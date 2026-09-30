-- Mock-only persistence/owner-gate regression. No live model/provider execution; all changes roll back.
begin;
select set_config('stage12.test.owner',(select owner_user_id::text from public.businesses where name='Stage 9 Live Qualification' limit 1),true);
select set_config('stage12.test.business',(select id::text from public.businesses where name='Stage 9 Live Qualification' limit 1),true);
select set_config('request.jwt.claim.sub',current_setting('stage12.test.owner'),true);
set local role authenticated;
do $$
declare b uuid:=current_setting('stage12.test.business')::uuid; run jsonb; duplicate jsonb; denied boolean:=false; scenario text;
begin
  begin perform public.begin_etsy_discovery_simulation(gen_random_uuid(),'stage12:foreign',gen_random_uuid(),repeat('stage12-wrong-owner-',3));
  exception when insufficient_privilege then denied:=true; end;
  assert denied,'Foreign Business simulation denied';
  denied:=false;
  begin perform public.begin_etsy_discovery_simulation(b,'stage12:bad-capability',gen_random_uuid(),null);
  exception when others then denied:=true; end;
  assert denied,'Null runtime capability denied';
  denied:=false;
  begin perform public.activate_business_pack(b,(select id from public.packs where pack_key='workflow.etsy-product-discovery' and version='1.0.0'));
  exception when others then denied:=true; end;
  assert denied,'Experimental simulation must not be normally activatable';
  foreach scenario in array array['ack','stop','fail'] loop
    run:=public.begin_etsy_discovery_simulation(b,'stage12:runtime-regression:'||scenario,gen_random_uuid(),repeat('stage12-regression-'||scenario,3));
    duplicate:=public.begin_etsy_discovery_simulation(b,'stage12:runtime-regression:'||scenario,gen_random_uuid(),repeat('unused-capability-',3));
    assert run->'shouldStart'='true'::jsonb and duplicate->'shouldStart'='false'::jsonb and run->>'workflowRunId'=duplicate->>'workflowRunId','Reservations must be idempotent';
    assert (select pack_installation_id is null and pack_snapshot->>'mode'='simulation' and jsonb_array_length(pack_snapshot->'releases')=9 from public.workflow_runs where id=(run->>'workflowRunId')::uuid);
    perform set_config('stage12.test.'||scenario,run->>'workflowRunId',true);
  end loop;
  denied:=false;
  begin perform public.begin_web_research_qualification(b,'stage12:runtime-regression:ack',gen_random_uuid(),repeat('stage12-other-runtime-',3));
  exception when others then denied:=true; end;
  assert denied,'Cross-workflow idempotency keys cannot reuse or overwrite a simulation';
end; $$;
reset role;
set local role anon;
do $$
declare b uuid:=current_setting('stage12.test.business')::uuid; r uuid; cap text; scenario text; stage_key text;
  loaded jsonb; prepared jsonb; output jsonb; receipt jsonb; requested jsonb; denied boolean;
begin
  foreach scenario in array array['ack','stop','fail'] loop
    r:=current_setting('stage12.test.'||scenario)::uuid; cap:=repeat('stage12-regression-'||scenario,3);
    denied:=false;
    begin perform public.installed_pack_runtime_transition(r,b,repeat('unused-capability-',3),'load','{"runtimeRunId":"simulation_wrong"}');
    exception when insufficient_privilege then denied:=true; end;
    assert denied,'Repeated launch must not replace runtime capability';
    denied:=false;
    begin perform public.installed_pack_runtime_transition(r,gen_random_uuid(),cap,'load','{"runtimeRunId":"simulation_wrong"}');
    exception when insufficient_privilege then denied:=true; end;
    assert denied,'Capability cannot cross Businesses';
    loaded:=public.installed_pack_runtime_transition(r,b,cap,'load',jsonb_build_object('runtimeRunId','simulation_regression_'||scenario));
    assert loaded->'snapshot'->>'platformQualification'='stage12' and loaded->'snapshot'->'workflow'->>'version'='1.0.0';
    denied:=false;
    begin perform public.installed_pack_runtime_transition(r,b,cap,'prepare','{"stageKey":"review"}');
    exception when others then denied:=true; end;
    assert denied,'Review cannot bypass earlier stages';
    foreach stage_key in array array['research','strategy','review'] loop
      prepared:=public.installed_pack_runtime_transition(r,b,cap,'prepare',jsonb_build_object('stageKey',stage_key));
      assert prepared->'context'->'taskContract'->'permittedCapabilities'='[]'::jsonb;
      assert jsonb_array_length(prepared->'context'->'inputArtifacts')=case when stage_key='strategy' then 5 else 4 end,'Only scoped input and knowledge are injected';
      output:=prepared->'worker'->'manifest'->'examples'->0->'expectedOutput';
      receipt:=jsonb_build_object('receiptVersion','1.0','packKey',prepared->'worker'->'manifest'->>'packKey','packVersion','1.0.0',
        'workerKey',prepared->'worker'->'manifest'->'worker'->>'workerKey','workerVersion','1.0.0',
        'taskContractId',prepared->'context'->'taskContract'->>'id','inputArtifactIds',prepared->'context'->'taskContract'->'inputArtifactIds',
        'outputValidated',true,'executionMode','simulation.model_router','configuredExecutionMode','model_router','mode','simulation',
        'providerExecuted',false,'qualificationEvaluated',false,'executedCapabilities','[]'::jsonb,'modelRoutingExecuted',true,'mockProvider',true,'providerType','mock',
        'modelRouteKey',prepared->'worker'->'execution'->>'routeKey','providerRequestId','simulation:regression:'||stage_key,
        'totalReportedCostUsd',0,'totalEstimatedCostUsd',0,'stopReason',output->>'stopReason');
      denied:=false;
      begin perform public.installed_pack_runtime_transition(r,b,cap,'persist',jsonb_build_object('stageKey',stage_key,'output',output,'receipt',receipt||'{"providerExecuted":true}'));
      exception when others then denied:=true; end;
      assert denied,'Paid/live execution cannot be mislabeled as simulation';
      denied:=false;
      begin perform public.installed_pack_runtime_transition(r,b,cap,'persist',jsonb_build_object('stageKey',stage_key,'output',output,'receipt',receipt||'{"qualificationEvaluated":true}'));
      exception when others then denied:=true; end;
      assert denied,'Simulation cannot claim live qualification';
      denied:=false;
      begin perform public.installed_pack_runtime_transition(r,b,cap,'persist',jsonb_build_object('stageKey',stage_key,'output',output,'receipt',receipt||'{"stopReason":"continue"}'));
      exception when others then denied:=true; end;
      assert denied,'Worker stop reason is bound to the stage output';
      if stage_key='review' then
        denied:=false;
        begin perform public.installed_pack_runtime_transition(r,b,cap,'persist',jsonb_build_object('stageKey',stage_key,'output',output||'{"publicationAllowed":true}','receipt',receipt));
        exception when others then denied:=true; end;
        assert denied,'Review output cannot authorize publication';
        denied:=false;
        begin perform public.installed_pack_runtime_transition(r,b,cap,'persist',jsonb_build_object('stageKey',stage_key,'output',output,'receipt',receipt||'{"modelRouteKey":"standard.default"}'));
        exception when others then denied:=true; end;
        assert denied,'Reviewer keeps its pinned independent route';
      end if;
      perform public.installed_pack_runtime_transition(r,b,cap,'persist',jsonb_build_object('stageKey',stage_key,'output',output,'receipt',receipt));
      assert public.installed_pack_runtime_transition(r,b,cap,'prepare',jsonb_build_object('stageKey',stage_key))->'completed'='true'::jsonb,'Repeated execution uses durable output';
    end loop;
    denied:=false;
    begin perform public.installed_pack_runtime_transition(r,b,cap,'complete'); exception when insufficient_privilege then denied:=true; end;
    assert denied,'Complete cannot skip the Needs You owner gate';
    denied:=false;
    begin perform public.record_web_research_qualification(r,b,cap); exception when insufficient_privilege then denied:=true; end;
    assert denied,'Simulation cannot enter the live qualification recorder';
    requested:=public.installed_pack_runtime_transition(r,b,cap,'simulation_review_requested');
    assert requested->>'status'='needs_owner';
    assert requested=public.installed_pack_runtime_transition(r,b,cap,'simulation_review_requested'),'Review request is idempotent';
    perform set_config('stage12.test.'||scenario||'.review',requested->>'interventionId',true);
    denied:=false;
    begin perform public.installed_pack_runtime_transition(r,b,cap,'simulation_review_resolved',jsonb_build_object('decision','acknowledge','ownerUserId',current_setting('stage12.test.owner'),'decidedAt',now()));
    exception when insufficient_privilege then denied:=true; end;
    assert denied,'A forged hook payload cannot substitute for persisted owner acknowledgment';
    if scenario='fail' then
      perform public.installed_pack_runtime_transition(r,b,cap,'fail','{"category":"simulation_test_failure","message":"Mock-only failure regression"}');
    end if;
  end loop;
end; $$;
reset role;
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
set local role authenticated;
do $$
declare denied boolean:=false;
begin
  begin perform public.record_etsy_simulation_decision(current_setting('stage12.test.ack.review')::uuid,'acknowledge'); exception when insufficient_privilege then denied:=true; end;
  assert denied,'Only the owning Business user can acknowledge simulation';
end; $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('stage12.test.owner'),true);
set local role authenticated;
do $$
declare scenario text; decision text; result jsonb; duplicate jsonb; denied boolean;
begin
  foreach scenario in array array['ack','stop'] loop
    decision:=case when scenario='ack' then 'acknowledge' else 'stop' end;
    denied:=false;
    begin update public.owner_interventions set resolution='{"decision":"acknowledge"}' where id=current_setting('stage12.test.'||scenario||'.review')::uuid;
    exception when insufficient_privilege then denied:=true; end;
    assert denied,'Direct table updates cannot forge a simulation decision';
    result:=public.record_etsy_simulation_decision(current_setting('stage12.test.'||scenario||'.review')::uuid,decision);
    duplicate:=public.record_etsy_simulation_decision(current_setting('stage12.test.'||scenario||'.review')::uuid,decision);
    assert result=duplicate and result->'shouldResume'='true'::jsonb,'Hook delivery retry reuses exact owner decision';
    denied:=false;
    begin perform public.record_etsy_simulation_decision(current_setting('stage12.test.'||scenario||'.review')::uuid,case when decision='stop' then 'acknowledge' else 'stop' end);
    exception when others then denied:=true; end;
    assert denied,'A recorded decision cannot be flipped by a repeated click';
    perform set_config('stage12.test.'||scenario||'.decision',(result->'decision')::text,true);
  end loop;
end; $$;
reset role;
set local role anon;
do $$
declare b uuid:=current_setting('stage12.test.business')::uuid; scenario text; r uuid; cap text; result jsonb; decision jsonb;
begin
  foreach scenario in array array['ack','stop'] loop
    r:=current_setting('stage12.test.'||scenario)::uuid; cap:=repeat('stage12-regression-'||scenario,3); decision:=current_setting('stage12.test.'||scenario||'.decision')::jsonb;
    result:=public.installed_pack_runtime_transition(r,b,cap,'simulation_review_resolved',decision);
    assert result->>'status'=case when scenario='ack' then 'completed' else 'cancelled' end;
    assert public.installed_pack_runtime_transition(r,b,cap,'simulation_review_resolved',decision)->>'status'=result->>'status','Repeated hook completion is idempotent';
  end loop;
end; $$;
reset role;
set local role authenticated;
do $$
begin
  assert public.record_etsy_simulation_decision(current_setting('stage12.test.ack.review')::uuid,'acknowledge')->'shouldResume'='false'::jsonb,'Closed review does not redeliver its hook';
end; $$;
reset role;
do $$
declare scenario text; r uuid;
begin
  foreach scenario in array array['ack','stop','fail'] loop
    r:=current_setting('stage12.test.'||scenario)::uuid;
    assert (select count(*) from public.worker_runs where workflow_run_id=r and status='completed')=3;
    assert (select count(*) from public.task_contracts where workflow_run_id=r and status='completed')=3;
    assert (select count(*) from public.artifacts where workflow_run_id=r and artifact_type='worker.output')=3;
    assert (select count(*) from public.events where workflow_run_id=r and event_type='worker.completed')=3;
    assert (select count(*) from public.owner_interventions where workflow_run_id=r)=1;
    assert not exists(select 1 from public.owner_interventions where workflow_run_id=r and status='open');
    assert not exists(select 1 from public.action_intents where workflow_run_id=r),'Simulation grants no external action authority';
    assert (select state->'providerExecuted'='false'::jsonb and state->'qualificationEvaluated'='false'::jsonb and state->'publicationAllowed'='false'::jsonb from public.workflow_runs where id=r);
  end loop;
  assert (select status from public.workflow_runs where id=current_setting('stage12.test.fail')::uuid)='failed';
  assert (select status from public.owner_interventions where id=current_setting('stage12.test.stop.review')::uuid)='declined';
  assert (select status from public.owner_interventions where id=current_setting('stage12.test.ack.review')::uuid)='resolved';
  assert (select count(*) from public.packs where id in (select (value->>'id')::uuid from public.workflow_runs r cross join lateral jsonb_array_elements(r.pack_snapshot->'releases') where r.id=current_setting('stage12.test.ack')::uuid) and status='experimental')=9,'Mock persistence and acknowledgment never promote release qualification';
end; $$;
rollback;
