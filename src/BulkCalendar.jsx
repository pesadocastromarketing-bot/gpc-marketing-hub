import React,{useEffect,useMemo,useState} from 'react';
import {CalendarDays,UploadCloud,Plus,Copy,Check,ChevronLeft,ChevronRight,Trash2,Image as ImageIcon,Video,Clock,Layers,RefreshCw} from 'lucide-react';
import {BUSINESS_UNITS} from './businessUnits.js';

const BRAND_NAMES=Object.fromEntries(BUSINESS_UNITS.map(u=>[u.id,u.name]));
const two=x=>String(x).padStart(2,'0');
const dateKey=d=>[d.getFullYear(),two(d.getMonth()+1),two(d.getDate())].join('-');
const dateOffset=(value,n)=>{const d=new Date(value+'T12:00:00');d.setDate(d.getDate()+n);return dateKey(d)};
const today=dateKey(new Date());
const id=()=>crypto.randomUUID();
const calendarCells=month=>{const start=(new Date(month.getFullYear(),month.getMonth(),1).getDay()+6)%7;return Array.from({length:42},(_,i)=>new Date(month.getFullYear(),month.getMonth(),1+i-start))};
const channels=['Instagram','Facebook'];
const assetChannel=a=>a?.kind==='page'?'Facebook':'Instagram';
const destinationName=a=>a?.kind==='instagram_account'?'@'+String(a.name||'').replace(/^@/,''):(a?.name||'Página sin nombre');
const destinationLabel=a=>assetChannel(a)+' · '+destinationName(a)+' (ID '+a.external_id+')';
const isVideoMime=m=>m?.startsWith('video/');
const maxMediaCount=10;
// Each Instagram Story is a separate Media API item, even when the user selects a batch.
// Space jobs one minute apart and preserve their selected order in the calendar.
const storySlot=(date,time,index)=>{
 const original=Date.parse(date+'T'+time.slice(0,5)+':00-03:00');
 const argentinaTime=new Date(original+index*60_000-3*60*60_000).toISOString();
 return {scheduled_date:argentinaTime.slice(0,10),scheduled_time:argentinaTime.slice(11,16)};
};
function moneyDate(s){return new Date(s+'T12:00:00').toLocaleDateString('es-AR',{day:'2-digit',month:'short'})}

export default function BulkCalendar({client,user,organizationId,brandIds,brandFilter,onChangeCount,openSignal=0}){
 const allBrands=BUSINESS_UNITS.filter(u=>brandIds[u.id]).map(u=>({code:u.id,id:brandIds[u.id],name:u.name,type:u.type}));
 const [month,setMonth]=useState(new Date(new Date().getFullYear(),new Date().getMonth(),1));
 const [jobs,setJobs]=useState([]);const [items,setItems]=useState([]),[media,setMedia]=useState([]),[loading,setLoading]=useState(false),[uploading,setUploading]=useState(false),[saving,setSaving]=useState(false),[message,setMessage]=useState('');
 const [showComposer,setShowComposer]=useState(false),[selectedBrands,setSelectedBrands]=useState([]),[selectedChannels,setSelectedChannels]=useState(['Instagram','Facebook']);
 const [dates,setDates]=useState([dateOffset(today,1)]),[manualDate,setManualDate]=useState(dateOffset(today,1)),[time,setTime]=useState('18:00');
 const [title,setTitle]=useState(''),[copy,setCopy]=useState(''),[format,setFormat]=useState('Imagen'),[selectedMedia,setSelectedMedia]=useState([]),[planMode,setPlanMode]=useState('draft'),[filterDay,setFilterDay]=useState('');
 const [selectedRows,setSelectedRows]=useState([]);
 const [socialAssets,setSocialAssets]=useState([]),[exactDestinations,setExactDestinations]=useState([]);
 const [mediaUrls,setMediaUrls]=useState({});
 useEffect(()=>{setSelectedBrands(old=>old.length?old:allBrands.slice(0,1).map(x=>x.code))},[organizationId]);
 useEffect(()=>{if(openSignal>0)setShowComposer(true)},[openSignal]);
 async function refresh(){
  setLoading(true);
  const [a,b,c]=await Promise.all([
   client.from('hub_content').select('id,title,copy_text,format,scheduled_date,scheduled_time,channels,brand_id,target_asset_id,media_paths,batch_id,publication_mode,status').eq('organization_id',organizationId).order('scheduled_date',{ascending:true}).limit(1500),
   client.from('hub_media').select('storage_path,filename,mime_type,size_bytes').eq('organization_id',organizationId).order('created_at',{ascending:false}).limit(100),
   client.from('hub_publication_jobs').select('id,content_id,status,error_message,external_post_id,scheduled_for').eq('organization_id',organizationId).order('created_at',{ascending:false}).limit(1000)
  ]);
  if(a.error)setMessage('No se pudo cargar el calendario: '+a.error.message);
  else {setItems(a.data||[]);onChangeCount?.((a.data||[]).length)}
  if(b.error)setMessage('No se pudo cargar la biblioteca: '+b.error.message);
  else setMedia(b.data||[]);
  if(!c.error)setJobs(c.data||[]);
  setLoading(false);
 }
 useEffect(()=>{refresh();let active=true;(async()=>{try{const {data:{session}}=await client.auth.getSession();const r=await fetch('/api/meta/assets-fast?view=social',{headers:{Authorization:'Bearer '+session?.access_token}});const j=await r.json();if(active&&r.ok)setSocialAssets((j.assets||[]).filter(a=>a.brand_id&&['page','instagram_account'].includes(a.kind)));}catch(_){}})();return()=>{active=false}},[organizationId]);
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
 // Instagram accepts JPEG Story images. Preserve uploaded originals and convert PNG/WebP copies when needed.
 async function prepareStoryImage(file){
  const {data:original,error:downloadError}=await client.storage.from('hub-creatives').download(file.storage_path);
  if(downloadError||!original)throw Error('No se pudo preparar la imagen de historia: '+(downloadError?.message||'archivo no disponible'));
  const bitmap=await createImageBitmap(original);
  const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
  const ctx=canvas.getContext('2d');
  if(!ctx){bitmap.close?.();throw Error('Tu navegador no pudo convertir la imagen a JPG');}
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(bitmap,0,0);bitmap.close?.();
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('No se pudo convertir la imagen')), 'image/jpeg',0.94));
  const storagePath=organizationId+'/'+user.id+'/'+id()+'.jpg';
  const {error:uploadError}=await client.storage.from('hub-creatives').upload(storagePath,blob,{contentType:'image/jpeg',upsert:false});
  if(uploadError)throw Error('No se pudo guardar la imagen JPG: '+uploadError.message);
  const filename=(file.filename||'historia').replace(/\.[^.]+$/,'')+'.jpg';
  const {error:dbError}=await client.from('hub_media').insert({organization_id:organizationId,uploaded_by:user.id,storage_path:storagePath,filename,mime_type:'image/jpeg',size_bytes:blob.size});
  if(dbError){await client.storage.from('hub-creatives').remove([storagePath]);throw Error('No se pudo registrar la imagen: '+dbError.message)}
  return storagePath;
 }
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
 // Never infer the publishing account from a dealership alone: Instagram can have parallel profiles.
 const selectedBrandIds=new Set(selectedBrands.map(code=>brandIds[code]).filter(Boolean));
 const selectedTargets=socialAssets.filter(a=>exactDestinations.includes(a.id)&&selectedBrandIds.has(a.brand_id)&&selectedChannels.includes(assetChannel(a)));
 const destinationCount=selectedTargets.length;
 const estimated=dates.length*destinationCount*(format==='Historia'?selectedMedia.length:1);
 function moveStory(path,direction){
  setSelectedMedia(old=>{
   const index=old.indexOf(path),next=index+direction;
   if(index<0||next<0||next>=old.length)return old;
   const reordered=[...old];[reordered[index],reordered[next]]=[reordered[next],reordered[index]];
   return reordered;
  });
 }
 function toggleBrand(code,checked){
  setSelectedBrands(old=>checked?[...new Set([...old,code])]:old.filter(x=>x!==code));
  if(!checked)setExactDestinations(old=>old.filter(assetId=>socialAssets.find(a=>a.id===assetId)?.brand_id!==brandIds[code]));
 }
 function toggleChannel(channel,checked){
  setSelectedChannels(old=>checked?[...new Set([...old,channel])]:old.filter(x=>x!==channel));
  if(!checked)setExactDestinations(old=>old.filter(assetId=>assetChannel(socialAssets.find(a=>a.id===assetId))!==channel));
 }
 async function saveBatch(){
  if(!title.trim()||!dates.length||!selectedBrands.length||!selectedChannels.length||!selectedMedia.length){
   setMessage('Completá título, creatividad, fechas, concesionarios y redes sociales.');return;
  }
  if(!selectedTargets.length){
   setMessage('Elegí al menos una cuenta real de Instagram o una página de Facebook. Si no aparece, vinculala desde Configuración → Meta.');return;
  }
  if(estimated>200){setMessage('Máximo 200 publicaciones por lote. Dividí la planificación.');return}
  if(format==='Historia'&&selectedTargets.some(a=>a.kind!=='instagram_account')){setMessage('Las historias automáticas son solo para Instagram. Desmarcá las páginas de Facebook.');return}
  const files=selectedMedia.map(p=>media.find(m=>m.storage_path===p)).filter(Boolean);
  if(files.length!==selectedMedia.length){setMessage('No se encontraron todos los archivos seleccionados. Actualizá la biblioteca antes de crear el lote.');return}
  if(format==='Carrusel'&&(files.length<2||files.some(m=>isVideoMime(m.mime_type)))){
   setMessage('Para carrusel elegí de 2 a 10 imágenes.');return
  }
  if(format==='Reel'&&(files.length!==1||!isVideoMime(files[0]?.mime_type))){
   setMessage('Para Reel cargá un único video MP4/MOV.');return
  }
  if(format==='Historia'&&files.some(m=>!['image/jpeg','image/png','image/webp','video/mp4','video/quicktime'].includes(m.mime_type))){
   setMessage('Las historias admiten hasta 10 archivos JPG, PNG, WebP, MP4 o MOV por lote.');return
  }
  if(format==='Imagen'&&files.some(m=>isVideoMime(m.mime_type))){
   setMessage('El formato Imagen requiere imágenes; elegí Reel o Historia para video.');return
  }
  if(dates.some(d=>d<today)){setMessage('No se pueden planificar publicaciones en fechas pasadas.');return}
  const preciseTargets=selectedTargets.map(a=>'• '+(allBrands.find(b=>b.id===a.brand_id)?.name||'Unidad sin nombre')+' — '+destinationLabel(a)).join('\n');
  if(!window.confirm('¿Crear '+estimated+(format==='Historia'?' historias':' publicaciones')+' en '+dates.length+' fecha(s)?\n\nSE PUBLICARÁ EN ESTAS CUENTAS EXACTAS:\n'+preciseTargets+'\n\n'+(format==='Historia'?'Cada archivo será una historia independiente, programada con un minuto de separación en el orden seleccionado.\n\n':'')+(planMode==='pending_authorization'?'El HUB intentará programar AUTOMÁTICAMENTE solo estas cuentas autorizadas. Las que no tengan permisos quedarán pendientes.':'Quedarán como borradores y NO se publicarán.')))return;
  setSaving(true);setMessage('');
  const batchId=id();
  const targets=selectedTargets.map(a=>({brand_id:a.brand_id,channel:assetChannel(a),target_asset_id:a.id}));
  try{
   let preparedMedia=selectedMedia;
   if(format==='Historia'){
    preparedMedia=[];
    for(let i=0;i<files.length;i++){
     const file=files[i];
     if(['image/png','image/webp'].includes(file.mime_type)){
      setMessage('Preparando historia '+(i+1)+' de '+files.length+'...');
      preparedMedia.push(await prepareStoryImage(file));
     }else preparedMedia.push(file.storage_path);
    }
   }
   const rows=dates.flatMap(date=>targets.flatMap(target=>{
    const paths=format==='Historia'?preparedMedia:[preparedMedia];
    return paths.map((path,index)=>{
     const slot=format==='Historia'?storySlot(date,time,index):{scheduled_date:date,scheduled_time:time};
     return {
      organization_id:organizationId,brand_id:target.brand_id,target_asset_id:target.target_asset_id,
      title:format==='Historia'?title.trim()+' · Historia '+(index+1)+'/'+preparedMedia.length:title.trim(),
      copy_text:copy.trim(),format,...slot,channels:[target.channel],
      media_paths:format==='Historia'?[path]:path,
      created_by:user.id,status:'draft',publication_mode:planMode,timezone:'America/Argentina/Buenos_Aires',batch_id:batchId
     };
    });
   }));
   const {data:created,error}=await client.from('hub_content').insert(rows).select('id');
   if(error)throw Error(error.message);
   let summary='Se crearon '+rows.length+' publicaciones en Supabase.';
   if(planMode==='pending_authorization'&&created?.length){
    const {data:{session}}=await client.auth.getSession();
    const groups=[];for(let i=0;i<created.length;i+=100)groups.push(created.slice(i,i+100).map(x=>x.id));
    let success=0,failed=0,details=[];
    for(const ids of groups){
     const response=await fetch('/api/social/schedule',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session?.access_token},body:JSON.stringify({ids,confirmation:'PROGRAMAR'})});
     const result=await response.json();
     if(!response.ok){failed+=ids.length;details.push(result.error||'Meta no autorizó la programación');continue}
     success+=result.scheduled||0;failed+=(result.total||ids.length)-(result.scheduled||0);
     details.push(...(result.results||[]).filter(x=>x.status==='error').slice(0,3).map(x=>x.message));
    }
    summary+=' Programadas automáticamente: '+success+'. Pendientes: '+failed+'.'+(details.length?' '+[...new Set(details)].slice(0,3).join(' | '):'');
   }
   setMessage(summary);setShowComposer(false);setDates([dateOffset(today,1)]);setSelectedMedia([]);setExactDestinations([]);setTitle('');setCopy('');
   await refresh();
  }catch(e){setMessage('No se pudo guardar el lote: '+e.message)}
  finally{setSaving(false)}
 }
 async function scheduleSelected(){
  if(!selectedRows.length)return;
  if(selectedRows.length>100){setMessage('Máximo 100 publicaciones para programar en un lote.');return}
  const rowsToSchedule=items.filter(p=>selectedRows.includes(p.id));
  const resolved=rowsToSchedule.map(p=>{
   const accounts=socialAssets.filter(a=>a.brand_id===p.brand_id&&assetChannel(a)===p.channels?.[0]);
   const target=p.target_asset_id?accounts.find(a=>a.id===p.target_asset_id):(accounts.length===1?accounts[0]:null);
   return {post:p,target};
  });
  const unresolved=resolved.filter(x=>!x.target);
  if(unresolved.length){
   setMessage('No se programó nada: '+unresolved.length+' publicación(es) no tienen un destino único y verificable. Replicalas y seleccioná la cuenta exacta de Instagram o Facebook.');return;
  }
  const destinations=[...new Set(resolved.map(x=>(allBrands.find(b=>b.id===x.post.brand_id)?.name||'Unidad')+' — '+destinationLabel(x.target)))];
  if(!window.confirm('ATENCIÓN: Vas a programar '+selectedRows.length+' publicación(es) en Meta.\n\nDESTINOS EXACTOS:\n'+destinations.map(x=>'• '+x).join('\n')+'\n\n¿Confirmás?'))return;
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
  setSelectedBrands([allBrands.find(b=>b.id===item.brand_id)?.code].filter(Boolean));setExactDestinations(item.target_asset_id?[item.target_asset_id]:[]);
  setSelectedChannels(item.channels||['Instagram']);setSelectedMedia(item.media_paths||[]);
  setPlanMode(item.publication_mode||'draft');setShowComposer(true);
  setMessage('Creatividad y copy precargados. Elegí nuevas fechas y marcas para replicar.');
 }
 return <div className="hub-calendar">
  <section className="hub-calendar-top">
   <div><h3>Calendario editorial multicuenta</h3><p>Una creatividad para cualquiera de los 6 concesionarios y 2 unidades de usados, en varias fechas y redes.</p></div>
   <button className="primary" onClick={()=>setShowComposer(v=>!v)}><Plus size={16}/> {showComposer?'Cerrar editor':'Crear lote de publicaciones'}</button>
  </section>
  {message&&<p className="hub-cal-notice" role="status">{message}</p>}
  {showComposer&&<section className="hub-composer">
   <div className="hub-composer-heading"><h3>1. Subí la creatividad una sola vez</h3><span>Biblioteca privada de Supabase</span></div>
   <label className="hub-upload"><UploadCloud size={23}/><strong>{uploading?'Subiendo archivos...':'Elegir imágenes o videos'}</strong><span>JPG, PNG, WebP, MP4 o MOV · hasta 50 MB cada uno · 10 archivos</span><input disabled={uploading||saving} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" multiple onChange={e=>{uploadFiles(e.target.files);e.target.value=''}}/></label>
   {media.length>0&&<div className="hub-media-library"><strong>Archivos recientes (tocá para usar)</strong><div className="hub-media-grid">{media.slice(0,30).map(file=><button className={selectedMedia.includes(file.storage_path)?'selected':''} key={file.storage_path} onClick={()=>setSelectedMedia(current=>current.includes(file.storage_path)?current.filter(p=>p!==file.storage_path):current.length<10?[...current,file.storage_path]:current)}>
    {isVideoMime(file.mime_type)?<Video size={25}/>:mediaUrls[file.storage_path]?<img src={mediaUrls[file.storage_path]} alt={file.filename}/>:<ImageIcon size={23}/>}
    <small title={file.filename}>{file.filename}</small>{selectedMedia.includes(file.storage_path)&&<Check size={17} className="hub-media-check"/>}</button>)}</div></div>}
   <div className="hub-composer-two"><label>Título interno<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Ej. Amarok tasa 0%"/></label><label>Formato<select value={format} onChange={e=>{const next=e.target.value;setFormat(next);if(next==='Historia'){setSelectedChannels(['Instagram']);setExactDestinations(old=>old.filter(assetId=>assetChannel(socialAssets.find(a=>a.id===assetId))==='Instagram'))}}}><option>Imagen</option><option>Carrusel</option><option>Reel</option><option>Historia</option></select></label></div>
   {format==='Historia'&&<p className="hub-calendar-warning">Historias de Instagram: seleccioná hasta 10 fotos o videos juntos (JPG, PNG, WebP, MP4 o MOV). Se creará una historia independiente por archivo, en el orden indicado abajo, con un minuto de diferencia entre publicaciones. Los PNG/WebP se convierten a JPG. El copy no se superpone a la historia: incluilo en el diseño.</p>}
   {format==='Historia'&&selectedMedia.length>0&&<div className="hub-story-order"><strong>Orden de las historias ({selectedMedia.length})</strong><ol>{selectedMedia.map((path,index)=>{
    const file=media.find(m=>m.storage_path===path);
    return <li key={path}><span>{index+1}. {file?.filename||'Archivo seleccionado'}</span><div><button type="button" className="secondary" disabled={index===0||saving} aria-label={'Subir historia '+(index+1)} onClick={()=>moveStory(path,-1)}>↑</button><button type="button" className="secondary" disabled={index===selectedMedia.length-1||saving} aria-label={'Bajar historia '+(index+1)} onClick={()=>moveStory(path,1)}>↓</button><button type="button" className="secondary" disabled={saving} aria-label={'Quitar historia '+(index+1)} onClick={()=>setSelectedMedia(current=>current.filter(p=>p!==path))}>×</button></div></li>;
   })}</ol></div>
   <label className="hub-wide-label">Copy de la publicación<textarea rows="3" placeholder="Texto que se reutilizará en todas las fechas y cuentas..." value={copy} onChange={e=>setCopy(e.target.value)}/></label>
   <div className="hub-composer-heading"><h3>2. Elegí los concesionarios y cada cuenta exacta</h3><span>Oficiales y paralelas, siempre por separado</span></div>
   <div className="hub-business-units">
    {[{type:'dealership',label:'Concesionarios (6)'},{type:'used',label:'Usados (2)'}].map(group=><div key={group.type}>
     <strong>{group.label}</strong>
     <div className="hub-check-list">{allBrands.filter(b=>b.type===group.type).map(b=><label key={b.id}><input type="checkbox" checked={selectedBrands.includes(b.code)} onChange={e=>toggleBrand(b.code,e.target.checked)}/>{b.name}</label>)}</div>
    </div>)}
   </div>
   <div className="hub-check-list">{channels.map(channel=><label key={channel}><input type="checkbox" checked={selectedChannels.includes(channel)} onChange={e=>toggleChannel(channel,e.target.checked)}/>{channel}</label>)}</div>
   <div className="hub-destination-picker">
    <strong>¿En qué cuentas EXACTAS se va a publicar?</strong>
    <p>Marcá cada @usuario de Instagram o página de Facebook. Las cuentas oficiales y las paralelas nunca se seleccionan automáticamente; elegí solamente las que querés usar.</p>
    {selectedBrands.length===0||selectedChannels.length===0?<p className="hub-destination-empty">Elegí primero un concesionario y al menos una red social.</p>:
    <div className="hub-destination-groups">
     {allBrands.filter(b=>selectedBrands.includes(b.code)).map(b=><div className="hub-destination-unit" key={b.id}>
      <h4>{b.name}</h4>
      {selectedChannels.map(channel=>{
       const options=socialAssets.filter(a=>a.brand_id===b.id&&assetChannel(a)===channel).sort((a,z)=>String(a.name).localeCompare(String(z.name)));
       return <div className="hub-destination-network" key={channel}>
        <strong>{channel} <span>{options.length} cuenta(s) vinculada(s)</span></strong>
        {options.length?<div className="hub-destination-options">{options.map(a=><label key={a.id} className={'hub-destination-option '+(exactDestinations.includes(a.id)?'selected':'')}>
         <input type="checkbox" checked={exactDestinations.includes(a.id)} onChange={e=>setExactDestinations(old=>e.target.checked?[...new Set([...old,a.id])]:old.filter(id=>id!==a.id))}/>
         <span><b>{destinationName(a)}</b><small>{channel==='Facebook'?'Página de Facebook':'Cuenta profesional de Instagram'} · ID {a.external_id}</small>
          {channel==='Facebook'&&!a.is_ready&&<small className="hub-destination-permission">Sin permiso CREATE_CONTENT; se podrá guardar como borrador, pero no programar aún.</small>}
         </span>
        </label>)}</div>:
        <p className="hub-destination-empty">No hay una cuenta de {channel} vinculada a {b.name}. Revisá Configuración → Meta para asignarla.</p>}
       </div>
      })}
     </div>)}
    </div>}
    <small className="hub-destination-note">El HUB guardará el ID exacto de Meta de cada destino, no solo el nombre del concesionario.</small>
   </div>
   <div className="hub-composer-heading"><h3>3. Elegí todas las fechas</h3><span>Hora de Argentina (UTC−3)</span></div>
   <div className="hub-date-controls"><input type="date" min={today} value={manualDate} onChange={e=>setManualDate(e.target.value)}/><button className="secondary" onClick={()=>addDate(manualDate)}>Agregar fecha</button><input type="time" value={time} onChange={e=>setTime(e.target.value)}/></div>
   <div className="hub-shortcuts"><button onClick={()=>addDate(today)}>Hoy</button><button onClick={()=>addDate(dateOffset(today,1))}>Mañana</button><button onClick={()=>addDate(dateOffset(today,7))}>+7 días</button><button onClick={()=>addDate(dateOffset(today,14))}>+14 días</button><button onClick={()=>repeat(7)}>4 semanas seguidas</button><button onClick={()=>repeat(30)}>4 meses seguidos</button></div>
   <div className="hub-date-pills">{dates.map(d=><button key={d} onClick={()=>removeDate(d)}>{moneyDate(d)} <span>×</span></button>)}</div>
   <div className="hub-composer-heading"><h3>4. Guardá todas las publicaciones</h3></div>
   <div className="hub-check-list"><label><input type="radio" checked={planMode==='draft'} onChange={()=>setPlanMode('draft')}/>Guardar como borrador (NO publica)</label><label><input type="radio" checked={planMode==='pending_authorization'} onChange={()=>setPlanMode('pending_authorization')}/>Crear y programar automáticamente donde Meta lo permita</label></div>
   <div className="hub-destination-review"><strong>Se va a publicar en:</strong>
    {selectedTargets.length?<ul>{selectedTargets.map(a=><li key={a.id}><strong>{allBrands.find(b=>b.id===a.brand_id)?.name||'Unidad'}</strong> · {destinationLabel(a)}</li>)}</ul>:<p>Seleccioná la cuenta exacta arriba para continuar. No se elegirá ningún perfil por defecto.</p>}
   </div>
   <div className="hub-submit"><div><strong>{estimated} {format==='Historia'?'historias':'publicaciones'}</strong><small>{dates.length} fechas × {destinationCount} cuenta(s) exacta(s){format==='Historia'?' × '+selectedMedia.length+' archivo(s)':''}</small></div><button className="primary" disabled={saving||uploading||estimated===0} onClick={saveBatch}>{saving?'Guardando...':(planMode==='pending_authorization'?'Crear y programar ':'Guardar ')+estimated+(planMode==='pending_authorization'?' publicación(es)':' borrador(es)')}</button></div>
   {message&&<p className="hub-cal-notice" role="alert" aria-live="assertive">{message}</p>}
   <p className="hub-calendar-warning">No se publicará en otros perfiles del concesionario: solo en los destinos exactos que seleccionaste arriba. «Crear y programar» requiere permisos de Meta; si faltan, las publicaciones quedarán sin programar. «Borradores» no publica nada.</p>
  </section>}
  <section className="hub-calendar-view">
   <div className="hub-calendar-month"><button aria-label="Mes anterior" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))}><ChevronLeft size={18}/></button><strong>{month.toLocaleDateString('es-AR',{month:'long',year:'numeric'})}</strong><button aria-label="Mes siguiente" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))}><ChevronRight size={18}/></button><span>{inMonth.length} publicaciones</span><button className="secondary" onClick={refresh} disabled={loading}><RefreshCw size={14}/> Actualizar</button></div>
   <div className="hub-calendar-days">{['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(x=><span key={x}>{x}</span>)}</div>
   <div className="hub-cal-grid">{calendarCells(month).map((d,i)=>{const key=dateKey(d);const dayItems=dateMap.get(key)||[];return <button key={i} className={'hub-cal-cell '+(d.getMonth()!==month.getMonth()?'outside ':'')+(key===today?'today ':'')+(filterDay===key?'chosen':'')} onClick={()=>setFilterDay(old=>old===key?'':key)}><strong>{d.getDate()}</strong>{dayItems.length>0&&<span data-count={dayItems.length} aria-label={dayItems.length+' publicaciones'}>{dayItems.length} publicaciones</span>}{dayItems.slice(0,2).map(x=><small key={x.id}>{x.title}</small>)}</button>})}</div>
  </section>
  <section className="hub-calendar-entries">
   <div className="hub-cal-listhead"><h3>{filterDay?'Publicaciones del '+moneyDate(filterDay):'Publicaciones de '+month.toLocaleDateString('es-AR',{month:'long',year:'numeric'})}</h3><span>{(filterDay?visible.filter(x=>x.scheduled_date===filterDay):inMonth).length} resultados</span><button className="secondary" onClick={()=>{const shown=(filterDay?visible.filter(x=>x.scheduled_date===filterDay):inMonth).filter(x=>x.status==='draft'&&!jobs.some(j=>j.content_id===x.id)).slice(0,100);setSelectedRows(shown.length&&shown.every(x=>selectedRows.includes(x.id))?[]:shown.map(x=>x.id))}}>{selectedRows.length?'Quitar selección':'Seleccionar visibles'}</button>{selectedRows.length>0&&<button className="primary" disabled={saving} onClick={scheduleSelected}><Clock size={15}/> Programar {selectedRows.length} en Meta</button>}{selectedRows.length>0&&<button className="secondary" onClick={removeSelected}><Trash2 size={15}/> Eliminar {selectedRows.length}</button>}</div>
   {(filterDay?visible.filter(x=>x.scheduled_date===filterDay):inMonth).slice(0,150).map(p=><div key={p.id} className="hub-cal-entry">
     <input aria-label={'Seleccionar '+p.title} type="checkbox" disabled={p.status!=='draft'||jobs.some(j=>j.content_id===p.id)} checked={selectedRows.includes(p.id)} onChange={e=>setSelectedRows(v=>e.target.checked?[...v,p.id]:v.filter(x=>x!==p.id))}/>
     {p.media_paths?.length&&mediaUrls[p.media_paths[0]]&&p.format!=='Reel'?<img src={mediaUrls[p.media_paths[0]]} alt="" loading="lazy"/>:<span className="hub-cal-entry-image"><ImageIcon size={19}/></span>}
     <div><strong>{p.title}</strong><small>{moneyDate(p.scheduled_date)} · {(p.scheduled_time||'18:00').slice(0,5)} · {BRAND_NAMES[allBrands.find(b=>b.id===p.brand_id)?.code]||'Marca'} · {socialAssets.find(a=>a.id===p.target_asset_id)?destinationLabel(socialAssets.find(a=>a.id===p.target_asset_id)):(p.target_asset_id?'Destino no disponible — revisá Meta':'Destino exacto sin definir')}</small><small>{(jobs.find(j=>j.content_id===p.id)?.status==='published'||p.status==='published')?'Publicado':(jobs.find(j=>j.content_id===p.id)?.status==='failed'||p.status==='failed')?'Error de publicación':jobs.find(j=>j.content_id===p.id)?.status==='publishing'?'En proceso en Meta':(jobs.find(j=>j.content_id===p.id)?.status==='queued'||p.status==='scheduled')?'Programado en Meta':p.publication_mode==='pending_authorization'?'Pendiente de autorización Meta':'Borrador'} · {(p.media_paths||[]).length} archivo(s)</small>{jobs.find(j=>j.content_id===p.id)?.error_message&&<small style={{color:'#c13245'}}>Error: {jobs.find(j=>j.content_id===p.id)?.error_message}</small>}</div>
     <button title="Replicar esta publicación en otras fechas" className="secondary" onClick={()=>clone(p)}><Copy size={16}/> Replicar</button>
   </div>)}
   {!loading&&(filterDay?visible.filter(x=>x.scheduled_date===filterDay):inMonth).length===0&&<p className="hub-calendar-empty">No hay publicaciones en estas fechas. Creá un lote para empezar.</p>}
  </section>
 </div>;
}
