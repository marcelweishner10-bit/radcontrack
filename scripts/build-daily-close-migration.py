from pathlib import Path
p=Path('supabase/migrations/20261102052458_daily_close_workflow.sql')
base=Path('supabase/migrations/20261015210000_shared_stock_followup.sql').read_text()
start=base.index('create or replace function radcontrack_private.save_shift(')
end=base.index('end $$;',start)+len('end $$;')
contrast=base[start:end].replace('radcontrack_private.save_shift(', 'radcontrack_private.save_contrast_shift(',1)
contrast=contrast.replace("v_context:=radcontrack_private.shift_context(p_date,p_room,p_shift);", """v_context:=radcontrack_private.shift_context(p_date,p_room,p_shift);
 select jsonb_set(v_context,'{items}',coalesce(jsonb_agg(x),'[]')) into v_context
 from jsonb_array_elements(v_context->'items') x where x->>'id' in ('ct_contrast','mri_contrast','gastrolux');
 if exists(select 1 from jsonb_object_keys(p_details) k where k not in ('ct_contrast','mri_contrast','gastrolux')) then raise exception 'Use daily close for films and consumables';end if;
 if v_old.version>0 and v_old.entry_mode='legacy' then raise exception 'Keep this earlier shift in its original form';end if;""")
contrast=contrast.replace("v_res:=radcontrack_private.save_room_usage_volume(p_date,p_room,p_shift,'films',v_films,v_film_pat,p_staff,p_film_version,'{}');",'-- Films are saved once in daily close, never by this writer.')
contrast=contrast.replace('set details=p_details,physical=',"set entry_mode='contrast',details=p_details,physical=")
contrast=contrast.replace('radcontrack_private.shift_context(', 'radcontrack_private.contrast_shift_context(')
reopen_start=base.index('create or replace function radcontrack_private.reopen_room_reviews()')
reopen_end=base.index('end $$;',reopen_start)+len('end $$;')
reopen=base[reopen_start:reopen_end].replace('where finished and date>=',"where finished and (entry_mode='legacy' or new.item_id in ('ct_contrast','mri_contrast','gastrolux')) and date>=")
p.write_text("""-- Additive workflow only: no historical usage, counts, receipts or movements are rewritten.
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
"""+contrast+"""
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
"""+reopen+"""
notify pgrst,'reload schema';
commit;
""",encoding='utf8')
