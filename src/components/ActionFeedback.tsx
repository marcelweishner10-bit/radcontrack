import {useEffect,useState} from 'react';
import {CheckCircle2,AlertCircle,Loader2,X} from 'lucide-react';

/** Persistent feedback at the viewport edge, including on long/mobile forms. */
export function ActionFeedback({busy=false,busyLabel='Saving…',error='',success='',info='',onDismiss}: {
 busy?:boolean;busyLabel?:string;error?:string;success?:string;info?:string;onDismiss?:()=>void;
}) {
 const [slow,setSlow]=useState(false);
 useEffect(()=>{setSlow(false);if(!busy)return;const timer=window.setTimeout(()=>setSlow(true),10000);return()=>window.clearTimeout(timer);},[busy]);
 if(!busy&&!error&&!success&&!info)return null;
 const explanation=/could not find the function|schema cache/i.test(error)?'This app update is not ready on the server. Ask Honey to complete the update.':/fetch|network|timeout|connection/i.test(error)&&!success?`${error} Check your connection. Reload the saved record before trying again; the save may not have been confirmed.`:error;
 const Icon=busy?Loader2:error?AlertCircle:CheckCircle2;
 return <><div className="h-24" aria-hidden="true"/><div role={!busy&&error?'alert':'status'} aria-live={!busy&&error?'assertive':'polite'} aria-atomic="true" className={`fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-xl rounded-lg border p-4 shadow-lg ${busy?'bg-card text-foreground':error?'border-amber-500 bg-card text-foreground':'border-primary bg-card text-foreground'}`}>
  <div className="flex gap-3 items-start"><Icon aria-hidden="true" className={`h-5 w-5 shrink-0 mt-0.5 ${busy?'animate-spin':error?'text-amber-600':'text-primary'}`}/><div className="min-w-0 flex-1"><p className="font-semibold text-sm">{busy?(success?'Saved — refreshing the screen…':busyLabel):error?(success?'Saved — refresh needs attention':'Needs attention'):success?'Saved successfully':'Please review'}</p>
  <p className="text-sm mt-1 break-words">{busy?(slow?'Taking longer than usual. Keep this page open; do not save again.':'Please wait for confirmation before leaving this page.'):error?(success?`${success} ${explanation}`:explanation):success||info}</p></div>
  {!busy&&onDismiss&&<button type="button" aria-label="Dismiss action message" className="rounded p-1 hover:bg-muted focus-visible:outline focus-visible:outline-2" onClick={onDismiss}><X aria-hidden="true" className="h-4 w-4"/></button>}</div>
 </div></>;
}
