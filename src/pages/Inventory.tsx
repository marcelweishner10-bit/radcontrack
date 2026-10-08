import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Boxes, CalendarDays, CheckCircle2, PackagePlus, TrendingDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AppNavigation } from '@/components/AppNavigation';

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
  const [items] = useState<StockItem[]>(() => {
    const saved = localStorage.getItem('radcontrack-inventory');
    return saved ? JSON.parse(saved) : initialItems;
  });
  const [date, setDate] = useState(today);
  const [issueLog] = useState<IssueEntry[]>(() => JSON.parse(localStorage.getItem('radcontrack-issue-register') || '[]'));
  const [adjustmentLog] = useState<AdjustmentEntry[]>(() => JSON.parse(localStorage.getItem('radcontrack-adjustments') || '[]'));
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

  return <div className="min-h-screen bg-background">
    <AppNavigation />

    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-7 space-y-6">
      <div><h1 className="text-2xl font-bold">Old records — reference only</h1><p className="text-sm text-muted-foreground mt-2">These earlier records are saved only in this browser on this device. They do not update current department or room balances. Entries cannot be added, edited or deleted here.</p><Link to="/stock/balances" className="inline-block text-primary underline mt-3">View current shared stock balances</Link></div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Items tracked', value: items.length, Icon: Boxes },
          { label: 'Store issues recorded', value: issueLog.length, Icon: PackagePlus },
          { label: 'Low stock items', value: totals.low, Icon: TrendingDown },
          { label: 'Awaiting opening count', value: totals.notSet, Icon: CalendarDays },
        ].map(({ label, value, Icon }) => <div key={label} className="dashboard-card p-5"><div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">{label}</p><Icon className="h-5 w-5 text-primary" /></div><p className="text-3xl font-bold mt-2">{value}</p></div>)}
      </div>

      <section className="dashboard-card p-5">
        <label className="block mb-4 max-w-xs">View earlier film date<Input aria-label="View earlier film date" type="date" value={date} onChange={e=>setDate(e.target.value)} /></label>
        <div className="flex flex-wrap justify-between gap-3 items-start"><div><h2 className="font-bold text-lg">Film sheets printed on {date}</h2><p className="text-sm text-muted-foreground">Earlier film entries saved in this browser, across all shifts and rooms. These are not current shared usage records.</p></div><Link to="/" className="text-sm font-semibold text-primary underline">Open current Daily usage</Link></div>
        <div className="grid grid-cols-2 gap-3 mt-4 max-w-xl"><div className="rounded-xl bg-muted/50 p-4"><p className="text-sm text-muted-foreground">17 × 14</p><p className="text-2xl font-bold">{printedFilms.film1714} <span className="text-sm font-normal">sheets</span></p></div><div className="rounded-xl bg-muted/50 p-4"><p className="text-sm text-muted-foreground">12 × 10</p><p className="text-2xl font-bold">{printedFilms.film1210} <span className="text-sm font-normal">sheets</span></p></div></div>
      </section>

      {adjustmentLog.length > 0 && <section className="dashboard-card overflow-hidden"><div className="p-5 border-b"><h2 className="font-bold text-lg">Physical count adjustments</h2></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-muted/60 text-left"><tr>{['Date', 'Item', 'Before', 'Counted', 'Difference', 'Reason', 'Recorded by'].map(heading => <th key={heading} className="px-4 py-3 font-semibold whitespace-nowrap">{heading}</th>)}</tr></thead><tbody>{adjustmentLog.map(entry => <tr key={entry.id} className="border-t"><td className="px-4 py-3">{entry.date}</td><td className="px-4 py-3">{entry.itemName}</td><td className="px-4 py-3">{entry.previousBalance} {entry.unit}</td><td className="px-4 py-3">{entry.countedBalance} {entry.unit}</td><td className="px-4 py-3">{entry.difference > 0 ? '+' : ''}{entry.difference}</td><td className="px-4 py-3">{entry.reason}</td><td className="px-4 py-3">{entry.recordedBy}</td></tr>)}</tbody></table></div></section>}

      <section className="dashboard-card overflow-hidden">
        <div className="p-5 border-b"><h2 className="font-bold text-lg">Daily store issue register</h2><p className="text-sm text-muted-foreground">Date, item picked, quantity, automatic balance, and staff confirmation.</p></div>
        {issueLog.length === 0 ? <div className="p-8 text-center text-muted-foreground">No earlier issue records were found in this browser.</div> : <div className="overflow-x-auto"><table className="w-full text-sm">
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
        <div className="p-5 border-b"><h2 className="font-bold text-lg">Reconciliation chart</h2><p className="text-sm text-muted-foreground">Historical browser balance = opening + received − issued + adjustments. This is not the current shared stock balance.</p></div>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-muted/60 text-left"><tr>{['Item', 'Unit', 'Opening', 'Received', 'Issued', 'Adjustment', 'Balance in hand', 'Minimum', 'Status'].map(h => <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
          <tbody>{items.map(item => { const balance = balanceOf(item); const low = balance <= item.minimum; return <tr key={item.id} className="border-t">
            <td className="px-4 py-3 font-medium min-w-56">{item.name}</td><td className="px-4 py-3 text-muted-foreground">{item.unit}</td>
            <td className="px-2 py-2">{item.opening}</td>
            <td className="px-4 py-3">{item.received}</td><td className="px-4 py-3">{item.used}</td><td className="px-4 py-3">{item.adjusted || 0}</td>
            <td className="px-4 py-3"><span className={`text-lg font-bold ${balance < 0 ? 'text-destructive' : ''}`}>{balance}</span> <span className="text-xs text-muted-foreground">{item.unit}</span></td>
            <td className="px-2 py-2">{item.minimum}</td>
            <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${low ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>{item.opening === 0 && item.received === 0 && item.used === 0 ? 'No opening recorded' : low ? 'Reorder' : 'In stock'}</span></td>
          </tr>})}</tbody>
        </table></div>
      </section>
    </main>
  </div>;
}
