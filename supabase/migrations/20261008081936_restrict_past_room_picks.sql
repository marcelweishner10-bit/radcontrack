begin;
-- Guard both ledgers, including corrections and soft deletion. Existing data is unchanged.
create or replace function radcontrack_private.guard_past_room_pick() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_today date := (now() at time zone 'Africa/Lagos')::date; v_past boolean;
begin
 v_past := new.movement_type in ('issue','pick') and new.occurred_on < v_today;
 if TG_OP='UPDATE' then v_past := v_past or (old.movement_type in ('issue','pick') and old.occurred_on < v_today); end if;
 if v_past and not (
  coalesce(radcontrack_private.inventory_role(),'')='stock_editor'
  and exists(select 1 from auth.users where id=auth.uid() and lower(email)='honey.onabanjo@bthdc.com.ng' and email_confirmed_at is not null)
 ) then raise exception 'Only Honey can record, correct or remove a room pick for a past date. Choose today or ask Honey to help.'; end if;
 return new;
end $$;
revoke all on function radcontrack_private.guard_past_room_pick() from public,anon,authenticated;
create trigger guard_past_department_pick before insert or update on public.stock_movements
for each row execute function radcontrack_private.guard_past_room_pick();
create trigger guard_past_room_pick before insert or update on public.room_stock_movements
for each row execute function radcontrack_private.guard_past_room_pick();
commit;
