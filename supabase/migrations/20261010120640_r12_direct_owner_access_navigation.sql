-- Resume the exact saved owner access operation after a reload. This projection
-- conveys no provider profile/session, owner-view URL, source scope or authority.
begin;
alter function public.r12_owner_direct_read(uuid,uuid,uuid) rename to r12_owner_direct_read_before_access_navigation;
create function public.r12_owner_direct_read(p_business_id uuid,p_goal_id uuid,p_test_envelope_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;s private.r12_etsy_steel_setups;owner_view jsonb;navigation jsonb:=null;selected_envelope uuid;
begin
 result:=public.r12_owner_direct_read_before_access_navigation(p_business_id,p_goal_id,p_test_envelope_id);
 selected_envelope:=(result->'current'->>'testEnvelopeId')::uuid;
 if selected_envelope is not null then
  select x.* into s from private.r12_etsy_steel_setups x
   join private.r12_direct_test_envelopes e on e.id=x.envelope_id and e.business_id=x.business_id and e.owner_id=x.owner_id
   where x.envelope_id=selected_envelope and x.business_id=p_business_id and x.owner_id=auth.uid() and e.goal_id=p_goal_id
   order by x.sequence desc limit 1;
  if s.operation_id is not null then
   owner_view:=public.r12_etsy_steel_owner(p_business_id,'read',jsonb_build_object('operationId',s.operation_id));
   navigation:=jsonb_build_object('version','r12.direct-owner-access-navigation.1','testEnvelopeId',s.envelope_id,
    'operationId',s.operation_id,'status',owner_view->>'status',
    'verification',public.r12_owner_etsy_steel_verification_read(p_business_id,s.operation_id));
  end if;
 end if;
 return result||jsonb_build_object('ownerAccess',navigation);
end $$;
revoke all on function public.r12_owner_direct_read_before_access_navigation(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.r12_owner_direct_read(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.r12_owner_direct_read(uuid,uuid,uuid) to authenticated;
commit;
