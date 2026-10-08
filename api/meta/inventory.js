import {createDecipheriv} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {admin,GRAPH} from './_shared.js';

const isUuid = x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x);
function decrypt(cipher,iv){
 const secret=process.env.META_TOKEN_ENCRYPTION_KEY;
 if(!/^[0-9a-f]{64}$/i.test(secret||''))throw Error('No hay clave de cifrado');
 const bytes=Buffer.from(cipher,'base64');
 const d=createDecipheriv('aes-256-gcm',Buffer.from(secret,'hex'),Buffer.from(iv,'base64'));
 d.setAuthTag(bytes.subarray(-16));
 return Buffer.concat([d.update(bytes.subarray(0,-16)),d.final()]).toString('utf8');
}
async function graph(token,path,fields,after){
 const url=new URL(GRAPH+'/'+path);url.searchParams.set('fields',fields);url.searchParams.set('limit','100');
 if(after)url.searchParams.set('after',after);
 const result=await fetch(url,{headers:{Authorization:'Bearer '+token}});
 const json=await result.json();
 if(!result.ok)throw Error(json.error?.message||'Meta rechazó la consulta');
 return json;
}
async function pages(token){
 const result=[];let after=null;
 for(let i=0;i<5;i++){
  const data=await graph(token,'me/accounts','id,name,tasks',after);
  result.push(...(data.data||[]));
  const next=data.paging?.cursors?.after;
  if(!data.paging?.next||!next)break;
  after=next;
 }
 return result;
}
async function advertising(token){
 const result=[];let after=null;
 for(let i=0;i<5;i++){
  const data=await graph(token,'me/adaccounts','id,name,account_id,account_status,currency',after);
  result.push(...(data.data||[]));
  const next=data.paging?.cursors?.after;
  if(!data.paging?.next||!next)break;
  after=next;
 }
 return result;
}
function suggestBrand(name,brandRows){
 const s=(name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 let choices=[];
 if(/chevromax|chevrolet|pesado castro motors/.test(s))choices.push('Chevromax');
 if(/volkswagen|\bvw\b|f pesado castro/.test(s))choices.push('Pesado Castro VW');
 if(/renault|circular|rombo|centro rosario/.test(s))choices.push('Circular Renault');
 if(/sakura|toyota|\bsak\b/.test(s))choices.push('Sakura Toyota');
 if(/usados|\bupc\b/.test(s))choices.push('Usados GPC');
 choices=[...new Set(choices)];
 if(choices.length!==1)return null;
 return brandRows.find(b=>b.name===choices[0])?.id||null;
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','private,no-store');
 if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Método no permitido'});
 try {
  const bearer=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if(!bearer)return res.status(401).json({error:'Iniciá sesión'});
  const auth=createClient(process.env.VITE_SUPABASE_URL,process.env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false}});
  const {data:{user},error}=await auth.auth.getUser(bearer);
  if(error||!user)return res.status(401).json({error:'Sesión inválida'});
  const db=admin();
  const {data:member,error:memberError}=await db.from('hub_members').select('organization_id,role').eq('user_id',user.id).limit(1).maybeSingle();
  if(memberError||!member)return res.status(403).json({error:'Sin acceso a workspace'});
  const org=member.organization_id;
  const {data:brandRows,error:brandsError}=await db.from('hub_brands').select('id,name').eq('organization_id',org);
  if(brandsError)throw brandsError;
  if(req.method==='POST'){
    if(!['owner','admin'].includes(member.role))return res.status(403).json({error:'Solo administradores pueden aplicar la configuración'});
    const changes=req.body?.assignments;
    if(!Array.isArray(changes)||changes.length<1||changes.length>150||changes.some(x=>!isUuid(x.asset_id)||(x.brand_id!==null&&!isUuid(x.brand_id))))
      return res.status(400).json({error:'Seleccioná entre 1 y 150 conexiones válidas'});
    if(new Set(changes.map(x=>x.asset_id)).size!==changes.length)return res.status(400).json({error:'Hay cuentas repetidas'});
    const allowed=new Set((brandRows||[]).map(b=>b.id));
    if(changes.some(x=>x.brand_id!==null&&!allowed.has(x.brand_id)))return res.status(400).json({error:'Una de las marcas no pertenece a este workspace'});
    const assetIds=changes.map(x=>x.asset_id);
    const {data:existing,error:listError}=await db.from('hub_meta_assets').select('id,kind,brand_id').eq('organization_id',org).in('id',assetIds);
    if(listError)throw listError;
    if(existing?.length!==changes.length)return res.status(403).json({error:'Una cuenta no pertenece a tu organización'});
    const existingById=new Map(existing.map(x=>[x.id,x]));
    // Multiple pages or Instagram profiles can belong to the same brand. Each keeps its own Meta ID.
    let changed=0;const errors=[];
    for(const x of changes){
      if(existingById.get(x.asset_id).brand_id===x.brand_id)continue;
      const {error:e}=await db.from('hub_meta_assets').update({brand_id:x.brand_id}).eq('organization_id',org).eq('id',x.asset_id);
      if(e)errors.push(e.message);else changed++;
    }
    return res.status(200).json({changed,errors,ok:errors.length===0});
  }
  const warnings=[];
  const {data:adsTokens,error:adTokenError}=await db.rpc('hub_meta_encrypted_connections');
  if(adTokenError)throw adTokenError;
  const {data:socialTokens,error:socialTokenError}=await db.rpc('hub_social_tokens');
  if(socialTokenError)throw socialTokenError;
  const adsConns=(adsTokens||[]).filter(x=>x.organization_id===org&&(!x.expires_at||Date.parse(x.expires_at)>Date.now()));
  const socialConns=(socialTokens||[]).filter(x=>x.organization_id===org&&(!x.expires_at||Date.parse(x.expires_at)>Date.now()));
  const found=new Map(),persisted=[];
  const upsert=async row=>{
    const key=row.kind+':'+row.external_id;
    if(found.has(key))return;
    found.set(key,true);
    persisted.push(row);
  };
  for(const conn of adsConns){
    try {
      const token=decrypt(conn.token_ciphertext,conn.token_iv);
      for(const a of await advertising(token)){
        if(!a.account_id)continue;
        await upsert({organization_id:org,kind:'ad_account',external_id:String(a.account_id),display_name:a.name||'Cuenta publicitaria',metadata:{currency:a.currency||null,account_status:a.account_status||null}});
      }
    }catch(e){warnings.push('Publicidad: '+String(e.message).slice(0,130))}
  }
  let canPublishFb=false,canPublishIg=false;
  for(const conn of socialConns){
    const scopes=conn.scopes||[];
    canPublishFb ||= scopes.includes('pages_manage_posts');
    canPublishIg ||= scopes.includes('instagram_content_publish')&&scopes.includes('instagram_basic');
    try {
      const token=decrypt(conn.token_ciphertext,conn.token_iv);
      for(const p of await pages(token)){
        if(!p.id)continue;
        const tasks=Array.isArray(p.tasks)?p.tasks:[];
        await upsert({organization_id:org,kind:'page',external_id:String(p.id),display_name:p.name||'Página Facebook',metadata:{tasks,meta_user_id:conn.meta_user_id}});
        if(scopes.includes('instagram_basic')){
         try{
           const ig=await graph(token,String(p.id),'instagram_business_account{id,username}');
           if(ig.instagram_business_account?.id){
            await upsert({organization_id:org,kind:'instagram_account',external_id:String(ig.instagram_business_account.id),
            display_name:ig.instagram_business_account.username||'Perfil Instagram',metadata:{page_id:String(p.id),meta_user_id:conn.meta_user_id}});
           }
         }catch(e){warnings.push('Instagram de '+String(p.name||p.id).slice(0,40)+': falta acceso de lectura')}
        }
      }
    }catch(e){warnings.push('Páginas: '+String(e.message).slice(0,130))}
  }
  for(const row of persisted){
    const {data:existing,error:readError}=await db.from('hub_meta_assets').select('id')
      .eq('organization_id',org).eq('kind',row.kind).eq('external_id',row.external_id).maybeSingle();
    if(readError){warnings.push('No se pudo comprobar '+row.display_name);continue}
    // Preserve existing manual mappings. A sync must never overwrite brand_id.
    const query=existing?db.from('hub_meta_assets').update({display_name:row.display_name,metadata:row.metadata}).eq('id',existing.id):
      db.from('hub_meta_assets').insert({...row,brand_id:null});
    const {error:e}=await query;
    if(e)warnings.push(row.kind+': '+e.message.slice(0,100));
  }
  const {data:current,error:currentError}=await db.from('hub_meta_assets')
    .select('id,brand_id,kind,display_name,external_id,metadata')
    .eq('organization_id',org).in('kind',['page','instagram_account','ad_account']);
  if(currentError)throw currentError;
  const brandMap=new Map((brandRows||[]).map(b=>[b.id,b.name]));
  const rows=(current||[]).map(x=>{
    const proposed=suggestBrand(x.display_name,brandRows||[]);
    return {
      id:x.id,kind:x.kind,name:x.display_name,external_id:x.external_id,
      brand_id:x.brand_id,suggested_brand_id:x.brand_id||proposed,
      brand_name:x.brand_id?brandMap.get(x.brand_id)||null:null,
      currency:x.kind==='ad_account'?x.metadata?.currency||null:null,
      tasks:x.kind==='page'?x.metadata?.tasks||[]:[],
      publish_ready:x.kind==='page'?canPublishFb&&(x.metadata?.tasks||[]).includes('CREATE_CONTENT'):x.kind==='instagram_account'?canPublishIg:null,
      stale:!found.has(x.kind+':'+x.external_id)
    };
  });
  const order={page:0,instagram_account:1,ad_account:2};
  rows.sort((a,b)=>(order[a.kind]??5)-(order[b.kind]??5)||(a.name||'').localeCompare(b.name||''));
  return res.status(200).json({
    assets:rows,brands:brandRows||[],
    connection:{ads:adsConns.length>0,facebook:socialConns.length>0,
      instagram:canPublishIg,pages_publish:canPublishFb},
    counts:{
      ads:rows.filter(x=>x.kind==='ad_account'&&!x.stale).length,
      pages:rows.filter(x=>x.kind==='page'&&!x.stale).length,
      instagram:rows.filter(x=>x.kind==='instagram_account'&&!x.stale).length
    },
    warnings:[...new Set(warnings)].slice(0,12)
  });
 }catch(e){return res.status(500).json({error:'No se pudo sincronizar Meta: '+String(e.message).slice(0,160)})}
}
