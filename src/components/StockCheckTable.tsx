import { Input } from '@/components/ui/input';
import { STOCK_ROOMS, bottleCapacity } from '@/lib/roomStock';
import type { Tables } from '@/integrations/supabase/types';

export function StockCheckTable({items,rooms,location,counts,onChange}: {
  items:Tables<'stock_items'>[];rooms:Tables<'room_stock'>[];location:string;
  counts:Record<string,string>;onChange:(id:string,value:string)=>void;
}) {
  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">Use the calculated totals to check stock before requesting more from the main store. Enter only quantities you physically checked in <strong>{location || 'the selected room'}</strong>. Blank rows are left unchanged.</p>
    <div className="overflow-x-auto border rounded-lg"><table aria-label="Stock check before requisition" className="w-full text-sm">
      <thead className="bg-muted text-left"><tr>{['Item','Unit','Calculated total left',`Calculated in ${location || 'selected room'}`, 'Actually counted','Difference'].map(h=><th key={h} className="px-3 py-3 font-semibold min-w-24">{h}</th>)}</tr></thead>
      <tbody>{items.map(item=>{
        const locations=STOCK_ROOMS.map(room=>rooms.find(r=>r.room===room&&r.item_id===item.id));
        const room=rooms.find(r=>r.room===location&&r.item_id===item.id);
        const expected=location==='Department stock'?item.balance:room?.balance??0;
        const known=location==='Department stock'?item.opening_recorded:!!room?.counted_on;
        const total=item.balance+locations.reduce((sum,r)=>sum+(r?.balance??0),0);
        const totalKnown=item.opening_recorded&&locations.every(r=>!!r?.counted_on);
        const raw=counts[item.id]??'',actual=Number(raw),entered=raw.trim()!==''&&Number.isFinite(actual)&&actual>=0;
        const difference=actual-expected;
        const amount=(n:number)=>Number(n.toFixed(2));
        return <tr key={item.id} className="border-t">
          <th scope="row" className="px-3 py-3 text-left min-w-48">{item.name}<details className="mt-1 text-xs font-normal text-muted-foreground"><summary className="cursor-pointer">Show location breakdown</summary><dl className="mt-2 space-y-1"><div>Department: {amount(item.balance)}{!item.opening_recorded?' (unconfirmed)':''}</div>{locations.map((r,i)=><div key={STOCK_ROOMS[i]}>{STOCK_ROOMS[i]}: {amount(r?.balance??0)}{!r?.counted_on?' (unconfirmed)':''}</div>)}</dl></details></th><td className="px-3 py-3">{item.unit}</td>
          <td className="px-3 py-3 font-semibold">{amount(total)}{!totalKnown&&<small className="block font-normal text-muted-foreground">Recorded estimate</small>}</td>
          <td className="px-3 py-3">{amount(expected)}{!known&&<small className="block text-muted-foreground">Unconfirmed</small>}</td>
          <td className="px-3 py-3"><Input aria-label={`Actually counted ${item.name}`} className="w-28" type="number" min="0" step={bottleCapacity(item.id)?'0.01':'1'} disabled={!location} placeholder="Not checked" value={raw} onChange={e=>onChange(item.id,e.target.value)} /></td>
          <td className={`px-3 py-3 font-semibold whitespace-nowrap ${entered&&difference!==0?'text-destructive':''}`}>{entered?(known?`${difference>0?'+':''}${amount(difference)}`:'Sets first confirmed count'):'—'}</td>
        </tr>;
      })}</tbody>
    </table></div>
    <p className="text-sm text-muted-foreground">Total left combines department stock and all rooms, after recorded usage and wastage. Unconfirmed locations make it an estimate. Saving replaces only the counted location’s balance; it does not add stock or change other locations.</p>
  </div>;
}
