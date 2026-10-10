-- Owner-safe status only. This read never returns a profile/session, private
-- proof, credential envelope, owner-view URL, or reusable source binding.
begin;
create function public.r12_owner_etsy_steel_verification_read(p_business_id uuid,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s private.r12_etsy_steel_setups;c private.r12_etsy_steel_candidates;v private.r12_etsy_steel_verifications;
 e private.r12_direct_test_envelopes;r private.r12_direct_browser_routes;vr private.r12_etsy_steel_verification_runs;
 terminal private.r12_direct_browser_receipts;state text;reason text;result jsonb;
begin
 -- Locks/rechecks the authenticated owner, rather than accepting owner identity
 -- from a supplied operation or returning metadata for another Business.
 perform private.r05_owner(p_business_id);
 select * into s from private.r12_etsy_steel_setups where operation_id=p_operation_id
  and business_id=p_business_id and owner_id=auth.uid();
 if s.operation_id is null then return null;end if;
 select * into c from private.r12_etsy_steel_candidates where operation_id=s.operation_id;
 if c.binding_id is null then return null;end if;
 select * into v from private.r12_etsy_steel_verifications where binding_id=c.binding_id;
 select * into strict e from private.r12_direct_test_envelopes where id=s.envelope_id;
 select * into strict r from private.r12_direct_browser_routes where route_hash=s.route_hash;
 if exists(select 1 from private.r12_etsy_steel_stops where operation_id=s.operation_id) then
  state:='stopped';reason:='owner_stopped';
 elsif exists(select 1 from private.r12_etsy_steel_setups x where x.business_id=s.business_id and x.account_id=s.account_id and x.sequence>s.sequence) then
  state:='invalidated';reason:='account_revision_changed';
 elsif s.profile_expires_at<=clock_timestamp() or e.expires_at<=clock_timestamp() or r.valid_until<=clock_timestamp()
  or (v.binding_id is null and s.approval_expires_at<=clock_timestamp())
  or (v.binding_id is not null and (v.binding->>'expiresAt')::timestamptz<=clock_timestamp()) then
  state:='expired';reason:='verification_expired';
 else
  begin
   perform private.r12_etsy_steel_current(s.operation_id,v.binding_id is null);
   if e.content->>'version'='r12.owner-direct-test-envelope.1' then perform private.r12_direct_test_current(e.id);end if;
  exception when raise_exception then
   -- Only explicit current-authority denials become an ordinary inactive view.
   -- Corrupt records, SQL defects and unexpected authorization errors propagate.
   if sqlerrm in ('etsy_handoff_authority_inactive','r12_direct_current_test_required') then
    state:='invalidated';reason:='authority_inactive';
   else raise;end if;
  end;
 end if;
 if state is null and v.binding_id is not null then
  perform private.r12_etsy_steel_account_binding_check(v.binding);
  state:='verified';reason:='verification_verified';
 elsif state is null then
  select * into vr from private.r12_etsy_steel_verification_runs where setup_operation_id=s.operation_id;
  select * into terminal from private.r12_direct_browser_receipts where operation_id=vr.operation_id;
  if terminal.operation_id is not null then
   if terminal.content->>'version' is distinct from 'etsy.steel-account-verification-receipt.1'
    or terminal.content->>'scopeHash' is distinct from vr.scope_hash then raise exception 'etsy_verification_status_receipt_invalid';end if;
   if terminal.content->>'status' in ('paused','failed') then
    state:='failed';reason:=case when terminal.content->>'status'='paused' then 'verification_paused' else 'verification_failed' end;
   elsif terminal.content->>'status'='verified' then
    state:='pending_verification';reason:='binding_persistence_pending';
   else raise exception 'etsy_verification_status_receipt_invalid';end if;
  else
   state:='pending_verification';reason:=case when vr.operation_id is null then 'awaiting_verification' else 'verification_in_progress' end;
  end if;
 end if;
 result:=jsonb_build_object('version','etsy.steel-owner-verification-view.1','operationId',s.operation_id,
  'status',state,'accountBindingHash',null,'observedShopName',null,'verifiedAt',null,'expiresAt',null,'reason',reason);
 if state='verified' then result:=result||jsonb_build_object('accountBindingHash',v.binding_hash,
  'observedShopName',v.binding->>'observedShopName','verifiedAt',v.binding->>'verifiedAt','expiresAt',v.binding->>'expiresAt');end if;
 return result;
end $$;
revoke all on function public.r12_owner_etsy_steel_verification_read(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.r12_owner_etsy_steel_verification_read(uuid,uuid) to authenticated;
commit;
