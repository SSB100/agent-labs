-- OFFLINE administrator-only regression for the version-boundary fences, not live evidence.
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

create function pg_temp.creative_quote() returns jsonb language sql as $$
 select jsonb_build_object('version','creative-estimate-1.0','verifiedAt',now(),'sourceUrls',jsonb_build_array('https://openrouter.ai/api/v1/models'),
 'generatorModel','recraft/recraft-v4.1-pro','directorModel','openai/gpt-5.6-luna','reviewerModel','anthropic/claude-haiku-4.5',
 'maximaMicrousd','{"brief":33992,"screen":107304,"generation":210000,"review":131880}'::jsonb,'maximumEstimateMicrousd',825056,'maximumCalls',6,'estimateOnly',true,'providerInvoiceGuarantee',false);
$$;

create function pg_temp.creative_approval(p_candidate uuid) returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('approvalId',gen_random_uuid(),'candidateId',c.id,'businessId',c.business_id,'decisionId',null,'purpose','technical_qualification',
 'concept',c.concept,'audience',c.audience,'designInstructions','Create one original opaque cream square with three geometric pines and a sun; no words, brand names, copied art, or external references.','candidateAssessment',null,'originalDesign',true,'rightsStatement','Synthetic fixture owner attests original artwork and no protected names, likeness or copied source images.',
 'rightsConfirmed',true,'policyScreen',(select jsonb_agg(jsonb_build_object('category',k,'status','clear','rationale','Synthetic fixture screen finds no protected element in this original concept.',
 'sourceUrls',jsonb_build_array('https://www.etsy.com/legal/sellers/'))) from unnest(array['brand_names','trademarks','copyrighted_characters','sports_teams','logos','celebrity_likeness','copied_artwork','marketplace_policy']) k),
 'printSpecification',jsonb_build_object('provider','printful','product','Bella Canvas 3001','garment','Cream cotton T-shirt','placement','front center','sourceUrl','https://www.printful.com/custom/mens/t-shirts',
 'sourceExcerpt','Synthetic fixture for a verified printable placement; this is not an actual product or fulfillment claim.','verifiedAt',now(),'maximumWidthInches',12,'maximumHeightInches',16,'designWidthInches',6.5,'designHeightInches',6.5,'minimumDpi',150,'colorSpace','srgb','background','opaque','maximumBytes',7000000),
 'approvedBy','owner','approvedAt',now(),'expiresAt',now()+interval '1 day','maximumMicrousd',1000000,'maximumGenerations',2,'publicationAllowed',false)
 from public.product_candidates c where c.id=p_candidate;
$$;

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

-- Legacy positive fixtures use only rollback-scoped structural qualifications.
update public.packs set status='qualified' where pack_key in ('capability.web-research','knowledge.research-evidence','worker.market-researcher','workflow.web-research') and version='1.0.0';
update public.workflow_definitions set status='qualified' where workflow_key='research.public-evidence' and version='1.0.0';
update public.worker_definitions set status='qualified' where worker_key='market.researcher' and version='1.0.0';
select set_config('request.jwt.claim.sub',current_setting('stage13v2.owner'),true);
do $$ declare b uuid:=current_setting('stage13v2.business')::uuid; c jsonb; launch jsonb; e public.product_experiments%rowtype; d public.product_decisions%rowtype;
  dimensions jsonb; changed_dimensions jsonb; assessment jsonb; input jsonb; approved jsonb; replay jsonb; root uuid; child uuid; dossier_id uuid; descriptor jsonb; denied boolean; message text; v2only jsonb; v2child uuid;
  cap text:=repeat('version-fence-legacy-',3);
begin
  c:=public.create_product_candidate(b,'{"concept":"Synthetic version-boundary original design","audience":"Adult original-art buyers","hypothesis":"Synthetic original candidate tests legacy history and new-version eligibility boundaries without real demand.","originalDesign":true,"rightsStatus":"unclear","sourceDomains":["etsy.com"]}');
  launch:=public.begin_product_discovery((c->>'candidateId')::uuid,gen_random_uuid(),cap);
  perform pg_temp.stage13_fixture((launch->>'workflowRunId')::uuid,b,cap);
  perform public.product_discovery_runtime((launch->>'workflowRunId')::uuid,b,cap,'finalize');
  select * into strict e from public.product_experiments where id=(launch->>'experimentId')::uuid;
  select * into strict d from public.product_decisions where experiment_id=e.id;
  -- Drain only R12 adoption FK checks before this synthetic timestamp rewrite.
  set constraints public.product_decisions_focused_adoption_id_fkey immediate;
  alter table public.product_decisions disable trigger stage13_decision_append_only;
  update public.product_decisions set created_at=now()-interval '1 minute' where id=d.id;
  alter table public.product_decisions enable trigger stage13_decision_append_only;
  set constraints public.product_decisions_focused_adoption_id_fkey deferred;
  select jsonb_agg(x||jsonb_build_object('score',4,'rationale','Owner-scored synthetic rollback evidence only',
    'evidenceKind',(case when x->>'dimension'='policy_ip_risk' then 'policy' when x->>'dimension' in ('estimated_margin','production_complexity') then 'operational_fact' else 'market_observation' end),
    'evidenceIds',jsonb_build_array(e.evidence_pack->'evidence'->(case when x->>'dimension'='policy_ip_risk' then 2 when x->>'dimension' in ('estimated_margin','production_complexity') then 1 else 0 end)->>'id')))
    into dimensions from jsonb_array_elements(d.assessment->'dimensions') x;
  assessment:=public.record_product_assessment(e.id,dimensions,true);
  input:=pg_temp.creative_approval((c->>'candidateId')::uuid)||jsonb_build_object('purpose','candidate_production','decisionId',assessment->>'decisionId','candidateAssessment',assessment->'assessment');
  approved:=public.approve_creative_candidate((c->>'candidateId')::uuid,input,pg_temp.creative_quote());
  perform private.stage14_assert_approval((c->>'candidateId')::uuid,approved->'snapshot');
  root:=pg_temp.v2_foundation_root(b); child:=pg_temp.v2_foundation_child(root,(c->>'candidateId')::uuid);
  dossier_id:=gen_random_uuid();
  insert into public.artifacts(id,business_id,workflow_run_id,artifact_type,name,content)
    select dossier_id,b,workflow_run_id,'product.discovery-dossier.v2','Synthetic immutable new comparison',jsonb_build_object('version','pod-discovery-2.0','shortlist',jsonb_build_array(variables->'identity')) from public.product_experiments where id=child;
  descriptor:=jsonb_build_object('version','pod-discovery-2.0','intentId',root,'dossierArtifactId',dossier_id,'strategyArtifactId',gen_random_uuid(),'reviewArtifactId',gen_random_uuid());
  update public.product_experiments set status='completed',source_artifact_id=dossier_id,evidence_pack=descriptor,completed_at=now() where id=child;
  assert not exists(select 1 from public.product_decisions where experiment_id=child),'No fabricated Reviewer decision is appended for this unselected candidate';
  denied:=false; begin perform private.stage14_assert_approval((c->>'candidateId')::uuid,approved->'snapshot'); exception when others then denied:=true; message:=sqlerrm; end;
  assert denied and position('Newer completed v2 discovery' in message)>0,'A newer unselected candidate experiment still invalidates an old v1 production TEST';
  denied:=false; begin perform public.begin_creative_run((approved->>'approvalId')::uuid,gen_random_uuid(),repeat('fenced-creative-',3)); exception when others then denied:=true; end;
  assert denied,'The already-recorded old approval cannot start production after new discovery';
  input:=input||jsonb_build_object('approvalId',gen_random_uuid(),'designInstructions','A changed synthetic design scope cannot bypass a newer completed comparison even without another candidate decision row.');
  denied:=false; begin perform public.approve_creative_candidate((c->>'candidateId')::uuid,input,pg_temp.creative_quote()); exception when others then denied:=true; end;
  assert denied,'A newly submitted creative scope also sees the newer experiment fence';
  replay:=public.begin_product_discovery((c->>'candidateId')::uuid,gen_random_uuid(),cap);
  assert replay->>'experimentId'=e.id::text and replay->'shouldStart'='false','Legacy cached replay cannot accidentally return a v2 child';
  assert public.finalize_product_discovery(e.id)->'cached'='true','Existing completed v1 finalization remains a read-only replay';
  assert public.record_product_assessment(e.id,dimensions,true)->'cached'='true','Existing v1 assessment replay remains unchanged';
  changed_dimensions:=jsonb_set(dimensions,'{0,rationale}','"A new legacy scoring mutation must not overwrite the newer versioned discovery authority."');
  denied:=false; begin perform public.record_product_assessment(e.id,changed_dimensions,true); exception when others then denied:=true; end;
  assert denied,'A new legacy scoring mutation cannot supersede a v2 comparison';
  denied:=false; begin perform public.finalize_product_discovery(child); exception when others then denied:=true; message:=sqlerrm; end;
  assert denied and position('versioned v2' in message)>0,'Legacy finalization rejects v2 descriptors explicitly';
  denied:=false; begin perform public.record_product_assessment(child,dimensions,true); exception when others then denied:=true; end;
  assert denied,'Legacy numeric assessment cannot consume v2 qualitative rows';
  denied:=false; begin perform public.reconsider_product_candidate((c->>'candidateId')::uuid,e.source_artifact_id); exception when others then denied:=true; message:=sqlerrm; end;
  assert denied and position('versioned discovery history' in message)>0,'Legacy reconsideration requires its own v1 history and cannot reset v2 workflow authority';
  denied:=false; begin perform public.product_discovery_runtime((select workflow_run_id from public.product_experiments where id=root),b,repeat('synthetic-v2-capability-',3),'scope'); exception when others then denied:=true; end;
  assert denied,'The legacy capability RPC cannot select a v2 root or child';
  v2only:=public.create_product_candidate(b,'{"concept":"Synthetic v2-only original identity","audience":"Adult original-art buyers","hypothesis":"This candidate belongs to a versioned shortlist and must not silently enter the old workflow.","originalDesign":true,"rightsStatus":"unclear","sourceDomains":["etsy.com"]}');
  v2child:=pg_temp.v2_foundation_child(root,(v2only->>'candidateId')::uuid);
  denied:=false; begin perform public.begin_product_discovery((v2only->>'candidateId')::uuid,gen_random_uuid(),cap); exception when others then denied:=true; message:=sqlerrm; end;
  assert denied and position('versioned discovery history' in message)>0,'A v2-only candidate cannot be cached as an old initial discovery';
end; $$;
rollback;
