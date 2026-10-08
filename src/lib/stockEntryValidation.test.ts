import { describe,it,expect } from 'vitest';
import { lagosToday,stockEntryError } from './stockEntryValidation';
const entry={type:'issue',date:'2026-10-08',today:'2026-10-08',recipient:'George',destination:'CT',shift:'morning',confirmed:true,canBackdatePicks:false,lines:[{itemId:'gastrolux',quantity:'100',item:{id:'gastrolux',name:'Gastrolux'}}]};
describe('specific stock validation',()=>{
 it('uses Lagos date across midnight',()=>expect(lagosToday(new Date('2026-10-07T23:30:00Z'))).toBe('2026-10-08'));
 it('accepts valid entries and today picks',()=>expect(stockEntryError(entry)).toBeNull());
 it('names missing date, name, room, shift and confirmation',()=>{
  for(const [patch,message] of [[{date:''},'Choose the date'],[{recipient:''},'full name'],[{destination:''},'Select the room'],[{shift:''},'Select the shift'],[{confirmed:false},'confirmation checkbox']] as const) expect(stockEntryError({...entry,...patch})).toContain(message);
 });
 it('names the blank, invalid and duplicated item',()=>{
  expect(stockEntryError({...entry,lines:[{itemId:'',quantity:'100'}]})).toContain('Item 1');
  expect(stockEntryError({...entry,lines:[{...entry.lines[0],quantity:''}]})).toContain('quantity for Gastrolux');
  expect(stockEntryError({...entry,lines:[{...entry.lines[0],quantity:'0'}]})).toContain('positive quantity for Gastrolux');
  expect(stockEntryError({...entry,lines:[...entry.lines,...entry.lines]})).toContain('Gastrolux is listed twice');
 });
 it('blocks staff past picks but allows Honey, and rejects future dates',()=>{
  expect(stockEntryError({...entry,date:'2026-10-07'})).toContain('Only Honey');
  expect(stockEntryError({...entry,date:'2026-10-07',canBackdatePicks:true})).toBeNull();
  expect(stockEntryError({...entry,date:'2026-10-09',canBackdatePicks:true})).toContain('future date');
 });
 it('permits zero counts, contrast decimals and rejects fractional film counts',()=>{
  expect(stockEntryError({...entry,type:'room_count',lines:[{...entry.lines[0],quantity:'0'}]})).toBeNull();
  expect(stockEntryError({...entry,lines:[{...entry.lines[0],quantity:'0.25'}]})).toBeNull();
  expect(stockEntryError({...entry,lines:[{itemId:'film_14x17',quantity:'1.5',item:{id:'film_14x17',name:'17 × 14 film'}}]})).toContain('whole quantity for 17 × 14 film');
 });
});
