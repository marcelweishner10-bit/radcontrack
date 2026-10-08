begin;
create function radcontrack_private.guard_usage_day() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_today date:=(now() at time zone 'Africa/Lagos')::date;v_honey boolean;
begin
 perform radcontrack_private.assert_stock_user();
 v_honey:=coalesce(radcontrack_private.inventory_role(),'')='stock_editor' and exists(select 1 from auth.users where id=auth.uid() and lower(email)='honey.onabanjo@bthdc.com.ng' and email_confirmed_at is not null);
 if new.date::date>v_today then raise exception 'Usage cannot be entered for a future day';end if;
 if not v_honey and (new.date::date<v_today-1 or (tg_op='UPDATE' and old.date::date<v_today-1)) then raise exception 'Staff can edit today or yesterday only. Ask Honey to correct an older day';end if;
 return new;
end $$;
revoke all on function radcontrack_private.guard_usage_day() from public,anon,authenticated;
create trigger guard_usage_day before insert or update on public.stock_shift_usage for each row execute function radcontrack_private.guard_usage_day();
create trigger guard_review_day before insert or update on public.room_shift_reviews for each row execute function radcontrack_private.guard_usage_day();
create trigger guard_clinical_day before insert or update on public.daily_contrast_data for each row execute function radcontrack_private.guard_usage_day();
-- Original clinical tables are retained in the same audit archive as connected usage.
create function radcontrack_private.audit_clinical_edit() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and old.data is distinct from new.data then
 insert into radcontrack_private.stock_correction_audit(source,record_id,before_record,after_record,reason,changed_by)
 values('clinical',new.date::text,to_jsonb(old),to_jsonb(new),'Clinical usage correction',auth.uid());
 end if;
 return new;
end $$;
revoke all on function radcontrack_private.audit_clinical_edit() from public,anon,authenticated;
create trigger audit_clinical_edit after update on public.daily_contrast_data for each row execute function radcontrack_private.audit_clinical_edit();
commit;
