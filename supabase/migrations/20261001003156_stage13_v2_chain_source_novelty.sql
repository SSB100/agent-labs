-- OFFLINE DRAFT: duplicate-only queries stop before their paid selector.
-- Compare immutable source content across the entire locked goal chain, including
-- raw sources whose selector/later phase failed or whose pack was not imported.
-- The already-paid new raw collection and its charge remain recorded. No retry,
-- extra call, public signature, privilege or v1 behavior is added.

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
            where prior_source.business_id=r.business_id and prior_source.artifact_type='research.sources' and
              exists(select 1 from public.product_experiments prior_root where prior_root.workflow_run_id=prior_source.workflow_run_id and prior_root.business_id=r.business_id and
                prior_root.discovery_version='pod-discovery-2.0' and prior_root.parent_discovery_id is null and (chain_scope->'chainRootIds') ? prior_root.id::text) and
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


