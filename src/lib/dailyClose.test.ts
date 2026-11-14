import {describe,it,expect} from 'vitest';
import {closeExtra,closeMissing,closeProblem,type CloseItem} from './dailyClose';
const item=(key:string,earlier=0,deducted=0):CloseItem=>({key,id:'film1714',room:key.split('|')[0],name:'17 × 14 film',unit:'films',cadence:'daily',earlier,remaining:200,deducted,picked:100});
describe('whole-day reconciliation',()=>{
 it('requires an explicit answer; zero is a reviewed answer',()=>{
  const i=item('CT|film1714');expect(closeMissing([i],{})).toHaveLength(1);
  expect(closeMissing([i],{[i.key]:{used:0,patients:0,reviewed:true}})).toHaveLength(0);
 });
 it('keeps film entry missing until patients are entered and requires them to close',()=>{
  const i=item('CT|film1714');const d={[i.key]:{used:4,reviewed:true}};
  expect(closeMissing([i],d)).toHaveLength(1);
  expect(closeProblem([i],d,true)).toContain('patients printed for');
  expect(closeMissing([i],{[i.key]:{used:4,patients:2,reviewed:true}})).toHaveLength(0);
  expect(closeProblem([i],{[i.key]:{used:4,patients:0,reviewed:true}},true)).toContain('patients printed for');
 });
 it('only deducts the difference beyond earlier shifts and the previously saved daily total',()=>{
  const i=item('CT|film1714',20,30),j=item('MRI|film1714',10,5);
  expect(closeExtra([i,j],{[i.key]:{used:60},[j.key]:{used:18}},'film1714')).toBe(13);
  expect(closeExtra([i,j],{},'film1714')).toBe(0);
 });
 it('refuses to erase historical usage by entering a lower total',()=>{
  const i=item('CT|film1714',20);expect(closeProblem([i],{[i.key]:{used:19}})).toContain('earlier shifts');
 });
 it('does not require daily counting of packs',()=>{
  const i={...item('Shared|gloves_pack'),cadence:'pack' as const};expect(closeMissing([i],{})).toEqual([]);
 });
});
