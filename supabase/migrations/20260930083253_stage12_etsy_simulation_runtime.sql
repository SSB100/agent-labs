-- The only experimental runtime exception here is the exact Stage 12 mock-only closure.
-- The generic installed-pack persistence engine remains the source of contracts and artifacts.
alter table public.workflow_runs drop constraint pack_run_pins_required;
alter table public.workflow_runs add constraint pack_run_pins_required check (
  (pack_installation_id is null and pack_snapshot is null) or
  (jsonb_typeof(pack_snapshot)='object' and runtime_capability_hash is not null and
    (pack_installation_id is not null or
      (pack_snapshot->>'platformQualification'='stage11' and pack_snapshot->'workflow'->>'key'='research.public-evidence') or
      (pack_snapshot->>'platformQualification'='stage12' and pack_snapshot->>'mode'='simulation' and
        pack_snapshot->'workflow'->>'key'='etsy.product-discovery-simulation' and pack_snapshot->'workflow'->>'version'='1.0.0'))));

create function private.stage12_assert_simulation_snapshot(p_snapshot jsonb)
returns void language plpgsql stable set search_path='' as $$
declare v_keys text[]; v_root jsonb;
begin
  select array_agg(value->'manifest'->>'packKey' order by value->'manifest'->>'packKey') into v_keys
    from jsonb_array_elements(p_snapshot->'releases');
  select value into v_root from jsonb_array_elements(p_snapshot->'releases') where value->>'id'=p_snapshot->>'rootPackId';
  if p_snapshot->>'platformQualification' is distinct from 'stage12' or p_snapshot->>'mode' is distinct from 'simulation' or
    v_keys is distinct from array['knowledge.etsy-current-policy','knowledge.etsy-selling','knowledge.print-on-demand',
      'knowledge.product-research','knowledge.social-marketing','worker.etsy-market-researcher','worker.etsy-product-strategist',
      'worker.etsy-reviewer','workflow.etsy-product-discovery'] or
    v_root->'manifest'->>'packKey' is distinct from 'workflow.etsy-product-discovery' or
    p_snapshot->'workflow'->>'key' is distinct from 'etsy.product-discovery-simulation' or
    p_snapshot->'workflow'->>'version' is distinct from '1.0.0' or
    p_snapshot->'workflow' is distinct from v_root->'manifest'->'workflows'->0 or
    exists(select 1 from jsonb_array_elements(p_snapshot->'releases') r where
      r->>'status' is distinct from 'experimental' or r->'manifest'->>'version' is distinct from '1.0.0' or
      r->'manifest'->'capabilities' is distinct from '[]'::jsonb or
      not exists(select 1 from public.packs p where p.id=(r->>'id')::uuid and p.manifest=r->'manifest')) or
    exists(select 1 from jsonb_array_elements(p_snapshot->'workflow'->'stages') s where s->'permittedCapabilities' is distinct from '[]'::jsonb) then
    raise exception 'Only the exact Stage 12 simulation snapshot is permitted.' using errcode='42501';
  end if;
end; $$;
revoke all on function private.stage12_assert_simulation_snapshot(jsonb) from public,anon,authenticated,service_role;

create function public.begin_etsy_discovery_simulation(p_business_id uuid,p_idempotency_key text,p_launch_nonce uuid,p_runtime_capability text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.packs%rowtype; d public.workflow_definitions%rowtype; v_workflow jsonb; v_snapshot jsonb; v_id uuid; s jsonb; n integer:=0;
begin
  if auth.uid() is null or not private.is_business_owner(p_business_id) then raise exception 'Business ownership required.' using errcode='42501'; end if;
  if p_launch_nonce is null or coalesce(length(p_runtime_capability),0) not between 32 and 512 or
    coalesce(length(btrim(p_idempotency_key)),0) not between 1 and 200 then raise exception 'Invalid simulation reservation.'; end if;
  select * into strict p from public.packs where pack_key='workflow.etsy-product-discovery' and version='1.0.0' and status='experimental';
  select value into strict v_workflow from jsonb_array_elements(p.manifest->'workflows') where value->>'key'='etsy.product-discovery-simulation';
  v_snapshot:=jsonb_build_object('rootPackId',p.id,'releases',private.stage10_resolve(p.id,true),'workflow',v_workflow,'platformQualification','stage12','mode','simulation');
  perform private.stage12_assert_simulation_snapshot(v_snapshot);
  select * into strict d from public.workflow_definitions where pack_id=p.id and workflow_key=v_workflow->>'key' and version='1.0.0' and status='experimental';
  insert into public.workflow_runs(business_id,workflow_definition_id,status,idempotency_key,input,state,pack_snapshot,runtime_capability_hash,runtime_launch_status,runtime_launch_nonce,runtime_launch_reserved_at)
    values(p_business_id,d.id,'queued',p_idempotency_key,v_workflow->'sampleInput',
      '{"mode":"simulation","providerExecuted":false,"qualificationEvaluated":false,"publicationAllowed":false}',v_snapshot,
      encode(extensions.digest(convert_to(p_runtime_capability,'UTF8'),'sha256'),'hex'),'reserved',p_launch_nonce,now())
    on conflict(business_id,idempotency_key) do nothing returning id into v_id;
  if v_id is null then
    select id into strict v_id from public.workflow_runs where business_id=p_business_id and idempotency_key=p_idempotency_key
      and pack_snapshot->>'platformQualification'='stage12' and pack_snapshot->>'mode'='simulation'
      and workflow_definition_id=d.id and input=v_workflow->'sampleInput';
    return jsonb_build_object('workflowRunId',v_id,'shouldStart',false);
  end if;
  for s in select value from jsonb_array_elements(v_workflow->'stages') loop
    n:=n+1;
    insert into public.workflow_stage_runs(business_id,workflow_run_id,stage_key,sequence,attempt,status,input,output,failure)
      values(p_business_id,v_id,s->>'key',n,1,'pending','{}','{}','{}');
  end loop;
  return jsonb_build_object('workflowRunId',v_id,'shouldStart',true);
end; $$;
revoke all on function public.begin_etsy_discovery_simulation(uuid,text,uuid,text) from public,anon;
grant execute on function public.begin_etsy_discovery_simulation(uuid,text,uuid,text) to authenticated;

-- Preserve the original generic engine privately. The public capability boundary adds
-- simulation invariants, without granting another callable persistence bypass.
alter function public.installed_pack_runtime_transition(uuid,uuid,text,text,jsonb) set schema private;
alter function private.installed_pack_runtime_transition(uuid,uuid,text,text,jsonb) rename to stage10_installed_pack_runtime_transition;
revoke all on function private.stage10_installed_pack_runtime_transition(uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role;

create function public.installed_pack_runtime_transition(p_workflow_run_id uuid,p_business_id uuid,p_runtime_capability text,p_operation text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.workflow_runs%rowtype; i public.owner_interventions%rowtype; v_result jsonb; v_output jsonb; receipt jsonb;
  stage jsonb; worker jsonb; v_id uuid; v_resolution jsonb; v_stage_key text:=p_payload->>'stageKey';
begin
  if p_runtime_capability is null or length(p_runtime_capability) not between 32 and 512 or
    jsonb_typeof(p_payload) is distinct from 'object' or length(p_payload::text)>200000 then
    raise exception 'Pack runtime request denied.' using errcode='42501'; end if;
  select * into r from public.workflow_runs where id=p_workflow_run_id and business_id=p_business_id and pack_snapshot is not null
    and runtime_capability_hash=encode(extensions.digest(convert_to(p_runtime_capability,'UTF8'),'sha256'),'hex') for update;
  if not found then raise exception 'Pack runtime capability denied.' using errcode='42501'; end if;
  if r.pack_snapshot->>'platformQualification' is distinct from 'stage12' and
    r.pack_snapshot->'workflow'->>'key' is distinct from 'etsy.product-discovery-simulation' then
    return private.stage10_installed_pack_runtime_transition(p_workflow_run_id,p_business_id,p_runtime_capability,p_operation,p_payload);
  end if;
  perform private.stage12_assert_simulation_snapshot(r.pack_snapshot);
  v_id:=private.stage4_deterministic_uuid('etsy:simulation-review:'||r.id);
  select * into i from public.owner_interventions where id=v_id and workflow_run_id=r.id and business_id=r.business_id for update;
  if p_operation='load' and r.status='needs_owner' then
    if nullif(p_payload->>'runtimeRunId','') is null or r.runtime_run_id is distinct from p_payload->>'runtimeRunId' then raise exception 'Runtime identity mismatch.'; end if;
    return jsonb_build_object('snapshot',r.pack_snapshot,'input',r.input,'status',r.status);
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
    update public.owner_interventions set status=case when v_resolution->>'decision'='acknowledge' then 'resolved' else 'declined' end,resolved_at=now() where id=i.id;
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
    return jsonb_build_object('output',r.state->'output','schema',r.pack_snapshot->'workflow'->'outputSchema'); end if;
  return private.stage10_installed_pack_runtime_transition(r.id,r.business_id,p_runtime_capability,p_operation,p_payload);
end; $$;
revoke all on function public.installed_pack_runtime_transition(uuid,uuid,text,text,jsonb) from public,authenticated;
grant execute on function public.installed_pack_runtime_transition(uuid,uuid,text,text,jsonb) to anon;

-- Persist the decision before delivering the durable hook. Keep it open until consumption,
-- so a failed hook delivery can be retried; repeated decisions reuse the exact payload.
create function public.record_etsy_simulation_decision(p_intervention_id uuid,p_decision text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.owner_interventions%rowtype; r public.workflow_runs%rowtype; v_resolution jsonb;
begin
  if auth.uid() is null or p_decision is null or p_decision not in ('acknowledge','stop') then raise exception 'Valid owner simulation decision required.' using errcode='42501'; end if;
  select * into i from public.owner_interventions where id=p_intervention_id and intervention_type='etsy_simulation_review';
  if not found or not private.is_business_owner(i.business_id) then raise exception 'Business ownership required.' using errcode='42501'; end if;
  select * into strict r from public.workflow_runs where id=i.workflow_run_id and business_id=i.business_id for update;
  select * into strict i from public.owner_interventions where id=p_intervention_id for update;
  perform private.stage12_assert_simulation_snapshot(r.pack_snapshot);
  if i.resolution->>'decision' is not null then
    if i.resolution->>'decision' is distinct from p_decision or i.resolution->>'ownerUserId' is distinct from auth.uid()::text then raise exception 'Simulation decision is already recorded.'; end if;
    if r.status not in ('needs_owner','completed','cancelled') then raise exception 'Simulation review is terminal.'; end if;
    return jsonb_build_object('workflowRunId',r.id,'shouldResume',i.status='open' and r.status='needs_owner','decision',i.resolution);
  end if;
  if i.status<>'open' or r.status<>'needs_owner' then raise exception 'Simulation review is not open.'; end if;
  v_resolution:=jsonb_build_object('decision',p_decision,'ownerUserId',auth.uid(),'decidedAt',now()::text);
  update public.owner_interventions set resolution=v_resolution where id=i.id;
  insert into public.events(id,business_id,workflow_run_id,event_type,actor_type,actor_id,payload) values
    (private.stage4_deterministic_uuid('etsy:simulation-decision:'||r.id),r.business_id,r.id,'owner_intervention.decision_recorded','owner',auth.uid()::text,
      v_resolution||'{"mode":"simulation","publicationAllowed":false,"qualificationEvaluated":false}') on conflict(id) do nothing;
  return jsonb_build_object('workflowRunId',r.id,'shouldResume',true,'decision',v_resolution);
end; $$;
revoke all on function public.record_etsy_simulation_decision(uuid,text) from public,anon;
grant execute on function public.record_etsy_simulation_decision(uuid,text) to authenticated;

-- Owner table write grants must not bypass the authenticated decision RPC or forge a review.
create function private.stage12_guard_intervention() returns trigger language plpgsql set search_path='' as $$
begin
  if current_user in ('anon','authenticated') and
    ((tg_op<>'INSERT' and old.intervention_type='etsy_simulation_review') or
      (tg_op<>'DELETE' and new.intervention_type='etsy_simulation_review')) then
    raise exception 'Use the owner-checked simulation decision RPC.' using errcode='42501'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end; $$;
revoke all on function private.stage12_guard_intervention() from public,anon,authenticated,service_role;
create trigger stage12_simulation_intervention_guard before insert or update or delete on public.owner_interventions
  for each row execute function private.stage12_guard_intervention();
