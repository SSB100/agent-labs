-- One append-only R12 saved-review continuation migration.
-- Definition only. No scope/proposal/policy/key/adapter/operation is enrolled.
-- Operator staging inserts the exact envelope and owner proposal. Genuine
-- owner confirmation appends R04 revisions and confirms a one-dispatch R05
-- policy. Separately approved activation registers finite verifier hashes,
-- inserts r12_discovery_authorities, then calls the private initializer.
-- No JWT/session impersonation, new funding root, source timestamp rewrite,
-- provider call, automatic retry or generic controller framework is included.
begin;
-- Source verifier. Old responses retain their original plan, intent and time.
-- p_current controls live evidence/Knowledge freshness only; historical reads
-- never establish fresh authority and still verify all immutable hashes.
create function private.r12_review_source(s private.r12_discovery_scopes,effective_at timestamptz,p_current boolean default true)
returns jsonb language plpgsql stable set search_path='' as $$
declare e jsonb:=s.amendment; src private.r12_discovery_scopes; p private.r07_plans;
 a private.r07_attempts; abandoned private.r07_attempts; phase jsonb; dep jsonb; deps jsonb:='[]';
 pins jsonb:='[]'; key text; n integer:=0; total bigint:=0; installation public.installed_packs;
 source_step jsonb; source_at timestamptz; source_committed bigint; source_authority private.r12_discovery_authorities;
 k jsonb;closure_releases jsonb; required_keys text[]:=array['etsy.current-policy','pod.production','product.research','research.evidence-guide','social.marketing'];
begin
 if e->>'version' is distinct from 'r12.discovery-review-continuation.1' or not isfinite(effective_at) then raise exception 'r12_review_envelope_required';end if;
 select * into src from private.r12_discovery_scopes where id=(e->>'sourceScopeId')::uuid and business_id=s.business_id and goal_id=s.goal_id;
 select * into p from private.r07_plans where id=(e->>'sourcePlanId')::uuid and business_id=s.business_id and goal_id=s.goal_id;
 if src.id is null or p.id is null or src.id=s.id or src.amendment->>'version' is distinct from 'r12.discovery-source-scope.1'
 or src.amendment_hash is distinct from e->>'sourceScopeHash' or src.amendment_hash is distinct from private.stage14_hash(src.amendment)
 or p.content->>'format' is distinct from 'r12.discovery.1' or p.version<>1 or p.previous_plan_id is not null
 or p.content_hash is distinct from e->>'sourcePlanHash' or p.content_hash is distinct from private.r04_hash(p.content)
 or p.content->>'discoveryScopeId' is distinct from src.id::text or p.content->>'discoveryScopeHash' is distinct from src.amendment_hash
 or src.budget_authority_root_id<>s.budget_authority_root_id or src.prior_round_id<>s.prior_round_id
 or e->'allowedDomains' is distinct from src.amendment->'allowedDomains' or e->'excludedDomains' is distinct from src.amendment->'excludedDomains'
 or e->'approvedQuery' is distinct from src.amendment->'approvedQuery' then raise exception 'r12_review_source_identity_changed';end if;
 select * into source_authority from private.r12_discovery_authorities where scope_id=src.id and plan=p.content;
 if source_authority.scope_id is null or not exists(select 1 from private.r05_revocations where policy_id=p.policy_id)
 or not exists(select 1 from private.r07_server_revocations where key_hash=source_authority.controller_key_hash)
 or not exists(select 1 from private.r05_server_revocations where key_hash=source_authority.admission_key_hash)
 then raise exception 'r12_review_original_authority_must_stay_closed';end if;
 select * into abandoned from private.r07_attempts where id=(e->>'sourceReviewAttemptId')::uuid and business_id=s.business_id and plan_id=p.id and step_key='review';
 if abandoned.id is null or abandoned.status not in('scheduled','cancelled') or abandoned.attempt<>1
 or exists(select 1 from private.r05_requests where workflow_run_id=abandoned.id)
 or exists(select 1 from private.r07_bindings where attempt_id=abandoned.id)
 or exists(select 1 from private.r07_markers where attempt_id=abandoned.id)
 or exists(select 1 from private.r07_responses where attempt_id=abandoned.id)
 or exists(select 1 from private.r12_discovery_wires where attempt_id=abandoned.id)
 or (select count(*) from private.r07_attempts where plan_id=p.id)<>5 then raise exception 'r12_review_exact_unsent_predecessor_required';end if;
 if jsonb_typeof(e->'sourcePhases') is distinct from 'array' or jsonb_array_length(e->'sourcePhases')<>4 then raise exception 'r12_review_four_sources_required';end if;
 for phase in select value from jsonb_array_elements(e->'sourcePhases') loop
 perform private.r04_keys(phase,array['stepKey','attemptId','artifactId','responseHash']);
 key:=(array['plan','search1','select1','strategy'])[n+1];
 if phase->>'stepKey' is distinct from key then raise exception 'r12_review_source_order_required';end if;
 select * into a from private.r07_attempts where id=(phase->>'attemptId')::uuid and business_id=s.business_id and plan_id=p.id and step_key=key and attempt=1;
 if a.id is null then raise exception 'r12_review_source_attempt_required';end if;
 dep:=private.r12_discovery_completed_phase(a,p);
 if phase->>'artifactId' is distinct from dep->>'artifactId' or phase->>'responseHash' is distinct from dep->>'responseHash'
 or a.dependency_pins is distinct from pins then raise exception 'r12_review_source_dependency_changed';end if;
 if not exists(select 1 from private.r12_discovery_receipt_checks c join private.r12_discovery_receipt_observations o on o.check_id=c.id
 where c.request_id=(dep->'binding'->>'requestId')::uuid and o.proof=dep->'proof'
 and o.created_at>=(dep->'binding'->>'dispatchedAt')::timestamptz and o.created_at<(dep->'binding'->>'receiptExpiresAt')::timestamptz)
 then raise exception 'r12_review_original_receipt_time_unverified';end if;
 total:=total+(dep->'candidate'->>'reportedMicrousd')::bigint;
 deps:=deps||jsonb_build_array(dep);
 pins:=pins||jsonb_build_array(jsonb_build_object('stepKey',key,'attemptId',a.id,'resultHash',dep->>'responseHash'));
 if key='search1' and p_current and ((dep->'candidate'->>'receivedAt')::timestamptz>effective_at or (dep->'candidate'->>'receivedAt')::timestamptz+interval '1 day'<=effective_at) then raise exception 'r12_review_source_evidence_expired';end if;
 if key='strategy' then
 source_at:=(dep->'binding'->>'dispatchedAt')::timestamptz;
 source_committed:=(dep->'binding'->'request'->'requestMetadata'->>'r12CommittedBeforeAttemptMicrousd')::bigint;
 select value into source_step from jsonb_array_elements(p.content->'steps') x where x->>'key'='strategy';
 end if;
 n:=n+1;
 end loop;
 if abandoned.dependency_pins is distinct from pins or e->'baseDispatches' is distinct from '4'::jsonb or e->'baseChildren' is distinct from '5'::jsonb
 or e->>'baseKnownMicrounits' is distinct from total::text or total<0 or source_committed is null or source_committed<0 or source_at is null
 or source_at>=(src.amendment->>'expiresAt')::timestamptz then raise exception 'r12_review_source_totals_changed';end if;
 select * into installation from public.installed_packs where id=(source_step->>'installationId')::uuid and business_id=s.business_id;
 if installation.id is null or private.r04_hash(installation.snapshot) is distinct from source_step->>'packSnapshotHash' then raise exception 'r12_review_source_knowledge_changed';end if;
 if p_current then
 with recursive releases as (select value item from jsonb_array_elements(installation.snapshot->'releases')),
 reached(item) as (
 select item from releases where item->>'id'=installation.snapshot->>'rootPackId'
 union
 select r.item from reached parent cross join lateral jsonb_array_elements(parent.item->'manifest'->'dependencies') dependency
 join releases r on r.item->'manifest'->>'packKey'=dependency->>'packKey' and r.item->'manifest'->>'version'=dependency->>'version'
 ) select coalesce(jsonb_agg(item),'[]'::jsonb) into closure_releases from reached;
 if jsonb_array_length(closure_releases)=0 or exists(select 1 from jsonb_array_elements(closure_releases) parent cross join lateral jsonb_array_elements(parent->'manifest'->'dependencies') dependency
 where (select count(*) from jsonb_array_elements(closure_releases) child where child->'manifest'->>'packKey'=dependency->>'packKey' and child->'manifest'->>'version'=dependency->>'version')<>1) then raise exception 'r12_review_source_knowledge_closure_required';end if;
 if installation.status<>'active' then raise exception 'r12_review_source_knowledge_inactive';end if;
 foreach key in array required_keys loop
 if (select count(*) from jsonb_array_elements(closure_releases) release cross join lateral jsonb_array_elements(release->'manifest'->'knowledge') item where item->>'key'=key)<>1 then raise exception 'r12_review_source_knowledge_required';end if;
 select item into k from jsonb_array_elements(closure_releases) release cross join lateral jsonb_array_elements(release->'manifest'->'knowledge') item where item->>'key'=key;
 if (k->>'verifiedAt')::timestamptz>effective_at or (k->>'freshnessDays')::integer not between 1 and 365 or (k->>'verifiedAt')::timestamptz+make_interval(days=>(k->>'freshnessDays')::integer)<=effective_at then raise exception 'r12_review_source_knowledge_expired';end if;
 end loop;
 end if;
 return jsonb_build_object('sourceAmendment',src.amendment,'sourcePlan',p.content,'sourceValidationAt',source_at,'sourceCommittedMicrousd',source_committed,
 'dependencies',deps,'dependencyPins',pins,'knowledgeSnapshot',installation.snapshot,'knowledgeSnapshotHash',private.r04_hash(installation.snapshot),'knowledgeCanonicalHash',private.stage14_hash(installation.snapshot));
end $$;

create function private.r12_validate_review_envelope(s private.r12_discovery_scopes) returns void language plpgsql set search_path='' as $$
declare e jsonb:=s.amendment;k text;source jsonb;h private.r07_heads;begin
 perform private.r04_keys(e,array['version','id','businessId','goalId','budgetAuthorityRootId','priorRoundId','sourceScopeId','sourceScopeHash','sourcePlanId','sourcePlanHash','sourceReviewAttemptId','sourcePhases','baseDispatches','baseChildren','baseKnownMicrounits','allowedDomains','excludedDomains','approvedQuery','approvalHash','independentReviewHash','createdAt','expiresAt']);
 foreach k in array array['id','businessId','goalId','budgetAuthorityRootId','priorRoundId','sourceScopeId','sourcePlanId','sourceReviewAttemptId'] loop
 if jsonb_typeof(e->k) is distinct from 'string' or e->>k !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then raise exception 'r12_review_identity_invalid';end if;end loop;
 foreach k in array array['sourceScopeHash','sourcePlanHash','approvalHash','independentReviewHash'] loop
 if jsonb_typeof(e->k) is distinct from 'string' or e->>k !~ '^[a-f0-9]{64}$' then raise exception 'r12_review_hash_invalid';end if;end loop;
 if e->>'id' is distinct from s.id::text or e->>'businessId' is distinct from s.business_id::text or e->>'goalId' is distinct from s.goal_id::text
 or e->>'budgetAuthorityRootId' is distinct from s.budget_authority_root_id::text or e->>'priorRoundId' is distinct from s.prior_round_id::text
 or s.id in(s.budget_authority_root_id,s.prior_round_id,(e->>'sourceScopeId')::uuid) or s.amendment_hash is distinct from private.stage14_hash(e)
 or jsonb_typeof(e->'baseKnownMicrounits') is distinct from 'string' or e->>'baseKnownMicrounits' !~ '^(0|[1-9][0-9]{0,15})$'
 then raise exception 'r12_review_envelope_identity_mismatch';end if;
 foreach k in array array['createdAt','expiresAt'] loop
 if jsonb_typeof(e->k) is distinct from 'string' or not isfinite((e->>k)::timestamptz) then raise exception 'r12_review_window_invalid';end if;end loop;
 if (e->>'createdAt')::timestamptz>clock_timestamp() or (e->>'expiresAt')::timestamptz<=clock_timestamp()
 or (e->>'expiresAt')::timestamptz<=(e->>'createdAt')::timestamptz or (e->>'expiresAt')::timestamptz>(e->>'createdAt')::timestamptz+interval '1 day'
 then raise exception 'r12_review_window_invalid';end if;
 source:=private.r12_review_source(s,clock_timestamp(),true);
 select * into h from private.r07_heads where business_id=s.business_id and goal_id=s.goal_id;
 if h.plan_id is distinct from (e->>'sourcePlanId')::uuid or h.dispatches<>(e->>'baseDispatches')::integer or h.children_created<>(e->>'baseChildren')::integer
 or h.repairs_used<>0 or h.pivots_used<>0 then raise exception 'r12_review_current_predecessor_required';end if;
end $$;

create unique index r12_one_review_continuation_per_source on private.r12_discovery_scopes((amendment->>'sourcePlanId'))
where amendment->>'version'='r12.discovery-review-continuation.1';

-- Only invoked by the approved operator activation transaction, after genuine
-- owner R04/R05 confirmation and registration of the fresh finite authority.
create function private.r12_initialize_review_continuation(p_scope_id uuid) returns jsonb language plpgsql set search_path='' as $$
declare s private.r12_discovery_scopes;q private.r12_discovery_authorities;source jsonb;prior private.r07_plans;next_plan private.r07_plans;h private.r07_heads;
 abandoned private.r07_attempts;pin jsonb;step jsonb;actor uuid;begin
 select * into s from private.r12_discovery_scopes where id=p_scope_id;
 if s.id is null or s.amendment->>'version' is distinct from 'r12.discovery-review-continuation.1' then raise exception 'r12_review_envelope_required';end if;
 perform 1 from public.businesses where id=s.business_id for update;
 perform 1 from public.product_experiments where id=s.budget_authority_root_id and business_id=s.business_id for update;
 select * into h from private.r07_heads where business_id=s.business_id and goal_id=s.goal_id for update;
 select * into q from private.r12_discovery_authorities where scope_id=s.id for share;
 if q.scope_id is null or q.plan->>'format' is distinct from 'r12.discovery-review.1' or q.valid_until<=clock_timestamp() or not private.r12_authority_owner_current(q) then raise exception 'r12_review_authority_required';end if;
 perform private.r12_discovery_key(q.controller_key_hash);
 perform 1 from private.r05_server_keys where key_hash=q.admission_key_hash and expires_at>clock_timestamp() for share;
 if not found or exists(select 1 from private.r05_server_revocations where key_hash=q.admission_key_hash) then raise exception 'r12_review_admission_authority_required';end if;
 select * into next_plan from private.r07_plans where business_id=s.business_id and goal_id=s.goal_id and content=q.plan;
 if next_plan.id is not null then
 if h.plan_id<>next_plan.id or (select count(*) from private.r07_reused where plan_id=next_plan.id)<>4 then raise exception 'r12_review_initializer_replay_conflict';end if;
 return jsonb_build_object('planId',next_plan.id,'planHash',next_plan.content_hash,'replayed',true,'shouldDispatch',false);
 end if;
 perform private.r12_validate_review_envelope(s);
 source:=private.r12_review_source(s,clock_timestamp(),true);
 select * into prior from private.r07_plans where id=(s.amendment->>'sourcePlanId')::uuid;
 select * into abandoned from private.r07_attempts where id=(s.amendment->>'sourceReviewAttemptId')::uuid for update;
 if abandoned.status<>'scheduled' then raise exception 'r12_review_predecessor_already_retired';end if;
 if exists(select 1 from private.r07_attempts where business_id=s.business_id and goal_id=s.goal_id and id<>abandoned.id and status in('scheduled','reserved','dispatched','uncertain','responded')) then raise exception 'r12_review_pending_lineage_required';end if;
 perform private.r07_validate_plan(s.business_id,s.goal_id,q.plan);
 select owner_user_id into actor from public.businesses where id=s.business_id;
 insert into private.r07_core_admissions values(txid_current(),abandoned.id) on conflict do nothing;
 update private.r07_attempts set status='cancelled',reason='cancelled_unsent' where id=abandoned.id;
 update public.workflow_runs set status='cancelled',completed_at=clock_timestamp() where id=abandoned.id;
 update public.task_contracts set status='cancelled' where id=private.stage4_deterministic_uuid('r07:task:'||abandoned.id);
 update public.worker_runs set status='cancelled',completed_at=clock_timestamp() where id=private.stage4_deterministic_uuid('r07:worker:'||abandoned.id);
 update public.workflow_stage_runs set status='skipped',completed_at=clock_timestamp() where id=private.stage4_deterministic_uuid('r07:stage:'||abandoned.id);
 delete from private.r07_core_admissions where transaction_id=txid_current() and workflow_run_id=abandoned.id;
 insert into private.r07_plans(business_id,goal_id,version,previous_plan_id,policy_id,owner_id,content,content_hash,reason,evidence_hash)
 values(s.business_id,s.goal_id,prior.version+1,prior.id,(q.plan->>'policyId')::uuid,actor,q.plan,q.plan_hash,'Approved remaining independent review',s.amendment_hash) returning * into next_plan;
 for pin in select value from jsonb_array_elements(source->'dependencyPins') loop
 insert into private.r07_reused(plan_id,step_key,business_id,attempt_id) values(next_plan.id,pin->>'stepKey',s.business_id,(pin->>'attemptId')::uuid);
 end loop;
 if (select count(*) from private.r07_reused where plan_id=next_plan.id)<>4 then raise exception 'r12_review_knowledge_reuse_rejected';end if;
 select value into step from jsonb_array_elements(q.plan->'steps');
 if private.r07_dependencies(next_plan.id,step) is distinct from source->'dependencyPins' then raise exception 'r12_review_reuse_pin_mismatch';end if;
 update private.r07_heads set plan_id=next_plan.id,revision=revision+1,state='ready',reason='review_continuation_ready',lease_epoch=lease_epoch+1,lease_hash=null,lease_expires_at=null
 where goal_id=s.goal_id and business_id=s.business_id and plan_id=prior.id;
 if not found then raise exception 'r12_review_head_changed';end if;
 if private.r07_gate(next_plan,step) is not null then raise exception 'r12_review_successor_not_admissible';end if;
 insert into private.r07_events(business_id,goal_id,plan_id,attempt_id,operation,payload)
 values(s.business_id,s.goal_id,prior.id,abandoned.id,'cancel',jsonb_build_object('status','cancelled','reason','cancelled_unsent','successorPlanId',next_plan.id,'shouldDispatch',false)),
 (s.business_id,s.goal_id,next_plan.id,null,'review_continuation',jsonb_build_object('sourcePlanId',prior.id,'sourceScopeId',s.amendment->>'sourceScopeId','scopeId',s.id,'sourcePhases',s.amendment->'sourcePhases','shouldDispatch',false));
 perform private.r12_discovery_key(q.controller_key_hash);
 if exists(select 1 from private.r05_server_revocations where key_hash=q.admission_key_hash) or q.valid_until<=clock_timestamp() then raise exception 'r12_review_activation_expired';end if;
 return jsonb_build_object('planId',next_plan.id,'planHash',next_plan.content_hash,'replayed',false,'shouldDispatch',false);
end $$;

create function private.r12_review_phase_inputs(a private.r07_attempts,p private.r07_plans)
returns jsonb language plpgsql set search_path='' as $$
declare s private.r12_discovery_scopes;prior public.product_experiments;source jsonb;budget jsonb;c private.r12_discovery_candidates;
 own_held bigint:=0;own_pending bigint:=0;validation_at timestamptz:=clock_timestamp();input_mode text:='dispatch';output jsonb;begin
 if p.content->>'format' is distinct from 'r12.discovery-review.1' or a.plan_id<>p.id or a.business_id<>p.business_id or a.step_key<>'review' then raise exception 'r12_review_attempt_required';end if;
 select own_candidate.* into c from private.r12_discovery_candidates own_candidate join private.r12_discovery_wires own_wire on own_wire.request_id=own_candidate.request_id where own_wire.attempt_id=a.id and own_wire.business_id=p.business_id;
 if c.request_id is not null and private.r12_discovery_receipt_status(c)->>'status'='verified' then
 select created_at into strict validation_at from private.r05_markers where request_id=c.request_id;input_mode:='receipt';
 s:=private.r12_discovery_scope_at(p,validation_at);
 else s:=private.r12_discovery_scope_current(p);end if;
 source:=private.r12_review_source(s,validation_at,true);
 if a.dependency_pins is distinct from source->'dependencyPins'
 or exists(select 1 from jsonb_array_elements(source->'dependencyPins') pin where not exists(select 1 from private.r07_reused r where r.plan_id=p.id and r.business_id=p.business_id and r.step_key=pin->>'stepKey' and r.attempt_id=(pin->>'attemptId')::uuid))
 or (select count(*) from private.r07_reused where plan_id=p.id)<>4 then raise exception 'r12_review_exact_reuse_required';end if;
 if p.content->'steps'->0->>'packSnapshotHash' is distinct from source->>'knowledgeSnapshotHash' then raise exception 'r12_review_knowledge_changed';end if;
 select * into strict prior from public.product_experiments where id=s.prior_round_id and business_id=p.business_id;
 budget:=private.stage13v2_budget_authority(s.prior_round_id,true);
 select coalesce(sum(e.held),0),coalesce(sum(e.held) filter(where e.is_pending),0) into own_held,own_pending
 from private.r12_discovery_exposure(s.budget_authority_root_id) e join private.r05_requests req on req.id=e.request_id where req.workflow_run_id=a.id;
 output:=jsonb_build_object('version','r12.discovery-review-inputs.1','businessId',p.business_id,'planId',p.id,'attemptId',a.id,'inputMode',input_mode,'validationAt',validation_at,
 'knowledgeSnapshot',source->'knowledgeSnapshot','knowledgeSnapshotHash',source->>'knowledgeSnapshotHash','knowledgeCanonicalHash',source->>'knowledgeCanonicalHash',
 'original',jsonb_build_object('businessId',s.business_id,'budgetAuthorityRootId',s.budget_authority_root_id,'priorRoundId',s.prior_round_id,'semanticGoalHash',prior.variables->>'semanticGoalHash','priorIntent',prior.variables->'intent','maximumMicrousd',budget->'maximumMicrousd','committedMicrousd',(budget->>'committedMicrousd')::bigint-own_held,'hasUncertainCosts',(budget->>'pendingExposureMicrousd')::bigint>own_pending),
 'amendment',s.amendment,'sourceAmendment',source->'sourceAmendment','sourceValidationAt',source->'sourceValidationAt','sourceCommittedMicrousd',source->'sourceCommittedMicrousd','dependencies',source->'dependencies');
 if octet_length(output::text)>524288 then raise exception 'r12_complete_input_bound';end if;
 if input_mode='receipt' then
 if private.r12_discovery_receipt_status(c)->>'status' is distinct from 'verified' then raise exception 'r12_receipt_grace_ended';end if;
 perform private.r12_discovery_scope_at(p,validation_at);
 else perform private.r12_discovery_scope_current(p);end if;
 return output;
end $$;

create function private.r12_review_result(s private.r12_discovery_scopes) returns jsonb language plpgsql stable set search_path='' as $$
declare p private.r07_plans;a private.r07_attempts;source jsonb;current_phase jsonb;prior public.product_experiments;step jsonb;at_time timestamptz;committed bigint;output jsonb;begin
 select * into p from private.r07_plans where business_id=s.business_id and goal_id=s.goal_id and content->>'format'='r12.discovery-review.1' and content->>'discoveryScopeId'=s.id::text order by version desc limit 1;
 select * into a from private.r07_attempts where plan_id=p.id and business_id=s.business_id and step_key='review' and status='completed' order by private.r07_attempts.attempt desc limit 1;
 if a.id is null then return null;end if;
 if p.content->>'discoveryScopeHash' is distinct from s.amendment_hash or s.amendment_hash is distinct from private.stage14_hash(s.amendment) then raise exception 'r12_review_result_scope_unverified';end if;
 current_phase:=private.r12_discovery_completed_phase(a,p);at_time:=(current_phase->'binding'->>'dispatchedAt')::timestamptz;
 source:=private.r12_review_source(s,at_time,false);
 if a.dependency_pins is distinct from source->'dependencyPins' or exists(select 1 from jsonb_array_elements(source->'dependencyPins') pin where not exists(select 1 from private.r07_reused r where r.plan_id=p.id and r.business_id=p.business_id and r.step_key=pin->>'stepKey' and r.attempt_id=(pin->>'attemptId')::uuid)) then raise exception 'r12_review_result_reuse_unverified';end if;
 step:=p.content->'steps'->0;
 if step->>'packSnapshotHash' is distinct from source->>'knowledgeSnapshotHash' then raise exception 'r12_review_result_knowledge_unverified';end if;
 committed:=(current_phase->'binding'->'request'->'requestMetadata'->>'r12CommittedBeforeAttemptMicrousd')::bigint;
 select * into prior from public.product_experiments where id=s.prior_round_id and business_id=s.business_id;
 if prior.id is null or committed is null or committed<0 or committed>=(prior.variables->'intent'->'limits'->>'maximumMicrousd')::bigint then raise exception 'r12_review_result_budget_unverified';end if;
 output:=jsonb_build_object('version','r12.discovery-saved-result.1','context',jsonb_build_object('planId',p.id,'planHash',p.content_hash,'plan',p.content,'step',step,
 'attempt',jsonb_build_object('id',a.id,'stepKey',a.step_key,'attempt',a.attempt,'status',a.status,'reason',a.reason,'inputHash',a.input_hash,'dependencyPins',a.dependency_pins,'repairEvidenceHash',a.repair_evidence_hash,'wireHash',null,'requestId',current_phase->'binding'->'requestId','responseHash',current_phase->'responseHash'),
 'knowledge',jsonb_build_object('format','r09.1','businessId',s.business_id,'planId',p.id,'pins','[]'::jsonb)),
 'inputs',jsonb_build_object('version','r12.discovery-review-inputs.1','businessId',s.business_id,'planId',p.id,'attemptId',a.id,'inputMode','receipt','validationAt',at_time,
 'knowledgeSnapshot',source->'knowledgeSnapshot','knowledgeSnapshotHash',source->>'knowledgeSnapshotHash','knowledgeCanonicalHash',source->>'knowledgeCanonicalHash',
 'original',jsonb_build_object('businessId',s.business_id,'budgetAuthorityRootId',s.budget_authority_root_id,'priorRoundId',s.prior_round_id,'semanticGoalHash',prior.variables->>'semanticGoalHash','priorIntent',prior.variables->'intent','maximumMicrousd',prior.variables->'intent'->'limits'->'maximumMicrousd','committedMicrousd',committed,'hasUncertainCosts',false),
 'amendment',s.amendment,'sourceAmendment',source->'sourceAmendment','sourceValidationAt',source->'sourceValidationAt','sourceCommittedMicrousd',source->'sourceCommittedMicrousd','dependencies',source->'dependencies'),'current',current_phase);
 if octet_length(output::text)>655360 then raise exception 'r12_completed_history_bound';end if;return output;
end $$;

-- Immutable owner review packet. Staging creates no permission or key.
create table private.r12_review_owner_proposals(
 scope_id uuid primary key references private.r12_discovery_scopes(id),business_id uuid not null references public.businesses(id),owner_id uuid not null references auth.users(id),
 proposal jsonb not null,proposal_hash text not null,created_at timestamptz not null default clock_timestamp(),
 check(proposal_hash=private.stage14_hash(proposal) and octet_length(proposal::text)<=32768)
);
create table private.r12_review_owner_confirmations(
 scope_id uuid primary key references private.r12_review_owner_proposals(scope_id),business_id uuid not null references public.businesses(id),actor_id uuid not null references auth.users(id),
 proposal_hash text not null,policy_id uuid not null,policy_hash text not null,business_revision integer not null,goal_revision integer not null,created_at timestamptz not null default clock_timestamp(),
 foreign key(policy_id,business_id) references private.r05_policies(id,business_id)
);
alter table private.r12_review_owner_proposals enable row level security;
alter table private.r12_review_owner_confirmations enable row level security;
revoke all on private.r12_review_owner_proposals,private.r12_review_owner_confirmations from public,anon,authenticated,service_role;
create trigger r12_review_proposal_immutable before insert or update or delete on private.r12_review_owner_proposals for each row execute function private.r12_discovery_history_guard();
create trigger r12_review_confirmation_immutable before insert or update or delete on private.r12_review_owner_confirmations for each row execute function private.r12_discovery_history_guard();

create function private.r12_review_owner_proposal_validate(q private.r12_review_owner_proposals,p_current boolean default true) returns void language plpgsql set search_path='' as $$
declare v jsonb:=q.proposal;s private.r12_discovery_scopes;p jsonb;src jsonb;b private.r04_business_versions;g private.r04_goal_versions;cap private.r05_cap_versions;op jsonb;k text;begin
 perform private.r04_safe(v);
 perform private.r04_keys(v,array['version','scopeId','scopeHash','businessId','ownerId','goalId','expectedBusinessRevision','expectedBusinessHash','expectedGoalRevision','expectedGoalHash','businessContent','goalContent','operatingPolicy','interpretationHash']);
 select * into s from private.r12_discovery_scopes where id=q.scope_id and business_id=q.business_id;
 if s.id is null or s.amendment->>'version' is distinct from 'r12.discovery-review-continuation.1'
 or v->>'version' is distinct from 'r12.review-owner-proposal.1' or v->>'scopeId' is distinct from q.scope_id::text or v->>'scopeHash' is distinct from s.amendment_hash
 or v->>'businessId' is distinct from q.business_id::text or v->>'ownerId' is distinct from q.owner_id::text or v->>'goalId' is distinct from s.goal_id::text
 or q.proposal_hash is distinct from private.stage14_hash(v) then raise exception 'r12_review_owner_proposal_identity';end if;
 foreach k in array array['expectedBusinessHash','expectedGoalHash','interpretationHash'] loop
 if jsonb_typeof(v->k) is distinct from 'string' or v->>k !~ '^[a-f0-9]{64}$' then raise exception 'r12_review_owner_proposal_hash';end if;end loop;
 foreach k in array array['expectedBusinessRevision','expectedGoalRevision'] loop
 if jsonb_typeof(v->k) is distinct from 'number' or v->>k !~ '^[1-9][0-9]{0,8}$' then raise exception 'r12_review_owner_proposal_revision';end if;end loop;
 select * into b from private.r04_business_versions where business_id=q.business_id and revision=(v->>'expectedBusinessRevision')::integer;
 select * into g from private.r04_goal_versions where business_id=q.business_id and goal_id=s.goal_id and revision=(v->>'expectedGoalRevision')::integer;
 if b.content_hash is distinct from v->>'expectedBusinessHash' or g.content_hash is distinct from v->>'expectedGoalHash'
 or jsonb_typeof(v->'businessContent') is distinct from 'object' or jsonb_typeof(v->'goalContent') is distinct from 'object'
 or v->'goalContent'->'objective' is distinct from g.content->'objective' or v->'goalContent'->'originalIntent' is distinct from g.content->'originalIntent'
 or (select jsonb_agg(x order by x) from jsonb_array_elements_text(v->'goalContent'->'parsed'->'geography') x) is distinct from (select jsonb_agg(x order by x) from jsonb_array_elements_text(g.content->'parsed'->'geography') x)
 or v->'goalContent'->'parsed'->'budget' is distinct from g.content->'parsed'->'budget'
 then raise exception 'r12_review_owner_original_goal_changed';end if;
 p:=v->'operatingPolicy';
 if p->>'version' is distinct from 'r05.1' or p->>'goalId' is distinct from s.goal_id::text or p->'businessRevision' is distinct from to_jsonb(b.revision+1) or p->'goalRevision' is distinct from to_jsonb(g.revision+2)
 or p->>'currency' is distinct from 'USD' or p->'maximumDispatches' is distinct from '1'::jsonb or p->>'financialMode' is distinct from 'bounded_model_cost_only'
 or p->'stopOnTarget' is distinct from 'false'::jsonb or jsonb_typeof(p->'operations') is distinct from 'array' or jsonb_array_length(p->'operations')<>1
 or p->'categoryLimits' is distinct from jsonb_build_array(jsonb_build_object('category','model','microunits',p->>'policyLimitMicrounits'))
 or (p->>'expiresAt')::timestamptz>(s.amendment->>'expiresAt')::timestamptz or (p->>'expiresAt')::timestamptz<=(p->>'startsAt')::timestamptz
 then raise exception 'r12_review_owner_exact_policy_required';end if;
 op:=p->'operations'->0;
 if op->>'operationKey' is distinct from 'research.r12.'||s.id||'.review' or op->>'maximumPerOperationMicrounits' is distinct from p->>'policyLimitMicrounits'
 or op->>'provider' is distinct from 'openrouter' or op->'accountId' is distinct from 'null'::jsonb or op->'accountRevision' is distinct from 'null'::jsonb
 or op->'sourceDomains' is distinct from s.amendment->'allowedDomains' then raise exception 'r12_review_owner_reviewer_only';end if;
 if p_current then
 if not exists(select 1 from public.businesses where id=q.business_id and owner_user_id=q.owner_id)
 or not exists(select 1 from private.r04_business_state where business_id=q.business_id and revision=b.revision)
 or not exists(select 1 from private.r04_goal_state where business_id=q.business_id and goal_id=s.goal_id and revision=g.revision)
 or (s.amendment->>'expiresAt')::timestamptz<=clock_timestamp() or (p->>'expiresAt')::timestamptz<=clock_timestamp() then raise exception 'r12_review_owner_proposal_stale';end if;
 select * into cap from private.r05_cap_versions where business_id=q.business_id and currency='USD' order by revision desc limit 1;
 if cap.business_id is null or p->>'businessLifetimeLimitMicrounits' is distinct from cap.maximum_microunits::text or p->'expectedCapRevision' is distinct from to_jsonb(cap.revision)
 or exists(select 1 from private.r05_exposure(q.business_id) where unknown)
 or (select coalesce(sum(held),0)::text from private.r05_exposure(q.business_id) where currency='USD') is distinct from p->>'expectedExposureMicrounits'
 then raise exception 'r12_review_owner_original_cap_changed';end if;
 src:=private.r12_review_source(s,clock_timestamp(),true);
 perform private.r12_validate_review_envelope(s);
 end if;
end $$;
create function private.r12_review_owner_proposal_insert() returns trigger language plpgsql set search_path='' as $$ begin perform private.r12_review_owner_proposal_validate(new,true);return new;end $$;
create trigger r12_review_owner_proposal_insert before insert on private.r12_review_owner_proposals for each row execute function private.r12_review_owner_proposal_insert();

create function public.r12_review_owner_read(p_business_id uuid,p_scope_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare q private.r12_review_owner_proposals;c private.r12_review_owner_confirmations;s private.r12_discovery_scopes;eligible boolean:=false;reason text;begin
 if private.is_business_owner(p_business_id) is distinct from true then raise exception 'r12_owner_required' using errcode='42501';end if;
 if (select count(*) from private.r12_review_owner_proposals proposal join private.r12_discovery_scopes scope on scope.id=proposal.scope_id where proposal.business_id=p_business_id and proposal.owner_id=auth.uid() and (proposal.scope_id=p_scope_id or scope.amendment->>'sourceScopeId'=p_scope_id::text))>1 then raise exception 'r12_review_owner_proposal_ambiguous';end if;
 select proposal.* into q from private.r12_review_owner_proposals proposal join private.r12_discovery_scopes scope on scope.id=proposal.scope_id where proposal.business_id=p_business_id and proposal.owner_id=auth.uid() and (proposal.scope_id=p_scope_id or scope.amendment->>'sourceScopeId'=p_scope_id::text);if q.scope_id is null then return null;end if;
 select * into s from private.r12_discovery_scopes where id=q.scope_id;
 select * into c from private.r12_review_owner_confirmations where scope_id=q.scope_id;
 if c.scope_id is null then
 begin perform private.r12_review_owner_proposal_validate(q,true);eligible:=true;exception when others then reason:='proposal_no_longer_current';end;
 else reason:='already_confirmed';end if;
 return jsonb_build_object('version','r12.review-owner-workspace.1','businessId',p_business_id,'scopeId',q.scope_id,'scope',s.amendment,'proposalHash',q.proposal_hash,'proposal',q.proposal,
 'confirmation',case when c.scope_id is null then null else jsonb_build_object('policyId',c.policy_id,'policyHash',c.policy_hash,'businessRevision',c.business_revision,'goalRevision',c.goal_revision) end,'eligible',eligible,'reason',reason);
end $$;

create function public.r12_review_owner_confirm(p_business_id uuid,p_scope_id uuid,p_proposal_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare q private.r12_review_owner_proposals;c private.r12_review_owner_confirmations;s private.r12_discovery_scopes;session_id uuid:=private.r11_auth_session();v jsonb;r jsonb;op jsonb;begin
 perform private.r05_owner(p_business_id);
 perform 1 from auth.sessions where id=session_id and user_id=auth.uid() for share;
 if not private.r11_session(auth.uid(),session_id) then raise exception 'r12_review_owner_session_required' using errcode='42501';end if;
 select * into s from private.r12_discovery_scopes where id=p_scope_id and business_id=p_business_id;
 if s.id is null then raise exception 'r12_review_owner_proposal_required';end if;
 perform 1 from public.product_experiments where id=s.budget_authority_root_id and business_id=p_business_id for update;
 select * into q from private.r12_review_owner_proposals where scope_id=p_scope_id and business_id=p_business_id and owner_id=auth.uid() for share;
 if q.scope_id is null or q.proposal_hash is distinct from p_proposal_hash then raise exception 'r12_review_exact_owner_proposal_required';end if;
 select * into c from private.r12_review_owner_confirmations where scope_id=q.scope_id;
 if c.scope_id is not null then
 if c.actor_id<>auth.uid() or c.proposal_hash<>q.proposal_hash then raise exception 'r12_review_owner_confirmation_conflict';end if;
 return jsonb_build_object('scopeId',c.scope_id,'policyId',c.policy_id,'policyHash',c.policy_hash,'businessRevision',c.business_revision,'goalRevision',c.goal_revision,'replayed',true,'executionAuthorized',false);
 end if;
 perform private.r12_review_owner_proposal_validate(q,true);v:=q.proposal;
 r:=public.r04_quest_transition(p_business_id,'business.save',jsonb_build_object('expectedRevision',v->'expectedBusinessRevision','content',v->'businessContent','preference','setup'),private.stage4_deterministic_uuid('r12:review-owner:'||s.id||':business'));
 if r->'revision' is distinct from to_jsonb((v->>'expectedBusinessRevision')::integer+1) then raise exception 'r12_review_business_revision_unverified';end if;
 r:=public.r04_quest_transition(p_business_id,'quest.save',jsonb_build_object('goalId',s.goal_id,'expectedRevision',v->'expectedGoalRevision','content',v->'goalContent'),private.stage4_deterministic_uuid('r12:review-owner:'||s.id||':goal'));
 if r->'revision' is distinct from to_jsonb((v->>'expectedGoalRevision')::integer+1) then raise exception 'r12_review_goal_revision_unverified';end if;
 r:=public.r04_quest_transition(p_business_id,'quest.preference',jsonb_build_object('goalId',s.goal_id,'expectedRevision',(v->>'expectedGoalRevision')::integer+1,'preference','ready'),private.stage4_deterministic_uuid('r12:review-owner:'||s.id||':ready'));
 if r->'revision' is distinct from to_jsonb((v->>'expectedGoalRevision')::integer+2) then raise exception 'r12_review_goal_ready_unverified';end if;
 op:=public.r05_policy_owner(p_business_id,'propose',v->'operatingPolicy',private.stage4_deterministic_uuid('r12:review-owner:'||s.id||':propose'));
 perform public.r05_policy_owner(p_business_id,'confirm',jsonb_build_object('policyId',op->>'id','policyHash',op->>'hash'),private.stage4_deterministic_uuid('r12:review-owner:'||s.id||':confirm'));
 insert into private.r05_policy_proofs(policy_id,policy_hash,evidence_hash,valid_until) values((op->>'id')::uuid,op->>'hash',v->>'interpretationHash',(v->'operatingPolicy'->>'expiresAt')::timestamptz);
 insert into private.r12_review_owner_confirmations(scope_id,business_id,actor_id,proposal_hash,policy_id,policy_hash,business_revision,goal_revision)
 values(s.id,p_business_id,auth.uid(),q.proposal_hash,(op->>'id')::uuid,op->>'hash',(v->>'expectedBusinessRevision')::integer+1,(v->>'expectedGoalRevision')::integer+2) returning * into c;
 if not private.r11_session(auth.uid(),session_id) or (s.amendment->>'expiresAt')::timestamptz<=clock_timestamp() then raise exception 'r12_review_owner_confirmation_expired';end if;
 perform private.r12_review_source(s,clock_timestamp(),true);
 return jsonb_build_object('scopeId',c.scope_id,'policyId',c.policy_id,'policyHash',c.policy_hash,'businessRevision',c.business_revision,'goalRevision',c.goal_revision,'replayed',false,'executionAuthorized',false);
end $$;
revoke all on function public.r12_review_owner_read(uuid,uuid),public.r12_review_owner_confirm(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.r12_review_owner_read(uuid,uuid),public.r12_review_owner_confirm(uuid,uuid,text) to authenticated;


-- private.r12_discovery_scope_validate
CREATE OR REPLACE FUNCTION private.r12_discovery_scope_validate()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare prior public.product_experiments; goal private.r04_goal_versions; a jsonb; scope jsonb; domains text[]; excluded text[]; item jsonb; d text; begin
 if current_user in ('anon','authenticated','service_role') then raise exception 'r12_trusted_scope_registration_required' using errcode='42501';end if;
 if tg_op<>'INSERT' then raise exception 'r12_immutable_source_amendment';end if;
 perform 1 from public.businesses where id=new.business_id for update;
 a:=new.amendment;
 if a->>'version'='r12.discovery-review-continuation.1' then perform private.r04_safe(a);perform private.r12_validate_review_envelope(new);return new;end if;
 perform private.r04_safe(a);
 perform private.r04_keys(a,array['version','id','businessId','goalId','budgetAuthorityRootId','priorRoundId','originalIntentHash','originalSemanticGoalHash','allowedDomains','excludedDomains','sourceReviews','approvalHash','independentReviewHash','purposeReviewHash','approvedQuery','createdAt','expiresAt']);
 if a->>'version' is distinct from 'r12.discovery-source-scope.1' or a->>'id' is distinct from new.id::text or a->>'businessId' is distinct from new.business_id::text or a->>'goalId' is distinct from new.goal_id::text or a->>'budgetAuthorityRootId' is distinct from new.budget_authority_root_id::text or a->>'priorRoundId' is distinct from new.prior_round_id::text or new.id in(new.budget_authority_root_id,new.prior_round_id) then raise exception 'r12_scope_identity_mismatch';end if;
 foreach d in array array['originalIntentHash','originalSemanticGoalHash','approvalHash','independentReviewHash','purposeReviewHash'] loop
 if jsonb_typeof(a->d) is distinct from 'string' or a->>d !~ '^[a-f0-9]{64}$' then raise exception 'r12_review_pin_required';end if;end loop;
 if jsonb_typeof(a->'approvedQuery') is distinct from 'string' or length(a->>'approvedQuery') not between 20 and 800 or btrim(a->>'approvedQuery') is distinct from a->>'approvedQuery' or a->>'purposeReviewHash' is distinct from private.stage14_hash(jsonb_build_object('query',a->>'approvedQuery','classification','generic_nonpersonal_public_research')) then raise exception 'r12_reviewed_public_query_required';end if;
 if new.amendment_hash is distinct from private.stage14_hash(a) then raise exception 'r12_amendment_hash_mismatch';end if;
 select * into strict prior from public.product_experiments where id=new.prior_round_id and business_id=new.business_id and discovery_version='pod-discovery-2.0' and parent_discovery_id is null and candidate_id is null;
 if prior.status not in ('failed','completed') or prior.variables->>'budgetAuthorityRootId' is distinct from new.budget_authority_root_id::text or prior.variables->>'semanticGoalHash' is distinct from a->>'originalSemanticGoalHash' or private.stage14_hash(prior.variables->'intent') is distinct from a->>'originalIntentHash' then raise exception 'r12_original_scope_mismatch';end if;
 if exists(select 1 from public.product_experiments e where e.business_id=new.business_id and e.discovery_version='pod-discovery-2.0' and e.parent_discovery_id is null and e.candidate_id is null and e.variables->>'budgetAuthorityRootId'=new.budget_authority_root_id::text and (e.created_at,e.id)>(prior.created_at,prior.id)) then raise exception 'r12_latest_round_required';end if;
 scope:=private.stage13v2_budget_authority(prior.id,true);
 if scope->'hasUncertainCosts' is distinct from 'false'::jsonb or (scope->>'remainingMicrousd')::bigint<=0 then raise exception 'r12_shared_funding_unavailable';end if;
 select v.* into goal from private.r04_goal_versions v join private.r04_goal_state s using(goal_id,business_id,revision) where v.goal_id=new.goal_id and v.business_id=new.business_id;
 if goal.goal_id is null or goal.preference<>'ready' or goal.content->>'objective' is distinct from prior.variables->'intent'->>'objective' or (select jsonb_agg(x order by x) from jsonb_array_elements_text(goal.content->'parsed'->'geography') x) is distinct from (select jsonb_agg(x->>'countryCode' order by x->>'countryCode') from jsonb_array_elements(prior.variables->'intent'->'comparisonUniverse'->'markets') x) then raise exception 'r12_original_goal_required';end if;
 if jsonb_typeof(a->'createdAt') is distinct from 'string' or jsonb_typeof(a->'expiresAt') is distinct from 'string' or (a->>'createdAt')::timestamptz>clock_timestamp() or (a->>'expiresAt')::timestamptz<=clock_timestamp() or (a->>'expiresAt')::timestamptz>(a->>'createdAt')::timestamptz+interval '1 day' then raise exception 'r12_amendment_expired';end if;
 perform private.r04_strings(a->'allowedDomains',4);perform private.r04_strings(a->'excludedDomains',32);
 select array_agg(x) into domains from jsonb_array_elements_text(a->'allowedDomains') x;
 select array_agg(x) into excluded from jsonb_array_elements_text(a->'excludedDomains') x;
 if coalesce(cardinality(domains),0)<1 or (array['etsy.com','etsy.me','etsystatic.com']<@excluded) is distinct from true or cardinality(domains)<>(select count(distinct x) from unnest(domains) x) or cardinality(excluded)<>(select count(distinct x) from unnest(excluded) x) then raise exception 'r12_source_scope_invalid';end if;
 foreach d in array domains||excluded loop
 if length(d)>253 or d !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' or d like '%.local' or d like '%.internal' then raise exception 'r12_source_scope_invalid';end if;end loop;
 if exists(select 1 from unnest(domains) allowed_domain cross join unnest(excluded) blocked_domain where allowed_domain=blocked_domain or allowed_domain like '%.'||blocked_domain or blocked_domain like '%.'||allowed_domain) then raise exception 'r12_restricted_source';end if;
 if jsonb_typeof(a->'sourceReviews') is distinct from 'array' or jsonb_array_length(a->'sourceReviews')<>cardinality(domains) or (select count(distinct x->>'domain') from jsonb_array_elements(a->'sourceReviews') x)<>cardinality(domains) then raise exception 'r12_source_reviews_required';end if;
 for item in select value from jsonb_array_elements(a->'sourceReviews') loop
 perform private.r04_keys(item,array['domain','basis','reviewHash']);
 if jsonb_typeof(item->'domain') is distinct from 'string' or jsonb_typeof(item->'reviewHash') is distinct from 'string' or not(item->>'domain'=any(domains)) or item->>'basis' is distinct from 'documented_api_factual_snippets' or item->>'reviewHash' !~ '^[a-f0-9]{64}$' then raise exception 'r12_source_reviews_required';end if;end loop;
 return new;
end $function$;

-- private.r07_validate_plan
CREATE OR REPLACE FUNCTION private.r07_validate_plan(b uuid, g uuid, p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare s jsonb; k text; seen text[]:='{}'; first_key text; challenge_key text; total numeric:=0; policy private.r05_policies; scope jsonb; n integer:=0; dep text; discovery boolean:=coalesce(p->>'format' in ('r12.discovery.1','r12.discovery-review.1'),false);review_cont boolean:=coalesce(p->>'format'='r12.discovery-review.1',false);source jsonb;old_review jsonb; discovery_keys text[]:=array['plan','search1','select1','strategy','review']; binding private.r12_discovery_scopes; original public.product_experiments; budget jsonb; begin
 perform private.r07_safe(p);
 perform private.r04_keys(p,array['format','businessId','goalId','goalRevision','goalHash','businessRevision','businessHash','policyId','policyHash','authorityRootId','plannerWorkerDefinitionId','currency','maximumMicrounits','deadline','expiresAt','maximumRepairs','maximumPivots','maximumChildren','maximumDispatches','requiredChecks','finishCondition','stopConditions','steps']||case when discovery then array['discoveryScopeId','discoveryScopeHash'] else array[]::text[] end);
 if (not discovery and p->>'format' is distinct from 'r07.1') or p->>'businessId' is distinct from b::text or p->>'goalId' is distinct from g::text or p->>'authorityRootId' is distinct from b::text or p->>'currency' is distinct from 'USD' then raise exception 'r07_invalid_lineage'; end if;
 foreach k in array array['goalRevision','businessRevision','maximumRepairs','maximumPivots','maximumChildren','maximumDispatches'] loop
 if jsonb_typeof(p->k) is distinct from 'number' or p->>k !~ '^(0|[1-9][0-9]{0,8})$' then raise exception 'r07_invalid_integer'; end if;
 end loop;
 if (p->>'maximumRepairs')::integer>8 or (p->>'maximumPivots')::integer>3 or (p->>'maximumChildren')::integer not between 2 and 32 or (p->>'maximumDispatches')::integer not between 2 and 64 then raise exception 'r07_invalid_bounds'; end if;
 if not exists(select 1 from private.r04_goal_versions where business_id=b and goal_id=g and revision=(p->>'goalRevision')::integer and content_hash=p->>'goalHash') or not exists(select 1 from private.r04_business_versions where business_id=b and revision=(p->>'businessRevision')::integer and content_hash=p->>'businessHash') then raise exception 'r07_invalid_version_pins'; end if;
 if review_cont then
 select * into binding from private.r12_discovery_scopes where id=(p->>'discoveryScopeId')::uuid and business_id=b and goal_id=g and amendment_hash=p->>'discoveryScopeHash';
 if binding.id is null or binding.amendment->>'version' is distinct from 'r12.discovery-review-continuation.1' then raise exception 'r07_review_scope_unavailable';end if;
 source:=private.r12_review_source(binding,clock_timestamp(),true);
 select value into old_review from jsonb_array_elements(source->'sourcePlan'->'steps') x where x->>'key'='review';
 end if;
 select * into policy from private.r05_policies where id=(p->>'policyId')::uuid and business_id=b and goal_id=g;
 if policy.id is null or policy.content_hash is distinct from p->>'policyHash' or policy.goal_revision<>(p->>'goalRevision')::integer or policy.business_revision<>(p->>'businessRevision')::integer then raise exception 'r07_policy_pin_mismatch'; end if;
 if not exists(select 1 from public.worker_definitions where id=(p->>'plannerWorkerDefinitionId')::uuid and (status in ('qualified','assisted','autonomous') or status='experimental' and worker_key='product.discovery-v2.plan' and version='1.0.0' and private.r12_plan_qualification(b,g,p))) then raise exception 'r07_planner_unqualified'; end if;
 foreach k in array array['deadline','expiresAt'] loop
 if jsonb_typeof(p->k) is distinct from 'string' or p->>k !~ '^\d{4}-\d\d-\d\dT.+(Z|[+-]\d\d:\d\d)$' then raise exception 'r07_invalid_time'; end if;
 end loop;
 if (p->>'expiresAt')::timestamptz>(policy.payload->>'expiresAt')::timestamptz or (p->>'expiresAt')::timestamptz>(p->>'deadline')::timestamptz or (p->>'expiresAt')::timestamptz<=clock_timestamp() or (private.r05_money(p->'maximumMicrounits')-case when review_cont then (binding.amendment->>'baseKnownMicrounits')::bigint else 0 end) not between 1 and private.r05_money(policy.payload->'policyLimitMicrounits') or ((p->>'maximumDispatches')::integer-case when review_cont then (binding.amendment->>'baseDispatches')::integer else 0 end)>(policy.payload->>'maximumDispatches')::integer then raise exception 'r07_parent_scope_exceeded'; end if;
 if p->>'finishCondition' is distinct from 'all_required_outputs_verified' or p->'stopConditions' is distinct from '["no_permitted_work","deadline","repair_exhausted","owner_stopped"]'::jsonb then raise exception 'r07_invalid_stop_conditions'; end if;
 if jsonb_typeof(p->'steps') is distinct from 'array' or jsonb_array_length(p->'steps') not between (case when review_cont then 1 else 2 end) and 16 or jsonb_array_length(p->'steps')>(p->>'maximumChildren')::integer or jsonb_array_length(p->'steps')>(p->>'maximumDispatches')::integer then raise exception 'r07_invalid_steps'; end if;
 if discovery then
 if review_cont then
 if jsonb_array_length(p->'steps')<>1 or p->'maximumChildren'<>to_jsonb((binding.amendment->>'baseChildren')::integer+1) or p->'maximumDispatches'<>to_jsonb((binding.amendment->>'baseDispatches')::integer+1) or p->'maximumRepairs'<>'0' or p->'maximumPivots'<>'0' or p->'requiredChecks'<>'["review"]'::jsonb
 or policy.payload->'maximumDispatches'<>'1'::jsonb or jsonb_array_length(policy.payload->'operations')<>1
 or private.r05_money(p->'maximumMicrounits')<>(binding.amendment->>'baseKnownMicrounits')::bigint+private.r05_money(policy.payload->'policyLimitMicrounits')
 or p->>'plannerWorkerDefinitionId' is distinct from source->'sourcePlan'->>'plannerWorkerDefinitionId'
 then raise exception 'r07_review_topology_invalid';end if;
 else
 if p->>'discoveryScopeId' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' or p->>'discoveryScopeHash' !~ '^[a-f0-9]{64}$' or jsonb_typeof(p->'discoveryScopeId') is distinct from 'string' or jsonb_typeof(p->'discoveryScopeHash') is distinct from 'string' or jsonb_array_length(p->'steps')<>5 or p->'maximumChildren'<>'5' or p->'maximumDispatches'<>'5' or p->'maximumRepairs'<>'0' or p->'maximumPivots'<>'0' or p->'requiredChecks'<>'["review"]'::jsonb then raise exception 'r07_discovery_topology_invalid';end if;
 end if;
 select * into binding from private.r12_discovery_scopes where id=(p->>'discoveryScopeId')::uuid and business_id=b and goal_id=g and amendment_hash=p->>'discoveryScopeHash';
 if binding.id is null or (not review_cont and binding.amendment->>'version' is distinct from 'r12.discovery-source-scope.1') or (binding.amendment->>'expiresAt')::timestamptz<(p->>'expiresAt')::timestamptz then raise exception 'r07_discovery_scope_unavailable';end if;
 select * into strict original from public.product_experiments where id=binding.prior_round_id and business_id=b;
 if exists(select 1 from public.product_experiments newer where newer.business_id=b and newer.discovery_version='pod-discovery-2.0' and newer.parent_discovery_id is null and newer.candidate_id is null and newer.variables->>'budgetAuthorityRootId'=binding.budget_authority_root_id::text and (newer.created_at,newer.id)>(original.created_at,original.id)) or not exists(select 1 from private.r04_goal_versions gv join private.r04_goal_state gs using(goal_id,business_id,revision) where gv.goal_id=g and gv.business_id=b and gv.preference='ready' and gv.revision=(p->>'goalRevision')::integer and gv.content->>'objective'=original.variables->'intent'->>'objective' and (select jsonb_agg(x order by x) from jsonb_array_elements_text(gv.content->'parsed'->'geography') x)=(select jsonb_agg(x->>'countryCode' order by x->>'countryCode') from jsonb_array_elements(original.variables->'intent'->'comparisonUniverse'->'markets') x)) then raise exception 'r07_discovery_original_scope_changed';end if;
 budget:=private.stage13v2_budget_authority(original.id,true);
 if budget->'hasUncertainCosts' is distinct from 'false'::jsonb or (private.r05_money(p->'maximumMicrounits')-(case when review_cont then (binding.amendment->>'baseKnownMicrounits')::bigint else 0 end))>(budget->>'remainingMicrousd')::bigint then raise exception 'r07_discovery_shared_budget_exceeded';end if;
 end if;
 for s in select value from jsonb_array_elements(p->'steps') loop
 perform private.r04_keys(s,array['key','kind','objective','reason','adapter','qualificationHash','installationId','packSnapshotHash','workflowDefinitionId','workerDefinitionId','role','operationKey','purpose','dependsOn','expectedArtifactType','maximumMicrounits','expiresAt','notBefore','measurement','maximumRepairs']);
 foreach k in array array['key','kind','objective','reason','adapter','qualificationHash','installationId','packSnapshotHash','workflowDefinitionId','workerDefinitionId','role','operationKey','purpose','expectedArtifactType','expiresAt','notBefore'] loop
 if jsonb_typeof(s->k) is distinct from 'string' or length(btrim(s->>k)) not between 1 and 240 then raise exception 'r07_invalid_step_type'; end if;
 end loop;
 if s->>'key' !~ '^[a-z][a-z0-9_-]{0,39}$' or s->>'key'=any(seen) or s->>'qualificationHash' !~ '^[a-f0-9]{64}$' or s->>'packSnapshotHash' !~ '^[a-f0-9]{64}$' then raise exception 'r07_invalid_step_identity'; end if;
 if jsonb_typeof(s->'maximumRepairs') is distinct from 'number' or s->>'maximumRepairs' !~ '^[0-3]$' or (s->>'maximumRepairs')::integer>(p->>'maximumRepairs')::integer then raise exception 'r07_invalid_repair_bound'; end if;
 perform private.r04_strings(s->'dependsOn',16);
 if (select count(*)<>count(distinct x) from jsonb_array_elements_text(s->'dependsOn') x) then raise exception 'r07_duplicate_dependency'; end if;
 for dep in select jsonb_array_elements_text(s->'dependsOn') loop if not dep=any(seen) and not(review_cont and dep=any(array['plan','search1','select1','strategy'])) then raise exception 'r07_invalid_dependencies'; end if; end loop;
 if s->>'kind' not in ('research','challenge','work','review','measure') then raise exception 'r07_invalid_kind'; end if;
 if discovery then
 if review_cont then
 if n<>0 or s->>'key' is distinct from 'review' or s->>'kind' is distinct from 'review' or s->>'role' is distinct from 'review'
 or s->>'adapter' is distinct from 'r12.discovery.'||(p->>'discoveryScopeId')||'.review' or s->>'operationKey' is distinct from 'research.r12.'||(p->>'discoveryScopeId')||'.review'
 or s->>'expectedArtifactType' is distinct from 'r12.discovery.review' or s->'maximumRepairs'<>'0' or s->'measurement'<>'null'::jsonb or s->'dependsOn' is distinct from '["plan","search1","select1","strategy"]'::jsonb
 or private.r05_money(s->'maximumMicrounits')<>private.r05_money(policy.payload->'policyLimitMicrounits')
 or s->>'installationId' is distinct from old_review->>'installationId' or s->>'packSnapshotHash' is distinct from old_review->>'packSnapshotHash'
 or s->>'workflowDefinitionId' is distinct from old_review->>'workflowDefinitionId' or s->>'workerDefinitionId' is distinct from old_review->>'workerDefinitionId'
 or exists(select 1 from jsonb_array_elements(source->'sourcePlan'->'steps') os where os->>'key'<>'review' and os->>'workerDefinitionId'=s->>'workerDefinitionId')
 then raise exception 'r07_review_topology_invalid';end if;challenge_key:='review';
 else
 if s->>'key' is distinct from discovery_keys[n+1] or s->>'kind' is distinct from (case when n=1 then 'research' when n=4 then 'review' else 'work' end) or s->>'adapter' is distinct from 'r12.discovery.'||(p->>'discoveryScopeId')||'.'||discovery_keys[n+1] or s->>'role' is distinct from discovery_keys[n+1] or s->>'operationKey' is distinct from 'research.r12.'||(p->>'discoveryScopeId')||'.'||discovery_keys[n+1] or s->>'expectedArtifactType' is distinct from 'r12.discovery.'||discovery_keys[n+1] or s->'maximumRepairs'<>'0' or s->'measurement'<>'null'::jsonb or s->'dependsOn' is distinct from to_jsonb(discovery_keys[1:n]) then raise exception 'r07_discovery_topology_invalid';end if;
 if n=4 then challenge_key:='review';end if;
 end if;
 elsif n=0 then first_key:=s->>'key'; if s->>'kind'<>'research' or s->'dependsOn'<>'[]' then raise exception 'r07_research_first'; end if;
 elsif n=1 then challenge_key:=s->>'key'; if s->>'kind'<>'challenge' or not(s->'dependsOn' ? first_key) then raise exception 'r07_challenge_second'; end if;
 elsif not(s->'dependsOn' ? challenge_key) then raise exception 'r07_challenge_required'; end if;
 if s->>'kind' in ('challenge','review') and ((s->>'workerDefinitionId')::uuid=(p->>'plannerWorkerDefinitionId')::uuid or exists(select 1 from jsonb_array_elements(p->'steps') x where s->'dependsOn' ? (x->>'key') and (x->>'workerDefinitionId')::uuid=(s->>'workerDefinitionId')::uuid)) then raise exception 'r07_independent_check_required'; end if;
 select value into scope from jsonb_array_elements(policy.payload->'operations') x where x->>'operationKey'=s->>'operationKey';
 if scope is null or scope->>'purpose' is distinct from s->>'purpose' or scope->>'workflowDefinitionId' is distinct from s->>'workflowDefinitionId' or scope->>'installationId' is distinct from s->>'installationId' then raise exception 'r07_child_scope_widened'; end if;
 if not exists(select 1 from public.installed_packs where id=(s->>'installationId')::uuid and business_id=b and private.r04_hash(snapshot)=s->>'packSnapshotHash') then raise exception 'r07_snapshot_mismatch'; end if;
 foreach k in array array['expiresAt','notBefore'] loop
 if s->>k !~ '^\d{4}-\d\d-\d\dT.+(Z|[+-]\d\d:\d\d)$' then raise exception 'r07_invalid_time'; end if;
 end loop;
 if private.r05_money(s->'maximumMicrounits') not between 1 and private.r05_money(p->'maximumMicrounits') or (s->>'expiresAt')::timestamptz>(p->>'expiresAt')::timestamptz or (s->>'notBefore')::timestamptz>=(s->>'expiresAt')::timestamptz then raise exception 'r07_child_scope_widened'; end if;
 if s->'measurement'<>'null'::jsonb then
 perform private.r04_keys(s->'measurement',array['minimumObservations','closesAt']);
 if jsonb_typeof(s->'measurement'->'closesAt') is distinct from 'string' or s->'measurement'->>'closesAt' !~ '^\d{4}-\d\d-\d\dT.+(Z|[+-]\d\d:\d\d)$' or s->>'kind'<>'measure' or jsonb_typeof(s->'measurement'->'minimumObservations') is distinct from 'number' or s->'measurement'->>'minimumObservations' !~ '^[1-9][0-9]{0,8}$' or (s->'measurement'->>'closesAt')::timestamptz<=(s->>'notBefore')::timestamptz or (s->'measurement'->>'closesAt')::timestamptz>(s->>'expiresAt')::timestamptz then raise exception 'r07_invalid_measurement'; end if;
 elsif s->>'kind'='measure' then raise exception 'r07_measurement_required'; end if;
 total:=total+private.r05_money(s->'maximumMicrounits'); seen:=array_append(seen,s->>'key'); n:=n+1;
 end loop;
 if total>private.r05_money(p->'maximumMicrounits') then raise exception 'r07_plan_budget_exceeded'; end if;
 perform private.r04_strings(p->'requiredChecks',16);
 if not(p->'requiredChecks' ? challenge_key) or exists(select 1 from jsonb_array_elements_text(p->'requiredChecks') ck where not exists(select 1 from jsonb_array_elements(p->'steps') cs where cs->>'key'=ck and cs->>'kind' in ('challenge','review'))) or (select count(*)<>count(distinct ck) from jsonb_array_elements_text(p->'requiredChecks') ck) then raise exception 'r07_invalid_required_checks'; end if;
end $function$;

-- private.r07_gate
CREATE OR REPLACE FUNCTION private.r07_gate(p private.r07_plans, s jsonb DEFAULT NULL::jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare pol private.r05_policies; a private.r07_adapters; scope jsonb; begin
 if not coalesce(p.content->>'format' in ('r07.1','r12.discovery.1','r12.discovery-review.1'),false) then return 'plan_format_unavailable';end if;
 if p.content->>'format' in ('r12.discovery.1','r12.discovery-review.1') then
 begin perform private.r12_discovery_scope_current(p);exception when others then return 'discovery_scope_unavailable';end;
 end if;
 if p.content->>'format' in ('r12.discovery.1','r12.discovery-review.1') and not private.r12_plan_qualification(p.business_id,p.goal_id,p.content) then return 'discovery_authority_unavailable';end if;
 select * into pol from private.r05_policies where id=p.policy_id;
 if not exists(select 1 from public.businesses where id=p.business_id and owner_user_id=p.owner_id and owner_user_id=pol.actor_id) then return 'owner_changed'; end if;
 if not exists(select 1 from private.r05_confirmations where policy_id=pol.id and actor_id=p.owner_id) or exists(select 1 from private.r05_revocations where policy_id=pol.id) then return 'policy_not_confirmed'; end if;
 if not exists(select 1 from private.r04_goal_state where goal_id=p.goal_id and business_id=p.business_id and revision=(p.content->>'goalRevision')::integer) or not exists(select 1 from private.r04_business_state where business_id=p.business_id and revision=(p.content->>'businessRevision')::integer) then return 'intent_revision_changed'; end if;
 if not exists(select 1 from private.r04_goal_versions where goal_id=p.goal_id and business_id=p.business_id and revision=(p.content->>'goalRevision')::integer and preference='ready') or not exists(select 1 from private.r04_business_versions where business_id=p.business_id and revision=(p.content->>'businessRevision')::integer and preference='setup') then return 'owner_stopped'; end if;
 if clock_timestamp()>=(p.content->>'expiresAt')::timestamptz or clock_timestamp()>=(p.content->>'deadline')::timestamptz or clock_timestamp()>=(pol.payload->>'expiresAt')::timestamptz then return 'deadline'; end if;
 if clock_timestamp()<(pol.payload->>'startsAt')::timestamptz then return 'not_started'; end if;
 if not exists(select 1 from private.r05_policy_proofs where policy_id=pol.id and policy_hash=pol.content_hash and valid_until>clock_timestamp()) then return 'rules_interpretation_unqualified'; end if;
 if private.r05_paused(p.business_id,'business',p.business_id) or private.r05_paused(p.business_id,'quest',p.goal_id) then return 'scope_paused'; end if;
 if s is null then return null; end if;
 select * into a from private.r07_adapters where adapter_key=s->>'adapter' for share;
 if (a.mode='qualification' and not coalesce(p.content->>'format' in ('r12.discovery.1','r12.discovery-review.1'),false)) or a.adapter_key is null or a.qualification_hash is distinct from s->>'qualificationHash' or a.workflow_definition_id::text is distinct from s->>'workflowDefinitionId' or a.worker_definition_id::text is distinct from s->>'workerDefinitionId' or a.role is distinct from s->>'role' or a.operation_key is distinct from s->>'operationKey' or a.purpose is distinct from s->>'purpose' or a.artifact_type is distinct from s->>'expectedArtifactType' or exists(select 1 from private.r07_adapter_revocations where adapter_key=a.adapter_key) then return 'adapter_unqualified'; end if;
 if clock_timestamp()<a.valid_from or clock_timestamp()>=a.valid_until or clock_timestamp()>=a.knowledge_valid_until then return 'qualification_or_knowledge_expired'; end if;
 if clock_timestamp()>=(s->>'expiresAt')::timestamptz then return 'step_expired'; end if;
 if clock_timestamp()<(s->>'notBefore')::timestamptz or (s->>'kind'='measure' and clock_timestamp()<(s->'measurement'->>'closesAt')::timestamptz) then return 'measurement_wait'; end if;
 perform 1 from public.worker_definitions wd where id=a.worker_definition_id and (status in ('qualified','assisted','autonomous') or status='experimental' and a.mode='qualification' and private.r12_plan_qualification(p.business_id,p.goal_id,p.content)) and private.r04_hash(to_jsonb(wd))=a.worker_hash for share;
 if not found then return 'worker_unqualified'; end if;
 perform 1 from public.workflow_definitions fd where id=a.workflow_definition_id and (status in ('qualified','assisted','autonomous') or status='experimental' and a.mode='qualification' and private.r12_plan_qualification(p.business_id,p.goal_id,p.content)) and private.r04_hash(to_jsonb(fd))=a.workflow_hash for share;
 if not found then return 'workflow_unqualified'; end if;
 perform 1 from public.installed_packs where id=(s->>'installationId')::uuid and business_id=p.business_id and status='active' and private.r04_hash(snapshot)=s->>'packSnapshotHash' for share;
 if not found then return 'pack_unavailable'; end if;
 select value into scope from jsonb_array_elements(pol.payload->'operations') x where x->>'operationKey'=s->>'operationKey';
 if private.r05_paused(p.business_id,'pack',(s->>'installationId')::uuid) or (scope->>'accountId' is not null and private.r05_paused(p.business_id,'account',(scope->>'accountId')::uuid)) then return 'scope_paused'; end if;
 if scope->>'accountId' is not null then
 perform 1 from private.connected_accounts where id=(scope->>'accountId')::uuid and business_id=p.business_id and owner_id=p.owner_id and connection_revision::text=scope->>'accountRevision' and status='connected' and revoked_at is null for share;
 if not found then return 'account_unavailable'; end if;
 end if;
 return null;
end $function$;

-- private.r12_discovery_scope_current
CREATE OR REPLACE FUNCTION private.r12_discovery_scope_current(p private.r07_plans)
 RETURNS private.r12_discovery_scopes
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare s private.r12_discovery_scopes; prior public.product_experiments; begin
 perform 1 from public.businesses where id=p.business_id and owner_user_id=p.owner_id for update;
 if not found then raise exception 'r12_owner_changed';end if;
 select * into s from private.r12_discovery_scopes where id=(p.content->>'discoveryScopeId')::uuid and business_id=p.business_id and goal_id=p.goal_id and amendment_hash=p.content->>'discoveryScopeHash';
 if not coalesce(p.content->>'format' in ('r12.discovery.1','r12.discovery-review.1'),false) or s.id is null then raise exception 'r12_scope_binding_required';end if;
 if p.content->>'format'='r12.discovery-review.1' then
 if s.amendment->>'version' is distinct from 'r12.discovery-review-continuation.1' then raise exception 'r12_scope_binding_required';end if;
 perform private.r12_review_source(s,clock_timestamp(),true);
 elsif s.amendment->>'version' is distinct from 'r12.discovery-source-scope.1' then raise exception 'r12_scope_binding_required';end if;
 perform 1 from public.product_experiments where id=s.budget_authority_root_id and business_id=p.business_id for update;
 select * into strict prior from public.product_experiments where id=s.prior_round_id and business_id=p.business_id;
 if prior.status not in ('failed','completed') or (s.amendment->>'expiresAt')::timestamptz<=clock_timestamp() or exists(select 1 from public.product_experiments newer where newer.business_id=p.business_id and newer.discovery_version='pod-discovery-2.0' and newer.parent_discovery_id is null and newer.candidate_id is null and newer.variables->>'budgetAuthorityRootId'=s.budget_authority_root_id::text and (newer.created_at,newer.id)>(prior.created_at,prior.id)) then raise exception 'r12_scope_no_longer_current';end if;
 if not exists(select 1 from private.r04_goal_versions gv join private.r04_goal_state gs using(goal_id,business_id,revision) where gv.goal_id=p.goal_id and gv.business_id=p.business_id and gv.preference='ready' and gv.revision=(p.content->>'goalRevision')::integer and gv.content_hash=p.content->>'goalHash' and gv.content->>'objective'=prior.variables->'intent'->>'objective' and (select jsonb_agg(x order by x) from jsonb_array_elements_text(gv.content->'parsed'->'geography') x)=(select jsonb_agg(x->>'countryCode' order by x->>'countryCode') from jsonb_array_elements(prior.variables->'intent'->'comparisonUniverse'->'markets') x)) then raise exception 'r12_original_goal_changed';end if;
 return s;
end $function$;

-- private.r12_discovery_scope_at
CREATE OR REPLACE FUNCTION private.r12_discovery_scope_at(p private.r07_plans, effective_at timestamp with time zone)
 RETURNS private.r12_discovery_scopes
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare s private.r12_discovery_scopes; prior public.product_experiments; begin
 perform 1 from public.businesses where id=p.business_id and owner_user_id=p.owner_id for update;
 if not found then raise exception 'r12_owner_changed';end if;
 select * into s from private.r12_discovery_scopes where id=(p.content->>'discoveryScopeId')::uuid and business_id=p.business_id and goal_id=p.goal_id and amendment_hash=p.content->>'discoveryScopeHash';
 if not coalesce(p.content->>'format' in ('r12.discovery.1','r12.discovery-review.1'),false) or s.id is null then raise exception 'r12_scope_binding_required';end if;
 if p.content->>'format'='r12.discovery-review.1' then
 if s.amendment->>'version' is distinct from 'r12.discovery-review-continuation.1' then raise exception 'r12_scope_binding_required';end if;
 perform private.r12_review_source(s,effective_at,true);
 elsif s.amendment->>'version' is distinct from 'r12.discovery-source-scope.1' then raise exception 'r12_scope_binding_required';end if;
 perform 1 from public.product_experiments where id=s.budget_authority_root_id and business_id=p.business_id for update;
 select * into strict prior from public.product_experiments where id=s.prior_round_id and business_id=p.business_id;
 if prior.status not in ('failed','completed') or (s.amendment->>'expiresAt')::timestamptz<=effective_at or exists(select 1 from public.product_experiments newer where newer.business_id=p.business_id and newer.discovery_version='pod-discovery-2.0' and newer.parent_discovery_id is null and newer.candidate_id is null and newer.variables->>'budgetAuthorityRootId'=s.budget_authority_root_id::text and (newer.created_at,newer.id)>(prior.created_at,prior.id)) then raise exception 'r12_scope_no_longer_current';end if;
 if not exists(select 1 from private.r04_goal_versions gv join private.r04_goal_state gs using(goal_id,business_id,revision) where gv.goal_id=p.goal_id and gv.business_id=p.business_id and gv.preference='ready' and gv.revision=(p.content->>'goalRevision')::integer and gv.content_hash=p.content->>'goalHash' and gv.content->>'objective'=prior.variables->'intent'->>'objective' and (select jsonb_agg(x order by x) from jsonb_array_elements_text(gv.content->'parsed'->'geography') x)=(select jsonb_agg(x->>'countryCode' order by x->>'countryCode') from jsonb_array_elements(prior.variables->'intent'->'comparisonUniverse'->'markets') x)) then raise exception 'r12_original_goal_changed';end if;
 return s;
end $function$;

-- private.r12_discovery_exposure
CREATE OR REPLACE FUNCTION private.r12_discovery_exposure(root_id uuid)
 RETURNS TABLE(request_id uuid, business_id uuid, held bigint, actual bigint, is_pending boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select r.id,r.business_id,coalesce(settled.actual,r.liability_microunits),settled.actual,settled.actual is null
 from private.r12_discovery_scopes scope
 join private.r07_plans p on p.business_id=scope.business_id and p.goal_id=scope.goal_id and p.content->>'format' in ('r12.discovery.1','r12.discovery-review.1') and p.content->>'discoveryScopeId'=scope.id::text and p.content->>'discoveryScopeHash'=scope.amendment_hash
 join private.r07_attempts a on a.plan_id=p.id and a.business_id=p.business_id
 join private.r05_requests r on r.workflow_run_id=a.id and r.business_id=a.business_id and r.policy_id=p.policy_id and r.payload->>'operationKey'='research.r12.'||scope.id::text||'.'||a.step_key and r.payload->'accounting'='{"kind":"r05"}'::jsonb
 join private.r05_reservations reserved on reserved.request_id=r.id and reserved.business_id=r.business_id
 left join lateral(select max(actual_microunits) actual from private.r05_settlements where request_id=r.id and business_id=r.business_id and provider_request_id is not null) settled on true
 where scope.budget_authority_root_id=root_id and not exists(select 1 from private.r05_releases released where released.request_id=r.id)
$function$;

-- private.r12_plan_qualification
CREATE OR REPLACE FUNCTION private.r12_plan_qualification(b uuid, g uuid, v jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select exists(select 1 from private.r12_discovery_authorities q join private.r12_discovery_scopes s on s.id=q.scope_id
 where q.business_id=b and q.goal_id=g and q.plan=v and q.plan_hash=private.r04_hash(v) and v->>'format' in ('r12.discovery.1','r12.discovery-review.1') and v->>'discoveryScopeId'=s.id::text and v->>'discoveryScopeHash'=s.amendment_hash and ((v->>'format'='r12.discovery.1' and s.amendment->>'version'='r12.discovery-source-scope.1') or (v->>'format'='r12.discovery-review.1' and s.amendment->>'version'='r12.discovery-review-continuation.1')) and q.valid_until>clock_timestamp() and private.r12_authority_owner_current(q))
$function$;

-- private.r12_authority_validate
CREATE OR REPLACE FUNCTION private.r12_authority_validate()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare s private.r12_discovery_scopes;step jsonb;adapter private.r07_adapters;wd public.worker_definitions;fd public.workflow_definitions;begin
 perform 1 from public.businesses where id=new.business_id for update;
 select * into s from private.r12_discovery_scopes where id=new.scope_id and business_id=new.business_id and goal_id=new.goal_id;
 if s.id is null or not coalesce(new.plan->>'format' in ('r12.discovery.1','r12.discovery-review.1'),false) or new.plan->>'discoveryScopeId' is distinct from s.id::text or new.plan->>'discoveryScopeHash' is distinct from s.amendment_hash or new.valid_until is distinct from (new.plan->>'expiresAt')::timestamptz or new.valid_until<=clock_timestamp() or new.valid_until>clock_timestamp()+interval '30 minutes' or new.valid_until>(s.amendment->>'expiresAt')::timestamptz then raise exception 'r12_bounded_authority_required';end if;
 if (new.plan->>'format'='r12.discovery.1') is distinct from (s.amendment->>'version'='r12.discovery-source-scope.1') or (new.plan->>'format'='r12.discovery-review.1') is distinct from (s.amendment->>'version'='r12.discovery-review-continuation.1') then raise exception 'r12_scope_format_mismatch';end if;
 if new.plan->>'format'='r12.discovery-review.1' and not exists(select 1 from private.r12_review_owner_confirmations confirmed where confirmed.scope_id=new.scope_id and confirmed.business_id=new.business_id and confirmed.policy_id=(new.plan->>'policyId')::uuid and confirmed.policy_hash=new.plan->>'policyHash' and confirmed.business_revision=(new.plan->>'businessRevision')::integer and confirmed.goal_revision=(new.plan->>'goalRevision')::integer) then raise exception 'r12_review_owner_confirmation_required';end if;
 if not exists(select 1 from private.r07_server_keys where key_hash=new.controller_key_hash and expires_at>=new.receipt_until and expires_at<=new.receipt_until+interval '5 seconds') or not exists(select 1 from private.r05_server_keys where key_hash=new.admission_key_hash and expires_at>=new.receipt_until and expires_at<=new.receipt_until+interval '5 seconds') then raise exception 'r12_exact_authority_window_required';end if;
 if exists(select 1 from private.r05_server_keys where key_hash=new.controller_key_hash) or exists(select 1 from private.r07_server_keys where key_hash=new.admission_key_hash) then raise exception 'r12_separate_scoped_key_roles_required';end if;
 if exists(select 1 from private.r07_server_revocations where key_hash=new.controller_key_hash) or exists(select 1 from private.r05_server_revocations where key_hash=new.admission_key_hash) then raise exception 'r12_authority_revoked';end if;
 for step in select value from jsonb_array_elements(new.plan->'steps') loop
 select * into adapter from private.r07_adapters where adapter_key=step->>'adapter' and qualification_hash=step->>'qualificationHash';
 select * into wd from public.worker_definitions where id=adapter.worker_definition_id;select * into fd from public.workflow_definitions where id=adapter.workflow_definition_id;
 if adapter.adapter_key is null or adapter.mode<>new.mode or adapter.operation_key is distinct from 'research.r12.'||s.id||'.'||(step->>'key') or private.r04_hash(to_jsonb(wd)) is distinct from adapter.worker_hash or private.r04_hash(to_jsonb(fd)) is distinct from adapter.workflow_hash then raise exception 'r12_exact_definition_qualification_required';end if;
 if new.mode='qualification' and (wd.worker_key is distinct from 'product.discovery-v2.'||(case when step->>'key' in ('search1','select1') then 'research' else step->>'key' end) or wd.version<>'1.0.0' or fd.version<>'1.0.0' or fd.workflow_key<>'product.discovery-v2.one' or wd.status not in ('experimental','qualified','assisted','autonomous') or fd.status not in ('experimental','qualified','assisted','autonomous')) then raise exception 'r12_existing_discovery_definition_required';end if;
 end loop;
 -- AFTER INSERT makes this exact scope row visible to the narrow experimental
 -- planner exception. Any invalid plan rolls the entire registration back.
 perform private.r07_validate_plan(new.business_id,new.goal_id,new.plan);return new;
end $function$;

-- private.r12_controller_keys
CREATE OR REPLACE FUNCTION private.r12_controller_keys(b uuid, g uuid, v jsonb, controller_hash text, admission_hash text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if (v is null or v->>'format'='r07.1') and not exists(select 1 from private.r12_discovery_authorities q where q.controller_key_hash in (controller_hash,admission_hash) or q.admission_key_hash in (controller_hash,admission_hash)) then return;end if;
 if v is not null and not coalesce(v->>'format' in ('r12.discovery.1','r12.discovery-review.1'),false) then raise exception 'r12_exact_scoped_controller_authority_required';end if;
 if not exists(select 1 from private.r12_discovery_authorities q where q.business_id=b and q.goal_id=g and (q.plan=v or v is null) and q.controller_key_hash=controller_hash and q.admission_key_hash=admission_hash and q.receipt_until>clock_timestamp() and private.r12_authority_owner_current(q)) then raise exception 'r12_exact_scoped_controller_authority_required';end if;
end $function$;

-- private.r12_admission_key_scope
CREATE OR REPLACE FUNCTION private.r12_admission_key_scope(b uuid, op text, request_payload jsonb, key_hash text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare scoped boolean;a private.r07_attempts;p private.r07_plans;r private.r05_requests;begin
 scoped:=exists(select 1 from private.r12_discovery_authorities q where key_hash in(q.admission_key_hash,q.controller_key_hash));
 if op in ('prepare','guard') then
 select * into a from private.r07_attempts where id=(request_payload->>'workflowRunId')::uuid and business_id=b;
 elsif op in ('reserve','dispatch','release_unsent','settle','readback') then
 select * into r from private.r05_requests where id=(request_payload->>'requestId')::uuid and business_id=b;
 select * into a from private.r07_attempts where id=r.workflow_run_id and business_id=b;
 elsif scoped then raise exception 'r12_exact_scoped_admission_authority_required';else return;end if;
 select * into p from private.r07_plans where id=a.plan_id and business_id=b;
 if not scoped and (p.id is null or p.content->>'format'='r07.1') and coalesce(coalesce(request_payload->>'operationKey',r.payload->>'operationKey'),'') not like 'research.r12.%' then return;end if;
 if a.id is null or not coalesce(p.content->>'format' in ('r12.discovery.1','r12.discovery-review.1'),false) or not exists(select 1 from private.r12_discovery_authorities q where q.business_id=b and q.goal_id=p.goal_id and q.plan=p.content and q.admission_key_hash=key_hash and q.receipt_until>clock_timestamp() and private.r12_authority_owner_current(q) and (op not in ('prepare','guard','reserve','dispatch') or q.valid_until>clock_timestamp() and private.r12_authority_owner_current(q)))
 or (op in ('prepare','guard') and (request_payload->>'operationKey' is distinct from 'research.r12.'||(p.content->>'discoveryScopeId')||'.'||a.step_key or request_payload->'accounting' is distinct from '{"kind":"r05"}'::jsonb))
 or (r.id is not null and (r.policy_id is distinct from p.policy_id or r.payload->>'operationKey' is distinct from 'research.r12.'||(p.content->>'discoveryScopeId')||'.'||a.step_key)) then raise exception 'r12_exact_scoped_admission_authority_required';end if;
end $function$;

-- public.r12_discovery_server
CREATE OR REPLACE FUNCTION public.r12_discovery_server(p_business_id uuid, p_attempt_id uuid, p_operation text, p_payload jsonb, p_server_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare key_hash text;a private.r07_attempts;p private.r07_plans;s private.r12_discovery_scopes;r private.r05_requests;rb private.r07_bindings;w private.r12_discovery_wires;c private.r12_discovery_candidates;q private.r12_discovery_receipt_checks;o private.r12_discovery_receipt_observations;
 v jsonb;state jsonb;mark timestamptz;expiry timestamptz;retry_at timestamptz;code text;http integer;terminal boolean;max_bytes integer;models jsonb;begin
 if p_server_key is null or length(p_server_key) not between 32 and 200 then raise exception 'r12_controller_authority_required' using errcode='42501';end if;
 perform 1 from public.businesses where id=p_business_id for update;if not found then raise exception 'r12_business_unavailable';end if;
 key_hash:=encode(extensions.digest(convert_to(p_server_key,'UTF8'),'sha256'),'hex');perform private.r12_discovery_key(key_hash);
 select * into a from private.r07_attempts where id=p_attempt_id and business_id=p_business_id;select * into p from private.r07_plans where id=a.plan_id and business_id=p_business_id;
 if a.id is null or not coalesce(p.content->>'format' in ('r12.discovery.1','r12.discovery-review.1'),false) or not exists(select 1 from public.businesses where id=p_business_id and owner_user_id=p.owner_id) then raise exception 'r12_attempt_scope_required';end if;
 if not exists(select 1 from private.r12_discovery_authorities scoped_auth where scoped_auth.business_id=p_business_id and scoped_auth.goal_id=p.goal_id and scoped_auth.plan=p.content and scoped_auth.controller_key_hash=key_hash and scoped_auth.receipt_until>clock_timestamp() and private.r12_authority_owner_current(scoped_auth)) then raise exception 'r12_exact_scoped_controller_authority_required';end if;
 if p_operation='inputs' then
 perform private.r04_keys(p_payload,array[]::text[]);v:=private.r12_discovery_phase_inputs(a,p);perform private.r12_discovery_key(key_hash);return v;end if;
 select * into rb from private.r07_bindings where attempt_id=a.id and business_id=p_business_id;select * into r from private.r05_requests where id=rb.request_id and business_id=p_business_id;
 if r.id is null then raise exception 'r12_reservation_required';end if;
 select * into w from private.r12_discovery_wires where request_id=r.id;
 if w.request_id is not null and w.producer_key_hash<>key_hash then raise exception 'r12_producer_key_changed';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>131072 then raise exception 'r12_payload_invalid';end if;
 if p_operation='bind' then
 perform private.r04_keys(p_payload,array['binding','bindingHash']);v:=p_payload->'binding';
 if p_payload->>'bindingHash' is distinct from private.stage14_hash(v) then raise exception 'r12_wire_hash_mismatch';end if;
 if w.request_id is not null then
 if w.binding is distinct from v or w.binding_hash is distinct from p_payload->>'bindingHash' then raise exception 'r12_wire_conflict';end if;return jsonb_build_object('bound',true,'bindingHash',w.binding_hash,'replayed',true);end if;
 if a.status<>'reserved' or exists(select 1 from private.r05_markers where request_id=r.id) then raise exception 'r12_unsent_reservation_required';end if;
 s:=private.r12_discovery_scope_current(p);if private.r07_gate(p,(select value from jsonb_array_elements(p.content->'steps') x where x->>'key'=a.step_key)) is not null then raise exception 'r12_current_gate_required';end if;
 perform private.r12_discovery_wire_validate(r,a,p,s,v);
 insert into private.r12_discovery_wires(request_id,business_id,attempt_id,scope_id,binding,binding_hash,producer_key_hash) values(r.id,p_business_id,a.id,s.id,v,p_payload->>'bindingHash',key_hash);
 return jsonb_build_object('bound',true,'bindingHash',p_payload->>'bindingHash','replayed',false);
 end if;
 if w.request_id is null then
 if p_operation='load' then perform private.r04_keys(p_payload,array[]::text[]);return jsonb_build_object('binding',null,'candidate',null,'receipt',null,'proof',null);end if;
 raise exception 'r12_wire_binding_required';end if;
 if p_operation='send' then
 perform private.r04_keys(p_payload,array['wireHash']);
 if p_payload->>'wireHash' is distinct from rb.wire_hash or not exists(select 1 from private.r05_markers where request_id=r.id) or not exists(select 1 from private.r07_markers where attempt_id=a.id) then raise exception 'r12_marked_wire_required';end if;
 if exists(select 1 from private.r12_discovery_transport_claims where request_id=r.id) then return jsonb_build_object('shouldDispatch',false,'reason','already_claimed');end if;
 if a.status<>'dispatched' or not exists(select 1 from private.r07_heads head join private.r07_markers marker on marker.attempt_id=a.id and marker.lease_epoch=head.lease_epoch where head.goal_id=a.goal_id and head.plan_id=p.id and head.lease_expires_at>clock_timestamp()) then raise exception 'r12_original_dispatch_lease_required';end if;
 s:=private.r12_discovery_scope_current(p);if private.r07_gate(p,(select value from jsonb_array_elements(p.content->'steps') x where x->>'key'=a.step_key)) is not null then raise exception 'r12_current_gate_required';end if;
 perform private.r12_discovery_wire_validate(r,a,p,s,w.binding);
 if private.r05_admissible(r) is not null then raise exception 'r12_current_financial_gate_required';end if;
 -- Recheck after operation/pack/registry lock waits before returning one-shot permission.
 s:=private.r12_discovery_scope_current(p);
 if private.r07_gate(p,(select value from jsonb_array_elements(p.content->'steps') x where x->>'key'=a.step_key)) is not null then raise exception 'r12_current_gate_required';end if;
 perform private.r12_discovery_wire_validate(r,a,p,s,w.binding);
 perform private.r12_discovery_key(key_hash);
 insert into private.r12_discovery_transport_claims(request_id) values(r.id);
 perform private.r12_discovery_key(key_hash);return jsonb_build_object('shouldDispatch',true,'reason','claimed_once');
 end if;
 select * into c from private.r12_discovery_candidates where request_id=r.id;
 if p_operation='load' then
 perform private.r04_keys(p_payload,array[]::text[]);
 return jsonb_build_object('dispatchedAt',(select created_at from private.r05_markers where request_id=r.id),'binding',w.binding,'candidate',c.candidate,'receipt',case when c.request_id is null then null else private.r12_discovery_receipt_status(c) end,'proof',(select ro.proof from private.r12_discovery_receipt_checks rc join private.r12_discovery_receipt_observations ro on ro.check_id=rc.id where rc.request_id=c.request_id and ro.proof is not null));
 end if;
 if p_operation='stage' then
 perform private.r04_keys(p_payload,array['candidate','candidateHash']);v:=p_payload->'candidate';
 perform private.r04_keys(v,array['version','scopeId','attemptId','requestId','phase','requestHash','providerRequestId','providerModelId','receivedAt','reportedMicrousd','output']);
 select created_at into mark from private.r05_markers where request_id=r.id;
 if mark is null or not exists(select 1 from private.r12_discovery_transport_claims where request_id=r.id) or not exists(select 1 from private.r07_markers where attempt_id=a.id) then raise exception 'r12_dispatch_required';end if;
 expiry:=least((p.content->>'expiresAt')::timestamptz+interval '30 minutes',mark+interval '60 minutes');
 models:=case when a.step_key='review' then '["anthropic/claude-haiku-4.5","anthropic/claude-4.5-haiku-20251001"]'::jsonb else '["openai/gpt-5.6-luna","openai/gpt-5.6-luna-20260709"]'::jsonb end;
 max_bytes:=case when a.step_key='strategy' then 73728 when a.step_key='search1' then 28672 else 20480 end;
 if v->>'version' is distinct from 'r12.discovery-response.1' or v->>'scopeId' is distinct from w.scope_id::text or v->>'attemptId' is distinct from a.id::text or v->>'requestId' is distinct from r.id::text or v->>'phase' is distinct from a.step_key or v->>'requestHash' is distinct from r.payload->>'requestHash' or p_payload->>'candidateHash' is distinct from private.stage14_hash(v) or octet_length(v::text)>max_bytes or jsonb_typeof(v->'output') is distinct from 'object' or not coalesce(models ? (v->>'providerModelId'),false) or (not coalesce(v->>'providerRequestId' ~ '^gen-[A-Za-z0-9_-]+$',false) or length(v->>'providerRequestId')>300) or jsonb_typeof(v->'receivedAt') is distinct from 'string' or not isfinite((v->>'receivedAt')::timestamptz) or (v->>'receivedAt')::timestamptz<mark or (v->>'receivedAt')::timestamptz>=expiry or (v->>'receivedAt')::timestamptz>clock_timestamp()+interval '5 minutes' then raise exception 'r12_candidate_invalid';end if;
 if v->'reportedMicrousd' is distinct from 'null'::jsonb and (jsonb_typeof(v->'reportedMicrousd') is distinct from 'number' or v->>'reportedMicrousd' !~ '^(0|[1-9][0-9]{0,6})$' or (v->>'reportedMicrousd')::bigint>r.liability_microunits) then raise exception 'r12_candidate_cost_invalid';end if;
 if c.request_id is not null then
 if c.candidate is distinct from v or c.candidate_hash is distinct from p_payload->>'candidateHash' then raise exception 'r12_candidate_conflict';end if;return private.r12_discovery_receipt_status(c)||jsonb_build_object('staged',true,'replayed',true);end if;
 if clock_timestamp()>=expiry then raise exception 'r12_receipt_expired';end if;
 insert into private.r12_discovery_candidates(request_id,candidate,candidate_hash,receipt_expires_at) values(r.id,v,p_payload->>'candidateHash',expiry) returning * into c;
 return private.r12_discovery_receipt_status(c)||jsonb_build_object('staged',true,'replayed',false);
 end if;
 if c.request_id is null or p_payload->>'candidateHash' is distinct from c.candidate_hash then raise exception 'r12_candidate_required';end if;
 state:=private.r12_discovery_receipt_status(c);
 if p_operation='claim' then
 perform private.r04_keys(p_payload,array['candidateHash']);
 if state->>'status' in ('verified','terminal','exhausted','expired','stopped') then return state||jsonb_build_object('claimed',false,'claimId',null,'reason',state->>'status');end if;
 if state->>'nextCheckAt' is not null and clock_timestamp()<(state->>'nextCheckAt')::timestamptz then return state||jsonb_build_object('claimed',false,'claimId',null,'reason','cooldown');end if;
 insert into private.r12_discovery_receipt_checks(request_id,attempt) values(r.id,(state->>'attempts')::integer+1) returning * into q;
 perform private.r12_discovery_key(key_hash);return private.r12_discovery_receipt_status(c)||jsonb_build_object('claimed',true,'claimId',q.id,'reason','claimed');
 elsif p_operation<>'record' then raise exception 'r12_operation_unavailable';end if;
 perform private.r04_keys(p_payload,array['candidateHash','claimId','proof','diagnostic','retryAfterAt']);
 select * into q from private.r12_discovery_receipt_checks where id=(p_payload->>'claimId')::uuid and request_id=r.id;
 if q.id is null or exists(select 1 from private.r12_discovery_receipt_checks where request_id=r.id and attempt>q.attempt) then raise exception 'r12_receipt_claim_invalid';end if;
 if (p_payload->'proof'='null'::jsonb)=(p_payload->'diagnostic'='null'::jsonb) then raise exception 'r12_receipt_record_invalid';end if;
 if p_payload->'proof'<>'null'::jsonb then
 perform private.r12_discovery_proof_validate(c,p_payload->'proof');terminal:=false;
 if p_payload->'retryAfterAt' is distinct from 'null'::jsonb then raise exception 'r12_retry_after_invalid';end if;
 else
 perform private.r04_keys(p_payload->'diagnostic',array['code','httpStatus']);code:=p_payload->'diagnostic'->>'code';
 if jsonb_typeof(p_payload->'diagnostic'->'code') is distinct from 'string' or code not in ('invalid_request','configuration_unavailable','transport_failure','timeout','redirect_rejected','api_failure','response_too_large','json_invalid','response_invalid','generation_mismatch','provider_mismatch','model_mismatch','provider_responses_invalid') then raise exception 'r12_diagnostic_invalid';end if;
 if p_payload->'diagnostic'->'httpStatus'<>'null'::jsonb then
 if jsonb_typeof(p_payload->'diagnostic'->'httpStatus') is distinct from 'number' or p_payload->'diagnostic'->>'httpStatus' !~ '^[1-5][0-9]{2}$' then raise exception 'r12_diagnostic_invalid';end if;http:=(p_payload->'diagnostic'->>'httpStatus')::integer;end if;
 terminal:=not(code in ('transport_failure','timeout') or code='api_failure' and coalesce(http in (404,429) or http between 500 and 599,false));
 if p_payload->'retryAfterAt'<>'null'::jsonb then
 if terminal or jsonb_typeof(p_payload->'retryAfterAt') is distinct from 'string' or p_payload->>'retryAfterAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then raise exception 'r12_retry_after_invalid';end if;
 retry_at:=(p_payload->>'retryAfterAt')::timestamptz;if not isfinite(retry_at) then raise exception 'r12_retry_after_invalid';end if;end if;
 end if;
 select * into o from private.r12_discovery_receipt_observations where check_id=q.id;
 if o.check_id is not null then
 if o.proof is distinct from nullif(p_payload->'proof','null'::jsonb) or o.diagnostic is distinct from nullif(p_payload->'diagnostic','null'::jsonb) or o.retry_after_at is distinct from retry_at then raise exception 'r12_receipt_record_conflict';end if;
 return state||jsonb_build_object('recorded',true,'replayed',true);end if;
 if state->>'status' in ('expired','stopped') then raise exception 'r12_receipt_inactive';end if;
 insert into private.r12_discovery_receipt_observations(check_id,proof,diagnostic,retry_after_at,terminal) values(q.id,nullif(p_payload->'proof','null'::jsonb),nullif(p_payload->'diagnostic','null'::jsonb),retry_at,terminal);
 perform private.r12_discovery_key(key_hash);return private.r12_discovery_receipt_status(c)||jsonb_build_object('recorded',true,'replayed',false);
end $function$;

-- private.r12_discovery_response_guard
CREATE OR REPLACE FUNCTION private.r12_discovery_response_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare a private.r07_attempts;p private.r07_plans;c private.r12_discovery_candidates;state jsonb;begin
 select * into a from private.r07_attempts where id=new.attempt_id;select * into p from private.r07_plans where id=a.plan_id;
 if p.content->>'format'='r07.1' then return new;end if;
 if not coalesce(p.content->>'format' in ('r12.discovery.1','r12.discovery-review.1'),false) then raise exception 'r12_unknown_response_format';end if;
 select c0.* into c from private.r12_discovery_candidates c0 join private.r12_discovery_wires w on w.request_id=c0.request_id where w.attempt_id=a.id and w.business_id=new.business_id;
 if c.request_id is null then raise exception 'r12_verified_candidate_required';end if;
 state:=private.r12_discovery_receipt_status(c);
 if state->>'status'<>'verified' or new.content->'result'->>'candidateHash' is distinct from c.candidate_hash or new.content->'result'->>'routeProofHash' is distinct from state->>'proofHash' or new.content->'result'->>'outputHash' is distinct from private.stage14_hash(c.candidate->'output') or c.candidate->'reportedMicrousd'='null'::jsonb or not exists(select 1 from private.r05_settlements z where z.request_id=c.request_id and z.actual_microunits=(c.candidate->>'reportedMicrousd')::bigint and z.provider_request_id=c.candidate->>'providerRequestId') then raise exception 'r12_verified_candidate_required';end if;
 return new;
end $function$;

-- private.r12_discovery_wire_validate
CREATE OR REPLACE FUNCTION private.r12_discovery_wire_validate(r private.r05_requests, a private.r07_attempts, p private.r07_plans, s private.r12_discovery_scopes, v jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare body jsonb;q jsonb;route jsonb;msg jsonb;phase text:=a.step_key;maximum_bytes integer;tokens integer;begin
 if not coalesce(p.content->>'format' in ('r12.discovery.1','r12.discovery-review.1'),false) then raise exception 'r12_unknown_wire_format';end if;
 if p.content->>'format'='r12.discovery-review.1' and (phase<>'review' or s.amendment->>'version' is distinct from 'r12.discovery-review-continuation.1' or a.dependency_pins is distinct from private.r07_dependencies(p.id,p.content->'steps'->0)) then raise exception 'r12_review_only_wire_required';end if;
 perform private.r04_keys(v,array['version','scopeId','scopeHash','attemptId','requestId','phase','requestJson','requestHash','wireBody','wireHash','quote','dependencyPins']);
 if v->>'version' is distinct from 'r12.discovery-wire.1' or v->>'scopeId' is distinct from s.id::text or v->>'scopeHash' is distinct from s.amendment_hash or v->>'attemptId' is distinct from a.id::text or v->>'requestId' is distinct from r.id::text or v->>'phase' is distinct from phase or v->'dependencyPins' is distinct from a.dependency_pins or r.workflow_run_id<>a.id or r.policy_id<>p.policy_id or r.payload->>'operationKey' is distinct from 'research.r12.'||s.id::text||'.'||phase then raise exception 'r12_wire_scope_mismatch';end if;
 if v->>'requestHash' is distinct from private.stage14_hash((v->>'requestJson')::jsonb) or r.payload->>'requestHash' is distinct from v->>'requestHash' or v->>'wireHash' is distinct from encode(extensions.digest(convert_to(v->>'wireBody','UTF8'),'sha256'),'hex') or r.payload->>'wireRequestHash' is distinct from v->>'wireHash' or jsonb_typeof(v->'wireBody') is distinct from 'string' then raise exception 'r12_wire_hash_mismatch';end if;
 maximum_bytes:=case phase when 'plan' then 12288 when 'search1' then 8192 when 'select1' then 16384 when 'strategy' then 32768 when 'review' then 32768 end;
 tokens:=case phase when 'plan' then 1500 when 'search1' then 4000 when 'select1' then 1000 when 'strategy' then 5000 when 'review' then 4000 end;
 if maximum_bytes is null or octet_length(v->>'wireBody')>maximum_bytes or octet_length(v->>'wireBody') is distinct from (r.payload->>'wireRequestBytes')::integer or (r.payload->>'maximumOutputTokens')::integer is distinct from tokens then raise exception 'r12_wire_bound_mismatch';end if;
 body:=(v->>'wireBody')::jsonb;q:=v->'quote';route:=q->(case when phase='review' then 'reviewer' else 'luna' end);
 if q->>'version' is distinct from 'r12.discovery-quote.1' or q->>'quoteHash' is distinct from private.stage14_hash(q-array['quoteHash','verifiedAt','validUntil']) or q->'maximumCalls' is distinct from '5'::jsonb or q->'maximumCollections' is distinct from '1'::jsonb or q->'proposalOnly' is distinct from 'true'::jsonb or q->'dispatchAuthorized' is distinct from 'false'::jsonb or jsonb_typeof(q->'verifiedAt') is distinct from 'string' or jsonb_typeof(q->'validUntil') is distinct from 'string' or not isfinite((q->>'verifiedAt')::timestamptz) or not isfinite((q->>'validUntil')::timestamptz) or (q->>'verifiedAt')::timestamptz>clock_timestamp() or (q->>'validUntil')::timestamptz<=clock_timestamp() or (q->>'validUntil')::timestamptz-(q->>'verifiedAt')::timestamptz<>interval '5 minutes' then raise exception 'r12_fresh_quote_required';end if;
 if jsonb_typeof(q->'ceilings'->phase) is distinct from 'number' or q->'ceilings'->>phase !~ '^[1-9][0-9]{0,6}$' or (q->'ceilings'->>phase)::bigint>r.liability_microunits then raise exception 'r12_quote_liability_mismatch';end if;
 if route->>'modelId' is distinct from (case when phase='review' then 'anthropic/claude-haiku-4.5' else 'openai/gpt-5.6-luna' end) or route->>'endpoint' is distinct from (case when phase='review' then 'amazon-bedrock/us' else 'azure/us' end) or route->>'providerName' is distinct from (case when phase='review' then 'Amazon Bedrock' else 'Azure' end) or body->>'model' is distinct from route->>'modelId' or r.payload->>'providerModelId' is distinct from body->>'model' or body->'max_tokens' is distinct from to_jsonb(tokens) or body->'stream' is distinct from 'false'::jsonb or body->'provider'->'only' is distinct from jsonb_build_array(route->>'endpoint') or body->'provider'->'allow_fallbacks' is distinct from 'false'::jsonb or body->'provider'->'require_parameters' is distinct from 'true'::jsonb or body->'provider'->'data_collection' is distinct from '"deny"'::jsonb or body->'provider'->'zdr' is distinct from 'true'::jsonb or body->'provider'->'max_price' is distinct from route->'priceLimit' then raise exception 'r12_exact_route_required';end if;
 if r.payload->'sourceDomains' is distinct from s.amendment->'allowedDomains' then raise exception 'r12_source_provenance_required';end if;
 perform private.r04_keys(body->'provider',array['only','allow_fallbacks','require_parameters','data_collection','zdr','max_price']);
 if jsonb_typeof(body->'messages') is distinct from 'array' or jsonb_array_length(body->'messages') not between 1 and 4 or exists(select 1 from jsonb_array_elements(body->'messages') m where jsonb_typeof(m->'content') is distinct from 'string' or not coalesce(m->>'role' in ('system','user'),false)) then raise exception 'r12_text_only_phase_required';end if;
 for msg in select value from jsonb_array_elements(body->'messages') loop perform private.r04_keys(msg,array['role','content']);end loop;
 if phase='search1' then
 perform private.r04_keys(body,array['model','provider','messages','tools','tool_choice','max_tool_calls','max_tokens','stream']);
 if body->'messages'->1->>'content' is distinct from s.amendment->>'approvedQuery' or ((v->>'requestJson')::jsonb)->>'query' is distinct from s.amendment->>'approvedQuery' or body->'tools' is distinct from jsonb_build_array(jsonb_build_object('type','openrouter:web_search','parameters',jsonb_build_object('engine','exa','mode','fast','max_uses',1,'max_results',4,'max_total_results',4,'max_characters',1800,'allowed_domains',s.amendment->'allowedDomains','excluded_domains',s.amendment->'excludedDomains'))) or body->>'tool_choice' is distinct from 'required' or body->'max_tool_calls' is distinct from '1'::jsonb or ((v->>'requestJson')::jsonb)->'allowedDomains' is distinct from s.amendment->'allowedDomains' or ((v->>'requestJson')::jsonb)->'excludedDomains' is distinct from s.amendment->'excludedDomains' then raise exception 'r12_exact_search_scope_required';end if;
 elsif body ?| array['tools','plugins','tool_choice','max_tool_calls'] or body->'response_format'->>'type' is distinct from 'json_schema' then raise exception 'r12_text_only_phase_required';end if;
 if phase<>'search1' then
 perform private.r04_keys(body,array['model','provider','messages','response_format','max_tokens','stream']||case when phase='select1' then array['reasoning'] else array[]::text[] end);
 perform private.r04_keys(body->'response_format',array['type','json_schema']);perform private.r04_keys(body->'response_format'->'json_schema',array['name','strict','schema']);
 if body->'response_format'->'json_schema'->'strict' is distinct from 'true'::jsonb or body->'response_format'->'json_schema'->>'name' is distinct from (case phase when 'plan' then 'geographic_discovery_plan_v2' when 'select1' then 'discovery_evidence_selection_v2' when 'strategy' then 'product_discovery_v2_strategy' when 'review' then 'product_discovery_v2_review' end) or (phase='select1' and body->'reasoning' is distinct from '{"effort":"none"}'::jsonb) or (phase<>'select1' and body ? 'reasoning') then raise exception 'r12_static_nonprivate_schema_required';end if;
 if private.stage14_hash(((v->>'requestJson')::jsonb)->'outputSchema') is distinct from (case phase
 when 'plan' then 'b49dfc9ddc8c2dc3c496c3d4ccf350ea383150b724dedaf3e9d99fbbe7ebcf10'
 when 'select1' then 'e1bedf858d2286df3a2007c6a17040eb4c2e42ef8f92c445979be74f02e3a39c'
 when 'strategy' then '5515b1bc5c413c852525df2fb9641f710be92418bb3bf68746577cf1663c24a3'
 when 'review' then 'd1ab02be3a01b43f6c407070b284c37b8079e10eb2991013009d2c502bbd7e54' end)
 or private.stage14_hash(body->'response_format'->'json_schema'->'schema') is distinct from (case phase
 when 'plan' then 'ca9d827a2c2027e579902b91e4b368b4ebcd01bde1109a8332c61848c8e4c8d8'
 when 'select1' then '8ecda611f97e9ad9fb515c985be2eb93cdc1dd034d6e758760e888449d8a5cc9'
 when 'strategy' then '4d8489ecc1a39768e42f07969bb96054d40861de28ef0cd110645927a048204b'
 when 'review' then '81c1f3d20dce36cd6f00e3dabf8b7bce069cf5d03628d770e7ef40172b5d734c' end)
 then raise exception 'r12_static_nonprivate_schema_required';end if;end if;
end $function$;

-- private.r12_discovery_completed_phase
CREATE OR REPLACE FUNCTION private.r12_discovery_completed_phase(a private.r07_attempts, p private.r07_plans)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare r private.r07_responses;w private.r12_discovery_wires;c private.r12_discovery_candidates;q private.r05_requests;mark timestamptz;proof jsonb;begin
 if not coalesce(p.content->>'format' in ('r12.discovery.1','r12.discovery-review.1'),false) or (p.content->>'format'='r12.discovery-review.1' and a.step_key<>'review') then raise exception 'r12_completed_history_format_invalid';end if;
 select * into r from private.r07_responses where attempt_id=a.id and business_id=p.business_id;
 select * into w from private.r12_discovery_wires where attempt_id=a.id and business_id=p.business_id and scope_id=(p.content->>'discoveryScopeId')::uuid;
 select * into c from private.r12_discovery_candidates where request_id=w.request_id;
 select * into q from private.r05_requests where id=w.request_id and business_id=p.business_id;
 select created_at into mark from private.r05_markers where request_id=w.request_id;
 select o.proof into proof from private.r12_discovery_receipt_checks rc join private.r12_discovery_receipt_observations o on o.check_id=rc.id where rc.request_id=c.request_id and o.proof is not null;
 if a.plan_id is distinct from p.id or a.business_id is distinct from p.business_id or a.status is distinct from 'completed' or r.content->>'outcome' is distinct from 'accepted'
 or p.content_hash is distinct from private.r04_hash(p.content) or r.content_hash is distinct from private.r04_hash(r.content)
 or not exists(select 1 from public.artifacts x where x.id=r.artifact_id and x.business_id=p.business_id and x.workflow_run_id=a.id and x.artifact_type='r12.discovery.'||a.step_key and x.content=r.content and x.checksum=r.content_hash)
 or r.content->>'planHash' is distinct from p.content_hash or r.content->>'inputHash' is distinct from a.input_hash or r.artifact_id is null or w.request_id is null or c.request_id is null or q.id is null or mark is null or proof is null
 or r.content->'result'->>'candidateHash' is distinct from c.candidate_hash or c.candidate_hash is distinct from private.stage14_hash(c.candidate)
 or r.content->'result'->>'outputHash' is distinct from private.stage14_hash(c.candidate->'output') or r.content->'result'->>'routeProofHash' is distinct from proof->>'proofHash'
 or c.candidate->'reportedMicrousd'='null'::jsonb or not exists(select 1 from private.r05_settlements z where z.request_id=c.request_id and z.actual_microunits=(c.candidate->>'reportedMicrousd')::bigint and z.provider_request_id=c.candidate->>'providerRequestId')
 then raise exception 'r12_completed_history_unverified';end if;
 return jsonb_build_object('stepKey',a.step_key,'attemptId',a.id,'artifactId',r.artifact_id,'responseHash',r.content_hash,'responseCanonicalHash',private.stage14_hash(r.content),'response',r.content,
 'binding',jsonb_build_object('scopeId',w.scope_id,'attemptId',a.id,'requestId',q.id,'phase',a.step_key,'request',(w.binding->>'requestJson')::jsonb,'maximumMicrousd',q.liability_microunits,'dispatchedAt',mark,'receiptExpiresAt',c.receipt_expires_at),
 'candidate',c.candidate,'proof',proof);
end $function$;

-- private.r12_discovery_financial_guard
CREATE OR REPLACE FUNCTION private.r12_discovery_financial_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r private.r05_requests; a private.r07_attempts; p private.r07_plans; scope private.r12_discovery_scopes; budget jsonb; own_held bigint:=0; mapped_pending bigint:=0; begin
 select * into strict r from private.r05_requests where id=new.request_id and business_id=new.business_id;
 if r.payload->>'operationKey' not like 'research.r12.%' then return new;end if;
 select * into a from private.r07_attempts where id=r.workflow_run_id and business_id=r.business_id;
 select * into p from private.r07_plans where id=a.plan_id and business_id=a.business_id;
 if a.id is null or p.id is null or r.policy_id is distinct from p.policy_id or r.payload->'accounting' is distinct from '{"kind":"r05"}'::jsonb or r.payload->>'idempotencyKey' is distinct from 'r07:'||a.id or r.payload->>'operationKey' is distinct from 'research.r12.'||(p.content->>'discoveryScopeId')||'.'||a.step_key then raise exception 'r12_exact_controller_request_required';end if;
 scope:=private.r12_discovery_scope_current(p);
 budget:=private.stage13v2_budget_authority(scope.prior_round_id,true);
 select coalesce(sum(e.held) filter(where e.request_id=r.id),0),coalesce(sum(e.held) filter(where e.is_pending),0) into own_held,mapped_pending from private.r12_discovery_exposure(scope.budget_authority_root_id) e;
 if (budget->>'pendingExposureMicrousd')::bigint>mapped_pending or exists(select 1 from private.r12_discovery_exposure(scope.budget_authority_root_id) e where e.is_pending and e.request_id<>r.id) then raise exception 'r12_original_funding_uncertain';end if;
 if (budget->>'committedMicrousd')::bigint-own_held+r.liability_microunits>(budget->>'maximumMicrousd')::bigint then raise exception 'r12_original_funding_exceeded';end if;
 -- Reservation and sent marker both recheck after the shared-root lock. The
 -- marker is still deliberately unavailable without the next exact-wire bridge.
 if tg_table_name='r05_markers' then perform private.r12_discovery_mark_guard(r,a,p,scope);end if;
 return new;
end $function$;

-- private.r12_discovery_routed_marker
CREATE OR REPLACE FUNCTION private.r12_discovery_routed_marker(r private.r05_requests)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare a private.r07_attempts;p private.r07_plans;s private.r12_discovery_scopes;begin
 select * into a from private.r07_attempts where id=r.workflow_run_id and business_id=r.business_id;select * into p from private.r07_plans where id=a.plan_id;
 if a.id is null or p.id is null then raise exception 'r12_exact_controller_request_required';end if;
 s:=private.r12_discovery_scope_current(p);perform private.r12_discovery_mark_guard(r,a,p,s);
 if private.r05_admissible(r) is not null then raise exception 'r12_current_financial_gate_required';end if;
 s:=private.r12_discovery_scope_current(p);perform private.r12_discovery_mark_guard(r,a,p,s);
end $function$;

-- private.r12_discovery_mark_guard
CREATE OR REPLACE FUNCTION private.r12_discovery_mark_guard(r private.r05_requests, a private.r07_attempts, p private.r07_plans, s private.r12_discovery_scopes)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare w private.r12_discovery_wires;begin
 select * into w from private.r12_discovery_wires where request_id=r.id and business_id=r.business_id and attempt_id=a.id and scope_id=s.id;
 if w.request_id is null then raise exception 'r12_source_dispatch_bridge_unavailable';end if;
 perform private.r12_discovery_key(w.producer_key_hash);
 perform private.r12_discovery_wire_validate(r,a,p,s,w.binding);
end $function$;

-- private.r12_discovery_receipt_status
CREATE OR REPLACE FUNCTION private.r12_discovery_receipt_status(c private.r12_discovery_candidates)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare w private.r12_discovery_wires;a private.r07_attempts;p private.r07_plans;h private.r07_heads;q private.r12_discovery_receipt_checks;o private.r12_discovery_receipt_observations;n timestamptz;state text;begin
 select * into w from private.r12_discovery_wires where request_id=c.request_id;select * into a from private.r07_attempts where id=w.attempt_id;select * into p from private.r07_plans where id=a.plan_id;select * into h from private.r07_heads where goal_id=a.goal_id;
 select * into q from private.r12_discovery_receipt_checks where request_id=c.request_id order by attempt desc limit 1;
 select * into o from private.r12_discovery_receipt_observations where check_id=q.id;n:=greatest(q.created_at+interval '120 seconds',o.retry_after_at);
 if h.reason='owner_stopped' or h.plan_id<>p.id or exists(select 1 from private.r05_revocations where policy_id=p.policy_id) or private.r05_paused(p.business_id,'business',p.business_id) or private.r05_paused(p.business_id,'quest',p.goal_id) or not exists(select 1 from public.businesses where id=p.business_id and owner_user_id=p.owner_id) or not exists(select 1 from private.r04_goal_state gs join private.r04_goal_versions gv using(goal_id,business_id,revision) where gs.goal_id=p.goal_id and gs.business_id=p.business_id and gs.revision=(p.content->>'goalRevision')::integer and gv.preference='ready')
 or not exists(select 1 from private.r04_business_state bs join private.r04_business_versions bv using(business_id,revision) where bs.business_id=p.business_id and bs.revision=(p.content->>'businessRevision')::integer and bv.preference='setup')
 or exists(select 1 from jsonb_array_elements(p.content->'steps') step where step->>'key'=a.step_key and (private.r05_paused(p.business_id,'pack',(step->>'installationId')::uuid) or exists(select 1 from private.r07_adapter_revocations revoked where revoked.adapter_key=step->>'adapter') or exists(select 1 from private.r05_operation_revocations revoked where revoked.operation_key=step->>'operationKey')))
 then state:='stopped';
 elsif clock_timestamp()>=c.receipt_expires_at then state:='expired';
 elsif o.proof is not null then state:='verified';
 elsif o.terminal then state:='terminal';
 elsif q.attempt=3 and (o.check_id is not null or clock_timestamp()>=n) then state:='exhausted';
 elsif q.id is not null and o.check_id is null and clock_timestamp()<n then state:='checking_receipt';else state:='awaiting_receipt';end if;
 return jsonb_build_object('requestId',c.request_id,'candidateHash',c.candidate_hash,'status',state,'attempts',coalesce(q.attempt,0),'nextCheckAt',case when state in ('awaiting_receipt','checking_receipt') then n else null end,'receiptExpiresAt',c.receipt_expires_at,'diagnostic',o.diagnostic,'proofHash',o.proof->>'proofHash');
end $function$;

-- private.r12_discovery_phase_inputs
CREATE OR REPLACE FUNCTION private.r12_discovery_phase_inputs(a private.r07_attempts, p private.r07_plans)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare s private.r12_discovery_scopes;prior public.product_experiments;budget jsonb;own_held bigint:=0;own_pending bigint:=0;step jsonb;installation public.installed_packs;
 pin jsonb;dep private.r07_attempts;response private.r07_responses;wire private.r12_discovery_wires;c private.r12_discovery_candidates;r private.r05_requests;mark timestamptz;proof jsonb;dependencies jsonb:='[]';output jsonb;validation_at timestamptz:=clock_timestamp();input_mode text:='dispatch';begin
 if p.content->>'format'='r12.discovery-review.1' then return private.r12_review_phase_inputs(a,p);end if;
 if p.content->>'format' is distinct from 'r12.discovery.1' then raise exception 'r12_unknown_input_format';end if;
 select own_candidate.* into c from private.r12_discovery_candidates own_candidate join private.r12_discovery_wires own_wire on own_wire.request_id=own_candidate.request_id where own_wire.attempt_id=a.id and own_wire.business_id=p.business_id;
 if c.request_id is not null and private.r12_discovery_receipt_status(c)->>'status'='verified' then
 select created_at into strict validation_at from private.r05_markers where request_id=c.request_id;input_mode:='receipt';
 s:=private.r12_discovery_scope_at(p,validation_at);
 else s:=private.r12_discovery_scope_current(p);end if;
 select * into strict prior from public.product_experiments where id=s.prior_round_id;
 select value into step from jsonb_array_elements(p.content->'steps') x where x->>'key'=a.step_key;
 select * into installation from public.installed_packs where id=(step->>'installationId')::uuid and business_id=p.business_id and status='active' for share;
 if installation.id is null or private.r04_hash(installation.snapshot) is distinct from step->>'packSnapshotHash' then raise exception 'r12_knowledge_installation_changed';end if;
 budget:=private.stage13v2_budget_authority(s.prior_round_id,true);
 select coalesce(sum(e.held),0),coalesce(sum(e.held) filter(where e.is_pending),0) into own_held,own_pending from private.r12_discovery_exposure(s.budget_authority_root_id) e join private.r05_requests req on req.id=e.request_id where req.workflow_run_id=a.id;
 if jsonb_array_length(a.dependency_pins)>4 then raise exception 'r12_dependency_bound';end if;
 for pin in select value from jsonb_array_elements(a.dependency_pins) loop
 select * into dep from private.r07_attempts where id=(pin->>'attemptId')::uuid and business_id=p.business_id and plan_id=p.id and step_key=pin->>'stepKey' and status='completed';
 select * into response from private.r07_responses where attempt_id=dep.id and business_id=p.business_id and content_hash=pin->>'resultHash';
 select * into wire from private.r12_discovery_wires where attempt_id=dep.id and business_id=p.business_id and scope_id=s.id;
 select * into c from private.r12_discovery_candidates where request_id=wire.request_id;
 select * into r from private.r05_requests where id=wire.request_id and business_id=p.business_id;
 select created_at into mark from private.r05_markers where request_id=wire.request_id;
 if dep.id is null or response.attempt_id is null or response.content->>'outcome' is distinct from 'accepted' or wire.request_id is null or c.request_id is null or mark is null or private.r12_discovery_receipt_status(c)->>'status' is distinct from 'verified' then raise exception 'r12_completed_dependency_required';end if;
 select ro.proof into proof from private.r12_discovery_receipt_checks rc join private.r12_discovery_receipt_observations ro on ro.check_id=rc.id where rc.request_id=c.request_id and ro.proof is not null;
 if proof is null then raise exception 'r12_verified_dependency_required';end if;
 dependencies:=dependencies||jsonb_build_array(jsonb_build_object('stepKey',dep.step_key,'attemptId',dep.id,'artifactId',response.artifact_id,'responseHash',response.content_hash,'responseCanonicalHash',private.stage14_hash(response.content),'response',response.content,
 'binding',jsonb_build_object('scopeId',s.id,'attemptId',dep.id,'requestId',r.id,'phase',dep.step_key,'request',(wire.binding->>'requestJson')::jsonb,'maximumMicrousd',r.liability_microunits,'dispatchedAt',mark,'receiptExpiresAt',c.receipt_expires_at),
 'candidate',c.candidate,'proof',proof));
 end loop;
 output:=jsonb_build_object('version','r12.discovery-inputs.1','businessId',p.business_id,'planId',p.id,'attemptId',a.id,'inputMode',input_mode,'validationAt',validation_at,'knowledgeSnapshot',installation.snapshot,'knowledgeSnapshotHash',private.r04_hash(installation.snapshot),'knowledgeCanonicalHash',private.stage14_hash(installation.snapshot),
 'original',jsonb_build_object('businessId',s.business_id,'budgetAuthorityRootId',s.budget_authority_root_id,'priorRoundId',s.prior_round_id,'semanticGoalHash',prior.variables->>'semanticGoalHash','priorIntent',prior.variables->'intent','maximumMicrousd',budget->'maximumMicrousd','committedMicrousd',(budget->>'committedMicrousd')::bigint-own_held,'hasUncertainCosts',(budget->>'pendingExposureMicrousd')::bigint>own_pending),
 'amendment',s.amendment,'dependencies',dependencies);
 if octet_length(output::text)>524288 then raise exception 'r12_complete_input_bound';end if;
 if input_mode='receipt' then
 select own_candidate.* into c from private.r12_discovery_candidates own_candidate join private.r12_discovery_wires own_wire on own_wire.request_id=own_candidate.request_id where own_wire.attempt_id=a.id and own_wire.business_id=p.business_id;
 if private.r12_discovery_receipt_status(c)->>'status' is distinct from 'verified' then raise exception 'r12_receipt_grace_ended';end if;
 perform private.r12_discovery_scope_at(p,validation_at);
 else perform private.r12_discovery_scope_current(p);end if;return output;
end $function$;

-- public.r12_discovery_result_read
CREATE OR REPLACE FUNCTION public.r12_discovery_result_read(p_business_id uuid, p_scope_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s private.r12_discovery_scopes;p private.r07_plans;a private.r07_attempts;dep private.r07_attempts;prior public.product_experiments;installation public.installed_packs;
 step jsonb;pin jsonb;current_phase jsonb;dependency jsonb;dependencies jsonb:='[]';at_time timestamptz;committed bigint;output jsonb;begin
 if private.is_business_owner(p_business_id) is distinct from true then raise exception 'r12_owner_required' using errcode='42501';end if;
 select * into s from private.r12_discovery_scopes where id=p_scope_id and business_id=p_business_id;if s.id is null then return null;end if;
 if s.amendment->>'version'='r12.discovery-review-continuation.1' then return private.r12_review_result(s);end if;
 if s.amendment->>'version' is distinct from 'r12.discovery-source-scope.1' then raise exception 'r12_unknown_result_scope';end if;
 select * into p from private.r07_plans where business_id=p_business_id and goal_id=s.goal_id and content->>'format'='r12.discovery.1' and content->>'discoveryScopeId'=s.id::text order by version desc limit 1;
 select * into a from private.r07_attempts where plan_id=p.id and business_id=p_business_id and step_key='review' and status='completed' order by private.r07_attempts.attempt desc limit 1;
 if a.id is null then return null;end if;
 if p.content->>'discoveryScopeHash' is distinct from s.amendment_hash or private.stage14_hash(s.amendment) is distinct from s.amendment_hash or jsonb_array_length(a.dependency_pins)<>4 then raise exception 'r12_completed_history_unverified';end if;
 current_phase:=private.r12_discovery_completed_phase(a,p);at_time:=(current_phase->'binding'->>'dispatchedAt')::timestamptz;
 committed:=(current_phase->'binding'->'request'->'requestMetadata'->>'r12CommittedBeforeAttemptMicrousd')::bigint;
 for pin in select value from jsonb_array_elements(a.dependency_pins) loop
 select * into dep from private.r07_attempts where id=(pin->>'attemptId')::uuid and plan_id=p.id and business_id=p_business_id and step_key=pin->>'stepKey';
 dependency:=private.r12_discovery_completed_phase(dep,p);
 if dependency->>'responseHash' is distinct from pin->>'resultHash' then raise exception 'r12_completed_history_unverified';end if;
 dependencies:=dependencies||jsonb_build_array(dependency);
 end loop;
 if (select array_agg(x->>'stepKey' order by x->>'stepKey') from jsonb_array_elements(dependencies)x) is distinct from array['plan','search1','select1','strategy'] then raise exception 'r12_completed_history_unverified';end if;
 select value into step from jsonb_array_elements(p.content->'steps')x where x->>'key'='review';
 select * into installation from public.installed_packs where id=(step->>'installationId')::uuid and business_id=p_business_id;
 if installation.id is null or private.r04_hash(installation.snapshot) is distinct from step->>'packSnapshotHash' then raise exception 'r12_completed_knowledge_unverified';end if;
 select * into prior from public.product_experiments where id=s.prior_round_id and business_id=p_business_id;
 if prior.id is null or committed is null or committed<0 or committed>=(prior.variables->'intent'->'limits'->>'maximumMicrousd')::bigint then raise exception 'r12_completed_history_unverified';end if;
 output:=jsonb_build_object('version','r12.discovery-saved-result.1','context',jsonb_build_object('planId',p.id,'planHash',p.content_hash,'plan',p.content,'step',step,
 'attempt',jsonb_build_object('id',a.id,'stepKey',a.step_key,'attempt',a.attempt,'status',a.status,'reason',a.reason,'inputHash',a.input_hash,'dependencyPins',a.dependency_pins,'repairEvidenceHash',a.repair_evidence_hash,'wireHash',null,'requestId',current_phase->'binding'->'requestId','responseHash',current_phase->'responseHash'),
 'knowledge',jsonb_build_object('format','r09.1','businessId',p_business_id,'planId',p.id,'pins','[]'::jsonb)),
 'inputs',jsonb_build_object('version','r12.discovery-inputs.1','businessId',p_business_id,'planId',p.id,'attemptId',a.id,'inputMode','receipt','validationAt',at_time,
 'knowledgeSnapshot',installation.snapshot,'knowledgeSnapshotHash',private.r04_hash(installation.snapshot),'knowledgeCanonicalHash',private.stage14_hash(installation.snapshot),
 'original',jsonb_build_object('businessId',s.business_id,'budgetAuthorityRootId',s.budget_authority_root_id,'priorRoundId',s.prior_round_id,'semanticGoalHash',prior.variables->>'semanticGoalHash','priorIntent',prior.variables->'intent','maximumMicrousd',prior.variables->'intent'->'limits'->'maximumMicrousd','committedMicrousd',committed,'hasUncertainCosts',false),
 'amendment',s.amendment,'dependencies',dependencies),'current',current_phase);
 if octet_length(output::text)>655360 then raise exception 'r12_completed_history_bound';end if;return output;
end $function$;

-- public.r12_discovery_owner_read
CREATE OR REPLACE FUNCTION public.r12_discovery_owner_read(p_business_id uuid, p_scope_id uuid, p_activation boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare source_scope private.r12_discovery_scopes;authority private.r12_discovery_authorities;saved_plan private.r07_plans;head private.r07_heads;
 phase_plan_id uuid;source_plan private.r07_plans;step jsonb;attempt private.r07_attempts;binding private.r07_bindings;request private.r05_requests;candidate private.r12_discovery_candidates;response private.r07_responses;
 phases jsonb:='[]';receipt jsonb;actual bigint;held bigint;marked boolean;reserved boolean;known_total bigint:=0;held_total bigint:=0;unknown_cost boolean:=false;active boolean;stopped boolean;policy_revoked boolean;paused boolean;budget jsonb;begin
 if private.is_business_owner(p_business_id) is distinct from true then raise exception 'r12_owner_required' using errcode='42501';end if;
 select * into source_scope from private.r12_discovery_scopes where id=p_scope_id and business_id=p_business_id;if source_scope.id is null then return null;end if;
 if not coalesce(source_scope.amendment->>'version' in ('r12.discovery-source-scope.1','r12.discovery-review-continuation.1'),false) then raise exception 'r12_unknown_owner_scope';end if;
 if source_scope.amendment->>'version'='r12.discovery-review-continuation.1' then
 select * into source_plan from private.r07_plans where id=(source_scope.amendment->>'sourcePlanId')::uuid and business_id=p_business_id and goal_id=source_scope.goal_id and content_hash=source_scope.amendment->>'sourcePlanHash';
 if source_plan.id is null then raise exception 'r12_review_owner_source_unavailable';end if;end if;
 select * into authority from private.r12_discovery_authorities where scope_id=source_scope.id;
 select * into saved_plan from private.r07_plans where business_id=p_business_id and goal_id=source_scope.goal_id and content->>'discoveryScopeId'=source_scope.id::text order by version desc limit 1;
 select * into head from private.r07_heads where plan_id=saved_plan.id;
 stopped:=authority.scope_id is null or exists(select 1 from private.r05_revocations where policy_id=(authority.plan->>'policyId')::uuid) or private.r05_paused(p_business_id,'business',p_business_id) or private.r05_paused(p_business_id,'quest',source_scope.goal_id)
 or not exists(select 1 from private.r04_goal_state gs join private.r04_goal_versions gv using(goal_id,business_id,revision) where gs.goal_id=source_scope.goal_id and gs.business_id=p_business_id and gs.revision=(authority.plan->>'goalRevision')::integer and gv.preference='ready')
 or not exists(select 1 from private.r04_business_state bs join private.r04_business_versions bv using(business_id,revision) where bs.business_id=p_business_id and bs.revision=(authority.plan->>'businessRevision')::integer and bv.preference='setup');
 policy_revoked:=exists(select 1 from private.r05_revocations where policy_id=(authority.plan->>'policyId')::uuid);
 paused:=private.r05_paused(p_business_id,'business',p_business_id) or private.r05_paused(p_business_id,'quest',source_scope.goal_id) or exists(select 1 from jsonb_array_elements(authority.plan->'steps') st where private.r05_paused(p_business_id,'pack',(st->>'installationId')::uuid));
 active:=not stopped and not paused and authority.valid_until>clock_timestamp() and exists(select 1 from private.r07_server_keys k where k.key_hash=authority.controller_key_hash and k.expires_at>clock_timestamp() and not exists(select 1 from private.r07_server_revocations rev where rev.key_hash=k.key_hash)) and exists(select 1 from private.r05_server_keys k where k.key_hash=authority.admission_key_hash and k.expires_at>clock_timestamp() and not exists(select 1 from private.r05_server_revocations rev where rev.key_hash=k.key_hash));
 if authority.scope_id is not null or source_plan.id is not null then
 for step in select value from jsonb_array_elements(case when source_plan.id is null then authority.plan->'steps' else source_plan.content->'steps' end) loop
 phase_plan_id:=case when source_plan.id is not null and step->>'key'<>'review' then source_plan.id else saved_plan.id end;
 select * into attempt from private.r07_attempts where plan_id=phase_plan_id and business_id=p_business_id and step_key=step->>'key' order by private.r07_attempts.attempt desc limit 1;
 select * into binding from private.r07_bindings where attempt_id=attempt.id;
 select * into request from private.r05_requests where id=binding.request_id;
 select * into candidate from private.r12_discovery_candidates where request_id=request.id;
 select * into response from private.r07_responses where attempt_id=attempt.id;
 select max(actual_microunits) into actual from private.r05_settlements where request_id=request.id and provider_request_id is not null;
 marked:=exists(select 1 from private.r05_markers where request_id=request.id);reserved:=exists(select 1 from private.r05_reservations where request_id=request.id) and not exists(select 1 from private.r05_releases where request_id=request.id);
 held:=case when reserved and actual is null then request.liability_microunits else 0 end;
 receipt:=case when candidate.request_id is null then null else private.r12_discovery_receipt_status(candidate)-array['requestId','candidateHash','proofHash'] end;
 known_total:=known_total+coalesce(actual,0);held_total:=held_total+held;unknown_cost:=unknown_cost or marked and actual is null;
 phases:=phases||jsonb_build_array(jsonb_build_object('phase',step->>'key','status',coalesce(attempt.status,'not_started'),'reason',attempt.reason,'attemptId',attempt.id,'artifactId',response.artifact_id,
 'candidateSaved',candidate.request_id is not null,'receipt',receipt,'knownMicrousd',actual::text,'heldMicrousd',held::text,'unknownCost',marked and actual is null,'outcome',response.content->'result'->>'outcome'));
 end loop;end if;
 budget:=private.stage13v2_budget_authority(source_scope.prior_round_id,false);
 return jsonb_build_object('version','r12.discovery-workspace.1','businessId',p_business_id,'scopeId',source_scope.id,'goalId',source_scope.goal_id,
 'title',(select content->>'title' from private.r04_goal_versions where goal_id=source_scope.goal_id order by revision desc limit 1),
 'approvedQuery',source_scope.amendment->>'approvedQuery','sourceDomains',source_scope.amendment->'allowedDomains','priorRoundId',source_scope.prior_round_id,'budgetAuthorityRootId',source_scope.budget_authority_root_id,
 'planId',saved_plan.id,'planHash',saved_plan.content_hash,'state',case when authority.scope_id is null then 'awaiting_authority' when head.state='completed' then 'completed' when policy_revoked then 'stopped' when paused then 'paused' when stopped then 'blocked' else coalesce(head.state,'prepared') end,'reason',case when policy_revoked then 'owner_stopped' when paused then 'scope_paused' when stopped and authority.scope_id is not null then 'scope_changed' else head.reason end,'policyRevoked',policy_revoked,'paused',paused,
 'activeWindow',active,'dispatchUntil',authority.valid_until,'receiptUntil',authority.receipt_until,'phases',phases,
 'cost',jsonb_build_object('knownMicrousd',known_total::text,'heldMicrousd',held_total::text,'hasUnknown',unknown_cost),'rootFunding',budget,
 'activation',case when p_activation and authority.scope_id is not null then jsonb_build_object('scope',source_scope.amendment,'plan',authority.plan,'planHash',authority.plan_hash,'mode',authority.mode,
 'controllerKeyHash',authority.controller_key_hash,'admissionKeyHash',authority.admission_key_hash,'operations',(select payload->'operations' from private.r05_policies where id=(authority.plan->>'policyId')::uuid)) else null end);
end $function$;

-- public.r12_discovery_scope_read
CREATE OR REPLACE FUNCTION public.r12_discovery_scope_read(p_business_id uuid, p_scope_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s private.r12_discovery_scopes; prior public.product_experiments; budget jsonb; begin
 if private.is_business_owner(p_business_id) is distinct from true then raise exception 'r12_scope_not_owned' using errcode='42501';end if;
 select * into s from private.r12_discovery_scopes where id=p_scope_id and business_id=p_business_id;
 if s.id is null then return null;end if;
 if s.amendment->>'version' is distinct from 'r12.discovery-source-scope.1' then raise exception 'r12_source_scope_only';end if;
 select * into strict prior from public.product_experiments where id=s.prior_round_id and business_id=p_business_id;
 if (s.amendment->>'expiresAt')::timestamptz<=clock_timestamp() or prior.status not in ('failed','completed') or exists(select 1 from public.product_experiments newer where newer.business_id=p_business_id and newer.discovery_version='pod-discovery-2.0' and newer.parent_discovery_id is null and newer.candidate_id is null and newer.variables->>'budgetAuthorityRootId'=s.budget_authority_root_id::text and (newer.created_at,newer.id)>(prior.created_at,prior.id)) or not exists(select 1 from private.r04_goal_versions gv join private.r04_goal_state gs using(goal_id,business_id,revision) where gv.goal_id=s.goal_id and gv.business_id=p_business_id and gv.preference='ready' and gv.content->>'objective'=prior.variables->'intent'->>'objective' and (select jsonb_agg(x order by x) from jsonb_array_elements_text(gv.content->'parsed'->'geography') x)=(select jsonb_agg(x->>'countryCode' order by x->>'countryCode') from jsonb_array_elements(prior.variables->'intent'->'comparisonUniverse'->'markets') x)) then raise exception 'r12_scope_no_longer_current';end if;
 budget:=private.stage13v2_budget_authority(prior.id,false);
 return jsonb_build_object('original',jsonb_build_object('businessId',s.business_id,'budgetAuthorityRootId',s.budget_authority_root_id,'priorRoundId',s.prior_round_id,'semanticGoalHash',prior.variables->>'semanticGoalHash','priorIntent',prior.variables->'intent','maximumMicrousd',budget->'maximumMicrousd','committedMicrousd',budget->'committedMicrousd','hasUncertainCosts',budget->'hasUncertainCosts'),'amendment',s.amendment,'amendmentHash',s.amendment_hash,'executionAuthorized',false);
end $function$;

-- Every private entry stays unavailable to API roles. Existing public function
-- ACLs are retained by CREATE OR REPLACE; only the two owner RPCs above are new.
do $acl$ declare fn regprocedure;begin
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in
 ('r12_review_source','r12_validate_review_envelope','r12_initialize_review_continuation','r12_review_phase_inputs','r12_review_result','r12_review_owner_proposal_validate','r12_review_owner_proposal_insert')
 loop execute format('revoke all on function %s from public,anon,authenticated,service_role',fn);end loop;
end $acl$;
commit;
