import {randomBytes} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {admin,APP_ID,REDIRECT,SCOPES,digest} from './_shared.js';
export default async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'method_not_allowed'});
 res.setHeader('Cache-Control','no-store');
 try{
  const bearer=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if(!bearer)return res.status(401).json({error:'Sign in first'});
  const auth=createClient(process.env.VITE_SUPABASE_URL,process.env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false}});
  const {data:{user},error:authError}=await auth.auth.getUser(bearer);
  if(authError||!user)return res.status(401).json({error:'Invalid user'});
  const db=admin();
  const {data:member,error:memberError}=await db.from('hub_members').select('organization_id,role').eq('user_id',user.id).in('role',['owner','admin']).limit(1).maybeSingle();
  if(memberError||!member)return res.status(403).json({error:'Workspace admin access required'});
  if(!APP_ID||!process.env.META_APP_SECRET||!process.env.META_TOKEN_ENCRYPTION_KEY)return res.status(503).json({error:'Meta backend environment not configured'});
  const state=randomBytes(32).toString('hex');
  const flow=['ads_manage','social_fb','social_ig','social_publish'].includes(req.body?.mode)?req.body.mode:'ads';
  const {error}=await db.rpc('hub_oauth_state_create_flow',{p_hash:digest(state),p_user:user.id,p_org:member.organization_id,p_expires:new Date(Date.now()+10*60*1000).toISOString(),p_flow:flow});
  if(error)throw error;
  const url=new URL('https://www.facebook.com/v25.0/dialog/oauth');
  url.searchParams.set('client_id',APP_ID);
  url.searchParams.set('redirect_uri',REDIRECT);
  url.searchParams.set('response_type','code');
  const scopeMode=flow==='ads_manage'?'ads_read,ads_management':flow==='social_fb'?'pages_show_list,pages_read_engagement':flow==='social_publish'?'pages_show_list,pages_read_engagement,pages_manage_posts':flow==='social_ig'?'pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish':SCOPES;
  url.searchParams.set('scope',scopeMode);
  url.searchParams.set('state',state);
  if(flow!=='ads')url.searchParams.set('auth_type','rerequest');
  return res.status(200).json({url:url.toString()});
 }catch(e){return res.status(500).json({error:'Meta connection unavailable',detail:e.message})}
}
