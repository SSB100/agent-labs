-- One terminal technical qualification after an exactly proved marked-before-transport failure.
-- Definitions only. Existing recovery slots and all historical rows remain immutable.
begin;
create unique index r12_one_marked_pretransport_reconciliation on private.r07_events(attempt_id)
 where operation='r12.marked_pretransport_reconciled';
create table private.r12_pilot_technical_qualification_authorizations(
 scope_id uuid primary key references private.r12_discovery_scopes(id) deferrable initially deferred,
 business_id uuid not null references public.businesses(id),
 failed_recovery_scope_id uuid not null unique references private.r12_pilot_unsent_recovery_authorizations(scope_id),
 budget_authority_root_id uuid not null unique references public.product_experiments(id),
 reconciliation_event_id bigint not null unique references private.r07_events(id),
 authorization_data jsonb not null,authorization_hash text not null,created_at timestamptz not null default clock_timestamp(),
 check(scope_id<>failed_recovery_scope_id and jsonb_typeof(authorization_data)='object' and octet_length(authorization_data::text)<=16384
 and (authorization_data->>'version') is not distinct from 'r12.focused-pilot-terminal-qualification-authorization.1'
 and authorization_hash=private.stage14_hash(authorization_data))
);
alter table private.r12_pilot_technical_qualification_authorizations enable row level security;
revoke all on private.r12_pilot_technical_qualification_authorizations from public,anon,authenticated,service_role;
create trigger r12_terminal_qualification_immutable before insert or update or delete
 on private.r12_pilot_technical_qualification_authorizations for each row execute function private.r12_discovery_history_guard();

-- A separate proof: the two exact Core markers exist, every external-effect store is empty.
-- Never relax the released pre-marker helper or generic release_unsent API.
do $patch$ declare d text;old text;replacement text;begin
 d:=pg_get_functiondef('private.r12_pilot_unsent_absence(private.r05_requests,private.r07_attempts)'::regprocedure);
 d:=replace(d,'FUNCTION private.r12_pilot_unsent_absence(','FUNCTION private.r12_pilot_pretransport_absence(');
 old:=$o$ if exists(select 1 from jsonb_each(counts) c where c.value<>'0'::jsonb) then raise exception 'r12_recovery_effect_evidence_present';end if;$o$;
 replacement:=$r$ if counts->'r05Markers' is distinct from '1'::jsonb or counts->'r07Markers' is distinct from '1'::jsonb
 or exists(select 1 from jsonb_each(counts-array['r05Markers','r07Markers']) c where c.value<>'0'::jsonb)
 then raise exception 'r12_pretransport_effect_evidence_present';end if;$r$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_pretransport_absence_definition_drift';end if;
 execute replace(d,old,replacement);
 d:=pg_get_functiondef('private.r12_pilot_unsent_request(uuid,uuid)'::regprocedure);
 d:=replace(d,'FUNCTION private.r12_pilot_unsent_request(','FUNCTION private.r12_pilot_marked_request(');
 old:=$o$a.status<>'reserved' or a.reason<>'admitted'$o$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_pretransport_request_definition_drift';end if;
 d:=replace(d,old,$r$a.status<>'dispatched' or a.reason<>'marked'$r$);
 d:=replace(d,'private.r12_pilot_unsent_absence(r,a)','private.r12_pilot_pretransport_absence(r,a)');
 old:=$o$'reservationHash',private.stage14_hash(to_jsonb(reservation)),'absenceHash',private.stage14_hash(counts));$o$;
 replacement:=$r$'reservationHash',private.stage14_hash(to_jsonb(reservation)),'absenceHash',private.stage14_hash(counts),
 'financialMarkerHash',(select private.stage14_hash(to_jsonb(m)) from private.r05_markers m where request_id=r.id),
 'controllerMarkerHash',(select private.stage14_hash(to_jsonb(m)) from private.r07_markers m where attempt_id=a.id),
 'revocationsHash',private.stage14_hash(jsonb_build_object(
 'policy',(select to_jsonb(z) from private.r05_revocations z where policy_id=pol.id),
 'controller',(select to_jsonb(z) from private.r07_server_revocations z where key_hash=q.controller_key_hash),
 'admission',(select to_jsonb(z) from private.r05_server_revocations z where key_hash=q.admission_key_hash))));$r$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_pretransport_request_return_drift';end if;
 execute replace(d,old,replacement);
end $patch$;

create function private.r12_pilot_marked_context(p_scope_id uuid) returns jsonb
language plpgsql stable set search_path='' as $$
declare s private.r12_discovery_scopes;authz private.r12_pilot_unsent_recovery_authorizations;
 p private.r07_plans;h private.r07_heads;a private.r07_attempts;context jsonb;request_proof jsonb;begin
 select * into strict s from private.r12_discovery_scopes where id=p_scope_id;
 select * into strict authz from private.r12_pilot_unsent_recovery_authorizations where scope_id=s.id and business_id=s.business_id;
 if authz.authorization_hash is distinct from private.stage14_hash(authz.authorization_data)
 or authz.budget_authority_root_id<>s.budget_authority_root_id
 or exists(select 1 from private.r12_pilot_technical_qualification_authorizations where scope_id=s.id)
 then raise exception 'r12_pretransport_original_recovery_required';end if;
 select * into strict p from private.r07_plans where goal_id=s.goal_id and business_id=s.business_id;
 select * into strict h from private.r07_heads where plan_id=p.id and business_id=s.business_id and goal_id=s.goal_id;
 select * into strict a from private.r07_attempts where plan_id=p.id and step_key='strategy' and attempt=1;
 if h.dispatches<>1 or h.children_created<>1 or h.repairs_used<>0 or h.pivots_used<>0
 or (select count(*) from private.r07_attempts where plan_id=p.id)<>1
 or (select count(*) from private.r07_children where plan_id=p.id)<>1
 or (select count(*) from private.r05_requests where business_id=s.business_id and policy_id=p.policy_id)<>1
 or (select count(*) from private.r12_discovery_wires where scope_id=s.id)<>1
 or not exists(select 1 from private.r07_markers m where m.attempt_id=a.id and m.business_id=s.business_id and m.lease_epoch=h.lease_epoch)
 or p.content->'maximumDispatches' is distinct from '2'::jsonb or p.content->'maximumChildren' is distinct from '2'::jsonb
 or p.content->'maximumRepairs' is distinct from '0'::jsonb or p.content->'maximumPivots' is distinct from '0'::jsonb
 or jsonb_array_length(p.content->'steps')<>2 or p.content->'steps'->0->>'key' is distinct from 'strategy'
 or p.content->'steps'->1->>'key' is distinct from 'review'
 then raise exception 'r12_pretransport_single_marked_strategy_required';end if;
 request_proof:=private.r12_pilot_marked_request(s.id,a.id);
 perform private.r12_pilot_profile_validate(s,clock_timestamp(),false);
 -- Reconstruct the original paid and pre-marker histories exactly once; no source recursion.
 context:=private.r12_pilot_unsent_recovery_validate_context(s,authz.authorization_data);
 if authz.abandoned_scope_id::text is distinct from context->'unsentClosure'->>'scopeId'
 then raise exception 'r12_pretransport_recovery_source_changed';end if;
 return context||jsonb_build_object('markedRequest',request_proof,'recoveryAuthorizationHash',authz.authorization_hash);
end $$;

create function private.r12_pilot_marked_closure_context(p_scope_id uuid) returns jsonb
language plpgsql stable set search_path='' as $$
declare context jsonb;request_proof jsonb;event private.r07_events;released private.r05_releases;
 decision private.r05_decisions;r private.r05_requests;a private.r07_attempts;failed_scope private.r12_discovery_scopes;proof jsonb;closed jsonb;revocations jsonb;absence jsonb;k text;begin
 context:=private.r12_pilot_marked_context(p_scope_id);request_proof:=context->'markedRequest';
 select * into strict failed_scope from private.r12_discovery_scopes where id=p_scope_id;
 select * into strict r from private.r05_requests where id=(request_proof->>'requestId')::uuid;
 select * into strict event from private.r07_events where attempt_id=r.workflow_run_id and business_id=r.business_id
 and operation='r12.marked_pretransport_reconciled';
 proof:=event.payload;
 select * into strict a from private.r07_attempts where id=r.workflow_run_id;
 absence:=private.r12_pilot_pretransport_absence(r,a);
 revocations:=jsonb_build_object('policy',(select to_jsonb(z) from private.r05_revocations z where policy_id=r.policy_id),
 'controller',(select to_jsonb(z) from private.r07_server_revocations z where key_hash=request_proof->>'controllerKeyHash'),
 'admission',(select to_jsonb(z) from private.r05_server_revocations z where key_hash=request_proof->>'admissionKeyHash'));
 perform private.r04_keys(proof,array['version','request','recoveryAuthorizationHash','predecessorClosureHash','unsentClosureHash',
 'ownerApprovalEvidenceHash','independentReviewHash','absence','revocations','before','after']);
 perform private.r04_keys(proof->'before',array['rootKnownMicrousd','rootPendingMicrousd','businessExposureMicrousd','businessCapMicrousd']);
 perform private.r04_keys(proof->'after',array['rootKnownMicrousd','rootPendingMicrousd','businessExposureMicrousd','businessCapMicrousd']);
 foreach k in array array['rootKnownMicrousd','rootPendingMicrousd','businessExposureMicrousd','businessCapMicrousd'] loop
 if jsonb_typeof(proof->'before'->k) is distinct from 'number' or jsonb_typeof(proof->'after'->k) is distinct from 'number'
 then raise exception 'r12_pretransport_recorded_financial_types';end if;
 perform private.r05_money(to_jsonb(proof->'before'->>k));perform private.r05_money(to_jsonb(proof->'after'->>k));
 end loop;
 if proof->'absence' is distinct from absence or private.stage14_hash(absence) is distinct from request_proof->>'absenceHash'
 or proof->'revocations' is distinct from revocations or private.stage14_hash(revocations) is distinct from request_proof->>'revocationsHash'
 or proof->'before'->'rootKnownMicrousd' is distinct from proof->'after'->'rootKnownMicrousd'
 or proof->'before'->'businessCapMicrousd' is distinct from proof->'after'->'businessCapMicrousd'
 or proof->'before'->'rootPendingMicrousd' is distinct from '66671'::jsonb or proof->'after'->'rootPendingMicrousd' is distinct from '0'::jsonb
 or (proof->'before'->>'businessExposureMicrousd')::bigint-(proof->'after'->>'businessExposureMicrousd')::bigint<>66671
 then raise exception 'r12_pretransport_recorded_financial_proof';end if;
 select * into strict released from private.r05_releases where request_id=r.id and business_id=r.business_id;
 select d.* into strict decision from private.r05_decisions d where d.request_id=r.id and d.business_id=r.business_id
 and d.decision='allowed' and d.reason='released_marked_before_transport';
 if proof->>'version' is distinct from 'r12.marked-pretransport-reconciliation.1'
 or proof->'request' is distinct from request_proof
 or proof->>'recoveryAuthorizationHash' is distinct from context->>'recoveryAuthorizationHash'
 or proof->>'predecessorClosureHash' is distinct from private.stage14_hash(context->'closure')
 or proof->>'unsentClosureHash' is distinct from private.stage14_hash(context->'unsentClosure')
 or event.goal_id::text is distinct from request_proof->>'goalId' or event.plan_id::text is distinct from request_proof->>'planId'
 or released.evidence_hash is distinct from private.stage14_hash(proof) or released.created_at<event.created_at
 or decision.created_at<released.created_at or event.created_at<r.created_at
 or jsonb_typeof(proof->'ownerApprovalEvidenceHash') is distinct from 'string' or proof->>'ownerApprovalEvidenceHash' !~ '^[a-f0-9]{64}$'
 or jsonb_typeof(proof->'independentReviewHash') is distinct from 'string' or proof->>'independentReviewHash' !~ '^[a-f0-9]{64}$'
 or proof->>'ownerApprovalEvidenceHash'=proof->>'independentReviewHash'
 or proof->>'ownerApprovalEvidenceHash'=failed_scope.amendment->>'approvalHash'
 or proof->>'independentReviewHash' in(failed_scope.amendment->>'independentReviewHash',failed_scope.amendment->>'approvalHash')
 or proof->>'independentReviewHash'=(select execution_review_hash from private.r12_discovery_authorities where scope_id=failed_scope.id)
 or exists(select 1 from private.r05_exposure(r.business_id) ex where ex.source_key=r.source_key)
 or exists(select 1 from private.r12_discovery_exposure((request_proof->>'budgetAuthorityRootId')::uuid) ex where ex.request_id=r.id)
 then raise exception 'r12_pretransport_canonical_reconciliation_required';end if;
 closed:=request_proof||jsonb_build_object('version','r12.focused-pilot-marked-pretransport-closure.1',
 'recoveryAuthorizationHash',context->'recoveryAuthorizationHash','reconciliationEventId',event.id::text,
 'reconciliationProofHash',private.stage14_hash(proof),'releaseHash',private.stage14_hash(to_jsonb(released)),
 'releaseEvidenceHash',released.evidence_hash,'decisionHash',private.stage14_hash(to_jsonb(decision)),
 'dispatches',1,'childrenCreated',1,'repairsUsed',0,'pivotsUsed',0,'authorityClosed',true,'knownMicrousd','0','heldMicrousd','0');
 return context||jsonb_build_object('markedClosure',closed);
end $$;
create function private.r12_pilot_marked_closure(p_scope_id uuid) returns jsonb
language plpgsql stable set search_path='' as $$
begin return private.r12_pilot_marked_closure_context(p_scope_id)->'markedClosure';end $$;

-- Trusted operator only. Business serialization drains an earlier send, while
-- committed revocations fence any send queued behind this transaction. A lost
-- successful send response still leaves a claim and is categorically ineligible.
create function private.r12_pilot_marked_pretransport_reconcile(
 p_business_id uuid,p_scope_id uuid,p_expected_request_hash text,p_owner_approval_hash text,p_independent_review_hash text
) returns jsonb language plpgsql set search_path='' as $$
declare s private.r12_discovery_scopes;q private.r12_discovery_authorities;r private.r05_requests;a private.r07_attempts;
 context jsonb;request_proof jsonb;proof jsonb;before_budget jsonb;after_budget jsonb;before_exposure bigint;after_exposure bigint;
 cap bigint;event_id bigint;result jsonb;existing private.r07_events;begin
 if current_setting('transaction_isolation') is distinct from 'read committed'
 then raise exception 'r12_pretransport_read_committed_required';end if;
 if current_user in ('anon','authenticated','service_role') or p_expected_request_hash is null or p_expected_request_hash !~ '^[a-f0-9]{64}$'
 or p_owner_approval_hash is null or p_owner_approval_hash !~ '^[a-f0-9]{64}$'
 or p_independent_review_hash is null or p_independent_review_hash !~ '^[a-f0-9]{64}$' or p_owner_approval_hash=p_independent_review_hash
 then raise exception 'r12_pretransport_operator_evidence_required' using errcode='42501';end if;
 select * into strict s from private.r12_discovery_scopes where id=p_scope_id and business_id=p_business_id;
 perform 1 from public.businesses where id=s.business_id and owner_user_id=(select (authorization_data->>'ownerId')::uuid
 from private.r12_pilot_unsent_recovery_authorizations where scope_id=s.id and business_id=s.business_id) for update;
 if not found then raise exception 'r12_pretransport_owner_changed';end if;
 perform 1 from public.product_experiments where id=s.budget_authority_root_id and business_id=s.business_id for update;
 if not found then raise exception 'r12_pretransport_root_changed';end if;
 select * into strict q from private.r12_discovery_authorities where scope_id=s.id and business_id=s.business_id;
 perform 1 from private.r07_server_keys where key_hash=q.controller_key_hash for update;
 perform 1 from private.r05_server_keys where key_hash=q.admission_key_hash for update;
 perform 1 from private.r07_heads where business_id=s.business_id and goal_id=s.goal_id for update;
 select req.* into strict r from private.r05_requests req join private.r07_bindings rb on rb.request_id=req.id
 join private.r07_attempts att on att.id=rb.attempt_id join private.r07_plans plan on plan.id=att.plan_id
 where plan.business_id=s.business_id and plan.goal_id=s.goal_id and att.step_key='strategy' for update of req;
 select * into strict a from private.r07_attempts where id=r.workflow_run_id;
 context:=private.r12_pilot_marked_context(s.id);request_proof:=context->'markedRequest';
 if private.stage14_hash(request_proof) is distinct from p_expected_request_hash
 or p_owner_approval_hash=s.amendment->>'approvalHash'
 or p_independent_review_hash in(s.amendment->>'independentReviewHash',s.amendment->>'approvalHash',q.execution_review_hash) then raise exception 'r12_pretransport_exact_new_approval_required';end if;
 select * into existing from private.r07_events where attempt_id=a.id and operation='r12.marked_pretransport_reconciled';
 if existing.id is not null then
 if existing.payload->>'ownerApprovalEvidenceHash' is distinct from p_owner_approval_hash
 or existing.payload->>'independentReviewHash' is distinct from p_independent_review_hash
 then raise exception 'r12_pretransport_reconciliation_conflict';end if;
 return jsonb_build_object('replayed',true,'closure',private.r12_pilot_marked_closure(s.id),'providerCalls',0);
 end if;
 if exists(select 1 from private.r05_releases where request_id=r.id)
 or exists(select 1 from private.r05_decisions d where d.request_id=r.id and d.reason='released_marked_before_transport')
 then raise exception 'r12_pretransport_partial_reconciliation';end if;
 before_budget:=private.stage13v2_budget_authority(s.prior_round_id,false);
 select coalesce(sum(held),0) into before_exposure from private.r05_exposure(s.business_id) where currency='USD';
 select maximum_microunits into strict cap from private.r05_cap_versions where business_id=s.business_id and currency='USD' order by revision desc limit 1;
 if r.liability_microunits<>66671 or r.currency<>'USD'
 or (before_budget->>'pendingExposureMicrousd')::bigint<>r.liability_microunits
 or exists(select 1 from private.r05_exposure(s.business_id) ex where ex.unknown and ex.source_key<>r.source_key)
 or not exists(select 1 from private.r05_exposure(s.business_id) ex where ex.source_key=r.source_key and ex.held=r.liability_microunits and ex.unknown)
 then raise exception 'r12_pretransport_exact_pending_liability_required';end if;
 proof:=jsonb_build_object('version','r12.marked-pretransport-reconciliation.1','request',request_proof,
 'recoveryAuthorizationHash',context->'recoveryAuthorizationHash','predecessorClosureHash',private.stage14_hash(context->'closure'),
 'unsentClosureHash',private.stage14_hash(context->'unsentClosure'),'ownerApprovalEvidenceHash',p_owner_approval_hash,
 'independentReviewHash',p_independent_review_hash,'absence',private.r12_pilot_pretransport_absence(r,a),
 'revocations',jsonb_build_object('policy',(select to_jsonb(z) from private.r05_revocations z where policy_id=r.policy_id),
 'controller',(select to_jsonb(z) from private.r07_server_revocations z where key_hash=q.controller_key_hash),
 'admission',(select to_jsonb(z) from private.r05_server_revocations z where key_hash=q.admission_key_hash)),
 'before',jsonb_build_object('rootKnownMicrousd',before_budget->'knownActualMicrousd','rootPendingMicrousd',before_budget->'pendingExposureMicrousd',
 'businessExposureMicrousd',before_exposure,'businessCapMicrousd',cap),
 'after',jsonb_build_object('rootKnownMicrousd',before_budget->'knownActualMicrousd','rootPendingMicrousd',0,
 'businessExposureMicrousd',before_exposure-r.liability_microunits,'businessCapMicrousd',cap));
 insert into private.r07_events(business_id,goal_id,plan_id,attempt_id,operation,payload)
 values(s.business_id,s.goal_id,(request_proof->>'planId')::uuid,a.id,'r12.marked_pretransport_reconciled',proof) returning id into event_id;
 insert into private.r05_releases(request_id,business_id,evidence_hash) values(r.id,s.business_id,private.stage14_hash(proof));
 result:=private.r05_result(s.business_id,r.id,'allowed','released_marked_before_transport',false);
 after_budget:=private.stage13v2_budget_authority(s.prior_round_id,false);
 select coalesce(sum(held),0) into after_exposure from private.r05_exposure(s.business_id) where currency='USD';
 if after_budget->'knownActualMicrousd' is distinct from before_budget->'knownActualMicrousd'
 or (after_budget->>'pendingExposureMicrousd')::bigint<>0 or after_budget->'hasUncertainCosts' is distinct from 'false'::jsonb
 or after_exposure<>before_exposure-r.liability_microunits
 or exists(select 1 from private.r05_exposure(s.business_id) ex where ex.source_key=r.source_key)
 or exists(select 1 from private.r12_discovery_exposure(s.budget_authority_root_id) ex where ex.request_id=r.id)
 then raise exception 'r12_pretransport_financial_readback_failed';end if;
 return jsonb_build_object('replayed',false,'closure',private.r12_pilot_marked_closure(s.id),'releasedMicrousd',r.liability_microunits::text,
 'rootKnownMicrousd',after_budget->'knownActualMicrousd','rootPendingMicrousd',after_budget->'pendingExposureMicrousd',
 'businessExposureMicrousd',after_exposure,'providerCalls',0,'historyRewritten',false);
end $$;

create function private.r12_pilot_terminal_validate_context(s private.r12_discovery_scopes,v jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare e jsonb:=s.amendment;context jsonb;closed jsonb;old_scope private.r12_discovery_scopes;
 g private.r04_goal_versions;k text;begin
 perform private.r04_keys(v,array['version','businessId','ownerId','scopeId','scopeHash','goalId','preparedGoalRevision','preparedGoalHash',
 'profileHash','ownerApprovalEvidenceHash','predecessorClosure','markedClosure','limits','createdAt','expiresAt']);
 if v->>'version' is distinct from 'r12.focused-pilot-terminal-qualification-authorization.1' or octet_length(v::text)>16384
 or v->>'businessId' is distinct from s.business_id::text or v->>'scopeId' is distinct from s.id::text or v->>'goalId' is distinct from s.goal_id::text
 or v->>'scopeHash' is distinct from s.amendment_hash or s.amendment_hash is distinct from private.stage14_hash(e)
 or v->>'profileHash' is distinct from e->>'profileHash' or e->>'profileHash' is distinct from private.stage14_hash(e->'profile')
 or v->>'ownerApprovalEvidenceHash' is distinct from e->>'approvalHash'
 or v->>'ownerApprovalEvidenceHash' is distinct from e->'profile'->'observations'->>'approvalHash'
 or e->>'independentReviewHash' is distinct from e->'profile'->'observations'->>'independentReviewHash'
 or v->'createdAt' is distinct from e->'createdAt' or v->'expiresAt' is distinct from e->'expiresAt'
 or v->'preparedGoalRevision' is distinct from '2'::jsonb
 or v->'limits' is distinct from '{"maximumSuccessors":1,"maximumTechnicalQualifications":1,"maximumPaidCalls":2,"maximumReceiptGets":6,"maximumReceiptGetsPerCall":3,"dispatchWindowSeconds":1800,"receiptGraceSeconds":1800,"maximumMicrousd":277907,"maximumStrategyMicrousd":66671,"maximumReviewMicrousd":211236,"stopOnAnyNegative":true,"researchOnly":true,"paidRetryAllowed":false,"searchAllowed":false,"imageAllowed":false,"storeActionsAllowed":false}'::jsonb
 then raise exception 'r12_terminal_exact_authorization_required';end if;
 foreach k in array array['scopeHash','profileHash','preparedGoalHash','ownerApprovalEvidenceHash'] loop
 if jsonb_typeof(v->k) is distinct from 'string' or v->>k !~ '^[a-f0-9]{64}$' then raise exception 'r12_terminal_authorization_hash';end if;end loop;
 select * into g from private.r04_goal_versions where business_id=s.business_id and goal_id=s.goal_id and revision=2;
 if g.goal_id is null or g.content_hash is distinct from v->>'preparedGoalHash' or g.preference<>'ready' or g.actor_id::text is distinct from v->>'ownerId'
 or not exists(select 1 from public.businesses where id=s.business_id and owner_user_id=g.actor_id)
 then raise exception 'r12_terminal_prepared_owner_goal_required';end if;
 context:=private.r12_pilot_marked_closure_context((v->'markedClosure'->>'scopeId')::uuid);closed:=context->'markedClosure';
 if v->'markedClosure' is distinct from closed or v->'predecessorClosure' is distinct from context->'closure'
 or closed->>'businessId' is distinct from s.business_id::text
 or closed->>'planId' is distinct from e->>'closedPlanId' or closed->>'planHash' is distinct from e->>'closedPlanHash'
 or closed->>'budgetAuthorityRootId' is distinct from s.budget_authority_root_id::text or closed->>'priorRoundId' is distinct from s.prior_round_id::text
 or s.goal_id::text in(closed->>'goalId',context->'closure'->>'goalId',context->'closure'->>'originalGoalId',context->'unsentClosure'->>'goalId')
 or s.id::text in(closed->>'scopeId',context->'closure'->>'scopeId',context->'closure'->>'acceptedReviewScopeId',context->'unsentClosure'->>'scopeId')
 or exists(select 1 from private.r12_pilot_successor_authorizations where scope_id=s.id)
 or exists(select 1 from private.r12_pilot_unsent_recovery_authorizations where scope_id=s.id)
 then raise exception 'r12_terminal_closed_lineage_changed';end if;
 select * into strict old_scope from private.r12_discovery_scopes where id=(closed->>'scopeId')::uuid;
 foreach k in array array['originalGoalId','budgetAuthorityRootId','priorRoundId','originalIntentHash','originalSemanticGoalHash',
 'acceptedReviewScopeId','acceptedReviewHash','acceptedReviewRecordHash','allowedDomains','excludedDomains','approvedQuery'] loop
 if e->k is distinct from old_scope.amendment->k then raise exception 'r12_terminal_original_scope_changed';end if;end loop;
 -- New container/Goal/approval identities only. Every actual observation, capture
 -- timestamp, limitation and source review remains byte-identical to the failed recovery.
 if ((e->'profile')-array['id','goalId','intent','observations','history','pinnedLearningPlan','createdAt','expiresAt'])
 is distinct from ((old_scope.amendment->'profile')-array['id','goalId','intent','observations','history','pinnedLearningPlan','createdAt','expiresAt'])
 or ((e->'profile'->'intent')-array['id','expiresAt']) is distinct from ((old_scope.amendment->'profile'->'intent')-array['id','expiresAt'])
 or ((e->'profile'->'history')-'scopeChangeExplanation') is distinct from ((old_scope.amendment->'profile'->'history')-'scopeChangeExplanation')
 or ((e->'profile'->'observations')-array['id','goalId','approvalHash','independentReviewHash','createdAt','expiresAt'])
 is distinct from ((old_scope.amendment->'profile'->'observations')-array['id','goalId','approvalHash','independentReviewHash','createdAt','expiresAt'])
 or e->'profile'->'observations'->'id'=old_scope.amendment->'profile'->'observations'->'id'
 or ((e->'profile'->'pinnedLearningPlan')-'evidenceRefs') is distinct from ((old_scope.amendment->'profile'->'pinnedLearningPlan')-'evidenceRefs')
 or (select jsonb_agg(ref-'artifactId' order by n) from jsonb_array_elements(e->'profile'->'pinnedLearningPlan'->'evidenceRefs') with ordinality r(ref,n))
 is distinct from (select jsonb_agg(ref-'artifactId' order by n) from jsonb_array_elements(old_scope.amendment->'profile'->'pinnedLearningPlan'->'evidenceRefs') with ordinality r(ref,n))
 or e->'profile'->'researchAllocationMicrousd' is distinct from '277907'::jsonb
 or (e->>'createdAt')::timestamptz<=(old_scope.amendment->>'createdAt')::timestamptz
 or (e->>'expiresAt')::timestamptz>(old_scope.amendment->>'expiresAt')::timestamptz
 or e->>'approvalHash'=old_scope.amendment->>'approvalHash' or e->>'approvalHash'=e->>'independentReviewHash'
 or e->>'independentReviewHash' in(old_scope.amendment->>'independentReviewHash',old_scope.amendment->>'approvalHash')
 or e->>'independentReviewHash'=(select execution_review_hash from private.r12_discovery_authorities where scope_id=old_scope.id)
 or e->>'approvalHash' is distinct from (select payload->>'ownerApprovalEvidenceHash' from private.r07_events where id=(closed->>'reconciliationEventId')::bigint)
 then raise exception 'r12_terminal_same_evidence_and_learning_required';end if;
 return context;
end $$;
create function private.r12_pilot_terminal_validate(s private.r12_discovery_scopes,v jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
begin return private.r12_pilot_terminal_validate_context(s,v)->'markedClosure';end $$;
create function private.r12_pilot_terminal_source(s private.r12_discovery_scopes,effective_at timestamptz,p_current boolean) returns jsonb
language plpgsql stable set search_path='' as $$
declare authz private.r12_pilot_technical_qualification_authorizations;context jsonb;prior_scope private.r12_discovery_scopes;begin
 select * into strict authz from private.r12_pilot_technical_qualification_authorizations where scope_id=s.id and business_id=s.business_id;
 if authz.authorization_hash is distinct from private.stage14_hash(authz.authorization_data)
 then raise exception 'r12_terminal_authorization_mutated';end if;
 perform private.r12_pilot_profile_validate(s,effective_at,p_current);
 context:=private.r12_pilot_terminal_validate_context(s,authz.authorization_data);
 if authz.failed_recovery_scope_id::text is distinct from context->'markedClosure'->>'scopeId'
 or authz.reconciliation_event_id::text is distinct from context->'markedClosure'->>'reconciliationEventId'
 or authz.budget_authority_root_id<>s.budget_authority_root_id then raise exception 'r12_terminal_row_binding';end if;
 -- Flat, bounded historical reads retain both original wall-clock and caller-time
 -- checks. No terminal/recovery source is called, no nested authorization is returned.
 for prior_scope in select * from private.r12_discovery_scopes where id in(
 authz.failed_recovery_scope_id,(context->'unsentClosure'->>'scopeId')::uuid,(context->'closure'->>'scopeId')::uuid) loop
 perform private.r12_pilot_profile_validate(prior_scope,effective_at,false);
 end loop;
 if exists(select 1 from private.r04_research_links where business_id=s.business_id and goal_id=s.goal_id)
 then raise exception 'r12_pilot_no_research_relink';end if;
 return context->'source'||jsonb_build_object('closedPlanId',s.amendment->>'closedPlanId','closedPlanHash',s.amendment->>'closedPlanHash',
 'successor',jsonb_build_object('authorization',authz.authorization_data,'authorizationHash',authz.authorization_hash));
end $$;

-- Existing successor negative-stop, wire, diagnostics, owner confirmation and
-- genuine TEST adoption use this one exact, scope-filtered proof projection.
create or replace function private.r12_pilot_research_authorizations(p_scope_id uuid,p_business_id uuid)
returns table(scope_id uuid,business_id uuid,authorization_data jsonb,authorization_hash text)
language sql stable set search_path='' as $$
 select scope_id,business_id,authorization_data,authorization_hash from private.r12_pilot_successor_authorizations where scope_id=p_scope_id and business_id=p_business_id
 union all select scope_id,business_id,authorization_data,authorization_hash from private.r12_pilot_unsent_recovery_authorizations where scope_id=p_scope_id and business_id=p_business_id
 union all select scope_id,business_id,authorization_data,authorization_hash from private.r12_pilot_technical_qualification_authorizations where scope_id=p_scope_id and business_id=p_business_id
$$;
do $patch$ declare d text;old text;replacement text;begin
 d:=pg_get_functiondef('private.r12_pilot_successor_closure_context(uuid)'::regprocedure);
 old:=' or exists(select 1 from private.r12_pilot_successor_authorizations where scope_id=s.id)';
 replacement:=old||chr(10)||' or exists(select 1 from private.r12_pilot_technical_qualification_authorizations where scope_id=s.id)';
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_terminal_predecessor_definition_drift';end if;
 execute replace(d,old,replacement);
 d:=pg_get_functiondef('private.r12_pilot_source(private.r12_discovery_scopes,timestamptz,boolean)'::regprocedure);
 old:=' if exists(select 1 from private.r12_pilot_unsent_recovery_authorizations where scope_id=s.id) then return private.r12_pilot_unsent_recovery_source(s,effective_at,p_current);end if;';
 replacement:=' if exists(select 1 from private.r12_pilot_technical_qualification_authorizations where scope_id=s.id) then return private.r12_pilot_terminal_source(s,effective_at,p_current);end if;'||chr(10)||old;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_terminal_source_definition_drift';end if;
 execute replace(d,old,replacement);
 -- Reserved, unmarked terminal work uses the already reviewed bounded cleanup.
 -- Marked terminal failures cannot create another qualification or auto-release.
 d:=pg_get_functiondef('private.r12_pilot_unsent_recovery_release(uuid,uuid)'::regprocedure);
 d:=replace(d,'FUNCTION private.r12_pilot_unsent_recovery_release(','FUNCTION private.r12_pilot_terminal_release(');
 d:=replace(d,'private.r12_pilot_unsent_recovery_authorizations','private.r12_pilot_technical_qualification_authorizations');
 d:=replace(d,'r12.unsent-recovery-release.1','r12.terminal-qualification-release.1');
 execute d;
end $patch$;

create function private.r12_pilot_pretransport_owner_eligibility(p_scope_id uuid,p_business_id uuid) returns jsonb
language plpgsql stable set search_path='' as $$
declare result jsonb;begin
 if not exists(select 1 from private.r12_pilot_unsent_recovery_authorizations where scope_id=p_scope_id and business_id=p_business_id)
 or exists(select 1 from private.r12_pilot_technical_qualification_authorizations t join private.r12_discovery_scopes s
 on s.id=p_scope_id and s.business_id=p_business_id where t.failed_recovery_scope_id=s.id or t.budget_authority_root_id=s.budget_authority_root_id)
 then return null;end if;
 result:=private.r12_pilot_marked_closure(p_scope_id);return result;
 exception when others then return null;
end $$;
-- This projection verifies the canonical event/release/decision linkage without
-- performing recursive historical reads for every displayed phase.
create function private.r12_pilot_pretransport_reconciled(p_request_id uuid) returns boolean
language plpgsql stable set search_path='' as $$
declare r private.r05_requests;event private.r07_events;proof jsonb;begin
 select * into strict r from private.r05_requests where id=p_request_id;
 select * into strict event from private.r07_events where attempt_id=r.workflow_run_id and business_id=r.business_id
 and operation='r12.marked_pretransport_reconciled';
 proof:=private.r12_pilot_marked_request((event.payload->'request'->>'scopeId')::uuid,r.workflow_run_id);
 return event.payload->>'version'='r12.marked-pretransport-reconciliation.1' and event.payload->'request'=proof
 and event.goal_id::text=proof->>'goalId' and event.plan_id::text=proof->>'planId'
 and exists(select 1 from private.r05_releases z where z.request_id=r.id and z.business_id=r.business_id and z.evidence_hash=private.stage14_hash(event.payload))
 and (select count(*) from private.r05_decisions d where d.request_id=r.id and d.business_id=r.business_id and d.decision='allowed' and d.reason='released_marked_before_transport')=1;
 exception when others then return false;
end $$;
do $patch$ declare d text;old text;replacement text;begin
 d:=pg_get_functiondef('public.r12_discovery_owner_read(uuid,uuid,boolean)'::regprocedure);
 old:='marked and actual is null';
 if (length(d)-length(replace(d,old,'')))/length(old)<>2 then raise exception 'r12_pretransport_owner_cost_definition_drift';end if;
 d:=replace(d,old,'marked and actual is null and not private.r12_pilot_pretransport_reconciled(request.id)');
 old:=$o$'unknownCost',marked and actual is null and not private.r12_pilot_pretransport_reconciled(request.id),'outcome'$o$;
 replacement:=$r$'unknownCost',marked and actual is null and not private.r12_pilot_pretransport_reconciled(request.id),
 'pretransportReconciled',private.r12_pilot_pretransport_reconciled(request.id),'outcome'$r$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_pretransport_owner_phase_definition_drift';end if;
 d:=replace(d,old,replacement);
 old:=$o$(select private.r12_pilot_unsent_owner_eligibility(source_scope.id,p_business_id) closure) checked where closure is not null),'{}'::jsonb);$o$;
 replacement:=$r$(select private.r12_pilot_unsent_owner_eligibility(source_scope.id,p_business_id) closure) checked where closure is not null),'{}'::jsonb)
 ||coalesce((select jsonb_build_object('focusedPretransportClosure',closure) from
 (select private.r12_pilot_pretransport_owner_eligibility(source_scope.id,p_business_id) closure) checked where closure is not null),'{}'::jsonb)
 ||case when head.state in ('ready','running','waiting') and head.lease_expires_at>clock_timestamp()
 and private.r12_authority_owner_current(authority)
 and (active or (not stopped and not paused and authority.receipt_until>clock_timestamp()
 and exists(select 1 from private.r07_server_keys k where k.key_hash=authority.controller_key_hash and k.expires_at>clock_timestamp()
 and not exists(select 1 from private.r07_server_revocations z where z.key_hash=k.key_hash))
 and exists(select 1 from private.r05_server_keys k where k.key_hash=authority.admission_key_hash and k.expires_at>clock_timestamp()
 and not exists(select 1 from private.r05_server_revocations z where z.key_hash=k.key_hash))
 and exists(select 1 from jsonb_array_elements(phases) phase where phase->'candidateSaved'='true'::jsonb
 and phase->>'status' in ('dispatched','uncertain','responded') and phase->'receipt'->>'status' in ('awaiting_receipt','checking_receipt','verified'))))
 and exists(select 1 from private.r12_pilot_research_authorizations(source_scope.id,p_business_id) authz_record
 where authz_record.authorization_data->>'version' in ('r12.focused-pilot-unsent-recovery-authorization.1','r12.focused-pilot-terminal-qualification-authorization.1'))
 then jsonb_build_object('continueAfter',head.lease_expires_at) else '{}'::jsonb end;$r$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_pretransport_owner_closure_definition_drift';end if;
 execute replace(d,old,replacement);
end $patch$;

revoke all on function private.r12_pilot_pretransport_absence(private.r05_requests,private.r07_attempts),
 private.r12_pilot_marked_request(uuid,uuid),private.r12_pilot_marked_context(uuid),private.r12_pilot_marked_closure_context(uuid),
 private.r12_pilot_marked_closure(uuid),private.r12_pilot_marked_pretransport_reconcile(uuid,uuid,text,text,text),
 private.r12_pilot_terminal_validate_context(private.r12_discovery_scopes,jsonb),private.r12_pilot_terminal_validate(private.r12_discovery_scopes,jsonb),
 private.r12_pilot_terminal_source(private.r12_discovery_scopes,timestamptz,boolean),private.r12_pilot_terminal_release(uuid,uuid),
 private.r12_pilot_pretransport_owner_eligibility(uuid,uuid),private.r12_pilot_pretransport_reconciled(uuid)
 from public,anon,authenticated,service_role;
commit;
