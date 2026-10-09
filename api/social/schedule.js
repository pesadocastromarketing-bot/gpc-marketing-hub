import {createClient} from '@supabase/supabase-js';
import {admin} from '../meta/_shared.js';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Método no permitido'});
 const {ids,confirmation}=req.body||{};
 if(!Array.isArray(ids)||!ids.length||ids.length>100||!ids.every(x=>typeof x==='string'&&UUID.test(x))||new Set(ids).size!==ids.length||!['PROGRAMAR','PUBLICAR_AHORA'].includes(confirmation))
 return res.status(400).json({error:'Seleccioná de 1 a 100 publicaciones y confirmá el envío'});
 try{
 const bearer=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];if(!bearer)return res.status(401).json({error:'Iniciá sesión'});
 const auth=createClient(process.env.VITE_SUPABASE_URL,process.env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false}});
 const {data:{user},error:authError}=await auth.auth.getUser(bearer);
 if(authError||!user)return res.status(401).json({error:'Sesión inválida'});
 const db=admin();
 const {data:membership}=await db.from('hub_members').select('organization_id,role').eq('user_id',user.id).in('role',['owner','admin','editor']).limit(1).maybeSingle();
 if(!membership)return res.status(403).json({error:'No tenés autorización para programar publicaciones'});
 const {data:posts,error:postsError}=await db.from('hub_content').select('id,organization_id,brand_id,target_asset_id,channels,format,media_paths,scheduled_date,scheduled_time,status').eq('organization_id',membership.organization_id).in('id',ids);
 if(postsError)throw postsError;
 const {data:assets,error:assetsError}=await db.from('hub_meta_assets').select('id,brand_id,kind,metadata,display_name').eq('organization_id',membership.organization_id);
 if(assetsError)throw assetsError;
 const results=[];
 for(const p of posts||[]){
  let error=null,asset=null,scheduled=null;
  try{
   if(p.status==='published'||p.status==='publishing')throw Error('Publicación ya enviada o en proceso');
   const channel=p.channels?.[0];
   if(!['Facebook','Instagram'].includes(channel))throw Error('Red social no disponible');
   if(p.channels.length!==1)throw Error('La publicación debe pertenecer a una red por fila');
   if(!p.scheduled_date||!p.scheduled_time)throw Error('Falta fecha u hora');
   const raw=p.scheduled_date+'T'+String(p.scheduled_time).slice(0,5)+':00-03:00';
   scheduled=new Date(raw);
   if(!Number.isFinite(scheduled.getTime()))throw Error('Fecha u hora inválida');
   if(confirmation==='PUBLICAR_AHORA'){
    // Immediate mode is reserved for Instagram stories. Every item still has its own
    // scheduled slot so a batch is processed in the user's chosen sequence.
    if(channel!=='Instagram'||p.format!=='Historia')throw Error('Publicar ahora está disponible para historias de Instagram');
    if(scheduled.getTime()>Date.now()+15*60*1000)throw Error('Reintentá el envío: la hora inmediata ya no es válida');
    scheduled=new Date(Math.max(Date.now(),scheduled.getTime()));
   }else if(scheduled.getTime()<Date.now()+2*60*1000)throw Error('Elegí una fecha al menos dos minutos en el futuro');
   if(scheduled.getTime()>Date.now()+365*86400000)throw Error('La programación no puede superar un año');
   const kind=channel==='Facebook'?'page':'instagram_account';
   const candidates=(assets||[]).filter(a=>a.brand_id===p.brand_id&&a.kind===kind);
   if(p.target_asset_id){
    asset=candidates.find(a=>a.id===p.target_asset_id);
    if(!asset)throw Error('El destino elegido no corresponde a la marca y red social de la publicación');
   }else{
    if(candidates.length!==1)throw Error(candidates.length?'Esta marca tiene varios perfiles; elegí el destino exacto al crear el lote':'Vinculá una cuenta de '+channel+' a esta marca en Configuración');
    asset=candidates[0];
   }
   if(kind==='page'&&!asset.metadata?.tasks?.includes('CREATE_CONTENT'))throw Error('Meta no concedió la tarea CREATE_CONTENT en esta página');
   if(!p.media_paths?.length)throw Error('Subí primero la creatividad');
   const {data:media,error:mediaError}=await db.from('hub_media').select('storage_path,mime_type').eq('organization_id',membership.organization_id).in('storage_path',p.media_paths);
   if(mediaError||media?.length!==p.media_paths.length)throw Error('Faltan archivos de la creatividad');
   if(p.format==='Imagen'&&(media.length!==1||!media[0].mime_type.startsWith('image/')))throw Error('Imagen requiere una imagen');
   if(p.format==='Carrusel'&&(media.length<2||media.length>10||media.some(m=>!m.mime_type.startsWith('image/'))))throw Error('Carrusel requiere entre 2 y 10 imágenes');
   if(p.format==='Reel'&&(media.length!==1||!media[0].mime_type.startsWith('video/')))throw Error('Reel requiere un video');
   if(p.format==='Historia'){
    if(channel!=='Instagram')throw Error('Las historias automáticas están disponibles solamente en Instagram');
    if(media.length!==1||!['image/jpeg','video/mp4','video/quicktime'].includes(media[0].mime_type))throw Error('Historia de Instagram requiere una sola imagen JPG o un video MP4/MOV');
   }
   if(channel==='Instagram'&&['Imagen','Carrusel'].includes(p.format)&&media.some(m=>m.mime_type!=='image/jpeg'))throw Error('Instagram requiere imágenes JPG; convertí las imágenes antes de programar');
   if(channel==='Facebook'&&['Imagen','Carrusel'].includes(p.format)&&media.some(m=>!['image/jpeg','image/png'].includes(m.mime_type)))throw Error('Facebook requiere imágenes JPG o PNG');
   // Confirm that the current OAuth social connection still exists; worker checks permissions again before publish.
   const {data:tokens}=await db.rpc('hub_social_tokens');
   if(channel==='Facebook'&&!(tokens||[]).some(t=>t.organization_id===membership.organization_id&&(!t.expires_at||Date.parse(t.expires_at)>Date.now())))throw Error('Autorizá el acceso de Facebook en Meta');
   if(channel==='Instagram'){
    const authorized=(tokens||[]).some(t=>t.organization_id===membership.organization_id&&t.meta_user_id===asset.metadata?.meta_user_id&&
     (!t.expires_at||Date.parse(t.expires_at)>Date.now())&&(t.scopes||[]).includes('instagram_content_publish')&&(t.scopes||[]).includes('instagram_basic'));
    let directAuthorized=false;
    if(!authorized){
     const {data:direct,error:directError}=await db.schema('hub_private').from('instagram_direct_connections')
      .select('instagram_scoped_id,expires_at,username,scopes')
      .eq('organization_id',membership.organization_id).eq('asset_id',asset.id).maybeSingle();
     if(directError)throw directError;
     directAuthorized=Boolean(direct&&Date.parse(direct.expires_at)>Date.now()&&
      String(direct.username).toLowerCase()===String(asset.display_name).toLowerCase()&&
      (direct.scopes||[]).includes('instagram_business_content_publish'));
    }
    if(!authorized&&!directAuthorized)throw Error('El perfil @'+asset.display_name+' no tiene permiso de publicación. Conectá ese Instagram exacto desde Configuración (Facebook Login o Instagram Login).');
   }
   const {error:jobError}=await db.from('hub_publication_jobs').insert({
    organization_id:membership.organization_id,content_id:p.id,meta_asset_id:asset.id,scheduled_for:scheduled.toISOString(),status:'queued'
   });
   if(jobError)throw Error(jobError.code==='23505'?'Esta publicación ya está programada':jobError.message);
   await db.from('hub_content').update({status:'scheduled',target_asset_id:asset.id}).eq('id',p.id).eq('organization_id',membership.organization_id);
  }catch(e){error=String(e.message||e).slice(0,180)}
  results.push({id:p.id,status:error?'error':'scheduled',message:error||(confirmation==='PUBLICAR_AHORA'?'En cola de publicación inmediata':'Programada')});
 }
 return res.status(200).json({results,scheduled:results.filter(x=>x.status==='scheduled').length,total:ids.length});
 }catch(e){return res.status(500).json({error:'Error al programar: '+String(e.message||e).slice(0,150)})}
}
