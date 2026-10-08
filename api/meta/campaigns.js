import {createDecipheriv} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {admin,GRAPH} from './_shared.js';
function decrypt(ciphertext,ivB64){const key=process.env.META_TOKEN_ENCRYPTION_KEY;if(!/^[0-9a-fA-F]{64}$/.test(key||''))throw Error('Encryption not configured');const b=Buffer.from(ciphertext,'base64');const d=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),Buffer.from(ivB64,'base64'));d.setAuthTag(b.subarray(-16));return Buffer.concat([d.update(b.subarray(0,-16)),d.final()]).toString('utf8')}
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const id=String(req.query.account_id||'');
 if(!/^\d{6,25}$/.test(id))return res.status(400).json({error:'Seleccioná una cuenta válida'});
 try{
 const bearer=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];if(!bearer)return res.status(401).json({error:'Iniciá sesión'});
 const client=createClient(process.env.VITE_SUPABASE_URL,process.env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false}});
 const {data:{user},error}=await client.auth.getUser(bearer);if(error||!user)return res.status(401).json({error:'Sesión inválida'});
 const db=admin();const {data:membership}=await db.from('hub_members').select('organization_id').eq('user_id',user.id).limit(1).maybeSingle();if(!membership)return res.status(403).json({error:'Sin workspace'});
 const {data:connections,error:dbError}=await db.rpc('hub_meta_encrypted_connections');if(dbError)throw dbError;
 for(const connection of (connections||[]).filter(c=>c.organization_id===membership.organization_id)){
  if(connection.expires_at&&Date.parse(connection.expires_at)<Date.now())continue;
  const token=decrypt(connection.token_ciphertext,connection.token_iv);
  const accountUrl=GRAPH+'/act_'+id+'?fields=id,account_id,name&access_token='+encodeURIComponent(token);
  const check=await fetch(accountUrl);if(!check.ok)continue;
  const account=await check.json();if(String(account.account_id)!==id)continue;
  const fields='id,name,status,effective_status,objective,daily_budget,lifetime_budget,buying_type,created_time,updated_time';
  let next=GRAPH+'/act_'+id+'/campaigns?fields='+encodeURIComponent(fields)+'&limit=100&access_token='+encodeURIComponent(token);
  const campaigns=[];let pages=0;
  while(next&&pages++<5){
   const response=await fetch(next);const data=await response.json();
   if(!response.ok)return res.status(502).json({error:data.error?.message||'Meta no permitió leer campañas'});
   for(const c of data.data||[])campaigns.push({id:c.id,name:c.name,status:c.status,effective_status:c.effective_status,objective:c.objective,daily_budget:c.daily_budget||null,lifetime_budget:c.lifetime_budget||null,created_time:c.created_time,updated_time:c.updated_time});
   next=data.paging?.next||null;
  }
  return res.status(200).json({account:{id, name:account.name},campaigns,truncated:!!next});
 }
 return res.status(403).json({error:'No hay autorización para esta cuenta en tu workspace'});
 }catch(e){return res.status(500).json({error:'No se pudieron leer las campañas'})}
}
