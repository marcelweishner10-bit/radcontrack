import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,describe,it,expect,vi} from 'vitest';
import DailyUsage from './DailyUsage';
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{email:'staff@example.com'},canManageStock:false,canManageStaff:false,signOut:vi.fn()})}));
vi.mock('@/hooks/useTheme',()=>({useTheme:()=>({theme:'dark',toggleTheme:vi.fn()})}));
vi.mock('@/components/UnifiedShift',()=>({UnifiedShift:({room,shift,onDirtyChange}:{room:string;shift:string;onDirtyChange:(dirty:boolean)=>void})=><section><p>{room}/{shift}</p><button onClick={()=>onDirtyChange(true)}>Change usage</button><button onClick={()=>onDirtyChange(false)}>Save mock usage</button></section>}));
vi.mock('@/components/StockSummary',()=>({StockSummary:()=>null}));
afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe('daily usage flow',()=>{
  it('selects room, shift and entry type without showing stock forms',()=>{
    render(<MemoryRouter><DailyUsage /></MemoryRouter>);
    expect(screen.getByText('CT/morning')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'MRI'}));
    fireEvent.click(screen.getByRole('button',{name:'night'}));
    expect(screen.getByText('MRI/night')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Mammography'}));
    expect(screen.getByText('Mammography/night')).toBeInTheDocument();
    expect(screen.queryByText('Movement history')).not.toBeInTheDocument();
    expect(screen.queryByRole('link',{name:'Audit history'})).not.toBeInTheDocument();
  });
  it('locks room and shift while allowing confirmed date navigation with unsaved changes',()=>{
    render(<MemoryRouter><DailyUsage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button',{name:'Change usage'}));
    expect(screen.getByLabelText('Date')).not.toBeDisabled();
    expect(screen.getByRole('button',{name:'MRI'})).toBeDisabled();
    expect(screen.getByRole('button',{name:'night'})).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:'Save mock usage'}));
    expect(screen.getByRole('button',{name:'MRI'})).not.toBeDisabled();
  });
});

it('keeps the selected day when a draft navigation is cancelled, then permits previous day after confirmation',()=>{
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
 render(<MemoryRouter><DailyUsage/></MemoryRouter>);
 const date=screen.getByLabelText('Date') as HTMLInputElement;const initial=date.value;
 fireEvent.click(screen.getByRole('button',{name:'Change usage'}));
 expect(date).not.toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Previous day'}));
 expect(confirm).toHaveBeenCalledWith(expect.stringContaining('stay saved as a draft'));
 expect(date.value).toBe(initial);
 confirm.mockReturnValue(true);
 fireEvent.click(screen.getByRole('button',{name:'Previous day'}));
 expect(date.value).not.toBe(initial);
});
