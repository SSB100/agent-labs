-- OFFLINE v2 budget RPC regression. Synthetic metadata only, no HTTP/model call.
-- Shares explicit setup with the foundation suite so it runs independently.
-- OFFLINE administrator-only regression for the v2 FOUNDATION, not live evidence.
-- Synthetic definitions below are never executed, qualified, or committed.
-- Complete terminal validation and runtime integration are deliberately unavailable.
begin;
select set_config('stage13v2.owner',gen_random_uuid()::text,true);
select set_config('stage13v2.other',gen_random_uuid()::text,true);
select set_config('stage13v2.business',gen_random_uuid()::text,true);
select set_config('stage13v2.foreign',gen_random_uuid()::text,true);
insert into auth.users(id,email) values(current_setting('stage13v2.owner')::uuid,'v2-foundation-owner@example.invalid'),(current_setting('stage13v2.other')::uuid,'v2-foundation-other@example.invalid');
insert into public.businesses(id,owner_user_id,name) values
  (current_setting('stage13v2.business')::uuid,current_setting('stage13v2.owner')::uuid,'V2 foundation synthetic owner'),
  (current_setting('stage13v2.foreign')::uuid,current_setting('stage13v2.other')::uuid,'V2 foundation foreign owner');

-- A synthetic registered definition enables private structural validation only.
-- There is intentionally no public qualified or experimental launch lane here.
do $$ declare manifest jsonb; pack_id uuid; workflows jsonb:='[]'; key text; stages jsonb; begin
  foreach key in array array['product.discovery-v2.one','product.discovery-v2.two'] loop
    stages:=(case when key='product.discovery-v2.one' then '[{"key":"plan"},{"key":"research1"},{"key":"strategy"},{"key":"review"}]'::jsonb
      else '[{"key":"plan"},{"key":"research1"},{"key":"research2"},{"key":"strategy"},{"key":"review"}]'::jsonb end);
    workflows:=workflows||jsonb_build_array(jsonb_build_object('key',key,'version','1.0.0','name','Synthetic v2 definition only','description','Never executed foundation fixture',
      'inputSchema','{}'::jsonb,'outputSchema','{}'::jsonb,'stages',stages));
  end loop;
  manifest:=jsonb_build_object('frameworkVersion','1.0','packKey','fixture.discovery-v2-foundation','version','1.0.0','kind','workflow','name','Synthetic foundation registry',
    'dependencies','[]'::jsonb,'evals',jsonb_build_array('fixture-only'),'capabilities','[]'::jsonb,'knowledge','[]'::jsonb,'workers','[]'::jsonb,'workflows',workflows);
  pack_id:=private.stage10_register_pack(manifest);
  perform set_config('stage13v2.pack',pack_id::text,true);
end; $$;

create function pg_temp.v2_foundation_root(p_business uuid,p_collections integer default 1,p_intent_override jsonb default '{}',p_quote_override jsonb default '{}') returns uuid
language plpgsql security definer set search_path='' as $$
declare root_id uuid:=gen_random_uuid(); run_id uuid:=gen_random_uuid(); installation_id uuid; definition_id uuid; intent jsonb; quote jsonb; manifest jsonb; workflow jsonb; snapshot jsonb; ceilings jsonb;
begin
  select p.manifest into manifest from public.packs p where p.id=current_setting('stage13v2.pack')::uuid;
  select value into workflow from jsonb_array_elements(manifest->'workflows') where value->>'key'=(case p_collections when 1 then 'product.discovery-v2.one' else 'product.discovery-v2.two' end);
  snapshot:=jsonb_build_object('rootPackId',current_setting('stage13v2.pack'),'releases',jsonb_build_array(jsonb_build_object('id',current_setting('stage13v2.pack'),'status','experimental','manifest',manifest)),'workflow',workflow);
  select id into installation_id from public.installed_packs where business_id=p_business and root_pack_id=current_setting('stage13v2.pack')::uuid;
  if installation_id is null then
    insert into public.installed_packs(business_id,root_pack_id,root_pack_key,status,snapshot)
      values(p_business,current_setting('stage13v2.pack')::uuid,'fixture.discovery-v2-foundation','active',snapshot-'workflow') returning id into installation_id;
  end if;
  select id into definition_id from public.workflow_definitions where pack_id=current_setting('stage13v2.pack')::uuid and workflow_key=workflow->>'key';
  intent:=jsonb_build_object('version','pod-discovery-2.0','id',root_id,'businessId',p_business,'objective','Compare a bounded set of geographic starting markets for original shirts using retained evidence.',
    'comparisonUniverse',jsonb_build_object('productType','original_pod_tshirt','markets','[{"countryCode":"US","currency":"USD"},{"countryCode":"GB","currency":"GBP"}]'::jsonb,
      'audiences',jsonb_build_array('Adult original-art buyers'),'sourceDomains',jsonb_build_array('etsy.com','printful.com'),'selectionQuestion','Which of these two geographic starting markets has the best evidence for a bounded learning test?'),
    'limits',jsonb_build_object('maximumAlternatives',3,'maximumNewCollections',p_collections,'maximumMicrousd',1000000,'maximumGenerations',1),'expiresAt',now()+interval '1 day')||p_intent_override;
  ceilings:=(case p_collections when 1 then '{"plan:1":1000,"search:1":1000,"select:1":1000,"strategy:1":1000,"review:1":1000}'::jsonb
    else '{"plan:1":1000,"search:1":1000,"select:1":1000,"search:2":1000,"select:2":1000,"strategy:1":1000,"review:1":1000}'::jsonb end);
  quote:=jsonb_build_object('version','discovery-estimate-2.0','intentId',root_id,'policyHash',private.stage14_hash(intent),'maximumCollections',p_collections,
    'maximumCalls',(case p_collections when 1 then 5 else 7 end),'maximumEstimateMicrousd',(case p_collections when 1 then 5000 else 7000 end),'ceilings',ceilings,
    'directorModel','openai/gpt-5.6-luna','reviewerModel','anthropic/claude-haiku-4.5','verifiedAt',now(),
    'sourceUrls','["https://openrouter.ai/api/v1/models","https://openrouter.ai/docs/guides/features/server-tools/web-search"]'::jsonb,
    'primaryOnly',true,'estimateOnly',true,'providerInvoiceGuarantee',false)||p_quote_override;
  insert into public.workflow_runs(id,business_id,workflow_definition_id,status,idempotency_key,input,pack_installation_id,pack_snapshot,runtime_capability_hash)
    values(run_id,p_business,definition_id,'queued','v2-fixture:'||root_id,jsonb_build_object('intentId',root_id),installation_id,snapshot,private.stage13_hash(repeat('synthetic-v2-capability-',3)));
  insert into public.product_experiments(id,business_id,candidate_id,workflow_run_id,fingerprint,hypothesis,variables,audience,status,measurement_plan,discovery_version)
    values(root_id,p_business,null,run_id,private.stage13_hash('v2-fixture:'||root_id),'Synthetic foundation research intent, not a product candidate.',
      jsonb_build_object('intent',intent,'policyHash',private.stage14_hash(intent),'budgetQuote',quote,'budgetAuthorityRootId',root_id),'Bounded geographic comparison','reserved','{"version":"pod-discovery-2.0","testPlan":null}','pod-discovery-2.0');
  return root_id;
end; $$;
create function pg_temp.v2_foundation_child(p_root uuid,p_candidate uuid,p_business uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare root public.product_experiments%rowtype; candidate public.product_candidates%rowtype; id uuid:=gen_random_uuid(); identity jsonb;
begin
  select * into strict root from public.product_experiments where product_experiments.id=p_root;
  select * into strict candidate from public.product_candidates where product_candidates.id=p_candidate;
  identity:=jsonb_build_object('id',candidate.id,'businessId',candidate.business_id,'concept',candidate.concept,'audience',candidate.audience,
    'productType',candidate.product_type,'originalDesign',candidate.original_design,'rightsStatus',candidate.rights_status);
  insert into public.product_experiments(id,business_id,candidate_id,workflow_run_id,fingerprint,hypothesis,variables,audience,status,measurement_plan,discovery_version,parent_discovery_id)
    values(id,coalesce(p_business,root.business_id),candidate.id,root.workflow_run_id,private.stage13_hash('v2-child:'||id),candidate.hypothesis,
      jsonb_build_object('intentId',root.id,'identity',identity),candidate.audience,'reserved','{"version":"pod-discovery-2.0","testPlan":null}','pod-discovery-2.0',root.id);
  return id;
end; $$;

create function pg_temp.v2_budget_prepare(p_root uuid,p_key text) returns void language plpgsql security definer set search_path='' as $$
declare e public.product_experiments%rowtype; stage_id uuid:=gen_random_uuid(); task_id uuid:=gen_random_uuid(); worker_id uuid; artifact_id uuid; sequence integer; content jsonb;
begin
  select * into strict e from public.product_experiments where id=p_root;
  select id into strict worker_id from public.worker_definitions order by created_at,id limit 1;
  sequence:=(case p_key when 'plan' then 1 when 'research1' then 2 when 'research2' then 3 when 'strategy' then 4 else 5 end);
  insert into public.workflow_stage_runs(id,business_id,workflow_run_id,stage_key,sequence,attempt,status) values(stage_id,e.business_id,e.workflow_run_id,p_key,sequence,1,'running');
  artifact_id:=private.stage4_deterministic_uuid('pack:input:'||e.workflow_run_id||':'||p_key);
  content:=(case when p_key like 'research%' then jsonb_build_object('question','Bounded synthetic geographic research question for regression.','sourceDomains',jsonb_build_array('etsy.com'),
    'queryId',private.stage4_deterministic_uuid('discovery:v2:query:'||e.id||':'||right(p_key,1))) else jsonb_build_object('intentId',e.id) end);
  insert into public.artifacts(id,business_id,workflow_run_id,artifact_type,name,content) values(artifact_id,e.business_id,e.workflow_run_id,'pack.stage-input','Synthetic budget stage input',content);
  insert into public.task_contracts(id,business_id,workflow_run_id,workflow_stage_run_id,worker_definition_id,status,objective,input_artifact_ids)
    values(task_id,e.business_id,e.workflow_run_id,stage_id,worker_id,'running','Synthetic finite discovery budget regression',array[artifact_id]);
  insert into public.worker_runs(business_id,workflow_run_id,task_contract_id,worker_definition_id,status,input)
    values(e.business_id,e.workflow_run_id,task_id,worker_id,'running','{}');
end; $$;
create function pg_temp.v2_budget_estimate(p_root uuid,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.product_experiments%rowtype; kind text:=split_part(p_key,':',1); it integer; ot integer; amount integer; query jsonb;
begin
  select * into strict e from public.product_experiments where id=p_root;
  it:=(case kind when 'search' then 128000 else 8193 end);
  ot:=(case kind when 'plan' then 1500 when 'search' then 8000 when 'select' then 1000 when 'strategy' then 5000 else 4000 end);
  amount:=ceil(it*0.01+ot*0.001+(case kind when 'search' then 7000 else 0 end))::integer;
  query:=(case when kind='search' then jsonb_build_object('query','Bounded synthetic geographic research question for regression.','allowedDomains',jsonb_build_array('etsy.com')) else 'null'::jsonb end);
  return jsonb_build_object('version','discovery-estimate-2.0','intentId',e.id,'policyHash',e.variables->>'policyHash','maximumCollections',e.variables->'intent'->'limits'->'maximumNewCollections',
    'maximumMicrousd',e.variables->'intent'->'limits'->'maximumMicrousd','callKey',p_key,'requestBytes',1,'inputTokenAllowance',it,'outputTokenAllowance',ot,'reservedMicrousd',amount,
    'quote',jsonb_build_object('modelId',(case p_key when 'review:1' then 'anthropic/claude-haiku-4.5' else 'openai/gpt-5.6-luna' end),'verifiedAt',now(),'source','https://openrouter.ai/api/v1/models','inputPerMillion',0.01,'outputPerMillion',0.001,'cacheWritePerMillion',0),
    'researchRequest',query,'primaryOnly',true,'estimateOnly',true,'providerInvoiceGuarantee',false);
end; $$;
select set_config('request.jwt.claim.sub',current_setting('stage13v2.owner'),true);
do $$
declare b uuid:=current_setting('stage13v2.business')::uuid; root uuid; r uuid; estimate jsonb; invalid jsonb; result jsonb; denied boolean; source_id uuid;
  cap text:=repeat('synthetic-v2-capability-',3); hash text:=repeat('a',64); amount integer;
begin
  root:=pg_temp.v2_foundation_root(b,1,'{}','{"ceilings":{"plan:1":20000,"search:1":20000,"select:1":20000,"strategy:1":20000,"review:1":20000},"maximumEstimateMicrousd":100000}');
  select workflow_run_id into r from public.product_experiments where id=root;
  update public.workflow_runs set status='running' where id=r;
  update public.product_experiments set status='researching' where id=root;
  perform pg_temp.v2_budget_prepare(root,'plan');
  estimate:=pg_temp.v2_budget_estimate(root,'plan:1'); amount:=(estimate->>'reservedMicrousd')::integer;
  denied:=false; begin perform public.reserve_product_research_cost(r,b,'wrong-capability-is-deliberately-longer-than-32','plan:1',amount,hash,estimate); exception when insufficient_privilege then denied:=true; end;
  assert denied,'A caller cannot choose a discovery budget without its exact run capability';
  denied:=false; begin perform public.reserve_product_research_cost(r,current_setting('stage13v2.foreign')::uuid,cap,'plan:1',amount,hash,estimate); exception when insufficient_privilege then denied:=true; end;
  assert denied,'Same capability cannot cross the persisted Business boundary';
  result:=public.reserve_product_research_cost(r,b,cap,'plan:1',amount,hash,estimate);
  assert result->'shouldCall'='true' and result->'totalReservedMicrousd'=to_jsonb(amount),'Exact first-phase quote is reserved atomically';
  assert public.reserve_product_research_cost(r,b,cap,'plan:1',amount,hash,estimate)->'shouldCall'='false','Exact replay cannot dispatch twice';
  denied:=false; begin perform public.reserve_product_research_cost(r,b,cap,'plan:1',amount,hash,estimate||'{"primaryOnly":false}'); exception when others then denied:=true; end;
  assert denied,'Same request hash cannot rewrite an immutable quote';
  estimate:=pg_temp.v2_budget_estimate(root,'search:1');
  denied:=false; begin perform public.reserve_product_research_cost(r,b,cap,'search:1',(estimate->>'reservedMicrousd')::integer,hash,estimate); exception when others then denied:=true; end;
  assert denied,'Unsettled earlier attempt blocks every next call';
  perform public.record_product_research_cost(r,b,cap,'plan:1',null,null);
  denied:=false; begin perform public.reserve_product_research_cost(r,b,cap,'search:1',(estimate->>'reservedMicrousd')::integer,hash,estimate); exception when others then denied:=true; end;
  assert denied,'Explicit unknown receipt keeps the reservation and stops progress';
  perform public.record_product_research_cost(r,b,cap,'plan:1',amount,'v2-budget-plan-actual');
  assert public.record_product_research_cost(r,b,cap,'plan:1',amount,'v2-budget-plan-actual')->'cached'='true','Exact known settlement is idempotent';
  denied:=false; begin perform public.record_product_research_cost(r,b,cap,'plan:1',amount+1,'v2-budget-plan-actual'); exception when others then denied:=true; end;
  assert denied,'A known receipt cannot be rewritten';
  denied:=false; begin perform public.reserve_product_research_cost(r,b,cap,'search:1',(estimate->>'reservedMicrousd')::integer,hash,estimate); exception when others then denied:=true; end;
  assert denied,'A known charge does not bypass prepared-stage ordering';
  update public.workflow_stage_runs set status='completed' where workflow_run_id=r and stage_key='plan';
  update public.task_contracts set status='completed' where workflow_run_id=r;
  update public.worker_runs set status='completed' where workflow_run_id=r;
  perform pg_temp.v2_budget_prepare(root,'research1');
  for invalid in select value from jsonb_array_elements(jsonb_build_array(
    estimate-'researchRequest',jsonb_set(estimate,'{maximumMicrousd}','999999'),jsonb_set(estimate,'{policyHash}',to_jsonb(repeat('f',64))),
    jsonb_set(estimate,'{maximumCollections}','2'),jsonb_set(estimate,'{quote,modelId}','"anthropic/claude-haiku-4.5"'),
    jsonb_set(estimate,'{inputTokenAllowance}','127999'),jsonb_set(estimate,'{outputTokenAllowance}','4000'),
    jsonb_set(estimate,'{requestBytes}','8193'),jsonb_set(estimate,'{researchRequest,query}','"A substituted research question"'),
    jsonb_set(estimate,'{researchRequest,allowedDomains}','["attacker.invalid"]'),
    jsonb_set(estimate,'{quote,verifiedAt}',to_jsonb(now()-interval '6 minutes')),
    jsonb_set(estimate,'{quote,extraFee}','0.1'),estimate||'{"providerFallback":true}')) loop
    denied:=false; begin perform public.reserve_product_research_cost(r,b,cap,'search:1',(invalid->>'reservedMicrousd')::integer,hash,invalid); exception when others then denied:=true; end;
    assert denied,'Changed scope, model, allowances, query, domains, freshness or unknown fees must fail closed';
  end loop;
  denied:=false; begin perform public.reserve_product_research_cost(r,b,cap,'search:1',(estimate->>'reservedMicrousd')::integer-1,hash,jsonb_set(estimate,'{reservedMicrousd}',to_jsonb((estimate->>'reservedMicrousd')::integer-1))); exception when others then denied:=true; end;
  assert denied,'SQL recomputes the exact quoted reservation rather than trusting the supplied amount';
  result:=public.reserve_product_research_cost(r,b,cap,'search:1',(estimate->>'reservedMicrousd')::integer,hash,estimate);
  assert result->'shouldCall'='true','Exact persisted source scope may consume its single search slot';
  denied:=false; begin perform public.record_product_research_cost(r,b,cap,'search:1',1,'v2-budget-plan-actual'); exception when others then denied:=true; end;
  assert denied,'Separate paid phases cannot reuse one provider request identity';
  perform public.record_product_research_cost(r,b,cap,'search:1',(estimate->>'reservedMicrousd')::integer,'v2-budget-search-actual');
  estimate:=pg_temp.v2_budget_estimate(root,'select:1');
  denied:=false; begin perform public.reserve_product_research_cost(r,b,cap,'select:1',(estimate->>'reservedMicrousd')::integer,hash,estimate); exception when others then denied:=true; end;
  assert denied,'Selector cannot execute before immutable receipt-backed sources exist';
  source_id:=private.stage4_deterministic_uuid('research:sources:'||r||':research1');
  insert into public.artifacts(id,business_id,workflow_run_id,artifact_type,name,content)
    values(source_id,b,r,'research.sources','Synthetic receipt linkage only',jsonb_build_object('providerMetadata',jsonb_build_object('intentId',root,'callKey','search:1',
      'queryId',private.stage4_deterministic_uuid('discovery:v2:query:'||root||':1'),'providerRequestId','v2-budget-search-actual')));
  assert public.reserve_product_research_cost(r,b,cap,'select:1',(estimate->>'reservedMicrousd')::integer,hash,estimate)->'shouldCall'='true';
  perform public.record_product_research_cost(r,b,cap,'select:1',null,null);
  invalid:=pg_temp.v2_budget_estimate(root,'search:2');
  denied:=false; begin perform public.reserve_product_research_cost(r,b,cap,'search:2',(invalid->>'reservedMicrousd')::integer,hash,invalid); exception when others then denied:=true; end;
  assert denied,'One-collection scope never gains a second search';
  update public.workflow_runs set status='failed' where id=r;
  update public.product_experiments set status='failed',failure='Synthetic stopped selector',completed_at=now() where id=root;
  perform public.record_product_research_cost(r,b,cap,'select:1',500,'v2-budget-selector-late');
  assert (select status='failed' from public.product_experiments where id=root),'Late receipt reconciliation never reopens a failed root';
  assert private.stage13_committed_cost(root)>=500,'Known late costs remain committed';
  invalid:=pg_temp.v2_budget_estimate(root,'strategy:1');
  denied:=false; begin perform public.reserve_product_research_cost(r,b,cap,'strategy:1',(invalid->>'reservedMicrousd')::integer,hash,invalid); exception when others then denied:=true; end;
  assert denied,'Late reconciliation cannot authorize further provider work';
end; $$;
rollback;
