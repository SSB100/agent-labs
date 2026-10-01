-- OFFLINE DRAFT: exact experimental v2 launch and authoritative phase context.
-- Existing public signatures and grants are unchanged. No release is registered
-- or promoted by this migration. Terminal v2 validation remains fail-closed.
-- The private loader returns JSON arrays; trusted Node code alone materializes
-- Maps and the evidence pool. A missing productScope is never generic authority.

alter table public.workflow_runs drop constraint pack_run_pins_required;
alter table public.workflow_runs add constraint pack_run_pins_required check (
  (pack_installation_id is null and pack_snapshot is null) or
  (jsonb_typeof(pack_snapshot)='object' and runtime_capability_hash is not null and
    (pack_installation_id is not null or
      (pack_snapshot->>'platformQualification'='stage11' and pack_snapshot->'workflow'->>'key'='research.public-evidence') or
      (pack_snapshot->>'platformQualification'='stage12' and pack_snapshot->>'mode'='simulation' and
        pack_snapshot->'workflow'->>'key'='etsy.product-discovery-simulation' and pack_snapshot->'workflow'->>'version'='1.0.0') or
      (pack_snapshot->>'platformQualification'='stage13_v2_bounded_discovery' and
        pack_snapshot->'workflow'->>'key' in ('product.discovery-v2.one','product.discovery-v2.two') and
        pack_snapshot->'workflow'->>'version'='1.0.0'))));

-- This loader has no public role grant and no caller-controlled scope flag.
create function private.stage13v2_runtime_context(p_workflow_run_id uuid,p_stage_key text default null)
returns jsonb language plpgsql set search_path='' as $$
declare r public.workflow_runs%rowtype; root public.product_experiments%rowtype; e public.product_experiments%rowtype;
  a public.artifacts%rowtype; source_artifact public.artifacts%rowtype; input_artifact public.artifacts%rowtype;
  stage_row public.workflow_stage_runs%rowtype; task_row public.task_contracts%rowtype; worker_row public.worker_runs%rowtype;
  source_run public.workflow_runs%rowtype; candidate public.product_candidates%rowtype;
  scope jsonb; phase jsonb; validated jsonb; knowledge jsonb; pins jsonb:='[]'; item jsonb; rel jsonb; k jsonb;
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
          select * into strict source_run from public.workflow_runs where id=a.workflow_run_id and business_id=r.business_id and status='completed';
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
          if source_intent<>root.id and source_run.status<>'completed' then raise exception 'Prior discovery packs require a completed source run.'; end if;
          select * into strict stage_row from public.workflow_stage_runs where workflow_run_id=source_run.id and business_id=r.business_id and stage_key=a.metadata->>'stageKey' and stage_key in ('research1','research2') and status='completed';
          select * into strict task_row from public.task_contracts where id=a.task_contract_id and workflow_stage_run_id=stage_row.id and workflow_run_id=source_run.id and business_id=r.business_id and status='completed';
          select * into strict worker_row from public.worker_runs where id=private.stage4_deterministic_uuid('pack:worker:'||source_run.id||':'||stage_row.stage_key) and task_contract_id=task_row.id and workflow_run_id=source_run.id and business_id=r.business_id and status='completed';
          select * into strict source_artifact from public.artifacts where id=private.stage4_deterministic_uuid('research:sources:'||source_run.id||':'||stage_row.stage_key) and task_contract_id=task_row.id and business_id=r.business_id and workflow_run_id=source_run.id and artifact_type='research.sources';
          select * into strict input_artifact from public.artifacts where id=private.stage4_deterministic_uuid('pack:input:'||source_run.id||':'||stage_row.stage_key) and business_id=r.business_id and workflow_run_id=source_run.id and artifact_type='pack.stage-input';
          query:=jsonb_build_object('id',input_artifact.content->>'queryId','question',input_artifact.content->>'question','sourceDomains',input_artifact.content->'sourceDomains');
          receipt:=a.metadata->'receipt'; search_receipt:=source_artifact.content->'providerMetadata'->'receipt'; pack:=a.content->'evidencePack';
          if a.id<>private.stage4_deterministic_uuid('pack:output:'||source_run.id||':'||stage_row.stage_key) or a.content is distinct from stage_row.output or a.content is distinct from worker_row.output or
            worker_row.execution_metadata->'receipt' is distinct from receipt or receipt->>'workerKey' is distinct from 'product.discovery-v2.research' or
            receipt->>'packKey' is distinct from 'worker.product-discovery-v2-research' or receipt->>'workerVersion' is distinct from '1.0.0' or receipt->>'packVersion' is distinct from '1.0.0' or
            receipt->>'intentId' is distinct from source_intent::text or receipt->>'queryId' is distinct from query->>'id' or receipt->>'callKey' is distinct from 'select:'||right(stage_row.stage_key,1) or
            receipt->>'actualProviderModelId' is distinct from 'openai/gpt-5.6-luna' or receipt->>'executionMode' is distinct from 'web.research' or receipt->>'provider' is distinct from 'openrouter' or
            receipt->'primaryOnly' is distinct from 'true'::jsonb or receipt->'mockProvider' is distinct from 'false'::jsonb or receipt->'outputValidated' is distinct from 'true'::jsonb or
            receipt->>'taskContractId' is distinct from task_row.id::text or receipt->'inputArtifactIds' is distinct from to_jsonb(task_row.input_artifact_ids) or not(source_artifact.id=any(task_row.input_artifact_ids)) or
            source_artifact.content->>'query' is distinct from query->>'question' or source_artifact.content->'providerMetadata'->>'intentId' is distinct from source_intent::text or
            source_artifact.content->'providerMetadata'->>'queryId' is distinct from query->>'id' or
            not exists(select 1 from public.product_research_cost_reservations cr join public.product_research_cost_settlements cs on cs.reservation_id=cr.id
              where cr.experiment_id=source_intent and cr.attempt_key=receipt->>'callKey' and cs.reported_microusd is not null and cs.provider_request_id=receipt->>'providerRequestId') or
            not exists(select 1 from public.product_research_cost_reservations cr join public.product_research_cost_settlements cs on cs.reservation_id=cr.id
              where cr.experiment_id=source_intent and cr.attempt_key='search:'||right(stage_row.stage_key,1) and cs.reported_microusd is not null and cs.provider_request_id=source_artifact.content->'providerMetadata'->>'providerRequestId') then
            raise exception 'Dossier evidence requires exact completed research, task, model and paid-call lineage.'; end if;
          if a.content->>'decision' is distinct from 'complete' or a.content->>'stopReason' is distinct from 'evidence_collected' or
            pack->>'evidencePackVersion' is distinct from '1.0' or pack->>'question' is distinct from query->>'question' or
            pack-array['evidencePackVersion','question','sources','evidence','claims','limitations']<>'{}'::jsonb or
            jsonb_typeof(pack->'sources') is distinct from 'array' or jsonb_array_length(pack->'sources') not between 1 and 4 or
            jsonb_typeof(pack->'evidence') is distinct from 'array' or jsonb_array_length(pack->'evidence') not between 1 and 4 or
            jsonb_typeof(pack->'claims') is distinct from 'array' or jsonb_array_length(pack->'claims')<>jsonb_array_length(pack->'evidence') then raise exception 'Invalid v2 Evidence Pack.'; end if;
          for src in select value from jsonb_array_elements(pack->'sources') loop
            hostname:=substring(src->>'url' from '^https://([a-z0-9.-]+)/');
            if not exists(select 1 from jsonb_array_elements(source_artifact.content->'sources') x where x=src) or
              src->>'provider' is distinct from 'openrouter.exa' or hostname is null or src->>'url' ~ '[#[:space:]]' or src->>'url' ~* '[?&](token|access_token|api_key|auth|password|utm_[^=]*|fbclid|gclid)=' or
              not exists(select 1 from jsonb_array_elements_text(query->'sourceDomains') d where hostname=d or hostname like '%.'||d) or
              length(src->>'excerpt') not between 30 and 1800 or src->>'contentHash' is distinct from private.stage13_hash(src->>'excerpt') or
              src->>'id' is distinct from 'src-'||left(private.stage13_hash((src->>'url')||':'||(src->>'contentHash')),24) or
              (src->>'retrievedAt')::timestamptz>clock_timestamp()+interval '5 minutes' or (src->>'retrievalExpiresAt')::timestamptz<=clock_timestamp() or
              (src->>'retrievalExpiresAt')::timestamptz not between (src->>'retrievedAt')::timestamptz and (src->>'retrievedAt')::timestamptz+interval '1 day' then raise exception 'Dossier source is forged, stale or out of scope.'; end if;
          end loop;
          for evidence in select value from jsonb_array_elements(pack->'evidence') loop
            -- V2 may select any retained exact span; prefix-only v1 IDs are not required.
            if length(evidence->>'quote') not between 20 and 320 or evidence->>'id' is distinct from 'evi-'||left(private.stage13_hash((evidence->>'sourceId')||':'||(evidence->>'quote')),24) or
              not exists(select 1 from jsonb_array_elements(pack->'sources') x where x->>'id'=evidence->>'sourceId' and strpos(x->>'excerpt',evidence->>'quote')>0) or
              (select count(*) from jsonb_array_elements(pack->'claims') x where x->>'evidenceId'=evidence->>'id' and x->>'sourceId'=evidence->>'sourceId' and x->>'text'=evidence->>'quote')<>1 then raise exception 'V2 selected evidence is not an exact retained source span.'; end if;
          end loop;
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
revoke all on function private.stage13v2_runtime_context(uuid,text) from public,anon,authenticated,service_role;

create or replace function public.begin_installed_pack_run(p_business_id uuid,p_installation_id uuid,p_workflow_key text,p_input jsonb,p_idempotency_key text,p_launch_nonce uuid,p_runtime_capability text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_install public.installed_packs%rowtype; v_definition public.workflow_definitions%rowtype; v_workflow jsonb; v_id uuid; s jsonb; n integer:=0;
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
    root_id:=(intent->>'id')::uuid;
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
      if exists(select 1 from public.product_research_cost_reservations cr where cr.experiment_id=prior.id and not exists(
        select 1 from public.product_research_cost_settlements cs where cs.reservation_id=cr.id and cs.reported_microusd is not null and cs.provider_request_id is not null)) then
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
        'ownerKickoff',kickoff||jsonb_build_object('ownerUserId',auth.uid(),'recordedAt',now()),'priorArtifactIds',p_input->'priorArtifactIds','priorEvidenceHashes',prior_hashes,'semanticGoalHash',semantic_hash),
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

-- Preserve the generic engine and create the v2 scoped input at first prepare.
create or replace function private.stage10_installed_pack_runtime_transition(p_workflow_run_id uuid,p_business_id uuid,p_runtime_capability text,p_operation text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  r public.workflow_runs%rowtype; s public.workflow_stage_runs%rowtype; t public.task_contracts%rowtype;
  w public.worker_runs%rowtype; d public.worker_definitions%rowtype;
  stage jsonb; worker jsonb; knowledge jsonb; release jsonb; stage_input jsonb; context jsonb; v_output jsonb; receipt jsonb;
  v_product jsonb; v_phase jsonb;
  v_stage_key text:=p_payload->>'stageKey'; task_id uuid; worker_id uuid; artifact_id uuid; artifact_ids uuid[]:='{}'; k text;
begin
  if p_runtime_capability is null or length(p_runtime_capability) not between 32 and 512 or jsonb_typeof(p_payload) is distinct from 'object' or length(p_payload::text)>200000 then
    raise exception 'Pack runtime request denied.' using errcode='42501'; end if;
  select * into r from public.workflow_runs where id=p_workflow_run_id and business_id=p_business_id and pack_snapshot is not null
    and runtime_capability_hash=encode(extensions.digest(convert_to(p_runtime_capability,'UTF8'),'sha256'),'hex') for update;
  if not found then raise exception 'Pack runtime capability denied.' using errcode='42501'; end if;
  if p_operation='load' then
    if r.status in ('failed','cancelled') then raise exception 'Pack run is terminal.'; end if;
    if r.runtime_run_id is not null and r.runtime_run_id is distinct from p_payload->>'runtimeRunId' then raise exception 'Runtime identity mismatch.'; end if;
    if nullif(p_payload->>'runtimeRunId','') is null then raise exception 'Runtime identity required.'; end if;
    if r.status<>'completed' then
      update public.workflow_runs set status='running',runtime_launch_status='started',runtime_provider='vercel_workflow',runtime_run_id=p_payload->>'runtimeRunId',started_at=coalesce(started_at,now()) where id=r.id;
      insert into public.events(id,business_id,workflow_run_id,event_type,actor_type,payload)
        values(private.stage4_deterministic_uuid('pack:started:'||r.id),r.business_id,r.id,'workflow.started','system',jsonb_build_object('packKey',r.pack_snapshot->'releases'->0->'manifest'->>'packKey','runtimeRunId',p_payload->>'runtimeRunId')) on conflict(id) do nothing;
    end if;
    return jsonb_build_object('snapshot',r.pack_snapshot,'input',r.input,'status',r.status);
  end if;
  if p_operation='fail' then
    if r.status in ('completed','failed') then return jsonb_build_object('status',r.status); end if;
    update public.workflow_runs set status='failed',completed_at=now(),state=jsonb_build_object('failure',p_payload) where id=r.id;
    update public.workflow_stage_runs set status=(case when status='running' then 'failed' else 'skipped' end),failure=p_payload,completed_at=now() where workflow_run_id=r.id and status in ('pending','running');
    update public.task_contracts set status='failed' where workflow_run_id=r.id and status in ('draft','ready','running');
    update public.worker_runs set status='failed',failure=p_payload,completed_at=now() where workflow_run_id=r.id and status in ('queued','running');
    insert into public.events(id,business_id,workflow_run_id,event_type,actor_type,payload) values(private.stage4_deterministic_uuid('pack:failed:'||r.id),r.business_id,r.id,'workflow.failed','system',p_payload) on conflict(id) do nothing;
    return jsonb_build_object('status','failed');
  end if;
  if p_operation in ('output','complete') then
    if exists(select 1 from public.workflow_stage_runs where workflow_run_id=r.id and status<>'completed') or r.status not in ('running','completed') then raise exception 'Stages are not complete.'; end if;
    select output into v_output from public.workflow_stage_runs where workflow_run_id=r.id order by sequence desc limit 1;
    if p_operation='output' then return jsonb_build_object('output',v_output,'schema',r.pack_snapshot->'workflow'->'outputSchema'); end if;
    update public.workflow_runs set status='completed',current_stage_key=null,completed_at=coalesce(completed_at,now()),state=jsonb_build_object('output',v_output) where id=r.id;
    insert into public.events(id,business_id,workflow_run_id,event_type,actor_type,payload) values(private.stage4_deterministic_uuid('pack:completed:'||r.id),r.business_id,r.id,'workflow.completed','system',jsonb_build_object('output',v_output)) on conflict(id) do nothing;
    return jsonb_build_object('status','completed','output',v_output);
  end if;
  if r.status not in ('running','completed') then raise exception 'Pack run is not running.'; end if;
  select value into strict stage from jsonb_array_elements(r.pack_snapshot->'workflow'->'stages') where value->>'key'=v_stage_key;
  select * into strict s from public.workflow_stage_runs where workflow_run_id=r.id and stage_key=stage->>'key' and attempt=1 for update;
  if exists(select 1 from public.workflow_stage_runs where workflow_run_id=r.id and sequence<s.sequence and status<>'completed') then raise exception 'Earlier stages must complete first.'; end if;
  task_id:=private.stage4_deterministic_uuid('pack:task:'||r.id||':'||v_stage_key);
  worker_id:=private.stage4_deterministic_uuid('pack:worker:'||r.id||':'||v_stage_key);
  select x.value,y.value into strict worker,release from jsonb_array_elements(r.pack_snapshot->'releases') y
    cross join lateral jsonb_array_elements(y.value->'manifest'->'workers') x
    where x.value->'manifest'->'worker'->>'workerKey'=stage->>'workerKey' and x.value->'manifest'->'worker'->>'version'=stage->>'workerVersion';
  select * into strict d from public.worker_definitions where pack_id=(release->>'id')::uuid and worker_key=stage->>'workerKey' and version=stage->>'workerVersion';
  select * into w from public.worker_runs where id=worker_id and business_id=r.business_id;
  if found and w.status='completed' and p_operation in ('prepare','persist') then
    return jsonb_build_object('completed',true,'output',w.output,'receipt',w.execution_metadata->'receipt');
  end if;
  if p_operation='prepare' then
    if s.status in ('failed','skipped') then raise exception 'Stage is terminal.'; end if;
    v_product:=private.stage13v2_runtime_context(r.id,v_stage_key);
    if v_product->'productScope'->>'version'='pod-discovery-2.0' then
      stage_input:=v_product->'discoveryPhase';
    elsif stage->>'inputFrom'='workflow' then stage_input:=r.input; else
      select output into strict stage_input from public.workflow_stage_runs where workflow_run_id=r.id and stage_key=stage->>'inputFrom' and status='completed'; end if;
    artifact_id:=private.stage4_deterministic_uuid('pack:input:'||r.id||':'||v_stage_key);
    insert into public.artifacts(id,business_id,workflow_run_id,artifact_type,name,media_type,content,metadata)
      values(artifact_id,r.business_id,r.id,'pack.stage-input','Stage input','application/json',stage_input,jsonb_build_object('stageKey',v_stage_key)) on conflict(id) do nothing;
    if v_product->'productScope'->>'version'='pod-discovery-2.0' and not exists(select 1 from public.artifacts a where a.id=artifact_id and a.business_id=r.business_id and a.workflow_run_id=r.id and a.artifact_type='pack.stage-input' and a.content=stage_input) then
      raise exception 'The first prepared phase input is immutable.'; end if;
    artifact_ids:=array[artifact_id];
    for k in select jsonb_array_elements_text(stage->'knowledgeKeys') loop
      select x.value,y.value into strict knowledge,release from jsonb_array_elements(r.pack_snapshot->'releases') y
        cross join lateral jsonb_array_elements(y.value->'manifest'->'knowledge') x where x.value->>'key'=k;
      if (knowledge->>'verifiedAt')::timestamptz + (knowledge->>'freshnessDays')::integer * interval '1 day'<now() then raise exception 'Required knowledge is stale.'; end if;
      artifact_id:=private.stage4_deterministic_uuid('pack:knowledge:'||r.id||':'||v_stage_key||':'||k);
      insert into public.artifacts(id,business_id,workflow_run_id,artifact_type,name,media_type,content,metadata) values
        (artifact_id,r.business_id,r.id,'pack.knowledge',knowledge->>'name','application/json',knowledge->'content',jsonb_build_object('knowledgeKey',k,'knowledgeVersion',knowledge->>'version','packId',release->>'id','source',knowledge->>'source','verifiedAt',knowledge->>'verifiedAt')) on conflict(id) do nothing;
      artifact_ids:=array_append(artifact_ids,artifact_id);
    end loop;
    insert into public.task_contracts(id,business_id,workflow_run_id,workflow_stage_run_id,worker_definition_id,status,objective,input_artifact_ids,permitted_capabilities,required_knowledge,required_output_schema,completion_criteria,failure_criteria,non_goals,escalation_rules)
      values(task_id,r.business_id,r.id,s.id,d.id,'running',stage->>'objective',artifact_ids,
        array(select jsonb_array_elements_text(stage->'permittedCapabilities')),array(select jsonb_array_elements_text(stage->'knowledgeKeys')),
        worker->'manifest'->'outputSchema',stage->'completionCriteria',jsonb_build_object('onInvalidOutput','fail'),
        array(select jsonb_array_elements_text(stage->'nonGoals')),jsonb_build_object('onFailure','classify_and_stop','maximumAttempts',1)) on conflict(id) do nothing;
    select * into strict t from public.task_contracts where id=task_id and business_id=r.business_id and workflow_run_id=r.id;
    select jsonb_build_object('taskContract',jsonb_build_object('id',t.id,'objective',t.objective,'inputArtifactIds',to_jsonb(t.input_artifact_ids),
      'permittedCapabilities',to_jsonb(t.permitted_capabilities),'requiredKnowledge',to_jsonb(t.required_knowledge),'requiredOutputSchema',t.required_output_schema,
      'completionCriteria',t.completion_criteria,'failureCriteria',t.failure_criteria,'nonGoals',to_jsonb(t.non_goals),'escalationRules',t.escalation_rules),
      'inputArtifacts',coalesce(jsonb_agg(jsonb_build_object('id',a.id,'artifactType',a.artifact_type,'name',a.name,'mediaType',a.media_type,'content',a.content,'metadata',a.metadata) order by a.id),'[]')) into context
      from public.artifacts a where a.id=any(t.input_artifact_ids) and a.business_id=r.business_id and a.workflow_run_id=r.id;
    insert into public.worker_runs(id,business_id,workflow_run_id,task_contract_id,worker_definition_id,status,input,output,failure,execution_metadata,started_at)
      values(worker_id,r.business_id,r.id,task_id,d.id,'running',context,'{}','{}',jsonb_build_object('packKey',worker->'manifest'->>'packKey','packVersion',worker->'manifest'->>'version','workerKey',stage->>'workerKey','workerVersion',stage->>'workerVersion'),now()) on conflict(id) do nothing;
    update public.workflow_stage_runs set status='running',started_at=coalesce(started_at,now()) where id=s.id;
    update public.workflow_runs set current_stage_key=v_stage_key where id=r.id;
    insert into public.events(id,business_id,workflow_run_id,event_type,actor_type,payload) values(private.stage4_deterministic_uuid('pack:worker-started:'||worker_id),r.business_id,r.id,'worker.started','worker',jsonb_build_object('workerRunId',worker_id,'stageKey',v_stage_key,'workerKey',stage->>'workerKey','workerVersion',stage->>'workerVersion')) on conflict(id) do nothing;
    return jsonb_build_object('completed',false,'worker',worker,'context',context);
  elsif p_operation='persist' then
    v_output:=p_payload->'output'; receipt:=p_payload->'receipt';
    if w.id is null or w.status<>'running' or jsonb_typeof(v_output) is distinct from 'object' or
      receipt->>'outputValidated' is distinct from 'true' or receipt->>'taskContractId' is distinct from task_id::text or
      receipt->>'workerKey' is distinct from stage->>'workerKey' or receipt->>'workerVersion' is distinct from stage->>'workerVersion' or
      receipt->>'packKey' is distinct from worker->'manifest'->>'packKey' or receipt->>'packVersion' is distinct from worker->'manifest'->>'version' then
      raise exception 'Invalid scoped worker receipt.'; end if;
    artifact_id:=private.stage4_deterministic_uuid('pack:output:'||r.id||':'||v_stage_key);
    insert into public.artifacts(id,business_id,workflow_run_id,task_contract_id,artifact_type,name,media_type,content,metadata)
      values(artifact_id,r.business_id,r.id,task_id,'worker.output','Pack worker output','application/json',v_output,jsonb_build_object('receipt',receipt,'stageKey',v_stage_key)) on conflict(id) do nothing;
    update public.worker_runs set status='completed',output=v_output,completed_at=now(),execution_metadata=execution_metadata||jsonb_build_object('receipt',receipt,'outputValidated',true,'outputArtifactId',artifact_id) where id=worker_id;
    update public.task_contracts set status='completed' where id=task_id;
    update public.workflow_stage_runs set status='completed',output=v_output,completed_at=now() where id=s.id;
    insert into public.events(id,business_id,workflow_run_id,event_type,actor_type,payload) values(private.stage4_deterministic_uuid('pack:worker-completed:'||worker_id),r.business_id,r.id,'worker.completed','worker',jsonb_build_object('workerRunId',worker_id,'stageKey',v_stage_key,'workerVersion',stage->>'workerVersion','outputArtifactId',artifact_id)) on conflict(id) do nothing;
    return jsonb_build_object('completed',true,'output',v_output,'receipt',receipt);
  end if;
  raise exception 'Unknown pack runtime operation.';
end; $$;

-- Public capability boundary keeps the existing Stage 12 behavior intact.
create or replace function public.installed_pack_runtime_transition(p_workflow_run_id uuid,p_business_id uuid,p_runtime_capability text,p_operation text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.workflow_runs%rowtype; i public.owner_interventions%rowtype; v_result jsonb; v_output jsonb; receipt jsonb;
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
      perform private.stage13v2_validate_persisted((v_product->'productScope'->>'rootId')::uuid,true);
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

-- Reuse source persistence, adding only v2 paid-query lineage and exact replay.
create or replace function public.append_pack_research_sources(p_workflow_run_id uuid,p_business_id uuid,p_runtime_capability text,p_stage_key text,p_collection jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.workflow_runs%rowtype; t public.task_contracts%rowtype; w public.worker_runs%rowtype;
  v_product jsonb; receipt jsonb;
  stage jsonb; worker jsonb; v_input jsonb; v_source jsonb; v_evidence jsonb; v_hostname text; v_artifact_id uuid; v_prepared jsonb;
begin
  if p_runtime_capability is null or length(p_runtime_capability) not between 32 and 512 or jsonb_typeof(p_collection) is distinct from 'object' or length(p_collection::text)>50000 then
    raise exception 'Research source request denied.' using errcode='42501'; end if;
  select * into r from public.workflow_runs where id=p_workflow_run_id and business_id=p_business_id and pack_snapshot is not null
    and runtime_capability_hash=encode(extensions.digest(convert_to(p_runtime_capability,'UTF8'),'sha256'),'hex') for update;
  if not found then raise exception 'Research runtime capability denied.' using errcode='42501'; end if;
  v_product:=private.stage13v2_runtime_context(r.id,null);
  select value into strict stage from jsonb_array_elements(r.pack_snapshot->'workflow'->'stages') where value->>'key'=p_stage_key;
  select x.value into strict worker from jsonb_array_elements(r.pack_snapshot->'releases') y cross join lateral jsonb_array_elements(y.value->'manifest'->'workers') x
    where x.value->'manifest'->'worker'->>'workerKey'=stage->>'workerKey' and x.value->'manifest'->'worker'->>'version'=stage->>'workerVersion';
  if worker->'execution'->>'kind' is distinct from 'web.research' or not ((stage->'permittedCapabilities') ? 'web.research') then raise exception 'Stage does not authorize Web Research.' using errcode='42501'; end if;
  select * into strict t from public.task_contracts where workflow_run_id=r.id and business_id=r.business_id and workflow_stage_run_id=(select id from public.workflow_stage_runs where workflow_run_id=r.id and stage_key=p_stage_key and attempt=1);
  select * into strict w from public.worker_runs where task_contract_id=t.id and workflow_run_id=r.id and business_id=r.business_id;
  v_artifact_id:=private.stage4_deterministic_uuid('research:sources:'||r.id||':'||p_stage_key);
  if exists(select 1 from public.artifacts where id=v_artifact_id and business_id=r.business_id and workflow_run_id=r.id and task_contract_id=t.id) then
    if v_product->'productScope'->>'version'='pod-discovery-2.0' and not exists(select 1 from public.artifacts where id=v_artifact_id and content=p_collection) then raise exception 'Source replay changed the immutable collection.'; end if;
    return jsonb_build_object('artifactId',v_artifact_id,'cached',true); end if;
  if r.status<>'running' or t.status<>'running' or w.status<>'running' then raise exception 'Research stage is not running.'; end if;
  select content into strict v_input from public.artifacts where id=any(t.input_artifact_ids) and workflow_run_id=r.id and business_id=r.business_id and artifact_type='pack.stage-input';
  if v_product->'productScope'->>'version'='pod-discovery-2.0' then
    receipt:=p_collection->'providerMetadata'->'receipt';
    if p_stage_key not in ('research1','research2') or p_collection->'providerMetadata'->>'intentId' is distinct from v_product->'productScope'->>'rootId' or
      p_collection->'providerMetadata'->>'queryId' is distinct from v_input->>'queryId' or
      p_collection->'providerMetadata'->>'callKey' is distinct from 'search:'||right(p_stage_key,1) or
      p_collection->'providerMetadata'->'searchRequests' is distinct from '1'::jsonb or p_collection->'providerMetadata'->>'engine' is distinct from 'exa' or
      receipt->>'intentId' is distinct from v_product->'productScope'->>'rootId' or receipt->>'queryId' is distinct from v_input->>'queryId' or
      receipt->>'callKey' is distinct from 'search:'||right(p_stage_key,1) or receipt->>'executionMode' is distinct from 'web.research' or receipt->>'provider' is distinct from 'openrouter' or
      receipt->>'actualProviderModelId' is distinct from 'openai/gpt-5.6-luna' or receipt->'primaryOnly' is distinct from 'true'::jsonb or
      receipt->'mockProvider' is distinct from 'false'::jsonb or receipt->'outputValidated' is distinct from 'true'::jsonb or
      receipt->>'providerRequestId' is distinct from p_collection->'providerMetadata'->>'providerRequestId' or
      not exists(select 1 from public.product_research_cost_reservations cr join public.product_research_cost_settlements cs on cs.reservation_id=cr.id
        where cr.experiment_id=(v_product->'productScope'->>'rootId')::uuid and cr.workflow_run_id=r.id and cr.business_id=r.business_id and
          cr.attempt_key='search:'||right(p_stage_key,1) and cs.reported_microusd is not null and cs.provider_request_id=receipt->>'providerRequestId') then
      raise exception 'Source collection must match the exact prepared query and settled primary search call.'; end if;
  end if;
  if p_collection->>'collectionVersion' is distinct from '1.0' or p_collection->>'query' is distinct from v_input->>'question' or
    jsonb_typeof(p_collection->'sources') is distinct from 'array' or jsonb_array_length(p_collection->'sources') not between 1 and 4 or
    jsonb_typeof(p_collection->'evidence') is distinct from 'array' or jsonb_array_length(p_collection->'evidence') not between 1 and 4 then raise exception 'Invalid scoped research collection.'; end if;
  for v_source in select value from jsonb_array_elements(p_collection->'sources') loop
    v_hostname:=substring(v_source->>'url' from '^https://([a-z0-9.-]+)/');
    if v_hostname is null or not (v_source ?& array['id','url','excerpt','contentHash','retrievedAt','retrievalExpiresAt']) or
      jsonb_typeof(v_source->'retrievedAt') is distinct from 'string' or jsonb_typeof(v_source->'retrievalExpiresAt') is distinct from 'string' or
      not exists(select 1 from jsonb_array_elements_text(v_input->'sourceDomains') domain where v_hostname=domain or v_hostname like '%.'||domain) or
      v_source->>'contentHash' is distinct from encode(extensions.digest(convert_to(v_source->>'excerpt','UTF8'),'sha256'),'hex') or
      length(v_source->>'excerpt') not between 30 and 1800 or
      (v_source->>'retrievedAt')::timestamptz>now()+interval '5 minutes' or
      (v_source->>'retrievalExpiresAt')::timestamptz<now() or
      (v_source->>'retrievalExpiresAt')::timestamptz>(v_source->>'retrievedAt')::timestamptz+interval '1 day' then raise exception 'Source is out of scope, corrupt, or stale.'; end if;
  end loop;
  for v_evidence in select value from jsonb_array_elements(p_collection->'evidence') loop
    if length(v_evidence->>'quote') not between 1 and 320 or not exists(select 1 from jsonb_array_elements(p_collection->'sources') source where source->>'id'=v_evidence->>'sourceId' and strpos(source->>'excerpt',v_evidence->>'quote')>0) then
      raise exception 'Evidence does not match its source.'; end if;
  end loop;
  insert into public.artifacts(id,business_id,workflow_run_id,task_contract_id,artifact_type,name,media_type,content,metadata)
    values(v_artifact_id,r.business_id,r.id,t.id,'research.sources','Inspectable research sources','application/json',p_collection,
      jsonb_build_object('stageKey',p_stage_key,'sourceCount',jsonb_array_length(p_collection->'sources'),'providerMetadata',p_collection->'providerMetadata'));
  update public.task_contracts set input_artifact_ids=array_append(input_artifact_ids,v_artifact_id) where id=t.id;
  v_prepared:=public.installed_pack_runtime_transition(r.id,r.business_id,p_runtime_capability,'prepare',jsonb_build_object('stageKey',p_stage_key));
  update public.worker_runs set input=v_prepared->'context' where id=w.id;
  insert into public.events(id,business_id,workflow_run_id,event_type,actor_type,payload)
    values(private.stage4_deterministic_uuid('research:collected:'||r.id||':'||p_stage_key),r.business_id,r.id,'research.sources.collected','system',jsonb_build_object('artifactId',v_artifact_id,'sourceCount',jsonb_array_length(p_collection->'sources'),'stageKey',p_stage_key));
  return jsonb_build_object('artifactId',v_artifact_id,'cached',false);
end; $$;
