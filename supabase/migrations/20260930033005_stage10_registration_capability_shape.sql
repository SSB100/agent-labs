create or replace function private.stage10_register_pack(p_manifest jsonb) returns uuid language plpgsql security definer set search_path='' as $$
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
      values(v_id,m->'worker'->>'workerKey',m->'worker'->>'version',m->>'name',m->'worker'->>'role',m->'worker'->>'charter','experimental',m->'inputSchema',m->'outputSchema',m->'knowledgeRequirements',m->'capabilityPolicy'->'allowed',m->'modelRequirements');
  end loop;
  for d in select value from jsonb_array_elements(p_manifest->'workflows') loop
    insert into public.workflow_definitions(pack_id,workflow_key,version,name,description,status,input_schema,output_schema,stage_definition)
      values(v_id,d->>'key',d->>'version',d->>'name',d->>'description','experimental',d->'inputSchema',d->'outputSchema',jsonb_build_object('stages',d->'stages','frameworkVersion','1.0'));
  end loop;
  return v_id;
end; $$;
revoke all on function private.stage10_register_pack(jsonb) from public,anon,authenticated,service_role;


