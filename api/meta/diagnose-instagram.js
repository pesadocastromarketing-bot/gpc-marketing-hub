import {createDecipheriv} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {admin,GRAPH} from './_shared.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function decode(cipher,iv){
 const key=process.env.META_TOKEN_ENCRYPTION_KEY;
 if(!/^[0-9a-f]{64}$/i.test(key||''))throw Error('Meta no está configurado');
 const bytes=Buffer.from(cipher,'base64');
 const decipher=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),Buffer.from(iv,'base64'));
 decipher.setAuthTag(bytes.subarray(-16));
 return Buffer.concat([decipher.update(bytes.subarray(0,-16)),decipher.final()]).toString('utf8');
}
async function get(token,path,fields){
 const url=new URL(GRAPH+'/'+path);
 if(fields)url.searchParams.set('fields',fields);
 const ctrl=new AbortController();
 const timeout=setTimeout(()=>ctrl.abort(),12000);
 try{
  const response=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:ctrl.signal});
  const body=await response.json();
  if(!response.ok||body.error)throw Error(body.error?.message||'Meta no concedió acceso');
  return body;
 }finally{clearTimeout(timeout)}
}
async function verify(token,pageId,igId){
 let after=null;let page=null;
 for(let n=0;n<6;n++){
  const path='me/accounts?'+new URLSearchParams({fields:'id,name,tasks,access_token',limit:'100',...(after?{after}:{})});
  const response=await get(token,path);
  page=(response.data||[]).find(p=>String(p.id)===String(pageId));
  if(page)break;
  const next=response.paging?.cursors?.after;
  if(!response.paging?.next||!next)break;
  after=next;
 }
 if(!page)return {page_seen:false,create_content:false,ig_matches:false};
 const create_content=(page.tasks||[]).includes('CREATE_CONTENT')&&Boolean(page.access_token);
 if(!create_content)return {page_seen:true,create_content:false,ig_matches:false};
 let ig;
 try{ig=await get(page.access_token,pageId,'instagram_business_account{id,username}')}
 catch(_){ig=await get(token,pageId,'instagram_business_account{id,username}')}
 return {page_seen:true,create_content:true,ig_matches:String(ig.instagram_business_account?.id||'')===String(igId)};
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Método no permitido'});
 if(!UUID.test(req.body?.asset_id||''))return res.status(400).json({error:'Instagram inválido'});
 const repair=req.body?.repair===true;
 try{
  const bearer=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if(!bearer)return res.status(401).json({error:'Necesitás iniciar sesión'});
  const auth=createClient(process.env.VITE_SUPABASE_URL,process.env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false}});
  const {data:{user},error:authError}=await auth.auth.getUser(bearer);
  if(authError||!user)return res.status(401).json({error:'Sesión inválida'});
  const db=admin();
  const {data:member,error:memberErr}=await db.from('hub_members').select('organization_id,role').eq('user_id',user.id).in('role',['owner','admin']).limit(1).maybeSingle();
  if(memberErr||!member)return res.status(403).json({error:'Solo administradores pueden diagnosticar conexiones'});
  const {data:asset,error:assetError}=await db.from('hub_meta_assets').select('id,organization_id,kind,display_name,external_id,brand_id,metadata').eq('id',req.body.asset_id).eq('organization_id',member.organization_id).eq('kind','instagram_account').maybeSingle();
  if(assetError||!asset)return res.status(404).json({error:'No se encontró el Instagram en tu workspace'});
  const pageId=asset.metadata?.page_id;
  if(!/^\d{6,30}$/.test(String(pageId||'')))return res.status(400).json({error:'El Instagram no tiene página de Facebook vinculada'});
  const {data:connections,error:connErr}=await db.rpc('hub_social_tokens');
  if(connErr)throw connErr;
  const active=(connections||[]).filter(c=>c.organization_id===member.organization_id&&(!c.expires_at||Date.parse(c.expires_at)>Date.now()));
  const authorized=active.filter(c=>(c.scopes||[]).includes('instagram_basic')&&(c.scopes||[]).includes('instagram_content_publish'));
  const diagnostics=await Promise.all(authorized.map(async (c,index)=>{
   try{
    const result=await verify(decode(c.token_ciphertext,c.token_iv),pageId,asset.external_id);
    return {connection_index:index+1,meta_user_id:c.meta_user_id,...result};
   }catch(e){
    return {connection_index:index+1,meta_user_id:c.meta_user_id,page_seen:false,create_content:false,ig_matches:false,error:String(e.message||e).slice(0,150)};
   }
  }));
  const valid=diagnostics.find(d=>d.page_seen&&d.create_content&&d.ig_matches);
  const currentlyMapped=Boolean(valid&&valid.meta_user_id===asset.metadata?.meta_user_id);
  const response={
   instagram:asset.display_name,instagram_id:asset.external_id,
   tested:authorized.length,valid_connection_found:Boolean(valid),currently_mapped:currentlyMapped,
   repair_available:Boolean(valid&&!currentlyMapped),
   diagnostics:diagnostics.map(({connection_index,page_seen,create_content,ig_matches,error})=>({connection_index,page_seen,create_content,ig_matches,...(error?{error}:{})})),
   message:valid?'Meta confirmó acceso a la página y al Instagram exacto.':authorized.length===0?'Falta autorizar instagram_content_publish en la cuenta personal de Meta.':'El permiso general está concedido, pero las conexiones autorizadas no pueden publicar en la página vinculada a este Instagram. Revisá las tareas de contenido en el BM propietario.'
  };
  if(repair){
   if(!valid)return res.status(409).json({...response,error:'No se puede asociar una identidad sin verificar acceso a Meta'});
   if(!currentlyMapped){
    // Repair ONLY this existing asset's identity; preserve its ID, business ownership and brand.
    const metadata={...asset.metadata,meta_user_id:valid.meta_user_id};
    const {data:updated,error:updateError}=await db.from('hub_meta_assets').update({metadata})
     .eq('id',asset.id).eq('organization_id',member.organization_id)
     .eq('kind','instagram_account').eq('external_id',asset.external_id)
     .select('id').maybeSingle();
    if(updateError||!updated)throw Error(updateError?.message||'No se pudo guardar la conexión');
   }
   return res.status(200).json({...response,repaired:true,currently_mapped:true,repair_available:false,
    message:'Conexión verificada y asociada al Instagram exacto. Actualizá las cuentas para ver el permiso.'});
  }
  return res.status(200).json(response);
 }catch(e){return res.status(500).json({error:'Diagnóstico de Meta: '+String(e.message||e).slice(0,180)})}
}
