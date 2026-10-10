-- Owner visibility of the existing canonical test ledger. Pending maxima stay
-- distinct from actual billing; this read grants no financial or access authority.
begin;
alter function public.r12_owner_direct_read(uuid,uuid,uuid) rename to r12_owner_direct_read_before_test_exposure;
create function public.r12_owner_direct_read(p_business_id uuid,p_goal_id uuid,p_test_envelope_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;e private.r12_direct_test_envelopes;exposure jsonb:=null;
begin
 result:=public.r12_owner_direct_read_before_test_exposure(p_business_id,p_goal_id,p_test_envelope_id);
 select x.* into e from private.r12_direct_test_envelopes x
  join private.r12_direct_test_confirmations c on c.envelope_id=x.id and c.actor_id=x.owner_id
  where x.id=(result->'current'->>'testEnvelopeId')::uuid and x.content_hash=result->'current'->>'testEnvelopeHash'
   and x.business_id=p_business_id and x.goal_id=p_goal_id and x.owner_id=auth.uid();
 if e.id is not null then exposure:=private.r12_direct_test_exposure(e.id);end if;
 return result||jsonb_build_object('testExposure',exposure);
end $$;
revoke all on function public.r12_owner_direct_read_before_test_exposure(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.r12_owner_direct_read(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.r12_owner_direct_read(uuid,uuid,uuid) to authenticated;
commit;
