\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',true);
do $$declare v_id text;v_ctx jsonb;v_room text;begin
 foreach v_room in array array['X-ray','Fluoroscopy','Mammography'] loop
 foreach v_id in array array['cd','cd_jacket','double_connector','electrodes','injector_syringe','marker','single_connector','wipes'] loop
  if radcontrack_private.routine_item(v_id,v_room) then raise exception 'Unwanted X-ray item %',v_id;end if;
  if not radcontrack_private.routine_item(v_id,'CT') then raise exception 'Changed CT item %',v_id;end if;
 end loop;
 foreach v_id in array array['gloves','pen','film1714','film1210'] loop
  if not radcontrack_private.routine_item(v_id,v_room) then raise exception 'Removed required X-ray item %',v_id;end if;
 end loop;
 v_ctx:=public.shift_context('2026-10-08',v_room,'morning');
 if exists(select 1 from jsonb_array_elements(v_ctx->'items') i where i->>'id' in ('cd','cd_jacket','double_connector','electrodes','injector_syringe','marker','single_connector','wipes')) then raise exception 'Excluded item still in daily context';end if;
end loop;
 if not radcontrack_private.routine_item('ct_contrast','Fluoroscopy') or not radcontrack_private.routine_item('gastrolux','Fluoroscopy') then raise exception 'Removed Fluoroscopy contrast';end if;
end $$;
rollback;
select 'Eight unrelated X-ray consumables excluded; film sizes, gloves, pen and other rooms preserved' result;

