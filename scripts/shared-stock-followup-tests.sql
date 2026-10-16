\set ON_ERROR_STOP on
-- End-to-end checks for Shared stock on a production replica after
-- 20261008135954_shared_consumable_stock and 20261015210000_shared_stock_followup.
-- Run with: psql -v before_totals="'<json>'" ... (see scripts/run-shared-stock-tests.sh). Everything rolls back.
begin;
create temp table t_ids as select
 (select id from auth.users where email='honey.onabanjo@bthdc.com.ng') honey,
 (select id from auth.users where email='btradiographers@gmail.com') staff,
 (now() at time zone 'Africa/Lagos')::date today;
grant select on t_ids to public;

create function pg_temp.as_user(p uuid) returns void language sql as $$select set_config('request.jwt.claim.sub',p::text,true)$$;
create function pg_temp.ctx(p_date date,p_room text,p_shift text,p_id text) returns jsonb language sql as
 $$select x from jsonb_array_elements(radcontrack_private.shift_context(p_date,p_room,p_shift)->'items') x where x->>'id'=p_id$$;
create function pg_temp.items(p_date date,p_room text,p_shift text) returns text[] language sql as
 $$select array_agg(x->>'id' order by x->>'id') from jsonb_array_elements(radcontrack_private.shift_context(p_date,p_room,p_shift)->'items') x$$;
create function pg_temp.expect_error(p_sql text,p_like text) returns void language plpgsql as $$
begin execute p_sql; raise exception 'Expected error like "%" from: %',p_like,p_sql;
exception when others then if sqlerrm not like p_like then raise; end if; end $$;
create function pg_temp.shift_save(p_date date,p_room text,p_shift text,p_details jsonb,p_finish boolean) returns integer language plpgsql as $$
declare r public.room_shift_reviews; f integer; s integer;
begin
 select * into r from public.room_shift_reviews where date=p_date and room=p_room and shift=p_shift;
 select version into f from public.stock_shift_usage where date=p_date and room=p_room and shift=p_shift and category='films';
 select version into s from public.stock_shift_usage where date=p_date and room=p_room and shift=p_shift and category='supplies';
 return radcontrack_private.save_shift(p_date,p_room,p_shift,p_details,'Test radiographer',coalesce(r.version,0),coalesce(f,0),coalesce(s,0),p_finish,'{}'::jsonb,'',
  radcontrack_private.shift_context(p_date,p_room,p_shift)->>'token');
end $$;

do $$declare t record; v jsonb; b uuid;
begin
 select * into t from t_ids;

 -- 1. Data preserved by the migrations: per-item totals across department + every location.
 if exists(select 1 from (select i.id,i.balance+coalesce((select sum(balance) from public.room_stock r where r.item_id=i.id),0) total from public.stock_items i) x
  join (select key id,value::numeric total from jsonb_each_text(current_setting('tracstoc.before_totals')::jsonb)) y using(id) where x.total<>y.total)
 then raise exception 'Item totals changed during migration'; end if;
 if exists(select 1 from public.room_stock where room not in ('Shared','CT','MRI','Fluoroscopy') ) then raise exception 'Room-level consumable balances remain after pooling'; end if;
 if exists(select 1 from public.room_stock rs where rs.balance<>(select coalesce(sum(change),0) from public.room_stock_movements m where m.room=rs.room and m.item_id=rs.item_id and m.voided_at is null)) then raise exception 'A location balance no longer equals its movements'; end if;
 if exists(select 1 from public.stock_movements where movement_type='issue' and picked_for is null and occurred_on>='2026-10-02') then raise exception 'Some earlier picks lost their room attribution'; end if;

 -- 2. Item lists stay relevant to each modality.
 perform pg_temp.as_user(t.staff);
 if pg_temp.items(t.today,'X-ray','morning') && array['gastrolux','ct_contrast','mri_contrast','injector_syringe','double_connector'] then raise exception 'X-ray lists irrelevant items: %',pg_temp.items(t.today,'X-ray','morning'); end if;
 if pg_temp.items(t.today,'MRI','morning') && array['gastrolux','ct_contrast'] then raise exception 'MRI lists CT items'; end if;
 if not pg_temp.items(t.today,'CT','morning') @> array['ct_contrast','gastrolux','film1714','film1210','cd','cd_jacket'] then raise exception 'CT is missing routine items'; end if;
 if pg_temp.items(t.today,'Mammography','morning') && array['a4_paper','gloves_piece'] then raise exception 'Administrative items listed'; end if;

 -- 3. One pick with mixed items, picked "for MRI": each item goes to its own location.
 b:=radcontrack_private.move_room_stock('issue',t.today,'Test picker','[{"item_id":"mri_contrast","quantity":15},{"item_id":"ct_contrast","quantity":100},{"item_id":"film1210","quantity":100}]','MRI','afternoon',null,null);
 if (select string_agg(item_id||'>'||destination||'/'||picked_for,',' order by item_id) from public.stock_movements where batch_id=b)<>'ct_contrast>CT/MRI,film1210>Shared/MRI,mri_contrast>MRI/MRI' then
  raise exception 'Mixed pick routed wrongly: %',(select string_agg(item_id||'>'||destination||'/'||picked_for,',') from public.stock_movements where batch_id=b); end if;

 -- 4. Repeated top-ups in one shift accumulate; each pickup stays a separate record.
 perform radcontrack_private.move_room_stock('issue',t.today,'Test picker','[{"item_id":"film1714","quantity":100}]','X-ray','afternoon',null,null);
 perform radcontrack_private.move_room_stock('issue',t.today,'Second picker','[{"item_id":"film1714","quantity":50}]','CT','afternoon',null,null);
 v:=pg_temp.ctx(t.today,'X-ray','afternoon','film1714');
 if (v->>'received')::numeric<>150 or (v->>'received_for_room')::numeric<>100 or (v->>'topups')::numeric<>50 then raise exception 'Top-ups wrong: %',v; end if;

 -- 5. Cross-room Shared use in the same shift: one pool, usage attributed to each room.
 perform pg_temp.shift_save(t.today,'X-ray','afternoon','{"film1714":{"used":20,"patients":10,"reviewed":true}}',false);
 perform pg_temp.shift_save(t.today,'CT','afternoon','{"film1714":{"used":30,"patients":12,"reviewed":true}}',false);
 v:=pg_temp.ctx(t.today,'X-ray','afternoon','film1714');
 if (v->>'used_elsewhere')::numeric<>30 then raise exception 'X-ray should see 30 films used elsewhere: %',v; end if;
 if (v->>'remaining')::numeric<>(v->>'opening')::numeric+(v->>'received')::numeric+(v->>'adjustment')::numeric-50 then raise exception 'Shared remaining wrong: %',v; end if;
 if (pg_temp.ctx(t.today,'CT','afternoon','film1714')->>'used_elsewhere')::numeric<>20 then raise exception 'CT should see 20 films used elsewhere'; end if;
 if (select count(*) from public.room_stock where item_id='film1714')<>1 then raise exception 'Shared films duplicated across rooms'; end if;
 if (select quantities->>'film1714' from public.stock_shift_usage where date=t.today and room='X-ray' and shift='afternoon' and category='films')<>'20' then raise exception 'X-ray attribution lost'; end if;

 -- 6. Correcting saved usage changes the balance by the difference only (no double depletion).
 v:=pg_temp.ctx(t.today,'X-ray','afternoon','film1714');
 perform pg_temp.shift_save(t.today,'X-ray','afternoon','{"film1714":{"used":25,"patients":11,"reviewed":true}}',false);
 if (pg_temp.ctx(t.today,'X-ray','afternoon','film1714')->>'remaining')::numeric<>(v->>'remaining')::numeric-5 then raise exception 'Usage correction double-deducted'; end if;

 -- 7. Contrast with wastage: remaining = carry-over + pickups - administered - wastage.
 v:=pg_temp.ctx(t.today,'CT','afternoon','ct_contrast');
 perform pg_temp.shift_save(t.today,'CT','afternoon','{"film1714":{"used":30,"patients":12,"reviewed":true},"ct_contrast":{"used":80,"waste":20,"patients":2,"reviewed":true}}',false);
 if (pg_temp.ctx(t.today,'CT','afternoon','ct_contrast')->>'remaining')::numeric<>(v->>'remaining')::numeric-100 then raise exception 'Contrast wastage not deducted once'; end if;

 -- 8. Another room's usage does not invalidate this room's review token.
 v:=radcontrack_private.shift_context(t.today,'CT','afternoon');
 perform pg_temp.shift_save(t.today,'X-ray','afternoon','{"film1714":{"used":26,"patients":11,"reviewed":true}}',false);
 if radcontrack_private.shift_context(t.today,'CT','afternoon')->>'token'<>v->>'token' then raise exception 'Other room usage changed CT token'; end if;

 -- A pickup on a later day does not mark an earlier saved shift as changed.
 v:=radcontrack_private.shift_context(t.today-1,'CT','night');
 perform radcontrack_private.move_room_stock('issue',t.today,'Test picker','[{"item_id":"ct_contrast","quantity":100}]','CT','night',null,null);
 if radcontrack_private.shift_context(t.today-1,'CT','night')->>'token'<>v->>'token' then raise exception 'Later pickup changed an earlier shift token'; end if;

 -- 9. Finishing needs every item reviewed, not a physical count.
 perform pg_temp.expect_error($q$select pg_temp.shift_save((select today from t_ids),'MRI','afternoon','{"mri_contrast":{"used":10,"waste":0,"patients":1,"reviewed":true}}',true)$q$,'%: review it or choose None used before finishing');
 perform pg_temp.shift_save(t.today,'MRI','afternoon',(select jsonb_object_agg(x->>'id',case when x->>'id'='mri_contrast' then '{"used":10,"waste":0,"patients":1,"reviewed":true}'::jsonb when x->>'id' in ('film1714','film1210') then '{"used":0,"patients":0,"reviewed":true}'::jsonb else '{"used":0,"reviewed":true}'::jsonb end) from jsonb_array_elements(radcontrack_private.shift_context(t.today,'MRI','afternoon')->'items') x),true);
 if not (select finished from public.room_shift_reviews where date=t.today and room='MRI' and shift='afternoon') then raise exception 'Shift did not finish'; end if;
 -- A Shared pickup reopens it; another room's Shared usage does not.
 perform pg_temp.shift_save(t.today,'X-ray','afternoon','{"film1714":{"used":27,"patients":11,"reviewed":true}}',false);
 if not (select finished from public.room_shift_reviews where date=t.today and room='MRI' and shift='afternoon') then raise exception 'X-ray usage reopened MRI'; end if;
 perform radcontrack_private.move_room_stock('issue',t.today,'Test picker','[{"item_id":"cd","quantity":10}]','CT','afternoon',null,null);
 if (select finished from public.room_shift_reviews where date=t.today and room='MRI' and shift='afternoon') then raise exception 'Shared pickup did not reopen MRI review'; end if;

 -- 10. Usage beyond recorded stock names the item and location.
 perform pg_temp.expect_error($q$select pg_temp.shift_save((select today from t_ids),'X-ray','night','{"film1210":{"used":100000,"patients":5,"reviewed":true}}',false)$q$,'12 × 10 film: usage is more than the stock recorded in Shared stock%');
 perform pg_temp.expect_error($q$select pg_temp.shift_save((select today from t_ids),'X-ray','night','{"film1210":{"used":5,"patients":0,"reviewed":true}}',false)$q$,'12 × 10 film: check the patients%');

 -- 11. Day permissions: staff may edit yesterday, not older days; Honey may.
 perform pg_temp.shift_save(t.today-1,'X-ray','night','{"film1210":{"used":1,"patients":1,"reviewed":true}}',false);
 perform pg_temp.expect_error($q$select pg_temp.shift_save((select today-3 from t_ids),'X-ray','night','{"film1210":{"used":1,"patients":1,"reviewed":true}}',false)$q$,'Staff can edit today or yesterday only%');
 perform pg_temp.expect_error($q$select radcontrack_private.move_room_stock('issue',(select today-1 from t_ids),'Test','[{"item_id":"cd","quantity":1}]','CT','morning',null,null)$q$,'Only Honey can record%');
 perform pg_temp.expect_error($q$select radcontrack_private.move_room_stock('receipt',(select today from t_ids),'Test','[{"item_id":"cd","quantity":1}]',null,null,null,null)$q$,'Only authorised stock editors%');
 perform pg_temp.expect_error($q$select radcontrack_private.correct_pick_room((select id from public.stock_movements where movement_type='issue' and destination='CT' and item_id='ct_contrast' and voided_at is null order by created_at desc limit 1),1,'Fluoroscopy','Staff attempt')$q$,'Only authorised stock editors%');
 perform pg_temp.as_user(t.honey);
 perform pg_temp.shift_save(t.today-3,'X-ray','night','{"film1210":{"used":1,"patients":1,"reviewed":true}}',false);

 -- 12. Shared stock cannot be "moved" to a room; contrast still can, by Honey only.
 perform pg_temp.expect_error($q$select radcontrack_private.correct_pick_room((select id from public.stock_movements where batch_id=(select batch_id from public.stock_movements where item_id='film1210' and picked_for='MRI' order by created_at desc limit 1) and item_id='film1210'),1,'CT','Honey attempt')$q$,'Shared stock is used by every room%');

 -- 13. Physical count replaces the Shared balance; it does not add.
 perform radcontrack_private.move_room_stock('room_count',t.today,'Honey','[{"item_id":"film1714","quantity":400}]','Shared','night',null,null);
 if (select balance from public.room_stock where room='Shared' and item_id='film1714')<>400 then raise exception 'Count did not replace balance'; end if;
 if not (pg_temp.ctx(t.today,'CT','night','film1714')->>'known')::boolean then raise exception 'Counted Shared balance should be known'; end if;

 raise notice 'Shared stock follow-up: all end-to-end checks passed';
end $$;
rollback;
