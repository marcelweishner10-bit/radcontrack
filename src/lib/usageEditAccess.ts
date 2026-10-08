import { format,parseISO,subDays } from 'date-fns';
import { lagosToday } from './stockEntryValidation';
export function canEditUsageDay(date:string,email:string|undefined,canManageStock:boolean,today=lagosToday()) {
 const honey=canManageStock&&email?.toLowerCase()==='honey.onabanjo@bthdc.com.ng';
 return date<=today&&(honey||date>=format(subDays(parseISO(today),1),'yyyy-MM-dd'));
}
