-- OFFLINE DRAFT. New owner-approved strategy/review round, no paid research replay.
-- Preserves terminal history, existing manifests, original goal/funding, tenant/source
-- boundaries and all public signatures/ACLs. Apply only after reviewed isolated tests.
-- The two-call lane is a separate experimental workflow; it is not qualification.

alter table public.workflow_runs drop constraint pack_run_pins_required;
alter table public.workflow_runs add constraint pack_run_pins_required check (
  (pack_installation_id is null and pack_snapshot is null) or
  (jsonb_typeof(pack_snapshot)='object' and runtime_capability_hash is not null and
    (pack_installation_id is not null or
      (pack_snapshot->>'platformQualification'='stage11' and pack_snapshot->'workflow'->>'key'='research.public-evidence') or
      (pack_snapshot->>'platformQualification'='stage12' and pack_snapshot->>'mode'='simulation' and
        pack_snapshot->'workflow'->>'key'='etsy.product-discovery-simulation' and pack_snapshot->'workflow'->>'version'='1.0.0') or
      (pack_snapshot->>'platformQualification'='stage13_v2_bounded_discovery' and
        pack_snapshot->'workflow'->>'key' in ('product.discovery-v2.one','product.discovery-v2.two','product.discovery-v2.analysis') and
        pack_snapshot->'workflow'->>'version'='1.0.0'))));


create function private.stage13v2_analysis_source(p_root_id uuid,p_business_id uuid)
returns jsonb language plpgsql stable set search_path='' as $$
declare root public.product_experiments%rowtype; r public.workflow_runs%rowtype;
  plan_artifact public.artifacts%rowtype; plan_root public.product_experiments%rowtype;
  dossier public.artifacts%rowtype; s public.workflow_stage_runs%rowtype;
  t public.task_contracts%rowtype; w public.worker_runs%rowtype; receipt jsonb; ref jsonb;
  pack jsonb; source_run public.workflow_runs%rowtype; source_artifact public.artifacts%rowtype; query jsonb;
begin
  select * into strict root from public.product_experiments where id=p_root_id and business_id=p_business_id
    and discovery_version='pod-discovery-2.0' and parent_discovery_id is null and candidate_id is null and status='failed';
  select * into strict r from public.workflow_runs where id=root.workflow_run_id and business_id=p_business_id and status='failed';
  if r.pack_snapshot->'workflow'->>'key' not in ('product.discovery-v2.one','product.discovery-v2.two','product.discovery-v2.analysis') or
    r.pack_snapshot->'workflow'->>'version' is distinct from '1.0.0' or r.pack_snapshot->>'platformQualification' is distinct from 'stage13_v2_bounded_discovery' then
    raise exception 'The source must be an exact persisted v2 discovery round.';
  end if;
  perform private.stage13v2_budget_authority(root.id,false);
  select * into strict dossier from public.artifacts where id=root.source_artifact_id
    and id=private.stage4_deterministic_uuid('discovery:v2:dossier:'||r.id) and business_id=p_business_id and workflow_run_id=r.id
    and artifact_type='product.discovery-dossier.v2' and media_type='application/json';
  if dossier.content->>'version' is distinct from 'pod-discovery-2.0' or dossier.content->>'intentId' is distinct from root.id::text or
    dossier.content->>'businessId' is distinct from p_business_id::text or dossier.metadata->>'contentHash' is distinct from private.stage14_hash(dossier.content) or
    dossier.content-array['version','intentId','businessId','packRefs','shortlist','comparisonRationale']<>'{}'::jsonb or
    jsonb_typeof(dossier.content->'packRefs') is distinct from 'array' or jsonb_array_length(dossier.content->'packRefs') not between 1 and 4 or
    (select count(distinct x->>'artifactId') from jsonb_array_elements(dossier.content->'packRefs') x)<>jsonb_array_length(dossier.content->'packRefs') or
    jsonb_typeof(dossier.content->'shortlist') is distinct from 'array' or jsonb_array_length(dossier.content->'shortlist') not between 1 and 3 then
    raise exception 'Evidence reuse requires the exact frozen bounded dossier of the failed round.';
  end if;
  select * into strict plan_artifact from public.artifacts where id=case when r.pack_snapshot->'workflow'->>'key'='product.discovery-v2.analysis'
      then (root.variables->'analysisSource'->>'planArtifactId')::uuid else private.stage4_deterministic_uuid('pack:output:'||r.id||':plan') end
    and business_id=p_business_id and artifact_type='worker.output' and media_type='application/json';
  select * into strict plan_root from public.product_experiments where workflow_run_id=plan_artifact.workflow_run_id and business_id=p_business_id
    and discovery_version='pod-discovery-2.0' and parent_discovery_id is null and candidate_id is null;
  if plan_root.variables->>'budgetAuthorityRootId' is distinct from root.variables->>'budgetAuthorityRootId' or
    plan_root.variables->>'semanticGoalHash' is distinct from root.variables->>'semanticGoalHash' or
    plan_artifact.id<>private.stage4_deterministic_uuid('pack:output:'||plan_root.workflow_run_id||':plan') or
    plan_artifact.content->>'version' is distinct from 'pod-discovery-2.0' or plan_artifact.content->>'intentId' is distinct from plan_root.id::text or
    plan_artifact.content->>'comparisonRationale' is distinct from dossier.content->>'comparisonRationale' or
    (r.pack_snapshot->'workflow'->>'key'='product.discovery-v2.analysis' and root.variables->'analysisSource'->>'planHash' is distinct from private.stage14_hash(plan_artifact.content)) then
    raise exception 'The reused plan must retain its original goal, round and dossier provenance.';
  end if;
  perform private.stage13v2_budget_authority(plan_root.id,false);
  select * into strict s from public.workflow_stage_runs where workflow_run_id=plan_root.workflow_run_id and business_id=p_business_id and stage_key='plan' and attempt=1 and status='completed';
  select * into strict t from public.task_contracts where id=plan_artifact.task_contract_id and id=private.stage4_deterministic_uuid('pack:task:'||plan_root.workflow_run_id||':plan')
    and workflow_run_id=plan_root.workflow_run_id and business_id=p_business_id and workflow_stage_run_id=s.id and status='completed';
  select * into strict w from public.worker_runs where id=private.stage4_deterministic_uuid('pack:worker:'||plan_root.workflow_run_id||':plan')
    and workflow_run_id=plan_root.workflow_run_id and business_id=p_business_id and task_contract_id=t.id and worker_definition_id=t.worker_definition_id and status='completed';
  receipt:=plan_artifact.metadata->'receipt';
  if plan_artifact.content is distinct from s.output or plan_artifact.content is distinct from w.output or
    w.execution_metadata->'receipt' is distinct from receipt or w.execution_metadata->>'outputArtifactId' is distinct from plan_artifact.id::text or
    plan_artifact.metadata->>'stageKey' is distinct from 'plan' or receipt->>'receiptVersion' is distinct from '1.0' or
    receipt->>'taskContractId' is distinct from t.id::text or receipt->'inputArtifactIds' is distinct from to_jsonb(t.input_artifact_ids) or
    not(private.stage4_deterministic_uuid('pack:input:'||plan_root.workflow_run_id||':plan')=any(t.input_artifact_ids)) or
    not exists(select 1 from public.worker_definitions d join public.packs p on p.id=d.pack_id where d.id=w.worker_definition_id and d.worker_key='product.discovery-v2.plan' and d.version='1.0.0' and p.pack_key='worker.product-discovery-v2-plan' and p.version='1.0.0') or
    receipt->>'packKey' is distinct from 'worker.product-discovery-v2-plan' or receipt->>'packVersion' is distinct from '1.0.0' or
    receipt->>'workerKey' is distinct from 'product.discovery-v2.plan' or receipt->>'workerVersion' is distinct from '1.0.0' or
    receipt->>'executionMode' is distinct from 'discovery.plan' or receipt->>'stopReason' is distinct from 'bounded_discovery_phase_completed' or
    receipt->>'provider' is distinct from 'openrouter' or receipt->>'actualProviderModelId' is distinct from 'openai/gpt-5.6-luna' or
    receipt->'primaryOnly' is distinct from 'true'::jsonb or receipt->'mockProvider' is distinct from 'false'::jsonb or receipt->'outputValidated' is distinct from 'true'::jsonb or
    receipt->>'intentId' is distinct from plan_root.id::text or receipt->>'callKey' is distinct from 'plan:1' or
    not exists(select 1 from public.product_research_cost_reservations cr join public.product_research_cost_settlements cs on cs.reservation_id=cr.id
      where cr.business_id=p_business_id and cr.experiment_id=plan_root.id and cr.workflow_run_id=plan_root.workflow_run_id and cr.attempt_key='plan:1'
        and cs.business_id=p_business_id and cs.reported_microusd is not null and cs.provider_request_id=receipt->>'providerRequestId') then
    raise exception 'Plan reuse requires its completed task, worker and known original model charge.';
  end if;
  for ref in select value from jsonb_array_elements(dossier.content->'packRefs') loop
    select * into strict source_artifact from public.artifacts where id=(ref->>'artifactId')::uuid and business_id=p_business_id and artifact_type='worker.output';
    select * into strict source_run from public.workflow_runs where id=source_artifact.workflow_run_id and business_id=p_business_id and status in ('completed','failed');
    if source_run.pack_snapshot->'workflow'->>'key'='research.public-evidence' then
      pack:=private.stage13_validated_evidence(source_artifact.id,p_business_id,true);
      query:=jsonb_build_object('id',private.stage4_deterministic_uuid('discovery:v2:prior-query:'||source_artifact.id),'question',source_run.input->>'question','sourceDomains',source_run.input->'sourceDomains');
    else
      query:=private.stage13v2_validated_evidence(source_artifact.id,p_business_id);
      pack:=query->'evidencePack';
      query:=jsonb_build_object('id',query->>'queryId','question',query->>'question','sourceDomains',query->'sourceDomains');
    end if;
    if ref->>'sha256' is distinct from private.stage14_hash(pack) or ref->'query' is distinct from query or
      exists(select 1 from jsonb_array_elements_text(query->'sourceDomains') d where not((root.variables->'intent'->'comparisonUniverse'->'sourceDomains') ? d)) or
      exists(select 1 from jsonb_array_elements(pack->'sources') x where (x->>'retrievalExpiresAt')::timestamptz<=clock_timestamp()) then
      raise exception 'Every carried Evidence Pack must preserve validated fresh source and query lineage.';
    end if;
  end loop;
  return jsonb_build_object('sourceRootId',root.id,'planArtifactId',plan_artifact.id,'planHash',private.stage14_hash(plan_artifact.content),
    'dossierArtifactId',dossier.id,'dossierHash',private.stage14_hash(dossier.content));
end; $$;
revoke all on function private.stage13v2_analysis_source(uuid,uuid) from public,anon,authenticated,service_role;

-- Fail closed on unexpected installed function drift; CREATE OR REPLACE retains
-- signature, owner, SECURITY DEFINER/invoker mode, search_path and existing ACLs.
do $migration$
declare patch record; definition text;
begin
  for patch in select * from (values
    ('private.stage13v2_validate_persisted(uuid,boolean)',
     $old$'product.discovery-v2.one','product.discovery-v2.two'$old$,
     $new$'product.discovery-v2.one','product.discovery-v2.two','product.discovery-v2.analysis'$new$,1),
    ('private.stage13v2_runtime_context(uuid,text)',
     $old$'product.discovery-v2.one','product.discovery-v2.two'$old$,
     $new$'product.discovery-v2.one','product.discovery-v2.two','product.discovery-v2.analysis'$new$,1),
    ('public.begin_installed_pack_run(uuid,uuid,text,jsonb,text,uuid,text)',
     $old$'product.discovery-v2.one','product.discovery-v2.two'$old$,
     $new$'product.discovery-v2.one','product.discovery-v2.two','product.discovery-v2.analysis'$new$,1),
    ('private.stage13_research_write_guard()',
     $old$'product.discovery-v2.one','product.discovery-v2.two'$old$,
     $new$'product.discovery-v2.one','product.discovery-v2.two','product.discovery-v2.analysis'$new$,4),
    ('private.stage13v2_validate_persisted(uuid,boolean)',
     $old$coalesce(limits->'maximumNewCollections','null') not in ('1'::jsonb,'2'::jsonb)$old$,
     $new$coalesce(limits->'maximumNewCollections','null') not in ('0'::jsonb,'1'::jsonb,'2'::jsonb)$new$,1),
    ('private.stage13v2_validate_persisted(uuid,boolean)',
     $old$case collections when 1 then 'product.discovery-v2.one'$old$,
     $new$case collections when 0 then 'product.discovery-v2.analysis' when 1 then 'product.discovery-v2.one'$new$,1),
    ('private.stage13v2_validate_persisted(uuid,boolean)',
     $old$case collections when 1 then array['plan','research1','strategy','review']$old$,
     $new$case collections when 0 then array['strategy','review'] when 1 then array['plan','research1','strategy','review']$new$,1),
    ('private.stage13v2_validate_persisted(uuid,boolean)',
     $old$case collections when 1 then array['plan:1','search:1','select:1','strategy:1','review:1']$old$,
     $new$case collections when 0 then array['strategy:1','review:1'] when 1 then array['plan:1','search:1','select:1','strategy:1','review:1']$new$,1),
    ('private.stage13v2_validate_persisted(uuid,boolean)',
     $old$<>collections+3 or has_uncertain$old$,
     $new$<>(case collections when 0 then 2 else collections+3 end) or has_uncertain$new$,1),
    ('private.stage13v2_validate_persisted(uuid,boolean)',
     $old$  expected_keys:=(case collections$old$,
     $new$  if collections=0 then
    if root.variables->'analysisSource' is distinct from private.stage13v2_analysis_source((root.variables->'ownerKickoff'->'followUpBasis'->>'rootId')::uuid,root.business_id) or
      root.variables->'ownerKickoff'->'followUpBasis'->>'reason' is distinct from 'reuse_evidence_for_strategy_review' then
      raise exception 'Analysis-only authority requires the immutable failed-round source binding.';
    end if;
  elsif root.variables ? 'analysisSource' then raise exception 'Research rounds cannot claim analysis-only authority'; end if;
  expected_keys:=(case collections$new$,1),
    ('public.reserve_product_research_cost(uuid,uuid,text,text,integer,text,jsonb)',
     $old$case collection_count when 1 then array['plan:1','search:1','select:1','strategy:1','review:1']$old$,
     $new$case collection_count when 0 then array['strategy:1','review:1'] when 1 then array['plan:1','search:1','select:1','strategy:1','review:1']$new$,1),
    ('private.stage13v2_runtime_context(uuid,text)',
     $old$'worker.product-discovery-v2-review','worker.product-discovery-v2-strategy','workflow.product-discovery-v2'];$old$,
     $new$'worker.product-discovery-v2-review','worker.product-discovery-v2-strategy',
    (case when r.pack_snapshot->'workflow'->>'key'='product.discovery-v2.analysis' then 'workflow.product-discovery-v2-analysis' else 'workflow.product-discovery-v2' end)];$new$,1),
    ('private.stage13v2_runtime_context(uuid,text)',
     $old$p.pack_key='workflow.product-discovery-v2' and p.version='1.0.0'$old$,
     $new$p.pack_key=(case when r.pack_snapshot->'workflow'->>'key'='product.discovery-v2.analysis' then 'workflow.product-discovery-v2-analysis' else 'workflow.product-discovery-v2' end) and p.version='1.0.0'$new$,1),
    ('private.stage13v2_runtime_context(uuid,text)',
     $old$    select content into plan from public.artifacts where id=private.stage4_deterministic_uuid('pack:output:'||r.id||':plan') and business_id=r.business_id and workflow_run_id=r.id and artifact_type='worker.output';
    if plan is null or plan->>'version' is distinct from 'pod-discovery-2.0' or plan->>'intentId' is distinct from root.id::text or
      not exists(select 1 from public.workflow_stage_runs where workflow_run_id=r.id and stage_key='plan' and status='completed' and output=plan) then raise exception 'An immutable completed discovery plan is required.'; end if;$old$,
     $new$    if (validated->>'maximumCollections')::integer=0 then
      if p_stage_key not in ('strategy','review') then raise exception 'Analysis-only rounds cannot plan, search or select.'; end if;
      select content into strict plan from public.artifacts where id=(root.variables->'analysisSource'->>'planArtifactId')::uuid and business_id=r.business_id and artifact_type='worker.output';
      if private.stage14_hash(plan) is distinct from root.variables->'analysisSource'->>'planHash' then raise exception 'The carried plan changed.'; end if;
    else
    select content into plan from public.artifacts where id=private.stage4_deterministic_uuid('pack:output:'||r.id||':plan') and business_id=r.business_id and workflow_run_id=r.id and artifact_type='worker.output';
    if plan is null or plan->>'version' is distinct from 'pod-discovery-2.0' or plan->>'intentId' is distinct from root.id::text or
      not exists(select 1 from public.workflow_stage_runs where workflow_run_id=r.id and stage_key='plan' and status='completed' and output=plan) then raise exception 'An immutable completed discovery plan is required.'; end if;
    end if;$new$,1),
    ('private.stage13v2_runtime_context(uuid,text)',
     $old$for query in select value from jsonb_array_elements(plan->'queries') order by (value->>'ordinal')::integer loop$old$,
     $new$for query in select value from jsonb_array_elements(plan->'queries') where (validated->>'maximumCollections')::integer>0 order by (value->>'ordinal')::integer loop$new$,1),
    ('private.stage13v2_runtime_context(uuid,text)',
     $old$        insert into public.artifacts(id,business_id,workflow_run_id,artifact_type,name,media_type,content,metadata)
          values(private.stage4_deterministic_uuid('discovery:v2:dossier:'||r.id)$old$,
     $new$        if (validated->>'maximumCollections')::integer=0 and not exists(select 1 from public.artifacts previous
          where previous.id=(root.variables->'analysisSource'->>'dossierArtifactId')::uuid and previous.business_id=r.business_id
            and previous.content->'shortlist'=dossier->'shortlist' and previous.content->'comparisonRationale'=dossier->'comparisonRationale'
            and (select jsonb_agg(x order by x->>'artifactId') from jsonb_array_elements(dossier->'packRefs') x) =
                (select jsonb_agg(jsonb_set(x,'{origin}','"prior"'::jsonb) order by x->>'artifactId') from jsonb_array_elements(previous.content->'packRefs') x)) then
          raise exception 'Analysis-only dossier must preserve the complete exact shortlist and every Evidence Pack.';
        end if;
        insert into public.artifacts(id,business_id,workflow_run_id,artifact_type,name,media_type,content,metadata)
          values(private.stage4_deterministic_uuid('discovery:v2:dossier:'||r.id)$new$,1),
    ('public.begin_installed_pack_run(uuid,uuid,text,jsonb,text,uuid,text)',
     $old$chain_scope jsonb; authority_id uuid; prior_query jsonb;$old$,
     $new$chain_scope jsonb; authority_id uuid; prior_query jsonb; analysis_source jsonb;$new$,1),
    ('public.begin_installed_pack_run(uuid,uuid,text,jsonb,text,uuid,text)',
     $old$    root_id:=(intent->>'id')::uuid; authority_id:=root_id;$old$,
     $new$    if (p_workflow_key='product.discovery-v2.analysis') is distinct from (intent->'limits'->'maximumNewCollections'='0'::jsonb) or
      (p_workflow_key='product.discovery-v2.analysis' and (basis->>'reason' is distinct from 'reuse_evidence_for_strategy_review' or basis->>'rootId' is null)) then
      raise exception 'Zero collections require an explicit evidence-reuse owner kickoff; initial research cannot skip its plan.';
    end if;
    root_id:=(intent->>'id')::uuid; authority_id:=root_id;$new$,1),
    ('public.begin_installed_pack_run(uuid,uuid,text,jsonb,text,uuid,text)',
     $old$(prior.status='failed' and basis->>'reason'='retry_after_known_failed_call')$old$,
     $new$(prior.status='failed' and (basis->>'reason'='retry_after_known_failed_call' and p_workflow_key<>'product.discovery-v2.analysis' or basis->>'reason'='reuse_evidence_for_strategy_review' and p_workflow_key='product.discovery-v2.analysis'))$new$,1),
    ('public.begin_installed_pack_run(uuid,uuid,text,jsonb,text,uuid,text)',
     $old$    for prior_id in select value::uuid from jsonb_array_elements_text(p_input->'priorArtifactIds') loop$old$,
     $new$    if p_workflow_key='product.discovery-v2.analysis' then
      analysis_source:=private.stage13v2_analysis_source(prior.id,p_business_id);
      if (intent-array['id','expiresAt','limits']) is distinct from ((prior.variables->'intent')-array['id','expiresAt','limits']) or
        ((intent->'limits')-array['maximumNewCollections','maximumMicrousd']) is distinct from ((prior.variables->'intent'->'limits')-array['maximumNewCollections','maximumMicrousd']) or
        (select jsonb_agg(x order by x) from jsonb_array_elements(p_input->'priorArtifactIds') x) is distinct from
        (select jsonb_agg(x->'artifactId' order by x->'artifactId') from public.artifacts a cross join lateral jsonb_array_elements(a.content->'packRefs') x where a.id=(analysis_source->>'dossierArtifactId')::uuid and a.business_id=p_business_id) or
        exists(select 1 from public.product_experiments active join public.workflow_runs active_run on active_run.id=active.workflow_run_id and active_run.business_id=active.business_id
          where active.business_id=p_business_id and active.discovery_version='pod-discovery-2.0' and active.parent_discovery_id is null and active.variables->>'budgetAuthorityRootId'=authority_id::text
            and (active.status not in ('completed','failed') or active_run.status not in ('completed','failed'))) then
        raise exception 'Evidence reuse must retain the exact goal and all packs, with no overlapping active round.';
      end if;
    end if;
    for prior_id in select value::uuid from jsonb_array_elements_text(p_input->'priorArtifactIds') loop$new$,1),
    ('public.begin_installed_pack_run(uuid,uuid,text,jsonb,text,uuid,text)',
     $old$pack_key='workflow.product-discovery-v2' and version='1.0.0' and status='experimental'$old$,
     $new$pack_key=(case when p_workflow_key='product.discovery-v2.analysis' then 'workflow.product-discovery-v2-analysis' else 'workflow.product-discovery-v2' end) and version='1.0.0' and status='experimental'$new$,1),
    ('public.begin_installed_pack_run(uuid,uuid,text,jsonb,text,uuid,text)',
     $old$'priorEvidenceHashes',prior_hashes,'semanticGoalHash',semantic_hash),$old$,
     $new$'priorEvidenceHashes',prior_hashes,'semanticGoalHash',semantic_hash)||case when analysis_source is null then '{}'::jsonb else jsonb_build_object('analysisSource',analysis_source) end,$new$,1),
    ('private.stage13v2_validate_persisted(uuid,boolean)',
     $old$octet_length(strategy::text)>32768$old$,
     $new$octet_length(strategy::text)>65536$new$,1),
    ('public.installed_pack_runtime_transition(uuid,uuid,text,text,jsonb)',
     $old$octet_length(v_output::text)>(case when v_stage_key='review' then 16384 else 32768 end)$old$,
     $new$octet_length(v_output::text)>(case when v_stage_key='review' then 16384 when v_stage_key='strategy' then 65536 else 32768 end)$new$,1)
    ,('private.stage13v2_runtime_context(uuid,text)',
     $old$  if p_stage_key='plan' then$old$,
     $new$  if (validated->>'maximumCollections')::integer=0 and p_stage_key not in ('strategy','review') then raise exception 'Analysis-only rounds cannot plan, search or select.'; end if;
  if p_stage_key='plan' then$new$,1)
  ) as edits(signature,old_text,new_text,expected_count) loop
    definition:=pg_get_functiondef(patch.signature::regprocedure);
    if (length(definition)-length(replace(definition,patch.old_text,'')))/length(patch.old_text)<>patch.expected_count then
      raise exception 'Evidence-reuse migration refused unexpected function drift: %',patch.signature;
    end if;
    execute replace(definition,patch.old_text,patch.new_text);
  end loop;
end; $migration$;

-- Immutable new workflow release; the original discovery manifests are unchanged.
select private.stage10_register_pack('{"frameworkVersion":"1.0","packKey":"workflow.product-discovery-v2-analysis","version":"1.0.0","kind":"workflow","name":"Evidence reuse · strategy and independent review","description":"Explicitly quoted two-call continuation of a terminal geographic discovery round, reusing its completed plan and every validated Evidence Pack without new collection or selection. Experimental; no creative or commerce authority.","dependencies":[{"packKey":"worker.product-discovery-v2-plan","version":"1.0.0"},{"packKey":"worker.product-discovery-v2-research","version":"1.0.0"},{"packKey":"worker.product-discovery-v2-strategy","version":"1.0.0"},{"packKey":"worker.product-discovery-v2-review","version":"1.0.0"}],"ui":{"category":"Etsy POD · Research","summary":"App-researched starting-market recommendations with explicit evidence, uncertainty and bounded follow-up.","supportedBusinessTypes":["etsy-pod"]},"evals":["schema","owner-isolation","geographic-comparison","source-linkage","exact-spans","immutable-rounds","cost-replay","actual-model-independence","unknowns","no-commerce-authority","live-qualification"],"capabilities":[],"knowledge":[],"workers":[],"workflows":[{"key":"product.discovery-v2.analysis","version":"1.0.0","name":"Preserved evidence · strategy and independent review","description":"Explicitly quoted two-call continuation of a terminal geographic discovery round, reusing its completed plan and every validated Evidence Pack without new collection or selection. Experimental; no creative or commerce authority.","inputSchema":{"type":"object","additionalProperties":false,"required":["intentId"],"properties":{"intentId":{"type":"string","pattern":"^[0-9a-f-]{36}$"}}},"outputSchema":{"type":"object","additionalProperties":false,"required":["version","intentId","dossierHash","assessmentHash","execution","marketCountryCode","candidateId","outcome","sufficiencyRationale","dimensions","checks","executionPrerequisites","additionalUncertainties","missingQuestions","publicationAllowed","commerceAllowed"],"properties":{"version":{"const":"pod-discovery-2.0"},"intentId":{"type":"string","format":"uuid"},"dossierHash":{"type":"string","pattern":"^[a-f0-9]{64}$","minLength":64,"maxLength":64},"assessmentHash":{"type":"string","pattern":"^[a-f0-9]{64}$","minLength":64,"maxLength":64},"execution":{"type":"object","additionalProperties":false,"required":["modelId","providerRequestId","primaryOnly"],"properties":{"modelId":{"const":"anthropic/claude-haiku-4.5"},"providerRequestId":{"type":"string","minLength":3,"maxLength":240},"primaryOnly":{"const":true}}},"marketCountryCode":{"anyOf":[{"type":"string","pattern":"^[A-Z]{2}$","minLength":2,"maxLength":2},{"type":"null"}]},"candidateId":{"anyOf":[{"type":"string","format":"uuid"},{"type":"null"}]},"outcome":{"type":"string","enum":["TEST","REJECT","NEEDS_MORE_EVIDENCE"]},"sufficiencyRationale":{"type":"string","minLength":60,"maxLength":1600},"dimensions":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["dimension","verdict","rationale","evidenceRefs"],"properties":{"dimension":{"type":"string","enum":["demand","competition","differentiation","estimated_margin","creative_opportunity","seasonality","production_complexity","policy_ip_risk","marketing_potential"]},"verdict":{"type":"string","enum":["sufficient_for_test","nonblocking_unknown","blocking","known_failure"]},"rationale":{"type":"string","minLength":30,"maxLength":1200},"evidenceRefs":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["artifactId","evidenceId","sourceId","sourceContentHash","start","end"],"properties":{"artifactId":{"type":"string","format":"uuid"},"evidenceId":{"type":"string","pattern":"^evi-[a-f0-9]{24}$","minLength":28,"maxLength":28},"sourceId":{"type":"string","pattern":"^src-[a-f0-9]{24}$","minLength":28,"maxLength":28},"sourceContentHash":{"type":"string","pattern":"^[a-f0-9]{64}$","minLength":64,"maxLength":64},"start":{"type":"integer","minimum":0,"maximum":1799},"end":{"type":"integer","minimum":1,"maximum":1800}}},"minItems":0,"maxItems":8,"uniqueItems":true}}},"minItems":0,"maxItems":9},"checks":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["check","outcome","rationale"],"properties":{"check":{"type":"string","enum":["source_support","alternative_comparison","test_learnability","uncertainty_handling","hard_gates"]},"outcome":{"type":"string","enum":["PASS","FAIL"]},"rationale":{"type":"string","minLength":30,"maxLength":1200}}},"minItems":5,"maxItems":5},"executionPrerequisites":{"type":"object","additionalProperties":false,"required":["ownerCreativeApproval","freshBudgetApproval","conceptSpecificIpScreen","printValidation"],"properties":{"ownerCreativeApproval":{"const":"required"},"freshBudgetApproval":{"const":"required"},"conceptSpecificIpScreen":{"const":"required"},"printValidation":{"const":"required"}}},"additionalUncertainties":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["dimension","question","blockingForTest","reason"],"properties":{"dimension":{"type":"string","enum":["demand","competition","differentiation","estimated_margin","creative_opportunity","seasonality","production_complexity","policy_ip_risk","marketing_potential"]},"question":{"type":"string","minLength":15,"maxLength":240},"blockingForTest":{"type":"boolean"},"reason":{"type":"string","minLength":30,"maxLength":300}}},"minItems":0,"maxItems":18},"missingQuestions":{"type":"array","items":{"type":"string","minLength":15,"maxLength":240},"minItems":0,"maxItems":81,"uniqueItems":true},"publicationAllowed":{"const":false},"commerceAllowed":{"const":false}}},"sampleInput":{"intentId":"11111111-1111-4111-8111-111111111111"},"stages":[{"key":"strategy","workerKey":"product.discovery-v2.strategy","workerVersion":"1.0.0","objective":"Compare geographies and all candidate alternatives, evaluating nine dimensions against the immutable dossier","inputFrom":"workflow","knowledgeKeys":["etsy.current-policy","pod.production","product.research","social.marketing"],"permittedCapabilities":[],"nonGoals":["No numeric confidence fiction, new tools, execution or commerce authority"],"completionCriteria":{"outputContract":"StrategistAssessmentV2","allNineDimensions":true}},{"key":"review","workerKey":"product.discovery-v2.review","workerVersion":"1.0.0","objective":"Independently review the exact strategy and source dossier; preserve unknowns and recommend only a justified bounded experiment","inputFrom":"strategy","knowledgeKeys":["etsy.current-policy","pod.production","product.research","social.marketing"],"permittedCapabilities":[],"nonGoals":["No same-model fallback, waived hard failure or implicit approval"],"completionCriteria":{"outputContract":"ReviewerDecisionV2","independentActualModel":true}}]}]}'::jsonb);
