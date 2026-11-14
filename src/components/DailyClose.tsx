import {ActionFeedback} from '@/components/ActionFeedback';
import {useCallback,useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {supabase} from '@/integrations/supabase/client';
import {useAuth} from '@/hooks/useAuth';
import {canEditUsageDay} from '@/lib/usageEditAccess';
import {closeMissing,closeProblem,closeExtra,type CloseDetails,type CloseItem} from '@/lib/dailyClose';
import {STOCK_ROOMS} from '@/lib/roomStock';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import type {Json} from '@/integrations/supabase/types';

type CloseRecord={version:number;details:CloseDetails;staff:string;note:string;finished:boolean;stock_token:string};
type Context={items:CloseItem[];token:string;close:CloseRecord|null};
export function DailyClose({date,onDirtyChange}:{date:string;onDirtyChange:(dirty:boolean)=>void}) {
 const {user,canManageStock}=useAuth();const readOnly=!canEditUsageDay(date,user?.email,canManageStock);
 const [ctx,setCtx]=useState<Context|null>(null),[details,setDetails]=useState<CloseDetails>({});
 const [staff,setStaff]=useState(''),[note,setNote]=useState(''),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [action,setAction]=useState('');
 const draftKey=`tracstoc-close-${date}`;
 const staffKey=`tracstoc-last-staff-${user?.email||'staff'}`;
 const [selectedRoom,setSelectedRoom]=useState<string>('CT');
 const [sameSleeves,setSameSleeves]=useState(true);
 useEffect(()=>onDirtyChange(dirty),[dirty,onDirtyChange]);
 const load=useCallback(async()=>{setBusy(true);setError('');try{
  const r=await supabase.rpc('daily_close_context',{p_date:date});if(r.error)throw new Error(r.error.message);
  const context=r.data as unknown as Context;
  // PostgreSQL can return an empty composite as an object of null fields.
  if(!context.close?.version)context.close=null;
  setCtx(context);
  const initial={...(context.close?.details||{})};
  // Earlier shift usage is visible and included, never deducted again or rewritten.
  for(const i of context.items)if(!initial[i.key]&&i.earlier>0)initial[i.key]={used:i.earlier,reviewed:false};
  let restored=false;try{const draft=JSON.parse(localStorage.getItem(draftKey)||'null');if(draft&&draft.version===(context.close?.version||0)&&draft.token===context.token){setDetails(draft.details);setStaff(draft.staff);setNote(draft.note);setSameSleeves(draft.details['Shared|cd_jacket']?.used===draft.details['Shared|cd']?.used);restored=true;}}catch{/* Ignore damaged drafts. */}
  if(!restored){setDetails(initial);setStaff(context.close?.staff||localStorage.getItem(staffKey)||'');setNote(context.close?.note||'');}
  if(!restored)setSameSleeves(initial['Shared|cd_jacket']?.used===initial['Shared|cd']?.used);
  setDirty(restored);
 }catch(e){setError(`Could not refresh the day: ${e instanceof Error?e.message:'check your connection'}. Reload the saved record before entering it again.`);}finally{setBusy(false);}},[date,draftKey,staffKey]);
 useEffect(()=>{void load();},[load]);
 useEffect(()=>{if(!dirty||!ctx)return;localStorage.setItem(draftKey,JSON.stringify({details,staff,note,version:ctx.close?.version||0,token:ctx.token}));const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty,ctx,details,staff,note,draftKey]);
 const change=(key:string,value:string)=>{setDetails(d=>{const updated={...d,[key]:{...d[key],used:value===''?undefined:Number(value),reviewed:value!=='',...(key.includes('|film')&&value==='0'?{patients:0}:{})}};if(key==='Shared|cd'&&sameSleeves)updated['Shared|cd_jacket']={...d['Shared|cd_jacket'],used:value===''?undefined:Number(value),reviewed:value!==''};return updated;});setDirty(true);};
 const noRoomActivity=()=>{
  if(!ctx)return;const items=ctx.items.filter(i=>i.room===selectedRoom);
  if(items.some(i=>i.earlier>0))return;
  if(items.some(i=>(details[i.key]?.used||0)>0)&&!window.confirm(`Set both film sizes in ${selectedRoom} to zero? This replaces the quantities currently entered.`))return;
  setDetails(d=>({...d,...Object.fromEntries(items.map(i=>[i.key,{used:0,patients:0,reviewed:true}]))}));setDirty(true);
 };
 const missing=ctx?closeMissing(ctx.items,details):[];
 const filmRooms=STOCK_ROOMS.filter(room=>ctx?.items.some(i=>i.room===room));
 const save=async(finish:boolean)=>{
  if(!ctx||readOnly||busy)return;setError('');setMessage('');
  if(staff.trim().length<2){setError('Enter your name.');return;}
  const problem=closeProblem(ctx.items,details,finish);if(problem){setError(problem);return;}
  if(finish&&missing.length){setError(`Still missing: ${missing.map(i=>`${i.room} / ${i.name}`).join(', ')}`);if(missing[0].room!=='Shared')setSelectedRoom(missing[0].room);requestAnimationFrame(()=>document.getElementById(`close-${missing[0].key}`)?.focus());return;}
  if((finish||ctx.close)&&!window.confirm(`${finish?'Close this day?':'Update this daily close?'}\n${date}\nThis recalculates the stock carried forward. Earlier shift records remain unchanged.`))return;
  setAction(finish?'Closing day…':'Saving progress…');setBusy(true);try{const r=await supabase.rpc('save_daily_close',{p_date:date,p_details:details as Json,p_staff:staff.trim(),p_note:note,p_version:ctx.close?.version||0,p_finish:finish,p_token:ctx.token});if(r.error)throw new Error(r.error.message);setMessage(finish?'Day saved and closed.':'Progress saved.');setDirty(false);localStorage.setItem(staffKey,staff.trim());setDirty(false);localStorage.removeItem(draftKey);await load();setMessage(finish?'Day closed. Recorded balances carry forward automatically.':'Progress saved. Daily close is still unfinished.');}catch(e){setError(e instanceof Error?e.message:'Could not save. Your entries are still here.');}finally{setBusy(false);setAction('');}
 };
 const input=(i:CloseItem)=> <div className="flex gap-2 items-center"><Input id={`close-${i.key}`} aria-label={`${i.room} ${i.name} daily total`} type="number" min={i.earlier} step="1" inputMode="numeric" className="w-24" disabled={i.id==='cd_jacket'&&sameSleeves} value={details[i.key]?.used??''} placeholder="—" onChange={e=>change(i.key,e.target.value)}/><Button size="sm" variant="outline" disabled={i.id==='cd_jacket'&&sameSleeves} onClick={()=>change(i.key,String(i.earlier))}>{i.earlier?'Keep earlier':'None'}</Button>{i.cadence==='daily'&&<span className={`text-xs ${!closeMissing([i],details).length?'text-primary':'text-amber-700 dark:text-amber-400'}`}>{!closeMissing([i],details).length?'Complete':'Missing'}</span>}</div>;
 return <section className="space-y-5" aria-label="Daily close">
  <div><h2 className="text-xl font-bold">Daily close</h2><p className="text-sm text-muted-foreground">Night personnel: confirm the whole day from the room sheets. Include reprints.</p></div>
  {readOnly&&<p>Reference only. Ask Honey to correct an older day.</p>}

  {!ctx?<p>{busy?'Loading the day…':'Daily close is unavailable. No entries have been changed.'}</p>:<fieldset disabled={busy||readOnly} className="space-y-6">
   <div className="flex flex-wrap gap-4 justify-between items-end"><label className="text-sm">Closed by<Input value={staff} placeholder="Your full name" onChange={e=>{setStaff(e.target.value);setDirty(true);}}/></label><p role="status" className="text-sm">{dirty?'Unsaved changes':ctx.close?.finished&&ctx.close.stock_token===ctx.token?'Day closed':ctx.close?'Saved — review and close':'Not closed'} · {missing.length} entries left</p></div>
   {ctx.close?.finished&&ctx.close.stock_token!==ctx.token&&<p role="status" className="text-amber-700">Stock changed after this day was closed. Review and close again.</p>}
   <section><h3 className="font-semibold mb-3">Films printed today</h3><div className="flex flex-wrap gap-2 mb-3" role="group" aria-label="Film room">{filmRooms.map(room=><Button key={room} variant={selectedRoom===room?'default':'outline'} aria-pressed={selectedRoom===room} onClick={()=>setSelectedRoom(room)}>{room}{missing.some(i=>i.room===room)&&<span className="text-xs ml-1">· Missing</span>}</Button>)}</div><Button className="mb-3" size="sm" variant="outline" disabled={ctx.items.some(i=>i.room===selectedRoom&&i.earlier>0)} onClick={noRoomActivity}>No activity in this room</Button><div className="overflow-x-auto border rounded-lg"><table className="w-full text-sm"><thead className="bg-muted"><tr><th className="p-3 text-left">Room</th><th className="p-3 text-left">17 × 14 films</th><th className="p-3 text-left">12 × 10 films</th></tr></thead><tbody>{filmRooms.filter(room=>room===selectedRoom).map(room=><tr key={room} className="border-t"><th className="text-left p-3">{room}</th>{['film1714','film1210'].map(id=>{const i=ctx.items.find(x=>x.id===id&&x.room===room);return <td key={id} className="p-3 space-y-2">{i?<>{input(i)}<label className="text-xs text-muted-foreground flex gap-2 items-center mt-2">Patients printed for (required)<Input required aria-label={`${room} ${i.name} daily patients`} className="w-20" type="number" min="0" step="1" inputMode="numeric" placeholder="—" value={details[i.key]?.patients??''} onChange={e=>{const value=e.target.value;setDetails(d=>({...d,[i.key]:{...d[i.key],patients:value===''?undefined:Number(value)}}));setDirty(true);}}/></label></>:'Unavailable'}</td>;})}</tr>)}</tbody></table></div></section>
   <section><h3 className="font-semibold mb-3">CDs and connectors used today — all rooms</h3><div className="overflow-x-auto border rounded-lg"><table className="w-full text-sm"><thead className="bg-muted"><tr><th className="text-left p-3">Item</th><th className="text-left p-3">Daily total</th><th className="text-right p-3">Earlier shifts included</th></tr></thead><tbody>{ctx.items.filter(i=>i.room==='Shared'&&i.cadence==='daily').map(i=><tr key={i.key} className="border-t"><th className="text-left p-3">{i.name} <span className="font-normal text-muted-foreground">({i.unit})</span></th><td className="p-3">{input(i)}{i.id==='cd_jacket'&&<label className="flex gap-2 items-center text-xs mt-2"><input type="checkbox" checked={sameSleeves} onChange={e=>{const match=e.target.checked;if(match&&(details['Shared|cd_jacket']?.used??0)!==(details['Shared|cd']?.used??0)&&(details['Shared|cd_jacket']?.used??0)>0&&!window.confirm('Replace the sleeve quantity with the CD plate quantity?'))return;setSameSleeves(match);if(match){setDetails(d=>({...d,'Shared|cd_jacket':{...d['Shared|cd_jacket'],used:d['Shared|cd']?.used,reviewed:d['Shared|cd']?.reviewed||false}}));setDirty(true);}}}/>Sleeves match plates</label>}</td><td className="p-3 text-right">{i.earlier}</td></tr>)}</tbody></table></div></section>
   <details className="border-t pt-4"><summary className="cursor-pointer font-medium">Any packs or bottles finished today? (optional)</summary><p className="text-sm text-muted-foreground my-3">Enter the day’s finished quantity using the unit shown. For the weekly electrode check, note unopened packs and any open pack in the handover note below. Do not count strips or reset stock to unopened packs alone.</p><div className="space-y-3">{ctx.items.filter(i=>i.cadence==='pack').map(i=><div key={i.key} className="flex gap-4 flex-wrap items-center"><span className="min-w-40 text-sm">{i.name} ({i.unit})</span>{input(i)}</div>)}</div></details>
   <details className="border-t pt-4"><summary className="cursor-pointer font-medium">Estimated Shared balances</summary><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="text-left p-3">Item</th><th className="text-right p-3">Picked today</th><th className="text-right p-3">Estimated left after these entries</th></tr></thead><tbody>{ctx.items.filter((i,n,a)=>a.findIndex(x=>x.id===i.id)===n).map(i=><tr key={i.id} className="border-t"><th className="text-left p-3">{i.name}</th><td className="p-3 text-right">{i.picked}</td><td className="p-3 text-right">{i.remaining-closeExtra(ctx.items,details,i.id)} {i.unit}</td></tr>)}</tbody></table></div><p className="text-xs text-muted-foreground">Calculated from recorded movements. An unknown opening quantity is not included.</p></details>
   <label className="block text-sm max-w-xl">Handover note (optional)<Input value={note} onChange={e=>{setNote(e.target.value);setDirty(true);}}/></label>
   {!dirty&&!busy&&<p className="text-xs text-muted-foreground">Enter or change a value to enable Save progress.</p>}
   <div className="flex gap-3 flex-wrap"><Button disabled={!dirty||busy} onClick={()=>void save(false)}>{action==='Saving progress…'?'Saving…':'Save progress'}</Button><Button variant="secondary" disabled={busy} onClick={()=>void save(true)}>{action==='Closing day…'?'Closing…':'Close day'}</Button><Button variant="outline" onClick={()=>{if(dirty&&!window.confirm('Discard unsaved daily close changes?'))return;localStorage.removeItem(draftKey);void load();}}>Reload day</Button></div>
  </fieldset>}
 <ActionFeedback busy={!!action} busyLabel={action} error={error} success={dirty?'':message} onDismiss={()=>{setError('');setMessage('');}}/>
 </section>;
}
