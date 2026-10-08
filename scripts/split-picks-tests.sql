\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',true);
do $$declare row record;ctx jsonb;stripped jsonb;begin
 for row in select * from split_context_before loop
  ctx:=public.shift_context(row.day,row.room,row.shift);
  select jsonb_agg(value-'initial_received'-'topups' order by ord) into stripped from jsonb_array_elements(ctx->'items') with ordinality a(value,ord);
  if jsonb_set(ctx,'{items}',coalesce(stripped,'[]'))<>row.context then raise exception 'Existing stock context changed for % / % / %',row.day,row.room,row.shift;end if;
 end loop;
end $$;
update public.stock_items set balance=1000 where id='ct_contrast';
set local role authenticated;
select public.move_room_stock_units('issue','2026-10-08','Honey','[{"item_id":"ct_contrast","quantity":200}]','CT','morning');
select public.move_room_stock_units('issue','2026-10-08','Honey','[{"item_id":"ct_contrast","quantity":100}]','CT','morning');
do $$declare ctx jsonb;item jsonb;first_pick public.stock_movements;last_pick public.stock_movements;begin
 ctx:=public.shift_context('2026-10-08','CT','morning');
 select value into item from jsonb_array_elements(ctx->'items') where value->>'id'='ct_contrast';
 if (item->>'initial_received')::numeric<>200 or (item->>'topups')::numeric<>100 or (item->>'received')::numeric<>300 or (item->>'remaining')::numeric<>435 then raise exception 'Initial + topup totals incorrect';end if;
 select * into first_pick from stock_movements where destination='CT' and item_id='ct_contrast' and occurred_on='2026-10-08' order by created_at,id limit 1;
 select * into last_pick from stock_movements where destination='CT' and item_id='ct_contrast' and occurred_on='2026-10-08' order by created_at desc,id desc limit 1;
 perform public.correct_stock_movement('store',first_pick.id,first_pick.version,250,first_pick.occurred_on,'Honey',null,'First pickup corrected',false);
 perform public.correct_stock_movement('store',last_pick.id,last_pick.version,80,last_pick.occurred_on,'Honey',null,'Topup corrected',false);
 ctx:=public.shift_context('2026-10-08','CT','morning');
 select value into item from jsonb_array_elements(ctx->'items') where value->>'id'='ct_contrast';
 if (item->>'initial_received')::numeric<>250 or (item->>'topups')::numeric<>80 or (item->>'received')::numeric<>330 then raise exception 'Corrected split incorrect';end if;
 perform public.correct_stock_movement('store',first_pick.id,first_pick.version+1,250,first_pick.occurred_on,'Honey',null,'Duplicate first pick removed',true);
 ctx:=public.shift_context('2026-10-08','CT','morning');
 select value into item from jsonb_array_elements(ctx->'items') where value->>'id'='ct_contrast';
 if (item->>'initial_received')::numeric<>80 or (item->>'topups')::numeric<>0 or (item->>'received')::numeric<>80 then raise exception 'Deleted pick should not be counted';end if;
 ctx:=public.shift_context('2026-10-08','CT','afternoon');
 select value into item from jsonb_array_elements(ctx->'items') where value->>'id'='ct_contrast';
 if (item->>'opening')::numeric<>215 or (item->>'received')::numeric<>0 then raise exception 'Carryover shifted into a receipt';end if;
end $$;
rollback;
select 'Unchanged stock calculations across 30 contexts; initial pickups, topups, edits, deletion and carryover passed' result;
