\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',true);
do $$declare r text;v jsonb;v_id uuid;begin
 foreach r in array array['X-ray','Fluoroscopy','Mammography'] loop
  if radcontrack_private.shift_item('cd',r,'1999-01-01','morning') then raise exception 'Default optional item visible';end if;
  insert into public.room_stock_movements(batch_id,room,item_id,movement_type,change,balance_after,balance_known,occurred_on,shift,staff_name,recorded_by)
  values(gen_random_uuid(),r,'cd','pick',5,5,true,'1999-01-01','afternoon','QA',auth.uid()) returning id into v_id;
  if radcontrack_private.shift_item('cd',r,'1999-01-01','morning') then raise exception 'Future pickup leaked backwards';end if;
  v:=public.shift_context('1999-01-01',r,'afternoon');
  if not exists(select 1 from jsonb_array_elements(v->'items') i where i->>'id'='cd' and (i->>'initial_received')::numeric=5) then raise exception 'Picked item absent from context';end if;
  if not radcontrack_private.shift_item('cd',r,'1999-01-02','morning') then raise exception 'Carryover disappeared';end if;
  begin
   perform public.save_shift('1999-01-01',r,'afternoon','{"cd":{"used":"bad"}}','QA',0,0,0,false,'{}','','');
   raise exception 'Invalid amount accepted';
  exception when others then
   if sqlerrm<>'Enter a valid amount used' then raise;end if;
  end;
  insert into public.room_stock_movements(batch_id,room,item_id,movement_type,change,balance_after,balance_known,occurred_on,shift,staff_name,recorded_by)
  values(gen_random_uuid(),r,'cd','usage',-5,0,true,'1999-01-01','afternoon','QA',auth.uid());
  if not radcontrack_private.shift_item('cd',r,'1999-01-01','afternoon') then raise exception 'Depleted pickup hidden in its shift';end if;
  if radcontrack_private.shift_item('cd',r,'1999-01-02','morning') then raise exception 'Depleted item visible next day';end if;
  insert into public.room_shift_reviews(date,room,shift,details) values('1999-01-02',r,'morning','{"cd":{"used":0}}');
  if not radcontrack_private.shift_item('cd',r,'1999-01-02','morning') then raise exception 'Saved detail hidden';end if;
  update public.room_stock_movements set voided_at=now() where id=v_id;
 end loop;
 if not radcontrack_private.shift_item('ct_contrast','Fluoroscopy','1999-01-01','morning') then raise exception 'Lost routine contrast';end if;
end $$;
rollback;
select 'Optional picks, timing, carryover, depletion, saved records and save validation passed in all three rooms' result;
