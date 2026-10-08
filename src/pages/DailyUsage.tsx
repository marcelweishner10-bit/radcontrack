import { StockSummary } from '@/components/StockSummary';
import { useState } from 'react';
import { format, parseISO, subDays } from 'date-fns';
import { Link } from 'react-router-dom';
import { AppNavigation } from '@/components/AppNavigation';
import { UnifiedShift } from '@/components/UnifiedShift';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { STOCK_ROOMS, STOCK_SHIFTS } from '@/lib/roomStock';
import type { ShiftType } from '@/types/contrast';

export default function DailyUsage() {
  const params = new URLSearchParams(window.location.search);
  const [date, setDate] = useState(params.get('date') || format(new Date(),'yyyy-MM-dd'));
  const [shift, setShift] = useState<ShiftType>(STOCK_SHIFTS.find(s=>s===params.get('shift')) || 'morning');
  const [room, setRoom] = useState<string>(STOCK_ROOMS.find(r=>r===params.get('room')) || 'CT');
  const [dirty, setDirty] = useState(false);
  const chooseDate=(next:string)=>{if(!next||next===date)return;if(dirty&&!window.confirm('Switch to another day? Your unfinished entry will stay saved as a draft for this room and shift. Return to this day to continue it.'))return;setDirty(false);setDate(next);};
  return <div className="min-h-screen bg-background"><AppNavigation />
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-7 space-y-6">
      <div><h1 className="text-2xl font-bold">Daily usage</h1><p className="text-muted-foreground mt-1 max-w-prose">Choose the date, shift and room. Record what was actually used, then save.</p></div>
      <div className="space-y-4 border-b pb-5">
        <div className="flex flex-wrap items-end gap-4"><div><Label htmlFor="usage-date">Date</Label><Input id="usage-date" className="w-auto" type="date" max={format(new Date(),'yyyy-MM-dd')} value={date} onChange={e => chooseDate(e.target.value)} /></div><Button variant="outline" onClick={() => chooseDate(format(subDays(parseISO(date),1),'yyyy-MM-dd'))}>Previous day</Button><Button variant="outline" onClick={() => chooseDate(format(new Date(),'yyyy-MM-dd'))}>Today</Button></div>
        <fieldset><legend className="text-sm font-medium mb-2">Shift</legend><div className="flex flex-wrap gap-2">{STOCK_SHIFTS.map(value => <Button key={value} aria-pressed={shift===value} disabled={dirty} variant={shift===value?'default':'outline'} className="capitalize" onClick={() => setShift(value)}>{value}</Button>)}</div></fieldset>
        <fieldset><legend className="text-sm font-medium mb-2">Room</legend><div className="flex flex-wrap gap-2">{STOCK_ROOMS.map(value => <Button key={value} aria-pressed={room===value} disabled={dirty} variant={room===value?'default':'outline'} onClick={() => setRoom(value)}>{value}</Button>)}</div></fieldset>
      </div>
      {dirty && <p className="text-sm text-muted-foreground" role="status">Save progress before changing the shift or room. You can switch dates after confirming; your unfinished entry stays as a draft.</p>}
      <UnifiedShift key={`${date}/${shift}/${room}`} date={date} shift={shift} room={room} onDirtyChange={setDirty} />
      <div className="border-t pt-4 text-sm text-muted-foreground space-y-2"><p>Picked stock is recorded under <Link className="text-primary underline" to="/stock/pick">Pick for a room</Link>. A pick is not usage.</p><p><Link className="text-primary underline" to="/clinical">Earlier clinical records</Link> are kept for reference. New entries above update both usage and stock once.</p></div>
      <StockSummary />
    </main>
  </div>;
}
