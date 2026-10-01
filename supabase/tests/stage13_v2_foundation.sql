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
select set_config('request.jwt.claim.sub',current_setting('stage13v2.owner'),true);
do $$
declare b uuid:=current_setting('stage13v2.business')::uuid; root uuid; other_root uuid; c uuid; child uuid; payload jsonb; scope jsonb; denied boolean; before_candidate jsonb; reservation uuid;
begin
  root:=pg_temp.v2_foundation_root(b); other_root:=pg_temp.v2_foundation_root(b,2);
  perform set_config('stage13v2.root',root::text,true);
  perform set_config('stage13v2.run',(select workflow_run_id::text from public.product_experiments where id=root),true);
  scope:=private.stage13v2_validate_persisted(root,false);
  assert scope->>'validationLevel'='intent_scope_only' and scope->'maximumCollections'='1' and scope->'maximumMicrousd'='1000000';
  assert scope->'decisionValidated'='false' and scope->'productionEligible'='false','Scope validation cannot be advertised as a product decision';
  assert private.stage13v2_validate_persisted(other_root,false)->'maximumCollections'='2','Two-collection branch matches exact registered stages';
  denied:=false; begin perform private.stage13v2_validate_persisted(root,true); exception when others then denied:=true; end;
  assert denied,'Unintegrated terminal decision validation remains fail-closed';
  payload:=public.create_product_candidate(b,'{"concept":"Synthetic unchanged v2 concept","audience":"Adult original-art buyers","hypothesis":"This immutable concept is a regression fixture, not real market evidence.","originalDesign":true,"rightsStatus":"unclear","sourceDomains":["etsy.com"]}');
  c:=(payload->>'candidateId')::uuid;
  select to_jsonb(x) into before_candidate from public.product_candidates x where id=c;
  insert into public.product_experiments(business_id,candidate_id,fingerprint,hypothesis,variables,audience,status,measurement_plan)
    values(b,c,private.stage13_hash('legacy:'||c),'Historical fixed-plan fixture','{}','Adult original-art buyers','reserved',private.stage13_plan());
  denied:=false; begin
    insert into public.product_experiments(business_id,candidate_id,fingerprint,hypothesis,variables,audience,status,measurement_plan)
      values(b,c,private.stage13_hash('legacy-duplicate:'||c),'Duplicate old initial fixture','{}','Adult original-art buyers','reserved',private.stage13_plan());
  exception when unique_violation then denied:=true; end;
  assert denied,'V1 still permits only one initial discovery per existing candidate';
  child:=pg_temp.v2_foundation_child(root,c);
  perform pg_temp.v2_foundation_child(other_root,c);
  assert (select count(*) from public.product_experiments where candidate_id=c and discovery_version='pod-discovery-2.0')=2,'Two explicitly distinct roots may reuse the exact candidate identity';
  assert (select to_jsonb(x)=before_candidate from public.product_candidates x where id=c),'Candidate identity and rights were never rewritten';
  assert private.stage13v2_validate_persisted(child,false)->>'intentId'=root::text,'Child resolves the root envelope, never its own cap';
  denied:=false; begin perform pg_temp.v2_foundation_child(root,c); exception when unique_violation then denied:=true; end;
  assert denied,'A single root cannot duplicate one candidate child';
  denied:=false; begin perform pg_temp.v2_foundation_child(root,c,current_setting('stage13v2.foreign')::uuid); exception when others then denied:=true; end;
  assert denied,'Cross-Business parent or candidate identity is rejected';
  denied:=false; begin update public.product_experiments set variables=variables||'{"newScope":true}' where id=root; exception when others then denied:=true; end;
  assert denied,'The persisted intent, quote and policy hash are immutable';
  denied:=false; begin
    insert into public.product_experiments(business_id,candidate_id,fingerprint,hypothesis,variables,audience,status,measurement_plan)
      values(b,null,repeat('a',64),'Invalid old null-candidate fixture','{}','Adult original-art buyers','reserved',private.stage13_plan());
  exception when others then denied:=true; end;
  assert denied,'The nullable root extension never permits null-candidate v1 history';
  insert into public.product_research_cost_reservations(business_id,experiment_id,workflow_run_id,attempt_key,reserved_microusd,request_hash,estimate)
    select b,root,workflow_run_id,'plan:1',1000,repeat('a',64),'{"version":"discovery-estimate-2.0"}' from public.product_experiments where id=root returning id into reservation;
  scope:=private.stage13v2_validate_persisted(root,false);
  assert scope->'committedMicrousd'='1000' and scope->'hasUncertainCosts'='true','Missing cost receipt keeps its reservation and is visible as uncertain';
  insert into public.product_research_cost_settlements(business_id,reservation_id,reported_microusd,provider_request_id,fingerprint)
    values(b,reservation,1200,'synthetic-foundation-known-cost',repeat('b',64));
  scope:=private.stage13v2_validate_persisted(root,false);
  assert scope->'committedMicrousd'='1200' and scope->'hasUncertainCosts'='false','Committed budget uses the greater reservation or reported charge';
  foreach payload in array array[
    '{"limits":{"maximumAlternatives":3,"maximumNewCollections":3,"maximumMicrousd":1000000,"maximumGenerations":1}}'::jsonb,
    '{"limits":{"maximumAlternatives":3,"maximumNewCollections":1,"maximumMicrousd":2000001,"maximumGenerations":1}}'::jsonb,
    jsonb_build_object('expiresAt',now()-interval '1 second')
  ] loop
    denied:=false; begin other_root:=pg_temp.v2_foundation_root(b,1,payload); perform private.stage13v2_validate_persisted(other_root,false); exception when others then denied:=true; end;
    assert denied,'Invalid count, expanded budget or expiry cannot become runtime authority';
  end loop;
  foreach payload in array array['{"primaryOnly":false}'::jsonb,'{"reviewerModel":"openai/gpt-5.6-luna"}'::jsonb,'{"maximumEstimateMicrousd":1}'::jsonb,'{"maximumCalls":7}'::jsonb] loop
    denied:=false; begin other_root:=pg_temp.v2_foundation_root(b,1,'{}',payload); perform private.stage13v2_validate_persisted(other_root,false); exception when others then denied:=true; end;
    assert denied,'Altered model, fallback, quote arithmetic or call authority is rejected';
  end loop;
end; $$;
set local role authenticated;
do $$ declare denied boolean; begin
  denied:=false; begin update public.workflow_runs set status='completed' where id=current_setting('stage13v2.run')::uuid; exception when insufficient_privilege then denied:=true; end;
  assert denied,'Generic owner workflow writes cannot forge v2 completion';
  denied:=false; begin insert into public.artifacts(business_id,artifact_type,name,content) values(current_setting('stage13v2.business')::uuid,'product.discovery-dossier.v2','Forged standalone dossier','{}'); exception when insufficient_privilege then denied:=true; end;
  assert denied,'A standalone dossier cannot bypass workflow provenance protection';
  denied:=false; begin perform private.stage13v2_validate_persisted(current_setting('stage13v2.root')::uuid,false); exception when insufficient_privilege then denied:=true; end;
  assert denied,'The new validator adds no authenticated-callable endpoint';
end; $$;
reset role;
do $$ begin
  assert not has_function_privilege('anon','private.stage13v2_validate_persisted(uuid,boolean)','execute');
  assert not has_function_privilege('authenticated','private.stage13v2_validate_persisted(uuid,boolean)','execute');
  assert not has_function_privilege('service_role','private.stage13v2_validate_persisted(uuid,boolean)','execute');
  assert (select status='experimental' from public.packs where id=current_setting('stage13v2.pack')::uuid),'Synthetic fixture was never promoted';
end; $$;
rollback;
