import type { Json } from '@/integrations/supabase/types';
export const itemNames:Record<string,string> = {ct_contrast:'CT contrast',mri_contrast:'MRI contrast',gastrolux:'Gastrolux',film1714:'17 × 14 films',film1210:'12 × 10 films',cd:'CD plates',cd_jacket:'CD sleeves',gloves_pack:'Gloves (packs)',gloves_piece:'Gloves (earlier pieces)',single_connector:'Single connector',double_connector:'Double connector',wipes:'Wipes',a4_paper:'A4 paper',hexopax:'Hexopax',marker:'CD marker',sanitizer:'Hand sanitiser',cotton_wool:'Cotton wool',spirit:'Spirit'};
const labels:Record<string,string> = {staff:'Recorded by',note:'Difference explanation',finished:'Shift finished',quantity:'Quantity',balance_after:'Counted balance',occurred_on:'Date',date:'Date',recipient_name:'Received, picked or counted by',staff_name:'Staff name',recorded_by_name:'Recorded by',reference:'Reference',destination:'Room',room:'Room',shift:'Shift',patients:'Patients',administered_ml:'Administered ml',waste_ml:'Discarded ml'};
const textValue = (value:Json|undefined) => value === null || value === undefined || value === '' ? 'Not recorded' : typeof value === 'object' ? JSON.stringify(value) : String(value);
export function auditChanges(before:Record<string,Json>,after:Record<string,Json>) {
  const changes:{label:string;before:string;after:string}[]=[];
  for(const [key,label] of Object.entries(labels)) if(JSON.stringify(before[key])!==JSON.stringify(after[key])) changes.push({label,before:textValue(before[key]),after:textValue(after[key])});
  const oldQty=(before.quantities || {}) as Record<string,Json>;
  const newQty=(after.quantities || {}) as Record<string,Json>;
  for(const item of new Set([...Object.keys(oldQty),...Object.keys(newQty)])) if(JSON.stringify(oldQty[item])!==JSON.stringify(newQty[item])) changes.push({label:itemNames[item] || item,before:textValue(oldQty[item] ?? 0),after:textValue(newQty[item] ?? 0)});
  const oldVolumes=(before.contrast_volumes || {}) as Record<string,Record<string,Json>>;
  const newVolumes=(after.contrast_volumes || {}) as Record<string,Record<string,Json>>;
  for(const item of new Set([...Object.keys(oldVolumes),...Object.keys(newVolumes)])) for(const field of ['administered_ml','waste_ml']) if(JSON.stringify(oldVolumes[item]?.[field])!==JSON.stringify(newVolumes[item]?.[field])) changes.push({label:`${itemNames[item] || item}: ${labels[field]}`,before:textValue(oldVolumes[item]?.[field]),after:textValue(newVolumes[item]?.[field])});
  for(const group of ['details','physical']) {
    const oldValues=(before[group]||{}) as Record<string,Json>;
    const newValues=(after[group]||{}) as Record<string,Json>;
    for(const item of new Set([...Object.keys(oldValues),...Object.keys(newValues)])) {
      if(group==='physical') {
        if(oldValues[item]!==newValues[item])changes.push({label:(itemNames[item]||item)+' actually remaining',before:textValue(oldValues[item]),after:textValue(newValues[item])});
      } else for(const field of ['used','waste','patients','reviewed']) {
        const oldDetail=(oldValues[item]||{}) as Record<string,Json>,newDetail=(newValues[item]||{}) as Record<string,Json>;
        if(oldDetail[field]!==newDetail[field])changes.push({label:(itemNames[item]||item)+' '+field,before:textValue(oldDetail[field]),after:textValue(newDetail[field])});
      }
    }
  }
  if(!before.voided_at && after.voided_at) changes.push({label:'Status',before:'Active',after:'Deleted'});
  if(JSON.stringify(before.data)!==JSON.stringify(after.data))changes.push({label:'Clinical record',before:textValue(before.data),after:textValue(after.data)});
  return changes;
}

