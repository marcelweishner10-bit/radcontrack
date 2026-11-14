export type CloseDetail = {used?:number;reviewed?:boolean;patients?:number};
export type CloseItem = {key:string;id:string;room:string;name:string;unit:string;cadence:'daily'|'pack';earlier:number;remaining:number;deducted:number;picked:number};
export type CloseDetails = Record<string,CloseDetail>;
export function closeMissing(items:CloseItem[],details:CloseDetails) {
 return items.filter(i=>{const d=details[i.key];return i.cadence==='daily' && (!d?.reviewed || d.used===undefined || (i.id.startsWith('film')&&(d.patients===undefined||((d.used||0)>0&&d.patients===0))));});
}
export function closeProblem(items:CloseItem[],details:CloseDetails,finish=false):string|null {
 for(const i of items){const d=details[i.key];if(!d)continue;
  if(d.used===undefined||!Number.isSafeInteger(d.used)||d.used<0)return `${i.room} / ${i.name}: enter a whole quantity.`;
  if(d.used<i.earlier)return `${i.room} / ${i.name}: ${i.earlier} already recorded in earlier shifts. Correct that entry first.`;
  if(finish&&i.id.startsWith('film')&&d.patients===undefined)return `${i.room} / ${i.name}: enter patients printed for.`;
  if(i.id.startsWith('film')&&(d.used||0)>0&&d.patients===0)return `${i.room} / ${i.name}: enter patients printed for.`;
  if(d.patients!==undefined&&(!Number.isSafeInteger(d.patients)||d.patients<0||d.patients>d.used))return `${i.room} / ${i.name}: check patients printed for.`;
 }
 return null;
}
export const closeExtra=(i:CloseItem[],d:CloseDetails,id:string)=>i.filter(x=>x.id===id).reduce((n,x)=>n+((d[x.key]?.used??(x.earlier+x.deducted))-x.earlier-x.deducted),0);
