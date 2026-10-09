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
  const {data:records,error:stateErr}=await db.rpc('hub_ig_login_state_consume',{p_hash:digest(state)});
  if(stateErr||records?.length!==1)throw Error('Autorización expirada o ya utilizada. Reintentá desde el Hub.');
  const record=records[0];
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
  // Verify actual publishing authorization without creating or publishing any content.
  // The consent screen alone does not guarantee that the content-publish grant is usable.
  const limitRes=await fetch(IG_GRAPH+'/'+encodeURIComponent(String(profile.id))+'/content_publishing_limit?fields=quota_usage',{
   headers:{Authorization:'Bearer '+long.access_token}});
  const limit=await limitRes.json();
  if(!limitRes.ok||limit.error)throw Error('Instagram Login no concedió acceso efectivo a publicación: '+String(limit.error?.message||'comprobación de permisos fallida').slice(0,115));
  const encrypted=encrypt(long.access_token);
  const row={organization_id:record.organization_id,asset_id:asset.id,instagram_scoped_id:String(profile.id),
   username:exactActual,token_ciphertext:encrypted.token_ciphertext,token_iv:encrypted.token_iv,
   scopes:['instagram_business_basic','instagram_business_content_publish'],
   expires_at:new Date(Date.now()+Number(long.expires_in)*1000).toISOString(),connected_by:record.requested_by,
   connected_at:new Date().toISOString()};
  const {error:saveError}=await db.rpc('hub_ig_direct_save',{
   p_org:row.organization_id,p_asset:row.asset_id,p_ig_id:row.instagram_scoped_id,
   p_username:row.username,p_cipher:row.token_ciphertext,p_iv:row.token_iv,
   p_scopes:row.scopes,p_exp:row.expires_at,p_user:row.connected_by
  });
  if(saveError)throw saveError;
  return done(res,{instagram_connected:1,instagram_user:exactActual});
 }catch(e){return done(res,{instagram_error:String(e.message||e).slice(0,180)})}
}
