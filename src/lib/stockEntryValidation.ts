export const lagosToday = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
export const PAST_PICK_WARNING = 'This pick is for a past date. Saving, correcting or removing it will change stock received for that shift and balances carried forward into later shifts and days. Review later entries after saving. Continue?';
type Entry = { type: string; date: string; today: string; recipient: string; destination: string; shift: string; confirmed: boolean; canBackdatePicks: boolean; lines: {itemId:string; quantity:string; item?:{id:string;name:string}}[] };
export function stockEntryError(e: Entry): string | null {
  if (!e.date) return 'Choose the date for this entry.';
  if (e.date > e.today) return 'Choose today or an earlier date; stock cannot be recorded for a future date.';
  if (e.type === 'issue' && e.date < e.today && !e.canBackdatePicks) return 'Only Honey can record a room pick for a past date. Choose today or ask Honey to help.';
  if (['opening','room_count'].includes(e.type) && e.date !== e.today) return 'Use today for a physical count of what is here now.';
  if (e.recipient.trim().length < 2) return `Enter the full name of the person who ${e.type === 'issue' ? 'picked' : e.type === 'receipt' ? 'received' : 'counted'} the stock.`;
  if (['issue','room_count'].includes(e.type) && !e.destination) return 'Select the room receiving this stock or count.';
  if (['issue','room_count'].includes(e.type) && !e.shift) return 'Select the shift for this entry.';
  const seen = new Set<string>();
  for (const [index,line] of e.lines.entries()) {
    if (!line.item) return `Choose an item for Item ${index + 1}, or remove that unused row.`;
    if (seen.has(line.itemId)) return `${line.item.name} is listed twice. Combine its quantities in one row and remove the duplicate.`;
    seen.add(line.itemId);
    if (!line.quantity.trim()) return `Enter the quantity for ${line.item.name}.`;
    const q = Number(line.quantity), count = ['opening','room_count'].includes(e.type);
    if (!Number.isFinite(q) || q < 0 || (!count && q === 0)) return `Enter ${count ? 'zero or a positive' : 'a positive'} quantity for ${line.item.name}.`;
    if (q > 1000000) return `The quantity for ${line.item.name} is too large. Check the units and enter no more than 1,000,000.`;
    if (['ct_contrast','mri_contrast','gastrolux'].includes(line.itemId)) {
      if (Math.abs(q * 100 - Math.round(q * 100)) > 0.00001) return `Enter the quantity for ${line.item.name} in ml, with no more than two decimal places.`;
    } else if (!Number.isInteger(q)) return `Enter a whole quantity for ${line.item.name}, using the unit shown beside it.`;
  }
  if (!e.lines.length) return 'Add at least one stock item.';
  if (!e.confirmed) return 'Tick the confirmation checkbox to confirm these quantities were actually picked, received or counted.';
  return null;
}
