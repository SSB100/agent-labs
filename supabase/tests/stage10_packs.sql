-- Administrator regression; all fixtures and qualification changes roll back.
begin;
do $$
declare v_pack record; blocked boolean:=false;
begin
  assert (select count(*) from public.packs where manifest->>'frameworkVersion'='1.0')=6;
  assert (select count(*) from public.worker_definitions w join public.packs p on p.id=w.pack_id where p.manifest->>'frameworkVersion'='1.0')=2;
  assert (select count(*) from public.workflow_definitions w join public.packs p on p.id=w.pack_id where p.manifest->>'frameworkVersion'='1.0')=2;
  assert (select count(*) from public.pack_knowledge_definitions)=1;
  assert (select count(*) from public.pack_capability_definitions)=1;
  begin
    perform private.stage10_qualify_pack((select id from public.packs where pack_key='workflow.synthetic-summary' and version='1.0.0'),'{"source":"regression","checks":{"manifest":"passed"}}');
  exception when others then blocked:=true; end;
  assert blocked,'Incomplete qualification must fail';
  for v_pack in select id from public.packs where manifest->>'frameworkVersion'='1.0' loop
    perform private.stage10_qualify_pack(v_pack.id,'{"source":"rolled-back-regression","checks":{"manifest":"passed","dependencies":"passed","scope":"passed","version-pinning":"passed","worker-output":"passed"}}');
  end loop;
end; $$;
select set_config('request.jwt.claim.sub',(select owner_user_id::text from public.businesses where name='Stage 9 Live Qualification' limit 1),true);
set local role authenticated;
do $$
declare b uuid; p1 uuid; p2 uuid; i1 uuid; i2 uuid; run1 jsonb; run2 jsonb; duplicate jsonb; denied boolean:=false;
begin
  select id into strict b from public.businesses where name='Stage 9 Live Qualification' and owner_user_id=auth.uid();
  select id into strict p1 from public.packs where pack_key='workflow.synthetic-summary' and version='1.0.0';
  select id into strict p2 from public.packs where pack_key='workflow.synthetic-summary' and version='2.0.0';
  i1:=public.activate_business_pack(b,p1);
  assert public.activate_business_pack(b,p1)=i1,'Activation must be idempotent';
  run1:=public.begin_installed_pack_run(b,i1,'synthetic.installed-summary','{"message":"Old pinned run"}','stage10:regression:v1',gen_random_uuid(),repeat('stage10-regression-',3));
  duplicate:=public.begin_installed_pack_run(b,i1,'synthetic.installed-summary','{"message":"Old pinned run"}','stage10:regression:v1',gen_random_uuid(),repeat('new-unused-capability-',3));
  assert (run1->>'shouldStart')::boolean and not (duplicate->>'shouldStart')::boolean and run1->>'workflowRunId'=duplicate->>'workflowRunId';
  i2:=public.activate_business_pack(b,p2);
  run2:=public.begin_installed_pack_run(b,i2,'synthetic.installed-summary','{"message":"New pinned run"}','stage10:regression:v2',gen_random_uuid(),repeat('stage10-new-version-',3));
  assert (select count(*) from public.installed_packs where business_id=b and root_pack_key='workflow.synthetic-summary' and status='active')=1;
  assert (select pack_snapshot->'workflow'->>'version' from public.workflow_runs where id=(run1->>'workflowRunId')::uuid)='1.0.0';
  assert (select pack_snapshot->'workflow'->>'version' from public.workflow_runs where id=(run2->>'workflowRunId')::uuid)='2.0.0';
  assert (select count(*) from public.workflow_stage_runs where workflow_run_id=(run1->>'workflowRunId')::uuid)=1;
  begin perform public.activate_business_pack(gen_random_uuid(),p1); exception when insufficient_privilege then denied:=true; end;
  assert denied,'Foreign Business activation denied'; denied:=false;
  begin update public.workflow_runs set pack_snapshot=jsonb_set(pack_snapshot,'{workflow,version}','"2.0.0"') where id=(run1->>'workflowRunId')::uuid;
  exception when others then denied:=true; end;
  assert denied,'Run pins cannot be rewritten'; denied:=false;
  begin perform private.stage10_qualify_pack(p1,'{}'); exception when insufficient_privilege then denied:=true; end;
  assert denied,'Owners cannot qualify packs';
  perform set_config('stage10.test.run',run1->>'workflowRunId',true);
  perform set_config('stage10.test.business',b::text,true);
end; $$;
reset role;
set local role anon;
do $$
declare r uuid:=current_setting('stage10.test.run')::uuid; b uuid:=current_setting('stage10.test.business')::uuid;
  cap text:=repeat('stage10-regression-',3); prepared jsonb; loaded jsonb; persisted jsonb; completed jsonb; receipt jsonb; denied boolean:=false;
begin
  begin perform public.installed_pack_runtime_transition(r,b,repeat('wrong-capability-',3),'load','{"runtimeRunId":"wrun_regression"}');
  exception when insufficient_privilege then denied:=true; end;
  assert denied,'Wrong runtime capability denied';
  loaded:=public.installed_pack_runtime_transition(r,b,cap,'load','{"runtimeRunId":"wrun_regression"}');
  assert loaded->'snapshot'->'workflow'->>'version'='1.0.0','Upgrade must not alter runtime pins';
  prepared:=public.installed_pack_runtime_transition(r,b,cap,'prepare','{"stageKey":"summary"}');
  assert prepared->'worker'->'manifest'->>'version'='1.0.0';
  assert jsonb_array_length(prepared->'context'->'inputArtifacts')=2,'Only scoped input and required knowledge';
  receipt:=jsonb_build_object('receiptVersion','1.0','packKey','worker.synthetic-summary','packVersion','1.0.0','workerKey','synthetic.summary','workerVersion','1.0.0',
    'taskContractId',prepared->'context'->'taskContract'->>'id','inputArtifactIds',prepared->'context'->'taskContract'->'inputArtifactIds','outputValidated',true,'executionMode','structured.mapping','stopReason','objective_complete');
  denied:=false;
  begin perform public.installed_pack_runtime_transition(r,b,cap,'persist',jsonb_build_object('stageKey','summary','output','{}'::jsonb,'receipt',receipt||'{"workerVersion":"2.0.0"}'));
  exception when others then denied:=true; end;
  assert denied,'Worker receipt version must match the snapshot';
  persisted:=public.installed_pack_runtime_transition(r,b,cap,'persist',jsonb_build_object('stageKey','summary','output',jsonb_build_object('decision','complete','summary','Old pinned run','guidance','Use only the supplied message. Stop once the summary is complete.','releaseVersion','1.0.0','stopReason','objective_complete'),'receipt',receipt));
  assert (persisted->>'completed')::boolean;
  assert (public.installed_pack_runtime_transition(r,b,cap,'prepare','{"stageKey":"summary"}')->>'completed')::boolean,'Retry reuses saved output';
  completed:=public.installed_pack_runtime_transition(r,b,cap,'complete');
  assert completed->>'status'='completed' and completed->'output'->>'releaseVersion'='1.0.0';
end; $$;
reset role;
rollback;

