import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { contrasts, quantityUsed, validateDetail, type ShiftDetails } from '@/lib/shiftWorkflow';
import { bottleCapacity, isFilm } from '@/lib/roomStock';
import type { Json } from '@/integrations/supabase/types';

type Flow = {id:string;name:string;unit:string;opening:number;received:number;initial_received?:number;topups?:number;adjustment:number;remaining:number;known:boolean};
type Context = {items:Flow[];token:string};
export function UnifiedShift({date,room,shift,onDirtyChange}:{date:string;room:string;shift:string;onDirtyChange:(value:boolean)=>void}) {
 const [context,setContext]=useState<Context>({items:[],token:''});
 const [details,setDetails]=useState<ShiftDetails>({});
 const [saved,setSaved]=useState<Record<string,number>>({});
 const [physical,setPhysical]=useState<Record<string,number>>({});
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
   setContext(ctx);setSaved(totals);setDetails(initial);setPhysical(changed?{}:row?.physical as Record<string,number>||{});
   setStaff(row?.staff||usage.data?.[0]?.recorded_by_name||'');setNote(row?.note||'');setVersions(nextVersions);setFinished(!changed&&!!row?.finished);setDirty(false);
   if(changed)setMessage('Stock movements changed since this entry. Check the items and remaining stock again before finishing.');
   try {
    const draft=JSON.parse(localStorage.getItem(draftKey)||'null');
    if(draft && JSON.stringify(draft.versions)===JSON.stringify(nextVersions)) {
     if(draft.token!==ctx.token)for(const value of Object.values(draft.details as ShiftDetails))value.reviewed=false;
     setDetails(draft.details);setPhysical(draft.token===ctx.token?draft.physical:{});setStaff(draft.staff);setNote(draft.note);setDirty(true);setMessage('Your unsaved shift entry has been restored. Check remaining stock before finishing.');
    }
   } catch { /* Damaged drafts do not replace shared records. */ }
   setReady(true);
  } catch(e) {setError(e instanceof Error?e.message:'Unable to load the shift.');}
  finally {setBusy(false);}
 },[date,room,shift,draftKey]);
 useEffect(()=>{void load();},[load]);
 useEffect(()=>{
  if(!dirty)return;
  localStorage.setItem(draftKey,JSON.stringify({details,physical,staff,note,versions,token:context.token}));
  const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};
  window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
 },[dirty,details,physical,staff,note,versions,draftKey,context.token]);
 const change=(id:string,field:'used'|'waste'|'patients',value:string)=>{
  setDetails(prev=>({...prev,[id]:{...prev[id],[field]:value===''?undefined:Number(value),reviewed:false}}));
  setPhysical({});setDirty(true);setFinished(false);
 };
 const remaining=(item:Flow)=>details[item.id]===undefined?item.remaining:Number((item.remaining+(saved[item.id]||0)-quantityUsed(details[item.id])).toFixed(2));
 const save=async(finish:boolean)=>{
  setError('');setMessage('');
  if(staff.trim().length<2){setError('Enter your name.');return;}
  for(const item of context.items) {
   if(!details[item.id] && !finish)continue;
   const problem=validateDetail(item.id,details[item.id]||{},finish);
   if(problem){setError(`${item.name}: ${problem}`);return;}
   if(finish && physical[item.id]===undefined){setError(`Confirm what remains for ${item.name}.`);return;}
  }
  const payload=Object.fromEntries(Object.entries(details).filter(([id])=>context.items.some(i=>i.id===id)).map(([id,d])=>[id,{...d,used:d.used||0,waste:d.waste||0,patients:d.patients||0}]));
  const existing=versions.review>0||versions.films>0||versions.supplies>0;
  if ((existing||finish)&&!window.confirm(`${existing?'Update this saved shift?':'Finish this shift?'}\n\n${date} · ${room} · ${shift}\n\n${existing?'This replaces the saved usage and recalculates room balances and later carryover.':'This saves usage and the remaining stock for carryover.'}${finish?' Physical counts can adjust the recorded balance.':''}\n\nCancel keeps your entries without saving.`)) return;
  setBusy(true);
  try {
   const result=await supabase.rpc('save_shift',{p_date:date,p_room:room,p_shift:shift,p_details:payload as Json,p_staff:staff.trim(),p_version:versions.review,p_film_version:versions.films,p_supply_version:versions.supplies,p_finish:finish,p_physical:physical,p_note:note,p_token:context.token});
   if(result.error)throw new Error(result.error.message);
   localStorage.removeItem(draftKey);await load();
   setMessage(finish?'Shift finished. Leftovers remain in the room for the next shift.':'Progress saved. Finish the shift after reviewing all items.');
  } catch(e){setError(e instanceof Error?e.message:'Unable to save. Your entry is still here.');}
  finally{setBusy(false);}
 };

 return <section className="space-y-7">
  <div className="flex flex-wrap items-end justify-between gap-4"><label className="text-sm">Recorded by<Input value={staff} disabled={busy} placeholder="Your full name" onChange={e=>{setStaff(e.target.value);setDirty(true);}} /></label><p className="text-sm">{finished?'Shift finished':versions.review?'Saved, review before finishing':'New shift entry'}</p></div>
  <p className="text-sm text-muted-foreground">Leftovers carry forward automatically. <Link className="underline text-primary" onClick={e=>{if(dirty){e.preventDefault();setError('Save progress before recording a top-up.');}}} to={`/stock/pick?room=${encodeURIComponent(room)}&shift=${shift}&date=${date}`}>Pick or top up this room</Link>, then reload this shift.</p>
  {error&&<p role="alert" className="text-destructive">{error}</p>}{message&&<p role="status">{message}</p>}
  {!ready&&<p>{busy?'Loading shared shift…':'The shift could not load. Check that the database update has been applied, then reload.'}</p>}
  {ready&&[['Contrast', (id:string)=>contrasts.includes(id)],['Films printed',(id:string)=>isFilm(id)],['Other consumables',(id:string)=>!contrasts.includes(id)&&!isFilm(id)]].map(([title,filter])=>{
   const items=context.items.filter(i=>(filter as (id:string)=>boolean)(i.id));if(!items.length)return null;
   const splitPicks=items.every(item=>item.initial_received!==undefined&&item.topups!==undefined);
   return <section key={title as string} className="border-t pt-5 space-y-4"><h2 className="text-lg font-bold">{title as string}</h2>
    {title==='Films printed'&&<p className="text-sm text-muted-foreground">Include reprints in films printed. Count patients separately for each size; do not count the same patient again for a reprint.</p>}
    {splitPicks&&<p className="text-sm text-muted-foreground">Initial stock received is the first pickup for each item in this shift. Additional stock received / Top-ups adds all later pickups. Carried over is stock left from earlier shifts.</p>}
    <div className="overflow-x-auto rounded-lg border border-border"><table aria-label={title as string} className="w-full border-collapse">
     <thead><tr className="bg-muted/50"><th scope="col" className="p-3 text-left text-sm min-w-[180px] border-b">Row Type</th>{items.map(item=><th scope="colgroup" key={item.id} colSpan={title==='Contrast'?2:1} className="p-3 text-center text-sm font-semibold border-b border-l min-w-[150px]">{item.name}</th>)}</tr>
     <tr className="bg-muted/30"><th className="border-b" />{items.map(item=><Fragment key={item.id}><th scope="col" className="p-2 text-xs text-muted-foreground border-b border-l">{title==='Contrast'?'Total (mls)':item.unit}</th>{title==='Contrast'&&<th scope="col" className="p-2 text-xs text-muted-foreground border-b min-w-[110px]">Bottle equivalent</th>}</Fragment>)}</tr></thead>
     <tbody>
      {(['Carried Over',...(splitPicks?['Initial Stock Received','Additional Stock Received / Top-ups']:['Additional Stock Received']),...(items.some(i=>i.adjustment!==0)?['Physical Count Adjustment']:[]),'Total Qty Available','Total Consumption',...(title==='Contrast'?['Wastage']:[]),...(title==='Other consumables'?[]:['No. of Patients']),'Outstanding Stock','Review'] as const).map(label=><tr key={label} className={label==='Outstanding Stock'?'bg-accent/30':label==='No. of Patients'?'bg-accent/10':'hover:bg-muted/20'}>
       <th scope="row" className="p-3 text-sm text-left font-medium border-b">{label}{label==='Total Consumption'&&title==='Contrast'&&<span className="block text-xs font-normal text-muted-foreground">Given to patients</span>}{label==='Outstanding Stock'&&<span className="block text-xs font-normal text-muted-foreground">Available − used{title==='Contrast'?' − wastage':''}</span>}</th>
       {items.map(item=>{
        const key=label==='Total Consumption'?'used':label==='Wastage'?'waste':label==='No. of Patients'?'patients':null;
        const value=label==='Carried Over'?item.opening:label==='Initial Stock Received'?item.initial_received:label==='Additional Stock Received / Top-ups'?item.topups:label==='Additional Stock Received'?item.received:label==='Physical Count Adjustment'?item.adjustment:label==='Total Qty Available'?Number((item.opening+item.received+item.adjustment).toFixed(2)):label==='Outstanding Stock'?remaining(item):key?details[item.id]?.[key]:0;
        const merged=label==='No. of Patients'||label==='Review';
        return <Fragment key={item.id}><td colSpan={title==='Contrast'&&merged?2:1} className="p-2 text-center border-b border-l">
         {label==='Review'?<div className="space-y-2"><Button variant="outline" size="sm" disabled={busy} onClick={()=>{setDetails(prev=>({...prev,[item.id]:{used:0,waste:0,patients:0,reviewed:true}}));setPhysical({});setDirty(true);setFinished(false);}}>None used</Button><label className="flex justify-center gap-2 text-xs"><input type="checkbox" aria-label={item.name+' reviewed'} disabled={busy} checked={details[item.id]?.reviewed||false} onChange={e=>{setDetails(prev=>({...prev,[item.id]:{...prev[item.id],reviewed:e.target.checked}}));setDirty(true);setFinished(false);}}/>Checked</label></div>:key?<Input aria-label={item.name+' '+(key==='patients'?(isFilm(item.id)?'Patients printed for':'Number of patients'):key==='waste'?'Wastage (ml)':isFilm(item.id)?'Films printed':contrasts.includes(item.id)?'Used for patients (ml)':'Used this shift')} className="clinical-input text-center min-w-24" type="number" min="0" step={key==='patients'||!contrasts.includes(item.id)?1:0.01} disabled={busy} value={value??''} placeholder="0" onChange={e=>change(item.id,key,e.target.value)}/>:<div className={'clinical-input clinical-input-readonly text-center '+(label==='Outstanding Stock'?'font-semibold':'')}>{value}{label==='Outstanding Stock'?' '+item.unit:''}</div>}
        </td>{title==='Contrast'&&!merged&&<td className="p-2 text-center border-b"><div className="clinical-input clinical-input-readonly text-center">{value===undefined?'—':Number((value/bottleCapacity(item.id)).toFixed(3))}</div></td>}</Fragment>;
       })}
      </tr>)}
     </tbody></table></div>
     {items.some(i=>!i.known)&&<p className="text-xs text-muted-foreground">Opening balance unconfirmed for: {items.filter(i=>!i.known).map(i=>i.name).join(', ')}.</p>}
     {items.filter(i=>!details[i.id]&&saved[i.id]>0).map(item=><p key={item.id} className="text-xs text-muted-foreground">{item.name}: earlier depletion {saved[item.id]} {item.unit}. Enter the breakdown to review it; it remains unchanged until corrected.</p>)}

   </section>;
  })}
  {ready&&<details className="border-t pt-5"><summary className="cursor-pointer font-semibold">Finish shift: check what remains</summary>
   <p className="text-sm text-muted-foreground my-3">Check the actual stock in the room. Differences are recorded for review and do not silently change stock.</p>
   <div className="space-y-3">{context.items.map(item=><div key={item.id} className="flex flex-wrap gap-3 items-center"><span className="w-48 text-sm">{item.name}: expected {remaining(item)} {item.unit}</span><Input aria-label={`${item.name} actually remaining`} className="w-28" type="number" min="0" step={contrasts.includes(item.id)?0.01:1} disabled={busy} value={physical[item.id]??''} onChange={e=>{setPhysical(p=>{const next={...p};if(e.target.value==='')delete next[item.id];else next[item.id]=Number(e.target.value);return next;});setDirty(true);}}/><Button variant="outline" disabled={busy||remaining(item)<0||!item.known} onClick={()=>{setPhysical(p=>({...p,[item.id]:remaining(item)}));setDirty(true);}}>Matches</Button></div>)}</div>
   <label className="block text-sm mt-4">Explain any difference or unconfirmed opening balance<Input value={note} disabled={busy} onChange={e=>{setNote(e.target.value);setDirty(true);}}/></label>
   <Button className="mt-4" disabled={busy} onClick={()=>void save(true)}>Finish shift</Button>
  </details>}
  <div className="flex flex-wrap gap-3"><Button disabled={busy||!ready||!dirty} onClick={()=>void save(false)}>{busy?'Saving / loading…':'Save progress'}</Button><Button variant="outline" disabled={busy} onClick={()=>{if(dirty&&!window.confirm('Discard your unsaved changes and reload?'))return;localStorage.removeItem(draftKey);void load();}}>Reload shift</Button></div>
 </section>;
}
