import {admin,APP_ID,GRAPH,REDIRECT,digest,encrypt,errorRedirect,BASE_URL} from './_shared.js';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).end();
 const {state,code,error}=req.query;
 if(typeof state!=='string'||!state||typeof code!=='string'||error)return res.redirect(302,errorRedirect(error||'authorization_cancelled'));
 try{
 const db=admin();
 const {data:record,error:findError}=await db.schema('hub_private').from('meta_oauth_states').select('*').eq('state_hash',digest(state)).maybeSingle();
 if(findError||!record||new Date(record.expires_at).getTime()<Date.now())return res.redirect(302,errorRedirect('invalid_or_expired_state'));
 const {error:removeError}=await db.schema('hub_private').from('meta_oauth_states').delete().eq('state_hash',digest(state));
 if(removeError)throw removeError;
 const params=new URLSearchParams({client_id:APP_ID,client_secret:process.env.META_APP_SECRET,redirect_uri:REDIRECT,code});
 const tokenResponse=await fetch(GRAPH+'/oauth/access_token?'+params);
 const tokenData=await tokenResponse.json();
 if(!tokenResponse.ok||!tokenData.access_token)throw Error(tokenData.error?.message||'token_exchange_failed');
 const longParams=new URLSearchParams({grant_type:'fb_exchange_token',client_id:APP_ID,client_secret:process.env.META_APP_SECRET,fb_exchange_token:tokenData.access_token});
 const longResponse=await fetch(GRAPH+'/oauth/access_token?'+longParams);
 const longData=await longResponse.json();
 const accessToken=longResponse.ok&&longData.access_token?longData.access_token:tokenData.access_token;
 const meRes=await fetch(GRAPH+'/me?fields=id,name&access_token='+encodeURIComponent(accessToken));
 const me=await meRes.json();
 if(!meRes.ok||!me.id)throw Error('Unable to retrieve authorized Meta identity');
 const encrypted=encrypt(accessToken);
 const expiresSeconds=longData.expires_in||tokenData.expires_in;
 const {error:saveError}=await db.schema('hub_private').from('meta_connections').upsert({...encrypted,organization_id:record.organization_id,connected_by:record.user_id,meta_user_id:String(me.id),meta_user_name:me.name||'',scopes:[],expires_at:expiresSeconds?new Date(Date.now()+Number(expiresSeconds)*1000).toISOString():null},{onConflict:'organization_id,meta_user_id'});
 if(saveError)throw saveError;
 return res.redirect(302,BASE_URL+'/?meta_connected=1');
 }catch(e){return res.redirect(302,errorRedirect(e.message))}
}
