import {createClient} from '@supabase/supabase-js';
import {createHash, randomBytes, createCipheriv} from 'node:crypto';
export const GRAPH='https://graph.facebook.com/v25.0';
export const APP_ID=process.env.VITE_META_APP_ID;
export const BASE_URL='https://gpc-ads-manager.vercel.app';
export const REDIRECT=BASE_URL+'/api/meta/callback';
export const SCOPES='ads_read';
export function admin(){
 if(!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');
 return createClient(process.env.VITE_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
}
export function digest(x){return createHash('sha256').update(x).digest('hex')}
export function encrypt(token){
 const secret=process.env.META_TOKEN_ENCRYPTION_KEY;
 if(!secret || !/^[a-fA-F0-9]{64}$/.test(secret)) throw new Error('META_TOKEN_ENCRYPTION_KEY must be 64 hex digits');
 const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',Buffer.from(secret,'hex'),iv);
 const encrypted=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);
 return {token_ciphertext:Buffer.concat([encrypted,cipher.getAuthTag()]).toString('base64'),token_iv:iv.toString('base64')};
}
export const errorRedirect=(error)=>BASE_URL+'/?meta_error='+encodeURIComponent(String(error).slice(0,90))+'#settings';
