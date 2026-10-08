export const STOCK_ROOMS = ['X-ray', 'CT', 'MRI', 'Fluoroscopy', 'Mammography'] as const;
export const STOCK_LOCATIONS = [...STOCK_ROOMS, 'Shared'] as const;
export const stockLocation = (id:string,room:string) => ['ct_contrast','mri_contrast'].includes(id)?room:'Shared';
export const STOCK_SHIFTS = ['morning', 'afternoon', 'night'] as const;
export const isFilm = (id: string) => id === 'film1714' || id === 'film1210';
export const bottleCapacity = (id: string) => id === 'mri_contrast' ? 15 : ['ct_contrast', 'gastrolux'].includes(id) ? 100 : 0;
export const roomUnit = (id: string, unit: string) => bottleCapacity(id) ? 'ml' : isFilm(id) ? 'films' : unit;
export const toRoomUnits = (_id: string, quantity: number) => quantity;
export const stockAmount = (id: string, quantity: number) => bottleCapacity(id)
  ? `${Number(quantity.toFixed(2))} ml (${Number((quantity / bottleCapacity(id)).toFixed(3))} bottles equivalent)`
  : String(quantity);
