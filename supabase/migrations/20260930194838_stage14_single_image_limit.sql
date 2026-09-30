-- Stage14 explicit one-image/no-repair option. DRAFT: not applied by this task.
-- Only existing functions are replaced. No tables, stored history, storage
-- policies, function signatures, ownership, SECURITY DEFINER or grants change.
-- Existing two-image approvals retain their exact bound and replay semantics.
-- Includes the complete 20260930130626 terminal eligibility guard unchanged.

create or replace function private.stage14_assert_approval(p_candidate_id uuid,p_snapshot jsonb) returns void language plpgsql stable set search_path='' as $$
declare c public.product_candidates%rowtype; d public.product_decisions%rowtype; e public.product_experiments%rowtype;
  spec jsonb:=p_snapshot->'printSpecification'; check_item jsonb; name text; dimension text; v_pack jsonb; v_assessment jsonb;
begin
  select * into strict c from public.product_candidates where id=p_candidate_id;
  if jsonb_typeof(p_snapshot) is distinct from 'object' or
    p_snapshot-array['approvalId','businessId','candidateId','decisionId','purpose','concept','audience','designInstructions','candidateAssessment','originalDesign','rightsStatement','rightsConfirmed','policyScreen','printSpecification','approvedBy','approvedAt','expiresAt','maximumMicrousd','maximumGenerations','publicationAllowed']<>'{}'::jsonb or
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
    if d.id is null or d.assessment is distinct from p_snapshot->'candidateAssessment' or
      d.assessment->>'outcome' is distinct from 'TEST' or d.assessment->>'assessmentOrigin' is distinct from 'owner_assessment' or
      d.assessment->'missingEvidence' is distinct from '[]'::jsonb or coalesce((d.assessment->>'totalScore')::integer,0)<65 or
      exists(select 1 from public.product_decisions later where later.candidate_id=c.id and later.id<>d.id and later.created_at>=d.created_at) then
      raise exception 'Production requires the current persisted evidence-backed owner TEST decision.';
    end if;
    select * into strict e from public.product_experiments where id=d.experiment_id and candidate_id=c.id and business_id=c.business_id and status='completed';
    v_pack:=private.stage13_validated_evidence(e.source_artifact_id,c.business_id,true);
    if d.assessment->'ownerRightsConfirmed'='true'::jsonb then c.rights_status:='confirmed'; end if;
    v_assessment:=private.stage13_assessment(c,v_pack,d.assessment->'dimensions');
    if d.assessment->'ownerRightsConfirmed'='true'::jsonb then v_assessment:=v_assessment||'{"ownerRightsConfirmed":true}'::jsonb; end if;
    if v_assessment is distinct from d.assessment then raise exception 'Production TEST evidence is stale or inconsistent.'; end if;
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
    p_quote->>'generatorModel' is distinct from 'recraft/recraft-v4.1-pro' or p_quote->>'directorModel' is distinct from 'openai/gpt-5.6-luna' or
    p_quote->>'reviewerModel' is distinct from 'anthropic/claude-haiku-4.5' or p_quote->'maximumCalls' is distinct from to_jsonb(2+2*(snapshot->>'maximumGenerations')::integer) or
    p_quote->'estimateOnly' is distinct from 'true'::jsonb or p_quote->'providerInvoiceGuarantee' is distinct from 'false'::jsonb or
    nullif(p_quote->>'verifiedAt','') is null or (p_quote->>'verifiedAt')::timestamptz<now()-interval '1 hour' or (p_quote->>'verifiedAt')::timestamptz>now()+interval '5 minutes' or
    jsonb_typeof(p_quote->'sourceUrls') is distinct from 'array' or jsonb_array_length(p_quote->'sourceUrls') not between 1 and 8 or
    exists(select 1 from jsonb_array_elements_text(p_quote->'sourceUrls') u where u !~ '^https://(openrouter\.ai|openai\.com|www\.recraft\.ai|docs\.recraft\.ai)/[^[:space:]#]*$') then raise exception 'Fresh, explicit supported provider quote required.'; end if;
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

create or replace function public.begin_creative_run(p_approval_id uuid,p_launch_nonce uuid,p_runtime_capability text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.creative_approvals%rowtype; r public.creative_runs%rowtype; p public.packs%rowtype; d public.workflow_definitions%rowtype;
  id uuid:=gen_random_uuid(); wid uuid:=gen_random_uuid(); snap jsonb; key text; n integer:=0;
begin
  select * into a from public.creative_approvals where creative_approvals.id=p_approval_id for update;
  if auth.uid() is null or a.id is null or not private.is_business_owner(a.business_id) then raise exception 'Business ownership required.' using errcode='42501'; end if;
  if p_launch_nonce is null or coalesce(length(p_runtime_capability),0) not between 32 and 512 then raise exception 'Launch nonce and strong runtime capability required.'; end if;
  select * into r from public.creative_runs where approval_id=a.id;
  if r.id is not null then return jsonb_build_object('creativeRunId',r.id,'workflowRunId',r.workflow_run_id,'shouldStart',false,'snapshot',a.snapshot,'approvalHash',a.approval_hash,'quote',a.quote); end if;
  perform private.stage14_assert_approval(a.candidate_id,a.snapshot);
  select * into strict p from public.packs where pack_key='workflow.etsy-creative-pipeline' and version='1.0.0' and status='experimental';
  select * into strict d from public.workflow_definitions where pack_id=p.id and workflow_key='etsy.creative-pipeline' and version='1.0.0' and status='experimental';
  snap:=jsonb_build_object('rootPackId',p.id,'releases',private.stage10_resolve(p.id,true),'workflow',(select value from jsonb_array_elements(p.manifest->'workflows') where value->>'key'=d.workflow_key),'version','creative-pipeline-1.0');
  if (select count(*) from jsonb_array_elements(snap->'releases') rel where rel->'manifest'->>'packKey' in ('capability.image-generation','worker.etsy-creative-director','worker.etsy-creative-reviewer','workflow.etsy-creative-pipeline') and rel->>'status'='experimental')<>4 then raise exception 'Exact experimental creative catalog required.'; end if;
  insert into public.workflow_runs(id,business_id,workflow_definition_id,status,current_stage_key,idempotency_key,input,state,runtime_provider,runtime_launch_status,runtime_launch_nonce,runtime_launch_reserved_at)
    values(wid,a.business_id,d.id,'queued','brief:1','creative:'||a.id,jsonb_build_object('creativeRunId',id,'approvalId',a.id,'approvalHash',a.approval_hash),
      jsonb_build_object('purpose',a.purpose,'productionReady',false,'publicationAllowed',false),'vercel_workflow','reserved',p_launch_nonce,now());
  insert into public.creative_runs(id,business_id,candidate_id,approval_id,workflow_run_id,catalog_snapshot,capability_expires_at)
    values(id,a.business_id,a.candidate_id,a.id,wid,snap,least(now()+interval '2 hours',a.expires_at));
  insert into private.creative_run_capabilities values(id,private.stage13_hash(p_runtime_capability));
  foreach key in array (case when a.snapshot->'maximumGenerations'='1'::jsonb then
    array['brief:1','screen:1','generate:1','review:1'] else array['brief:1','screen:1','generate:1','review:1','generate:2','review:2'] end) loop
    n:=n+1;
    insert into public.workflow_stage_runs(id,business_id,workflow_run_id,stage_key,sequence,attempt,status,input)
      values(private.stage4_deterministic_uuid('creative:stage:'||id||':'||key),a.business_id,wid,key,n,1,'pending',jsonb_build_object('approvalId',a.id,'approvalHash',a.approval_hash));
  end loop;
  insert into public.artifacts(id,business_id,workflow_run_id,artifact_type,name,content,checksum) values
    (private.stage4_deterministic_uuid('creative:approval:'||id),a.business_id,wid,'creative.approval','Owner creative approval',a.snapshot,a.approval_hash);
  insert into public.events(business_id,workflow_run_id,event_type,actor_type,actor_id,payload) values(a.business_id,wid,'creative.queued','owner',auth.uid()::text,jsonb_build_object('creativeRunId',id,'approvalId',a.id,'purpose',a.purpose));
  return jsonb_build_object('creativeRunId',id,'workflowRunId',wid,'shouldStart',true,'snapshot',a.snapshot,'approvalHash',a.approval_hash,'quote',a.quote);
end; $$;

create or replace function private.stage14_prepare(p_run uuid,p_key text) returns jsonb language plpgsql set search_path='' as $$
declare r public.creative_runs%rowtype; a public.creative_approvals%rowtype; d public.worker_definitions%rowtype; t public.task_contracts%rowtype;
  worker jsonb; knowledge jsonb; release jsonb; context jsonb; phase text:=split_part(p_key,':',1); version integer:=split_part(p_key,':',2)::integer;
  task_id uuid:=private.stage4_deterministic_uuid('creative:task:'||p_run||':'||p_key); input_ids uuid[]; kid uuid; k text;
begin
  select * into strict r from public.creative_runs where id=p_run;
  select * into strict a from public.creative_approvals where id=r.approval_id;
  if coalesce(a.snapshot->'maximumGenerations','null'::jsonb) not in ('1'::jsonb,'2'::jsonb) or
    (phase in ('generate','review') and version>(a.snapshot->>'maximumGenerations')::integer) then
    raise exception 'Creative phase exceeds the owner-approved image limit; no repair is authorized.';
  end if;
  if phase='generate' then return '{}'::jsonb; end if;
  select x.value into strict worker from jsonb_array_elements(r.catalog_snapshot->'releases') rel cross join lateral jsonb_array_elements(rel->'manifest'->'workers') x
    where x.value->'manifest'->'worker'->>'workerKey'=case when phase='brief' then 'etsy.creative-director' else 'etsy.creative-reviewer' end;
  select d0.* into strict d from public.worker_definitions d0 join public.packs p on p.id=d0.pack_id
    where d0.worker_key=worker->'manifest'->'worker'->>'workerKey' and d0.version='1.0.0' and p.pack_key=worker->'manifest'->>'packKey' and p.version='1.0.0'
      and d0.output_schema=worker->'manifest'->'outputSchema';
  select * into t from public.task_contracts where id=task_id;
  if t.id is null then
    input_ids:=array[private.stage4_deterministic_uuid('creative:approval:'||r.id)];
    if phase<>'brief' then input_ids:=input_ids||private.stage4_deterministic_uuid('creative:output:'||r.id||':brief:1'); end if;
    if phase='review' then input_ids:=input_ids||private.stage4_deterministic_uuid('creative:output:'||r.id||':generate:'||version); end if;
    if p_key='review:2' then input_ids:=input_ids||private.stage4_deterministic_uuid('creative:output:'||r.id||':review:1'); end if;
    foreach k in array array['etsy.current-policy','pod.production'] loop
      select x.value,rel.value into strict knowledge,release from jsonb_array_elements(r.catalog_snapshot->'releases') rel
        cross join lateral jsonb_array_elements(rel.value->'manifest'->'knowledge') x where x.value->>'key'=k;
      if (knowledge->>'verifiedAt')::timestamptz+(knowledge->>'freshnessDays')::integer*interval '1 day'<now() then raise exception 'Required creative knowledge is stale.'; end if;
      kid:=private.stage4_deterministic_uuid('creative:knowledge:'||r.id||':'||p_key||':'||k);
      insert into public.artifacts(id,business_id,workflow_run_id,artifact_type,name,content,checksum,metadata)
        values(kid,r.business_id,r.workflow_run_id,'pack.knowledge',knowledge->>'name',knowledge->'content',private.stage14_hash(knowledge->'content'),jsonb_build_object('knowledgeKey',k,'knowledgeVersion',knowledge->>'version','source',knowledge->>'source','verifiedAt',knowledge->>'verifiedAt','packId',release->>'id'));
      input_ids:=input_ids||kid;
    end loop;
    insert into public.task_contracts(id,business_id,workflow_run_id,workflow_stage_run_id,worker_definition_id,status,objective,input_artifact_ids,permitted_capabilities,required_knowledge,required_output_schema,completion_criteria,failure_criteria,non_goals,escalation_rules)
      values(task_id,r.business_id,r.workflow_run_id,private.stage4_deterministic_uuid('creative:stage:'||r.id||':'||p_key),d.id,'ready',
        case when phase='brief' then 'Create one scoped original Design Brief' when phase='screen' then 'Independently screen this final Design Brief for all eight IP/policy categories' else 'Inspect the supplied PNG pixels against this exact brief and five review criteria' end,
        input_ids,'{}',array['etsy.current-policy','pod.production'],worker->'manifest'->'outputSchema',jsonb_build_object('outputValidated',true,'approvalHash',a.approval_hash,'actualPixelsRequired',phase='review'),
        '{"noAutomaticRetry":true,"unknownRights":"needs_owner"}',array['No strategy changes','No publication','No arbitrary tools','No unapproved spending'],jsonb_build_object('maximumAttempts',1,'maximumGenerations',(a.snapshot->>'maximumGenerations')::integer,'repeatedFailure','needs_owner')) returning * into t;
  end if;
  select jsonb_build_object('taskContract',jsonb_build_object('id',t.id,'objective',t.objective,'inputArtifactIds',to_jsonb(t.input_artifact_ids),
    'permittedCapabilities',to_jsonb(t.permitted_capabilities),'requiredKnowledge',to_jsonb(t.required_knowledge),'requiredOutputSchema',t.required_output_schema,
    'completionCriteria',t.completion_criteria,'failureCriteria',t.failure_criteria,'nonGoals',to_jsonb(t.non_goals),'escalationRules',t.escalation_rules),
    'inputArtifacts',coalesce(jsonb_agg(jsonb_build_object('id',x.id,'artifactType',x.artifact_type,'name',x.name,'mediaType',x.media_type,'content',x.content,
      'metadata',x.metadata||jsonb_build_object('checksum',x.checksum,'storagePath',x.storage_path)) order by x.id),'[]'::jsonb)) into context
    from public.artifacts x where x.id=any(t.input_artifact_ids) and x.business_id=r.business_id and x.workflow_run_id=r.workflow_run_id;
  return jsonb_build_object('worker',worker,'context',context);
end; $$;

create or replace function public.creative_runtime_transition(p_creative_run_id uuid,p_business_id uuid,p_runtime_capability text,p_operation text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
<<creative_runtime_transition>>
declare r public.creative_runs%rowtype; w public.workflow_runs%rowtype; a public.creative_approvals%rowtype;
  reserved public.creative_cost_reservations%rowtype; settled public.creative_cost_settlements%rowtype; previous public.creative_phase_outputs%rowtype;
  worker public.worker_definitions%rowtype; asset public.creative_assets%rowtype;
  key text:=p_payload->>'callKey'; phase text; expected_model text; k text; output jsonb; receipt jsonb; brief jsonb; screen jsonb; inspection jsonb;
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
        price_quote->>'source' is distinct from (case when phase='generate' then 'https://openrouter.ai/api/v1/images/models/recraft/recraft-v4.1-pro/endpoints' else 'https://openrouter.ai/api/v1/models' end) or
        estimate->'estimateOnly' is distinct from 'true'::jsonb or estimate->'providerInvoiceGuarantee' is distinct from 'false'::jsonb then raise exception 'Fresh exact-model pricing metadata required.'; end if;
      if phase='generate' then
        select x.review into prior_review from public.creative_reviews x join public.creative_assets v on v.id=x.asset_id where v.creative_run_id=r.id and v.version=1;
        if estimate->>'version' is distinct from 'recraft-image-1.0' or estimate->>'provider' is distinct from 'openrouter' or estimate->>'upstreamProvider' is distinct from 'recraft' or
          estimate->>'requestHash' is distinct from p_payload->>'requestHash' or (estimate->>'estimatedMicrousd')::bigint is distinct from amount or
          coalesce(estimate->>'pricingFingerprint','') !~ '^[a-f0-9]{64}$' or nullif(estimate->>'quoteId','') is null or
          estimate->>'promptHash' is distinct from private.stage13_hash((brief->>'imagePrompt')||(case when version=2 then E'\n\nRepair instruction: '||(prior_review->>'repairInstruction') else '' end)) then raise exception 'Image price quote is not bound to this exact request and prompt.'; end if;
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
      if output-array['inspection','storagePath','prompt','model','provider','generatedAt']<>'{}'::jsonb or output->>'model' is distinct from expected_model or output->>'provider' is distinct from 'openrouter' or
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
