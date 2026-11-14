// Generate a guarded, single-transaction release for the dashboard SQL editor.
import fs from 'node:fs/promises';
const dir='deployment-artifacts/daily-close-2026-11-02';
await fs.mkdir(dir,{recursive:true});
const migration=await fs.readFile('supabase/migrations/20261102052458_daily_close_workflow.sql','utf8');
const start=`begin;
do $$begin
 if to_regclass('public.daily_stock_closes') is not null then raise exception 'Daily close already exists. Verify the prior release instead of running it twice';end if;
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='stock_movements' and column_name='picked_for') then raise exception 'The existing Shared stock follow-up must be installed first';end if;
end $$;
-- Lock existing inventory and clinical tables so preservation checks share one snapshot.
do $$declare r record;begin
 for r in select schemaname,tablename from pg_tables where schemaname in ('public','radcontrack_private') order by schemaname,tablename loop
  execute format('lock table %I.%I in share row exclusive mode',r.schemaname,r.tablename);
 end loop;
end $$;
create temp table daily_release_before(table_schema text,table_name text,rows bigint,checksum text) on commit drop;
do $$declare r record;n bigint;h text;begin
 for r in select schemaname,tablename from pg_tables where schemaname in ('public','radcontrack_private') order by schemaname,tablename loop
  execute format('select count(*),md5(coalesce(string_agg((to_jsonb(t)-''entry_mode'')::text,'''' order by (to_jsonb(t)-''entry_mode'')::text),'''')) from %I.%I t',r.schemaname,r.tablename) into n,h;
  insert into daily_release_before values(r.schemaname,r.tablename,n,h);
 end loop;
end $$;
`;
const finish=`
do $$declare r record;n bigint;h text;begin
 for r in select * from daily_release_before loop
  execute format('select count(*),md5(coalesce(string_agg((to_jsonb(t)-''entry_mode'')::text,'''' order by (to_jsonb(t)-''entry_mode'')::text),'''')) from %I.%I t',r.table_schema,r.table_name) into n,h;
  if n<>r.rows or h<>r.checksum then raise exception 'Preservation check failed for %.%; entire release rolled back',r.table_schema,r.table_name;end if;
 end loop;
 if exists(select 1 from public.room_shift_reviews where entry_mode<>'legacy') then raise exception 'Earlier shift modes changed';end if;
 if exists(select 1 from public.daily_stock_closes) then raise exception 'Unexpected daily entries created';end if;
 if has_table_privilege('authenticated','public.daily_stock_closes','INSERT') or has_table_privilege('authenticated','public.daily_stock_closes','UPDATE') or has_table_privilege('authenticated','public.daily_stock_closes','DELETE') then raise exception 'Direct write privileges found';end if;
 if has_function_privilege('anon','public.save_daily_close(date,jsonb,text,text,integer,boolean,text)','EXECUTE') then raise exception 'Anonymous write privilege found';end if;
end $$;
select 'PRESERVED' as result,table_schema,table_name,rows,checksum from daily_release_before order by table_schema,table_name;
commit;
`;
const body=migration.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'');
await fs.writeFile(`${dir}/APPLY-guarded-daily-close.sql`,start+body+finish);
await fs.writeFile(`${dir}/BACKUP-read-only.sql`,`-- Run and export the JSON result before the release. Does not alter any records.
do $$declare r record;v jsonb;all_rows jsonb:='{}';begin
 for r in select schemaname,tablename from pg_tables where schemaname in ('public','radcontrack_private') order by schemaname,tablename loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t)),''[]'') from %I.%I t',r.schemaname,r.tablename) into v;
  all_rows:=jsonb_set(all_rows,array[r.schemaname||'.'||r.tablename],v);
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'email',email,'email_confirmed_at',email_confirmed_at,'created_at',created_at)),'[]') into v from auth.users;
 all_rows:=jsonb_set(all_rows,array['auth.users(subset)'],v);
 perform set_config('tracstoc.backup',jsonb_build_object('exported_at',clock_timestamp(),'project','beptsdmmbyffblwevxwh','tables',all_rows)::text,false);
end $$;
select current_setting('tracstoc.backup')::jsonb as backup;
`);
await fs.writeFile(`${dir}/VERIFY-read-only.sql`,`select 'daily_stock_closes' as name,count(*) from public.daily_stock_closes;
select entry_mode,count(*) from public.room_shift_reviews group by entry_mode;
select proname,prosecdef from pg_proc join pg_namespace n on n.oid=pronamespace where n.nspname='public' and proname in ('save_daily_close','daily_close_context','save_contrast_shift','contrast_shift_context');
select relrowsecurity from pg_class where oid='public.daily_stock_closes'::regclass;
select i.id,i.balance as department,r.room,r.balance as room_balance from public.stock_items i left join public.room_stock r on r.item_id=i.id order by i.id,r.room;
`);
console.log('Prepared guarded release, backup and verification SQL.');
const testScript=await fs.readFile('scripts/daily-close-tests.sql','utf8');
await fs.writeFile(`${dir}/CHECK-local.sql`,testScript.replace('\\ir ../supabase/migrations/20261102052458_daily_close_workflow.sql','\\ir APPLY-guarded-daily-close.sql'));
