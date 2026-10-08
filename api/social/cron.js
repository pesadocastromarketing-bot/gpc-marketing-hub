import {createDecipheriv} from 'node:crypto';
import {admin,GRAPH} from '../meta/_shared.js';
function decrypt(c,iv){const key=process.env.META_TOKEN_ENCRYPTION_KEY;const b=Buffer.from(c,'base64');const d=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),Buffer.from(iv,'base64'));d.setAuthTag(b.subarray(-16));return Buffer.concat([d.update(b.subarray(0,-16)),d.final()]).toString('utf8')}
async function graph(token,path,params=null){
 const url=new URL(GRAPH+'/'+path);
 if(!params){const r=await fetch(url,{headers:{Authorization:'Bearer '+token}});const j=await r.json();if(!r.ok)throw Error(j.error?.message||'Meta rechazó la consulta');return j}
 const body=new URLSearchParams();
 for(const [key,value] of Object.entries(params))body.set(key,String(value));
 const r=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/x-www-form-urlencoded'},body:body.toString()});
 const j=await r.json();if(!r.ok)throw Error(j.error?.message||'Meta rechazó la publicación');return j;
}
async function pageToken(userToken,pageId){
 let url=GRAPH+'/me/accounts?fields=id,name,access_token,tasks&limit=100',count=0;
 while(url&&count++<5){
  const parsed=new URL(url);if(parsed.hostname!=='graph.facebook.com')throw Error('URL de Meta no válida');
  const r=await fetch(url,{headers:{Authorization:'Bearer '+userToken}});const j=await r.json();
  if(!r.ok)throw Error(j.error?.message||'No se pudo leer Pages');
  const page=(j.data||[]).find(x=>String(x.id)===String(pageId));
  if(page){if(!page.access_token||!page.tasks?.includes('CREATE_CONTENT'))throw Error('No tenés permiso CREATE_CONTENT para esta página');return page.access_token}
  url=j.paging?.next||null;
 }
 throw Error('La página ya no está disponible en la autorización actual');
}
async function signedMedia(db,paths){
 const urls=[];
 for(const path of paths){
  const {data,error}=await db.storage.from('hub-creatives').createSignedUrl(path,7200);
  if(error||!data?.signedUrl)throw Error('No se pudo generar URL de creatividad');
  urls.push(data.signedUrl);
 }
 return urls;
}
async function publishFb(page,token,post,media){
 const caption=post.copy_text||'';
 if(post.format==='Imagen'){
  const response=await graph(token,page+'/photos',{url:media[0],caption,published:'true'});
  return response.post_id||response.id||null;
 }
 if(post.format==='Carrusel'){
  const ids=[];
  for(const url of media){const p=await graph(token,page+'/photos',{url,published:'false'});if(!p.id)throw Error('Meta no devolvió ID de foto del carrusel');ids.push(p.id)}
  const values={message:caption};
  ids.forEach((v,i)=>{values['attached_media['+i+']']=JSON.stringify({media_fbid:v})});
  const postResult=await graph(token,page+'/feed',values);
  return postResult.id||null;
 }
 if(post.format==='Reel'){
  const started=await graph(token,page+'/video_reels',{upload_phase:'start'});
  if(!started.video_id||!started.upload_url)throw Error('Meta no inició carga de Reel');
  const url=new URL(started.upload_url);
  if(url.protocol!=='https:'||url.hostname!=='rupload.facebook.com')throw Error('Servidor de upload inválido');
  const uploaded=await fetch(url,{method:'POST',headers:{Authorization:'OAuth '+token,file_url:media[0]}});
  const up=await uploaded.json();
  if(!uploaded.ok||up.success===false)throw Error(up.error?.message||'Meta no aceptó el video');
  const completed=await graph(token,page+'/video_reels',{video_id:started.video_id,upload_phase:'finish',video_state:'PUBLISHED',description:caption,title:post.title||''});
  if(completed.success!==true)throw Error('Meta no confirmó la publicación del Reel');
  return started.video_id;
 }
 throw Error('Formato de Facebook no habilitado');
}
async function publishIg(ig,token,post,media,existingContainer){
 let container=existingContainer;
 if(!container){
  if(post.format==='Imagen'){
   const created=await graph(token,ig+'/media',{image_url:media[0],caption:post.copy_text||''});
   container=created.id;
  }else if(post.format==='Carrusel'){
   const children=[];
   for(const url of media){const c=await graph(token,ig+'/media',{image_url:url,is_carousel_item:'true'});if(!c.id)throw Error('Meta no creó tarjeta de Instagram');children.push(c.id)}
   const result=await graph(token,ig+'/media',{media_type:'CAROUSEL',children:children.join(','),caption:post.copy_text||''});
   container=result.id;
  }else if(post.format==='Reel'){
   const result=await graph(token,ig+'/media',{media_type:'REELS',video_url:media[0],caption:post.copy_text||''});
   container=result.id;
   if(!container)throw Error('Meta no creó contenedor de Reel');
   return {processing:true,container};
  }else throw Error('Formato Instagram no soportado');
 }
 if(!container)throw Error('No se creó contenedor de Instagram');
 if(post.format==='Reel'){
  const j=await fetch(GRAPH+'/'+container+'?fields=status_code',{headers:{Authorization:'Bearer '+token}}).then(x=>x.json());
  if(j.error)throw Error(j.error.message||'Error de procesamiento en Meta');
  if(j.status_code==='ERROR'||j.status_code==='EXPIRED')throw Error('Meta rechazó o venció el procesamiento de Reel');
  if(j.status_code!=='FINISHED')return {processing:true,container};
 }
 const result=await graph(token,ig+'/media_publish',{creation_id:container});
 if(!result.id)throw Error('Meta no confirmó la publicación de Instagram');
 return {id:result.id};
}
export default async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'Método no permitido'});
 if(!process.env.CRON_SECRET||req.headers.authorization!=='Bearer '+process.env.CRON_SECRET)return res.status(401).json({error:'Sin autorización'});
 res.setHeader('Cache-Control','no-store');
 try{
  const db=admin();
  const {data:tasks,error}=await db.rpc('hub_claim_publication_jobs',{p_limit:5});
  if(error)throw error;
  const {data:connections,error:tokensError}=await db.rpc('hub_social_tokens');if(tokensError)throw tokensError;
  const outcome=[];
  for(const job of tasks||[]){
   try{
    const {data:post}=await db.from('hub_content').select('*').eq('id',job.content_id).eq('organization_id',job.organization_id).maybeSingle();
    const {data:asset}=await db.from('hub_meta_assets').select('*').eq('id',job.meta_asset_id).eq('organization_id',job.organization_id).maybeSingle();
    if(!post||!asset||post.target_asset_id!==asset.id)throw Error('Publicación o destino ya no coinciden');
    const social=(connections||[]).find(c=>c.organization_id===job.organization_id&&c.meta_user_id===asset.metadata?.meta_user_id&&(!c.expires_at||Date.parse(c.expires_at)>Date.now()));
    if(!social)throw Error('Autorización Meta vencida o desconectada');
    if(asset.kind==='instagram_account'&&!(social.scopes||[]).includes('instagram_content_publish'))throw Error('Permiso de Instagram no disponible');
    const userToken=decrypt(social.token_ciphertext,social.token_iv);
    const pageId=asset.kind==='page'?asset.external_id:asset.metadata?.page_id;
    if(!pageId)throw Error('Cuenta sin página vinculada');
    const pToken=await pageToken(userToken,pageId);
    const urls=job.external_container_id?[]:await signedMedia(db,post.media_paths||[]);
    let publishedId=null,processing=null;
    if(asset.kind==='page')publishedId=await publishFb(pageId,pToken,post,urls);
    else if(asset.kind==='instagram_account'){
      const result=await publishIg(asset.external_id,pToken,post,urls,job.external_container_id);
      if(result.processing)processing=result.container;else publishedId=result.id;
    }else throw Error('Red social no soportada');
    if(processing){
      if(job.attempts>=20)throw Error('Tiempo de procesamiento agotado en Meta');
      await db.from('hub_publication_jobs').update({external_container_id:processing,error_message:null}).eq('id',job.job_id);
      outcome.push({job_id:job.job_id,status:'processing'});
    }else{
      await db.from('hub_publication_jobs').update({status:'published',external_post_id:String(publishedId||''),error_message:null,lease_until:null}).eq('id',job.job_id);
      await db.from('hub_content').update({status:'published'}).eq('id',post.id);
      outcome.push({job_id:job.job_id,status:'published'});
    }
   }catch(e){
    const message=String(e.message||e).slice(0,500);
    await db.from('hub_publication_jobs').update({status:'failed',error_message:message,lease_until:null}).eq('id',job.job_id);
    await db.from('hub_content').update({status:'failed'}).eq('id',job.content_id);
    outcome.push({job_id:job.job_id,status:'failed',error:message});
   }
  }
  return res.status(200).json({processed:outcome.length,results:outcome});
 }catch(e){return res.status(500).json({error:'Error de cola: '+String(e.message||e).slice(0,150)})}
}
