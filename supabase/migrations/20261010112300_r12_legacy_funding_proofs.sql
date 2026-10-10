-- Additive read-only evidence for legacy funding revision hashes. Native caps
-- use compact digests; legacy increases use the full immutable chained body.
-- No scope, preview, input snapshot, allowance, grant or paid effect is changed.
begin;

create function private.r12_adaptive_funding_revision_body(v private.r12_owner_funding_revisions)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('bindingId',v.binding_id,'revision',v.revision,
  'previousHash',v.previous_hash,'previousMaximumMicrounits',v.previous_maximum_microunits::text,
  'maximumMicrounits',v.maximum_microunits::text,'committedMicrounits',v.committed_microunits::text,
  'policyId',v.policy_id,'ownerId',v.owner_id)
$$;

create function private.r12_adaptive_funding_proof(p_scope uuid) returns jsonb
language plpgsql stable set search_path='' as $$
declare s private.r12_discovery_scopes;setup private.r12_adaptive_setups;
 a private.r12_adaptive_activations;b private.r12_owner_funding_bindings;
 current_row private.r12_owner_funding_revisions;approval_row private.r12_owner_funding_revisions;
 current_body jsonb:=null;approval_body jsonb:=null;body jsonb;pin jsonb;
 current_revision integer;approval_revision integer;current_maximum bigint;approval_maximum bigint;
begin
 select * into s from private.r12_discovery_scopes where id=p_scope;
 select * into a from private.r12_adaptive_activations where scope_id=s.id;
 select * into setup from private.r12_adaptive_setups where id=a.setup_id;
 select * into b from private.r12_owner_funding_bindings where id=setup.binding_id;
 if s.id is null or s.origin is distinct from 'owner_adaptive'
 or s.amendment->>'version' not in ('r12.discovery-owner-adaptive.1','r12.discovery-owner-adaptive.2','r12.discovery-owner-adaptive.3')
 or a.scope_id is null or setup.id is null or b.id is null
 or a.business_id is distinct from s.business_id or a.goal_id is distinct from s.goal_id
 or setup.business_id is distinct from s.business_id or setup.goal_id is distinct from s.goal_id
 or setup.scope_id is distinct from s.id or setup.owner_id is distinct from a.owner_id
 or setup.policy_id is distinct from a.policy_id or setup.binding_id is distinct from a.binding_id
 or b.business_id is distinct from s.business_id
 or s.amendment_hash is distinct from a.scope_hash or s.amendment_hash is distinct from private.stage14_hash(s.amendment)
 or s.amendment->>'setupId' is distinct from setup.id::text
 or s.amendment->>'setupHash' is distinct from setup.setup_hash
 or s.amendment->'funding'->>'bindingId' is distinct from b.id::text
 or s.amendment->'funding'->>'kind' is distinct from b.kind
 or s.amendment->'funding'->>'authorityRootId' is distinct from b.authority_root_id::text
 or setup.setup_hash is distinct from private.stage14_hash(private.r12_adaptive_setup_packet(
  setup.selection,setup.grant_id,setup.approval_hash,setup.quote,setup.preview,setup.submission_id,setup.owner_observation_ref))
 then raise exception 'r12_adaptive_funding_proof_identity';end if;
 if b.kind='r05_business' then return null;end if;
 pin:=setup.preview->'funding';
 current_revision:=(pin->>'revision')::integer;
 approval_revision:=(s.amendment->'fundingApproval'->>'revision')::integer;
 current_maximum:=private.r05_money(pin->'currentLimitMicrounits');
 approval_maximum:=private.r05_money(pin->'proposedLimitMicrounits');
 if current_revision is null or approval_revision is null or current_revision<0 or approval_revision<>(current_revision+case when approval_maximum>current_maximum then 1 else 0 end)
 or approval_maximum<current_maximum
 or s.amendment->'fundingApproval'->>'maximumMicrounits' is distinct from approval_maximum::text
 then raise exception 'r12_adaptive_funding_proof_revision';end if;
 if current_revision=0 then
  if pin->>'bindingHash' is distinct from private.stage14_hash(jsonb_build_object('bindingId',b.id,
   'revision',0,'maximumMicrounits',current_maximum::text)) then raise exception 'r12_adaptive_funding_proof_current';end if;
 else
  select * into current_row from private.r12_owner_funding_revisions where binding_id=b.id and revision=current_revision;
  current_body:=private.r12_adaptive_funding_revision_body(current_row);
  if current_row.binding_id is null or current_row.maximum_microunits<>current_maximum
   or current_row.owner_id is distinct from setup.owner_id
   or current_row.previous_maximum_microunits<0 or current_row.committed_microunits<0
   or current_row.committed_microunits>current_row.previous_maximum_microunits
   or current_row.content_hash is distinct from pin->>'bindingHash'
   or current_row.content_hash is distinct from private.stage14_hash(current_body)
   or not exists(select 1 from private.r05_policies p join private.r05_confirmations c on c.policy_id=p.id
    where p.id=current_row.policy_id and p.business_id=s.business_id and p.actor_id=current_row.owner_id
     and c.business_id=s.business_id and c.actor_id=current_row.owner_id)
  then raise exception 'r12_adaptive_funding_proof_current';end if;
 end if;
 if approval_revision=0 then
  if s.amendment->'fundingApproval'->>'hash' is distinct from pin->>'bindingHash'
  then raise exception 'r12_adaptive_funding_proof_approval';end if;
  return null;
 end if;
 select * into approval_row from private.r12_owner_funding_revisions where binding_id=b.id and revision=approval_revision;
 approval_body:=private.r12_adaptive_funding_revision_body(approval_row);
 if approval_row.binding_id is null or approval_row.maximum_microunits<>approval_maximum
 or approval_row.owner_id is distinct from setup.owner_id
 or approval_row.previous_maximum_microunits<0 or approval_row.committed_microunits<0
 or approval_row.committed_microunits>approval_row.previous_maximum_microunits
 or approval_row.content_hash is distinct from s.amendment->'fundingApproval'->>'hash'
 or approval_row.content_hash is distinct from private.stage14_hash(approval_body)
 or not exists(select 1 from private.r05_policies p join private.r05_confirmations c on c.policy_id=p.id
  where p.id=approval_row.policy_id and p.business_id=s.business_id and p.actor_id=approval_row.owner_id
   and c.business_id=s.business_id and c.actor_id=approval_row.owner_id)
 then raise exception 'r12_adaptive_funding_proof_approval';end if;
 if approval_revision=current_revision then
  if approval_body is distinct from current_body then raise exception 'r12_adaptive_funding_proof_unchanged';end if;
 elsif approval_row.previous_hash is distinct from pin->>'bindingHash'
 or approval_row.previous_maximum_microunits<>current_maximum
 or approval_row.committed_microunits is distinct from private.r05_money(pin->'committedMicrounits')
 or approval_row.policy_id is distinct from setup.policy_id or approval_row.owner_id is distinct from setup.owner_id
 then raise exception 'r12_adaptive_funding_proof_chain';end if;
 body:=jsonb_build_object('version','r12.adaptive-funding-proof.1','businessId',s.business_id,
  'scopeId',s.id,'scopeHash',s.amendment_hash,'setupId',setup.id,'setupHash',setup.setup_hash,
  'bindingId',b.id,'ownerId',setup.owner_id,'policyId',setup.policy_id,
  'currentRevision',current_body,'approvalRevision',approval_body);
 return body||jsonb_build_object('proofHash',private.stage14_hash(body));
end $$;

-- Project alongside the original saved packet only after the original owner/
-- server-key checks succeed. Do not rewrite immutable snapshots for old calls.
alter function public.r12_discovery_owner_read(uuid,uuid,boolean) rename to r12_discovery_owner_read_before_funding_proof;
alter function public.r12_discovery_owner_read_before_funding_proof(uuid,uuid,boolean) set schema private;
create function public.r12_discovery_owner_read(p_business_id uuid,p_scope_id uuid,p_activation boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
 result:=private.r12_discovery_owner_read_before_funding_proof(p_business_id,p_scope_id,p_activation);
 if result->'activation'->'scope'->>'version' in
  ('r12.discovery-owner-adaptive.1','r12.discovery-owner-adaptive.2','r12.discovery-owner-adaptive.3') then
  result:=jsonb_set(result,'{activation,fundingProof}',coalesce(private.r12_adaptive_funding_proof(p_scope_id),'null'::jsonb));
 end if;
 return result;
end $$;

alter function public.r12_discovery_server(uuid,uuid,text,jsonb,text) rename to r12_discovery_server_before_funding_proof;
alter function public.r12_discovery_server_before_funding_proof(uuid,uuid,text,jsonb,text) set schema private;
create function public.r12_discovery_server(p_business_id uuid,p_attempt_id uuid,p_operation text,p_payload jsonb,p_server_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;scope uuid;begin
 result:=private.r12_discovery_server_before_funding_proof(p_business_id,p_attempt_id,p_operation,p_payload,p_server_key);
 if p_operation in ('inputs','load') then
  select activation.scope_id into scope from private.r07_attempts attempt
   join private.r12_adaptive_activations activation on activation.plan_id=attempt.plan_id and activation.business_id=attempt.business_id
   where attempt.id=p_attempt_id and attempt.business_id=p_business_id;
  if scope is not null then
   result:=result||jsonb_build_object('fundingProof',private.r12_adaptive_funding_proof(scope));
  end if;
 end if;
 return result;
end $$;

revoke all on function private.r12_adaptive_funding_revision_body(private.r12_owner_funding_revisions),
 private.r12_adaptive_funding_proof(uuid),
 private.r12_discovery_owner_read_before_funding_proof(uuid,uuid,boolean),
 private.r12_discovery_server_before_funding_proof(uuid,uuid,text,jsonb,text)
 from public,anon,authenticated,service_role;
revoke all on function public.r12_discovery_owner_read(uuid,uuid,boolean),
 public.r12_discovery_server(uuid,uuid,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.r12_discovery_owner_read(uuid,uuid,boolean) to authenticated;
grant execute on function public.r12_discovery_server(uuid,uuid,text,jsonb,text) to anon;
commit;
