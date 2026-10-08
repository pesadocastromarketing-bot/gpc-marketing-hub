import React,{useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ChevronDown,Search,X} from 'lucide-react';

const secondaryAccount=a=>
  /(?:read[ -]?only|alternativ[ao]|^\d{8,}$)/i.test(a.name||'')||
  (a.account_status!==undefined&&Number(a.account_status)!==1);
const name=a=>a.name?.trim()||'Cuenta sin nombre';

export default function AccountPicker({accounts=[],value,onChange}){
  const[open,setOpen]=useState(false);
  const[query,setQuery]=useState('');
  const[showOther,setShowOther]=useState(false);
  const[placement,setPlacement]=useState({left:12,top:12,width:420,maxHeight:460});
  const trigger=useRef(null);
  const searchInput=useRef(null);
  const unique=useMemo(()=>[...new Map(accounts.filter(x=>x.account_id).map(a=>[String(a.account_id),a])).values()],[accounts]);
  const selected=unique.find(a=>String(a.account_id)===String(value));
  const main=unique.filter(a=>!secondaryAccount(a));
  const other=unique.filter(secondaryAccount);
  const filtered=unique.filter(a=>(showOther||query.trim()||!secondaryAccount(a))&&
    [a.name,a.account_id,a.currency].some(v=>String(v||'').toLowerCase().includes(query.trim().toLowerCase())));

  useLayoutEffect(()=>{
    if(!open)return;
    function reposition(){
      if(!trigger.current)return;
      const rect=trigger.current.getBoundingClientRect();
      const viewportWidth=window.innerWidth,viewportHeight=window.innerHeight;
      if(viewportWidth<=700){
        setPlacement({left:12,top:Math.max(12,Math.round(viewportHeight*.08)),width:Math.max(250,viewportWidth-24),maxHeight:Math.max(210,Math.round(viewportHeight*.82))});
        return;
      }
      const width=Math.min(500,viewportWidth-24);
      const left=Math.min(Math.max(12,rect.left),viewportWidth-width-12);
      const below=viewportHeight-rect.bottom-16;
      const above=rect.top-16;
      if(below<260&&above>below){
        const available=Math.max(130,Math.min(470,above-8));
        setPlacement({left,bottom:viewportHeight-rect.top+7,width,maxHeight:available});
      }else{
        const available=Math.max(130,Math.min(470,below-8));
        setPlacement({left,top:rect.bottom+7,width,maxHeight:available});
      }
    }
    reposition();
    searchInput.current?.focus();
    const onEscape=e=>{if(e.key==='Escape')setOpen(false)};
    document.addEventListener('keydown',onEscape);
    window.addEventListener('resize',reposition);
    window.addEventListener('scroll',reposition,true);
    return()=>{
      document.removeEventListener('keydown',onEscape);
      window.removeEventListener('resize',reposition);
      window.removeEventListener('scroll',reposition,true);
    };
  },[open]);

  const choose=a=>{
    onChange(String(a.account_id));
    setOpen(false);
    setQuery('');
  };
  const popup=open&&createPortal(
    <div className="gpc-account-overlay" onMouseDown={()=>setOpen(false)}>
      <div className="gpc-account-popover gpc-account-popover-portal" role="dialog" aria-label="Elegir cuenta publicitaria"
        style={placement} onMouseDown={e=>e.stopPropagation()}>
        <div className="gpc-account-heading">
          <strong>Elegir cuenta publicitaria</strong>
          <button type="button" onClick={()=>setOpen(false)} aria-label="Cerrar"><X size={19}/></button>
        </div>
        <label className="gpc-account-search"><Search size={17}/>
          <input ref={searchInput} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar por nombre o ID" aria-label="Buscar cuenta publicitaria"/>
        </label>
        <div className="gpc-account-summary">{main.length} principales · {other.length} secundarias/otras</div>
        <div className="gpc-account-list" role="listbox" aria-label="Cuentas publicitarias disponibles">
          {filtered.length===0&&<p className="gpc-account-empty">No encontramos cuentas con ese criterio.</p>}
          {filtered.map(a=><button type="button" role="option" aria-selected={String(a.account_id)===String(value)}
            key={a.account_id} className={'gpc-account-option '+(String(a.account_id)===String(value)?'selected':'')} onClick={()=>choose(a)}>
            <span className="gpc-account-option-name">{name(a)}</span>
            <span className="gpc-account-option-details">{a.currency||'—'} · ID {a.account_id}{secondaryAccount(a)?' · Secundaria':''}</span>
          </button>)}
        </div>
        {other.length>0&&!query.trim()&&<button type="button" className="gpc-account-secondary-toggle" onClick={()=>setShowOther(v=>!v)}>
          {showOther?'Ocultar cuentas secundarias':'Mostrar '+other.length+' cuentas secundarias / Read-Only'}
        </button>}
        <p className="gpc-account-footnote">Cuentas identificadas por su ID. «Read-Only» forma parte del nombre que informa Meta.</p>
      </div>
    </div>,
    document.body
  );
  return <>
    <div className="gpc-account-picker">
      <button ref={trigger} type="button" className="gpc-account-trigger" aria-expanded={open} aria-haspopup="dialog"
        onClick={()=>setOpen(x=>!x)}><span><strong>{selected?name(selected):'Seleccioná una cuenta publicitaria'}</strong>
        {selected&&<small>{selected.currency} · ID {selected.account_id}</small>}</span><ChevronDown size={18}/></button>
    </div>
    {popup}
  </>;
}
