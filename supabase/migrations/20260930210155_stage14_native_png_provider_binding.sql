-- Stage 14 explicit BFL native-PNG provider-bound approval. DRAFT ONLY.
-- Existing approvals, snapshots, reservations and receipts remain immutable.
-- Replaces only the owner approval and capability-scoped runtime functions with
-- unchanged signatures, ownership, SECURITY DEFINER, search paths and grants.
-- No table, policy, Storage, privilege or existing-data update is included.
-- Runtime is based on 20260930194904, preserving its full source provenance,
-- 20260930194838 one-image bounds and 20260930130626 terminal eligibility guard.
-- New BFL approvals explicitly acknowledge the versioned data-use disclosure:
-- OpenRouter advertises no training and 30-day retention; per-request denial,
-- zero-data-retention routing and contract override are not verified. BFL's API
-- terms contain a training license. This is not a privacy guarantee.

create or replace function public.approve_creative_candidate(p_candidate_id uuid,p_approval jsonb,p_quote jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.product_candidates%rowtype; a public.creative_approvals%rowtype; snapshot jsonb; v_id uuid; maximum bigint; k text; v_scope_hash text;
begin
  select * into c from public.product_candidates candidate where candidate.id=p_candidate_id;
  if auth.uid() is null or c.id is null or not private.is_business_owner(c.business_id) then raise exception 'Business ownership required.' using errcode='42501'; end if;
  if coalesce(length(p_approval::text),0)>50000 or coalesce(length(p_quote::text),0)>10000 then raise exception 'Approval payload is too large.'; end if;
  v_id:=(p_approval->>'approvalId')::uuid;
  if v_id is null then raise exception 'Approval UUID required.'; end if;
  select * into a from public.creative_approvals where creative_approvals.id=v_id;
  if a.id is not null then
    if a.candidate_id<>c.id or a.owner_user_id<>auth.uid() or (a.snapshot-array['approvedAt','approvedBy','candidateAssessment']) is distinct from (p_approval-array['approvedAt','approvedBy','candidateAssessment']) or a.quote is distinct from p_quote then raise exception 'Approval replay differs from immutable approval.'; end if;
    return jsonb_build_object('approvalId',a.id,'approvalHash',a.approval_hash,'snapshot',a.snapshot);
  end if;
  -- The new route requires its own explicit, versioned data-use acknowledgement.
  -- This fixed binding cannot add models, upstreams, request formats or fallbacks.
  if p_quote->>'generatorModel'='black-forest-labs/flux.2-klein-4b' and
    p_quote->'providerBinding' is distinct from '{"provider":"openrouter","upstreamProvider":"black-forest-labs","adapterVersion":"flux-klein-png-1.0","outputFormat":"png","requestedSize":"1024x1024","nativePngRequired":true,"disclosureVersion":"bfl-openrouter-data-use-1.0","ownerAcknowledged":true}'::jsonb then
    raise exception 'Explicit BFL native-PNG contract and owner data-use acknowledgement required.';
  end if;
  -- Serialize duplicate owner clicks/form refreshes before issuing another spending scope.
  perform 1 from public.product_candidates candidate where candidate.id=c.id for update;
  v_scope_hash:=private.stage14_hash(jsonb_build_object('approval',
    (p_approval-array['approvalId','approvedAt','approvedBy','expiresAt','candidateAssessment'])||jsonb_build_object('printSpecification',(p_approval->'printSpecification')-'verifiedAt'),
    'models',jsonb_build_array(p_quote->>'generatorModel',p_quote->>'directorModel',p_quote->>'reviewerModel')));
  select * into a from public.creative_approvals existing where existing.candidate_id=c.id and existing.business_id=c.business_id and existing.scope_hash=v_scope_hash;
  if a.id is not null then return jsonb_build_object('approvalId',a.id,'approvalHash',a.approval_hash,'snapshot',a.snapshot); end if;
  snapshot:=p_approval||jsonb_build_object('approvedAt',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'approvedBy','owner');
  if snapshot->>'purpose'='candidate_production' then
    snapshot:=snapshot||jsonb_build_object('candidateAssessment',(select assessment from public.product_decisions where product_decisions.id=(snapshot->>'decisionId')::uuid and candidate_id=c.id and business_id=c.business_id));
  end if;
  perform private.stage14_assert_approval(c.id,snapshot);
  maximum:=(snapshot->>'maximumMicrousd')::bigint;
  if jsonb_typeof(p_quote) is distinct from 'object' or p_quote->>'version' is distinct from 'creative-estimate-1.0' or
    coalesce(p_quote->>'generatorModel','') not in ('recraft/recraft-v4.1-pro','black-forest-labs/flux.2-klein-4b') or p_quote->>'directorModel' is distinct from 'openai/gpt-5.6-luna' or
    p_quote->>'reviewerModel' is distinct from 'anthropic/claude-haiku-4.5' or p_quote->'maximumCalls' is distinct from to_jsonb(2+2*(snapshot->>'maximumGenerations')::integer) or
    p_quote->'estimateOnly' is distinct from 'true'::jsonb or p_quote->'providerInvoiceGuarantee' is distinct from 'false'::jsonb or
    nullif(p_quote->>'verifiedAt','') is null or (p_quote->>'verifiedAt')::timestamptz<now()-interval '1 hour' or (p_quote->>'verifiedAt')::timestamptz>now()+interval '5 minutes' or
    jsonb_typeof(p_quote->'sourceUrls') is distinct from 'array' or jsonb_array_length(p_quote->'sourceUrls') not between 1 and 8 or
    exists(select 1 from jsonb_array_elements_text(p_quote->'sourceUrls') u where u !~ (case when p_quote->>'generatorModel'='black-forest-labs/flux.2-klein-4b'
      then '^https://(openrouter\.ai|bfl\.ai|docs\.bfl\.ai|help\.bfl\.ai)/[^[:space:]#]*$'
      else '^https://(openrouter\.ai|openai\.com|www\.recraft\.ai|docs\.recraft\.ai)/[^[:space:]#]*$' end)) then raise exception 'Fresh, explicit supported provider quote required.'; end if;
  if p_quote-array['version','verifiedAt','sourceUrls','generatorModel','directorModel','reviewerModel','maximaMicrousd','maximumEstimateMicrousd','maximumCalls','estimateOnly','providerInvoiceGuarantee','providerBinding']<>'{}'::jsonb or
    (p_quote->>'generatorModel'='recraft/recraft-v4.1-pro' and p_quote ? 'providerBinding') then
    raise exception 'Only the closed, provider-specific creative quote contract is supported.';
  end if;
  if p_quote->>'generatorModel'='black-forest-labs/flux.2-klein-4b' and (
    p_quote->'maximaMicrousd'->'generation' is distinct from '70000'::jsonb or
    not (p_quote->'sourceUrls' @> '["https://openrouter.ai/api/v1/images/models/black-forest-labs/flux.2-klein-4b/endpoints","https://bfl.ai/legal/developer-terms-of-service","https://bfl.ai/legal/flux-api-service-terms"]'::jsonb)) then
    raise exception 'The exact BFL catalog, both applicable terms and US$0.07 image ceiling are required.';
  end if;
  foreach k in array array['brief','screen','generation','review'] loop
    if jsonb_typeof(p_quote->'maximaMicrousd'->k) is distinct from 'number' or (p_quote->'maximaMicrousd'->>k)::numeric<>trunc((p_quote->'maximaMicrousd'->>k)::numeric) or
      (p_quote->'maximaMicrousd'->>k)::bigint not between 0 and 2000000 then raise exception 'Invalid per-call quoted ceiling.'; end if;
  end loop;
  if p_quote->'maximumEstimateMicrousd' is distinct from to_jsonb(
    (p_quote->'maximaMicrousd'->>'brief')::bigint+(p_quote->'maximaMicrousd'->>'screen')::bigint+
    (snapshot->>'maximumGenerations')::integer*((p_quote->'maximaMicrousd'->>'generation')::bigint+(p_quote->'maximaMicrousd'->>'review')::bigint)) or
    (snapshot->>'purpose'<>'simulation' and ((p_quote->>'maximumEstimateMicrousd')::bigint>maximum or (p_quote->>'maximumEstimateMicrousd')::bigint<=0)) then raise exception 'Quoted worst-case estimate must match the approved image limit and fit its allowance.'; end if;
  insert into public.creative_approvals(id,business_id,candidate_id,decision_id,purpose,snapshot,scope_hash,approval_hash,quote,maximum_microusd,owner_user_id,approved_at,expires_at)
    values(v_id,c.business_id,c.id,(snapshot->>'decisionId')::uuid,snapshot->>'purpose',snapshot,v_scope_hash,private.stage14_hash(snapshot),p_quote,maximum,auth.uid(),(snapshot->>'approvedAt')::timestamptz,(snapshot->>'expiresAt')::timestamptz) returning * into a;
  return jsonb_build_object('approvalId',a.id,'approvalHash',a.approval_hash,'snapshot',a.snapshot);
end; $$;

create or replace function public.creative_runtime_transition(p_creative_run_id uuid,p_business_id uuid,p_runtime_capability text,p_operation text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
<<creative_runtime_transition>>
declare r public.creative_runs%rowtype; w public.workflow_runs%rowtype; a public.creative_approvals%rowtype;
  reserved public.creative_cost_reservations%rowtype; settled public.creative_cost_settlements%rowtype; previous public.creative_phase_outputs%rowtype;
  worker public.worker_definitions%rowtype; asset public.creative_assets%rowtype;
  key text:=p_payload->>'callKey'; phase text; expected_model text; k text; output jsonb; receipt jsonb; brief jsonb; screen jsonb; inspection jsonb; provenance jsonb;
  prior_review jsonb; brief_hash text; artifact_id uuid; task_id uuid; worker_id uuid; stage_id uuid; input_ids uuid[]; amount bigint; total bigint;
  schema jsonb; price_quote jsonb; estimate jsonb; version integer; next_key text; status text; intervention_id uuid; good boolean; binary_good boolean; source_artifacts jsonb; prepared jsonb; terminal_eligibility_changed boolean:=false;
begin
  if coalesce(length(p_runtime_capability),0) not between 32 and 512 or jsonb_typeof(p_payload) is distinct from 'object' or length(p_payload::text)>150000 then raise exception 'Invalid creative runtime request.' using errcode='42501'; end if;
  select cr.* into r from public.creative_runs cr join private.creative_run_capabilities secret on secret.creative_run_id=cr.id
    where cr.id=p_creative_run_id and cr.business_id=p_business_id and secret.capability_hash=private.stage13_hash(p_runtime_capability) for update of cr;
  if r.id is null then raise exception 'Creative capability denied.' using errcode='42501'; end if;
  select * into strict w from public.workflow_runs where id=r.workflow_run_id and business_id=r.business_id for update;
  select * into strict a from public.creative_approvals where id=r.approval_id and business_id=r.business_id;
  -- Time-limited capability cannot be refreshed by replaying begin. Owner must approve a new run.
  if r.capability_expires_at<=clock_timestamp() then raise exception 'Creative capability expired.' using errcode='42501'; end if;
  select x.output,x.output_hash into brief,brief_hash from public.creative_phase_outputs x where x.creative_run_id=r.id and x.call_key='brief:1';
  select x.output into screen from public.creative_phase_outputs x where x.creative_run_id=r.id and x.call_key='screen:1';
  if p_operation='load' then
    if (w.runtime_run_id is null or p_payload ? 'runtimeRunId') and coalesce(length(p_payload->>'runtimeRunId'),0) not between 1 and 300 then raise exception 'Durable runtime identity required.'; end if;
    if p_payload ? 'runtimeRunId' and w.runtime_run_id is not null and w.runtime_run_id is distinct from p_payload->>'runtimeRunId' then raise exception 'Durable runtime identity mismatch.'; end if;
    if w.status='queued' then
      update public.workflow_runs set runtime_run_id=p_payload->>'runtimeRunId',runtime_launch_status='started',status='running',started_at=now() where id=w.id;
      w.status:='running';
    end if;
    return jsonb_build_object('status',w.status,'phaseKey',w.current_stage_key,'approval',a.snapshot,'approvalHash',a.approval_hash,'quote',a.quote,'brief',brief,'briefHash',brief_hash,'screen',screen,
      'assets',coalesce((select jsonb_agg(o.output||jsonb_build_object('version',x.version) order by x.version) from public.creative_assets x join public.creative_phase_outputs o on o.creative_run_id=x.creative_run_id and o.call_key='generate:'||x.version where x.creative_run_id=r.id),'[]'::jsonb),
      'reviews',coalesce((select jsonb_agg(jsonb_build_object('version',v.version,'output',x.review) order by v.version) from public.creative_reviews x join public.creative_assets v on v.id=x.asset_id where x.creative_run_id=r.id),'[]'::jsonb),
      'committedMicrousd',private.stage14_committed_cost(r.id),'productionReady',w.state->'productionReady');
  end if;
  if p_operation='fail' then
    if w.status in ('completed','needs_owner','failed','cancelled') then return jsonb_build_object('status',w.status,'productionReady',w.state->'productionReady'); end if;
    if coalesce(length(btrim(p_payload->>'reason')),0) not between 3 and 1500 then raise exception 'Bounded failure reason required.'; end if;
    intervention_id:=private.stage14_needs_owner(r.id,p_payload->>'reason');
    return jsonb_build_object('status','needs_owner','interventionId',intervention_id,'productionReady',false);
  end if;
  if coalesce(key,'') not in ('brief:1','screen:1','generate:1','review:1','generate:2','review:2') then raise exception 'Unknown creative phase key.'; end if;
  phase:=split_part(key,':',1); version:=split_part(key,':',2)::integer;
  -- The immutable approval limits both image and review calls before preparation
  -- or reservation; a stale/malicious phase key cannot consume a repair slot.
  if coalesce(a.snapshot->'maximumGenerations','null'::jsonb) not in ('1'::jsonb,'2'::jsonb) or
    (phase in ('generate','review') and version>(a.snapshot->>'maximumGenerations')::integer) then
    raise exception 'Creative phase exceeds the owner-approved image limit; no repair is authorized.';
  end if;
  if coalesce(a.quote->>'generatorModel','') not in ('recraft/recraft-v4.1-pro','black-forest-labs/flux.2-klein-4b') or
    (a.quote->>'generatorModel'='black-forest-labs/flux.2-klein-4b' and a.quote->'providerBinding' is distinct from '{"provider":"openrouter","upstreamProvider":"black-forest-labs","adapterVersion":"flux-klein-png-1.0","outputFormat":"png","requestedSize":"1024x1024","nativePngRequired":true,"disclosureVersion":"bfl-openrouter-data-use-1.0","ownerAcknowledged":true}'::jsonb) then
    raise exception 'The run has no supported immutable provider-bound approval.';
  end if;
  expected_model:=a.quote->>(case when phase='brief' then 'directorModel' when phase='generate' then 'generatorModel' else 'reviewerModel' end);
  stage_id:=private.stage4_deterministic_uuid('creative:stage:'||r.id||':'||key);
  task_id:=private.stage4_deterministic_uuid('creative:task:'||r.id||':'||key);
  worker_id:=private.stage4_deterministic_uuid('creative:worker:'||r.id||':'||key);
  artifact_id:=private.stage4_deterministic_uuid('creative:output:'||r.id||':'||key);
  select * into reserved from public.creative_cost_reservations where creative_run_id=r.id and call_key=key;
  select * into settled from public.creative_cost_settlements where creative_run_id=r.id and call_key=key;
  select * into previous from public.creative_phase_outputs where creative_run_id=r.id and call_key=key;
  if p_operation='prepare' then
    if w.status<>'running' or w.current_stage_key<>key then raise exception 'Creative phase is not active.'; end if;
    return private.stage14_prepare(r.id,key);
  end if;
  if p_operation='reserve_call' then
    if r.capability_expires_at<clock_timestamp()+interval '5 minutes' then raise exception 'Insufficient capability lifetime for another bounded provider call.'; end if;
    if reserved.creative_run_id is not null then
      if reserved.request_hash is distinct from p_payload->>'requestHash' or reserved.model is distinct from p_payload->>'model' or
        reserved.reserved_microusd is distinct from (p_payload->>'reservedMicrousd')::bigint or reserved.provider is distinct from p_payload->>'provider' or reserved.estimate is distinct from p_payload->'estimate' then raise exception 'Reservation replay differs from original call.'; end if;
      return jsonb_build_object('allowed',true,'shouldExecute',false,'committedMicrousd',private.stage14_committed_cost(r.id));
    end if;
    if w.status<>'running' or w.current_stage_key<>key then raise exception 'Creative phase is not active.'; end if;
    perform private.stage14_assert_approval(a.candidate_id,a.snapshot);
    if p_payload->>'model' is distinct from expected_model or p_payload->>'provider' is distinct from 'openrouter' or
      coalesce(p_payload->>'requestHash','') !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_payload->'estimate') is distinct from 'object' or
      jsonb_typeof(p_payload->'reservedMicrousd') is distinct from 'number' or (p_payload->>'reservedMicrousd')::numeric<>trunc((p_payload->>'reservedMicrousd')::numeric) then raise exception 'Exact approved model, request hash and cost estimate required.'; end if;
    amount:=(p_payload->>'reservedMicrousd')::bigint;
    if amount<0 or amount>(a.quote->'maximaMicrousd'->>(case when phase='generate' then 'generation' else phase end))::bigint or
      (a.purpose='simulation' and amount<>0) or (a.purpose<>'simulation' and amount=0) then raise exception 'Call estimate exceeds approved per-call quote ceiling.'; end if;
    estimate:=p_payload->'estimate';
    price_quote:=(case when phase='generate' then estimate else estimate->'quote' end);
    if a.purpose<>'simulation' then
      if price_quote->>'modelId' is distinct from expected_model or nullif(price_quote->>'verifiedAt','') is null or
        abs(extract(epoch from now()-(price_quote->>'verifiedAt')::timestamptz))>300 or
        price_quote->>'source' is distinct from (case when phase='generate' then case expected_model when 'recraft/recraft-v4.1-pro' then 'https://openrouter.ai/api/v1/images/models/recraft/recraft-v4.1-pro/endpoints' when 'black-forest-labs/flux.2-klein-4b' then 'https://openrouter.ai/api/v1/images/models/black-forest-labs/flux.2-klein-4b/endpoints' end else 'https://openrouter.ai/api/v1/models' end) or
        estimate->'estimateOnly' is distinct from 'true'::jsonb or estimate->'providerInvoiceGuarantee' is distinct from 'false'::jsonb then raise exception 'Fresh exact-model pricing metadata required.'; end if;
      if phase='generate' then
        select x.review into prior_review from public.creative_reviews x join public.creative_assets v on v.id=x.asset_id where v.creative_run_id=r.id and v.version=1;
        if estimate->>'version' is distinct from (case expected_model when 'recraft/recraft-v4.1-pro' then 'recraft-image-1.0' when 'black-forest-labs/flux.2-klein-4b' then 'flux-klein-png-1.0' end) or estimate->>'provider' is distinct from 'openrouter' or estimate->>'upstreamProvider' is distinct from (case expected_model when 'recraft/recraft-v4.1-pro' then 'recraft' when 'black-forest-labs/flux.2-klein-4b' then 'black-forest-labs' end) or
          estimate->>'requestHash' is distinct from p_payload->>'requestHash' or (estimate->>'estimatedMicrousd')::bigint is distinct from amount or
          coalesce(estimate->>'pricingFingerprint','') !~ '^[a-f0-9]{64}$' or nullif(estimate->>'quoteId','') is null or
          estimate->>'promptHash' is distinct from private.stage13_hash((brief->>'imagePrompt')||(case when version=2 then E'\n\nRepair instruction: '||(prior_review->>'repairInstruction') else '' end)) then raise exception 'Image price quote is not bound to this exact request and prompt.'; end if;
        if expected_model='black-forest-labs/flux.2-klein-4b' and (
          amount<>70000 or
          estimate->>'requestHash' is distinct from private.stage14_hash(jsonb_build_object(
            'model','black-forest-labs/flux.2-klein-4b','prompt',(brief->>'imagePrompt')||(case when version=2 then E'\n\nRepair instruction: '||(prior_review->>'repairInstruction') else '' end),
            'aspect_ratio','1:1','n',1,'output_format','png','size','1024x1024',
            'provider',jsonb_build_object('only',jsonb_build_array('black-forest-labs'),'allow_fallbacks',false))) or
          estimate-array['version','provider','upstreamProvider','modelId','promptHash','requestHash','pricingFingerprint','estimatedMicrousd','verifiedAt','source','quoteId','estimateOnly','providerInvoiceGuarantee']<>'{}'::jsonb or
          estimate->>'quoteId' is distinct from private.stage14_hash(estimate-'quoteId')) then
          raise exception 'BFL native-PNG reservation requires the exact US$0.07 versioned quote and closed request contract.';
        end if;
      else
        foreach k in array array['inputTokenAllowance','outputTokenAllowance','textRequestBytes'] loop
          if jsonb_typeof(estimate->k) is distinct from 'number' or (estimate->>k)::numeric<>trunc((estimate->>k)::numeric) then raise exception 'Token and byte allowances must be integers.'; end if;
        end loop;
        if estimate->>'version' is distinct from 'creative-estimate-1.0' or coalesce((estimate->>'textRequestBytes')::integer,-1) not between 1 and 24576 or
          (estimate->>'inputTokenAllowance')::integer is distinct from (estimate->>'textRequestBytes')::integer+8192+(case when phase='review' then 8192 else 0 end) or
          (estimate->>'outputTokenAllowance')::integer is distinct from (case when phase='brief' then 2500 else 1800 end) then raise exception 'Invalid bounded creative text/image token allowance.'; end if;
        foreach k in array array['inputPerMillion','outputPerMillion','cacheWritePerMillion'] loop
          if jsonb_typeof(price_quote->k) is distinct from 'number' or (price_quote->>k)::numeric not between 0 and 1000000 then raise exception 'Invalid provider token quote.'; end if;
        end loop;
        if amount is distinct from ceil((estimate->>'inputTokenAllowance')::numeric*((price_quote->>'inputPerMillion')::numeric+(price_quote->>'cacheWritePerMillion')::numeric)+(estimate->>'outputTokenAllowance')::numeric*(price_quote->>'outputPerMillion')::numeric)::bigint then raise exception 'Reservation does not cover the quoted maximum token usage.'; end if;
      end if;
    end if;
    total:=private.stage14_committed_cost(r.id);
    if total+amount>a.maximum_microusd then
      intervention_id:=private.stage14_needs_owner(r.id,'The conservative committed provider cost plus this call exceeds the owner-approved budget. No further call is permitted.');
      return jsonb_build_object('allowed',false,'shouldExecute',false,'committedMicrousd',total,'status','needs_owner','interventionId',intervention_id);
    end if;
    if phase='generate' and (brief is null or screen->>'outcome' is distinct from 'PASS' or screen->>'briefHash' is distinct from brief_hash or screen->>'approvalHash' is distinct from a.approval_hash) then raise exception 'Independent final-brief IP/policy PASS required.'; end if;
    if phase='generate' and version=2 and not exists(select 1 from public.creative_reviews x join public.creative_assets v on v.id=x.asset_id where v.creative_run_id=r.id and v.version=1 and x.review->>'outcome'='FAIL' and private.stage14_safe_repair(x.review->>'repairInstruction')) then raise exception 'One exact failed-review repair instruction required.'; end if;
    input_ids:=array[private.stage4_deterministic_uuid('creative:approval:'||r.id)];
    if phase<>'brief' then input_ids:=input_ids||private.stage4_deterministic_uuid('creative:output:'||r.id||':brief:1'); end if;
    if phase='review' then input_ids:=input_ids||private.stage4_deterministic_uuid('creative:output:'||r.id||':generate:'||version); end if;
    if key='review:2' then input_ids:=input_ids||private.stage4_deterministic_uuid('creative:output:'||r.id||':review:1'); end if;
    update public.workflow_stage_runs set status='running',started_at=now(),input=jsonb_build_object('inputArtifactIds',input_ids,'approvalHash',a.approval_hash) where id=stage_id;
    if phase='generate' then
      insert into public.action_intents(id,business_id,workflow_run_id,action_type,capability,status,request,risk,financial_impact,idempotency_key,created_by_type)
        values(private.stage4_deterministic_uuid('creative:intent:'||r.id||':'||key),r.business_id,w.id,'creative.image.generate','image.generate','executing',
          jsonb_build_object('creativeRunId',r.id,'version',version,'approvalId',a.id,'approvalHash',a.approval_hash,'briefHash',brief_hash,'requestHash',p_payload->>'requestHash'),
          jsonb_build_object('publicationAllowed',false,'maxGenerations',(a.snapshot->>'maximumGenerations')::integer),jsonb_build_object('reservedMicrousd',amount,'maximumMicrousd',a.maximum_microusd,'ownerApprovalId',a.id),'creative:'||r.id||':'||key,'system');
    else
      prepared:=private.stage14_prepare(r.id,key);
      update public.task_contracts set status='running' where id=task_id;
      insert into public.worker_runs(id,business_id,workflow_run_id,task_contract_id,worker_definition_id,status,input,execution_metadata,started_at)
        select worker_id,r.business_id,w.id,task_id,t.worker_definition_id,'running',prepared->'context',jsonb_build_object('model',expected_model,'maximumAttempts',1),now()
        from public.task_contracts t where t.id=task_id;
    end if;
    insert into public.creative_cost_reservations(creative_run_id,business_id,call_key,reserved_microusd,request_hash,model,provider,estimate)
      values(r.id,r.business_id,key,amount,p_payload->>'requestHash',expected_model,'openrouter',p_payload->'estimate');
    select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'artifactType',x.artifact_type,'content',x.content,'checksum',x.checksum,'storagePath',x.storage_path)),'[]'::jsonb) into source_artifacts from public.artifacts x where x.id=any(input_ids) and x.business_id=r.business_id and x.workflow_run_id=w.id;
    return jsonb_build_object('allowed',true,'shouldExecute',true,'committedMicrousd',total+amount,'taskContract',(select to_jsonb(t) from public.task_contracts t where t.id=task_id),'inputArtifacts',source_artifacts)||coalesce(prepared,'{}'::jsonb);
  elsif p_operation='record_call' then
    receipt:=p_payload->'receipt';
    if reserved.creative_run_id is null then raise exception 'Cannot record an unreserved provider call.'; end if;
    if settled.creative_run_id is not null then
      if settled.reported_microusd is distinct from (p_payload->>'reportedMicrousd')::bigint or settled.provider_request_id is distinct from p_payload->>'providerRequestId' or settled.receipt is distinct from receipt then raise exception 'Settlement replay differs from immutable receipt.'; end if;
      return jsonb_build_object('recorded',false,'committedMicrousd',private.stage14_committed_cost(r.id));
    end if;
    if w.status<>'running' or w.current_stage_key<>key or jsonb_typeof(receipt) is distinct from 'object' or
      receipt->>'model' is distinct from expected_model or receipt->>'provider' is distinct from 'openrouter' or
      receipt->>'providerRequestId' is distinct from p_payload->>'providerRequestId' or
      jsonb_typeof(receipt->'outputValidated') is distinct from 'boolean' or jsonb_typeof(receipt->'mockProvider') is distinct from 'boolean' or
      receipt->>'executionMode' is distinct from (case when a.purpose='simulation' then 'simulation' when phase='generate' then 'image.generate' else 'creative.model' end) or
      (a.purpose='simulation' and (receipt->'mockProvider' is distinct from 'true'::jsonb or coalesce(p_payload->>'providerRequestId','') not like 'simulation:%' or p_payload->'reportedMicrousd' is distinct from '0'::jsonb)) or
      (a.purpose<>'simulation' and (receipt->'mockProvider' is distinct from 'false'::jsonb or coalesce(p_payload->>'providerRequestId','') ~ '^(simulation:|fixture:|mock:)')) or
      (p_payload->'reportedMicrousd'<>'null'::jsonb and (jsonb_typeof(p_payload->'reportedMicrousd') is distinct from 'number' or (p_payload->>'reportedMicrousd')::numeric<0 or (p_payload->>'reportedMicrousd')::numeric<>trunc((p_payload->>'reportedMicrousd')::numeric))) then raise exception 'Provider receipt does not match the exact reserved call.'; end if;
    insert into public.creative_cost_settlements(creative_run_id,business_id,call_key,reported_microusd,provider_request_id,receipt)
      values(r.id,r.business_id,key,(p_payload->>'reportedMicrousd')::bigint,p_payload->>'providerRequestId',receipt);
    if phase='generate' then
      insert into public.action_receipts(id,business_id,action_intent_id,attempt,outcome,provider,request_fingerprint,response_summary)
        values(private.stage4_deterministic_uuid('creative:receipt:'||r.id||':'||key),r.business_id,private.stage4_deterministic_uuid('creative:intent:'||r.id||':'||key),1,
          (case when p_payload->>'providerRequestId' is null or p_payload->>'reportedMicrousd' is null then 'uncertain' when receipt->'outputValidated'='true'::jsonb then 'succeeded' else 'failed' end),'openrouter',reserved.request_hash,receipt);
    else update public.worker_runs set execution_metadata=execution_metadata||jsonb_build_object('receipt',receipt,'reportedMicrousd',p_payload->'reportedMicrousd') where id=worker_id;
    end if;
    return jsonb_build_object('recorded',true,'committedMicrousd',private.stage14_committed_cost(r.id));
  elsif p_operation='persist_phase' then
    output:=p_payload->'output';
    if previous.creative_run_id is not null then
      if previous.output is distinct from output then raise exception 'Phase output replay differs from immutable output.'; end if;
      return jsonb_build_object('status',w.status,'phaseKey',w.current_stage_key,'artifactId',previous.artifact_id,'productionReady',w.state->'productionReady');
    end if;
    if w.status<>'running' or w.current_stage_key<>key or settled.creative_run_id is null or settled.receipt->'outputValidated' is distinct from 'true'::jsonb or
      jsonb_typeof(output) is distinct from 'object' then raise exception 'Settled validated provider receipt required before output persistence.'; end if;
    next_key:=(case key when 'brief:1' then 'screen:1' when 'screen:1' then 'generate:1' when 'generate:1' then 'review:1' when 'generate:2' then 'review:2' end);
    status:='running';
    if phase='brief' then
      if output->>'version' is distinct from '1.0' or output->>'approvalId' is distinct from a.id::text or output->>'concept' is distinct from a.snapshot->>'concept' or
        output->>'audience' is distinct from a.snapshot->>'audience' or output->>'placement' is distinct from a.snapshot->'printSpecification'->>'placement' or
        output->>'garmentCompatibility' is distinct from a.snapshot->'printSpecification'->>'garment' or
        not(output ?& array['version','approvalId','audience','concept','style','hierarchy','typography','placement','garmentCompatibility','colors','forbiddenElements','originalityRequirements','imagePrompt']) or
        output-array['version','approvalId','audience','concept','style','hierarchy','typography','placement','garmentCompatibility','colors','forbiddenElements','originalityRequirements','imagePrompt']<>'{}'::jsonb or
        coalesce(length(btrim(output->>'imagePrompt')),0) not between 50 and 3500 or octet_length(output->>'imagePrompt')>6000 or
        jsonb_typeof(output->'colors') is distinct from 'array' or jsonb_array_length(output->'colors') not between 1 and 6 or
        exists(select 1 from jsonb_array_elements_text(output->'colors') x where x !~ '^#[a-fA-F0-9]{6}$') or
        jsonb_typeof(output->'forbiddenElements') is distinct from 'array' or jsonb_array_length(output->'forbiddenElements') not between 3 and 16 or
        exists(select 1 from jsonb_array_elements_text(output->'forbiddenElements') x where length(btrim(x)) not between 3 and 120) then raise exception 'Design Brief differs from the approved contract.'; end if;
      foreach k in array array['style','hierarchy','typography','originalityRequirements'] loop
        if coalesce(length(btrim(output->>k)),0) not between 10 and 600 then raise exception 'Incomplete Design Brief.'; end if;
      end loop;
    elsif phase='screen' then
      if output->>'version' is distinct from '1.0' or output->>'briefHash' is distinct from brief_hash or output->>'approvalHash' is distinct from a.approval_hash or
        output-array['version','briefHash','approvalHash','checks','outcome']<>'{}'::jsonb or jsonb_typeof(output->'checks') is distinct from 'array' or jsonb_array_length(output->'checks')<>8 then raise exception 'Screen is not bound to the exact final brief and approval.'; end if;
      foreach k in array array['brand_names','trademarks','copyrighted_characters','sports_teams','logos','celebrity_likeness','copied_artwork','marketplace_policy'] loop
        if (select count(*) from jsonb_array_elements(output->'checks') x where x->>'category'=k and x->>'status' in ('clear','concern','unknown') and length(btrim(x->>'rationale')) between 15 and 700)<>1 then raise exception 'Incomplete independent IP screen.'; end if;
      end loop;
      good:=not exists(select 1 from jsonb_array_elements(output->'checks') x where x->>'status'<>'clear');
      if output->>'outcome' is distinct from (case when good then 'PASS' else 'NEEDS_OWNER' end) then raise exception 'Policy screen outcome contradicts its checks.'; end if;
      if not good then status:='needs_owner'; end if;
    elsif phase='generate' then
      inspection:=output->'inspection';
      select x.review into prior_review from public.creative_reviews x join public.creative_assets v on v.id=x.asset_id where v.creative_run_id=r.id and v.version=1;
      if output-array['inspection','provenance','storagePath','prompt','model','provider','generatedAt']<>'{}'::jsonb or output->>'model' is distinct from expected_model or output->>'provider' is distinct from 'openrouter' or
        output->>'storagePath' is distinct from r.business_id::text||'/'||r.id::text||'/version-'||version||'.png' or
        output->>'prompt' is distinct from (brief->>'imagePrompt')||(case when version=2 then E'\n\nRepair instruction: '||(prior_review->>'repairInstruction') else '' end) or
        nullif(output->>'generatedAt','') is null or (output->>'generatedAt')::timestamptz>now()+interval '5 minutes' or (output->>'generatedAt')::timestamptz<reserved.created_at-interval '5 minutes' or
        jsonb_typeof(inspection) is distinct from 'object' or coalesce(inspection->>'sha256','') !~ '^[a-f0-9]{64}$' or inspection->>'mediaType' is distinct from 'image/png' or
        coalesce((inspection->>'bytes')::bigint,0) not between 33 and 7000000 or (inspection->>'bytes')::bigint>(a.snapshot->'printSpecification'->>'maximumBytes')::bigint or
        coalesce((inspection->>'width')::integer,0) not between 1 and 4096 or coalesce((inspection->>'height')::integer,0) not between 1 and 4096 or
        jsonb_typeof(inspection->'hasAlpha') is distinct from 'boolean' or coalesce((inspection->>'transparentPixelFraction')::numeric,-1) not between 0 and 1 or
        jsonb_typeof(inspection->'failedCriteria') is distinct from 'array' or
        not exists(select 1 from storage.objects obj where obj.bucket_id='creative-assets' and obj.name=output->>'storagePath' and obj.metadata->>'mimetype'='image/png' and (obj.metadata->>'size')::bigint=(inspection->>'bytes')::bigint) then raise exception 'Immutable PNG upload and bounded binary inspection required.'; end if;
      -- Never trust a model or client supplied failedCriteria alone for physical feasibility.
      foreach k in array array['bytes','width','height'] loop
        if jsonb_typeof(inspection->k) is distinct from 'number' or (inspection->>k)::numeric<>trunc((inspection->>k)::numeric) then raise exception 'Image dimensions and byte count must be integers.'; end if;
      end loop;
      provenance:=output->'provenance';
      if jsonb_typeof(provenance) is distinct from 'object' or provenance is distinct from settled.receipt->'provenance' or
        not (provenance ?& array['version','providerMediaType','detectedMediaType','originalSha256','normalizedSha256','originalBytes','normalizedBytes','width','height','conversion','verification','decodedPixelSha256','normalizedDecodedPixelSha256','decodedChannels','decodedHasAlpha','decoder','encoder','originalStoragePath','normalizedStoragePath']) or
        provenance-array['version','providerMediaType','detectedMediaType','originalSha256','normalizedSha256','originalBytes','normalizedBytes','width','height','conversion','verification','decodedPixelSha256','normalizedDecodedPixelSha256','decodedChannels','decodedHasAlpha','decoder','encoder','originalStoragePath','normalizedStoragePath']<>'{}'::jsonb or
        provenance->>'version' is distinct from 'creative-image-normalization-1.0' or
        coalesce(provenance->>'detectedMediaType','') not in ('image/png','image/webp') or
        (provenance->'providerMediaType' is distinct from 'null'::jsonb and provenance->>'providerMediaType' is distinct from provenance->>'detectedMediaType') or
        jsonb_typeof(provenance->'originalSha256') is distinct from 'string' or jsonb_typeof(provenance->'normalizedSha256') is distinct from 'string' or
        jsonb_typeof(provenance->'decoder') is distinct from 'string' or
        coalesce(provenance->>'originalSha256','') !~ '^[a-f0-9]{64}$' or provenance->>'normalizedSha256' is distinct from inspection->>'sha256' or
        provenance->>'normalizedStoragePath' is distinct from output->>'storagePath' or
        provenance->'normalizedBytes' is distinct from inspection->'bytes' or provenance->'width' is distinct from inspection->'width' or provenance->'height' is distinct from inspection->'height' or
        jsonb_typeof(provenance->'originalBytes') is distinct from 'number' or (provenance->>'originalBytes')::numeric<>trunc((provenance->>'originalBytes')::numeric) or
        (provenance->>'originalBytes')::bigint not between 12 and 7000000 or
        coalesce(length(provenance->>'decoder'),0) not between 5 and 200 or provenance->>'decoder' !~ '^[a-zA-Z0-9@.;_-]+$' then
        raise exception 'Exact bounded original/derived provenance must match its immutable receipt and PNG inspection.';
      end if;
      if expected_model='black-forest-labs/flux.2-klein-4b' and provenance->>'detectedMediaType' is distinct from 'image/png' then
        raise exception 'The BFL approval requires native PNG source bytes; conversion and provider fallback are not authorized.';
      end if;
      if provenance->>'detectedMediaType'='image/png' then
        if provenance->>'originalStoragePath' is distinct from output->>'storagePath' or provenance->>'originalSha256' is distinct from inspection->>'sha256' or
          provenance->'originalBytes' is distinct from inspection->'bytes' or provenance->>'conversion' is distinct from 'none' or provenance->>'verification' is distinct from 'byte_identity' or
          provenance->'decodedPixelSha256' is distinct from 'null'::jsonb or provenance->'normalizedDecodedPixelSha256' is distinct from 'null'::jsonb or
          provenance->'decodedChannels' is distinct from 'null'::jsonb or provenance->'decodedHasAlpha' is distinct from 'null'::jsonb or provenance->'encoder' is distinct from 'null'::jsonb then
          raise exception 'Native PNG provenance must preserve byte identity.';
        end if;
      else
        if provenance->>'originalStoragePath' is distinct from r.business_id::text||'/'||r.id::text||'/version-'||version||'.original.webp' or
          provenance->>'conversion' is distinct from 'lossless_webp_to_png' or provenance->>'verification' is distinct from 'decoded_pixels_equal' or
          coalesce(provenance->>'decodedPixelSha256','') !~ '^[a-f0-9]{64}$' or provenance->>'normalizedDecodedPixelSha256' is distinct from provenance->>'decodedPixelSha256' or
          provenance->'decodedChannels' not in ('3'::jsonb,'4'::jsonb) or provenance->'decodedChannels' is null or
          jsonb_typeof(provenance->'decodedHasAlpha') is distinct from 'boolean' or
          provenance->'decodedHasAlpha' is distinct from to_jsonb(provenance->'decodedChannels'='4'::jsonb) or
          provenance->'decodedHasAlpha' is distinct from inspection->'hasAlpha' or
          jsonb_typeof(provenance->'encoder') is distinct from 'string' or jsonb_typeof(provenance->'decodedPixelSha256') is distinct from 'string' or jsonb_typeof(provenance->'normalizedDecodedPixelSha256') is distinct from 'string' or
          coalesce(length(provenance->>'encoder'),0) not between 5 and 200 or provenance->>'encoder' !~ '^[a-zA-Z0-9@.;_-]+$' or
          not exists(select 1 from storage.objects obj where obj.bucket_id='creative-assets' and obj.name=provenance->>'originalStoragePath'
            and obj.metadata->>'mimetype'='image/webp' and (obj.metadata->>'size')::bigint=(provenance->>'originalBytes')::bigint) then
          raise exception 'Lossless WebP provenance requires the original private object and equal decoded pixels.';
        end if;
      end if;
      binary_good:=inspection->>'colorSpace'='srgb' and
        abs((inspection->>'width')::numeric/(inspection->>'height')::numeric-(a.snapshot->'printSpecification'->>'designWidthInches')::numeric/(a.snapshot->'printSpecification'->>'designHeightInches')::numeric)<=0.01 and
        least((inspection->>'width')::numeric/(a.snapshot->'printSpecification'->>'designWidthInches')::numeric,(inspection->>'height')::numeric/(a.snapshot->'printSpecification'->>'designHeightInches')::numeric)>=(a.snapshot->'printSpecification'->>'minimumDpi')::numeric and
        (a.snapshot->'printSpecification'->>'background'<>'transparent' or (inspection->'hasAlpha'='true'::jsonb and (inspection->>'transparentPixelFraction')::numeric>=0.01));
      if not coalesce(binary_good,false) and inspection->'failedCriteria'='[]'::jsonb then raise exception 'Inspection hides deterministic binary failures.'; end if;
    else
      select * into strict asset from public.creative_assets x where x.creative_run_id=r.id and x.version=version;
      if output->>'version' is distinct from '1.0' or output->>'assetHash' is distinct from asset.asset_hash or output->>'briefHash' is distinct from brief_hash or
        output-array['version','assetHash','briefHash','checks','outcome','repairInstruction']<>'{}'::jsonb or
        jsonb_typeof(output->'checks') is distinct from 'array' or jsonb_array_length(output->'checks')<>5 or expected_model=asset.model then raise exception 'Independent review of this exact asset and brief required.'; end if;
      foreach k in array array['brief_alignment','print_constraints','originality_policy','target_audience','visual_clarity'] loop
        if (select count(*) from jsonb_array_elements(output->'checks') x where x->>'criterion'=k and x->>'outcome' in ('PASS','FAIL') and length(btrim(x->>'rationale')) between 15 and 700)<>1 then raise exception 'Incomplete five-criterion visual review.'; end if;
      end loop;
      good:=not exists(select 1 from jsonb_array_elements(output->'checks') x where x->>'outcome'<>'PASS');
      if output->>'outcome' is distinct from (case when good then 'PASS' else 'FAIL' end) or
        (good and output->'repairInstruction' is distinct from 'null'::jsonb) or
        (not good and not private.stage14_safe_repair(output->>'repairInstruction')) then raise exception 'Review outcome or exact repair contradicts checks.'; end if;
      binary_good:=asset.inspection->'failedCriteria'='[]'::jsonb;
      if good and binary_good then status:='completed'; next_key:=null;
      elsif not good and version<(a.snapshot->>'maximumGenerations')::integer then next_key:='generate:2';
      else status:='needs_owner'; next_key:=null; end if;
    end if;
    insert into public.artifacts(id,business_id,workflow_run_id,task_contract_id,artifact_type,name,media_type,storage_path,content,checksum,metadata)
      values(artifact_id,r.business_id,w.id,(case when phase='generate' then null else task_id end),(case phase when 'generate' then 'creative.image' when 'screen' then 'creative.brief-screen' else 'creative.'||phase end),'Creative '||key,
        (case when phase='generate' then 'image/png' else 'application/json' end),(case when phase='generate' then output->>'storagePath' else null end),output,
        (case when phase='generate' then output->'inspection'->>'sha256' else private.stage14_hash(output) end),jsonb_build_object('receipt',settled.receipt,'approvalId',a.id,'approvalHash',a.approval_hash,'briefHash',brief_hash,'callKey',key));
    insert into public.creative_phase_outputs(creative_run_id,business_id,workflow_run_id,call_key,artifact_id,output,output_hash)
      values(r.id,r.business_id,w.id,key,artifact_id,output,private.stage14_hash(output));
    if phase='generate' then
      insert into public.creative_assets(id,creative_run_id,candidate_id,approval_id,business_id,version,brief_hash,asset_hash,storage_path,inspection,prompt,provider,model,generated_at,artifact_id)
        values(private.stage4_deterministic_uuid('creative:asset:'||r.id||':'||version),r.id,r.candidate_id,a.id,r.business_id,version,brief_hash,inspection->>'sha256',output->>'storagePath',inspection,output->>'prompt','openrouter',expected_model,(output->>'generatedAt')::timestamptz,artifact_id);
      update public.action_intents set status='completed' where id=private.stage4_deterministic_uuid('creative:intent:'||r.id||':'||key);
    else
      update public.worker_runs set status='completed',output=creative_runtime_transition.output,completed_at=now(),execution_metadata=execution_metadata||jsonb_build_object('outputArtifactId',artifact_id) where id=worker_id;
      update public.task_contracts set status='completed' where id=task_id;
      if phase='review' then insert into public.creative_reviews(id,creative_run_id,business_id,asset_id,brief_hash,asset_hash,review,reviewer_model,artifact_id)
        values(private.stage4_deterministic_uuid('creative:review:'||r.id||':'||version),r.id,r.business_id,asset.id,brief_hash,asset.asset_hash,output,expected_model,artifact_id); end if;
    end if;
    update public.workflow_stage_runs set status='completed',output=creative_runtime_transition.output,completed_at=now() where id=stage_id;
    -- A provider PASS is not a durable approval: the decision or eligibility may
    -- have changed while this already-reserved paid review was in flight. Keep
    -- every output/receipt above, then recheck before publishing productionReady.
    if status='completed' and a.purpose='candidate_production' then
      -- Candidate FK blocks creation of another experiment; experiment FKs block
      -- new decisions. Deterministic lock order serializes terminal publication
      -- with committed assessments without modifying the Stage13 write API.
      perform 1 from public.product_candidates c where c.id=r.candidate_id and c.business_id=r.business_id for update;
      perform 1 from public.product_experiments e where e.candidate_id=r.candidate_id and e.business_id=r.business_id order by e.id for update;
      -- Locks may have waited past the hard deadline. This is intentionally
      -- outside the caught eligibility block: expired authority must roll back
      -- this entire persist, while an earlier record_call stays durable.
      if r.capability_expires_at<=clock_timestamp() then
        raise exception 'Creative capability expired before final production publication.' using errcode='42501';
      end if;
      begin
        -- Each validation SPI statement needs a fresh committed snapshot after
        -- the locks. Fail closed if called under a stale transaction snapshot.
        if current_setting('transaction_isolation')<>'read committed' then raise exception 'Fresh committed production eligibility snapshot required.'; end if;
        -- now() is transaction-stable. Actual deadlines still apply after a wait.
        if least(a.expires_at,(a.snapshot->>'expiresAt')::timestamptz)<=clock_timestamp() or
          (a.snapshot->'printSpecification'->>'verifiedAt')::timestamptz+interval '30 days'<clock_timestamp() or
          exists(select 1 from public.product_decisions d join public.product_experiments e on e.id=d.experiment_id and e.business_id=d.business_id
            cross join lateral jsonb_array_elements(e.evidence_pack->'sources') src
            where d.id=a.decision_id and d.business_id=r.business_id and (src->>'retrievalExpiresAt')::timestamptz<=clock_timestamp()) then
          raise exception 'Production approval or evidence expired before final review commit.';
        end if;
        perform private.stage14_assert_approval(a.candidate_id,a.snapshot);
      exception when others then
        -- This block contains validation only: no paid output or receipt rolls
        -- back when eligibility fails closed, including an unavailable basis.
        terminal_eligibility_changed:=true;
      end;
    end if;
    if settled.reported_microusd is null or private.stage14_committed_cost(r.id)>a.maximum_microusd then
      status:='needs_owner'; next_key:=null;
      intervention_id:=private.stage14_needs_owner(r.id,'Paid output was retained, but the reported charge is missing or exceeds the approved budget. No further calls are permitted.');
    elsif terminal_eligibility_changed then
      status:='needs_owner'; next_key:=null;
      intervention_id:=private.stage14_needs_owner(r.id,'Production eligibility changed or expired while the final review was in flight. Paid output, asset versions, review and charges are preserved. Inspect the current decision, source freshness and owner approval before any separately approved production work.');
    elsif status='needs_owner' then
      intervention_id:=private.stage14_needs_owner(r.id,(case when phase='screen' then 'The independent final-brief IP/policy screen requires owner review.' when good then 'The model passed the asset but deterministic print or image constraints failed.' when a.snapshot->'maximumGenerations'='1'::jsonb then 'The first image failed review. This approval allows one image with no repair. No more generation is authorized.' else 'The single allowed repair failed review. No more generation is authorized.' end));
    else
      update public.workflow_runs set current_stage_key=next_key,status=creative_runtime_transition.status,state=state||jsonb_build_object('productionReady',status='completed' and a.purpose='candidate_production','publicationAllowed',false),completed_at=(case when status='completed' then now() else null end) where id=w.id;
      if status='completed' then update public.workflow_stage_runs set status='skipped',completed_at=now() where workflow_run_id=w.id and workflow_stage_runs.status='pending'; end if;
    end if;
    insert into public.events(business_id,workflow_run_id,event_type,actor_type,payload) values(r.business_id,w.id,'creative.'||phase||'.completed',(case when phase='generate' then 'provider' else 'worker' end),
      jsonb_build_object('creativeRunId',r.id,'callKey',key,'artifactId',artifact_id,'approvalHash',a.approval_hash,'status',status,'productionReady',status='completed' and a.purpose='candidate_production'));
    return jsonb_build_object('status',status,'phaseKey',next_key,'artifactId',artifact_id,'productionReady',status='completed' and a.purpose='candidate_production','interventionId',intervention_id);
  end if;
  raise exception 'Unknown creative runtime operation.';
end; $$;
