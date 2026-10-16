\set ON_ERROR_STOP on
-- Runs against a production replica; everything rolls back.
begin;
do $$declare honey uuid; staff uuid; v integer; ct_before numeric; mri_before numeric; audits integer;
begin
 select id into honey from auth.users where email='honey.onabanjo@bthdc.com.ng';
 select id into staff from auth.users where email='btradiographers@gmail.com';
 select count(*) into audits from radcontrack_private.stock_correction_audit;
 select balance into ct_before from public.room_stock where room='CT' and item_id='ct_contrast';
 select balance into mri_before from public.room_stock where room='MRI' and item_id='mri_contrast';

 -- The shared staff login cannot move picks.
 perform set_config('request.jwt.claim.sub',staff::text,true);
 begin perform public.correct_pick_room('0d09f785-1ebe-4ffe-9c2e-89788381e152',1,'CT','Picked for CT, recorded in MRI');
  raise exception 'Staff login moved a pick';
 exception when others then if sqlerrm not like 'Only authorised stock editors%' then raise; end if; end;

 perform set_config('request.jwt.claim.sub',honey::text,true);
 -- Contrast rules still apply.
 begin perform public.correct_pick_room('0d09f785-1ebe-4ffe-9c2e-89788381e152',1,'X-ray','Wrong room test');
  raise exception 'CT contrast moved to X-ray';
 exception when others then if sqlerrm not like 'CT contrast must go%' then raise; end if; end;
 -- A stale version is rejected.
 begin perform public.correct_pick_room('0d09f785-1ebe-4ffe-9c2e-89788381e152',7,'CT','Stale version test');
  raise exception 'Stale version accepted';
 exception when others then if sqlerrm not like 'This pick changed%' then raise; end if; end;

 v:=public.correct_pick_room('0d09f785-1ebe-4ffe-9c2e-89788381e152',1,'CT','9 Oct JETHRO pick: 1000 ml CT contrast was taken to CT but recorded under MRI');
 v:=public.correct_pick_room('942f822d-e39f-4077-8878-01c3016f5ad8',1,'MRI','14 Oct GEORGE pick: 30 ml MRI contrast was taken to MRI but recorded under CT');

 if (select balance from public.room_stock where room='MRI' and item_id='ct_contrast')<>0 then raise exception 'MRI still holds CT contrast'; end if;
 if (select balance from public.room_stock where room='CT' and item_id='mri_contrast')<>0 then raise exception 'CT still holds MRI contrast'; end if;
 if (select balance from public.room_stock where room='CT' and item_id='ct_contrast')<>ct_before+1000 then raise exception 'CT contrast not added to CT'; end if;
 if (select balance from public.room_stock where room='MRI' and item_id='mri_contrast')<>mri_before+30 then raise exception 'MRI contrast not added to MRI'; end if;
 if (select count(*) from radcontrack_private.stock_correction_audit)<>audits+4 then raise exception 'Expected four audit records'; end if;
 if exists(select 1 from public.room_stock rs where rs.balance<>(select coalesce(sum(change),0) from public.room_stock_movements m where m.room=rs.room and m.item_id=rs.item_id and voided_at is null)) then raise exception 'Room balance no longer matches its movements'; end if;
 if (select destination from public.stock_movements where id='0d09f785-1ebe-4ffe-9c2e-89788381e152')<>'CT' then raise exception 'Store destination not updated'; end if;
 -- Store balances are untouched.
 if (select balance from public.stock_items where id='ct_contrast')<>3075 or (select balance from public.stock_items where id='mri_contrast')<>210 then raise exception 'Store balance changed'; end if;
 -- The same correction cannot be applied twice.
 begin perform public.correct_pick_room('0d09f785-1ebe-4ffe-9c2e-89788381e152',1,'CT','Repeat test');
  raise exception 'Repeat correction accepted';
 exception when others then if sqlerrm not like 'This pick changed%' then raise; end if; end;
 raise notice 'correct_pick_room: all checks passed (CT ct_contrast % -> %, MRI mri_contrast % -> %)',ct_before,ct_before+1000,mri_before,mri_before+30;
end $$;
rollback;
