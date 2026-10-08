import React,{useEffect,useState} from 'react';
import {ArrowLeft,ChevronRight,Image as ImageIcon,Film,Layers,RefreshCw,ExternalLink} from 'lucide-react';
import './style.css';
import CreativePreview from './CreativePreview.jsx';

const labelStatus=(v)=>({
  ACTIVE:'Activa',PAUSED:'Pausada',CAMPAIGN_PAUSED:'Pausada por campaña',
  ADSET_PAUSED:'Pausada por conjunto',ARCHIVED:'Archivada',DELETED:'Eliminada',
  IN_PROCESS:'En proceso',WITH_ISSUES:'Con problemas',PENDING_REVIEW:'En revisión',
  DISAPPROVED:'Rechazada',PREAPPROVED:'Preaprobada'
}[v]||v||'Sin estado');
const isActive=(v)=>(v.effective_status||v.status)==='ACTIVE';
const secureLink=(value)=>typeof value==='string'&&/^https:\/\//i.test(value)?value:null;

export default function MetaHierarchy({client,accountId,campaign,onBack}){
  const[adsets,setAdsets]=useState([]);
  const[ads,setAds]=useState([]);
  const[adset,setAdset]=useState(null);
  const[ad,setAd]=useState(null);
  const[creative,setCreative]=useState(null);
  const[loading,setLoading]=useState('');
  const[error,setError]=useState('');
  const[warning,setWarning]=useState('');
  const[showInactiveSets,setShowInactiveSets]=useState(false);
  const[showInactiveAds,setShowInactiveAds]=useState(false);

  async function query(level,options={}){
    const {data:{session}}=await client.auth.getSession();
    if(!session?.access_token)throw Error('La sesión expiró. Volvé a iniciar sesión.');
    const params=new URLSearchParams({level,account_id:accountId,campaign_id:campaign.id,...options});
    const response=await fetch('/api/meta/hierarchy?'+params.toString(),{
      headers:{Authorization:'Bearer '+session.access_token}
    });
    const json=await response.json();
    if(!response.ok)throw Error(json.error||'Error al consultar Meta');
    return json;
  }

  useEffect(()=>{
    let mounted=true;
    setAdsets([]);setAdset(null);setAd(null);setCreative(null);
    setError('');setWarning('');setShowInactiveSets(false);setLoading('adsets');
    query('adsets').then(result=>{
      if(!mounted)return;
      setAdsets(result.adsets||[]);
      if(result.truncated)setWarning('Se muestran como máximo 500 conjuntos por campaña.');
    }).catch(e=>{if(mounted)setError(e.message)}).finally(()=>{if(mounted)setLoading('')});
    return()=>{mounted=false};
  },[accountId,campaign.id]);

  async function openAdset(item){
    setAdset(item);setAd(null);setCreative(null);setAds([]);
    setShowInactiveAds(false);setError('');setWarning('');setLoading('ads');
    try{
      const result=await query('ads',{adset_id:item.id});
      setAds(result.ads||[]);
      if(result.truncated)setWarning('Se muestran como máximo 500 anuncios de este conjunto.');
    }catch(e){setError(e.message)}
    finally{setLoading('')}
  }
  async function openAd(item){
    setAd(item);setCreative(null);setError('');setWarning('');setLoading('creative');
    try{
      const result=await query('creative',{adset_id:adset.id,ad_id:item.id});
      setCreative(result.creative||null);
      if(result.partial)setWarning('Meta permitió consultar una vista parcial de esta creatividad.');
      if(result.message)setWarning(result.message);
    }catch(e){setError(e.message)}
    finally{setLoading('')}
  }
  function back(){
    setError('');setWarning('');
    if(ad){setAd(null);setCreative(null);return}
    if(adset){setAdset(null);setAds([]);return}
    onBack();
  }
  const visibleSets=showInactiveSets?adsets:adsets.filter(isActive);
  const visibleAds=showInactiveAds?ads:ads.filter(isActive);
  const inactiveSets=adsets.length-adsets.filter(isActive).length;
  const inactiveAds=ads.length-ads.filter(isActive).length;
  const statusPill=item=><span className={'mh-status '+(isActive(item)?'mh-active':'mh-inactive')}>{labelStatus(item.effective_status||item.status)}</span>;

  return <section className="panel mh-panel">
    <div className="mh-head">
      <button className="mh-back" onClick={back}><ArrowLeft size={16}/> {ad?'Volver a anuncios':adset?'Volver a conjuntos':'Volver a campañas'}</button>
      <span className="mh-readonly">Solo lectura · Meta Ads</span>
    </div>
    <div className="mh-breadcrumbs">
      <span>{campaign.name}</span><ChevronRight size={15}/>
      {adset?<><button onClick={()=>{setAdset(null);setAd(null);setCreative(null);setError('');setWarning('')}}>Conjuntos</button><ChevronRight size={15}/><span>{adset.name}</span></>:<strong>Conjuntos de anuncios</strong>}
      {ad&&<><ChevronRight size={15}/><strong>{ad.name}</strong></>}
    </div>

    {loading&&<div className="mh-message"><RefreshCw size={16} className="mh-spin"/> Consultando {loading==='adsets'?'conjuntos':loading==='ads'?'anuncios':'creatividad'} en Meta...</div>}
    {error&&<div className="mh-error" role="alert">{error}</div>}
    {warning&&<div className="mh-note">{warning}</div>}

    {!adset&&<div className="mh-content">
      <div className="mh-section-title"><div><h3>Conjuntos de anuncios</h3><p>Campaña: {campaign.name}</p></div><span>{adsets.filter(isActive).length} activos · {inactiveSets} inactivos</span></div>
      {inactiveSets>0&&<button className="secondary" onClick={()=>setShowInactiveSets(x=>!x)}>{showInactiveSets?'Ocultar conjuntos inactivos':'Mostrar conjuntos inactivos ('+inactiveSets+')'}</button>}
      {!loading&&!error&&adsets.length===0&&<p className="mh-empty">Esta campaña no tiene conjuntos disponibles.</p>}
      {!loading&&!error&&adsets.length>0&&visibleSets.length===0&&<p className="mh-empty">No hay conjuntos activos. Podés mostrar los inactivos.</p>}
      <div className="mh-list">{visibleSets.map(item=><div className="mh-item" key={item.id}><div className="mh-item-info"><strong>{item.name}</strong><div className="mh-meta">{statusPill(item)}<span>{item.optimization_goal||'Sin objetivo de optimización'}</span><span>ID {item.id}</span></div></div><button className="secondary" onClick={()=>openAdset(item)}>Ver anuncios <ChevronRight size={15}/></button></div>)}</div>
    </div>}

    {adset&&!ad&&<div className="mh-content">
      <div className="mh-section-title"><div><h3>Anuncios</h3><p>Conjunto: {adset.name}</p></div><span>{ads.filter(isActive).length} activos · {inactiveAds} inactivos</span></div>
      {inactiveAds>0&&<button className="secondary" onClick={()=>setShowInactiveAds(x=>!x)}>{showInactiveAds?'Ocultar anuncios inactivos':'Mostrar anuncios inactivos ('+inactiveAds+')'}</button>}
      {!loading&&!error&&ads.length===0&&<p className="mh-empty">Este conjunto no tiene anuncios disponibles.</p>}
      {!loading&&!error&&ads.length>0&&visibleAds.length===0&&<p className="mh-empty">No hay anuncios activos. Podés mostrar los inactivos.</p>}
      <div className="mh-list">{visibleAds.map(item=><div className="mh-item" key={item.id}>
        <div className="mh-thumb">{item.thumbnail_url?<img src={item.thumbnail_url} alt={'Creatividad de '+item.name} loading="lazy"/>:<ImageIcon size={20}/>}</div>
        <div className="mh-item-info"><strong>{item.name}</strong><div className="mh-meta">{statusPill(item)}<span>{item.creative_name||'Creatividad sin nombre'}</span><span>ID {item.id}</span></div></div>
        <button className="secondary" onClick={()=>openAd(item)}>Ver creatividad <ChevronRight size={15}/></button>
      </div>)}</div>
    </div>}

    {ad&&<div className="mh-content">
      <div className="mh-section-title"><div><h3>Creatividad del anuncio</h3><p>{ad.name}</p></div>{statusPill(ad)}</div>
      {!loading&&!error&&!creative&&<p className="mh-empty">No hay una creatividad disponible para este anuncio.</p>}
      {creative&&<div className="mh-creative">
        <CreativePreview creative={creative}/>
        <div className="mh-details">
          <div className="mh-detail"><span>Título</span><strong>{creative.title||'No informado'}</strong></div>
          <div className="mh-detail"><span>Texto del anuncio</span><p>{creative.body||'Meta no proporcionó texto para esta creatividad.'}</p></div>
          {creative.description&&<div className="mh-detail"><span>Descripción</span><p>{creative.description}</p></div>}
          {creative.cta&&<div className="mh-detail"><span>Llamado a la acción</span><strong>{creative.cta}</strong></div>}
          {secureLink(creative.destination)&&<div className="mh-detail"><span>URL de destino</span><a href={secureLink(creative.destination)} target="_blank" rel="noopener noreferrer">Abrir destino <ExternalLink size={13}/></a></div>}
          <div className="mh-detail"><span>ID de la creatividad</span><code>{creative.id||'No informado'}</code></div><div className="mh-detail"><a href={'https://adsmanager.facebook.com/adsmanager/manage/ads?act='+encodeURIComponent(accountId)+'&selected_ad_ids='+encodeURIComponent(ad.id)} target="_blank" rel="noopener noreferrer">Abrir este anuncio en Meta Ads Manager <ExternalLink size={13}/></a></div>
          {creative.cards?.length>0&&<div className="mh-detail"><span>{creative.format==='Carrusel'?'Tarjetas del carrusel':'Activos de la creatividad'} ({creative.cards.length})</span><div className="mh-cards">{creative.cards.map((card,i)=><div key={i}>{card.picture&&<img src={card.picture} alt={'Tarjeta '+(i+1)}/>}<strong>{card.name||'Tarjeta '+(i+1)}</strong><small>{card.description}</small></div>)}</div></div>}
        </div>
      </div>}
      <p className="mh-disclaimer">Vista de activos y textos recuperados de Meta. Algunas variantes automáticas, ubicaciones o vistas previas exactas pueden diferir.</p>
    </div>}
  </section>;
}
