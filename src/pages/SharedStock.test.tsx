import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SharedStock from './SharedStock';
import { supabase } from '@/integrations/supabase/client';

const access = vi.hoisted(() => ({ canManageStock: false, canManageStaff: false, user: { id: 'honey', email:'honey.onabanjo@bthdc.com.ng' }, movements: [] as Record<string, unknown>[], roomMovements: [] as Record<string, unknown>[] }));
vi.mock('@/lib/stockEntryValidation',async importOriginal => ({...await importOriginal<typeof import('@/lib/stockEntryValidation')>(),lagosToday:()=> '2026-10-08'}));
vi.mock('@/hooks/useTheme', () => ({ useTheme: () => ({theme:'dark',toggleTheme:vi.fn()}) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ ...access, loading: false }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  from: (name: string) => {
    const result = Promise.resolve({ error: null, data: name === 'stock_items' ? [{ id: 'gastrolux', name: 'Gastrolux', unit: 'ml', balance: 200, opening_recorded: true, active: true }] : name === 'stock_movements' ? access.movements : name === 'room_stock_movements' ? access.roomMovements : [] });
    const query = { select: () => query, eq: () => query, order: () => query, limit: () => query, range: () => query, then: result.then.bind(result) };
    return query;
  }, rpc: vi.fn(),
} }));
beforeEach(() => { vi.stubGlobal('crypto', { randomUUID: () => 'test-line' }); vi.spyOn(window,'confirm').mockReturnValue(true); access.movements = []; access.roomMovements = []; vi.mocked(supabase.rpc).mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('shared stock access', () => {
  it.each([false,true])('cancel blocks stock correction/deletion (delete=%s)',async(remove)=>{
    access.canManageStock=true;access.canManageStaff=false;
    access.movements=[{id:'receipt',item_id:'gastrolux',quantity:200,occurred_on:'2026-10-08',recipient_name:'Honey',reference:'R1',version:1,movement_type:'receipt'}];
    render(<MemoryRouter><SharedStock view="history" /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button',{name:'Edit / delete'}));
    fireEvent.change(screen.getByPlaceholderText('For example, entered 10000 instead of 100 films'),{target:{value:'Wrong quantity'}});
    vi.mocked(window.confirm).mockReturnValue(false);
    if(remove)fireEvent.click(screen.getByRole('checkbox',{name:'Remove this entry and reverse its stock movement'}));
    fireEvent.click(screen.getByRole('button',{name:remove?'Delete entry':'Save correction'}));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining(remove?'Delete this stock entry?':'Save this stock correction?'));
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('For example, entered 10000 instead of 100 films')).toHaveValue('Wrong quantity');
  });
  it('cancel preserves a physical count draft without replacing stock',async()=>{
    access.canManageStock=true;access.canManageStaff=false;
    render(<MemoryRouter><SharedStock view="count" /></MemoryRouter>);
    const counted=await screen.findByRole('spinbutton',{name:'Actually counted Gastrolux'});
    fireEvent.change(counted,{target:{value:'180'}});
    fireEvent.change(screen.getByLabelText('Counted by'),{target:{value:'Honey'}});
    fireEvent.click(screen.getByRole('checkbox',{name:'I confirm these quantities were physically counted.'}));
    vi.mocked(window.confirm).mockReturnValue(false);
    fireEvent.click(screen.getByRole('button',{name:'Save physical count'}));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('replaces the recorded balance'));
    expect(supabase.rpc).not.toHaveBeenCalled();expect(counted).toHaveValue(180);
  });
  it('saves only physically checked rows with the count replacement RPC',async()=>{
    access.canManageStock=true;access.canManageStaff=false;
    vi.mocked(supabase.rpc).mockResolvedValue({error:null,data:'count-batch'} as never);
    render(<MemoryRouter><SharedStock view="count" /></MemoryRouter>);
    await screen.findByRole('table',{name:'Stock check before requisition'});
    expect(screen.getByRole('columnheader',{name:'Calculated total left'})).toBeInTheDocument();
    const counted=screen.getByRole('spinbutton',{name:'Actually counted Gastrolux'});
    expect(counted).toHaveValue(null);
    fireEvent.change(counted,{target:{value:'180'}});
    expect(screen.getByRole('cell',{name:'-20'})).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Counted by'),{target:{value:'Honey'}});
    fireEvent.click(screen.getByRole('checkbox',{name:'I confirm these quantities were physically counted.'}));
    fireEvent.click(screen.getByRole('button',{name:'Save physical count'}));
    await waitFor(()=>expect(supabase.rpc).toHaveBeenCalledWith('move_room_stock_units',expect.objectContaining({p_type:'opening',p_lines:[{item_id:'gastrolux',quantity:180}],p_room:null})));
  });
  it('does not treat an unchecked row as a zero count',async()=>{
    access.canManageStock=true;access.canManageStaff=false;
    render(<MemoryRouter><SharedStock view="count" /></MemoryRouter>);
    await screen.findByRole('table',{name:'Stock check before requisition'});
    fireEvent.click(screen.getByRole('button',{name:'Save physical count'}));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter at least one quantity you physically counted');
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
  it('blocks staff correcting yesterday even for their own pick',async()=>{
    access.canManageStock=false;access.canManageStaff=false;
    access.movements=[{id:'old-own',item_id:'gastrolux',movement_type:'issue',occurred_on:'2026-10-07',quantity:100,recorded_by:'honey'}];
    render(<MemoryRouter><SharedStock view="pick" /></MemoryRouter>);
    await screen.findByText('Gastrolux');
    expect(screen.queryByRole('button',{name:'Edit pick'})).not.toBeInTheDocument();
  });
  it('warns Honey and leaves an old correction unsaved when she cancels',async()=>{
    access.canManageStock=true;access.canManageStaff=false;
    access.movements=[{id:'old',item_id:'gastrolux',movement_type:'issue',occurred_on:'2026-10-07',quantity:100,version:1,recipient_name:'Honey',recorded_by:'honey'}];
    vi.mocked(window.confirm).mockReturnValue(false);
    render(<MemoryRouter><SharedStock view="pick" /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button',{name:'Edit pick'}));
    fireEvent.change(screen.getByLabelText('Reason for correction'),{target:{value:'Wrong amount'}});
    fireEvent.click(screen.getByRole('button',{name:'Save correction'}));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('balances carried forward'));
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
  it('corrects a saved pick directly on the pick page with its version and reason', async () => {
    access.canManageStock=false; access.canManageStaff=false;
    access.movements=[{id:'pick-own',item_id:'gastrolux',movement_type:'issue',quantity:100,occurred_on:'2026-10-08',recipient_name:'Honey',version:2,recorded_by:'honey',destination:'CT',shift:'morning'}];
    vi.mocked(supabase.rpc).mockResolvedValue({error:null,data:3} as never);
    render(<MemoryRouter><SharedStock view="pick" /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button',{name:'Edit pick'}));
    fireEvent.change(screen.getByLabelText('Quantity (ml)'),{target:{value:'50'}});
    fireEvent.change(screen.getByLabelText('Reason for correction'),{target:{value:'Picked 50, not 100'}});
    fireEvent.click(screen.getByRole('button',{name:'Save correction'}));
    await waitFor(()=>expect(supabase.rpc).toHaveBeenCalledWith('correct_stock_movement',expect.objectContaining({p_id:'pick-own',p_version:2,p_quantity:50,p_delete:false})));
    expect(await screen.findByText(/Pick corrected\. Additional stock received/)).toBeInTheDocument();
  });
  it('shows count corrections and pick editing beside records, then submits a versioned correction', async () => {
    access.canManageStock = true; access.canManageStaff = false;
    access.movements = [
      { id:'count-1',item_id:'gastrolux',movement_type:'opening',quantity:200,occurred_on:'2026-10-07',recipient_name:'Honey',version:1,recorded_by:'honey' },
      { id:'pick-1',item_id:'gastrolux',movement_type:'issue',quantity:100,occurred_on:'2026-10-07',recipient_name:'George',version:2,recorded_by:'other' },
    ];
    vi.mocked(supabase.rpc).mockResolvedValue({error:null,data:3} as never);
    render(<MemoryRouter><SharedStock view="history" /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button',{name:'Correct count'}));
    expect(within(screen.getByRole('region',{name:'Correct stock entry'})).getByLabelText('Date')).toBeDisabled();
    expect(screen.queryByRole('button',{name:'Delete entry'})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Cancel'}));
    fireEvent.click(screen.getByRole('button',{name:'Edit / delete'}));
    fireEvent.change(screen.getByLabelText('Quantity (ml)'),{target:{value:'50'}});
    fireEvent.change(screen.getByLabelText('Reason for correction'),{target:{value:'Wrong quantity'}});
    fireEvent.click(screen.getByRole('button',{name:'Save correction'}));
    await waitFor(()=>expect(supabase.rpc).toHaveBeenCalledWith('correct_stock_movement',expect.objectContaining({p_source:'store',p_id:'pick-1',p_version:2,p_quantity:50,p_reason:'Wrong quantity',p_delete:false})));
  });
  it('lets staff correct their own picks but hides store counts and other staff picks', async () => {
    access.canManageStock = false; access.canManageStaff = false;
    access.movements = [
      {id:'own',item_id:'gastrolux',movement_type:'issue',recorded_by:'honey'},
      {id:'other',item_id:'gastrolux',movement_type:'issue',recorded_by:'other'},
      {id:'count',item_id:'gastrolux',movement_type:'opening',recorded_by:'honey'},
    ];
    render(<MemoryRouter><SharedStock view="history" /></MemoryRouter>);
    await screen.findByRole('button',{name:'Edit / delete'});
    expect(screen.getAllByRole('button',{name:'Edit / delete'})).toHaveLength(1);
    expect(screen.queryByRole('button',{name:'Correct count'})).not.toBeInTheDocument();
  });
  it('opens a room count with its counted amount rather than its change', async () => {
    access.canManageStock = true; access.canManageStaff = false;
    access.roomMovements = [{id:'room-1',room:'MRI',item_id:'gastrolux',movement_type:'count',change:-20,balance_after:80,occurred_on:'2026-10-07',staff_name:'Honey',version:1}];
    render(<MemoryRouter><SharedStock view="history" /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button',{name:'Room counts and usage'}));
    fireEvent.click(await screen.findByRole('button',{name:'Correct room count'}));
    expect(screen.getByLabelText('Quantity (ml)')).toHaveValue(80);
    expect(screen.queryByRole('button',{name:'Delete entry'})).not.toBeInTheDocument();
  });
  it('keeps entry forms separate from histories and reconciliation', async () => {
    access.canManageStock = false; access.canManageStaff = false;
    render(<MemoryRouter><SharedStock view="pick" /></MemoryRouter>);
    await screen.findByRole('button',{name:'Save room pick'});
    expect(screen.queryByText('Recent store movements')).not.toBeInTheDocument();
    expect(screen.queryByText('Stock in rooms and total remaining')).not.toBeInTheDocument();
    expect(screen.queryByRole('link',{name:'Receive stock'})).not.toBeInTheDocument();
  });
  it('lets staff count a room while hiding store count controls', async () => {
    access.canManageStock = false; access.canManageStaff = false;
    render(<MemoryRouter><SharedStock view="count" /></MemoryRouter>);
    await screen.findByRole('button',{name:'Save physical count'});
    expect(screen.getByRole('button',{name:'In a room'})).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'In the store'})).not.toBeInTheDocument();
  });
  it('gives an editor a dedicated received-stock form', async () => {
    access.canManageStock = true; access.canManageStaff = false;
    render(<MemoryRouter><SharedStock view="receive" /></MemoryRouter>);
    await screen.findByRole('button',{name:'Save received stock'});
    expect(screen.getByRole('link',{name:'Receive stock'})).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Approve staff login'})).not.toBeInTheDocument();
  });
  it('blocks the shared account from receiving stock even through a direct link', async () => {
    access.canManageStock = false; access.canManageStaff = true;
    render(<MemoryRouter><SharedStock view="receive" /></MemoryRouter>);
    await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('requires an authorised stock-editor login'));
    expect(screen.queryByRole('button',{name:'Save received stock'})).not.toBeInTheDocument();
    expect(screen.getByRole('link',{name:'Staff access'})).toBeInTheDocument();
  });
  it('keeps staff approval in its own page', async () => {
    access.canManageStock = false; access.canManageStaff = true;
    render(<MemoryRouter><SharedStock view="access" /></MemoryRouter>);
    await waitFor(()=>expect(screen.getByRole('button',{name:'Approve staff login'})).toBeInTheDocument());
    expect(screen.queryByRole('button',{name:'Save room pick'})).not.toBeInTheDocument();
  });
  it('does not present an unconfirmed department total as a known balance', async () => {
    access.canManageStock = false; access.canManageStaff = false;
    render(<MemoryRouter><SharedStock view="balances" /></MemoryRouter>);
    await screen.findByText('Unconfirmed');
    expect(screen.getByText('0 (tracked balance)')).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Save room pick'})).not.toBeInTheDocument();
  });
});
