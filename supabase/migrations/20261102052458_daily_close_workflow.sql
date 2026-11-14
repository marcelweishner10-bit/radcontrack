-- Additive workflow only: no historical usage, counts, receipts or movements are rewritten.
begin;
alter table public.room_shift_reviews add column entry_mode text not null default 'legacy'
 check(entry_mode in ('legacy','contrast'));
create function radcontrack_private.contrast_shift_context(p_date date,p_room text,p_shift text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c jsonb;t text;
begin
 perform radcontrack_private.assert_stock_user();
 c:=radcontrack_private.shift_context(p_date,p_room,p_shift);
 select md5(coalesce(string_agg(id::text||':'||version::text||':'||change::text||':'||coalesce(voided_at::text,''),',' order by id),'')) into t
 from public.room_stock_movements where item_id in ('ct_contrast','mri_contrast','gastrolux')
 and (room=p_room or (room='Shared' and (movement_type in ('pick','count') or usage_room=p_room)))
 and (occurred_on<p_date or (occurred_on=p_date and coalesce(array_position(array['morning','afternoon','night'],shift),1)<=array_position(array['morning','afternoon','night'],p_shift)));
 return jsonb_set(c,'{token}',to_jsonb(t));
end $$;
create function public.contrast_shift_context(p_date date,p_room text,p_shift text) returns jsonb language sql security invoker set search_path='' as $$select radcontrack_private.contrast_shift_context(p_date,p_room,p_shift)$$;
revoke all on function radcontrack_private.contrast_shift_context(date,text,text),public.contrast_shift_context(date,text,text) from public,anon;
grant execute on function radcontrack_private.contrast_shift_context(date,text,text),public.contrast_shift_context(date,text,text) to authenticated;
create or replace function radcontrack_private.save_contrast_shift(p_date date,p_room text,p_shift text,p_details jsonb,p_staff text,
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
 v_context:=radcontrack_private.contrast_shift_context(p_date,p_room,p_shift);
 select jsonb_set(v_context,'{items}',coalesce(jsonb_agg(x),'[]')) into v_context
 from jsonb_array_elements(v_context->'items') x where x->>'id' in ('ct_contrast','mri_contrast','gastrolux');
 if exists(select 1 from jsonb_object_keys(p_details) k where k not in ('ct_contrast','mri_contrast','gastrolux')) then raise exception 'Use daily close for films and consumables';end if;
 if v_old.version>0 and v_old.entry_mode='legacy' then raise exception 'Keep this earlier shift in its original form';end if;
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
 -- Films are saved once in daily close, never by this writer.
 v_res:=radcontrack_private.save_room_usage_volume(p_date,p_room,p_shift,'supplies',v_supplies,0,p_staff,p_supply_version,v_volumes);
 update public.room_shift_reviews set entry_mode='contrast',details=p_details,physical=coalesce(p_physical,'{}'),note=coalesce(p_note,''),staff=btrim(p_staff),stock_token=radcontrack_private.contrast_shift_context(p_date,p_room,p_shift)->>'token',finished=p_finish,version=v_old.version+1,updated_at=clock_timestamp() where date=p_date and room=p_room and shift=p_shift;
 insert into radcontrack_private.stock_correction_audit(source,record_id,before_record,after_record,reason,changed_by)
 select 'usage',p_date::text||'/'||p_room||'/'||p_shift,to_jsonb(v_old),to_jsonb(r),case when p_finish then 'Shift reviewed and finished' else 'Shift progress saved' end,auth.uid() from public.room_shift_reviews r where date=p_date and room=p_room and shift=p_shift;
 return v_old.version+1;
end $$;
create function public.save_contrast_shift(p_date date,p_room text,p_shift text,p_details jsonb,p_staff text,p_version integer,p_film_version integer,p_supply_version integer,p_finish boolean,p_physical jsonb,p_note text,p_token text) returns integer
language sql security invoker set search_path='' as $$select radcontrack_private.save_contrast_shift(p_date,p_room,p_shift,p_details,p_staff,p_version,p_film_version,p_supply_version,p_finish,p_physical,p_note,p_token)$$;
revoke all on function radcontrack_private.save_contrast_shift(date,text,text,jsonb,text,integer,integer,integer,boolean,jsonb,text,text),public.save_contrast_shift(date,text,text,jsonb,text,integer,integer,integer,boolean,jsonb,text,text) from public,anon;
grant execute on function radcontrack_private.save_contrast_shift(date,text,text,jsonb,text,integer,integer,integer,boolean,jsonb,text,text),public.save_contrast_shift(date,text,text,jsonb,text,integer,integer,integer,boolean,jsonb,text,text) to authenticated;

create table public.daily_stock_closes (
 date date primary key, details jsonb not null default '{}', deductions jsonb not null default '{}',
 staff text not null, note text not null default '', finished boolean not null default false,
 version integer not null default 0, stock_token text not null default '', updated_at timestamptz not null default clock_timestamp()
);
alter table public.daily_stock_closes enable row level security;
revoke all on public.daily_stock_closes from public,anon,authenticated;
grant select on public.daily_stock_closes to authenticated;
create policy approved_read on public.daily_stock_closes for select to authenticated using(radcontrack_private.inventory_role() is not null);
create trigger guard_daily_close_day before insert or update on public.daily_stock_closes for each row execute function radcontrack_private.guard_usage_day();

create function radcontrack_private.daily_close_context(p_date date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_items jsonb;v_token text;v_close public.daily_stock_closes;
begin
 perform radcontrack_private.assert_stock_user();
 select * into v_close from public.daily_stock_closes where date=p_date;
 select md5(coalesce(string_agg(id::text||':'||version::text||':'||change::text||':'||coalesce(voided_at::text,''),',' order by id),'')) into v_token
 from public.room_stock_movements where room='Shared' and occurred_on<=p_date;
 with candidates as (
 select i.id,i.name,i.unit,r.room,'daily'::text cadence from public.stock_items i
 cross join unnest(array['X-ray','CT','MRI','Fluoroscopy','Mammography']) r(room)
 where i.active and i.id in ('film1714','film1210')
 and (r.room<>'Mammography'
  or coalesce(v_close.details,'{}') ? (r.room||'|'||i.id)
  or exists(select 1 from public.stock_shift_usage u where u.date=p_date and u.room=r.room and coalesce((u.quantities->>i.id)::numeric,0)>0))
 union all
 select i.id,i.name,i.unit,'Shared',case when i.id in ('cd','cd_jacket','single_connector','double_connector','injector_syringe') then 'daily' else 'pack' end
 from public.stock_items i where i.active and (i.id in ('cd','cd_jacket','single_connector','double_connector','injector_syringe','electrodes','gloves_pack','gloves','wipes') or lower(i.name) like '%saniti%')
 ), items as (
 select c.*,c.room||'|'||c.id as key,
 coalesce((select sum((u.quantities->>c.id)::numeric) from public.stock_shift_usage u where u.date=p_date and (c.room='Shared' or u.room=c.room)),0) as earlier,
 coalesce((select sum(change) from public.room_stock_movements m where m.room='Shared' and m.item_id=c.id and m.voided_at is null and m.occurred_on<=p_date),0) as remaining,
 coalesce((v_close.deductions->>(c.room||'|'||c.id))::numeric,0) as deducted,
 coalesce((select sum(change) from public.room_stock_movements m where m.room='Shared' and m.item_id=c.id and m.voided_at is null and m.occurred_on=p_date and m.movement_type='pick'),0) as picked
 from candidates c
 ) select coalesce(jsonb_agg(to_jsonb(items) order by cadence,room,name),'[]') into v_items from items;
 return jsonb_build_object('items',v_items,'token',v_token,'close',to_jsonb(v_close));
end $$;
create function public.daily_close_context(p_date date) returns jsonb language sql security invoker set search_path='' as $$select radcontrack_private.daily_close_context(p_date)$$;
revoke all on function radcontrack_private.daily_close_context(date),public.daily_close_context(date) from public,anon;
grant execute on function radcontrack_private.daily_close_context(date),public.daily_close_context(date) to authenticated;

create function radcontrack_private.save_daily_close(p_date date,p_details jsonb,p_staff text,p_note text,p_version integer,p_finish boolean,p_token text) returns integer
language plpgsql security definer set search_path='' as $$
declare v_old public.daily_stock_closes;v_ctx jsonb;v_item jsonb;v_detail jsonb;v_deductions jsonb:='{}';
 v_key text;v_id text;v_scope text;v_qty numeric;v_deduct numeric;v_previous numeric;v_delta numeric;v_room public.room_stock;v_batch uuid:=gen_random_uuid();v_budget jsonb:='{}';v_left numeric;
begin
 perform radcontrack_private.assert_stock_user();
 if p_date is null or length(btrim(coalesce(p_staff,'')))<2 or jsonb_typeof(p_details) is distinct from 'object' or p_finish is null then raise exception 'Choose a date and enter your name';end if;
 -- Same global item order as existing inventory writers: all changes are atomic.
 perform 1 from public.stock_items order by id for update;
 select * into v_old from public.daily_stock_closes where date=p_date for update;
 if coalesce(v_old.version,0) is distinct from p_version then raise exception 'This daily close changed. Reload before saving';end if;
 v_ctx:=radcontrack_private.daily_close_context(p_date);
 if p_token is distinct from v_ctx->>'token' then raise exception 'Stock changed. Reload the day before saving';end if;
 if exists(select 1 from jsonb_object_keys(p_details) k where not exists(select 1 from jsonb_array_elements(v_ctx->'items') x where x->>'key'=k)) then raise exception 'Choose a daily close item';end if;
 for v_item in select value from jsonb_array_elements(v_ctx->'items') loop
  v_key:=v_item->>'key';v_id:=v_item->>'id';v_scope:=v_item->>'room';v_detail:=p_details->v_key;
  if v_detail is null then
   if coalesce(v_old.details,'{}') ? v_key then raise exception 'Keep previously saved quantities; use zero to correct one';end if;
   if p_finish and v_item->>'cadence'='daily' then raise exception '% / %: enter a quantity or choose None used',v_scope,v_item->>'name';end if;
   continue;
  end if;
  if jsonb_typeof(v_detail->'used') is distinct from 'number' or (v_detail->>'used')!~'^[0-9]+$' or (v_detail->>'used')::numeric>1000000 then raise exception '%: enter a whole quantity',v_item->>'name';end if;
  if p_finish and v_item->>'cadence'='daily' and v_detail->'reviewed' is distinct from 'true'::jsonb then raise exception '% / %: confirm this quantity',v_scope,v_item->>'name';end if;
  v_qty:=(v_detail->>'used')::numeric;
  if p_finish and v_id in ('film1714','film1210') and (jsonb_typeof(v_detail->'patients') is distinct from 'number' or (v_qty>0 and coalesce((v_detail->>'patients')::numeric,0)=0)) then raise exception '% / %: enter patients printed for',v_scope,v_item->>'name';end if;
  if v_detail ? 'patients' and (jsonb_typeof(v_detail->'patients') is distinct from 'number' or (v_detail->>'patients')!~'^[0-9]+$' or (v_detail->>'patients')::numeric>v_qty) then raise exception '%: check patients printed for',v_item->>'name';end if;
  v_deduct:=v_qty-(v_item->>'earlier')::numeric;
  if v_deduct<0 then raise exception '% / %: total cannot be below earlier shift usage (%). Correct that original entry first',v_scope,v_item->>'name',v_item->>'earlier';end if;
  v_previous:=coalesce((v_old.deductions->>v_key)::numeric,0);v_delta:=v_deduct-v_previous;
  v_deductions:=jsonb_set(v_deductions,array[v_key],to_jsonb(v_deduct));
  if v_delta<>0 then
   insert into public.room_stock(room,item_id) values('Shared',v_id) on conflict do nothing;
   select * into v_room from public.room_stock where room='Shared' and item_id=v_id for update;
   if p_date<v_room.counted_on or (v_old.version>0 and v_old.updated_at<=v_room.counted_at) then raise exception 'A later physical count includes this usage. Ask Honey to review the count';end if;
   v_left:=coalesce((v_budget->>v_id)::numeric,(v_item->>'remaining')::numeric)-v_delta;
   if v_room.balance-v_delta<0 or v_left<0 then raise exception '%: usage exceeds recorded Shared stock. Check missing pickups',v_item->>'name';end if;
   v_budget:=jsonb_set(v_budget,array[v_id],to_jsonb(v_left));
   update public.room_stock set balance=balance-v_delta where room='Shared' and item_id=v_id;
   insert into public.room_stock_movements(batch_id,room,item_id,movement_type,change,balance_after,balance_known,occurred_on,shift,staff_name,recorded_by,usage_room)
    values(v_batch,'Shared',v_id,case when v_delta>0 then 'usage' else 'correction' end,-v_delta,v_room.balance-v_delta,v_room.counted_on is not null,p_date,'night',btrim(p_staff),auth.uid(),v_scope);
  end if;
 end loop;
 insert into public.daily_stock_closes(date,details,deductions,staff,note,finished,version,stock_token)
 values(p_date,p_details,v_deductions,btrim(p_staff),coalesce(p_note,''),p_finish,coalesce(v_old.version,0)+1,radcontrack_private.daily_close_context(p_date)->>'token')
 on conflict(date) do update set details=excluded.details,deductions=excluded.deductions,staff=excluded.staff,note=excluded.note,finished=excluded.finished,version=excluded.version,stock_token=excluded.stock_token,updated_at=clock_timestamp();
 insert into radcontrack_private.stock_correction_audit(source,record_id,before_record,after_record,reason,changed_by)
 select 'usage','daily/'||p_date::text,to_jsonb(v_old),to_jsonb(c),case when p_finish then 'Day closed' else 'Daily close saved' end,auth.uid() from public.daily_stock_closes c where date=p_date;
 return coalesce(v_old.version,0)+1;
end $$;
create function public.save_daily_close(p_date date,p_details jsonb,p_staff text,p_note text,p_version integer,p_finish boolean,p_token text) returns integer
language sql security invoker set search_path='' as $$select radcontrack_private.save_daily_close(p_date,p_details,p_staff,p_note,p_version,p_finish,p_token)$$;
revoke all on function radcontrack_private.save_daily_close(date,jsonb,text,text,integer,boolean,text),public.save_daily_close(date,jsonb,text,text,integer,boolean,text) from public,anon;
grant execute on function radcontrack_private.save_daily_close(date,jsonb,text,text,integer,boolean,text),public.save_daily_close(date,jsonb,text,text,integer,boolean,text) to authenticated;

-- Older shift quantities remain the authoritative baseline. Lock only entries that
-- a new daily close already covers; contrast changes remain possible.
create function radcontrack_private.guard_daily_baseline() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.daily_stock_closes;k text;
begin
 perform 1 from public.stock_items order by id for update;
 select * into c from public.daily_stock_closes where date=new.date;
 if c.date is not null then
  for k in select key from jsonb_object_keys(new.quantities) key union select key from jsonb_object_keys(case when tg_op='UPDATE' then old.quantities else '{}' end) key loop
   if (c.details ? ('Shared|'||k) or c.details ? (new.room||'|'||k))
    and coalesce((new.quantities->>k)::numeric,0)<>coalesce((case when tg_op='UPDATE' then old.quantities else '{}' end->>k)::numeric,0)
   then raise exception 'This item is included in the daily close. Correct the daily close first';end if;
  end loop;
 end if;
 return new;
end $$;
revoke all on function radcontrack_private.guard_daily_baseline() from public,anon,authenticated;
create trigger guard_daily_baseline before insert or update on public.stock_shift_usage for each row execute function radcontrack_private.guard_daily_baseline();
create or replace function radcontrack_private.reopen_room_reviews() returns trigger language plpgsql security definer set search_path='' as $$begin
 update public.room_shift_reviews set finished=false,version=version+1
 where finished and (entry_mode='legacy' or new.item_id in ('ct_contrast','mri_contrast','gastrolux')) and date>=least(new.occurred_on,case when tg_op='UPDATE' then old.occurred_on else new.occurred_on end)
 and (room=new.room or (new.room='Shared' and (new.movement_type in ('pick','count') or room=new.usage_room))
  or (tg_op='UPDATE' and (room=old.room or room=old.usage_room)));
 return new;end $$;
notify pgrst,'reload schema';
commit;
