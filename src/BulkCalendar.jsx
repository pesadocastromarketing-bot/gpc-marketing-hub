import React,{useEffect,useMemo,useState} from 'react';
import {CalendarDays,UploadCloud,Plus,Copy,Check,ChevronLeft,ChevronRight,Trash2,Image as ImageIcon,Video,Clock,Layers,RefreshCw} from 'lucide-react';

const BRAND_NAMES={'vw':'Pesado Castro VW','chevy':'Chevromax','renault':'Circular Renault','toyota':'Sakura Toyota','used':'Usados GPC'};
const two=x=>String(x).padStart(2,'0');
const dateKey=d=>[d.getFullYear(),two(d.getMonth()+1),two(d.getDate())].join('-');
const dateOffset=(value,n)=>{const d=new Date(value+'T12:00:00');d.setDate(d.getDate()+n);return dateKey(d)};
const today=dateKey(new Date());
const id=()=>globalThis.crypto?.randomUUID?.()||('m'+Date.now()+Math.random().toString(36).slice(2));
const calendarCells=month=>{const start=(new Date(month.getFullYear(),month.getMonth(),1).getDay()+6)%7;return Array.from({length:42},(_,i)=>new Date(month.getFullYear(),month.getMonth(),1+i-start))};
const channels=['Instagram','Facebook'];
const isVideoMime=m=>m?.startsWith('video/');
const maxMediaCount=10;
function moneyDate(s){return new Date(s+'T12:00:00').toLocaleDateString('es-AR',{day:'2-digit',month:'short'})}

export default function BulkCalendar({client,user,organizationId,brandIds,brandFilter,onChangeCount,openSignal=0}){
 const allBrands=Object.keys(brandIds).filter(x=>brandIds[x]).map(x=>({code:x,id:brandIds[x],name:BRAND_NAMES[x]||x}));
 const [month,setMonth]=useState(new Date(new Date().getFullYear(),new Date().getMonth(),1));
 const [items,setItems]=useState([]),[media,setMedia]=useState([]),[loading,setLoading]=useState(false),[uploading,setUploading]=useState(false),[saving,setSaving]=useState(false),[message,setMessage]=useState('');
 const [showComposer,setShowComposer]=useState(false),[selectedBrands,setSelectedBrands]=useState([]),[selectedChannels,setSelectedChannels]=useState(['Instagram','Facebook']);
 const [dates,setDates]=useState([dateOffset(today,1)]),[manualDate,setManualDate]=useState(dateOffset(today,1)),[time,setTime]=useState('18:00');
 const [title,setTitle]=useState(''),[copy,setCopy]=useState(''),[format,setFormat]=useState('Imagen'),[selectedMedia,setSelectedMedia]=useState([]),[planMode,setPlanMode]=useState('draft'),[filterDay,setFilterDay]=useState('');
 const [selectedRows,setSelectedRows]=useState([]);
 const [mediaUrls,setMediaUrls]=useState({});
 useEffect(()=>{setSelectedBrands(old=>old.length?old:allBrands.slice(0,1).map(x=>x.code))},[organizationId]);
 useEffect(()=>{if(openSignal>0)setShowComposer(true)},[openSignal]);
 async function refresh(){
  setLoading(true);
  const [a,b]=await Promise.all([
   client.from('hub_content').select('id,title,copy_text,format,scheduled_date,scheduled_time,channels,brand_id,media_paths,batch_id,publication_mode,status').eq('organization_id',organizationId).order('scheduled_date',{ascending:true}).limit(1500),
   client.from('hub_media').select('storage_path,filename,mime_type,size_bytes').eq('organization_id',organizationId).order('created_at',{ascending:false}).limit(100)
  ]);
  if(a.error)setMessage('No se pudo cargar el calendario: '+a.error.message);
  else {setItems(a.data||[]);onChangeCount?.((a.data||[]).length)}
  if(b.error)setMessage('No se pudo cargar la biblioteca: '+b.error.message);
  else setMedia(b.data||[]);
  setLoading(false);
 }
 useEffect(()=>{refresh()},[organizationId]);
 useEffect(()=>{
  const unique=[...new Set(items.filter(p=>p.scheduled_date?.startsWith(dateKey(month).slice(0,7))).flatMap(p=>p.media_paths||[]))].slice(0,45);
  const missing=unique.filter(p=>!mediaUrls[p]);
  if(!missing.length)return;
  let active=true;
  client.storage.from('hub-creatives').createSignedUrls(missing,3600).then(({data})=>{
   if(active)setMediaUrls(old=>({...old,...Object.fromEntries((data||[]).filter(x=>x.signedUrl).map(x=>[x.path,x.signedUrl]))}));
  });
  return()=>{active=false};
 },[month,items]);
 const visible=items.filter(p=>(brandFilter==='all'||p.brand_id===brandIds[brandFilter]));
 const inMonth=visible.filter(p=>p.scheduled_date?.startsWith(dateKey(month).slice(0,7)));
 const dateMap=useMemo(()=>{
  const map=new Map();
  for(const item of visible){const list=map.get(item.scheduled_date)||[];list.push(item);map.set(item.scheduled_date,list)}
  return map;
 },[visible]);
 const addDate=d=>{if(d&&!dates.includes(d)){if(dates.length>=30){setMessage('Máximo 30 fechas por planificación.');return}setDates(v=>[...v,d].sort())}};
 const removeDate=d=>setDates(old=>old.filter(x=>x!==d));
 const repeat=days=>{const start=dates.at(0)||today;setDates(Array.from({length:4},(_,i)=>dateOffset(start,days*i)))};
 const checkFile=(file)=>file.size<=50*1024*1024&&['image/jpeg','image/png','image/webp','video/mp4','video/quicktime'].includes(file.type);
 async function uploadFiles(files){
  const chosen=Array.from(files||[]);if(!chosen.length)return;
  if(chosen.length+selectedMedia.length>maxMediaCount){setMessage('Máximo '+maxMediaCount+' archivos por creatividad.');return}
  if(chosen.some(f=>!checkFile(f))){setMessage('Usá JPG, PNG, WebP, MP4 o MOV de hasta 50 MB por archivo.');return}
  setUploading(true);setMessage('');
  try{
   const paths=[];
   for(const file of chosen){
    const extension=file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g,'')||'bin';
    const storagePath=organizationId+'/'+user.id+'/'+id()+'.'+extension;
    const {error:uploadError}=await client.storage.from('hub-creatives').upload(storagePath,file,{contentType:file.type,upsert:false});
    if(uploadError)throw Error(file.name+': '+uploadError.message);
    const {error:dbError}=await client.from('hub_media').insert({organization_id:organizationId,uploaded_by:user.id,storage_path:storagePath,filename:file.name,mime_type:file.type,size_bytes:file.size});
    if(dbError){await client.storage.from('hub-creatives').remove([storagePath]);throw Error(dbError.message)}
    const {data:url}=await client.storage.from('hub-creatives').createSignedUrl(storagePath,3600);
    paths.push(storagePath);
    if(url?.signedUrl)setMediaUrls(old=>({...old,[storagePath]:url.signedUrl}));
   }
   setSelectedMedia(v=>[...v,...paths]);
   await refresh();setMessage(chosen.length+' archivo(s) cargado(s) correctamente.');
  }catch(e){setMessage('Error al subir creatividad: '+e.message)}
  finally{setUploading(false)}
 }
 const estimated=dates.length*selectedBrands.length*selectedChannels.length;
 async function saveBatch(){
  if(!title.trim()||!dates.length||!selectedBrands.length||!selectedChannels.length||!selectedMedia.length){
   setMessage('Completá título, creatividad, fechas, marcas y redes sociales.');return;
  }
  if(estimated>200){setMessage('Máximo 200 publicaciones por lote. Dividí la planificación.');return}
  const files=selectedMedia.map(p=>media.find(m=>m.storage_path===p)).filter(Boolean);
  if(format==='Carrusel'&&(files.length<2||files.some(m=>isVideoMime(m.mime_type)))){
   setMessage('Para carrusel elegí de 2 a 10 imágenes.');return
  }
  if(format==='Reel'&&(files.length!==1||!isVideoMime(files[0]?.mime_type))){
   setMessage('Para Reel cargá un único video MP4/MOV.');return
  }
  if(format!=='Carrusel'&&format!=='Reel'&&files.some(m=>isVideoMime(m.mime_type))){
   setMessage('Los formatos Imagen e Historia requieren imágenes; elegí Reel para video.');return
  }
  if(dates.some(d=>d<today)){setMessage('No se pueden planificar publicaciones en fechas pasadas.');return}
  if(!window.confirm('¿Crear '+estimated+' publicaciones en '+dates.length+' fecha(s), '+selectedBrands.length+' marca(s) y '+selectedChannels.length+' red(es)?\n\nTodavía no se publicarán automáticamente.'))return;
  setSaving(true);setMessage('');
  const batchId=id();
  const rows=dates.flatMap(date=>selectedBrands.flatMap(code=>selectedChannels.map(channel=>({
    organization_id:organizationId,brand_id:brandIds[code],title:title.trim(),copy_text:copy.trim(),format,
    scheduled_date:date,scheduled_time:time,channels:[channel],media_paths:selectedMedia,
    created_by:user.id,status:'draft',publication_mode:planMode,timezone:'America/Argentina/Buenos_Aires',batch_id:batchId
  }))));
  const {error}=await client.from('hub_content').insert(rows);
  if(error)setMessage('No se pudo guardar el lote: '+error.message);
  else {setMessage('Se crearon '+rows.length+' publicaciones en Supabase. La salida a Meta sigue pendiente de autorización.');setShowComposer(false);setDates([dateOffset(today,1)]);setSelectedMedia([]);setTitle('');setCopy('');await refresh();}
  setSaving(false);
 }
 async function scheduleSelected(){
  if(!selectedRows.length)return;
  if(selectedRows.length>100){setMessage('Máximo 100 publicaciones para programar en un lote.');return}
  if(!window.confirm('ATENCIÓN: Vas a programar '+selectedRows.length+' publicación(es) para que Meta las publique automáticamente en las fechas y redes correspondientes. ¿Confirmás?'))return;
  setSaving(true);setMessage('Comprobando destinos y permisos de Meta...');
  try{
   const {data:{session}}=await client.auth.getSession();
   const response=await fetch('/api/social/schedule',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session?.access_token},body:JSON.stringify({ids:selectedRows,confirmation:'PROGRAMAR'})});
   const result=await response.json();if(!response.ok)throw Error(result.error||'Error al programar');
   const failures=(result.results||[]).filter(x=>x.status==='error');
   setMessage('Programadas '+result.scheduled+' de '+result.total+' publicación(es).'+(failures.length?' Sin programar: '+failures.slice(0,4).map(x=>x.message).join(' | '):''));
   setSelectedRows(failures.map(x=>x.id));
   await refresh();
  }catch(e){setMessage('No se pudieron programar: '+e.message)}
  finally{setSaving(false)}
 }
 async function removeSelected(){
  if(!selectedRows.length||!window.confirm('¿Eliminar '+selectedRows.length+' borradores seleccionados del calendario? Los archivos originales permanecerán guardados.'))return;
  const {error}=await client.from('hub_content').delete().eq('organization_id',organizationId).in('id',selectedRows);
  if(error)setMessage('No se pudieron eliminar: '+error.message);
  else{setSelectedRows([]);setMessage('Borradores eliminados.');await refresh()}
 }
 function clone(item){
  setTitle(item.title);setCopy(item.copy_text||'');setFormat(item.format||'Imagen');
  setDates([dateOffset(item.scheduled_date,7)]);setManualDate(dateOffset(item.scheduled_date,7));setTime((item.scheduled_time||'18:00').slice(0,5));
  setSelectedBrands([allBrands.find(b=>b.id===item.brand_id)?.code].filter(Boolean));
  setSelectedChannels(item.channels||['Instagram']);setSelectedMedia(item.media_paths||[]);
  setPlanMode(item.publication_mode||'draft');setShowComposer(true);
  setMessage('Creatividad y copy precargados. Elegí nuevas fechas y marcas para replicar.');
 }
 return <div className="hub-calendar">
  <section className="hub-calendar-top">
   <div><h3>Calendario editorial multicuenta</h3><p>Una creatividad, varias marcas, varias redes y fechas. Todo en un solo paso.</p></div>
   <button className="primary" onClick={()=>setShowComposer(v=>!v)}><Plus size={16}/> {showComposer?'Cerrar editor':'Crear lote de publicaciones'}</button>
  </section>
  {message&&<p className="hub-cal-notice" role="status">{message}</p>}
  {showComposer&&<section className="hub-composer">
   <div className="hub-composer-heading"><h3>1. Subí la creatividad una sola vez</h3><span>Biblioteca privada de Supabase</span></div>
   <label className="hub-upload"><UploadCloud size={23}/><strong>{uploading?'Subiendo archivos...':'Elegir imágenes o videos'}</strong><span>JPG, PNG, WebP, MP4 o MOV · hasta 50 MB cada uno · 10 archivos</span><input disabled={uploading||saving} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" multiple onChange={e=>{uploadFiles(e.target.files);e.target.value=''}}/></label>
   {media.length>0&&<div className="hub-media-library"><strong>Archivos recientes (tocá para usar)</strong><div className="hub-media-grid">{media.slice(0,30).map(file=><button className={selectedMedia.includes(file.storage_path)?'selected':''} key={file.storage_path} onClick={()=>setSelectedMedia(current=>current.includes(file.storage_path)?current.filter(p=>p!==file.storage_path):current.length<10?[...current,file.storage_path]:current)}>
    {isVideoMime(file.mime_type)?<Video size={25}/>:mediaUrls[file.storage_path]?<img src={mediaUrls[file.storage_path]} alt={file.filename}/>:<ImageIcon size={23}/>}
    <small title={file.filename}>{file.filename}</small>{selectedMedia.includes(file.storage_path)&&<Check size={17} className="hub-media-check"/>}</button>)}</div></div>}
   <div className="hub-composer-two"><label>Título interno<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Ej. Amarok tasa 0%"/></label><label>Formato<select value={format} onChange={e=>setFormat(e.target.value)}><option>Imagen</option><option>Carrusel</option><option>Reel</option><option>Historia</option></select></label></div>
   <label className="hub-wide-label">Copy de la publicación<textarea rows="3" placeholder="Texto que se reutilizará en todas las fechas y cuentas..." value={copy} onChange={e=>setCopy(e.target.value)}/></label>
   <div className="hub-composer-heading"><h3>2. Elegí las marcas y los canales</h3><span>Podés seleccionar varios destinos</span></div>
   <div className="hub-check-list">{allBrands.map(b=><label key={b.id}><input type="checkbox" checked={selectedBrands.includes(b.code)} onChange={e=>setSelectedBrands(v=>e.target.checked?[...v,b.code]:v.filter(x=>x!==b.code))}/>{b.name}</label>)}</div>
   <div className="hub-check-list">{channels.map(channel=><label key={channel}><input type="checkbox" checked={selectedChannels.includes(channel)} onChange={e=>setSelectedChannels(v=>e.target.checked?[...v,channel]:v.filter(x=>x!==channel))}/>{channel}</label>)}</div>
   <div className="hub-composer-heading"><h3>3. Elegí todas las fechas</h3><span>Hora de Argentina (UTC−3)</span></div>
   <div className="hub-date-controls"><input type="date" min={today} value={manualDate} onChange={e=>setManualDate(e.target.value)}/><button className="secondary" onClick={()=>addDate(manualDate)}>Agregar fecha</button><input type="time" value={time} onChange={e=>setTime(e.target.value)}/></div>
   <div className="hub-shortcuts"><button onClick={()=>addDate(today)}>Hoy</button><button onClick={()=>addDate(dateOffset(today,1))}>Mañana</button><button onClick={()=>addDate(dateOffset(today,7))}>+7 días</button><button onClick={()=>addDate(dateOffset(today,14))}>+14 días</button><button onClick={()=>repeat(7)}>4 semanas seguidas</button><button onClick={()=>repeat(30)}>4 meses seguidos</button></div>
   <div className="hub-date-pills">{dates.map(d=><button key={d} onClick={()=>removeDate(d)}>{moneyDate(d)} <span>×</span></button>)}</div>
   <div className="hub-composer-heading"><h3>4. Guardá todas las publicaciones</h3></div>
   <div className="hub-check-list"><label><input type="radio" checked={planMode==='draft'} onChange={()=>setPlanMode('draft')}/>Borradores</label><label><input type="radio" checked={planMode==='pending_authorization'} onChange={()=>setPlanMode('pending_authorization')}/>Listas para autorizar y programar</label></div>
   <div className="hub-submit"><div><strong>{estimated} publicaciones</strong><small>{dates.length} fechas × {selectedBrands.length} marcas × {selectedChannels.length} redes</small></div><button className="primary" disabled={saving||uploading||estimated===0} onClick={saveBatch}>{saving?'Guardando...':'Crear '+estimated+' publicaciones'}</button></div>
   <p className="hub-calendar-warning">Estas publicaciones se guardan con su fecha y creatividad en Supabase. No saldrán automáticamente a Meta hasta habilitar el acceso de publicación a las páginas y cuentas de Instagram.</p>
  </section>}
  <section className="hub-calendar-view">
   <div className="hub-calendar-month"><button aria-label="Mes anterior" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))}><ChevronLeft size={18}/></button><strong>{month.toLocaleDateString('es-AR',{month:'long',year:'numeric'})}</strong><button aria-label="Mes siguiente" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))}><ChevronRight size={18}/></button><span>{inMonth.length} publicaciones</span><button className="secondary" onClick={refresh} disabled={loading}><RefreshCw size={14}/> Actualizar</button></div>
   <div className="hub-calendar-days">{['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(x=><span key={x}>{x}</span>)}</div>
   <div className="hub-cal-grid">{calendarCells(month).map((d,i)=>{const key=dateKey(d);const dayItems=dateMap.get(key)||[];return <button key={i} className={'hub-cal-cell '+(d.getMonth()!==month.getMonth()?'outside ':'')+(key===today?'today ':'')+(filterDay===key?'chosen':'')} onClick={()=>setFilterDay(old=>old===key?'':key)}><strong>{d.getDate()}</strong>{dayItems.length>0&&<span>{dayItems.length} publicaciones</span>}{dayItems.slice(0,2).map(x=><small key={x.id}>{x.title}</small>)}</button>})}</div>
  </section>
  <section className="hub-calendar-entries">
   <div className="hub-cal-listhead"><h3>{filterDay?'Publicaciones del '+moneyDate(filterDay):'Publicaciones de '+month.toLocaleDateString('es-AR',{month:'long',year:'numeric'})}</h3><span>{(filterDay?visible.filter(x=>x.scheduled_date===filterDay):inMonth).length} resultados</span><button className="secondary" onClick={()=>{const shown=(filterDay?visible.filter(x=>x.scheduled_date===filterDay):inMonth).slice(0,100);setSelectedRows(shown.every(x=>selectedRows.includes(x.id))?[]:shown.map(x=>x.id))}}>{selectedRows.length?'Quitar selección':'Seleccionar visibles'}</button>{selectedRows.length>0&&<button className="primary" disabled={saving} onClick={scheduleSelected}><Clock size={15}/> Programar {selectedRows.length} en Meta</button>}{selectedRows.length>0&&<button className="secondary" onClick={removeSelected}><Trash2 size={15}/> Eliminar {selectedRows.length}</button>}</div>
   {(filterDay?visible.filter(x=>x.scheduled_date===filterDay):inMonth).slice(0,150).map(p=><div key={p.id} className="hub-cal-entry">
     <input aria-label={'Seleccionar '+p.title} type="checkbox" checked={selectedRows.includes(p.id)} onChange={e=>setSelectedRows(v=>e.target.checked?[...v,p.id]:v.filter(x=>x!==p.id))}/>
     {p.media_paths?.length&&mediaUrls[p.media_paths[0]]&&p.format!=='Reel'?<img src={mediaUrls[p.media_paths[0]]} alt="" loading="lazy"/>:<span className="hub-cal-entry-image"><ImageIcon size={19}/></span>}
     <div><strong>{p.title}</strong><small>{moneyDate(p.scheduled_date)} · {(p.scheduled_time||'18:00').slice(0,5)} · {BRAND_NAMES[allBrands.find(b=>b.id===p.brand_id)?.code]||'Marca'} · {(p.channels||[]).join(', ')}</small><small>{p.status==='published'?'Publicado':p.status==='failed'?'Error de publicación':p.status==='scheduled'?'Programado en Meta':p.publication_mode==='pending_authorization'?'Pendiente de autorización Meta':'Borrador'} · {(p.media_paths||[]).length} archivo(s)</small></div>
     <button title="Replicar esta publicación en otras fechas" className="secondary" onClick={()=>clone(p)}><Copy size={16}/> Replicar</button>
   </div>)}
   {!loading&&(filterDay?visible.filter(x=>x.scheduled_date===filterDay):inMonth).length===0&&<p className="hub-calendar-empty">No hay publicaciones en estas fechas. Creá un lote para empezar.</p>}
  </section>
 </div>;
}
