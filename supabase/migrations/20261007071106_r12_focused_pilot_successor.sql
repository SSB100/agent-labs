-- One separately owner-approved research successor, never a reset or generic retry.
-- Definition only. No live scopes, Goals, policies, keys, operations or calls.
begin;
create table private.r12_pilot_successor_authorizations(
 scope_id uuid primary key references private.r12_discovery_scopes(id) deferrable initially deferred,
 business_id uuid not null references public.businesses(id),
 predecessor_scope_id uuid not null unique references private.r12_discovery_scopes(id),
 budget_authority_root_id uuid not null unique references public.product_experiments(id),
 authorization_data jsonb not null,authorization_hash text not null,
 created_at timestamptz not null default clock_timestamp(),
 check(jsonb_typeof(authorization_data)='object' and octet_length(authorization_data::text)<=16384
 and authorization_hash=private.stage14_hash(authorization_data))
);
alter table private.r12_pilot_successor_authorizations enable row level security;
revoke all on private.r12_pilot_successor_authorizations from public,anon,authenticated,service_role;
create trigger r12_pilot_successor_immutable before insert or update or delete
 on private.r12_pilot_successor_authorizations for each row execute function private.r12_discovery_history_guard();

-- Canonical closure uses immutable same-response receipts, not live receipt status:
-- revoked/expired history deliberately reports stopped/expired before verified.
create function private.r12_pilot_successor_closure(p_scope_id uuid) returns jsonb
language plpgsql stable set search_path='' as $$
declare s private.r12_discovery_scopes;p private.r07_plans;h private.r07_heads;q private.r12_discovery_authorities;
 pol private.r05_policies;a private.r07_attempts;r private.r05_requests;rb private.r07_bindings;
 w private.r12_discovery_wires;c private.r12_discovery_candidates;z private.r05_settlements;
 resp private.r07_responses;received private.r12_discovery_response_observations;rejected private.r12_discovery_response_observations;
 proof jsonb;phase text;phases jsonb:='[]';total bigint:=0;source jsonb;
begin
 select * into s from private.r12_discovery_scopes where id=p_scope_id;
 if s.id is null or s.amendment->>'version' is distinct from 'r12.discovery-focused-pilot.1'
 or s.amendment_hash is distinct from private.stage14_hash(s.amendment)
 or exists(select 1 from private.r12_pilot_successor_authorizations where scope_id=s.id)
 then raise exception 'r12_successor_first_focused_predecessor_required';end if;
 select * into p from private.r07_plans where business_id=s.business_id and goal_id=s.goal_id and content->>'discoveryScopeId'=s.id::text;
 select * into h from private.r07_heads where business_id=s.business_id and goal_id=s.goal_id;
 select * into q from private.r12_discovery_authorities where scope_id=s.id and business_id=s.business_id and goal_id=s.goal_id;
 select * into pol from private.r05_policies where id=p.policy_id and business_id=s.business_id and goal_id=s.goal_id;
 if p.id is null or p.version<>1 or p.previous_plan_id is not null or p.content->>'format' is distinct from 'r12.discovery-pilot.1'
 or p.content_hash is distinct from private.r04_hash(p.content) or p.content->>'discoveryScopeHash' is distinct from s.amendment_hash
 or p.content->'maximumDispatches' is distinct from '2'::jsonb or p.content->'maximumChildren' is distinct from '2'::jsonb
 or p.content->'maximumRepairs' is distinct from '0'::jsonb or p.content->'maximumPivots' is distinct from '0'::jsonb
 or jsonb_array_length(p.content->'steps')<>2 or p.content->'steps'->0->>'key' is distinct from 'strategy' or p.content->'steps'->1->>'key' is distinct from 'review'
 or h.plan_id is distinct from p.id or h.dispatches<>2 or h.children_created<>2 or h.repairs_used<>0 or h.pivots_used<>0
 or (select count(*) from private.r07_plans where business_id=s.business_id and goal_id=s.goal_id)<>1
 or (select count(*) from private.r07_attempts where plan_id=p.id)<>2
 or exists(select 1 from private.r07_reused where plan_id=p.id)
 or q.scope_id is null or q.plan is distinct from p.content or q.plan_hash is distinct from p.content_hash
 or pol.id is null or pol.content_hash is distinct from private.r04_hash(pol.payload) or pol.content_hash is distinct from p.content->>'policyHash'
 or pol.actor_id<>p.owner_id or pol.payload->'maximumDispatches' is distinct from '2'::jsonb
 or not exists(select 1 from public.businesses where id=s.business_id and owner_user_id=p.owner_id)
 or not exists(select 1 from private.r05_revocations where business_id=s.business_id and policy_id=pol.id)
 or not exists(select 1 from private.r07_server_revocations where key_hash=q.controller_key_hash)
 or not exists(select 1 from private.r05_server_revocations where key_hash=q.admission_key_hash)
 then raise exception 'r12_successor_predecessor_not_closed';end if;
 -- This is the original branch; no recursion is possible because the sidecar
 -- absence above and its unique root successor slot are both mandatory.
 source:=private.r12_pilot_source(s,clock_timestamp(),false);
 foreach phase in array array['strategy','review'] loop
 select * into a from private.r07_attempts where plan_id=p.id and business_id=s.business_id and goal_id=s.goal_id and step_key=phase and attempt=1;
 select * into rb from private.r07_bindings where attempt_id=a.id and business_id=s.business_id;
 select * into r from private.r05_requests where id=rb.request_id and business_id=s.business_id and workflow_run_id=a.id and policy_id=pol.id;
 select * into w from private.r12_discovery_wires where request_id=r.id and business_id=s.business_id and attempt_id=a.id and scope_id=s.id;
 select * into c from private.r12_discovery_candidates where request_id=r.id;
 select * into resp from private.r07_responses where attempt_id=a.id and business_id=s.business_id;
 select * into received from private.r12_discovery_response_observations where request_id=r.id and kind='received';
 select * into rejected from private.r12_discovery_response_observations where request_id=r.id and kind='rejected';
 if a.id is null or rb.attempt_id is null or r.id is null or w.request_id is null or c.request_id is null
 or (select count(*) from private.r05_requests where workflow_run_id=a.id and business_id=s.business_id)<>1
 or r.request_hash is distinct from private.r04_hash(r.payload) or rb.descriptor_hash is distinct from r.request_hash
 or r.payload->>'operationKey' is distinct from 'research.r12.'||s.id||'.'||phase
 or r.payload->>'workflowRunId' is distinct from a.id::text or r.currency<>'USD' or r.payload->'accounting' is distinct from '{"kind":"r05"}'::jsonb
 or r.payload->>'idempotencyKey' is distinct from 'r07:'||a.id
 or not exists(select 1 from private.r05_reservations where request_id=r.id and business_id=s.business_id)
 or not exists(select 1 from private.r05_markers where request_id=r.id and business_id=s.business_id)
 or not exists(select 1 from private.r07_markers where attempt_id=a.id and business_id=s.business_id)
 or not exists(select 1 from private.r12_discovery_transport_claims where request_id=r.id)
 or exists(select 1 from private.r05_releases where request_id=r.id)
 or w.binding_hash is distinct from private.stage14_hash(w.binding) or w.producer_key_hash is distinct from q.controller_key_hash
 or w.binding->>'scopeId' is distinct from s.id::text or w.binding->>'scopeHash' is distinct from s.amendment_hash
 or w.binding->>'attemptId' is distinct from a.id::text or w.binding->>'requestId' is distinct from r.id::text
 or w.binding->>'phase' is distinct from phase or w.binding->'dependencyPins' is distinct from a.dependency_pins
 or w.binding->>'requestHash' is distinct from private.stage14_hash((w.binding->>'requestJson')::jsonb)
 or w.binding->>'requestHash' is distinct from r.payload->>'requestHash'
 or w.binding->>'wireHash' is distinct from rb.wire_hash or r.payload->>'wireRequestHash' is distinct from rb.wire_hash
 or rb.wire_hash is distinct from encode(extensions.digest(convert_to(w.binding->>'wireBody','UTF8'),'sha256'),'hex')
 or c.candidate_hash is distinct from private.stage14_hash(c.candidate)
 or c.candidate->>'scopeId' is distinct from s.id::text or c.candidate->>'attemptId' is distinct from a.id::text
 or c.candidate->>'requestId' is distinct from r.id::text or c.candidate->>'phase' is distinct from phase
 or c.candidate->>'requestHash' is distinct from w.binding->>'requestHash'
 then raise exception 'r12_successor_predecessor_dispatch_unverified';end if;
 select ro.proof into proof from private.r12_discovery_receipt_checks rc join private.r12_discovery_receipt_observations ro on ro.check_id=rc.id where rc.request_id=r.id and ro.proof is not null;
 if proof is null or (select count(*) from private.r12_discovery_receipt_checks rc join private.r12_discovery_receipt_observations ro on ro.check_id=rc.id where rc.request_id=r.id and ro.proof is not null)<>1 then raise exception 'r12_successor_predecessor_receipt_required';end if;
 perform private.r12_discovery_proof_validate(c,proof);
 select * into z from private.r05_settlements where request_id=r.id and business_id=s.business_id order by receipt_hash limit 1;
 if z.id is null or z.actual_microunits is null or z.currency<>'USD'
 or exists(select 1 from private.r05_settlements other where other.request_id=r.id and other.business_id=s.business_id and (other.currency is distinct from 'USD' or other.actual_microunits is distinct from z.actual_microunits or other.provider_request_id is distinct from z.provider_request_id))
 or z.actual_microunits>r.liability_microunits or c.candidate->'reportedMicrousd' is distinct from to_jsonb(z.actual_microunits) or z.provider_request_id is distinct from c.candidate->>'providerRequestId'
 or not exists(select 1 from private.r05_receipt_claims cl where cl.provider='openrouter' and cl.provider_request_id=z.provider_request_id and cl.business_id=s.business_id and cl.workflow_run_id=a.id and cl.source_key=r.source_key)
 or not exists(select 1 from private.r12_discovery_exposure(s.budget_authority_root_id) ex where ex.request_id=r.id and ex.actual=z.actual_microunits and ex.held=z.actual_microunits and not ex.is_pending)
 then raise exception 'r12_successor_predecessor_settlement_required';end if;
 if phase='strategy' then
 if a.status<>'completed' or resp.attempt_id is null or resp.content->>'outcome' is distinct from 'accepted' or resp.content->'result'->>'outcome' is distinct from 'TEST' or resp.artifact_id is null or rejected.request_id is not null then raise exception 'r12_successor_prior_strategy_required';end if;
 perform private.r12_discovery_completed_phase(a,p);
 else
 if a.status='completed' or resp.attempt_id is not null or received.request_id is null or rejected.request_id is null
 or received.payload_hash is distinct from private.stage14_hash(received.payload) or rejected.payload_hash is distinct from private.stage14_hash(rejected.payload)
 or rejected.payload->>'code' is distinct from 'domain_validation' or rejected.payload->'observationSaved' is distinct from 'true'::jsonb
 or rejected.payload->>'scopeId' is distinct from s.id::text or rejected.payload->>'attemptId' is distinct from a.id::text or rejected.payload->>'requestId' is distinct from r.id::text
 or received.payload->>'scopeId' is distinct from s.id::text or received.payload->>'attemptId' is distinct from a.id::text or received.payload->>'requestId' is distinct from r.id::text
 or received.payload->>'providerRequestId' is distinct from c.candidate->>'providerRequestId'
 or received.payload->>'providerModelId' is distinct from c.candidate->>'providerModelId'
 or received.payload->>'finishReason' is distinct from 'stop' or received.payload->>'contentState' is distinct from 'complete'
 or (received.payload->>'content')::jsonb is distinct from c.candidate->'output'
 or received.payload->>'contentHash' is distinct from encode(extensions.digest(convert_to(received.payload->>'content','UTF8'),'sha256'),'hex')
 or exists(select 1 from public.artifacts where workflow_run_id=a.id and business_id=s.business_id and artifact_type='r12.discovery.review')
 then raise exception 'r12_successor_prior_rejected_review_required';end if;
 end if;
 total:=total+z.actual_microunits;
 phases:=phases||jsonb_build_array(jsonb_build_object('phase',phase,'attemptId',a.id,'requestId',r.id,'wireBindingHash',w.binding_hash,'candidateHash',c.candidate_hash,'routeProofHash',proof->>'proofHash','settlementHash',(select private.stage14_hash(jsonb_agg(jsonb_build_object('receiptHash',zs.receipt_hash,'actualMicrounits',zs.actual_microunits::text,'providerRequestId',zs.provider_request_id,'currency',zs.currency) order by zs.receipt_hash)) from private.r05_settlements zs where zs.request_id=r.id and zs.business_id=s.business_id),'actualMicrousd',z.actual_microunits::text,'acceptedResponseHash',resp.content_hash,'artifactId',resp.artifact_id,'receivedObservationHash',received.payload_hash,'rejectedDiagnosticHash',rejected.payload_hash));
 end loop;
 if exists(select 1 from private.r12_discovery_exposure(s.budget_authority_root_id) ex join private.r05_requests req on req.id=ex.request_id join private.r07_attempts att on att.id=req.workflow_run_id where att.plan_id=p.id and ex.is_pending) then raise exception 'r12_successor_prior_funding_unsettled';end if;
 return jsonb_build_object('version','r12.focused-pilot-closure.1','businessId',s.business_id,'scopeId',s.id,'scopeHash',s.amendment_hash,'goalId',s.goal_id,'planId',p.id,'planHash',p.content_hash,'policyId',pol.id,'policyHash',pol.content_hash,'profileHash',s.amendment->>'profileHash','budgetAuthorityRootId',s.budget_authority_root_id,'priorRoundId',s.prior_round_id,'originalGoalId',s.amendment->>'originalGoalId','originalClosedPlanId',s.amendment->>'closedPlanId','originalClosedPlanHash',s.amendment->>'closedPlanHash','acceptedReviewScopeId',s.amendment->>'acceptedReviewScopeId','acceptedReviewHash',s.amendment->>'acceptedReviewHash','controllerKeyHash',q.controller_key_hash,'admissionKeyHash',q.admission_key_hash,'dispatches',2,'childrenCreated',2,'repairsUsed',0,'pivotsUsed',0,'authorityClosed',true,'knownMicrousd',total::text,'phases',phases);
end $$;

create function private.r12_pilot_successor_validate(s private.r12_discovery_scopes,v jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare closed jsonb;old_scope private.r12_discovery_scopes;g private.r04_goal_versions;k text;e jsonb:=s.amendment;begin
 perform private.r12_pilot_safe(v);
 perform private.r04_keys(v,array['version','businessId','ownerId','scopeId','scopeHash','goalId','preparedGoalRevision','preparedGoalHash','profileHash','ownerApprovalEvidenceHash','predecessorClosure','limits','createdAt','expiresAt']);
 if v->>'version' is distinct from 'r12.focused-pilot-successor-authorization.1' or octet_length(v::text)>16384
 or v->>'businessId' is distinct from s.business_id::text or v->>'scopeId' is distinct from s.id::text or v->>'goalId' is distinct from s.goal_id::text
 or v->>'scopeHash' is distinct from s.amendment_hash or s.amendment_hash is distinct from private.stage14_hash(e)
 or v->>'profileHash' is distinct from e->>'profileHash' or e->>'profileHash' is distinct from private.stage14_hash(e->'profile')
 or v->>'ownerApprovalEvidenceHash' is distinct from e->>'approvalHash' or v->>'ownerApprovalEvidenceHash' is distinct from e->'profile'->'observations'->>'approvalHash'
 or v->'createdAt' is distinct from e->'createdAt' or v->'expiresAt' is distinct from e->'expiresAt'
 or v->'preparedGoalRevision' is distinct from '2'::jsonb
 or v->'limits' is distinct from '{"maximumSuccessors":1,"maximumPaidCalls":2,"maximumReceiptGets":6,"maximumReceiptGetsPerCall":3,"dispatchWindowSeconds":1800,"receiptGraceSeconds":1800,"maximumMicrousd":277907,"maximumStrategyMicrousd":66671,"maximumReviewMicrousd":211236,"stopOnAnyNegative":true,"researchOnly":true,"paidRetryAllowed":false,"searchAllowed":false,"imageAllowed":false,"storeActionsAllowed":false}'::jsonb
 then raise exception 'r12_successor_exact_authorization_required';end if;
 foreach k in array array['scopeHash','profileHash','preparedGoalHash','ownerApprovalEvidenceHash'] loop
 if jsonb_typeof(v->k) is distinct from 'string' or v->>k !~ '^[a-f0-9]{64}$' then raise exception 'r12_successor_authorization_hash';end if;end loop;
 select * into g from private.r04_goal_versions where business_id=s.business_id and goal_id=s.goal_id and revision=2;
 if g.goal_id is null or g.content_hash is distinct from v->>'preparedGoalHash' or g.preference<>'ready' or g.actor_id::text is distinct from v->>'ownerId'
 or not exists(select 1 from public.businesses where id=s.business_id and owner_user_id=g.actor_id) then raise exception 'r12_successor_prepared_owner_goal_required';end if;
 closed:=private.r12_pilot_successor_closure((v->'predecessorClosure'->>'scopeId')::uuid);
 if v->'predecessorClosure' is distinct from closed or closed->>'businessId' is distinct from s.business_id::text
 or closed->>'planId' is distinct from e->>'closedPlanId' or closed->>'planHash' is distinct from e->>'closedPlanHash'
 or closed->>'originalGoalId' is distinct from e->>'originalGoalId' or closed->>'budgetAuthorityRootId' is distinct from s.budget_authority_root_id::text
 or closed->>'priorRoundId' is distinct from s.prior_round_id::text or closed->>'acceptedReviewScopeId' is distinct from e->>'acceptedReviewScopeId'
 or closed->>'acceptedReviewHash' is distinct from e->>'acceptedReviewHash' or s.goal_id::text in(closed->>'goalId',closed->>'originalGoalId')
 or s.id::text in(closed->>'scopeId',closed->>'acceptedReviewScopeId',closed->>'budgetAuthorityRootId',closed->>'priorRoundId')
 then raise exception 'r12_successor_closed_lineage_changed';end if;
 select * into strict old_scope from private.r12_discovery_scopes where id=(closed->>'scopeId')::uuid;
 foreach k in array array['originalGoalId','budgetAuthorityRootId','priorRoundId','originalIntentHash','originalSemanticGoalHash','acceptedReviewScopeId','acceptedReviewHash','acceptedReviewRecordHash','allowedDomains','excludedDomains','approvedQuery'] loop
 if e->k is distinct from old_scope.amendment->k then raise exception 'r12_successor_original_scope_changed';end if;end loop;
 foreach k in array array['candidate','learningQuestion','originalDesignConstraints','researchAllocationMicrousd'] loop
 if e->'profile'->k is distinct from old_scope.amendment->'profile'->k then raise exception 'r12_successor_learning_scope_changed';end if;end loop;
 if ((e->'profile'->'intent')-array['id','expiresAt']) is distinct from ((old_scope.amendment->'profile'->'intent')-array['id','expiresAt'])
 or ((e->'profile'->'history')-'scopeChangeExplanation') is distinct from ((old_scope.amendment->'profile'->'history')-'scopeChangeExplanation')
 or e->'profile'->'observations'->'observations' is distinct from old_scope.amendment->'profile'->'observations'->'observations'
 or e->'profile'->'observations'->'sellerBankCountry' is distinct from old_scope.amendment->'profile'->'observations'->'sellerBankCountry'
 or ((e->'profile'->'pinnedLearningPlan')-'evidenceRefs') is distinct from ((old_scope.amendment->'profile'->'pinnedLearningPlan')-'evidenceRefs')
 or (select jsonb_agg(ref-'artifactId' order by n) from jsonb_array_elements((e->'profile'->'pinnedLearningPlan')->'evidenceRefs') with ordinality r(ref,n)) is distinct from (select jsonb_agg(ref-'artifactId' order by n) from jsonb_array_elements((old_scope.amendment->'profile'->'pinnedLearningPlan')->'evidenceRefs') with ordinality r(ref,n))
 or e->'profile'->'researchAllocationMicrousd' is distinct from '277907'::jsonb
 then raise exception 'r12_successor_evidence_or_learning_plan_changed';end if;
 return closed;
end $$;

create function private.r12_pilot_successor_source(s private.r12_discovery_scopes,effective_at timestamptz,p_current boolean)
returns jsonb language plpgsql stable set search_path='' as $$
declare a private.r12_pilot_successor_authorizations;closed jsonb;old_scope private.r12_discovery_scopes;source jsonb;begin
 select * into strict a from private.r12_pilot_successor_authorizations where scope_id=s.id and business_id=s.business_id;
 if a.authorization_hash is distinct from private.stage14_hash(a.authorization_data) then raise exception 'r12_successor_authorization_mutated';end if;
 perform private.r12_pilot_profile_validate(s,effective_at,p_current);
 closed:=private.r12_pilot_successor_validate(s,a.authorization_data);
 if a.predecessor_scope_id::text is distinct from closed->>'scopeId' or a.budget_authority_root_id<>s.budget_authority_root_id then raise exception 'r12_successor_row_binding';end if;
 select * into strict old_scope from private.r12_discovery_scopes where id=a.predecessor_scope_id;
 source:=private.r12_pilot_source(old_scope,effective_at,false);
 if exists(select 1 from private.r04_research_links where business_id=s.business_id and goal_id=s.goal_id) then raise exception 'r12_pilot_no_research_relink';end if;
 return source||jsonb_build_object('closedPlanId',s.amendment->>'closedPlanId','closedPlanHash',s.amendment->>'closedPlanHash','successor',jsonb_build_object('authorization',a.authorization_data,'authorizationHash',a.authorization_hash));
end $$;

-- Narrow guarded patches preserve existing function ACLs and security modes.
do $patch$ declare d text;old text;replacement text;begin
 d:=pg_get_functiondef('private.r12_pilot_source(private.r12_discovery_scopes,timestamp with time zone,boolean)'::regprocedure);
 old:=' perform private.r12_pilot_profile_validate(s,effective_at,p_current);';
 replacement:=' if exists(select 1 from private.r12_pilot_successor_authorizations where scope_id=s.id) then return private.r12_pilot_successor_source(s,effective_at,p_current);end if;'||chr(10)||old;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_successor_source_definition_drift';end if;execute replace(d,old,replacement);
end $patch$;

-- A valid negative strategy is retained as accepted history, but ends this
-- separately approved run before even scheduling or reserving the review.
do $patch$ declare d text;old text;replacement text;begin
 d:=pg_get_functiondef('private.r07_gate(private.r07_plans,jsonb)'::regprocedure);
 old:=' if s is null then return null; end if;';
 replacement:=$r$ if s is null then return null; end if;
 if s->>'key'='review' and exists(select 1 from private.r12_pilot_successor_authorizations where scope_id=(p.content->>'discoveryScopeId')::uuid)
 and not exists(select 1 from private.r07_attempts sa join private.r07_responses sr on sr.attempt_id=sa.id
 where sa.plan_id=p.id and sa.business_id=p.business_id and sa.step_key='strategy' and sa.attempt=1 and sa.status='completed'
 and sr.content->>'outcome'='accepted' and sr.content->'result'->>'outcome'='TEST'
 and exists(select 1 from private.r12_discovery_wires sw join private.r12_discovery_candidates sc on sc.request_id=sw.request_id where sw.attempt_id=sa.id and sw.scope_id=(p.content->>'discoveryScopeId')::uuid and sc.candidate->'output'->'usesPinnedLearningPlan'='true'::jsonb and sc.candidate->'output'->'recommendation'->>'proposedOutcome'='TEST'
 and not exists(select 1 from jsonb_array_elements(sc.candidate->'output'->'candidates') cand cross join lateral jsonb_array_elements(cand->'dimensions') dim where dim->'hardFailure'='true'::jsonb or exists(select 1 from jsonb_array_elements(dim->'uncertainties') u where u->'blockingForTest'='true'::jsonb)))) then return 'r12_successor_strategy_terminal';end if;$r$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_successor_gate_definition_drift';end if;execute replace(d,old,replacement);
end $patch$;

-- Bind the proof through the real owner proposal and R05 interpretation proof.
do $patch$ declare d text;old text;replacement text;begin
 d:=pg_get_functiondef('private.r12_review_owner_proposal_validate(private.r12_review_owner_proposals,boolean)'::regprocedure);
 old:=' p:=v->''operatingPolicy'';';
 replacement:=$r$ if exists(select 1 from private.r12_pilot_successor_authorizations a where a.scope_id=s.id) then
 if not exists(select 1 from private.r12_pilot_successor_authorizations a where a.scope_id=s.id and a.business_id=s.business_id
 and a.authorization_hash=v->>'interpretationHash' and a.authorization_data->>'ownerId'=q.owner_id::text
 and a.authorization_data->>'preparedGoalHash'=v->>'expectedGoalHash' and a.authorization_data->'preparedGoalRevision'=v->'expectedGoalRevision')
 then raise exception 'r12_successor_owner_proof_required';end if;
 if v->'operatingPolicy'->'operations'->0->>'maximumPerOperationMicrounits' is distinct from '66671'
 or v->'operatingPolicy'->'operations'->1->>'maximumPerOperationMicrounits' is distinct from '211236'
 or v->'operatingPolicy'->>'policyLimitMicrounits' is distinct from '277907' then raise exception 'r12_successor_exact_ceilings_required';end if;
 end if;
 p:=v->'operatingPolicy';$r$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_successor_owner_definition_drift';end if;execute replace(d,old,replacement);
end $patch$;

-- Metadata never enters provider content; it binds the trusted request/receipt.
do $patch$ declare d text;old text;replacement text;begin
 d:=pg_get_functiondef('private.r12_discovery_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb)'::regprocedure);
 old:=$o$ if p.content->>'format'='r12.discovery-pilot.1' then
 if ((v->>'requestJson')::jsonb)->'requestMetadata'->>'r12FocusedPilotProfileHash'$o$;
 replacement:=$r$ if p.content->>'format'='r12.discovery-pilot.1' then
 if ((v->>'requestJson')::jsonb)->'requestMetadata'->>'r12FocusedSuccessorAuthorizationHash' is distinct from
 (select authorization_hash from private.r12_pilot_successor_authorizations where scope_id=s.id and business_id=s.business_id)
 then raise exception 'r12_successor_wire_proof_required';end if;
 if exists(select 1 from private.r12_pilot_successor_authorizations where scope_id=s.id) and phase='review'
 and not exists(select 1 from private.r07_attempts prior_a join private.r07_responses prior_r on prior_r.attempt_id=prior_a.id
 where prior_a.plan_id=p.id and prior_a.business_id=p.business_id and prior_a.step_key='strategy' and prior_a.attempt=1 and prior_a.status='completed'
 and prior_r.content->>'outcome'='accepted' and prior_r.content->'result'->>'outcome'='TEST'
 and exists(select 1 from private.r12_discovery_wires sw join private.r12_discovery_candidates sc on sc.request_id=sw.request_id where sw.attempt_id=prior_a.id and sw.scope_id=(p.content->>'discoveryScopeId')::uuid and sc.candidate->'output'->'usesPinnedLearningPlan'='true'::jsonb and sc.candidate->'output'->'recommendation'->>'proposedOutcome'='TEST'
 and not exists(select 1 from jsonb_array_elements(sc.candidate->'output'->'candidates') cand cross join lateral jsonb_array_elements(cand->'dimensions') dim where dim->'hardFailure'='true'::jsonb or exists(select 1 from jsonb_array_elements(dim->'uncertainties') u where u->'blockingForTest'='true'::jsonb)))) then raise exception 'r12_successor_strategy_terminal';end if;
 if ((v->>'requestJson')::jsonb)->'requestMetadata'->>'r12FocusedPilotProfileHash'$r$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_successor_wire_definition_drift';end if;execute replace(d,old,replacement);
end $patch$;

-- Only this proved successor may retain failed strategy diagnostics through the
-- same private bounded observation path; all legacy strategy roles stay denied.
do $patch$ declare d text;old text;replacement text;begin
 d:=pg_get_functiondef('public.r12_discovery_server(uuid,uuid,text,jsonb,text)'::regprocedure);
 old:=$o$ if a.step_key is distinct from 'review' or w.business_id is distinct from p_business_id$o$;
 replacement:=$r$ if not (a.step_key='review' or (a.step_key='strategy' and exists(select 1 from private.r12_pilot_successor_authorizations authz where authz.scope_id=w.scope_id and authz.business_id=p_business_id))) or w.business_id is distinct from p_business_id$r$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_successor_diagnostic_role_definition_drift';end if;d:=replace(d,old,replacement);
 old:=$o$or r.payload->>'operationKey' is distinct from 'research.r12.'||w.scope_id::text||'.review'$o$;
 replacement:=$r$or r.payload->>'operationKey' is distinct from 'research.r12.'||w.scope_id::text||'.'||a.step_key$r$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_successor_diagnostic_operation_definition_drift';end if;d:=replace(d,old,replacement);
 old:=$o$or w.binding->>'phase' is distinct from 'review' or w.binding->>'requestHash'$o$;
 replacement:=$r$or w.binding->>'phase' is distinct from a.step_key or w.binding->>'requestHash'$r$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_successor_diagnostic_phase_definition_drift';end if;execute replace(d,old,replacement);
end $patch$;

-- Safe owner-only projections. No new RPC grant is created. Absent keys stay absent.
do $patch$ declare d text;old text;replacement text;begin
 d:=pg_get_functiondef('public.r12_discovery_owner_read(uuid,uuid,boolean)'::regprocedure);
 old:=$o$else '{}'::jsonb end;$o$;
 replacement:=$r$else '{}'::jsonb end||coalesce((select jsonb_build_object('focusedSuccessor',jsonb_build_object('authorization',a.authorization_data,'authorizationHash',a.authorization_hash)) from private.r12_pilot_successor_authorizations a where a.scope_id=source_scope.id and a.business_id=p_business_id),'{}'::jsonb);$r$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_successor_owner_read_definition_drift';end if;execute replace(d,old,replacement);
 d:=pg_get_functiondef('public.r12_review_owner_read(uuid,uuid)'::regprocedure);
 old:=$o$end,'eligible',eligible,'reason',reason);$o$;
 replacement:=$r$end,'eligible',eligible,'reason',reason)||coalesce((select jsonb_build_object('successor',jsonb_build_object('authorization',a.authorization_data,'authorizationHash',a.authorization_hash)) from private.r12_pilot_successor_authorizations a where a.scope_id=s.id and a.business_id=p_business_id),'{}'::jsonb);$r$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_successor_review_read_definition_drift';end if;execute replace(d,old,replacement);
end $patch$;

revoke all on function private.r12_pilot_successor_closure(uuid),private.r12_pilot_successor_validate(private.r12_discovery_scopes,jsonb),private.r12_pilot_successor_source(private.r12_discovery_scopes,timestamp with time zone,boolean) from public,anon,authenticated,service_role;
-- Original per-closed-plan/per-Goal uniqueness and all old rows remain intact.
commit;
