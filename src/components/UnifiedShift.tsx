import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { contrasts, quantityUsed, validateDetail, type ShiftDetails } from '@/lib/shiftWorkflow';
import { bottleCapacity, isFilm } from '@/lib/roomStock';
import type { Json } from '@/integrations/supabase/types';
import { useAuth } from '@/hooks/useAuth';
import { canEditUsageDay } from '@/lib/usageEditAccess';

type Flow = {id:string;name:string;unit:string;shared?:boolean;opening:number;received:number;received_for_room?:number;initial_received?:number;topups?:number;adjustment:number;used_elsewhere?:number;remaining:number;known:boolean};
type Context = {items:Flow[];token:string};
type RowLabel = 'Carried Over'|'Additional Stock Received'|'Physical Count Adjustment'|'Total Qty Available'|'Used Elsewhere'|'Total Consumption'|'Wastage'|'No. of Patients'|'Outstanding Stock'|'Review';
const SECTIONS:[string,(id:string)=>boolean][]=[['Contrast',id=>contrasts.includes(id)],['Films printed',id=>isFilm(id)],['Other consumables',id=>!contrasts.includes(id)&&!isFilm(id)]];
export function UnifiedShift({date,room,shift,onDirtyChange}:{date:string;room:string;shift:string;onDirtyChange:(value:boolean)=>void}) {
 const {user,canManageStock}=useAuth();
 const readOnly=!canEditUsageDay(date,user?.email,canManageStock);
 const [context,setContext]=useState<Context>({items:[],token:''});
 const [details,setDetails]=useState<ShiftDetails>({});
 const [saved,setSaved]=useState<Record<string,number>>({});
 const [staff,setStaff]=useState('');const [note,setNote]=useState('');
 const [versions,setVersions]=useState({review:0,films:0,supplies:0});
 const [finished,setFinished]=useState(false);const [dirty,setDirty]=useState(false);
 const [busy,setBusy]=useState(true);const [ready,setReady]=useState(false);
 const [error,setError]=useState('');const [message,setMessage]=useState('');
 const draftKey=`radcontrack-unified-${date}-${room}-${shift}`;
 useEffect(()=>onDirtyChange(dirty),[dirty,onDirtyChange]);
 const load=useCallback(async()=>{
  setBusy(true);setReady(false);setError('');
  try {
   const [flow,review,usage]=await Promise.all([
    supabase.rpc('shift_context',{p_date:date,p_room:room,p_shift:shift}),
    supabase.from('room_shift_reviews').select('*').eq('date',date).eq('room',room).eq('shift',shift).maybeSingle(),
    supabase.from('stock_shift_usage').select('*').eq('date',date).eq('room',room).eq('shift',shift),
   ]);
   if(flow.error||review.error||usage.error) throw new Error(flow.error?.message||review.error?.message||usage.error?.message);
   const ctx=flow.data as unknown as Context;const row=review.data;
   const old:ShiftDetails={};const totals:Record<string,number>={};
   for(const u of usage.data||[]) for(const [id,amount] of Object.entries(u.quantities as Record<string,number>)) {
    totals[id]=amount;
    const volume=(u.contrast_volumes as Record<string,{administered_ml:number;waste_ml:number}>)[id];
    if(!contrasts.includes(id)||volume)old[id]={used:volume?.administered_ml ?? amount,waste:volume?.waste_ml||0};
   }
   // Historical overall patient counts cannot be guessed for individual film sizes.
   const changed=!!row && row.stock_token!==ctx.token;
   const initial=structuredClone(row?.details as ShiftDetails || old);
   if(changed)for(const value of Object.values(initial))value.reviewed=false;
   const nextVersions={review:row?.version||0,films:usage.data?.find(x=>x.category==='films')?.version||0,supplies:usage.data?.find(x=>x.category==='supplies')?.version||0};
   setContext(ctx);setSaved(totals);setDetails(initial);
   setStaff(row?.staff||usage.data?.[0]?.recorded_by_name||'');setNote(row?.note||'');setVersions(nextVersions);setFinished(!changed&&!!row?.finished);setDirty(false);
   if(changed)setMessage('A pickup or correction changed this shift’s stock since it was saved. Check each item again before finishing.');
   try {
    const draft=JSON.parse(localStorage.getItem(draftKey)||'null');
    if(draft && JSON.stringify(draft.versions)===JSON.stringify(nextVersions)) {
     if(draft.token!==ctx.token)for(const value of Object.values(draft.details as ShiftDetails))value.reviewed=false;
     setDetails(draft.details);setStaff(draft.staff);setNote(draft.note);setDirty(true);setMessage('Your unsaved entry for this shift has been restored. Save progress to keep it.');
    }
   } catch { /* Damaged drafts do not replace shared records. */ }
   setReady(true);
  } catch(e) {setError(e instanceof Error?e.message:'Unable to load the shift.');}
  finally {setBusy(false);}
 },[date,room,shift,draftKey]);
 useEffect(()=>{void load();},[load]);
 useEffect(()=>{
  if(!dirty)return;
  localStorage.setItem(draftKey,JSON.stringify({details,staff,note,versions,token:context.token}));
  const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};
  window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
 },[dirty,details,staff,note,versions,draftKey,context.token]);
 // Entering an amount used is a review of that item; patients and wastage alone are not.
 const change=(id:string,field:'used'|'waste'|'patients',value:string)=>{
  setDetails(prev=>({...prev,[id]:{...prev[id],[field]:value===''?undefined:Number(value),reviewed:field==='used'?value!=='':prev[id]?.reviewed||false}}));
  setDirty(true);setFinished(false);
 };
 const remaining=(item:Flow)=>details[item.id]===undefined?item.remaining:Number((item.remaining+(saved[item.id]||0)-quantityUsed(details[item.id])).toFixed(2));
 const unreviewed=context.items.filter(item=>!details[item.id]?.reviewed);
 const save=async(finish:boolean)=>{
  if(readOnly){setError('Staff can edit today or yesterday only. Ask Honey to correct an older day.');return;}
  setError('');setMessage('');
  if(staff.trim().length<2){setError('Enter your name in “Recorded by”.');return;}
  for(const item of context.items) {
   if(!details[item.id] && !finish)continue;
   const problem=validateDetail(item.id,details[item.id]||{},finish);
   if(problem){setError(`${item.name}: ${problem}`);return;}
  }
  const payload=Object.fromEntries(Object.entries(details).filter(([id])=>context.items.some(i=>i.id===id)).map(([id,d])=>[id,{...d,used:d.used||0,waste:d.waste||0,patients:d.patients||0}]));
  const existing=versions.review>0||versions.films>0||versions.supplies>0;
  if ((existing||finish)&&!window.confirm(`${finish?'Finish this shift?':'Update this saved shift?'}\n\n${date} · ${room} · ${shift}\n\n${existing?'This replaces the saved usage and recalculates balances carried into later shifts.':'This saves usage for every item and hands the remaining balances to the next shift.'}\n\nCancel keeps your entries without saving.`)) return;
  setBusy(true);
  try {
   const result=await supabase.rpc('save_shift',{p_date:date,p_room:room,p_shift:shift,p_details:payload as Json,p_staff:staff.trim(),p_version:versions.review,p_film_version:versions.films,p_supply_version:versions.supplies,p_finish:finish,p_physical:{},p_note:note,p_token:context.token});
   if(result.error)throw new Error(result.error.message);
   const left=context.items.filter(item=>!(payload as ShiftDetails)[item.id]?.reviewed).map(item=>item.name);
   localStorage.removeItem(draftKey);await load();
   setMessage(finish?'Shift finished. Remaining balances carry into the next shift.':`Progress saved. The shift is not finished yet.${left.length?` Still to review: ${left.join(', ')}.`:' Every item is reviewed; choose Finish shift when you hand over.'}`);
  } catch(e){setError(e instanceof Error?e.message:'Unable to save. Your entry is still here.');}
  finally{setBusy(false);}
 };

 return <section className="space-y-7">
  {readOnly&&<p role="status">Reference only. Staff can edit today or yesterday. Honey can correct older days.</p>}
  <fieldset disabled={readOnly} className="contents">
  <div className="flex flex-wrap items-end justify-between gap-4"><label className="text-sm">Recorded by<Input value={staff} disabled={busy} placeholder="Your full name" onChange={e=>{setStaff(e.target.value);setDirty(true);}} /></label>
   <p className="text-sm font-medium" aria-live="polite">{finished?'Shift finished':dirty?'Unsaved changes':versions.review||versions.films||versions.supplies?'Progress saved, not finished':'Nothing saved yet'}{ready&&context.items.length>0&&` · ${context.items.length-unreviewed.length} of ${context.items.length} items reviewed`}</p></div>
  <p className="text-sm text-muted-foreground">Balances carry forward automatically. <Link className="underline text-primary" onClick={e=>{if(dirty){e.preventDefault();setError('Save progress before recording a pickup or top-up.');}}} to={`/stock/pick?room=${encodeURIComponent(room)}&shift=${shift}&date=${date}`}>Record a pickup or top-up</Link>, then reload this shift.</p>
  {error&&<p role="alert" className="text-destructive">{error}</p>}{message&&<p role="status">{message}</p>}
  {!ready&&<p>{busy?'Loading shift…':'The shift could not load. Reload the page or try again shortly.'}</p>}
  {ready&&SECTIONS.map(([title,filter])=>{
   const items=context.items.filter(i=>filter(i.id));if(!items.length)return null;
   const contrast=title==='Contrast';
   const shared=items.some(i=>i.shared);
   const labels:RowLabel[]=['Carried Over','Additional Stock Received',...(items.some(i=>i.adjustment!==0)?['Physical Count Adjustment' as const]:[]),'Total Qty Available',...(shared?['Used Elsewhere' as const]:[]),'Total Consumption',...(contrast?['Wastage' as const]:[]),...(title==='Other consumables'?[]:['No. of Patients' as const]),'Outstanding Stock','Review'];
   const heading=(label:RowLabel)=>!contrast&&label==='Carried Over'?'Balance carried over from recorded entries':!contrast&&label==='Outstanding Stock'?'Balance from recorded pickups and usage':label==='Physical Count Adjustment'?'Stock check adjustment':label==='Additional Stock Received'?'Stock picked this shift':label==='Used Elsewhere'?'Used in other rooms this shift':label==='Total Consumption'?(contrast?'Total Consumption':shared?'Used in this room':'Used this shift'):label;
   return <section key={title} className="border-t pt-5 space-y-4"><h2 className="text-lg font-bold">{title}</h2>
    <p className="text-sm text-muted-foreground">{contrast?'CT and MRI contrast stay with their room. Gastrolux comes from Shared stock. ':''}{shared?'Shared stock is one pool for all rooms: pickups by any room add to it, and every room’s usage comes out of it. Enter only what this room used.':'Record what this room gave to patients and any wastage.'}</p>
    {title==='Films printed'&&<p className="text-sm text-muted-foreground">Include reprints in films printed. Count patients separately for each size; do not count the same patient again for a reprint.</p>}
    <div className="overflow-x-auto rounded-lg border border-border"><table aria-label={title} className="w-full border-collapse">
     <thead><tr className="bg-muted/50"><th scope="col" className="p-3 text-left text-sm min-w-[180px] border-b sticky left-0 bg-muted">Row Type</th>{items.map(item=><th scope="colgroup" key={item.id} colSpan={contrast?2:1} className="p-3 text-center text-sm font-semibold border-b border-l min-w-[150px]">{item.name}{item.shared&&<span className="block text-xs font-normal text-muted-foreground">Shared stock</span>}</th>)}</tr>
     <tr className="bg-muted/30"><th className="border-b sticky left-0 bg-muted" />{items.map(item=><Fragment key={item.id}><th scope="col" className="p-2 text-xs text-muted-foreground border-b border-l">{contrast?'Total (mls)':item.unit}</th>{contrast&&<th scope="col" className="p-2 text-xs text-muted-foreground border-b min-w-[110px]">Bottle equivalent</th>}</Fragment>)}</tr></thead>
     <tbody>
      {labels.map(label=><tr key={label} className={label==='Outstanding Stock'?'bg-accent/30':label==='No. of Patients'?'bg-accent/10':'hover:bg-muted/20'}>
       <th scope="row" className="p-3 text-sm text-left font-medium border-b sticky left-0 bg-background">{heading(label)}{label==='Total Consumption'&&contrast&&<span className="block text-xs font-normal text-muted-foreground">Given to patients</span>}{label==='Additional Stock Received'&&shared&&<span className="block text-xs font-normal text-muted-foreground">Into Shared stock by any room</span>}{label==='Outstanding Stock'&&<span className="block text-xs font-normal text-muted-foreground">Available − used{shared?' in all rooms':''}{contrast?' − wastage':''}</span>}</th>
       {items.map(item=>{
        const key=label==='Total Consumption'?'used':label==='Wastage'?'waste':label==='No. of Patients'?'patients':null;
        const value=label==='Carried Over'?item.opening:label==='Additional Stock Received'?item.received:label==='Physical Count Adjustment'?item.adjustment:label==='Total Qty Available'?Number((item.opening+item.received+item.adjustment).toFixed(2)):label==='Used Elsewhere'?(item.shared?item.used_elsewhere||0:undefined):label==='Outstanding Stock'?remaining(item):key?details[item.id]?.[key]:0;
        const merged=label==='No. of Patients'||label==='Review';
        const forRoom=label==='Additional Stock Received'&&item.shared&&item.received>0?item.received_for_room||0:null;
        return <Fragment key={item.id}><td colSpan={contrast&&merged?2:1} className="p-2 text-center border-b border-l">
         {label==='Review'?<div className="space-y-2"><Button variant="outline" size="sm" disabled={busy} onClick={()=>{setDetails(prev=>({...prev,[item.id]:{used:0,waste:0,patients:0,reviewed:true}}));setDirty(true);setFinished(false);}}>None used</Button><label className="flex justify-center gap-2 text-xs"><input type="checkbox" aria-label={item.name+' reviewed'} disabled={busy} checked={details[item.id]?.reviewed||false} onChange={e=>{setDetails(prev=>({...prev,[item.id]:{...prev[item.id],reviewed:e.target.checked}}));setDirty(true);setFinished(false);}}/>Reviewed</label></div>
         :key?<Input aria-label={item.name+' '+(key==='patients'?(isFilm(item.id)?'Patients printed for':'Number of patients'):key==='waste'?'Wastage (ml)':isFilm(item.id)?'Films printed':contrasts.includes(item.id)?'Used for patients (ml)':'Used this shift')} className="clinical-input text-center min-w-24" type="number" min="0" inputMode={key==='patients'||!contrasts.includes(item.id)?'numeric':'decimal'} step={key==='patients'||!contrasts.includes(item.id)?1:0.01} disabled={busy} value={value??''} placeholder="0" onChange={e=>change(item.id,key,e.target.value)}/>
         :<div className={'clinical-input clinical-input-readonly text-center '+(label==='Outstanding Stock'?'font-semibold':'')}>{value===undefined?'—':value}{label==='Outstanding Stock'?' '+(value===1?item.unit.replace(/s$/,''):item.unit):''}{forRoom!==null&&<span className="block text-xs text-muted-foreground">{forRoom} for this room</span>}</div>}
        </td>{contrast&&!merged&&<td className="p-2 text-center border-b"><div className="clinical-input clinical-input-readonly text-center">{value===undefined||!bottleCapacity(item.id)?'—':Number((value/bottleCapacity(item.id)).toFixed(3))}</div></td>}</Fragment>;
       })}
      </tr>)}
     </tbody></table></div>
     {items.some(i=>!i.known)&&<p className="text-xs text-muted-foreground">Calculated from recorded pickups and usage only; stock that was already there before recording began is not included for: {items.filter(i=>!i.known).map(i=>i.name).join(', ')}. A stock check sets a confirmed balance.</p>}
     {items.some(i=>remaining(i)<0)&&<p role="status" className="text-amber-700">Usage is more than the recorded stock for: {items.filter(i=>remaining(i)<0).map(i=>i.name).join(', ')}. A pickup is probably missing; record it before saving.</p>}
     {items.filter(i=>!details[i.id]&&saved[i.id]>0).map(item=><p key={item.id} className="text-xs text-muted-foreground">{item.name}: {saved[item.id]} {item.unit} already deducted from an earlier entry. Enter the breakdown to review it; it stays unchanged until corrected.</p>)}
   </section>;
  })}
  {ready&&<section className="border-t pt-5 space-y-3" aria-label="Finish shift"><h2 className="text-lg font-bold">Finish shift</h2>
   <p className="text-sm text-muted-foreground">Finish when every item above is reviewed: enter what was used, or choose None used. You do not need to count stock to finish.{unreviewed.length>0&&` Still to review: ${unreviewed.map(i=>i.name).join(', ')}.`}</p>
   <p className="text-sm text-muted-foreground">Physically counted something? Record it under <Link className="underline text-primary" to="/stock/count">Stock check</Link>. A count replaces the recorded balance; it does not add stock.</p>
   <label className="block text-sm max-w-xl">Handover note (optional)<Input value={note} disabled={busy} onChange={e=>{setNote(e.target.value);setDirty(true);}}/></label>
  </section>}
  <div className="flex flex-wrap gap-3"><Button disabled={busy||!ready||!dirty} onClick={()=>void save(false)}>{busy?'Saving / loading…':'Save progress'}</Button><Button variant="secondary" disabled={busy||!ready} onClick={()=>void save(true)}>Finish shift</Button><Button variant="outline" disabled={busy} onClick={()=>{if(dirty&&!window.confirm('Discard your unsaved changes and reload?'))return;localStorage.removeItem(draftKey);void load();}}>Reload shift</Button></div>
 </fieldset></section>;
}
