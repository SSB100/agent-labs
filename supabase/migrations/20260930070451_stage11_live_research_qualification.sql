-- Experimental packs can run only this fixed, owner-scoped qualification flow.
alter table public.workflow_runs drop constraint pack_run_pins_required;
alter table public.workflow_runs add constraint pack_run_pins_required check(
  (pack_installation_id is null and pack_snapshot is null) or
  (jsonb_typeof(pack_snapshot)='object' and runtime_capability_hash is not null and
   (pack_installation_id is not null or (pack_snapshot->>'platformQualification'='stage11' and pack_snapshot->'workflow'->>'key'='research.public-evidence'))));

create function public.begin_web_research_qualification(p_business_id uuid,p_idempotency_key text,p_launch_nonce uuid,p_runtime_capability text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.packs%rowtype; d public.workflow_definitions%rowtype; v_workflow jsonb; v_releases jsonb; v_id uuid; s jsonb; n integer:=0;
begin
  if auth.uid() is null or not private.is_business_owner(p_business_id) then raise exception 'Business ownership required.' using errcode='42501'; end if;
  if p_launch_nonce is null or coalesce(length(p_runtime_capability),0) not between 32 and 512 or coalesce(length(btrim(p_idempotency_key)),0) not between 1 and 200 then raise exception 'Invalid qualification reservation.'; end if;
  select * into strict p from public.packs where pack_key='workflow.web-research' and version='1.0.0' and status<>'retired';
  v_releases:=private.stage10_resolve(p.id,true);
  select value into strict v_workflow from jsonb_array_elements(p.manifest->'workflows') where value->>'key'='research.public-evidence';
  select * into strict d from public.workflow_definitions where pack_id=p.id and workflow_key=v_workflow->>'key' and version=v_workflow->>'version';
  insert into public.workflow_runs(business_id,workflow_definition_id,status,idempotency_key,input,state,pack_snapshot,runtime_capability_hash,runtime_launch_status,runtime_launch_nonce,runtime_launch_reserved_at)
    values(p_business_id,d.id,'queued',p_idempotency_key,v_workflow->'sampleInput','{}',jsonb_build_object('rootPackId',p.id,'releases',v_releases,'workflow',v_workflow,'platformQualification','stage11'),
      encode(extensions.digest(convert_to(p_runtime_capability,'UTF8'),'sha256'),'hex'),'reserved',p_launch_nonce,now())
    on conflict(business_id,idempotency_key) do nothing returning id into v_id;
  if v_id is null then select id into strict v_id from public.workflow_runs where business_id=p_business_id and idempotency_key=p_idempotency_key and pack_snapshot->>'platformQualification'='stage11';
    return jsonb_build_object('workflowRunId',v_id,'shouldStart',false); end if;
  for s in select value from jsonb_array_elements(v_workflow->'stages') loop
    n:=n+1;
    insert into public.workflow_stage_runs(business_id,workflow_run_id,stage_key,sequence,attempt,status,input,output,failure) values(p_business_id,v_id,s->>'key',n,1,'pending','{}','{}','{}');
  end loop;
  return jsonb_build_object('workflowRunId',v_id,'shouldStart',true);
end; $$;
revoke all on function public.begin_web_research_qualification(uuid,text,uuid,text) from public,anon;
grant execute on function public.begin_web_research_qualification(uuid,text,uuid,text) to authenticated;

create function public.record_web_research_qualification(p_workflow_run_id uuid,p_business_id uuid,p_runtime_capability text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.workflow_runs%rowtype; w public.worker_runs%rowtype; v_sources jsonb; v_pack jsonb; v_claim jsonb; v_release jsonb; v_evidence jsonb;
begin
  if p_runtime_capability is null or length(p_runtime_capability) not between 32 and 512 then raise exception 'Qualification capability denied.' using errcode='42501'; end if;
  select * into r from public.workflow_runs where id=p_workflow_run_id and business_id=p_business_id and pack_snapshot->>'platformQualification'='stage11'
    and runtime_capability_hash=encode(extensions.digest(convert_to(p_runtime_capability,'UTF8'),'sha256'),'hex') for update;
  if not found then raise exception 'Qualification capability denied.' using errcode='42501'; end if;
  if r.status not in ('running','completed') or exists(select 1 from public.workflow_stage_runs where workflow_run_id=r.id and status<>'completed') then raise exception 'Research stages are not complete.'; end if;
  select * into strict w from public.worker_runs where workflow_run_id=r.id and status='completed';
  select content into strict v_sources from public.artifacts where workflow_run_id=r.id and business_id=r.business_id and task_contract_id=w.task_contract_id and artifact_type='research.sources';
  v_pack:=w.output->'evidencePack';
  if w.execution_metadata->'receipt'->>'outputValidated' is distinct from 'true' or w.execution_metadata->'receipt'->>'executionMode' is distinct from 'web.research' or
    w.execution_metadata->'receipt'->>'modelRouteKey' is distinct from 'standard.default' or nullif(w.execution_metadata->'receipt'->>'providerRequestId','') is null or
    v_sources->'providerMetadata'->>'searchRequests' is distinct from '1' or nullif(v_sources->'providerMetadata'->>'providerRequestId','') is null or
    jsonb_typeof(v_pack->'claims') is distinct from 'array' or jsonb_array_length(v_pack->'claims') not between 1 and 4 then raise exception 'Live source and Researcher evidence is incomplete.'; end if;
  for v_claim in select value from jsonb_array_elements(v_pack->'claims') loop
    if not exists(select 1 from jsonb_array_elements(v_sources->'evidence') evidence cross join jsonb_array_elements(v_sources->'sources') source where
      evidence->>'id'=v_claim->>'evidenceId' and evidence->>'sourceId'=v_claim->>'sourceId' and source->>'id'=v_claim->>'sourceId' and
      v_claim->>'text'=evidence->>'quote' and strpos(source->>'excerpt',v_claim->>'text')>0) then raise exception 'Qualification contains an unsupported claim.'; end if;
  end loop;
  for v_release in select value from jsonb_array_elements(r.pack_snapshot->'releases') loop
    select qualification_evidence into strict v_evidence from public.packs where id=(v_release->>'id')::uuid;
    if v_evidence->>'databaseRegression' is distinct from 'passed' or exists(select 1 from jsonb_array_elements_text(v_release->'manifest'->'evals') e where v_evidence->'checks'->>e is distinct from 'passed') then raise exception 'Platform evaluations must pass before live promotion.'; end if;
    perform private.stage10_qualify_pack((v_release->>'id')::uuid,v_evidence||jsonb_build_object('liveQualification','passed','liveWorkflowRunId',r.id,
      'liveCheckedAt',now(),'sourceCount',jsonb_array_length(v_sources->'sources'),'providerRequestId',v_sources->'providerMetadata'->>'providerRequestId'));
  end loop;
  perform public.installed_pack_runtime_transition(r.id,r.business_id,p_runtime_capability,'complete');
  return jsonb_build_object('status','qualified','workflowRunId',r.id);
end; $$;
revoke all on function public.record_web_research_qualification(uuid,uuid,text) from public,authenticated;
grant execute on function public.record_web_research_qualification(uuid,uuid,text) to anon;

-- Contract, source-linkage, adversarial, freshness, provider, and Researcher tests;
-- live promotion above separately requires an actual completed source-linked run.
update public.packs set qualification_evidence=jsonb_build_object('source','tests/research.test.mjs','databaseRegression','pending',
  'checks',jsonb_build_object('manifest','passed','dependencies','passed','scope','passed','version-pinning','passed','worker-output','passed',
    'source-linkage','passed','unsupported-claims','passed','freshness','passed','provider','passed'),'liveQualification','pending')
where pack_key in ('capability.web-research','knowledge.research-evidence','worker.market-researcher','workflow.web-research') and version='1.0.0';
