import {describe,it,expect} from 'vitest';
import {canEditUsageDay} from './usageEditAccess';
describe('usage correction window',()=>{
 it('allows staff today and yesterday, including month boundaries',()=>{
  expect(canEditUsageDay('2026-10-08','staff@test.com',false,'2026-10-08')).toBe(true);
  expect(canEditUsageDay('2026-10-07','staff@test.com',false,'2026-10-08')).toBe(true);
  expect(canEditUsageDay('2026-09-30','staff@test.com',false,'2026-10-01')).toBe(true);
  expect(canEditUsageDay('2026-10-06','staff@test.com',false,'2026-10-08')).toBe(false);
 });
 it('allows confirmed editor UI for Honey on older dates, without allowing future days',()=>{
  expect(canEditUsageDay('2026-09-01','honey.onabanjo@bthdc.com.ng',true,'2026-10-08')).toBe(true);
  expect(canEditUsageDay('2026-09-01','honey.onabanjo@bthdc.com.ng',false,'2026-10-08')).toBe(false);
  expect(canEditUsageDay('2026-10-09','honey.onabanjo@bthdc.com.ng',true,'2026-10-08')).toBe(false);
 });
});
