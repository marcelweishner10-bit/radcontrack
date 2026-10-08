begin;
-- Optional supplies become visible only for stock/receipts/records in this shift.
create function radcontrack_private.shift_item(p_id text,p_room text,p_date date,p_shift text) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare v_rank integer:=array_position(array['morning','afternoon','night'],p_shift);v_balance numeric;v_pick boolean;
begin
 perform radcontrack_private.assert_stock_user();
 if radcontrack_private.routine_item(p_id,p_room) then return true;end if;
 if p_room not in ('X-ray','Fluoroscopy','Mammography') or p_id not in ('cd','cd_jacket','double_connector','electrodes','injector_syringe','marker','single_connector','wipes') then return false;end if;
 select coalesce(sum(change),0),coalesce(bool_or(movement_type='pick' and occurred_on=p_date and coalesce(array_position(array['morning','afternoon','night'],shift),1)=v_rank),false)
 into v_balance,v_pick from public.room_stock_movements
 where room=p_room and item_id=p_id and voided_at is null
 and (occurred_on<p_date or (occurred_on=p_date and coalesce(array_position(array['morning','afternoon','night'],shift),1)<=v_rank));
 return v_balance<>0 or v_pick
 or exists(select 1 from public.stock_shift_usage where date=p_date and room=p_room and shift=p_shift and coalesce((quantities->>p_id)::numeric,0)>0)
 or exists(select 1 from public.room_shift_reviews where date=p_date and room=p_room and shift=p_shift and details ? p_id);
end $$;
revoke all on function radcontrack_private.shift_item(text,text,date,text) from public,anon;
grant execute on function radcontrack_private.shift_item(text,text,date,text) to authenticated;
-- Change eligibility in both readers and writers, preserving all later fixes.
do $$declare v_definition text;begin
 select pg_get_functiondef('radcontrack_private.shift_context(date,text,text)'::regprocedure) into v_definition;
 if position('radcontrack_private.routine_item(i.id,p_room)' in v_definition)=0 then raise exception 'Unexpected context definition';end if;
 execute replace(v_definition,'radcontrack_private.routine_item(i.id,p_room)','radcontrack_private.shift_item(i.id,p_room,p_date,p_shift)');
 select pg_get_functiondef('radcontrack_private.save_shift(date,text,text,jsonb,text,integer,integer,integer,boolean,jsonb,text,text)'::regprocedure) into v_definition;
 if position('radcontrack_private.routine_item(id,p_room)' in v_definition)=0 then raise exception 'Unexpected save definition';end if;
 execute replace(v_definition,'radcontrack_private.routine_item(id,p_room)','radcontrack_private.shift_item(id,p_room,p_date,p_shift)');
end $$;
commit;
