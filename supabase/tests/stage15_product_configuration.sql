-- Offline, rollback-only. All accounts, uploads, pixels and provider observations
-- here are synthetic administrative fixtures, never live qualification.
-- The existing Stage14 evidence validator is tested for a stale exact TEST then
-- isolated for downstream state-machine tests. Its definition is rolled back.
begin;
create function pg_temp.expect_error(sql text, expected text default null) returns void language plpgsql as $$
begin
 begin execute sql; exception when others then
  if expected is not null and position(expected in sqlerrm)=0 then raise exception 'Unexpected error: %; wanted %',sqlerrm,expected; end if; return;
 end; raise exception 'Expected failure did not occur: %',sql;
end $$;
insert into auth.users(id,email) values('15000000-1111-4111-8111-000000000090','product-owner@example.invalid'),('15000000-1111-4111-8111-000000000091','product-other@example.invalid');
insert into public.businesses(id,owner_user_id,name) values('15000000-1111-4111-8111-000000000002','15000000-1111-4111-8111-000000000090','Rollback product'),('15000000-1111-4111-8111-000000000092','15000000-1111-4111-8111-000000000091','Other rollback product');
select set_config('request.jwt.claim.sub','15000000-1111-4111-8111-000000000090',true);
create temp table product_fixture(source uuid,body jsonb,payload jsonb,run uuid,state jsonb,revision integer default 0);
create temp table product_original_helpers as select proname,prosrc from pg_proc where oid='private.stage14_assert_approval(uuid,jsonb)'::regprocedure;
do $$ declare n text; begin
 assert has_function_privilege('authenticated','public.printful_product_owner_transition(uuid,text,jsonb,text)','EXECUTE');
 assert not has_function_privilege('anon','public.printful_product_owner_transition(uuid,text,jsonb,text)','EXECUTE');
 assert not has_function_privilege('service_role','public.printful_product_owner_transition(uuid,text,jsonb,text)','EXECUTE');
 assert not has_function_privilege('authenticated','private.stage15_product_owner(uuid,text,jsonb,text)','EXECUTE');
 assert not has_function_privilege('authenticated','private.stage15_product_source(uuid,uuid,boolean)','EXECUTE');
 foreach n in array array['printful_product_sources','printful_product_runs','printful_product_operations','printful_product_server_authority','printful_product_write_authorities','printful_product_mutation_admissions'] loop
  assert not has_table_privilege('authenticated','private.'||n,'SELECT');
  assert not has_table_privilege('service_role','private.'||n,'INSERT');
  assert (select relrowsecurity from pg_class where oid=('private.'||n)::regclass);
 end loop;
 assert not exists(select 1 from private.printful_product_server_authority);
 assert not exists(select 1 from private.printful_product_write_authorities);
 assert not exists(select 1 from private.printful_product_sources);
 assert not exists(select 1 from private.printful_product_runs);
end $$;
set local role authenticated;
do $$ declare b uuid:='15000000-1111-4111-8111-000000000002'; begin
 assert public.printful_product_owner_transition(b,'workspace')->'runs'='[]';
 assert public.printful_product_owner_transition(b,'workspace')->'sourceAuthorityAvailable'='false';
 assert public.printful_product_owner_transition(b,'workspace')->'productWriteAuthorityAvailable'='false';
 perform pg_temp.expect_error('select public.printful_product_owner_transition(''15000000-1111-4111-8111-000000000092'',''workspace'')','owner_required');
 perform pg_temp.expect_error(format('select public.printful_product_owner_transition(%L,''source'')',b),'server_authority_required');
 perform pg_temp.expect_error('select * from private.printful_product_sources','permission denied');
 perform pg_temp.expect_error('insert into private.printful_product_mutation_admissions values(txid_current())','permission denied');
 perform pg_temp.expect_error(format('insert into public.action_intents(business_id,action_type,capability,idempotency_key,created_by_type) values(%L,''printful.product.configure'',''fulfilment.print'',''forged'',''owner'')',b));
 perform pg_temp.expect_error(format('insert into public.external_resources(business_id,provider,resource_type,external_id,metadata) values(%L,''printful'',''product_configuration_observation'',''forged'',''{}'')',b));
end $$;
reset role;
insert into private.printful_product_server_authority values(private.stage13_hash(repeat('product-fixture-server-',3)),false);
do $$ begin
 perform pg_temp.expect_error($q$select public.printful_product_owner_transition('15000000-1111-4111-8111-000000000002','source','{}',repeat('product-fixture-server-',3))$q$,'server_authority_required');
end $$;
update private.printful_product_server_authority set enabled=true;

-- Administrative immutable fixture. No owner-facing function can do this.
create function pg_temp.seed_product_source(n integer,technical boolean default false,placement_missing boolean default false) returns uuid language plpgsql as $$
declare b uuid:='15000000-1111-4111-8111-000000000002'; owner uuid:='15000000-1111-4111-8111-000000000090';
 sid uuid:=gen_random_uuid(); cid uuid; revision uuid; goal uuid:=gen_random_uuid(); workflow uuid:=gen_random_uuid(); creative_workflow uuid:=gen_random_uuid();
 candidate uuid:=gen_random_uuid(); experiment uuid:=gen_random_uuid(); decision uuid:=gen_random_uuid(); approval uuid:=gen_random_uuid(); run uuid:=gen_random_uuid(); asset uuid:=gen_random_uuid(); artifact uuid:=gen_random_uuid(); review_artifact uuid:=gen_random_uuid(); evidence_artifact uuid:=gen_random_uuid();
 snapshot jsonb; assessment jsonb; plan jsonb; source jsonb; stock jsonb; cost jsonb; dt timestamptz:=clock_timestamp()-interval '1 minute'; sha text:=private.stage13_hash('synthetic-product-'||n);
begin
 select id,connection_revision into cid,revision from private.connected_accounts where business_id=b and provider='printful';
 if cid is null then
  cid:=gen_random_uuid();revision:=gen_random_uuid();
  insert into private.connected_accounts(id,business_id,owner_id,provider,provider_account_id,status,connection_revision,verified_at) values(cid,b,owner,'printful','15001','connected',revision,dt);
  insert into private.provider_connections(id,business_id,revision,store_id,store_kind,scopes,provider_scopes,expires_at) values(cid,b,revision,15001,'manual_api','["catalog.read"]','[]',clock_timestamp()+interval '1 hour');
 end if;
 insert into public.goals(id,business_id,title,status) values(goal,b,'Synthetic product goal','active');
 insert into public.workflow_runs(id,business_id,goal_id,workflow_definition_id,status,idempotency_key) select workflow,b,goal,id,'completed','product-parent-fixture:'||n from public.workflow_definitions limit 1;
 insert into public.workflow_runs(id,business_id,workflow_definition_id,status,idempotency_key,state) select creative_workflow,b,id,'completed','product-creative-fixture:'||n,'{"productionReady":true}' from public.workflow_definitions where workflow_key='etsy.creative-pipeline';
 insert into public.product_candidates(id,business_id,fingerprint,concept,audience,hypothesis,original_design,rights_status,source_domains) values(candidate,b,sha,'Original mountain art '||n,'Adult hikers','Original mountain geometry may appeal to adult hikers.',true,'confirmed',array['etsy.com','printful.com']);
 insert into public.artifacts(id,business_id,workflow_run_id,artifact_type,name,content) values(evidence_artifact,b,workflow,'research.evidence.v1','Synthetic upstream evidence','{}');
 insert into public.product_experiments(id,business_id,candidate_id,workflow_run_id,fingerprint,hypothesis,variables,audience,status,measurement_plan,evidence_pack,source_artifact_id,completed_at)
  values(experiment,b,candidate,workflow,sha,'Synthetic hypothesis','{}','Adult hikers','completed',private.stage13_plan(),'{}',evidence_artifact,dt);
 assessment:='{"outcome":"TEST","assessmentOrigin":"owner_assessment","missingEvidence":[],"totalScore":80,"review":{"status":"contract_checked","liveQualified":false,"creativeProductionAllowed":false,"publicationAllowed":false}}';
 insert into public.product_decisions(id,business_id,candidate_id,experiment_id,assessment,assessment_fingerprint,created_at) values(decision,b,candidate,experiment,assessment,private.stage14_hash(assessment),dt);
 snapshot:=jsonb_build_object('approvalId',approval,'businessId',b,'candidateId',candidate,'decisionId',decision,'purpose',case when technical then 'technical_qualification' else 'candidate_production' end,
  'concept','Original mountain art '||n,'audience','Adult hikers','designInstructions','Create one original geometric mountain illustration without words, protected names or copied artwork.',
  'candidateAssessment',assessment,'originalDesign',true,'rightsStatement','Synthetic fixture owner confirms rights to this original design without protected subjects.','rightsConfirmed',true,
  'policyScreen',(select jsonb_agg(jsonb_build_object('category',k,'status','clear','rationale','Synthetic independent original-design policy screen.','sourceUrls','["https://www.etsy.com/legal/sellers/"]'::jsonb)) from unnest(array['brand_names','trademarks','copyrighted_characters','sports_teams','logos','celebrity_likeness','copied_artwork','marketplace_policy']) k),
  'printSpecification',jsonb_build_object('provider','printful','product','Synthetic tee','garment','Cotton tee','placement','front center','sourceUrl','https://www.printful.com/custom/mens/t-shirts','sourceExcerpt','Synthetic print dimensions used only in offline regression testing.','verifiedAt',dt,'maximumWidthInches',12,'maximumHeightInches',16,'designWidthInches',6,'designHeightInches',6,'minimumDpi',150,'colorSpace','srgb','background','opaque','maximumBytes',7000000),
  'approvedBy','owner','approvedAt',dt,'expiresAt',clock_timestamp()+interval '1 hour','maximumMicrousd',1000000,'maximumGenerations',1,'publicationAllowed',false);
 insert into public.creative_approvals(id,business_id,candidate_id,decision_id,purpose,snapshot,scope_hash,approval_hash,quote,maximum_microusd,owner_user_id,approved_at,expires_at)
  values(approval,b,candidate,decision,case when technical then 'technical_qualification' else 'candidate_production' end,snapshot,sha,private.stage14_hash(snapshot),'{}',1000000,owner,dt,clock_timestamp()+interval '1 hour');
 insert into public.creative_runs(id,business_id,candidate_id,approval_id,workflow_run_id,catalog_snapshot,capability_expires_at) values(run,b,candidate,approval,creative_workflow,'{}',clock_timestamp()+interval '1 hour');
 insert into public.artifacts(id,business_id,workflow_run_id,artifact_type,name,content) values(artifact,b,creative_workflow,'creative.asset.v1','Synthetic artwork','{}'),(review_artifact,b,creative_workflow,'creative.review.v1','Synthetic review','{}');
 insert into public.creative_assets(id,creative_run_id,candidate_id,approval_id,business_id,version,brief_hash,asset_hash,storage_path,inspection,prompt,provider,model,generated_at,artifact_id)
  values(asset,run,candidate,approval,b,1,sha,sha,b||'/'||run||'/version-1.png','{"failedCriteria":[],"width":1200,"height":1200}','Synthetic artwork','fixture','fixture',dt,artifact);
 insert into public.creative_reviews(id,creative_run_id,business_id,asset_id,brief_hash,asset_hash,review,reviewer_model,artifact_id) values(gen_random_uuid(),run,b,asset,sha,sha,'{"outcome":"PASS"}','fixture',review_artifact);
 plan:=jsonb_build_object('version','1.0.0','businessId',b,'productId',71,'variantId',4012,'placement','front','technique','dtg','storeKind','manual_api','operation','create_native_sync_product',
  'assetVersionId',asset,'assetSha256',sha,'sourceWidthPx',1200,'sourceHeightPx',1200,'designWidthIn',6,'designHeightIn',6,'effectiveDpi',200,'productCatalogHash',sha,'variantCatalogHash',sha,'printRequirementHash',sha,
  'requestHash',sha,'state','proposal','executionAuthorized',false,'publicationAuthorized',false,'orderSubmissionAuthorized',false,'requires','["verified_store_connection","current_persisted_creative_production_approval","current_stock_and_cost_quote","owner_configuration_approval"]'::jsonb);
 -- Reproduce the foundation's deliberately ordered plan hash (not sorted
 -- jsonb source hashing) so this fixture is valid at the real TS wire boundary.
 plan:=plan||jsonb_build_object('requestHash',private.stage13_hash((select '{'||string_agg(to_jsonb(k)::text||':'||private.stage14_canonical(plan->k),',' order by ord)||'}' from unnest(array['businessId','productId','variantId','placement','technique','storeKind','operation','assetVersionId','assetSha256','sourceWidthPx','sourceHeightPx','designWidthIn','designHeightIn','effectiveDpi','productCatalogHash','variantCatalogHash','printRequirementHash']) with ordinality x(k,ord))));
 stock:=jsonb_build_object('variantId',4012,'available',true,'responseHash',sha,'observedAt',dt,'expiresAt',clock_timestamp()+interval '1 hour');
 cost:=jsonb_build_object('variantId',4012,'currency','USD','productionMinor',1000,'responseHash',sha,'observedAt',dt,'expiresAt',clock_timestamp()+interval '1 hour',
  'pricing','{"currency":"USD","itemPriceMinor":2499,"shippingChargedMinor":0,"discountBps":0,"productionMinor":1000,"fulfilmentShippingMinor":400,"sellerTaxCostMinor":50,"marketplaceFee":{"fixedMinor":20,"rateBps":650,"basis":"item"},"paymentFee":{"fixedMinor":25,"rateBps":300,"basis":"item"},"refundReserveBps":500,"targetMarginBps":1000,"assumptionLabel":"Synthetic complete scenario"}'::jsonb);
 source:=jsonb_build_object('version','1.0.0','id',sid,'businessId',b,'connectionId',cid,'connectionRevision',revision,'storeId',15001,'storeKind','manual_api','evidenceMode','live',
  'goalId',goal,'workflowRunId',workflow,'candidateId',candidate,'decisionId',decision,'creativeApprovalId',approval,'creativeRunId',run,'assetVersionId',asset,'assetSha256',sha,'assetStoragePath',b||'/'||run||'/version-1.png',
  'plan',plan,'name','Synthetic product '||n,'retailPrice','24.99','currency','USD','printfulFileId',150001,'fileBinding',jsonb_build_object('id',gen_random_uuid(),'source','authenticated_upload','assetSha256',sha,'printfulFileId',150001,'providerMd5',repeat('f',32),'widthPx',1200,'heightPx',1200,'observedAt',dt,'expiresAt',clock_timestamp()+interval '1 hour'),
  'fileTypeEvidence',jsonb_build_object('catalogProductId',71,'catalogVariantId',4012,'placement','front','fileType','default','observedAt',dt,'expiresAt',clock_timestamp()+interval '1 hour','responseHash',sha),
  'placementEvidence',case when placement_missing then null else jsonb_build_object('id',gen_random_uuid(),'source','authenticated_placement','proofHash',sha,'assetSha256',sha,'catalogVariantId',4012,'placement','front','designWidthIn',6,'designHeightIn',6,'observedAt',dt,'expiresAt',clock_timestamp()+interval '1 hour') end,
  'stockEvidence',stock,'costEvidence',cost,'providerFactsHash',private.stage14_hash(jsonb_build_object('productCatalogHash',sha,'variantCatalogHash',sha,'stockEvidence',stock,'costEvidence',cost)),'observedAt',dt,'expiresAt',clock_timestamp()+interval '1 hour');
 insert into private.printful_product_sources(id,business_id,owner_id,connection_id,connection_revision,store_id,source,source_hash) values(sid,b,owner,cid,revision,15001,source,private.stage14_hash(source));
 return sid;
end $$;
insert into product_fixture(source) values(pg_temp.seed_product_source(1));
update product_fixture set body=(select source from private.printful_product_sources where id=product_fixture.source);
-- Existing complete Stage14 validator rejects this intentionally synthetic pack.
do $$ begin
 perform pg_temp.expect_error(format('select private.stage15_product_source(''15000000-1111-4111-8111-000000000002'',%L,true)',(select source from product_fixture)));
end $$;
savepoint stale_test;
insert into public.product_decisions(id,business_id,candidate_id,experiment_id,assessment,assessment_fingerprint,created_at)
 select gen_random_uuid(),d.business_id,d.candidate_id,d.experiment_id,d.assessment||'{"outcome":"HOLD"}',repeat('e',64),clock_timestamp() from public.product_decisions d join product_fixture f on d.id=(f.body->>'decisionId')::uuid;
do $$ begin
 perform pg_temp.expect_error(format('select private.stage15_product_source(''15000000-1111-4111-8111-000000000002'',%L,true)',(select source from product_fixture)),'current exact persisted TEST');
end $$;
rollback to stale_test;
-- The real upstream evidence validator is outside this bounded fixture. All
-- other Stage14/asset/connection/owner checks below remain the real SQL code.
create or replace function private.stage14_assert_approval(p_candidate_id uuid,p_snapshot jsonb) returns void language plpgsql stable set search_path='' as $$ begin return; end $$;
create function pg_temp.product_payload(sid uuid) returns jsonb language plpgsql as $$
declare s jsonb; sh text; rh text; a jsonb;
begin
 select source,source_hash into s,sh from private.printful_product_sources where id=sid;
 rh:=private.stage13_hash('printful-product-configure:v1:'||(s->>'businessId')||':'||sid||':'||sh||':'||(s->>'connectionId')||':'||(s->>'connectionRevision')||':'||(s->>'storeId'));
 a:=jsonb_build_object('id',gen_random_uuid(),'sourceHash',sh,'requestHash',rh,'operation','create_native_product','configuration',true,'approvedAt',clock_timestamp(),'expiresAt',clock_timestamp()+interval '4 minutes');
 return jsonb_build_object('sourceId',sid,'sourceHash',sh,'requestHash',rh,'approval',a,'approvalHash',private.stage14_hash(a));
end $$;
update product_fixture set payload=pg_temp.product_payload(source);
do $$ declare b uuid:='15000000-1111-4111-8111-000000000002'; sid uuid; begin
 assert private.stage15_product_source(b,(select source from product_fixture),true)->>'sourceHash'=(select payload->>'sourceHash' from product_fixture);
 sid:=pg_temp.seed_product_source(2,true);
 perform pg_temp.expect_error(format('select private.stage15_product_source(%L,%L,true)',b,sid),'product_production_approval_required');
 sid:=pg_temp.seed_product_source(3,false,true);
 perform pg_temp.expect_error(format('select public.printful_product_owner_transition(%L,''prepare'',%L,%L)',b,pg_temp.product_payload(sid),repeat('product-fixture-server-',3)),'product_placement_producer_required');
 perform pg_temp.expect_error(format('select public.printful_product_owner_transition(%L,''prepare'',%L,%L)',b,(select payload from product_fixture),repeat('product-fixture-server-',3)),'product_write_authority_unavailable');
 perform pg_temp.expect_error(format('update private.printful_product_sources set source=source||''{"name":"changed"}'' where id=%L',(select source from product_fixture)),'product_source_immutable');
end $$;
insert into private.printful_product_write_authorities(id,business_id,owner_id,connection_id,connection_revision,store_id,scopes,provider_scopes,credential_envelope,enabled,expires_at)
 select gen_random_uuid(),business_id,owner_id,id,connection_revision,15001,'["product.configure"]','["sync_products/read","sync_products/write","file_library/read","stores_list/read"]',repeat('offline-opaque-placeholder-',2),true,clock_timestamp()+interval '1 hour' from private.connected_accounts where provider='printful';
-- catalog.read remains exact and cannot be rewritten by this lane.
do $$ begin assert (select scopes='["catalog.read"]'::jsonb from private.provider_connections limit 1); end $$;
update product_fixture set run=(public.printful_product_owner_transition('15000000-1111-4111-8111-000000000002','prepare',payload,repeat('product-fixture-server-',3))->>'runId')::uuid;
update product_fixture set state=(public.printful_product_owner_transition('15000000-1111-4111-8111-000000000002','acquire',jsonb_build_object('runId',run,'lease',repeat('lease-a-',6)),repeat('product-fixture-server-',3))->'state');
create function pg_temp.product_rpc(op text,p jsonb) returns jsonb language sql as $$ select public.printful_product_owner_transition('15000000-1111-4111-8111-000000000002',op,p,repeat('product-fixture-server-',3)); $$;
create function pg_temp.save_product(s jsonb,rev integer default null) returns jsonb language plpgsql as $$ declare f product_fixture%rowtype; result jsonb; begin
 select * into strict f from product_fixture;
 result:=pg_temp.product_rpc('save',jsonb_build_object('runId',f.run,'lease',repeat('lease-a-',6),'revision',coalesce(rev,f.revision),'state',s));
 update product_fixture set state=result->'state',revision=(result->>'revision')::integer; return result;
end $$;
do $$ declare f product_fixture%rowtype; begin
 select * into f from product_fixture;
 assert pg_temp.product_rpc('prepare',f.payload)->'created'='false';
 perform pg_temp.expect_error(format('select pg_temp.product_rpc(''prepare'',%L)',f.payload||'{"sourceHash":"forged"}'),'product_approval_replay_mismatch');
 perform pg_temp.expect_error(format('select pg_temp.product_rpc(''acquire'',%L)',jsonb_build_object('runId',f.run,'lease',repeat('lease-b-',6))),'product_in_progress');
 perform pg_temp.expect_error(format('select pg_temp.product_rpc(''release'',%L)',jsonb_build_object('runId',f.run,'lease',repeat('lease-b-',6))),'product_lease_expired');
 perform pg_temp.expect_error(format('select pg_temp.product_rpc(''guard'',%L)',jsonb_build_object('runId',f.run,'lease',repeat('lease-a-',6),'mode','reconcile')),'product_dispatch_required');
 perform pg_temp.expect_error(format('select pg_temp.save_product(%L)',f.state||'{"identity":"forged"}'),'product_state_identity_immutable');
 perform pg_temp.expect_error(format('select pg_temp.save_product(%L,2)',f.state),'stale_product_revision');
 perform pg_temp.expect_error(format('select pg_temp.save_product(%L)',f.state||'{"status":"verified"}'),'product_state_identity_immutable');
 perform pg_temp.expect_error(format('select pg_temp.save_product(%L)',f.state||'{"syncProductId":1501}'),'product_observed_identity_immutable');
 perform pg_temp.product_rpc('guard',jsonb_build_object('runId',f.run,'lease',repeat('lease-a-',6),'mode','configure'));
 perform pg_temp.save_product(f.state||jsonb_build_object('status','running','dispatch',jsonb_build_object('requestHash',f.state->>'requestHash','sentAt',clock_timestamp())));
end $$;
do $$ declare f product_fixture%rowtype; begin
 select * into f from product_fixture;
 assert (select count(*)=1 from private.printful_product_operations where run_id=f.run);
 perform pg_temp.product_rpc('guard',jsonb_build_object('runId',f.run,'lease',repeat('lease-a-',6),'mode','configure'));
 perform pg_temp.expect_error(format('select pg_temp.save_product(%L)',f.state||'{"dispatch":null}'),'product_dispatch_cannot_be_reset');
 perform pg_temp.save_product(f.state||'{"syncProductId":1501}');
 select * into f from product_fixture;
 perform pg_temp.expect_error(format('select pg_temp.save_product(%L)',f.state||'{"syncProductId":1502}'),'product_observed_identity_immutable');
 perform pg_temp.expect_error(format('select pg_temp.save_product(%L)',f.state||'{"syncProductId":null}'),'product_observed_identity_immutable');
 perform pg_temp.expect_error(format('select pg_temp.save_product(%L)',f.state||'{"status":"cancelled"}'),'product_dispatched_requires_reconciliation');
end $$;

-- Freshness, explicit complete pricing, exact assets, source ingress, projection.
create function pg_temp.product_source_variant(change jsonb) returns uuid language plpgsql as $$
declare row private.printful_product_sources%rowtype; s jsonb; sid uuid:=gen_random_uuid(); begin
 select * into row from private.printful_product_sources where id=(select source from product_fixture);
 s:=row.source||change||jsonb_build_object('id',sid);
 insert into private.printful_product_sources(id,business_id,owner_id,connection_id,connection_revision,store_id,source,source_hash)
 values(sid,row.business_id,row.owner_id,row.connection_id,row.connection_revision,row.store_id,s,private.stage14_hash(s)); return sid;
end $$;
do $$ declare b uuid:='15000000-1111-4111-8111-000000000002'; s jsonb; sid uuid; w jsonb; begin
 select body into s from product_fixture;
 sid:=pg_temp.product_source_variant(jsonb_build_object('stockEvidence',(s->'stockEvidence')||'{"available":false}'));
 perform pg_temp.expect_error(format('select private.stage15_product_source(%L,%L,true)',b,sid),'product_stock_evidence_required');
 sid:=pg_temp.product_source_variant(jsonb_build_object('costEvidence',jsonb_set(s->'costEvidence','{pricing,sellerTaxCostMinor}','null')));
 perform pg_temp.expect_error(format('select private.stage15_product_source(%L,%L,true)',b,sid),'product_cost_evidence_required');
 sid:=pg_temp.product_source_variant(jsonb_build_object('fileTypeEvidence',(s->'fileTypeEvidence')||'{"fileType":"front"}'));
 perform pg_temp.expect_error(format('select private.stage15_product_source(%L,%L,true)',b,sid),'product_file_type_evidence_required');
 sid:=pg_temp.product_source_variant(jsonb_build_object('expiresAt',clock_timestamp()-interval '1 second'));
 perform pg_temp.expect_error(format('select private.stage15_product_source(%L,%L,true)',b,sid),'product_source_expired');
 assert private.stage15_product_source(b,sid,false)->'source'->>'id'=sid::text;
 perform pg_temp.expect_error(format('select pg_temp.product_rpc(''register_source'',%L)',jsonb_build_object('source',s)));
 perform pg_temp.expect_error(format('select pg_temp.product_rpc(''source'',%L)',jsonb_build_object('sourceId',(select source from product_fixture),'source',s)),'product_request_invalid');
 select value into w from jsonb_array_elements(pg_temp.product_rpc('workspace','{}')->'sources') where value->>'id'=(select source::text from product_fixture);
 assert w ?& array['id','name','sourceHash','expiresAt','connectionId','connectionRevision','storeId','assetVersionId','assetSha256','catalogProductId','catalogVariantId','placement','designWidthIn','designHeightIn','retailPrice','currency'];
 assert w->>'catalogVariantId'=s->'plan'->>'variantId' and w->>'retailPrice'=s->>'retailPrice';
 assert not (w ?| array['assetStoragePath','credentialEnvelope','fileBinding','source','approval']);
end $$;
savepoint changed_asset;
insert into public.creative_assets(id,creative_run_id,candidate_id,approval_id,business_id,version,brief_hash,asset_hash,storage_path,inspection,prompt,provider,model,generated_at,artifact_id)
 select gen_random_uuid(),a.creative_run_id,a.candidate_id,a.approval_id,a.business_id,2,a.brief_hash,a.asset_hash,replace(a.storage_path,'version-1','version-2'),a.inspection,a.prompt,a.provider,a.model,a.generated_at,a.artifact_id from public.creative_assets a join product_fixture f on a.id=(f.body->>'assetVersionId')::uuid;
do $$ begin perform pg_temp.expect_error(format('select private.stage15_product_source(''15000000-1111-4111-8111-000000000002'',%L,true)',(select source from product_fixture)),'product_asset_provenance_not_current'); end $$;
rollback to changed_asset;
savepoint stopped_goal;
update public.goals set status='cancelled' where id=(select (body->>'goalId')::uuid from product_fixture);
do $$ begin perform pg_temp.expect_error(format('select private.stage15_product_source(''15000000-1111-4111-8111-000000000002'',%L,true)',(select source from product_fixture)),'product_goal_or_workflow_stopped'); end $$;
rollback to stopped_goal;

-- A later lease may reconcile but never regain the first dispatch authority.
do $$ declare f product_fixture%rowtype; begin
 select * into f from product_fixture;
 perform pg_temp.product_rpc('release',jsonb_build_object('runId',f.run,'lease',repeat('lease-a-',6)));
 perform pg_temp.product_rpc('acquire',jsonb_build_object('runId',f.run,'lease',repeat('lease-b-',6)));
 perform pg_temp.expect_error(format('select pg_temp.product_rpc(''guard'',%L)',jsonb_build_object('runId',f.run,'lease',repeat('lease-b-',6),'mode','configure')),'product_already_dispatched');
 perform pg_temp.product_rpc('guard',jsonb_build_object('runId',f.run,'lease',repeat('lease-b-',6),'mode','reconcile'));
 perform pg_temp.product_rpc('release',jsonb_build_object('runId',f.run,'lease',repeat('lease-b-',6)));
 perform pg_temp.product_rpc('acquire',jsonb_build_object('runId',f.run,'lease',repeat('lease-a-',6)));
 -- Reusing the original token cannot recover the first acquisition epoch.
 perform pg_temp.expect_error(format('select pg_temp.product_rpc(''guard'',%L)',jsonb_build_object('runId',f.run,'lease',repeat('lease-a-',6),'mode','configure')),'product_already_dispatched');
end $$;
-- Build the exact partial observation shape. Hash domain is independent product
-- readback facts, never the upstream catalog/stock/cost source hash.
create function pg_temp.product_finish_payload() returns jsonb language plpgsql as $$
declare f product_fixture%rowtype; s jsonb; summary jsonb; facts jsonb; receipt jsonb; resource jsonb; ts text:=clock_timestamp()::text;
begin
 select * into strict f from product_fixture; s:=f.state||'{"status":"needs_owner","reason":"product_placement_not_observable","syncProductId":1501,"syncVariantId":1502,"receiptRecorded":true}';
 facts:=jsonb_build_object('storeId',s->'storeId','syncProductId',s->'syncProductId','syncVariantId',s->'syncVariantId','externalId',s->'identity','variantExternalId',(s->>'identity')||'-v',
  'catalogProductId',f.body->'plan'->'productId','catalogVariantId',f.body->'plan'->'variantId','placement',f.body->'plan'->'placement','fileType',f.body->'fileTypeEvidence'->'fileType',
  'printfulFileId',f.body->'printfulFileId','providerMd5',f.body->'fileBinding'->'providerMd5','widthPx',f.body->'fileBinding'->'widthPx','heightPx',f.body->'fileBinding'->'heightPx','retailPriceMinor',2499,'currency','USD');
 summary:=jsonb_build_object('executionMode','provider_response','configurationRunId',s->'id','sourceId',s->'sourceId','sourceHash',s->'sourceHash','approvalHash',s->'approvalHash','requestHash',s->'requestHash',
  'connectionId',s->'connectionId','connectionRevision',s->'connectionRevision','storeId',s->'storeId','syncProductId',s->'syncProductId','syncVariantId',s->'syncVariantId','identity',s->'identity',
  'assetVersionId',f.body->'assetVersionId','assetSha256',f.body->'assetSha256','printfulFileId',f.body->'printfulFileId','providerFactsHash',private.stage14_hash(facts),'productReadHash',repeat('a',64),'fileReadHash',repeat('b',64),
  'associationVerified',true,'assetBindingVerified',true,'physicalPlacementVerified',false,'techniqueVerified',false,'configurationVerified',false,'liveQualified',false,'listingReady',false,'publicationAuthorized',false,'orderSubmissionAuthorized',false,
  'verifiedBy','independent_get','stopRequested',false,'blockers','["physical_placement_not_observable","technique_not_observable"]'::jsonb);
 s:=s||jsonb_build_object('observationHash',private.stage14_hash(summary));
 receipt:=jsonb_build_object('id',s->'receiptId','businessId',s->'businessId','actionIntentId',s->'actionIntentId','externalResourceId',s->'resourceId','attempt',1,'outcome','uncertain','provider','printful','requestFingerprint',s->'requestHash','responseSummary',summary,'occurredAt',ts,'createdAt',ts);
 resource:=jsonb_build_object('id',s->'resourceId','businessId',s->'businessId','provider','printful','resourceType','product_configuration_observation','externalId','store:15001:sync_product:1501','status','pending','canonicalUrl','https://api.printful.com/store/products/1501','metadata',summary,'createdAt',ts,'updatedAt',ts);
 return jsonb_build_object('runId',f.run,'lease',repeat('lease-a-',6),'revision',f.revision,'state',s,'receipt',receipt,'resource',resource);
end $$;
create temp table product_observation(payload jsonb);
insert into product_observation values(pg_temp.product_finish_payload());
do $$ declare p jsonb; q jsonb; begin
 select payload into p from product_observation;
 assert p->'receipt'->'responseSummary'->>'providerFactsHash'<>(select body->>'providerFactsHash' from product_fixture);
 q:=jsonb_set(p,'{receipt,responseSummary,configurationVerified}','true');
 perform pg_temp.expect_error(format('select pg_temp.product_rpc(''finish'',%L)',q),'product_observation_binding_invalid');
 q:=jsonb_set(p,'{receipt,responseSummary,productFactsHash}',to_jsonb(repeat('a',64)));
 perform pg_temp.expect_error(format('select pg_temp.product_rpc(''finish'',%L)',q),'product_observation_binding_invalid');
 q:=jsonb_set(p,'{receipt,responseSummary,providerFactsHash}',(select body->'providerFactsHash' from product_fixture));
 perform pg_temp.expect_error(format('select pg_temp.product_rpc(''finish'',%L)',q),'product_observation_binding_invalid');
 q:=jsonb_set(p,'{receipt,outcome}','"succeeded"');
 perform pg_temp.expect_error(format('select pg_temp.product_rpc(''finish'',%L)',q),'product_receipt_binding_invalid');
 q:=jsonb_set(p,'{resource,status}','"active"');
 perform pg_temp.expect_error(format('select pg_temp.product_rpc(''finish'',%L)',q),'product_resource_binding_invalid');
 perform pg_temp.expect_error(format('select pg_temp.save_product(%L)',p->'state'),'product_observation_requires_finish');
end $$;
-- An owner may stop before dispatch without a server key. Approval replay
-- retains that stopped identity rather than offering a fresh mutation attempt.
do $$ declare sid uuid; p jsonb; rid uuid; result jsonb; begin
 sid:=pg_temp.seed_product_source(10); p:=pg_temp.product_payload(sid);
 rid:=(pg_temp.product_rpc('prepare',p)->>'runId')::uuid;
 result:=public.printful_product_owner_transition('15000000-1111-4111-8111-000000000002','cancel',jsonb_build_object('runId',rid));
 assert result->>'status'='cancelled' and result->'stopRequested'='true';
 assert not exists(select 1 from private.printful_product_operations where run_id=rid);
 assert pg_temp.product_rpc('prepare',p)->'created'='false';
 perform pg_temp.product_rpc('acquire',jsonb_build_object('runId',rid,'lease',repeat('stop-lease-',6)));
 perform pg_temp.expect_error(format('select pg_temp.product_rpc(''guard'',%L)',jsonb_build_object('runId',rid,'lease',repeat('stop-lease-',6),'mode','configure')),'product_stopped_or_approval_expired');
 perform pg_temp.product_rpc('release',jsonb_build_object('runId',rid,'lease',repeat('stop-lease-',6)));
end $$;
-- Stop races the already-obtained observation. Current account revocation stops
-- any future provider read, but finish still stores the truthful partial result.
select public.printful_product_owner_transition('15000000-1111-4111-8111-000000000002','cancel',jsonb_build_object('runId',run)) from product_fixture;
update private.connected_accounts set status='revoked' where provider='printful';
do $$ declare f product_fixture%rowtype; result jsonb; begin
 select * into f from product_fixture;
 perform pg_temp.expect_error(format('select pg_temp.product_rpc(''guard'',%L)',jsonb_build_object('runId',f.run,'lease',repeat('lease-a-',6),'mode','reconcile')),'product_connection_revoked');
 result:=pg_temp.product_rpc('finish',(select payload from product_observation));
 assert result->'state'->'receiptRecorded'='true' and result->'state'->'stopRequested'='true' and result->'state'->>'status'='needs_owner';
 update product_fixture set state=result->'state',revision=(result->>'revision')::integer;
 assert (select outcome='uncertain' and response_summary->'configurationVerified'='false' and response_summary->'stopRequested'='true' from public.action_receipts where id=(f.state->>'receiptId')::uuid);
 assert (select status='pending' and metadata->'listingReady'='false' from public.external_resources where id=(f.state->>'resourceId')::uuid);
 assert (select status='executing' from public.action_intents where id=(f.state->>'actionIntentId')::uuid);
 assert exists(select 1 from public.owner_interventions where action_intent_id=(f.state->>'actionIntentId')::uuid and status='open');
 assert not exists(select 1 from public.artifacts where business_id='15000000-1111-4111-8111-000000000002' and artifact_type='product.package.v1');
end $$;
do $$ declare f product_fixture%rowtype; begin
 select * into f from product_fixture;
 assert pg_temp.product_rpc('save',jsonb_build_object('runId',f.run,'lease',repeat('lease-a-',6),'revision',f.revision,'state',f.state))->'state'=f.state;
 perform pg_temp.expect_error(format('select pg_temp.save_product(%L)',f.state||'{"observationHash":null}'),'product_observation_immutable');
 perform pg_temp.expect_error(format('update public.action_receipts set response_summary=''{}'' where id=%L',f.state->>'receiptId'),'product_core_runtime_managed');
 perform pg_temp.expect_error(format('delete from public.external_resources where id=%L',f.state->>'resourceId'),'product_core_runtime_managed');
 perform pg_temp.expect_error(format('update private.printful_product_operations set marker=''{}'' where run_id=%L',f.run),'product_runtime_managed');
 assert not exists(select 1 from private.printful_product_mutation_admissions);
end $$;
-- Isolated invoker regression: this new guard alone must not deny ordinary
-- authenticated Core operations or expose any private row. Older guards stay
-- untouched on public tables and are compared separately against baseline.
create temp table external_resources (like public.external_resources including defaults);
grant select,insert,update on pg_temp.external_resources to authenticated;
create trigger isolated_product_guard before insert or update or delete on pg_temp.external_resources for each row execute function private.stage15_product_core_guard();
set local role authenticated;
insert into pg_temp.external_resources(business_id,provider,resource_type,external_id) values('15000000-1111-4111-8111-000000000002','ordinary','note','unrelated');
update pg_temp.external_resources set status='inactive' where provider='ordinary';
do $$ begin
 assert (select count(*)=1 from pg_temp.external_resources where provider='ordinary' and status='inactive');
 perform pg_temp.expect_error('select * from private.printful_product_runs','permission denied');
 assert not private.stage15_product_core_identity('15000000-1111-4111-8111-000000000092','external_resources','{}');
end $$;
reset role;
-- Re-run after changing session identity: no same-store cross-Business read.
select set_config('request.jwt.claim.sub','15000000-1111-4111-8111-000000000091',true);
set local role authenticated;
do $$ begin
 perform pg_temp.expect_error('select public.printful_product_owner_transition(''15000000-1111-4111-8111-000000000002'',''workspace'')','owner_required');
 assert public.printful_product_owner_transition('15000000-1111-4111-8111-000000000092','workspace')->'runs'='[]';
end $$;
reset role;
rollback;
