begin;
-- Move a daily pick to the room it was actually taken to. The store quantity is unchanged,
-- so store balances and later store counts are unaffected; only the two room balances change.
create function radcontrack_private.correct_pick_room(p_store_id uuid,p_version integer,p_room text,p_reason text) returns integer
language plpgsql security definer set search_path='' as $$
declare v_item public.stock_items; v_store public.stock_movements; v_move public.room_stock_movements;
 v_from public.room_stock; v_to public.room_stock; v_after jsonb; v_version integer;
begin
 perform radcontrack_private.assert_stock_user();
 perform radcontrack_private.assert_stock_manager();
 if length(btrim(coalesce(p_reason,'')))<5 then raise exception 'Enter the reason for moving this pick'; end if;
 select i.* into v_item from public.stock_items i where i.id=(select item_id from public.stock_movements where id=p_store_id) for update;
 if not found then raise exception 'Stock entry not found'; end if;
 select * into v_store from public.stock_movements where id=p_store_id for update;
 if v_store.movement_type<>'issue' then raise exception 'Only a daily pick can be moved to another room'; end if;
 if v_store.voided_at is not null or p_version is distinct from v_store.version then raise exception 'This pick changed. Reload before correcting it'; end if;
 if p_room is null or p_room not in ('X-ray','CT','MRI','Fluoroscopy','Mammography','Shared') or p_room=v_store.destination then raise exception 'Choose the room the stock actually went to'; end if;
 if v_item.id='mri_contrast' and p_room<>'MRI' then raise exception 'MRI contrast must go to the MRI room'; end if;
 if v_item.id='ct_contrast' and p_room not in ('CT','Fluoroscopy') then raise exception 'CT contrast must go to CT or Fluoroscopy'; end if;
 select * into v_move from public.room_stock_movements where batch_id=v_store.batch_id and item_id=v_item.id
  and room=v_store.destination and movement_type='pick' and voided_at is null for update;
 if not found then raise exception 'The linked room pick is missing. Record physical counts instead'; end if;
 select * into v_from from public.room_stock where room=v_store.destination and item_id=v_item.id for update;
 insert into public.room_stock(room,item_id) values(p_room,v_item.id) on conflict do nothing;
 select * into v_to from public.room_stock where room=p_room and item_id=v_item.id for update;
 if (v_from.counted_at is not null and v_move.created_at<=v_from.counted_at) or v_move.occurred_on<v_from.counted_on then
  raise exception 'A later count in % includes this pick. Record physical counts now instead',v_store.destination; end if;
 if v_move.occurred_on<v_to.counted_on then
  raise exception 'A later count in % already includes what is there. Record physical counts now instead',p_room; end if;
 if v_from.balance<v_move.change then raise exception '% has already used some of this pick. Correct that usage first',v_store.destination; end if;
 update public.room_stock set balance=balance-v_move.change where room=v_from.room and item_id=v_item.id;
 update public.room_stock set balance=balance+v_move.change where room=p_room and item_id=v_item.id;
 update public.room_stock_movements set room=p_room,version=version+1 where id=v_move.id;
 insert into radcontrack_private.stock_correction_audit(source,record_id,before_record,after_record,reason,changed_by)
  select 'room',v_move.id::text,to_jsonb(v_move),to_jsonb(m),btrim(p_reason),auth.uid() from public.room_stock_movements m where id=v_move.id;
 update public.stock_movements set destination=p_room,version=version+1 where id=p_store_id
  returning to_jsonb(stock_movements),version into v_after,v_version;
 insert into radcontrack_private.stock_correction_audit(source,record_id,before_record,after_record,reason,changed_by)
  values('store',p_store_id::text,to_jsonb(v_store),v_after,btrim(p_reason),auth.uid());
 return v_version;
end $$;
create function public.correct_pick_room(p_store_id uuid,p_version integer,p_room text,p_reason text) returns integer
language sql security invoker set search_path='' as $$select radcontrack_private.correct_pick_room(p_store_id,p_version,p_room,p_reason)$$;
revoke all on function radcontrack_private.correct_pick_room(uuid,integer,text,text),public.correct_pick_room(uuid,integer,text,text) from public,anon;
grant execute on function radcontrack_private.correct_pick_room(uuid,integer,text,text),public.correct_pick_room(uuid,integer,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
