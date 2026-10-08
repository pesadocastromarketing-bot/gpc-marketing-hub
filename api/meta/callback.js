import {admin,APP_ID,GRAPH,REDIRECT,digest,encrypt,errorRedirect,BASE_URL} from './_shared.js';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).end();
 const {state,code,error}=req.query;
 if(typeof state!=='string'||!state||typeof code!=='string'||error)return res.redirect(302,errorRedirect(error||'authorization_cancelled'));
 try{
 const db=admin();
 const {data:record,error:findError}=await db.rpc('hub_oauth_state_consume_flow',{p_hash:digest(state)});
 if(findError||!record?.length)return res.redirect(302,errorRedirect('invalid_or_expired_state'));

 const flow=record[0].flow||'ads';
 const isBusiness=flow==='business';
 const params=new URLSearchParams({client_id:APP_ID,client_secret:process.env.META_APP_SECRET,redirect_uri:REDIRECT,code});
 const tokenResponse=await fetch(GRAPH+'/oauth/access_token?'+params);
 const tokenData=await tokenResponse.json();
 if(!tokenResponse.ok||!tokenData.access_token)throw Error(tokenData.error?.message||'token_exchange_failed');
 // Business Login may return a system-user access token, already long-lived.
 // Do not attempt fb_exchange_token on that type.
 let longData={};
 if(!isBusiness){
   const longParams=new URLSearchParams({grant_type:'fb_exchange_token',client_id:APP_ID,client_secret:process.env.META_APP_SECRET,fb_exchange_token:tokenData.access_token});
   const longResponse=await fetch(GRAPH+'/oauth/access_token?'+longParams);
   longData=await longResponse.json();
 }
 const accessToken=longData.access_token||tokenData.access_token;
 let meRes=await fetch(GRAPH+'/me?fields=id,name',{headers:{Authorization:'Bearer '+accessToken}});
 let me=await meRes.json();
 // A system user may expose only its ID, not a personal profile/name.
 if((!meRes.ok||!me.id)&&isBusiness){
   meRes=await fetch(GRAPH+'/me?fields=id',{headers:{Authorization:'Bearer '+accessToken}});
   me=await meRes.json();
 }
 if(!meRes.ok||!me.id)throw Error('Meta no devolvió una identidad autorizada');
 const encrypted=encrypt(accessToken);
 const expiresSeconds=longData.expires_in||tokenData.expires_in;
 const exp=expiresSeconds?new Date(Date.now()+Number(expiresSeconds)*1000).toISOString():null;
 const isSocial=isBusiness||flow.startsWith('social_');
 let saveError;
 if(isSocial){
   const scopes=new Set();
   try{
     const grantedRes=await fetch(GRAPH+'/me/permissions',{headers:{Authorization:'Bearer '+accessToken}});
     const grantedJson=await grantedRes.json();
     if(grantedRes.ok)for(const permission of grantedJson.data||[]){
       if(permission.status==='granted')scopes.add(permission.permission);
     }
   }catch(_){}
   if(isBusiness){
     // Check the token's actual granted scopes, not those merely selected in the UI.
     try{
       const url=GRAPH+'/debug_token?'+new URLSearchParams({input_token:accessToken});
       const debugRes=await fetch(url,{headers:{Authorization:'Bearer '+APP_ID+'|'+process.env.META_APP_SECRET}});
       const debug=await debugRes.json();
       if(debugRes.ok&&debug.data?.is_valid){
         for(const p of debug.data.scopes||[])scopes.add(p);
         for(const p of debug.data.granted_scopes||[])scopes.add(p);
       }
     }catch(_){}
   }
   const save=await db.rpc('hub_store_meta_social',{
     p_org:record[0].organization_id,p_user:record[0].user_id,p_meta_id:String(me.id),p_meta_name:me.name||'Meta Business',p_cipher:encrypted.token_ciphertext,p_iv:encrypted.token_iv,p_exp:exp,p_scopes:[...scopes]
   });
   saveError=save.error;
 }else{
   const save=await db.rpc('hub_meta_connection_save',{p_org:record[0].organization_id,p_user:record[0].user_id,p_meta_id:String(me.id),p_meta_name:me.name||'',p_cipher:encrypted.token_ciphertext,p_iv:encrypted.token_iv,p_exp:exp});
   saveError=save.error;
 }
 if(saveError)throw saveError;
 return res.redirect(302,BASE_URL+'/?meta_connected=1&meta_flow='+encodeURIComponent(record[0].flow||'ads'));
 }catch(e){return res.redirect(302,errorRedirect(e.message))}
}
