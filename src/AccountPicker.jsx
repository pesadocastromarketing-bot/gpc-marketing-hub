import React,{useEffect,useMemo,useRef,useState} from 'react';
import {ChevronDown,Search,X} from 'lucide-react';

const secondaryAccount=a=>
  /(?:read[ -]?only|alternativ[ao]|^\d{8,}$)/i.test(a.name||'')||
  (a.account_status!==undefined&&Number(a.account_status)!==1);
const name=a=>a.name?.trim()||'Cuenta sin nombre';
export default function AccountPicker({accounts=[],value,onChange}){
  const[open,setOpen]=useState(false);
  const[query,setQuery]=useState('');
  const[showOther,setShowOther]=useState(false);
  const root=useRef(null);
  const unique=useMemo(()=>[...new Map(accounts.filter(x=>x.account_id).map(a=>[String(a.account_id),a])).values()], [accounts]);
  const selected=unique.find(a=>String(a.account_id)===String(value));
  const main=unique.filter(a=>!secondaryAccount(a));
  const other=unique.filter(secondaryAccount);
  const filtered=unique.filter(a=>(showOther||query.trim()||!secondaryAccount(a))&&
    [a.name,a.account_id,a.currency].some(v=>String(v||'').toLowerCase().includes(query.trim().toLowerCase())));
  useEffect(()=>{
    if(!open)return;
    const close=e=>{if(root.current&&!root.current.contains(e.target))setOpen(false)};
    const esc=e=>{if(e.key==='Escape')setOpen(false)};
    document.addEventListener('pointerdown',close);
    document.addEventListener('keydown',esc);
    return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',esc)};
  },[open]);
  return <div className="gpc-account-picker" ref={root}>
    <button type="button" className="gpc-account-trigger" aria-expanded={open} aria-haspopup="listbox"
      onClick={()=>setOpen(x=>!x)}><span><strong>{selected?name(selected):'Seleccioná una cuenta publicitaria'}</strong>{selected&&<small>{selected.currency} · ID {selected.account_id}</small>}</span><ChevronDown size={18}/></button>
    {open&&<div className="gpc-account-popover">
      <div className="gpc-account-heading"><strong>Elegir cuenta publicitaria</strong><button type="button" onClick={()=>setOpen(false)} aria-label="Cerrar"><X size={19}/></button></div>
      <label className="gpc-account-search"><Search size={17}/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar por nombre o ID"/></label>
      <div className="gpc-account-summary">{main.length} principales · {other.length} secundarias/otras</div>
      <div className="gpc-account-list" role="listbox">
        {filtered.length===0&&<p className="gpc-account-empty">No encontramos cuentas con ese criterio.</p>}
        {filtered.map(a=><button type="button" role="option" aria-selected={String(a.account_id)===String(value)} key={a.account_id} className={'gpc-account-option '+(String(a.account_id)===String(value)?'selected':'')} onClick={()=>{onChange(String(a.account_id));setOpen(false);setQuery('')}}><span className="gpc-account-option-name">{name(a)}</span><span className="gpc-account-option-details">{a.currency||'—'} · ID {a.account_id}{secondaryAccount(a)?' · Secundaria':''}</span></button>)}
      </div>
      {other.length>0&&!query.trim()&&<button type="button" className="gpc-account-secondary-toggle" onClick={()=>setShowOther(v=>!v)}>{showOther?'Ocultar cuentas secundarias':'Mostrar '+other.length+' cuentas secundarias / Read-Only'}</button>}
      <p className="gpc-account-footnote">Cuentas identificadas por su ID. «Read-Only» forma parte del nombre que informa Meta.</p>
    </div>}
  </div>;
}
