import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { STOCK_ROOMS, STOCK_SHIFTS, roomUnit, toRoomUnits, bottleCapacity, stockAmount } from '@/lib/roomStock';
import { useAuth } from '@/hooks/useAuth';
import { lagosToday, stockEntryError, PAST_PICK_WARNING } from '@/lib/stockEntryValidation';
import { AppNavigation, StockNavigation } from '@/components/AppNavigation';

type Item = Tables<'stock_items'>;
type Movement = Tables<'stock_movements'>;
type Correction = Pick<Movement, 'id' | 'item_id' | 'quantity' | 'occurred_on' | 'recipient_name' | 'reference' | 'version' | 'movement_type'> & { source: 'store' | 'room' };
type MovementType = 'receipt' | 'issue' | 'opening' | 'room_count';
type DraftLine = { key: string; itemId: string; quantity: string };
const newLine = (): DraftLine => ({ key: crypto.randomUUID(), itemId: '', quantity: '' });
const typeLabels: Record<MovementType, string> = {
  receipt: 'Stock received', issue: 'Picked for a room', opening: 'Department stock count', room_count: 'Room count',
};
export type StockView = 'pick' | 'receive' | 'count' | 'balances' | 'history' | 'access';
const viewTitles:Record<StockView,string> = {pick:'Pick for a room',receive:'Receive stock',count:'Count what is left',balances:'Stock balances',history:'Movement history',access:'Staff access'};
const viewHelp:Record<StockView,string> = {pick:'Record items taken from department stock into a room. This moves stock; it does not record usage.',receive:'Record what was actually received from the main store and who received it.',count:'Count the items physically present. This replaces the balance at the selected location.',balances:'See what remains in department stock and each room. Uncounted locations are shown clearly.',history:'Review entries and correct mistakes beside the relevant record.',access:'Approve individual staff logins for daily picks and usage.'};

export default function SharedStock({ view = 'pick' }: { view?: StockView }) {
  const { user, canManageStock, canManageStaff, loading: accessLoading } = useAuth();
  const canBackdatePicks = canManageStock && user?.email?.toLowerCase() === 'honey.onabanjo@bthdc.com.ng';
  const today = lagosToday();
  const [items, setItems] = useState<Item[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [roomStock, setRoomStock] = useState<Tables<'room_stock'>[]>([]);
  const [roomMovements, setRoomMovements] = useState<Tables<'room_stock_movements'>[]>([]);
  const [historyLocation,setHistoryLocation] = useState<'store'|'room'>('store');
  const [historyPage,setHistoryPage] = useState(0);
  const [type, setType] = useState<MovementType>('issue');
  useEffect(() => {setType(view === 'receive' ? 'receipt' : view === 'count' ? canManageStock ? 'opening' : 'room_count' : 'issue');}, [view,canManageStock]);
  const [editing, setEditing] = useState<Correction | null>(null);
  const editorRef = useRef<HTMLElement>(null);
  useEffect(()=>{ if (editing) editorRef.current?.scrollIntoView?.({behavior:'smooth',block:'start'}); },[editing]);
  const [editQuantity, setEditQuantity] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editRecipient, setEditRecipient] = useState('');
  const [editReference, setEditReference] = useState('');
  const [editReason, setEditReason] = useState('');
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [staffEmail, setStaffEmail] = useState('');
  const [staffAccessSaving, setStaffAccessSaving] = useState(false);
  const [date, setDate] = useState(new URLSearchParams(window.location.search).get('date') || format(new Date(), 'yyyy-MM-dd'));
  const [recipient, setRecipient] = useState('');
  const [destination, setDestination] = useState(new URLSearchParams(window.location.search).get('room') || '');
  const [shift, setShift] = useState(new URLSearchParams(window.location.search).get('shift') || '');
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([newLine()]);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [requestId,setRequestId] = useState(()=>crypto.randomUUID());

  const refresh = useCallback(async () => {
    setLoading(true);
    let pickQuery = view === 'pick' ? supabase.from('stock_movements').select('*').eq('movement_type','issue').eq('occurred_on',date) : null;
    if (pickQuery && destination) pickQuery = pickQuery.eq('destination',destination);
    if (pickQuery && shift) pickQuery = pickQuery.eq('shift',shift);
    const [itemResult, movementResult, roomResult, roomMovementResult] = await Promise.all([
      supabase.from('stock_items').select('*').eq('active', true).order('name'),
      pickQuery ? pickQuery.order('created_at',{ascending:false}).order('id',{ascending:false}).range(historyPage*50,historyPage*50+49) : view === 'history' && historyLocation === 'store' ? supabase.from('stock_movements').select('*').order('created_at', { ascending: false }).order('id',{ascending:false}).range(historyPage*50,historyPage*50+49) : Promise.resolve({data:[],error:null}),
      supabase.from('room_stock').select('*'),
      view === 'history' && historyLocation === 'room' ? supabase.from('room_stock_movements').select('*').order('created_at', { ascending: false }).order('id',{ascending:false}).range(historyPage*50,historyPage*50+49) : Promise.resolve({data:[],error:null}),
    ]);
    if (itemResult.error || movementResult.error || roomResult.error || roomMovementResult.error) {
      setError(itemResult.error?.message || movementResult.error?.message || roomResult.error?.message || roomMovementResult.error?.message || 'Could not load shared stock.');
    } else {
      setItems(itemResult.data || []);
      setMovements(movementResult.data || []);
      setRoomStock(roomResult.data || []);
      setRoomMovements(roomMovementResult.data || []);
      setError('');
    }
    setLoading(false);
  }, [view,historyLocation,historyPage,date,destination,shift]);
  useEffect(()=>{setHistoryPage(0);setEditing(null);},[date,destination,shift]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 15000);
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [refresh]);

  const selectedLines = useMemo(() => lines.map(line => ({
    item: items.find(item => item.id === line.itemId), quantity: Number(line.quantity),
  })), [items, lines]);

  const setLine = (key: string, patch: Partial<DraftLine>) => {
    setLines(current => current.map(line => line.key === key ? { ...line, ...patch } : line));
    setNotice('');
  };

  const save = async () => {
    setError(''); setNotice('');
    if ((type === 'receipt' || type === 'opening') && !canManageStock) { setError('Only the administrator can manage store receipts and counts.'); return; }
    const validationError = stockEntryError({type,date,today,recipient,destination,shift,confirmed,canBackdatePicks,
      lines:lines.map((line,index)=>({...line,item:selectedLines[index].item}))});
    if (validationError) { setError(validationError); return; }
    if (type === 'issue' && date < today && !window.confirm(PAST_PICK_WARNING)) return;
    const chosen = selectedLines;
    setSaving(true);
    const { error: saveError } = await supabase.rpc('move_room_stock_units', {
      p_type: type,
      p_date: date,
      p_staff: recipient.trim(),
      p_lines: chosen.map(line => ({ item_id: line.item!.id, quantity: line.quantity })),
      p_room: type === 'issue' || type === 'room_count' ? destination : null,
      p_shift: type === 'issue' || type === 'room_count' ? shift : null,
      p_reference: reference.trim() || null,
      p_request: requestId,
    });
    setSaving(false);
    if (saveError) { setError(saveError.message); return; }
    setNotice(`${typeLabels[type]} saved.${type === 'issue' ? ' Stock moved to the room; it has not been consumed.' : ''} Uncounted balances remain awaiting a physical count.`);
    setLines([newLine()]); setReference(''); if(type!=='issue')setDestination(''); setConfirmed(false);
    setRequestId(crypto.randomUUID());
    await refresh();
  };

  const beginCorrection = (row: Correction) => {
    setEditing(row); setEditQuantity(String(row.quantity)); setEditDate(row.occurred_on);
    setEditRecipient(row.recipient_name); setEditReference(row.reference || '');
    setEditReason(''); setDeleteConfirmed(false);
  };
  const editReceipt = async (remove: boolean) => {
    if (!editing || (remove && !deleteConfirmed)) return;
    if (editReason.trim().length < 3) { setError('Enter the reason for this correction.'); return; }
    if (editing.movement_type === 'issue' && (editing.occurred_on < today || editDate < today)) {
      if (!canBackdatePicks) { setError('Only Honey can correct or remove a pick for a past date. Ask Honey to help.'); return; }
      if (!window.confirm(PAST_PICK_WARNING)) return;
    }
    setSaving(true); setError(''); setNotice('');
    const result = await supabase.rpc('correct_stock_movement', { p_source: editing.source, p_id: editing.id, p_version: editing.version, p_quantity: Number(editQuantity), p_date: editDate, p_staff: editRecipient, p_reference: editReference || null, p_reason: editReason.trim(), p_delete: remove });
    setSaving(false);
    if (result.error) { setError(result.error.message.includes('Could not find the function') ? 'The correction database update has not been applied yet. Apply the stock movement corrections SQL first.' : result.error.message); return; }
    setEditing(null); setNotice(remove ? 'Entry removed and affected balances updated. Its audit history is retained.' : editing.movement_type==='issue' ? 'Pick corrected. Additional stock received, room stock and department stock are updated. Reopen the daily entry to see the corrected figures. The original is retained in audit history.' : 'Entry corrected and affected balances updated. The original record is retained in the audit history.');
    await refresh();
  };
  const setStaffAccess = async (active: boolean) => {
    setStaffAccessSaving(true); setError(''); setNotice('');
    const { error } = await supabase.rpc('set_stock_staff', { p_email: staffEmail.trim(), p_active: active });
    setStaffAccessSaving(false);
    if (error) setError(error.message); else { setNotice(active ? 'Staff login approved for daily picks and usage.' : 'Staff access removed.'); setStaffEmail(''); }
  };

  const formVisible = ['pick','receive','count'].includes(view) && (view !== 'receive' || canManageStock);
  return <div className="min-h-screen bg-background">
    <AppNavigation />
    <main className="max-w-6xl mx-auto px-5 py-7 space-y-6">
      <StockNavigation />
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold">{viewTitles[view]}</h1><p className="text-muted-foreground mt-1 max-w-prose">{viewHelp[view]}</p></div><Button variant="outline" onClick={() => void refresh()} disabled={loading}><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button></div>
      {view === 'receive' && !canManageStock && <p role="alert">Receiving stock requires an authorised stock-editor login. You can still record daily picks and usage.</p>}
      {view === 'access' && !canManageStaff && <p role="alert">Staff access requires the administrator login.</p>}
      {error && <div role="alert" className="rounded-lg border border-red-300 bg-red-50 text-red-800 p-4">{error}</div>}
      {notice && <div role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-800 p-4">{notice}</div>}
      {view==='pick' && destination && shift && <Link className="text-primary underline text-sm" to={`/?room=${encodeURIComponent(destination)}&shift=${shift}&date=${date}`}>Return to this room’s daily entry</Link>}

      {formVisible && <section className="dashboard-card p-5 space-y-5">
        {view === 'count' && <div className="flex flex-wrap gap-2">{(['opening','room_count'] as const).filter(option=>canManageStock || option==='room_count').map(option => <Button key={option} type="button" variant={type === option ? 'default' : 'outline'} onClick={() => { setType(option); setConfirmed(false); setDate(format(new Date(), 'yyyy-MM-dd')); }}>{option === 'opening' ? 'In department stock' : 'In a room'}</Button>)}</div>}
        <p className="text-sm text-muted-foreground">Use ml for all contrast, individual films and CD pieces, and packs for gloves. 1 film pack = 100 films. {canManageStock ? 'Your stock-editor login can manage received stock.' : 'Main store collections are managed by the authorised stock editor.'}</p>
        <div className="grid md:grid-cols-3 gap-4">
          <div><Label htmlFor="stock-date">Date</Label><Input id="stock-date" type="date" min={type === 'issue' && !canBackdatePicks ? today : undefined} max={today} value={date} onChange={event => setDate(event.target.value)} /></div>
          <div><Label htmlFor="stock-recipient">{type === 'receipt' ? 'Received by' : type === 'issue' ? 'Picked by' : 'Counted by'}</Label><Input id="stock-recipient" value={recipient} onChange={event => setRecipient(event.target.value)} placeholder="Staff full name" /></div>
          <div><Label htmlFor="stock-reference">Request or receipt reference (optional)</Label><Input id="stock-reference" value={reference} onChange={event => setReference(event.target.value)} placeholder="For example, STR-202609-00110" /></div>
        </div>
        {(type === 'issue' || type === 'room_count') && <div className="grid sm:grid-cols-2 gap-4 max-w-xl"><div><Label>Room</Label><Select value={destination} onValueChange={setDestination}><SelectTrigger aria-label="Room"><SelectValue placeholder="Choose room" /></SelectTrigger><SelectContent>{STOCK_ROOMS.map(room => <SelectItem key={room} value={room}>{room}</SelectItem>)}</SelectContent></Select></div>{(type === 'issue' || type === 'room_count') && <div><Label>{type === 'issue' ? 'Shift receiving this pick' : 'Shift of this count'}</Label><Select value={shift} onValueChange={setShift}><SelectTrigger aria-label="Shift receiving this pick"><SelectValue placeholder="Choose shift" /></SelectTrigger><SelectContent>{STOCK_SHIFTS.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select></div>}</div>}
        {(type === 'opening' || type === 'room_count') && <p className="text-sm text-amber-800 bg-amber-50 rounded-lg p-3">Count what is physically here now, including any recent collections. This replaces the recorded balance at this location; it does not add more stock. Room film counts use individual films, not packs.</p>}
        {type === 'receipt' && <p className="text-sm text-muted-foreground">You can save a collection before counting existing stock. The full balance will remain unconfirmed until counted. Do not add a collection again if a later physical count already included it.</p>}
        {type === 'issue' && <p className="text-sm text-muted-foreground">{canBackdatePicks ? 'Past-date picks require confirmation because they change carried-forward balances.' : 'Record room picks for today. Ask Honey to record or correct a pick for a past date.'}</p>}
        <div className="space-y-3"><div className="flex items-center justify-between"><h4 className="font-semibold">Items</h4><Button type="button" variant="outline" size="sm" onClick={() => setLines(current => [...current, newLine()])}><Plus className="w-4 h-4 mr-1" />Add item</Button></div>
          {lines.map((line, index) => { const item=items.find(candidate => candidate.id === line.itemId); const quantity=Number(line.quantity) || 0; return <div key={line.key} className="grid sm:grid-cols-[minmax(0,1fr)_9rem_10rem_2.5rem] gap-3 items-end rounded-lg border p-3">
            <div><Label>Item {index + 1}</Label><Select value={line.itemId} onValueChange={value => setLine(line.key, { itemId: value })}><SelectTrigger aria-label={`Item ${index + 1}`}><SelectValue placeholder="Choose item" /></SelectTrigger><SelectContent>{items.map(candidate => <SelectItem key={candidate.id} value={candidate.id}>{candidate.name} ({candidate.unit})</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Quantity {item ? `(${item.unit})` : ''}</Label><Input aria-label={`Quantity for item ${index + 1}`} type="number" min={type === 'opening' || type === 'room_count' ? '0' : item && bottleCapacity(item.id) ? '0.01' : '1'} step={item && bottleCapacity(item.id) ? '0.01' : '1'} value={line.quantity} onChange={event => setLine(line.key, { quantity: event.target.value })} /></div>
            <div className="text-sm text-muted-foreground">{item ? type === 'room_count' ? `Room count: ${quantity} ${roomUnit(item.id,item.unit)}` : <><span>Department stock: {item.opening_recorded ? `${item.balance} ${item.unit}` : 'balance awaiting stock count'}</span><br />{type === 'opening' ? `Counted now: ${quantity} ${item.unit}` : type === 'issue' ? `To room: ${toRoomUnits(item.id,quantity)} ${roomUnit(item.id,item.unit)}` : `Adding: ${quantity} ${item.unit}`}</> : 'Select an item'}</div>
            <Button type="button" variant="ghost" size="icon" aria-label={`Remove item ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines(current => current.filter(candidate => candidate.key !== line.key))}><Trash2 className="w-4 h-4" /></Button>
          </div>; })}
        </div>
        <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="h-4 w-4 accent-primary" /><span>I confirm these quantities were {type === 'receipt' ? 'actually received' : type === 'issue' ? 'actually picked' : 'physically counted'}.</span></label>
        <Button onClick={() => void save()} disabled={saving || loading || accessLoading || items.length === 0}><Save className="w-4 h-4 mr-2" />{saving ? 'Saving…' : type === 'receipt' ? 'Save received stock' : type === 'issue' ? 'Save room pick' : 'Save physical count'}</Button>
        <p className="text-sm text-muted-foreground">Made a mistake? Open <Link className="text-primary underline" to="/stock/history">Movement history</Link> to correct an earlier entry.</p>
      </section>}

      {editing && <section ref={editorRef} className="dashboard-card p-5 space-y-4" aria-label="Correct stock entry">
        <h3 className="font-bold text-lg">Correct stock entry: {items.find(item=>item.id===editing.item_id)?.name || editing.item_id}</h3>
        <p className="text-sm text-muted-foreground">{editing.movement_type === 'issue' ? 'A pick correction updates department stock and the receiving room by equal, opposite amounts.' : 'A correction updates the affected balance and keeps the original record in the audit history.'} Older entries covered by a newer physical count require a new count instead.</p>
        <div className="grid md:grid-cols-4 gap-3"><label>Date<Input type="date" disabled={editing.movement_type === 'opening' || editing.movement_type === 'count'} value={editDate} onChange={e=>setEditDate(e.target.value)} /></label><label>Quantity ({items.find(item=>item.id===editing.item_id)?.unit})<Input type="number" min={editing.movement_type === 'opening' || editing.movement_type === 'count' ? '0' : bottleCapacity(editing.item_id)?'0.01':'1'} step={bottleCapacity(editing.item_id)?'0.01':'1'} value={editQuantity} onChange={e=>setEditQuantity(e.target.value)} /></label><label>Received, picked or counted by<Input value={editRecipient} onChange={e=>setEditRecipient(e.target.value)} /></label>{editing.source === 'store' && <label>Reference<Input value={editReference} onChange={e=>setEditReference(e.target.value)} /></label>}</div>
        <label className="block">Reason for correction<Input value={editReason} onChange={e=>setEditReason(e.target.value)} placeholder="For example, entered 10000 instead of 100 films" /></label>
        {editing.item_id.startsWith('film') && <p className="text-sm text-muted-foreground">{Number(editQuantity) || 0} films = {(Number(editQuantity) || 0) / 100} packs (100 films per pack).</p>}
        {error && <p role="alert" className="text-destructive">{error}</p>}
        <div className="flex gap-3"><Button disabled={saving} onClick={()=>void editReceipt(false)}>Save correction</Button><Button disabled={saving} variant="outline" onClick={()=>setEditing(null)}>Cancel</Button></div>
        {['receipt','issue'].includes(editing.movement_type) ? <><label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={deleteConfirmed} onChange={e=>setDeleteConfirmed(e.target.checked)} />Remove this entry and reverse its stock movement</label><Button variant="destructive" disabled={saving||!deleteConfirmed} onClick={()=>void editReceipt(true)}>Delete entry</Button></> : <p className="text-sm text-muted-foreground">Counts establish the stock baseline. Correct the quantity; counts cannot be deleted.</p>}
      </section>}
      {view === 'access' && canManageStaff && <section className="dashboard-card p-5 space-y-3"><h3 className="font-bold text-lg">Staff login access</h3><p className="text-sm text-muted-foreground">Staff create and confirm their own login on the sign-in page. Approve their email here to allow daily picks and usage. Staff cannot add, edit or delete store collections.</p><label>Staff email<Input type="email" value={staffEmail} onChange={e=>setStaffEmail(e.target.value)} placeholder="Staff member’s personal email" /></label><div className="flex gap-3"><Button disabled={staffAccessSaving||!staffEmail.trim()} onClick={()=>void setStaffAccess(true)}>Approve staff login</Button><Button variant="outline" disabled={staffAccessSaving||!staffEmail.trim()} onClick={()=>void setStaffAccess(false)}>Remove staff access</Button></div></section>}
      {view === 'balances' && <>
      <section aria-label="Store and room balances" className="space-y-4"><p className="text-sm text-muted-foreground">All locations use the same units. A pick moves stock between locations. Uncounted locations prevent a confirmed total.</p>
        {loading ? <p role="status">Loading balances…</p> : items.length === 0 ? <p>No stock items are available yet.</p> : <div className="divide-y border-y">{items.map(item => {
          const rooms=STOCK_ROOMS.map(room => roomStock.find(row => row.room===room && row.item_id===item.id));
          const total=item.balance+rooms.reduce((sum,row) => sum+(row?.balance || 0),0);
          const known=item.opening_recorded && rooms.every(row => row?.counted_on);
          return <article key={item.id} className="py-5"><h2 className="font-semibold mb-3">{item.name} <span className="text-sm font-normal text-muted-foreground">({item.unit})</span></h2><dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            <div><dt className="text-sm text-muted-foreground">Department stock</dt><dd className="font-medium">{item.opening_recorded ? item.balance : 'Awaiting count'}</dd></div>
            {rooms.map((row,index) => <div key={STOCK_ROOMS[index]}><dt className="text-sm text-muted-foreground">{STOCK_ROOMS[index]}</dt><dd className="font-medium">{row?.counted_on ? row.balance : 'Awaiting count'}</dd></div>)}
            <div><dt className="text-sm text-muted-foreground">Total left</dt><dd className="font-semibold">{known ? Number(total.toFixed(2)) : 'Unconfirmed'}</dd></div>
          </dl></article>;
        })}</div>}
        <p className="text-sm text-muted-foreground">If a balance needs checking, <Link className="text-primary underline" to="/stock/count">count what is left</Link> at that location. 100 films make one pack.</p>
      </section>
      </>}
      {(view === 'history'||view==='pick') && <>
        {view==='history'&&<div className="flex flex-wrap gap-2"><Button variant={historyLocation === 'store' ? 'default' : 'outline'} onClick={() => {setHistoryLocation('store');setHistoryPage(0);setEditing(null);}}>Department entries and daily picks</Button><Button variant={historyLocation === 'room' ? 'default' : 'outline'} onClick={() => {setHistoryLocation('room');setHistoryPage(0);setEditing(null);}}>Room counts and usage</Button></div>}
      {historyLocation === 'room' && <section className="dashboard-card overflow-hidden"><div className="p-5 border-b"><h3 className="font-bold text-lg">Room picks, usage and counts</h3><p className="text-sm text-muted-foreground">Correct room counts here. Edit daily picks under Recent department movements. To correct actual usage, reopen its date, room and shift on the <Link className="underline" to="/">daily entry page</Link>.</p></div>
        <div className="divide-y">{roomMovements.map(row => <article key={row.id} className="p-5 space-y-3">
          <div className="flex flex-wrap justify-between gap-3"><div><h4 className="font-semibold">{items.find(item => item.id === row.item_id)?.name || row.item_id}</h4><p className="text-sm text-muted-foreground">{row.occurred_on} · {row.room} · {row.shift} · {row.voided_at ? 'Deleted pick' : row.movement_type}</p></div>
            {row.movement_type === 'count' && !row.voided_at && (canManageStock || row.recorded_by === user?.id) && <Button size="sm" variant="outline" disabled={saving || loading} onClick={() => beginCorrection({source:'room',id:row.id,item_id:row.item_id,quantity:row.balance_after,occurred_on:row.occurred_on,recipient_name:row.staff_name,reference:null,version:row.version,movement_type:'count'})}>Correct room count</Button>}
          </div><dl className="grid sm:grid-cols-3 gap-3 text-sm"><div><dt className="text-muted-foreground">Change</dt><dd>{row.change > 0 ? '+' : ''}{stockAmount(row.item_id,row.change)}</dd></div><div><dt className="text-muted-foreground">Room balance when recorded</dt><dd>{row.balance_known ? stockAmount(row.item_id,row.balance_after) : 'Awaiting count'}</dd></div><div><dt className="text-muted-foreground">Recorded by</dt><dd>{row.staff_name}</dd></div></dl>
        </article>)}{!loading && roomMovements.length === 0 && <p className="p-5 text-muted-foreground">No room movements recorded yet.</p>}</div>
      </section>}
      {historyLocation === 'store' && <section className="dashboard-card overflow-hidden"><div className="p-5 border-b"><h3 className="font-bold text-lg">{view==='pick'?'Picks for this date':'Recent department movements'}</h3><p className="text-sm text-muted-foreground">{view==='pick'?'Choose the date, room and shift above to find a pick. Edit an incorrect quantity here; the daily entry’s Additional Stock Received and affected balances adjust automatically. Reopen the daily entry after saving.':'Edit collections and daily picks, or correct a stock count here. Original records remain in the audit history.'}</p></div>
        <div className="divide-y">{movements.map(row => <article key={row.id} className="p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h4 className="font-semibold">{items.find(item => item.id === row.item_id)?.name || row.item_id}</h4><p className="text-sm text-muted-foreground">{row.occurred_on} · {row.voided_at ? 'Deleted entry' : typeLabels[row.movement_type as MovementType]}</p></div>
            {!row.voided_at && (row.movement_type === 'issue' ? (row.occurred_on < today ? canBackdatePicks : canManageStock || row.recorded_by === user?.id) : canManageStock) && <Button variant="outline" size="sm" disabled={saving || loading} onClick={() => beginCorrection({ ...row, source: 'store' })}>{view==='pick'?'Edit pick':row.movement_type === 'opening' ? 'Correct count' : 'Edit / delete'}</Button>}
          </div>
          <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
            <div><dt className="text-muted-foreground">Quantity</dt><dd>{row.quantity} {items.find(item => item.id === row.item_id)?.unit}</dd></div>
            <div><dt className="text-muted-foreground">Balance when recorded</dt><dd>{row.balance_known ? `${row.balance_after} ${items.find(item => item.id === row.item_id)?.unit}` : 'Awaiting count'}</dd></div>
            <div><dt className="text-muted-foreground">Received or picked by</dt><dd className="break-words">{row.recipient_name}</dd></div>
            <div><dt className="text-muted-foreground">Destination</dt><dd>{[row.destination,row.shift].filter(Boolean).join(' · ') || '—'}</dd></div>
            <div><dt className="text-muted-foreground">Reference</dt><dd className="break-words">{row.reference || '—'}</dd></div>
          </dl>
          {view==='pick'&&row.destination&&row.shift&&<Link className="text-primary underline text-sm" to={`/?date=${row.occurred_on}&room=${encodeURIComponent(row.destination)}&shift=${row.shift}`}>Open this room’s daily entry</Link>}
        </article>)}{!loading && movements.length === 0 && <p className="p-5 text-muted-foreground">No shared movements recorded yet.</p>}</div>
      </section>}
        <div className="flex items-center gap-3"><Button variant="outline" disabled={loading || historyPage === 0} onClick={() => {setHistoryPage(page => page-1);setEditing(null);}}>Newer entries</Button><span className="text-sm text-muted-foreground">Page {historyPage+1}</span><Button variant="outline" disabled={loading || (historyLocation === 'store' ? movements : roomMovements).length < 50} onClick={() => {setHistoryPage(page => page+1);setEditing(null);}}>Older entries</Button></div>
      </>}
    </main>
  </div>;
}



