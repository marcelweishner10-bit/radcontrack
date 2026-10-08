\set ON_ERROR_STOP on
select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);
create table split_context_before as
 select day,room,shift,public.shift_context(day,room,shift) as context
 from unnest(array['2026-10-07'::date,'2026-10-08'::date]) day,
 unnest(array['CT','MRI','X-ray','Fluoroscopy','Mammography']) room,
 unnest(array['morning','afternoon','night']) shift;
