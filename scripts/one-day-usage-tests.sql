\set ON_ERROR_STOP on
begin;
create temporary table qa_usage(date text,data jsonb);
create trigger qa_guard before insert or update on qa_usage for each row execute function radcontrack_private.guard_usage_day();
create trigger qa_audit after update on qa_usage for each row execute function radcontrack_private.audit_clinical_edit();
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
do $$declare d date:=(now() at time zone 'Africa/Lagos')::date;v_count integer;begin
 insert into qa_usage values(d::text,'{}'),((d-1)::text,'{}');
 begin
  insert into qa_usage values((d-2)::text,'{}');
  raise exception 'Older staff entry allowed';
 exception when others then if sqlerrm not like 'Staff can edit today or yesterday only%' then raise;end if;end;
 select count(*) into v_count from radcontrack_private.stock_correction_audit where source='clinical';
 update qa_usage set data='{"morning":{"used":2}}' where date=(d-1)::text;
 if (select count(*) from radcontrack_private.stock_correction_audit where source='clinical')<>v_count+1 then raise exception 'Audit missing';end if;
 if not exists(select 1 from radcontrack_private.stock_correction_audit where source='clinical' and changed_by=auth.uid() and before_record->'data'='{}'::jsonb and after_record->'data'='{"morning":{"used":2}}'::jsonb) then raise exception 'Audit actor or before/after missing';end if;
 perform set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',true);
 insert into qa_usage values((d-20)::text,'{}');
 update qa_usage set data='{"corrected":true}' where date=(d-20)::text;
end $$;
rollback;
