import { describe, expect, it } from 'vitest';
import { isSharedItem, stockLocation } from './roomStock';

describe('stock routing', () => {
  it('sends each item to the same location as the database', () => {
    expect(stockLocation('mri_contrast', 'CT')).toBe('MRI');
    expect(stockLocation('ct_contrast', 'MRI')).toBe('CT');
    expect(stockLocation('ct_contrast', 'Fluoroscopy')).toBe('Fluoroscopy');
    expect(stockLocation('gastrolux', 'CT')).toBe('Shared');
    expect(stockLocation('film1210', 'X-ray')).toBe('Shared');
    expect(isSharedItem('cd')).toBe(true);
    expect(isSharedItem('ct_contrast')).toBe(false);
  });
});
