import React,{useEffect,useMemo,useState} from 'react';
import {RefreshCw,Link2,Facebook,Instagram,Megaphone,CheckCircle2,AlertTriangle,ChevronDown,Search,ArrowRight,Check,ShieldCheck} from 'lucide-react';
import './style.css';
const kinds={ad_account:{title:'Cuentas publicitarias',singular:'Cuenta publicitaria',Icon:Megaphone},page:{title:'Páginas de Facebook',singular:'Página',Icon:Facebook},instagram_account:{title:'Cuentas de Instagram',singular:'Instagram',Icon:Instagram}};
const sortKind={page:0,instagram_account:1,ad_account:2};
export default function MetaSetupCenter({client}){
 const[assets,setAssets]=useState([]),[brands,setBrands]=useState([]),[connection,setConnection]=useState({}),[counts,setCounts]=useState({ads:0,pages:0,instagram:0});
 const[busy,setBusy]=useState(false),[authorizing,setAuthorizing]=useState(false),[message,setMessage]=useState(''),[warnings,setWarnings]=useState([]);
 const[assignments,setAssignments]=useState({}),[filter,setFilter]=useState(''),[expanded,setExpanded]=useState({ad_account:false,page:true,instagram_account:true}),[showAll,setShowAll]=useState(false);
 const [scopeMessage,setScopeMessage]=useState('');
 const assigned=useMemo(()=>assets.map(a=>({...a,chosen_brand_id:Object.prototype.hasOwnProperty.call(assignments,a.id)?assignments[a.id]:a.brand_id})),[assets,assignments]);
 const confident=assets.filter(a=>!a.brand_id&&a.suggested_brand_id&&!a.stale);
 const missing=assigned.filter(a=>!a.chosen_brand_id&&!a.stale);
 const brandName=id=>brands.find(x=>x.id===id)?.name||'Sin vincular';
 async function call(path,body){
  const {data:{session}}=await client.auth.getSession();
  if(!session?.access_token)throw Error('Necesitás iniciar sesión nuevamente.');
  const res=await fetch(path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+session.access_token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const json=await res.json();if(!res.ok)throw Error(json.error||'El HUB no pudo completar la operación');
  return json;
 }
 async function sync(){
  setBusy(true);setMessage('Consultando Meta y actualizando tus cuentas...');
  try{
   const d=await call('/api/meta/inventory');
   setAssets(d.assets||[]);setBrands(d.brands||[]);setCounts(d.counts||{ads:0,pages:0,instagram:0});
   setConnection(d.connection||{});setWarnings(d.warnings||[]);setAssignments({});
   const adsCount=d.counts?.ads||0,pageCount=d.counts?.pages||0,igCount=d.counts?.instagram||0;
   setMessage('Sincronización lista: '+adsCount+' cuentas publicitarias, '+pageCount+' páginas y '+igCount+' Instagram.');
  }catch(e){setMessage('No se pudo sincronizar: '+e.message)}
  finally{setBusy(false)}
 }
 useEffect(()=>{sync();const params=new URLSearchParams(window.location.search);if(params.has('meta_error'))setScopeMessage('Meta rechazó la autorización: '+params.get('meta_error'));if(params.has('meta_connected'))setScopeMessage('Meta confirmó la autorización. Se están actualizando las conexiones.');},[]);
 const setBrand=(assetId,brandId)=>setAssignments(o=>({...o,[assetId]:brandId||null}));
 function propose(){
  const suggestions={};
  for(const a of confident)suggestions[a.id]=a.suggested_brand_id;
  setAssignments(o=>({...suggestions,...o}));
  setMessage('Se prepararon '+confident.length+' coincidencias. Revisalas y presioná Guardar conexiones.');
 }
 async function save(){
  const changed=assigned.filter(a=>a.chosen_brand_id!==a.brand_id).map(a=>({asset_id:a.id,brand_id:a.chosen_brand_id||null}));
  if(!changed.length){setMessage('No hay cambios pendientes.');return}
  if(!window.confirm('¿Guardar '+changed.length+' asignación(es) de Meta a concesionarios? No se publicará ni modificará ningún anuncio.'))return;
  setBusy(true);setMessage('');
  try{
   const result=await call('/api/meta/inventory',{assignments:changed});
   if(result.errors?.length)throw Error(result.errors.join(' · '));
   await sync();setMessage('Se guardaron '+result.changed+' conexiones. Las cuentas quedaron organizadas por marca.');
  }catch(e){setMessage('No se pudieron guardar: '+e.message)}
  finally{setBusy(false)}
 }
 async function authorize(mode){
  setAuthorizing(true);setScopeMessage('');
  try{
   const json=await call('/api/meta/start',{mode});
   if(!json.url?.startsWith('https://www.facebook.com/'))throw Error('Meta devolvió una dirección inválida');
   window.location.assign(json.url);
  }catch(e){setScopeMessage('No se pudo iniciar Meta: '+e.message);setAuthorizing(false)}
 }
 function row(a){
  const {Icon}=kinds[a.kind];
  return <div className={'gpc-wizard-asset '+(a.stale?'stale':'')} key={a.id}>
    <span className="gpc-wizard-asset-icon"><Icon size={18}/></span>
    <div className="gpc-wizard-asset-detail"><strong>{a.name}</strong><small>{kinds[a.kind].singular} · ID {a.external_id}{a.currency?' · '+a.currency:''}</small>
      <small>{a.stale?'No aparece en la autorización actual':a.chosen_brand_id?'Vinculada a '+brandName(a.chosen_brand_id):a.suggested_brand_id?'Sugerencia: '+brandName(a.suggested_brand_id):'Vinculación pendiente'}
       {a.kind!=='ad_account'&&a.publish_ready===true?' · Permiso de publicación detectado':''}
      </small></div>
    <select disabled={busy} aria-label={'Concesionario para '+a.name} value={a.chosen_brand_id||''} onChange={e=>setBrand(a.id,e.target.value)}>
     <option value="">Sin concesionario</option>{brands.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
    </select>
  </div>;
 }
 const toDisplay=assigned.filter(a=>!filter.trim()||[a.name,a.external_id,brandName(a.chosen_brand_id)].some(x=>String(x||'').toLowerCase().includes(filter.toLowerCase())));
 return <div className="gpc-meta-wizard">
  <section className="gpc-wizard-intro"><div className="gpc-wizard-head"><div><span className="gpc-wizard-eyebrow">GPC MARKETING HUB · CONEXIONES</span><h2>Configurá todo Meta desde un solo lugar</h2><p>Reutilizamos la autorización publicitaria y detectamos las páginas e Instagram disponibles. Vinculás los concesionarios en lote, sin cargar IDs ni tokens.</p></div><button className="primary" disabled={busy} onClick={sync}><RefreshCw size={17}/> {busy?'Sincronizando...':'Sincronizar Meta'}</button></div>
   <div className="gpc-wizard-stats">
    <div><Megaphone size={20}/><strong>{counts.ads||0}</strong><span>cuentas publicitarias</span><small>{connection.ads?'Conectadas':'Pendiente'}</small></div>
    <div><Facebook size={20}/><strong>{counts.pages||0}</strong><span>páginas de Facebook</span><small>{connection.facebook?'Autorización registrada':'Requiere autorización'}</small></div>
    <div><Instagram size={20}/><strong>{counts.instagram||0}</strong><span>perfiles de Instagram</span><small>{connection.instagram?'Permiso de publicación':'Por verificar'}</small></div>
   </div>
  </section>
  {scopeMessage&&<div className="gpc-wizard-alert" role="alert"><AlertTriangle size={17}/>{scopeMessage}</div>}
  <section className="gpc-wizard-permissions">
   <div><span className="gpc-wizard-step">1</span><div><h3>Autorizaciones necesarias</h3><p>El HUB ya tiene acceso a publicidad. Para ver y publicar en páginas o Instagram hay que autorizar esos permisos en Meta, sin compartir contraseñas.</p></div></div>
   <div className="gpc-wizard-permission-row"><div><strong>Publicidad</strong><small>Campañas y métricas</small></div><span className={connection.ads?'gpc-wizard-ok':'gpc-wizard-pending'}>{connection.ads?'Conectada':'Pendiente'}</span></div>
   <div className="gpc-wizard-permission-row"><div><strong>Facebook y páginas</strong><small>Descubrir automáticamente páginas administradas</small></div>
    {connection.facebook?<span className="gpc-wizard-ok">Conectado</span>:<button className="primary" onClick={()=>authorize('social_fb')} disabled={authorizing}>Autorizar páginas <ArrowRight size={14}/></button>}</div>
   {connection.facebook&&<div className="gpc-wizard-permission-row"><div><strong>Publicación en Facebook</strong><small>Habilitar programación desde el calendario</small></div>
    {connection.pages_publish?<span className="gpc-wizard-ok">Habilitada</span>:<button className="secondary" disabled={authorizing} onClick={()=>authorize('social_publish')}>Autorizar publicación</button>}</div>}
   <div className="gpc-wizard-permission-row"><div><strong>Instagram</strong><small>Buscaremos los perfiles profesionales vinculados a las páginas. Meta puede requerir permisos específicos adicionales.</small></div>
    {connection.instagram?<span className="gpc-wizard-ok">Habilitado</span>:<span className="gpc-wizard-pending">Permiso pendiente</span>}</div>
   {connection.facebook&&counts.instagram===0&&<p className="gpc-wizard-footnote">Si no aparecen tus Instagram después de sincronizar, Meta todavía no autorizó su lectura o no están vinculados a las páginas disponibles. No significa que se hayan eliminado.</p>}
  </section>
  <section className="gpc-wizard-accounts">
   <div className="gpc-wizard-section-top"><span className="gpc-wizard-step">2</span><div><h3>Ordenar cuentas por concesionario</h3><p>El HUB propuso {confident.length} coincidencias y encontró {missing.length} activos sin asignar. Ningún destino se publica sin tu confirmación.</p></div></div>
   <div className="gpc-wizard-tools">
    <button className="secondary" disabled={busy||!confident.length} onClick={propose}><Check size={15}/> Aplicar sugerencias ({confident.length})</button>
    <button className="primary" disabled={busy||!assigned.some(a=>a.chosen_brand_id!==a.brand_id)} onClick={save}><ShieldCheck size={15}/> Guardar conexiones</button>
    <label className="gpc-wizard-search"><Search size={15}/><input placeholder="Buscar nombre, ID o concesionario" value={filter} onChange={e=>setFilter(e.target.value)}/></label>
   </div>
   {Object.entries(kinds).sort((a,b)=>sortKind[a[0]]-sortKind[b[0]]).map(([kind,config])=>{
    const rows=toDisplay.filter(x=>x.kind===kind);
    return <div className="gpc-wizard-group" key={kind}><button className="gpc-wizard-group-title" onClick={()=>setExpanded(e=>({...e,[kind]:!e[kind]}))}><config.Icon size={18}/><strong>{config.title}</strong><span>{rows.length}</span><ChevronDown size={16} style={{transform:expanded[kind]?'rotate(180deg)':'none'}}/></button>
    {expanded[kind]&&<div>{rows.length?rows.slice(0,showAll?150:25).map(row):<p className="gpc-wizard-none">{kind==='ad_account'?'Sin cuentas publicitarias disponibles.':'Todavía no hay cuentas disponibles con los permisos actuales.'}</p>}
     {rows.length>25&&<button className="gpc-wizard-showmore" onClick={()=>setShowAll(x=>!x)}>{showAll?'Mostrar menos':'Mostrar '+(rows.length-25)+' restantes'}</button>}
     </div>}</div>;
   })}
   <p className="gpc-wizard-footnote">Las cuentas con el mismo nombre y distinto ID no se fusionan. Las sugerencias no eliminan ni modifican campañas, páginas o perfiles.</p>
  </section>
  {message&&<p className="gpc-wizard-message" role="status">{message}</p>}
  {warnings.length>0&&<details className="gpc-wizard-warnings"><summary>Detalles de sincronización ({warnings.length})</summary>{warnings.map((w,i)=><p key={i}>{w}</p>)}</details>}
 </div>;
}
