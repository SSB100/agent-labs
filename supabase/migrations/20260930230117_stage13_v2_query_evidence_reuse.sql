-- OFFLINE DRAFT: query-level reuse from a failed discovery root.
-- A completed research stage remains inspectable when a later stage fails.
-- This migration neither marks that root successful nor renews its budget.
-- Existing owner launch/runtime signatures and all public grants are unchanged.

-- One exact completed query may be reused independently of a later failed
-- strategy/review. This grants no success, cost or execution authority to its root.
create function private.stage13v2_validated_evidence(p_artifact_id uuid,p_business_id uuid)
returns jsonb language plpgsql stable set search_path='' as $$
declare a public.artifacts%rowtype; r public.workflow_runs%rowtype; root public.product_experiments%rowtype;
  s public.workflow_stage_runs%rowtype; t public.task_contracts%rowtype; w public.worker_runs%rowtype;
  src public.artifacts%rowtype; input_artifact public.artifacts%rowtype; plan_artifact public.artifacts%rowtype;
  pack jsonb; receipt jsonb; search_receipt jsonb; source_value jsonb; evidence_value jsonb; claim_value jsonb;
  query jsonb; root_release jsonb; closure_keys text[]; hostname text; ordinal integer; call_key text; actual_request text;
begin
  select * into strict a from public.artifacts where id=p_artifact_id and business_id=p_business_id and artifact_type='worker.output' and media_type='application/json';
  select * into strict r from public.workflow_runs where id=a.workflow_run_id and business_id=p_business_id and status in ('running','completed','failed');
  select * into strict root from public.product_experiments where workflow_run_id=r.id and business_id=p_business_id and discovery_version='pod-discovery-2.0' and parent_discovery_id is null and candidate_id is null;
  select value into strict root_release from jsonb_array_elements(r.pack_snapshot->'releases') where value->>'id'=r.pack_snapshot->>'rootPackId';
  select array_agg(value->'manifest'->>'packKey' order by value->'manifest'->>'packKey') into closure_keys from jsonb_array_elements(r.pack_snapshot->'releases');
  if r.pack_snapshot->>'platformQualification' is distinct from 'stage13_v2_bounded_discovery' or
    r.pack_snapshot->'workflow'->>'key' not in ('product.discovery-v2.one','product.discovery-v2.two') or r.pack_snapshot->'workflow'->>'version' is distinct from '1.0.0' or
    root_release->'manifest'->>'packKey' is distinct from 'workflow.product-discovery-v2' or root_release->'manifest'->>'version' is distinct from '1.0.0' or
    not exists(select 1 from jsonb_array_elements(root_release->'manifest'->'workflows') x where x=r.pack_snapshot->'workflow') or
    closure_keys is distinct from array['capability.web-research','knowledge.etsy-current-policy','knowledge.print-on-demand','knowledge.product-research','knowledge.research-evidence-v2','knowledge.social-marketing',
      'worker.product-discovery-v2-plan','worker.product-discovery-v2-research','worker.product-discovery-v2-review','worker.product-discovery-v2-strategy','workflow.product-discovery-v2'] or
    not exists(select 1 from jsonb_array_elements(r.pack_snapshot->'releases') guide cross join lateral jsonb_array_elements(guide->'manifest'->'knowledge') knowledge
      where guide->'manifest'->>'packKey'='knowledge.research-evidence-v2' and knowledge->>'key'='research.evidence-guide' and knowledge->>'version'='2.0.0') or
    exists(select 1 from jsonb_array_elements(r.pack_snapshot->'releases') x where x->'manifest'->>'version' is distinct from '1.0.0' or
      not exists(select 1 from public.packs p where p.id=(x->>'id')::uuid and p.manifest=x->'manifest')) or
    r.input is distinct from jsonb_build_object('intentId',root.id) or root.variables->'intent'->>'id' is distinct from root.id::text or
    root.variables->'intent'->>'businessId' is distinct from p_business_id::text or root.variables->>'policyHash' is distinct from private.stage14_hash(root.variables->'intent') then
    raise exception 'Exact same-Business persisted discovery/query origin required.';
  end if;
  -- Account linkage is checked without renewing old intent or knowledge expiry.
  -- Only the retained source's own freshness governs reuse of its public facts.
  perform private.stage13v2_budget_authority(root.id,false);
  select * into strict s from public.workflow_stage_runs where workflow_run_id=r.id and business_id=p_business_id and stage_key=a.metadata->>'stageKey' and stage_key in ('research1','research2') and attempt=1 and status='completed';
  ordinal:=right(s.stage_key,1)::integer;
  if ordinal>(root.variables->'intent'->'limits'->>'maximumNewCollections')::integer then raise exception 'Query ordinal exceeds its original finite scope.'; end if;
  select * into strict t from public.task_contracts where id=private.stage4_deterministic_uuid('pack:task:'||r.id||':'||s.stage_key) and id=a.task_contract_id and workflow_stage_run_id=s.id and workflow_run_id=r.id and business_id=p_business_id and status='completed';
  select * into strict w from public.worker_runs where id=private.stage4_deterministic_uuid('pack:worker:'||r.id||':'||s.stage_key) and workflow_run_id=r.id and business_id=p_business_id and task_contract_id=t.id and worker_definition_id=t.worker_definition_id and status='completed';
  select * into strict src from public.artifacts where id=private.stage4_deterministic_uuid('research:sources:'||r.id||':'||s.stage_key) and workflow_run_id=r.id and business_id=p_business_id and task_contract_id=t.id and artifact_type='research.sources' and media_type='application/json';
  select * into strict input_artifact from public.artifacts where id=private.stage4_deterministic_uuid('pack:input:'||r.id||':'||s.stage_key) and workflow_run_id=r.id and business_id=p_business_id and artifact_type='pack.stage-input';
  select * into strict plan_artifact from public.artifacts where id=private.stage4_deterministic_uuid('pack:output:'||r.id||':plan') and workflow_run_id=r.id and business_id=p_business_id and artifact_type='worker.output';
  select value into strict query from jsonb_array_elements(plan_artifact.content->'queries') where value->'ordinal'=to_jsonb(ordinal);
  if plan_artifact.content->>'intentId' is distinct from root.id::text or plan_artifact.content->>'version' is distinct from 'pod-discovery-2.0' or
    not exists(select 1 from public.workflow_stage_runs ps where ps.workflow_run_id=r.id and ps.business_id=p_business_id and ps.stage_key='plan' and ps.status='completed' and ps.output=plan_artifact.content) or
    query->>'queryId' is distinct from private.stage4_deterministic_uuid('discovery:v2:query:'||root.id||':'||ordinal)::text or
    input_artifact.content->>'kind' is distinct from 'research' or input_artifact.content->'ordinal' is distinct from to_jsonb(ordinal) or
    input_artifact.content->>'queryId' is distinct from query->>'queryId' or input_artifact.content->>'question' is distinct from query->>'question' or
    input_artifact.content->'sourceDomains' is distinct from query->'sourceDomains' or query->'sourceDomains' is distinct from root.variables->'intent'->'comparisonUniverse'->'sourceDomains' or
    not(input_artifact.id=any(t.input_artifact_ids)) or not(src.id=any(t.input_artifact_ids)) then raise exception 'Evidence query differs from its original prepared plan and task input.'; end if;
  receipt:=a.metadata->'receipt'; search_receipt:=src.content->'providerMetadata'->'receipt'; pack:=a.content->'evidencePack';
  if a.id<>private.stage4_deterministic_uuid('pack:output:'||r.id||':'||s.stage_key) or a.content is distinct from s.output or a.content is distinct from w.output or
    w.execution_metadata->'receipt' is distinct from receipt or w.execution_metadata->>'outputArtifactId' is distinct from a.id::text or
    not exists(select 1 from public.worker_definitions d join public.packs p on p.id=d.pack_id where d.id=w.worker_definition_id and d.worker_key='product.discovery-v2.research' and d.version='1.0.0' and p.pack_key='worker.product-discovery-v2-research' and p.version='1.0.0') or
    receipt->>'receiptVersion' is distinct from '1.0' or receipt->>'packKey' is distinct from 'worker.product-discovery-v2-research' or receipt->>'packVersion' is distinct from '1.0.0' or
    receipt->>'workerKey' is distinct from 'product.discovery-v2.research' or receipt->>'workerVersion' is distinct from '1.0.0' or receipt->>'taskContractId' is distinct from t.id::text or
    receipt->'inputArtifactIds' is distinct from to_jsonb(t.input_artifact_ids) or receipt->>'stopReason' is distinct from 'evidence_collected' or
    src.content->>'collectionVersion' is distinct from '1.0' or src.content->>'query' is distinct from query->>'question' or
    src.content->'providerMetadata'->>'intentId' is distinct from root.id::text or src.content->'providerMetadata'->>'queryId' is distinct from query->>'queryId' or
    src.content->'providerMetadata'->>'callKey' is distinct from 'search:'||ordinal or src.content->'providerMetadata'->'searchRequests' is distinct from '1'::jsonb or
    src.content->'providerMetadata'->>'engine' is distinct from 'exa' or search_receipt->>'providerRequestId' is distinct from src.content->'providerMetadata'->>'providerRequestId' then
    raise exception 'The completed query needs immutable source and selector task provenance.';
  end if;
  foreach call_key in array array['search:'||ordinal,'select:'||ordinal] loop
    claim_value:=(case when call_key like 'search:%' then search_receipt else receipt end);
    actual_request:=claim_value->>'providerRequestId';
    if claim_value->>'executionMode' is distinct from 'web.research' or claim_value->>'provider' is distinct from 'openrouter' or claim_value->>'actualProviderModelId' is distinct from 'openai/gpt-5.6-luna' or
      claim_value->'primaryOnly' is distinct from 'true'::jsonb or claim_value->'mockProvider' is distinct from 'false'::jsonb or claim_value->'outputValidated' is distinct from 'true'::jsonb or
      claim_value->>'intentId' is distinct from root.id::text or claim_value->>'queryId' is distinct from query->>'queryId' or claim_value->>'callKey' is distinct from call_key or
      coalesce(length(actual_request),0) not between 3 and 240 or actual_request ~* '(mock|fixture|simulation)' or
      not exists(select 1 from public.product_research_cost_reservations cr join public.product_research_cost_settlements cs on cs.reservation_id=cr.id where
        cr.experiment_id=root.id and cr.business_id=p_business_id and cr.workflow_run_id=r.id and cr.attempt_key=call_key and cr.request_hash ~ '^[a-f0-9]{64}$' and
        cr.estimate->>'version'='discovery-estimate-2.0' and cr.estimate->>'intentId'=root.id::text and cr.estimate->>'policyHash'=root.variables->>'policyHash' and
        cs.reported_microusd is not null and cs.provider_request_id=actual_request) then raise exception 'Both exact query calls must have known, primary-only settled receipts.'; end if;
  end loop;
  if receipt->>'providerRequestId'=search_receipt->>'providerRequestId' then raise exception 'Search and selection cannot reuse the same provider request.'; end if;
  if a.content->>'decision' is distinct from 'complete' or a.content->>'stopReason' is distinct from 'evidence_collected' or
    jsonb_typeof(pack) is distinct from 'object' or not(pack ?& array['evidencePackVersion','question','sources','evidence','claims','limitations']) or
    pack-array['evidencePackVersion','question','sources','evidence','claims','limitations']<>'{}'::jsonb or pack->>'evidencePackVersion' is distinct from '1.0' or pack->>'question' is distinct from query->>'question' or
    jsonb_typeof(pack->'sources') is distinct from 'array' or jsonb_array_length(pack->'sources') not between 1 and 4 or
    jsonb_typeof(pack->'evidence') is distinct from 'array' or jsonb_array_length(pack->'evidence') not between 1 and 4 or
    jsonb_typeof(pack->'claims') is distinct from 'array' or jsonb_array_length(pack->'claims')<>jsonb_array_length(pack->'evidence') or
    jsonb_typeof(pack->'limitations') is distinct from 'array' or exists(select 1 from jsonb_array_elements(pack->'limitations') l where jsonb_typeof(l)<>'string') or
    (select count(distinct x->>'id') from jsonb_array_elements(pack->'sources') x)<>jsonb_array_length(pack->'sources') or
    (select count(distinct x->>'id') from jsonb_array_elements(pack->'evidence') x)<>jsonb_array_length(pack->'evidence') then raise exception 'Invalid immutable query Evidence Pack.'; end if;
  for source_value in select value from jsonb_array_elements(pack->'sources') loop
    hostname:=substring(source_value->>'url' from '^https://([a-z0-9.-]+)/');
    if not exists(select 1 from jsonb_array_elements(src.content->'sources') x where x=source_value) or
      not(source_value ?& array['id','url','title','retrievedAt','publishedAt','retrievalExpiresAt','contentHash','excerpt','provider']) or
      source_value-array['id','url','title','retrievedAt','publishedAt','retrievalExpiresAt','contentHash','excerpt','provider']<>'{}'::jsonb or
      jsonb_typeof(source_value->'title') is distinct from 'string' or jsonb_typeof(source_value->'publishedAt') not in ('null','string') or source_value->>'provider' is distinct from 'openrouter.exa' or
      hostname is null or source_value->>'url' ~ '[#[:space:]]' or source_value->>'url' ~* '[?&](token|access_token|api_key|auth|password|utm_[^=]*|fbclid|gclid)=' or
      not exists(select 1 from jsonb_array_elements_text(query->'sourceDomains') d where hostname=d or hostname like '%.'||d) or
      jsonb_typeof(source_value->'excerpt') is distinct from 'string' or length(source_value->>'excerpt') not between 30 and 1800 or
      source_value->>'contentHash' is distinct from private.stage13_hash(source_value->>'excerpt') or
      source_value->>'id' is distinct from 'src-'||left(private.stage13_hash((source_value->>'url')||':'||(source_value->>'contentHash')),24) or
      jsonb_typeof(source_value->'retrievedAt') is distinct from 'string' or jsonb_typeof(source_value->'retrievalExpiresAt') is distinct from 'string' or
      (source_value->>'retrievedAt')::timestamptz>clock_timestamp()+interval '5 minutes' or (source_value->>'retrievalExpiresAt')::timestamptz<=clock_timestamp() or
      (source_value->>'retrievalExpiresAt')::timestamptz<=(source_value->>'retrievedAt')::timestamptz or (source_value->>'retrievalExpiresAt')::timestamptz>(source_value->>'retrievedAt')::timestamptz+interval '1 day' or
      not exists(select 1 from jsonb_array_elements(pack->'evidence') e where e->>'sourceId'=source_value->>'id') then raise exception 'Retained query source is stale, forged or outside its exact domain scope.'; end if;
  end loop;
  for evidence_value in select value from jsonb_array_elements(pack->'evidence') loop
    if not(evidence_value ?& array['id','sourceId','quote']) or evidence_value-array['id','sourceId','quote']<>'{}'::jsonb or jsonb_typeof(evidence_value->'quote') is distinct from 'string' or length(evidence_value->>'quote') not between 20 and 320 or
      evidence_value->>'id' is distinct from 'evi-'||left(private.stage13_hash((evidence_value->>'sourceId')||':'||(evidence_value->>'quote')),24) or
      not exists(select 1 from jsonb_array_elements(pack->'sources') x where x->>'id'=evidence_value->>'sourceId' and strpos(x->>'excerpt',evidence_value->>'quote')>0) or
      (select count(*) from jsonb_array_elements(pack->'claims') x where x->>'evidenceId'=evidence_value->>'id' and x->>'sourceId'=evidence_value->>'sourceId' and x->>'text'=evidence_value->>'quote')<>1 then raise exception 'Selected evidence must be an exact retained quote with its canonical identity.'; end if;
  end loop;
  for claim_value in select value from jsonb_array_elements(pack->'claims') loop
    if not(claim_value ?& array['text','evidenceId','sourceId']) or claim_value-array['text','evidenceId','sourceId']<>'{}'::jsonb or
      not exists(select 1 from jsonb_array_elements(pack->'evidence') x where x->>'id'=claim_value->>'evidenceId' and x->>'sourceId'=claim_value->>'sourceId' and x->>'quote'=claim_value->>'text') then raise exception 'Retained claims must preserve exact source support.'; end if;
  end loop;
  return jsonb_build_object('artifactId',a.id,'businessId',p_business_id,'workflowRunId',r.id,'queryId',query->>'queryId','collectedForIntentId',root.id,
    'question',query->>'question','sourceDomains',query->'sourceDomains','evidencePack',pack,'lineage',jsonb_build_object('status','completed','executionMode','web.research','provider','openrouter.exa',
      'sourceArtifactId',src.id,'providerRequestId',search_receipt->>'providerRequestId','workerRequestId',receipt->>'providerRequestId'));
end; $$;
revoke all on function private.stage13v2_validated_evidence(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.begin_installed_pack_run(p_business_id uuid,p_installation_id uuid,p_workflow_key text,p_input jsonb,p_idempotency_key text,p_launch_nonce uuid,p_runtime_capability text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_install public.installed_packs%rowtype; v_definition public.workflow_definitions%rowtype; v_workflow jsonb; v_id uuid; s jsonb; n integer:=0;
  chain_scope jsonb; authority_id uuid; prior_query jsonb;
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
      select * into strict prior_run from public.workflow_runs where id=prior_artifact.workflow_run_id and business_id=p_business_id and status in ('completed','failed');
      if prior_run.pack_snapshot->'workflow'->>'key'='research.public-evidence' then
        prior_pack:=private.stage13_validated_evidence(prior_id,p_business_id,true);
      else
        -- Validate the exact completed selector query, not whole-root success.
        prior_query:=private.stage13v2_validated_evidence(prior_id,p_business_id);
        prior_pack:=prior_query->'evidencePack';
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



create or replace function private.stage13v2_runtime_context(p_workflow_run_id uuid,p_stage_key text default null)
returns jsonb language plpgsql set search_path='' as $$
declare r public.workflow_runs%rowtype; root public.product_experiments%rowtype; e public.product_experiments%rowtype;
  a public.artifacts%rowtype; source_artifact public.artifacts%rowtype; input_artifact public.artifacts%rowtype;
  stage_row public.workflow_stage_runs%rowtype; task_row public.task_contracts%rowtype; worker_row public.worker_runs%rowtype;
  source_run public.workflow_runs%rowtype; candidate public.product_candidates%rowtype;
  persisted_query jsonb; scope jsonb; phase jsonb; validated jsonb; knowledge jsonb; pins jsonb:='[]'; item jsonb; rel jsonb; k jsonb;
  plan jsonb; query jsonb; dossier jsonb; packs jsonb:='[]'; candidates jsonb:='[]'; refs jsonb:='[]'; pack jsonb;
  receipt jsonb; search_receipt jsonb; src jsonb; evidence jsonb; claim jsonb; identity jsonb; strategy jsonb;
  dossier_refs jsonb; shortlist jsonb; proposal jsonb; prior_artifact_id uuid; candidate_fingerprint text;
  closure_keys text[]; expected_keys text[]; ordinal integer; offset_start integer; count_roots integer; source_intent uuid; hostname text;
begin
  select * into strict r from public.workflow_runs where id=p_workflow_run_id;
  select count(*) into count_roots from public.product_experiments where workflow_run_id=r.id and business_id=r.business_id and parent_discovery_id is null;
  if count_roots=0 then
    if exists(select 1 from public.product_experiments where workflow_run_id=r.id) or
      r.pack_snapshot->'workflow'->>'key' in ('product.discovery-v2.one','product.discovery-v2.two') then
      raise exception 'Product workflow linkage is missing or inconsistent.'; end if;
    return jsonb_build_object('productScope',null,'discoveryPhase',null);
  end if;
  if count_roots<>1 and (r.status<>'completed' or exists(select 1 from public.product_experiments where workflow_run_id=r.id and discovery_version='pod-discovery-2.0')) then
    raise exception 'Active product workflow linkage is ambiguous.'; end if;
  select * into strict root from public.product_experiments where workflow_run_id=r.id and business_id=r.business_id and parent_discovery_id is null
    order by (basis_artifact_id is null) desc,created_at,id limit 1;
  if root.discovery_version='pod-discovery-1.0' then
    if root.candidate_id is null or r.pack_snapshot->'workflow'->>'key' is distinct from 'research.public-evidence' then raise exception 'Legacy product workflow linkage is invalid.'; end if;
    return jsonb_build_object('productScope',jsonb_build_object('version','pod-discovery-1.0','experimentId',root.id),'discoveryPhase',null);
  end if;
  validated:=private.stage13v2_validate_persisted(root.id,false);
  expected_keys:=array['capability.web-research','knowledge.etsy-current-policy','knowledge.print-on-demand','knowledge.product-research',
    'knowledge.research-evidence-v2','knowledge.social-marketing','worker.product-discovery-v2-plan','worker.product-discovery-v2-research',
    'worker.product-discovery-v2-review','worker.product-discovery-v2-strategy','workflow.product-discovery-v2'];
  select array_agg(x->'manifest'->>'packKey' order by x->'manifest'->>'packKey') into closure_keys from jsonb_array_elements(r.pack_snapshot->'releases') x;
  if r.pack_snapshot->>'platformQualification' is distinct from 'stage13_v2_bounded_discovery' or closure_keys is distinct from expected_keys or
    r.pack_snapshot->'releases' is distinct from private.stage10_resolve((r.pack_snapshot->>'rootPackId')::uuid,true) or
    not exists(select 1 from public.packs p where p.id=(r.pack_snapshot->>'rootPackId')::uuid and p.pack_key='workflow.product-discovery-v2' and p.version='1.0.0' and p.status='experimental') or
    exists(select 1 from jsonb_array_elements(r.pack_snapshot->'releases') x where x->'manifest'->>'version' is distinct from '1.0.0' or
      (x->'manifest'->>'packKey' like '%product-discovery-v2%' and x->>'status' is distinct from 'experimental') or
      (x->'manifest'->>'packKey' not like '%product-discovery-v2%' and x->>'status' not in ('experimental','qualified'))) then
    raise exception 'Only the exact registered experimental v2 closure is eligible.';
  end if;
  if exists(select 1 from jsonb_array_elements(r.pack_snapshot->'workflow'->'stages') s where
    s->>'workerVersion' is distinct from '1.0.0' or s->>'workerKey' is distinct from
      (case when s->>'key' in ('research1','research2') then 'product.discovery-v2.research' else 'product.discovery-v2.'||(s->>'key') end) or
    s->'permittedCapabilities' is distinct from (case when s->>'key' in ('research1','research2') then '["web.research"]'::jsonb else '[]'::jsonb end)) then
    raise exception 'Discovery stage workers or capabilities do not match the finite lane.';
  end if;
  for k,rel in select x.value,y.value from jsonb_array_elements(r.pack_snapshot->'releases') y cross join lateral jsonb_array_elements(y.value->'manifest'->'knowledge') x
    where x.value->>'key' in ('etsy.current-policy','pod.production','product.research','social.marketing','research.evidence-guide') order by x.value->>'key' loop
    if k->>'key'='research.evidence-guide' and (k->>'version' is distinct from '2.0.0' or rel->'manifest'->>'packKey' is distinct from 'knowledge.research-evidence-v2') then
      raise exception 'V2 research needs its exact-span guide version 2.0.0, not legacy prefix-ID instructions.'; end if;
    if (k->>'verifiedAt')::timestamptz>clock_timestamp() or (k->>'freshnessDays')::integer not between 1 and 365 or
      (k->>'verifiedAt')::timestamptz+(k->>'freshnessDays')::integer*interval '1 day'<=clock_timestamp() then
      raise exception 'Pinned discovery knowledge is stale or future dated.'; end if;
    pins:=pins||jsonb_build_array(jsonb_build_object('releaseId',rel->>'id','packKey',rel->'manifest'->>'packKey','packVersion',rel->'manifest'->>'version',
      'manifestHash',private.stage14_hash(rel->'manifest'),'knowledgeKey',k->>'key','knowledgeVersion',k->>'version','contentHash',private.stage14_hash(k->'content')));
  end loop;
  if jsonb_array_length(pins)<>5 or (select count(distinct x->>'knowledgeKey') from jsonb_array_elements(pins) x)<>5 then raise exception 'All five unambiguous pinned knowledge records are required.'; end if;
  knowledge:=jsonb_build_object('snapshot',r.pack_snapshot-array['workflow','platformQualification'],'records',pins);
  scope:=jsonb_build_object('version','pod-discovery-2.0','rootId',root.id,'intent',validated->'intent','quote',validated->'budgetQuote',
    'budgetScope',jsonb_build_object('intentId',root.id,'maximumCollections',validated->'maximumCollections','maximumMicrousd',validated->'maximumMicrousd','policyHash',validated->>'policyHash'),
    'committedMicrousd',validated->'committedMicrousd','hasUncertainCosts',validated->'hasUncertainCosts');
  if p_stage_key is null then return jsonb_build_object('productScope',scope,'discoveryPhase',null); end if;
  if p_stage_key='plan' then
    if jsonb_typeof(root.variables->'ownerKickoff'->'focus') is distinct from 'string' or length(btrim(root.variables->'ownerKickoff'->>'focus')) not between 20 and 1200 then raise exception 'A bounded persisted owner research focus is required.'; end if;
    phase:=jsonb_build_object('kind','plan','intent',validated->'intent','focus',root.variables->'ownerKickoff'->>'focus','knowledge',knowledge);
  else
    select content into plan from public.artifacts where id=private.stage4_deterministic_uuid('pack:output:'||r.id||':plan') and business_id=r.business_id and workflow_run_id=r.id and artifact_type='worker.output';
    if plan is null or plan->>'version' is distinct from 'pod-discovery-2.0' or plan->>'intentId' is distinct from root.id::text or
      not exists(select 1 from public.workflow_stage_runs where workflow_run_id=r.id and stage_key='plan' and status='completed' and output=plan) then raise exception 'An immutable completed discovery plan is required.'; end if;
    if p_stage_key in ('research1','research2') then
      ordinal:=right(p_stage_key,1)::integer;
      select value into strict query from jsonb_array_elements(plan->'queries') where value->'ordinal'=to_jsonb(ordinal);
      if ordinal>(validated->>'maximumCollections')::integer or query->>'queryId' is distinct from private.stage4_deterministic_uuid('discovery:v2:query:'||root.id||':'||ordinal)::text or
        jsonb_typeof(query->'question') is distinct from 'string' or length(query->>'question') not between 5 and 800 or
        query->'sourceDomains' is distinct from root.variables->'intent'->'comparisonUniverse'->'sourceDomains' then raise exception 'Prepared query is outside the immutable discovery scope.'; end if;
      phase:=jsonb_build_object('kind','research','ordinal',ordinal,'queryId',query->>'queryId','question',query->>'question','sourceDomains',query->'sourceDomains','knowledge',knowledge);
    elsif p_stage_key in ('strategy','review') then
      if p_stage_key='strategy' and root.source_artifact_id is null then
        if r.status<>'running' or root.status not in ('reserved','researching') or
          exists(select 1 from public.workflow_stage_runs where workflow_run_id=r.id and stage_key in ('research1','research2') and status<>'completed') then raise exception 'All finite research stages must complete before freezing a dossier.'; end if;
        dossier_refs:='[]'; shortlist:='[]';
        for query in select value from jsonb_array_elements(plan->'queries') order by (value->>'ordinal')::integer loop
          select * into strict a from public.artifacts where id=private.stage4_deterministic_uuid('pack:output:'||r.id||':research'||(query->>'ordinal')) and business_id=r.business_id and workflow_run_id=r.id and artifact_type='worker.output';
          dossier_refs:=dossier_refs||jsonb_build_array(jsonb_build_object('artifactId',a.id,'sha256',private.stage14_hash(a.content->'evidencePack'),'origin','new',
            'query',jsonb_build_object('id',query->>'queryId','question',query->>'question','sourceDomains',query->'sourceDomains')));
        end loop;
        for prior_artifact_id in select value::uuid from jsonb_array_elements_text(root.variables->'priorArtifactIds') loop
          select * into strict a from public.artifacts where id=prior_artifact_id and business_id=r.business_id and artifact_type='worker.output';
          select * into strict source_run from public.workflow_runs where id=a.workflow_run_id and business_id=r.business_id and status in ('completed','failed');
          if source_run.pack_snapshot->'workflow'->>'key'='research.public-evidence' then
            query:=jsonb_build_object('id',private.stage4_deterministic_uuid('discovery:v2:prior-query:'||a.id),'question',source_run.input->>'question','sourceDomains',source_run.input->'sourceDomains');
          else
            select content into strict query from public.artifacts where id=private.stage4_deterministic_uuid('pack:input:'||source_run.id||':'||(a.metadata->>'stageKey')) and business_id=r.business_id and workflow_run_id=source_run.id and artifact_type='pack.stage-input';
            query:=jsonb_build_object('id',query->>'queryId','question',query->>'question','sourceDomains',query->'sourceDomains');
          end if;
          if not exists(select 1 from jsonb_array_elements(root.variables->'priorEvidenceHashes') x where x->>'artifactId'=a.id::text and x->>'sha256'=private.stage14_hash(a.content->'evidencePack')) then raise exception 'Prior evidence differs from the owner kickoff snapshot.'; end if;
          dossier_refs:=dossier_refs||jsonb_build_array(jsonb_build_object('artifactId',a.id,'sha256',private.stage14_hash(a.content->'evidencePack'),'origin','prior','query',query));
        end loop;
        if jsonb_typeof(plan->'proposals') is distinct from 'array' or jsonb_array_length(plan->'proposals') not between 1 and 3 then raise exception 'A bounded concept shortlist is required.'; end if;
        for proposal in select value from jsonb_array_elements(plan->'proposals') loop
          if not((root.variables->'intent'->'comparisonUniverse'->'audiences') ? (proposal->>'audience')) or
            length(btrim(proposal->>'concept')) not between 3 and 160 or length(btrim(proposal->>'audience')) not between 3 and 160 or
            length(btrim(proposal->>'hypothesis')) not between 20 and 500 or proposal ? 'marketCountryCode' then raise exception 'Candidate concepts cannot preselect a selling country or leave the audience scope.'; end if;
          candidate_fingerprint:=private.stage13_hash('original_pod_tshirt:'||private.stage13_normalize(proposal->>'concept')||':'||private.stage13_normalize(proposal->>'audience'));
          insert into public.product_candidates(business_id,fingerprint,concept,audience,hypothesis,original_design,rights_status,source_domains)
            values(r.business_id,candidate_fingerprint,btrim(proposal->>'concept'),btrim(proposal->>'audience'),btrim(proposal->>'hypothesis'),true,'unclear',
              array(select jsonb_array_elements_text(root.variables->'intent'->'comparisonUniverse'->'sourceDomains'))) on conflict(business_id,fingerprint) do nothing;
          select * into strict candidate from public.product_candidates where business_id=r.business_id and fingerprint=candidate_fingerprint;
          -- Existing identity, originality and rights are retained verbatim. A model
          -- proposal never upgrades rights or rewrites the original hypothesis.
          shortlist:=shortlist||jsonb_build_array(jsonb_build_object('id',candidate.id,'businessId',candidate.business_id,'concept',candidate.concept,'audience',candidate.audience,
            'productType',candidate.product_type,'originalDesign',candidate.original_design,'rightsStatus',candidate.rights_status));
        end loop;
        dossier:=jsonb_build_object('version','pod-discovery-2.0','intentId',root.id,'businessId',r.business_id,'packRefs',dossier_refs,'shortlist',shortlist,'comparisonRationale',plan->>'comparisonRationale');
        insert into public.artifacts(id,business_id,workflow_run_id,artifact_type,name,media_type,content,metadata)
          values(private.stage4_deterministic_uuid('discovery:v2:dossier:'||r.id),r.business_id,r.id,'product.discovery-dossier.v2','Immutable geographic discovery dossier','application/json',dossier,
            jsonb_build_object('intentId',root.id,'version','pod-discovery-2.0','contentHash',private.stage14_hash(dossier)));
        update public.product_experiments set status='researching',source_artifact_id=private.stage4_deterministic_uuid('discovery:v2:dossier:'||r.id),
          evidence_pack=jsonb_build_object('version','pod-discovery-2.0','intentId',root.id,'dossierArtifactId',private.stage4_deterministic_uuid('discovery:v2:dossier:'||r.id),
            'strategyArtifactId',private.stage4_deterministic_uuid('pack:output:'||r.id||':strategy'),'reviewArtifactId',private.stage4_deterministic_uuid('pack:output:'||r.id||':review')) where id=root.id;
        select * into strict root from public.product_experiments where id=root.id;
      end if;
      select content into dossier from public.artifacts where id=root.source_artifact_id and id=private.stage4_deterministic_uuid('discovery:v2:dossier:'||r.id)
        and business_id=r.business_id and workflow_run_id=r.id and artifact_type='product.discovery-dossier.v2';
      if dossier is null or octet_length(dossier::text)>16384 or dossier->>'version' is distinct from 'pod-discovery-2.0' or dossier->>'intentId' is distinct from root.id::text or
        dossier->>'businessId' is distinct from r.business_id::text or jsonb_typeof(dossier->'packRefs') is distinct from 'array' or jsonb_array_length(dossier->'packRefs') not between 1 and 6 or
        jsonb_typeof(dossier->'shortlist') is distinct from 'array' or jsonb_array_length(dossier->'shortlist') not between 1 and 3 or
        dossier-array['version','intentId','businessId','packRefs','shortlist','comparisonRationale']<>'{}'::jsonb then raise exception 'A bounded persisted dossier is required before strategy or review.'; end if;
      for identity in select value from jsonb_array_elements(dossier->'shortlist') loop
        select * into strict candidate from public.product_candidates where id=(identity->>'id')::uuid and business_id=r.business_id;
        if identity is distinct from jsonb_build_object('id',candidate.id,'businessId',candidate.business_id,'concept',candidate.concept,'audience',candidate.audience,
          'productType',candidate.product_type,'originalDesign',candidate.original_design,'rightsStatus',candidate.rights_status) then raise exception 'Dossier candidate identity changed.'; end if;
        candidates:=candidates||jsonb_build_array(identity);
      end loop;
      for item in select value from jsonb_array_elements(dossier->'packRefs') loop
        select * into strict a from public.artifacts where id=(item->>'artifactId')::uuid and business_id=r.business_id and artifact_type='worker.output';
        select * into strict source_run from public.workflow_runs where id=a.workflow_run_id and business_id=r.business_id;
        source_intent:=null;
        select id into source_intent from public.product_experiments where workflow_run_id=source_run.id and business_id=r.business_id and discovery_version='pod-discovery-2.0' and parent_discovery_id is null;
        if item->>'origin' is distinct from (case when source_intent=root.id then 'new' else 'prior' end) then raise exception 'Research origin cannot be relabeled.'; end if;
        if source_intent is null then
          pack:=private.stage13_validated_evidence(a.id,r.business_id,true);
          query:=jsonb_build_object('id',private.stage4_deterministic_uuid('discovery:v2:prior-query:'||a.id),'question',source_run.input->>'question','sourceDomains',source_run.input->'sourceDomains');
          select * into strict source_artifact from public.artifacts where id=private.stage4_deterministic_uuid('research:sources:'||source_run.id||':research') and business_id=r.business_id;
          receipt:=a.metadata->'receipt';
        else
          persisted_query:=private.stage13v2_validated_evidence(a.id,r.business_id);
          pack:=persisted_query->'evidencePack';
          query:=jsonb_build_object('id',persisted_query->>'queryId','question',persisted_query->>'question','sourceDomains',persisted_query->'sourceDomains');
          select * into strict source_artifact from public.artifacts where id=(persisted_query->'lineage'->>'sourceArtifactId')::uuid and business_id=r.business_id and workflow_run_id=source_run.id;
          receipt:=jsonb_build_object('providerRequestId',persisted_query->'lineage'->>'workerRequestId');
        end if;
        if item->>'sha256' is distinct from private.stage14_hash(pack) or item->'query' is distinct from query or
          exists(select 1 from jsonb_array_elements_text(query->'sourceDomains') d where not((root.variables->'intent'->'comparisonUniverse'->'sourceDomains') ? d)) then raise exception 'Dossier pack hash or immutable query scope changed.'; end if;
        packs:=packs||jsonb_build_array(jsonb_build_object('artifactId',a.id,'businessId',r.business_id,'workflowRunId',source_run.id,'queryId',query->>'id','collectedForIntentId',source_intent,
          'question',query->>'question','sourceDomains',query->'sourceDomains','evidencePack',pack,'lineage',jsonb_build_object('status','completed','executionMode','web.research','provider','openrouter.exa',
          'sourceArtifactId',source_artifact.id,'providerRequestId',source_artifact.content->'providerMetadata'->>'providerRequestId','workerRequestId',receipt->>'providerRequestId')));
        for evidence in select value from jsonb_array_elements(pack->'evidence') loop
          select value into strict src from jsonb_array_elements(pack->'sources') where value->>'id'=evidence->>'sourceId';
          offset_start:=strpos(src->>'excerpt',evidence->>'quote')-1;
          refs:=refs||jsonb_build_array(jsonb_build_object('artifactId',a.id,'evidenceId',evidence->>'id','sourceId',src->>'id','sourceContentHash',src->>'contentHash','start',offset_start,'end',offset_start+length(evidence->>'quote')));
        end loop;
      end loop;
      if (select count(*) from jsonb_array_elements(dossier->'packRefs') x where x->>'origin'='new')<>(validated->>'maximumCollections')::integer or
        (select count(distinct x->>'artifactId') from jsonb_array_elements(dossier->'packRefs') x)<>jsonb_array_length(dossier->'packRefs') or
        (select count(distinct x->>'id') from jsonb_array_elements(candidates) x)<>jsonb_array_length(candidates) then raise exception 'The dossier must contain every finite collection and distinct candidate/pack identities.'; end if;
      phase:=jsonb_build_object('kind',p_stage_key,'dossier',dossier,'validation',jsonb_build_object('packs',packs,'candidates',candidates,'knowledge',knowledge,
        'committedMicrousd',validated->'committedMicrousd','ownerRightsConfirmedCandidateIds','[]'::jsonb,'sellerBankCountry',null),'evidenceReferences',refs);
      if p_stage_key='review' then
        select * into strict a from public.artifacts where id=private.stage4_deterministic_uuid('pack:output:'||r.id||':strategy') and business_id=r.business_id and workflow_run_id=r.id and artifact_type='worker.output';
        strategy:=a.content; receipt:=a.metadata->'receipt';
        if strategy->>'dossierHash' is distinct from private.stage14_hash(dossier) or strategy->>'intentId' is distinct from root.id::text or
          strategy->'execution'->>'modelId' is distinct from 'openai/gpt-5.6-luna' or strategy->'execution'->>'providerRequestId' is distinct from receipt->>'providerRequestId' or
          receipt->>'actualProviderModelId' is distinct from 'openai/gpt-5.6-luna' or receipt->>'outputHash' is distinct from private.stage14_hash(strategy) or
          not exists(select 1 from public.workflow_stage_runs where workflow_run_id=r.id and stage_key='strategy' and status='completed' and output=strategy) then raise exception 'Review requires the actual persisted Luna strategy and receipt.'; end if;
        phase:=phase||jsonb_build_object('assessment',strategy,'actualStrategistExecution',strategy->'execution');
      end if;
    else raise exception 'Unknown discovery phase.'; end if;
  end if;
  select * into input_artifact from public.artifacts where id=private.stage4_deterministic_uuid('pack:input:'||r.id||':'||p_stage_key)
    and workflow_run_id=r.id and business_id=r.business_id and artifact_type='pack.stage-input';
  if input_artifact.id is not null then
    if p_stage_key in ('strategy','review') then
      phase:=jsonb_set(phase,'{validation,committedMicrousd}',input_artifact.content->'validation'->'committedMicrousd');
    end if;
    if input_artifact.content is distinct from phase then raise exception 'Prepared discovery context changed after its immutable snapshot.'; end if;
    phase:=input_artifact.content;
  end if;
  return jsonb_build_object('productScope',scope,'discoveryPhase',phase);
end; $$;
