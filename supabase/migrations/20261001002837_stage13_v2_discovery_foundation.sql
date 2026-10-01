-- DRAFT ONLY: versioned discovery registry foundation. No hosted application,
-- qualification, paid call, public endpoint, role grant or v1 history rewrite.
-- V1 validation remains exact; v2 research intents are not fake candidates.

alter table public.product_experiments
  add column discovery_version text not null default 'pod-discovery-1.0',
  add column parent_discovery_id uuid;
alter table public.product_experiments alter column candidate_id drop not null;
alter table public.product_experiments
  add constraint product_experiments_discovery_version_check
    check(discovery_version in ('pod-discovery-1.0','pod-discovery-2.0')),
  add constraint product_experiments_v2_parent_fk
    foreign key(parent_discovery_id,business_id) references public.product_experiments(id,business_id) on delete restrict,
  add constraint product_experiments_versioned_identity_check check(
    (discovery_version='pod-discovery-1.0' and candidate_id is not null and parent_discovery_id is null) or
    (discovery_version='pod-discovery-2.0' and workflow_run_id is not null and basis_artifact_id is null and
      ((parent_discovery_id is null and candidate_id is null) or (parent_discovery_id is not null and candidate_id is not null and parent_discovery_id<>id))));

-- A genuinely new, explicitly authorized v2 round may reassess the same unchanged
-- candidate. It must not mint a new candidate ID just to bypass v1's initial rule.
drop index public.stage13_one_initial_discovery;
create unique index stage13_one_initial_discovery on public.product_experiments(candidate_id)
  where basis_artifact_id is null and discovery_version='pod-discovery-1.0';
create unique index stage13_v2_one_root_per_workflow on public.product_experiments(workflow_run_id)
  where discovery_version='pod-discovery-2.0' and parent_discovery_id is null;
create unique index stage13_v2_one_child_per_candidate on public.product_experiments(parent_discovery_id,candidate_id)
  where discovery_version='pod-discovery-2.0' and parent_discovery_id is not null;

-- Preserve the exact old fixed-plan predicate only for v1; v2 stores its bounded
-- learning-test snapshot (or null when there is no TEST) without numeric scoring.
alter table public.product_experiments drop constraint product_experiments_measurement_plan_check;
alter table public.product_experiments add constraint product_experiments_versioned_measurement_plan_check check(
  (discovery_version='pod-discovery-1.0' and measurement_plan=private.stage13_plan()) or
  (discovery_version='pod-discovery-2.0' and jsonb_typeof(measurement_plan)='object' and
    measurement_plan ?& array['version','testPlan'] and measurement_plan-array['version','testPlan']='{}'::jsonb and
    measurement_plan->>'version' is not distinct from 'pod-discovery-2.0' and
    (measurement_plan->'testPlan'='null'::jsonb or (jsonb_typeof(measurement_plan->'testPlan')='object' and
      measurement_plan->'testPlan'->>'budgetStatus' is not distinct from 'proposal_only' and
      measurement_plan->'testPlan'->'generationAuthorized' is not distinct from 'false'::jsonb and
      measurement_plan->'testPlan'->'spendingAuthorized' is not distinct from 'false'::jsonb and
      measurement_plan->'testPlan'->'publicationAllowed' is not distinct from 'false'::jsonb and
      measurement_plan->'testPlan'->'commerceAllowed' is not distinct from 'false'::jsonb and
      jsonb_typeof(measurement_plan->'testPlan'->'maximumMicrousd') is not distinct from 'number' and
      (measurement_plan->'testPlan'->>'maximumMicrousd')::numeric=trunc((measurement_plan->'testPlan'->>'maximumMicrousd')::numeric) and
      (measurement_plan->'testPlan'->>'maximumMicrousd')::numeric between 1 and 1000000 and
      coalesce(measurement_plan->'testPlan'->'maximumGenerations','null'::jsonb) in ('1'::jsonb,'2'::jsonb))) and
    (parent_discovery_id is not null or measurement_plan->'testPlan'='null'::jsonb)));

-- The strict v2 ReviewerDecision object is persisted verbatim. Its version and
-- actual execution identify its origin; do not inject a fake v1 owner assessment.
do $$ declare c record; n integer:=0; begin
  for c in select conname from pg_constraint where conrelid='public.product_decisions'::regclass and contype='c' and
    (position('assessmentOrigin' in pg_get_constraintdef(oid))>0 or position('contract_checked' in pg_get_constraintdef(oid))>0) loop
    execute format('alter table public.product_decisions drop constraint %I',c.conname); n:=n+1;
  end loop;
  if n<>2 then raise exception 'Unexpected v1 decision constraints; review required.'; end if;
end; $$;
alter table public.product_decisions add constraint product_decisions_versioned_origin_check check(
  (not(assessment ? 'version') and assessment->>'assessmentOrigin' in ('deterministic_provisional','owner_assessment') and
    assessment->'review'='{"status":"contract_checked","liveQualified":false,"creativeProductionAllowed":false,"publicationAllowed":false}'::jsonb) or
  coalesce((assessment->>'version'='pod-discovery-2.0' and not(assessment ? 'assessmentOrigin') and
    assessment->>'outcome' in ('TEST','REJECT','NEEDS_MORE_EVIDENCE') and
    assessment->'publicationAllowed'='false'::jsonb and assessment->'commerceAllowed'='false'::jsonb and
    assessment->'executionPrerequisites'='{"ownerCreativeApproval":"required","freshBudgetApproval":"required","conceptSpecificIpScreen":"required","printValidation":"required"}'::jsonb and
    assessment->'execution'->>'modelId'='anthropic/claude-haiku-4.5' and assessment->'execution'->'primaryOnly'='true'::jsonb),false));

create or replace function private.stage13_registry_guard() returns trigger language plpgsql set search_path='' as $$
declare parent public.product_experiments%rowtype; candidate public.product_candidates%rowtype; experiment public.product_experiments%rowtype; identity jsonb;
begin
  if current_user in ('anon','authenticated','service_role') then raise exception 'Use the guarded product discovery RPC.' using errcode='42501'; end if;
  if tg_op='DELETE' then raise exception 'Product discovery history is append-only.'; end if;
  if tg_op='UPDATE' then
    if tg_table_name<>'product_experiments' then raise exception 'Product discovery history is immutable.'; end if;
    if old.status in ('completed','failed') or
      (to_jsonb(new)-array['status','evidence_pack','source_artifact_id','failure','started_at','completed_at']) is distinct from
      (to_jsonb(old)-array['status','evidence_pack','source_artifact_id','failure','started_at','completed_at']) or
      new.status not in ('researching','completed','failed') or
      (old.source_artifact_id is not null and new.source_artifact_id is distinct from old.source_artifact_id) or
      (old.evidence_pack is not null and new.evidence_pack is distinct from old.evidence_pack) then
      raise exception 'Product discovery history is immutable.';
    end if;
  end if;
  if tg_table_name='product_experiments' then
    if new.discovery_version='pod-discovery-2.0' then
    if new.parent_discovery_id is null then
      if new.candidate_id is not null or new.variables->'intent'->>'id' is distinct from new.id::text or
        new.variables->'intent'->>'businessId' is distinct from new.business_id::text or
        new.variables->'intent'->>'version' is distinct from 'pod-discovery-2.0' or
        new.variables->>'policyHash' is distinct from private.stage14_hash(new.variables->'intent') then
        raise exception 'The v2 root must preserve its own exact intent, Business and policy hash.';
      end if;
    else
      select * into parent from public.product_experiments where id=new.parent_discovery_id and business_id=new.business_id;
      select * into candidate from public.product_candidates where id=new.candidate_id and business_id=new.business_id;
      identity:=new.variables->'identity';
      if parent.id is null or parent.discovery_version<>'pod-discovery-2.0' or parent.parent_discovery_id is not null or parent.candidate_id is not null or
        parent.workflow_run_id is distinct from new.workflow_run_id or candidate.id is null or
        new.variables->>'intentId' is distinct from parent.id::text or jsonb_typeof(identity) is distinct from 'object' or
        not(identity ?& array['id','businessId','concept','audience','productType','originalDesign','rightsStatus']) or
        identity-array['id','businessId','concept','audience','productType','originalDesign','rightsStatus']<>'{}'::jsonb or
        identity->>'id' is distinct from candidate.id::text or identity->>'businessId' is distinct from candidate.business_id::text or
        identity->>'concept' is distinct from candidate.concept or identity->>'audience' is distinct from candidate.audience or
        identity->>'productType' is distinct from candidate.product_type or identity->'originalDesign' is distinct from to_jsonb(candidate.original_design) or
        identity->>'rightsStatus' is distinct from candidate.rights_status or
        not((parent.variables->'intent'->'comparisonUniverse'->'audiences') ? (identity->>'audience')) then
        raise exception 'V2 child identity must match the unchanged candidate and same-Business discovery root.';
      end if;
    end if;
    end if;
  elsif tg_table_name='product_decisions' then
    select * into experiment from public.product_experiments where id=new.experiment_id and business_id=new.business_id and candidate_id=new.candidate_id;
    if experiment.id is null or
      (experiment.discovery_version='pod-discovery-1.0' and new.assessment ? 'version') or
      (experiment.discovery_version='pod-discovery-2.0' and (experiment.parent_discovery_id is null or new.assessment->>'version' is distinct from 'pod-discovery-2.0' or
        new.assessment->>'intentId' is distinct from experiment.parent_discovery_id::text or new.assessment->>'candidateId' is distinct from new.candidate_id::text)) then
      raise exception 'Decision version and identity must match its exact persisted experiment.';
    end if;
  end if;
  return new;
end; $$;

-- Protect both old and new provenance from direct generic owner CRUD, including
-- attempts to move an artifact/run into or out of the protected workflow scope.
create or replace function private.stage13_research_write_guard() returns trigger language plpgsql set search_path='' as $$
declare v_old jsonb; v_new jsonb; v_run uuid;
begin
  if current_user not in ('anon','authenticated','service_role') then if tg_op='DELETE' then return old; else return new; end if; end if;
  if tg_op<>'INSERT' then v_old:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then v_new:=to_jsonb(new); end if;
  if tg_table_name='workflow_runs' then
    if tg_op='UPDATE' and current_user='authenticated' and private.is_business_owner(old.business_id) and
      old.status='queued' and old.runtime_launch_status='reserved' and old.runtime_run_id is null and
      new.status='failed' and new.runtime_launch_status='launch_failed' and new.completed_at is not null and
      (v_old-array['status','runtime_launch_status','completed_at','updated_at'])=(v_new-array['status','runtime_launch_status','completed_at','updated_at']) and
      not exists(select 1 from public.product_experiments where workflow_run_id=old.id) and
      coalesce(old.pack_snapshot->'workflow'->>'key','') not in ('product.discovery-v2.one','product.discovery-v2.two') then return new; end if;
    if v_old->'pack_snapshot'->'workflow'->>'key' in ('research.public-evidence','product.discovery-v2.one','product.discovery-v2.two') or
      v_new->'pack_snapshot'->'workflow'->>'key' in ('research.public-evidence','product.discovery-v2.one','product.discovery-v2.two') then
      raise exception 'Research provenance is runtime-managed.' using errcode='42501'; end if;
  else
    if tg_table_name='artifacts' and (v_old->>'artifact_type' in ('product.discovery-dossier.v2','product.discovery-intent.v2') or v_new->>'artifact_type' in ('product.discovery-dossier.v2','product.discovery-intent.v2')) then
      raise exception 'Discovery dossiers are runtime-managed.' using errcode='42501'; end if;
    for v_run in select distinct x from unnest(array[(v_old->>'workflow_run_id')::uuid,(v_new->>'workflow_run_id')::uuid]) x where x is not null loop
      if exists(select 1 from public.workflow_runs where id=v_run and pack_snapshot->'workflow'->>'key' in ('research.public-evidence','product.discovery-v2.one','product.discovery-v2.two')) then
        raise exception 'Research provenance is runtime-managed.' using errcode='42501'; end if;
    end loop;
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end; $$;

-- The existing cost ledger gains only the finite v2 attempt-key vocabulary.
-- Reservation RPCs are not broadened here; each must still be integrated with
-- authoritative root/stage/quote validation before these keys can be invoked.
alter table public.product_research_cost_reservations drop constraint product_research_cost_reservations_attempt_key_check;
alter table public.product_research_cost_reservations add constraint product_research_cost_reservations_versioned_attempt_key_check check(
  attempt_key in ('search:luna.standard','search:gemini.flash.large','selector:luna.standard','selector:gemini.flash.large') or
  (attempt_key in ('plan:1','search:1','select:1','search:2','select:2','strategy:1','review:1') and estimate->>'version' is not distinct from 'discovery-estimate-2.0'));

-- Private foundation only. false validates/resolves the immutable persisted
-- budget scope. true deliberately remains closed until terminal dossier,
-- actual-receipt and qualitative-decision integration is installed. No caller
-- may interpret the scope result as an evidence or production approval.
create function private.stage13v2_validate_persisted(p_experiment_id uuid,p_require_completed boolean default true)
returns jsonb language plpgsql stable set search_path='' as $$
declare e public.product_experiments%rowtype; root public.product_experiments%rowtype; r public.workflow_runs%rowtype;
  intent jsonb; universe jsonb; limits jsonb; quote jsonb; item jsonb; field text; expected_keys text[]; maximum integer; collections integer; committed bigint;
  has_uncertain boolean; owner_id uuid; root_release jsonb;
begin
  select * into e from public.product_experiments where id=p_experiment_id;
  if e.id is null or e.discovery_version<>'pod-discovery-2.0' then raise exception 'A persisted v2 discovery experiment is required.'; end if;
  select * into root from public.product_experiments where id=coalesce(e.parent_discovery_id,e.id) and business_id=e.business_id;
  if root.id is null or root.discovery_version<>'pod-discovery-2.0' or root.parent_discovery_id is not null or root.candidate_id is not null or
    root.workflow_run_id is distinct from e.workflow_run_id then raise exception 'A same-Business immutable discovery root is required.'; end if;
  select * into r from public.workflow_runs where id=root.workflow_run_id and business_id=root.business_id;
  select owner_user_id into owner_id from public.businesses where id=root.business_id;
  if r.id is null or owner_id is null or r.runtime_capability_hash is null or
    r.input is distinct from jsonb_build_object('intentId',root.id) or
    coalesce(r.pack_snapshot->'workflow'->>'key','') not in ('product.discovery-v2.one','product.discovery-v2.two') or
    r.pack_snapshot->'workflow'->>'version' is distinct from '1.0.0' then
    raise exception 'The root must belong to an exact v2 discovery workflow.';
  end if;
  intent:=root.variables->'intent'; universe:=intent->'comparisonUniverse'; limits:=intent->'limits'; quote:=root.variables->'budgetQuote';
  if jsonb_typeof(intent) is distinct from 'object' or octet_length(intent::text)>20000 or
    not(intent ?& array['version','id','businessId','objective','comparisonUniverse','limits','expiresAt']) or
    intent-array['version','id','businessId','objective','comparisonUniverse','limits','expiresAt']<>'{}'::jsonb or
    intent->>'version' is distinct from 'pod-discovery-2.0' or intent->>'id' is distinct from root.id::text or intent->>'businessId' is distinct from root.business_id::text or
    root.variables->>'policyHash' is distinct from private.stage14_hash(intent) or
    jsonb_typeof(intent->'objective') is distinct from 'string' or length(btrim(intent->>'objective')) not between 20 and 1200 or
    jsonb_typeof(intent->'expiresAt') is distinct from 'string' or (intent->>'expiresAt')::timestamptz<=clock_timestamp() then
    raise exception 'The exact unexpired discovery intent and canonical policy hash are required.';
  end if;
  if jsonb_typeof(universe) is distinct from 'object' or not(universe ?& array['productType','markets','audiences','sourceDomains','selectionQuestion']) or
    universe-array['productType','markets','audiences','sourceDomains','selectionQuestion']<>'{}'::jsonb or
    universe->>'productType' is distinct from 'original_pod_tshirt' or jsonb_typeof(universe->'selectionQuestion') is distinct from 'string' or
    length(btrim(universe->>'selectionQuestion')) not between 20 and 800 or
    jsonb_typeof(universe->'markets') is distinct from 'array' or jsonb_array_length(universe->'markets') not between 2 and 4 or
    jsonb_typeof(universe->'audiences') is distinct from 'array' or jsonb_array_length(universe->'audiences') not between 1 and 3 or
    jsonb_typeof(universe->'sourceDomains') is distinct from 'array' or jsonb_array_length(universe->'sourceDomains') not between 1 and 6 then
    raise exception 'A finite geographic, audience and source-domain comparison universe is required.';
  end if;
  for item in select value from jsonb_array_elements(universe->'markets') loop
    if jsonb_typeof(item) is distinct from 'object' or not(item ?& array['countryCode','currency']) or item-array['countryCode','currency']<>'{}'::jsonb or
      jsonb_typeof(item->'countryCode') is distinct from 'string' or coalesce(item->>'countryCode','') !~ '^[A-Z]{2}$' or
      jsonb_typeof(item->'currency') is distinct from 'string' or coalesce(item->>'currency','') !~ '^[A-Z]{3}$' then
      raise exception 'Every geographic comparison needs an explicit country and currency.';
    end if;
  end loop;
  if (select count(distinct value->>'countryCode') from jsonb_array_elements(universe->'markets'))<>jsonb_array_length(universe->'markets') then raise exception 'Duplicate geographic markets are not additional scope.'; end if;
  foreach field in array array['audiences','sourceDomains'] loop
    if (select count(distinct value) from jsonb_array_elements(universe->field))<>jsonb_array_length(universe->field) then raise exception 'Comparison values must be unique.'; end if;
    for item in select value from jsonb_array_elements(universe->field) loop
      if jsonb_typeof(item) is distinct from 'string' or length(btrim(item#>>'{}')) not between 3 and 600 then raise exception 'Bounded comparison text is required.'; end if;
      if field='sourceDomains' and (length(item#>>'{}')>200 or
        (item#>>'{}') !~ '^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$' or
        (item#>>'{}') ~ '\.(local|internal|localhost|test|invalid|example|onion)$' or (item#>>'{}') ~ '(^|\.)(localhost|localdomain)$') then raise exception 'Unsafe discovery source domain.'; end if;
    end loop;
  end loop;
  if jsonb_typeof(limits) is distinct from 'object' or not(limits ?& array['maximumAlternatives','maximumNewCollections','maximumMicrousd','maximumGenerations']) or
    limits-array['maximumAlternatives','maximumNewCollections','maximumMicrousd','maximumGenerations']<>'{}'::jsonb or
    limits->'maximumAlternatives' is distinct from '3'::jsonb or coalesce(limits->'maximumNewCollections','null') not in ('1'::jsonb,'2'::jsonb) or
    coalesce(limits->'maximumGenerations','null') not in ('1'::jsonb,'2'::jsonb) or jsonb_typeof(limits->'maximumMicrousd') is distinct from 'number' or
    (limits->>'maximumMicrousd')::numeric<>trunc((limits->>'maximumMicrousd')::numeric) or (limits->>'maximumMicrousd')::numeric not between 1 and 1000000 then
    raise exception 'Only the explicit finite discovery and future test bounds are permitted.';
  end if;
  maximum:=(limits->>'maximumMicrousd')::integer; collections:=(limits->>'maximumNewCollections')::integer;
  if r.pack_snapshot->'workflow'->>'key' is distinct from (case collections when 1 then 'product.discovery-v2.one' else 'product.discovery-v2.two' end) then
    raise exception 'The registered workflow stage list must match the approved collection count.';
  end if;
  if (select array_agg(x.stage->>'key' order by x.ordinal) from jsonb_array_elements(r.pack_snapshot->'workflow'->'stages') with ordinality x(stage,ordinal)) is distinct from
    (case collections when 1 then array['plan','research1','strategy','review'] else array['plan','research1','research2','strategy','review'] end) then
    raise exception 'Only the exact finite v2 stage list is supported.';
  end if;
  if jsonb_typeof(r.pack_snapshot->'releases') is distinct from 'array' then raise exception 'Pinned discovery releases required.'; end if;
  select value into root_release from jsonb_array_elements(r.pack_snapshot->'releases') where value->>'id'=r.pack_snapshot->>'rootPackId';
  if root_release is null or not exists(select 1 from public.packs p where p.id=(root_release->>'id')::uuid and p.manifest=root_release->'manifest') or
    not exists(select 1 from jsonb_array_elements(root_release->'manifest'->'workflows') w where w=r.pack_snapshot->'workflow') or
    exists(select 1 from jsonb_array_elements(r.pack_snapshot->'releases') release where not exists(
      select 1 from public.packs p where p.id=(release->>'id')::uuid and p.manifest=release->'manifest' and p.version=release->'manifest'->>'version')) then
    raise exception 'Discovery scope must retain its actual registered manifest closure.';
  end if;
  expected_keys:=(case collections when 1 then array['plan:1','search:1','select:1','strategy:1','review:1'] else array['plan:1','search:1','select:1','search:2','select:2','strategy:1','review:1'] end);
  if jsonb_typeof(quote) is distinct from 'object' or
    not(quote ?& array['version','intentId','policyHash','maximumCollections','maximumCalls','maximumEstimateMicrousd','ceilings','directorModel','reviewerModel','verifiedAt','sourceUrls','primaryOnly','estimateOnly','providerInvoiceGuarantee']) or
    quote-array['version','intentId','policyHash','maximumCollections','maximumCalls','maximumEstimateMicrousd','ceilings','directorModel','reviewerModel','verifiedAt','sourceUrls','primaryOnly','estimateOnly','providerInvoiceGuarantee']<>'{}'::jsonb or
    jsonb_typeof(quote->'verifiedAt') is distinct from 'string' or (quote->>'verifiedAt')::timestamptz not between root.created_at-interval '5 minutes' and root.created_at+interval '5 minutes' or
    quote->'sourceUrls' is distinct from '["https://openrouter.ai/api/v1/models","https://openrouter.ai/docs/guides/features/server-tools/web-search"]'::jsonb or
    quote->>'version' is distinct from 'discovery-estimate-2.0' or
    quote->>'intentId' is distinct from root.id::text or quote->>'policyHash' is distinct from root.variables->>'policyHash' or
    quote->'maximumCollections' is distinct from to_jsonb(collections) or quote->'maximumCalls' is distinct from to_jsonb(cardinality(expected_keys)) or
    quote->>'directorModel' is distinct from 'openai/gpt-5.6-luna' or quote->>'reviewerModel' is distinct from 'anthropic/claude-haiku-4.5' or
    quote->'primaryOnly' is distinct from 'true'::jsonb or quote->'estimateOnly' is distinct from 'true'::jsonb or quote->'providerInvoiceGuarantee' is distinct from 'false'::jsonb or
    jsonb_typeof(quote->'ceilings') is distinct from 'object' or not((quote->'ceilings') ?& expected_keys) or (quote->'ceilings')-expected_keys<>'{}'::jsonb or
    jsonb_typeof(quote->'maximumEstimateMicrousd') is distinct from 'number' or
    (quote->>'maximumEstimateMicrousd')::numeric not between 1 and maximum or
    exists(select 1 from jsonb_each(quote->'ceilings') q where jsonb_typeof(q.value)<>'number' or (q.value#>>'{}')::numeric<>trunc((q.value#>>'{}')::numeric) or (q.value#>>'{}')::numeric not between 1 and maximum) or
    (quote->>'maximumEstimateMicrousd')::numeric is distinct from (select sum((value#>>'{}')::numeric) from jsonb_each(quote->'ceilings')) then
    raise exception 'The entire finite primary-only discovery quote must fit its immutable owner envelope.';
  end if;
  committed:=private.stage13_committed_cost(root.id);
  select exists(select 1 from public.product_research_cost_reservations reservation where reservation.experiment_id=root.id and
    not exists(select 1 from public.product_research_cost_settlements settlement where settlement.reservation_id=reservation.id and settlement.reported_microusd is not null and settlement.provider_request_id is not null)) into has_uncertain;
  if p_require_completed is distinct from false then
    -- This foundation intentionally cannot authorize a terminal v2 decision.
    -- The next reviewed integration adds receipt-backed dossier/strategy/review
    -- validation after the exact new manifest/runtime contract is available.
    raise exception 'V2 terminal dossier and decision validation is not installed; no production authority is available.';
  end if;
  return jsonb_build_object('validationLevel','intent_scope_only','experimentId',root.id,'intentId',root.id,'businessId',root.business_id,
    'workflowRunId',r.id,'maximumCollections',collections,'maximumMicrousd',maximum,'policyHash',root.variables->>'policyHash',
    'committedMicrousd',committed,'hasUncertainCosts',has_uncertain,'status',root.status,'intent',intent,'budgetQuote',quote,
    'decisionValidated',false,'productionEligible',false);
end; $$;
revoke all on function private.stage13v2_validate_persisted(uuid,boolean) from public,anon,authenticated,service_role;
