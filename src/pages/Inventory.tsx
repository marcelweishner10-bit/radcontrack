import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { ArrowLeft, Boxes, CalendarDays, CheckCircle2, PackagePlus, Save, TrendingDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { TrackRadBrand } from '@/components/TrackRadBrand';

type StockItem = { id: string; name: string; unit: string; opening: number; received: number; used: number; adjusted?: number; minimum: number };
type IssueEntry = { id: string; date: string; item: string; itemName: string; unit: string; quantity: number; expectedBalance: number; recordedBalance: number | null; issuedBy: string; signed: boolean };
type AdjustmentEntry = { id: string; date: string; itemName: string; unit: string; previousBalance: number; countedBalance: number; difference: number; reason: string; recordedBy: string };
const balanceOf = (item: StockItem) => item.opening + item.received - item.used + (item.adjusted || 0);

const initialItems: StockItem[] = [
  { id: 'scanlux', name: 'Scanlux contrast', unit: 'bottles', opening: 0, received: 0, used: 0, minimum: 10 },
  { id: 'gastrolux', name: 'Gastrolux contrast', unit: 'bottles', opening: 0, received: 0, used: 0, minimum: 5 },
  { id: 'mri', name: 'MRI contrast (15 ml)', unit: 'bottles', opening: 0, received: 0, used: 0, minimum: 10 },
  { id: 'film1714', name: 'APEX / AGFA film 17 × 14', unit: 'packets', opening: 0, received: 0, used: 0, minimum: 2 },
  { id: 'film1210', name: 'APEX / AGFA film 12 × 10', unit: 'packets', opening: 0, received: 0, used: 0, minimum: 2 },
  { id: 'cd', name: 'Recordable CDs', unit: 'pieces', opening: 0, received: 0, used: 0, minimum: 20 },
  { id: 'gloves', name: 'Gloves', unit: 'packets', opening: 0, received: 0, used: 0, minimum: 3 },
  { id: 'cannula', name: 'Cannula', unit: 'pieces', opening: 0, received: 0, used: 0, minimum: 20 },
];

const today = format(new Date(), 'yyyy-MM-dd');

export default function Inventory() {
  const { toast } = useToast();
  const [items, setItems] = useState<StockItem[]>(() => {
    const saved = localStorage.getItem('radcontrack-inventory');
    return saved ? JSON.parse(saved) : initialItems;
  });
  const [date, setDate] = useState(today);
  const [entryItem, setEntryItem] = useState(initialItems[0].id);
  const [entryType, setEntryType] = useState<'received' | 'used' | 'adjustment'>('used');
  const [quantity, setQuantity] = useState('');
  const [balanceLeft, setBalanceLeft] = useState('');
  const [issuedBy, setIssuedBy] = useState('');
  const [signed, setSigned] = useState(false);
  const [reason, setReason] = useState('');
  const [issueLog, setIssueLog] = useState<IssueEntry[]>(() => JSON.parse(localStorage.getItem('radcontrack-issue-register') || '[]'));
  const [adjustmentLog, setAdjustmentLog] = useState<AdjustmentEntry[]>(() => JSON.parse(localStorage.getItem('radcontrack-adjustments') || '[]'));
  const selectedItem = items.find(item => item.id === entryItem) ?? items[0];
  const enteredQuantity = Number(quantity) || 0;
  const automaticBalance = entryType === 'adjustment' ? enteredQuantity : balanceOf(selectedItem) + (entryType === 'received' ? enteredQuantity : -enteredQuantity);

  useEffect(() => localStorage.setItem('radcontrack-inventory', JSON.stringify(items)), [items]);
  useEffect(() => localStorage.setItem('radcontrack-issue-register', JSON.stringify(issueLog)), [issueLog]);
  useEffect(() => localStorage.setItem('radcontrack-adjustments', JSON.stringify(adjustmentLog)), [adjustmentLog]);

  const totals = useMemo(() => items.reduce((a, item) => {
    const balance = balanceOf(item);
    if (item.opening === 0 && item.received === 0 && item.used === 0 && !item.adjusted) a.notSet += 1;
    else if (balance <= item.minimum) a.low += 1;
    return a;
  }, { low: 0, notSet: 0 }), [items]);

  const printedFilms = ['morning', 'afternoon', 'night'].reduce((totals, shift) => {
    let saved: Record<string, Record<string, number>> = {};
    try { saved = JSON.parse(localStorage.getItem(`radcontrack-film-${date}-${shift}`) || '{}'); } catch { /* no local film data */ }
    for (const room of Object.values(saved)) {
      totals.film1714 += Number(room['17 × 14']) || 0;
      totals.film1210 += Number(room['12 × 10']) || 0;
    }
    return totals;
  }, { film1714: 0, film1210: 0 });

  const update = (id: string, field: keyof Pick<StockItem, 'opening' | 'received' | 'used' | 'minimum'>, value: string) => {
    setItems(current => current.map(item => item.id === id ? { ...item, [field]: Math.max(0, Number(value) || 0) } : item));
  };

  const logEntry = () => {
    const amount = Number(quantity);
    if (!Number.isInteger(amount) || amount < 0 || (entryType !== 'adjustment' && amount === 0)) {
      toast({ title: entryType === 'adjustment' ? 'Enter a valid whole physical count' : 'Enter a whole quantity greater than zero' });
      return;
    }
    const selected = items.find(item => item.id === entryItem)!;
    const previousBalance = balanceOf(selected);
    const expectedBalance = previousBalance + (entryType === 'received' ? amount : -amount);
    if (entryType === 'used' && expectedBalance < 0) {
      toast({ title: 'Not enough stock', description: `Available balance is ${previousBalance} ${selected.unit}.` });
      return;
    }
    if (entryType !== 'received' && (!issuedBy.trim() || !signed || (entryType === 'adjustment' && !reason.trim()))) {
      toast({ title: 'Complete the record', description: 'Enter the staff name, confirm the entry, and provide a reason for any adjustment.' });
      return;
    }
    setItems(current => current.map(item => item.id === entryItem ? entryType === 'adjustment' ? { ...item, adjusted: (item.adjusted || 0) + amount - balanceOf(item) } : { ...item, [entryType]: item[entryType] + amount } : item));
    const history = JSON.parse(localStorage.getItem('radcontrack-stock-history') || '[]');
    localStorage.setItem('radcontrack-stock-history', JSON.stringify([...history, { date, item: entryItem, type: entryType, quantity: amount, reason: reason.trim(), recordedBy: issuedBy.trim() }]));
    if (entryType === 'used') {
      setIssueLog(current => [{ id: crypto.randomUUID(), date, item: selected.id, itemName: selected.name, unit: selected.unit, quantity: amount, expectedBalance, recordedBalance: balanceLeft === '' ? null : Number(balanceLeft), issuedBy: issuedBy.trim(), signed }, ...current]);
    }
    if (entryType === 'adjustment') setAdjustmentLog(current => [{ id: crypto.randomUUID(), date, itemName: selected.name, unit: selected.unit, previousBalance, countedBalance: amount, difference: amount - previousBalance, reason: reason.trim(), recordedBy: issuedBy.trim() }, ...current]);
    setQuantity('');
    setBalanceLeft('');
    setIssuedBy('');
    setSigned(false);
    setReason('');
    toast({ title: 'Entry saved', description: entryType === 'adjustment' ? `Physical count saved at ${amount} ${selected.unit}.` : `${amount} ${selected.unit} ${entryType === 'used' ? 'issued' : 'received'} on ${date}. Balance updated automatically.` });
  };

  return <div className="min-h-screen bg-background">
    <nav className="dashboard-nav sticky top-0 z-50 shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3"><TrackRadBrand /><div><p className="text-white font-bold leading-tight">TrackRad</p><p className="text-white/60 text-xs">Store & Stock</p></div></div>
        <div className="flex items-center gap-2"><Button asChild variant="ghost" className="text-white hover:bg-white/10 hover:text-white"><Link to="/"><ArrowLeft className="h-4 w-4 mr-2" />Daily Log</Link></Button><Button asChild variant="ghost" className="text-white hover:bg-white/10 hover:text-white"><Link to="/stock">Shared stock</Link></Button><Button asChild variant="ghost" className="text-white hover:bg-white/10 hover:text-white"><Link to="/usage">Reports</Link></Button></div>
      </div>
    </nav>

    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-7 space-y-6">
      <div><p className="text-sm text-muted-foreground">Inventory overview</p><h1 className="text-2xl font-bold">Store issues and reconciliation</h1><p className="text-sm text-muted-foreground mt-1">Balances are shown by item and its own unit.</p></div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Items tracked', value: items.length, Icon: Boxes },
          { label: 'Store issues recorded', value: issueLog.length, Icon: PackagePlus },
          { label: 'Low stock items', value: totals.low, Icon: TrendingDown },
          { label: 'Awaiting opening count', value: totals.notSet, Icon: CalendarDays },
        ].map(({ label, value, Icon }) => <div key={label} className="dashboard-card p-5"><div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">{label}</p><Icon className="h-5 w-5 text-primary" /></div><p className="text-3xl font-bold mt-2">{value}</p></div>)}
      </div>

      <section className="dashboard-card p-5">
        <div className="flex flex-wrap justify-between gap-3 items-start"><div><h2 className="font-bold text-lg">Film sheets printed on {date}</h2><p className="text-sm text-muted-foreground">Recorded in the Daily Log across all shifts and rooms. Store packets remain a separate unit.</p></div><Link to="/" className="text-sm font-semibold text-primary underline">Open Daily Log</Link></div>
        <div className="grid grid-cols-2 gap-3 mt-4 max-w-xl"><div className="rounded-xl bg-muted/50 p-4"><p className="text-sm text-muted-foreground">17 × 14</p><p className="text-2xl font-bold">{printedFilms.film1714} <span className="text-sm font-normal">sheets</span></p></div><div className="rounded-xl bg-muted/50 p-4"><p className="text-sm text-muted-foreground">12 × 10</p><p className="text-2xl font-bold">{printedFilms.film1210} <span className="text-sm font-normal">sheets</span></p></div></div>
      </section>

      <section className="dashboard-card p-5">
        <div className="mb-4"><h2 className="font-bold text-lg">Log store movement</h2><p className="text-sm text-muted-foreground">Each entry immediately updates the balance in hand.</p></div>
        <div className="grid md:grid-cols-5 gap-3 items-end">
          <div><Label>Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          <div><Label>Item</Label><Select value={entryItem} onValueChange={setEntryItem}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{items.map(i => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>Movement</Label><Select value={entryType} onValueChange={v => setEntryType(v as 'received' | 'used' | 'adjustment')}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="used">Issued from store</SelectItem><SelectItem value="received">Received into store</SelectItem><SelectItem value="adjustment">Physical count adjustment</SelectItem></SelectContent></Select></div>
          <div><Label>{entryType === 'adjustment' ? 'Counted balance' : 'Quantity'} ({selectedItem.unit})</Label><Input type="number" min={entryType === 'adjustment' ? '0' : '1'} step="1" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="0" /></div>
          <Button onClick={logEntry}><Save className="h-4 w-4 mr-2" />Save entry</Button>
        </div>
        {entryType === 'used' && <div className="mt-4 rounded-xl border bg-muted/30 p-4">
          <p className="font-semibold mb-3">Store issue acknowledgement</p>
          <div className="grid md:grid-cols-3 gap-3">
            <div><Label>Balance left (automatic)</Label><div className="h-10 rounded-md border bg-muted px-3 flex items-center font-bold">{automaticBalance} <span className="ml-1 text-xs font-normal text-muted-foreground">{selectedItem.unit}</span></div></div>
            <div><Label>Picked / issued to</Label><Input value={issuedBy} onChange={e => setIssuedBy(e.target.value)} placeholder="Staff full name" /></div>
            <label className="flex items-center gap-3 rounded-lg border bg-background px-4 h-10 mt-5 cursor-pointer"><input type="checkbox" checked={signed} onChange={e => setSigned(e.target.checked)} className="h-4 w-4 accent-primary" /><span className="text-sm font-medium">I confirm this issue</span></label>
          </div>
          <div className="mt-3 max-w-sm"><Label>Optional physical count</Label><Input type="number" min="0" value={balanceLeft} onChange={e => setBalanceLeft(e.target.value)} placeholder="Only enter this when stock was counted" /><p className="text-xs text-muted-foreground mt-1">Used only to flag a difference from the automatic balance.</p></div>
        </div>}
        {entryType === 'adjustment' && <div className="mt-4 rounded-xl border bg-muted/30 p-4 space-y-3"><p className="font-semibold">Physical count adjustment</p><p className="text-sm text-muted-foreground">Calculated balance: <strong className="text-foreground">{balanceOf(selectedItem)} {selectedItem.unit}</strong>. Counted balance: <strong className="text-foreground">{automaticBalance} {selectedItem.unit}</strong>.</p><div className="grid md:grid-cols-3 gap-3"><div><Label>Reason for difference</Label><Input value={reason} onChange={e => setReason(e.target.value)} placeholder="For example, monthly stock count" /></div><div><Label>Recorded by</Label><Input value={issuedBy} onChange={e => setIssuedBy(e.target.value)} placeholder="Staff full name" /></div><label className="flex items-center gap-3 rounded-lg border bg-background px-4 h-10 mt-5 cursor-pointer"><input type="checkbox" checked={signed} onChange={e => setSigned(e.target.checked)} className="h-4 w-4 accent-primary" /><span className="text-sm font-medium">I confirm this count</span></label></div></div>}
      </section>

      {adjustmentLog.length > 0 && <section className="dashboard-card overflow-hidden"><div className="p-5 border-b"><h2 className="font-bold text-lg">Physical count adjustments</h2></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted/60 text-left"><tr>{['Date', 'Item', 'Before', 'Counted', 'Difference', 'Reason', 'Recorded by'].map(heading => <th key={heading} className="px-4 py-3 font-semibold whitespace-nowrap">{heading}</th>)}</tr></thead><tbody>{adjustmentLog.map(entry => <tr key={entry.id} className="border-t"><td className="px-4 py-3">{entry.date}</td><td className="px-4 py-3">{entry.itemName}</td><td className="px-4 py-3">{entry.previousBalance} {entry.unit}</td><td className="px-4 py-3">{entry.countedBalance} {entry.unit}</td><td className="px-4 py-3">{entry.difference > 0 ? '+' : ''}{entry.difference}</td><td className="px-4 py-3">{entry.reason}</td><td className="px-4 py-3">{entry.recordedBy}</td></tr>)}</tbody></table></div></section>}

      <section className="dashboard-card overflow-hidden">
        <div className="p-5 border-b"><h2 className="font-bold text-lg">Daily store issue register</h2><p className="text-sm text-muted-foreground">Date, item picked, quantity, automatic balance, and staff confirmation.</p></div>
        {issueLog.length === 0 ? <div className="p-8 text-center text-muted-foreground">No items have been issued yet.</div> : <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-muted/60 text-left"><tr>{['Date', 'Item picked', 'Qty', 'Calculated balance', 'Physical count', 'Difference', 'Confirmed by'].map(h => <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
          <tbody>{issueLog.map(entry => { const hasCount = entry.recordedBalance !== null && entry.recordedBalance !== undefined; const difference = hasCount ? Number(entry.recordedBalance) - entry.expectedBalance : 0; return <tr key={entry.id} className="border-t">
            <td className="px-4 py-3 whitespace-nowrap">{new Date(`${entry.date}T12:00:00`).toLocaleDateString()}</td>
            <td className="px-4 py-3 font-medium">{entry.itemName}</td>
            <td className="px-4 py-3">{entry.quantity} {entry.unit}</td>
            <td className="px-4 py-3 font-semibold">{entry.expectedBalance}</td>
            <td className="px-4 py-3 font-semibold">{hasCount ? entry.recordedBalance : 'Not counted'}</td>
            <td className={`px-4 py-3 font-bold ${!hasCount ? 'text-muted-foreground' : difference === 0 ? 'text-emerald-600' : 'text-destructive'}`}>{!hasCount ? '—' : difference === 0 ? 'Matched' : `${difference > 0 ? '+' : ''}${difference}`}</td>
            <td className="px-4 py-3"><span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-emerald-600" />{entry.issuedBy}</span></td>
          </tr>})}</tbody>
        </table></div>}
      </section>

      <section className="dashboard-card overflow-hidden">
        <div className="p-5 border-b"><h2 className="font-bold text-lg">Reconciliation chart</h2><p className="text-sm text-muted-foreground">Balance = opening stock + received − issued + physical count adjustments. Set an opening count before the first movement.</p></div>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-muted/60 text-left"><tr>{['Item', 'Unit', 'Opening', 'Received', 'Issued', 'Adjustment', 'Balance in hand', 'Minimum', 'Status'].map(h => <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
          <tbody>{items.map(item => { const balance = balanceOf(item); const low = balance <= item.minimum; return <tr key={item.id} className="border-t">
            <td className="px-4 py-3 font-medium min-w-56">{item.name}</td><td className="px-4 py-3 text-muted-foreground">{item.unit}</td>
            <td className="px-2 py-2"><Input aria-label={`${item.name} opening stock`} className="w-24" type="number" min="0" value={item.opening} disabled={item.received > 0 || item.used > 0} onChange={e => update(item.id, 'opening', e.target.value)} /></td>
            <td className="px-4 py-3">{item.received}</td><td className="px-4 py-3">{item.used}</td><td className="px-4 py-3">{item.adjusted || 0}</td>
            <td className="px-4 py-3"><span className={`text-lg font-bold ${balance < 0 ? 'text-destructive' : ''}`}>{balance}</span> <span className="text-xs text-muted-foreground">{item.unit}</span></td>
            <td className="px-2 py-2"><Input className="w-20" type="number" min="0" value={item.minimum} onChange={e => update(item.id, 'minimum', e.target.value)} /></td>
            <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${low ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>{item.opening === 0 && item.received === 0 && item.used === 0 ? 'Set opening count' : low ? 'Reorder' : 'In stock'}</span></td>
          </tr>})}</tbody>
        </table></div>
      </section>
    </main>
  </div>;
}
