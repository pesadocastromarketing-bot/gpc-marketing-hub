import {createDecipheriv} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {admin,GRAPH} from './_shared.js';

function decrypt(ciphertext,ivB64){
  const key=process.env.META_TOKEN_ENCRYPTION_KEY;
  if(!/^[0-9a-fA-F]{64}$/.test(key||''))throw Error('Encryption not configured');
  const bytes=Buffer.from(ciphertext,'base64');
  const decipher=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),Buffer.from(ivB64,'base64'));
  decipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([decipher.update(bytes.subarray(0,-16)),decipher.final()]).toString('utf8');
}
function validId(value){return typeof value==='string'&&/^\d{6,25}$/.test(value)}
function safeImage(value){return typeof value==='string'&&/^https:\/\//i.test(value)?value:null}
async function graph(token,path,params={}){
  const url=new URL(GRAPH+'/'+path);
  Object.entries(params).forEach(([key,value])=>url.searchParams.set(key,String(value)));
  const response=await fetch(url,{headers:{Authorization:'Bearer '+token}});
  const body=await response.json();
  if(!response.ok)throw Error(body.error?.message||'Meta no permitió consultar los datos');
  return body;
}
async function pageAll(token,path,fields){
  const all=[];let after=null;let more=false;
  for(let page=0;page<5;page++){
    const data=await graph(token,path,{fields,limit:100,...(after?{after}:{})});
    all.push(...(data.data||[]));
    const cursor=data.paging?.cursors?.after;
    more=Boolean(data.paging?.next&&cursor);
    if(!more)break;
    after=cursor;
  }
  return {items:all,truncated:more};
}
function summarizeCreative(creative){
  if(!creative)return null;
  const story=creative.object_story_spec||{};
  const link=story.link_data||{};
  const photo=story.photo_data||{};
  const video=story.video_data||{};
  const assets=creative.asset_feed_spec||{};
  const cards=Array.isArray(link.child_attachments)?link.child_attachments:[];
  const assetImages=Array.isArray(assets.images)?assets.images:[];
  const assetVideos=Array.isArray(assets.videos)?assets.videos:[];
  const pictures=[creative.image_url,creative.thumbnail_url,link.picture,photo.url,video.image_url,...cards.map(x=>x.picture),...assetImages.map(x=>x.url)].map(safeImage).filter(Boolean);
  const images=[...new Set(pictures)].slice(0,12);
  const isVideo=Boolean(video.video_id||assetVideos.length);
  const isCarousel=cards.length>1||assetImages.length>1;
  const body=creative.body||link.message||photo.caption||video.message||assets.bodies?.[0]?.text||'';
  const title=creative.title||link.name||video.title||assets.titles?.[0]?.text||'';
  return {
    id:creative.id||null,name:creative.name||'Creatividad',title,body,
    format:isCarousel?'Carrusel':isVideo?'Video':'Imagen',
    images,video_id:video.video_id||assetVideos[0]?.video_id||null,
    description:link.description||video.description||'',
    destination:link.link||video.call_to_action?.value?.link||null,
    cta:creative.call_to_action_type||link.call_to_action?.type||video.call_to_action?.type||null,
    cards:cards.slice(0,12).map(x=>({name:x.name||'',description:x.description||'',picture:safeImage(x.picture),link:x.link||null}))
  };
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  if(req.method!=='GET')return res.status(405).json({error:'Método no permitido'});
  const level=String(req.query.level||'');
  const accountId=String(req.query.account_id||'');
  const campaignId=String(req.query.campaign_id||'');
  const adsetId=String(req.query.adset_id||'');
  const adId=String(req.query.ad_id||'');
  if(!['adsets','ads','creative'].includes(level)||!validId(accountId)||
    (level==='adsets'&&!validId(campaignId))||
    (level==='ads'&&(!validId(campaignId)||!validId(adsetId)))||
    (level==='creative'&&(!validId(adsetId)||!validId(adId))))
    return res.status(400).json({error:'Parámetros de consulta inválidos'});
  try{
    const bearer=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if(!bearer)return res.status(401).json({error:'Iniciá sesión'});
    const auth=createClient(process.env.VITE_SUPABASE_URL,process.env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false}});
    const {data:{user},error:authError}=await auth.auth.getUser(bearer);
    if(authError||!user)return res.status(401).json({error:'Sesión inválida'});
    const db=admin();
    const {data:membership,error:membershipError}=await db.from('hub_members').select('organization_id').eq('user_id',user.id).limit(1).maybeSingle();
    if(membershipError||!membership)return res.status(403).json({error:'Workspace no autorizado'});
    const {data:connections,error:dbError}=await db.rpc('hub_meta_encrypted_connections');
    if(dbError)throw dbError;
    let token=null;
    for(const connection of (connections||[]).filter(c=>c.organization_id===membership.organization_id)){
      if(connection.expires_at&&Date.parse(connection.expires_at)<Date.now())continue;
      try{
        const candidate=decrypt(connection.token_ciphertext,connection.token_iv);
        const account=await graph(candidate,'act_'+accountId,{fields:'account_id'});
        if(String(account.account_id)===accountId){token=candidate;break}
      }catch(_){}
    }
    if(!token)return res.status(403).json({error:'Esta cuenta no está autorizada en tu workspace'});
    if(level==='adsets'){
      const campaign=await graph(token,campaignId,{fields:'id,account_id'});
      if(String(campaign.account_id)!==accountId)return res.status(403).json({error:'Campaña fuera de la cuenta seleccionada'});
      const result=await pageAll(token,campaignId+'/adsets','id,name,status,effective_status,optimization_goal,billing_event,daily_budget,lifetime_budget,start_time,end_time,campaign_id');
      return res.status(200).json({adsets:result.items.map(x=>({id:x.id,name:x.name,status:x.status,effective_status:x.effective_status,optimization_goal:x.optimization_goal,billing_event:x.billing_event,daily_budget:x.daily_budget||null,lifetime_budget:x.lifetime_budget||null,start_time:x.start_time||null,end_time:x.end_time||null})),truncated:result.truncated});
    }
    const adset=await graph(token,adsetId,{fields:'id,account_id,campaign_id'});
    if(String(adset.account_id)!==accountId||(level==='ads'&&String(adset.campaign_id)!==campaignId))
      return res.status(403).json({error:'Conjunto fuera de la cuenta o campaña seleccionada'});
    if(level==='ads'){
      const result=await pageAll(token,adsetId+'/ads','id,name,status,effective_status,adset_id,creative{id,name,thumbnail_url}');
      return res.status(200).json({ads:result.items.map(x=>({id:x.id,name:x.name,status:x.status,effective_status:x.effective_status,thumbnail_url:safeImage(x.creative?.thumbnail_url),creative_id:x.creative?.id||null,creative_name:x.creative?.name||null})),truncated:result.truncated});
    }
    const ad=await graph(token,adId,{fields:'id,name,adset_id,account_id,creative{id,name,thumbnail_url}'});
    if(String(ad.account_id)!==accountId||String(ad.adset_id)!==adsetId)
      return res.status(403).json({error:'Anuncio fuera del conjunto seleccionado'});
    if(!ad.creative?.id)return res.status(200).json({creative:null,message:'Este anuncio no tiene una creatividad accesible'});
    let detail,partial=false;
    try{
      detail=await graph(token,ad.creative.id,{fields:'id,name,thumbnail_url,image_url,title,body,call_to_action_type,object_story_spec,asset_feed_spec'});
    }catch(_){
      partial=true;
      detail=await graph(token,ad.creative.id,{fields:'id,name,thumbnail_url,image_url,title,body'});
    }
    return res.status(200).json({creative:summarizeCreative(detail),partial});
  }catch(e){return res.status(502).json({error:'No se pudo consultar Meta: '+String(e.message||'Error').slice(0,180)})}
}
