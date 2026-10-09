import {admin,encrypt,digest,BASE_URL} from '../meta/_shared.js';
const IG_GRAPH='https://graph.instagram.com/v25.0';
function done(res,params){
 const url=new URL(BASE_URL+'/');
 for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));
 url.hash='settings';
 return res.redirect(302,url.toString());
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).end();
 const {state,code,error}=req.query;
 if(error||!state||!code||typeof state!=='string'||typeof code!=='string')
  return done(res,{instagram_error:String(error||'authorization_cancelled').slice(0,90)});
 if(!process.env.INSTAGRAM_APP_ID||!process.env.INSTAGRAM_APP_SECRET)
  return done(res,{instagram_error:'Instagram API no configurada'});
 try{
  const db=admin();
  const {data:records,error:stateErr}=await db.schema('hub_private').from('instagram_login_states')
   .select('state_hash,organization_id,asset_id,requested_by,expires_at,consumed_at')
   .eq('state_hash',digest(state)).is('consumed_at',null).gt('expires_at',new Date().toISOString()).limit(1);
  if(stateErr||records?.length!==1)throw Error('Autorización expirada. Reintentá desde el Hub.');
  const record=records[0];
  // Burn state before exchanging token: one-time code, replay resistant.
  const {data:burn,error:burnErr}=await db.schema('hub_private').from('instagram_login_states').update({consumed_at:new Date().toISOString()})
   .eq('state_hash',record.state_hash).is('consumed_at',null).select('state_hash').maybeSingle();
  if(burnErr||!burn)throw Error('Esta autorización ya fue utilizada');
  const shortBody=new URLSearchParams({client_id:process.env.INSTAGRAM_APP_ID,
   client_secret:process.env.INSTAGRAM_APP_SECRET,
   grant_type:'authorization_code',redirect_uri:BASE_URL+'/api/instagram/callback',
   code:code.replace(/#_$/,'')});
  const shortRes=await fetch('https://api.instagram.com/oauth/access_token',{method:'POST',body:shortBody});
  const short=await shortRes.json();
  const shortToken=short.access_token||short.data?.[0]?.access_token;
  if(!shortRes.ok||!shortToken)throw Error(short.error_message||short.error?.message||'Meta no entregó un token de Instagram');
  const longUrl=new URL('https://graph.instagram.com/access_token');
  longUrl.searchParams.set('grant_type','ig_exchange_token');
  longUrl.searchParams.set('client_secret',process.env.INSTAGRAM_APP_SECRET);
  longUrl.searchParams.set('access_token',shortToken);
  const longRes=await fetch(longUrl);
  const long=await longRes.json();
  if(!longRes.ok||!long.access_token||!long.expires_in)throw Error(long.error?.message||'No se pudo extender el acceso de Instagram');
  const profileRes=await fetch(IG_GRAPH+'/me?fields=id,username,account_type',{headers:{Authorization:'Bearer '+long.access_token}});
  const profile=await profileRes.json();
  if(!profileRes.ok||!profile.id||!profile.username)throw Error(profile.error?.message||'Meta no confirmó la cuenta de Instagram');
  const {data:asset,error:assetErr}=await db.from('hub_meta_assets').select('id,organization_id,display_name,external_id,kind')
   .eq('id',record.asset_id).eq('organization_id',record.organization_id).eq('kind','instagram_account').maybeSingle();
  if(assetErr||!asset)throw Error('La cuenta seleccionada ya no existe en el Hub');
  const exactExpected=asset.display_name.trim().replace(/^@/,'').toLowerCase();
  const exactActual=String(profile.username).trim().replace(/^@/,'').toLowerCase();
  if(exactExpected!==exactActual)throw Error('Instagram devolvió @'+exactActual+' pero seleccionaste @'+exactExpected+'. No se vinculó ninguna cuenta.');
  if(!['BUSINESS','MEDIA_CREATOR','CREATOR'].includes(String(profile.account_type||'').toUpperCase()))
   throw Error('Instagram Login requiere una cuenta profesional Business o Creator');
  const encrypted=encrypt(long.access_token);
  const row={organization_id:record.organization_id,asset_id:asset.id,instagram_scoped_id:String(profile.id),
   username:exactActual,token_ciphertext:encrypted.token_ciphertext,token_iv:encrypted.token_iv,
   scopes:['instagram_business_basic','instagram_business_content_publish'],
   expires_at:new Date(Date.now()+Number(long.expires_in)*1000).toISOString(),connected_by:record.requested_by,
   connected_at:new Date().toISOString()};
  const {error:saveError}=await db.schema('hub_private').from('instagram_direct_connections').upsert(row,{onConflict:'organization_id,asset_id'});
  if(saveError)throw saveError;
  return done(res,{instagram_connected:1,instagram_user:exactActual});
 }catch(e){return done(res,{instagram_error:String(e.message||e).slice(0,180)})}
}
