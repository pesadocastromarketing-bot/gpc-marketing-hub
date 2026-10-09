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
 const [igDiagnostics,setIgDiagnostics]=useState({});
 const [checkingIg,setCheckingIg]=useState('');
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
 async function sync(force=false){
  setBusy(true);setMessage(force===true?'Consultando Meta y actualizando tus cuentas...':'Cargando cuentas guardadas...');
  try{
   const d=await call(force===true?'/api/meta/inventory':'/api/meta/assets-fast?view=inventory');
   setAssets(d.assets||[]);setBrands(d.brands||[]);setCounts(d.counts||{ads:0,pages:0,instagram:0});
   setConnection(d.connection||{});setWarnings(d.warnings||[]);setAssignments({});
   const adsCount=d.counts?.ads||0,pageCount=d.counts?.pages||0,igCount=d.counts?.instagram||0;
   setMessage((d.cached?'Cuentas cargadas: ':'Sincronización lista: ')+adsCount+' cuentas publicitarias, '+pageCount+' páginas y '+igCount+' Instagram.');
  }catch(e){setMessage('No se pudo sincronizar: '+e.message)}
  finally{setBusy(false)}
 }
 useEffect(()=>{const params=new URLSearchParams(window.location.search);sync(params.has('meta_connected'));if(params.has('meta_error'))setScopeMessage('Meta rechazó la autorización: '+params.get('meta_error'));if(params.has('meta_connected'))setScopeMessage('Meta confirmó la autorización. Se están actualizando las conexiones.');},[]);
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
  if(!window.confirm('¿Guardar '+changed.length+' asignación(es) de Meta a unidades comerciales? No se publicará ni modificará ningún anuncio.'))return;
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
 async function diagnoseInstagram(asset,repair=false){
  if(repair&&!window.confirm('¿Corregir solamente la conexión de @'+asset.name+' después de verificar su página y permisos con Meta? No cambia otras cuentas.'))return;
  setCheckingIg(asset.id);
  setIgDiagnostics(previous=>({...previous,[asset.id]:{loading:true}}));
  try{
   const result=await call('/api/meta/diagnose-instagram',{asset_id:asset.id,repair});
   if(repair){
    await sync(true);
    setIgDiagnostics(previous=>({...previous,[asset.id]:{message:result.message,verified:true}}));
   }else{
    setIgDiagnostics(previous=>({...previous,[asset.id]:result}));
   }
  }catch(e){
   setIgDiagnostics(previous=>({...previous,[asset.id]:{message:'No se pudo comprobar: '+e.message}}));
  }finally{setCheckingIg('')}
 }
 function row(a){
  const {Icon}=kinds[a.kind];
  return <div className={'gpc-wizard-asset '+(a.stale?'stale':'')} key={a.id}>
    <span className="gpc-wizard-asset-icon"><Icon size={18}/></span>
    <div className="gpc-wizard-asset-detail"><strong>{a.name}</strong><small>{kinds[a.kind].singular} · ID {a.external_id}{a.currency?' · '+a.currency:''}</small>
      <small>{a.stale?'No aparece en la autorización actual':a.chosen_brand_id?'Vinculada a '+brandName(a.chosen_brand_id):a.suggested_brand_id?'Sugerencia: '+brandName(a.suggested_brand_id):'Vinculación pendiente'}
       {a.kind==='instagram_account'?(a.publish_ready===true?' · Publicación autorizada para esta cuenta':' · No autorizada para publicar desde este Instagram'):a.kind==='page'&&a.publish_ready===true?' · Publicación autorizada':''}
      </small>
      {a.kind==='instagram_account'&&!a.publish_ready&&
       <div className="gpc-ig-diagnostics">
        <button type="button" className="secondary" disabled={Boolean(checkingIg)} onClick={()=>diagnoseInstagram(a)}>
         {checkingIg===a.id?'Comprobando acceso en Meta...':'Diagnosticar permiso de esta cuenta'}
        </button>
        {igDiagnostics[a.id]&&!igDiagnostics[a.id].loading&&<>
         <small>{igDiagnostics[a.id].message}</small>
         {igDiagnostics[a.id].diagnostics?.length>0&&<small>
          Comprobadas {igDiagnostics[a.id].diagnostics.length} conexiones autorizadas.
          {igDiagnostics[a.id].diagnostics.some(d=>d.page_seen&&!d.create_content)?' Falta autorización para crear contenido en la página.':''}
          {!igDiagnostics[a.id].diagnostics.some(d=>d.page_seen)?' Meta no incluyó la página en las cuentas accesibles a esas conexiones.':''}
         </small>}
         {igDiagnostics[a.id].repair_available&&
          <button type="button" className="primary" disabled={Boolean(checkingIg)} onClick={()=>diagnoseInstagram(a,true)}>
           Verificar y corregir asociación
          </button>}
        </>}
       </div>}
     </div>
    <select disabled={busy} aria-label={'Unidad comercial para '+a.name} value={a.chosen_brand_id||''} onChange={e=>setBrand(a.id,e.target.value)}>
     <option value="">Sin asignar</option><optgroup label="Concesionarios">{brands.filter(b=>b.unit_type==='dealership').map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</optgroup><optgroup label="Usados">{brands.filter(b=>b.unit_type==='used').map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</optgroup>
    </select>
  </div>;
 }
 const toDisplay=assigned.filter(a=>!filter.trim()||[a.name,a.external_id,brandName(a.chosen_brand_id)].some(x=>String(x||'').toLowerCase().includes(filter.toLowerCase())));
 return <div className="gpc-meta-wizard">
  <section className="gpc-wizard-intro"><div className="gpc-wizard-head"><div><span className="gpc-wizard-eyebrow">GPC MARKETING HUB · CONEXIONES</span><h2>Configurá Meta para las 8 unidades comerciales</h2><p>Reutilizamos la autorización publicitaria y detectamos las páginas e Instagram disponibles. Asociás las cuentas a los 6 concesionarios y las 2 unidades de usados en lote, sin cargar IDs ni tokens.</p></div><button className="primary" disabled={busy} onClick={()=>sync(true)}><RefreshCw size={17}/> {busy?'Sincronizando...':'Sincronizar Meta'}</button></div>
   <div className="gpc-wizard-stats">
    <div><Megaphone size={20}/><strong>{counts.ads||0}</strong><span>cuentas publicitarias</span><small>{connection.ads?'Conectadas':'Pendiente'}</small></div>
    <div><Facebook size={20}/><strong>{counts.pages||0}</strong><span>páginas de Facebook</span><small>{connection.facebook?'Autorización registrada':'Requiere autorización'}</small></div>
    <div><Instagram size={20}/><strong>{counts.instagram||0}</strong><span>perfiles de Instagram</span><small>{connection.instagram?'Permiso de publicación':'Por verificar'}</small></div>
   </div>
  </section>
  {scopeMessage&&<div className="gpc-wizard-alert" role="alert"><AlertTriangle size={17}/>{scopeMessage}</div>}
  <section className="gpc-wizard-permissions">
   <div><span className="gpc-wizard-step">1</span><div><h3>Conectá todos tus activos con Meta</h3><p>Una única autorización empresarial para seleccionar páginas de Facebook, cuentas de Instagram y cuentas publicitarias. Usamos el ajuste GPC Marketing Hub de Meta Developers.</p></div></div>
   <div className="gpc-wizard-permission-row">
     <div><strong>Facebook Login for Business</strong><small>Meta te mostrará qué empresas y activos actuales (y, cuando esté disponible, futuros) querés autorizar. No ingreses tokens ni contraseñas en este HUB.</small></div>
     <button className="primary" onClick={()=>authorize('business')} disabled={authorizing}>{authorizing?'Abriendo Meta...':'Conectar todo con Meta'} <ArrowRight size={15}/></button>
   </div>
   <div className="gpc-wizard-permission-row"><div><strong>Publicidad</strong><small>Campañas, métricas y anuncios</small></div><span className={connection.ads?'gpc-wizard-ok':'gpc-wizard-pending'}>{connection.ads?'Ya conectada':'Pendiente'}</span></div>
   <div className="gpc-wizard-permission-row"><div><strong>Páginas de Facebook</strong><small>{counts.pages||0} páginas detectadas. Para publicar, Meta debe conceder la tarea CREATE_CONTENT y pages_manage_posts.</small></div><span className={connection.facebook?'gpc-wizard-ok':'gpc-wizard-pending'}>{connection.facebook?'Permiso concedido':'Por autorizar'}</span></div>
   <div className="gpc-wizard-permission-row"><div><strong>Instagram · historias, reels y publicaciones</strong><small>{counts.instagram||0} perfiles detectados. Para programar historias, autorizá instagram_content_publish con el usuario de Facebook que administra la página vinculada al Instagram elegido. El permiso es individual por conexión: autorizar un perfil no habilita automáticamente los otros.</small></div><div className="gpc-instagram-permission-actions"><span className={connection.instagram?'gpc-wizard-ok':'gpc-wizard-pending'}>{connection.instagram?'Permiso concedido':'Por verificar'}</span><button type="button" className="secondary" disabled={authorizing} onClick={()=>authorize('social_ig')}><Instagram size={16}/>{authorizing?'Abriendo Meta...':'Solicitar permisos de Instagram'}</button></div></div>
   <p className="gpc-wizard-footnote">La autorización previa de anuncios se conserva. Si Meta no ofrece todos los activos, consultá Detalles de sincronización al final: puede faltar aprobación o acceso a alguna página. Los contenidos no se publican por conectar las cuentas.</p>
  </section>
  <section className="gpc-wizard-accounts">
   <div className="gpc-wizard-section-top"><span className="gpc-wizard-step">2</span><div><h3>Asignar cuentas por unidad comercial</h3><p>El HUB propuso {confident.length} coincidencias y encontró {missing.length} activos sin asignar. Ningún destino se publica sin tu confirmación.</p></div></div>
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
