import React,{useEffect,useState} from 'react';
import {Facebook,Instagram,RefreshCw,CheckCircle2,AlertTriangle,Link2} from 'lucide-react';
const names={'vw':'Pesado Castro VW','chevy':'Chevromax','renault':'Circular Renault','toyota':'Sakura Toyota','used':'Usados GPC'};
export default function SocialConnections({client,brandIds}){
 const[assets,setAssets]=useState([]),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[connected,setConnected]=useState(false),[authorizing,setAuthorizing]=useState(false);
 async function request(path,body){
  const{data:{session}}=await client.auth.getSession();
  const response=await fetch(path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+session?.access_token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const json=await response.json();if(!response.ok)throw Error(json.error||'Error de servidor');return json;
 }
 async function refresh(force=false){
  setBusy(true);try{
   const json=await request(force===true?'/api/social/accounts':'/api/meta/assets-fast?view=social');
   setAssets(json.assets||[]);setConnected(Boolean(json.connected));
   if(json.warnings?.length)setMessage(json.warnings.join(' · '));
  }catch(e){setMessage(e.message)}finally{setBusy(false)}
 }
 useEffect(()=>{refresh()},[]);
 async function connect(mode){
  setAuthorizing(true);setMessage('');
  try{
   const result=await request('/api/meta/start',{mode});
   if(!result.url?.startsWith('https://www.facebook.com/'))throw Error('Meta devolvió una URL inesperada');
   window.location.href=result.url;
  }catch(e){setMessage(e.message);setAuthorizing(false)}
 }
 async function assign(asset,brandId){
  setBusy(true);setMessage('');
  try{
   await request('/api/social/accounts',{asset_id:asset.id,brand_id:brandId||null});
   setAssets(old=>old.map(x=>x.id===asset.id?{...x,brand_id:brandId||null}:x));
   setMessage('Destino vinculado correctamente.');
  }catch(e){setMessage(e.message)}
  finally{setBusy(false)}
 }
 return <section className="panel hub-social-panel"><div className="panelhead"><h3>Redes para el calendario</h3><button className="secondary" onClick={()=>refresh(true)} disabled={busy}><RefreshCw size={15}/> Actualizar</button></div>
  <div className="hub-social-body"><p>Autorizá tus páginas y vinculá cada perfil a una marca. Después podrás programar desde el calendario las publicaciones preparadas para ese destino.</p>
   <div className="hub-social-actions">
    <button className="primary" disabled={authorizing} onClick={()=>connect('social_fb')}><Facebook size={17}/> Conectar páginas de Facebook</button>
    <button className="secondary" disabled={authorizing} onClick={()=>connect('social_ig')}><Instagram size={17}/> Solicitar permisos de Instagram</button>
   </div>
   <small className="hub-social-note">Meta debe autorizar pages_show_list, pages_manage_posts y pages_read_engagement. Instagram requiere además instagram_basic e instagram_content_publish; esos permisos pueden necesitar habilitación o revisión adicional.</small>
   {message&&<p className="hub-cal-notice" role="status">{message}</p>}
   {!connected&&<p className="hub-social-muted">Todavía no hay autorización de publicación. La conexión publicitaria existente se mantiene separada.</p>}
   {assets.length===0&&connected&&<p className="hub-social-muted">No se encontraron páginas disponibles con la autorización actual.</p>}
   {assets.map(asset=><div className="hub-social-row" key={asset.id}>
    <span>{asset.kind==='page'?<Facebook size={20}/>:<Instagram size={20}/>}</span><div><strong>{asset.name}</strong><small>{asset.kind==='page'?'Facebook':'Instagram'} · ID {asset.external_id}</small><small>{asset.is_ready?'Acceso de publicación detectado':'Sin tarea CREATE_CONTENT (consulta solamente)'}</small></div>
    <select disabled={busy} aria-label={'Vincular '+asset.name+' a una marca'} value={asset.brand_id||''} onChange={e=>assign(asset,e.target.value)}>
      <option value="">Sin marca</option>{Object.entries(brandIds).filter(([,id])=>id).map(([code,id])=><option key={id} value={id}>{names[code]||code}</option>)}
    </select>
   </div>)}
  </div>
 </section>;
}
