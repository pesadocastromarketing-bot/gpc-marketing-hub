import {createDecipheriv} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {admin,GRAPH} from '../meta/_shared.js';
function decrypt(ciphertext,iv){const key=process.env.META_TOKEN_ENCRYPTION_KEY;if(!/^[0-9a-fA-F]{64}$/.test(key||''))throw Error('Encryption unavailable');const b=Buffer.from(ciphertext,'base64');const d=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),Buffer.from(iv,'base64'));d.setAuthTag(b.subarray(-16));return Buffer.concat([d.update(b.subarray(0,-16)),d.final()]).toString('utf8')}
async function graph(token,path,fields){const url=new URL(GRAPH+'/'+path);url.searchParams.set('fields',fields);url.searchParams.set('limit','100');const r=await fetch(url,{headers:{Authorization:'Bearer '+token}});const j=await r.json();if(!r.ok)throw Error(j.error?.message||'Meta no permitió consultar perfiles');return j}
export default async function handler(req,res){
 res.setHeader('Cache-Control','private,no-store');
 if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Método no permitido'});
 try{
 const bearer=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
 if(!bearer)return res.status(401).json({error:'Iniciá sesión'});
 const auth=createClient(process.env.VITE_SUPABASE_URL,process.env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false}});
 const {data:{user},error:authError}=await auth.auth.getUser(bearer);
 if(authError||!user)return res.status(401).json({error:'Sesión inválida'});
 const db=admin();
 const {data:member,error}=await db.from('hub_members').select('organization_id,role').eq('user_id',user.id).limit(1).maybeSingle();
 if(error||!member)return res.status(403).json({error:'Workspace no autorizado'});
 if(req.method==='POST'){
  if(!['owner','admin'].includes(member.role))return res.status(403).json({error:'Solo administradores pueden vincular marcas'});
  const assetId=String(req.body?.asset_id||''),brandId=req.body?.brand_id||null;
  if(!/^[0-9a-f-]{36}$/.test(assetId)|| (brandId&&!/^[0-9a-f-]{36}$/.test(brandId)))return res.status(400).json({error:'ID inválido'});
  const {data:asset}=await db.from('hub_meta_assets').select('id,organization_id').eq('organization_id',member.organization_id).eq('id',assetId).maybeSingle();
  if(!asset)return res.status(404).json({error:'Destino no encontrado'});
  if(brandId){const {data:brand}=await db.from('hub_brands').select('id').eq('organization_id',member.organization_id).eq('id',brandId).maybeSingle();if(!brand)return res.status(400).json({error:'Marca no válida'});}
  const {error:editError}=await db.from('hub_meta_assets').update({brand_id:brandId}).eq('id',assetId).eq('organization_id',member.organization_id);
  if(editError)throw editError;
  return res.status(200).json({saved:true});
 }
 const {data:conns,error:tokenError}=await db.rpc('hub_social_tokens');if(tokenError)throw tokenError;
 const warnings=[],visible=new Set();
 for(const conn of (conns||[]).filter(c=>c.organization_id===member.organization_id)){
  if(conn.expires_at&&Date.parse(conn.expires_at)<Date.now()){warnings.push('La autorización social expiró. Reconectá Meta.');continue}
  try{
   const token=decrypt(conn.token_ciphertext,conn.token_iv);
   let next='me/accounts',pages=0;
   while(next&&pages++<4){
    let json;
    if(next==='me/accounts')json=await graph(token,'me/accounts','id,name,tasks');
    else{
     const url=new URL(next);
     if(url.hostname!=='graph.facebook.com')break;
     const r=await fetch(url,{headers:{Authorization:'Bearer '+token}});
     json=await r.json();if(!r.ok)throw Error(json.error?.message||'Error de paginación');
    }
    for(const page of json.data||[]){
     if(!page.id)continue;
     const tasks=Array.isArray(page.tasks)?page.tasks:[];
     const row={organization_id:member.organization_id,kind:'page',external_id:String(page.id),display_name:page.name||'Página Facebook',metadata:{tasks,meta_user_id:conn.meta_user_id}};
     const {data:prior}=await db.from('hub_meta_assets').select('id,brand_id').eq('organization_id',member.organization_id).eq('kind','page').eq('external_id',String(page.id)).maybeSingle();
     if(prior){await db.from('hub_meta_assets').update({display_name:row.display_name,metadata:row.metadata}).eq('id',prior.id)}
     else await db.from('hub_meta_assets').insert(row);
     visible.add('page:'+String(page.id));
     // Instagram may not be available to an application without instagram_basic.
     if((conn.scopes||[]).includes('instagram_basic')){
      try{
       const ig=await graph(token,String(page.id),'instagram_business_account{id,username}');
       const account=ig.instagram_business_account;
       if(account?.id){
        const igRow={organization_id:member.organization_id,kind:'instagram_account',external_id:String(account.id),display_name:account.username||'Instagram',metadata:{page_id:String(page.id),meta_user_id:conn.meta_user_id}};
        const {data:old}=await db.from('hub_meta_assets').select('id').eq('organization_id',member.organization_id).eq('kind','instagram_account').eq('external_id',String(account.id)).maybeSingle();
        if(old)await db.from('hub_meta_assets').update({display_name:igRow.display_name,metadata:igRow.metadata}).eq('id',old.id);
        else await db.from('hub_meta_assets').insert(igRow);
        visible.add('instagram_account:'+String(account.id));
       }
      }catch(_){}
     }
    }
    next=json.paging?.next||null;
   }
  }catch(e){warnings.push(String(e.message).slice(0,125))}
 }
 const {data:all,error:assetsError}=await db.from('hub_meta_assets').select('id,brand_id,kind,display_name,external_id,metadata').eq('organization_id',member.organization_id).in('kind',['page','instagram_account']);
 if(assetsError)throw assetsError;
 const assets=(all||[]).filter(a=>visible.has(a.kind+':'+a.external_id)).map(a=>({
  id:a.id,brand_id:a.brand_id,kind:a.kind,name:a.display_name,external_id:a.external_id,
  tasks:a.metadata?.tasks||[],is_ready:a.kind==='page'?(a.metadata?.tasks||[]).includes('CREATE_CONTENT'):true
 }));
 return res.status(200).json({assets,warnings,connected:(conns||[]).some(x=>x.organization_id===member.organization_id)});
 }catch(e){return res.status(500).json({error:'No se pudieron consultar redes: '+String(e.message).slice(0,130)})}
}
