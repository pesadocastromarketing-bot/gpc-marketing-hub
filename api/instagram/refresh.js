import {createDecipheriv} from 'node:crypto';
import {admin,encrypt} from '../meta/_shared.js';
function decrypt(cipher,iv){
 const secret=process.env.META_TOKEN_ENCRYPTION_KEY;
 if(!/^[0-9a-f]{64}$/i.test(secret||''))throw Error('Encryption not configured');
 const b=Buffer.from(cipher,'base64'),d=createDecipheriv('aes-256-gcm',Buffer.from(secret,'hex'),Buffer.from(iv,'base64'));
 d.setAuthTag(b.subarray(-16));
 return Buffer.concat([d.update(b.subarray(0,-16)),d.final()]).toString('utf8');
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Método no permitido'});
 if(!process.env.CRON_SECRET||req.headers.authorization!=='Bearer '+process.env.CRON_SECRET)
  return res.status(401).json({error:'No autorizado'});
 try{
  const db=admin();
  const {data:connections,error}=await db.rpc('hub_ig_direct_tokens');
  if(error)throw error;
  const now=Date.now(),refreshBefore=now+14*86400000;
  const expiring=(connections||[]).filter(c=>{
   const ms=Date.parse(c.expires_at);
   return ms>now+86400000&&ms<=refreshBefore;
  });
  let renewed=0,failed=0;
  for(const c of expiring){
   try{
    const old=decrypt(c.token_ciphertext,c.token_iv);
    const url=new URL('https://graph.instagram.com/refresh_access_token');
    url.searchParams.set('grant_type','ig_refresh_token');
    url.searchParams.set('access_token',old);
    const response=await fetch(url,{headers:{'Cache-Control':'no-store'}});
    const result=await response.json();
    if(!response.ok||!result.access_token||!result.expires_in)throw Error('Instagram refused token renewal');
    const cipher=encrypt(result.access_token);
    const {error:updateError}=await db.rpc('hub_ig_direct_refresh',{
     p_org:c.organization_id,p_asset:c.asset_id,
     p_cipher:cipher.token_ciphertext,p_iv:cipher.token_iv,
     p_exp:new Date(Date.now()+Number(result.expires_in)*1000).toISOString()
    });
    if(updateError)throw updateError;
    renewed++;
   }catch(e){failed++;console.warn('Instagram direct refresh failed for asset',c.asset_id,String(e.message||e).slice(0,90))}
  }
  return res.status(200).json({checked:expiring.length,renewed,failed});
 }catch(e){return res.status(500).json({error:'No se pudo renovar Instagram Login'})}
}
