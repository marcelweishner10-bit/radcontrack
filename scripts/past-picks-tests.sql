\set ON_ERROR_STOP on
begin;
update public.stock_items set balance=1000,counted_on=null where id='gastrolux';
update public.room_stock set counted_on=null where item_id='gastrolux';
do $$declare v_today date:=(now() at time zone 'Africa/Lagos')::date; v_id uuid; v_old uuid; v_balance numeric;begin
 perform set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
 select balance into v_balance from public.stock_items where id='gastrolux';
 begin
  perform public.move_room_stock_units('issue',v_today-1,'Staff','[{"item_id":"gastrolux","quantity":10}]','CT','morning');
  raise exception 'Past staff pick was allowed';
 exception when raise_exception then if SQLERRM not like 'Only Honey%' then raise;end if;end;
 if (select balance from public.stock_items where id='gastrolux')<>v_balance then raise exception 'Rejected pick altered balance';end if;
 v_id:=public.move_room_stock_units('issue',v_today,'Staff','[{"item_id":"gastrolux","quantity":10}]','CT','morning');
 begin
  update public.stock_movements set occurred_on=v_today-1 where batch_id=v_id;
  raise exception 'Staff changed pick to past';
 exception when raise_exception then if SQLERRM not like 'Only Honey%' then raise;end if;end;
 perform set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',true);
 v_old:=public.move_room_stock_units('issue',v_today-1,'Honey','[{"item_id":"gastrolux","quantity":10}]','CT','morning');
 update public.stock_movements set quantity=11 where batch_id=v_old;
 perform set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
 begin
  update public.stock_movements set occurred_on=v_today where batch_id=v_old;
  raise exception 'Staff bypassed restriction by redating old pick';
 exception when raise_exception then if SQLERRM not like 'Only Honey%' then raise;end if;end;
 begin
  update public.room_stock_movements set change=12 where batch_id=v_old;
  raise exception 'Staff bypassed room ledger guard';
 exception when raise_exception then if SQLERRM not like 'Only Honey%' then raise;end if;end;
 begin
  update public.stock_movements set voided_at=now() where batch_id=v_old;
  raise exception 'Staff deleted old pick';
 exception when raise_exception then if SQLERRM not like 'Only Honey%' then raise;end if;end;
end $$;
rollback;
select 'Today picks allowed; past staff picks, redating and deletion blocked; Honey past picks allowed; rejected writes rolled back' result;
