begin;
alter table public.room_stock drop constraint room_stock_room_check;
alter table public.room_stock add constraint room_stock_room_check check(room in ('X-ray','CT','MRI','Fluoroscopy','Mammography','Shared'));
alter table public.room_stock_movements add column usage_room text;
create function radcontrack_private.stock_location(p_item text,p_room text) returns text language sql immutable set search_path='' as $$select case when p_item in ('ct_contrast','mri_contrast') then p_room else 'Shared' end$$;
revoke all on function radcontrack_private.stock_location(text,text) from public,anon,authenticated;
create or replace function radcontrack_private.move_room_stock(p_type text,p_date date,p_staff text,p_lines jsonb,p_room text,p_shift text,p_reference text,p_request uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_batch uuid:=coalesce(p_request,gen_random_uuid()); v_line jsonb; v_item public.stock_items; v_room public.room_stock; v_qty numeric; v_factor integer; v_after numeric; v_payload jsonb; v_existing jsonb; v_location text;
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
 for v_line in select value from jsonb_array_elements(p_lines) order by value->>'item_id' loop
  if jsonb_typeof(v_line->'quantity') is distinct from 'number' or (v_line->>'quantity') !~ '^[0-9]+(\.[0-9]{1,2})?$' then raise exception 'Enter whole quantities'; end if;
  v_qty:=(v_line->>'quantity')::numeric;
  if v_qty<0 or v_qty>1000000 or (v_qty=0 and p_type in ('receipt','issue')) then raise exception 'Only physical counts may be zero'; end if;
  select * into v_item from public.stock_items where id=v_line->>'item_id' and active for update;
  if not found then raise exception 'Choose a valid stock item'; end if;
  if v_qty<>trunc(v_qty) and v_item.id not in ('ct_contrast','mri_contrast','gastrolux') then raise exception 'Only contrast quantities accept decimal millilitres'; end if;
  v_location:=radcontrack_private.stock_location(v_item.id,p_room);
  if p_type in ('issue','room_count') and v_item.id='mri_contrast' and p_room<>'MRI' then raise exception 'MRI contrast must go to the MRI room';end if;
  if p_type in ('issue','room_count') and v_item.id='ct_contrast' and p_room not in ('CT','Fluoroscopy') then raise exception 'CT contrast must go to CT or Fluoroscopy';end if;
  v_factor:=1;
  if p_type<>'room_count' then
   if p_type<>'opening' and p_date<v_item.counted_on then raise exception 'This movement predates the latest store count. Do not add stock already included in that count'; end if;
   if p_type='issue' and v_item.balance<v_qty then raise exception 'Not enough recorded % in the store. Record a physical count or missing collection first',v_item.name; end if;
   v_after:=case p_type when 'opening' then v_qty when 'issue' then v_item.balance-v_qty else v_item.balance+v_qty end;
   insert into public.stock_movements(batch_id,item_id,movement_type,quantity,balance_after,balance_known,occurred_on,recipient_name,destination,shift,reference,recorded_by)
    values(v_batch,v_item.id,p_type,v_qty,v_after,v_item.opening_recorded or p_type='opening',p_date,btrim(p_staff),case when p_type='issue' then v_location end,p_shift,p_reference,auth.uid());
   update public.stock_items set balance=v_after,opening_recorded=opening_recorded or p_type='opening',counted_on=case when p_type='opening' then p_date else counted_on end,counted_at=case when p_type='opening' then clock_timestamp() else counted_at end where id=v_item.id;
  end if;
  if p_type in ('issue','room_count') then
   insert into public.room_stock(room,item_id) values(v_location,v_item.id) on conflict do nothing;
   select * into v_room from public.room_stock where room=v_location and item_id=v_item.id for update;
   if p_type='issue' and p_date<v_room.counted_on then raise exception 'This pick predates the room count and may already be included in it'; end if;
   -- Store, rooms and usage now share the same base units.
   v_after:=case when p_type='room_count' then v_qty else v_room.balance+v_qty*v_factor end;
   insert into public.room_stock_movements(batch_id,room,item_id,movement_type,change,balance_after,balance_known,occurred_on,shift,staff_name,recorded_by)
    values(v_batch,v_location,v_item.id,case when p_type='issue' then 'pick' else 'count' end,v_after-v_room.balance,v_after,v_room.counted_on is not null or p_type='room_count',p_date,p_shift,btrim(p_staff),auth.uid());
   update public.room_stock set balance=v_after,counted_on=case when p_type='room_count' then p_date else counted_on end,counted_at=case when p_type='room_count' then clock_timestamp() else counted_at end where room=v_location and item_id=v_item.id;
  end if;
 end loop;
 return v_batch;
end $$;

create or replace function radcontrack_private.save_room_usage(p_date date,p_room text,p_shift text,p_category text,p_quantities jsonb,p_patients integer,p_staff text,p_version integer) returns integer
language plpgsql security definer set search_path='' as $$
declare v_old public.stock_shift_usage; v_stock public.room_stock; v_id text; v_qty numeric; v_prev numeric; v_delta numeric; v_batch uuid:=gen_random_uuid(); v_location text;
begin
 perform radcontrack_private.assert_stock_user();
 if p_date is null or p_date>(now() at time zone 'Africa/Lagos')::date or p_room is null or p_room not in ('X-ray','CT','MRI','Fluoroscopy','Mammography') or p_shift is null or p_shift not in ('morning','afternoon','night') or p_category is null or p_category not in ('films','supplies') or jsonb_typeof(p_quantities) is distinct from 'object' or p_patients is null or p_patients not between 0 and 10000 or length(btrim(coalesce(p_staff,'')))<2 then raise exception 'Complete the room, shift, name and usage'; end if;
 insert into public.stock_shift_usage(date,room,shift,category,recorded_by_name) values(p_date,p_room,p_shift,p_category,p_staff) on conflict do nothing;
 select * into v_old from public.stock_shift_usage where date=p_date and room=p_room and shift=p_shift and category=p_category for update;
 if p_version is distinct from v_old.version then raise exception 'Someone else updated this shift. Reload it before saving'; end if;
 if (select count(*) from jsonb_object_keys(p_quantities))>50 then raise exception 'Too many items'; end if;
 if p_category='films' and p_patients=0 and exists(select 1 from jsonb_each(p_quantities) where value::text::numeric>0) then raise exception 'Enter the number of patients printed for'; end if;
 for v_id in select key from jsonb_object_keys(p_quantities) as key union select key from jsonb_object_keys(v_old.quantities) as key order by 1 loop
  if not exists(select 1 from public.stock_items where id=v_id and (active or (v_old.quantities ? v_id and coalesce((p_quantities->>v_id)::numeric,0)=coalesce((v_old.quantities->>v_id)::numeric,0)))) or (p_category='films')<>(v_id in ('film1714','film1210')) then raise exception 'Choose an item from the correct usage section'; end if;
  if p_quantities ? v_id and (jsonb_typeof(p_quantities->v_id)<>'number' or (p_quantities->>v_id)!~'^[0-9]+(\.[0-9]{1,2})?$') then raise exception 'Usage must be whole numbers'; end if;
  v_qty:=coalesce((p_quantities->>v_id)::numeric,0); v_prev:=coalesce((v_old.quantities->>v_id)::numeric,0); v_delta:=v_qty-v_prev;
  if v_qty<>trunc(v_qty) and v_id not in ('ct_contrast','mri_contrast','gastrolux') then raise exception 'Only contrast volume may contain decimals'; end if;
  if v_qty not between 0 and 1000000 then raise exception 'Usage quantity is outside the allowed range'; end if;
  v_location:=radcontrack_private.stock_location(v_id,p_room);
  if v_delta<>0 then
   insert into public.room_stock(room,item_id) values(v_location,v_id) on conflict do nothing;
   select * into v_stock from public.room_stock where room=v_location and item_id=v_id for update;
   if p_date<v_stock.counted_on or (v_old.version>0 and v_old.updated_at<=v_stock.counted_at) then raise exception 'This earlier usage was included in a later physical count. Record a new count instead of changing the stock deduction'; end if;
   if v_stock.balance<v_delta then raise exception 'Not enough recorded stock in % for %. Record its pick or physical count first',p_room,(select name from public.stock_items where id=v_id); end if;
   update public.room_stock set balance=balance-v_delta where room=v_location and item_id=v_id;
   insert into public.room_stock_movements(batch_id,room,item_id,movement_type,change,balance_after,balance_known,occurred_on,shift,staff_name,recorded_by,usage_room)
    values(v_batch,v_location,v_id,case when v_delta>0 then 'usage' else 'correction' end,-v_delta,v_stock.balance-v_delta,v_stock.counted_on is not null,p_date,p_shift,btrim(p_staff),auth.uid(),p_room);
  end if;
 end loop;
 update public.stock_shift_usage set quantities=p_quantities,patients=p_patients,version=version+1,recorded_by_name=btrim(p_staff),updated_at=clock_timestamp() where date=p_date and room=p_room and shift=p_shift and category=p_category;
 return v_old.version+1;
end $$;
create or replace function radcontrack_private.routine_item(p_id text,p_room text) returns boolean language sql immutable set search_path='' as $$select case when p_id in ('a4_paper','gloves_piece') then false when p_id='mri_contrast' then p_room='MRI' when p_id='ct_contrast' then p_room in ('CT','Fluoroscopy') else true end$$;
create or replace function radcontrack_private.reopen_room_reviews() returns trigger language plpgsql security definer set search_path='' as $$begin
 update public.room_shift_reviews set finished=false,version=version+1 where (new.room='Shared' or room=new.room) and date>=least(new.occurred_on,case when tg_op='UPDATE' then old.occurred_on else new.occurred_on end) and finished;
 return new;end $$;
create or replace function radcontrack_private.shift_context(p_date date,p_room text,p_shift text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_result jsonb; v_rank integer; v_token text;
begin
 perform radcontrack_private.assert_stock_user();
 v_rank:=array_position(array['morning','afternoon','night'],p_shift);
 if v_rank is null or p_room not in ('X-ray','CT','MRI','Fluoroscopy','Mammography') then raise exception 'Choose a room and shift';end if;
 select md5(coalesce(string_agg(id::text||':'||version::text||':'||change::text||':'||coalesce(voided_at::text,''),',' order by id),'')) into v_token
 from public.room_stock_movements where room in (p_room,'Shared');
 with movements as (
 select *,coalesce(array_position(array['morning','afternoon','night'],shift),1) as rank
 from public.room_stock_movements where room in (p_room,'Shared') and voided_at is null
 ), picks as (
 select id,row_number() over(partition by item_id order by created_at,id) as pick_number
 from movements where occurred_on=p_date and rank=v_rank and movement_type='pick'
 ), flows as (
 select i.id,i.name,i.unit,
 coalesce(sum(m.change) filter(where m.occurred_on<p_date or (m.occurred_on=p_date and m.rank<v_rank)),0) as opening,
 coalesce(sum(m.change) filter(where m.occurred_on=p_date and m.rank=v_rank and m.movement_type='pick'),0) as received,
 coalesce(sum(m.change) filter(where p.pick_number=1),0) as initial_received,
 coalesce(sum(m.change) filter(where p.pick_number>1),0) as topups,
 coalesce(sum(m.change) filter(where m.occurred_on=p_date and m.rank=v_rank and m.movement_type='count'),0) as adjustment,
 coalesce(sum(m.change) filter(where m.occurred_on<p_date or (m.occurred_on=p_date and m.rank<=v_rank)),0) as remaining,
 ((i.id in ('ct_contrast','mri_contrast') or exists(select 1 from public.room_stock rs where rs.room='Shared' and rs.item_id=i.id and rs.counted_on is not null)) and coalesce(bool_or(m.movement_type='count' and (m.occurred_on<p_date or (m.occurred_on=p_date and m.rank<=v_rank))),false)
 and not coalesce(bool_or(m.movement_type='count' and m.occurred_on=p_date and m.shift is null),false)) as known
 from public.stock_items i left join movements m on m.item_id=i.id and m.room=radcontrack_private.stock_location(i.id,p_room) left join picks p on p.id=m.id
 where i.active and radcontrack_private.routine_item(i.id,p_room) group by i.id,i.name,i.unit
 ) select jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(flows) order by name),'[]'),'token',v_token) into v_result from flows;
 return v_result;
end $$;
-- Keep original attribution and full before/after records during consolidation.
do $$declare actor uuid; r record; begin
 select id into strict actor from auth.users where lower(email)='honey.onabanjo@bthdc.com.ng' and email_confirmed_at is not null;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform 1 from public.stock_items order by id for update;
 for r in select * from public.stock_movements where movement_type='issue' and item_id not in ('ct_contrast','mri_contrast') and destination<>'Shared' for update loop
  update public.stock_movements set destination='Shared',version=version+1 where id=r.id;
  insert into radcontrack_private.stock_correction_audit(source,record_id,before_record,after_record,reason,changed_by) select 'store',r.id::text,to_jsonb(r),to_jsonb(m),'Consolidated consumables into shared stock; original destination retained in audit',actor from public.stock_movements m where id=r.id;
 end loop;
 -- Migration changes stock location, not quantities, dates or depletion.
 alter table public.room_stock_movements disable trigger reopen_room_reviews;
 alter table public.room_stock_movements disable trigger guard_past_room_pick;
 for r in select * from public.room_stock_movements where item_id not in ('ct_contrast','mri_contrast') and room<>'Shared' for update loop
  update public.room_stock_movements set usage_room=room,room='Shared',version=version+1 where id=r.id;
  insert into radcontrack_private.stock_correction_audit(source,record_id,before_record,after_record,reason,changed_by) select 'room',r.id::text,to_jsonb(r),to_jsonb(m),'Consolidated existing stock and depletion into shared stock',actor from public.room_stock_movements m where id=r.id;
 end loop;
 alter table public.room_stock_movements enable trigger guard_past_room_pick;
 alter table public.room_stock_movements enable trigger reopen_room_reviews;
 insert into public.room_stock(room,item_id,balance,counted_on,counted_at)
 select 'Shared',item_id,sum(balance),case when bool_and(counted_on is not null) then min(counted_on) end,case when bool_and(counted_at is not null) then min(counted_at) end from public.room_stock where item_id not in ('ct_contrast','mri_contrast') group by item_id
 on conflict(room,item_id) do update set balance=excluded.balance,counted_on=excluded.counted_on,counted_at=excluded.counted_at;
 delete from public.room_stock where room<>'Shared' and item_id not in ('ct_contrast','mri_contrast');
end $$;
notify pgrst,'reload schema';
commit;
