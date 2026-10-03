-- Inert administrator fixtures only. No real provider/account/key is provisioned.
begin;
create function pg_temp.r05_assert(ok boolean,label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'R05 assertion: %',label; end if; end $$;
create function pg_temp.r05_reject(statement text,expected text) returns void language plpgsql as $$ begin
 begin execute statement; exception when others then if position(expected in sqlerrm)=0 then raise exception 'Wrong rejection: % wanted %',sqlerrm,expected; end if; return; end;
 raise exception 'Expected rejection: %',statement;
end $$;
insert into auth.users(id,email) values('95050000-0000-4000-8000-000000000001','r05-owner@example.invalid'),('95050000-0000-4000-8000-000000000002','r05-other@example.invalid');
insert into public.packs(id,pack_key,version,name,kind,status) values('95050000-0000-4000-8000-000000000011','r05.inert','1.0.0','R05 inert SQL only','workflow','qualified');
insert into public.workflow_definitions(id,pack_id,workflow_key,version,name,status) values('95050000-0000-4000-8000-000000000012','95050000-0000-4000-8000-000000000011','r05.inert','1.0.0','R05 inert workflow','qualified');
insert into private.r05_operations values('research.model','95050000-0000-4000-8000-000000000011','95050000-0000-4000-8000-000000000012','openrouter','inert/model','Research planning','USD','model',10000,100,60,'[]','["business_context","public_evidence"]',repeat('a',64),repeat('b',64),repeat('c',64),clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day');
insert into private.r05_server_keys values(encode(extensions.digest(convert_to(repeat('inert-',8),'UTF8'),'sha256'),'hex'),clock_timestamp()+interval '1 day');
create temporary table r05_fixture(b uuid,g uuid,w uuid,installation uuid,policy uuid,hash text,payload jsonb);
create function pg_temp.r05_seed(ceiling integer default 100) returns uuid language plpgsql as $$
declare b uuid:=gen_random_uuid(); g uuid; w uuid:=gen_random_uuid(); i uuid:=gen_random_uuid(); p jsonb; result jsonb; begin
 insert into public.businesses(id,owner_user_id,name) values(b,'95050000-0000-4000-8000-000000000001','R05 inert Business');
 perform set_config('request.jwt.claim.sub','95050000-0000-4000-8000-000000000001',true);
 perform public.r04_quest_transition(b,'business.save','{"expectedRevision":0,"content":{"brandContext":"Original research","operatingRules":"Only finite model costs","allowedActivity":"Research planning","restrictions":"No commerce"},"preference":"setup"}',gen_random_uuid());
 result:=public.r04_quest_transition(b,'quest.save','{"goalId":null,"expectedRevision":0,"content":{"title":"Research","originalIntent":"Research one market","objective":"Research one market","parsed":{"target":{"amount":"1","currency":null,"metric":"units"},"budget":{"amount":"1","currency":"USD"},"deadline":{"date":"2027-01-01","time":"12:00","timezone":"UTC"},"scope":"Research planning","geography":["New Zealand"],"stopConstraints":["No commerce"]},"ambiguities":[]}}',gen_random_uuid());
 g:=(result->>'id')::uuid;
 perform public.r04_quest_transition(b,'quest.preference',jsonb_build_object('goalId',g,'expectedRevision',1,'preference','ready'),gen_random_uuid());
 insert into public.installed_packs(id,business_id,root_pack_id,root_pack_key,status,snapshot) values(i,b,'95050000-0000-4000-8000-000000000011','r05.inert','active','{}');
 insert into public.workflow_runs(id,business_id,goal_id,workflow_definition_id,idempotency_key,status,runtime_capability_hash,pack_installation_id,pack_snapshot) values(w,b,g,'95050000-0000-4000-8000-000000000012','r05-inert','running',encode(extensions.digest(convert_to(repeat('capability-',5),'UTF8'),'sha256'),'hex'),i,'{}');
 p:=jsonb_build_object('version','r05.1','goalId',g,'goalRevision',2,'businessRevision',1,'currency','USD','businessLifetimeLimitMicrounits',ceiling::text,'policyLimitMicrounits',ceiling::text,'categoryLimits',jsonb_build_array(jsonb_build_object('category','model','microunits',ceiling::text)),'expectedCapRevision',0,'expectedExposureMicrounits','0','startsAt',clock_timestamp()-interval '1 minute','expiresAt',clock_timestamp()+interval '1 hour','maximumDispatches',10,'minimumIntervalSeconds',0,'stopOnTarget',false,'financialMode','bounded_model_cost_only','operations',jsonb_build_array(jsonb_build_object('operationKey','research.model','installationId',i,'workflowDefinitionId','95050000-0000-4000-8000-000000000012','purpose','Research planning','provider','openrouter','category','model','accountId',null,'accountRevision',null,'sourceDomains','[]'::jsonb,'dataClasses','["business_context","public_evidence"]'::jsonb,'maximumPerOperationMicrounits','60')));
 result:=public.r05_policy_owner(b,'propose',p,gen_random_uuid());
 perform public.r05_policy_owner(b,'confirm',jsonb_build_object('policyId',result->>'id','policyHash',result->>'hash'),gen_random_uuid());
 insert into private.r05_policy_proofs values((result->>'id')::uuid,result->>'hash',repeat('d',64),clock_timestamp()+interval '1 day');
 insert into r05_fixture values(b,g,w,i,(result->>'id')::uuid,result->>'hash',p);
 return b;
end $$;
create function pg_temp.r05_input(b uuid,k text) returns jsonb language sql as $$ select jsonb_build_object('workflowRunId',w,'runtimeCapability',repeat('capability-',5),'operationKey','research.model','requestHash',repeat('e',64),'wireRequestHash',repeat('f',64),'wireRequestBytes',1000,'idempotencyKey',k,'providerModelId','inert/model','maximumOutputTokens',100,'accounting',jsonb_build_object('kind','r05'),'sourceDomains','[]'::jsonb,'dataClasses','["business_context","public_evidence"]'::jsonb,'accountId',null,'accountRevision',null,'currency','USD','liabilityMicrounits','60') from r05_fixture where r05_fixture.b=$1 $$;
create function pg_temp.r05_server(b uuid,op text,p jsonb) returns jsonb language sql as $$ select public.r05_admission_server(b,op,p,repeat('inert-',8)) $$;
create function pg_temp.r05_settle(b uuid,r uuid,cost text,receipt text) returns jsonb language sql as $$ select pg_temp.r05_server(b,'settle',jsonb_build_object('requestId',r,'currency','USD','actualMicrounits',cost,'providerRequestId',receipt,'receiptHash',encode(extensions.digest(convert_to(coalesce(cost,'unknown')||receipt,'UTF8'),'sha256'),'hex'))) $$;
create function pg_temp.r05_legacy(b uuid,key text default 'selector:luna.standard',amount integer default 60) returns uuid language plpgsql as $$
declare candidate uuid:=gen_random_uuid(); experiment uuid:=gen_random_uuid(); reservation uuid:=gen_random_uuid(); wf uuid; begin
 select w into wf from r05_fixture where r05_fixture.b=$1;
 insert into public.product_candidates(id,business_id,fingerprint,concept,audience,hypothesis,original_design,rights_status,source_domains) values(candidate,b,repeat('a',64),'Original design','Adult audience','An inert research hypothesis',true,'confirmed',array['example.invalid']);
 insert into public.product_experiments(id,business_id,candidate_id,workflow_run_id,fingerprint,hypothesis,variables,audience,status,measurement_plan) values(experiment,b,candidate,wf,repeat('b',64),'An inert research hypothesis','{}','Adult audience','reserved',private.stage13_plan());
 insert into public.product_research_cost_reservations(id,business_id,experiment_id,workflow_run_id,attempt_key,reserved_microusd,request_hash,estimate) values(reservation,b,experiment,wf,key,amount,repeat('e',64),'{}');
 return reservation;
end $$;
select set_config('r05.a',pg_temp.r05_seed()::text,true);
select set_config('r05.b',pg_temp.r05_seed()::text,true);
grant select on r05_fixture to authenticated,anon,service_role;
set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.r05_reject($q$select public.r05_admission_read(current_setting('r05.a')::uuid)$q$,'r05_owner_required');
select set_config('request.jwt.claim.sub','95050000-0000-4000-8000-000000000002',true);
select pg_temp.r05_reject($q$select public.r05_admission_read(current_setting('r05.a')::uuid)$q$,'r05_owner_required');
select pg_temp.r05_reject($q$select * from private.r05_server_keys$q$,'permission denied');
select set_config('request.jwt.claim.sub','95050000-0000-4000-8000-000000000001',true);
select pg_temp.r05_assert(jsonb_array_length(public.r05_admission_read(current_setting('r05.a')::uuid)->'eligibleOperations')=1,'safe exact choices');
select pg_temp.r05_reject($q$select public.r05_policy_owner(current_setting('r05.a')::uuid,'propose',(select jsonb_set(payload,'{currency}','"EUR"') from r05_fixture where b=current_setting('r05.a')::uuid),gen_random_uuid())$q$,'r05_unsupported_policy');
select pg_temp.r05_reject($q$select public.r05_policy_owner(current_setting('r05.a')::uuid,'propose',(select jsonb_set(payload,'{startsAt}','null') from r05_fixture where b=current_setting('r05.a')::uuid),gen_random_uuid())$q$,'r05_invalid_policy_type');
select pg_temp.r05_reject($q$select public.r05_policy_owner(current_setting('r05.a')::uuid,'pause',jsonb_build_object('kind','business','id',current_setting('r05.b')),gen_random_uuid())$q$,'r05_scope_unavailable');
set local role anon;
select pg_temp.r05_reject($q$select public.r05_admission_server(current_setting('r05.a')::uuid,'guard',pg_temp.r05_input(current_setting('r05.a')::uuid,'bad'),'bad')$q$,'r05_server_authority_required');
select pg_temp.r05_reject($q$select pg_temp.r05_server(current_setting('r05.a')::uuid,'guard',jsonb_set(pg_temp.r05_input(current_setting('r05.a')::uuid,'bad'),'{runtimeCapability}','"wrong"'))$q$,'r05_runtime_authority_required');
select pg_temp.r05_assert(pg_temp.r05_server(current_setting('r05.a')::uuid,'guard',jsonb_set(pg_temp.r05_input(current_setting('r05.a')::uuid,'wire-bad'),'{providerModelId}','"wrong/model"'))->>'reason'='wire_scope_or_quote_mismatch','exact model');
select set_config('r05.first',pg_temp.r05_server(current_setting('r05.a')::uuid,'guard',pg_temp.r05_input(current_setting('r05.a')::uuid,'first'))::text,true);
select pg_temp.r05_assert(current_setting('r05.first')::jsonb->>'shouldDispatch'='true','first dispatch');
select pg_temp.r05_assert(pg_temp.r05_server(current_setting('r05.a')::uuid,'guard',pg_temp.r05_input(current_setting('r05.a')::uuid,'first'))->>'shouldDispatch'='false','replay cannot send');
select pg_temp.r05_reject($q$select pg_temp.r05_server(current_setting('r05.a')::uuid,'guard',jsonb_set(pg_temp.r05_input(current_setting('r05.a')::uuid,'first'),'{wireRequestHash}',to_jsonb(repeat('a',64))))$q$,'r05_idempotency_conflict');
select pg_temp.r05_assert(pg_temp.r05_server(current_setting('r05.a')::uuid,'guard',pg_temp.r05_input(current_setting('r05.a')::uuid,'second'))->>'reason'='unresolved_prior_liability','unknown blocks subsequent spend');
select pg_temp.r05_assert(pg_temp.r05_server(current_setting('r05.a')::uuid,'release_unsent',jsonb_build_object('requestId',current_setting('r05.first')::jsonb->>'requestId','evidenceHash',repeat('a',64)))->>'reason'='marked_liability_cannot_release','sent cannot release');
select pg_temp.r05_settle(current_setting('r05.a')::uuid,(current_setting('r05.first')::jsonb->>'requestId')::uuid,null,'inert-receipt-a');
select pg_temp.r05_assert(pg_temp.r05_server(current_setting('r05.a')::uuid,'guard',pg_temp.r05_input(current_setting('r05.a')::uuid,'third'))->>'reason'='unresolved_prior_liability','null settlement is unknown');
select pg_temp.r05_settle(current_setting('r05.a')::uuid,(current_setting('r05.first')::jsonb->>'requestId')::uuid,'60','inert-receipt-a');
select pg_temp.r05_assert(pg_temp.r05_server(current_setting('r05.a')::uuid,'guard',pg_temp.r05_input(current_setting('r05.a')::uuid,'third'))->>'reason'='financial_cap_exceeded','readback resolves unknown without resetting charge');
reset role;
do $$ declare biz uuid:=pg_temp.r05_seed(200); account uuid:=gen_random_uuid(); rev uuid:=gen_random_uuid(); p jsonb; q jsonb; request jsonb; begin
 insert into private.connected_accounts(id,business_id,owner_id,provider,provider_account_id,status,connection_revision,verified_at) values(account,biz,'95050000-0000-4000-8000-000000000001','printful','inert-r05-source','connected',rev,clock_timestamp());
 select jsonb_set(jsonb_set(jsonb_set(payload,'{expectedCapRevision}','1'),'{operations,0,accountId}',to_jsonb(account::text)),'{operations,0,accountRevision}',to_jsonb(rev::text)) into p from r05_fixture where b=biz;
 q:=public.r05_policy_owner(biz,'propose',p,gen_random_uuid());
 perform public.r05_policy_owner(biz,'confirm',jsonb_build_object('policyId',q->>'id','policyHash',q->>'hash'),gen_random_uuid());
 insert into private.r05_policy_proofs values((q->>'id')::uuid,q->>'hash',repeat('c',64),clock_timestamp()+interval '1 day');
 request:=pg_temp.r05_server(biz,'prepare',jsonb_set(jsonb_set(pg_temp.r05_input(biz,'account'),'{accountId}',to_jsonb(account::text)),'{accountRevision}',to_jsonb(rev::text)));
 perform public.r05_policy_owner(biz,'pause',jsonb_build_object('kind','account','id',account),gen_random_uuid());
 perform pg_temp.r05_assert(pg_temp.r05_server(biz,'dispatch',jsonb_build_object('requestId',request->>'requestId'))->>'reason'='scope_paused','account pause denies before marker');
 perform public.r05_policy_owner(biz,'resume',jsonb_build_object('kind','account','id',account),gen_random_uuid());
 update private.connected_accounts set connection_revision=gen_random_uuid() where id=account;
 perform pg_temp.r05_assert(pg_temp.r05_server(biz,'dispatch',jsonb_build_object('requestId',request->>'requestId'))->>'reason'='account_unavailable','account revision invalidates prepared authority');
end $$;
do $$ declare biz uuid:=pg_temp.r05_seed(200); request jsonb; p jsonb; q jsonb; begin
 request:=pg_temp.r05_server(biz,'guard',pg_temp.r05_input(biz,'old-policy'));
 perform pg_temp.r05_settle(biz,(request->>'requestId')::uuid,'60','inert-old-policy');
 select jsonb_set(payload,'{expectedCapRevision}','1') into p from r05_fixture where b=biz;
 q:=public.r05_policy_owner(biz,'propose',p,gen_random_uuid());
 begin
 perform public.r05_policy_owner(biz,'confirm',jsonb_build_object('policyId',q->>'id','policyHash',q->>'hash'),gen_random_uuid());
 raise exception 'Expected stale exposure rejection';
 exception when others then if sqlerrm<>'r05_stale_exposure' then raise; end if; end;
 p:=jsonb_set(jsonb_set(jsonb_set(jsonb_set(p,'{expectedExposureMicrounits}','"60"'),'{businessLifetimeLimitMicrounits}','"100"'),'{policyLimitMicrounits}','"100"'),'{categoryLimits,0,microunits}','"100"');
 q:=public.r05_policy_owner(biz,'propose',p,gen_random_uuid());
 perform public.r05_policy_owner(biz,'confirm',jsonb_build_object('policyId',q->>'id','policyHash',q->>'hash'),gen_random_uuid());
 insert into private.r05_policy_proofs values((q->>'id')::uuid,q->>'hash',repeat('c',64),clock_timestamp()+interval '1 day');
 perform pg_temp.r05_assert(pg_temp.r05_server(biz,'guard',pg_temp.r05_input(biz,'new-policy'))->>'reason'='financial_cap_exceeded','new confirmation never resets prior policy exposure');
 perform pg_temp.r05_assert((select sum(held)=60 from private.r05_exposure(biz)),'old settled charge remains');
end $$;
do $$ declare biz uuid:=pg_temp.r05_seed(200); p jsonb; q jsonb; request jsonb; begin
 select jsonb_set(jsonb_set(payload,'{expectedCapRevision}','1'),'{minimumIntervalSeconds}','3600') into p from r05_fixture where b=biz;
 q:=public.r05_policy_owner(biz,'propose',p,gen_random_uuid());
 perform public.r05_policy_owner(biz,'confirm',jsonb_build_object('policyId',q->>'id','policyHash',q->>'hash'),gen_random_uuid());
 insert into private.r05_policy_proofs values((q->>'id')::uuid,q->>'hash',repeat('c',64),clock_timestamp()+interval '1 day');
 request:=pg_temp.r05_server(biz,'guard',pg_temp.r05_input(biz,'cadence-one'));
 perform pg_temp.r05_settle(biz,(request->>'requestId')::uuid,'1','inert-cadence');
 perform pg_temp.r05_assert(pg_temp.r05_server(biz,'guard',pg_temp.r05_input(biz,'cadence-two'))->>'reason'='cadence_exceeded','cadence persists after cheap settlement');
 perform pg_temp.r05_assert(pg_temp.r05_server(biz,'guard',jsonb_set(pg_temp.r05_input(biz,'huge-wire'),'{wireRequestBytes}','10001'))->>'reason'='wire_scope_or_quote_mismatch','input size must fit fixed liability proof');
end $$;
do $$ declare b uuid:=pg_temp.r05_seed(200); source uuid; request jsonb; total bigint; blocked boolean:=false; begin
 source:=pg_temp.r05_legacy(b);
 perform pg_temp.r05_assert(pg_temp.r05_server(b,'guard',pg_temp.r05_input(b,'unmapped'))->>'reason'='unresolved_prior_liability','legacy unknown retained across new requests');
 request:=pg_temp.r05_server(b,'guard',jsonb_set(pg_temp.r05_input(b,'legacy'),'{accounting}','{"kind":"research","callKey":"selector:luna.standard"}'));
 perform pg_temp.r05_assert(request->>'shouldDispatch'='true','exact existing reservation admitted');
 select sum(held) into total from private.r05_exposure(b);
 perform pg_temp.r05_assert(total=60,'legacy source is counted once');
 insert into public.product_research_cost_settlements(business_id,reservation_id,reported_microusd,provider_request_id,fingerprint) values(b,source,40,'inert-legacy-receipt',repeat('a',64));
 select sum(held) into total from private.r05_exposure(b);
 perform pg_temp.r05_assert(total=40,'sidecar immediately follows original settlement');
 perform pg_temp.r05_assert(pg_temp.r05_server(b,'guard',pg_temp.r05_input(b,'after-legacy'))->>'shouldDispatch'='true','known legacy settlement permits next bounded dispatch');
 perform pg_temp.r05_assert((select count(*)=1 from public.product_research_cost_reservations where id=source),'original reservation untouched');
end $$;
do $$ declare b uuid:=pg_temp.r05_seed(100); source uuid; original public.product_research_cost_reservations; blocked boolean:=false; begin
 source:=pg_temp.r05_legacy(b);
 select * into original from public.product_research_cost_reservations where id=source;
 begin
 insert into public.product_research_cost_reservations(business_id,experiment_id,workflow_run_id,attempt_key,reserved_microusd,request_hash,estimate) values(b,original.experiment_id,original.workflow_run_id,'selector:gemini.flash.large',60,repeat('f',64),'{}');
 exception when others then if sqlerrm<>'r05_business_cap_exceeded' then raise; end if; blocked:=true; end;
 perform pg_temp.r05_assert(blocked,'legacy second reservation shares cumulative cap');
 perform pg_temp.r05_assert((select count(*)=1 from public.product_research_cost_reservations where business_id=b),'rejected reserve is fully rolled back');
end $$;
do $$ declare b uuid:=pg_temp.r05_seed(200); request jsonb; fixture r05_fixture; begin

 request:=pg_temp.r05_server(b,'prepare',pg_temp.r05_input(b,'stale-rule'));
 perform public.r04_quest_transition(b,'business.save','{"expectedRevision":1,"content":{"brandContext":"Original research","operatingRules":"Stop all paid activity","allowedActivity":"Planning","restrictions":"No commerce"},"preference":"setup"}',gen_random_uuid());
 perform pg_temp.r05_assert(pg_temp.r05_server(b,'dispatch',jsonb_build_object('requestId',request->>'requestId'))->>'reason'='intent_revision_changed','rules edit invalidates prepared request');
end $$;
do $$ declare b uuid:=pg_temp.r05_seed(200); r jsonb; held text; begin
 r:=pg_temp.r05_server(b,'prepare',pg_temp.r05_input(b,'paused'));
 perform public.r05_policy_owner(b,'pause',jsonb_build_object('kind','business','id',b),gen_random_uuid());
 perform pg_temp.r05_assert(pg_temp.r05_server(b,'dispatch',jsonb_build_object('requestId',r->>'requestId'))->>'reason'='scope_paused','pause wins before marker');
 perform public.r05_policy_owner(b,'resume',jsonb_build_object('kind','business','id',b),gen_random_uuid());
 perform pg_temp.r05_assert(pg_temp.r05_server(b,'dispatch',jsonb_build_object('requestId',r->>'requestId'))->>'shouldDispatch'='true','resume permits unsent request');
 perform public.r05_policy_owner(b,'pause',jsonb_build_object('kind','business','id',b),gen_random_uuid());
 perform pg_temp.r05_settle(b,(r->>'requestId')::uuid,'250','inert-overage');
 select sum(e.held)::text into held from private.r05_exposure(b) e;
 perform pg_temp.r05_assert(held='250','settle after pause preserves over-cap truth');
 perform public.r05_policy_owner(b,'resume',jsonb_build_object('kind','business','id',b),gen_random_uuid());
 perform pg_temp.r05_assert(pg_temp.r05_server(b,'guard',pg_temp.r05_input(b,'after-overage'))->>'reason'='financial_cap_exceeded','overage blocks next');
end $$;
do $$ declare b uuid:=current_setting('r05.b')::uuid; p uuid; r jsonb; begin
 select policy into p from r05_fixture where r05_fixture.b=current_setting('r05.b')::uuid;
 r:=pg_temp.r05_server(b,'prepare',pg_temp.r05_input(b,'revoke'));
 perform public.r05_policy_owner(b,'revoke',jsonb_build_object('policyId',p,'policyHash',(select hash from r05_fixture where r05_fixture.b=current_setting('r05.b')::uuid)),gen_random_uuid());
 perform pg_temp.r05_assert(pg_temp.r05_server(b,'dispatch',jsonb_build_object('requestId',r->>'requestId'))->>'reason'='policy_not_confirmed','revocation invalidates prepared');
 perform pg_temp.r05_assert(pg_temp.r05_server(b,'release_unsent',jsonb_build_object('requestId',r->>'requestId','evidenceHash',repeat('e',64)))->>'reason'='released_unsent','unmarked release with evidence');
end $$;
select pg_temp.r05_reject($q$update private.r05_markers set created_at=clock_timestamp()$q$,'r05_immutable_history');
grant usage on schema private to service_role;
grant insert on private.r05_server_keys to service_role;
set local role service_role;
select pg_temp.r05_reject($q$insert into private.r05_server_keys values(repeat('f',64),clock_timestamp()+interval '1 hour')$q$,'r05_guarded_rpc_required');
reset role;
rollback;
