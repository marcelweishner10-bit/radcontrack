begin;
-- Keep historical records and balances. Only change the current routine room item lists.
create or replace function radcontrack_private.routine_item(p_id text,p_room text) returns boolean
language sql immutable set search_path='' as $$
 select case when p_id in ('a4_paper','gloves_piece') then false
 when p_room in ('X-ray','Fluoroscopy','Mammography') and p_id in ('cd','cd_jacket','double_connector','electrodes','injector_syringe','marker','single_connector','wipes') then false
 when p_id='mri_contrast' then p_room='MRI'
 when p_id in ('ct_contrast','gastrolux') then p_room in ('CT','Fluoroscopy') else true end
$$;
revoke all on function radcontrack_private.routine_item(text,text) from public,anon;
grant execute on function radcontrack_private.routine_item(text,text) to authenticated;
commit;

