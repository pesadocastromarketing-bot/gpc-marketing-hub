import {createClient} from '@supabase/supabase-js';
import {admin} from '../meta/_shared.js';
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Método no permitido'});
 try{
  const token=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if(!token)return res.status(401).json({error:'Iniciá sesión'});
  const client=createClient(process.env.VITE_SUPABASE_URL,process.env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false}});
  const {data:{user},error}=await client.auth.getUser(token);
  if(error||!user)return res.status(401).json({error:'Sesión inválida'});
  const snapshot=JSON.parse(process.env.GPC_INTELLIGENCE_SNAPSHOT||'null');
  if(!snapshot)return res.status(503).json({error:'Fuente PIT aún no configurada'});
  const workspace=String(req.query.workspace||'');
  if(!snapshot.organizations.includes(workspace))return res.status(403).json({error:'Workspace no autorizado'});
  const {data:membership,error:memberError}=await admin().from('hub_members').select('organization_id').eq('user_id',user.id).eq('organization_id',workspace).maybeSingle();
  if(memberError||!membership)return res.status(403).json({error:'Sin acceso'});
  const {organizations,...result}=snapshot;
  return res.status(200).json(result);
 }catch{return res.status(500).json({error:'No se pudo consultar Inteligencia de Mercado'});}
}