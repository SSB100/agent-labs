-- Exact reviewed recovery/terminal runtime only; no role-wide timeout or grant.
begin;
create function public.r12_recovery_server(
 p_business_id uuid,p_scope_id uuid,p_attempt_id uuid,p_operation text,p_payload jsonb,p_server_key text
) returns jsonb language plpgsql security definer
set search_path='' set statement_timeout='8s' set lock_timeout='3s' as $$
declare supplied_key_hash text;
begin
 if p_operation is null or p_operation not in ('inputs','bind','send')
 or p_server_key is null or length(p_server_key) not between 32 and 200
 or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>131072 then
 raise exception 'r12_recovery_runtime_authority_required' using errcode='42501';end if;
 if (p_operation='inputs' and p_payload<>'{}'::jsonb)
 or (p_operation='send' and ((select array_agg(key order by key) from jsonb_object_keys(p_payload) key) is distinct from array['wireHash']::text[] or jsonb_typeof(p_payload->'wireHash') is distinct from 'string' or coalesce(p_payload->>'wireHash','') !~ '^[a-f0-9]{64}$'))
 or (p_operation='bind' and ((select array_agg(key order by key) from jsonb_object_keys(p_payload) key) is distinct from array['binding','bindingHash']::text[] or jsonb_typeof(p_payload->'binding') is distinct from 'object' or jsonb_typeof(p_payload->'bindingHash') is distinct from 'string' or coalesce(p_payload->>'bindingHash','') !~ '^[a-f0-9]{64}$')) then
 raise exception 'r12_recovery_runtime_authority_required' using errcode='42501';end if;
 if p_operation='bind' then
 perform private.r04_keys(p_payload->'binding',array['version','scopeId','scopeHash','attemptId','requestId','phase','requestJson','requestHash','wireBody','wireHash','quote','dependencyPins']);
 if p_payload->'binding'->>'version' is distinct from 'r12.discovery-wire.1'
 or jsonb_typeof(p_payload->'binding'->'requestJson') is distinct from 'string' or octet_length(p_payload->'binding'->>'requestJson')>49152
 or jsonb_typeof(p_payload->'binding'->'wireBody') is distinct from 'string' or octet_length(p_payload->'binding'->>'wireBody')>49152 then
 raise exception 'r12_recovery_runtime_authority_required' using errcode='42501';end if;end if;
 supplied_key_hash:=encode(extensions.digest(convert_to(p_server_key,'UTF8'),'sha256'),'hex');
 -- Nonlocking deny gate, before canonical Business/root/key/head/request locks.
 -- The canonical function repeats all current source, authority, quote, receipt
 -- and financial checks. This branch does not cache or replace any proof.
 if not exists(
 select 1 from (
  select scope_id,business_id,authorization_data from private.r12_pilot_unsent_recovery_authorizations
   where authorization_data->>'version'='r12.focused-pilot-unsent-recovery-authorization.1'
  union all
  select scope_id,business_id,authorization_data from private.r12_pilot_technical_qualification_authorizations
   where authorization_data->>'version'='r12.focused-pilot-terminal-qualification-authorization.1'
 ) proof
 join private.r12_discovery_scopes scope on scope.id=proof.scope_id and scope.business_id=proof.business_id
 join public.businesses business on business.id=scope.business_id
 join private.r12_discovery_authorities authority on authority.scope_id=scope.id and authority.business_id=scope.business_id and authority.goal_id=scope.goal_id
 join private.r07_server_keys controller on controller.key_hash=authority.controller_key_hash
 join private.r05_server_keys admission on admission.key_hash=authority.admission_key_hash
 join private.r07_heads head on head.goal_id=scope.goal_id and head.business_id=scope.business_id
 join private.r07_plans plan on plan.id=head.plan_id and plan.business_id=scope.business_id and plan.goal_id=scope.goal_id
 join private.r07_attempts attempt on attempt.id=p_attempt_id and attempt.plan_id=plan.id and attempt.business_id=scope.business_id and attempt.goal_id=scope.goal_id
 left join private.r07_bindings binding on binding.attempt_id=attempt.id and binding.business_id=scope.business_id
 left join private.r05_requests request on request.id=binding.request_id and request.business_id=scope.business_id and request.workflow_run_id=attempt.id and request.policy_id=plan.policy_id
 left join private.r12_discovery_wires wire on wire.request_id=request.id and wire.scope_id=scope.id and wire.attempt_id=attempt.id and wire.business_id=scope.business_id
 join private.r05_policies policy on policy.id=plan.policy_id and policy.business_id=scope.business_id and policy.goal_id=scope.goal_id
 where scope.id=p_scope_id and scope.business_id=p_business_id
 and proof.authorization_data->>'ownerId'=business.owner_user_id::text and policy.actor_id=business.owner_user_id and plan.owner_id=business.owner_user_id
 and authority.mode='qualification' and authority.plan->>'format'='r12.discovery-pilot.1'
 and authority.plan->>'discoveryScopeId'=scope.id::text and authority.plan->>'discoveryScopeHash'=scope.amendment_hash
 and authority.plan_hash=plan.content_hash and authority.plan=plan.content
 and attempt.step_key in ('strategy','review') and authority.controller_key_hash=supplied_key_hash
 and admission.expires_at>clock_timestamp()
 and not exists(select 1 from private.r05_server_revocations r where r.key_hash=authority.admission_key_hash)
 and controller.expires_at>clock_timestamp() and authority.receipt_until>clock_timestamp()
 -- Receipt-mode inputs must retain the original grace. Canonical inputs alone
 -- determines whether a verified saved output qualifies for historical mode;
 -- an unmarked/unverified call after valid_until is still rejected there.
 and (p_operation='inputs' or authority.valid_until>clock_timestamp())
 and (p_operation<>'bind' or (request.id is not null and attempt.status='reserved'
 and p_payload->'binding'->>'scopeId'=scope.id::text and p_payload->'binding'->>'scopeHash'=scope.amendment_hash
 and p_payload->'binding'->>'attemptId'=attempt.id::text and p_payload->'binding'->>'requestId'=request.id::text
 and p_payload->'binding'->>'phase'=attempt.step_key and p_payload->'binding'->'dependencyPins'=attempt.dependency_pins
 and p_payload->'binding'->>'wireHash'=binding.wire_hash and p_payload->'binding'->>'requestHash'=request.payload->>'requestHash'
 and not exists(select 1 from private.r05_markers marker where marker.request_id=request.id)))
 and (p_operation<>'send' or (request.id is not null and wire.request_id is not null and wire.producer_key_hash=supplied_key_hash
 and p_payload->>'wireHash'=binding.wire_hash and wire.binding->>'wireHash'=binding.wire_hash
 and attempt.status='dispatched' and head.lease_expires_at>clock_timestamp()
 and exists(select 1 from private.r05_markers marker where marker.request_id=request.id and marker.business_id=scope.business_id)
 and exists(select 1 from private.r07_markers marker where marker.attempt_id=attempt.id and marker.business_id=scope.business_id and marker.lease_epoch=head.lease_epoch)))
 and not exists(select 1 from private.r07_server_revocations r where r.key_hash=supplied_key_hash)
 and not exists(select 1 from private.r05_revocations r where r.policy_id=policy.id)
 ) then raise exception 'r12_recovery_runtime_authority_required' using errcode='42501';end if;
 return public.r12_discovery_server(p_business_id,p_attempt_id,p_operation,p_payload,p_server_key);
end $$;
revoke all on function public.r12_recovery_server(uuid,uuid,uuid,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.r12_recovery_server(uuid,uuid,uuid,text,jsonb,text) to anon;

do $patch$
declare d text;old text;replacement text;begin
 d:=pg_get_functiondef('public.r12_recovery_dispatch(uuid,uuid,uuid,jsonb,uuid,text,text,bigint,text)'::regprocedure);
 old:='from private.r12_pilot_unsent_recovery_authorizations recovery';
 replacement:=$new$from (
 select scope_id,business_id,authorization_data from private.r12_pilot_unsent_recovery_authorizations where authorization_data->>'version'='r12.focused-pilot-unsent-recovery-authorization.1'
 union all
 select scope_id,business_id,authorization_data from private.r12_pilot_technical_qualification_authorizations where authorization_data->>'version'='r12.focused-pilot-terminal-qualification-authorization.1'
 ) recovery$new$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_recovery_dispatch_definition_drift';end if;
 d:=replace(d,old,replacement);
 old:=$old$and recovery.authorization_data->>'version'='r12.focused-pilot-unsent-recovery-authorization.1'$old$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_recovery_dispatch_version_drift';end if;
 execute replace(d,old,$new$and recovery.authorization_data->>'version' in ('r12.focused-pilot-unsent-recovery-authorization.1','r12.focused-pilot-terminal-qualification-authorization.1')$new$);
 d:=pg_get_functiondef('public.r12_discovery_server(uuid,uuid,text,jsonb,text)'::regprocedure);
 old:=$old$if exists(select 1 from private.r12_pilot_unsent_recovery_authorizations where scope_id=w.scope_id and business_id=p_business_id) then$old$;
 replacement:=$new$if exists(select 1 from private.r12_pilot_unsent_recovery_authorizations where scope_id=w.scope_id and business_id=p_business_id and authorization_data->>'version'='r12.focused-pilot-unsent-recovery-authorization.1')
 or exists(select 1 from private.r12_pilot_technical_qualification_authorizations where scope_id=w.scope_id and business_id=p_business_id and authorization_data->>'version'='r12.focused-pilot-terminal-qualification-authorization.1') then$new$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_recovery_send_fence_definition_drift';end if;
 execute replace(d,old,replacement);
end $patch$;
notify pgrst,'reload schema';
commit;
