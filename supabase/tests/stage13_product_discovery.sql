-- Administrator-only structural regression. Synthetic source/receipt records below are
-- TEST FIXTURES, not live qualification evidence. No provider calls; every write rolls back.
begin;
select set_config('stage13.owner',gen_random_uuid()::text,true);
select set_config('stage13.other',gen_random_uuid()::text,true);
select set_config('stage13.business',gen_random_uuid()::text,true);
select set_config('stage13.foreign',gen_random_uuid()::text,true);
insert into auth.users(id,email) values(current_setting('stage13.owner')::uuid,'stage13-owner@example.invalid'),(current_setting('stage13.other')::uuid,'stage13-other@example.invalid');
insert into public.businesses(id,owner_user_id,name) values
  (current_setting('stage13.business')::uuid,current_setting('stage13.owner')::uuid,'Stage 13 rollback regression'),
  (current_setting('stage13.foreign')::uuid,current_setting('stage13.other')::uuid,'Stage 13 foreign regression');
-- Synthetic platform fixture, never committed or presented as live qualification.
update public.packs set status='qualified' where pack_key in ('capability.web-research','knowledge.research-evidence','worker.market-researcher','workflow.web-research') and version='1.0.0';
update public.workflow_definitions set status='qualified' where workflow_key='research.public-evidence' and version='1.0.0';
update public.worker_definitions set status='qualified' where worker_key='market.researcher' and version='1.0.0';

create function pg_temp.stage13_fixture(p_run uuid,p_business uuid,p_cap text,p_new_content boolean default false,p_new_url boolean default false,p_fault text default '')
returns uuid language plpgsql security definer set search_path='' as $$
declare prepared jsonb; r public.workflow_runs%rowtype; collection jsonb; output jsonb; receipt jsonb;
  sources jsonb:='[]'; evidence jsonb:='[]'; claims jsonb:='[]'; v_excerpt text; v_url text; v_hash text; v_sid text; v_eid text; v_kind text;
begin
  select * into strict r from public.workflow_runs where id=p_run and business_id=p_business;
  perform public.installed_pack_runtime_transition(p_run,p_business,p_cap,'load',jsonb_build_object('runtimeRunId','stage13-regression-'||p_run));
  prepared:=public.installed_pack_runtime_transition(p_run,p_business,p_cap,'prepare','{"stageKey":"research"}');
  foreach v_kind in array array['market','operations','policy'] loop
    v_excerpt:=case v_kind when 'market' then 'Synthetic regression observation: thirty outdoor shoppers viewed the original trail graphic during a seven day test; five expressed qualified interest.'
      when 'operations' then 'Synthetic regression production fact: one standard print area on a cotton T-shirt; production and shipping cost is twelve dollars and the proposed price is twenty-four.'
      else 'Synthetic regression policy fact: sellers must own their original designs and screen concept-specific intellectual property rights before publishing.' end;
    if p_new_content then v_excerpt:=v_excerpt||' Newly observed content for reconsideration.'; end if;
    v_url:='https://www.etsy.com/'||case v_kind when 'market' then 'listing/123' when 'operations' then 'manufacturing/spec' else 'legal/sellers' end||case when p_new_url then '/changed-url' else '' end;
    v_hash:=private.stage13_hash(v_excerpt); v_sid:='src-'||left(private.stage13_hash(v_url||':'||v_hash),24);
    v_eid:='evi-'||left(private.stage13_hash(v_sid||':'||v_excerpt),24);
    sources:=sources||jsonb_build_array(jsonb_build_object('id',v_sid,'url',v_url,'title','Synthetic rollback fixture','retrievedAt',now(),'publishedAt',null,
      'retrievalExpiresAt',case when p_fault='stale' then now()-interval '1 hour' else now()+interval '1 day' end,'contentHash',v_hash,'excerpt',v_excerpt,'provider','openrouter.exa'));
    evidence:=evidence||jsonb_build_array(jsonb_build_object('id',v_eid,'sourceId',v_sid,'quote',v_excerpt));
    claims:=claims||jsonb_build_array(jsonb_build_object('text',v_excerpt,'evidenceId',v_eid,'sourceId',v_sid));
  end loop;
  collection:=jsonb_build_object('collectionVersion','1.0','query',r.input->>'question','sources',sources,'evidence',evidence,
    'providerMetadata',jsonb_build_object('searchRequests',1,'providerRequestId','stage13-test-search'));
  if p_fault='hash' then collection:=jsonb_set(collection,'{sources,0,contentHash}',to_jsonb(repeat('0',64))); end if;
  perform public.append_pack_research_sources(p_run,p_business,p_cap,'research',collection);
  prepared:=public.installed_pack_runtime_transition(p_run,p_business,p_cap,'prepare','{"stageKey":"research"}');
  receipt:=jsonb_build_object('receiptVersion','1.0','packKey','worker.market-researcher','packVersion','1.0.0','workerKey','market.researcher','workerVersion','1.0.0',
    'taskContractId',prepared->'context'->'taskContract'->>'id','inputArtifactIds',prepared->'context'->'taskContract'->'inputArtifactIds',
    'outputValidated',true,'executionMode','web.research','stopReason','evidence_collected','modelRouteKey','standard.default','providerRequestId','stage13-test-model');
  output:=jsonb_build_object('decision','complete','stopReason','evidence_collected','evidencePack',jsonb_build_object('evidencePackVersion','1.0','question',r.input->>'question',
    'sources',sources,'evidence',evidence,'claims',claims,'limitations',jsonb_build_array('publication_dates_unknown')));
  if p_fault='citation' then output:=jsonb_set(output,'{evidencePack,claims,0,text}','"Forged market conclusion"'); end if;
  if p_fault='receipt' then receipt:=jsonb_set(receipt,'{executionMode}','"simulation.model_router"'); end if;
  if p_fault='source-id' then output:=jsonb_set(output,'{evidencePack,sources,0,id}','"src-forged"'); end if;
  perform public.installed_pack_runtime_transition(p_run,p_business,p_cap,'persist',jsonb_build_object('stageKey','research','output',output,'receipt',receipt));
  return private.stage4_deterministic_uuid('pack:output:'||p_run||':research');
end; $$;

select set_config('request.jwt.claim.sub',current_setting('stage13.owner'),true);
set local role authenticated;
do $$
declare c jsonb; duplicate jsonb; launch jsonb; replay jsonb; denied boolean; payload jsonb;
begin
  payload:='{"concept":"Trail-Sun Tees","audience":"Weekend hikers","hypothesis":"Original trail artwork may attract qualified interest from weekend hikers.","originalDesign":true,"rightsStatus":"confirmed","sourceDomains":["etsy.com"]}';
  c:=public.create_product_candidate(current_setting('stage13.business')::uuid,payload);
  duplicate:=public.create_product_candidate(current_setting('stage13.business')::uuid,payload||'{"concept":" trail sun   tees ","hypothesis":"Changed hypothesis must not overwrite the initial logical candidate.","rightsStatus":"unclear"}');
  assert c->>'candidateId'=duplicate->>'candidateId' and duplicate->'cached'='true','Normalized concept/audience duplicates reuse one candidate';
  assert (select hypothesis=payload->>'hypothesis' and rights_status='confirmed' from public.product_candidates where id=(c->>'candidateId')::uuid),'Duplicate never rewrites rights or hypothesis';
  denied:=false; begin perform public.create_product_candidate(current_setting('stage13.foreign')::uuid,payload); exception when insufficient_privilege then denied:=true; end;
  assert denied,'Foreign owner candidate denied';
  denied:=false; begin perform public.create_product_candidate(current_setting('stage13.business')::uuid,payload||'{"extra":true}'); exception when others then denied:=true; end;
  assert denied,'Unknown candidate fields denied';
  denied:=false; begin perform public.create_product_candidate(current_setting('stage13.business')::uuid,payload||'{"sourceDomains":["127.0.0.1"]}'); exception when others then denied:=true; end;
  assert denied,'Private/IP source domains denied';
  denied:=false; begin perform public.create_product_candidate(current_setting('stage13.business')::uuid,payload||'{"originalDesign":"true"}'); exception when others then denied:=true; end;
  assert denied,'Originality must be boolean';
  perform set_config('stage13.candidate',c->>'candidateId',true);
  perform set_config('stage13.nonce',gen_random_uuid()::text,true);
  launch:=public.begin_product_discovery((c->>'candidateId')::uuid,current_setting('stage13.nonce')::uuid,repeat('stage13-capability-',3));
  replay:=public.begin_product_discovery((c->>'candidateId')::uuid,gen_random_uuid(),repeat('replacement-capability-',3));
  assert launch->'shouldStart'='true' and replay->'shouldStart'='false' and launch->>'workflowRunId'=replay->>'workflowRunId' and launch->>'experimentId'=replay->>'experimentId';
  assert (select creative is null and price is null and channel='research_only' and status='reserved' and evidence_pack is null and source_artifact_id is null from public.product_experiments where id=(launch->>'experimentId')::uuid);
  perform set_config('stage13.run',launch->>'workflowRunId',true); perform set_config('stage13.experiment',launch->>'experimentId',true);
  denied:=false; begin update public.product_candidates set rights_status='unclear' where id=(c->>'candidateId')::uuid; exception when insufficient_privilege then denied:=true; end;
  assert denied,'Owner cannot directly rewrite candidate history';
  denied:=false; begin delete from public.product_experiments where id=(launch->>'experimentId')::uuid; exception when insufficient_privilege then denied:=true; end;
  assert denied,'Owner cannot delete experiments';
  denied:=false; begin update public.workflow_runs set status='completed' where id=(launch->>'workflowRunId')::uuid; exception when insufficient_privilege then denied:=true; end;
  assert denied,'Owner cannot forge completed research';
end; $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('stage13.other'),true);
set local role authenticated;
do $$
declare denied boolean:=false;
begin
  assert (select count(*) from public.product_candidates where business_id=current_setting('stage13.business')::uuid)=0;
  assert (select count(*) from public.product_experiments where business_id=current_setting('stage13.business')::uuid)=0;
  begin perform public.begin_product_discovery(current_setting('stage13.candidate')::uuid,gen_random_uuid(),repeat('foreign-capability-',3)); exception when insufficient_privilege then denied:=true; end;
  assert denied,'Foreign candidate launch denied'; denied:=false;
  begin perform public.finalize_product_discovery(current_setting('stage13.experiment')::uuid); exception when insufficient_privilege then denied:=true; end;
  assert denied,'Foreign reconciliation denied';
end; $$;
reset role;
set local role anon;
do $$
declare denied boolean; fault text; r uuid:=current_setting('stage13.run')::uuid; b uuid:=current_setting('stage13.business')::uuid;
  cap text:=repeat('stage13-capability-',3); done jsonb; replay jsonb;
begin
  denied:=false; begin perform public.product_discovery_runtime(r,b,repeat('replacement-capability-',3),'finalize'); exception when insufficient_privilege then denied:=true; end;
  assert denied,'Duplicate launch cannot replace the runtime capability';
  denied:=false; begin perform public.product_discovery_runtime(r,current_setting('stage13.foreign')::uuid,cap,'finalize'); exception when insufficient_privilege then denied:=true; end;
  assert denied,'Capability cannot cross businesses';
  denied:=false; begin perform public.product_discovery_runtime(r,b,cap,'finalize'); exception when others then denied:=true; end;
  assert denied,'Incomplete worker stages cannot finalize';
  foreach fault in array array['stale','hash','citation','receipt','source-id'] loop
    denied:=false;
    begin
      perform pg_temp.stage13_fixture(r,b,cap,false,false,fault);
      perform public.product_discovery_runtime(r,b,cap,'finalize');
    exception when others then denied:=true; end;
    assert denied,'Invalid source/receipt/evidence rejected: '||fault;
  end loop;
  perform pg_temp.stage13_fixture(r,b,cap);
  done:=public.product_discovery_runtime(r,b,cap,'finalize');
  replay:=public.product_discovery_runtime(r,b,cap,'finalize');
  assert done->>'status'='completed' and done->'cached'='false' and replay->'cached'='true' and done->>'decisionId'=replay->>'decisionId';
  assert public.product_discovery_runtime(r,b,cap,'fail')->>'status'='completed','Late failure cannot overwrite completion';
end; $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('stage13.owner'),true);
set local role authenticated;
do $$
declare e public.product_experiments%rowtype; d public.product_decisions%rowtype; dimensions jsonb; assessment jsonb; replay jsonb; denied boolean; policy_eid text;
begin
  select * into strict e from public.product_experiments where id=current_setting('stage13.experiment')::uuid;
  select * into strict d from public.product_decisions where experiment_id=e.id;
  assert e.status='completed' and e.evidence_pack is not null and e.source_artifact_id is not null;
  assert d.assessment->>'assessmentOrigin'='deterministic_provisional' and d.assessment->>'outcome'='NEEDS_MORE_EVIDENCE' and d.assessment->'totalScore'='null';
  assert jsonb_array_length(d.assessment->'missingEvidence')=9 and not exists(select 1 from jsonb_array_elements(d.assessment->'dimensions') x where x->'score'<>'null');
  assert d.assessment->'review'='{"status":"contract_checked","liveQualified":false,"creativeProductionAllowed":false,"publicationAllowed":false}';
  assert public.finalize_product_discovery(e.id)->'cached'='true','Owner reconciliation is idempotent';
  -- Classifications here are owner assertions, not verified causal market facts.
  select jsonb_agg(x||jsonb_build_object('score',4,'rationale','Owner-scored synthetic regression evidence only',
    'evidenceKind',case when x->>'dimension'='policy_ip_risk' then 'policy' when x->>'dimension' in ('estimated_margin','production_complexity') then 'operational_fact' else 'market_observation' end,
    'evidenceIds',jsonb_build_array(e.evidence_pack->'evidence'->case when x->>'dimension'='policy_ip_risk' then 2 when x->>'dimension' in ('estimated_margin','production_complexity') then 1 else 0 end->>'id')))
    into dimensions from jsonb_array_elements(d.assessment->'dimensions') x;
  assessment:=public.record_product_assessment(e.id,dimensions);
  assert assessment->'assessment'->>'outcome'='TEST' and assessment->'assessment'->>'totalScore'='80';
  assert assessment->'assessment'->'review'->'creativeProductionAllowed'='false' and assessment->'assessment'->'review'->'publicationAllowed'='false';
  replay:=public.record_product_assessment(e.id,dimensions);
  assert replay->'cached'='true' and replay->>'decisionId'=assessment->>'decisionId','Assessment replay appends once';
  assessment:=public.record_product_assessment(e.id,jsonb_set(dimensions,'{7,score}','0'));
  assert assessment->'assessment'->>'outcome'='REJECT','Known zero policy gate rejects';
  assessment:=public.record_product_assessment(e.id,jsonb_set(dimensions,'{6,score}','0'));
  assert assessment->'assessment'->>'outcome'='REJECT','Known zero production gate rejects';
  assessment:=public.record_product_assessment(e.id,jsonb_set(dimensions,'{0,score}','2'));
  assert assessment->'assessment'->>'outcome'='NEEDS_MORE_EVIDENCE','Demand gate applies independently of weighted total';
  assessment:=public.record_product_assessment(e.id,jsonb_set(jsonb_set(dimensions,'{0,score}','null'),'{0,evidenceKind}','"unassessed"'));
  assert assessment->'assessment'->'totalScore'='null' and jsonb_array_length(assessment->'assessment'->'missingEvidence')=1,'Unknown score remains null';
  denied:=false; begin perform public.record_product_assessment(e.id,jsonb_set(dimensions,'{0,evidenceIds}','["evi-foreign"]')); exception when others then denied:=true; end;
  assert denied,'Foreign or invented assessment citations denied';
  denied:=false; begin perform public.record_product_assessment(e.id,jsonb_set(dimensions,'{0,score}','2.5')); exception when others then denied:=true; end;
  assert denied,'Fractional score denied';
  -- Explicit eight-element case (JSON array subtraction is index based).
  denied:=false; begin perform public.record_product_assessment(e.id,dimensions-8); exception when others then denied:=true; end;
  assert denied,'Missing dimension denied';
  policy_eid:=e.evidence_pack->'evidence'->2->>'id';
  denied:=false; begin perform public.record_product_assessment(e.id,jsonb_set(dimensions,'{0,evidenceIds}',jsonb_build_array(policy_eid))); exception when others then denied:=true; end;
  assert denied,'Policy page cannot be disguised as positive demand observation';
  denied:=false; begin update public.artifacts set content='{}' where id=e.source_artifact_id; exception when others then denied:=true; end;
  assert denied,'Persisted worker evidence cannot be tampered';
  denied:=false; begin delete from public.product_decisions where id=d.id; exception when insufficient_privilege then denied:=true; end;
  assert denied,'Decisions append instead of replacing history';
  perform set_config('stage13.dimensions',dimensions::text,true);
end; $$;
reset role;

-- Terminal failures never trigger a second paid/provider loop. Launch failure is nonce-scoped.
select set_config('request.jwt.claim.sub',current_setting('stage13.owner'),true);
set local role authenticated;
do $$
declare c jsonb; l jsonb; denied boolean; scenario text; payload jsonb;
begin
  foreach scenario in array array['failure','launch','nonoriginal','unclear'] loop
    payload:=jsonb_build_object('concept','Trail scenario '||scenario,'audience','Weekend hikers','hypothesis','A bounded original trail concept may attract qualified buyer interest.',
      'originalDesign',scenario<>'nonoriginal','rightsStatus',case when scenario='unclear' then 'unclear' else 'confirmed' end,'sourceDomains',jsonb_build_array('etsy.com'));
    c:=public.create_product_candidate(current_setting('stage13.business')::uuid,payload);
    l:=public.begin_product_discovery((c->>'candidateId')::uuid,current_setting('stage13.nonce')::uuid,repeat('stage13-extra-cap-',3));
    perform set_config('stage13.'||scenario||'_candidate',c->>'candidateId',true);
    perform set_config('stage13.'||scenario||'_experiment',l->>'experimentId',true);
    perform set_config('stage13.'||scenario||'_run',l->>'workflowRunId',true);
  end loop;
  denied:=false; begin perform public.fail_product_discovery_launch(current_setting('stage13.launch_experiment')::uuid,gen_random_uuid()); exception when insufficient_privilege then denied:=true; end;
  assert denied,'Launch failure must match original nonce';
  assert public.fail_product_discovery_launch(current_setting('stage13.launch_experiment')::uuid,current_setting('stage13.nonce')::uuid)->'cached'='false';
  assert public.fail_product_discovery_launch(current_setting('stage13.launch_experiment')::uuid,current_setting('stage13.nonce')::uuid)->'cached'='true';
  l:=public.begin_product_discovery(current_setting('stage13.launch_candidate')::uuid,gen_random_uuid(),repeat('replacement-capability-',3));
  assert l->'shouldStart'='false' and l->>'workflowRunId'=current_setting('stage13.launch_run'),'Failed launch is terminal and reused';
end; $$;
reset role;
set local role anon;
do $$
declare b uuid:=current_setting('stage13.business')::uuid; cap text:=repeat('stage13-extra-cap-',3); scenario text; r uuid;
begin
  r:=current_setting('stage13.failure_run')::uuid;
  perform public.installed_pack_runtime_transition(r,b,cap,'fail','{"message":"Synthetic no-sources failure"}');
  assert public.product_discovery_runtime(r,b,cap,'fail')->'cached'='true','Legacy explicit failure projection remains idempotent after atomic persistence';
  assert public.product_discovery_runtime(r,b,cap,'fail')->'cached'='true';
  foreach scenario in array array['nonoriginal','unclear'] loop
    r:=current_setting('stage13.'||scenario||'_run')::uuid;
    perform pg_temp.stage13_fixture(r,b,cap);
    perform public.product_discovery_runtime(r,b,cap,'finalize');
  end loop;
end; $$;
reset role;
set local role authenticated;
do $$
declare l jsonb; d jsonb;
begin
  l:=public.begin_product_discovery(current_setting('stage13.failure_candidate')::uuid,gen_random_uuid(),repeat('replacement-capability-',3));
  assert l->'shouldStart'='false' and l->>'workflowRunId'=current_setting('stage13.failure_run'),'Failed research is terminal and reused';
  assert (select failure='Synthetic no-sources failure' from public.product_experiments where id=current_setting('stage13.failure_experiment')::uuid),'Failure is copied from persisted workflow';
  select assessment into strict d from public.product_decisions where experiment_id=current_setting('stage13.nonoriginal_experiment')::uuid;
  assert d->>'outcome'='REJECT' and d->'totalScore'='null','Non-original concept rejects without invented scores';
  select assessment into strict d from public.product_decisions where experiment_id=current_setting('stage13.unclear_experiment')::uuid;
  assert d->>'outcome'='NEEDS_MORE_EVIDENCE' and jsonb_array_length(d->'missingEvidence')=10,'Unclear rights adds exact clearance gap';
  l:=public.record_product_assessment(current_setting('stage13.unclear_experiment')::uuid,current_setting('stage13.dimensions')::jsonb,true);
  assert l->'assessment'->>'outcome'='TEST' and l->'assessment'->'ownerRightsConfirmed'='true','Explicit owner declaration can resolve rights in a new assessment';
  assert (select rights_status='unclear' from public.product_candidates where id=current_setting('stage13.unclear_candidate')::uuid),'Initial rights declaration stays immutable';
  assert (select count(*) from public.product_decisions where experiment_id=current_setting('stage13.unclear_experiment')::uuid)=2,'Both original and owner-updated decision retained';
  l:=public.record_product_assessment(current_setting('stage13.unclear_experiment')::uuid,current_setting('stage13.dimensions')::jsonb,true);
  assert l->'cached'='true','Repeated rights confirmation reuses decision';
end; $$;
reset role;

-- Offline reconsideration uses existing completed paid research; this API itself launches nothing.
set local role authenticated;
do $$
declare initial public.workflow_runs%rowtype; l jsonb; scenario text;
begin
  select * into strict initial from public.workflow_runs where id=current_setting('stage13.run')::uuid;
  foreach scenario in array array['samecontent','newcontent','reconcile','unrelated'] loop
    l:=public.begin_installed_pack_run(initial.business_id,initial.pack_installation_id,'research.public-evidence',
      case when scenario='unrelated' then jsonb_set(initial.input,'{question}','"An unrelated public research question"') else initial.input end,
      'stage13:offline:'||scenario,gen_random_uuid(),repeat('stage13-offline-cap-',3));
    perform set_config('stage13.'||scenario||'_run',l->>'workflowRunId',true);
  end loop;
end; $$;
reset role;
-- Test harness only: simulate validated stored worker outputs using current source hashes.
do $$
declare scenario text; r uuid; a uuid; b uuid:=current_setting('stage13.business')::uuid; cap text:=repeat('stage13-offline-cap-',3);
begin
  foreach scenario in array array['samecontent','newcontent','unrelated'] loop
    r:=current_setting('stage13.'||scenario||'_run')::uuid;
    a:=pg_temp.stage13_fixture(r,b,cap,scenario<>'samecontent',true);
    perform public.installed_pack_runtime_transition(r,b,cap,'complete','{}');
    perform set_config('stage13.'||scenario||'_artifact',a::text,true);
  end loop;
end; $$;
set local role authenticated;
do $$
declare result jsonb; replay jsonb; denied boolean; initial_count integer; workflow_count integer;
begin
  select count(*) into initial_count from public.product_experiments where candidate_id=current_setting('stage13.candidate')::uuid;
  select count(*) into workflow_count from public.workflow_runs where business_id=current_setting('stage13.business')::uuid;
  denied:=false; begin perform public.reconsider_product_candidate(current_setting('stage13.candidate')::uuid,
    (select source_artifact_id from public.product_experiments where id=current_setting('stage13.experiment')::uuid)); exception when others then denied:=true; end;
  assert denied,'Original artifact cannot masquerade as new evidence';
  denied:=false; begin perform public.reconsider_product_candidate(current_setting('stage13.candidate')::uuid,current_setting('stage13.samecontent_artifact')::uuid); exception when others then denied:=true; end;
  assert denied,'New URL and retrieval time with unchanged content cannot retest';
  denied:=false; begin perform public.reconsider_product_candidate(current_setting('stage13.candidate')::uuid,current_setting('stage13.unrelated_artifact')::uuid); exception when others then denied:=true; end;
  assert denied,'Completed unrelated research cannot satisfy candidate scope';
  denied:=false; begin perform public.reconsider_product_candidate(current_setting('stage13.candidate')::uuid,gen_random_uuid()); exception when others then denied:=true; end;
  assert denied,'Forged missing artifact denied';
  result:=public.reconsider_product_candidate(current_setting('stage13.candidate')::uuid,current_setting('stage13.newcontent_artifact')::uuid);
  replay:=public.reconsider_product_candidate(current_setting('stage13.candidate')::uuid,current_setting('stage13.newcontent_artifact')::uuid);
  assert result->'cached'='false' and replay->'cached'='true' and result->>'experimentId'=replay->>'experimentId';
  assert (select count(*) from public.product_experiments where candidate_id=current_setting('stage13.candidate')::uuid)=initial_count+1;
  assert (select count(*) from public.workflow_runs where business_id=current_setting('stage13.business')::uuid)=workflow_count,'Offline reconsideration never launches a provider workflow';
  assert (select status='completed' and basis_artifact_id=current_setting('stage13.newcontent_artifact')::uuid and source_artifact_id=basis_artifact_id and creative is null and price is null
    from public.product_experiments where id=(result->>'experimentId')::uuid);
  assert (select status='completed' and basis_artifact_id is null from public.product_experiments where id=current_setting('stage13.experiment')::uuid),'Prior experiment preserved';
end; $$;
reset role;

-- Owner reconciliation succeeds if generic workflow completion precedes registry finalization.
set local role authenticated;
do $$
declare c jsonb; l jsonb;
begin
  c:=public.create_product_candidate(current_setting('stage13.business')::uuid,'{"concept":"Reconciliation Trail Tee","audience":"Weekend hikers","hypothesis":"A simple original trail drawing could attract measured buyer interest.","originalDesign":true,"rightsStatus":"confirmed","sourceDomains":["etsy.com"]}');
  l:=public.begin_product_discovery((c->>'candidateId')::uuid,gen_random_uuid(),repeat('stage13-reconcile-cap-',3));
  perform set_config('stage13.reconcile_experiment',l->>'experimentId',true); perform set_config('stage13.reconcile_run',l->>'workflowRunId',true);
end; $$;
reset role;
do $$
declare r uuid:=current_setting('stage13.reconcile_run')::uuid; b uuid:=current_setting('stage13.business')::uuid; cap text:=repeat('stage13-reconcile-cap-',3);
begin
  perform pg_temp.stage13_fixture(r,b,cap);
  perform public.installed_pack_runtime_transition(r,b,cap,'complete','{}');
end; $$;
set local role authenticated;
do $$
begin
  assert public.finalize_product_discovery(current_setting('stage13.reconcile_experiment')::uuid)->'cached'='false';
  assert public.finalize_product_discovery(current_setting('stage13.reconcile_experiment')::uuid)->'cached'='true';
end; $$;
reset role;
-- The one-dollar envelope is a conservative estimate, not a guaranteed invoice cap.
select set_config('request.jwt.claim.sub',current_setting('stage13.owner'),true);
set local role authenticated;
do $$
declare c jsonb; l jsonb;
begin
  c:=public.create_product_candidate(current_setting('stage13.business')::uuid,'{"concept":"Budget Trail Tee","audience":"Weekend hikers","hypothesis":"An original trail graphic may attract bounded qualified buyer interest.","originalDesign":true,"rightsStatus":"confirmed","sourceDomains":["etsy.com"]}');
  l:=public.begin_product_discovery((c->>'candidateId')::uuid,gen_random_uuid(),repeat('stage13-budget-cap-',3));
  perform set_config('stage13.budget_run',l->>'workflowRunId',true);
end; $$;
reset role;
set local role anon;
do $$
declare r uuid:=current_setting('stage13.budget_run')::uuid; b uuid:=current_setting('stage13.business')::uuid; cap text:=repeat('stage13-budget-cap-',3);
  result jsonb; denied boolean;
begin
  perform public.installed_pack_runtime_transition(r,b,cap,'load',jsonb_build_object('runtimeRunId','stage13-regression-'||r));
  result:=public.product_discovery_runtime(r,b,cap,'scope');
  assert result->>'budgetMicrousd'='1000000' and result->'guaranteedInvoiceCap'='false';
  denied:=false; begin perform public.reserve_product_research_cost(r,b,repeat('wrong-capability-',3),'search:luna.standard',300000,repeat('a',64)); exception when insufficient_privilege then denied:=true; end;
  assert denied,'Budget capability isolation';
  result:=public.reserve_product_research_cost(r,b,cap,'search:luna.standard',300000,repeat('a',64));
  assert result->'shouldCall'='true' and result->>'totalReservedMicrousd'='300000';
  result:=public.reserve_product_research_cost(r,b,cap,'search:luna.standard',300000,repeat('a',64));
  assert result->'shouldCall'='false' and result->>'totalReservedMicrousd'='300000','Timeout/replay cannot authorize another call';
  denied:=false; begin perform public.reserve_product_research_cost(r,b,cap,'search:luna.standard',300000,repeat('b',64)); exception when others then denied:=true; end;
  assert denied,'Attempt payload hash cannot change';
  result:=public.record_product_research_cost(r,b,cap,'search:luna.standard',400000,'stage13-test-search-cost');
  assert result->>'totalReservedMicrousd'='400000','Higher reported spend increases committed envelope';
  result:=public.record_product_research_cost(r,b,cap,'search:luna.standard',400000,'stage13-test-search-cost');
  assert result->'cached'='true','Repeated settlement is append-once';
  result:=public.record_product_research_cost(r,b,cap,'search:luna.standard',100000,'stage13-test-search-cost');
  assert result->>'totalReservedMicrousd'='400000','Lower later reports never refund prior committed cost';
  denied:=false; begin perform public.record_product_research_cost(r,b,cap,'search:luna.standard',400000,'different-provider-call'); exception when others then denied:=true; end;
  assert denied,'Settlement cannot conceal a second provider call';
  denied:=false; begin perform public.reserve_product_research_cost(r,b,cap,'selector:luna.standard',600001,repeat('c',64)); exception when others then denied:=true; end;
  assert denied,'Remaining estimate budget counts the greater actual report';
  result:=public.reserve_product_research_cost(r,b,cap,'selector:luna.standard',600000,repeat('c',64));
  assert result->'shouldCall'='true' and result->>'totalReservedMicrousd'='1000000';
  result:=public.record_product_research_cost(r,b,cap,'selector:luna.standard',null,null);
  assert result->>'totalReservedMicrousd'='1000000','Unknown outcomes retain full estimate';
  denied:=false; begin perform public.reserve_product_research_cost(r,b,cap,'search:gemini.flash.large',1,repeat('d',64)); exception when others then denied:=true; end;
  assert denied,'Fallback cannot exceed remaining budget';
  denied:=false; begin perform public.reserve_product_research_cost(r,b,cap,'selector:unbounded',1,repeat('d',64)); exception when insufficient_privilege then denied:=true; end;
  assert denied,'Only approved standard route search/selector attempts allowed';
  perform pg_temp.stage13_fixture(r,b,cap);
  perform public.product_discovery_runtime(r,b,cap,'finalize');
end; $$;
reset role;

select set_config('request.jwt.claim.sub',current_setting('stage13.other'),true);
set local role authenticated;
do $$
declare denied boolean; c jsonb;
begin
  assert (select count(*) from public.product_decisions where business_id=current_setting('stage13.business')::uuid)=0,'Other owner cannot see decisions';
  c:=public.create_product_candidate(current_setting('stage13.foreign')::uuid,'{"concept":"Other Trail Tee","audience":"Other hikers","hypothesis":"An unrelated original tee may attract qualified interest.","originalDesign":true,"rightsStatus":"confirmed","sourceDomains":["etsy.com"]}');
  denied:=false; begin perform public.record_product_assessment(current_setting('stage13.experiment')::uuid,current_setting('stage13.dimensions')::jsonb); exception when insufficient_privilege then denied:=true; end;
  assert denied,'Foreign assessment denied';
  denied:=false; begin perform public.reconsider_product_candidate(current_setting('stage13.candidate')::uuid,current_setting('stage13.newcontent_artifact')::uuid); exception when insufficient_privilege then denied:=true; end;
  assert denied,'Foreign reconsideration denied';
end; $$;
reset role;
do $$
declare denied boolean; c public.product_candidates%rowtype; e public.product_experiments%rowtype;
begin
  select * into strict c from public.product_candidates where id=current_setting('stage13.candidate')::uuid;
  select * into strict e from public.product_experiments where id=current_setting('stage13.experiment')::uuid;
  denied:=false;
  begin perform private.stage13_validated_evidence(e.source_artifact_id,current_setting('stage13.foreign')::uuid,true); exception when others then denied:=true; end;
  assert denied,'Even a real completed source artifact cannot cross businesses';
  denied:=false;
  begin perform private.stage13_assessment(c,jsonb_set(e.evidence_pack,'{sources,0,url}','"https://help.etsy.com/hc/article"'),current_setting('stage13.dimensions')::jsonb); exception when others then denied:=true; end;
  assert denied,'Help hostname cannot be owner-labeled a market observation';
  denied:=false;
  begin perform private.stage13_assessment(c,jsonb_set(e.evidence_pack,'{sources,0,url}','"https://support.etsy.com/article"'),current_setting('stage13.dimensions')::jsonb); exception when others then denied:=true; end;
  assert denied,'Support hostname cannot be owner-labeled a market observation';
end; $$;
do $$
begin
  assert not has_table_privilege('anon','public.product_candidates','SELECT');
  assert has_table_privilege('authenticated','public.product_candidates','SELECT');
  assert not has_table_privilege('authenticated','public.product_candidates','INSERT');
  assert not has_table_privilege('authenticated','public.product_decisions','UPDATE');
  assert not has_function_privilege('anon','public.record_product_assessment(uuid,jsonb,boolean)','EXECUTE');
  assert not has_function_privilege('authenticated','public.product_discovery_runtime(uuid,uuid,text,text)','EXECUTE');
  assert has_function_privilege('anon','public.product_discovery_runtime(uuid,uuid,text,text)','EXECUTE');
  assert not has_function_privilege('authenticated','private.stage13_finalize(uuid)','EXECUTE');
  assert not has_function_privilege('anon','private.stage13_validated_evidence(uuid,uuid,boolean)','EXECUTE');
  assert not has_function_privilege('authenticated','public.reserve_product_research_cost(uuid,uuid,text,text,integer,text,jsonb)','EXECUTE');
  assert not has_table_privilege('authenticated','public.product_research_cost_reservations','INSERT');
  assert not has_table_privilege('authenticated','public.product_research_cost_settlements','UPDATE');
  assert (select count(*) from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename in ('product_candidates','product_experiments','product_decisions'))=3;
  assert (select count(*) from public.events where business_id=current_setting('stage13.business')::uuid and event_type='product.candidate.created')=(select count(*) from public.product_candidates where business_id=current_setting('stage13.business')::uuid);
  assert (select count(*) from public.events where business_id=current_setting('stage13.business')::uuid and event_type='product.discovery.completed')=(select count(*) from public.product_experiments where business_id=current_setting('stage13.business')::uuid and status='completed');
  assert exists(select 1 from public.events where business_id=current_setting('stage13.business')::uuid and event_type='product.assessment.recorded');
  assert not exists(select 1 from public.product_decisions where business_id=current_setting('stage13.business')::uuid and
    (assessment->'review'->'liveQualified'<>'false' or assessment->'review'->'creativeProductionAllowed'<>'false' or assessment->'review'->'publicationAllowed'<>'false'));
end; $$;
rollback;
