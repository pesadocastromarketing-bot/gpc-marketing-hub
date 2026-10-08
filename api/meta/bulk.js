import {createDecipheriv} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {admin,GRAPH} from './_shared.js';
const ID=/^\d{6,25}$/;
function decrypt(c,iv){
 const key=process.env.META_TOKEN_ENCRYPTION_KEY;
 if(!/^[0-9a-fA-F]{64}$/.test(key||''))throw Error('Meta encryption unavailable');
 const bytes=Buffer.from(c,'base64');const decipher=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),Buffer.from(iv,'base64'));
 decipher.setAuthTag(bytes.subarray(-16));
 return Buffer.concat([decipher.update(bytes.subarray(0,-16)),decipher.final()]).toString('utf8');
}
async function graph(token,path,fields){
 const url=new URL(GRAPH+'/'+path);url.searchParams.set('fields',fields);
 const result=await fetch(url,{headers:{Authorization:'Bearer '+token}});
 return {ok:result.ok,body:await result.json()};
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Método no permitido'});
 const {account_id,ids,operation,daily_budget,confirmation}=req.body||{};
 if(!ID.test(String(account_id))||!Array.isArray(ids)||ids.length<1||ids.length>25||
 !ids.every(x=>typeof x==='string'&&ID.test(x))||new Set(ids).size!==ids.length||
 !['pause','activate','daily_budget'].includes(operation)||confirmation!=='CONFIRMAR')
 return res.status(400).json({error:'Seleccioná de 1 a 25 campañas y confirmá la operación.'});
 if(operation==='daily_budget'&&(!Number.isInteger(daily_budget)||daily_budget<100||daily_budget>1000000000))
 return res.status(400).json({error:'Presupuesto inválido. Enviá un importe entero en unidades mínimas de moneda.'});
 try{
 const bearer=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
 if(!bearer)return res.status(401).json({error:'Iniciá sesión'});
 const auth=createClient(process.env.VITE_SUPABASE_URL,process.env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false}});
 const {data:{user},error:authError}=await auth.auth.getUser(bearer);
 if(authError||!user)return res.status(401).json({error:'Sesión inválida'});
 const db=admin();
 const {data:member}=await db.from('hub_members').select('organization_id,role').eq('user_id',user.id).in('role',['owner','admin']).limit(1).maybeSingle();
 if(!member)return res.status(403).json({error:'Solo administradores pueden modificar campañas.'});
 const {data:connections,error:dbError}=await db.rpc('hub_meta_encrypted_connections');if(dbError)throw dbError;
 const {data:businessConnections,error:businessError}=await db.rpc('hub_social_tokens');if(businessError)throw businessError;
 let token=null;
 for(const connection of ([...(businessConnections||[]),...(connections||[])]).filter(c=>c.organization_id===member.organization_id)){
  if(connection.expires_at&&new Date(connection.expires_at).getTime()<Date.now())continue;
  try{
   const candidate=decrypt(connection.token_ciphertext,connection.token_iv);
   const [account,permissions]=await Promise.all([graph(candidate,'act_'+account_id,'account_id,currency'),graph(candidate,'me/permissions','permission,status')]);
   const granted=(permissions.ok&&(permissions.body.data||[]).some(x=>x.permission==='ads_management'&&x.status==='granted'))||
     (connection.scopes||[]).includes('ads_management');
   if(account.ok&&String(account.body.account_id)===String(account_id)&&granted){token=candidate;break}
  }catch(_){}
 }
 if(!token)return res.status(403).json({error:'Falta ads_management. Entrá a Configuración y autorizá la edición de anuncios en Meta.'});
 const output=[];
 for(const campaignId of ids){
  let outcome='error',message='',previous=null;
  try{
   const result=await graph(token,campaignId,'id,name,account_id,status,effective_status,daily_budget,lifetime_budget');
   if(!result.ok||String(result.body.account_id)!==String(account_id))throw Error('Campaña no pertenece a la cuenta seleccionada');
   previous=result.body;
   if(operation==='activate'&&['ARCHIVED','DELETED'].includes(previous.status))throw Error('No se puede activar una campaña archivada o eliminada');
   if(operation==='daily_budget'&&!previous.daily_budget)throw Error('Sin presupuesto diario a nivel campaña; puede estar en el conjunto o usar presupuesto total');
   const params=new URLSearchParams();
   if(operation==='pause')params.set('status','PAUSED');
   if(operation==='activate')params.set('status','ACTIVE');
   if(operation==='daily_budget')params.set('daily_budget',String(daily_budget));
   const mutation=await fetch(GRAPH+'/'+campaignId,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/x-www-form-urlencoded'},body:params.toString()});
   const response=await mutation.json();
   if(!mutation.ok||response.success!==true)throw Error(response.error?.message||'Meta no confirmó el cambio');
   outcome='success';message='Confirmado por Meta';
  }catch(e){message=String(e.message||e).slice(0,180)}
  output.push({id:campaignId,name:previous?.name||campaignId,outcome,message});
  await db.from('hub_ads_audit').insert({
   organization_id:member.organization_id,actor:user.id,ad_account_id:account_id,
   campaign_id:campaignId,operation,requested_value:String(operation==='daily_budget'?daily_budget:operation),
   outcome,response_summary:message
  });
 }
 return res.status(200).json({results:output,changed:output.filter(x=>x.outcome==='success').length,total:ids.length});
 }catch(e){return res.status(500).json({error:'Error del servidor: '+String(e.message).slice(0,150)})}
}
