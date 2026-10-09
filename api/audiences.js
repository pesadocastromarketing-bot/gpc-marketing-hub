// GPC Signals: authenticated, read-only audience list from existing Meta OAuth connection.
import {createDecipheriv} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {admin,GRAPH} from './meta/_shared.js';

const json=(res,status,data)=>res.status(status).json(data);
function decrypt(ciphertext,iv){
  const hex=process.env.META_TOKEN_ENCRYPTION_KEY;
  if(!/^[0-9a-f]{64}$/i.test(hex||''))throw Error('No hay clave de Meta configurada');
  const data=Buffer.from(ciphertext,'base64');
  const decipher=createDecipheriv('aes-256-gcm',Buffer.from(hex,'hex'),Buffer.from(iv,'base64'));
  decipher.setAuthTag(data.subarray(-16));
  return Buffer.concat([decipher.update(data.subarray(0,-16)),decipher.final()]).toString('utf8');
}
async function graphGet(path,token,fields,after){
  const url=new URL(GRAPH+'/'+path);
  url.searchParams.set('fields',fields);
  url.searchParams.set('limit','100');
  if(after)url.searchParams.set('after',after);
  const response=await fetch(url,{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:AbortSignal.timeout(8000)});
  const data=await response.json();
  if(!response.ok||data.error){
    const code=Number(data.error?.code||0);
    const e=new Error('Meta no autorizó la consulta solicitada');
    e.metaCode=code;
    throw e;
  }
  return data;
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('Vary','Authorization');
  if(req.method!=='GET')return json(res,405,{error:'Método no permitido'});
  const jwt=/^Bearer (.+)$/i.exec(req.headers.authorization||'')?.[1];
  if(!jwt)return json(res,401,{error:'Iniciá sesión para consultar públicos'});
  const raw=typeof req.query.account==='string'?req.query.account:'';
  const id=raw.replace(/^act_/,'');
  if(!/^\d{10,20}$/.test(id))return json(res,400,{error:'Cuenta publicitaria inválida'});
  try{
    const auth=createClient(process.env.VITE_SUPABASE_URL,process.env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false}});
    const {data:{user},error:authError}=await auth.auth.getUser(jwt);
    if(authError||!user)return json(res,401,{error:'Sesión inválida o vencida'});
    const db=admin();
    const {data:memberships,error:memberError}=await db.from('hub_members')
      .select('organization_id,role').eq('user_id',user.id);
    if(memberError)throw memberError;
    const orgs=(memberships||[]).filter(m=>['owner','admin','editor','viewer'].includes(m.role)).map(m=>m.organization_id);
    if(!orgs.length)return json(res,403,{error:'Tu usuario no tiene acceso al workspace'});
    const {data:assets,error:assetsError}=await db.from('hub_meta_assets')
      .select('external_id').in('organization_id',orgs).eq('kind','ad_account')
      .in('external_id',[id,'act_'+id]).limit(1);
    if(assetsError)throw assetsError;
    if(!assets?.length)return json(res,403,{error:'La cuenta publicitaria no pertenece a tu workspace'});
    const {data:connections,error:connectionError}=await db.rpc('hub_meta_encrypted_connections');
    if(connectionError)throw connectionError;
    const allowed=(connections||[]).filter(c=>orgs.includes(c.organization_id)&&
      (!c.expires_at||new Date(c.expires_at).getTime()>Date.now()));
    if(!allowed.length)return json(res,503,{error:'No existe una conexión vigente de Meta para este workspace',code:'META_DISCONNECTED'});
    let lastCode=null;
    for(const connection of allowed){
      try{
        const token=decrypt(connection.token_ciphertext,connection.token_iv);
        const match=await graphGet('act_'+id,token,'id,account_id,name');
        if(String(match.account_id)!==id)continue;
        const audiences=[];let after=null,hasMore=false;const seen=new Set();
        for(let n=0;n<4;n++){
          const data=await graphGet('act_'+id+'/customaudiences',token,
            'id,name,subtype,description,approximate_count_lower_bound,approximate_count_upper_bound,operation_status,time_updated',after);
          audiences.push(...(data.data||[]).map(x=>({
            id:String(x.id||''),name:String(x.name||'Sin nombre'),
            subtype:x.subtype||null,description:x.description||'',
            size_lower:x.approximate_count_lower_bound??null,
            size_upper:x.approximate_count_upper_bound??null,
            status:x.operation_status?.description||null,updated:x.time_updated||null
          })));
          const cursor=data.paging?.cursors?.after||null;
          hasMore=Boolean(data.paging?.next&&cursor&&!seen.has(cursor));
          if(!hasMore)break;
          seen.add(cursor);after=cursor;
        }
        return json(res,200,{account:'act_'+id,audiences,limited:hasMore,source:'meta'});
      }catch(error){lastCode=error.metaCode||null;console.warn('Meta audiences read:',error.message);}
    }
    if(lastCode===10||lastCode===200)return json(res,403,{error:'Meta requiere habilitar permisos para leer públicos de esta cuenta',code:lastCode});
    return json(res,502,{error:'No se pudieron consultar los públicos. Verificá permisos y conexión en GPC Ads Manager.',code:lastCode});
  }catch(error){
    console.error('GPC audiences error:',error.message);
    return json(res,502,{error:'No se pudo validar la conexión con Meta'});
  }
}
