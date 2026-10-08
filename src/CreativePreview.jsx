import React,{useEffect,useState} from 'react';
import {ChevronLeft,ChevronRight,Film,Images,Image as ImageIcon,ExternalLink} from 'lucide-react';

const link=v=>typeof v==='string'&&/^https:\/\//i.test(v)?v:null;
export default function CreativePreview({creative}){
 const [index,setIndex]=useState(0);
 const cards=creative.cards||[];
 const isCarousel=creative.format==='Carrusel'&&cards.length>1;
 useEffect(()=>setIndex(0),[creative.id]);
 function picture(src,alt){return link(src)?<img className="mh-preview-photo" src={src} alt={alt} loading="lazy"/>:<div className="mh-placeholder"><ImageIcon size={28}/><span>Meta no entregó la imagen de esta tarjeta.</span></div>}
 function player(source,poster){
  return link(source)?<video className="mh-preview-video" src={source} poster={link(poster)||undefined} controls playsInline preload="metadata"/>:
    <div className="mh-no-video">{picture(poster,'Miniatura del video')}<span className="mh-play-unavailable"><Film size={16}/> Video sin enlace de reproducción disponible</span></div>
 }
 return <div className="mh-media">
  <div className="mh-media-title">{creative.format==='Video'?<Film size={18}/>:<Images size={18}/>} {creative.format} · {creative.name}</div>
  {isCarousel?<>
    <div className="mh-carousel">
      <div className="mh-carousel-frame">
        {cards[index].video_id?player(cards[index].video_url,cards[index].picture):picture(cards[index].picture,'Tarjeta '+(index+1)+' del carrusel')}
      </div>
      <div className="mh-carousel-controls">
        <button onClick={()=>setIndex(i=>(i-1+cards.length)%cards.length)} aria-label="Tarjeta anterior"><ChevronLeft size={20}/></button>
        <strong>{index+1} / {cards.length}</strong>
        <button onClick={()=>setIndex(i=>(i+1)%cards.length)} aria-label="Tarjeta siguiente"><ChevronRight size={20}/></button>
      </div>
      <div className="mh-carousel-caption"><strong>{cards[index].name||'Tarjeta '+(index+1)}</strong><p>{cards[index].description||''}</p>{link(cards[index].link)&&<a href={link(cards[index].link)} target="_blank" rel="noopener noreferrer">Destino de esta tarjeta <ExternalLink size={13}/></a>}</div>
    </div>
    <div className="mh-carousel-strip">{cards.map((card,i)=><button key={i} className={i===index?'selected':''} onClick={()=>setIndex(i)} aria-label={'Mostrar tarjeta '+(i+1)}>{picture(card.picture,'Miniatura '+(i+1))}</button>)}</div>
  </>:creative.format==='Video'?<>
      {player(creative.video_url,creative.images?.[0])}
      {!creative.video_url&&<p className="mh-note">La API devuelve el identificador y/o miniatura, pero no el archivo reproducible con los permisos actuales. Algunos Reels publicados se recuperan únicamente como vista previa.</p>}
    </>:creative.images?.length?
      <div className="mh-gallery">{creative.images.map((src,i)=><a href={src} target="_blank" rel="noopener noreferrer" key={src+i} title="Abrir imagen original"><img src={src} alt={'Imagen '+(i+1)+' de la creatividad'} loading="lazy"/></a>)}</div>:
      <div className="mh-placeholder"><ImageIcon size={28}/><span>Meta no proporcionó imágenes accesibles para esta creatividad.</span></div>
   }
   {creative.format==='Variantes de imagen'&&<p className="mh-note">Creatividad dinámica: estas son las imágenes disponibles; Meta puede combinar o adaptar variantes según la ubicación.</p>}
 </div>;
}
