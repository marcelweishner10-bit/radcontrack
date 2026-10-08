-- Read-only presentation split. Receipts, deductions and stock writers are unchanged.
begin;
create or replace function radcontrack_private.shift_context(p_date date,p_room text,p_shift text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_result jsonb; v_rank integer; v_token text;
begin
 perform radcontrack_private.assert_stock_user();
 v_rank:=array_position(array['morning','afternoon','night'],p_shift);
 if v_rank is null or p_room not in ('X-ray','CT','MRI','Fluoroscopy','Mammography') then raise exception 'Choose a room and shift';end if;
 select md5(coalesce(string_agg(id::text||':'||version::text||':'||change::text||':'||coalesce(voided_at::text,''),',' order by id),'')) into v_token
 from public.room_stock_movements where room=p_room;
 with movements as (
 select *,coalesce(array_position(array['morning','afternoon','night'],shift),1) as rank
 from public.room_stock_movements where room=p_room and voided_at is null
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
 (coalesce(bool_or(m.movement_type='count' and (m.occurred_on<p_date or (m.occurred_on=p_date and m.rank<=v_rank))),false)
 and not coalesce(bool_or(m.movement_type='count' and m.occurred_on=p_date and m.shift is null),false)) as known
 from public.stock_items i left join movements m on m.item_id=i.id left join picks p on p.id=m.id
 where i.active and radcontrack_private.routine_item(i.id,p_room) group by i.id,i.name,i.unit
 ) select jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(flows) order by name),'[]'),'token',v_token) into v_result from flows;
 return v_result;
end $$;
revoke all on function radcontrack_private.shift_context(date,text,text) from public,anon;
grant execute on function radcontrack_private.shift_context(date,text,text) to authenticated;
commit;
