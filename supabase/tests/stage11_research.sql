-- Administrator regression with synthetic provider records; every change rolls back.
begin;
update public.packs set status='experimental',qualification_evidence=qualification_evidence||'{"databaseRegression":"pending"}' where pack_key in ('capability.web-research','knowledge.research-evidence','worker.market-researcher','workflow.web-research');
select set_config('request.jwt.claim.sub',(select owner_user_id::text from public.businesses where name='Stage 9 Live Qualification' limit 1),true);
set local role authenticated;
do $$
declare b uuid; first_run jsonb; duplicate jsonb; denied boolean:=false;
begin
  select id into strict b from public.businesses where name='Stage 9 Live Qualification' and owner_user_id=auth.uid();
  begin perform public.activate_business_pack(b,(select id from public.packs where pack_key='workflow.web-research' and version='1.0.0'));
  exception when others then denied:=true; end;
  assert denied,'Experimental research cannot be activated normally';
  first_run:=public.begin_web_research_qualification(b,'stage11:regression',gen_random_uuid(),repeat('research-regression-',3));
  duplicate:=public.begin_web_research_qualification(b,'stage11:regression',gen_random_uuid(),repeat('unused-capability-',3));
  assert (first_run->>'shouldStart')::boolean and not (duplicate->>'shouldStart')::boolean and first_run->>'workflowRunId'=duplicate->>'workflowRunId';
  assert (select pack_snapshot->>'platformQualification' from public.workflow_runs where id=(first_run->>'workflowRunId')::uuid)='stage11';
  assert (select input->'sourceDomains' from public.workflow_runs where id=(first_run->>'workflowRunId')::uuid)='["etsy.com"]';
  denied:=false;
  begin perform public.begin_web_research_qualification(gen_random_uuid(),'stage11:foreign',gen_random_uuid(),repeat('foreign-capability-',3));
  exception when insufficient_privilege then denied:=true; end;
  assert denied,'Foreign Business qualification denied';
  perform set_config('stage11.test.run',first_run->>'workflowRunId',true);perform set_config('stage11.test.business',b::text,true);
end; $$;
reset role;
set local role anon;
do $$
declare r uuid:=current_setting('stage11.test.run')::uuid; b uuid:=current_setting('stage11.test.business')::uuid; cap text:=repeat('research-regression-',3);
  prepared jsonb; collection jsonb; source jsonb; evidence jsonb; receipt jsonb; output jsonb; stored jsonb; v_excerpt text:='Observe customer interests and test a bounded product hypothesis before expanding production.';
  v_url text:='https://www.etsy.com/seller-handbook'; v_hash text; v_source_id text; denied boolean:=false;
begin
  perform public.installed_pack_runtime_transition(r,b,cap,'load','{"runtimeRunId":"wrun_research_regression"}');
  prepared:=public.installed_pack_runtime_transition(r,b,cap,'prepare','{"stageKey":"research"}');
  assert jsonb_array_length(prepared->'context'->'inputArtifacts')=2;
  -- IDs match the deterministic TypeScript source/excerpt hashing convention.
  v_hash:=encode(extensions.digest(convert_to(v_excerpt,'UTF8'),'sha256'),'hex');
  v_source_id:='src-'||substr(encode(extensions.digest(convert_to(v_url||':'||v_hash,'UTF8'),'sha256'),'hex'),1,24);
  source:=jsonb_build_object('id',v_source_id,'url',v_url,'title','Synthetic source fixture','retrievedAt',now(),'publishedAt',null,'retrievalExpiresAt',now()+interval '1 day','contentHash',v_hash,'excerpt',v_excerpt,'provider','mock');
  evidence:=jsonb_build_object('id','evi-'||substr(encode(extensions.digest(convert_to(v_source_id||':'||v_excerpt,'UTF8'),'sha256'),'hex'),1,24),'sourceId',v_source_id,'quote',v_excerpt);
  collection:=jsonb_build_object('collectionVersion','1.0','query','What guidance does Etsy provide for researching products before launching a listing?','sources',jsonb_build_array(source),'evidence',jsonb_build_array(evidence),
    'providerMetadata',jsonb_build_object('fixture',true,'searchRequests',1,'providerRequestId','regression-fixture'));
  begin perform public.append_pack_research_sources(r,b,repeat('wrong-capability-',3),'research',collection); exception when insufficient_privilege then denied:=true; end;
  assert denied,'Incorrect source-write capability denied';denied:=false;
  begin perform public.append_pack_research_sources(r,b,cap,'research',jsonb_set(collection,'{sources,0,url}','"https://example.com/outside-scope"')); exception when others then denied:=true; end;
  assert denied,'Out-of-scope source denied';
  stored:=public.append_pack_research_sources(r,b,cap,'research',collection);
  assert not (stored->>'cached')::boolean;
  assert (public.append_pack_research_sources(r,b,cap,'research',collection)->>'cached')::boolean,'Duplicate source storage is cached';
  prepared:=public.installed_pack_runtime_transition(r,b,cap,'prepare','{"stageKey":"research"}');
  assert jsonb_array_length(prepared->'context'->'inputArtifacts')=3,'Source artifact is explicitly referenced';
  receipt:=jsonb_build_object('receiptVersion','1.0','packKey','worker.market-researcher','packVersion','1.0.0','workerKey','market.researcher','workerVersion','1.0.0',
    'taskContractId',prepared->'context'->'taskContract'->>'id','inputArtifactIds',prepared->'context'->'taskContract'->'inputArtifactIds','outputValidated',true,
    'executionMode','web.research','stopReason','evidence_collected','modelRouteKey','standard.default','providerRequestId','mock-researcher-result');
  output:=jsonb_build_object('decision','complete','stopReason','evidence_collected','evidencePack',jsonb_build_object('evidencePackVersion','1.0','question',collection->>'query','sources',collection->'sources','evidence',collection->'evidence',
    'claims',jsonb_build_array(jsonb_build_object('text',v_excerpt,'evidenceId',evidence->>'id','sourceId',v_source_id)),'limitations',jsonb_build_array('publication_dates_unknown')));
  denied:=false;
  begin
    perform public.installed_pack_runtime_transition(r,b,cap,'persist',jsonb_build_object('stageKey','research','output',jsonb_set(output,'{evidencePack,claims,0,text}','"Unsupported sales forecast"'),'receipt',receipt));
    perform public.record_web_research_qualification(r,b,cap);
  exception when others then denied:=true; end;
  assert denied,'Unsupported claims prevent qualification';
  perform public.installed_pack_runtime_transition(r,b,cap,'persist',jsonb_build_object('stageKey','research','output',output,'receipt',receipt));
  denied:=false;
  begin perform public.record_web_research_qualification(r,b,cap); exception when others then denied:=true; end;
  assert denied,'Pending database evaluations block promotion';
  perform set_config('stage11.test.artifact',stored->>'artifactId',true);
end; $$;
reset role;
set local role authenticated;
do $$
declare denied boolean:=false;
begin
  begin update public.artifacts set content='{}' where id=current_setting('stage11.test.artifact')::uuid; exception when others then denied:=true; end;
  assert denied,'Source provenance cannot be rewritten';
end; $$;
reset role;
-- Only this rolled-back administrator fixture enables the synthetic promotion test.
update public.packs set qualification_evidence=qualification_evidence||'{"databaseRegression":"passed"}' where pack_key in ('capability.web-research','knowledge.research-evidence','worker.market-researcher','workflow.web-research');
set local role anon;
do $$
declare result jsonb;
begin
  result:=public.record_web_research_qualification(current_setting('stage11.test.run')::uuid,current_setting('stage11.test.business')::uuid,repeat('research-regression-',3));
  assert result->>'status'='qualified';
end; $$;
reset role;
do $$
begin
  assert (select count(*) from public.packs where pack_key in ('capability.web-research','knowledge.research-evidence','worker.market-researcher','workflow.web-research') and status='qualified')=4;
  assert (select status from public.workflow_runs where id=current_setting('stage11.test.run')::uuid)='completed';
  assert (select count(*) from public.worker_runs where workflow_run_id=current_setting('stage11.test.run')::uuid and status in ('queued','running'))=0;
end; $$;
rollback;
