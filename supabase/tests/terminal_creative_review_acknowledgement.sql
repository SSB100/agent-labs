-- Synthetic, isolated PostgreSQL regression only. No hosted data or provider calls.
begin;
select set_config('terminal.owner', '94000000-0000-4000-8000-000000000001', true);
select set_config('terminal.other', '94000000-0000-4000-8000-000000000002', true);
select set_config('terminal.business', '94000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claim.sub', current_setting('terminal.owner'), true);
insert into auth.users(id,email) values (current_setting('terminal.owner')::uuid,'terminal-owner@example.invalid'),(current_setting('terminal.other')::uuid,'terminal-other@example.invalid');
insert into public.businesses(id,owner_user_id,name) values(current_setting('terminal.business')::uuid,current_setting('terminal.owner')::uuid,'Isolated acknowledgement fixture');

create function pg_temp.seed_terminal_notice() returns uuid language plpgsql as $$
declare b uuid:=current_setting('terminal.business')::uuid; c uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); w uuid:=gen_random_uuid();
 d uuid; wd uuid; stage uuid:=gen_random_uuid(); task uuid:=gen_random_uuid(); worker uuid:=gen_random_uuid(); intent uuid:=gen_random_uuid(); art uuid:=gen_random_uuid(); asset uuid:=gen_random_uuid(); notice uuid;
begin
 select id into strict d from public.workflow_definitions where workflow_key='etsy.creative-pipeline' and version='1.0.0';
 select id into wd from public.worker_definitions where worker_key='etsy.creative-director' limit 1;
 insert into public.product_candidates(id,business_id,fingerprint,concept,audience,hypothesis,original_design,rights_status,source_domains)
 values(c,b,private.stage13_hash(c::text),'Isolated original test','Synthetic fixture audience','Synthetic fixture only, no demand claim.',true,'confirmed',array['etsy.com']);
 insert into public.creative_approvals(id,business_id,candidate_id,purpose,snapshot,scope_hash,approval_hash,quote,maximum_microusd,owner_user_id,approved_at,expires_at)
 values(a,b,c,'technical_qualification','{"publicationAllowed":false}',repeat('a',64),repeat('b',64),'{}',100000,current_setting('terminal.owner')::uuid,now(),now()+interval '1 day');
 insert into public.workflow_runs(id,business_id,workflow_definition_id,status,idempotency_key,input,state,completed_at)
 values(w,b,d,'needs_owner',r::text,jsonb_build_object('creativeRunId',r,'approvalId',a),'{"productionReady":false,"publicationAllowed":false}',now());
 insert into public.creative_runs(id,business_id,candidate_id,approval_id,workflow_run_id,catalog_snapshot,capability_expires_at)
 values(r,b,c,a,w,'{}',now()+interval '1 hour');
 insert into private.creative_run_capabilities values(r,repeat('d',64));
 insert into public.workflow_stage_runs(id,business_id,workflow_run_id,stage_key,sequence,status,completed_at) values(stage,b,w,'generate:1',1,'failed',now());
 insert into public.task_contracts(id,business_id,workflow_run_id,workflow_stage_run_id,worker_definition_id,status,objective) values(task,b,w,stage,wd,'failed','Synthetic task');
 insert into public.worker_runs(id,business_id,workflow_run_id,task_contract_id,worker_definition_id,status,completed_at) values(worker,b,w,task,wd,'failed',now());
 insert into public.action_intents(id,business_id,workflow_run_id,task_contract_id,action_type,capability,status,idempotency_key,created_by_type)
 values(intent,b,w,task,'synthetic.terminal','image.generate','failed',r::text,'system');
 insert into public.action_receipts(business_id,action_intent_id,outcome,provider,request_fingerprint,response_summary)
 values(b,intent,'uncertain','synthetic',r::text,'{"reportedMicrousd":null,"outputValidated":false}');
 insert into public.artifacts(id,business_id,workflow_run_id,artifact_type,name) values(art,b,w,'creative.image','Synthetic immutable image');
 insert into public.creative_assets(id,creative_run_id,candidate_id,approval_id,business_id,version,brief_hash,asset_hash,storage_path,inspection,prompt,provider,model,generated_at,artifact_id)
 values(asset,r,c,a,b,1,repeat('a',64),repeat('b',64),b::text||'/'||r::text||'/version-1.png','{}','Synthetic','synthetic','synthetic',now(),art);
 insert into public.creative_cost_reservations(creative_run_id,business_id,call_key,reserved_microusd,request_hash,model,provider,estimate)
 values(r,b,'generate:1',75000,repeat('e',64),'synthetic','openrouter','{}');
 insert into public.creative_cost_settlements(creative_run_id,business_id,call_key,reported_microusd,provider_request_id,receipt)
 values(r,b,'generate:1',null,null,'{"outputValidated":false,"costStatus":"unknown"}');
 notice:=private.stage4_deterministic_uuid('creative:needs-owner:'||r);
 insert into public.owner_interventions(id,business_id,workflow_run_id,intervention_type,title,description,updated_at)
 values(notice,b,w,'creative_review','Synthetic terminal notice','Stopped synthetic run evidence','2026-10-02T08:00:00.123456+00');
 perform set_config('terminal.notice',notice::text,true); perform set_config('terminal.run',w::text,true);
 perform set_config('terminal.creative',r::text,true); perform set_config('terminal.stage',stage::text,true);
 perform set_config('terminal.worker',worker::text,true); perform set_config('terminal.task',task::text,true);
 perform set_config('terminal.intent',intent::text,true);
 return notice;
end $$;
select pg_temp.seed_terminal_notice();
select set_config('terminal.expected',(select updated_at::text from public.owner_interventions where id=current_setting('terminal.notice')::uuid),true);

-- Every table except the two explicitly permitted targets must be byte-for-byte unchanged.
create function pg_temp.terminal_snapshot() returns jsonb language plpgsql as $$
declare result jsonb:='{}'; t record; data jsonb;
begin
 for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in ('public','private') and c.relkind='r' and c.relname not in ('owner_interventions','events') order by 1,2 loop
 execute format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) from %I.%I t',t.nspname,t.relname) into data;
 result:=result||jsonb_build_object(t.nspname||'.'||t.relname,data);
 end loop; return result;
end $$;
select set_config('terminal.before',pg_temp.terminal_snapshot()::text,true);
insert into public.owner_interventions(business_id,workflow_run_id,intervention_type,title,description)
values(current_setting('terminal.business')::uuid,current_setting('terminal.run')::uuid,'validation_failure','Another unchanged notice','Must remain open');
insert into public.events(business_id,workflow_run_id,event_type,actor_type,payload)
values(current_setting('terminal.business')::uuid,current_setting('terminal.run')::uuid,'synthetic.fixture','system','{"unchanged":true}');
select set_config('terminal.other_notices',(select jsonb_agg(to_jsonb(i) order by i.id)::text from public.owner_interventions i where i.id<>current_setting('terminal.notice')::uuid),true);
select set_config('terminal.other_events',(select jsonb_agg(to_jsonb(e) order by e.id)::text from public.events e),true);


-- Each mutation/role test is rolled back independently, including role/JWT changes.
create function pg_temp.reject_terminal(p_mutation text,p_code text,p_role text default 'authenticated',p_message text default null) returns void language plpgsql as $$
declare rejected boolean:=false;
begin
 begin
   if p_mutation<>'' then execute p_mutation; end if;
   execute format('set local role %I',p_role);
   begin
     perform public.acknowledge_terminal_creative_review(current_setting('terminal.notice')::uuid,current_setting('terminal.expected')::timestamptz);
   exception when others then
     if sqlstate<>p_code then raise exception 'Expected %, got % (%) for %',p_code,sqlstate,sqlerrm,p_mutation; end if;
     if p_message is not null and sqlerrm<>p_message then raise exception 'Wrong rejection message: %',sqlerrm; end if;
     rejected:=true;
   end;
   assert rejected, 'Unsafe acknowledgement must reject';
   raise sqlstate 'ZX001';
 exception when sqlstate 'ZX001' then null;
 end;
end $$;

do $$ declare p record; begin
 select prosecdef,proconfig,proacl into strict p from pg_proc where oid='public.acknowledge_terminal_creative_review(uuid,timestamptz)'::regprocedure;
 assert p.prosecdef; assert p.proconfig=array['search_path=""'];
 assert has_function_privilege('authenticated','public.acknowledge_terminal_creative_review(uuid,timestamptz)','EXECUTE');
 assert not has_function_privilege('anon','public.acknowledge_terminal_creative_review(uuid,timestamptz)','EXECUTE');
 assert not has_function_privilege('service_role','public.acknowledge_terminal_creative_review(uuid,timestamptz)','EXECUTE');
 assert not exists(select 1 from aclexplode(p.proacl) a where a.grantee=0), 'PUBLIC has no grant';
end $$;
select pg_temp.reject_terminal('', '42501', 'anon');
select pg_temp.reject_terminal('', '42501', 'service_role');
select pg_temp.reject_terminal($m$select set_config('request.jwt.claim.sub','',true)$m$,'42501');
select pg_temp.reject_terminal($m$select set_config('request.jwt.claim.sub',current_setting('terminal.other'),true)$m$,'42501');
select pg_temp.reject_terminal($m$update public.businesses set owner_user_id=current_setting('terminal.other')::uuid where id=current_setting('terminal.business')::uuid$m$,'42501');
select pg_temp.reject_terminal($m$update public.owner_interventions set intervention_type='synthetic_workflow_review' where id=current_setting('terminal.notice')::uuid$m$,'P0001');
select pg_temp.reject_terminal($m$update public.owner_interventions set action_intent_id=current_setting('terminal.intent')::uuid where id=current_setting('terminal.notice')::uuid$m$,'P0001');
select pg_temp.reject_terminal($m$update public.owner_interventions set id=gen_random_uuid() where id=current_setting('terminal.notice')::uuid returning set_config('terminal.notice',id::text,true)$m$,'P0001');
select pg_temp.reject_terminal($m$update public.owner_interventions set workflow_run_id=null where id=current_setting('terminal.notice')::uuid$m$,'42501');
select pg_temp.reject_terminal($m$update public.workflow_runs set workflow_definition_id=(select id from public.workflow_definitions where workflow_key<>'etsy.creative-pipeline' limit 1) where id=current_setting('terminal.run')::uuid$m$,'P0001');
select pg_temp.reject_terminal($m$update public.workflow_definitions set version='99.0.0' where id=(select workflow_definition_id from public.workflow_runs where id=current_setting('terminal.run')::uuid)$m$,'P0001');
select pg_temp.reject_terminal($m$update public.workflow_runs set input=jsonb_set(input,'{creativeRunId}',to_jsonb(gen_random_uuid())) where id=current_setting('terminal.run')::uuid$m$,'P0001');
select pg_temp.reject_terminal($m$update public.workflow_runs set input=jsonb_set(input,'{approvalId}',to_jsonb(gen_random_uuid())) where id=current_setting('terminal.run')::uuid$m$,'P0001');
select pg_temp.reject_terminal($m$update public.workflow_runs set status='running' where id=current_setting('terminal.run')::uuid$m$,'P0001');
select pg_temp.reject_terminal($m$update public.workflow_runs set completed_at=null where id=current_setting('terminal.run')::uuid$m$,'P0001');
select pg_temp.reject_terminal($m$update public.workflow_runs set state='{"productionReady":true,"publicationAllowed":false}' where id=current_setting('terminal.run')::uuid$m$,'P0001');
select pg_temp.reject_terminal($m$update public.workflow_runs set state='{"productionReady":false,"publicationAllowed":true}' where id=current_setting('terminal.run')::uuid$m$,'P0001');
select pg_temp.reject_terminal($m$update public.workflow_runs set state='{}' where id=current_setting('terminal.run')::uuid$m$,'P0001');
select pg_temp.reject_terminal($m$update public.workflow_stage_runs set status='running' where id=current_setting('terminal.stage')::uuid$m$,'P0001');
select pg_temp.reject_terminal($m$update public.workflow_stage_runs set completed_at=null where id=current_setting('terminal.stage')::uuid$m$,'P0001');
select pg_temp.reject_terminal($m$update public.worker_runs set status='running' where id=current_setting('terminal.worker')::uuid$m$,'P0001');
select pg_temp.reject_terminal($m$update public.worker_runs set completed_at=null where id=current_setting('terminal.worker')::uuid$m$,'P0001');
select pg_temp.reject_terminal($m$update public.task_contracts set status='ready' where id=current_setting('terminal.task')::uuid$m$,'P0001');
select pg_temp.reject_terminal($m$update public.action_intents set status='approved' where id=current_setting('terminal.intent')::uuid$m$,'P0001');
select pg_temp.reject_terminal($m$update public.action_intents set status='executing' where id=current_setting('terminal.intent')::uuid$m$,'P0001');
select pg_temp.reject_terminal($m$select set_config('terminal.expected','2026-10-02T08:00:00.123455+00',true)$m$,'P0001');
select pg_temp.reject_terminal($m$update public.owner_interventions set resolution='{"decision":"different"}' where id=current_setting('terminal.notice')::uuid$m$,'P0001');
select pg_temp.reject_terminal($m$update public.owner_interventions set status='resolved',resolved_at=now(),resolution='{"decision":"acknowledge"}' where id=current_setting('terminal.notice')::uuid$m$,'P0001');
do $$ declare state text; begin
 foreach state in array array['pending','waiting','review'] loop
  perform pg_temp.reject_terminal(format('update public.workflow_stage_runs set status=%L where id=current_setting(''terminal.stage'')::uuid',state),'P0001');
 end loop;
 foreach state in array array['draft','running'] loop
  perform pg_temp.reject_terminal(format('update public.task_contracts set status=%L where id=current_setting(''terminal.task'')::uuid',state),'P0001');
 end loop;
 perform pg_temp.reject_terminal('update public.worker_runs set status=''queued'' where id=current_setting(''terminal.worker'')::uuid','P0001');
 perform pg_temp.reject_terminal('update public.action_intents set status=''proposed'' where id=current_setting(''terminal.intent'')::uuid','P0001');
end $$;
set local role authenticated;
do $$ declare rejected boolean:=false; begin
 begin update public.owner_interventions set status='resolved' where id=current_setting('terminal.notice')::uuid; exception when insufficient_privilege then rejected:=true; end;
 assert rejected, 'Direct owner UPDATE still raises 42501';
end $$;
reset role;

-- Inserting the immutable event is part of the same atomic operation.
create function pg_temp.fail_terminal_event() returns trigger language plpgsql as $$ begin
 if new.event_type='owner_intervention.resolved' then raise exception 'injected event insertion failure'; end if; return new;
end $$;
create trigger test_terminal_event before insert on public.events for each row execute function pg_temp.fail_terminal_event();
select pg_temp.reject_terminal('', 'P0001', 'authenticated', 'injected event insertion failure');
do $$ begin
 assert (select status='open' and resolution='{}' and resolved_at is null and updated_at=current_setting('terminal.expected')::timestamptz from public.owner_interventions where id=current_setting('terminal.notice')::uuid);
 assert not exists(select 1 from public.events where workflow_run_id=current_setting('terminal.run')::uuid and event_type='owner_intervention.resolved');
end $$;
drop trigger test_terminal_event on public.events;
select pg_temp.reject_terminal($m$insert into public.events(id,business_id,workflow_run_id,event_type,actor_type,payload)
values(private.stage4_deterministic_uuid('creative:terminal-review-acknowledged:'||current_setting('terminal.notice')),current_setting('terminal.business')::uuid,current_setting('terminal.run')::uuid,'owner_intervention.resolved','system','{}')$m$, '23505');

-- Nonexpired capability is deliberately retained. A stopped run need not wait for expiry.
set local role authenticated;
do $$ declare result jsonb; before_row jsonb; after_row jsonb; original_zone text:=current_setting('TimeZone'); begin
 result:=public.acknowledge_terminal_creative_review(current_setting('terminal.notice')::uuid,current_setting('terminal.expected')::timestamptz);
 assert result->>'outcome'='acknowledged';
 select to_jsonb(i) into before_row from public.owner_interventions i where id=current_setting('terminal.notice')::uuid;
 result:=public.acknowledge_terminal_creative_review(current_setting('terminal.notice')::uuid,current_setting('terminal.expected')::timestamptz);
 assert result->>'outcome'='already_acknowledged';
 select to_jsonb(i) into after_row from public.owner_interventions i where id=current_setting('terminal.notice')::uuid;
 assert before_row=after_row, 'Exact replay never changes timestamp or payload';
 perform set_config('TimeZone','America/New_York',true);
 result:=public.acknowledge_terminal_creative_review(current_setting('terminal.notice')::uuid,current_setting('terminal.expected')::timestamptz);
 assert result->>'outcome'='already_acknowledged', 'Exact replay is independent of session timezone';
 perform set_config('TimeZone',original_zone,true);
 assert (select count(*)=1 from public.events where workflow_run_id=current_setting('terminal.run')::uuid and event_type='owner_intervention.resolved');
end $$;
reset role;
select pg_temp.reject_terminal($m$select set_config('terminal.expected','2026-10-02T08:00:00.123455+00',true)$m$,'P0001');
select pg_temp.reject_terminal($m$update public.owner_interventions set resolution=jsonb_set(resolution,'{actorUserId}',to_jsonb(current_setting('terminal.other'))) where id=current_setting('terminal.notice')::uuid$m$,'P0001');
select pg_temp.reject_terminal($m$update public.businesses set owner_user_id=current_setting('terminal.other')::uuid where id=current_setting('terminal.business')::uuid; select set_config('request.jwt.claim.sub',current_setting('terminal.other'),true)$m$,'P0001');

do $$ declare i public.owner_interventions%rowtype; e public.events%rowtype; begin
 assert (select jsonb_agg(to_jsonb(other_notice) order by other_notice.id) from public.owner_interventions other_notice where other_notice.id<>current_setting('terminal.notice')::uuid)=current_setting('terminal.other_notices')::jsonb, 'Unselected notices unchanged';
 assert (select jsonb_agg(to_jsonb(other_event) order by other_event.id) from public.events other_event where event_type<>'owner_intervention.resolved')=current_setting('terminal.other_events')::jsonb, 'Previous immutable events unchanged';
 assert pg_temp.terminal_snapshot()=current_setting('terminal.before')::jsonb, 'All unrelated tables and capability/cost/receipt bytes unchanged';
 assert (select reported_microusd is null from public.creative_cost_settlements where creative_run_id=current_setting('terminal.creative')::uuid), 'Unknown cost remains unknown';
 select * into strict i from public.owner_interventions where id=current_setting('terminal.notice')::uuid;
 select * into strict e from public.events where id=private.stage4_deterministic_uuid('creative:terminal-review-acknowledged:'||i.id);
 assert i.resolution->>'version'='terminal-creative-review-acknowledgement-v1';
 assert i.resolution->>'decision'='acknowledge'; assert i.resolution->'executionResumed'='false';
 assert i.resolution->'newSpendAuthorized'='false'; assert i.resolution->'costsReconciled'='false';
 assert e.payload=i.resolution and e.actor_id=current_setting('terminal.owner') and e.occurred_at=i.resolved_at;
 begin update public.events set payload='{}' where id=e.id; assert false,'Event mutation must reject'; exception when raise_exception then null; end;
end $$;
rollback;
