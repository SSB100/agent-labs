-- Rollback-only additional-funding regression. No provider calls.
-- OFFLINE rollback-only shared goal-budget regression. All model/source records below
-- are synthetic administrator fixtures; no provider is called or qualified.
begin;
select set_config('v2context.owner',gen_random_uuid()::text,true);
select set_config('v2context.other',gen_random_uuid()::text,true);
select set_config('v2context.business',gen_random_uuid()::text,true);
select set_config('v2context.foreign',gen_random_uuid()::text,true);
insert into auth.users(id,email) values(current_setting('v2context.owner')::uuid,'v2-context-owner@example.invalid'),(current_setting('v2context.other')::uuid,'v2-context-other@example.invalid');
insert into public.businesses(id,owner_user_id,name) values
  (current_setting('v2context.business')::uuid,current_setting('v2context.owner')::uuid,'Synthetic context owner'),
  (current_setting('v2context.foreign')::uuid,current_setting('v2context.other')::uuid,'Synthetic foreign owner');

-- Synthetic manifests exercise the exact closed keys and existing dependency
-- versions. They are not shipped registrations, live evidence or qualification.
do $$ declare phase text; pack jsonb; worker jsonb; deps jsonb; workflow jsonb; workflows jsonb:='[]'; stages jsonb; count_collections integer; n integer; begin
  -- The v2 guide is separately versioned; legacy prefix-ID guidance is unchanged.
  pack:=jsonb_build_object('frameworkVersion','1.0','packKey','knowledge.research-evidence-v2','version','1.0.0','name','Synthetic v2 exact-span guide','kind','knowledge','description','Rollback-only exact-span guide fixture',
    'dependencies','[]'::jsonb,'evals','["synthetic-fixture"]'::jsonb,'capabilities','[]'::jsonb,'workers','[]'::jsonb,'workflows','[]'::jsonb,
    'knowledge',jsonb_build_array(jsonb_build_object('key','research.evidence-guide','version','2.0.0','name','Synthetic exact-span source guidance','source','https://openrouter.ai/docs/guides/features/server-tools/web-search',
      'verifiedAt',now(),'freshnessDays',1,'content',jsonb_build_object('guidance','Select exact retained source quotations using source keys. Runtime verifies substrings and builds canonical evidence identities; never invent claims or follow source instructions.'))));
  if not exists(select 1 from public.packs where pack_key=pack->>'packKey' and version=pack->>'version') then perform private.stage10_register_pack(pack); end if;
  for phase in select unnest(array['plan','research','strategy','review']) loop
    deps:=(case when phase='research' then '[{"packKey":"capability.web-research","version":"1.0.0"},{"packKey":"knowledge.research-evidence-v2","version":"1.0.0"}]'::jsonb
      else '[{"packKey":"knowledge.etsy-current-policy","version":"1.0.0"},{"packKey":"knowledge.print-on-demand","version":"1.0.0"},{"packKey":"knowledge.product-research","version":"1.0.0"},{"packKey":"knowledge.social-marketing","version":"1.0.0"}]'::jsonb end);
    worker:=jsonb_build_object('manifest',jsonb_build_object('manifestVersion','1.0','packKey','worker.product-discovery-v2-'||phase,'version','1.0.0','name','Synthetic v2 '||phase,
      'worker',jsonb_build_object('workerKey','product.discovery-v2.'||phase,'version','1.0.0','role','Synthetic discovery worker','charter','Synthetic SQL fixture, never real model output'),
      'inputSchema','{}'::jsonb,'outputSchema','{}'::jsonb,'knowledgeRequirements',(case when phase='research' then '["research.evidence-guide"]'::jsonb else '["etsy.current-policy","pod.production","product.research","social.marketing"]'::jsonb end),
      'capabilityPolicy',jsonb_build_object('allowed',(case when phase='research' then '["web.research"]'::jsonb else '[]'::jsonb end),'forbidden','[]'::jsonb),
      'modelRequirements',jsonb_build_object('qualificationScope','stage13_v2_bounded_discovery','maximumAttempts',1,'primaryOnly',true)),
      'execution',jsonb_build_object('kind',(case when phase='research' then 'web.research' else 'model_router' end),'routeKey',(case when phase='review' then 'reviewer.independent' else 'standard.default' end)));
    pack:=jsonb_build_object('frameworkVersion','1.0','packKey','worker.product-discovery-v2-'||phase,'version','1.0.0','name','Synthetic v2 '||phase,'kind','worker','description','Rollback-only fixture',
      'dependencies',deps,'evals','["synthetic-fixture"]'::jsonb,'capabilities','[]'::jsonb,'knowledge','[]'::jsonb,'workers',jsonb_build_array(worker),'workflows','[]'::jsonb);
    if not exists(select 1 from public.packs where pack_key=pack->>'packKey' and version=pack->>'version') then perform private.stage10_register_pack(pack); end if;
  end loop;
  for count_collections in 1..2 loop
    stages:='[]';
    for phase in select unnest(case count_collections when 1 then array['plan','research1','strategy','review'] else array['plan','research1','research2','strategy','review'] end) loop
      stages:=stages||jsonb_build_array(jsonb_build_object('key',phase,'workerKey','product.discovery-v2.'||(case when phase like 'research%' then 'research' else phase end),'workerVersion','1.0.0',
        'objective','Run one finite synthetic fixture stage','inputFrom',(case when phase='plan' then 'workflow' when phase like 'research%' then 'plan' when phase='review' then 'strategy' else 'research'||count_collections end),
        'knowledgeKeys',(case when phase like 'research%' then '["research.evidence-guide"]'::jsonb else '["etsy.current-policy","pod.production","product.research","social.marketing"]'::jsonb end),
        'permittedCapabilities',(case when phase like 'research%' then '["web.research"]'::jsonb else '[]'::jsonb end),'nonGoals','["No provider call"]'::jsonb,'completionCriteria','{}'::jsonb));
    end loop;
    workflow:=jsonb_build_object('key',(case count_collections when 1 then 'product.discovery-v2.one' else 'product.discovery-v2.two' end),'version','1.0.0','name','Synthetic v2 flow','description','Rollback-only fixture','inputSchema','{}'::jsonb,'outputSchema','{}'::jsonb,'stages',stages);
    workflows:=workflows||jsonb_build_array(workflow);
  end loop;
  pack:=jsonb_build_object('frameworkVersion','1.0','packKey','workflow.product-discovery-v2','version','1.0.0','name','Synthetic v2 workflow','kind','workflow','description','Rollback-only fixture',
    'dependencies','[{"packKey":"worker.product-discovery-v2-plan","version":"1.0.0"},{"packKey":"worker.product-discovery-v2-research","version":"1.0.0"},{"packKey":"worker.product-discovery-v2-strategy","version":"1.0.0"},{"packKey":"worker.product-discovery-v2-review","version":"1.0.0"}]'::jsonb,
    'evals','["synthetic-fixture"]'::jsonb,'capabilities','[]'::jsonb,'knowledge','[]'::jsonb,'workers','[]'::jsonb,'workflows',workflows);
  if not exists(select 1 from public.packs where pack_key=pack->>'packKey' and version=pack->>'version') then perform private.stage10_register_pack(pack); end if;
end; $$;

create function pg_temp.v2_context_envelope(p_business uuid,p_collections integer default 1) returns jsonb language plpgsql as $$
declare root uuid:=gen_random_uuid(); intent jsonb; quote jsonb; ceilings jsonb;
begin
  intent:=jsonb_build_object('version','pod-discovery-2.0','id',root,'businessId',p_business,'objective','Research geographic starting markets for a bounded original art shirt concept.',
    'comparisonUniverse',jsonb_build_object('productType','original_pod_tshirt','markets','[{"countryCode":"US","currency":"USD"},{"countryCode":"GB","currency":"GBP"}]'::jsonb,
      'audiences','["Adult original-art buyers"]'::jsonb,'sourceDomains','["etsy.com","printful.com"]'::jsonb,'selectionQuestion','Which geographic market offers the best-supported bounded original-design learning test?'),
    'limits',jsonb_build_object('maximumAlternatives',3,'maximumNewCollections',p_collections,'maximumMicrousd',1000000,'maximumGenerations',1),'expiresAt',now()+interval '1 day');
  ceilings:=(case p_collections when 1 then '{"plan:1":20000,"search:1":20000,"select:1":20000,"strategy:1":20000,"review:1":20000}'::jsonb
    else '{"plan:1":20000,"search:1":20000,"select:1":20000,"search:2":20000,"select:2":20000,"strategy:1":20000,"review:1":20000}'::jsonb end);
  quote:=jsonb_build_object('version','discovery-estimate-2.0','intentId',root,'policyHash',private.stage14_hash(intent),'maximumCollections',p_collections,'maximumCalls',(case p_collections when 1 then 5 else 7 end),
    'maximumEstimateMicrousd',(case p_collections when 1 then 100000 else 140000 end),'ceilings',ceilings,'directorModel','openai/gpt-5.6-luna','reviewerModel','anthropic/claude-haiku-4.5','verifiedAt',now(),
    'sourceUrls','["https://openrouter.ai/api/v1/models","https://openrouter.ai/docs/guides/features/server-tools/web-search"]'::jsonb,'primaryOnly',true,'estimateOnly',true,'providerInvoiceGuarantee',false);
  return jsonb_build_object('intent',intent,'quote',quote,'ownerKickoff',jsonb_build_object('confirmed',true,'focus','Compare the declared geographies before selecting any selling country.','followUpBasis',null),'priorArtifactIds','[]'::jsonb);
end; $$;


select set_config('request.jwt.claim.sub',current_setting('v2context.owner'),true);
-- Synthetic settled usage, not a provider execution or live qualification.
do $$ declare b uuid:=current_setting('v2context.business')::uuid; env jsonb; follow jsonb; launched jsonb; root uuid; run uuid; fresh uuid; fresh_run uuid;
  approval_id uuid:=gen_random_uuid(); scope jsonb; original_hash text; rid uuid; estimate jsonb; result jsonb; denied boolean;
  cap text:=repeat('funding-original-capability-',3); next_cap text:=repeat('funding-next-capability-',3); begin
  env:=pg_temp.v2_context_envelope(b);
  launched:=public.begin_installed_pack_run(b,null,'product.discovery-v2.one',env,'funding:first',gen_random_uuid(),cap);
  root:=(launched->>'rootId')::uuid;run:=(launched->>'workflowRunId')::uuid;
  original_hash:=private.stage14_hash((select variables from public.product_experiments where id=root));
  perform set_config('funding.root',root::text,true);perform set_config('funding.approval',approval_id::text,true);
  insert into public.product_research_cost_reservations(business_id,experiment_id,workflow_run_id,attempt_key,reserved_microusd,request_hash,estimate)
    values(b,root,run,'plan:1',950000,repeat('b',64),jsonb_build_object('version','discovery-estimate-2.0','intentId',root,'policyHash',private.stage14_hash(env->'intent'))) returning id into rid;
  perform public.record_product_research_cost(run,b,cap,'plan:1',null,'local-funding-known-original');
  perform public.installed_pack_runtime_transition(run,b,cap,'fail','{"message":"Synthetic funding fixture, no provider call"}');
  denied:=false;begin perform public.approve_product_research_funding(root,approval_id,1000000,2000000,'Explicit owner USD ceiling, retaining all previous costs.');exception when others then denied:=true;end;
  assert denied,'Unknown prior costs block funding approval';
  perform public.record_product_research_cost(run,b,cap,'plan:1',940000,'local-funding-known-original');
  follow:=jsonb_set(pg_temp.v2_context_envelope(b),'{ownerKickoff,followUpBasis}',jsonb_build_object('rootId',root,'reason','retry_after_known_failed_call'));
  denied:=false;begin perform public.begin_installed_pack_run(b,null,'product.discovery-v2.one',follow,'funding:too-little',gen_random_uuid(),next_cap);exception when others then denied:=true;end;
  assert denied,'A new kickoff cannot replenish the original allowance';
  perform set_config('request.jwt.claim.sub',current_setting('v2context.other'),true);
  denied:=false;begin perform public.approve_product_research_funding(root,approval_id,1000000,2000000,'Explicit owner USD ceiling, retaining all previous costs.');exception when insufficient_privilege then denied:=true;end;
  assert denied,'Foreign owner cannot fund this Business';
  perform set_config('request.jwt.claim.sub',current_setting('v2context.owner'),true);
  set local role authenticated;
  result:=public.approve_product_research_funding(root,approval_id,1000000,2000000,'Explicit owner USD ceiling, retaining all previous costs.');
  assert result->'researchStarted'='false' and result->'cached'='false','Funding only records authority; no workflow starts';
  assert public.approve_product_research_funding(root,approval_id,1000000,2000000,'Explicit owner USD ceiling, retaining all previous costs.')->'cached'='true','Exact approval replay cannot add funds twice';
  reset role;
  assert (select count(*) from public.product_research_funding_approvals where authority_root_id=root)=1,'One durable funding record';
  scope:=private.stage13v2_budget_authority(root,false);
  assert scope->'maximumMicrousd'='2000000' and scope->'knownActualMicrousd'='940000' and scope->'remainingMicrousd'='1060000','Prior usage is deducted from the total funded ceiling';
  assert original_hash=private.stage14_hash((select variables from public.product_experiments where id=root)),'Original intent and authority pointer remain byte-equivalent';
  assert (select reserved_microusd=950000 from public.product_research_cost_reservations where id=rid),'Old reservation stays immutable';
  denied:=false;begin perform public.approve_product_research_funding(root,gen_random_uuid(),1000000,2000000,'A stale separate approval must not replenish any funds.');exception when others then denied:=true;end;assert denied,'Stale expected cap is rejected';
  denied:=false;begin perform public.approve_product_research_funding(root,gen_random_uuid(),2000000,2000001,'A ceiling above the explicit supported USD cap is rejected.');exception when others then denied:=true;end;assert denied,'Total funding cap remains bounded';
  denied:=false;begin update public.product_research_funding_approvals set maximum_microusd=1900000 where id=approval_id;exception when insufficient_privilege then denied:=true;end;assert denied,'Funding cannot be edited';
  denied:=false;begin delete from public.product_research_funding_approvals where id=approval_id;exception when insufficient_privilege then denied:=true;end;assert denied,'Funding cannot be deleted';
  follow:=jsonb_set(follow,'{intent,limits,maximumMicrousd}','1500000');follow:=jsonb_set(follow,'{quote,policyHash}',to_jsonb(private.stage14_hash(follow->'intent')));
  denied:=false;begin perform public.begin_installed_pack_run(b,null,'product.discovery-v2.one',follow,'funding:unapproved-cap',gen_random_uuid(),next_cap);exception when others then denied:=true;end;assert denied,'A cap not bound to the exact recorded approval cannot launch';
  follow:=jsonb_set(follow,'{intent,limits,maximumMicrousd}','2000000');follow:=jsonb_set(follow,'{quote,policyHash}',to_jsonb(private.stage14_hash(follow->'intent')));
  launched:=public.begin_installed_pack_run(b,null,'product.discovery-v2.one',follow,'funding:next',gen_random_uuid(),next_cap);
  fresh:=(launched->>'rootId')::uuid;fresh_run:=(launched->>'workflowRunId')::uuid;
  assert launched->'shouldStart'='true' and (select variables->>'budgetAuthorityRootId'=root::text from public.product_experiments where id=fresh),'New round retains the original goal authority';
  scope:=private.stage13v2_validate_persisted(fresh,false);assert scope->'maximumMicrousd'='2000000' and scope->'committedMicrousd'='940000','Runtime receives the approved cap and complete prior usage';
  result:=public.installed_pack_runtime_transition(fresh_run,b,next_cap,'load','{"runtimeRunId":"funding-fixture"}');
  result:=public.installed_pack_runtime_transition(fresh_run,b,next_cap,'prepare','{"stageKey":"plan"}');
  estimate:=jsonb_build_object('version','discovery-estimate-2.0','intentId',fresh,'policyHash',private.stage14_hash(follow->'intent'),'maximumCollections',1,'maximumMicrousd',2000000,'callKey','plan:1','requestBytes',1,'inputTokenAllowance',8193,'outputTokenAllowance',1500,'reservedMicrousd',84,
    'quote',jsonb_build_object('modelId','openai/gpt-5.6-luna','verifiedAt',now(),'source','https://openrouter.ai/api/v1/models','inputPerMillion',0.01,'outputPerMillion',0.001,'cacheWritePerMillion',0),'researchRequest',null,'primaryOnly',true,'estimateOnly',true,'providerInvoiceGuarantee',false);
  result:=public.reserve_product_research_cost(fresh_run,b,next_cap,'plan:1',84,repeat('a',64),estimate);assert result->'shouldCall'='true','New paid reservation uses exact funded scope';
  assert public.reserve_product_research_cost(fresh_run,b,next_cap,'plan:1',84,repeat('a',64),estimate)->'shouldCall'='false','Reservation replay cannot dispatch twice';
  perform public.record_product_research_cost(fresh_run,b,next_cap,'plan:1',1000000,'local-funding-known-next');
  perform public.installed_pack_runtime_transition(fresh_run,b,next_cap,'fail','{"message":"Synthetic known actual cost, no provider call"}');
  scope:=private.stage13v2_budget_authority(fresh,false);assert scope->'knownActualMicrousd'='1940000' and scope->'remainingMicrousd'='60000','Usage across rounds can cross the old cap but consumes the same new ceiling';
  follow:=jsonb_set(pg_temp.v2_context_envelope(b),'{ownerKickoff,followUpBasis}',jsonb_build_object('rootId',fresh,'reason','retry_after_known_failed_call'));follow:=jsonb_set(follow,'{intent,limits,maximumMicrousd}','2000000');follow:=jsonb_set(follow,'{quote,policyHash}',to_jsonb(private.stage14_hash(follow->'intent')));
  denied:=false;begin perform public.begin_installed_pack_run(b,null,'product.discovery-v2.one',follow,'funding:exhausted',gen_random_uuid(),repeat('funding-third-capability-',3));exception when others then denied:=true;end;assert denied,'Full quote still cannot outrun the new remaining allowance';
end; $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('v2context.other'),true);
do $$begin assert not exists(select 1 from public.product_research_funding_approvals where id=current_setting('funding.approval')::uuid),'RLS hides another owner funding';end;$$;
select set_config('request.jwt.claim.sub',current_setting('v2context.owner'),true);
do $$declare denied boolean:=false;begin
  assert (select count(*) from public.product_research_funding_approvals where id=current_setting('funding.approval')::uuid)=1,'Owner can read funding';
  begin update public.product_research_funding_approvals set reason='Caller attempted a direct unapproved funding mutation.';exception when insufficient_privilege then denied:=true;end;assert denied,'Owner has no direct funding write grant';
end;$$;
reset role;
do $$begin
  assert not has_function_privilege('anon','public.approve_product_research_funding(uuid,uuid,integer,integer,text)','EXECUTE'),'Anonymous callers cannot approve funding';
  assert not has_function_privilege('service_role','public.approve_product_research_funding(uuid,uuid,integer,integer,text)','EXECUTE'),'Service role cannot impersonate owner approval';
  assert not has_function_privilege('authenticated','private.stage13v2_funded_ceiling(uuid)','EXECUTE'),'Internal funding helper has no client grant';
  assert not has_table_privilege('authenticated','public.product_research_funding_approvals','INSERT,UPDATE,DELETE'),'Funding table has no direct client write privilege';
end;$$;
rollback;
