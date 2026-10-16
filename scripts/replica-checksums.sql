-- Same checksums as recorded in migration-backup/baseline-*.md; run against production and replicas.
select json_build_object(
'daily_contrast_data',(select md5(string_agg(to_jsonb(t)::text,'' order by t.date::text)) from public.daily_contrast_data t),
'stock_shift_usage',(select md5(string_agg(to_jsonb(t)::text,'' order by t.date,t.room,t.shift,t.category)) from public.stock_shift_usage t),
'room_stock_movements',(select md5(string_agg(to_jsonb(t)::text,'' order by t.id)) from public.room_stock_movements t),
'stock_movements',(select md5(string_agg(to_jsonb(t)::text,'' order by t.id)) from public.stock_movements t),
'room_shift_reviews',(select md5(string_agg(to_jsonb(t)::text,'' order by t.date,t.room,t.shift)) from public.room_shift_reviews t),
-- Audit records hold jsonb numbers; normalise 53.00 -> 53 so JSON-restored replicas compare equal.
'stock_correction_audit',(select md5(string_agg(regexp_replace(regexp_replace(to_jsonb(t)::text,'\.00(?=[^0-9])','','g'),'(\.[0-9])0(?=[^0-9])','\1','g'),'' order by t.id)) from radcontrack_private.stock_correction_audit t),
'rsm_sum',(select sum(change) filter (where voided_at is null) from public.room_stock_movements)
)::text;
