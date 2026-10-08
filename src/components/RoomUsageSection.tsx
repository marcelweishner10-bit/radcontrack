import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import type { ShiftType } from '@/types/contrast';
import { STOCK_ROOMS, stockLocation, isFilm, roomUnit, bottleCapacity, stockAmount } from '@/lib/roomStock';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function RoomUsageSection({ shift, date, category, selectedRoom, onDirtyChange }: { shift: ShiftType; date: Date; category: 'films' | 'supplies'; selectedRoom?: string; onDirtyChange?: (dirty: boolean) => void }) {
  const dateKey = format(date,'yyyy-MM-dd');
  const [localRoom,setRoom] = useState<string>('CT');
  const room = selectedRoom || localRoom;
  const [items,setItems] = useState<Tables<'stock_items'>[]>([]);
  const [stock,setStock] = useState<Tables<'room_stock'>[]>([]);
  const [quantities,setQuantities] = useState<Record<string,number>>({});
  const [savedQuantities,setSavedQuantities] = useState<Record<string,number>>({});
  const [volumes,setVolumes] = useState<Record<string,{administered_ml?:number;waste_ml?:number;keep_existing?:boolean}>>({});
  const [patients,setPatients] = useState(0);
  const [staff,setStaff] = useState('');
  const [version,setVersion] = useState(0);
  const [loading,setLoading] = useState(true);
  const [loadFailed,setLoadFailed] = useState(true);
  const [saving,setSaving] = useState(false);
  const [message,setMessage] = useState('');
  const [error,setError] = useState('');
  const [dirty,setDirty] = useState(false);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty,onDirtyChange]);
  const draftKey=`radcontrack-usage-units-v1-draft-${dateKey}-${room}-${shift}-${category}`;
  const load = useCallback(async () => {
    setLoading(true); setLoadFailed(true); setError('');
    const [itemResult,stockResult,usageResult] = await Promise.all([
      supabase.from('stock_items').select('*').eq('active',true).order('name'),
      supabase.from('room_stock').select('*').in('room',[room,'Shared']),
      supabase.from('stock_shift_usage').select('*').eq('date',dateKey).eq('room',room).eq('shift',shift).eq('category',category).maybeSingle(),
    ]);
    if(itemResult.error||stockResult.error||usageResult.error) {
      setError(itemResult.error?.message||stockResult.error?.message||usageResult.error?.message||'Unable to load room usage.');
    } else {
      setLoadFailed(false);
      setItems((itemResult.data||[]).filter(item=>isFilm(item.id)===(category==='films')));
      setStock(stockResult.data||[]);
      const row=usageResult.data;
      const values=(row?.quantities||{}) as Record<string,number>;
      const breakdown=(row?.contrast_volumes||{}) as typeof volumes;
      setVolumes(Object.fromEntries(['ct_contrast','mri_contrast','gastrolux'].map(id=>[id,breakdown[id]||(values[id] ? {keep_existing:true} : {administered_ml:0,waste_ml:0})])));
      setQuantities(values); setSavedQuantities(values); setPatients(row?.patients||0);
      setStaff(row?.recorded_by_name||''); setVersion(row?.version||0); setDirty(false); setMessage('');
      try {
        const draft=JSON.parse(localStorage.getItem(draftKey)||'null');
        if(draft&&draft.version===(row?.version||0)){setQuantities(draft.quantities);if(draft.volumes)setVolumes(draft.volumes);setPatients(draft.patients);setStaff(draft.staff);setDirty(true);setMessage('Unsaved draft restored. Review it before saving.');}
      } catch { /* A damaged draft does not overwrite the shared record. */ }
    }
    setLoading(false);
  },[room,dateKey,shift,category,draftKey]);
  useEffect(()=>{ void load(); },[load]);
  useEffect(()=>{if(dirty)localStorage.setItem(draftKey,JSON.stringify({quantities,volumes,patients,staff,version}));},[dirty,draftKey,quantities,volumes,patients,staff,version]);
  useEffect(()=>{
    if(!dirty) return;
    const warn=(event: BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',warn);
    return ()=>window.removeEventListener('beforeunload',warn);
  },[dirty]);
  const save=async()=>{
    setError(''); setMessage('');
    if(staff.trim().length<2) {setError('Enter the name of the staff member recording this usage.');return;}
    setSaving(true);
    const result=await supabase.rpc('save_room_usage_units',{
      p_date:dateKey,p_room:room,p_shift:shift,p_category:category,p_quantities:quantities,p_patients:patients,p_staff:staff.trim(),p_version:version,
      p_volumes:category==='supplies'?volumes:{},
    });
    setSaving(false);
    if(result.error) {setError(result.error.message);return;}
    setVersion(result.data); setSavedQuantities({...quantities}); setDirty(false);
    localStorage.removeItem(draftKey);
    const updated=await supabase.from('room_stock').select('*').in('room',[room,'Shared']);
    if(updated.data) setStock(updated.data);
    setMessage('Saved for the team. Actual use was deducted from this room; the store was not deducted again.');
    window.dispatchEvent(new CustomEvent('radcontrack:film-updated'));
  };
  return <section className="dashboard-card p-5 space-y-4">
    <div><h3 className="font-bold capitalize">{room} · {shift} shift: {category==='films'?'film printing':'supplies actually used'}</h3><p className="text-sm text-muted-foreground">Select a room, enter actual use and save. Leftovers stay in that room for the next shift.</p></div>
    <div className="grid sm:grid-cols-3 gap-4">{!selectedRoom && <div><Label>Room</Label><Select value={room} disabled={dirty||saving} onValueChange={setRoom}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{STOCK_ROOMS.map(option=><SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select></div>}<div><Label>Recorded by</Label><Input value={staff} disabled={loading||saving} onChange={e=>{setStaff(e.target.value);setDirty(true);}} placeholder="Staff full name" /></div>{category==='films'&&<div><Label>Patients printed for</Label><Input type="number" min="0" step="1" value={patients||''} placeholder="0" disabled={loading||saving} onChange={e=>{setPatients(Math.max(0,Math.floor(Number(e.target.value)||0)));setDirty(true);}} /></div>}</div>
    {category==='supplies'&&<p className="text-sm text-muted-foreground">Enter actual ml administered and any ml discarded for CT, MRI and Gastrolux. Bottle equivalents calculate automatically: CT and Gastrolux 100 ml; MRI 15 ml. Usable leftovers stay in the room. Do not round the volume or enter a stock pick as usage.</p>}
    {version > 0 && <p className="rounded-lg border p-3 text-sm">This shift already has a saved record. Change an incorrect quantity or patient count below, then save the correction. Only the difference updates room stock. To reverse an incorrect usage amount, change that amount to 0 and save. Picks and store collections are corrected on the stock page.</p>}
    {error&&<p role="alert" className="text-destructive">{error}</p>}{message&&<p role="status" className="text-sm">{message}</p>}
    {loading?<p>Loading shared usage…</p>:<div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['Item','Used this shift','Room balance'].map(label=><th key={label} className="p-3 text-left">{label}</th>)}</tr></thead><tbody>{items.map(item=>{const balance=stock.find(row=>row.item_id===item.id&&row.room===stockLocation(item.id,room)); const preview=(balance?.balance||0)-(quantities[item.id]||0)+(savedQuantities[item.id]||0);return <tr key={item.id} className="border-t"><td className="p-3">{item.name} ({roomUnit(item.id,item.unit)})</td><td className="p-3">{bottleCapacity(item.id) ? <div className="space-y-2 min-w-64">{volumes[item.id]?.keep_existing ? <><p>Earlier depletion: {stockAmount(item.id,quantities[item.id]||0)}</p><p className="text-xs text-muted-foreground">Administered and waste were not recorded separately.</p><Button size="sm" variant="outline" disabled={saving} onClick={()=>{setVolumes(v=>({...v,[item.id]:{administered_ml:0,waste_ml:0}}));setQuantities(v=>({...v,[item.id]:0}));setDirty(true);}}>Enter volume breakdown</Button></> : <><div className="flex gap-3">{(['administered_ml','waste_ml'] as const).map(field=><label key={field} className="text-xs">{field==='administered_ml'?'Administered (ml)':'Discarded / waste (ml)'}<Input aria-label={room+' '+item.name+' '+field} type="number" min="0" step="0.01" value={volumes[item.id]?.[field]||''} placeholder="0" disabled={saving} onChange={e=>{const value=Number(e.target.value)||0;const updated={...volumes[item.id],[field]:value};setVolumes(v=>({...v,[item.id]:updated}));setQuantities(v=>({...v,[item.id]:Number(((updated.administered_ml||0)+(updated.waste_ml||0)).toFixed(2))}));setDirty(true);}} /></label>)}</div><p className="text-xs">Total depleted: {stockAmount(item.id,quantities[item.id]||0)}</p></>}</div> : <Input aria-label={`${room} ${item.name} used`} type="number" min="0" step="1" className="w-24" value={quantities[item.id]||''} placeholder="0" disabled={saving} onChange={e=>{setQuantities(values=>({...values,[item.id]:Math.max(0,Math.floor(Number(e.target.value)||0))}));setDirty(true);}} />}</td><td className="p-3">{balance?.counted_on?`${stockAmount(item.id,balance.balance)} now; ${stockAmount(item.id,preview)} after saving`:'Full balance awaiting count'}{!balance?.counted_on&&<span className="block text-xs text-muted-foreground">{balance?.balance||0} recorded {roomUnit(item.id,item.unit)} available</span>}</td></tr>})}</tbody></table></div>}
    <div className="flex flex-wrap gap-2"><Button onClick={()=>void save()} disabled={loading||loadFailed||saving||!dirty}>{saving?'Saving…':version > 0 ? 'Save usage correction' : 'Save actual usage'}</Button><Button variant="outline" disabled={saving} onClick={()=>{localStorage.removeItem(draftKey);void load();}}>{dirty?'Discard changes and reload':'Reload shared record'}</Button></div>
    {dirty&&<p className="text-sm text-amber-700">Unsaved changes. Save before changing the room, date or shift.</p>}
  </section>;
}

