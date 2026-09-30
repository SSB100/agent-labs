-- Stage 13: owner-scoped, append-only original POD T-shirt discovery registry.
-- No worker is promoted here. A TEST decision never authorizes production or publication.
create function private.stage13_hash(p_text text) returns text language sql immutable strict set search_path='' as $$
  select encode(extensions.digest(convert_to(p_text,'UTF8'),'sha256'),'hex');
$$;
create function private.stage13_normalize(p_text text) returns text language sql immutable strict set search_path='' as $$
  select btrim(regexp_replace(lower(p_text),'[^a-z0-9]+',' ','g'));
$$;
create function private.stage13_question(p_concept text,p_audience text,p_hypothesis text) returns text language sql immutable strict set search_path='' as $$
  select 'Research this original print-on-demand T-shirt opportunity: '||p_concept||'. Audience: '||p_audience||'. Find candidate-specific buyer-interest, comparable listings, dated trend signals, prices and production constraints. Separate observed facts from general policy guidance. Do not infer sales or demand from listing counts. Return inspectable sources only.';
$$;
create function private.stage13_plan() returns jsonb language sql immutable set search_path='' as $$
  select '{"metric":"qualified_interest_count","minimumSampleSize":30,"minimumDays":7,"successThreshold":5,"maximumBudgetUsd":0,"channel":"research_only","stopRule":"Stop after the planned observation window; do not infer demand below both the minimum sample and duration. No publication, advertising, or spending is authorized."}'::jsonb;
$$;

create table public.product_candidates (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete restrict,
  fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
  concept text not null check(length(btrim(concept)) between 3 and 160),
  audience text not null check(length(btrim(audience)) between 3 and 160),
  hypothesis text not null check(length(btrim(hypothesis)) between 10 and 600),
  product_type text not null default 'original_pod_tshirt' check(product_type='original_pod_tshirt'),
  original_design boolean not null, rights_status text not null check(rights_status in ('confirmed','unclear')),
  source_domains text[] not null check(cardinality(source_domains) between 1 and 6), created_at timestamptz not null default now(),
  unique(business_id,fingerprint), unique(id,business_id)
);
alter table public.artifacts add constraint stage13_artifact_workflow_identity unique(id,workflow_run_id,business_id);
create table public.product_experiments (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete restrict,
  candidate_id uuid not null, workflow_run_id uuid, fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
  hypothesis text not null, variables jsonb not null check(jsonb_typeof(variables)='object'), audience text not null,
  creative jsonb check(creative is null), price numeric check(price is null), channel text not null default 'research_only' check(channel='research_only'),
  status text not null check(status in ('reserved','researching','completed','failed')),
  measurement_plan jsonb not null check(measurement_plan=private.stage13_plan()),
  evidence_pack jsonb, source_artifact_id uuid, basis_artifact_id uuid, failure text,
  started_at timestamptz, completed_at timestamptz, created_at timestamptz not null default now(),
  foreign key(candidate_id,business_id) references public.product_candidates(id,business_id) on delete restrict,
  foreign key(workflow_run_id,business_id) references public.workflow_runs(id,business_id) on delete restrict,
  foreign key(source_artifact_id,workflow_run_id,business_id) references public.artifacts(id,workflow_run_id,business_id) on delete restrict,
  foreign key(basis_artifact_id,workflow_run_id,business_id) references public.artifacts(id,workflow_run_id,business_id) on delete restrict,
  check((source_artifact_id is null and evidence_pack is null) or (source_artifact_id is not null and workflow_run_id is not null and jsonb_typeof(evidence_pack)='object')),
  check(basis_artifact_id is null or workflow_run_id is not null),
  check(status<>'completed' or (evidence_pack is not null and source_artifact_id is not null and completed_at is not null)),
  unique(business_id,fingerprint), unique(id,candidate_id,business_id)
);
create unique index stage13_one_initial_discovery on public.product_experiments(candidate_id) where basis_artifact_id is null;
create unique index stage13_one_basis_discovery on public.product_experiments(candidate_id,basis_artifact_id) where basis_artifact_id is not null;
create index stage13_experiment_workflow on public.product_experiments(workflow_run_id,business_id);
create table public.product_decisions (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete restrict,
  candidate_id uuid not null, experiment_id uuid not null, assessment jsonb not null check(jsonb_typeof(assessment)='object'),
  assessment_fingerprint text not null check(assessment_fingerprint ~ '^[a-f0-9]{64}$'), created_at timestamptz not null default now(),
  foreign key(experiment_id,candidate_id,business_id) references public.product_experiments(id,candidate_id,business_id) on delete restrict,
  unique(experiment_id,assessment_fingerprint),
  check(assessment->'review'='{"status":"contract_checked","liveQualified":false,"creativeProductionAllowed":false,"publicationAllowed":false}'::jsonb),
  check(assessment->>'assessmentOrigin' in ('deterministic_provisional','owner_assessment'))
);
create index stage13_decision_business_created on public.product_decisions(business_id,created_at desc);
create index stage13_candidate_business_created on public.product_candidates(business_id,created_at desc);
alter table public.product_candidates enable row level security;
alter table public.product_experiments enable row level security;
alter table public.product_decisions enable row level security;
create policy product_candidates_owner_select on public.product_candidates for select to authenticated using(private.is_business_owner(business_id));
create policy product_experiments_owner_select on public.product_experiments for select to authenticated using(private.is_business_owner(business_id));
create policy product_decisions_owner_select on public.product_decisions for select to authenticated using(private.is_business_owner(business_id));
revoke all on public.product_candidates,public.product_experiments,public.product_decisions from public,anon,authenticated,service_role;
grant select on public.product_candidates,public.product_experiments,public.product_decisions to authenticated;

create function private.stage13_registry_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if current_user in ('anon','authenticated','service_role') then raise exception 'Use the guarded product discovery RPC.' using errcode='42501'; end if;
  if tg_op='DELETE' then raise exception 'Product discovery history is append-only.'; end if;
  if tg_op='UPDATE' then
    if tg_table_name<>'product_experiments' then raise exception 'Product discovery history is immutable.'; end if;
    if old.status in ('completed','failed') or
      (to_jsonb(new)-array['status','evidence_pack','source_artifact_id','failure','started_at','completed_at']) is distinct from
      (to_jsonb(old)-array['status','evidence_pack','source_artifact_id','failure','started_at','completed_at']) or
      new.status not in ('researching','completed','failed') or (old.source_artifact_id is not null and new.source_artifact_id is distinct from old.source_artifact_id) then
      raise exception 'Product discovery history is immutable.'; end if;
  end if;
  return new;
end; $$;
create trigger stage13_candidate_append_only before insert or update or delete on public.product_candidates for each row execute function private.stage13_registry_guard();
create trigger stage13_experiment_append_only before insert or update or delete on public.product_experiments for each row execute function private.stage13_registry_guard();
create trigger stage13_decision_append_only before insert or update or delete on public.product_decisions for each row execute function private.stage13_registry_guard();

-- Existing owner CRUD must not be used to forge an offline research basis.
-- Capability-scoped security-definer runtime functions remain the only write route.
create function private.stage13_research_write_guard() returns trigger language plpgsql set search_path='' as $$
declare v_old jsonb; v_new jsonb; v_run uuid;
begin
  if current_user not in ('anon','authenticated','service_role') then if tg_op='DELETE' then return old; else return new; end if; end if;
  if tg_op<>'INSERT' then v_old:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then v_new:=to_jsonb(new); end if;
  if tg_table_name='workflow_runs' then
    -- Preserve the existing dashboard's pre-execution launch-failure write only.
    if tg_op='UPDATE' and current_user='authenticated' and private.is_business_owner(old.business_id) and
      old.status='queued' and old.runtime_launch_status='reserved' and old.runtime_run_id is null and
      new.status='failed' and new.runtime_launch_status='launch_failed' and new.completed_at is not null and
      (v_old-array['status','runtime_launch_status','completed_at','updated_at'])=(v_new-array['status','runtime_launch_status','completed_at','updated_at']) and
      not exists(select 1 from public.product_experiments where workflow_run_id=old.id) then return new; end if;
    if v_old->'pack_snapshot'->'workflow'->>'key'='research.public-evidence' or v_new->'pack_snapshot'->'workflow'->>'key'='research.public-evidence' then
      raise exception 'Research provenance is runtime-managed.' using errcode='42501'; end if;
  else
    for v_run in select distinct x from unnest(array[(v_old->>'workflow_run_id')::uuid,(v_new->>'workflow_run_id')::uuid]) x where x is not null loop
      if exists(select 1 from public.workflow_runs where id=v_run and pack_snapshot->'workflow'->>'key'='research.public-evidence') then
        raise exception 'Research provenance is runtime-managed.' using errcode='42501'; end if;
    end loop;
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end; $$;
create trigger stage13_research_run_guard before insert or update or delete on public.workflow_runs for each row execute function private.stage13_research_write_guard();
create trigger stage13_research_stage_guard before insert or update or delete on public.workflow_stage_runs for each row execute function private.stage13_research_write_guard();
create trigger stage13_research_task_guard before insert or update or delete on public.task_contracts for each row execute function private.stage13_research_write_guard();
create trigger stage13_research_worker_guard before insert or update or delete on public.worker_runs for each row execute function private.stage13_research_write_guard();
create trigger stage13_research_artifact_guard before insert or update or delete on public.artifacts for each row execute function private.stage13_research_write_guard();

create function public.create_product_candidate(p_business_id uuid,p_candidate jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_hash text; v_domain jsonb; v_domains text[];
begin
  if auth.uid() is null or not private.is_business_owner(p_business_id) then raise exception 'Business ownership required.' using errcode='42501'; end if;
  if jsonb_typeof(p_candidate) is distinct from 'object' or length(p_candidate::text)>6000 or
    not (p_candidate ?& array['concept','audience','hypothesis','originalDesign','rightsStatus','sourceDomains']) or
    p_candidate-array['concept','audience','hypothesis','originalDesign','rightsStatus','sourceDomains']<>'{}'::jsonb or
    jsonb_typeof(p_candidate->'concept') is distinct from 'string' or (length(btrim(p_candidate->>'concept'))<3 or length(p_candidate->>'concept')>160) or
    jsonb_typeof(p_candidate->'audience') is distinct from 'string' or (length(btrim(p_candidate->>'audience'))<3 or length(p_candidate->>'audience')>160) or
    jsonb_typeof(p_candidate->'hypothesis') is distinct from 'string' or (length(btrim(p_candidate->>'hypothesis'))<10 or length(p_candidate->>'hypothesis')>600) or
    jsonb_typeof(p_candidate->'originalDesign') is distinct from 'boolean' or coalesce(p_candidate->>'rightsStatus','') not in ('confirmed','unclear') or
    jsonb_typeof(p_candidate->'sourceDomains') is distinct from 'array' then raise exception 'Invalid product candidate contract.'; end if;
  if jsonb_array_length(p_candidate->'sourceDomains') not between 1 and 6 then raise exception 'One to six safe public domains required.'; end if;
  for v_domain in select value from jsonb_array_elements(p_candidate->'sourceDomains') loop
    if jsonb_typeof(v_domain) is distinct from 'string' or length(v_domain#>>'{}')>200 or
      (v_domain#>>'{}') !~ '^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$' or
      (v_domain#>>'{}') ~ '\.(local|internal|localhost|test|invalid|example|onion)$' or
      (v_domain#>>'{}') ~ '(^|\.)(localhost|localdomain)$' then raise exception 'Unsafe source domain.'; end if;
  end loop;
  select array_agg(value order by value) into v_domains from jsonb_array_elements_text(p_candidate->'sourceDomains');
  if cardinality(v_domains)<>(select count(distinct x) from unnest(v_domains) x) then raise exception 'Source domains must be unique.'; end if;
  if private.stage13_normalize(p_candidate->>'concept')='' or private.stage13_normalize(p_candidate->>'audience')='' or private.stage13_normalize(p_candidate->>'hypothesis')='' then raise exception 'Concept and audience need meaningful text.'; end if;
  v_hash:=private.stage13_hash('original_pod_tshirt:'||private.stage13_normalize(p_candidate->>'concept')||':'||private.stage13_normalize(p_candidate->>'audience'));
  insert into public.product_candidates(business_id,fingerprint,concept,audience,hypothesis,original_design,rights_status,source_domains)
    values(p_business_id,v_hash,btrim(p_candidate->>'concept'),btrim(p_candidate->>'audience'),btrim(p_candidate->>'hypothesis'),(p_candidate->>'originalDesign')::boolean,p_candidate->>'rightsStatus',v_domains)
    on conflict(business_id,fingerprint) do nothing returning id into v_id;
  if v_id is null then select id into strict v_id from public.product_candidates where business_id=p_business_id and fingerprint=v_hash;
    return jsonb_build_object('candidateId',v_id,'cached',true); end if;
  insert into public.events(id,business_id,event_type,actor_type,actor_id,payload) values
    (private.stage4_deterministic_uuid('product:candidate-created:'||v_id),p_business_id,'product.candidate.created','owner',auth.uid()::text,jsonb_build_object('candidateId',v_id,'productType','original_pod_tshirt'));
  return jsonb_build_object('candidateId',v_id,'cached',false);
end; $$;

create function public.begin_product_discovery(p_candidate_id uuid,p_launch_nonce uuid,p_runtime_capability text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.product_candidates%rowtype; e public.product_experiments%rowtype; v_pack uuid; v_install uuid; v_run jsonb; v_id uuid;
begin
  select * into c from public.product_candidates where id=p_candidate_id;
  if c.id is null or auth.uid() is null or not private.is_business_owner(c.business_id) then raise exception 'Business ownership required.' using errcode='42501'; end if;
  if p_launch_nonce is null or coalesce(length(p_runtime_capability),0) not between 32 and 512 then raise exception 'Invalid product discovery reservation.'; end if;
  perform 1 from public.product_candidates where id=c.id for update;
  select * into e from public.product_experiments where candidate_id=c.id and basis_artifact_id is null;
  if found then return jsonb_build_object('experimentId',e.id,'workflowRunId',e.workflow_run_id,'shouldStart',false,'cached',true); end if;
  select id into strict v_pack from public.packs where pack_key='workflow.web-research' and version='1.0.0' and status='qualified';
  v_install:=public.activate_business_pack(c.business_id,v_pack);
  v_run:=public.begin_installed_pack_run(c.business_id,v_install,'research.public-evidence',
    jsonb_build_object('question',private.stage13_question(c.concept,c.audience,c.hypothesis),'sourceDomains',to_jsonb(c.source_domains)),
    'product-discovery:initial:'||c.id,p_launch_nonce,p_runtime_capability);
  insert into public.product_experiments(business_id,candidate_id,workflow_run_id,fingerprint,hypothesis,variables,audience,status,measurement_plan)
    values(c.business_id,c.id,(v_run->>'workflowRunId')::uuid,private.stage13_hash(c.id||':initial'),c.hypothesis,
      jsonb_build_object('concept',c.concept,'productType',c.product_type,'sourceDomains',c.source_domains,'originalDesign',c.original_design,'rightsStatus',c.rights_status),c.audience,'reserved',private.stage13_plan()) returning id into v_id;
  return jsonb_build_object('experimentId',v_id,'workflowRunId',v_run->'workflowRunId','shouldStart',v_run->'shouldStart','cached',false);
end; $$;

-- Shared persisted-provenance validator. It accepts no client-supplied evidence.
create function private.stage13_validated_evidence(p_artifact_id uuid,p_business_id uuid,p_require_completed boolean default true)
returns jsonb language plpgsql stable set search_path='' as $$
declare a public.artifacts%rowtype; r public.workflow_runs%rowtype; w public.worker_runs%rowtype;
  t public.task_contracts%rowtype; s public.workflow_stage_runs%rowtype; src public.artifacts%rowtype;
  v_pack jsonb; v_receipt jsonb; v_source jsonb; v_evidence jsonb; v_claim jsonb; v_host text; v_root jsonb;
begin
  select * into a from public.artifacts where id=p_artifact_id and business_id=p_business_id and artifact_type='worker.output' and media_type='application/json';
  if a.id is null then raise exception 'A same-business research worker output artifact is required.'; end if;
  select * into strict r from public.workflow_runs where id=a.workflow_run_id and business_id=p_business_id;
  select value into v_root from jsonb_array_elements(r.pack_snapshot->'releases') rel where rel->>'id'=r.pack_snapshot->>'rootPackId';
  if r.status not in ('running','completed') or (p_require_completed and r.status<>'completed') or
    r.pack_snapshot->'workflow'->>'key' is distinct from 'research.public-evidence' or
    r.pack_snapshot->'workflow'->>'version' is distinct from '1.0.0' or
    v_root->'manifest'->>'packKey' is distinct from 'workflow.web-research' or v_root->'manifest'->>'version' is distinct from '1.0.0' or
    v_root->>'status' is distinct from 'qualified' or r.pack_snapshot->'workflow' is distinct from v_root->'manifest'->'workflows'->0 or
    jsonb_array_length(r.pack_snapshot->'workflow'->'stages')<>1 or
    exists(select 1 from jsonb_array_elements(r.pack_snapshot->'releases') rel where rel->>'status' is distinct from 'qualified' or
      not exists(select 1 from public.packs p where p.id=(rel->>'id')::uuid and p.manifest=rel->'manifest' and p.version='1.0.0')) or
    jsonb_typeof(r.input->'question') is distinct from 'string' or length(r.input->>'question') not between 5 and 800 or
    jsonb_typeof(r.input->'sourceDomains') is distinct from 'array' then raise exception 'Completed qualified public research provenance required.'; end if;
  if (select count(*) from public.workflow_stage_runs where workflow_run_id=r.id and business_id=r.business_id)<>1 or
    exists(select 1 from public.workflow_stage_runs where workflow_run_id=r.id and status<>'completed') then raise exception 'Every research stage must be completed.'; end if;
  select * into strict s from public.workflow_stage_runs where workflow_run_id=r.id and business_id=r.business_id and stage_key='research' and attempt=1 and status='completed';
  select * into strict t from public.task_contracts where id=a.task_contract_id and id=private.stage4_deterministic_uuid('pack:task:'||r.id||':research')
    and workflow_run_id=r.id and business_id=r.business_id and workflow_stage_run_id=s.id and status='completed';
  select * into strict w from public.worker_runs where id=private.stage4_deterministic_uuid('pack:worker:'||r.id||':research')
    and workflow_run_id=r.id and business_id=r.business_id and task_contract_id=t.id and worker_definition_id=t.worker_definition_id and status='completed';
  select * into strict src from public.artifacts where id=private.stage4_deterministic_uuid('research:sources:'||r.id||':research')
    and workflow_run_id=r.id and business_id=r.business_id and task_contract_id=t.id and artifact_type='research.sources';
  v_receipt:=a.metadata->'receipt'; v_pack:=a.content->'evidencePack';
  if a.id<>private.stage4_deterministic_uuid('pack:output:'||r.id||':research') or
    a.content is distinct from w.output or a.content is distinct from s.output or
    w.execution_metadata->'receipt' is distinct from v_receipt or w.execution_metadata->>'outputArtifactId' is distinct from a.id::text or
    not exists(select 1 from public.worker_definitions d join public.packs p on p.id=d.pack_id where d.id=w.worker_definition_id and
      d.worker_key='market.researcher' and d.version='1.0.0' and p.pack_key='worker.market-researcher' and p.version='1.0.0') or
    v_receipt->>'receiptVersion' is distinct from '1.0' or v_receipt->>'packKey' is distinct from 'worker.market-researcher' or
    v_receipt->>'packVersion' is distinct from '1.0.0' or v_receipt->>'workerKey' is distinct from 'market.researcher' or
    v_receipt->>'workerVersion' is distinct from '1.0.0' or v_receipt->>'taskContractId' is distinct from t.id::text or
    v_receipt->'inputArtifactIds' is distinct from to_jsonb(t.input_artifact_ids) or not(src.id=any(t.input_artifact_ids)) or
    v_receipt->'outputValidated' is distinct from 'true'::jsonb or v_receipt->>'executionMode' is distinct from 'web.research' or
    v_receipt->>'modelRouteKey' is distinct from 'standard.default' or v_receipt->>'stopReason' is distinct from 'evidence_collected' or
    nullif(v_receipt->>'providerRequestId','') is null or v_receipt->>'providerRequestId' ~* '(mock|fixture|simulation)' or
    v_receipt->>'mockProvider'='true' or v_receipt->>'providerType'='mock' or v_receipt->>'mode'='simulation' or
    src.content->>'collectionVersion' is distinct from '1.0' or src.content->>'query' is distinct from r.input->>'question' or
    src.content->'providerMetadata'->>'searchRequests' is distinct from '1' or
    nullif(src.content->'providerMetadata'->>'providerRequestId','') is null or
    src.content->'providerMetadata'->>'providerRequestId' ~* '(mock|fixture|simulation)' or
    src.content->'providerMetadata'->>'fixture'='true' or src.content->'providerMetadata'->>'mockProvider'='true' or
    a.content->>'decision' is distinct from 'complete' or a.content->>'stopReason' is distinct from 'evidence_collected' or
    jsonb_typeof(v_pack) is distinct from 'object' or v_pack->>'evidencePackVersion' is distinct from '1.0' or
    v_pack->>'question' is distinct from r.input->>'question' or jsonb_typeof(v_pack->'sources') is distinct from 'array' or
    jsonb_typeof(v_pack->'evidence') is distinct from 'array' or jsonb_typeof(v_pack->'claims') is distinct from 'array' or
    jsonb_typeof(v_pack->'limitations') is distinct from 'array' or
    v_pack-array['evidencePackVersion','question','sources','evidence','claims','limitations']<>'{}'::jsonb or
    exists(select 1 from jsonb_array_elements(v_pack->'limitations') l where jsonb_typeof(l)<>'string') then raise exception 'Real web.research receipt and source artifact provenance required.'; end if;
  if jsonb_array_length(v_pack->'sources') not between 1 and 4 or jsonb_array_length(v_pack->'evidence') not between 1 and 4 or
    jsonb_array_length(v_pack->'claims')<>jsonb_array_length(v_pack->'evidence') or
    (select count(distinct x->>'id') from jsonb_array_elements(v_pack->'sources') x)<>jsonb_array_length(v_pack->'sources') or
    (select count(distinct x->>'id') from jsonb_array_elements(v_pack->'evidence') x)<>jsonb_array_length(v_pack->'evidence') then raise exception 'Invalid research source or evidence cardinality.'; end if;
  for v_source in select value from jsonb_array_elements(v_pack->'sources') loop
    v_host:=substring(v_source->>'url' from '^https://([a-z0-9.-]+)/');
    if not exists(select 1 from jsonb_array_elements(src.content->'sources') x where x=v_source) or
      jsonb_typeof(v_source) is distinct from 'object' or not(v_source ?& array['id','url','title','retrievedAt','publishedAt','retrievalExpiresAt','contentHash','excerpt','provider']) or
      v_source-array['id','url','title','retrievedAt','publishedAt','retrievalExpiresAt','contentHash','excerpt','provider']<>'{}'::jsonb or
      jsonb_typeof(v_source->'title') is distinct from 'string' or jsonb_typeof(v_source->'publishedAt') not in ('null','string') or
      v_source->>'provider' is distinct from 'openrouter.exa' or v_host is null or v_source->>'url' ~ '[#[:space:]]' or
      v_source->>'url' ~* '[?&](token|access_token|api_key|auth|password|utm_[^=]*|fbclid|gclid)=' or
      not exists(select 1 from jsonb_array_elements_text(r.input->'sourceDomains') d where v_host=d or v_host like '%.'||d) or
      jsonb_typeof(v_source->'excerpt') is distinct from 'string' or length(v_source->>'excerpt') not between 30 and 1800 or
      v_source->>'contentHash' is distinct from private.stage13_hash(v_source->>'excerpt') or
      v_source->>'id' is distinct from 'src-'||left(private.stage13_hash((v_source->>'url')||':'||(v_source->>'contentHash')),24) or
      jsonb_typeof(v_source->'retrievedAt') is distinct from 'string' or jsonb_typeof(v_source->'retrievalExpiresAt') is distinct from 'string' or
      (v_source->>'retrievedAt')::timestamptz>now()+interval '5 minutes' or (v_source->>'retrievalExpiresAt')::timestamptz<now() or
      (v_source->>'retrievalExpiresAt')::timestamptz<=(v_source->>'retrievedAt')::timestamptz or
      (v_source->>'retrievalExpiresAt')::timestamptz>(v_source->>'retrievedAt')::timestamptz+interval '1 day' or
      not exists(select 1 from jsonb_array_elements(v_pack->'evidence') e where e->>'sourceId'=v_source->>'id') then raise exception 'Research source is stale, tampered, or out of scope.'; end if;
  end loop;
  for v_evidence in select value from jsonb_array_elements(v_pack->'evidence') loop
    if not exists(select 1 from jsonb_array_elements(src.content->'evidence') x where x=v_evidence) or
      not(v_evidence ?& array['id','sourceId','quote']) or v_evidence-array['id','sourceId','quote']<>'{}'::jsonb or
      jsonb_typeof(v_evidence->'quote') is distinct from 'string' or length(v_evidence->>'quote') not between 1 and 320 or
      v_evidence->>'id' is distinct from 'evi-'||left(private.stage13_hash((v_evidence->>'sourceId')||':'||(v_evidence->>'quote')),24) or
      not exists(select 1 from jsonb_array_elements(v_pack->'sources') x where x->>'id'=v_evidence->>'sourceId' and strpos(x->>'excerpt',v_evidence->>'quote')>0) or
      (select count(*) from jsonb_array_elements(v_pack->'claims') x where x->>'evidenceId'=v_evidence->>'id' and x->>'sourceId'=v_evidence->>'sourceId' and x->>'text'=v_evidence->>'quote')<>1 then
      raise exception 'Research evidence citation is forged or unsupported.'; end if;
  end loop;
  for v_claim in select value from jsonb_array_elements(v_pack->'claims') loop
    if not(v_claim ?& array['text','evidenceId','sourceId']) or v_claim-array['text','evidenceId','sourceId']<>'{}'::jsonb or
      not exists(select 1 from jsonb_array_elements(v_pack->'evidence') x where x->>'id'=v_claim->>'evidenceId' and x->>'sourceId'=v_claim->>'sourceId' and x->>'quote'=v_claim->>'text') then
      raise exception 'Research claim is unsupported.'; end if;
  end loop;
  return v_pack;
end; $$;

create function private.stage13_assessment(p_candidate public.product_candidates,p_pack jsonb,p_dimensions jsonb default null)
returns jsonb language plpgsql immutable set search_path='' as $$
declare
  v_names text[]:=array['demand','competition','differentiation','estimated_margin','creative_opportunity','seasonality','production_complexity','policy_ip_risk','marketing_potential'];
  v_missing_map jsonb:='{"demand":"Candidate-specific buyer-interest observations with audience, sample, and observation period","competition":"Comparable original T-shirt listings with price, listing density, and review observations","differentiation":"Evidence of a specific unmet audience need and how the original concept differs","estimated_margin":"Current SKU production, shipping, marketplace/payment fees, proposed price, and deterministic margin calculation","creative_opportunity":"Source-linked visual opportunity and original-design feasibility without copying protected work","seasonality":"Dated audience-interest observations covering the intended selling period","production_complexity":"Verified intended SKU print specifications, fulfilment constraints, and production feasibility","policy_ip_risk":"Current applicable policy plus concept-specific originality, rights, and IP screening","marketing_potential":"Observed buyer language and channel-specific audience reach relevant to this candidate"}';
  v_name text; d jsonb; v_dimensions jsonb:='[]'; v_missing jsonb:='[]'; v_reasons jsonb:='[]'; v_scores jsonb:='{}';
  v_total integer; v_weighted integer:=0; v_all boolean:=true; v_score integer; v_outcome text:='NEEDS_MORE_EVIDENCE'; v_eid jsonb;
begin
  if p_dimensions is not null and (jsonb_typeof(p_dimensions) is distinct from 'array' or jsonb_array_length(p_dimensions)<>9 or
    (select count(distinct x->>'dimension') from jsonb_array_elements(p_dimensions) x)<>9) then raise exception 'Exactly nine dimension assessments required.'; end if;
  foreach v_name in array v_names loop
    if p_dimensions is null then d:=jsonb_build_object('dimension',v_name,'score',null,'evidenceIds','[]'::jsonb,'rationale',v_missing_map->>v_name,'evidenceKind','unassessed');
    else select value into d from jsonb_array_elements(p_dimensions) x where x->>'dimension'=v_name;
    end if;
    if d is null or jsonb_typeof(d) is distinct from 'object' or
      not(d ?& array['dimension','score','evidenceIds','rationale','evidenceKind']) or d-array['dimension','score','evidenceIds','rationale','evidenceKind']<>'{}'::jsonb or
      jsonb_typeof(d->'rationale') is distinct from 'string' or length(btrim(d->>'rationale'))<10 or length(d->>'rationale')>600 or
      jsonb_typeof(d->'evidenceIds') is distinct from 'array' then raise exception 'Invalid dimension assessment contract.'; end if;
    if jsonb_array_length(d->'evidenceIds')>4 or
      (select count(distinct x) from jsonb_array_elements(d->'evidenceIds') x)<>jsonb_array_length(d->'evidenceIds') then raise exception 'Evidence references must be unique and bounded.'; end if;
    for v_eid in select value from jsonb_array_elements(d->'evidenceIds') loop
      if jsonb_typeof(v_eid) is distinct from 'string' or not exists(select 1 from jsonb_array_elements(p_pack->'evidence') e where e->>'id'=v_eid#>>'{}') then
        raise exception 'Assessment cites unavailable evidence.'; end if;
    end loop;
    if d->'score'='null'::jsonb then
      if d->>'evidenceKind' is distinct from 'unassessed' then raise exception 'Unknown scores must remain unassessed.'; end if;
      v_all:=false; v_score:=null; v_missing:=v_missing||jsonb_build_array(v_missing_map->>v_name);
    else
      if jsonb_typeof(d->'score') is distinct from 'number' or (d->>'score')::numeric<>trunc((d->>'score')::numeric) or
        (d->>'score')::numeric not between 0 and 5 or jsonb_array_length(d->'evidenceIds')=0 then raise exception 'Known scores require integer 0 through 5 and evidence.'; end if;
      v_score:=(d->>'score')::integer;
      if (v_name in ('demand','competition','seasonality','marketing_potential') and d->>'evidenceKind' is distinct from 'market_observation') or
        (v_name in ('estimated_margin','production_complexity') and d->>'evidenceKind' is distinct from 'operational_fact') or
        (v_name='policy_ip_risk' and d->>'evidenceKind' is distinct from 'policy') or
        (v_name in ('differentiation','creative_opportunity') and coalesce(d->>'evidenceKind','') not in ('market_observation','operational_fact')) then raise exception 'Evidence kind does not support this dimension.'; end if;
      if d->>'evidenceKind'='market_observation' and exists(
        select 1 from jsonb_array_elements_text(d->'evidenceIds') eid join lateral jsonb_array_elements(p_pack->'evidence') e on e->>'id'=eid
          join lateral jsonb_array_elements(p_pack->'sources') src on src->>'id'=e->>'sourceId'
        where split_part(split_part(src->>'url','?',1),'#',1) ~* '/(seller-handbook|legal|help|blog)(/|$)' or src->>'url' ~* '^https://(help|support)\.') then
        raise exception 'Policy and guidance pages cannot substantiate candidate market observations.'; end if;
      v_weighted:=v_weighted+v_score*case when v_name='demand' then 3 when v_name in ('estimated_margin','policy_ip_risk') then 2 else 1 end;
    end if;
    v_scores:=v_scores||jsonb_build_object(v_name,v_score); v_dimensions:=v_dimensions||jsonb_build_array(d);
  end loop;
  if p_candidate.rights_status<>'confirmed' then v_missing:=v_missing||jsonb_build_array('Concept-specific originality and rights clearance'); end if;
  if v_all then v_total:=round(100.0*v_weighted/65)::integer; end if;
  if not p_candidate.original_design or (v_scores->>'policy_ip_risk')::integer=0 or (v_scores->>'production_complexity')::integer=0 then
    v_outcome:='REJECT';
    if not p_candidate.original_design then v_reasons:=v_reasons||jsonb_build_array('Original seller design is required for this POD candidate scope'); end if;
    if (v_scores->>'policy_ip_risk')::integer=0 then v_reasons:=v_reasons||jsonb_build_array('Source-linked policy/IP assessment fails the minimum gate'); end if;
    if (v_scores->>'production_complexity')::integer=0 then v_reasons:=v_reasons||jsonb_build_array('Source-linked production feasibility assessment fails the minimum gate'); end if;
  elsif v_all and p_candidate.rights_status='confirmed' and v_total>=65 and (v_scores->>'demand')::integer>=3 and
    (v_scores->>'estimated_margin')::integer>=3 and (v_scores->>'policy_ip_risk')::integer>=4 then
    v_outcome:='TEST'; v_reasons:=jsonb_build_array('Evidence-linked owner assessments meet the provisional research-test thresholds');
  else
    if jsonb_array_length(v_missing)>0 then v_reasons:=v_reasons||jsonb_build_array('Required candidate-specific evidence is missing or unassessed'); end if;
    if v_all and (v_total<65 or (v_scores->>'demand')::integer<3 or (v_scores->>'estimated_margin')::integer<3 or (v_scores->>'policy_ip_risk')::integer<4) then
      v_reasons:=v_reasons||jsonb_build_array('Test thresholds are not met: total 65/100, demand 3/5, margin 3/5, policy/IP 4/5'); end if;
  end if;
  return jsonb_build_object('scoringVersion','pod-discovery-1.0','dimensions',v_dimensions,'totalScore',v_total,'outcome',v_outcome,
    'missingEvidence',v_missing,'reasons',v_reasons,'evidenceIds',(select jsonb_agg(e->'id') from jsonb_array_elements(p_pack->'evidence') e),
    'assessmentOrigin',case when p_dimensions is null then 'deterministic_provisional' else 'owner_assessment' end,
    'review','{"status":"contract_checked","liveQualified":false,"creativeProductionAllowed":false,"publicationAllowed":false}'::jsonb);
end; $$;

create function private.stage13_finalize(p_experiment_id uuid) returns jsonb language plpgsql set search_path='' as $$
declare e public.product_experiments%rowtype; c public.product_candidates%rowtype; r public.workflow_runs%rowtype;
  v_artifact uuid; v_pack jsonb; v_assessment jsonb; v_decision uuid;
begin
  select * into strict e from public.product_experiments where id=p_experiment_id for update;
  if e.status='completed' then
    select id into strict v_decision from public.product_decisions where experiment_id=e.id and assessment->>'assessmentOrigin'='deterministic_provisional';
    return jsonb_build_object('experimentId',e.id,'workflowRunId',e.workflow_run_id,'decisionId',v_decision,'status','completed','cached',true); end if;
  if e.status='failed' then raise exception 'Failed discovery is terminal; new evidence requires reconsideration.'; end if;
  select * into strict c from public.product_candidates where id=e.candidate_id and business_id=e.business_id;
  select * into strict r from public.workflow_runs where id=e.workflow_run_id and business_id=e.business_id and status='completed';
  v_artifact:=coalesce(e.basis_artifact_id,private.stage4_deterministic_uuid('pack:output:'||r.id||':research'));
  v_pack:=private.stage13_validated_evidence(v_artifact,e.business_id,true);
  if v_pack->>'question' is distinct from private.stage13_question(c.concept,c.audience,c.hypothesis) or
    (select array_agg(x order by x) from jsonb_array_elements_text(r.input->'sourceDomains') x) is distinct from c.source_domains then
    raise exception 'Research does not match this candidate scope.'; end if;
  v_assessment:=private.stage13_assessment(c,v_pack);
  update public.product_experiments set status='completed',evidence_pack=v_pack,source_artifact_id=v_artifact,
    started_at=coalesce(e.started_at,r.started_at,now()),completed_at=now(),failure=null where id=e.id;
  insert into public.product_decisions(business_id,candidate_id,experiment_id,assessment,assessment_fingerprint)
    values(e.business_id,c.id,e.id,v_assessment,private.stage13_hash(v_assessment::text)) returning id into v_decision;
  insert into public.events(id,business_id,workflow_run_id,event_type,actor_type,payload) values
    (private.stage4_deterministic_uuid('product:discovery-completed:'||e.id),e.business_id,r.id,'product.discovery.completed','system',
      jsonb_build_object('candidateId',c.id,'experimentId',e.id,'decisionId',v_decision,'outcome',v_assessment->>'outcome','liveQualified',false,'creativeProductionAllowed',false,'publicationAllowed',false));
  return jsonb_build_object('experimentId',e.id,'workflowRunId',r.id,'decisionId',v_decision,'status','completed','cached',false);
end; $$;

create function public.product_discovery_runtime(p_workflow_run_id uuid,p_business_id uuid,p_runtime_capability text,p_operation text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.workflow_runs%rowtype; e public.product_experiments%rowtype; v_pack jsonb;
begin
  if coalesce(length(p_runtime_capability),0) not between 32 and 512 or p_operation is null or p_operation not in ('scope','finalize','fail') then raise exception 'Product runtime capability denied.' using errcode='42501'; end if;
  select * into r from public.workflow_runs where id=p_workflow_run_id and business_id=p_business_id
    and runtime_capability_hash=private.stage13_hash(p_runtime_capability) for update;
  if not found then raise exception 'Product runtime capability denied.' using errcode='42501'; end if;
  select * into e from public.product_experiments where workflow_run_id=r.id and business_id=r.business_id and basis_artifact_id is null for update;
  if not found then raise exception 'Linked initial product experiment required.' using errcode='42501'; end if;
  if p_operation='scope' then
    if e.status='reserved' and r.status='running' then update public.product_experiments set status='researching',started_at=coalesce(r.started_at,now()) where id=e.id; end if;
    return jsonb_build_object('experimentId',e.id,'researchMode','automatic_search','budgetMicrousd',1000000,'reservationBasis','conservative_preflight_estimate','guaranteedInvoiceCap',false);
  end if;
  if p_operation='finalize' then
    if e.status='completed' then return private.stage13_finalize(e.id); end if;
    v_pack:=private.stage13_validated_evidence(private.stage4_deterministic_uuid('pack:output:'||r.id||':research'),r.business_id,false);
    perform public.installed_pack_runtime_transition(r.id,r.business_id,p_runtime_capability,'complete','{}');
    return private.stage13_finalize(e.id);
  end if;
  if e.status='completed' or r.status='completed' then return jsonb_build_object('experimentId',e.id,'status',e.status,'cached',true); end if;
  if r.status<>'failed' then raise exception 'Persisted failed workflow required.'; end if;
  if e.status='failed' then return jsonb_build_object('experimentId',e.id,'status','failed','cached',true); end if;
  update public.product_experiments set status='failed',failure=left(coalesce(nullif(r.state->'failure'->>'message',''),(r.state->'failure')::text,'Research workflow failed'),1200),
    started_at=coalesce(e.started_at,r.started_at),completed_at=coalesce(r.completed_at,now()) where id=e.id;
  return jsonb_build_object('experimentId',e.id,'status','failed','cached',false);
end; $$;

create function public.finalize_product_discovery(p_experiment_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.product_experiments%rowtype;
begin
  select * into e from public.product_experiments where id=p_experiment_id;
  if e.id is null or auth.uid() is null or not private.is_business_owner(e.business_id) then raise exception 'Business ownership required.' using errcode='42501'; end if;
  return private.stage13_finalize(e.id);
end; $$;

create function public.record_product_assessment(p_experiment_id uuid,p_dimensions jsonb,p_confirm_rights boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.product_experiments%rowtype; c public.product_candidates%rowtype; v_assessment jsonb; v_hash text; v_id uuid;
begin
  select * into e from public.product_experiments where id=p_experiment_id;
  if e.id is null or auth.uid() is null or not private.is_business_owner(e.business_id) then raise exception 'Business ownership required.' using errcode='42501'; end if;
  if p_confirm_rights is null or e.status<>'completed' or e.evidence_pack is null or p_dimensions is null or length(p_dimensions::text)>12000 then raise exception 'Completed research and explicit dimension assessments required.'; end if;
  select * into strict c from public.product_candidates where id=e.candidate_id and business_id=e.business_id;
  if p_confirm_rights then c.rights_status:='confirmed'; end if;
  v_assessment:=private.stage13_assessment(c,e.evidence_pack,p_dimensions);
  if p_confirm_rights then v_assessment:=v_assessment||'{"ownerRightsConfirmed":true}'::jsonb; end if;
  v_hash:=private.stage13_hash(v_assessment::text);
  select id into v_id from public.product_decisions where experiment_id=e.id and assessment_fingerprint=v_hash;
  if found then return jsonb_build_object('decisionId',v_id,'assessment',v_assessment,'cached',true); end if;
  if private.stage13_validated_evidence(e.source_artifact_id,e.business_id,true) is distinct from e.evidence_pack then raise exception 'Stored evidence snapshot no longer matches provenance.'; end if;
  insert into public.product_decisions(business_id,candidate_id,experiment_id,assessment,assessment_fingerprint)
    values(e.business_id,c.id,e.id,v_assessment,v_hash) on conflict(experiment_id,assessment_fingerprint) do nothing returning id into v_id;
  if v_id is null then select id into strict v_id from public.product_decisions where experiment_id=e.id and assessment_fingerprint=v_hash;
    return jsonb_build_object('decisionId',v_id,'assessment',v_assessment,'cached',true); end if;
  insert into public.events(id,business_id,workflow_run_id,event_type,actor_type,actor_id,payload) values
    (private.stage4_deterministic_uuid('product:assessment-recorded:'||v_id),e.business_id,e.workflow_run_id,'product.assessment.recorded','owner',auth.uid()::text,
      jsonb_build_object('candidateId',c.id,'experimentId',e.id,'decisionId',v_id,'outcome',v_assessment->>'outcome','assessmentOrigin','owner_assessment','creativeProductionAllowed',false,'publicationAllowed',false));
  return jsonb_build_object('decisionId',v_id,'assessment',v_assessment,'cached',false);
end; $$;

create function public.reconsider_product_candidate(p_candidate_id uuid,p_basis_artifact_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.product_candidates%rowtype; v_pack jsonb; a public.artifacts%rowtype; e public.product_experiments%rowtype; v_id uuid;
begin
  select * into c from public.product_candidates where id=p_candidate_id;
  if c.id is null or auth.uid() is null or not private.is_business_owner(c.business_id) then raise exception 'Business ownership required.' using errcode='42501'; end if;
  perform 1 from public.product_candidates where id=c.id for update;
  select * into e from public.product_experiments where candidate_id=c.id and basis_artifact_id=p_basis_artifact_id;
  if found then return jsonb_build_object('experimentId',e.id,'cached',true); end if;
  if not exists(select 1 from public.product_experiments where candidate_id=c.id and status in ('completed','failed')) or
    exists(select 1 from public.product_experiments where candidate_id=c.id and status in ('reserved','researching')) then raise exception 'Finish the initial discovery before reconsideration.'; end if;
  v_pack:=private.stage13_validated_evidence(p_basis_artifact_id,c.business_id,true);
  select * into strict a from public.artifacts where id=p_basis_artifact_id and business_id=c.business_id;
  if exists(select 1 from public.product_experiments where candidate_id=c.id and source_artifact_id=a.id) then raise exception 'This research artifact was already used for this candidate.'; end if;
  if not exists(select 1 from jsonb_array_elements(v_pack->'sources') fresh where not exists(
    select 1 from public.product_experiments prior cross join lateral jsonb_array_elements(prior.evidence_pack->'sources') old_source
    where prior.candidate_id=c.id and old_source->>'contentHash'=fresh->>'contentHash') and not exists(
    select 1 from public.product_experiments prior join public.artifacts prior_sources on prior_sources.workflow_run_id=prior.workflow_run_id
      and prior_sources.business_id=prior.business_id and prior_sources.artifact_type='research.sources'
      cross join lateral jsonb_array_elements(prior_sources.content->'sources') old_source
    where prior.candidate_id=c.id and old_source->>'contentHash'=fresh->>'contentHash')) then
    raise exception 'Reconsideration requires never-before-seen source content, not a new URL or timestamp.'; end if;
  insert into public.product_experiments(business_id,candidate_id,workflow_run_id,fingerprint,hypothesis,variables,audience,status,measurement_plan,basis_artifact_id)
    values(c.business_id,c.id,a.workflow_run_id,private.stage13_hash(c.id||':basis:'||a.id),c.hypothesis,
      jsonb_build_object('concept',c.concept,'productType',c.product_type,'sourceDomains',c.source_domains,'originalDesign',c.original_design,'rightsStatus',c.rights_status,'reconsideration',true),
      c.audience,'reserved',private.stage13_plan(),a.id) returning id into v_id;
  perform private.stage13_finalize(v_id);
  return jsonb_build_object('experimentId',v_id,'cached',false);
end; $$;

create function public.fail_product_discovery_launch(p_experiment_id uuid,p_launch_nonce uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.product_experiments%rowtype; r public.workflow_runs%rowtype;
begin
  select * into e from public.product_experiments where id=p_experiment_id;
  if e.id is null or auth.uid() is null or not private.is_business_owner(e.business_id) then raise exception 'Business ownership required.' using errcode='42501'; end if;
  select * into strict r from public.workflow_runs where id=e.workflow_run_id and business_id=e.business_id for update;
  select * into strict e from public.product_experiments where id=p_experiment_id for update;
  if e.basis_artifact_id is not null or p_launch_nonce is null or r.runtime_launch_nonce is distinct from p_launch_nonce then raise exception 'Launch reservation denied.' using errcode='42501'; end if;
  if e.status='failed' and r.status='failed' and r.runtime_launch_status='launch_failed' then return jsonb_build_object('status','failed','cached',true); end if;
  if e.status<>'reserved' or r.status<>'queued' or r.runtime_launch_status<>'reserved' or r.runtime_run_id is not null then raise exception 'Only an unstarted reserved launch can fail.'; end if;
  update public.workflow_runs set status='failed',runtime_launch_status='launch_failed',completed_at=now(),state='{"failure":{"message":"Product discovery runtime launch failed before execution","code":"launch_failed"}}' where id=r.id;
  update public.workflow_stage_runs set status='skipped',completed_at=now(),failure='{"code":"launch_failed"}' where workflow_run_id=r.id and status='pending';
  update public.product_experiments set status='failed',failure='Product discovery runtime launch failed before execution',completed_at=now() where id=e.id;
  insert into public.events(id,business_id,workflow_run_id,event_type,actor_type,payload)
    values(private.stage4_deterministic_uuid('pack:failed:'||r.id),r.business_id,r.id,'workflow.failed','system','{"code":"launch_failed","providerExecuted":false}') on conflict(id) do nothing;
  return jsonb_build_object('experimentId',e.id,'status','failed','cached',false);
end; $$;

-- Explicit grants: owner APIs and per-run capability APIs never share a role.
revoke all on function public.create_product_candidate(uuid,jsonb),public.begin_product_discovery(uuid,uuid,text),
  public.finalize_product_discovery(uuid),public.record_product_assessment(uuid,jsonb,boolean),public.reconsider_product_candidate(uuid,uuid),
  public.fail_product_discovery_launch(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.create_product_candidate(uuid,jsonb),public.begin_product_discovery(uuid,uuid,text),
  public.finalize_product_discovery(uuid),public.record_product_assessment(uuid,jsonb,boolean),public.reconsider_product_candidate(uuid,uuid),
  public.fail_product_discovery_launch(uuid,uuid) to authenticated;
revoke all on function public.product_discovery_runtime(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.product_discovery_runtime(uuid,uuid,text,text) to anon;
revoke all on function private.stage13_hash(text),private.stage13_normalize(text),private.stage13_question(text,text,text),private.stage13_plan(),
  private.stage13_registry_guard(),private.stage13_research_write_guard(),private.stage13_validated_evidence(uuid,uuid,boolean),
  private.stage13_assessment(public.product_candidates,jsonb,jsonb),private.stage13_finalize(uuid) from public,anon,authenticated,service_role;

do $$
declare table_name text;
begin
  foreach table_name in array array['product_candidates','product_experiments','product_decisions'] loop
    if not exists(select 1 from pg_publication_tables p where p.pubname='supabase_realtime' and p.schemaname='public' and p.tablename=table_name) then
      execute format('alter publication supabase_realtime add table public.%I',table_name);
    end if;
  end loop;
end; $$;


-- Research-call reservations are conservative preflight ESTIMATES, never a
-- guaranteed invoice cap. Actual reported spend may exceed the estimate; each
-- later reservation counts the greater of the estimate and reported spend.
-- Unknown/timeout attempts retain their entire estimate. No refunds or retries.
alter table public.product_experiments add constraint stage13_experiment_business_identity unique(id,business_id);
create table public.product_research_cost_reservations (
  id uuid primary key default gen_random_uuid(), business_id uuid not null, experiment_id uuid not null, workflow_run_id uuid not null,
  attempt_key text not null check(attempt_key in ('search:luna.standard','search:gemini.flash.large','selector:luna.standard','selector:gemini.flash.large')),
  reserved_microusd integer not null check(reserved_microusd between 1 and 1000000), request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
  estimate jsonb not null default '{}' check(jsonb_typeof(estimate)='object' and octet_length(estimate::text)<=12000),
  created_at timestamptz not null default now(),
  foreign key(experiment_id,business_id) references public.product_experiments(id,business_id) on delete restrict,
  foreign key(workflow_run_id,business_id) references public.workflow_runs(id,business_id) on delete restrict,
  unique(experiment_id,attempt_key), unique(id,business_id)
);
create table public.product_research_cost_settlements (
  id uuid primary key default gen_random_uuid(), business_id uuid not null, reservation_id uuid not null,
  reported_microusd integer check(reported_microusd>=0), provider_request_id text check(length(provider_request_id) between 1 and 240),
  fingerprint text not null, created_at timestamptz not null default now(),
  foreign key(reservation_id,business_id) references public.product_research_cost_reservations(id,business_id) on delete restrict,
  unique(reservation_id,fingerprint)
);
create index stage13_cost_business on public.product_research_cost_reservations(business_id,created_at desc);
create index stage13_cost_settlement_business on public.product_research_cost_settlements(business_id,created_at desc);
alter table public.product_research_cost_reservations enable row level security;
alter table public.product_research_cost_settlements enable row level security;
create policy product_research_cost_owner_select on public.product_research_cost_reservations for select to authenticated using(private.is_business_owner(business_id));
create policy product_research_settlement_owner_select on public.product_research_cost_settlements for select to authenticated using(private.is_business_owner(business_id));
revoke all on public.product_research_cost_reservations,public.product_research_cost_settlements from public,anon,authenticated,service_role;
grant select on public.product_research_cost_reservations,public.product_research_cost_settlements to authenticated;
create trigger stage13_cost_append_only before insert or update or delete on public.product_research_cost_reservations for each row execute function private.stage13_registry_guard();
create trigger stage13_settlement_append_only before insert or update or delete on public.product_research_cost_settlements for each row execute function private.stage13_registry_guard();

create function private.stage13_committed_cost(p_experiment_id uuid) returns bigint language sql stable set search_path='' as $$
  select coalesce(sum(greatest(r.reserved_microusd,coalesce((select max(s.reported_microusd) from public.product_research_cost_settlements s where s.reservation_id=r.id),0))),0)::bigint
    from public.product_research_cost_reservations r where r.experiment_id=p_experiment_id;
$$;
revoke all on function private.stage13_committed_cost(uuid) from public,anon,authenticated,service_role;

create function public.reserve_product_research_cost(p_workflow_run_id uuid,p_business_id uuid,p_runtime_capability text,p_attempt_key text,p_reserved_microusd integer,p_request_hash text,p_estimate jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.workflow_runs%rowtype; e public.product_experiments%rowtype; reservation public.product_research_cost_reservations%rowtype; v_total bigint;
begin
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
      not(p_estimate->'quote' ?& array['modelId','verifiedAt','source','promptPerMillionUsd','completionPerMillionUsd','cacheWritePerMillionUsd','cacheReadPerMillionUsd']) or
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

create function public.record_product_research_cost(p_workflow_run_id uuid,p_business_id uuid,p_runtime_capability text,p_attempt_key text,p_reported_microusd integer,p_provider_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.workflow_runs%rowtype; e public.product_experiments%rowtype; reservation public.product_research_cost_reservations%rowtype; v_hash text; v_id uuid;
begin
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
revoke all on function public.reserve_product_research_cost(uuid,uuid,text,text,integer,text,jsonb),public.record_product_research_cost(uuid,uuid,text,text,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.reserve_product_research_cost(uuid,uuid,text,text,integer,text,jsonb),public.record_product_research_cost(uuid,uuid,text,text,integer,text) to anon;
