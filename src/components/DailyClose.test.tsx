import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {DailyClose} from './DailyClose';
const m=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:m}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{email:'honey.onabanjo@bthdc.com.ng'},canManageStock:true})}));
const ctx={token:'one',close:null,items:[{key:'Shared|cd',id:'cd',name:'CD plates',room:'Shared',unit:'pieces',cadence:'daily',earlier:5,remaining:95,deducted:0,picked:100},{key:'Shared|cd_jacket',id:'cd_jacket',name:'CD sleeves',room:'Shared',unit:'pieces',cadence:'daily',earlier:5,remaining:95,deducted:0,picked:100}]};
beforeEach(()=>{localStorage.clear();m.rpc.mockReset();m.rpc.mockImplementation(async(name:string)=>({data:name==='daily_close_context'?ctx:1,error:null}));});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
const setup=async()=>{render(<MemoryRouter><DailyClose date="2026-11-02" onDirtyChange={()=>{}}/></MemoryRouter>);await screen.findByLabelText('Shared CD plates daily total');};
describe('daily close',()=>{
 it('does not call an empty database composite a saved daily close',async()=>{
  m.rpc.mockResolvedValue({data:{...ctx,close:{date:null,version:null,details:null,finished:null,stock_token:null}},error:null});
  await setup();
  expect(screen.getByRole('status')).toHaveTextContent('Not closed');
  expect(screen.getByRole('status')).not.toHaveTextContent('Saved');
 });
 it('shows confirmed success even if the following refresh fails',async()=>{
  await setup();fireEvent.change(screen.getByPlaceholderText('Your full name'),{target:{value:'Honey'}});
  fireEvent.change(screen.getByLabelText('Shared CD plates daily total'),{target:{value:'12'}});
  m.rpc.mockImplementation(async(name:string)=>name==='save_daily_close'?{data:1,error:null}:{data:null,error:{message:'Connection lost'}});
  fireEvent.click(screen.getByText('Save progress'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Saved — refresh needs attention');
  expect(screen.getByRole('alert')).toHaveTextContent('Progress saved');
 });
 it('recovers the save button after an unexpected request rejection and keeps entries',async()=>{
  await setup();fireEvent.change(screen.getByPlaceholderText('Your full name'),{target:{value:'Honey'}});
  fireEvent.change(screen.getByLabelText('Shared CD plates daily total'),{target:{value:'12'}});
  m.rpc.mockRejectedValueOnce(new Error('Connection interrupted'));
  fireEvent.click(screen.getByText('Save progress'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Connection interrupted');
  expect(screen.getByRole('button',{name:'Save progress'})).toBeEnabled();
  expect(screen.getByLabelText('Shared CD plates daily total')).toHaveValue(12);
 });
 it('includes historical entries but does not silently mark them reviewed',async()=>{
  await setup();expect(screen.getByLabelText('Shared CD plates daily total')).toHaveValue(5);
  fireEvent.change(screen.getByPlaceholderText('Your full name'),{target:{value:'Honey'}});
  fireEvent.click(screen.getByText('Close day'));expect(await screen.findByRole('alert')).toHaveTextContent('Still missing');
  expect(m.rpc.mock.calls.some(c=>c[0]==='save_daily_close')).toBe(false);
 });
 it('copies plates to sleeves automatically and saves a single day total',async()=>{
  await setup();fireEvent.change(screen.getByPlaceholderText('Your full name'),{target:{value:'Honey'}});
  fireEvent.change(screen.getByLabelText('Shared CD plates daily total'),{target:{value:'12'}});
  expect(screen.getByLabelText('Shared CD sleeves daily total')).toHaveValue(12);
  expect(screen.getByLabelText('Shared CD sleeves daily total')).toBeDisabled();
  vi.spyOn(window,'confirm').mockReturnValue(true);fireEvent.click(screen.getByText('Close day'));
  await waitFor(()=>expect(m.rpc).toHaveBeenCalledWith('save_daily_close',expect.objectContaining({p_finish:true,p_details:{'Shared|cd':{used:12,reviewed:true},'Shared|cd_jacket':{used:12,reviewed:true}}})));
 });
 it('cancelling confirmation keeps entries and sends no save',async()=>{
  await setup();fireEvent.change(screen.getByPlaceholderText('Your full name'),{target:{value:'Honey'}});
  fireEvent.change(screen.getByLabelText('Shared CD plates daily total'),{target:{value:'12'}});
  vi.spyOn(window,'confirm').mockReturnValue(false);fireEvent.click(screen.getByText('Close day'));
  expect(m.rpc.mock.calls.some(c=>c[0]==='save_daily_close')).toBe(false);expect(screen.getByLabelText('Shared CD plates daily total')).toHaveValue(12);
 });
 it('allows different sleeves without changing plates',async()=>{
  await setup();fireEvent.change(screen.getByLabelText('Shared CD plates daily total'),{target:{value:'12'}});
  fireEvent.click(screen.getByLabelText('Sleeves match plates'));
  fireEvent.change(screen.getByLabelText('Shared CD sleeves daily total'),{target:{value:'10'}});
  fireEvent.change(screen.getByLabelText('Shared CD plates daily total'),{target:{value:'15'}});
  expect(screen.getByLabelText('Shared CD sleeves daily total')).toHaveValue(10);
 });
 it('remembers a visible name without confirming any usage',async()=>{
  localStorage.setItem('tracstoc-last-staff-honey.onabanjo@bthdc.com.ng','Honey');
  await setup();expect(screen.getByPlaceholderText('Your full name')).toHaveValue('Honey');
  expect(screen.getAllByText('Missing').length).toBeGreaterThan(0);
 });
 it('confirms no activity for only the chosen room and keeps other rooms missing',async()=>{
  const films=['CT','MRI'].flatMap(room=>['film1714','film1210'].map(id=>({key:`${room}|${id}`,id,name:id==='film1714'?'17 × 14 film':'12 × 10 film',room,unit:'films',cadence:'daily',earlier:0,remaining:100,deducted:0,picked:0})));
  m.rpc.mockImplementation(async()=>({data:{...ctx,items:[...ctx.items,...films]},error:null}));
  await setup();expect(screen.queryByLabelText('MRI 17 × 14 film daily total')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('No activity in this room'));
  expect(screen.getByLabelText('CT 17 × 14 film daily total')).toHaveValue(0);
  expect(screen.getByLabelText('CT 12 × 10 film daily total')).toHaveValue(0);
  fireEvent.click(screen.getByRole('button',{name:'MRI · Missing'}));
  expect(screen.getByLabelText('MRI 17 × 14 film daily total')).toHaveValue(null);
  expect(screen.getAllByText('Missing').length).toBeGreaterThan(0);
 });
});
