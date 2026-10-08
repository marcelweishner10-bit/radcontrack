import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {UnifiedShift} from './UnifiedShift';
const mock=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn()}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{email:'honey.onabanjo@bthdc.com.ng'},canManageStock:true})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:mock}));
beforeEach(()=>{
 localStorage.clear();
 mock.rpc.mockReset();mock.from.mockReset();
 mock.rpc.mockImplementation(async(name:string)=>({error:null,data:name==='shift_context'?{token:'one',items:[{id:'ct_contrast',name:'CT Contrast',unit:'ml',opening:100,received:0,adjustment:0,remaining:100,known:true},{id:'film1714',name:'17 × 14 film',unit:'films',opening:20,received:0,adjustment:0,remaining:20,known:true}]}:1}));
 mock.from.mockImplementation((table:string)=>{const result={data:table==='stock_shift_usage'?[]:null,error:null};const query={select:()=>query,eq:()=>query,maybeSingle:()=>Promise.resolve(result),then:(resolve:(v:unknown)=>unknown)=>Promise.resolve(result).then(resolve)};return query;});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
const setup=async()=>{render(<MemoryRouter><UnifiedShift date="2026-10-07" room="CT" shift="morning" onDirtyChange={()=>{}}/></MemoryRouter>);await screen.findByLabelText('CT Contrast Used for patients (ml)');};
describe('connected shift form',()=>{
 it('cancel prevents replacing saved usage and keeps the correction draft',async()=>{
  mock.from.mockImplementation((table:string)=>{const result={data:table==='stock_shift_usage'?[]:{version:1,stock_token:'one',details:{ct_contrast:{used:10,waste:0,patients:1}},staff:'Honey',physical:{},note:''},error:null};const query={select:()=>query,eq:()=>query,maybeSingle:()=>Promise.resolve(result),then:(resolve:(v:unknown)=>unknown)=>Promise.resolve(result).then(resolve)};return query;});
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
  await setup();
  fireEvent.change(screen.getByLabelText('CT Contrast Used for patients (ml)'),{target:{value:'20'}});
  fireEvent.click(screen.getByRole('button',{name:'Save progress'}));
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Update this saved shift?'));
  expect(mock.rpc.mock.calls.some(call=>call[0]==='save_shift')).toBe(false);
  expect(screen.getByLabelText('CT Contrast Used for patients (ml)')).toHaveValue(20);
 });
 it('combines pickups and top-ups while keeping consumption calculations',async()=>{
  mock.rpc.mockImplementation(async(name:string)=>({error:null,data:name==='shift_context'?{token:'one',items:[{id:'ct_contrast',name:'CT Contrast',unit:'ml',opening:50,received:300,initial_received:200,topups:100,adjustment:0,remaining:350,known:true}]}:1}));
  await setup();
  expect(screen.getByRole('row',{name:'Stock picked this shift 300 3'})).toBeInTheDocument();
  expect(screen.getByRole('row',{name:'Total Qty Available 350 3.5'})).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('CT Contrast Used for patients (ml)'),{target:{value:'70'}});
  fireEvent.change(screen.getByLabelText('CT Contrast Wastage (ml)'),{target:{value:'10'}});
  expect(screen.getByText('270 ml')).toBeInTheDocument();
 });
 it('updates estimated film remaining from usage without a physical count',async()=>{
  await setup();
  fireEvent.change(screen.getByLabelText('17 × 14 film Films printed'),{target:{value:'6'}});
  expect(screen.getByRole('row',{name:'Balance carried over from recorded entries 20'})).toBeInTheDocument();
  expect(screen.getByRole('row',{name:/Balance from recorded pickups and usage.*14 films/})).toBeInTheDocument();
  expect(screen.getByLabelText('17 × 14 film actually remaining')).toHaveValue(null);
 });
 it('shows one contrast entry and previews actual use plus wastage',async()=>{
  await setup();
  fireEvent.change(screen.getByLabelText('CT Contrast Used for patients (ml)'),{target:{value:'70'}});
  fireEvent.change(screen.getByLabelText('CT Contrast Wastage (ml)'),{target:{value:'10'}});
  expect(screen.getByText('20 ml')).toBeInTheDocument();
  expect(screen.getAllByLabelText('CT Contrast Used for patients (ml)')).toHaveLength(1);
 });
 it('saves patients, consumption and wastage in one request',async()=>{
  await setup();
  fireEvent.change(screen.getByPlaceholderText('Your full name'),{target:{value:'Honey'}});
  fireEvent.change(screen.getByLabelText('CT Contrast Used for patients (ml)'),{target:{value:'70'}});
  fireEvent.change(screen.getByLabelText('CT Contrast Number of patients'),{target:{value:'2'}});
  fireEvent.change(screen.getByLabelText('CT Contrast Wastage (ml)'),{target:{value:'10'}});
  fireEvent.click(screen.getByRole('button',{name:'Save progress'}));
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('save_shift',expect.objectContaining({p_finish:false,p_details:{ct_contrast:{used:70,waste:10,patients:2,reviewed:false}}})));
 });
 it('does not finish with untouched items',async()=>{
  await setup();fireEvent.change(screen.getByPlaceholderText('Your full name'),{target:{value:'Honey'}});
  fireEvent.click(screen.getByRole('button',{name:'Finish shift'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Review every item');
  expect(mock.rpc.mock.calls.some(call=>call[0]==='save_shift')).toBe(false);
 });
});
