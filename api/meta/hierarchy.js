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
  const link=story.link_data||story.template_data||{};
  const photo=story.photo_data||{};
  const video=story.video_data||{};
  const assets=creative.asset_feed_spec||{};
  const links=Array.isArray(link.child_attachments)?link.child_attachments:[];
  const assetImages=Array.isArray(assets.images)?assets.images:[];
  const assetVideos=Array.isArray(assets.videos)?assets.videos:[];
  const cards=links.length?links.slice(0,15).map((card,i)=>({
    index:i+1,name:card.name||card.title||'',description:card.description||'',
    picture:safeImage(card.picture)||safeImage(card.image_url)||null,
    image_hash:card.image_hash||null,video_id:card.video_id||null,video_url:null,
    link:safeImage(card.link)
  })):assetImages.length>1?assetImages.slice(0,15).map((image,i)=>({
    index:i+1,name:image.name||'',description:'',picture:safeImage(image.url),
    image_hash:image.hash||null,video_id:null,video_url:null,link:null
  })):[];
  const pictures=[creative.image_url,creative.thumbnail_url,link.picture,photo.url,video.image_url,...cards.map(x=>x.picture)]
    .map(safeImage).filter(Boolean);
  const images=[...new Set(pictures)].slice(0,15);
  const videoId=video.video_id||creative.video_id||assetVideos[0]?.video_id||null;
  const isCarousel=links.length>1;
  const isVideo=Boolean(videoId||assetVideos.length);
  const body=creative.body||link.message||photo.caption||video.message||assets.bodies?.[0]?.text||'';
  const title=creative.title||link.name||video.title||assets.titles?.[0]?.text||'';
  return {
    id:creative.id||null,name:creative.name||'Creatividad',title,body,
    format:isCarousel?'Carrusel':isVideo?'Video':assetImages.length>1?'Variantes de imagen':'Imagen',
    images,video_id:videoId,video_url:null,video_error:null,
    description:link.description||video.description||'',
    destination:safeImage(link.link)||safeImage(video.call_to_action?.value?.link),
    cta:creative.call_to_action_type||link.call_to_action?.type||video.call_to_action?.type||null,
    cards,
    story_id:creative.effective_object_story_id||creative.object_story_id||null
  };
}
async function enrichCreative(token,accountId,creative){
  const result=summarizeCreative(creative);
  if(!result)return null;
  // The standard creative thumbnail is frequently the only image in a video ad.
  // For multi-card ads, attempt image_hash resolution through the authorized ad account.
  const hashes=[...new Set(result.cards.map(c=>c.image_hash).filter(Boolean))].slice(0,15);
  if(hashes.length){
    try{
      const response=await graph(token,'act_'+accountId+'/adimages',{
        hashes:JSON.stringify(hashes),fields:'hash,url,url_128',limit:20
      });
      const lookup=new Map((response.data||[]).map(a=>[a.hash,safeImage(a.url)||safeImage(a.url_128)]));
      result.cards=result.cards.map(c=>({...c,picture:c.picture||lookup.get(c.image_hash)||null}));
    }catch(_){}
  }
  const ids=[...new Set([result.video_id,...result.cards.map(c=>c.video_id)].filter(Boolean))].slice(0,4);
  const media=await Promise.all(ids.map(async id=>{
    for(const fields of ['source,picture','source']){
      try{
        const response=await graph(token,String(id),{fields});
        return {id:String(id),url:safeImage(response.source),poster:safeImage(response.picture)};
      }catch(_){}
    }
    return {id:String(id),url:null,poster:null};
  }));
  const byId=new Map(media.map(x=>[x.id,x]));
  if(result.video_id){
    const record=byId.get(String(result.video_id));
    result.video_url=record?.url||null;
    result.video_error=!result.video_url?'Meta no habilitó la reproducción de este video para la autorización actual. Se muestra su miniatura.':null;
    if(record?.poster)result.images=[...new Set([record.poster,...result.images])];
  }
  result.cards=result.cards.map(card=>{
    const video=byId.get(String(card.video_id||''));
    return {...card,video_url:video?.url||null,picture:card.picture||video?.poster||null};
  });
  result.images=[...new Set([...result.cards.map(c=>c.picture).filter(Boolean),...result.images])].slice(0,18);
  return result;
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
      detail=await graph(token,ad.creative.id,{fields:'id,name,thumbnail_url,image_url,title,body,call_to_action_type,object_story_spec,asset_feed_spec,effective_object_story_id,object_story_id'});
    }catch(_){
      partial=true;
      detail=await graph(token,ad.creative.id,{fields:'id,name,thumbnail_url,image_url,title,body'});
    }
    return res.status(200).json({creative:await enrichCreative(token,accountId,detail),partial});
  }catch(e){return res.status(502).json({error:'No se pudo consultar Meta: '+String(e.message||'Error').slice(0,180)})}
}
