\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',true);
delete from public.stock_shift_usage where room in ('CT','MRI') and date=(now() at time zone 'Africa/Lagos')::date and category='films';
delete from public.room_stock_movements where item_id='film1210';
delete from public.room_stock where item_id='film1210';
select public.move_room_stock_units('room_count',(now() at time zone 'Africa/Lagos')::date,'Honey','[{"item_id":"film1210","quantity":100}]','Shared','morning',null,null);
select radcontrack_private.save_room_usage((now() at time zone 'Africa/Lagos')::date,'CT','morning','films','{"film1210":20}',1,'CT staff',0);
select radcontrack_private.save_room_usage((now() at time zone 'Africa/Lagos')::date,'MRI','morning','films','{"film1210":30}',1,'MRI staff',0);
do $$declare c jsonb;begin
 if (select balance from public.room_stock where room='Shared' and item_id='film1210')<>50 then raise exception 'Shared use deducted incorrectly';end if;
 if (select count(*) from public.stock_shift_usage where date=(now() at time zone 'Africa/Lagos')::date and category='films' and room in ('CT','MRI'))<>2 then raise exception 'Room attribution lost';end if;
 c:=public.shift_context((now() at time zone 'Africa/Lagos')::date,'X-ray','afternoon');
 if not exists(select 1 from jsonb_array_elements(c->'items') x where x->>'id'='film1210' and (x->>'opening')::numeric=50) then raise exception 'Shared carryover missing';end if;
end $$;
select radcontrack_private.save_room_usage((now() at time zone 'Africa/Lagos')::date,'CT','morning','films','{"film1210":10}',1,'CT staff',1);
do $$begin
 if (select balance from public.room_stock where room='Shared' and item_id='film1210')<>60 then raise exception 'Correction double deducted';end if;
 begin
 perform public.move_room_stock_units('issue',(now() at time zone 'Africa/Lagos')::date,'Honey','[{"item_id":"mri_contrast","quantity":1}]','CT','morning',null,null);
 raise exception 'Wrong MRI destination accepted';
 exception when others then if sqlerrm not like 'MRI contrast must%' then raise;end if;end;
end $$;
rollback;
