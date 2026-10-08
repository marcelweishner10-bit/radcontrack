import { useEffect, useState } from 'react';
import { format, startOfMonth } from 'date-fns';
import { AppNavigation } from '@/components/AppNavigation';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Json } from '@/integrations/supabase/types';
import {auditChanges,itemNames} from '@/lib/auditHistory';

type AuditRecord = { id:string;source:string;record_id:string;before_record:Record<string,Json>;after_record:Record<string,Json>;reason:string;changed_by:string;changed_at:string };
export default function AuditHistory() {
  const {canManageStock,canManageStaff}=useAuth();
  const allowed=canManageStock || canManageStaff;
  const [start,setStart]=useState(format(startOfMonth(new Date()),'yyyy-MM-dd'));
  const [end,setEnd]=useState(format(new Date(),'yyyy-MM-dd'));
  const [offset,setOffset]=useState(0);
  const [records,setRecords]=useState<AuditRecord[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    if(!allowed)return;
    if(!start || !end || start > end){setError('Choose a valid date range.');setRecords([]);setLoading(false);return;}
    let active=true; setLoading(true);setError('');setRecords([]);
    void Promise.resolve(supabase.rpc('stock_audit_history',{p_start:start,p_end:end,p_offset:offset,p_limit:50})).then(result=>{
      if(!active)return;
      if(result.error)setError(result.error.message.includes('Could not find the function')?'The audit-history database update has not been applied yet.':result.error.message);
      else setRecords((result.data || []) as unknown as AuditRecord[]);
      setLoading(false);
    }).catch(() => {if(active){setError('Unable to load audit history. Try Refresh.');setLoading(false);}});
    return()=>{active=false;};
  },[allowed,start,end,offset,revision]);
  return <div className="min-h-screen bg-background"><AppNavigation /><main className="max-w-6xl mx-auto px-4 sm:px-6 py-7 space-y-6">
    <div><h1 className="text-2xl font-bold">Audit history</h1><p className="text-muted-foreground mt-1">Edits and deletions, including the original values and the account that changed them.</p></div>
    {!allowed ? <p role="alert">Only authorised stock editors and administrators can view this history.</p> : <>
      <div className="flex flex-wrap items-end gap-3"><label>From<Input type="date" value={start} onChange={e=>{setStart(e.target.value);setOffset(0);}} /></label><label>To<Input type="date" value={end} onChange={e=>{setEnd(e.target.value);setOffset(0);}} /></label><Button variant="outline" disabled={loading} onClick={()=>setRevision(value=>value+1)}>Refresh</Button></div>
      {error&&<p role="alert" className="text-destructive">{error}</p>}
      {loading?<p role="status">Loading audit history…</p>:records.length===0&&!error?<p>No edits or deletions were recorded in this period.</p>:<div className="divide-y border-y">{records.map(record=>{
        const item=String(record.after_record.item_id || record.before_record.item_id || '');
        const deleted=!!record.after_record.voided_at;
        const changes=auditChanges(record.before_record,record.after_record);
        return <article key={record.id} className="py-5 space-y-3">
          <div><h2 className="font-semibold">{record.source==='clinical'?'Clinical records':record.source==='usage'?'Daily usage':record.source==='room'?'Room stock':'Store stock'}: {itemNames[item] || item || String(record.after_record.room || '')} {deleted?'deleted':'corrected'}</h2><p className="text-sm text-muted-foreground">{new Date(record.changed_at).toLocaleString('en-GB',{timeZone:'Africa/Lagos'})} · {record.changed_by}</p></div>
          <p className="text-sm"><span className="font-medium">Reason: </span>{record.reason}</p>
          <dl className="space-y-2">{changes.map(change=><div key={change.label} className="grid sm:grid-cols-[14rem_1fr_1fr] gap-1 sm:gap-3 text-sm"><dt className="font-medium">{change.label}</dt><dd className="break-words"><span className="text-muted-foreground">Before: </span>{change.before}</dd><dd className="break-words"><span className="text-muted-foreground">After: </span>{change.after}</dd></div>)}</dl>
        </article>;
      })}</div>}
      <div className="flex items-center gap-3"><Button variant="outline" disabled={loading||offset===0} onClick={()=>setOffset(value=>Math.max(0,value-50))}>Newer changes</Button><span className="text-sm text-muted-foreground">Page {offset/50+1}</span><Button variant="outline" disabled={loading||records.length<50} onClick={()=>setOffset(value=>value+50)}>Older changes</Button></div>
    </>}
  </main></div>;
}
