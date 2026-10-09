import {createClient} from '@supabase/supabase-js';
import {admin} from './_shared.js';

// Organization-scoped snapshot: quick UI reads, never a replacement for live Meta checks at publish time.
const validViews=new Set(['inventory','ads','social']);
const safe=(value)=>String(value||'');
function suggestBrand(name,brands){
 const s=safe(name).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim();
 const proposals=[
  {name:'Renault Circular',match:/\bcircular\b/},
  {name:'Renault Centro',match:/\bcentro rosario\b|\brenault\s*centro\b|renaultcentro|\brombo\b/},
  {name:'VW Pesado Castro',match:/\bvolkswagen\b|\bvw\b|pesadocastrovw|\bf pesado castro\b|\bfrancisco pesado castro\b/},
  {name:'Chevrolet Pesado Castro',match:/\bchevrolet\b.*\bpesado castro\b|\bpesado castro\b.*\bchevrolet\b|pcchevrolet|\bpesado castro motors\b/},
  {name:'Chevromax',match:/chevromax/},
  {name:'Sakura Motors',match:/sakura|toyota|\bsak\b/},
  {name:'Usados Pesado Castro',match:/usados.*pesado.?castr|pesado.?castr.*usados|\bupc\b/},
  {name:'Autos Directos',match:/autos.?directos/}
 ];
 const matched=proposals.filter(p=>p.match.test(s));
 return matched.length===1?(brands.find(b=>b.name===matched[0].name)?.id||null):null;
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Método no permitido'});
 const view=safe(req.query.view||'inventory');
 if(!validViews.has(view))return res.status(400).json({error:'Vista inválida'});
 try{
  const bearer=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if(!bearer)return res.status(401).json({error:'Iniciá sesión'});
  const auth=createClient(process.env.VITE_SUPABASE_URL,process.env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false}});
  const {data:{user},error:authError}=await auth.auth.getUser(bearer);
  if(authError||!user)return res.status(401).json({error:'Sesión inválida'});
  const db=admin();
  const {data:member,error:memberError}=await db.from('hub_members')
   .select('organization_id').eq('user_id',user.id).limit(1).maybeSingle();
  if(memberError||!member)return res.status(403).json({error:'Workspace no autorizado'});
  const org=member.organization_id;
  const [assetsResult,brandsResult,adsResult,socialResult]=await Promise.all([
   db.from('hub_meta_assets').select('id,brand_id,kind,display_name,external_id,metadata').eq('organization_id',org),
   view==='inventory'?db.from('hub_brands').select('id,name,unit_type').eq('organization_id',org).order('unit_type').order('name'):Promise.resolve({data:[],error:null}),
   db.rpc('hub_meta_encrypted_connections'),
   db.rpc('hub_social_tokens')
  ]);
  for(const r of [assetsResult,brandsResult,adsResult,socialResult])if(r.error)throw r.error;
  const active=c=>c.organization_id===org&&(!c.expires_at||Date.parse(c.expires_at)>Date.now());
  const adConns=(adsResult.data||[]).filter(active);
  const socialConns=(socialResult.data||[]).filter(active);
  const hasAdAccess=adConns.length>0||socialConns.some(x=>(x.scopes||[]).some(s=>['ads_read','ads_management'].includes(s)));
  const fb=socialConns.some(x=>(x.scopes||[]).includes('pages_manage_posts'));
  const ig=socialConns.some(x=>(x.scopes||[]).includes('instagram_basic')&&(x.scopes||[]).includes('instagram_content_publish'));
  const igReady=(asset)=>socialConns.some(x=>x.meta_user_id===asset.metadata?.meta_user_id&&
    (x.scopes||[]).includes('instagram_basic')&&(x.scopes||[]).includes('instagram_content_publish'));
  const all=assetsResult.data||[],brands=brandsResult.data||[];
  if(view==='ads')return res.status(200).json({
   accounts:hasAdAccess?all.filter(x=>x.kind==='ad_account').map(x=>({
    id:'act_'+x.external_id,name:x.display_name,account_id:x.external_id,
    account_status:x.metadata?.account_status,currency:x.metadata?.currency,business:null
   })):[],
   warnings:[],connected:hasAdAccess,cached:true
  });
  if(view==='social')return res.status(200).json({
   assets:socialConns.length?all.filter(x=>['page','instagram_account'].includes(x.kind)).map(x=>({
    id:x.id,brand_id:x.brand_id,kind:x.kind,name:x.display_name,external_id:x.external_id,
    tasks:x.metadata?.tasks||[],
    is_ready:x.kind==='page'?(x.metadata?.tasks||[]).includes('CREATE_CONTENT'):igReady(x)
   })):[],
   warnings:[],connected:socialConns.length>0,cached:true
  });
  const nameById=new Map(brands.map(b=>[b.id,b.name]));
  const order={page:0,instagram_account:1,ad_account:2};
  const rows=all.map(x=>({
   id:x.id,kind:x.kind,name:x.display_name,external_id:x.external_id,
   brand_id:x.brand_id,suggested_brand_id:x.brand_id||suggestBrand(x.display_name,brands),
   brand_name:x.brand_id?nameById.get(x.brand_id)||null:null,
   currency:x.kind==='ad_account'?x.metadata?.currency||null:null,
   tasks:x.kind==='page'?x.metadata?.tasks||[]:[],
   publish_ready:x.kind==='page'?fb&&(x.metadata?.tasks||[]).includes('CREATE_CONTENT'):x.kind==='instagram_account'?igReady(x):null,
   stale:false
  })).sort((a,b)=>(order[a.kind]??5)-(order[b.kind]??5)||safe(a.name).localeCompare(safe(b.name)));
  return res.status(200).json({
   assets:rows,brands,cached:true,
   connection:{ads:hasAdAccess,facebook:socialConns.some(x=>(x.scopes||[]).includes('pages_show_list')),
    instagram:ig,pages_publish:fb},
   counts:{ads:rows.filter(x=>x.kind==='ad_account'&&hasAdAccess).length,
    pages:rows.filter(x=>x.kind==='page'&&socialConns.length).length,
    instagram:rows.filter(x=>x.kind==='instagram_account'&&socialConns.length).length},
   warnings:[]
  });
 }catch(e){
  return res.status(500).json({error:'No se pudo cargar el inventario guardado: '+safe(e.message).slice(0,150)});
 }
}
