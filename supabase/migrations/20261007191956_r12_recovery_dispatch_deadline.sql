-- One bounded recovery-only entry point. No authority or credentials are seeded.
begin;
create function public.r12_recovery_dispatch(
 p_business_id uuid,p_goal_id uuid,p_scope_id uuid,p_payload jsonb,p_submission_id uuid,
 p_server_key text,p_lease_token text,p_epoch bigint,p_admission_key text
) returns jsonb language plpgsql security definer
set search_path='' set statement_timeout='8s' set lock_timeout='3s' as $$
declare controller_hash text;admission_hash text;
begin
 -- Reject anonymous probing before the canonical controller takes Business locks.
 -- This cheap deny gate never replaces its locked, fresh authorization checks.
 if p_server_key is null or length(p_server_key) not between 32 and 200
 or p_admission_key is null or length(p_admission_key) not between 32 and 200
 or p_lease_token is null or length(p_lease_token) not between 32 and 200
 or p_epoch is null or p_submission_id is null or jsonb_typeof(p_payload) is distinct from 'object'
 or octet_length(p_payload::text)>512 then
 raise exception 'r12_recovery_dispatch_authority_required' using errcode='42501';end if;
 controller_hash:=encode(extensions.digest(convert_to(p_server_key,'UTF8'),'sha256'),'hex');
 admission_hash:=encode(extensions.digest(convert_to(p_admission_key,'UTF8'),'sha256'),'hex');
 if (select array_agg(key order by key) from jsonb_object_keys(p_payload) key) is distinct from array['attemptId','wireHash']::text[]
 or coalesce(p_payload->>'attemptId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
 or coalesce(p_payload->>'wireHash','') !~ '^[a-f0-9]{64}$' then
 raise exception 'r12_recovery_dispatch_authority_required' using errcode='42501';end if;
 if not exists(
 select 1 from private.r12_pilot_unsent_recovery_authorizations recovery
 join private.r12_discovery_scopes scope on scope.id=recovery.scope_id and scope.business_id=recovery.business_id
 join private.r12_discovery_authorities authority on authority.scope_id=scope.id and authority.business_id=scope.business_id and authority.goal_id=scope.goal_id
 join public.businesses business on business.id=scope.business_id
 join private.r05_policies policy on policy.id=(authority.plan->>'policyId')::uuid and policy.business_id=scope.business_id and policy.goal_id=scope.goal_id
 join private.r07_server_keys controller on controller.key_hash=authority.controller_key_hash
 join private.r05_server_keys admission on admission.key_hash=authority.admission_key_hash
 join private.r07_heads head on head.goal_id=scope.goal_id and head.business_id=scope.business_id
 join private.r07_plans plan on plan.id=head.plan_id and plan.business_id=scope.business_id and plan.goal_id=scope.goal_id
 join private.r07_attempts attempt on attempt.id=(p_payload->>'attemptId')::uuid and attempt.plan_id=plan.id and attempt.business_id=scope.business_id and attempt.goal_id=scope.goal_id
 join private.r07_bindings binding on binding.attempt_id=attempt.id and binding.business_id=scope.business_id
 where scope.id=p_scope_id and scope.business_id=p_business_id and scope.goal_id=p_goal_id
 and recovery.authorization_data->>'version'='r12.focused-pilot-unsent-recovery-authorization.1'
 and recovery.authorization_data->>'ownerId'=business.owner_user_id::text and policy.actor_id=business.owner_user_id
 and authority.plan->>'format'='r12.discovery-pilot.1' and authority.plan->>'discoveryScopeId'=scope.id::text
 and authority.mode='qualification' and plan.content_hash=authority.plan_hash and plan.content=authority.plan
 and authority.plan->>'discoveryScopeHash'=scope.amendment_hash and plan.policy_id=policy.id
 and binding.wire_hash=p_payload->>'wireHash' and attempt.step_key in ('strategy','review')
 and head.lease_epoch=p_epoch and head.lease_expires_at>clock_timestamp()
 and head.lease_hash=encode(extensions.digest(convert_to(p_lease_token,'UTF8'),'sha256'),'hex')
 and authority.controller_key_hash=controller_hash and authority.admission_key_hash=admission_hash
 and authority.valid_until>clock_timestamp() and controller.expires_at>clock_timestamp() and admission.expires_at>clock_timestamp()
 and not exists(select 1 from private.r07_server_revocations r where r.key_hash=controller_hash)
 and not exists(select 1 from private.r05_server_revocations r where r.key_hash=admission_hash)
 and not exists(select 1 from private.r05_revocations r where r.policy_id=policy.id)
 ) then raise exception 'r12_recovery_dispatch_authority_required' using errcode='42501';end if;
 return public.r07_controller(p_business_id,p_goal_id,'dispatch',p_payload,p_submission_id,p_server_key,p_lease_token,p_epoch,p_admission_key);
end $$;
revoke all on function public.r12_recovery_dispatch(uuid,uuid,uuid,jsonb,uuid,text,text,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.r12_recovery_dispatch(uuid,uuid,uuid,jsonb,uuid,text,text,bigint,text) to anon;
notify pgrst,'reload schema';
commit;
