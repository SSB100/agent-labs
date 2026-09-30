alter table public.pack_capability_definitions drop constraint pack_capability_definitions_adapter_check;
alter table public.pack_capability_definitions add constraint pack_capability_definitions_adapter_check check(adapter in ('structured.mapping','web.research'));

create function private.stage11_guard_source_artifact() returns trigger language plpgsql set search_path='' as $$
begin
  if old.artifact_type='research.sources' or (old.artifact_type='worker.output' and old.metadata->'receipt'->>'executionMode'='web.research') then
    if (new.content,new.metadata,new.business_id,new.workflow_run_id,new.task_contract_id,new.artifact_type,new.media_type)
      is distinct from (old.content,old.metadata,old.business_id,old.workflow_run_id,old.task_contract_id,old.artifact_type,old.media_type) then
      raise exception 'Research provenance and validated Evidence Packs are immutable.'; end if;
  end if;
  return new;
end; $$;
revoke all on function private.stage11_guard_source_artifact() from public,anon,authenticated,service_role;
create trigger stage11_immutable_research_artifact before update on public.artifacts for each row execute function private.stage11_guard_source_artifact();

create function public.append_pack_research_sources(p_workflow_run_id uuid,p_business_id uuid,p_runtime_capability text,p_stage_key text,p_collection jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.workflow_runs%rowtype; t public.task_contracts%rowtype; w public.worker_runs%rowtype;
  stage jsonb; worker jsonb; v_input jsonb; v_source jsonb; v_evidence jsonb; v_hostname text; v_artifact_id uuid; v_prepared jsonb;
begin
  if p_runtime_capability is null or length(p_runtime_capability) not between 32 and 512 or jsonb_typeof(p_collection) is distinct from 'object' or length(p_collection::text)>50000 then
    raise exception 'Research source request denied.' using errcode='42501'; end if;
  select * into r from public.workflow_runs where id=p_workflow_run_id and business_id=p_business_id and pack_snapshot is not null
    and runtime_capability_hash=encode(extensions.digest(convert_to(p_runtime_capability,'UTF8'),'sha256'),'hex') for update;
  if not found then raise exception 'Research runtime capability denied.' using errcode='42501'; end if;
  select value into strict stage from jsonb_array_elements(r.pack_snapshot->'workflow'->'stages') where value->>'key'=p_stage_key;
  select x.value into strict worker from jsonb_array_elements(r.pack_snapshot->'releases') y cross join lateral jsonb_array_elements(y.value->'manifest'->'workers') x
    where x.value->'manifest'->'worker'->>'workerKey'=stage->>'workerKey' and x.value->'manifest'->'worker'->>'version'=stage->>'workerVersion';
  if worker->'execution'->>'kind' is distinct from 'web.research' or not (stage->'permittedCapabilities' ? 'web.research') then raise exception 'Stage does not authorize Web Research.' using errcode='42501'; end if;
  select * into strict t from public.task_contracts where workflow_run_id=r.id and business_id=r.business_id and workflow_stage_run_id=(select id from public.workflow_stage_runs where workflow_run_id=r.id and stage_key=p_stage_key and attempt=1);
  select * into strict w from public.worker_runs where task_contract_id=t.id and workflow_run_id=r.id and business_id=r.business_id;
  v_artifact_id:=private.stage4_deterministic_uuid('research:sources:'||r.id||':'||p_stage_key);
  if exists(select 1 from public.artifacts where id=v_artifact_id and business_id=r.business_id and workflow_run_id=r.id and task_contract_id=t.id) then
    return jsonb_build_object('artifactId',v_artifact_id,'cached',true); end if;
  if r.status<>'running' or t.status<>'running' or w.status<>'running' then raise exception 'Research stage is not running.'; end if;
  select content into strict v_input from public.artifacts where id=any(t.input_artifact_ids) and workflow_run_id=r.id and business_id=r.business_id and artifact_type='pack.stage-input';
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
revoke all on function public.append_pack_research_sources(uuid,uuid,text,text,jsonb) from public,authenticated;
grant execute on function public.append_pack_research_sources(uuid,uuid,text,text,jsonb) to anon;
