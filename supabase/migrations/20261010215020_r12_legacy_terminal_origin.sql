-- Definition-only forensic compatibility for already-closed legacy reviews.
-- No saved setup/projection, receipt, outcome, budget or authority is changed.
begin;

-- This is an archival proof, never a replacement for setup runtime eligibility.
-- 20760 deliberately keeps its original non_reconstructible classification.
-- The older published schema had exactly thirteen attempt keys. Its whole
-- prefix, including every original plan and settlement, must still hash to the
-- immutable closure that was consumed by a real successor activation.
create function private.r12_direct_origin_pre_adaptive_history(p private.r07_plans) returns jsonb
language plpgsql stable set search_path='' as $$
declare ep private.r12_owner_episode_activations;os private.r12_owner_setups;cl private.r12_owner_episode_closures;
 np private.r07_plans;sc private.r12_discovery_scopes;hp private.r12_historical_setup_projections;
 artifact jsonb;history jsonb;projected jsonb;attempt_row jsonb;rows jsonb:='[]'::jsonb;
begin
 select * into ep from private.r12_owner_episode_activations where predecessor_plan_id=p.id;
 select * into os from private.r12_owner_setups where id=ep.setup_id;
 select * into cl from private.r12_owner_episode_closures where predecessor_plan_id=p.id;
 select * into np from private.r07_plans where id=ep.plan_id;
 select * into sc from private.r12_discovery_scopes where id=ep.scope_id;
 select * into hp from private.r12_historical_setup_projections where artifact_kind='owner_setup' and setup_id=os.id and setup_hash=os.setup_hash;
 if p.id is null or p.content->>'format' is distinct from 'r12.discovery-episode.1'
 or ep.setup_id is null or os.id is null or cl.predecessor_plan_id is null or np.id is null or sc.id is null or hp.setup_id is null
 or ep.business_id is distinct from p.business_id or ep.goal_id is distinct from p.goal_id
 or os.business_id is distinct from p.business_id or os.goal_id is distinct from p.goal_id or os.owner_id is distinct from p.owner_id
 or cl.business_id is distinct from p.business_id or cl.goal_id is distinct from p.goal_id
 or np.business_id is distinct from p.business_id or np.goal_id is distinct from p.goal_id or np.owner_id is distinct from p.owner_id
 or np.previous_plan_id is distinct from p.id or np.version is distinct from p.version+1
 or np.content->>'format' is distinct from 'r12.discovery-episode.1' or np.content_hash is distinct from private.r04_hash(np.content)
 or np.content->>'discoveryScopeId' is distinct from sc.id::text or np.content->>'discoveryScopeHash' is distinct from sc.amendment_hash
 or sc.business_id is distinct from p.business_id or sc.goal_id is distinct from p.goal_id or sc.owner_setup_id is distinct from os.id
 or sc.origin is distinct from 'owner_episode' or sc.amendment->>'version' is distinct from 'r12.discovery-owner-episode.1'
 or sc.amendment_hash is distinct from private.stage14_hash(sc.amendment)
 or sc.amendment->>'setupId' is distinct from os.id::text or sc.amendment->>'setupHash' is distinct from os.setup_hash
 or sc.amendment->'predecessorClosure' is distinct from cl.proof or sc.amendment->>'predecessorClosureHash' is distinct from cl.proof_hash
 or os.preview->'predecessorClosure' is distinct from cl.proof or os.preview->>'predecessorClosureHash' is distinct from cl.proof_hash
 or ep.closure_hash is distinct from cl.proof_hash or cl.proof_hash is distinct from private.stage14_hash(cl.proof)
 or hp.disposition is distinct from 'non_reconstructible' or hp.attempt_shape is not null
 or hp.business_id is distinct from p.business_id or hp.goal_id is distinct from p.goal_id
 or hp.predecessor_plan_id is distinct from p.id or hp.predecessor_version is distinct from p.version
 or hp.closure_hash is distinct from cl.proof_hash or hp.history_hash is distinct from cl.proof->>'historyHash'
 or exists(select 1 from private.r12_historical_attempt_projections ap where ap.artifact_kind=hp.artifact_kind and ap.setup_id=hp.setup_id and ap.setup_hash=hp.setup_hash)
 then raise exception 'r12_direct_origin_legacy_history_anchor_required';end if;
 artifact:=private.r12_historical_setup_artifact('owner_setup',os.id,os.setup_hash);
 if artifact->'closure' is distinct from cl.proof or artifact->>'closureHash' is distinct from cl.proof_hash
 then raise exception 'r12_direct_origin_legacy_history_anchor_required';end if;
 history:=private.r12_historical_prefix(p.business_id,p.goal_id,p.version,'post20600');
 for attempt_row in select value from jsonb_array_elements(history->'attempts') loop
  perform private.r04_keys(attempt_row,array['id','business_id','goal_id','plan_id','child_id','step_key','attempt','input_hash','dependency_pins','status','reason','repair_evidence_hash','created_at','adaptive_action_ordinal','adaptive_action_hash','direct_cycle_ordinal']);
  if attempt_row->'adaptive_action_ordinal' is distinct from 'null'::jsonb or attempt_row->'adaptive_action_hash' is distinct from 'null'::jsonb
   or attempt_row->'direct_cycle_ordinal' is distinct from 'null'::jsonb then raise exception 'r12_direct_origin_legacy_history_shape_required';end if;
  rows:=rows||jsonb_build_array(attempt_row-array['adaptive_action_ordinal','adaptive_action_hash','direct_cycle_ordinal']);
 end loop;
 projected:=jsonb_set(history,'{attempts}',rows);
 if jsonb_array_length(rows)=0 or private.stage14_hash(projected) is distinct from hp.history_hash
 then raise exception 'r12_direct_origin_legacy_history_changed';end if;
 return jsonb_build_object('version','r12.direct-origin-pre-adaptive-history.1','attemptShape','r07.attempt.pre-adaptive.1',
  'setupId',os.id,'setupHash',os.setup_hash,'predecessorPlanId',p.id,'successorPlanId',np.id,'successorPlanHash',np.content_hash,
  'closureHash',cl.proof_hash,'historyHash',hp.history_hash);
end $$;

-- Financially settled and permanently closed is distinct from route-qualified
-- research. Legacy parse/schema failures stopped before candidate/receipt GETs.
-- Authenticate their exact original settlement and published closure; never
-- invent a candidate, route proof, accepted artifact or terminal status.
create function private.r12_direct_origin_legacy_terminal(aid uuid,rid uuid) returns text
language plpgsql stable set search_path='' as $$
declare a private.r07_attempts;r private.r05_requests;rb private.r07_bindings;p private.r07_plans;s private.r12_discovery_scopes;
 w private.r12_discovery_wires;q private.r12_discovery_authorities;st private.r05_settlements;
 successor private.r07_plans;successor_scope private.r12_discovery_scopes;received private.r12_discovery_response_observations;rejected private.r12_discovery_response_observations;
 mark timestamptz;expiry timestamptz;anchor jsonb;item jsonb;kind text;
begin
 select * into a from private.r07_attempts where id=aid;
 select * into r from private.r05_requests where id=rid;
 select * into rb from private.r07_bindings where attempt_id=aid;
 select * into p from private.r07_plans where id=a.plan_id;
 select * into s from private.r12_discovery_scopes where id=(p.content->>'discoveryScopeId')::uuid;
 select * into w from private.r12_discovery_wires where request_id=rid;
 select * into q from private.r12_discovery_authorities where scope_id=s.id;
 select * into st from private.r05_settlements where request_id=rid order by actual_microunits desc nulls last,id desc limit 1;
 select created_at into mark from private.r05_markers where request_id=rid;
 if a.id is null or r.id is null or rb.attempt_id is null or p.id is null or s.id is null or w.request_id is null or q.scope_id is null or st.id is null
 or a.step_key is distinct from 'review' or a.attempt is distinct from 1 or a.status not in ('dispatched','uncertain','responded','rejected','failed')
 or a.adaptive_action_ordinal is not null or a.adaptive_action_hash is not null or a.direct_cycle_ordinal is not null
 or p.content->>'format' not in ('r12.discovery-review.1','r12.discovery-episode.1')
 or a.business_id is distinct from p.business_id or a.goal_id is distinct from p.goal_id
 or r.business_id is distinct from p.business_id or r.workflow_run_id is distinct from a.id or r.policy_id is distinct from p.policy_id
 or rb.business_id is distinct from p.business_id or rb.request_id is distinct from r.id
 or (select count(*) from private.r05_requests where workflow_run_id=a.id)<>1
 or r.currency is distinct from 'USD' or r.payload->'accounting' is distinct from '{"kind":"r05"}'::jsonb
 or r.payload->>'workflowRunId' is distinct from a.id::text or r.payload->>'idempotencyKey' is distinct from 'r07:'||a.id
 or r.payload->>'operationKey' is distinct from 'research.r12.'||s.id||'.review'
 or r.request_hash is distinct from private.r04_hash(r.payload) or rb.descriptor_hash is distinct from r.request_hash
 or r.liability_microunits is distinct from private.r05_money(r.payload->'liabilityMicrounits')
 or p.content_hash is distinct from private.r04_hash(p.content) or p.content->>'discoveryScopeHash' is distinct from s.amendment_hash
 or s.business_id is distinct from p.business_id or s.goal_id is distinct from p.goal_id or s.amendment_hash is distinct from private.stage14_hash(s.amendment)
 or q.business_id is distinct from p.business_id or q.goal_id is distinct from p.goal_id or q.plan is distinct from p.content or q.plan_hash is distinct from p.content_hash
 or w.business_id is distinct from p.business_id or w.attempt_id is distinct from a.id or w.scope_id is distinct from s.id
 or w.producer_key_hash is distinct from q.controller_key_hash or w.binding_hash is distinct from private.stage14_hash(w.binding)
 or w.binding->>'version' is distinct from 'r12.discovery-wire.1'
 or w.binding->>'scopeId' is distinct from s.id::text or w.binding->>'scopeHash' is distinct from s.amendment_hash
 or w.binding->>'attemptId' is distinct from a.id::text or w.binding->>'requestId' is distinct from r.id::text or w.binding->>'phase' is distinct from a.step_key
 or w.binding->'dependencyPins' is distinct from a.dependency_pins
 or w.binding->>'requestHash' is distinct from r.payload->>'requestHash'
 or w.binding->>'requestHash' is distinct from private.stage14_hash((w.binding->>'requestJson')::jsonb)
 or w.binding->>'wireHash' is distinct from r.payload->>'wireRequestHash' or w.binding->>'wireHash' is distinct from rb.wire_hash
 or w.binding->>'wireHash' is distinct from encode(extensions.digest(convert_to(w.binding->>'wireBody','UTF8'),'sha256'),'hex')
 or mark is null or not exists(select 1 from private.r05_reservations where request_id=r.id and business_id=p.business_id)
 or not exists(select 1 from private.r07_markers where attempt_id=a.id and business_id=p.business_id)
 or not exists(select 1 from private.r12_discovery_transport_claims where request_id=r.id)
 or exists(select 1 from private.r05_releases where request_id=r.id)
 or exists(select 1 from private.r12_discovery_candidates where request_id=r.id)
 or exists(select 1 from private.r12_discovery_receipt_checks where request_id=r.id)
 or exists(select 1 from private.r07_responses where attempt_id=a.id)
 or exists(select 1 from public.artifacts where workflow_run_id=a.id and artifact_type='r12.discovery.review')
 or st.business_id is distinct from p.business_id or st.currency is distinct from 'USD' or st.actual_microunits is null or st.actual_microunits>r.liability_microunits
 or st.provider_request_id !~ '^gen-[A-Za-z0-9_-]+$' or length(st.provider_request_id)>300
 or st.receipt_hash is distinct from private.stage14_hash(jsonb_build_object('phase',a.step_key,'providerRequestId',st.provider_request_id,'actualMicrounits',st.actual_microunits::text))
 or exists(select 1 from private.r05_settlements z where z.request_id=r.id and (z.business_id<>p.business_id or z.currency<>'USD' or z.provider_request_id<>st.provider_request_id))
 or exists(select 1 from private.r05_settlements z where z.request_id<>r.id and z.provider_request_id=st.provider_request_id)
 or not exists(select 1 from private.r05_receipt_claims claim where claim.provider='openrouter' and claim.provider_request_id=st.provider_request_id
  and claim.business_id=p.business_id and claim.workflow_run_id=a.id and claim.source_key=r.source_key)
 or not exists(select 1 from private.r05_exposure(p.business_id) e where e.source_key=r.source_key and e.policy_id=p.policy_id and e.currency='USD' and e.held=st.actual_microunits and not e.unknown)
 or not exists(select 1 from private.r05_revocations where policy_id=p.policy_id and business_id=p.business_id)
 or not exists(select 1 from private.r07_server_revocations where key_hash=q.controller_key_hash)
 or not exists(select 1 from private.r05_server_revocations where key_hash=q.admission_key_hash)
 then raise exception 'r12_direct_origin_legacy_terminal_unverified';end if;
 if p.content->>'format'='r12.discovery-review.1' then
  select * into successor from private.r07_plans where previous_plan_id=p.id and business_id=p.business_id and goal_id=p.goal_id;
  select * into successor_scope from private.r12_discovery_scopes where id=(successor.content->>'discoveryScopeId')::uuid;
  if successor.id is null or successor.version is distinct from p.version+1 or successor.owner_id is distinct from p.owner_id
   or successor.content->>'format' is distinct from 'r12.discovery-review.1' or successor.content_hash is distinct from private.r04_hash(successor.content)
   or successor_scope.business_id is distinct from p.business_id or successor_scope.goal_id is distinct from p.goal_id
   or successor_scope.amendment->>'version' is distinct from 'r12.discovery-review-continuation.2'
   or successor_scope.amendment_hash is distinct from private.stage14_hash(successor_scope.amendment)
   or successor.content->>'discoveryScopeHash' is distinct from successor_scope.amendment_hash
   then raise exception 'r12_direct_origin_legacy_review_anchor_required';end if;
  perform private.r12_review_successor_source(successor_scope,(successor_scope.amendment->>'createdAt')::timestamptz,false);
  select value into strict item from jsonb_array_elements(successor_scope.amendment->'reviewHistory')
   where value->>'planId'=p.id::text and value->>'attemptId'=a.id::text and value->>'requestId'=r.id::text;
  if item->>'scopeId' is distinct from s.id::text or item->>'scopeHash' is distinct from s.amendment_hash
   or item->>'planHash' is distinct from p.content_hash or item->>'settlementHash' is distinct from st.receipt_hash
   or item->>'actualMicrounits' is distinct from st.actual_microunits::text then raise exception 'r12_direct_origin_legacy_review_anchor_required';end if;
  kind:='legacy_review_successor';anchor:=jsonb_build_object('successorPlanId',successor.id,'successorPlanHash',successor.content_hash,
   'successorScopeHash',successor_scope.amendment_hash,'reviewHistoryItem',item);
 else
  anchor:=private.r12_direct_origin_pre_adaptive_history(p);kind:='pre_adaptive_owner_episode';
  select * into received from private.r12_discovery_response_observations o where o.request_id=r.id and o.kind='received';
  select * into rejected from private.r12_discovery_response_observations o where o.request_id=r.id and o.kind='rejected';
  -- The table primary key (request_id,kind) makes both reads unique.
  perform private.r04_keys(received.payload,array['scopeId','attemptId','requestId','version','receivedAt','providerRequestId','providerModelId','finishReason','nativeFinishReason','contentState','content','contentBytes','contentHash']);
  perform private.r04_keys(rejected.payload,array['scopeId','attemptId','requestId','version','recordedAt','code','httpStatus','observationSaved','issues']);
  expiry:=least((p.content->>'expiresAt')::timestamptz+interval '30 minutes',mark+interval '60 minutes',q.receipt_until);
  if received.request_id is null or rejected.request_id is null or expiry is null or not isfinite(expiry)
   or jsonb_typeof(received.payload->'receivedAt') is distinct from 'string' or jsonb_typeof(rejected.payload->'recordedAt') is distinct from 'string'
   or not isfinite((received.payload->>'receivedAt')::timestamptz) or not isfinite((rejected.payload->>'recordedAt')::timestamptz)
   or received.payload_hash is distinct from private.stage14_hash(received.payload) or rejected.payload_hash is distinct from private.stage14_hash(rejected.payload)
   or received.payload->>'version' is distinct from 'r12.review-observation.1' or rejected.payload->>'version' is distinct from 'r12.review-diagnostic.1'
   or received.payload->>'scopeId' is distinct from s.id::text or received.payload->>'attemptId' is distinct from a.id::text or received.payload->>'requestId' is distinct from r.id::text
   or rejected.payload->>'scopeId' is distinct from s.id::text or rejected.payload->>'attemptId' is distinct from a.id::text or rejected.payload->>'requestId' is distinct from r.id::text
   or received.payload->>'providerRequestId' is distinct from st.provider_request_id
   or not coalesce(received.payload->>'providerModelId' in ('anthropic/claude-haiku-4.5','anthropic/claude-4.5-haiku-20251001'),false)
   or rejected.payload->>'code' is distinct from 'response_schema' or rejected.payload->'observationSaved' is distinct from 'true'::jsonb
   or received.created_at<mark or received.created_at>=expiry or rejected.created_at<received.created_at or rejected.created_at>=expiry
   or (received.payload->>'receivedAt')::timestamptz<mark or (received.payload->>'receivedAt')::timestamptz>=expiry
   or (rejected.payload->>'recordedAt')::timestamptz<(received.payload->>'receivedAt')::timestamptz or (rejected.payload->>'recordedAt')::timestamptz>=expiry
   then raise exception 'r12_direct_origin_legacy_diagnostic_unverified';end if;
  anchor:=anchor||jsonb_build_object('receivedObservationHash',received.payload_hash,'rejectedDiagnosticHash',rejected.payload_hash);
 end if;
 return private.stage14_hash(jsonb_build_object('version','r12.direct-origin-legacy-terminal.1','kind',kind,'researchQualified',false,
  'attemptId',a.id,'requestId',r.id,'wireBindingHash',w.binding_hash,'requestHash',r.request_hash,'settlement',to_jsonb(st),'anchor',anchor));
end $$;

-- Preserve the established function OID and every ordinary paid-receipt gate.
-- Only absent-candidate legacy reviews enter the new forensic verifier.
do $patch$ declare d text;old text;replacement text;begin
 d:=pg_get_functiondef('private.r12_direct_origin_financial(uuid,uuid)'::regprocedure);
 old:='  if w.request_id is null or c.request_id is null or proof is null or st.id is null or st.actual_microunits is null';
 replacement:=$new$  if c.request_id is null and proof is null and a.step_key='review'
   and exists(select 1 from private.r07_plans pl where pl.id=a.plan_id and pl.content->>'format' in ('r12.discovery-review.1','r12.discovery-episode.1')) then
   qualification:=private.r12_direct_origin_legacy_terminal(a.id,r.id);disposition:='qualified_terminal_failure';
  else
$new$||old;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_direct_origin_legacy_financial_patch_drift';end if;
 d:=replace(d,old,replacement);
 old:='  body:=jsonb_build_object(''scopeId'',w.scope_id,''attemptId'',a.id,''requestId'',r.id,''requestHash'',w.binding->>''requestHash'',';
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_direct_origin_legacy_financial_patch_drift';end if;
 execute replace(d,old,E'  end if;\n'||old);
end $patch$;
revoke all on function private.r12_direct_origin_pre_adaptive_history(private.r07_plans),private.r12_direct_origin_legacy_terminal(uuid,uuid) from public,anon,authenticated,service_role;
-- Origin-only adapter for the published pre-owner source contracts. These
-- scopes never stored amendment.intent. The TypeScript source contract derives
-- intent.id=sourceAmendment.id; review/evidence continuations retain that ID.
-- Authenticate that original derivation, without fabricating a stored intent
-- or broadening the shared adaptive input/runtime verifier.
create function private.r12_direct_origin_legacy_intent_v1(a private.r07_attempts,p private.r07_plans,s private.r12_discovery_scopes,mark timestamptz) returns text
language plpgsql stable set search_path='' as $$
declare src private.r12_discovery_scopes;source jsonb;prior public.product_experiments;begin
 if a.adaptive_action_hash is not null or a.adaptive_action_ordinal is not null or a.direct_cycle_ordinal is not null
 or s.amendment ? 'intent' or a.business_id is distinct from p.business_id or a.goal_id is distinct from p.goal_id
 or a.plan_id is distinct from p.id or s.business_id is distinct from p.business_id or s.goal_id is distinct from p.goal_id
 or p.content_hash is distinct from private.r04_hash(p.content)
 or p.content->>'discoveryScopeId' is distinct from s.id::text or p.content->>'discoveryScopeHash' is distinct from s.amendment_hash
 or s.amendment_hash is distinct from private.stage14_hash(s.amendment)
 or s.amendment->>'id' is distinct from s.id::text or s.amendment->>'businessId' is distinct from s.business_id::text
 or s.amendment->>'goalId' is distinct from s.goal_id::text or s.amendment->>'priorRoundId' is distinct from s.prior_round_id::text
 or s.amendment->>'budgetAuthorityRootId' is distinct from s.budget_authority_root_id::text
 or mark is null or not isfinite(mark)
 then raise exception 'r12_direct_origin_legacy_intent_identity';end if;
 -- This checks the immutable accepted response AND its exact public artifact.
 perform private.r12_discovery_completed_phase(a,p);
 if p.content->>'format'='r12.discovery.1' and s.amendment->>'version'='r12.discovery-source-scope.1'
  and p.version=1 and p.previous_plan_id is null then src:=s;
 elsif (p.content->>'format'='r12.discovery-review.1' and s.amendment->>'version' in ('r12.discovery-review-continuation.1','r12.discovery-review-continuation.2'))
  or (p.content->>'format'='r12.discovery-evidence.1' and s.amendment->>'version'='r12.discovery-evidence-continuation.1') then
  source:=private.r12_review_source(s,mark,false);
  select * into src from private.r12_discovery_scopes where id=(s.amendment->>'sourceScopeId')::uuid;
  if src.id is null or source->'sourceAmendment' is distinct from src.amendment
   or s.amendment->>'sourceScopeHash' is distinct from src.amendment_hash
   then raise exception 'r12_direct_origin_legacy_intent_source';end if;
 else raise exception 'r12_direct_origin_legacy_intent_version';end if;
 perform private.r04_keys(src.amendment,array['version','id','businessId','goalId','budgetAuthorityRootId','priorRoundId','originalIntentHash','originalSemanticGoalHash','allowedDomains','excludedDomains','sourceReviews','approvalHash','independentReviewHash','purposeReviewHash','approvedQuery','createdAt','expiresAt']);
 select * into prior from public.product_experiments where id=src.prior_round_id;
 if src.business_id is distinct from s.business_id or src.goal_id is distinct from s.goal_id
 or src.budget_authority_root_id is distinct from s.budget_authority_root_id or src.prior_round_id is distinct from s.prior_round_id
 or src.amendment->>'version' is distinct from 'r12.discovery-source-scope.1'
 or src.amendment_hash is distinct from private.stage14_hash(src.amendment)
 or src.amendment->>'id' is distinct from src.id::text or src.amendment->>'businessId' is distinct from src.business_id::text
 or src.amendment->>'goalId' is distinct from src.goal_id::text or src.amendment->>'priorRoundId' is distinct from src.prior_round_id::text
 or src.amendment->>'budgetAuthorityRootId' is distinct from src.budget_authority_root_id::text
 or src.id in (src.prior_round_id,src.budget_authority_root_id)
 or prior.id is null or prior.business_id is distinct from src.business_id or prior.discovery_version is distinct from 'pod-discovery-2.0'
 or prior.parent_discovery_id is not null or prior.candidate_id is not null or prior.status not in ('failed','completed')
 or prior.variables->>'budgetAuthorityRootId' is distinct from src.budget_authority_root_id::text
 or prior.variables->>'semanticGoalHash' is distinct from src.amendment->>'originalSemanticGoalHash'
 or private.stage14_hash(prior.variables->'intent') is distinct from src.amendment->>'originalIntentHash'
 or prior.variables->'intent'->>'id' is distinct from src.prior_round_id::text
 or prior.variables->'intent'->>'businessId' is distinct from src.business_id::text
 then raise exception 'r12_direct_origin_legacy_intent_original';end if;
 return src.id::text;
end $$;

-- Clone the qualified archival readers, changing only the explicitly missing
-- legacy intent resolver and the calls to it. Runtime readers stay unchanged.
do $patch$ declare d text;old text;replacement text;begin
 d:=pg_get_functiondef('private.r12_adaptive_input_dependency(uuid)'::regprocedure);
 old:='private.r12_adaptive_input_dependency(';
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_direct_origin_dependency_patch_drift';end if;
 d:=replace(d,old,'private.r12_direct_origin_dependency(');
 old:=' else intent_id:=s.amendment->''intent''->>''id'';end if;';
 replacement:=$new$ else
  intent_id:=s.amendment->'intent'->>'id';
  if intent_id is null then intent_id:=private.r12_direct_origin_legacy_intent_v1(a,p,s,mark);end if;
 end if;$new$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_direct_origin_dependency_patch_drift';end if;
 execute replace(d,old,replacement);
 d:=pg_get_functiondef('private.r12_adaptive_evidence_archive(uuid)'::regprocedure);
 old:='private.r12_adaptive_evidence_archive(';
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_direct_origin_archive_patch_drift';end if;
 d:=replace(d,old,'private.r12_direct_origin_evidence_archive(');
 old:='private.r12_adaptive_input_dependency(';
 if (length(d)-length(replace(d,old,'')))/length(old)<>2 then raise exception 'r12_direct_origin_archive_patch_drift';end if;
 execute replace(d,old,'private.r12_direct_origin_dependency(');
 d:=pg_get_functiondef('private.r12_direct_origin_build(uuid,uuid)'::regprocedure);
 old:='private.r12_adaptive_input_dependency(';
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_direct_origin_build_patch_drift';end if;
 d:=replace(d,old,'private.r12_direct_origin_dependency(');
 old:='private.r12_adaptive_evidence_archive(';
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_direct_origin_build_patch_drift';end if;
 d:=replace(d,old,'private.r12_direct_origin_evidence_archive(');
 -- The old addendum branch passed a generic record after reusing it for other
 -- row shapes. Give that loop its actual composite type; validation is intact.
 old:=' x record;d jsonb;';
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_direct_origin_addendum_patch_drift';end if;
 d:=replace(d,old,' x record;addendum_scope private.r12_discovery_scopes;d jsonb;');
 old:=$old$ -- Authenticated public addenda were not selector calls; retain them separately.
 for x in select sc.* from private.r12_discovery_scopes sc join private.r07_plans pl on pl.content->>'discoveryScopeId'=sc.id::text
 where pl.business_id=b and pl.goal_id=g and sc.amendment->>'version'='r12.discovery-evidence-continuation.1' order by pl.version loop
  perform private.r12_evidence_addendum_validate(x,(x.amendment->>'createdAt')::timestamptz,false);
  for obs in select value from jsonb_array_elements(x.amendment->'addendum'->'observations') loop
   body:=jsonb_build_object('kind','legacy_evidence','scopeId',x.id,'containerId',x.amendment->'addendum'->>'id',
    'containerHash',x.amendment->>'addendumHash','sourceId',obs->>'sourceId','sourceContentHash',obs->>'contentHash',
    'evidenceId',obs->>'id','evidenceIdentityHash',private.r12_direct_origin_quote(substr(obs->>'context',(obs->>'start')::integer+1,(obs->>'end')::integer-(obs->>'start')::integer)),
    'factIdentityHash',null);body:=body||jsonb_build_object('provenanceHash',private.stage14_hash(body));
   if not provenance @> jsonb_build_array(body) then provenance:=provenance||jsonb_build_array(body);end if;
  end loop;
 end loop;
$old$;
 replacement:=replace(replace(replace(old,'for x in','for addendum_scope in'),'_validate(x,','_validate(addendum_scope,'),'x.','addendum_scope.');
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_direct_origin_addendum_patch_drift';end if;
 execute replace(d,old,replacement);
end $patch$;
revoke all on function private.r12_direct_origin_legacy_intent_v1(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,timestamptz),private.r12_direct_origin_dependency(uuid),private.r12_direct_origin_evidence_archive(uuid) from public,anon,authenticated,service_role;

commit;
