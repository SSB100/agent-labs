-- One separately approved replacement for the single proved-never-sent successor.
-- Definitions only: no Goal, policy, verifier, operation, payment or recovery is seeded.
begin;
create table private.r12_pilot_unsent_recovery_authorizations(
 scope_id uuid primary key references private.r12_discovery_scopes(id) deferrable initially deferred,
 business_id uuid not null references public.businesses(id),
 abandoned_scope_id uuid not null unique references private.r12_discovery_scopes(id),
 budget_authority_root_id uuid not null unique references public.product_experiments(id),
 authorization_data jsonb not null,authorization_hash text not null,
 created_at timestamptz not null default clock_timestamp(),
 check(scope_id<>abandoned_scope_id and jsonb_typeof(authorization_data)='object' and octet_length(authorization_data::text)<=16384
 and authorization_hash=private.stage14_hash(authorization_data))
);
alter table private.r12_pilot_unsent_recovery_authorizations enable row level security;
revoke all on private.r12_pilot_unsent_recovery_authorizations from public,anon,authenticated,service_role;
create trigger r12_pilot_unsent_recovery_immutable before insert or update or delete
 on private.r12_pilot_unsent_recovery_authorizations for each row execute function private.r12_discovery_history_guard();

-- A private read-only union preserves both original uniqueness constraints.
-- The recovery slot is permanent, even if that attempt is never activated.
create function private.r12_pilot_research_authorizations(p_scope_id uuid,p_business_id uuid)
returns table(scope_id uuid,business_id uuid,authorization_data jsonb,authorization_hash text)
language sql stable set search_path='' as $$
 select scope_id,business_id,authorization_data,authorization_hash from private.r12_pilot_successor_authorizations where scope_id=p_scope_id and business_id=p_business_id
 union all select scope_id,business_id,authorization_data,authorization_hash from private.r12_pilot_unsent_recovery_authorizations where scope_id=p_scope_id and business_id=p_business_id
$$;
create function private.r12_pilot_research_authorization(p_scope_id uuid,p_business_id uuid)
returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb;begin
 if (select count(*) from private.r12_pilot_research_authorizations(p_scope_id,p_business_id) a where a.scope_id=p_scope_id and a.business_id=p_business_id)>1
 then raise exception 'r12_recovery_authorization_ambiguous';end if;
 select jsonb_build_object('authorization',authorization_data,'authorizationHash',authorization_hash) into result
 from private.r12_pilot_research_authorizations(p_scope_id,p_business_id) a where a.scope_id=p_scope_id and a.business_id=p_business_id;
 return result;
end $$;

-- Absence is reconstructed from every dispatch/effect store, never accepted as
-- a caller's hash or inferred from a missing result. All counts must be zero.
create function private.r12_pilot_unsent_absence(r private.r05_requests,a private.r07_attempts)
returns jsonb language plpgsql stable set search_path='' as $$
declare counts jsonb;begin
 counts:=jsonb_build_object(
 'r05Markers',(select count(*) from private.r05_markers where request_id=r.id),
 'r07Markers',(select count(*) from private.r07_markers where attempt_id=a.id),
 'transportClaims',(select count(*) from private.r12_discovery_transport_claims where request_id=r.id),
 'candidates',(select count(*) from private.r12_discovery_candidates where request_id=r.id),
 'responseObservations',(select count(*) from private.r12_discovery_response_observations where request_id=r.id),
 'receiptChecks',(select count(*) from private.r12_discovery_receipt_checks where request_id=r.id),
 'receiptObservations',(select count(*) from private.r12_discovery_receipt_observations ro join private.r12_discovery_receipt_checks rc on rc.id=ro.check_id where rc.request_id=r.id),
 'settlements',(select count(*) from private.r05_settlements where request_id=r.id),
 'receiptClaims',(select count(*) from private.r05_receipt_claims where workflow_run_id=a.id or source_key=r.source_key),
 'legacyAttestations',(select count(*) from private.r05_legacy_attestations where workflow_run_id=a.id or source_key=r.source_key),
 'responses',(select count(*) from private.r07_responses where attempt_id=a.id),
 'artifacts',(select count(*) from public.artifacts where workflow_run_id=a.id),
 'modelInvocations',(select count(*) from public.model_invocations where workflow_run_id=a.id or task_contract_id=private.stage4_deterministic_uuid('r07:task:'||a.id) or worker_run_id=private.stage4_deterministic_uuid('r07:worker:'||a.id)),
 'legacyExposure',(select count(*) from private.r05_legacy_exposure(r.business_id) le where le.workflow_id=a.id or le.source_key=r.source_key));
 if exists(select 1 from jsonb_each(counts) c where c.value<>'0'::jsonb) then raise exception 'r12_recovery_effect_evidence_present';end if;
 return counts;
end $$;

-- Exact immutable request/wire join shared by closure and finite closeout.
-- Policy revocation and both verifier revocations fence all later transport.
create function private.r12_pilot_unsent_request(p_scope_id uuid,p_attempt_id uuid)
returns jsonb language plpgsql stable set search_path='' as $$
declare s private.r12_discovery_scopes;q private.r12_discovery_authorities;p private.r07_plans;
 a private.r07_attempts;r private.r05_requests;rb private.r07_bindings;w private.r12_discovery_wires;
 pol private.r05_policies;reservation private.r05_reservations;counts jsonb;begin
 select * into strict s from private.r12_discovery_scopes where id=p_scope_id;
 select * into strict q from private.r12_discovery_authorities where scope_id=s.id and business_id=s.business_id and goal_id=s.goal_id;
 select * into strict a from private.r07_attempts where id=p_attempt_id and business_id=s.business_id and goal_id=s.goal_id;
 select * into strict p from private.r07_plans where id=a.plan_id and business_id=s.business_id and goal_id=s.goal_id;
 select * into strict rb from private.r07_bindings where attempt_id=a.id and business_id=s.business_id;
 select * into strict r from private.r05_requests where id=rb.request_id and workflow_run_id=a.id and business_id=s.business_id;
 select * into strict w from private.r12_discovery_wires where request_id=r.id and attempt_id=a.id and scope_id=s.id and business_id=s.business_id;
 select * into strict pol from private.r05_policies where id=r.policy_id and business_id=s.business_id and goal_id=s.goal_id;
 select * into strict reservation from private.r05_reservations where request_id=r.id and business_id=s.business_id;
 if s.amendment->>'version' is distinct from 'r12.discovery-focused-pilot.1' or s.amendment_hash is distinct from private.stage14_hash(s.amendment)
 or a.status<>'reserved' or a.reason<>'admitted' or a.attempt<>1 or a.step_key not in ('strategy','review')
 or p.version<>1 or p.previous_plan_id is not null or p.content->>'format' is distinct from 'r12.discovery-pilot.1'
 or p.content_hash is distinct from private.r04_hash(p.content) or p.content->>'discoveryScopeId' is distinct from s.id::text
 or p.content->>'discoveryScopeHash' is distinct from s.amendment_hash
 or q.plan is distinct from p.content or q.plan_hash is distinct from p.content_hash or q.mode<>'qualification'
 or q.approval_hash is distinct from s.amendment->>'approvalHash'
 or pol.payload->'maximumDispatches' is distinct from '2'::jsonb or pol.payload->>'policyLimitMicrounits' is distinct from '277907'
 or jsonb_array_length(pol.payload->'operations')<>2
 or pol.payload->'operations'->0->>'operationKey' is distinct from 'research.r12.'||s.id||'.strategy'
 or pol.payload->'operations'->0->>'maximumPerOperationMicrounits' is distinct from '66671'
 or pol.payload->'operations'->1->>'operationKey' is distinct from 'research.r12.'||s.id||'.review'
 or pol.payload->'operations'->1->>'maximumPerOperationMicrounits' is distinct from '211236'
 or not exists(select 1 from private.r12_review_owner_confirmations oc where oc.scope_id=s.id and oc.business_id=s.business_id
 and oc.actor_id=pol.actor_id and oc.policy_id=pol.id and oc.policy_hash=pol.content_hash)
 or not exists(select 1 from private.r05_confirmations fc where fc.policy_id=pol.id and fc.business_id=s.business_id and fc.actor_id=pol.actor_id)
 or not exists(select 1 from private.r05_policy_proofs pp where pp.policy_id=pol.id and pp.policy_hash=pol.content_hash
 and pp.evidence_hash=private.r12_pilot_research_authorization(s.id,s.business_id)->>'authorizationHash')
 or pol.content_hash is distinct from private.r04_hash(pol.payload) or p.policy_id<>pol.id
 or p.content->>'policyId' is distinct from pol.id::text or p.content->>'policyHash' is distinct from pol.content_hash
 or pol.actor_id<>p.owner_id or not exists(select 1 from public.businesses where id=s.business_id and owner_user_id=p.owner_id)
 or not private.r12_authority_owner_current(q)
 or not exists(select 1 from private.r05_revocations where policy_id=pol.id and business_id=s.business_id)
 or not exists(select 1 from private.r07_server_revocations where key_hash=q.controller_key_hash)
 or not exists(select 1 from private.r05_server_revocations where key_hash=q.admission_key_hash)
 or r.currency<>'USD' or r.liability_microunits<>(case when a.step_key='strategy' then 66671 else 211236 end)
 or r.idempotency_key is distinct from 'r07:'||a.id or r.payload->>'idempotencyKey' is distinct from r.idempotency_key
 or r.source_key is distinct from 'r05:'||a.id||':r07:'||a.id
 or r.payload->>'workflowRunId' is distinct from a.id::text or r.payload->'accounting' is distinct from '{"kind":"r05"}'::jsonb
 or r.payload->>'operationKey' is distinct from 'research.r12.'||s.id||'.'||a.step_key
 or r.request_hash is distinct from private.r04_hash(r.payload) or rb.descriptor_hash is distinct from r.request_hash
 or w.binding_hash is distinct from private.stage14_hash(w.binding) or w.producer_key_hash is distinct from q.controller_key_hash
 or w.binding->>'scopeId' is distinct from s.id::text or w.binding->>'scopeHash' is distinct from s.amendment_hash
 or w.binding->>'attemptId' is distinct from a.id::text or w.binding->>'requestId' is distinct from r.id::text
 or w.binding->>'phase' is distinct from a.step_key or w.binding->'dependencyPins' is distinct from a.dependency_pins
 or w.binding->>'requestHash' is distinct from private.stage14_hash((w.binding->>'requestJson')::jsonb)
 or w.binding->>'requestHash' is distinct from r.payload->>'requestHash'
 or w.binding->>'wireHash' is distinct from rb.wire_hash or r.payload->>'wireRequestHash' is distinct from rb.wire_hash
 or encode(extensions.digest(convert_to(w.binding->>'wireBody','UTF8'),'sha256'),'hex') is distinct from rb.wire_hash
 or ((w.binding->>'requestJson')::jsonb)->'requestMetadata'->>'r12FocusedSuccessorAuthorizationHash' is distinct from
 private.r12_pilot_research_authorization(s.id,s.business_id)->>'authorizationHash'
 or (select count(*) from private.r07_plans where goal_id=s.goal_id and business_id=s.business_id)<>1
 or (select count(*) from private.r05_requests where workflow_run_id=a.id)<>1
 or exists(select 1 from private.r07_reused where plan_id=p.id)
 then raise exception 'r12_recovery_exact_unsent_request_required';end if;
 counts:=private.r12_pilot_unsent_absence(r,a);
 return jsonb_build_object('scopeId',s.id,'scopeHash',s.amendment_hash,'businessId',s.business_id,'goalId',s.goal_id,
 'planId',p.id,'planHash',p.content_hash,'policyId',pol.id,'policyHash',pol.content_hash,'profileHash',s.amendment->>'profileHash',
 'budgetAuthorityRootId',s.budget_authority_root_id,'priorRoundId',s.prior_round_id,
 'controllerKeyHash',q.controller_key_hash,'admissionKeyHash',q.admission_key_hash,
 'attemptId',a.id,'requestId',r.id,'requestHash',r.request_hash,'wireBindingHash',w.binding_hash,'wireHash',rb.wire_hash,
 'reservationHash',private.stage14_hash(to_jsonb(reservation)),'absenceHash',private.stage14_hash(counts));
end $$;

create function private.r12_pilot_unsent_closure_context(p_scope_id uuid)
returns jsonb language plpgsql stable set search_path='' as $$
declare s private.r12_discovery_scopes;authz private.r12_pilot_successor_authorizations;
 p private.r07_plans;h private.r07_heads;a private.r07_attempts;r private.r05_requests;
 released private.r05_releases;decision private.r05_decisions;unsent jsonb;context jsonb;begin
 select * into strict s from private.r12_discovery_scopes where id=p_scope_id;
 select * into strict authz from private.r12_pilot_successor_authorizations where scope_id=s.id and business_id=s.business_id;
 if authz.authorization_hash is distinct from private.stage14_hash(authz.authorization_data)
 or authz.budget_authority_root_id<>s.budget_authority_root_id
 or exists(select 1 from private.r12_pilot_unsent_recovery_authorizations where scope_id=s.id)
 then raise exception 'r12_recovery_original_successor_required';end if;
 select * into strict p from private.r07_plans where goal_id=s.goal_id and business_id=s.business_id;
 select * into strict h from private.r07_heads where plan_id=p.id and business_id=s.business_id and goal_id=s.goal_id;
 select * into strict a from private.r07_attempts where plan_id=p.id and step_key='strategy' and attempt=1;
 if h.dispatches<>0 or h.children_created<>1 or h.repairs_used<>0 or h.pivots_used<>0
 or (select count(*) from private.r07_attempts where plan_id=p.id)<>1
 or (select count(*) from private.r07_children where plan_id=p.id)<>1
 or p.content->'maximumDispatches' is distinct from '2'::jsonb or p.content->'maximumChildren' is distinct from '2'::jsonb
 or p.content->'maximumRepairs' is distinct from '0'::jsonb or p.content->'maximumPivots' is distinct from '0'::jsonb
 or jsonb_array_length(p.content->'steps')<>2 or p.content->'steps'->0->>'key' is distinct from 'strategy'
 or p.content->'steps'->1->>'key' is distinct from 'review'
 then raise exception 'r12_recovery_single_unsent_strategy_required';end if;
 unsent:=private.r12_pilot_unsent_request(s.id,a.id);
 select * into strict r from private.r05_requests where id=(unsent->>'requestId')::uuid;
 select * into strict released from private.r05_releases where request_id=r.id and business_id=s.business_id;
 select d.* into strict decision from private.r05_decisions d where d.request_id=r.id and d.business_id=s.business_id and d.decision='allowed' and d.reason='released_unsent';
 if released.created_at<r.created_at or decision.created_at<released.created_at
 or exists(select 1 from private.r05_exposure(s.business_id) ex where ex.source_key=r.source_key)
 or exists(select 1 from private.r12_discovery_exposure(s.budget_authority_root_id) ex where ex.request_id=r.id)
 then raise exception 'r12_recovery_canonical_release_required';end if;
 -- The old setup deadline is history. Its source/profile still receives the
 -- original wall-clock non-current validation, and caller-time validation below.
 perform private.r12_pilot_profile_validate(s,clock_timestamp(),false);
 context:=private.r12_pilot_successor_validate_context(s,authz.authorization_data);
 if authz.predecessor_scope_id::text is distinct from context->'closure'->>'scopeId'
 then raise exception 'r12_recovery_original_successor_binding';end if;
 unsent:=unsent||jsonb_build_object('version','r12.focused-pilot-unsent-closure.1','successorAuthorizationHash',authz.authorization_hash,
 'releaseHash',private.stage14_hash(to_jsonb(released)),'releaseEvidenceHash',released.evidence_hash,'decisionHash',private.stage14_hash(to_jsonb(decision)),
 'dispatches',0,'childrenCreated',1,'repairsUsed',0,'pivotsUsed',0,'authorityClosed',true,'knownMicrousd','0','heldMicrousd','0');
 return context||jsonb_build_object('unsentClosure',unsent);
end $$;
create function private.r12_pilot_unsent_closure(p_scope_id uuid)
returns jsonb language plpgsql stable set search_path='' as $$
begin return private.r12_pilot_unsent_closure_context(p_scope_id)->'unsentClosure';end $$;

-- Copy the released complete successor authorization validator with guarded
-- edits. The original function, original proof bytes and original slots remain
-- untouched. Only the recovery branch uses the abandoned plan as closedPlan.
do $patch$ declare d text;old text;replacement text;begin
 d:=pg_get_functiondef('private.r12_pilot_successor_validate_context(private.r12_discovery_scopes,jsonb)'::regprocedure);
 old:='FUNCTION private.r12_pilot_successor_validate_context(';
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_recovery_validate_name_drift';end if;
 d:=replace(d,old,'FUNCTION private.r12_pilot_unsent_recovery_validate_context(');
 old:='''ownerApprovalEvidenceHash'',''predecessorClosure'',''limits''';
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_recovery_validate_keys_drift';end if;
 d:=replace(d,old,'''ownerApprovalEvidenceHash'',''predecessorClosure'',''unsentClosure'',''limits''');
 old:='r12.focused-pilot-successor-authorization.1';
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_recovery_validate_version_drift';end if;
 d:=replace(d,old,'r12.focused-pilot-unsent-recovery-authorization.1');
 old:='"maximumSuccessors":1,"maximumPaidCalls":2';
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_recovery_validate_limits_drift';end if;
 d:=replace(d,old,'"maximumSuccessors":1,"maximumRecoveries":1,"maximumPaidCalls":2');
 old:=' context:=private.r12_pilot_successor_closure_context((v->''predecessorClosure''->>''scopeId'')::uuid);closed:=context->''closure'';';
 replacement:=$r$ context:=private.r12_pilot_unsent_closure_context((v->'unsentClosure'->>'scopeId')::uuid);closed:=context->'closure';
 if v->'unsentClosure' is distinct from context->'unsentClosure'
 or context->'unsentClosure'->>'businessId' is distinct from s.business_id::text
 or context->'unsentClosure'->>'budgetAuthorityRootId' is distinct from s.budget_authority_root_id::text
 or context->'unsentClosure'->>'priorRoundId' is distinct from s.prior_round_id::text
 or s.id::text in(context->'unsentClosure'->>'scopeId',context->'unsentClosure'->>'goalId')
 or s.goal_id::text in(context->'unsentClosure'->>'goalId',closed->>'goalId',closed->>'originalGoalId')
 or context->'unsentClosure'->>'scopeId'=closed->>'scopeId'
 or context->'unsentClosure'->>'planId'=closed->>'planId'
 then raise exception 'r12_recovery_exact_unsent_closure_required';end if;$r$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_recovery_validate_closure_drift';end if;d:=replace(d,old,replacement);
 old:='closed->>''planId'' is distinct from e->>''closedPlanId'' or closed->>''planHash'' is distinct from e->>''closedPlanHash''';
 replacement:='context->''unsentClosure''->>''planId'' is distinct from e->>''closedPlanId'' or context->''unsentClosure''->>''planHash'' is distinct from e->>''closedPlanHash''';
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_recovery_validate_plan_drift';end if;d:=replace(d,old,replacement);
 old:='select * into strict old_scope from private.r12_discovery_scopes where id=(closed->>''scopeId'')::uuid;';
 replacement:='select * into strict old_scope from private.r12_discovery_scopes where id=(context->''unsentClosure''->>''scopeId'')::uuid;';
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_recovery_validate_learning_drift';end if;d:=replace(d,old,replacement);
 execute d;
end $patch$;
create function private.r12_pilot_unsent_recovery_validate(s private.r12_discovery_scopes,v jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
begin return private.r12_pilot_unsent_recovery_validate_context(s,v)->'unsentClosure';end $$;

create function private.r12_pilot_unsent_recovery_source(s private.r12_discovery_scopes,effective_at timestamptz,p_current boolean)
returns jsonb language plpgsql stable set search_path='' as $$
declare a private.r12_pilot_unsent_recovery_authorizations;context jsonb;old_scope private.r12_discovery_scopes;charged_scope private.r12_discovery_scopes;begin
 select * into strict a from private.r12_pilot_unsent_recovery_authorizations where scope_id=s.id and business_id=s.business_id;
 if a.authorization_hash is distinct from private.stage14_hash(a.authorization_data) then raise exception 'r12_recovery_authorization_mutated';end if;
 perform private.r12_pilot_profile_validate(s,effective_at,p_current);
 context:=private.r12_pilot_unsent_recovery_validate_context(s,a.authorization_data);
 if a.abandoned_scope_id::text is distinct from context->'unsentClosure'->>'scopeId'
 or a.budget_authority_root_id<>s.budget_authority_root_id then raise exception 'r12_recovery_row_binding';end if;
 select * into strict old_scope from private.r12_discovery_scopes where id=a.abandoned_scope_id;
 select * into strict charged_scope from private.r12_discovery_scopes where id=(context->'closure'->>'scopeId')::uuid;
 perform private.r12_pilot_profile_validate(old_scope,effective_at,false);
 perform private.r12_pilot_profile_validate(charged_scope,effective_at,false);
 if exists(select 1 from private.r04_research_links where business_id=s.business_id and goal_id=s.goal_id) then raise exception 'r12_pilot_no_research_relink';end if;
 return context->'source'||jsonb_build_object('closedPlanId',s.amendment->>'closedPlanId','closedPlanHash',s.amendment->>'closedPlanHash',
 'successor',jsonb_build_object('authorization',a.authorization_data,'authorizationHash',a.authorization_hash));
end $$;

do $patch$ declare d text;old text;replacement text;begin
 d:=pg_get_functiondef('private.r12_pilot_source(private.r12_discovery_scopes,timestamp with time zone,boolean)'::regprocedure);
 old:=' if exists(select 1 from private.r12_pilot_successor_authorizations where scope_id=s.id) then return private.r12_pilot_successor_source(s,effective_at,p_current);end if;';
 replacement:=' if exists(select 1 from private.r12_pilot_unsent_recovery_authorizations where scope_id=s.id) then return private.r12_pilot_unsent_recovery_source(s,effective_at,p_current);end if;'||chr(10)||old;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_recovery_source_definition_drift';end if;execute replace(d,old,replacement);
end $patch$;

-- Apply exactly the existing successor negative-stop, proof-binding and private
-- observation controls to the discriminated recovery pair. No gate is removed.
do $patch$ declare signature text;expected integer;arguments text;d text;old text:='private.r12_pilot_successor_authorizations';begin
 for signature,expected,arguments in select * from (values
 ('private.r07_gate(private.r07_plans,jsonb)',1,'(p.content->>''discoveryScopeId'')::uuid,p.business_id'),
 ('private.r12_review_owner_proposal_validate(private.r12_review_owner_proposals,boolean)',2,'s.id,s.business_id'),
 ('private.r12_discovery_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb)',2,'s.id,s.business_id'),
 ('public.r12_discovery_server(uuid,uuid,text,jsonb,text)',1,'w.scope_id,p_business_id'),
 ('public.r12_discovery_owner_read(uuid,uuid,boolean)',1,'source_scope.id,p_business_id'),
 ('public.r12_review_owner_read(uuid,uuid)',1,'s.id,p_business_id')) refs(signature,expected,arguments) loop
 d:=pg_get_functiondef(signature::regprocedure);
 if (length(d)-length(replace(d,old,'')))/length(old)<>expected then raise exception 'r12_recovery_runtime_definition_drift: %',signature;end if;
 execute replace(d,old,'private.r12_pilot_research_authorizations('||arguments||')');
 end loop;
end $patch$;

-- Only an eligible original successor gets this owner-only, bounded closure.
-- This read creates no authority. Missing/invalid history suppresses eligibility;
-- stage reconstructs the full proof again under the Business/root locks.
create function private.r12_pilot_unsent_owner_eligibility(p_scope_id uuid,p_business_id uuid)
returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb;begin
 if not exists(select 1 from private.r12_pilot_successor_authorizations where scope_id=p_scope_id and business_id=p_business_id)
 or exists(select 1 from private.r12_pilot_unsent_recovery_authorizations recovery join private.r12_discovery_scopes s
 on s.budget_authority_root_id=recovery.budget_authority_root_id where s.id=p_scope_id and s.business_id=p_business_id)
 then return null;end if;
 result:=private.r12_pilot_unsent_closure(p_scope_id);
 if exists(select 1 from private.r12_discovery_exposure((result->>'budgetAuthorityRootId')::uuid) where is_pending)
 or exists(select 1 from private.r05_exposure(p_business_id) where unknown) then return null;end if;
 return result;
 exception when others then return null;
end $$;
do $patch$ declare d text;old text;replacement text;begin
 d:=pg_get_functiondef('public.r12_discovery_owner_read(uuid,uuid,boolean)'::regprocedure);
 old:='from private.r12_pilot_research_authorizations(source_scope.id,p_business_id) a where a.scope_id=source_scope.id and a.business_id=p_business_id),''{}''::jsonb);';
 replacement:=$r$from private.r12_pilot_research_authorizations(source_scope.id,p_business_id) a where a.scope_id=source_scope.id and a.business_id=p_business_id),'{}'::jsonb)
 ||coalesce((select jsonb_build_object('focusedUnsentClosure',closure) from
 (select private.r12_pilot_unsent_owner_eligibility(source_scope.id,p_business_id) closure) checked where closure is not null),'{}'::jsonb);$r$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_recovery_owner_eligibility_drift';end if;execute replace(d,old,replacement);
end $patch$;

-- Called only by the reviewed recovery CLOSE recipe, after the genuine owner
-- has revoked the policy and the exact two finite verifiers have been revoked.
-- This narrowly reconciles unsent holds; it never reopens authority or changes
-- Core statuses. Dispatched unknown work remains held for real reconciliation.
create function private.r12_pilot_unsent_recovery_release(p_business_id uuid,p_scope_id uuid)
returns jsonb language plpgsql set search_path='' as $$
declare s private.r12_discovery_scopes;q private.r12_discovery_authorities;authz private.r12_pilot_unsent_recovery_authorizations;
 a private.r07_attempts;r private.r05_requests;proof jsonb;decision jsonb;budget_before jsonb;budget_after jsonb;
 exposure_before bigint;exposure_after bigint;released_amount bigint:=0;released_count integer:=0;existing_count integer:=0;begin
 if current_user in ('anon','authenticated','service_role') then raise exception 'r12_recovery_operator_required';end if;
 select * into strict s from private.r12_discovery_scopes where id=p_scope_id and business_id=p_business_id;
 select * into strict authz from private.r12_pilot_unsent_recovery_authorizations where scope_id=s.id and business_id=s.business_id;
 if authz.authorization_hash is distinct from private.stage14_hash(authz.authorization_data)
 or authz.budget_authority_root_id<>s.budget_authority_root_id then raise exception 'r12_recovery_cleanup_authorization_changed';end if;
 perform 1 from public.businesses where id=s.business_id and owner_user_id=(authz.authorization_data->>'ownerId')::uuid for update;
 if not found then raise exception 'r12_recovery_cleanup_owner_changed';end if;
 perform 1 from public.product_experiments where id=s.budget_authority_root_id and business_id=s.business_id for update;
 if not found then raise exception 'r12_recovery_cleanup_root_changed';end if;
 select * into q from private.r12_discovery_authorities where scope_id=s.id and business_id=s.business_id and goal_id=s.goal_id;
 if q.scope_id is null then
 if exists(select 1 from private.r07_plans where business_id=s.business_id and goal_id=s.goal_id)
 or exists(select 1 from private.r05_requests r join private.r05_policies p on p.id=r.policy_id where p.business_id=s.business_id and p.goal_id=s.goal_id)
 then raise exception 'r12_recovery_cleanup_authority_missing';end if;
 return jsonb_build_object('releasedRequests',0,'releasedMicrousd','0','authorityCreated',false,'providerCalls',0);
 end if;
 perform 1 from private.r07_server_keys where key_hash=q.controller_key_hash for update;
 perform 1 from private.r05_server_keys where key_hash=q.admission_key_hash for update;
 if not private.r12_authority_owner_current(q)
 or q.plan->>'discoveryScopeId' is distinct from s.id::text or q.plan->>'discoveryScopeHash' is distinct from s.amendment_hash
 or q.plan_hash is distinct from private.r04_hash(q.plan)
 or not exists(select 1 from private.r05_revocations where business_id=s.business_id and policy_id=(q.plan->>'policyId')::uuid)
 or not exists(select 1 from private.r07_server_revocations where key_hash=q.controller_key_hash)
 or not exists(select 1 from private.r05_server_revocations where key_hash=q.admission_key_hash)
 then raise exception 'r12_recovery_cleanup_all_revocations_required';end if;
 perform 1 from private.r07_heads where business_id=s.business_id and goal_id=s.goal_id for update;
 budget_before:=private.stage13v2_budget_authority(s.prior_round_id,false);
 select coalesce(sum(held),0) into exposure_before from private.r05_exposure(s.business_id) where currency='USD';
 for a in select att.* from private.r07_attempts att join private.r07_plans p on p.id=att.plan_id
 where p.business_id=s.business_id and p.goal_id=s.goal_id and p.content=q.plan and att.status='reserved' order by att.id for update of att loop
 select req.* into strict r from private.r05_requests req join private.r07_bindings rb on rb.request_id=req.id
 where rb.attempt_id=a.id and rb.business_id=s.business_id for update of req;
 proof:=private.r12_pilot_unsent_request(s.id,a.id);
 proof:=jsonb_build_object('version','r12.unsent-recovery-release.1','authorizationHash',authz.authorization_hash,'request',proof);
 if exists(select 1 from private.r05_releases where request_id=r.id) then
 if not exists(select 1 from private.r05_releases where request_id=r.id and business_id=s.business_id and evidence_hash=private.stage14_hash(proof))
 or (select count(*) from private.r05_decisions d where d.request_id=r.id and d.business_id=s.business_id and d.decision='allowed' and d.reason='released_unsent')<>1
 or exists(select 1 from private.r05_exposure(s.business_id) ex where ex.source_key=r.source_key)
 or exists(select 1 from private.r12_discovery_exposure(s.budget_authority_root_id) ex where ex.request_id=r.id)
 then raise exception 'r12_recovery_cleanup_existing_release_invalid';end if;
 existing_count:=existing_count+1;
 else
 insert into private.r05_releases(request_id,business_id,evidence_hash) values(r.id,s.business_id,private.stage14_hash(proof));
 decision:=private.r05_result(s.business_id,r.id,'allowed','released_unsent',false);
 if decision is distinct from jsonb_build_object('decision','allowed','reason','released_unsent','requestId',r.id,'shouldDispatch',false)
 or exists(select 1 from private.r05_exposure(s.business_id) ex where ex.source_key=r.source_key)
 or exists(select 1 from private.r12_discovery_exposure(s.budget_authority_root_id) ex where ex.request_id=r.id)
 then raise exception 'r12_recovery_cleanup_release_readback_failed';end if;
 released_amount:=released_amount+r.liability_microunits;released_count:=released_count+1;
 end if;
 end loop;
 budget_after:=private.stage13v2_budget_authority(s.prior_round_id,false);
 select coalesce(sum(held),0) into exposure_after from private.r05_exposure(s.business_id) where currency='USD';
 if budget_after->'knownActualMicrousd' is distinct from budget_before->'knownActualMicrousd'
 or (budget_after->>'pendingExposureMicrousd')::bigint<>(budget_before->>'pendingExposureMicrousd')::bigint-released_amount
 or exposure_after<>exposure_before-released_amount or released_count+existing_count>2
 then raise exception 'r12_recovery_cleanup_financial_readback_failed';end if;
 return jsonb_build_object('releasedRequests',released_count,'alreadyReleasedRequests',existing_count,'releasedMicrousd',released_amount::text,
 'rootKnownMicrousd',budget_after->'knownActualMicrousd','rootPendingMicrousd',budget_after->'pendingExposureMicrousd',
 'rootUnknown',budget_after->'hasUncertainCosts','authorityClosed',true,'providerCalls',0,'historyRewritten',false);
end $$;

revoke all on function private.r12_pilot_research_authorizations(uuid,uuid),private.r12_pilot_research_authorization(uuid,uuid),
 private.r12_pilot_unsent_absence(private.r05_requests,private.r07_attempts),private.r12_pilot_unsent_request(uuid,uuid),
 private.r12_pilot_unsent_closure_context(uuid),private.r12_pilot_unsent_closure(uuid),
 private.r12_pilot_unsent_recovery_validate_context(private.r12_discovery_scopes,jsonb),
 private.r12_pilot_unsent_recovery_validate(private.r12_discovery_scopes,jsonb),
 private.r12_pilot_unsent_recovery_source(private.r12_discovery_scopes,timestamp with time zone,boolean),
 private.r12_pilot_unsent_owner_eligibility(uuid,uuid),private.r12_pilot_unsent_recovery_release(uuid,uuid)
 from public,anon,authenticated,service_role;
commit;
