\set ON_ERROR_STOP on
create temp table old_records as
 select 'usage' kind,md5(coalesce(jsonb_agg(to_jsonb(t) order by date,room,shift,category)::text,'')) hash from public.stock_shift_usage t
 union all select 'reviews',md5(coalesce(jsonb_agg(to_jsonb(t) order by date,room,shift)::text,'')) from public.room_shift_reviews t
 union all select 'stock',md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.stock_items t
 union all select 'room_stock',md5(coalesce(jsonb_agg(to_jsonb(t) order by room,item_id)::text,'')) from public.room_stock t
 union all select 'movements',md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.room_stock_movements t
 union all select 'receipts',md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.stock_movements t
 union all select 'clinical',md5(coalesce(jsonb_agg(to_jsonb(t) order by date)::text,'')) from public.daily_contrast_data t;
\ir ../supabase/migrations/20261102052458_daily_close_workflow.sql
do $$declare r record;h text;begin
 for r in select * from old_records loop
  if r.kind='reviews' then select md5(coalesce(jsonb_agg(to_jsonb(t)-'entry_mode' order by date,room,shift)::text,'')) into h from public.room_shift_reviews t;
  elsif r.kind='usage' then select md5(coalesce(jsonb_agg(to_jsonb(t) order by date,room,shift,category)::text,'')) into h from public.stock_shift_usage t;
  elsif r.kind='stock' then select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) into h from public.stock_items t;
  elsif r.kind='room_stock' then select md5(coalesce(jsonb_agg(to_jsonb(t) order by room,item_id)::text,'')) into h from public.room_stock t;
  elsif r.kind='movements' then select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) into h from public.room_stock_movements t;
  elsif r.kind='receipts' then select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) into h from public.stock_movements t;
  else select md5(coalesce(jsonb_agg(to_jsonb(t) order by date)::text,'')) into h from public.daily_contrast_data t;end if;
  if h is distinct from r.hash then raise exception 'Historical data changed: %',r.kind;end if;
 end loop;
end $$;
\echo PASS: historical rows and stock quantities preserved across migration
begin;
create function pg_temp.expect_error(q text,pattern text) returns void language plpgsql as $$begin execute q;raise exception 'Expected %',pattern;exception when others then if sqlerrm not like pattern then raise;end if;end $$;
create function pg_temp.save_close(d jsonb,finish boolean) returns integer language plpgsql as $$declare c jsonb;begin
 c:=public.daily_close_context((now() at time zone 'Africa/Lagos')::date);
 return public.save_daily_close((now() at time zone 'Africa/Lagos')::date,d,'Test night staff','Test only',coalesce((c#>>'{close,version}')::integer,0),finish,c->>'token');end $$;
do $$declare today date:=(now() at time zone 'Africa/Lagos')::date;ctx jsonb;d jsonb;before numeric;after_qty numeric;old_usage jsonb;v integer;t text;rec public.room_shift_reviews;
begin
 perform set_config('request.jwt.claim.sub',(select id::text from auth.users where email='honey.onabanjo@bthdc.com.ng'),true);
 -- Only fixtures in this rollback transaction are changed.
 perform public.move_room_stock_units('room_count',today,'Test count','[{"item_id":"film1714","quantity":1000},{"item_id":"film1210","quantity":1000},{"item_id":"cd","quantity":1000},{"item_id":"cd_jacket","quantity":1000},{"item_id":"single_connector","quantity":100},{"item_id":"double_connector","quantity":100},{"item_id":"injector_syringe","quantity":100}]','Shared','morning',null,null);
 perform public.move_room_stock_units('room_count',today,'Test count','[{"item_id":"ct_contrast","quantity":500}]','CT','morning',null,null);
 -- Earlier film usage is preserved and counted toward the daily target.
 perform public.save_room_usage_units(today,'CT','morning','films','{"film1714":10}',5,'Test morning',0,'{}');
 select to_jsonb(s) into old_usage from public.stock_shift_usage s where date=today and room='CT' and shift='morning' and category='films';
 select balance into before from public.room_stock where room='Shared' and item_id='film1714';
 ctx:=public.daily_close_context(today);
 if exists(select 1 from jsonb_array_elements(ctx->'items') x where x->>'room'='Mammography') then raise exception 'Mammography should not require film entry';end if;
 select jsonb_object_agg(x->>'key',jsonb_build_object('used',(x->>'earlier')::numeric,'reviewed',true,'patients',case when (x->>'earlier')::numeric>0 then 5 else 0 end)) into d from jsonb_array_elements(ctx->'items') x where x->>'cadence'='daily';
 d:=jsonb_set(d,'{CT|film1714,used}','20');d:=jsonb_set(d,'{MRI|film1714,used}','5');d:=jsonb_set(d,'{MRI|film1714,patients}','2');
 perform pg_temp.expect_error(format('select pg_temp.save_close(%L::jsonb,true)',d#-'{CT|film1714,patients}'),'%enter patients printed for%');
 perform pg_temp.save_close(d,true);
 select balance into after_qty from public.room_stock where room='Shared' and item_id='film1714';
 if before-after_qty<>15 then raise exception 'Daily deduction double counted earlier usage: %',before-after_qty;end if;
 if old_usage is distinct from (select to_jsonb(s) from public.stock_shift_usage s where date=today and room='CT' and shift='morning' and category='films') then raise exception 'Original shift overwritten';end if;
 perform pg_temp.save_close(d,true);
 if after_qty<>(select balance from public.room_stock where room='Shared' and item_id='film1714') then raise exception 'Repeated save deducted twice';end if;
 d:=jsonb_set(d,'{CT|film1714,used}','22');perform pg_temp.save_close(d,true);
 if after_qty-2<>(select balance from public.room_stock where room='Shared' and item_id='film1714') then raise exception 'Correction did not deduct difference only';end if;
 d:=jsonb_set(d,'{CT|film1714,used}','19');perform pg_temp.save_close(d,true);
 if after_qty+1<>(select balance from public.room_stock where room='Shared' and item_id='film1714') then raise exception 'Downward correction not restored';end if;
 perform pg_temp.expect_error(format('select pg_temp.save_close(%L::jsonb,true)',jsonb_set(d,'{CT|film1714,used}','9')),'%below earlier shift%');
 perform pg_temp.expect_error(format('select pg_temp.save_close(%L::jsonb,true)',d-'CT|film1210'),'%Keep previously saved quantities%');
 ctx:=public.daily_close_context(today);
 perform pg_temp.expect_error(format('select public.save_daily_close(%L,%L::jsonb,%L,%L,0,true,%L)',today,d,'Test','',(ctx->>'token')),'%changed%');
 -- Contrast closes only contrast; it creates no film record or daily consumption.
 ctx:=public.contrast_shift_context(today,'CT','afternoon');t:=ctx->>'token';
 perform public.save_contrast_shift(today,'CT','afternoon','{"ct_contrast":{"used":80,"waste":20,"patients":2,"reviewed":true},"gastrolux":{"used":0,"waste":0,"patients":0,"reviewed":true}}','Test afternoon',0,0,0,true,'{}','',t);
 select * into rec from public.room_shift_reviews where date=today and room='CT' and shift='afternoon';
 if not rec.finished or rec.entry_mode<>'contrast' then raise exception 'Contrast-only finish failed';end if;
 if exists(select 1 from public.stock_shift_usage where date=today and room='CT' and shift='afternoon' and category='films') then raise exception 'Contrast save created films';end if;
 if not exists(select 1 from radcontrack_private.stock_correction_audit where record_id='daily/'||today::text and before_record is not null) then raise exception 'Daily correction audit missing';end if;
 -- Staff can correct yesterday, but not older days. Anonymous cannot call writers.
 perform set_config('request.jwt.claim.sub',(select id::text from auth.users where email='btradiographers@gmail.com'),true);
 perform pg_temp.expect_error(format('select public.save_daily_close(%L,%L::jsonb,%L,%L,0,false,%L)',today-2,'{}','Test','',(public.daily_close_context(today-2)->>'token')),'%today or yesterday%');
end $$;
set local role authenticated;
do $$begin
 if has_table_privilege('authenticated','public.daily_stock_closes','INSERT') or has_table_privilege('authenticated','public.daily_stock_closes','UPDATE') or has_table_privilege('authenticated','public.daily_stock_closes','DELETE') then raise exception 'Direct daily write allowed';end if;
 if not exists(select 1 from public.daily_stock_closes) then raise exception 'Approved read blocked';end if;
end $$;
reset role;
set local role anon;
select pg_temp.expect_error('select public.daily_close_context(current_date)','%permission denied%');
reset role;
rollback;
\echo PASS: no double deduction, corrections, historical baseline, contrast finish, audit, access and date restrictions
