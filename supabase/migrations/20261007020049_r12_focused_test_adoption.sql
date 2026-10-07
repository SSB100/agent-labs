-- Exact focused TEST adoption after the separate pilot migration; no authority is seeded.
begin;

-- Owner-guarded authenticated adoption is the only new public EXECUTE grant.
-- Depends on the reviewed r12_pilot_* helpers. Original research USD2 funding
-- remains provenance only; creative reservations use Stage14 + Business R05 caps.
-- One adopted candidate experiment references the REAL R12 review response artifact.
-- It is never a Stage13 worker/source pack, research root or new R07 child.

create table private.r12_focused_adoptions (
 id uuid primary key, scope_id uuid not null unique references private.r12_discovery_scopes(id),
 business_id uuid not null references public.businesses(id), candidate_id uuid not null,
 experiment_id uuid not null unique, decision_id uuid not null unique,
 result jsonb not null, proof jsonb not null, proof_hash text not null,
 actor_id uuid not null references auth.users(id), created_at timestamptz not null default clock_timestamp(),
 foreign key(candidate_id,business_id) references public.product_candidates(id,business_id),
 foreign key(experiment_id,candidate_id,business_id) references public.product_experiments(id,candidate_id,business_id) deferrable initially deferred,
 foreign key(decision_id) references public.product_decisions(id) deferrable initially deferred,
 check(octet_length(result::text)<=262144 and octet_length(proof::text)<=8192 and proof_hash=private.stage14_hash(proof)),
 unique(id,business_id)
);
alter table private.r12_focused_adoptions enable row level security;
revoke all on private.r12_focused_adoptions from public,anon,authenticated,service_role;
create trigger r12_focused_adoption_history_guard before insert or update or delete on private.r12_focused_adoptions
 for each row execute function private.r12_discovery_history_guard();

-- Keep a distinct discriminator so ordinary Stage13 budget/source validators
-- cannot treat an adopted recommendation as another research funding root.
alter table public.product_experiments drop constraint product_experiments_discovery_version_check;
alter table public.product_experiments add constraint product_experiments_discovery_version_check
 check(discovery_version in ('pod-discovery-1.0','pod-discovery-2.0','r12.focused-adoption.1'));
alter table public.product_experiments drop constraint product_experiments_versioned_identity_check;
alter table public.product_experiments add constraint product_experiments_versioned_identity_check check(
 (discovery_version='pod-discovery-1.0' and candidate_id is not null and parent_discovery_id is null) or
 (discovery_version='pod-discovery-2.0' and workflow_run_id is not null and basis_artifact_id is null and
   ((parent_discovery_id is null and candidate_id is null) or (parent_discovery_id is not null and candidate_id is not null and parent_discovery_id<>id))) or
 (discovery_version='r12.focused-adoption.1' and candidate_id is not null and parent_discovery_id is null and workflow_run_id is not null and basis_artifact_id is null and status='completed'));
-- Reuse the exact existing nonauthorizing learning-plan predicate. Its existing
-- ordinary v2 parent restriction stays intact; only the new discriminator gets
-- a candidate experiment without an invented research root.
do $draft$
declare definition text;begin
 select pg_get_constraintdef(oid) into strict definition from pg_constraint
 where conrelid='public.product_experiments'::regclass and conname='product_experiments_versioned_measurement_plan_check';
 if definition not like 'CHECK (%)' then raise exception 'r12_measurement_constraint_definition_drift';end if;
 execute 'alter table public.product_experiments drop constraint product_experiments_versioned_measurement_plan_check';
 execute 'alter table public.product_experiments add constraint product_experiments_versioned_measurement_plan_check check ('||
 substring(definition from 8 for length(definition)-8)||' or (discovery_version=''r12.focused-adoption.1'' and measurement_plan->>''version''=''pod-discovery-2.0'' and jsonb_typeof(measurement_plan->''testPlan'')=''object''))';
end $draft$;
alter table public.product_decisions add column focused_adoption_id uuid references private.r12_focused_adoptions(id) deferrable initially deferred;
do $draft$
declare definition text;begin
 select pg_get_constraintdef(oid) into strict definition from pg_constraint
 where conrelid='public.product_decisions'::regclass and conname='product_decisions_versioned_origin_check';
 if definition not like 'CHECK (%)' then raise exception 'r12_origin_constraint_definition_drift';end if;
 execute 'alter table public.product_decisions drop constraint product_decisions_versioned_origin_check';
 execute 'alter table public.product_decisions add constraint product_decisions_versioned_origin_check check ((focused_adoption_id is null and ('||
 substring(definition from 8 for length(definition)-8)||')) or (focused_adoption_id is not null and assessment->>''version''=''pod-discovery-2.0'' and assessment->>''outcome''=''TEST'' and assessment->''publicationAllowed''=''false''::jsonb and assessment->''commerceAllowed''=''false''::jsonb and jsonb_typeof(assessment->''execution''->''qualifiedRoute'')=''object''))';
end $draft$;

-- Accept only exact normalized hashes committed by the trusted, qualified R12
-- response projector. Owner JSON never supplies its own successful receipt.
create function private.r12_focused_adoption_source(p_scope_id uuid,p_result jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare s private.r12_discovery_scopes;p private.r07_plans;strategy_a private.r07_attempts;review_a private.r07_attempts;
 strategy jsonb;review jsonb;profile jsonb;receipts jsonb;budget jsonb;step jsonb;installation public.installed_packs;knowledge jsonb;knowledge_key text;knowledge_count integer;
begin
 if jsonb_typeof(p_result) is distinct from 'object' or octet_length(p_result::text)>262144 then raise exception 'r12_adoption_result_required';end if;
 perform private.r04_keys(p_result,array['version','businessId','scopeId','goalId','planId','historyOnly','executionAuthorized','reviewedAt','sourceScopeExpiresAt','originalFundingRootId','sourceScopeHash','knowledgeHash','objective','dossier','assessment','review','focusedPilot','focusedPilotProfileHash','evidenceAddendum','predecessorScopeId','phaseReceipts']);
 select * into strict s from private.r12_discovery_scopes where id=p_scope_id and amendment->>'version'='r12.discovery-focused-pilot.1';
 select * into strict p from private.r07_plans where id=(p_result->>'planId')::uuid and business_id=s.business_id and goal_id=s.goal_id;
 perform private.r12_pilot_scope_at(p,clock_timestamp(),true);
 if not exists(select 1 from private.r07_heads h where h.plan_id=p.id and h.goal_id=p.goal_id and h.business_id=p.business_id and h.state='completed' and h.dispatches=2 and h.children_created=2)
 or exists(select 1 from private.r07_plans newer where newer.goal_id=p.goal_id and newer.business_id=p.business_id and newer.version>p.version)
 or private.r05_paused(s.business_id,'business',s.business_id) or private.r05_paused(s.business_id,'quest',s.goal_id) then raise exception 'r12_adoption_current_completed_plan_required';end if;
 -- A fresh adoption/current approval cannot reuse a superseded installation
 -- or expired operating/policy knowledge merely because its earlier TEST was valid.
 for step in select value from jsonb_array_elements(p.content->'steps') loop
  select * into installation from public.installed_packs where id=(step->>'installationId')::uuid and business_id=s.business_id and status='active';
  if installation.id is null or private.r04_hash(installation.snapshot) is distinct from step->>'packSnapshotHash'
  or private.r05_paused(s.business_id,'pack',installation.id)
  or exists(select 1 from jsonb_array_elements(installation.snapshot->'releases') release where not exists(
   select 1 from public.packs catalog where catalog.id=(release->>'id')::uuid and catalog.manifest=release->'manifest' and catalog.status in ('experimental','qualified')))
  then raise exception 'r12_adoption_knowledge_installation_changed';end if;
  foreach knowledge_key in array array['etsy.current-policy','pod.production','product.research','social.marketing','research.evidence-guide'] loop
   select count(*) into knowledge_count from jsonb_array_elements(installation.snapshot->'releases') release
   cross join lateral jsonb_array_elements(release->'manifest'->'knowledge') item where item->>'key'=knowledge_key;
   select item into knowledge from jsonb_array_elements(installation.snapshot->'releases') release
   cross join lateral jsonb_array_elements(release->'manifest'->'knowledge') item where item->>'key'=knowledge_key;
   if knowledge_count<>1 or (knowledge->>'verifiedAt')::timestamptz>clock_timestamp()
   or (knowledge->>'verifiedAt')::timestamptz+make_interval(days=>(knowledge->>'freshnessDays')::integer)<=clock_timestamp()
   then raise exception 'r12_adoption_knowledge_expired';end if;
  end loop;
 end loop;
 select * into strict strategy_a from private.r07_attempts where plan_id=p.id and business_id=s.business_id and step_key='strategy' and attempt=1 and status='completed';
 select * into strict review_a from private.r07_attempts where plan_id=p.id and business_id=s.business_id and step_key='review' and attempt=1 and status='completed';
 strategy:=private.r12_discovery_completed_phase(strategy_a,p);review:=private.r12_discovery_completed_phase(review_a,p);profile:=s.amendment->'profile';
 if p_result->>'version' is distinct from 'r12.discovery-focused-pilot-result.1' or p_result->>'businessId' is distinct from s.business_id::text
 or p_result->>'scopeId' is distinct from s.id::text or p_result->>'goalId' is distinct from s.goal_id::text
 or p_result->'historyOnly' is distinct from 'true'::jsonb or p_result->'executionAuthorized' is distinct from 'false'::jsonb
 or p_result->>'sourceScopeHash' is distinct from s.amendment_hash or p_result->'focusedPilot' is distinct from profile
 or p_result->>'focusedPilotProfileHash' is distinct from s.amendment->>'profileHash' or p_result->>'focusedPilotProfileHash' is distinct from private.stage14_hash(profile)
 or p_result->>'originalFundingRootId' is distinct from s.budget_authority_root_id::text or p_result->'sourceScopeExpiresAt' is distinct from profile->'expiresAt'
 or p_result->'objective' is distinct from profile->'intent'->'objective' or p_result->'evidenceAddendum' is distinct from profile->'observations'
 or p_result->'predecessorScopeId' is distinct from profile->'history'->'acceptedReviewScopeId'
 or p_result->'knowledgeHash' is distinct from review->'binding'->'request'->'requestMetadata'->'r12KnowledgeHash'
 or p_result->'knowledgeHash' is distinct from strategy->'binding'->'request'->'requestMetadata'->'r12KnowledgeHash'
 or p_result->'reviewedAt' is distinct from review->'candidate'->'receivedAt'
 or p_result->'assessment'->'testPlan' is distinct from profile->'pinnedLearningPlan'
 or p_result->'assessment'->'recommendation'->>'proposedOutcome' is distinct from 'TEST'
 or p_result->'review'->>'outcome' is distinct from 'TEST' or p_result->'review'->>'marketCountryCode' is distinct from 'GB'
 or p_result->'review'->'candidateId' is distinct from profile->'candidate'->'id'
 or p_result->'review'->>'intentId' is distinct from s.id::text
 or private.stage14_hash(p_result->'assessment') is distinct from strategy->'response'->'result'->>'assessmentHash'
 or private.stage14_hash(p_result->'review') is distinct from review->'response'->'result'->>'reviewHash'
 or p_result->'review'->>'assessmentHash' is distinct from private.stage14_hash(p_result->'assessment')
 or p_result->'review'->>'dossierHash' is distinct from private.stage14_hash(p_result->'dossier')
 or p_result->'assessment'->>'dossierHash' is distinct from private.stage14_hash(p_result->'dossier')
 or p_result->'dossier'->'shortlist' is distinct from jsonb_build_array(profile->'candidate')
 or p_result->'dossier'->'packRefs' is distinct from '[]'::jsonb
 or p_result->'assessment'->'execution'->'qualifiedRoute' is distinct from strategy->'proof'
 or p_result->'review'->'execution'->'qualifiedRoute' is distinct from review->'proof'
 or p_result->'assessment'->'execution'->'modelId' is distinct from strategy->'candidate'->'providerModelId'
 or p_result->'review'->'execution'->'modelId' is distinct from review->'candidate'->'providerModelId'
 then raise exception 'r12_adoption_exact_accepted_test_required';end if;
 receipts:=jsonb_build_array(
 jsonb_build_object('phase','strategy','artifactId',strategy->'artifactId','responseHash',strategy->'responseHash','candidateHash',private.stage14_hash(strategy->'candidate'),'routeProofHash',strategy->'proof'->'proofHash'),
 jsonb_build_object('phase','review','artifactId',review->'artifactId','responseHash',review->'responseHash','candidateHash',private.stage14_hash(review->'candidate'),'routeProofHash',review->'proof'->'proofHash'));
 if p_result->'phaseReceipts' is distinct from receipts then raise exception 'r12_adoption_receipt_binding';end if;
 -- Research funding is checked for closure/currentness, never assigned to creative.
 budget:=private.stage13v2_budget_authority(s.prior_round_id,true);
 if budget->'hasUncertainCosts' is distinct from 'false'::jsonb or (budget->>'maximumMicrousd')::bigint<>2000000 or
 (budget->>'committedMicrousd')::bigint>(budget->>'maximumMicrousd')::bigint then raise exception 'r12_adoption_research_funding_unreconciled';end if;
 return jsonb_build_object('plan',to_jsonb(p),'profile',profile,'strategy',strategy,'review',review,'resultHash',private.stage14_hash(p_result));
end $$;
revoke all on function private.r12_focused_adoption_source(uuid,jsonb) from public,anon,authenticated,service_role;

-- Carry only unresolved execution questions needed by the creative phases; do
-- not waive them or send the unrelated commercial review history to the models.
create function private.r12_focused_execution_constraints(p_result jsonb) returns jsonb language sql immutable set search_path='' as $$
 select coalesce((select jsonb_agg(jsonb_build_object('dimension',dimension->'dimension','question',uncertainty->'question','reason',uncertainty->'reason','blockingForTest',uncertainty->'blockingForTest') order by d.ordinality,u.ordinality)
 from jsonb_array_elements(p_result->'assessment'->'candidates'->0->'dimensions') with ordinality d(dimension,ordinality)
 cross join lateral jsonb_array_elements(dimension->'uncertainties') with ordinality u(uncertainty,ordinality)
 where dimension->>'dimension' in ('policy_ip_risk','production_complexity')),'[]'::jsonb)
 ||coalesce((select jsonb_agg(uncertainty order by u.ordinality) from jsonb_array_elements(p_result->'review'->'additionalUncertainties') with ordinality u(uncertainty,ordinality)
 where uncertainty->>'dimension' in ('policy_ip_risk','production_complexity')),'[]'::jsonb)
$$;
revoke all on function private.r12_focused_execution_constraints(jsonb) from public,anon,authenticated,service_role;

create function private.r12_focused_adoption_proof(p_adoption_id uuid,p_source jsonb,p_result jsonb,p_adopted_at text)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('version','r12.focused-adoption.1','adoptionId',p_adoption_id,
 'businessId',p_result->'businessId','candidateId',p_result->'focusedPilot'->'candidate'->'id','candidateIdentityHash',private.stage14_hash(p_result->'focusedPilot'->'candidate'),
 'scopeId',p_result->'scopeId','scopeHash',p_result->'sourceScopeHash','profileHash',p_result->'focusedPilotProfileHash','resultHash',private.stage14_hash(p_result),
 'planId',p_result->'planId','planHash',p_source->'plan'->'content_hash','goalId',p_result->'goalId','goalRevision',p_source->'plan'->'content'->'goalRevision','goalHash',p_source->'plan'->'content'->'goalHash',
 'dossierHash',private.stage14_hash(p_result->'dossier'),'assessmentHash',private.stage14_hash(p_result->'assessment'),'reviewHash',private.stage14_hash(p_result->'review'),'learningPlanHash',private.stage14_hash(p_result->'focusedPilot'->'pinnedLearningPlan'),'originalDesignConstraintsHash',private.stage14_hash(p_result->'focusedPilot'->'originalDesignConstraints'),'maximumCreativeProposalMicrousd',p_result->'focusedPilot'->'pinnedLearningPlan'->'maximumMicrousd','executionConstraintsHash',private.stage14_hash(private.r12_focused_execution_constraints(p_result)),
 'originalResearchFundingRootId',p_result->'originalFundingRootId','researchMaximumMicrousd',2000000,
 'strategyArtifactId',p_source->'strategy'->'artifactId','strategyResponseHash',p_source->'strategy'->'responseHash','strategyCandidateHash',private.stage14_hash(p_source->'strategy'->'candidate'),'strategyRouteProofHash',p_source->'strategy'->'proof'->'proofHash',
 'reviewArtifactId',p_source->'review'->'artifactId','reviewResponseHash',p_source->'review'->'responseHash','reviewCandidateHash',private.stage14_hash(p_source->'review'->'candidate'),'reviewRouteProofHash',p_source->'review'->'proof'->'proofHash',
 'marketCountryCode','GB','maximumGenerations',1,'adoptedAt',p_adopted_at,'expiresAt',p_result->'sourceScopeExpiresAt',
 'executionAuthorized',false,'publicationAllowed',false,'commerceAllowed',false)
$$;
revoke all on function private.r12_focused_adoption_proof(uuid,jsonb,jsonb,text) from public,anon,authenticated,service_role;

create function private.r12_focused_adoption_current(p_adoption_id uuid) returns private.r12_focused_adoptions language plpgsql set search_path='' as $$
declare a private.r12_focused_adoptions;fresh jsonb;begin
 select * into strict a from private.r12_focused_adoptions where id=p_adoption_id;
 fresh:=private.r12_focused_adoption_source(a.scope_id,a.result);
 if a.proof_hash is distinct from private.stage14_hash(a.proof)
 or a.proof is distinct from private.r12_focused_adoption_proof(a.id,fresh,a.result,a.proof->>'adoptedAt')
 or (a.proof->>'expiresAt')::timestamptz<=clock_timestamp() then raise exception 'r12_adoption_stale_or_mutated';end if;
 return a;
end $$;
revoke all on function private.r12_focused_adoption_current(uuid) from public,anon,authenticated,service_role;

-- The authenticated owner action is enabled only with this complete bridge,
-- including installation and exact financial/transport admission, is approved.
create function public.adopt_r12_focused_test(p_scope_id uuid,p_result jsonb,p_owner_intent jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.r12_discovery_scopes;a private.r12_focused_adoptions;source jsonb;proof jsonb;candidate jsonb;descriptor jsonb;profile jsonb;
 aid uuid:=private.stage4_deterministic_uuid('r12:focused-adoption:'||p_scope_id);
 eid uuid:=private.stage4_deterministic_uuid('r12:focused-adoption-experiment:'||p_scope_id);
 did uuid:=private.stage4_deterministic_uuid('r12:focused-adoption-decision:'||p_scope_id);
 adopted_at text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
 select * into s from private.r12_discovery_scopes where id=p_scope_id;
 if auth.uid() is null or s.id is null or not private.is_business_owner(s.business_id) then raise exception 'Business ownership required.' using errcode='42501';end if;
 perform 1 from public.businesses where id=s.business_id for update;
 source:=private.r12_focused_adoption_source(s.id,p_result);profile:=source->'profile';candidate:=profile->'candidate';
 if p_owner_intent is distinct from jsonb_build_object('version','r12.focused-adoption-owner.1','scopeId',s.id,
 'profileHash',s.amendment->'profileHash','resultHash',private.stage14_hash(p_result),'goalId',s.goal_id,
 'goalRevision',source->'plan'->'content'->'goalRevision','goalHash',source->'plan'->'content'->'goalHash',
 'candidateId',candidate->'id','learningPlanHash',private.stage14_hash(profile->'pinnedLearningPlan'),
 'originalResearchFundingRootId',s.budget_authority_root_id,'adoptForPrivateLearning',true,'creativeExecutionAuthorized',false)
 then raise exception 'r12_exact_owner_adoption_required';end if;
 select * into a from private.r12_focused_adoptions where scope_id=s.id;
 if found then
  if a.result is distinct from p_result or a.actor_id<>auth.uid() then raise exception 'r12_adoption_replay_changed';end if;
  return jsonb_build_object('adoptionId',a.id,'candidateId',a.candidate_id,'experimentId',a.experiment_id,'decisionId',a.decision_id,'proof',a.proof,'cached',true,'executionAuthorized',false);
 end if;
 -- This pilot owns a new exact candidate, never an unrelated pre-existing row.
 if exists(select 1 from public.product_candidates where id=(candidate->>'id')::uuid) then raise exception 'r12_adoption_candidate_already_exists';end if;
 proof:=private.r12_focused_adoption_proof(aid,source,p_result,adopted_at);
 descriptor:=jsonb_build_object('version','r12.focused-adoption.1','scopeId',s.id,'resultHash',private.stage14_hash(p_result),'reviewArtifactId',source->'review'->'artifactId');
 insert into public.product_candidates(id,business_id,fingerprint,concept,audience,hypothesis,product_type,original_design,rights_status,source_domains)
 values((candidate->>'id')::uuid,s.business_id,private.stage14_hash(candidate),candidate->>'concept',candidate->>'audience',profile->'pinnedLearningPlan'->>'hypothesis','original_pod_tshirt',true,candidate->>'rightsStatus',array(select jsonb_array_elements_text(profile->'intent'->'comparisonUniverse'->'sourceDomains')));
 insert into private.r12_focused_adoptions(id,scope_id,business_id,candidate_id,experiment_id,decision_id,result,proof,proof_hash,actor_id)
 values(aid,s.id,s.business_id,(candidate->>'id')::uuid,eid,did,p_result,proof,private.stage14_hash(proof),auth.uid());
 insert into public.product_experiments(id,business_id,candidate_id,workflow_run_id,fingerprint,hypothesis,variables,audience,status,measurement_plan,evidence_pack,source_artifact_id,started_at,completed_at,discovery_version,parent_discovery_id)
 values(eid,s.business_id,(candidate->>'id')::uuid,(source->'review'->>'attemptId')::uuid,private.stage13_hash('r12:focused-adoption:'||s.id),profile->'pinnedLearningPlan'->>'hypothesis',jsonb_build_object('focusedPilotAdoption',proof,'focusedOriginalDesignConstraints',profile->'originalDesignConstraints','focusedExecutionConstraints',private.r12_focused_execution_constraints(p_result)),candidate->>'audience','completed',
 jsonb_build_object('version','pod-discovery-2.0','testPlan',profile->'pinnedLearningPlan'),descriptor,(source->'review'->>'artifactId')::uuid,
 (source->'strategy'->'binding'->>'dispatchedAt')::timestamptz,(p_result->>'reviewedAt')::timestamptz,'r12.focused-adoption.1',null);
 insert into public.product_decisions(id,business_id,candidate_id,experiment_id,assessment,assessment_fingerprint,focused_adoption_id)
 values(did,s.business_id,(candidate->>'id')::uuid,eid,p_result->'review',private.stage14_hash(p_result->'review'),aid);
 return jsonb_build_object('adoptionId',aid,'candidateId',candidate->'id','experimentId',eid,'decisionId',did,'proof',proof,'cached',false,'executionAuthorized',false);
end $$;
revoke all on function public.adopt_r12_focused_test(uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.adopt_r12_focused_test(uuid,jsonb,jsonb) to authenticated;

-- This trigger is additive. The existing append-only/version fences remain.
create function private.r12_focused_registry_guard() returns trigger language plpgsql set search_path='' as $$
declare a private.r12_focused_adoptions;e public.product_experiments;expected jsonb;begin
 if tg_table_name='product_experiments' then
  if new.discovery_version<>'r12.focused-adoption.1' then return new;end if;
  select * into strict a from private.r12_focused_adoptions where experiment_id=new.id and business_id=new.business_id and candidate_id=new.candidate_id;
  expected:=jsonb_build_object('version','r12.focused-adoption.1','scopeId',a.scope_id,'resultHash',a.proof->'resultHash','reviewArtifactId',a.proof->'reviewArtifactId');
  if new.status<>'completed' or new.parent_discovery_id is not null or new.basis_artifact_id is not null or new.failure is not null
  or new.variables is distinct from jsonb_build_object('focusedPilotAdoption',a.proof,'focusedOriginalDesignConstraints',a.result->'focusedPilot'->'originalDesignConstraints','focusedExecutionConstraints',private.r12_focused_execution_constraints(a.result))
  or new.evidence_pack is distinct from expected or new.source_artifact_id::text is distinct from a.proof->>'reviewArtifactId'
  or new.measurement_plan is distinct from jsonb_build_object('version','pod-discovery-2.0','testPlan',a.result->'focusedPilot'->'pinnedLearningPlan')
  or not exists(select 1 from public.artifacts x where x.id=new.source_artifact_id and x.business_id=new.business_id and x.workflow_run_id=new.workflow_run_id and x.artifact_type='r12.discovery.review')
  then raise exception 'r12_adoption_registry_binding';end if;
 else
  select * into strict e from public.product_experiments where id=new.experiment_id and business_id=new.business_id and candidate_id=new.candidate_id;
  if e.discovery_version<>'r12.focused-adoption.1' then
   if new.focused_adoption_id is not null then raise exception 'r12_adoption_ordinary_decision_mismatch';end if;
   return new;
  end if;
  select * into strict a from private.r12_focused_adoptions where id=new.focused_adoption_id and decision_id=new.id and experiment_id=e.id and business_id=e.business_id and candidate_id=e.candidate_id;
  if new.assessment is distinct from a.result->'review' or new.assessment_fingerprint is distinct from a.proof->>'reviewHash' then raise exception 'r12_adoption_review_changed';end if;
 end if;
 return new;
end $$;
revoke all on function private.r12_focused_registry_guard() from public,anon,authenticated,service_role;
create trigger r12_focused_registry_guard before insert on public.product_experiments for each row execute function private.r12_focused_registry_guard();
create trigger r12_focused_registry_guard before insert on public.product_decisions for each row execute function private.r12_focused_registry_guard();


-- Original Stage14 owner/IP/physical checks retained, with only the adopted lineage branch.
create function private.stage14_assert_focused_adoption(p_candidate_id uuid,p_snapshot jsonb) returns void language plpgsql set search_path='' as $$
declare c public.product_candidates%rowtype; d public.product_decisions%rowtype; e public.product_experiments%rowtype;
  adoption private.r12_focused_adoptions; installation public.installed_packs; binding jsonb:=p_snapshot->'focusedPilotBinding';
  spec jsonb:=p_snapshot->'printSpecification'; check_item jsonb; name text; dimension text; v_pack jsonb; v_assessment jsonb;
begin
  select * into strict c from public.product_candidates where id=p_candidate_id;
  perform private.r04_keys(binding,array['adoption','pinnedLearningPlan','originalDesignConstraints','executionConstraints','creativeInstallationId','creativeInstallationSnapshotHash','physicalSpecificationHash']);
  adoption:=private.r12_focused_adoption_current((binding->'adoption'->>'adoptionId')::uuid);
  select * into installation from public.installed_packs where id=(binding->>'creativeInstallationId')::uuid and business_id=c.business_id and status='active' and root_pack_key='workflow.etsy-creative-pipeline';
  if adoption.business_id<>c.business_id or adoption.candidate_id<>c.id or binding->'adoption' is distinct from adoption.proof
  or binding->'executionConstraints' is distinct from private.r12_focused_execution_constraints(adoption.result)
  or binding->'pinnedLearningPlan' is distinct from adoption.result->'focusedPilot'->'pinnedLearningPlan'
  or binding->'originalDesignConstraints' is distinct from adoption.result->'focusedPilot'->'originalDesignConstraints'
  or (p_snapshot->>'maximumMicrousd')::bigint>(adoption.proof->>'maximumCreativeProposalMicrousd')::bigint
  or p_snapshot->>'purpose' is distinct from 'candidate_production' or p_snapshot->'maximumGenerations' is distinct from '1'::jsonb
  or (p_snapshot->>'expiresAt')::timestamptz>(adoption.proof->>'expiresAt')::timestamptz
  or binding->>'physicalSpecificationHash' is distinct from private.stage14_hash(spec)
  or installation.id is null or binding->>'creativeInstallationSnapshotHash' is distinct from private.stage14_hash(installation.snapshot)
  or private.r05_paused(c.business_id,'pack',installation.id) then raise exception 'r12_focused_creative_binding_required';end if;
  if jsonb_typeof(p_snapshot) is distinct from 'object' or
    p_snapshot-array['approvalId','businessId','candidateId','decisionId','purpose','concept','audience','designInstructions','candidateAssessment','originalDesign','rightsStatement','rightsConfirmed','policyScreen','printSpecification','approvedBy','approvedAt','expiresAt','maximumMicrousd','maximumGenerations','publicationAllowed','focusedPilotBinding']<>'{}'::jsonb or
    p_snapshot->>'businessId' is distinct from c.business_id::text or p_snapshot->>'candidateId' is distinct from c.id::text or
    p_snapshot->>'concept' is distinct from c.concept or p_snapshot->>'audience' is distinct from c.audience or
    coalesce(p_snapshot->>'purpose','') not in ('candidate_production','technical_qualification','simulation') or
    p_snapshot->'originalDesign' is distinct from 'true'::jsonb or not c.original_design or
    coalesce(length(btrim(p_snapshot->>'designInstructions')),0) not between 50 and 1500 or
    p_snapshot->'rightsConfirmed' is distinct from 'true'::jsonb or coalesce(length(btrim(p_snapshot->>'rightsStatement')),0) not between 30 and 1500 or
    p_snapshot->>'approvedBy' is distinct from 'owner' or p_snapshot->'publicationAllowed' is distinct from 'false'::jsonb or
    coalesce(p_snapshot->'maximumGenerations','null'::jsonb) not in ('1'::jsonb,'2'::jsonb) or jsonb_typeof(p_snapshot->'maximumMicrousd') is distinct from 'number' or
    (p_snapshot->>'maximumMicrousd')::numeric<>trunc((p_snapshot->>'maximumMicrousd')::numeric) or (p_snapshot->>'maximumMicrousd')::numeric not between 0 and 2000000 or
    nullif(p_snapshot->>'approvedAt','') is null or (p_snapshot->>'approvedAt')::timestamptz>now()+interval '5 minutes' or
    nullif(p_snapshot->>'expiresAt','') is null or (p_snapshot->>'expiresAt')::timestamptz<=now() or
    (p_snapshot->>'expiresAt')::timestamptz>(p_snapshot->>'approvedAt')::timestamptz+interval '7 days' or
    (p_snapshot->>'purpose'='simulation' and (p_snapshot->>'maximumMicrousd')::bigint<>0) then
    raise exception 'Explicit, unexpired same-Business original-design approval required.';
  end if;
  if p_snapshot->>'purpose'='candidate_production' then
    select * into d from public.product_decisions where id=(p_snapshot->>'decisionId')::uuid and candidate_id=c.id and business_id=c.business_id;
    if d.id is null or d.assessment is distinct from p_snapshot->'candidateAssessment' or d.assessment->>'outcome' is distinct from 'TEST' or
      exists(select 1 from public.product_decisions later where later.candidate_id=c.id and later.business_id=c.business_id and later.id<>d.id and later.created_at>=d.created_at) then
      raise exception 'Production requires the current exact persisted TEST decision.';
    end if;
    select * into strict e from public.product_experiments where id=d.experiment_id and candidate_id=c.id and business_id=c.business_id and status='completed';
    if exists(select 1 from public.product_experiments newer where newer.business_id=c.business_id and newer.candidate_id=c.id and newer.discovery_version='pod-discovery-2.0' and
      newer.parent_discovery_id is not null and newer.status='completed' and newer.id<>e.id and newer.created_at>=e.created_at) then
      raise exception 'Newer completed v2 discovery supersedes this TEST, including an unselected candidate with no new verdict.';
    end if;
    if e.discovery_version is distinct from 'r12.focused-adoption.1' or e.id is distinct from adoption.experiment_id or d.id is distinct from adoption.decision_id
    or d.focused_adoption_id is distinct from adoption.id or d.assessment is distinct from adoption.result->'review'
    or e.variables is distinct from jsonb_build_object('focusedPilotAdoption',adoption.proof,'focusedOriginalDesignConstraints',adoption.result->'focusedPilot'->'originalDesignConstraints','focusedExecutionConstraints',private.r12_focused_execution_constraints(adoption.result))
    or e.source_artifact_id::text is distinct from adoption.proof->>'reviewArtifactId'
    or e.evidence_pack is distinct from jsonb_build_object('version','r12.focused-adoption.1','scopeId',adoption.scope_id,'resultHash',adoption.proof->'resultHash','reviewArtifactId',adoption.proof->'reviewArtifactId')
    or e.measurement_plan is distinct from jsonb_build_object('version','pod-discovery-2.0','testPlan',adoption.result->'focusedPilot'->'pinnedLearningPlan')
    or private.stage14_hash(jsonb_build_object('id',c.id,'businessId',c.business_id,'concept',c.concept,'audience',c.audience,'productType',c.product_type,'originalDesign',c.original_design,'rightsStatus',c.rights_status)) is distinct from adoption.proof->>'candidateIdentityHash'
    or exists(select 1 from public.product_experiments later where later.business_id=c.business_id and later.candidate_id=c.id and later.id<>e.id and later.status='completed' and later.created_at>=e.created_at)
    then raise exception 'r12_current_exact_adopted_test_required';end if;
  elsif p_snapshot->'candidateAssessment' is distinct from 'null'::jsonb or p_snapshot->'decisionId' is distinct from 'null'::jsonb then
    raise exception 'Technical and simulation approvals cannot attach a fabricated research decision.';
  end if;
  if jsonb_typeof(p_snapshot->'policyScreen') is distinct from 'array' or jsonb_array_length(p_snapshot->'policyScreen')<>8 then raise exception 'Eight source-backed IP/policy screens required.'; end if;
  foreach name in array array['brand_names','trademarks','copyrighted_characters','sports_teams','logos','celebrity_likeness','copied_artwork','marketplace_policy'] loop
    if (select count(*) from jsonb_array_elements(p_snapshot->'policyScreen') x where x->>'category'=name)<>1 then raise exception 'Exactly one screen per category required.'; end if;
    select value into check_item from jsonb_array_elements(p_snapshot->'policyScreen') x where x->>'category'=name;
    if check_item->>'status' is distinct from 'clear' or coalesce(length(btrim(check_item->>'rationale')),0) not between 15 and 800 or
      jsonb_typeof(check_item->'sourceUrls') is distinct from 'array' or jsonb_array_length(check_item->'sourceUrls') not between 1 and 4 or
      exists(select 1 from jsonb_array_elements_text(check_item->'sourceUrls') u where u !~ '^https://[a-z][a-z0-9.-]+\.[a-z]{2,}(/[^[:space:]#]*)?$' or length(u)>1500 or u ~ '@') then
      raise exception 'Clear concept-specific source-linked IP/policy review required.'; end if;
  end loop;
  if jsonb_typeof(spec) is distinct from 'object' or spec->>'provider' is distinct from 'printful' or
    coalesce(spec->>'sourceUrl','') !~ '^https://(www\.)?printful\.com/[^[:space:]#]*$|^https://help\.printful\.com/[^[:space:]#]*$' or
    coalesce(length(btrim(spec->>'sourceExcerpt')),0) not between 30 and 1500 or nullif(spec->>'verifiedAt','') is null or
    (spec->>'verifiedAt')::timestamptz<now()-interval '30 days' or (spec->>'verifiedAt')::timestamptz>now()+interval '5 minutes' or
    spec->>'colorSpace' is distinct from 'srgb' or coalesce(spec->>'background','') not in ('transparent','opaque') or
    jsonb_typeof(spec->'maximumBytes') is distinct from 'number' or (spec->>'maximumBytes')::numeric<>trunc((spec->>'maximumBytes')::numeric) or
    (spec->>'maximumBytes')::integer not between 1024 and 7000000 or
    coalesce((spec->>'minimumDpi')::numeric,0) not between 150 and 300 then raise exception 'A fresh source-backed Printful specification is required.'; end if;
  foreach name in array array['product','garment','placement'] loop
    if coalesce(length(btrim(spec->>name)),0) not between 3 and 1000 then raise exception 'Invalid print product specification.'; end if;
  end loop;
  foreach dimension in array array['maximumWidthInches','maximumHeightInches','designWidthInches','designHeightInches'] loop
    if jsonb_typeof(spec->dimension) is distinct from 'number' or coalesce((spec->>dimension)::numeric,0)<=0 or (spec->>dimension)::numeric>24 then raise exception 'Invalid print dimensions.'; end if;
  end loop;
  if (spec->>'designWidthInches')::numeric>(spec->>'maximumWidthInches')::numeric or (spec->>'designHeightInches')::numeric>(spec->>'maximumHeightInches')::numeric then raise exception 'Placement exceeds print constraints.'; end if;
end; $$;

revoke all on function private.stage14_assert_focused_adoption(uuid,jsonb) from public,anon,authenticated,service_role;


-- Guard all string replacements against expected definition drift.
-- Existing ordinary paths and grants are preserved. The new owner adoption RPC
-- has only the explicit authenticated owner grant. No R07 children or Storage policy changes.
do $draft$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.stage14_assert_approval(uuid,jsonb)'::regprocedure);
 old:=$old$begin
  select * into strict c from public.product_candidates where id=p_candidate_id;$old$;
 replacement:=$new$begin
  if p_snapshot ? 'focusedPilotBinding' then
    perform private.stage14_assert_focused_adoption(p_candidate_id,p_snapshot);return;
  end if;
  select * into strict c from public.product_candidates where id=p_candidate_id;$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_stage14_assert_definition_drift';end if;
 -- Currentness helper takes the established Business->research-root lock order.
 -- Use a fresh statement snapshot when the public runtime calls this helper.
 if (length(definition)-length(replace(definition,E'\n STABLE\n','')))/length(E'\n STABLE\n')<>1 then raise exception 'r12_stage14_assert_volatility_drift';end if;
 definition:=replace(definition,E'\n STABLE\n',E'\n VOLATILE\n');
 execute replace(definition,old,replacement);
end $draft$;

do $draft$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('public.begin_creative_run(uuid,uuid,text)'::regprocedure);
 old:=$old$  insert into public.workflow_runs(id,business_id,workflow_definition_id,status,current_stage_key,idempotency_key,input,state,runtime_provider,runtime_launch_status,runtime_launch_nonce,runtime_launch_reserved_at)
    values(wid,a.business_id,d.id,'queued','brief:1','creative:'||a.id,jsonb_build_object('creativeRunId',id,'approvalId',a.id,'approvalHash',a.approval_hash),
      jsonb_build_object('purpose',a.purpose,'productionReady',false,'publicationAllowed',false),'vercel_workflow','reserved',p_launch_nonce,now());$old$;
 replacement:=$new$  if a.snapshot ? 'focusedPilotBinding' and not exists(select 1 from public.installed_packs i
    where i.id=(a.snapshot->'focusedPilotBinding'->>'creativeInstallationId')::uuid and i.business_id=a.business_id and i.status='active'
    and i.root_pack_id=p.id and i.snapshot->'releases'=snap->'releases'
    and private.stage14_hash(i.snapshot)=a.snapshot->'focusedPilotBinding'->>'creativeInstallationSnapshotHash') then
    raise exception 'r12_focused_creative_catalog_not_installed';end if;
  insert into public.workflow_runs(id,business_id,goal_id,workflow_definition_id,pack_installation_id,pack_snapshot,runtime_capability_hash,status,current_stage_key,idempotency_key,input,state,runtime_provider,runtime_launch_status,runtime_launch_nonce,runtime_launch_reserved_at)
    values(wid,a.business_id,(a.snapshot->'focusedPilotBinding'->'adoption'->>'goalId')::uuid,d.id,
      (a.snapshot->'focusedPilotBinding'->>'creativeInstallationId')::uuid,case when a.snapshot ? 'focusedPilotBinding' then snap else null end,
      case when a.snapshot ? 'focusedPilotBinding' then private.stage13_hash(p_runtime_capability) else null end,
      'queued','brief:1','creative:'||a.id,jsonb_build_object('creativeRunId',id,'approvalId',a.id,'approvalHash',a.approval_hash)||
      case when a.snapshot ? 'focusedPilotBinding' then jsonb_build_object('focusedPilotBinding',a.snapshot->'focusedPilotBinding') else '{}'::jsonb end,
      jsonb_build_object('purpose',a.purpose,'productionReady',false,'publicationAllowed',false),'vercel_workflow','reserved',p_launch_nonce,now());$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_stage14_begin_definition_drift';end if;
 execute replace(definition,old,replacement);
end $draft$;

-- Existing runtime calls stage14_assert_approval before each reservation and at
-- terminal eligibility. Add native run-pin checks before any phase dispatch.
do $draft$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('public.creative_runtime_transition(uuid,uuid,text,text,jsonb)'::regprocedure);
 old:=$old$  select * into strict a from public.creative_approvals where id=r.approval_id and business_id=r.business_id;$old$;
 replacement:=$new$  select * into strict a from public.creative_approvals where id=r.approval_id and business_id=r.business_id;
  if a.snapshot ? 'focusedPilotBinding' and (
    w.goal_id::text is distinct from a.snapshot->'focusedPilotBinding'->'adoption'->>'goalId'
    or w.pack_installation_id::text is distinct from a.snapshot->'focusedPilotBinding'->>'creativeInstallationId'
    or w.pack_snapshot is distinct from r.catalog_snapshot
    or w.input->'focusedPilotBinding' is distinct from a.snapshot->'focusedPilotBinding'
    or w.runtime_capability_hash is distinct from private.stage13_hash(p_runtime_capability)) then
    raise exception 'r12_focused_creative_workflow_pins_changed';end if;$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_stage14_runtime_definition_drift';end if;
 execute replace(definition,old,replacement);
end $draft$;

commit;
