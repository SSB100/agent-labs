-- OFFLINE DRAFT: one immutable allowance across an explicit discovery goal chain.
-- V2 accounting is known-final actual usage + pending/unknown reserved exposure.
-- An unused settled estimate is not billable and is released from remaining
-- authority. History is retained; neither a new root nor a reason replenishes it.
-- V1 and creative accounting, public signatures and grants remain unchanged.

create function private.stage13v2_budget_authority(p_root_id uuid,p_lock_authority boolean default false)
returns jsonb language plpgsql set search_path='' as $$
declare root public.product_experiments%rowtype; authority public.product_experiments%rowtype; authority_id uuid;
  chain_ids uuid[]; known bigint; pending bigint; uncertain boolean;
begin
  select * into strict root from public.product_experiments where id=p_root_id and discovery_version='pod-discovery-2.0' and parent_discovery_id is null and candidate_id is null;
  authority_id:=(root.variables->>'budgetAuthorityRootId')::uuid;
  if authority_id is null then raise exception 'V2 research requires an immutable original budget-authority root.'; end if;
  if p_lock_authority then
    select * into strict authority from public.product_experiments where id=authority_id and business_id=root.business_id and discovery_version='pod-discovery-2.0' and parent_discovery_id is null and candidate_id is null for update;
  else
    select * into strict authority from public.product_experiments where id=authority_id and business_id=root.business_id and discovery_version='pod-discovery-2.0' and parent_discovery_id is null and candidate_id is null;
  end if;
  if authority.variables->>'budgetAuthorityRootId' is distinct from authority.id::text or
    coalesce(authority.variables->'ownerKickoff'->'followUpBasis','null'::jsonb)<>'null'::jsonb or
    root.variables->'intent'->'limits'->'maximumMicrousd' is distinct from authority.variables->'intent'->'limits'->'maximumMicrousd' or
    root.variables->>'semanticGoalHash' is distinct from authority.variables->>'semanticGoalHash' then raise exception 'A follow-up cannot change the original semantic goal or its approved allowance.'; end if;
  -- The immutable parent path must actually reach that original root. A budget
  -- marker alone cannot relabel another goal, orphan a round or create a cycle.
  if not exists(with recursive lineage as (
    select e.id,e.variables, array[e.id] path from public.product_experiments e where e.id=root.id
    union all
    select p.id,p.variables,l.path||p.id from lineage l join public.product_experiments p
      on p.id=(l.variables->'ownerKickoff'->'followUpBasis'->>'rootId')::uuid and p.business_id=root.business_id and p.discovery_version='pod-discovery-2.0' and p.parent_discovery_id is null and p.candidate_id is null
      and p.variables->>'budgetAuthorityRootId'=authority.id::text where not(p.id=any(l.path)))
    select 1 from lineage where id=authority.id) then raise exception 'Follow-up does not descend from its declared original budget authority.'; end if;
  select array_agg(e.id order by e.id) into chain_ids from public.product_experiments e where e.business_id=root.business_id and e.discovery_version='pod-discovery-2.0' and
    e.parent_discovery_id is null and e.candidate_id is null and e.variables->>'budgetAuthorityRootId'=authority.id::text;
  select coalesce(sum(case when settled.actual is not null then settled.actual else 0 end),0),
    coalesce(sum(case when settled.actual is null then cr.reserved_microusd else 0 end),0),coalesce(bool_or(settled.actual is null),false)
    into known,pending,uncertain from public.product_research_cost_reservations cr
    left join lateral (select max(cs.reported_microusd) actual from public.product_research_cost_settlements cs where cs.reservation_id=cr.id and cs.reported_microusd is not null and cs.provider_request_id is not null) settled on true
    where cr.experiment_id=any(chain_ids) and cr.business_id=root.business_id;
  return jsonb_build_object('authorityRootId',authority.id,'businessId',root.business_id,'chainRootIds',to_jsonb(chain_ids),
    'maximumMicrousd',authority.variables->'intent'->'limits'->'maximumMicrousd','knownActualMicrousd',known,'pendingExposureMicrousd',pending,
    'committedMicrousd',known+pending,'hasUncertainCosts',uncertain,'remainingMicrousd',greatest(0,(authority.variables->'intent'->'limits'->>'maximumMicrousd')::bigint-known-pending),
    'accounting','known_final_actual_plus_pending_reserved_exposure');
end; $$;
revoke all on function private.stage13v2_budget_authority(uuid,boolean) from public,anon,authenticated,service_role;

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
      if new.variables->>'budgetAuthorityRootId' is null then raise exception 'The initial budget authority must be immutable on every v2 root.'; end if;
      if new.variables->>'budgetAuthorityRootId'<>new.id::text then
        select * into parent from public.product_experiments where id=(new.variables->'ownerKickoff'->'followUpBasis'->>'rootId')::uuid and business_id=new.business_id and discovery_version='pod-discovery-2.0' and parent_discovery_id is null and candidate_id is null;
        if parent.id is null or parent.variables->>'budgetAuthorityRootId' is distinct from new.variables->>'budgetAuthorityRootId' or
          parent.variables->'intent'->'limits'->'maximumMicrousd' is distinct from new.variables->'intent'->'limits'->'maximumMicrousd' or
          parent.variables->>'semanticGoalHash' is distinct from new.variables->>'semanticGoalHash' then raise exception 'Follow-up cannot mint or relabel budget authority.'; end if;
      elsif coalesce(new.variables->'ownerKickoff'->'followUpBasis','null'::jsonb)<>'null'::jsonb then raise exception 'An initial budget root cannot also claim a prior round.';
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


create or replace function private.stage13v2_validate_persisted(p_experiment_id uuid,p_require_completed boolean default true)
returns jsonb language plpgsql set search_path='' as $$
declare e public.product_experiments%rowtype; root public.product_experiments%rowtype; r public.workflow_runs%rowtype;
  intent jsonb; universe jsonb; limits jsonb; quote jsonb; item jsonb; field text; expected_keys text[]; maximum integer; collections integer; committed bigint;
  chain_scope jsonb;
  has_uncertain boolean; owner_id uuid; root_release jsonb;
  terminal_context jsonb; review_phase jsonb; strategy_phase jsonb; current_phase jsonb; dossier jsonb; strategy jsonb; review jsonb;
  phase_stage public.workflow_stage_runs%rowtype; phase_task public.task_contracts%rowtype; phase_worker public.worker_runs%rowtype; phase_artifact public.artifacts%rowtype;
  phase_key text; call_key text; expected_model text; expected_worker text; phase_receipt jsonb; source_value jsonb; source_url text; ref jsonb;
  evidence_pool jsonb; candidate_keys jsonb; binding_hash text; ordinal integer; required text[]; reference_lists jsonb; reference_list jsonb; prose_rules jsonb; required_questions jsonb;
  market jsonb; candidate_value jsonb; identity_value jsonb; dimension_value jsonb; reviewed_dimension jsonb; fact jsonb; uncertainty jsonb;
  recommendation jsonb; selected_candidate jsonb; selected_identity jsonb; test_plan jsonb; merged_uncertainties jsonb; alternative_count integer;
  is_market boolean; known_failure boolean; observed_market_basis boolean;
  dimensions text[]:=array['demand','competition','differentiation','estimated_margin','creative_opportunity','seasonality','production_complexity','policy_ip_risk','marketing_potential'];
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
  chain_scope:=private.stage13v2_budget_authority(root.id,false);
  committed:=(chain_scope->>'committedMicrousd')::bigint;
  has_uncertain:=(chain_scope->>'hasUncertainCosts')::boolean;
  if (chain_scope->>'maximumMicrousd')::bigint<>maximum then raise exception 'Research cap differs from the original goal authority.'; end if;
  if p_require_completed is distinct from false then
    if root.status not in ('researching','completed') or r.status not in ('running','completed') or root.source_artifact_id is null or
      exists(select 1 from public.workflow_stage_runs where workflow_run_id=r.id and business_id=r.business_id and status<>'completed') or
      (select count(*) from public.workflow_stage_runs where workflow_run_id=r.id and business_id=r.business_id)<>collections+3 or has_uncertain or committed>maximum then
      raise exception 'Terminal discovery requires every declared phase, known charges and an unexceeded root envelope.';
    end if;
    if (select count(*) from public.product_research_cost_reservations where experiment_id=root.id)<>cardinality(expected_keys) or
      exists(select 1 from unnest(expected_keys) key where not exists(select 1 from public.product_research_cost_reservations cr
        where cr.experiment_id=root.id and cr.workflow_run_id=r.id and cr.business_id=r.business_id and cr.attempt_key=key and cr.estimate->>'version'='discovery-estimate-2.0' and cr.estimate->>'intentId'=root.id::text and cr.estimate->>'policyHash'=root.variables->>'policyHash')) then
      raise exception 'Terminal discovery must retain the complete exact finite call ledger.';
    end if;
    terminal_context:=private.stage13v2_runtime_context(r.id,'review');
    review_phase:=terminal_context->'discoveryPhase'; dossier:=review_phase->'dossier';
    strategy_phase:=private.stage13v2_runtime_context(r.id,'strategy')->'discoveryPhase';
    select content into strict strategy from public.artifacts where id=private.stage4_deterministic_uuid('pack:output:'||r.id||':strategy') and business_id=r.business_id and workflow_run_id=r.id and artifact_type='worker.output';
    select content into strict review from public.artifacts where id=private.stage4_deterministic_uuid('pack:output:'||r.id||':review') and business_id=r.business_id and workflow_run_id=r.id and artifact_type='worker.output';
    if root.evidence_pack is distinct from jsonb_build_object('version','pod-discovery-2.0','intentId',root.id,'dossierArtifactId',root.source_artifact_id,
      'strategyArtifactId',private.stage4_deterministic_uuid('pack:output:'||r.id||':strategy'),'reviewArtifactId',private.stage4_deterministic_uuid('pack:output:'||r.id||':review')) then raise exception 'The root dossier/phase descriptor changed.'; end if;
    -- Validate every model phase against the actual completed task, artifact and
    -- immutable settlement. Provider identity is never taken only from output.
    for phase_key in select stage_key from public.workflow_stage_runs where workflow_run_id=r.id order by sequence loop
      select * into strict phase_stage from public.workflow_stage_runs where workflow_run_id=r.id and business_id=r.business_id and stage_key=phase_key and attempt=1 and status='completed';
      select * into strict phase_artifact from public.artifacts where id=private.stage4_deterministic_uuid('pack:output:'||r.id||':'||phase_key) and workflow_run_id=r.id and business_id=r.business_id and artifact_type='worker.output';
      select * into strict phase_task from public.task_contracts where id=private.stage4_deterministic_uuid('pack:task:'||r.id||':'||phase_key) and workflow_stage_run_id=phase_stage.id and workflow_run_id=r.id and business_id=r.business_id and status='completed';
      select * into strict phase_worker from public.worker_runs where id=private.stage4_deterministic_uuid('pack:worker:'||r.id||':'||phase_key) and task_contract_id=phase_task.id and worker_definition_id=phase_task.worker_definition_id and workflow_run_id=r.id and business_id=r.business_id and status='completed';
      phase_receipt:=phase_artifact.metadata->'receipt'; call_key:=(case when phase_key like 'research%' then 'select:'||right(phase_key,1) else phase_key||':1' end);
      expected_model:=(case when phase_key='review' then 'anthropic/claude-haiku-4.5' else 'openai/gpt-5.6-luna' end);
      expected_worker:='product.discovery-v2.'||(case when phase_key like 'research%' then 'research' else phase_key end);
      if phase_artifact.task_contract_id is distinct from phase_task.id or phase_artifact.metadata->>'stageKey' is distinct from phase_key or
        phase_artifact.content is distinct from phase_stage.output or phase_artifact.content is distinct from phase_worker.output or
        phase_worker.execution_metadata->'receipt' is distinct from phase_receipt or phase_worker.execution_metadata->>'outputArtifactId' is distinct from phase_artifact.id::text or
        phase_receipt->>'receiptVersion' is distinct from '1.0' or phase_receipt->>'taskContractId' is distinct from phase_task.id::text or
        phase_receipt->'inputArtifactIds' is distinct from to_jsonb(phase_task.input_artifact_ids) or
        not(private.stage4_deterministic_uuid('pack:input:'||r.id||':'||phase_key)=any(phase_task.input_artifact_ids)) or
        phase_receipt->>'workerKey' is distinct from expected_worker or phase_receipt->>'workerVersion' is distinct from '1.0.0' or
        phase_receipt->>'packKey' is distinct from 'worker.product-discovery-v2-'||(case when phase_key like 'research%' then 'research' else phase_key end) or phase_receipt->>'packVersion' is distinct from '1.0.0' or
        phase_receipt->>'executionMode' is distinct from (case when phase_key like 'research%' then 'web.research' else 'discovery.'||phase_key end) or
        phase_receipt->>'stopReason' is distinct from (case when phase_key like 'research%' then 'evidence_collected' else 'bounded_discovery_phase_completed' end) or
        phase_receipt->>'provider' is distinct from 'openrouter' or phase_receipt->>'actualProviderModelId' is distinct from expected_model or
        phase_receipt->'primaryOnly' is distinct from 'true'::jsonb or phase_receipt->'mockProvider' is distinct from 'false'::jsonb or phase_receipt->'outputValidated' is distinct from 'true'::jsonb or
        phase_receipt->>'intentId' is distinct from root.id::text or phase_receipt->>'callKey' is distinct from call_key or
        coalesce(length(phase_receipt->>'providerRequestId'),0) not between 3 and 240 or phase_receipt->>'providerRequestId' ~* '(mock|fixture|simulation)' or
        not exists(select 1 from public.worker_definitions wd join public.packs p on p.id=wd.pack_id where wd.id=phase_worker.worker_definition_id and wd.worker_key=expected_worker and wd.version='1.0.0' and p.pack_key=phase_receipt->>'packKey' and p.version='1.0.0') or
        not exists(select 1 from public.product_research_cost_reservations cr join public.product_research_cost_settlements cs on cs.reservation_id=cr.id
          where cr.experiment_id=root.id and cr.attempt_key=call_key and cs.reported_microusd is not null and cs.provider_request_id=phase_receipt->>'providerRequestId') then
        raise exception 'Every terminal phase needs its actual versioned worker, scoped input and settled primary-call receipt.';
      end if;
      if phase_key in ('strategy','review') then
        current_phase:=(case phase_key when 'strategy' then strategy_phase else review_phase end);
        evidence_pool:='[]'; ordinal:=0;
        for ref in select value from jsonb_array_elements(current_phase->'evidenceReferences') order by private.stage14_hash(value) loop
          ordinal:=ordinal+1;
          select source.value into strict source_value from jsonb_array_elements(current_phase->'validation'->'packs') p
            cross join lateral jsonb_array_elements(p->'evidencePack'->'sources') source where p->>'artifactId'=ref->>'artifactId' and source.value->>'id'=ref->>'sourceId';
          evidence_pool:=evidence_pool||jsonb_build_array(jsonb_build_object('key','E'||ordinal,'reference',ref,
            'quote',substring(source_value->>'excerpt' from (ref->>'start')::integer+1 for (ref->>'end')::integer-(ref->>'start')::integer),
            'url',source_value->>'url','retrievedAt',source_value->>'retrievedAt','expiresAt',source_value->>'retrievalExpiresAt'));
        end loop;
        select jsonb_agg(jsonb_build_object('key','C'||n,'candidateId',x->>'id') order by n) into candidate_keys from
          (select x,row_number() over(order by x->>'id') n from jsonb_array_elements(dossier->'shortlist') x) q;
        binding_hash:=private.stage14_hash(jsonb_build_object('intent',intent,'dossier',dossier,'evidencePool',evidence_pool,'candidateKeys',candidate_keys,
          'knowledgePinHash',private.stage14_hash(current_phase->'validation'->'knowledge'),'committedMicrousd',current_phase->'validation'->'committedMicrousd',
          'ownerRightsConfirmedCandidateIds','[]'::jsonb,'sellerBankCountry',null));
        if phase_receipt->>'dossierHash' is distinct from private.stage14_hash(dossier) or phase_receipt->>'contextBindingHash' is distinct from binding_hash or
          phase_receipt->>'outputHash' is distinct from private.stage14_hash(phase_artifact.content) or
          phase_artifact.content->'execution' is distinct from jsonb_build_object('modelId',expected_model,'providerRequestId',phase_receipt->>'providerRequestId','primaryOnly',true) then
          raise exception 'Strategy/review output is not bound to its exact immutable prepared context and actual model.'; end if;
      end if;
    end loop;
    if strategy->'execution'->>'providerRequestId'=review->'execution'->>'providerRequestId' or strategy->'execution'->>'modelId'=review->'execution'->>'modelId' then raise exception 'Independent review requires a different actual model and request.'; end if;
    -- Closed object fields prohibit hidden numeric scoring and injected authority.
    required:=array['version','intentId','dossierHash','execution','marketComparisons','candidates','recommendation','testPlan','missingQuestions','publicationAllowed','commerceAllowed'];
    if jsonb_typeof(strategy) is distinct from 'object' or not(strategy ?& required) or strategy-required<>'{}'::jsonb or octet_length(strategy::text)>32768 or
      strategy->>'version' is distinct from 'pod-discovery-2.0' or strategy->>'intentId' is distinct from root.id::text or strategy->>'dossierHash' is distinct from private.stage14_hash(dossier) or
      strategy->'publicationAllowed' is distinct from 'false'::jsonb or strategy->'commerceAllowed' is distinct from 'false'::jsonb then raise exception 'Invalid non-authorizing qualitative strategist snapshot.'; end if;
    required:=array['version','intentId','dossierHash','assessmentHash','execution','marketCountryCode','candidateId','outcome','sufficiencyRationale','dimensions','checks','executionPrerequisites','additionalUncertainties','missingQuestions','publicationAllowed','commerceAllowed'];
    if jsonb_typeof(review) is distinct from 'object' or not(review ?& required) or review-required<>'{}'::jsonb or octet_length(review::text)>16384 or
      review->>'version' is distinct from 'pod-discovery-2.0' or review->>'intentId' is distinct from root.id::text or review->>'dossierHash' is distinct from private.stage14_hash(dossier) or
      review->>'assessmentHash' is distinct from private.stage14_hash(strategy) or review->'publicationAllowed' is distinct from 'false'::jsonb or review->'commerceAllowed' is distinct from 'false'::jsonb or
      review->'executionPrerequisites' is distinct from '{"ownerCreativeApproval":"required","freshBudgetApproval":"required","conceptSpecificIpScreen":"required","printValidation":"required"}'::jsonb or
      coalesce(review->>'outcome','') not in ('TEST','REJECT','NEEDS_MORE_EVIDENCE') or jsonb_typeof(review->'sufficiencyRationale') is distinct from 'string' or length(btrim(review->>'sufficiencyRationale')) not between 60 and 1600 then raise exception 'Invalid independent qualitative reviewer snapshot.'; end if;
    if jsonb_typeof(strategy->'marketComparisons') is distinct from 'array' or jsonb_array_length(strategy->'marketComparisons')<>jsonb_array_length(universe->'markets') or
      (select count(distinct x->>'countryCode') from jsonb_array_elements(strategy->'marketComparisons') x)<>jsonb_array_length(universe->'markets') then raise exception 'Every geographic alternative must be compared exactly once.'; end if;
    reference_lists:='[]'; prose_rules:='[]'; required_questions:='[]';
    for market in select value from jsonb_array_elements(strategy->'marketComparisons') loop
      required:=array['countryCode','currency','assessment','evidenceRefs','assumptions','limitations','sellerBankCountry','feeScenarios'];
      if not(market ?& required) or market-required<>'{}'::jsonb or not exists(select 1 from jsonb_array_elements(universe->'markets') x where x->>'countryCode'=market->>'countryCode' and x->>'currency'=market->>'currency') or
        market->'sellerBankCountry' is distinct from 'null'::jsonb or jsonb_typeof(market->'feeScenarios') is distinct from 'array' or jsonb_array_length(market->'feeScenarios') not between 1 and 4 then raise exception 'Geography/currency and unknown seller bank country must remain explicit.'; end if;
      prose_rules:=prose_rules||jsonb_build_array(jsonb_build_object('value',market->'assessment','min',40,'max',1200));
      reference_lists:=reference_lists||jsonb_build_array(market->'evidenceRefs');
      foreach field in array array['assumptions','limitations'] loop
        if jsonb_typeof(market->field) is distinct from 'array' or jsonb_array_length(market->field) not between (case field when 'limitations' then 1 else 0 end) and 8 or
          (select count(distinct value) from jsonb_array_elements(market->field))<>jsonb_array_length(market->field) then raise exception 'Bounded, distinct geographic assumptions and limitations are required.'; end if;
        for item in select value from jsonb_array_elements(market->field) loop prose_rules:=prose_rules||jsonb_build_array(jsonb_build_object('value',item,'min',15,'max',600)); end loop;
      end loop;
      for item in select value from jsonb_array_elements(market->'feeScenarios') loop
        required:=array['sellerBankCountry','hypothetical','explanation','evidenceRefs'];
        if not(item ?& required) or item-required<>'{}'::jsonb or coalesce(item->>'sellerBankCountry','') !~ '^[A-Z]{2}$' or item->'hypothetical' is distinct from 'true'::jsonb then raise exception 'Fee scenarios cannot be promoted into discovered bank facts.'; end if;
        prose_rules:=prose_rules||jsonb_build_array(jsonb_build_object('value',item->'explanation','min',30,'max',1200)); reference_lists:=reference_lists||jsonb_build_array(item->'evidenceRefs');
      end loop;
    end loop;
    if jsonb_typeof(strategy->'candidates') is distinct from 'array' or jsonb_array_length(strategy->'candidates')<>jsonb_array_length(dossier->'shortlist') or
      (select count(distinct x->>'candidateId') from jsonb_array_elements(strategy->'candidates') x)<>jsonb_array_length(dossier->'shortlist') then raise exception 'Every immutable candidate must receive its own complete comparison.'; end if;
    for candidate_value in select value from jsonb_array_elements(strategy->'candidates') loop
      select value into identity_value from jsonb_array_elements(dossier->'shortlist') where value->>'id'=candidate_value->>'candidateId';
      required:=array['candidateId','identityHash','dimensions'];
      if identity_value is null or not(candidate_value ?& required) or candidate_value-required<>'{}'::jsonb or candidate_value->>'identityHash' is distinct from private.stage14_hash(identity_value) or
        jsonb_typeof(candidate_value->'dimensions') is distinct from 'array' or jsonb_array_length(candidate_value->'dimensions')<>9 or
        exists(select 1 from unnest(dimensions) dimension_name where (select count(*) from jsonb_array_elements(candidate_value->'dimensions') x where x->>'dimension'=dimension_name)<>1) then raise exception 'Candidate identity and all nine distinct dimensions are required.'; end if;
      for dimension_value in select value from jsonb_array_elements(candidate_value->'dimensions') loop
        required:=array['dimension','finding','evidenceStrength','facts','rationale','uncertainties','hardFailure'];
        if not(dimension_value ?& required) or dimension_value-required<>'{}'::jsonb or coalesce(dimension_value->>'finding','') not in ('supported','uncertain','unfavorable') or
          coalesce(dimension_value->>'evidenceStrength','') not in ('direct','adjacent','guidance','none') or jsonb_typeof(dimension_value->'hardFailure') is distinct from 'boolean' or
          jsonb_typeof(dimension_value->'facts') is distinct from 'array' or jsonb_array_length(dimension_value->'facts') not between 0 and 3 or
          jsonb_typeof(dimension_value->'uncertainties') is distinct from 'array' or jsonb_array_length(dimension_value->'uncertainties') not between 0 and 2 then raise exception 'Invalid closed qualitative dimension.'; end if;
        if ((dimension_value->>'evidenceStrength'='none')<>(jsonb_array_length(dimension_value->'facts')=0)) or
          (dimension_value->>'finding'<>'uncertain' and jsonb_array_length(dimension_value->'facts')=0) or
          ((dimension_value->>'finding'='uncertain' or dimension_value->>'evidenceStrength' in ('none','adjacent')) and jsonb_array_length(dimension_value->'uncertainties')=0) then raise exception 'Unsupported or adjacent findings must preserve exact uncertainty.'; end if;
        prose_rules:=prose_rules||jsonb_build_array(jsonb_build_object('value',dimension_value->'rationale','min',30,'max',450));
        is_market:=dimension_value->>'dimension' in ('demand','competition','seasonality','marketing_potential');
        if is_market and dimension_value->>'finding'='supported' and dimension_value->>'evidenceStrength' in ('guidance','none') then raise exception 'Generic guidance cannot substantiate a supported market finding.'; end if;
        if dimension_value->'hardFailure'='true'::jsonb and (dimension_value->>'dimension' not in ('policy_ip_risk','production_complexity') or dimension_value->>'finding'<>'unfavorable' or dimension_value->>'evidenceStrength'<>'direct') then raise exception 'Hard failure requires direct policy/IP or production support.'; end if;
        if dimension_value->>'dimension' in ('policy_ip_risk','production_complexity') and dimension_value->>'finding'='unfavorable' and dimension_value->'hardFailure'<>'true'::jsonb then raise exception 'Known policy/IP and production failures cannot be waived.'; end if;
        for fact in select value from jsonb_array_elements(dimension_value->'facts') loop
          required:=array['reference','relevance']; if not(fact ?& required) or fact-required<>'{}'::jsonb then raise exception 'A source fact requires only its exact reference and relevance.'; end if;
          prose_rules:=prose_rules||jsonb_build_array(jsonb_build_object('value',fact->'relevance','min',20,'max',240)); reference_lists:=reference_lists||jsonb_build_array(jsonb_build_array(fact->'reference'));
          select source.value->>'url' into source_url from jsonb_array_elements(review_phase->'validation'->'packs') p cross join lateral jsonb_array_elements(p->'evidencePack'->'sources') source
            where p->>'artifactId'=fact->'reference'->>'artifactId' and source.value->>'id'=fact->'reference'->>'sourceId';
          if is_market and dimension_value->>'evidenceStrength'<>'guidance' and (source_url ~* '^https://(help|support)\.' or source_url ~* '^https://[^/]+/(seller-handbook|legal|help|blog)(/|$)') then raise exception 'Policy pages are not observed buyer interest.'; end if;
        end loop;
        for uncertainty in select value from jsonb_array_elements(dimension_value->'uncertainties') loop
          required:=array['question','blockingForTest','reason']; if not(uncertainty ?& required) or uncertainty-required<>'{}'::jsonb or jsonb_typeof(uncertainty->'blockingForTest') is distinct from 'boolean' then raise exception 'Each missing fact needs a classified test impact.'; end if;
          prose_rules:=prose_rules||jsonb_build_array(jsonb_build_object('value',uncertainty->'question','min',15,'max',240),jsonb_build_object('value',uncertainty->'reason','min',30,'max',300));
          required_questions:=required_questions||jsonb_build_array(uncertainty->'question');
        end loop;
      end loop;
    end loop;
    recommendation:=strategy->'recommendation';
    required:=array['proposedOutcome','marketCountryCode','candidateId','rationale','alternatives'];
    if jsonb_typeof(recommendation) is distinct from 'object' or not(recommendation ?& required) or recommendation-required<>'{}'::jsonb or
      coalesce(recommendation->>'proposedOutcome','') not in ('TEST','REJECT','NEEDS_MORE_EVIDENCE') or
      jsonb_typeof(recommendation->'candidateId') not in ('null','string') or jsonb_typeof(recommendation->'marketCountryCode') not in ('null','string') or
      (recommendation->'marketCountryCode'<>'null'::jsonb and not exists(select 1 from jsonb_array_elements(universe->'markets') x where x->>'countryCode'=recommendation->>'marketCountryCode')) or
      (recommendation->'candidateId'<>'null'::jsonb and recommendation->'marketCountryCode'='null'::jsonb) then raise exception 'Recommendation must select within the compared geography and candidate universe.'; end if;
    selected_candidate:=null; selected_identity:=null;
    select value into selected_candidate from jsonb_array_elements(strategy->'candidates') where value->>'candidateId'=recommendation->>'candidateId';
    select value into selected_identity from jsonb_array_elements(dossier->'shortlist') where value->>'id'=recommendation->>'candidateId';
    if recommendation->'candidateId'<>'null'::jsonb and selected_candidate is null then raise exception 'Recommended candidate is outside the evaluated shortlist.'; end if;
    prose_rules:=prose_rules||jsonb_build_array(jsonb_build_object('value',recommendation->'rationale','min',40,'max',1200));
    alternative_count:=jsonb_array_length(dossier->'shortlist')-(case when selected_candidate is null then 0 else 1 end);
    if jsonb_typeof(recommendation->'alternatives') is distinct from 'array' or jsonb_array_length(recommendation->'alternatives')<>alternative_count or
      (select count(distinct x->>'candidateId') from jsonb_array_elements(recommendation->'alternatives') x)<>alternative_count then raise exception 'Every unselected alternative needs its own explicit tradeoff.'; end if;
    for item in select value from jsonb_array_elements(recommendation->'alternatives') loop
      required:=array['candidateId','rationale','evidenceRefs'];
      if not(item ?& required) or item-required<>'{}'::jsonb or item->>'candidateId'=recommendation->>'candidateId' or
        not exists(select 1 from jsonb_array_elements(dossier->'shortlist') x where x->>'id'=item->>'candidateId') then raise exception 'Alternative explanation changed its candidate identity.'; end if;
      prose_rules:=prose_rules||jsonb_build_array(jsonb_build_object('value',item->'rationale','min',30,'max',1200)); reference_lists:=reference_lists||jsonb_build_array(item->'evidenceRefs');
    end loop;
    if jsonb_typeof(strategy->'missingQuestions') is distinct from 'array' or jsonb_array_length(strategy->'missingQuestions')>81 or
      (select count(distinct value) from jsonb_array_elements(strategy->'missingQuestions'))<>jsonb_array_length(strategy->'missingQuestions') or
      exists(select 1 from jsonb_array_elements(required_questions) q where not((strategy->'missingQuestions') @> jsonb_build_array(q))) or
      exists(select 1 from jsonb_array_elements(strategy->'missingQuestions') q where not(required_questions @> jsonb_build_array(q))) then raise exception 'Strategist dropped or invented an unclassified missing question.'; end if;
    test_plan:=strategy->'testPlan';
    if recommendation->>'proposedOutcome'<>'TEST' and test_plan is distinct from 'null'::jsonb then raise exception 'A test plan requires an explicit strategist TEST proposal.'; end if;
    if recommendation->>'proposedOutcome'='TEST' then
      required:=array['scope','name','hypothesis','deliverable','successCriteria','failureCriteria','stopRule','maximumMicrousd','maximumGenerations','evidenceRefs','budgetStatus','generationAuthorized','spendingAuthorized','publicationAllowed','commerceAllowed'];
      if selected_candidate is null or jsonb_typeof(test_plan) is distinct from 'object' or not(test_plan ?& required) or test_plan-required<>'{}'::jsonb or
        test_plan->>'scope' is distinct from 'private_original_design_test' or test_plan->>'budgetStatus' is distinct from 'proposal_only' or
        test_plan->'generationAuthorized' is distinct from 'false'::jsonb or test_plan->'spendingAuthorized' is distinct from 'false'::jsonb or
        test_plan->'publicationAllowed' is distinct from 'false'::jsonb or test_plan->'commerceAllowed' is distinct from 'false'::jsonb or
        jsonb_typeof(test_plan->'maximumMicrousd') is distinct from 'number' or (test_plan->>'maximumMicrousd')::numeric<>trunc((test_plan->>'maximumMicrousd')::numeric) or
        (test_plan->>'maximumMicrousd')::numeric not between 1 and 1000000 or coalesce(test_plan->'maximumGenerations','null') not in ('1'::jsonb,'2'::jsonb) or
        (test_plan->>'maximumGenerations')::integer>(limits->>'maximumGenerations')::integer or
        jsonb_typeof(test_plan->'evidenceRefs') is distinct from 'array' or jsonb_array_length(test_plan->'evidenceRefs')<1 then raise exception 'TEST needs a bounded non-authorizing learning proposal and cited candidate evidence.'; end if;
      prose_rules:=prose_rules||jsonb_build_array(jsonb_build_object('value',test_plan->'name','min',10,'max',160),jsonb_build_object('value',test_plan->'hypothesis','min',40,'max',1200),
        jsonb_build_object('value',test_plan->'deliverable','min',30,'max',1200),jsonb_build_object('value',test_plan->'stopRule','min',40,'max',1200));
      foreach field in array array['successCriteria','failureCriteria'] loop
        if jsonb_typeof(test_plan->field) is distinct from 'array' or jsonb_array_length(test_plan->field) not between 1 and 5 or
          (select count(distinct value) from jsonb_array_elements(test_plan->field))<>jsonb_array_length(test_plan->field) then raise exception 'A learning test needs distinct bounded success and failure criteria.'; end if;
        for item in select value from jsonb_array_elements(test_plan->field) loop prose_rules:=prose_rules||jsonb_build_array(jsonb_build_object('value',item,'min',20,'max',600)); end loop;
      end loop;
      reference_lists:=reference_lists||jsonb_build_array(test_plan->'evidenceRefs');
      if exists(select 1 from jsonb_array_elements(test_plan->'evidenceRefs') cited_ref where not exists(
        select 1 from jsonb_array_elements(selected_candidate->'dimensions') d cross join lateral jsonb_array_elements(d->'facts') f where f->'reference'=cited_ref)) then raise exception 'Test evidence must belong to the selected candidate assessment.'; end if;
    end if;
    if review->'candidateId' is distinct from recommendation->'candidateId' or review->'marketCountryCode' is distinct from recommendation->'marketCountryCode' then raise exception 'Reviewer cannot replace the assessed candidate or selling geography.'; end if;
    if jsonb_typeof(review->'checks') is distinct from 'array' or jsonb_array_length(review->'checks')<>5 or
      exists(select 1 from unnest(array['source_support','alternative_comparison','test_learnability','uncertainty_handling','hard_gates']) key where
        (select count(*) from jsonb_array_elements(review->'checks') c where c->>'check'=key)<>1) then raise exception 'All five independent substantive review checks are required.'; end if;
    for item in select value from jsonb_array_elements(review->'checks') loop
      required:=array['check','outcome','rationale']; if not(item ?& required) or item-required<>'{}'::jsonb or coalesce(item->>'outcome','') not in ('PASS','FAIL') then raise exception 'Invalid independent review check.'; end if;
      prose_rules:=prose_rules||jsonb_build_array(jsonb_build_object('value',item->'rationale','min',30,'max',1200));
    end loop;
    if jsonb_typeof(review->'additionalUncertainties') is distinct from 'array' or jsonb_array_length(review->'additionalUncertainties')>18 then raise exception 'Reviewer-added uncertainty must be bounded and explicit.'; end if;
    for uncertainty in select value from jsonb_array_elements(review->'additionalUncertainties') loop
      required:=array['dimension','question','blockingForTest','reason'];
      if not(uncertainty ?& required) or uncertainty-required<>'{}'::jsonb or not(uncertainty->>'dimension'=any(dimensions)) or jsonb_typeof(uncertainty->'blockingForTest') is distinct from 'boolean' then raise exception 'Reviewer uncertainty needs its dimension and test impact.'; end if;
      prose_rules:=prose_rules||jsonb_build_array(jsonb_build_object('value',uncertainty->'question','min',15,'max',240),jsonb_build_object('value',uncertainty->'reason','min',30,'max',300));
      required_questions:=required_questions||jsonb_build_array(uncertainty->'question');
    end loop;
    if jsonb_typeof(review->'missingQuestions') is distinct from 'array' or jsonb_array_length(review->'missingQuestions')>81 or
      (select count(distinct value) from jsonb_array_elements(review->'missingQuestions'))<>jsonb_array_length(review->'missingQuestions') or
      exists(select 1 from jsonb_array_elements(required_questions) q where not((review->'missingQuestions') @> jsonb_build_array(q))) or
      exists(select 1 from jsonb_array_elements(review->'missingQuestions') q where not(required_questions @> jsonb_build_array(q))) then raise exception 'Review must preserve the exact union of strategist and reviewer missing questions.'; end if;
    if jsonb_typeof(review->'dimensions') is distinct from 'array' then raise exception 'Reviewer dimensions must be an explicit array.'; end if;
    if selected_candidate is null then
      if jsonb_array_length(review->'dimensions')<>0 or review->>'outcome'='TEST' then raise exception 'No-candidate discovery cannot become a creative test.'; end if;
    else
      if jsonb_array_length(review->'dimensions')<>9 or exists(select 1 from unnest(dimensions) dimension_name where
        (select count(*) from jsonb_array_elements(review->'dimensions') x where x->>'dimension'=dimension_name)<>1) then raise exception 'Reviewer must independently address all nine selected-candidate dimensions.'; end if;
      for reviewed_dimension in select value from jsonb_array_elements(review->'dimensions') loop
        required:=array['dimension','verdict','rationale','evidenceRefs'];
        if not(reviewed_dimension ?& required) or reviewed_dimension-required<>'{}'::jsonb or coalesce(reviewed_dimension->>'verdict','') not in ('sufficient_for_test','nonblocking_unknown','blocking','known_failure') then raise exception 'Invalid reviewed qualitative dimension.'; end if;
        select value into strict dimension_value from jsonb_array_elements(selected_candidate->'dimensions') where value->>'dimension'=reviewed_dimension->>'dimension';
        prose_rules:=prose_rules||jsonb_build_array(jsonb_build_object('value',reviewed_dimension->'rationale','min',30,'max',1200)); reference_lists:=reference_lists||jsonb_build_array(reviewed_dimension->'evidenceRefs');
        if jsonb_typeof(reviewed_dimension->'evidenceRefs') is distinct from 'array' or exists(select 1 from jsonb_array_elements(reviewed_dimension->'evidenceRefs') cited_ref where
          not exists(select 1 from jsonb_array_elements(dimension_value->'facts') f where f->'reference'=cited_ref)) then raise exception 'Review citations must support this exact candidate dimension.'; end if;
        select coalesce(jsonb_agg(x),'[]') into merged_uncertainties from (
          select value x from jsonb_array_elements(dimension_value->'uncertainties') union all
          select value x from jsonb_array_elements(review->'additionalUncertainties') where value->>'dimension'=reviewed_dimension->>'dimension') u;
        if dimension_value->'hardFailure'='true'::jsonb and reviewed_dimension->>'verdict'<>'known_failure' then raise exception 'Reviewer concealed an established hard failure.'; end if;
        if exists(select 1 from jsonb_array_elements(merged_uncertainties) u where u->'blockingForTest'='true'::jsonb) and reviewed_dimension->>'verdict' not in ('blocking','known_failure') then raise exception 'Blocking uncertainty from either worker cannot be waived.'; end if;
        if reviewed_dimension->>'verdict'='sufficient_for_test' and (jsonb_array_length(reviewed_dimension->'evidenceRefs')=0 or dimension_value->>'evidenceStrength' in ('none','guidance')) then raise exception 'Weak evidence cannot become sufficient by declaration.'; end if;
        if reviewed_dimension->>'verdict'='nonblocking_unknown' and (jsonb_array_length(merged_uncertainties)=0 or exists(select 1 from jsonb_array_elements(merged_uncertainties) u where u->'blockingForTest'='true'::jsonb)) then raise exception 'Nonblocking unknown needs explicit test-specific implications and no blocking flag.'; end if;
      end loop;
      known_failure:=selected_identity->'originalDesign'<>'true'::jsonb or exists(select 1 from jsonb_array_elements(selected_candidate->'dimensions') d where d->'hardFailure'='true'::jsonb) or
        exists(select 1 from jsonb_array_elements(review->'dimensions') d where d->>'verdict'='known_failure');
      if known_failure and review->>'outcome'<>'REJECT' then raise exception 'Known originality/IP/production failure requires REJECT.'; end if;
      if review->>'outcome'='TEST' then
        if recommendation->>'proposedOutcome'<>'TEST' or test_plan='null'::jsonb or
          exists(select 1 from jsonb_array_elements(review->'checks') c where c->>'outcome'<>'PASS') or
          exists(select 1 from jsonb_array_elements(review->'dimensions') d where d->>'verdict' in ('blocking','known_failure')) or
          exists(select 1 from jsonb_array_elements(review->'additionalUncertainties') u where u->'blockingForTest'='true'::jsonb) or
          exists(select 1 from jsonb_array_elements(selected_candidate->'dimensions') d cross join lateral jsonb_array_elements(d->'uncertainties') u where u->'blockingForTest'='true'::jsonb) then raise exception 'TEST cannot auto-convert NME or retain any blocking check or unknown.'; end if;
        if not exists(select 1 from jsonb_array_elements(strategy->'marketComparisons') m where m->>'countryCode'=review->>'marketCountryCode' and jsonb_array_length(m->'evidenceRefs')>0) then raise exception 'The selected geography needs cited comparative support.'; end if;
        observed_market_basis:=false;
        for dimension_value in select value from jsonb_array_elements(selected_candidate->'dimensions') where value->>'dimension' in ('demand','competition','marketing_potential','differentiation') and value->>'evidenceStrength' in ('direct','adjacent') loop
          for fact in select value from jsonb_array_elements(dimension_value->'facts') where (test_plan->'evidenceRefs') @> jsonb_build_array(value->'reference') loop
            select source.value->>'url' into source_url from jsonb_array_elements(review_phase->'validation'->'packs') p cross join lateral jsonb_array_elements(p->'evidencePack'->'sources') source
              where p->>'artifactId'=fact->'reference'->>'artifactId' and source.value->>'id'=fact->'reference'->>'sourceId';
            if source_url is not null and source_url !~* '^https://(help|support)\.' and source_url !~* '^https://[^/]+/(seller-handbook|legal|help|blog)(/|$)' then observed_market_basis:=true; end if;
          end loop;
        end loop;
        if not observed_market_basis then raise exception 'TEST needs relevant observed market evidence for its actual learning hypothesis.'; end if;
      end if;
    end if;
    -- Validate prose and exact citations after collecting each versioned field.
    for item in select value from jsonb_array_elements(prose_rules) loop
      if jsonb_typeof(item->'value') is distinct from 'string' or length(btrim(item->>'value'))<(item->>'min')::integer or length(item->>'value')>(item->>'max')::integer then raise exception 'Specific bounded qualitative reasoning is required.'; end if;
    end loop;
    for reference_list in select value from jsonb_array_elements(reference_lists) loop
      if jsonb_typeof(reference_list) is distinct from 'array' or jsonb_array_length(reference_list)>8 or (select count(distinct value) from jsonb_array_elements(reference_list))<>jsonb_array_length(reference_list) then raise exception 'Evidence reference lists must be bounded and distinct.'; end if;
      for ref in select value from jsonb_array_elements(reference_list) loop
        if not exists(select 1 from jsonb_array_elements(review_phase->'evidenceReferences') x where x=ref) then raise exception 'A citation is not an exact prepared source span with immutable artifact/evidence/source/hash/offset linkage.'; end if;
      end loop;
    end loop;
    if root.status='completed' then
      if not exists(select 1 from public.product_experiments child where child.parent_discovery_id=root.id and child.business_id=root.business_id) or
        (select count(*) from public.product_experiments child where child.parent_discovery_id=root.id and child.business_id=root.business_id)<>jsonb_array_length(dossier->'shortlist') or
        exists(select 1 from jsonb_array_elements(dossier->'shortlist') identity where not exists(select 1 from public.product_experiments child
          where child.id=private.stage4_deterministic_uuid('discovery:v2:child:'||root.id||':'||(identity->>'id')) and child.parent_discovery_id=root.id and child.business_id=root.business_id and child.workflow_run_id=r.id and
            child.candidate_id=(identity->>'id')::uuid and child.variables->'identity'=identity and child.evidence_pack=root.evidence_pack and child.source_artifact_id=root.source_artifact_id and child.status='completed')) or
        (review->'candidateId'<>'null'::jsonb and not exists(select 1 from public.product_decisions d where d.id=private.stage4_deterministic_uuid('discovery:v2:decision:'||root.id||':'||(review->>'candidateId')) and
          d.business_id=root.business_id and d.candidate_id=(review->>'candidateId')::uuid and d.experiment_id=private.stage4_deterministic_uuid('discovery:v2:child:'||root.id||':'||(review->>'candidateId')) and d.assessment=review and d.assessment_fingerprint=private.stage14_hash(review))) then
        raise exception 'Completed recommendation projection differs from its immutable terminal artifacts.';
      end if;
    end if;
    return jsonb_build_object('validationLevel','terminal_recommendation','experimentId',root.id,'intentId',root.id,'businessId',root.business_id,'workflowRunId',r.id,
      'maximumCollections',collections,'maximumMicrousd',maximum,'policyHash',root.variables->>'policyHash','committedMicrousd',committed,'hasUncertainCosts',false,'status',root.status,
      'intent',intent,'budgetQuote',quote,'dossier',dossier,'strategy',strategy,'review',review,'selectedCandidateId',review->'candidateId','selectedMarketCountryCode',review->'marketCountryCode',
      'outcome',review->>'outcome','decisionValidated',true,'productionEligible',false,'generationAuthorized',false,'spendingAuthorized',false,'publicationAllowed',false,'commerceAllowed',false);
  end if;
  return jsonb_build_object('validationLevel','intent_scope_only','experimentId',root.id,'intentId',root.id,'businessId',root.business_id,
    'workflowRunId',r.id,'maximumCollections',collections,'maximumMicrousd',maximum,'policyHash',root.variables->>'policyHash',
    'committedMicrousd',committed,'hasUncertainCosts',has_uncertain,'status',root.status,'intent',intent,'budgetQuote',quote,
    'decisionValidated',false,'productionEligible',false);
end; $$;


create or replace function public.begin_installed_pack_run(p_business_id uuid,p_installation_id uuid,p_workflow_key text,p_input jsonb,p_idempotency_key text,p_launch_nonce uuid,p_runtime_capability text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_install public.installed_packs%rowtype; v_definition public.workflow_definitions%rowtype; v_workflow jsonb; v_id uuid; s jsonb; n integer:=0;
  chain_scope jsonb; authority_id uuid;
  v_pack public.packs%rowtype; prior public.product_experiments%rowtype; prior_artifact public.artifacts%rowtype; prior_run public.workflow_runs%rowtype;
  intent jsonb; kickoff jsonb; basis jsonb; semantic jsonb; prior_review jsonb; prior_pack jsonb; snapshot jsonb; prior_hashes jsonb:='[]';
  semantic_hash text; v_fingerprint text; root_id uuid; prior_id uuid; existing_root_id uuid; prior_source_root uuid;
begin
  if auth.uid() is null or not private.is_business_owner(p_business_id) then raise exception 'Business ownership required.' using errcode='42501'; end if;
  if p_workflow_key in ('product.discovery-v2.one','product.discovery-v2.two') then
    if p_installation_id is not null or p_launch_nonce is null or coalesce(length(p_runtime_capability),0) not between 32 and 512 or
      coalesce(length(btrim(p_idempotency_key)),0) not between 1 and 200 or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>50000 or
      not(p_input ?& array['intent','quote','ownerKickoff','priorArtifactIds']) or p_input-array['intent','quote','ownerKickoff','priorArtifactIds']<>'{}'::jsonb then raise exception 'Invalid bounded discovery launch envelope.'; end if;
    intent:=p_input->'intent'; kickoff:=p_input->'ownerKickoff'; basis:=kickoff->'followUpBasis';
    if jsonb_typeof(kickoff) is distinct from 'object' or not(kickoff ?& array['confirmed','focus','followUpBasis']) or kickoff-array['confirmed','focus','followUpBasis']<>'{}'::jsonb or
      kickoff->'confirmed' is distinct from 'true'::jsonb or jsonb_typeof(kickoff->'focus') is distinct from 'string' or length(btrim(kickoff->>'focus')) not between 20 and 1200 or
      intent->>'businessId' is distinct from p_business_id::text or intent->>'version' is distinct from 'pod-discovery-2.0' or
      jsonb_typeof(p_input->'priorArtifactIds') is distinct from 'array' or jsonb_array_length(p_input->'priorArtifactIds')>4 or
      (select count(distinct value) from jsonb_array_elements(p_input->'priorArtifactIds'))<>jsonb_array_length(p_input->'priorArtifactIds') then raise exception 'Explicit owner kickoff and same-Business intent are required.'; end if;
    root_id:=(intent->>'id')::uuid; authority_id:=root_id;
    -- Serialize the semantic conflict check with other owner launches for this Business.
    perform 1 from public.businesses where id=p_business_id for update;
    semantic:=jsonb_build_object('objective',private.stage13_normalize(intent->>'objective'),
      'productType',intent->'comparisonUniverse'->>'productType','selectionQuestion',private.stage13_normalize(intent->'comparisonUniverse'->>'selectionQuestion'),
      'markets',(select jsonb_agg(x order by x->>'countryCode',x->>'currency') from jsonb_array_elements(intent->'comparisonUniverse'->'markets') x),
      'audiences',(select jsonb_agg(x order by x) from (select distinct private.stage13_normalize(value) x from jsonb_array_elements_text(intent->'comparisonUniverse'->'audiences')) a),
      'sourceDomains',(select jsonb_agg(x order by x) from jsonb_array_elements_text(intent->'comparisonUniverse'->'sourceDomains') x));
    semantic_hash:=private.stage14_hash(semantic);
    select goal.* into prior from public.product_experiments goal where goal.business_id=p_business_id and goal.discovery_version='pod-discovery-2.0' and goal.parent_discovery_id is null and
      goal.variables->>'semanticGoalHash'=semantic_hash and not exists(select 1 from public.product_experiments successor where successor.business_id=p_business_id and successor.discovery_version='pod-discovery-2.0' and successor.parent_discovery_id is null and
        successor.variables->'ownerKickoff'->'followUpBasis'->>'rootId'=goal.id::text) order by goal.created_at desc,goal.id desc limit 1;
    if prior.id is not null and (prior.status in ('reserved','researching') or basis='null'::jsonb) then
      if exists(select 1 from public.workflow_runs x where x.business_id=p_business_id and x.idempotency_key=p_idempotency_key and x.id<>prior.workflow_run_id) then raise exception 'Idempotency key already belongs to a different launch.'; end if;
      return jsonb_build_object('workflowRunId',prior.workflow_run_id,'rootId',prior.id,'shouldStart',false,'semanticReplay',true);
    end if;
    if basis is distinct from 'null'::jsonb then
      if jsonb_typeof(basis) is distinct from 'object' or not(basis ?& array['rootId','reason']) or basis-array['rootId','reason']<>'{}'::jsonb or
        prior.id is null or basis->>'rootId' is distinct from prior.id::text or prior.status not in ('completed','failed') then raise exception 'Follow-up must cite the latest matching terminal discovery root.'; end if;
      chain_scope:=private.stage13v2_budget_authority(prior.id,true);
      authority_id:=(chain_scope->>'authorityRootId')::uuid;
      if intent->'limits'->'maximumMicrousd' is distinct from chain_scope->'maximumMicrousd' or
        jsonb_typeof(p_input->'quote'->'maximumEstimateMicrousd') is distinct from 'number' or
        (p_input->'quote'->>'maximumEstimateMicrousd')::numeric>(chain_scope->>'remainingMicrousd')::bigint then
        raise exception 'A complete follow-up quote must fit the remaining original goal allowance; a kickoff never replenishes it.';
      end if;
      if chain_scope->'hasUncertainCosts'='true'::jsonb then
        raise exception 'Unknown prior charges must be reconciled before an explicit follow-up.'; end if;
      select content into prior_review from public.artifacts where id=private.stage4_deterministic_uuid('pack:output:'||prior.workflow_run_id||':review') and business_id=p_business_id and workflow_run_id=prior.workflow_run_id and artifact_type='worker.output';
      if not ((prior.status='failed' and basis->>'reason'='retry_after_known_failed_call') or
        (prior.status='completed' and prior_review->>'outcome'='NEEDS_MORE_EVIDENCE' and (prior_review->'missingQuestions') ? (basis->>'reason'))) then
        raise exception 'Follow-up reason must be an actual unanswered question or an explicit known-failure recovery.'; end if;
    elsif prior.id is not null then raise exception 'A new round needs a substantive terminal follow-up basis.';
    end if;
    for prior_id in select value::uuid from jsonb_array_elements_text(p_input->'priorArtifactIds') loop
      select * into strict prior_artifact from public.artifacts where id=prior_id and business_id=p_business_id and artifact_type='worker.output';
      select * into strict prior_run from public.workflow_runs where id=prior_artifact.workflow_run_id and business_id=p_business_id and status='completed';
      if prior_run.pack_snapshot->'workflow'->>'key'='research.public-evidence' then
        prior_pack:=private.stage13_validated_evidence(prior_id,p_business_id,true);
      else
        -- Completed v2 outputs must have passed the terminal validator. Until the
        -- subsequent terminal integration is installed this path stays closed.
        select id into strict prior_source_root from public.product_experiments where workflow_run_id=prior_run.id and business_id=p_business_id and discovery_version='pod-discovery-2.0' and parent_discovery_id is null;
        perform private.stage13v2_validate_persisted(prior_source_root,true);
        if prior_artifact.metadata->>'stageKey' not in ('research1','research2') then raise exception 'A prior Evidence Pack, not an arbitrary worker claim, is required.'; end if;
        prior_pack:=prior_artifact.content->'evidencePack';
      end if;
      if exists(select 1 from jsonb_array_elements(prior_pack->'sources') x where (x->>'retrievalExpiresAt')::timestamptz<=clock_timestamp()) then raise exception 'Prior evidence is stale.'; end if;
      prior_hashes:=prior_hashes||jsonb_build_array(jsonb_build_object('artifactId',prior_id,'sha256',private.stage14_hash(prior_pack)));
    end loop;
    select coalesce(jsonb_agg(x order by x->>'sha256',x->>'artifactId'),'[]') into prior_hashes from jsonb_array_elements(prior_hashes) x;
    v_fingerprint:=private.stage14_hash(jsonb_build_object('semanticGoal',semantic_hash,'basisRootId',basis->'rootId','priorEvidence',prior_hashes));
    if exists(select 1 from public.workflow_runs x where x.business_id=p_business_id and x.idempotency_key=p_idempotency_key) then
      select x.id,e.id into strict v_id,root_id from public.workflow_runs x join public.product_experiments e on e.workflow_run_id=x.id and e.business_id=x.business_id
        where x.business_id=p_business_id and x.idempotency_key=p_idempotency_key and e.fingerprint=v_fingerprint and e.discovery_version='pod-discovery-2.0' and e.parent_discovery_id is null;
      return jsonb_build_object('workflowRunId',v_id,'rootId',root_id,'shouldStart',false);
    end if;
    select workflow_run_id,id into v_id,existing_root_id from public.product_experiments pe where pe.business_id=p_business_id and pe.fingerprint=v_fingerprint;
    if found then return jsonb_build_object('workflowRunId',v_id,'rootId',existing_root_id,'shouldStart',false,'semanticReplay',true); end if;
    select * into strict v_pack from public.packs where pack_key='workflow.product-discovery-v2' and version='1.0.0' and status='experimental';
    select value into strict v_workflow from jsonb_array_elements(v_pack.manifest->'workflows') where value->>'key'=p_workflow_key and value->>'version'='1.0.0';
    select * into strict v_definition from public.workflow_definitions where pack_id=v_pack.id and workflow_key=p_workflow_key and version='1.0.0' and status='experimental';
    snapshot:=jsonb_build_object('rootPackId',v_pack.id,'releases',private.stage10_resolve(v_pack.id,true),'workflow',v_workflow,'platformQualification','stage13_v2_bounded_discovery');
    insert into public.workflow_runs(business_id,workflow_definition_id,status,idempotency_key,input,state,pack_snapshot,runtime_capability_hash,runtime_launch_status,runtime_launch_nonce,runtime_launch_reserved_at)
      values(p_business_id,v_definition.id,'queued',p_idempotency_key,jsonb_build_object('intentId',root_id),
        '{"discoveryVersion":"pod-discovery-2.0","publicationAllowed":false,"commerceAllowed":false}',snapshot,private.stage13_hash(p_runtime_capability),'reserved',p_launch_nonce,now()) returning id into v_id;
    insert into public.product_experiments(id,business_id,workflow_run_id,fingerprint,hypothesis,variables,audience,status,measurement_plan,discovery_version)
      values(root_id,p_business_id,v_id,v_fingerprint,intent->>'objective',jsonb_build_object('intent',intent,'policyHash',private.stage14_hash(intent),'budgetQuote',p_input->'quote',
        'budgetAuthorityRootId',authority_id,'ownerKickoff',kickoff||jsonb_build_object('ownerUserId',auth.uid(),'recordedAt',now()),'priorArtifactIds',p_input->'priorArtifactIds','priorEvidenceHashes',prior_hashes,'semanticGoalHash',semantic_hash),
        'Bounded geographic comparison','reserved','{"version":"pod-discovery-2.0","testPlan":null}','pod-discovery-2.0');
    for s in select value from jsonb_array_elements(v_workflow->'stages') loop
      n:=n+1; insert into public.workflow_stage_runs(business_id,workflow_run_id,stage_key,sequence,attempt,status,input,output,failure)
        values(p_business_id,v_id,s->>'key',n,1,'pending','{}','{}','{}');
    end loop;
    -- Validate the complete persisted authority and exact registered lane before
    -- the transaction can expose a runnable capability to the owner.
    perform private.stage13v2_runtime_context(v_id,null);
    insert into public.artifacts(id,business_id,workflow_run_id,artifact_type,name,media_type,content,metadata)
      values(private.stage4_deterministic_uuid('discovery:v2:intent:'||v_id),p_business_id,v_id,'product.discovery-intent.v2','Bounded geographic discovery intent','application/json',p_input,
        jsonb_build_object('version','pod-discovery-2.0','intentId',root_id,'policyHash',private.stage14_hash(intent),'ownerUserId',auth.uid()));
    return jsonb_build_object('workflowRunId',v_id,'rootId',root_id,'shouldStart',true);
  end if;
  if p_launch_nonce is null or length(p_runtime_capability) not between 32 and 512 or length(btrim(p_idempotency_key)) not between 1 and 200 or
    jsonb_typeof(p_input)<>'object' or length(p_input::text)>50000 then raise exception 'Invalid launch input.'; end if;
  select * into strict v_install from public.installed_packs where id=p_installation_id and business_id=p_business_id and status='active' for update;
  perform private.stage10_resolve(v_install.root_pack_id);
  select value into strict v_workflow from jsonb_array_elements((select manifest->'workflows' from public.packs where id=v_install.root_pack_id)) where value->>'key'=p_workflow_key;
  select * into strict v_definition from public.workflow_definitions where pack_id=v_install.root_pack_id and workflow_key=p_workflow_key and version=v_workflow->>'version' and status='qualified';
  insert into public.workflow_runs(business_id,workflow_definition_id,status,idempotency_key,input,state,pack_installation_id,pack_snapshot,runtime_capability_hash,runtime_launch_status,runtime_launch_nonce,runtime_launch_reserved_at)
    values(p_business_id,v_definition.id,'queued',p_idempotency_key,p_input,'{}',v_install.id,v_install.snapshot||jsonb_build_object('workflow',v_workflow),
      encode(extensions.digest(convert_to(p_runtime_capability,'UTF8'),'sha256'),'hex'),'reserved',p_launch_nonce,now())
    on conflict(business_id,idempotency_key) do nothing returning id into v_id;
  if v_id is null then
    select id into strict v_id from public.workflow_runs where business_id=p_business_id and idempotency_key=p_idempotency_key and pack_installation_id=p_installation_id and input=p_input;
    return jsonb_build_object('workflowRunId',v_id,'shouldStart',false);
  end if;
  for s in select value from jsonb_array_elements(v_workflow->'stages') loop
    n:=n+1;
    insert into public.workflow_stage_runs(business_id,workflow_run_id,stage_key,sequence,attempt,status,input,output,failure)
      values(p_business_id,v_id,s->>'key',n,1,'pending','{}','{}','{}');
  end loop;
  return jsonb_build_object('workflowRunId',v_id,'shouldStart',true);
end; $$;


create or replace function public.reserve_product_research_cost(p_workflow_run_id uuid,p_business_id uuid,p_runtime_capability text,p_attempt_key text,p_reserved_microusd integer,p_request_hash text,p_estimate jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.workflow_runs%rowtype; e public.product_experiments%rowtype; reservation public.product_research_cost_reservations%rowtype; v_total bigint;
  chain_scope jsonb; scope jsonb; price jsonb; kind text; v_stage_key text; expected_model text; field text; required_keys text[]; call_keys text[];
  call_index integer; collection_count integer; ceiling bigint; bytes integer; input_tokens integer; output_tokens integer; amount bigint;
  current_stage public.workflow_stage_runs%rowtype; stage_input public.artifacts%rowtype; source_id uuid; dossier public.artifacts%rowtype;
begin

  -- Resolve the mode from the persisted root before considering any caller estimate.
  if coalesce(length(p_runtime_capability),0) not between 32 and 512 then raise exception 'Product runtime capability denied.' using errcode='42501'; end if;
  select * into r from public.workflow_runs where id=p_workflow_run_id and business_id=p_business_id and runtime_capability_hash=private.stage13_hash(p_runtime_capability) for update;
  if not found then raise exception 'Product runtime capability denied.' using errcode='42501'; end if;
  select * into e from public.product_experiments where workflow_run_id=r.id and business_id=r.business_id and
    discovery_version='pod-discovery-2.0' and parent_discovery_id is null and candidate_id is null for update;
  if found then
    if p_attempt_key is null or p_attempt_key not in ('plan:1','search:1','select:1','search:2','select:2','strategy:1','review:1') or
      p_reserved_microusd is null or p_reserved_microusd not between 1 and 1000000 or p_request_hash is null or p_request_hash !~ '^[a-f0-9]{64}$' or
      jsonb_typeof(p_estimate) is distinct from 'object' or octet_length(p_estimate::text)>12000 then
      raise exception 'Invalid finite discovery reservation.';
    end if;
    select * into reservation from public.product_research_cost_reservations where experiment_id=e.id and attempt_key=p_attempt_key;
    chain_scope:=private.stage13v2_budget_authority(e.id,true);
    v_total:=(chain_scope->>'committedMicrousd')::bigint;
    if reservation.id is not null then
      if reservation.workflow_run_id is distinct from r.id or reservation.business_id is distinct from r.business_id or
        reservation.request_hash is distinct from p_request_hash or reservation.reserved_microusd is distinct from p_reserved_microusd or
        reservation.estimate is distinct from p_estimate then raise exception 'V2 reservation replay differs from its immutable request and quote.'; end if;
      return jsonb_build_object('shouldCall',false,'reservedMicrousd',reservation.reserved_microusd,'totalReservedMicrousd',v_total,
        'budgetMicrousd',e.variables->'intent'->'limits'->'maximumMicrousd','reservationBasis','conservative_preflight_estimate','guaranteedInvoiceCap',false);
    end if;
    scope:=private.stage13v2_validate_persisted(e.id,false);
    if r.status<>'running' or e.status not in ('reserved','researching') then raise exception 'V2 research is not active.'; end if;
    if scope->'hasUncertainCosts'='true'::jsonb then raise exception 'A prior discovery attempt is unsettled or its charge is unknown; no further call is authorized.'; end if;
    collection_count:=(scope->>'maximumCollections')::integer;
    call_keys:=(case collection_count when 1 then array['plan:1','search:1','select:1','strategy:1','review:1']
      else array['plan:1','search:1','select:1','search:2','select:2','strategy:1','review:1'] end);
    call_index:=array_position(call_keys,p_attempt_key);
    if call_index is null or exists(select 1 from public.product_research_cost_reservations prior where prior.experiment_id=e.id and not(prior.attempt_key=any(call_keys))) or
      (select count(*) from public.product_research_cost_reservations prior where prior.experiment_id=e.id)<>call_index-1 or
      exists(select 1 from unnest(call_keys[1:call_index-1]) earlier where not exists(
        select 1 from public.product_research_cost_reservations prior where prior.experiment_id=e.id and prior.attempt_key=earlier)) then
      raise exception 'Discovery calls must follow the exact finite primary-only sequence once.';
    end if;
    kind:=split_part(p_attempt_key,':',1);
    v_stage_key:=(case when kind in ('search','select') then 'research'||split_part(p_attempt_key,':',2) else kind end);
    select * into current_stage from public.workflow_stage_runs where workflow_run_id=r.id and business_id=r.business_id and workflow_stage_runs.stage_key=v_stage_key and attempt=1 for update;
    if current_stage.id is null or current_stage.status<>'running' or
      exists(select 1 from public.workflow_stage_runs prior where prior.workflow_run_id=r.id and prior.sequence<current_stage.sequence and prior.status<>'completed') or
      not exists(select 1 from public.task_contracts task join public.worker_runs worker on worker.task_contract_id=task.id
        where task.workflow_run_id=r.id and task.business_id=r.business_id and task.workflow_stage_run_id=current_stage.id and task.status='running' and
          worker.workflow_run_id=r.id and worker.business_id=r.business_id and worker.status='running') then
      raise exception 'The exact prepared discovery worker stage must be active.';
    end if;
    if kind='select' then
      source_id:=private.stage4_deterministic_uuid('research:sources:'||r.id||':'||v_stage_key);
      if not exists(select 1 from public.artifacts source where source.id=source_id and source.workflow_run_id=r.id and source.business_id=r.business_id and
        source.artifact_type='research.sources' and source.content->'providerMetadata'->>'intentId'=e.id::text and
        source.content->'providerMetadata'->>'callKey'='search:'||split_part(p_attempt_key,':',2) and
        source.content->'providerMetadata'->>'queryId'=private.stage4_deterministic_uuid('discovery:v2:query:'||e.id||':'||split_part(p_attempt_key,':',2))::text and
        exists(select 1 from public.product_research_cost_reservations prior join public.product_research_cost_settlements cost on cost.reservation_id=prior.id
          where prior.experiment_id=e.id and prior.attempt_key='search:'||split_part(p_attempt_key,':',2) and cost.reported_microusd is not null and
            cost.provider_request_id=source.content->'providerMetadata'->>'providerRequestId')) then
        raise exception 'Evidence selection requires the exact immutable, settled search collection.';
      end if;
      if exists(select 1 from public.artifacts current_source where current_source.id=source_id and
        jsonb_typeof(current_source.content->'sources')='array' and jsonb_array_length(current_source.content->'sources')>0 and
        not exists(select 1 from jsonb_array_elements(current_source.content->'sources') fresh where
          not exists(select 1 from public.artifacts prior_source cross join lateral jsonb_array_elements(prior_source.content->'sources') old_source
            where prior_source.business_id=r.business_id and prior_source.workflow_run_id=r.id and prior_source.artifact_type='research.sources' and
              prior_source.id<>source_id and old_source->>'contentHash'=fresh->>'contentHash') and
          not exists(select 1 from public.artifacts prior_pack cross join lateral jsonb_array_elements(prior_pack.content->'evidencePack'->'sources') old_source
            where prior_pack.business_id=r.business_id and (e.variables->'priorArtifactIds') ? prior_pack.id::text and old_source->>'contentHash'=fresh->>'contentHash'))) then
        raise exception 'The retained collection contains no new source content; stop without a paid selector or automatic repeat.';
      end if;
    elsif kind in ('strategy','review') then
      select * into dossier from public.artifacts a where a.id=e.source_artifact_id and a.business_id=r.business_id and a.workflow_run_id=r.id and a.artifact_type='product.discovery-dossier.v2';
      if dossier.id is null or dossier.content->>'version' is distinct from 'pod-discovery-2.0' or dossier.content->>'intentId' is distinct from e.id::text then
        raise exception 'A persisted same-root discovery dossier is required before strategy or review.';
      end if;
    end if;
    required_keys:=array['version','intentId','policyHash','maximumCollections','maximumMicrousd','callKey','requestBytes','inputTokenAllowance','outputTokenAllowance','reservedMicrousd','quote','researchRequest','primaryOnly','estimateOnly','providerInvoiceGuarantee'];
    if not(p_estimate ?& required_keys) or p_estimate-required_keys<>'{}'::jsonb or
      p_estimate->>'version' is distinct from 'discovery-estimate-2.0' or p_estimate->>'intentId' is distinct from e.id::text or
      p_estimate->>'policyHash' is distinct from scope->>'policyHash' or p_estimate->'maximumCollections' is distinct from scope->'maximumCollections' or
      p_estimate->'maximumMicrousd' is distinct from scope->'maximumMicrousd' or p_estimate->>'callKey' is distinct from p_attempt_key or
      p_estimate->'reservedMicrousd' is distinct from to_jsonb(p_reserved_microusd) or p_estimate->'primaryOnly' is distinct from 'true'::jsonb or
      p_estimate->'estimateOnly' is distinct from 'true'::jsonb or p_estimate->'providerInvoiceGuarantee' is distinct from 'false'::jsonb then
      raise exception 'The quote must match the authoritative discovery intent and exact paid phase.';
    end if;
    foreach field in array array['requestBytes','inputTokenAllowance','outputTokenAllowance','reservedMicrousd'] loop
      if jsonb_typeof(p_estimate->field) is distinct from 'number' or (p_estimate->>field)::numeric<>trunc((p_estimate->>field)::numeric) or
        (p_estimate->>field)::numeric not between 1 and 1000000 then raise exception 'Discovery allowances must be bounded integers.'; end if;
    end loop;
    if kind='search' then
      select * into stage_input from public.artifacts a where a.id=private.stage4_deterministic_uuid('pack:input:'||r.id||':'||v_stage_key) and
        a.workflow_run_id=r.id and a.business_id=r.business_id and a.artifact_type='pack.stage-input';
      if stage_input.id is null or jsonb_typeof(p_estimate->'researchRequest') is distinct from 'object' or
        not((p_estimate->'researchRequest') ?& array['query','allowedDomains']) or (p_estimate->'researchRequest')-array['query','allowedDomains']<>'{}'::jsonb or
        p_estimate->'researchRequest' is distinct from jsonb_build_object('query',stage_input.content->'question','allowedDomains',stage_input.content->'sourceDomains') or
        stage_input.content->>'queryId' is distinct from private.stage4_deterministic_uuid('discovery:v2:query:'||e.id||':'||split_part(p_attempt_key,':',2))::text or
        jsonb_typeof(p_estimate->'researchRequest'->'query') is distinct from 'string' or length(btrim(p_estimate->'researchRequest'->>'query')) not between 5 and 800 or
        jsonb_typeof(p_estimate->'researchRequest'->'allowedDomains') is distinct from 'array' or jsonb_array_length(p_estimate->'researchRequest'->'allowedDomains') not between 1 and 6 or
        exists(select 1 from jsonb_array_elements(p_estimate->'researchRequest'->'allowedDomains') domain where jsonb_typeof(domain)<>'string' or
          not((e.variables->'intent'->'comparisonUniverse'->'sourceDomains') @> jsonb_build_array(domain))) or
        (select count(distinct domain) from jsonb_array_elements(p_estimate->'researchRequest'->'allowedDomains') domain)<>jsonb_array_length(p_estimate->'researchRequest'->'allowedDomains') or
        not exists(select 1 from public.task_contracts task where task.workflow_stage_run_id=current_stage.id and task.workflow_run_id=r.id and stage_input.id=any(task.input_artifact_ids)) then
        raise exception 'Search must match the exact prepared question, query identity and authorized source domains.';
      end if;
    elsif p_estimate->'researchRequest' is distinct from 'null'::jsonb then
      raise exception 'Only a search phase may declare a research request.';
    end if;
    bytes:=(p_estimate->>'requestBytes')::integer;
    ceiling:=(case kind when 'plan' then 12288 when 'search' then 8192 when 'select' then 16384 else 32768 end);
    input_tokens:=(case when kind='search' then 128000 else bytes+8192 end);
    output_tokens:=(case kind when 'plan' then 1500 when 'search' then 8000 when 'select' then 1000 when 'strategy' then 5000 else 4000 end);
    if bytes>ceiling or p_estimate->'inputTokenAllowance' is distinct from to_jsonb(input_tokens) or p_estimate->'outputTokenAllowance' is distinct from to_jsonb(output_tokens) then
      raise exception 'Request bytes and token allowances differ from the fixed discovery phase policy.';
    end if;
    price:=p_estimate->'quote'; expected_model:=(case when p_attempt_key='review:1' then 'anthropic/claude-haiku-4.5' else 'openai/gpt-5.6-luna' end);
    required_keys:=array['modelId','verifiedAt','source','inputPerMillion','outputPerMillion','cacheWritePerMillion'];
    if jsonb_typeof(price) is distinct from 'object' or not(price ?& required_keys) or price-required_keys<>'{}'::jsonb or
      price->>'modelId' is distinct from expected_model or price->>'source' is distinct from 'https://openrouter.ai/api/v1/models' or
      jsonb_typeof(price->'verifiedAt') is distinct from 'string' or
      abs(extract(epoch from clock_timestamp()-(price->>'verifiedAt')::timestamptz))>300 then
      raise exception 'Fresh exact-primary model pricing required.';
    end if;
    foreach field in array array['inputPerMillion','outputPerMillion','cacheWritePerMillion'] loop
      if jsonb_typeof(price->field) is distinct from 'number' or (price->>field)::numeric not between 0 and 1000000 then raise exception 'Invalid discovery model price.'; end if;
    end loop;
    amount:=ceil(input_tokens*((price->>'inputPerMillion')::numeric+(price->>'cacheWritePerMillion')::numeric)+output_tokens*(price->>'outputPerMillion')::numeric+
      (case when kind='search' then 7000 else 0 end))::bigint;
    if amount is distinct from p_reserved_microusd or amount>(e.variables->'budgetQuote'->'ceilings'->>p_attempt_key)::bigint then
      raise exception 'The recomputed discovery reservation must match and fit the approved per-phase ceiling.';
    end if;
    if (e.variables->'intent'->>'expiresAt')::timestamptz<=clock_timestamp() then raise exception 'Discovery authority expired while preparing its reservation.'; end if;
    if v_total+amount>(scope->>'maximumMicrousd')::bigint then raise exception 'The complete committed discovery cost would exceed the immutable root allowance.'; end if;
    insert into public.product_research_cost_reservations(business_id,experiment_id,workflow_run_id,attempt_key,reserved_microusd,request_hash,estimate)
      values(r.business_id,e.id,r.id,p_attempt_key,p_reserved_microusd,p_request_hash,p_estimate);
    return jsonb_build_object('shouldCall',true,'reservedMicrousd',p_reserved_microusd,'totalReservedMicrousd',v_total+amount,
      'budgetMicrousd',scope->'maximumMicrousd','reservationBasis','conservative_preflight_estimate','guaranteedInvoiceCap',false);
  end if;
  if exists(select 1 from public.product_experiments where workflow_run_id=r.id and discovery_version='pod-discovery-2.0') then raise exception 'Malformed v2 linkage cannot fall back to v1 budgeting.'; end if;
  -- The existing v1 reservation contract below is preserved verbatim.
  if coalesce(length(p_runtime_capability),0) not between 32 and 512 or p_attempt_key is null or p_attempt_key not in ('search:luna.standard','search:gemini.flash.large','selector:luna.standard','selector:gemini.flash.large') or
    p_reserved_microusd is null or p_reserved_microusd not between 1 and 1000000 or p_request_hash is null or p_request_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid bounded model reservation.' using errcode='42501'; end if;
  select * into r from public.workflow_runs where id=p_workflow_run_id and business_id=p_business_id and runtime_capability_hash=private.stage13_hash(p_runtime_capability) for update;
  if not found then raise exception 'Product runtime capability denied.' using errcode='42501'; end if;
  select * into e from public.product_experiments where workflow_run_id=r.id and business_id=r.business_id and basis_artifact_id is null for update;
  if not found then raise exception 'Linked product research experiment required.'; end if;
  select * into reservation from public.product_research_cost_reservations where experiment_id=e.id and attempt_key=p_attempt_key;
  v_total:=private.stage13_committed_cost(e.id);
  if reservation.id is not null then
    if reservation.request_hash<>p_request_hash then raise exception 'Model attempt reservation cannot change.'; end if;
    return jsonb_build_object('shouldCall',false,'reservedMicrousd',reservation.reserved_microusd,'totalReservedMicrousd',v_total,'budgetMicrousd',1000000,'reservationBasis','conservative_preflight_estimate','guaranteedInvoiceCap',false);
  end if;
  if jsonb_typeof(p_estimate) is distinct from 'object' or octet_length(p_estimate::text)>12000 then raise exception 'A bounded cost estimate object is required.'; end if;
  if p_estimate<>'{}'::jsonb then
    if not(p_estimate ?& array['version','phase','requestBytes','inputTokenAllowance','outputTokenAllowance','reservedMicrousd','quote','estimateOnly','providerInvoiceGuarantee']) or
      p_estimate-array['version','phase','requestBytes','inputTokenAllowance','outputTokenAllowance','reservedMicrousd','quote','estimateOnly','providerInvoiceGuarantee']<>'{}'::jsonb or
      p_estimate->>'version' is distinct from 'discovery-estimate-1.0' or p_estimate->>'phase' is distinct from split_part(p_attempt_key,':',1) or
      p_estimate->'reservedMicrousd' is distinct from to_jsonb(p_reserved_microusd) or p_estimate->'estimateOnly' is distinct from 'true'::jsonb or
      p_estimate->'providerInvoiceGuarantee' is distinct from 'false'::jsonb or
      jsonb_typeof(p_estimate->'requestBytes') is distinct from 'number' or jsonb_typeof(p_estimate->'inputTokenAllowance') is distinct from 'number' or
      jsonb_typeof(p_estimate->'outputTokenAllowance') is distinct from 'number' or jsonb_typeof(p_estimate->'quote') is distinct from 'object' or
      not((p_estimate->'quote') ?& array['modelId','verifiedAt','source','promptPerMillionUsd','completionPerMillionUsd','cacheWritePerMillionUsd','cacheReadPerMillionUsd']) or
      (p_estimate->'quote')-array['modelId','verifiedAt','source','promptPerMillionUsd','completionPerMillionUsd','cacheWritePerMillionUsd','cacheReadPerMillionUsd']<>'{}'::jsonb or
      p_estimate->'quote'->>'source' is distinct from 'https://openrouter.ai/api/v1/models' or
      p_estimate->'quote'->>'modelId' is distinct from (case when split_part(p_attempt_key,':',2)='luna.standard' then 'openai/gpt-5.6-luna' else 'google/gemini-3.6-flash' end) or
      jsonb_typeof(p_estimate->'quote'->'verifiedAt') is distinct from 'string' or
      (p_estimate->'quote'->>'verifiedAt')::timestamptz not between now()-interval '5 minutes' and now()+interval '5 minutes' or
      exists(select 1 from jsonb_each(p_estimate->'quote') q where q.key in ('promptPerMillionUsd','completionPerMillionUsd','cacheWritePerMillionUsd','cacheReadPerMillionUsd') and jsonb_typeof(q.value)<>'number') then
      raise exception 'Cost estimate must contain only scoped model pricing and token allowances.'; end if;
  end if;
  if r.status<>'running' or e.status not in ('reserved','researching') then raise exception 'Research is not active.'; end if;
  if v_total+p_reserved_microusd>1000000 then raise exception 'Call estimate exceeds the remaining one-dollar research budget.'; end if;
  insert into public.product_research_cost_reservations(business_id,experiment_id,workflow_run_id,attempt_key,reserved_microusd,request_hash,estimate)
    values(r.business_id,e.id,r.id,p_attempt_key,p_reserved_microusd,p_request_hash,p_estimate);
  return jsonb_build_object('shouldCall',true,'reservedMicrousd',p_reserved_microusd,'totalReservedMicrousd',v_total+p_reserved_microusd,'budgetMicrousd',1000000,'reservationBasis','conservative_preflight_estimate','guaranteedInvoiceCap',false);
end; $$;


create or replace function public.record_product_research_cost(p_workflow_run_id uuid,p_business_id uuid,p_runtime_capability text,p_attempt_key text,p_reported_microusd integer,p_provider_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare chain_scope jsonb; r public.workflow_runs%rowtype; e public.product_experiments%rowtype; reservation public.product_research_cost_reservations%rowtype; v_hash text; v_id uuid; existing public.product_research_cost_settlements%rowtype; maximum integer;
begin

  if coalesce(length(p_runtime_capability),0) not between 32 and 512 then raise exception 'Product runtime capability denied.' using errcode='42501'; end if;
  select * into r from public.workflow_runs where id=p_workflow_run_id and business_id=p_business_id and runtime_capability_hash=private.stage13_hash(p_runtime_capability) for update;
  if not found then raise exception 'Product runtime capability denied.' using errcode='42501'; end if;
  select * into e from public.product_experiments where workflow_run_id=r.id and business_id=r.business_id and
    discovery_version='pod-discovery-2.0' and parent_discovery_id is null and candidate_id is null for update;
  if found then
    chain_scope:=private.stage13v2_budget_authority(e.id,true);
    -- A late known receipt may settle an already reserved expired/failed run.
    -- This never renews its intent or permits another provider dispatch.
    if p_attempt_key is null or p_attempt_key not in ('plan:1','search:1','select:1','search:2','select:2','strategy:1','review:1') or
      (p_reported_microusd is not null and p_reported_microusd<0) or
      (p_provider_request_id is not null and (length(btrim(p_provider_request_id)) not between 3 and 240 or p_provider_request_id ~* '(mock|fixture|simulation)')) then
      raise exception 'Invalid v2 provider settlement.';
    end if;
    select * into reservation from public.product_research_cost_reservations where experiment_id=e.id and workflow_run_id=r.id and business_id=r.business_id and attempt_key=p_attempt_key;
    if reservation.id is null or reservation.estimate->>'version' is distinct from 'discovery-estimate-2.0' or
      reservation.estimate->>'intentId' is distinct from e.id::text then raise exception 'Reserve the exact v2 root provider attempt before recording its receipt.'; end if;
    if p_provider_request_id is not null and exists(select 1 from public.product_research_cost_settlements where reservation_id=reservation.id and provider_request_id is not null and provider_request_id<>p_provider_request_id) then
      raise exception 'The v2 provider request identity cannot change.';
    end if;
    if p_provider_request_id is not null and exists(select 1 from public.product_research_cost_settlements cost join public.product_research_cost_reservations prior on prior.id=cost.reservation_id
      where (chain_scope->'chainRootIds') ? prior.experiment_id::text and prior.id<>reservation.id and cost.provider_request_id=p_provider_request_id) then
      raise exception 'Each v2 paid attempt must have its own provider request identity.';
    end if;
    select * into existing from public.product_research_cost_settlements where reservation_id=reservation.id and reported_microusd is not null and provider_request_id is not null order by created_at,id limit 1;
    if existing.id is not null and (existing.reported_microusd is distinct from p_reported_microusd or existing.provider_request_id is distinct from p_provider_request_id) then
      raise exception 'A known v2 provider settlement is immutable.';
    end if;
    maximum:=(e.variables->'intent'->'limits'->>'maximumMicrousd')::integer;
    v_hash:=private.stage13_hash(jsonb_build_object('reportedMicrousd',p_reported_microusd,'providerRequestId',p_provider_request_id)::text);
    insert into public.product_research_cost_settlements(business_id,reservation_id,reported_microusd,provider_request_id,fingerprint)
      values(r.business_id,reservation.id,p_reported_microusd,p_provider_request_id,v_hash) on conflict(reservation_id,fingerprint) do nothing returning id into v_id;
    chain_scope:=private.stage13v2_budget_authority(e.id,false);
    return jsonb_build_object('cached',v_id is null,'totalReservedMicrousd',chain_scope->'committedMicrousd','budgetMicrousd',maximum,
      'reservationBasis','conservative_preflight_estimate','guaranteedInvoiceCap',false);
  end if;
  if exists(select 1 from public.product_experiments where workflow_run_id=r.id and discovery_version='pod-discovery-2.0') then raise exception 'Malformed v2 linkage cannot fall back to v1 settlements.'; end if;
  -- The existing v1 settlement contract below is preserved verbatim.
  if coalesce(length(p_runtime_capability),0) not between 32 and 512 or (p_reported_microusd is not null and p_reported_microusd<0) or
    (p_provider_request_id is not null and length(p_provider_request_id) not between 1 and 240) then raise exception 'Invalid reported research cost.' using errcode='42501'; end if;
  select * into r from public.workflow_runs where id=p_workflow_run_id and business_id=p_business_id and runtime_capability_hash=private.stage13_hash(p_runtime_capability) for update;
  if not found then raise exception 'Product runtime capability denied.' using errcode='42501'; end if;
  select * into e from public.product_experiments where workflow_run_id=r.id and business_id=r.business_id and basis_artifact_id is null for update;
  if not found then raise exception 'Linked product research experiment required.'; end if;
  select * into reservation from public.product_research_cost_reservations where experiment_id=e.id and attempt_key=p_attempt_key;
  if not found then raise exception 'Reserve the specific provider attempt before reporting cost.'; end if;
  if p_provider_request_id is not null and exists(select 1 from public.product_research_cost_settlements where reservation_id=reservation.id and provider_request_id is not null and provider_request_id<>p_provider_request_id) then
    raise exception 'Provider request identity cannot change for an existing attempt.'; end if;
  v_hash:=private.stage13_hash(jsonb_build_object('reportedMicrousd',p_reported_microusd,'providerRequestId',p_provider_request_id)::text);
  insert into public.product_research_cost_settlements(business_id,reservation_id,reported_microusd,provider_request_id,fingerprint)
    values(r.business_id,reservation.id,p_reported_microusd,p_provider_request_id,v_hash) on conflict(reservation_id,fingerprint) do nothing returning id into v_id;
  return jsonb_build_object('cached',v_id is null,'totalReservedMicrousd',private.stage13_committed_cost(e.id),'budgetMicrousd',1000000,'reservationBasis','conservative_preflight_estimate','guaranteedInvoiceCap',false);
end; $$;
