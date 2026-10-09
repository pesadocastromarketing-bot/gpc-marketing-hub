import {createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {admin} from '../meta/_shared.js';

// Read-only copies of content ALREADY scheduled in Meta Business Suite.
// Never insert these records into hub_content/hub_publication_jobs.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const DATE=/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME=/^([01]\d|2[0-3]):[0-5]\d$/;
const FORMATS=new Set(['Historia','Reel','Imagen','Carrusel','Video']);
const TEXT_LIMIT=1000;
export default async function handler(req,res){
 res.setHeader('Cache-Control','private,no-store');
 if(!['POST','DELETE'].includes(req.method))return res.status(405).json({error:'Método no permitido'});
 try{
  const bearer=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if(!bearer)return res.status(401).json({error:'Iniciá sesión'});
  const auth=createClient(process.env.VITE_SUPABASE_URL,process.env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false}});
  const {data:{user},error}=await auth.auth.getUser(bearer);
  if(error||!user)return res.status(401).json({error:'Sesión inválida'});
  const db=admin();
  const {data:member,error:memberError}=await db.from('hub_members').select('organization_id,role')
   .eq('user_id',user.id).in('role',['owner','admin','editor']).limit(1).maybeSingle();
  if(memberError||!member)return res.status(403).json({error:'No tenés permisos de edición'});
  const org=member.organization_id;
  if(req.method==='DELETE'){
   const id=req.body?.id;
   if(!UUID.test(id||''))return res.status(400).json({error:'Referencia inválida'});
   // Only user-entered planner copies can be deleted, NEVER synced official Meta rows.
   const {data:row,error:rowError}=await db.from('hub_external_posts').select('id,external_id')
    .eq('organization_id',org).eq('id',id).maybeSingle();
   if(rowError)throw rowError;
   if(!row||!row.external_id.startsWith('planner:'))return res.status(403).json({error:'Solo se pueden quitar registros agregados manualmente'});
   const {error:deleteError}=await db.from('hub_external_posts').delete().eq('organization_id',org).eq('id',id).like('external_id','planner:%');
   if(deleteError)throw deleteError;
   return res.json({deleted:true});
  }
  const entries=req.body?.entries;
  if(!Array.isArray(entries)||entries.length<1||entries.length>100)
   return res.status(400).json({error:'Importá entre 1 y 100 filas por lote'});
  const idList=[...new Set(entries.map(e=>e?.asset_id))];
  if(idList.some(id=>!UUID.test(id||'')))return res.status(400).json({error:'Seleccioná la cuenta exacta para cada fila'});
  const {data:assets,error:assetsError}=await db.from('hub_meta_assets')
   .select('id,organization_id,brand_id,kind,display_name').eq('organization_id',org).in('id',idList);
  if(assetsError)throw assetsError;
  const assetsById=new Map((assets||[]).map(a=>[a.id,a]));
  const invalid=[],rows=[];
  for(let index=0;index<entries.length;index++){
   const entry=entries[index],asset=assetsById.get(entry.asset_id);
   const date=String(entry.date||''),time=String(entry.time||''),format=String(entry.format||'');
   const caption=String(entry.caption||'').trim().slice(0,TEXT_LIMIT);
   const reference=String(entry.reference||'').trim().slice(0,100);
   const parsed=Date.parse(date+'T'+time+':00-03:00');
   const local=Number.isFinite(parsed)?new Date(parsed-3*3600000).toISOString().slice(0,10):'';
   if(!asset||!asset.brand_id||!['page','instagram_account'].includes(asset.kind)||!DATE.test(date)||!TIME.test(time)||
    !FORMATS.has(format)||local!==date||!Number.isFinite(parsed)||date<'2020-01-01'||date>'2030-12-31'){
    invalid.push(index+1);continue;
   }
   const network=asset.kind==='page'?'Facebook':'Instagram';
   const identifier=[asset.id,date,time,format,caption,reference].join('|');
   const hash=createHash('sha256').update(identifier).digest('hex').slice(0,40);
   rows.push({
    organization_id:org,meta_asset_id:asset.id,external_id:'planner:'+hash,network,format,status:'scheduled',
    local_date:date,local_time:time+':00',event_at:new Date(parsed).toISOString(),
    caption,thumbnail_url:null,permalink_url:null,last_synced_at:new Date().toISOString()
   });
  }
  if(invalid.length)return res.status(400).json({error:'Filas inválidas: '+invalid.slice(0,12).join(', ')+'. Revisá fecha, hora y cuenta.'});
  const unique=new Map(rows.map(r=>[r.external_id,r]));
  const {error:saveError}=await db.from('hub_external_posts').upsert([...unique.values()],
   {onConflict:'organization_id,meta_asset_id,external_id'});
  if(saveError)throw saveError;
  return res.status(200).json({imported:unique.size,ignored_duplicates:rows.length-unique.size,
   message:'Referencias importadas al calendario. No se programó ni se publicó contenido.'});
 }catch(e){return res.status(500).json({error:'Error al importar agenda de Meta: '+String(e.message||e).slice(0,200)})}
}
