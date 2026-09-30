-- Platform registration is private. Owners can activate qualified immutable releases.
alter table public.packs add column qualification_evidence jsonb not null default '{}';
create table public.pack_capability_definitions (
  id uuid primary key default gen_random_uuid(), pack_id uuid not null references public.packs(id),
  capability_key text not null, adapter text not null check(adapter='structured.mapping'),
  description text not null, unique(pack_id,capability_key)
);
create table public.pack_knowledge_definitions (
  id uuid primary key default gen_random_uuid(), pack_id uuid not null references public.packs(id),
  knowledge_key text not null, version text not null, name text not null,
  source text not null, verified_at timestamptz not null, freshness_days integer not null check(freshness_days>0),
  content jsonb not null check(jsonb_typeof(content)='object'), unique(pack_id,knowledge_key,version)
);
create table public.installed_packs (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id),
  root_pack_id uuid not null references public.packs(id), root_pack_key text not null,
  status text not null check(status in ('active','superseded')), snapshot jsonb not null,
  activated_at timestamptz not null default now(), superseded_at timestamptz,
  unique(business_id,root_pack_id)
);
create unique index installed_packs_active_key on public.installed_packs(business_id,root_pack_key) where status='active';
create index installed_packs_business_idx on public.installed_packs(business_id);
alter table public.pack_capability_definitions enable row level security;
alter table public.pack_knowledge_definitions enable row level security;
alter table public.installed_packs enable row level security;
create policy pack_capabilities_read on public.pack_capability_definitions for select to authenticated
  using(exists(select 1 from public.packs p where p.id=pack_id and p.status<>'retired'));
create policy pack_knowledge_read on public.pack_knowledge_definitions for select to authenticated
  using(exists(select 1 from public.packs p where p.id=pack_id and p.status<>'retired'));
create policy installed_packs_owner_read on public.installed_packs for select to authenticated using(private.is_business_owner(business_id));
revoke all on public.pack_capability_definitions,public.pack_knowledge_definitions,public.installed_packs from anon,authenticated;
grant select on public.pack_capability_definitions,public.pack_knowledge_definitions,public.installed_packs to authenticated;
alter table public.workflow_runs add column pack_installation_id uuid references public.installed_packs(id), add column pack_snapshot jsonb;
alter table public.workflow_runs add constraint pack_run_pins_required check(
 (pack_installation_id is null and pack_snapshot is null) or
 (pack_installation_id is not null and jsonb_typeof(pack_snapshot)='object' and runtime_capability_hash is not null));
create index workflow_runs_pack_installation_idx on public.workflow_runs(pack_installation_id);

create function private.stage10_guard_immutable() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_table_name='packs' then
    if old.manifest->>'frameworkVersion'='1.0' and (new.manifest is distinct from old.manifest or
      new.pack_key<>old.pack_key or new.version<>old.version or new.kind<>old.kind) then raise exception 'Pack releases are immutable.'; end if;
  elsif tg_table_name='installed_packs' then
    if (new.business_id,new.root_pack_id,new.root_pack_key,new.snapshot) is distinct from
       (old.business_id,old.root_pack_id,old.root_pack_key,old.snapshot) then raise exception 'Installation pins are immutable.'; end if;
  elsif old.pack_snapshot is not null and (new.pack_snapshot,new.pack_installation_id,new.business_id,new.workflow_definition_id,new.input,new.runtime_capability_hash)
    is distinct from (old.pack_snapshot,old.pack_installation_id,old.business_id,old.workflow_definition_id,old.input,old.runtime_capability_hash) then
    raise exception 'Running workflow pins and input are immutable.';
  end if;
  return new;
end; $$;
revoke all on function private.stage10_guard_immutable() from public,anon,authenticated,service_role;
create trigger stage10_pack_immutable before update on public.packs for each row execute function private.stage10_guard_immutable();
create trigger stage10_installation_immutable before update on public.installed_packs for each row execute function private.stage10_guard_immutable();
create trigger stage10_run_pins_immutable before update on public.workflow_runs for each row execute function private.stage10_guard_immutable();

-- Called only by reviewed platform migrations emitted by scripts/register-pack.mjs.
create function private.stage10_register_pack(p_manifest jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_existing jsonb; d jsonb; m jsonb;
begin
  if p_manifest->>'frameworkVersion'<>'1.0' or p_manifest->>'kind' not in ('capability','knowledge','worker','workflow')
     or length(p_manifest::text)>200000 or p_manifest->>'version' !~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
     or jsonb_typeof(p_manifest->'dependencies')<>'array' or jsonb_array_length(p_manifest->'evals')=0 then
    raise exception 'Invalid platform pack manifest.'; end if;
  select id,manifest into v_id,v_existing from public.packs where pack_key=p_manifest->>'packKey' and version=p_manifest->>'version';
  if found then
    if v_existing is distinct from p_manifest then raise exception 'Release already exists with different content.'; end if;
    return v_id;
  end if;
  insert into public.packs(pack_key,version,name,kind,status,manifest) values
    (p_manifest->>'packKey',p_manifest->>'version',p_manifest->>'name',p_manifest->>'kind','experimental',p_manifest) returning id into v_id;
  for d in select value from jsonb_array_elements(p_manifest->'capabilities') loop
    insert into public.pack_capability_definitions(pack_id,capability_key,adapter,description) values(v_id,d->>'key',d->>'adapter',d->>'description');
  end loop;
  for d in select value from jsonb_array_elements(p_manifest->'knowledge') loop
    insert into public.pack_knowledge_definitions(pack_id,knowledge_key,version,name,source,verified_at,freshness_days,content)
      values(v_id,d->>'key',d->>'version',d->>'name',d->>'source',(d->>'verifiedAt')::timestamptz,(d->>'freshnessDays')::integer,d->'content');
  end loop;
  for d in select value from jsonb_array_elements(p_manifest->'workers') loop
    m:=d->'manifest';
    insert into public.worker_definitions(pack_id,worker_key,version,name,role,charter,status,input_schema,output_schema,knowledge_requirements,capability_requirements,model_requirements)
      values(v_id,m->'worker'->>'workerKey',m->'worker'->>'version',m->>'name',m->'worker'->>'role',m->'worker'->>'charter','experimental',m->'inputSchema',m->'outputSchema',m->'knowledgeRequirements',m->'capabilityPolicy',m->'modelRequirements');
  end loop;
  for d in select value from jsonb_array_elements(p_manifest->'workflows') loop
    insert into public.workflow_definitions(pack_id,workflow_key,version,name,description,status,input_schema,output_schema,stage_definition)
      values(v_id,d->>'key',d->>'version',d->>'name',d->>'description','experimental',d->'inputSchema',d->'outputSchema',jsonb_build_object('stages',d->'stages','frameworkVersion','1.0'));
  end loop;
  return v_id;
end; $$;
revoke all on function private.stage10_register_pack(jsonb) from public,anon,authenticated,service_role;

create function private.stage10_resolve(p_root_id uuid, p_allow_experimental boolean default false) returns jsonb language plpgsql stable set search_path='' as $$
declare v_bad boolean; v_result jsonb;
begin
  with recursive deps as (
    select p.id,p.pack_key,p.version,p.status,p.manifest,array[p.pack_key] path,0 depth,false cycle from public.packs p where p.id=p_root_id
    union all
    select p.id,d.value->>'packKey',d.value->>'version',p.status,p.manifest,deps.path||(d.value->>'packKey'),deps.depth+1,(d.value->>'packKey')=any(deps.path)
      from deps cross join lateral jsonb_array_elements(deps.manifest->'dependencies') d
      left join public.packs p on p.pack_key=d.value->>'packKey' and p.version=d.value->>'version'
      where deps.depth<30 and not deps.cycle
  )
  select coalesce(bool_or(id is null or cycle or depth>=30 or manifest->>'frameworkVersion' is distinct from '1.0' or
       not (status in ('qualified','assisted','autonomous') or (p_allow_experimental and status='experimental'))),true)
    or (select count(*)=0 or count(*)>50 from deps)
    or exists(select 1 from deps group by pack_key having count(distinct version)>1),
    (select jsonb_agg(jsonb_build_object('id',id,'status',status,'manifest',manifest) order by pack_key,version) from (select distinct id,pack_key,version,status,manifest from deps) d)
    into v_bad,v_result from deps;
  if v_bad then raise exception 'Pack dependencies are missing, unqualified, cyclic, conflicting, or exceed limits.' using errcode='22023'; end if;
  return v_result;
end; $$;
revoke all on function private.stage10_resolve(uuid,boolean) from public,anon,authenticated,service_role;

create function private.stage10_qualify_pack(p_pack_id uuid,p_evidence jsonb) returns void language plpgsql security definer set search_path='' as $$
declare v_manifest jsonb;
begin
  select manifest into strict v_manifest from public.packs where id=p_pack_id and manifest->>'frameworkVersion'='1.0';
  if jsonb_typeof(p_evidence)<>'object' or not (p_evidence ? 'source') or exists(
    select 1 from jsonb_array_elements_text(v_manifest->'evals') e where p_evidence->'checks'->>e<>'passed' or p_evidence->'checks'->>e is null) then
    raise exception 'All declared qualification checks need passing platform evidence.'; end if;
  perform private.stage10_resolve(p_pack_id,true);
  update public.packs set status='qualified',qualification_evidence=p_evidence||jsonb_build_object('qualifiedAt',now()),updated_at=now() where id=p_pack_id;
  update public.worker_definitions set status='qualified',updated_at=now() where pack_id=p_pack_id;
  update public.workflow_definitions set status='qualified',updated_at=now() where pack_id=p_pack_id;
end; $$;
revoke all on function private.stage10_qualify_pack(uuid,jsonb) from public,anon,authenticated,service_role;

create function public.activate_business_pack(p_business_id uuid,p_pack_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare v_pack public.packs%rowtype; v_releases jsonb; v_id uuid;
begin
  if auth.uid() is null or not private.is_business_owner(p_business_id) then raise exception 'Business ownership required.' using errcode='42501'; end if;
  perform 1 from public.businesses where id=p_business_id for update;
  select * into strict v_pack from public.packs where id=p_pack_id;
  v_releases:=private.stage10_resolve(p_pack_id);
  select id into v_id from public.installed_packs where business_id=p_business_id and root_pack_id=p_pack_id and status='active';
  if found then return v_id; end if;
  update public.installed_packs set status='superseded',superseded_at=now() where business_id=p_business_id and root_pack_key=v_pack.pack_key and status='active';
  insert into public.installed_packs(business_id,root_pack_id,root_pack_key,status,snapshot) values
    (p_business_id,p_pack_id,v_pack.pack_key,'active',jsonb_build_object('rootPackId',p_pack_id,'releases',v_releases))
    on conflict(business_id,root_pack_id) do update set status='active',superseded_at=null,activated_at=now() returning id into v_id;
  insert into public.events(business_id,event_type,actor_type,payload) values(p_business_id,'pack.activated','owner',jsonb_build_object('installationId',v_id,'packKey',v_pack.pack_key,'version',v_pack.version));
  return v_id;
end; $$;
revoke all on function public.activate_business_pack(uuid,uuid) from public,anon;
grant execute on function public.activate_business_pack(uuid,uuid) to authenticated;

create function public.begin_installed_pack_run(p_business_id uuid,p_installation_id uuid,p_workflow_key text,p_input jsonb,p_idempotency_key text,p_launch_nonce uuid,p_runtime_capability text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_install public.installed_packs%rowtype; v_definition public.workflow_definitions%rowtype; v_workflow jsonb; v_id uuid; s jsonb; n integer:=0;
begin
  if auth.uid() is null or not private.is_business_owner(p_business_id) then raise exception 'Business ownership required.' using errcode='42501'; end if;
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
revoke all on function public.begin_installed_pack_run(uuid,uuid,text,jsonb,text,uuid,text) from public,anon;
grant execute on function public.begin_installed_pack_run(uuid,uuid,text,jsonb,text,uuid,text) to authenticated;

create function public.installed_pack_runtime_transition(p_workflow_run_id uuid,p_business_id uuid,p_runtime_capability text,p_operation text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  r public.workflow_runs%rowtype; s public.workflow_stage_runs%rowtype; t public.task_contracts%rowtype;
  w public.worker_runs%rowtype; d public.worker_definitions%rowtype;
  stage jsonb; worker jsonb; knowledge jsonb; release jsonb; stage_input jsonb; context jsonb; v_output jsonb; receipt jsonb;
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
    if r.status='completed' then return jsonb_build_object('status','completed'); end if;
    update public.workflow_runs set status='failed',completed_at=now(),state=jsonb_build_object('failure',p_payload) where id=r.id;
    update public.workflow_stage_runs set status=case when status='running' then 'failed' else 'skipped' end,failure=p_payload,completed_at=now() where workflow_run_id=r.id and status in ('pending','running');
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
    if stage->>'inputFrom'='workflow' then stage_input:=r.input; else
      select output into strict stage_input from public.workflow_stage_runs where workflow_run_id=r.id and stage_key=stage->>'inputFrom' and status='completed'; end if;
    artifact_id:=private.stage4_deterministic_uuid('pack:input:'||r.id||':'||v_stage_key);
    insert into public.artifacts(id,business_id,workflow_run_id,artifact_type,name,media_type,content,metadata)
      values(artifact_id,r.business_id,r.id,'pack.stage-input','Stage input','application/json',stage_input,jsonb_build_object('stageKey',v_stage_key)) on conflict(id) do nothing;
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
      values(artifact_id,r.business_id,r.id,task_id,'worker.output','Pack worker output','application/json',v_output,jsonb_build_object('receipt',receipt)) on conflict(id) do nothing;
    update public.worker_runs set status='completed',output=v_output,completed_at=now(),execution_metadata=execution_metadata||jsonb_build_object('receipt',receipt,'outputValidated',true,'outputArtifactId',artifact_id) where id=worker_id;
    update public.task_contracts set status='completed' where id=task_id;
    update public.workflow_stage_runs set status='completed',output=v_output,completed_at=now() where id=s.id;
    insert into public.events(id,business_id,workflow_run_id,event_type,actor_type,payload) values(private.stage4_deterministic_uuid('pack:worker-completed:'||worker_id),r.business_id,r.id,'worker.completed','worker',jsonb_build_object('workerRunId',worker_id,'stageKey',v_stage_key,'workerVersion',stage->>'workerVersion','outputArtifactId',artifact_id)) on conflict(id) do nothing;
    return jsonb_build_object('completed',true,'output',v_output,'receipt',receipt);
  end if;
  raise exception 'Unknown pack runtime operation.';
end; $$;
revoke all on function public.installed_pack_runtime_transition(uuid,uuid,text,text,jsonb) from public,authenticated;
grant execute on function public.installed_pack_runtime_transition(uuid,uuid,text,text,jsonb) to anon;
