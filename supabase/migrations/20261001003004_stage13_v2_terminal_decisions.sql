-- OFFLINE DRAFT: terminal qualitative validation and append-only projection.
-- Recommendations grant no generation, spending, publication or commerce authority.
-- No v1 validator, Stage 14 eligibility gate, public signature or grant changes.

create or replace function private.stage13v2_validate_persisted(p_experiment_id uuid,p_require_completed boolean default true)
returns jsonb language plpgsql set search_path='' as $$
declare e public.product_experiments%rowtype; root public.product_experiments%rowtype; r public.workflow_runs%rowtype;
  intent jsonb; universe jsonb; limits jsonb; quote jsonb; item jsonb; field text; expected_keys text[]; maximum integer; collections integer; committed bigint;
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
  committed:=private.stage13_committed_cost(root.id);
  select exists(select 1 from public.product_research_cost_reservations reservation where reservation.experiment_id=root.id and
    not exists(select 1 from public.product_research_cost_settlements settlement where settlement.reservation_id=reservation.id and settlement.reported_microusd is not null and settlement.provider_request_id is not null)) into has_uncertain;
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

-- Project the terminal result once, only after the complete private validator.
create or replace function public.installed_pack_runtime_transition(p_workflow_run_id uuid,p_business_id uuid,p_runtime_capability text,p_operation text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.workflow_runs%rowtype; i public.owner_interventions%rowtype; v_result jsonb; v_output jsonb; receipt jsonb;
  terminal jsonb; root_row public.product_experiments%rowtype; child_identity jsonb; child_plan jsonb; child_variables jsonb; child_ids jsonb;
  child_id uuid; selected_decision_id uuid; child_hypothesis text;
  v_product jsonb; query jsonb; proposal jsonb; call_key text; expected_model text;
  stage jsonb; worker jsonb; v_id uuid; v_resolution jsonb; v_stage_key text:=p_payload->>'stageKey';
begin
  if p_runtime_capability is null or length(p_runtime_capability) not between 32 and 512 or
    jsonb_typeof(p_payload) is distinct from 'object' or length(p_payload::text)>200000 then
    raise exception 'Pack runtime request denied.' using errcode='42501'; end if;
  select * into r from public.workflow_runs where id=p_workflow_run_id and business_id=p_business_id and pack_snapshot is not null
    and runtime_capability_hash=encode(extensions.digest(convert_to(p_runtime_capability,'UTF8'),'sha256'),'hex') for update;
  if not found then raise exception 'Pack runtime capability denied.' using errcode='42501'; end if;
  if p_operation='fail' and exists(select 1 from public.product_experiments where workflow_run_id=r.id and business_id=r.business_id and discovery_version='pod-discovery-2.0' and parent_discovery_id is null) then
    v_result:=private.stage10_installed_pack_runtime_transition(r.id,r.business_id,p_runtime_capability,'fail',p_payload);
    update public.product_experiments set status='failed',failure=left(coalesce(p_payload->>'message','Discovery stopped; no automatic retry.'),1200),completed_at=now()
      where workflow_run_id=r.id and business_id=r.business_id and discovery_version='pod-discovery-2.0' and parent_discovery_id is null and status in ('reserved','researching');
    return v_result;
  end if;
  if p_operation='fail' and exists(select 1 from public.product_experiments where workflow_run_id=r.id and business_id=r.business_id and discovery_version='pod-discovery-1.0' and parent_discovery_id is null and basis_artifact_id is null) then
    v_result:=private.stage10_installed_pack_runtime_transition(r.id,r.business_id,p_runtime_capability,'fail',p_payload);
    perform public.product_discovery_runtime(r.id,r.business_id,p_runtime_capability,'fail');
    return v_result;
  end if;
  v_product:=private.stage13v2_runtime_context(r.id,null);
  if v_product->'productScope'->>'version'='pod-discovery-2.0' then
    if p_operation='complete' then
      terminal:=private.stage13v2_validate_persisted((v_product->'productScope'->>'rootId')::uuid,true);
      select * into strict root_row from public.product_experiments where id=(terminal->>'intentId')::uuid and business_id=r.business_id for update;
      v_result:=private.stage10_installed_pack_runtime_transition(r.id,r.business_id,p_runtime_capability,'complete',p_payload);
      child_ids:='[]'; selected_decision_id:=null;
      for child_identity in select value from jsonb_array_elements(terminal->'dossier'->'shortlist') loop
        child_id:=private.stage4_deterministic_uuid('discovery:v2:child:'||root_row.id||':'||(child_identity->>'id'));
        child_plan:=jsonb_build_object('version','pod-discovery-2.0','testPlan',(case when terminal->'review'->>'outcome'='TEST' and terminal->'review'->>'candidateId'=child_identity->>'id'
          then terminal->'strategy'->'testPlan' else 'null'::jsonb end));
        child_variables:=jsonb_build_object('intentId',root_row.id,'identity',child_identity,'recommendedMarketCountryCode',(case when terminal->'review'->>'candidateId'=child_identity->>'id' then terminal->'review'->'marketCountryCode' else 'null'::jsonb end));
        select hypothesis into strict child_hypothesis from public.product_candidates where id=(child_identity->>'id')::uuid and business_id=r.business_id;
        insert into public.product_experiments(id,business_id,candidate_id,workflow_run_id,fingerprint,hypothesis,variables,audience,status,measurement_plan,evidence_pack,source_artifact_id,started_at,completed_at,discovery_version,parent_discovery_id)
          values(child_id,r.business_id,(child_identity->>'id')::uuid,r.id,private.stage13_hash('discovery:v2:child:'||root_row.id||':'||(child_identity->>'id')),child_hypothesis,
            child_variables,child_identity->>'audience','completed',child_plan,root_row.evidence_pack,root_row.source_artifact_id,root_row.started_at,coalesce(root_row.completed_at,now()),'pod-discovery-2.0',root_row.id)
          on conflict(id) do nothing;
        if not exists(select 1 from public.product_experiments x where x.id=child_id and x.business_id=r.business_id and x.candidate_id=(child_identity->>'id')::uuid and
          x.workflow_run_id=r.id and x.discovery_version='pod-discovery-2.0' and x.parent_discovery_id=root_row.id and x.variables=child_variables and x.measurement_plan=child_plan and
          x.evidence_pack=root_row.evidence_pack and x.source_artifact_id=root_row.source_artifact_id and x.status='completed') then raise exception 'Completed child replay differs from its immutable identity and recommendation.'; end if;
        child_ids:=child_ids||jsonb_build_array(child_id);
        if terminal->'review'->>'candidateId'=child_identity->>'id' then
          selected_decision_id:=private.stage4_deterministic_uuid('discovery:v2:decision:'||root_row.id||':'||(child_identity->>'id'));
          insert into public.product_decisions(id,business_id,candidate_id,experiment_id,assessment,assessment_fingerprint)
            values(selected_decision_id,r.business_id,(child_identity->>'id')::uuid,child_id,terminal->'review',private.stage14_hash(terminal->'review')) on conflict(id) do nothing;
          if not exists(select 1 from public.product_decisions d where d.id=selected_decision_id and d.business_id=r.business_id and d.candidate_id=(child_identity->>'id')::uuid and d.experiment_id=child_id and
            d.assessment=terminal->'review' and d.assessment_fingerprint=private.stage14_hash(terminal->'review')) then raise exception 'Decision replay changed the actual independent reviewer snapshot.'; end if;
        end if;
      end loop;
      if root_row.status<>'completed' then update public.product_experiments set status='completed',completed_at=now() where id=root_row.id; end if;
      insert into public.events(id,business_id,workflow_run_id,event_type,actor_type,payload)
        values(private.stage4_deterministic_uuid('discovery:v2:completed:'||root_row.id),r.business_id,r.id,'product.discovery.completed','system',
          jsonb_build_object('version','pod-discovery-2.0','rootId',root_row.id,'childExperimentIds',child_ids,'decisionId',selected_decision_id,'outcome',terminal->>'outcome',
            'marketCountryCode',terminal->'selectedMarketCountryCode','generationAuthorized',false,'spendingAuthorized',false,'publicationAllowed',false,'commerceAllowed',false)) on conflict(id) do nothing;
      return v_result||jsonb_build_object('rootId',root_row.id,'childExperimentIds',child_ids,'decisionId',selected_decision_id,'outcome',terminal->>'outcome',
        'productionEligible',false,'generationAuthorized',false,'spendingAuthorized',false,'publicationAllowed',false,'commerceAllowed',false);
    elsif p_operation='persist' then
      receipt:=p_payload->'receipt'; v_output:=p_payload->'output';
      call_key:=(case when v_stage_key in ('research1','research2') then 'select:'||right(v_stage_key,1) else v_stage_key||':1' end);
      expected_model:=(case when v_stage_key='review' then 'anthropic/claude-haiku-4.5' else 'openai/gpt-5.6-luna' end);
      if v_stage_key not in ('plan','research1','research2','strategy','review') or
        receipt->>'intentId' is distinct from v_product->'productScope'->>'rootId' or receipt->>'callKey' is distinct from call_key or
        receipt->>'actualProviderModelId' is distinct from expected_model or receipt->>'provider' is distinct from 'openrouter' or
        receipt->>'executionMode' is distinct from (case when v_stage_key in ('research1','research2') then 'web.research' else 'discovery.'||v_stage_key end) or
        receipt->'primaryOnly' is distinct from 'true'::jsonb or receipt->'mockProvider' is distinct from 'false'::jsonb or receipt->'outputValidated' is distinct from 'true'::jsonb or
        not exists(select 1 from public.product_research_cost_reservations cr join public.product_research_cost_settlements cs on cs.reservation_id=cr.id
          where cr.experiment_id=(v_product->'productScope'->>'rootId')::uuid and cr.workflow_run_id=r.id and cr.business_id=r.business_id and cr.attempt_key=call_key and
          cs.reported_microusd is not null and cs.provider_request_id=receipt->>'providerRequestId') then raise exception 'V2 phase output requires its actual primary model and known paid-call receipt.'; end if;
      if v_stage_key='plan' then
        if v_output->>'version' is distinct from 'pod-discovery-2.0' or v_output->>'intentId' is distinct from v_product->'productScope'->>'rootId' or
          v_output-array['version','intentId','comparisonRationale','queries','proposals']<>'{}'::jsonb or
          jsonb_typeof(v_output->'queries') is distinct from 'array' or jsonb_array_length(v_output->'queries')<>(v_product->'productScope'->'budgetScope'->>'maximumCollections')::integer or
          jsonb_typeof(v_output->'proposals') is distinct from 'array' or jsonb_array_length(v_output->'proposals') not between 1 and 3 or length(btrim(v_output->>'comparisonRationale')) not between 40 and 700 then raise exception 'Invalid finite discovery plan.'; end if;
        for query in select value from jsonb_array_elements(v_output->'queries') loop
          if query-array['queryId','ordinal','question','sourceDomains']<>'{}'::jsonb or query->'ordinal' not in ('1'::jsonb,'2'::jsonb) or
            query->>'queryId' is distinct from private.stage4_deterministic_uuid('discovery:v2:query:'||(v_product->'productScope'->>'rootId')||':'||(query->>'ordinal'))::text or
            length(query->>'question') not between 5 and 800 or query->'sourceDomains' is distinct from v_product->'productScope'->'intent'->'comparisonUniverse'->'sourceDomains' then raise exception 'Plan query changed its declared source scope or deterministic identity.'; end if;
        end loop;
        if (select array_agg((x->>'ordinal')::integer order by (x->>'ordinal')::integer) from jsonb_array_elements(v_output->'queries') x) is distinct from
          (case when v_product->'productScope'->'budgetScope'->>'maximumCollections'='1' then array[1] else array[1,2] end) then raise exception 'Plan queries must be the exact finite ordinal list.'; end if;
        for proposal in select value from jsonb_array_elements(v_output->'proposals') loop
          if proposal-array['proposalKey','concept','audience','hypothesis','differentiationHypothesis']<>'{}'::jsonb or
            proposal->>'proposalKey' not in ('candidate-1','candidate-2','candidate-3') or
            not((v_product->'productScope'->'intent'->'comparisonUniverse'->'audiences') ? (proposal->>'audience')) or
            length(btrim(proposal->>'concept')) not between 3 and 160 or length(btrim(proposal->>'hypothesis')) not between 20 and 500 or length(btrim(proposal->>'differentiationHypothesis')) not between 20 and 400 then raise exception 'Invalid geography-independent candidate proposal.'; end if;
        end loop;
        if (select count(distinct private.stage13_normalize(x->>'concept')||':'||private.stage13_normalize(x->>'audience')) from jsonb_array_elements(v_output->'proposals') x)<>jsonb_array_length(v_output->'proposals') or
          (select count(distinct x->>'proposalKey') from jsonb_array_elements(v_output->'proposals') x)<>jsonb_array_length(v_output->'proposals') then raise exception 'Duplicate proposal identities are not alternatives.'; end if;
      elsif v_stage_key in ('strategy','review') then
        if v_output->>'version' is distinct from 'pod-discovery-2.0' or v_output->>'intentId' is distinct from v_product->'productScope'->>'rootId' or
          v_output->'execution' is distinct from jsonb_build_object('modelId',expected_model,'providerRequestId',receipt->>'providerRequestId','primaryOnly',true) or
          receipt->>'outputHash' is distinct from private.stage14_hash(v_output) or v_output->>'dossierHash' is distinct from receipt->>'dossierHash' or
          v_output->'publicationAllowed' is distinct from 'false'::jsonb or v_output->'commerceAllowed' is distinct from 'false'::jsonb or
          octet_length(v_output::text)>(case when v_stage_key='review' then 16384 else 32768 end) then raise exception 'Invalid non-authorizing strategy/review snapshot.'; end if;
      end if;
    end if;
    v_result:=private.stage10_installed_pack_runtime_transition(r.id,r.business_id,p_runtime_capability,p_operation,p_payload);
    if p_operation='load' then
      update public.product_experiments set status='researching',started_at=coalesce(started_at,now()) where id=(v_product->'productScope'->>'rootId')::uuid and status='reserved';
    elsif p_operation='fail' then
      update public.product_experiments set status='failed',failure=left(coalesce(p_payload->>'message','Discovery stopped; no automatic retry.'),1200),completed_at=now()
        where id=(v_product->'productScope'->>'rootId')::uuid and status in ('reserved','researching');
    end if;
    if p_operation in ('load','prepare','output') then
      return v_result||private.stage13v2_runtime_context(r.id,(case when p_operation='prepare' and v_result->'completed' is distinct from 'true'::jsonb then v_stage_key else null end));
    end if;
    return v_result;
  end if;
  if r.pack_snapshot->>'platformQualification' is distinct from 'stage12' and
    r.pack_snapshot->'workflow'->>'key' is distinct from 'etsy.product-discovery-simulation' then
    v_result:=private.stage10_installed_pack_runtime_transition(p_workflow_run_id,p_business_id,p_runtime_capability,p_operation,p_payload);
    if p_operation in ('load','prepare','output') then return v_result||v_product; end if;
    return v_result;
  end if;
  perform private.stage12_assert_simulation_snapshot(r.pack_snapshot);
  v_id:=private.stage4_deterministic_uuid('etsy:simulation-review:'||r.id);
  select * into i from public.owner_interventions where id=v_id and workflow_run_id=r.id and business_id=r.business_id for update;
  if p_operation='load' and r.status='needs_owner' then
    if nullif(p_payload->>'runtimeRunId','') is null or r.runtime_run_id is distinct from p_payload->>'runtimeRunId' then raise exception 'Runtime identity mismatch.'; end if;
    return jsonb_build_object('snapshot',r.pack_snapshot,'input',r.input,'status',r.status)||v_product;
  end if;
  if p_operation='persist' then
    receipt:=p_payload->'receipt'; v_output:=p_payload->'output';
    select value into strict stage from jsonb_array_elements(r.pack_snapshot->'workflow'->'stages') where value->>'key'=v_stage_key;
    select w.value into strict worker from jsonb_array_elements(r.pack_snapshot->'releases') rel
      cross join lateral jsonb_array_elements(rel->'manifest'->'workers') w where w.value->'manifest'->'worker'->>'workerKey'=stage->>'workerKey';
    if receipt->>'mode' is distinct from 'simulation' or receipt->>'executionMode' is distinct from 'simulation.model_router' or
      receipt->'providerExecuted' is distinct from 'false'::jsonb or receipt->'qualificationEvaluated' is distinct from 'false'::jsonb or
      receipt->'executedCapabilities' is distinct from '[]'::jsonb or receipt->'modelRoutingExecuted' is distinct from 'true'::jsonb or
      receipt->'mockProvider' is distinct from 'true'::jsonb or receipt->>'providerType' is distinct from 'mock' or
      receipt->>'configuredExecutionMode' is distinct from 'model_router' or receipt->'outputValidated' is distinct from 'true'::jsonb or
      receipt->>'modelRouteKey' is distinct from worker->'execution'->>'routeKey' or
      receipt->>'providerRequestId' not like 'simulation:%' or nullif(receipt->>'providerRequestId','') is null or
      receipt->'totalReportedCostUsd' is distinct from '0'::jsonb or receipt->'totalEstimatedCostUsd' is distinct from '0'::jsonb or
      v_output->>'mode' is distinct from 'simulation' or receipt->>'stopReason' is distinct from v_output->>'stopReason' or
      v_output->>'stopReason' is distinct from stage->'completionCriteria'->>'requiredStopReason' or
      (v_stage_key='review' and (v_output->'publicationAllowed' is distinct from 'false'::jsonb or
        v_output->'liveQualification' is distinct from 'false'::jsonb or coalesce(v_output->>'outcome','') not in ('needs_evidence','blocked'))) then
      raise exception 'Invalid mock-only simulation output or receipt.' using errcode='22023';
    end if;
  end if;
  if p_operation='simulation_review_requested' then
    if i.id is not null and r.status in ('needs_owner','completed','cancelled') then
      return jsonb_build_object('status',r.status,'interventionId',i.id); end if;
    v_result:=private.stage10_installed_pack_runtime_transition(r.id,r.business_id,p_runtime_capability,'output','{}');
    v_output:=v_result->'output';
    if (select count(*) from public.worker_runs where workflow_run_id=r.id and status='completed' and
      execution_metadata->'receipt'->>'executionMode'='simulation.model_router' and
      execution_metadata->'receipt'->'providerExecuted'='false'::jsonb and execution_metadata->'receipt'->'qualificationEvaluated'='false'::jsonb)<>3 or
      v_output->>'mode' is distinct from 'simulation' or v_output->'publicationAllowed' is distinct from 'false'::jsonb or v_output->'liveQualification' is distinct from 'false'::jsonb then
      raise exception 'Three validated mock worker outputs are required.'; end if;
    insert into public.owner_interventions(id,business_id,workflow_run_id,intervention_type,status,title,description,options)
      values(v_id,r.business_id,r.id,'etsy_simulation_review','open','Review simulated Etsy discovery',
        'This mock-only run produced the unvalidated hypothesis: '||left(coalesce(v_output->'strategy'->'hypothesis'->>'conceptName','unnamed concept'),240)||'. Outcome: '||coalesce(v_output->>'outcome','unknown')||
        '. Evidence gaps: '||coalesce((select string_agg(replace(value,'_',' '),', ') from jsonb_array_elements_text(v_output->'reasons')),'unknown')||
        '. Acknowledgment closes this simulation only; it does not qualify workers, validate demand, authorize publication, or spend money.',
        '[{"id":"acknowledge","label":"Acknowledge simulated result"},{"id":"stop","label":"Stop simulation"}]') on conflict(id) do nothing;
    update public.workflow_runs set status='needs_owner',current_stage_key='simulation-review',state=jsonb_build_object(
      'mode','simulation','providerExecuted',false,'qualificationEvaluated',false,'publicationAllowed',false,'output',v_output,'ownerReview','pending') where id=r.id;
    insert into public.events(id,business_id,workflow_run_id,event_type,actor_type,payload) values
      (private.stage4_deterministic_uuid('etsy:simulation-review-requested:'||r.id),r.business_id,r.id,'owner_intervention.requested','system',
        jsonb_build_object('mode','simulation','interventionId',v_id,'outcome',v_output->>'outcome','publicationAllowed',false,'qualificationEvaluated',false)) on conflict(id) do nothing;
    return jsonb_build_object('status','needs_owner','interventionId',v_id);
  elsif p_operation='simulation_review_resolved' then
    if i.id is null or i.resolution->>'decision' is null or
      p_payload->>'decision' is distinct from i.resolution->>'decision' or
      p_payload->>'ownerUserId' is distinct from i.resolution->>'ownerUserId' or
      p_payload->>'decidedAt' is distinct from i.resolution->>'decidedAt' or
      not exists(select 1 from public.businesses b where b.id=r.business_id and b.owner_user_id::text=i.resolution->>'ownerUserId') then
      raise exception 'Persisted owner simulation decision required.' using errcode='42501'; end if;
    if r.status in ('completed','cancelled') then return jsonb_build_object('status',r.status,'mode','simulation'); end if;
    if r.status<>'needs_owner' or i.status<>'open' then raise exception 'Simulation review is not open.'; end if;
    v_resolution:=i.resolution;
    if v_resolution->>'decision'='acknowledge' then
      update public.workflow_runs set status='running' where id=r.id;
      v_result:=private.stage10_installed_pack_runtime_transition(r.id,r.business_id,p_runtime_capability,'complete','{}');
    elsif v_resolution->>'decision'='stop' then
      update public.workflow_runs set status='cancelled',current_stage_key=null,completed_at=coalesce(completed_at,now()) where id=r.id;
      v_result:=jsonb_build_object('status','cancelled');
      insert into public.events(id,business_id,workflow_run_id,event_type,actor_type,payload) values
        (private.stage4_deterministic_uuid('etsy:simulation-stopped:'||r.id),r.business_id,r.id,'workflow.cancelled','owner',v_resolution) on conflict(id) do nothing;
    else raise exception 'Unknown simulation decision.'; end if;
    update public.owner_interventions set status=(case when v_resolution->>'decision'='acknowledge' then 'resolved' else 'declined' end),resolved_at=now() where id=i.id;
    update public.workflow_runs set state=state||jsonb_build_object('mode','simulation','providerExecuted',false,'qualificationEvaluated',false,
      'publicationAllowed',false,'ownerReview',v_resolution->>'decision') where id=r.id;
    insert into public.events(id,business_id,workflow_run_id,event_type,actor_type,actor_id,payload) values
      (private.stage4_deterministic_uuid('etsy:simulation-review-resolved:'||r.id),r.business_id,r.id,'owner_intervention.resolved','owner',v_resolution->>'ownerUserId',v_resolution) on conflict(id) do nothing;
    return v_result||jsonb_build_object('mode','simulation');
  elsif p_operation='complete' then
    -- Even a valid runtime capability must go through the owner-decision transition.
    if r.status='completed' and i.status='resolved' and i.resolution->>'decision'='acknowledge' then return jsonb_build_object('status','completed','mode','simulation'); end if;
    raise exception 'Simulation completion requires recorded owner acknowledgment.' using errcode='42501';
  elsif p_operation='fail' then
    if r.status in ('completed','cancelled') then return jsonb_build_object('status',r.status); end if;
    v_result:=private.stage10_installed_pack_runtime_transition(r.id,r.business_id,p_runtime_capability,p_operation,p_payload);
    update public.workflow_runs set state=state||jsonb_build_object('mode','simulation','providerExecuted',false,'qualificationEvaluated',false,'publicationAllowed',false) where id=r.id;
    update public.owner_interventions set status='cancelled',resolved_at=now() where id=v_id and status='open';
    return v_result;
  end if;
  if p_operation='output' and r.status='needs_owner' then
    return jsonb_build_object('output',r.state->'output','schema',r.pack_snapshot->'workflow'->'outputSchema')||v_product; end if;
  v_result:=private.stage10_installed_pack_runtime_transition(r.id,r.business_id,p_runtime_capability,p_operation,p_payload);
  if p_operation in ('load','prepare','output') then return v_result||v_product; end if;
  return v_result;
end; $$;

