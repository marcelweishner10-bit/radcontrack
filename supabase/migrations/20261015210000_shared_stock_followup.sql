begin;
-- Follow-up to 20261008135954_shared_consumable_stock. Apply immediately after it.
-- Restores modality-relevant item lists and optional picked items, routes contrast per item,
-- records which room a Shared pickup was collected for, shows other rooms' Shared use separately,
-- and lets staff finish a shift after reviewing every item without a physical count.

-- 1. Which room a pickup was collected for. Shared stock keeps one balance; this is attribution only.
alter table public.stock_movements add column picked_for text
 check(picked_for in ('X-ray','CT','MRI','Fluoroscopy','Mammography'));
alter table public.stock_movements disable trigger guard_past_department_pick;
update public.stock_movements s set picked_for=m.usage_room from public.room_stock_movements m
 where s.movement_type='issue' and m.batch_id=s.batch_id and m.item_id=s.item_id and m.movement_type='pick'
 and m.usage_room in ('X-ray','CT','MRI','Fluoroscopy','Mammography');
update public.stock_movements set picked_for=destination
 where movement_type='issue' and picked_for is null and destination in ('X-ray','CT','MRI','Fluoroscopy','Mammography');
alter table public.stock_movements enable trigger guard_past_department_pick;
create index stock_movements_picked_for_idx on public.stock_movements(occurred_on,picked_for) where movement_type='issue';
create index room_stock_movements_shift_idx on public.room_stock_movements(room,item_id,occurred_on);

-- 2. Picks: each line goes to its clinical location. MRI contrast always goes to MRI; CT contrast
-- goes to CT unless picked for Fluoroscopy; everything else goes to Shared stock.
create or replace function radcontrack_private.move_room_stock(p_type text,p_date date,p_staff text,p_lines jsonb,p_room text,p_shift text,p_reference text,p_request uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_batch uuid:=coalesce(p_request,gen_random_uuid()); v_line jsonb; v_item public.stock_items; v_room public.room_stock; v_qty numeric; v_after numeric; v_payload jsonb; v_existing jsonb; v_location text; v_for text;
begin
 perform radcontrack_private.assert_stock_user();
 if p_type in ('receipt','opening') then perform radcontrack_private.assert_stock_manager(); end if;
 v_payload:=jsonb_build_object('type',p_type,'date',p_date,'staff',p_staff,'lines',p_lines,'room',p_room,'shift',p_shift,'reference',p_reference);
 insert into radcontrack_private.stock_batch_requests(id,payload,recorded_by) values(v_batch,v_payload,auth.uid()) on conflict do nothing;
 if not found then
  select payload into v_existing from radcontrack_private.stock_batch_requests where id=v_batch and recorded_by=auth.uid();
  if v_existing is distinct from v_payload then raise exception 'This entry changed after an uncertain save. Reload the register and review the earlier entry'; end if;
  return v_batch;
 end if;
 if p_type not in ('receipt','issue','opening','room_count') or p_type is null or p_date is null or p_date>(now() at time zone 'Africa/Lagos')::date or length(btrim(coalesce(p_staff,'')))<2 or jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'Complete the date, staff name and items'; end if;
 if jsonb_array_length(p_lines) not between 1 and 50 then raise exception 'Choose at least one item'; end if;
 if p_type in ('issue','room_count') and (p_room is null or p_room not in ('X-ray','CT','MRI','Fluoroscopy','Mammography','Shared')) then raise exception 'Choose the room receiving the stock'; end if;
 if p_type='issue' and (p_shift is null or p_shift not in ('morning','afternoon','night')) then raise exception 'Choose the shift receiving the stock'; end if;
 if p_type in ('opening','room_count') and p_date<>(now() at time zone 'Africa/Lagos')::date then raise exception 'Use today for a physical count of what is here now'; end if;
 if (select count(distinct value->>'item_id') from jsonb_array_elements(p_lines))<>jsonb_array_length(p_lines) then raise exception 'List each item only once'; end if;
 v_for:=case when p_type='issue' and p_room<>'Shared' then p_room end;
 for v_line in select value from jsonb_array_elements(p_lines) order by value->>'item_id' loop
  if jsonb_typeof(v_line->'quantity') is distinct from 'number' or (v_line->>'quantity') !~ '^[0-9]+(\.[0-9]{1,2})?$' then raise exception 'Enter whole quantities'; end if;
  v_qty:=(v_line->>'quantity')::numeric;
  if v_qty<0 or v_qty>1000000 or (v_qty=0 and p_type in ('receipt','issue')) then raise exception 'Only physical counts may be zero'; end if;
  select * into v_item from public.stock_items where id=v_line->>'item_id' and active for update;
  if not found then raise exception 'Choose a valid stock item'; end if;
  if v_qty<>trunc(v_qty) and v_item.id not in ('ct_contrast','mri_contrast','gastrolux') then raise exception 'Only contrast quantities accept decimal millilitres'; end if;
  if p_type='issue' then
   v_location:=case when v_item.id='mri_contrast' then 'MRI'
    when v_item.id='ct_contrast' then case when p_room in ('CT','Fluoroscopy') then p_room else 'CT' end
    else 'Shared' end;
  else
   v_location:=radcontrack_private.stock_location(v_item.id,p_room);
   if p_type='room_count' and v_item.id='mri_contrast' and p_room<>'MRI' then raise exception 'MRI contrast is counted in the MRI room';end if;
   if p_type='room_count' and v_item.id='ct_contrast' and p_room not in ('CT','Fluoroscopy') then raise exception 'CT contrast is counted in CT or Fluoroscopy';end if;
  end if;
  if p_type<>'room_count' then
   if p_type<>'opening' and p_date<v_item.counted_on then raise exception 'This movement predates the latest store count. Do not add stock already included in that count'; end if;
   if p_type='issue' and v_item.balance<v_qty then raise exception 'Not enough recorded % in department stock. Record the missing collection or a department count first',v_item.name; end if;
   v_after:=case p_type when 'opening' then v_qty when 'issue' then v_item.balance-v_qty else v_item.balance+v_qty end;
   insert into public.stock_movements(batch_id,item_id,movement_type,quantity,balance_after,balance_known,occurred_on,recipient_name,destination,picked_for,shift,reference,recorded_by)
    values(v_batch,v_item.id,p_type,v_qty,v_after,v_item.opening_recorded or p_type='opening',p_date,btrim(p_staff),case when p_type='issue' then v_location end,v_for,p_shift,p_reference,auth.uid());
   update public.stock_items set balance=v_after,opening_recorded=opening_recorded or p_type='opening',counted_on=case when p_type='opening' then p_date else counted_on end,counted_at=case when p_type='opening' then clock_timestamp() else counted_at end where id=v_item.id;
  end if;
  if p_type in ('issue','room_count') then
   insert into public.room_stock(room,item_id) values(v_location,v_item.id) on conflict do nothing;
   select * into v_room from public.room_stock where room=v_location and item_id=v_item.id for update;
   if p_type='issue' and p_date<v_room.counted_on then raise exception 'This pick predates the % count and may already be included in it',v_location; end if;
   v_after:=case when p_type='room_count' then v_qty else v_room.balance+v_qty end;
   insert into public.room_stock_movements(batch_id,room,item_id,movement_type,change,balance_after,balance_known,occurred_on,shift,staff_name,recorded_by,usage_room)
    values(v_batch,v_location,v_item.id,case when p_type='issue' then 'pick' else 'count' end,v_after-v_room.balance,v_after,v_room.counted_on is not null or p_type='room_count',p_date,p_shift,btrim(p_staff),auth.uid(),case when v_location='Shared' then v_for end);
   update public.room_stock set balance=v_after,counted_on=case when p_type='room_count' then p_date else counted_on end,counted_at=case when p_type='room_count' then clock_timestamp() else counted_at end where room=v_location and item_id=v_item.id;
  end if;
 end loop;
 return v_batch;
end $$;

-- 3. Routine items per modality (as in production before Shared stock).
create or replace function radcontrack_private.routine_item(p_id text,p_room text) returns boolean language sql immutable set search_path='' as $$
 select case when p_id in ('a4_paper','gloves_piece') then false
 when p_room in ('X-ray','Fluoroscopy','Mammography') and p_id in ('cd','cd_jacket','double_connector','electrodes','injector_syringe','marker','single_connector','wipes') then false
 when p_id='mri_contrast' then p_room='MRI'
 when p_id in ('ct_contrast','gastrolux') then p_room in ('CT','Fluoroscopy') else true end
$$;

-- 4. Optional supplies appear in X-ray, Fluoroscopy and Mammography when collected for or used
-- in that room during the last 14 days, or already entered for this shift.
create or replace function radcontrack_private.shift_item(p_id text,p_room text,p_date date,p_shift text) returns boolean
language plpgsql stable security invoker set search_path='' as $$
begin
 perform radcontrack_private.assert_stock_user();
 if radcontrack_private.routine_item(p_id,p_room) then return true;end if;
 if p_room not in ('X-ray','Fluoroscopy','Mammography') or p_id not in ('cd','cd_jacket','double_connector','electrodes','injector_syringe','marker','single_connector','wipes') then return false;end if;
 return exists(select 1 from public.room_stock_movements where usage_room=p_room and item_id=p_id and voided_at is null
   and movement_type in ('pick','usage') and occurred_on between p_date-14 and p_date)
  or exists(select 1 from public.stock_shift_usage where date=p_date and room=p_room and shift=p_shift and coalesce((quantities->>p_id)::numeric,0)>0)
  or exists(select 1 from public.room_shift_reviews where date=p_date and room=p_room and shift=p_shift and details ? p_id);
end $$;

-- 5. Shift context. The token covers only movements that affect this shift (dated up to it): this
-- room's stock, Shared pickups and counts, and this room's own Shared usage. Later days and other
-- rooms' usage no longer mark a saved shift as changed.
create or replace function radcontrack_private.shift_context(p_date date,p_room text,p_shift text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_result jsonb; v_rank integer; v_token text;
begin
 perform radcontrack_private.assert_stock_user();
 v_rank:=array_position(array['morning','afternoon','night'],p_shift);
 if v_rank is null or p_room not in ('X-ray','CT','MRI','Fluoroscopy','Mammography') then raise exception 'Choose a room and shift';end if;
 select md5(coalesce(string_agg(id::text||':'||version::text||':'||change::text||':'||coalesce(voided_at::text,''),',' order by id),'')) into v_token
 from public.room_stock_movements where (room=p_room or (room='Shared' and (movement_type in ('pick','count') or usage_room=p_room)))
  and (occurred_on<p_date or (occurred_on=p_date and coalesce(array_position(array['morning','afternoon','night'],shift),1)<=v_rank));
 with movements as (
 select *,coalesce(array_position(array['morning','afternoon','night'],shift),1) as rank
 from public.room_stock_movements where room in (p_room,'Shared') and voided_at is null
 ), picks as (
 select id,row_number() over(partition by item_id order by created_at,id) as pick_number
 from movements where occurred_on=p_date and rank=v_rank and movement_type='pick'
 ), flows as (
 select i.id,i.name,i.unit,
 radcontrack_private.stock_location(i.id,p_room)='Shared' as shared,
 coalesce(sum(m.change) filter(where m.occurred_on<p_date or (m.occurred_on=p_date and m.rank<v_rank)),0) as opening,
 coalesce(sum(m.change) filter(where m.occurred_on=p_date and m.rank=v_rank and m.movement_type='pick'),0) as received,
 coalesce(sum(m.change) filter(where m.occurred_on=p_date and m.rank=v_rank and m.movement_type='pick' and m.usage_room=p_room),0) as received_for_room,
 coalesce(sum(m.change) filter(where p.pick_number=1),0) as initial_received,
 coalesce(sum(m.change) filter(where p.pick_number>1),0) as topups,
 coalesce(sum(m.change) filter(where m.occurred_on=p_date and m.rank=v_rank and m.movement_type='count'),0) as adjustment,
 coalesce(-sum(m.change) filter(where m.room='Shared' and m.occurred_on=p_date and m.rank=v_rank and m.movement_type in ('usage','correction') and m.usage_room is distinct from p_room),0) as used_elsewhere,
 coalesce(sum(m.change) filter(where m.occurred_on<p_date or (m.occurred_on=p_date and m.rank<=v_rank)),0) as remaining,
 ((i.id in ('ct_contrast','mri_contrast') or exists(select 1 from public.room_stock rs where rs.room='Shared' and rs.item_id=i.id and rs.counted_on is not null)) and coalesce(bool_or(m.movement_type='count' and (m.occurred_on<p_date or (m.occurred_on=p_date and m.rank<=v_rank))),false)
 and not coalesce(bool_or(m.movement_type='count' and m.occurred_on=p_date and m.shift is null),false)) as known
 from public.stock_items i left join movements m on m.item_id=i.id and m.room=radcontrack_private.stock_location(i.id,p_room) left join picks p on p.id=m.id
 where i.active and radcontrack_private.shift_item(i.id,p_room,p_date,p_shift) group by i.id,i.name,i.unit
 ) select jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(flows) order by name),'[]'),'token',v_token) into v_result from flows;
 return v_result;
end $$;

-- 6. Finishing a shift means every item was reviewed (used, or None used). Physical counts are a
-- separate stock check that replaces balances; they are no longer required here.
create or replace function radcontrack_private.save_shift(p_date date,p_room text,p_shift text,p_details jsonb,p_staff text,
 p_version integer,p_film_version integer,p_supply_version integer,p_finish boolean,p_physical jsonb,p_note text,p_token text) returns integer
language plpgsql security definer set search_path='' as $$
declare v_old public.room_shift_reviews; v_id text; v_d jsonb; v_qty numeric; v_pat integer;
 v_films jsonb; v_supplies jsonb; v_volumes jsonb:='{}'; v_film_pat integer:=0;
 v_context jsonb; v_item jsonb; v_previous numeric; v_res integer; v_name text;
begin
 perform radcontrack_private.assert_stock_user();
 if p_date is null or p_date>(now() at time zone 'Africa/Lagos')::date or p_room is null or p_room not in ('X-ray','CT','MRI','Fluoroscopy','Mammography') or p_shift is null or p_shift not in ('morning','afternoon','night') or length(btrim(coalesce(p_staff,'')))<2 or jsonb_typeof(p_details) is distinct from 'object' or p_finish is null then raise exception 'Complete the date, room, shift and staff name';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('clinical/'||p_date::text,0));
 -- Do not silently count an earlier separate clinical record a second time.
 if exists(select 1 from public.daily_contrast_data d, jsonb_each(d.data) s, jsonb_each(case when jsonb_typeof(s.value)='object' then s.value else '{}' end) c
 where d.date::text=p_date::text and not exists(select 1 from public.clinical_stock_transitions t where t.date::text=d.date::text) and s.key=p_shift and c.key in ('jodascan300','hexopack350','gastrolux','mriContrast') and (coalesce((c.value#>>'{consumption,mls}')::numeric,0)>0 or coalesce((c.value#>>'{consumption,bottles}')::numeric,0)>0 or coalesce((c.value->>'patients')::numeric,0)>0))
 and ((p_finish and p_room in ('CT','MRI','Fluoroscopy')) or exists(select 1 from jsonb_each(p_details) x where x.key in ('ct_contrast','mri_contrast','gastrolux') and coalesce((x.value->>'used')::numeric,0)>0))
 then raise exception 'This shift has an earlier clinical contrast entry. Reconcile that entry before adding connected contrast usage; it has not been deducted again';end if;
 -- Same lock order as other inventory writers.
 perform 1 from public.stock_items order by id for update;
 insert into public.room_shift_reviews(date,room,shift) values(p_date,p_room,p_shift) on conflict do nothing;
 select * into v_old from public.room_shift_reviews where date=p_date and room=p_room and shift=p_shift for update;
 if v_old.version is distinct from p_version then raise exception 'This shift changed. Reload before saving';end if;
 v_context:=radcontrack_private.shift_context(p_date,p_room,p_shift);
 if p_finish and v_context->>'token' is distinct from p_token then raise exception 'A pickup or this room''s usage changed since you opened the shift. Reload and review before finishing';end if;
 select quantities into v_films from public.stock_shift_usage where date=p_date and room=p_room and shift=p_shift and category='films';
 select quantities into v_supplies from public.stock_shift_usage where date=p_date and room=p_room and shift=p_shift and category='supplies';
 v_films:=coalesce(v_films,'{}');v_supplies:=coalesce(v_supplies,'{}');
 -- Preserve administrative/historical quantities outside the routine form.
 foreach v_id in array array['ct_contrast','mri_contrast','gastrolux'] loop
  if v_supplies ? v_id then v_volumes:=jsonb_set(v_volumes,array[v_id],'{"keep_existing":true}');end if;
 end loop;
 for v_id,v_d in select key,value from jsonb_each(p_details) loop
  select name into v_name from public.stock_items where id=v_id and active and radcontrack_private.shift_item(id,p_room,p_date,p_shift);
  if not found then raise exception 'Choose a routine item for this room';end if;
  if jsonb_typeof(v_d->'used') is distinct from 'number' or (v_d->>'used')!~'^[0-9]+(\.[0-9]{1,2})?$' then raise exception '%: enter a valid amount used',v_name;end if;
  v_qty:=(v_d->>'used')::numeric;
  if v_id not in ('ct_contrast','mri_contrast','gastrolux') and coalesce((v_d->>'waste')::numeric,0)<>0 then raise exception '%: only contrast has a separate ml wastage field',v_name;end if;
  if v_id in ('ct_contrast','mri_contrast','gastrolux','film1714','film1210') then
   if jsonb_typeof(v_d->'patients') is distinct from 'number' or (v_d->>'patients')!~'^[0-9]+$' then raise exception '%: enter the number of patients',v_name;end if;
   v_pat:=(v_d->>'patients')::integer;
   if v_pat>10000 or (v_qty>0 and v_pat=0) or (v_qty=0 and v_pat>0) then raise exception '%: check the patients and amount used',v_name;end if;
  end if;
  if v_id in ('film1714','film1210') then
   if v_pat>v_qty then raise exception '%: patients printed for cannot exceed films printed',v_name;end if;
   v_films:=jsonb_set(v_films,array[v_id],to_jsonb(v_qty));v_film_pat:=v_film_pat+v_pat;
  else
   if v_id in ('ct_contrast','mri_contrast','gastrolux') then
    if jsonb_typeof(v_d->'waste') is distinct from 'number' or (v_d->>'waste')!~'^[0-9]+(\.[0-9]{1,2})?$' then raise exception '%: enter wastage in ml, including zero when none',v_name;end if;
    v_volumes:=jsonb_set(v_volumes,array[v_id],jsonb_build_object('administered_ml',v_qty,'waste_ml',(v_d->>'waste')::numeric));
    v_qty:=v_qty+(v_d->>'waste')::numeric;
   end if;
   v_supplies:=jsonb_set(v_supplies,array[v_id],to_jsonb(v_qty));
  end if;
  select coalesce(sum((quantities->>v_id)::numeric),0) into v_previous from public.stock_shift_usage where date=p_date and room=p_room and shift=p_shift;
  select value into v_item from jsonb_array_elements(v_context->'items') where value->>'id'=v_id;
  if (v_item->>'remaining')::numeric+v_previous-v_qty<0 then
   raise exception '%: usage is more than the stock recorded in %. Record the missing pickup first',v_name,case when (v_item->>'shared')::boolean then 'Shared stock' else p_room end;
  end if;
 end loop;
 if p_finish then
  for v_item in select value from jsonb_array_elements(v_context->'items') loop
   if p_details->(v_item->>'id')->'reviewed' is distinct from 'true'::jsonb then raise exception '%: review it or choose None used before finishing',v_item->>'name';end if;
  end loop;
 end if;
 v_res:=radcontrack_private.save_room_usage_volume(p_date,p_room,p_shift,'films',v_films,v_film_pat,p_staff,p_film_version,'{}');
 v_res:=radcontrack_private.save_room_usage_volume(p_date,p_room,p_shift,'supplies',v_supplies,0,p_staff,p_supply_version,v_volumes);
 update public.room_shift_reviews set details=p_details,physical=coalesce(p_physical,'{}'),note=coalesce(p_note,''),staff=btrim(p_staff),stock_token=radcontrack_private.shift_context(p_date,p_room,p_shift)->>'token',finished=p_finish,version=v_old.version+1,updated_at=clock_timestamp() where date=p_date and room=p_room and shift=p_shift;
 insert into radcontrack_private.stock_correction_audit(source,record_id,before_record,after_record,reason,changed_by)
 select 'usage',p_date::text||'/'||p_room||'/'||p_shift,to_jsonb(v_old),to_jsonb(r),case when p_finish then 'Shift reviewed and finished' else 'Shift progress saved' end,auth.uid() from public.room_shift_reviews r where date=p_date and room=p_room and shift=p_shift;
 return v_old.version+1;
end $$;

-- 7. A finished shift reopens only when its own figures can change: this room's stock, a Shared
-- pickup or count, or this room's own Shared usage.
create or replace function radcontrack_private.reopen_room_reviews() returns trigger language plpgsql security definer set search_path='' as $$begin
 update public.room_shift_reviews set finished=false,version=version+1
 where finished and date>=least(new.occurred_on,case when tg_op='UPDATE' then old.occurred_on else new.occurred_on end)
 and (room=new.room or (new.room='Shared' and (new.movement_type in ('pick','count') or room=new.usage_room))
  or (tg_op='UPDATE' and (room=old.room or room=old.usage_room)));
 return new;end $$;

-- 8. Moving a contrast pick also updates who it was picked for.
create or replace function radcontrack_private.correct_pick_room(p_store_id uuid,p_version integer,p_room text,p_reason text) returns integer
language plpgsql security definer set search_path='' as $$
declare v_item public.stock_items; v_store public.stock_movements; v_move public.room_stock_movements;
 v_from public.room_stock; v_to public.room_stock; v_after jsonb; v_version integer;
begin
 perform radcontrack_private.assert_stock_user();
 perform radcontrack_private.assert_stock_manager();
 if length(btrim(coalesce(p_reason,'')))<5 then raise exception 'Enter the reason for moving this pick'; end if;
 select i.* into v_item from public.stock_items i where i.id=(select item_id from public.stock_movements where id=p_store_id) for update;
 if not found then raise exception 'Stock entry not found'; end if;
 select * into v_store from public.stock_movements where id=p_store_id for update;
 if v_store.movement_type<>'issue' then raise exception 'Only a daily pick can be moved to another room'; end if;
 if v_store.voided_at is not null or p_version is distinct from v_store.version then raise exception 'This pick changed. Reload before correcting it'; end if;
 if v_store.destination='Shared' then raise exception 'Shared stock is used by every room; there is no room to move it to'; end if;
 if p_room is null or p_room not in ('X-ray','CT','MRI','Fluoroscopy','Mammography') or p_room=v_store.destination then raise exception 'Choose the room the stock actually went to'; end if;
 if v_item.id='mri_contrast' and p_room<>'MRI' then raise exception 'MRI contrast must go to the MRI room'; end if;
 if v_item.id='ct_contrast' and p_room not in ('CT','Fluoroscopy') then raise exception 'CT contrast must go to CT or Fluoroscopy'; end if;
 select * into v_move from public.room_stock_movements where batch_id=v_store.batch_id and item_id=v_item.id
  and room=v_store.destination and movement_type='pick' and voided_at is null for update;
 if not found then raise exception 'The linked room pick is missing. Record physical counts instead'; end if;
 select * into v_from from public.room_stock where room=v_store.destination and item_id=v_item.id for update;
 insert into public.room_stock(room,item_id) values(p_room,v_item.id) on conflict do nothing;
 select * into v_to from public.room_stock where room=p_room and item_id=v_item.id for update;
 if (v_from.counted_at is not null and v_move.created_at<=v_from.counted_at) or v_move.occurred_on<v_from.counted_on then
  raise exception 'A later count in % includes this pick. Record physical counts now instead',v_store.destination; end if;
 if v_move.occurred_on<v_to.counted_on then
  raise exception 'A later count in % already includes what is there. Record physical counts now instead',p_room; end if;
 if v_from.balance<v_move.change then raise exception '% has already used some of this pick. Correct that usage first',v_store.destination; end if;
 update public.room_stock set balance=balance-v_move.change where room=v_from.room and item_id=v_item.id;
 update public.room_stock set balance=balance+v_move.change where room=p_room and item_id=v_item.id;
 update public.room_stock_movements set room=p_room,version=version+1 where id=v_move.id;
 insert into radcontrack_private.stock_correction_audit(source,record_id,before_record,after_record,reason,changed_by)
  select 'room',v_move.id::text,to_jsonb(v_move),to_jsonb(m),btrim(p_reason),auth.uid() from public.room_stock_movements m where id=v_move.id;
 update public.stock_movements set destination=p_room,picked_for=p_room,version=version+1 where id=p_store_id
  returning to_jsonb(stock_movements),version into v_after,v_version;
 insert into radcontrack_private.stock_correction_audit(source,record_id,before_record,after_record,reason,changed_by)
  values('store',p_store_id::text,to_jsonb(v_store),v_after,btrim(p_reason),auth.uid());
 return v_version;
end $$;

-- 9. Pooling moved rows and the token now ignores later days. Refresh the token of saved shifts
-- that had no stock change affecting them after their last save, so they are not flagged as changed.
do $$declare actor uuid; r record; begin
 select id into strict actor from auth.users where lower(email)='honey.onabanjo@bthdc.com.ng' and email_confirmed_at is not null;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 for r in select * from public.room_shift_reviews for update loop
  if not exists(select 1 from public.room_stock_movements m where (m.room=r.room or m.usage_room=r.room) and m.created_at>r.updated_at and m.occurred_on<=r.date)
   and not exists(select 1 from radcontrack_private.stock_correction_audit a where a.source in ('room','store') and a.changed_at>r.updated_at
    and a.reason not like 'Consolidated%' and r.room in (a.before_record->>'room',a.after_record->>'room',a.before_record->>'destination',a.after_record->>'destination')
    and least((a.before_record->>'occurred_on')::date,(a.after_record->>'occurred_on')::date)<=r.date) then
   update public.room_shift_reviews set stock_token=radcontrack_private.shift_context(r.date,r.room,r.shift)->>'token' where date=r.date and room=r.room and shift=r.shift;
  end if;
 end loop;
end $$;

-- 10. Table access goes through RLS and the functions above; remove unused broad privileges.
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;

notify pgrst,'reload schema';
commit;
