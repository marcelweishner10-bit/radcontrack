import { NavLink } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/hooks/useTheme';
import { Button } from '@/components/ui/button';
import { Sun, Moon } from 'lucide-react';
import { TrackRadBrand } from './TrackRadBrand';

export function AppNavigation() {
  const { user, canManageStock, canManageStaff, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const linkStyle = ({ isActive }: { isActive: boolean }) => `rounded-md px-3 py-2 text-sm font-medium ${isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`;
  return <header className="border-b bg-card">
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
      <div className="space-y-1"><TrackRadBrand /><p className="text-xs text-muted-foreground break-all">{user?.email}</p></div>
      <nav aria-label="Main navigation" className="flex flex-wrap gap-1">
        <NavLink to="/" end className={linkStyle}>Daily usage</NavLink>
        <NavLink to="/stock" className={linkStyle}>Stock</NavLink>
        <NavLink to="/usage" className={linkStyle}>Reports</NavLink>
        {(canManageStock || canManageStaff) && <NavLink to="/audit" className={linkStyle}>Audit history</NavLink>}
      </nav>
      <div className="flex gap-1"><Button variant="ghost" size="icon" aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'} onClick={toggleTheme}>{theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</Button><Button variant="ghost" size="sm" onClick={() => void signOut()}>Sign out</Button></div>
    </div>
  </header>;
}

export function StockNavigation() {
  const { canManageStock, canManageStaff } = useAuth();
  const links = [
    { to:'/stock/pick', label:'Pick for a room', visible:true },
    { to:'/stock/receive', label:'Receive stock', visible:canManageStock },
    { to:'/stock/count', label:'Count what is left', visible:true },
    { to:'/stock/balances', label:'Balances', visible:true },
    { to:'/stock/history', label:'Movement history', visible:true },
    { to:'/stock/access', label:'Staff access', visible:canManageStaff },
  ];
  return <nav aria-label="Stock tasks" className="flex flex-wrap gap-2 border-b pb-4">{links.filter(link => link.visible).map(link => <NavLink key={link.to} to={link.to} className={({isActive}) => `rounded-md px-3 py-2 text-sm ${isActive ? 'bg-primary/10 text-primary font-semibold' : 'text-muted-foreground hover:bg-muted'}`}>{link.label}</NavLink>)}</nav>;
}
