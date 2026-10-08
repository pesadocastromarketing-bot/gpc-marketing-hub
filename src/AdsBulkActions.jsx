import React,{useState} from 'react';
import {CheckSquare,Pause,Play,Wallet,X,AlertTriangle,ShieldCheck} from 'lucide-react';
export default function AdsBulkActions({client,accountId,currency='ARS',selectedIds,selectedCampaigns,onClear,onDone}){
 const [open,setOpen]=useState(false),[action,setAction]=useState('pause'),[amount,setAmount]=useState(''),[confirmation,setConfirmation]=useState(''),[running,setRunning]=useState(false),[error,setError]=useState(''),[result,setResult]=useState(null),[authorizing,setAuthorizing]=useState(false);
 const targets=selectedCampaigns.filter(c=>selectedIds.includes(c.id));
 const budget=Number(amount.replace(',','.'));
 const validBudget=Number.isFinite(budget)&&budget>=1&&budget<=10000000;
 const canSubmit=confirmation==='CONFIRMAR'&&targets.length>0&&targets.length<=25&&(action!=='daily_budget'||validBudget);
 const labels={pause:'Pausar',activate:'Activar',daily_budget:'Cambiar presupuesto diario'};
 async function authorize(){
   setAuthorizing(true);setError('');
   try{
    const {data:{session}}=await client.auth.getSession();
    const response=await fetch('/api/meta/start',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session?.access_token},body:JSON.stringify({mode:'ads_manage'})});
    const json=await response.json();if(!response.ok)throw Error(json.error||'No se pudo iniciar la autorización');
    window.location.href=json.url;
   }catch(e){setError(e.message);setAuthorizing(false)}
 }
 async function apply(){
   if(!canSubmit||running)return;
   setRunning(true);setError('');setResult(null);
   try{
    const {data:{session}}=await client.auth.getSession();
    const response=await fetch('/api/meta/bulk',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session?.access_token},body:JSON.stringify({
      account_id:accountId,ids:targets.map(c=>c.id),operation:action,
      ...(action==='daily_budget'?{daily_budget:Math.round(budget*100)}:{}),confirmation
    })});
    const json=await response.json();if(!response.ok)throw Error(json.error||'Meta rechazó la operación');
    setResult(json);if(json.changed)await onDone?.();
   }catch(e){setError(e.message)}
   finally{setRunning(false)}
 }
 return <>
  <div className="hub-ads-bulk-toolbar">
   <div><CheckSquare size={17}/> <strong>{targets.length} seleccionadas</strong> <small>(máximo 25 por lote)</small></div>
   <button className="secondary" onClick={authorize} disabled={authorizing}>{authorizing?'Autorizando...':'Autorizar edición Meta'}</button>
   <button className="secondary" disabled={!targets.length} onClick={()=>{setOpen(true);setError('');setResult(null);setConfirmation('')}}>Acciones en lote</button>
   {targets.length>0&&<button className="quiet" onClick={onClear}>Quitar selección</button>}
  </div>
  {error&&!open&&<p role="alert" className="hub-ads-bulk-error">{error}</p>}
  {open&&<div className="modalOverlay" role="presentation"><div className="modal hub-bulk-dialog" role="dialog" aria-modal="true" aria-label="Acciones en lote sobre campañas">
    <div className="modalTitle"><div><h2>Acciones masivas en Meta</h2><p>{targets.length} campaña(s) de la cuenta actual</p></div><button aria-label="Cerrar" onClick={()=>{setOpen(false);setResult(null)}}><X size={18}/></button></div>
    {!result?<><div className="hub-bulk-list">{targets.map(c=><div key={c.id}><strong>{c.name}</strong><small>{c.effective_status||c.status} · {c.id}</small></div>)}</div>
    <label className="hub-wide-label">Acción<select value={action} onChange={e=>{setAction(e.target.value);setConfirmation('')}}><option value="pause">Pausar campañas</option><option value="activate">Activar campañas</option><option value="daily_budget">Cambiar presupuesto diario a nivel campaña</option></select></label>
    {action==='daily_budget'&&<label className="hub-wide-label">Nuevo presupuesto diario ({currency})<input type="number" min="1" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="Ej. 25000"/><small>Solo campañas que usan presupuesto diario en campaña. Los conjuntos con presupuesto propio no se modifican. La inversión de Meta no incluye impuestos.</small></label>}
    <div className="hub-bulk-caution"><AlertTriangle size={17}/> Esta operación modifica campañas reales y puede afectar la inversión. Se aplicará exclusivamente a las campañas seleccionadas, una por una, y quedará auditada.</div>
    <label className="hub-wide-label">Escribí <strong>CONFIRMAR</strong> para ejecutar<input value={confirmation} onChange={e=>setConfirmation(e.target.value)} placeholder="CONFIRMAR" autoComplete="off"/></label>
    {error&&<p className="hub-ads-bulk-error" role="alert">{error}</p>}
    <div className="modalFoot"><button className="secondary" onClick={()=>setOpen(false)}>Cancelar</button><button className="primary" disabled={!canSubmit||running} onClick={apply}>{running?'Aplicando...':labels[action]+' '+targets.length+' campañas'}</button></div>
    </>:<>
     <div className="hub-bulk-result"><ShieldCheck size={23}/><strong>{result.changed} de {result.total} campañas modificadas</strong></div>
     <div className="hub-bulk-list">{result.results?.map(x=><div key={x.id}><strong>{x.name}</strong><small>{x.outcome==='success'?'Correcto':'Error'} · {x.message}</small></div>)}</div>
     <div className="modalFoot"><button className="primary" onClick={()=>{setOpen(false);setResult(null);setConfirmation('')}}>Cerrar</button></div>
    </>}
   </div></div>}
 </>;
}
