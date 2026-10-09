import {createDecipheriv} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {admin,GRAPH} from '../meta/_shared.js';

// This endpoint is READ-ONLY against Meta: no publishing, cancelling or rescheduling.
const monthPattern=/^20\d{2}-(0[1-9]|1[0-2])$/;
function decrypt(cipher,iv){
 const hex=process.env.META_TOKEN_ENCRYPTION_KEY;
 if(!/^[0-9a-f]{64}$/i.test(hex||''))throw Error('Falta la clave de conexión de Meta');
 const bytes=Buffer.from(cipher,'base64');
 const d=createDecipheriv('aes-256-gcm',Buffer.from(hex,'hex'),Buffer.from(iv,'base64'));
 d.setAuthTag(bytes.subarray(-16));
 return Buffer.concat([d.update(bytes.subarray(0,-16)),d.final()]).toString('utf8');
}
async function graphGet(token,path,fields,after){
 const url=new URL(GRAPH+'/'+path);
 url.searchParams.set('fields',fields);
 url.searchParams.set('limit','100');
 if(after)url.searchParams.set('after',after);
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),12000);
 try{
  const r=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:controller.signal});
  const json=await r.json();
  if(!r.ok||json.error)throw Error(json.error?.message||'Meta rechazó la consulta');
  return json;
 }finally{clearTimeout(timer)}
}
async function connectionPages(token){
 const out=new Map();let after=null;
 for(let p=0;p<5;p++){
  const data=await graphGet(token,'me/accounts','id,name,access_token,tasks',after);
  for(const page of data.data||[])if(page.access_token)out.set(String(page.id),page.access_token);
  if(!data.paging?.next||!data.paging?.cursors?.after)break;
  after=data.paging.cursors.after;
 }
 return out;
}
function argentinaDate(instant){
 const d=new Date(instant);
 if(!Number.isFinite(d.getTime()))return null;
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d).map(x=>[x.type,x.value]));
 return {date:p.year+'-'+p.month+'-'+p.day,time:p.hour+':'+p.minute};
}
function normalize(asset,item,scheduled=false){
 const rawTimestamp=item.timestamp||item.created_time||item.scheduled_publish_time;
 const from=typeof rawTimestamp==='number'||/^\d{10}$/.test(String(rawTimestamp||''))
  ?new Date(Number(rawTimestamp)*1000).toISOString():rawTimestamp;
 const iso=new Date(from);
 const local=argentinaDate(from);
 if(!local||!item.id||!Number.isFinite(iso.getTime()))return null;
 const instagram=asset.kind==='instagram_account';
 const story=item.media_product_type==='STORY'||item._story;
 const format=story?'Historia':item.media_product_type==='REELS'?'Reel':item.media_type==='CAROUSEL_ALBUM'?'Carrusel':
  instagram&&item.media_type==='VIDEO'?'Video':'Imagen';
 const remoteThumbnail=instagram?(item.thumbnail_url||((item.media_type==='IMAGE'||story)?item.media_url:null)):
  (item.full_picture||item.attachments?.data?.[0]?.media?.image?.src||null);
 return {
  organization_id:asset.organization_id,meta_asset_id:asset.id,
  external_id:String(item.id),network:instagram?'Instagram':'Facebook',format,status:scheduled?'scheduled':'published',
  local_date:local.date,local_time:local.time,event_at:iso.toISOString(),
  caption:String(item.caption||item.message||'').slice(0,12000),
  thumbnail_url:remoteThumbnail||null,
  permalink_url:item.permalink||item.permalink_url||null,
  last_synced_at:new Date().toISOString()
 };
}
async function retrieve(token,asset,month,edge,fields,extra={}){
 const rows=[];let cursor=null,truncated=false,warning=null;
 // Paged from newest to oldest. Instagram /media does not support filtering by month;
 // limit pagination and report when older content is unreachable, never fabricate rows.
 const earliest=month+'-01',latest=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1)).toISOString().slice(0,10);
 for(let page=0;page<6;page++){
  let result;
  try{result=await graphGet(token,asset.external_id+'/'+edge,fields,cursor)}
  catch(e){warning=String(e.message||e).slice(0,180);break}
  const items=result.data||[];
  let older=false;
  for(const raw of items){
   const normalized=normalize(asset,{...raw,...extra},edge==='scheduled_posts');
   if(!normalized)continue;
   if(normalized.local_date<earliest)older=true;
   if(normalized.local_date>=earliest&&normalized.local_date<latest)rows.push(normalized);
  }
  if(older||!result.paging?.next||!result.paging?.cursors?.after)break;
  cursor=result.paging.cursors.after;
  if(page===5)truncated=true;
 }
 return {rows,truncated,warning};
}
async function writeRows(db,rows){
 let n=0;
 for(let i=0;i<rows.length;i+=75){
  const {error}=await db.from('hub_external_posts').upsert(rows.slice(i,i+75),{onConflict:'organization_id,meta_asset_id,external_id'});
  if(error)throw error;
  n+=Math.min(75,rows.length-i);
 }
 return n;
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Método no permitido'});
 const month=req.body?.month;
 if(typeof month!=='string'||!monthPattern.test(month))return res.status(400).json({error:'Mes inválido'});
 const thisMonth=new Date().toISOString().slice(0,7);
 if(month>String(Number(thisMonth.slice(0,4))+2)+'-12')return res.status(400).json({error:'Mes demasiado lejano'});
 try{
  const bearer=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if(!bearer)return res.status(401).json({error:'Iniciá sesión para sincronizar'});
  const auth=createClient(process.env.VITE_SUPABASE_URL,process.env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false}});
  const {data:{user},error:authError}=await auth.auth.getUser(bearer);
  if(authError||!user)return res.status(401).json({error:'La sesión venció. Volvé a iniciar sesión'});
  const db=admin();
  const {data:membership}=await db.from('hub_members').select('organization_id,role').eq('user_id',user.id).limit(1).maybeSingle();
  if(!membership)return res.status(403).json({error:'No tenés acceso al calendario'});
  if(!['owner','admin','editor'].includes(membership.role))return res.status(403).json({error:'Pedile a un editor que sincronice Meta'});
  const org=membership.organization_id;
  const [{data:assets,error:assetsError},{data:tokens,error:tokensError}]=await Promise.all([
   db.from('hub_meta_assets').select('id,organization_id,brand_id,kind,external_id,display_name,metadata').eq('organization_id',org).not('brand_id','is',null).in('kind',['page','instagram_account']),
   db.rpc('hub_social_tokens')
  ]);
  if(assetsError||tokensError)throw assetsError||tokensError;
  const validTokens=(tokens||[]).filter(t=>t.organization_id===org&&(!t.expires_at||Date.parse(t.expires_at)>Date.now()));
  const scopeFor={page:'pages_read_engagement',instagram_account:'instagram_basic'};
  const tokenByUser=new Map(),pageCache=new Map(),warnings=[],matchedAssets=[];
  for(const a of assets||[]){
   const connection=validTokens.find(t=>t.meta_user_id===a.metadata?.meta_user_id&&(t.scopes||[]).includes(scopeFor[a.kind]));
   if(!connection){warnings.push(a.display_name+': conexión sin permiso de lectura');continue}
   if(!tokenByUser.has(connection.meta_user_id))tokenByUser.set(connection.meta_user_id,decrypt(connection.token_ciphertext,connection.token_iv));
   matchedAssets.push({asset:a,connection});
  }
  let imported=0,completed=0;
  const fetchOne=async ({asset,connection})=>{
   const userToken=tokenByUser.get(connection.meta_user_id);
   if(!pageCache.has(connection.meta_user_id))pageCache.set(connection.meta_user_id,connectionPages(userToken));
   let pages;
   try{pages=await pageCache.get(connection.meta_user_id)}
   catch(e){warnings.push(asset.display_name+': '+String(e.message).slice(0,110));return}
   const pageId=asset.kind==='page'?asset.external_id:asset.metadata?.page_id;
   const pageToken=pages.get(String(pageId||'')); 
   if(!pageToken){warnings.push(asset.display_name+': falta acceso a su página vinculada');return}
   const jobs=asset.kind==='instagram_account'?[
    ['media','id,caption,media_type,media_product_type,timestamp,permalink,thumbnail_url,media_url',{}],
    ...(month===thisMonth?[['stories','id,media_type,timestamp,media_url,thumbnail_url',{_story:true}]]:[])
   ]:[
    ['posts','id,message,created_time,permalink_url,full_picture',{}],
    ['scheduled_posts','id,message,scheduled_publish_time,full_picture',{}]
   ];
   for(const [edge,fields,extra] of jobs){
    const found=await retrieve(pageToken,asset,month,edge,fields,extra);
    if(found.warning)warnings.push(asset.display_name+' ('+edge+'): '+found.warning);
    if(found.truncated)warnings.push(asset.display_name+' ('+edge+'): hay más resultados; el historial de este mes podría estar incompleto');
    if(found.rows.length)imported+=await writeRows(db,found.rows);
   }
   completed++;
  };
  // Concurrency stays low to avoid hitting Meta rate limits and function timeout.
  let i=0;
  const workers=Array.from({length:3},async()=>{while(i<matchedAssets.length){const target=matchedAssets[i++];try{await fetchOne(target)}catch(e){warnings.push(target.asset.display_name+': '+String(e.message||e).slice(0,130))}}});
  await Promise.all(workers);
  return res.status(200).json({month,imported,assets_checked:completed,assets_available:matchedAssets.length,warnings:warnings.slice(0,35),history_note:'Las historias anteriores a las últimas 24 horas no se pueden recuperar desde esta API; el Hub guardará las que detecte en las próximas sincronizaciones.'});
 }catch(e){return res.status(500).json({error:'Error al leer el historial de Meta: '+String(e.message||e).slice(0,180)})}
}
