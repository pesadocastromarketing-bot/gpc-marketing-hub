import {randomBytes} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {admin,digest,BASE_URL} from '../meta/_shared.js';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export default async function handler(req,res){
 res.setHeader('Cache-Control','private,no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Método no permitido'});
 if(!process.env.INSTAGRAM_APP_ID||!process.env.INSTAGRAM_APP_SECRET)
  return res.status(503).json({error:'Falta configurar Instagram App ID y App Secret en Vercel (Instagram API con Instagram Login).'});
 const bearer=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
 if(!bearer)return res.status(401).json({error:'Iniciá sesión'});
 if(!UUID.test(req.body?.asset_id||''))return res.status(400).json({error:'Seleccioná un Instagram válido'});
 try{
  const auth=createClient(process.env.VITE_SUPABASE_URL,process.env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false}});
  const {data:{user},error}=await auth.auth.getUser(bearer);
  if(error||!user)return res.status(401).json({error:'Sesión inválida'});
  const db=admin();
  const {data:member}=await db.from('hub_members').select('organization_id,role').eq('user_id',user.id).in('role',['owner','admin']).limit(1).maybeSingle();
  if(!member)return res.status(403).json({error:'Solo administradores pueden conectar Instagram'});
  const {data:asset}=await db.from('hub_meta_assets').select('id').eq('id',req.body.asset_id).eq('organization_id',member.organization_id).eq('kind','instagram_account').maybeSingle();
  if(!asset)return res.status(404).json({error:'Instagram no encontrado'});
  const state=randomBytes(32).toString('hex');
  const {error:stateError}=await db.schema('hub_private').from('instagram_login_states').insert({
   state_hash:digest(state),organization_id:member.organization_id,
   asset_id:asset.id,requested_by:user.id,expires_at:new Date(Date.now()+10*60*1000).toISOString()
  });
  if(stateError)throw stateError;
  const callback=BASE_URL+'/api/instagram/callback';
  const url=new URL('https://www.instagram.com/oauth/authorize');
  url.searchParams.set('client_id',process.env.INSTAGRAM_APP_ID);
  url.searchParams.set('redirect_uri',callback);
  url.searchParams.set('response_type','code');
  url.searchParams.set('scope','instagram_business_basic,instagram_business_content_publish');
  url.searchParams.set('enable_fb_login','0');
  url.searchParams.set('state',state);
  return res.json({url:url.toString()});
 }catch(e){return res.status(500).json({error:'No se pudo iniciar Instagram Login: '+String(e.message||e).slice(0,180)})}
}
