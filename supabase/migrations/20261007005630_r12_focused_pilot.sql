-- Definition-only focused R12 pilot. No authority or data enrollment.
begin;

-- Definition only: no scopes, Goals, policies, keys or provider calls.
-- New functions are private SECURITY INVOKER and have no user-facing grants.

-- A narrow 64KiB pilot scanner delegates every key and scalar to the released
-- r04 credential scanner. It does not change r04_safe or its20KiB callers.
create function private.r12_pilot_safe(v jsonb) returns void language plpgsql set search_path='' as $$
declare k text;child jsonb;begin
 if v is null or octet_length(v::text)>65536 then raise exception 'r12_pilot_payload_bound';end if;
 if jsonb_typeof(v)='object' then
 for k,child in select key,value from jsonb_each(v) loop
 perform private.r04_safe(jsonb_build_object(k,null));perform private.r12_pilot_safe(child);end loop;
 elsif jsonb_typeof(v)='array' then
 for child in select value from jsonb_array_elements(v) loop perform private.r12_pilot_safe(child);end loop;
 else perform private.r04_safe(v);end if;
end $$;

create function private.r12_pilot_profile_validate(s private.r12_discovery_scopes,effective_at timestamptz,p_current boolean default true)
returns void language plpgsql stable set search_path='' as $$
declare e jsonb:=s.amendment;v jsonb:=e->'profile';i jsonb:=v->'intent';h jsonb:=v->'history';c jsonb:=v->'candidate';lp jsonb:=v->'pinnedLearningPlan';
 observation_scope private.r12_discovery_scopes:=s;k text;ref jsonb;domains jsonb;prior public.product_experiments;
begin
 perform private.r12_pilot_safe(e);
 perform private.r04_keys(e,array['version','id','businessId','goalId','budgetAuthorityRootId','priorRoundId','profile','profileHash','originalGoalId','closedPlanId','closedPlanHash','acceptedReviewScopeId','acceptedReviewHash','acceptedReviewRecordHash','originalIntentHash','originalSemanticGoalHash','allowedDomains','excludedDomains','approvedQuery','approvalHash','independentReviewHash','createdAt','expiresAt']);
 perform private.r04_keys(v,array['version','id','businessId','goalId','originalGoalId','budgetAuthorityRootId','priorRoundId','originalIntentHash','originalSemanticGoalHash','intent','candidate','observations','history','learningQuestion','pinnedLearningPlan','originalDesignConstraints','researchAllocationMicrousd','maximumPaidCalls','paidRetryAllowed','executionAuthorized','createdAt','expiresAt']);
 if not isfinite(effective_at) or e->>'version' is distinct from 'r12.discovery-focused-pilot.1'
 or v->>'version' is distinct from 'r12.focused-pilot-profile.1' or octet_length(e::text)>65536
 or e->>'id' is distinct from s.id::text or e->>'businessId' is distinct from s.business_id::text
 or e->>'goalId' is distinct from s.goal_id::text or e->>'budgetAuthorityRootId' is distinct from s.budget_authority_root_id::text
 or e->>'priorRoundId' is distinct from s.prior_round_id::text or s.amendment_hash is distinct from private.stage14_hash(e)
 or e->>'profileHash' is distinct from private.stage14_hash(v) or v->'maximumPaidCalls' is distinct from '2'::jsonb
 or v->'paidRetryAllowed' is distinct from 'false'::jsonb or v->'executionAuthorized' is distinct from 'false'::jsonb
 then raise exception 'r12_pilot_profile_identity';end if;
 foreach k in array array['id','businessId','goalId','originalGoalId','budgetAuthorityRootId','priorRoundId','originalIntentHash','originalSemanticGoalHash','createdAt','expiresAt'] loop
 if e->k is distinct from v->k then raise exception 'r12_pilot_profile_binding';end if;end loop;
 foreach k in array array['id','businessId','goalId','originalGoalId','budgetAuthorityRootId','priorRoundId','closedPlanId','acceptedReviewScopeId'] loop
 if jsonb_typeof(e->k) is distinct from 'string' or e->>k !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then raise exception 'r12_pilot_identity';end if;end loop;
 foreach k in array array['profileHash','closedPlanHash','acceptedReviewHash','acceptedReviewRecordHash','originalIntentHash','originalSemanticGoalHash','approvalHash','independentReviewHash'] loop
 if jsonb_typeof(e->k) is distinct from 'string' or e->>k !~ '^[a-f0-9]{64}$' then raise exception 'r12_pilot_hash';end if;end loop;
 if s.goal_id=(e->>'originalGoalId')::uuid or s.id in(s.goal_id,(e->>'originalGoalId')::uuid,s.budget_authority_root_id,s.prior_round_id,(e->>'acceptedReviewScopeId')::uuid)
 then raise exception 'r12_pilot_new_goal_required';end if;
 foreach k in array array['createdAt','expiresAt'] loop
 if jsonb_typeof(e->k) is distinct from 'string' or not isfinite((e->>k)::timestamptz) then raise exception 'r12_pilot_window';end if;end loop;
 if (e->>'createdAt')::timestamptz>effective_at or (e->>'expiresAt')::timestamptz<=(e->>'createdAt')::timestamptz
 or (e->>'expiresAt')::timestamptz>(e->>'createdAt')::timestamptz+interval '1 day'
 or (p_current and (e->>'expiresAt')::timestamptz<=effective_at) then raise exception 'r12_pilot_window';end if;
 select * into strict prior from public.product_experiments where id=s.prior_round_id and business_id=s.business_id and discovery_version='pod-discovery-2.0' and parent_discovery_id is null and candidate_id is null;
 if prior.status not in ('failed','completed') or prior.variables->>'budgetAuthorityRootId' is distinct from s.budget_authority_root_id::text or prior.variables->>'semanticGoalHash' is distinct from e->>'originalSemanticGoalHash'
 or private.stage14_hash(prior.variables->'intent') is distinct from e->>'originalIntentHash' or prior.variables->'intent'->'limits'->'maximumMicrousd' is distinct from '2000000'::jsonb
 then raise exception 'r12_pilot_original_funding_binding';end if;
 perform private.r04_keys(i,array['version','id','businessId','objective','comparisonUniverse','limits','expiresAt']);
 perform private.r04_keys(i->'comparisonUniverse',array['productType','markets','audiences','sourceDomains','selectionQuestion']);
 perform private.r04_keys(i->'limits',array['maximumAlternatives','maximumNewCollections','maximumMicrousd','maximumGenerations']);
 if i->>'version' is distinct from 'pod-discovery-2.0' or i->>'id' is distinct from s.id::text or i->>'businessId' is distinct from s.business_id::text
 or i->'expiresAt' is distinct from e->'expiresAt' or i->'comparisonUniverse'->>'productType' is distinct from 'original_pod_tshirt'
 or i->'comparisonUniverse'->'markets' is distinct from '[{"countryCode":"GB","currency":"GBP"}]'::jsonb
 or i->'limits' is distinct from '{"maximumAlternatives":3,"maximumNewCollections":0,"maximumMicrousd":2000000,"maximumGenerations":1}'::jsonb
 or jsonb_typeof(v->'researchAllocationMicrousd') is distinct from 'number' or private.r05_money(to_jsonb(v->>'researchAllocationMicrousd')) not between 1 and 2000000
 or e->'allowedDomains' is distinct from i->'comparisonUniverse'->'sourceDomains' or e->'approvedQuery' is distinct from v->'learningQuestion'
 or i->'comparisonUniverse'->'selectionQuestion' is distinct from v->'learningQuestion'
 then raise exception 'r12_pilot_intent';end if;
 foreach k in array array['objective'] loop
 if jsonb_typeof(i->k) is distinct from 'string' or char_length(i->>k) not between 20 and 1200 or btrim(i->>k) is distinct from i->>k then raise exception 'r12_pilot_objective';end if;end loop;
 if jsonb_typeof(v->'learningQuestion') is distinct from 'string' or char_length(v->>'learningQuestion') not between 20 and 800 or btrim(v->>'learningQuestion') is distinct from v->>'learningQuestion'
 or jsonb_typeof(i->'comparisonUniverse'->'selectionQuestion') is distinct from 'string' or char_length(i->'comparisonUniverse'->>'selectionQuestion') not between 20 and 800 then raise exception 'r12_pilot_question';end if;
 perform private.r04_strings(i->'comparisonUniverse'->'audiences',1);
 if jsonb_array_length(i->'comparisonUniverse'->'audiences')<>1 then raise exception 'r12_pilot_audience';end if;
 perform private.r04_keys(c,array['id','businessId','concept','audience','productType','originalDesign','rightsStatus']);
 if jsonb_typeof(c->'id') is distinct from 'string' or c->>'id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
 or c->>'businessId' is distinct from s.business_id::text or c->'audience' is distinct from i->'comparisonUniverse'->'audiences'->0
 or c->>'productType' is distinct from 'original_pod_tshirt' or c->'originalDesign' is distinct from 'true'::jsonb
 or not coalesce(c->>'rightsStatus' in ('confirmed','unclear'),false) or jsonb_typeof(c->'concept') is distinct from 'string' or char_length(c->>'concept') not between 3 and 160 then raise exception 'r12_pilot_candidate';end if;
 perform private.r04_keys(h,array['acceptedReviewScopeId','acceptedReviewHash','record','recordHash','scopeChangeExplanation','supportingEvidence']);
 if h->'acceptedReviewScopeId' is distinct from e->'acceptedReviewScopeId' or h->'acceptedReviewHash' is distinct from e->'acceptedReviewHash'
 or h->'recordHash' is distinct from e->'acceptedReviewRecordHash' or h->>'recordHash' is distinct from private.stage14_hash(h->'record')
 or h->'supportingEvidence' is distinct from 'false'::jsonb or h->'record'->>'outcome' is distinct from 'NEEDS_MORE_EVIDENCE'
 or jsonb_typeof(h->'scopeChangeExplanation') is distinct from 'string' or char_length(h->>'scopeChangeExplanation') not between 40 and 1200
 then raise exception 'r12_pilot_history';end if;
 perform private.r04_strings(h->'record'->'missingQuestions',81);
 if jsonb_array_length(h->'record'->'missingQuestions')<1 then raise exception 'r12_pilot_full_questions';end if;
 perform private.r04_keys(v->'originalDesignConstraints',array['noThirdPartyReferences','workingTitleOnly','forbiddenElements']);
 if v->'originalDesignConstraints'->'noThirdPartyReferences' is distinct from 'true'::jsonb or v->'originalDesignConstraints'->'workingTitleOnly' is distinct from 'true'::jsonb then raise exception 'r12_pilot_original_design';end if;
 perform private.r04_strings(v->'originalDesignConstraints'->'forbiddenElements',12);
 if jsonb_array_length(v->'originalDesignConstraints'->'forbiddenElements')<1 then raise exception 'r12_pilot_original_design';end if;
 -- Reuse the released full public-observation, quote, source-role and time guard.
 -- This projection is local only; it does not write or relabel old source rows.
 observation_scope.amendment:=jsonb_build_object('addendum',v->'observations','addendumHash',private.stage14_hash(v->'observations'),
 'predecessorScopeId',e->>'acceptedReviewScopeId','allowedDomains','[]'::jsonb,'expiresAt',e->>'expiresAt');
 select jsonb_agg(domain order by domain) into domains from (select distinct regexp_replace(lower(split_part(split_part(o->>'url','://',2),'/',1)),'^www\.','') domain from jsonb_array_elements(v->'observations'->'observations') o) x;
 observation_scope.amendment:=observation_scope.amendment||jsonb_build_object('executionSourceDomains',domains);
 perform private.r12_evidence_addendum_validate(observation_scope,effective_at,p_current);
 if v->'observations'->'predecessorReviewHash' is distinct from e->'acceptedReviewHash' then raise exception 'r12_pilot_observation_binding';end if;
 if e->'excludedDomains' is distinct from '["etsy.com","etsy.me","etsystatic.com"]'::jsonb then raise exception 'r12_pilot_restricted_domains';end if;
 if exists(select 1 from jsonb_array_elements(v->'observations'->'observations') o cross join lateral jsonb_array_elements_text(o->'countries') country where country<>'GB') then raise exception 'r12_pilot_gb_observations_only';end if;
 perform private.r04_strings(e->'allowedDomains',6);
 if jsonb_array_length(e->'allowedDomains')<1 or (select count(distinct domain) from jsonb_array_elements_text(e->'allowedDomains') domain)<>jsonb_array_length(e->'allowedDomains')
 or exists(select 1 from jsonb_array_elements_text(e->'allowedDomains') domain where domain !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' or domain ~ '\.(local|internal|localhost|test|invalid|example|onion)$'
 or domain='etsy.com' or domain like '%.etsy.com' or domain='etsy.me' or domain like '%.etsy.me' or domain='etsystatic.com' or domain like '%.etsystatic.com')
 or exists(select 1 from jsonb_array_elements(v->'observations'->'observations') o where not exists(select 1 from jsonb_array_elements_text(e->'allowedDomains') domain where lower(split_part(split_part(o->>'url','://',2),'/',1))=domain or lower(split_part(split_part(o->>'url','://',2),'/',1)) like '%.'||domain))
 then raise exception 'r12_pilot_allowed_observation_domains';end if;
 perform private.r04_keys(lp,array['scope','name','hypothesis','deliverable','successCriteria','failureCriteria','stopRule','maximumMicrousd','maximumGenerations','evidenceRefs','budgetStatus','generationAuthorized','spendingAuthorized','publicationAllowed','commerceAllowed']);
 if lp->>'scope' is distinct from 'private_original_design_test' or lp->>'budgetStatus' is distinct from 'proposal_only' or lp->'maximumGenerations' is distinct from '1'::jsonb
 or private.r05_money(to_jsonb(lp->>'maximumMicrousd')) not between 1 and 1000000 or lp->'generationAuthorized' is distinct from 'false'::jsonb or lp->'spendingAuthorized' is distinct from 'false'::jsonb
 or lp->'publicationAllowed' is distinct from 'false'::jsonb or lp->'commerceAllowed' is distinct from 'false'::jsonb then raise exception 'r12_pilot_learning_plan';end if;
 if jsonb_typeof(lp->'evidenceRefs') is distinct from 'array' or jsonb_array_length(lp->'evidenceRefs') not between 1 and 8 then raise exception 'r12_pilot_learning_evidence';end if;
 -- Ref shape and evidence hash equality are checked again by unchanged Core
 -- evidence resolution. SQL independently forbids historical/provider packs.
 for ref in select value from jsonb_array_elements(lp->'evidenceRefs') loop
 perform private.r04_keys(ref,array['artifactId','evidenceId','sourceId','sourceContentHash','start','end']);
 if ref->>'artifactId' is distinct from v->'observations'->>'id'
 or not exists(select 1 from jsonb_array_elements(v->'observations'->'observations') o where o->'id'=ref->'evidenceId'
 and o->'sourceId'=ref->'sourceId' and o->'contentHash'=ref->'sourceContentHash' and o->'start'=ref->'start' and o->'end'=ref->'end') then raise exception 'r12_pilot_learning_evidence';end if;end loop;
 if not exists(select 1 from jsonb_array_elements(v->'observations'->'observations') o where o->>'kind'='retail_offer' and o->>'geographyRole'='buyer_market'
 and o->'countries' ? 'GB' and o->'dimensions' ?| array['competition','differentiation'] and exists(select 1 from jsonb_array_elements(lp->'evidenceRefs') r where r->'evidenceId'=o->'id'))
 or not exists(select 1 from jsonb_array_elements(v->'observations'->'observations') o where o->>'kind'='official_operating_fact' and o->'dimensions' ? 'production_complexity'
 and lower(split_part(split_part(o->>'url','://',2),'/',1)) ~ '(^|\.)printful\.com$' and exists(select 1 from jsonb_array_elements(lp->'evidenceRefs') r where r->'evidenceId'=o->'id'))
 then raise exception 'r12_pilot_learning_basis';end if;
end $$;

create function private.r12_pilot_source(s private.r12_discovery_scopes,effective_at timestamptz,p_current boolean default true)
returns jsonb language plpgsql stable set search_path='' as $$
declare e jsonb:=s.amendment;old_plan private.r07_plans;review_plan private.r07_plans;old_scope private.r12_discovery_scopes;
 review_scope private.r12_discovery_scopes;old_head private.r07_heads;review_attempt private.r07_attempts;phase jsonb;historical_result jsonb;
begin
 perform private.r12_pilot_profile_validate(s,effective_at,p_current);
 select * into old_plan from private.r07_plans where id=(e->>'closedPlanId')::uuid and business_id=s.business_id and goal_id=(e->>'originalGoalId')::uuid;
 select * into old_scope from private.r12_discovery_scopes where id=(old_plan.content->>'discoveryScopeId')::uuid and business_id=s.business_id and goal_id=old_plan.goal_id;
 select * into old_head from private.r07_heads where business_id=s.business_id and goal_id=old_plan.goal_id;
 if old_plan.id is null or old_plan.version<>4 or old_plan.content->>'format' is distinct from 'r12.discovery-evidence.1'
 or old_plan.content_hash is distinct from e->>'closedPlanHash' or old_plan.content_hash is distinct from private.r04_hash(old_plan.content)
 or old_scope.id is null or old_scope.amendment->>'version' is distinct from 'r12.discovery-evidence-continuation.1'
 or old_scope.amendment_hash is distinct from old_plan.content->>'discoveryScopeHash' or old_scope.amendment_hash is distinct from private.stage14_hash(old_scope.amendment)
 or old_scope.budget_authority_root_id<>s.budget_authority_root_id or old_scope.prior_round_id<>s.prior_round_id
 or old_head.plan_id is distinct from old_plan.id or old_head.dispatches<>7 or old_head.children_created<>8 or old_head.repairs_used<>0 or old_head.pivots_used<>0
 or exists(select 1 from private.r07_plans newer where newer.business_id=s.business_id and newer.goal_id=old_plan.goal_id and newer.version>old_plan.version)
 then raise exception 'r12_pilot_closed_latest_plan_required';end if;
 -- Historical controller state can remain 'running'; closure is revocation plus
 -- known settlement, never rewriting old counters/state or calling it accepted.
 if not exists(select 1 from private.r12_discovery_authorities q where q.scope_id=old_scope.id and q.plan=old_plan.content)
 or exists(select 1 from private.r12_discovery_authorities q where q.business_id=s.business_id and q.goal_id=old_plan.goal_id and (
 not exists(select 1 from private.r05_revocations where business_id=s.business_id and policy_id=(q.plan->>'policyId')::uuid)
 or not exists(select 1 from private.r07_server_revocations where key_hash=q.controller_key_hash)
 or not exists(select 1 from private.r05_server_revocations where key_hash=q.admission_key_hash)))
 or exists(select 1 from private.r12_discovery_exposure(s.budget_authority_root_id) exposure join private.r05_requests r on r.id=exposure.request_id
 join private.r07_attempts a on a.id=r.workflow_run_id where a.goal_id=old_plan.goal_id and exposure.is_pending)
 then raise exception 'r12_pilot_old_authority_not_closed';end if;
 select * into review_scope from private.r12_discovery_scopes where id=(e->>'acceptedReviewScopeId')::uuid and business_id=s.business_id and goal_id=old_plan.goal_id;
 select * into review_plan from private.r07_plans where id=old_plan.previous_plan_id and business_id=s.business_id and goal_id=old_plan.goal_id;
 select * into review_attempt from private.r07_attempts where plan_id=review_plan.id and business_id=s.business_id and step_key='review' and attempt=1 and status='completed';
 if review_scope.id is null or review_plan.id is null or review_plan.version<>3 or review_plan.content->>'format' is distinct from 'r12.discovery-review.1'
 or review_plan.content->>'discoveryScopeId' is distinct from review_scope.id::text or review_plan.content->>'discoveryScopeHash' is distinct from review_scope.amendment_hash
 or old_scope.amendment->>'predecessorScopeId' is distinct from review_scope.id::text or old_scope.amendment->>'predecessorPlanId' is distinct from review_plan.id::text
 or review_scope.budget_authority_root_id<>s.budget_authority_root_id or review_scope.prior_round_id<>s.prior_round_id or review_attempt.id is null
 then raise exception 'r12_pilot_accepted_review_required';end if;
 phase:=private.r12_discovery_completed_phase(review_attempt,review_plan);
 if phase->'candidate'->'output'->>'outcome' is distinct from 'NEEDS_MORE_EVIDENCE' or phase->'response'->'result'->>'outcome' is distinct from 'NEEDS_MORE_EVIDENCE'
 or phase->'response'->'result'->>'reviewHash' is distinct from e->>'acceptedReviewHash'
 then raise exception 'r12_pilot_accepted_nme_required';end if;
 if exists(select 1 from private.r04_research_links where business_id=s.business_id and goal_id=s.goal_id) then raise exception 'r12_pilot_no_research_relink';end if;
 historical_result:=private.r12_review_result(review_scope);
 if not exists(select 1 from jsonb_array_elements(historical_result->'inputs'->'dependencies') dep cross join lateral jsonb_array_elements(dep->'response'->'result'->'candidates') candidate where dep->>'stepKey'='plan' and candidate=s.amendment->'profile'->'candidate') then raise exception 'r12_pilot_original_candidate_required';end if;
 return jsonb_build_object('acceptedReview',historical_result,'closedPlanId',old_plan.id,'closedPlanHash',old_plan.content_hash);
end $$;

create function private.r12_pilot_scope_at(p private.r07_plans,effective_at timestamptz,p_current boolean default true)
returns private.r12_discovery_scopes language plpgsql set search_path='' as $$
declare s private.r12_discovery_scopes;prior public.product_experiments;begin
 perform 1 from public.businesses where id=p.business_id and owner_user_id=p.owner_id for update;
 if not found then raise exception 'r12_owner_changed';end if;
 select * into s from private.r12_discovery_scopes where id=(p.content->>'discoveryScopeId')::uuid and business_id=p.business_id and goal_id=p.goal_id and amendment_hash=p.content->>'discoveryScopeHash';
 if s.id is null or p.content->>'format' is distinct from 'r12.discovery-pilot.1' then raise exception 'r12_pilot_scope_binding';end if;
 perform 1 from public.product_experiments where id=s.budget_authority_root_id and business_id=p.business_id for update;
 perform private.r12_pilot_source(s,effective_at,p_current);
 select * into strict prior from public.product_experiments where id=s.prior_round_id and business_id=p.business_id;
 if prior.status not in ('failed','completed') or exists(select 1 from public.product_experiments newer where newer.business_id=p.business_id and newer.discovery_version='pod-discovery-2.0' and newer.parent_discovery_id is null and newer.candidate_id is null and newer.variables->>'budgetAuthorityRootId'=s.budget_authority_root_id::text and (newer.created_at,newer.id)>(prior.created_at,prior.id)) then raise exception 'r12_pilot_original_root_changed';end if;
 if not exists(select 1 from private.r04_goal_versions gv join private.r04_goal_state gs using(goal_id,business_id,revision) where gv.goal_id=p.goal_id and gv.business_id=p.business_id
 and gv.preference='ready' and gv.revision=(p.content->>'goalRevision')::integer and gv.content_hash=p.content->>'goalHash'
 and gv.content->'objective'=s.amendment->'profile'->'intent'->'objective' and gv.content->'parsed'->'geography'='["GB"]'::jsonb)
 then raise exception 'r12_pilot_owner_goal_changed';end if;
 return s;
end $$;

create function private.r12_pilot_envelope_validate(s private.r12_discovery_scopes)
returns void language plpgsql set search_path='' as $$
declare budget jsonb;begin
 perform private.r12_pilot_source(s,clock_timestamp(),true);
 if exists(select 1 from private.r07_plans where business_id=s.business_id and goal_id=s.goal_id)
 or not exists(select 1 from private.r04_goal_versions gv join private.r04_goal_state gs using(goal_id,business_id,revision) where gv.business_id=s.business_id and gv.goal_id=s.goal_id
 and gv.preference='ready' and gv.content->'objective'=s.amendment->'profile'->'intent'->'objective' and gv.content->'parsed'->'geography'='["GB"]'::jsonb)
 then raise exception 'r12_pilot_fresh_owner_goal_required';end if;
 budget:=private.stage13v2_budget_authority(s.prior_round_id,true);
 if budget->'hasUncertainCosts' is distinct from 'false'::jsonb or (budget->>'maximumMicrousd')::bigint<>2000000
 or private.r05_money(to_jsonb(s.amendment->'profile'->>'researchAllocationMicrousd'))>(budget->>'remainingMicrousd')::bigint
 then raise exception 'r12_pilot_shared_funding_unavailable';end if;
end $$;

create function private.r12_pilot_input_snapshot(a private.r07_attempts,p private.r07_plans,s private.r12_discovery_scopes,validation_at timestamptz,input_mode text,committed bigint,uncertain boolean,p_current boolean default true)
returns jsonb language plpgsql stable set search_path='' as $$
declare source jsonb;step jsonb;installation public.installed_packs;prior public.product_experiments;pin jsonb;dep private.r07_attempts;phase jsonb;dependencies jsonb:='[]';output jsonb;begin
 if p.content->>'format' is distinct from 'r12.discovery-pilot.1' or a.plan_id<>p.id or a.business_id<>p.business_id or a.step_key not in ('strategy','review') or a.attempt<>1
 or input_mode not in ('dispatch','receipt') or p.version<>1 or p.previous_plan_id is not null or exists(select 1 from private.r07_reused where plan_id=p.id)
 then raise exception 'r12_pilot_attempt_required';end if;
 source:=private.r12_pilot_source(s,validation_at,p_current);
 select value into step from jsonb_array_elements(p.content->'steps') x where x->>'key'=a.step_key;
 select * into installation from public.installed_packs where id=(step->>'installationId')::uuid and business_id=p.business_id;
 if installation.id is null or (p_current and installation.status<>'active') or private.r04_hash(installation.snapshot) is distinct from step->>'packSnapshotHash' then raise exception 'r12_knowledge_installation_changed';end if;
 if jsonb_array_length(a.dependency_pins)<>(case when a.step_key='strategy' then 0 else 1 end)
 or a.dependency_pins is distinct from private.r07_dependencies(p.id,step) then raise exception 'r12_pilot_dependency_scope';end if;
 for pin in select value from jsonb_array_elements(a.dependency_pins) loop
 select * into dep from private.r07_attempts where id=(pin->>'attemptId')::uuid and business_id=p.business_id and plan_id=p.id and step_key='strategy' and attempt=1 and status='completed';
 phase:=private.r12_discovery_completed_phase(dep,p);
 if dep.id is null or pin->>'stepKey' is distinct from 'strategy' or phase->>'responseHash' is distinct from pin->>'resultHash' then raise exception 'r12_pilot_dependency_scope';end if;
 dependencies:=dependencies||jsonb_build_array(phase);end loop;
 select * into strict prior from public.product_experiments where id=s.prior_round_id and business_id=s.business_id;
 if committed is null or committed<0 or committed>=2000000 then raise exception 'r12_pilot_shared_funding_snapshot';end if;
 output:=jsonb_build_object('version','r12.discovery-pilot-inputs.1','businessId',s.business_id,'planId',p.id,'attemptId',a.id,'inputMode',input_mode,'validationAt',validation_at,
 'knowledgeSnapshot',installation.snapshot,'knowledgeSnapshotHash',private.r04_hash(installation.snapshot),'knowledgeCanonicalHash',private.stage14_hash(installation.snapshot),
 'original',jsonb_build_object('businessId',s.business_id,'budgetAuthorityRootId',s.budget_authority_root_id,'priorRoundId',s.prior_round_id,'semanticGoalHash',prior.variables->>'semanticGoalHash','priorIntent',prior.variables->'intent','maximumMicrousd',2000000,'committedMicrousd',committed,'hasUncertainCosts',uncertain),
 'amendment',s.amendment,'dependencies',dependencies,'focusedPilot',source||jsonb_build_object('profile',s.amendment->'profile','profileHash',s.amendment->>'profileHash'));
 if octet_length(output::text)>524288 then raise exception 'r12_complete_input_bound';end if;return output;
end $$;

create function private.r12_pilot_phase_inputs(a private.r07_attempts,p private.r07_plans) returns jsonb language plpgsql set search_path='' as $$
declare s private.r12_discovery_scopes;c private.r12_discovery_candidates;budget jsonb;own_held bigint:=0;own_pending bigint:=0;validation_at timestamptz:=clock_timestamp();input_mode text:='dispatch';output jsonb;begin
 select own_candidate.* into c from private.r12_discovery_candidates own_candidate join private.r12_discovery_wires own_wire on own_wire.request_id=own_candidate.request_id where own_wire.attempt_id=a.id and own_wire.business_id=p.business_id;
 if c.request_id is not null and private.r12_discovery_receipt_status(c)->>'status'='verified' then
 select created_at into strict validation_at from private.r05_markers where request_id=c.request_id;input_mode:='receipt';s:=private.r12_discovery_scope_at(p,validation_at);
 else s:=private.r12_discovery_scope_current(p);end if;
 budget:=private.stage13v2_budget_authority(s.prior_round_id,true);
 select coalesce(sum(e.held),0),coalesce(sum(e.held) filter(where e.is_pending),0) into own_held,own_pending from private.r12_discovery_exposure(s.budget_authority_root_id) e join private.r05_requests req on req.id=e.request_id where req.workflow_run_id=a.id;
 output:=private.r12_pilot_input_snapshot(a,p,s,validation_at,input_mode,(budget->>'committedMicrousd')::bigint-own_held,(budget->>'pendingExposureMicrousd')::bigint>own_pending,true);
 if input_mode='receipt' then
 if private.r12_discovery_receipt_status(c)->>'status' is distinct from 'verified' then raise exception 'r12_receipt_grace_ended';end if;
 perform private.r12_discovery_scope_at(p,validation_at);else perform private.r12_discovery_scope_current(p);end if;return output;
end $$;

create function private.r12_pilot_result(s private.r12_discovery_scopes) returns jsonb language plpgsql stable set search_path='' as $$
declare p private.r07_plans;a private.r07_attempts;phase jsonb;at_time timestamptz;committed bigint;output jsonb;begin
 select * into p from private.r07_plans where business_id=s.business_id and goal_id=s.goal_id and content->>'format'='r12.discovery-pilot.1' and content->>'discoveryScopeId'=s.id::text;
 select * into a from private.r07_attempts where plan_id=p.id and business_id=s.business_id and step_key='review' and attempt=1 and status='completed';
 if a.id is null then return null;end if;
 phase:=private.r12_discovery_completed_phase(a,p);at_time:=(phase->'binding'->>'dispatchedAt')::timestamptz;
 committed:=(phase->'binding'->'request'->'requestMetadata'->>'r12CommittedBeforeAttemptMicrousd')::bigint;
 output:=jsonb_build_object('version','r12.discovery-saved-result.1','context',jsonb_build_object('planId',p.id,'planHash',p.content_hash,'plan',p.content,'step',p.content->'steps'->1,
 'attempt',jsonb_build_object('id',a.id,'stepKey',a.step_key,'attempt',a.attempt,'status',a.status,'reason',a.reason,'inputHash',a.input_hash,'dependencyPins',a.dependency_pins,'repairEvidenceHash',a.repair_evidence_hash,'wireHash',null,'requestId',phase->'binding'->'requestId','responseHash',phase->'responseHash'),
 'knowledge',jsonb_build_object('format','r09.1','businessId',s.business_id,'planId',p.id,'pins','[]'::jsonb)),
 'inputs',private.r12_pilot_input_snapshot(a,p,s,at_time,'receipt',committed,false,false),'current',phase);
 if octet_length(output::text)>655360 then raise exception 'r12_completed_history_bound';end if;return output;
end $$;


-- Guarded branch 1: private.r07_gate(private.r07_plans,jsonb) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r07_gate(private.r07_plans,jsonb)'::regprocedure);
 old:=$old$'r12.discovery.1','r12.discovery-review.1','r12.discovery-evidence.1'$old$;
 replacement:=$new$'r12.discovery.1','r12.discovery-review.1','r12.discovery-evidence.1','r12.discovery-pilot.1'$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>4 then raise exception 'r12_pilot_definition_drift_1';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 2: private.r12_discovery_exposure(uuid) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r12_discovery_exposure(uuid)'::regprocedure);
 old:=$old$'r12.discovery.1','r12.discovery-review.1','r12.discovery-evidence.1'$old$;
 replacement:=$new$'r12.discovery.1','r12.discovery-review.1','r12.discovery-evidence.1','r12.discovery-pilot.1'$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_2';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 3: private.r12_controller_keys(uuid,uuid,jsonb,text,text) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r12_controller_keys(uuid,uuid,jsonb,text,text)'::regprocedure);
 old:=$old$'r12.discovery.1','r12.discovery-review.1','r12.discovery-evidence.1'$old$;
 replacement:=$new$'r12.discovery.1','r12.discovery-review.1','r12.discovery-evidence.1','r12.discovery-pilot.1'$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_3';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 4: private.r12_admission_key_scope(uuid,text,jsonb,text) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r12_admission_key_scope(uuid,text,jsonb,text)'::regprocedure);
 old:=$old$'r12.discovery.1','r12.discovery-review.1','r12.discovery-evidence.1'$old$;
 replacement:=$new$'r12.discovery.1','r12.discovery-review.1','r12.discovery-evidence.1','r12.discovery-pilot.1'$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_4';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 5: public.r12_discovery_server(uuid,uuid,text,jsonb,text) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('public.r12_discovery_server(uuid,uuid,text,jsonb,text)'::regprocedure);
 old:=$old$'r12.discovery.1','r12.discovery-review.1','r12.discovery-evidence.1'$old$;
 replacement:=$new$'r12.discovery.1','r12.discovery-review.1','r12.discovery-evidence.1','r12.discovery-pilot.1'$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_5';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 6: private.r12_discovery_response_guard() from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r12_discovery_response_guard()'::regprocedure);
 old:=$old$'r12.discovery.1','r12.discovery-review.1','r12.discovery-evidence.1'$old$;
 replacement:=$new$'r12.discovery.1','r12.discovery-review.1','r12.discovery-evidence.1','r12.discovery-pilot.1'$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_6';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 7: private.r12_discovery_completed_phase(private.r07_attempts,private.r07_plans) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r12_discovery_completed_phase(private.r07_attempts,private.r07_plans)'::regprocedure);
 old:=$old$'r12.discovery.1','r12.discovery-review.1','r12.discovery-evidence.1'$old$;
 replacement:=$new$'r12.discovery.1','r12.discovery-review.1','r12.discovery-evidence.1','r12.discovery-pilot.1'$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_7';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 8: private.r12_plan_qualification(uuid,uuid,jsonb) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r12_plan_qualification(uuid,uuid,jsonb)'::regprocedure);
 old:=$old$'r12.discovery.1','r12.discovery-review.1','r12.discovery-evidence.1'$old$;
 replacement:=$new$'r12.discovery.1','r12.discovery-review.1','r12.discovery-evidence.1','r12.discovery-pilot.1'$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_8';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 9: private.r12_authority_validate() from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r12_authority_validate()'::regprocedure);
 old:=$old$'r12.discovery.1','r12.discovery-review.1','r12.discovery-evidence.1'$old$;
 replacement:=$new$'r12.discovery.1','r12.discovery-review.1','r12.discovery-evidence.1','r12.discovery-pilot.1'$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_9';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 10: private.r07_validate_plan(uuid,uuid,jsonb) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r07_validate_plan(uuid,uuid,jsonb)'::regprocedure);
 old:=$old$'r12.discovery.1','r12.discovery-review.1','r12.discovery-evidence.1'$old$;
 replacement:=$new$'r12.discovery.1','r12.discovery-review.1','r12.discovery-evidence.1','r12.discovery-pilot.1'$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_10';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 11: private.r12_discovery_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r12_discovery_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb)'::regprocedure);
 old:=$old$'r12.discovery.1','r12.discovery-review.1','r12.discovery-evidence.1'$old$;
 replacement:=$new$'r12.discovery.1','r12.discovery-review.1','r12.discovery-evidence.1','r12.discovery-pilot.1'$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_11';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 12: private.r12_discovery_scope_validate() from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r12_discovery_scope_validate()'::regprocedure);
 old:=$old$ a:=new.amendment;$old$;
 replacement:=$new$ a:=new.amendment;
 if a->>'version'='r12.discovery-focused-pilot.1' then perform private.r12_pilot_envelope_validate(new);return new;end if;$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_12';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 13: private.r12_discovery_scope_current(private.r07_plans) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r12_discovery_scope_current(private.r07_plans)'::regprocedure);
 old:=$old$declare s private.r12_discovery_scopes; prior public.product_experiments; begin$old$;
 replacement:=$new$declare s private.r12_discovery_scopes; prior public.product_experiments; begin
 if p.content->>'format'='r12.discovery-pilot.1' then return private.r12_pilot_scope_at(p,clock_timestamp(),true);end if;$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_13';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 14: private.r12_discovery_scope_at(private.r07_plans,timestamp with time zone) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r12_discovery_scope_at(private.r07_plans,timestamp with time zone)'::regprocedure);
 old:=$old$declare s private.r12_discovery_scopes; prior public.product_experiments; begin$old$;
 replacement:=$new$declare s private.r12_discovery_scopes; prior public.product_experiments; begin
 if p.content->>'format'='r12.discovery-pilot.1' then return private.r12_pilot_scope_at(p,effective_at,true);end if;$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_14';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 15: private.r12_plan_qualification(uuid,uuid,jsonb) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r12_plan_qualification(uuid,uuid,jsonb)'::regprocedure);
 old:=$old$and ((v->>'format'='r12.discovery.1'$old$;
 replacement:=$new$and ((v->>'format'='r12.discovery-pilot.1' and s.amendment->>'version'='r12.discovery-focused-pilot.1') or (v->>'format'='r12.discovery.1'$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_15';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 16: private.r12_authority_validate() from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r12_authority_validate()'::regprocedure);
 old:=$old$ if (new.plan->>'format'='r12.discovery.1')$old$;
 replacement:=$new$ if (new.plan->>'format'='r12.discovery-pilot.1') is distinct from (s.amendment->>'version'='r12.discovery-focused-pilot.1') then raise exception 'r12_scope_format_mismatch';end if;
 if (new.plan->>'format'='r12.discovery.1')$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_16';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 17: private.r12_authority_validate() from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r12_authority_validate()'::regprocedure);
 old:=$old$if new.plan->>'format' in ('r12.discovery-review.1','r12.discovery-evidence.1')$old$;
 replacement:=$new$if new.plan->>'format' in ('r12.discovery-review.1','r12.discovery-evidence.1','r12.discovery-pilot.1')$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_17';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 18: private.r12_review_source(private.r12_discovery_scopes,timestamp with time zone,boolean) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r12_review_source(private.r12_discovery_scopes,timestamp with time zone,boolean)'::regprocedure);
 old:=$old$ if s.amendment->>'version'='r12.discovery-evidence-continuation.1'$old$;
 replacement:=$new$ if e->>'version'='r12.discovery-focused-pilot.1' then return private.r12_pilot_source(s,effective_at,p_current);end if;
 if s.amendment->>'version'='r12.discovery-evidence-continuation.1'$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_18';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 19: private.r07_validate_plan(uuid,uuid,jsonb) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r07_validate_plan(uuid,uuid,jsonb)'::regprocedure);
 old:=$old$evidence_cont boolean:=$old$;
 replacement:=$new$pilot boolean:=coalesce(p->>'format'='r12.discovery-pilot.1',false);evidence_cont boolean:=$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_19';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 20: private.r07_validate_plan(uuid,uuid,jsonb) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r07_validate_plan(uuid,uuid,jsonb)'::regprocedure);
 old:=$old$ if discovery then
 if review_cont then
 if jsonb_array_length(p->'steps')$old$;
 replacement:=$new$ if discovery then
 if pilot then
 select * into binding from private.r12_discovery_scopes where id=(p->>'discoveryScopeId')::uuid and business_id=b and goal_id=g and amendment_hash=p->>'discoveryScopeHash';
 if binding.id is null or binding.amendment->>'version' is distinct from 'r12.discovery-focused-pilot.1' then raise exception 'r07_pilot_scope_unavailable';end if;
 perform private.r12_pilot_source(binding,clock_timestamp(),true);
 if jsonb_array_length(p->'steps')<>2 or p->'maximumChildren' is distinct from '2'::jsonb or p->'maximumDispatches' is distinct from '2'::jsonb
 or p->'maximumRepairs' is distinct from '0'::jsonb or p->'maximumPivots' is distinct from '0'::jsonb or p->'requiredChecks' is distinct from '["review"]'::jsonb
 or policy.payload->'maximumDispatches' is distinct from '2'::jsonb or jsonb_array_length(policy.payload->'operations')<>2
 or private.r05_money(p->'maximumMicrounits')<>private.r05_money(policy.payload->'policyLimitMicrounits')
 or private.r05_money(p->'maximumMicrounits')<>private.r05_money(to_jsonb(binding.amendment->'profile'->>'researchAllocationMicrousd'))
 or exists(select 1 from private.r07_plans saved where saved.business_id=b and saved.goal_id=g and (saved.version<>1 or saved.previous_plan_id is not null or saved.content is distinct from p))
 or exists(select 1 from private.r07_reused reuse join private.r07_plans saved on saved.id=reuse.plan_id where saved.business_id=b and saved.goal_id=g)
 then raise exception 'r07_pilot_initial_topology_required';end if;
 elsif review_cont then
 if jsonb_array_length(p->'steps')$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_20';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 21: private.r07_validate_plan(uuid,uuid,jsonb) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r07_validate_plan(uuid,uuid,jsonb)'::regprocedure);
 old:=$old$(not review_cont and binding.amendment->>'version' is distinct from 'r12.discovery-source-scope.1')$old$;
 replacement:=$new$(not review_cont and not pilot and binding.amendment->>'version' is distinct from 'r12.discovery-source-scope.1')$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_21';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 22: private.r07_validate_plan(uuid,uuid,jsonb) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r07_validate_plan(uuid,uuid,jsonb)'::regprocedure);
 old:=$old$ if exists(select 1 from public.product_experiments newer where newer.business_id=b and newer.discovery_version='pod-discovery-2.0' and newer.parent_discovery_id is null and newer.candidate_id is null and newer.variables->>'budgetAuthorityRootId'=binding.budget_authority_root_id::text and (newer.created_at,newer.id)>(original.created_at,original.id)) or not exists(select 1 from private.r04_goal_versions gv join private.r04_goal_state gs using(goal_id,business_id,revision) where gv.goal_id=g and gv.business_id=b and gv.preference='ready' and gv.revision=(p->>'goalRevision')::integer and gv.content->>'objective'=original.variables->'intent'->>'objective' and (select jsonb_agg(x order by x) from jsonb_array_elements_text(gv.content->'parsed'->'geography') x)=(select jsonb_agg(x->>'countryCode' order by x->>'countryCode') from jsonb_array_elements(original.variables->'intent'->'comparisonUniverse'->'markets') x)) then raise exception 'r07_discovery_original_scope_changed';end if;$old$;
 replacement:=$new$ if pilot then
 if exists(select 1 from public.product_experiments newer where newer.business_id=b and newer.discovery_version='pod-discovery-2.0' and newer.parent_discovery_id is null and newer.candidate_id is null and newer.variables->>'budgetAuthorityRootId'=binding.budget_authority_root_id::text and (newer.created_at,newer.id)>(original.created_at,original.id))
 or not exists(select 1 from private.r04_goal_versions gv join private.r04_goal_state gs using(goal_id,business_id,revision) where gv.goal_id=g and gv.business_id=b and gv.preference='ready'
 and gv.revision=(p->>'goalRevision')::integer and gv.content_hash=p->>'goalHash' and gv.content->'objective'=binding.amendment->'profile'->'intent'->'objective' and gv.content->'parsed'->'geography'='["GB"]'::jsonb)
 then raise exception 'r07_pilot_owner_goal_changed';end if;
 else
 if exists(select 1 from public.product_experiments newer where newer.business_id=b and newer.discovery_version='pod-discovery-2.0' and newer.parent_discovery_id is null and newer.candidate_id is null and newer.variables->>'budgetAuthorityRootId'=binding.budget_authority_root_id::text and (newer.created_at,newer.id)>(original.created_at,original.id)) or not exists(select 1 from private.r04_goal_versions gv join private.r04_goal_state gs using(goal_id,business_id,revision) where gv.goal_id=g and gv.business_id=b and gv.preference='ready' and gv.revision=(p->>'goalRevision')::integer and gv.content->>'objective'=original.variables->'intent'->>'objective' and (select jsonb_agg(x order by x) from jsonb_array_elements_text(gv.content->'parsed'->'geography') x)=(select jsonb_agg(x->>'countryCode' order by x->>'countryCode') from jsonb_array_elements(original.variables->'intent'->'comparisonUniverse'->'markets') x)) then raise exception 'r07_discovery_original_scope_changed';end if;
 end if;$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_22';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 23: private.r07_validate_plan(uuid,uuid,jsonb) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r07_validate_plan(uuid,uuid,jsonb)'::regprocedure);
 old:=$old$ if discovery then
 if review_cont then
 if evidence_cont then$old$;
 replacement:=$new$ if discovery then
 if pilot then
 if n not between 0 and 1 or s->>'key' is distinct from (case n when 0 then 'strategy' else 'review' end)
 or s->>'kind' is distinct from (case n when 0 then 'work' else 'review' end) or s->>'role' is distinct from s->>'key'
 or s->>'adapter' is distinct from 'r12.discovery.'||(p->>'discoveryScopeId')||'.'||(s->>'key')
 or s->>'operationKey' is distinct from 'research.r12.'||(p->>'discoveryScopeId')||'.'||(s->>'key')
 or s->>'expectedArtifactType' is distinct from 'r12.discovery.'||(s->>'key') or s->'maximumRepairs' is distinct from '0'::jsonb or s->'measurement' is distinct from 'null'::jsonb
 or s->'dependsOn' is distinct from (case n when 0 then '[]'::jsonb else '["strategy"]'::jsonb end)
 then raise exception 'r07_pilot_topology_invalid';end if;
 if n=1 then challenge_key:='review';end if;
 elsif review_cont then
 if evidence_cont then$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_23';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 24: private.r07_validate_plan(uuid,uuid,jsonb) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r07_validate_plan(uuid,uuid,jsonb)'::regprocedure);
 old:=$old$ if scope is null or scope->>'purpose' is distinct from s->>'purpose'$old$;
 replacement:=$new$ if pilot and (scope->>'operationKey' is distinct from s->>'operationKey' or scope->>'provider' is distinct from 'openrouter'
 or scope->'accountId' is distinct from 'null'::jsonb or scope->'accountRevision' is distinct from 'null'::jsonb
 or scope->'sourceDomains' is distinct from binding.amendment->'allowedDomains'
 or private.r05_money(scope->'maximumPerOperationMicrounits')<>private.r05_money(s->'maximumMicrounits')) then raise exception 'r07_pilot_exact_operation';end if;
 if scope is null or scope->>'purpose' is distinct from s->>'purpose'$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_24';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 25: private.r07_validate_plan(uuid,uuid,jsonb) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r07_validate_plan(uuid,uuid,jsonb)'::regprocedure);
 old:=$old$ if evidence_cont and total<>$old$;
 replacement:=$new$ if (evidence_cont or pilot) and total<>$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_25';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 26: private.r12_discovery_phase_inputs(private.r07_attempts,private.r07_plans) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r12_discovery_phase_inputs(private.r07_attempts,private.r07_plans)'::regprocedure);
 old:=$old$ if p.content->>'format'='r12.discovery-evidence.1'$old$;
 replacement:=$new$ if p.content->>'format'='r12.discovery-pilot.1' then return private.r12_pilot_phase_inputs(a,p);end if;
 if p.content->>'format'='r12.discovery-evidence.1'$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_26';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 27: public.r12_discovery_result_read(uuid,uuid) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('public.r12_discovery_result_read(uuid,uuid)'::regprocedure);
 old:=$old$ if s.amendment->>'version'='r12.discovery-evidence-continuation.1'$old$;
 replacement:=$new$ if s.amendment->>'version'='r12.discovery-focused-pilot.1' then return private.r12_pilot_result(s);end if;
 if s.amendment->>'version'='r12.discovery-evidence-continuation.1'$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_27';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 28: private.r12_discovery_completed_phase(private.r07_attempts,private.r07_plans) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r12_discovery_completed_phase(private.r07_attempts,private.r07_plans)'::regprocedure);
 old:=$old$(p.content->>'format'='r12.discovery-evidence.1' and a.step_key not in ('strategy','review'))$old$;
 replacement:=$new$(p.content->>'format' in ('r12.discovery-evidence.1','r12.discovery-pilot.1') and a.step_key not in ('strategy','review'))$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_28';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 29: private.r12_review_owner_proposal_validate(private.r12_review_owner_proposals,boolean) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r12_review_owner_proposal_validate(private.r12_review_owner_proposals,boolean)'::regprocedure);
 old:=$old$evidence_cont boolean;$old$;
 replacement:=$new$evidence_cont boolean;pilot boolean;$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_29';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 30: private.r12_review_owner_proposal_validate(private.r12_review_owner_proposals,boolean) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r12_review_owner_proposal_validate(private.r12_review_owner_proposals,boolean)'::regprocedure);
 old:=$old$ evidence_cont:=coalesce$old$;
 replacement:=$new$ pilot:=coalesce(s.amendment->>'version'='r12.discovery-focused-pilot.1',false);
 evidence_cont:=coalesce$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_30';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 31: private.r12_review_owner_proposal_validate(private.r12_review_owner_proposals,boolean) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r12_review_owner_proposal_validate(private.r12_review_owner_proposals,boolean)'::regprocedure);
 old:=$old$('r12.discovery-review-continuation.1','r12.discovery-review-continuation.2','r12.discovery-evidence-continuation.1')$old$;
 replacement:=$new$('r12.discovery-review-continuation.1','r12.discovery-review-continuation.2','r12.discovery-evidence-continuation.1','r12.discovery-focused-pilot.1')$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_31';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 32: private.r12_review_owner_proposal_validate(private.r12_review_owner_proposals,boolean) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r12_review_owner_proposal_validate(private.r12_review_owner_proposals,boolean)'::regprocedure);
 old:=$old$when evidence_cont then 2$old$;
 replacement:=$new$when evidence_cont or pilot then 2$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>2 then raise exception 'r12_pilot_definition_drift_32';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 33: private.r12_review_owner_proposal_validate(private.r12_review_owner_proposals,boolean) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r12_review_owner_proposal_validate(private.r12_review_owner_proposals,boolean)'::regprocedure);
 old:=$old$ if evidence_cont then$old$;
 replacement:=$new$ if evidence_cont or pilot then$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_33';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 34: private.r12_review_owner_proposal_validate(private.r12_review_owner_proposals,boolean) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r12_review_owner_proposal_validate(private.r12_review_owner_proposals,boolean)'::regprocedure);
 old:=$old$op->'sourceDomains' is distinct from s.amendment->'executionSourceDomains'$old$;
 replacement:=$new$op->'sourceDomains' is distinct from (case when pilot then s.amendment->'allowedDomains' else s.amendment->'executionSourceDomains' end)$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_34';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 35: private.r12_review_owner_proposal_validate(private.r12_review_owner_proposals,boolean) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r12_review_owner_proposal_validate(private.r12_review_owner_proposals,boolean)'::regprocedure);
 old:=$old$ if p_current then$old$;
 replacement:=$new$ if pilot and private.r05_money(p->'policyLimitMicrounits')<>private.r05_money(to_jsonb(s.amendment->'profile'->>'researchAllocationMicrousd')) then raise exception 'r12_pilot_exact_allocation';end if;
 if p_current then$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_35';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 36: private.r12_review_owner_proposal_validate(private.r12_review_owner_proposals,boolean) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r12_review_owner_proposal_validate(private.r12_review_owner_proposals,boolean)'::regprocedure);
 old:=$old$ perform private.r12_validate_review_envelope(s);$old$;
 replacement:=$new$ if pilot then perform private.r12_pilot_source(s,clock_timestamp(),true);else perform private.r12_validate_review_envelope(s);end if;$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_36';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 37: private.r12_discovery_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r12_discovery_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb)'::regprocedure);
 old:=$old$ perform private.r04_keys(v,array['version','scopeId'$old$;
 replacement:=$new$ if p.content->>'format'='r12.discovery-pilot.1' and (phase not in ('strategy','review') or s.amendment->>'version' is distinct from 'r12.discovery-focused-pilot.1'
 or a.attempt<>1 or p.version<>1 or p.previous_plan_id is not null
 or a.dependency_pins is distinct from private.r07_dependencies(p.id,(select value from jsonb_array_elements(p.content->'steps') st where st->>'key'=phase))) then raise exception 'r12_pilot_only_wire_required';end if;
 perform private.r04_keys(v,array['version','scopeId'$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_37';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 38: private.r12_discovery_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r12_discovery_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb)'::regprocedure);
 old:=$old$p.content->>'format'='r12.discovery-evidence.1' then 65536$old$;
 replacement:=$new$p.content->>'format'='r12.discovery-pilot.1' then 49152 when p.content->>'format'='r12.discovery-evidence.1' then 65536$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_38';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 39: private.r12_discovery_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r12_discovery_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb)'::regprocedure);
 old:=$old$case when p.content->>'format'='r12.discovery-evidence.1' then 'r12.discovery-evidence-quote.1'$old$;
 replacement:=$new$case when p.content->>'format'='r12.discovery-pilot.1' then 'r12.discovery-pilot-quote.1' when p.content->>'format'='r12.discovery-evidence.1' then 'r12.discovery-evidence-quote.1'$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_39';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 40: private.r12_discovery_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r12_discovery_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb)'::regprocedure);
 old:=$old$(p.content->>'format'='r12.discovery-evidence.1' and q->'maximumRequestBytes'$old$;
 replacement:=$new$(p.content->>'format'='r12.discovery-pilot.1' and q->'maximumRequestBytes' is distinct from '49152'::jsonb) or (p.content->>'format'='r12.discovery-evidence.1' and q->'maximumRequestBytes'$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_40';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 41: private.r12_discovery_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r12_discovery_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb)'::regprocedure);
 old:=$old$case when p.content->>'format'='r12.discovery-evidence.1' then 2 else 5 end$old$;
 replacement:=$new$case when p.content->>'format' in ('r12.discovery-evidence.1','r12.discovery-pilot.1') then 2 else 5 end$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_41';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 42: private.r12_discovery_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r12_discovery_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb)'::regprocedure);
 old:=$old$case when p.content->>'format'='r12.discovery-evidence.1' then 0 else 1 end$old$;
 replacement:=$new$case when p.content->>'format' in ('r12.discovery-evidence.1','r12.discovery-pilot.1') then 0 else 1 end$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_42';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 43: private.r12_discovery_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('private.r12_discovery_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb)'::regprocedure);
 old:=$old$ if private.stage14_hash(((v->>'requestJson')::jsonb)->'outputSchema') is distinct from (case phase$old$;
 replacement:=$new$ if p.content->>'format'='r12.discovery-pilot.1' then
 if ((v->>'requestJson')::jsonb)->'requestMetadata'->>'r12FocusedPilotProfileHash' is distinct from s.amendment->>'profileHash'
 or private.stage14_hash(((v->>'requestJson')::jsonb)->'outputSchema') is distinct from (case phase when 'strategy' then '0eeaa5590d1945e34be684d637f069f7787bfd992c4d89182d0d44831aac8ba0' else 'd1ab02be3a01b43f6c407070b284c37b8079e10eb2991013009d2c502bbd7e54' end)
 or private.stage14_hash(body->'response_format'->'json_schema'->'schema') is distinct from (case phase when 'strategy' then '6af47351df9096251feb5bc4f2f710f109ae73b27003a55576446bcfbe04727d' else '81c1f3d20dce36cd6f00e3dabf8b7bce069cf5d03628d770e7ef40172b5d734c' end)
 then raise exception 'r12_pilot_static_schema_required';end if;return;
 end if;
 if private.stage14_hash(((v->>'requestJson')::jsonb)->'outputSchema') is distinct from (case phase$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_43';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 44: public.r12_discovery_owner_read(uuid,uuid,boolean) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('public.r12_discovery_owner_read(uuid,uuid,boolean)'::regprocedure);
 old:=$old$if not coalesce(source_scope.amendment->>'version' in ('r12.discovery-source-scope.1','r12.discovery-review-continuation.1','r12.discovery-review-continuation.2','r12.discovery-evidence-continuation.1'),false)$old$;
 replacement:=$new$if not coalesce(source_scope.amendment->>'version' in ('r12.discovery-source-scope.1','r12.discovery-review-continuation.1','r12.discovery-review-continuation.2','r12.discovery-evidence-continuation.1','r12.discovery-focused-pilot.1'),false)$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_44';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 45: public.r12_discovery_owner_read(uuid,uuid,boolean) from 20261006213033_r12_evidence_addendum_successor.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('public.r12_discovery_owner_read(uuid,uuid,boolean)'::regprocedure);
 old:=$old$else '{}'::jsonb end;$old$;
 replacement:=$new$else '{}'::jsonb end||case when source_scope.amendment->>'version'='r12.discovery-focused-pilot.1' then jsonb_build_object('focusedPilot',jsonb_build_object('profileHash',source_scope.amendment->>'profileHash','closedScopeId',(select old.content->>'discoveryScopeId' from private.r07_plans old where old.id=(source_scope.amendment->>'closedPlanId')::uuid and old.business_id=p_business_id and old.content_hash=source_scope.amendment->>'closedPlanHash'),'closedPlanId',source_scope.amendment->>'closedPlanId','acceptedReviewScopeId',source_scope.amendment->>'acceptedReviewScopeId')) else '{}'::jsonb end;$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_45';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- Guarded branch 46: public.r12_discovery_scope_read(uuid,uuid) from 20261006081027_r12_saved_review_continuation.sql
do $pilot_patch$
declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('public.r12_discovery_scope_read(uuid,uuid)'::regprocedure);
 old:=$old$ if (s.amendment->>'expiresAt')::timestamptz<=clock_timestamp()$old$;
 replacement:=$new$ if s.amendment->>'version'='r12.discovery-focused-pilot.1' then
 perform private.r12_pilot_source(s,clock_timestamp(),true);
 if not exists(select 1 from private.r04_goal_versions gv join private.r04_goal_state gs using(goal_id,business_id,revision) where gv.goal_id=s.goal_id and gv.business_id=s.business_id and gv.preference='ready' and gv.content->'objective'=s.amendment->'profile'->'intent'->'objective' and gv.content->'parsed'->'geography'='["GB"]'::jsonb) then raise exception 'r12_pilot_owner_goal_changed';end if;
 budget:=private.stage13v2_budget_authority(prior.id,false);
 return jsonb_build_object('original',jsonb_build_object('businessId',s.business_id,'budgetAuthorityRootId',s.budget_authority_root_id,'priorRoundId',s.prior_round_id,'semanticGoalHash',prior.variables->>'semanticGoalHash','priorIntent',prior.variables->'intent','maximumMicrousd',budget->'maximumMicrousd','committedMicrousd',budget->'committedMicrousd','hasUncertainCosts',budget->'hasUncertainCosts'),'amendment',s.amendment,'amendmentHash',s.amendment_hash,'executionAuthorized',false);
 end if;
 if (s.amendment->>'expiresAt')::timestamptz<=clock_timestamp()$new$;
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_pilot_definition_drift_46';end if;
 execute replace(definition,old,replacement);
end $pilot_patch$;


-- One finite pilot from the closed original research round, with a new Goal.
create unique index r12_one_focused_pilot_per_closed_plan on private.r12_discovery_scopes(business_id,(amendment->>'closedPlanId')) where amendment->>'version'='r12.discovery-focused-pilot.1';
create unique index r12_one_focused_pilot_per_goal on private.r12_discovery_scopes(business_id,goal_id) where amendment->>'version'='r12.discovery-focused-pilot.1';
revoke all on function private.r12_pilot_safe(jsonb),private.r12_pilot_profile_validate(private.r12_discovery_scopes,timestamp with time zone,boolean),
 private.r12_pilot_source(private.r12_discovery_scopes,timestamp with time zone,boolean),
 private.r12_pilot_scope_at(private.r07_plans,timestamp with time zone,boolean),
 private.r12_pilot_envelope_validate(private.r12_discovery_scopes),
 private.r12_pilot_input_snapshot(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,timestamp with time zone,text,bigint,boolean,boolean),
 private.r12_pilot_phase_inputs(private.r07_attempts,private.r07_plans),private.r12_pilot_result(private.r12_discovery_scopes)
 from public,anon,authenticated,service_role;
commit;
