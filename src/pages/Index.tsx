import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, RotateCcw } from 'lucide-react';
import { useContrastData } from '@/hooks/useContrastData';
import { AppNavigation } from '@/components/AppNavigation';
import { ShiftSection } from '@/components/ShiftSection';
import { DateSelector } from '@/components/DateSelector';
import { DailySummary } from '@/components/DailySummary';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import type { ShiftType } from '@/types/contrast';
import { useEffect } from 'react';
import { parseISO } from 'date-fns';
import { useAuth } from '@/hooks/useAuth';
import { canEditUsageDay } from '@/lib/usageEditAccess';

export const Dashboard = () => {
  const {user,canManageStock}=useAuth();
  const {selectedDate,setSelectedDate,data,isLoading,updateReceived,updateAdditionalReceived,updateConsumption,updatePatients,getReceivedValues,getAdditionalReceivedValues,getOutstandingValues,updateMetadata,resetForm,connected,loadingError}=useContrastData();
  const params = new URLSearchParams(window.location.search);
  const [shift,setShift]=useState<ShiftType>(['morning','afternoon','night'].includes(params.get('shift')||'') ? params.get('shift') as ShiftType : 'morning');
  useEffect(() => { const date = params.get('date'); if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) setSelectedDate(parseISO(date)); }, []);
  const [editingDate,setEditingDate]=useState<string|null>(null);
  return <div className="min-h-screen bg-background"><AppNavigation />
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-7 space-y-6">
      <div><h1 className="text-2xl font-bold">Clinical shift records</h1><p className="text-muted-foreground mt-1 max-w-prose">Your saved contrast entries remain here. Continue unfinished entries in this table. Corrections recalculate the later shifts in this day. New connected room entries are on the <Link className="text-primary underline" to="/">Daily usage page</Link>.</p></div>
      <DateSelector selectedDate={selectedDate} onDateChange={setSelectedDate} />
      <fieldset><legend className="text-sm font-medium mb-2">Shift</legend><div className="flex flex-wrap gap-2">{(['morning','afternoon','night'] as const).map(value=><Button key={value} aria-pressed={shift===value} variant={shift===value?'default':'outline'} className="capitalize" onClick={()=>setShift(value)}>{value}</Button>)}</div></fieldset>
      {connected&&<p role="status" className="rounded-lg border p-4">This date now uses the connected room tables. <Link className="text-primary underline font-semibold" to={`/?date=${data.date}&shift=${shift}&room=CT`}>Open the saved CT shift</Link> or <Link className="text-primary underline font-semibold" to={`/?date=${data.date}&shift=${shift}&room=MRI`}>open the saved MRI shift</Link>. The original table below is retained as a reference.</p>}
      {!connected&&canEditUsageDay(data.date,user?.email,canManageStock)&&!isLoading&&!loadingError&&<div><Button variant="outline" onClick={()=>{if(editingDate===data.date){setEditingDate(null);return;}if(window.confirm('Edit this clinical record for '+data.date+'? Changes save automatically and recalculate later shifts in this day. Cancel keeps the record unchanged.'))setEditingDate(data.date);}}>{editingDate===data.date?'Stop editing':'Enter or edit clinical record'}</Button><p className="text-sm text-muted-foreground mt-2">{editingDate===data.date?'Editing enabled. Changes save automatically.':'View only. Choose Enter or edit clinical record to make changes.'}</p></div>}
      {isLoading?<p role="status" className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading clinical record…</p>:loadingError?<p role="alert" className="text-destructive">{loadingError}</p>:<fieldset disabled={connected||editingDate!==data.date||!canEditUsageDay(data.date,user?.email,canManageStock)}><ShiftSection shift={shift} shiftData={data[shift]} getReceivedValues={getReceivedValues} getAdditionalReceivedValues={getAdditionalReceivedValues} getOutstandingValues={getOutstandingValues} onReceivedChange={updateReceived} onAdditionalReceivedChange={updateAdditionalReceived} onConsumptionChange={updateConsumption} onPatientsChange={updatePatients} onMetadataChange={updateMetadata} /></fieldset>}
      <details className="border-t pt-4"><summary className="cursor-pointer font-medium">Clinical daily summary</summary><div className="mt-4"><DailySummary data={data} /></div></details>

    </main>
  </div>;
};
export default Dashboard;
