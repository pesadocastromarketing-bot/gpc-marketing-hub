import {createDecipheriv} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {admin,GRAPH} from './_shared.js';
function decrypt(ciphertext,ivB64){const secret=process.env.META_TOKEN_ENCRYPTION_KEY;if(!/^[0-9a-fA-F]{64}$/.test(secret||''))throw Error('Encryption not configured');const bytes=Buffer.from(ciphertext,'base64');const body=bytes.subarray(0,-16);const tag=bytes.subarray(-16);const decipher=createDecipheriv('aes-256-gcm',Buffer.from(secret,'hex'),Buffer.from(ivB64,'base64'));decipher.setAuthTag(tag);return Buffer.concat([decipher.update(body),decipher.final()]).toString('utf8')}
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 try{
 const bearer=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];if(!bearer)return res.status(401).json({error:'Iniciá sesión'});
 const auth=createClient(process.env.VITE_SUPABASE_URL,process.env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false}});
 const {data:{user},error}=await auth.auth.getUser(bearer);if(error||!user)return res.status(401).json({error:'Sesión inválida'});
 const db=admin();const {data:membership}=await db.from('hub_members').select('organization_id').eq('user_id',user.id).limit(1).maybeSingle();
 if(!membership)return res.status(403).json({error:'Sin workspace'});
 const {data:connections,error:dbError}=await db.rpc('hub_meta_encrypted_connections');if(dbError)throw dbError;
 const accounts=[];const warnings=[];
 for(const conn of (connections||[]).filter(x=>x.organization_id===membership.organization_id)){
 if(conn.expires_at&&new Date(conn.expires_at).getTime()<Date.now()){warnings.push('La autorización de Meta expiró');continue}
 try{
 const token=decrypt(conn.token_ciphertext,conn.token_iv);
 let next=GRAPH+'/me/adaccounts?fields=id,name,account_id,account_status,currency,business{id,name}&limit=100&access_token='+encodeURIComponent(token);
 let count=0;
 while(next&&count++<5){
 const response=await fetch(next);const json=await response.json();
 if(!response.ok){warnings.push(json.error?.message||'Meta no permitió leer las cuentas');break}
 for(const a of json.data||[])accounts.push({id:a.id,name:a.name,account_id:a.account_id,account_status:a.account_status,currency:a.currency,business:a.business?.name||null});
 next=json.paging?.next||null;
 }
 }catch(e){warnings.push('No se pudo consultar una conexión de Meta')}
 }
 res.status(200).json({accounts,warnings,connected:(connections||[]).some(x=>x.organization_id===membership.organization_id)});
 }catch(e){res.status(500).json({error:'No se pudieron cargar las cuentas de Meta'})}
}
