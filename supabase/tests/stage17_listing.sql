-- Rollback-only offline Stage17 regression. No provider/model qualification is
-- fabricated. Real public ACL/source/qualification denials are tested first;
-- then ONLY the newly added Stage17 source/catalog helpers are transactionally
-- substituted to isolate the durable accounting/provenance state machine.
-- These isolated tests are not Stage16 prerequisite or live qualification proof.
begin;
create function pg_temp.expect_error(sql text, expected text default null) returns void language plpgsql as $$
begin
 begin execute sql; exception when others then
  if expected is not null and position(expected in sqlerrm)=0 then raise exception 'Unexpected error: %; wanted %',sqlerrm,expected; end if;
  return;
 end;
 raise exception 'Expected failure did not occur: %',sql;
end $$;
insert into auth.users(id,email) values('17000000-1111-4111-8111-000000000090','stage17-rollback-owner@example.invalid'),('17000000-1111-4111-8111-000000000091','stage17-other-owner@example.invalid');
insert into public.businesses(id,owner_user_id,name) values('17000000-1111-4111-8111-000000000002','17000000-1111-4111-8111-000000000090','Stage17 rollback only'),('17000000-1111-4111-8111-000000000092','17000000-1111-4111-8111-000000000091','Other rollback only');
insert into public.artifacts(id,business_id,artifact_type,name,content) values('17000000-1111-4111-8111-000000000001','17000000-1111-4111-8111-000000000002','product.package.v1','Unqualified offline source','{}');
insert into private.etsy_server_authority values(private.stage13_hash(repeat('server-fixture-only-',3)),true);
select set_config('request.jwt.claim.sub','17000000-1111-4111-8111-000000000090',true);
do $$ begin
 assert not has_function_privilege('anon','public.listing_owner_transition(uuid,text,jsonb,text)','EXECUTE');
 assert has_function_privilege('anon','public.listing_runtime_transition(uuid,uuid,text,text,jsonb)','EXECUTE');
 assert not has_function_privilege('authenticated','private.stage17_owner(uuid,text,jsonb,text)','EXECUTE');
 assert not has_table_privilege('authenticated','private.listing_run_capabilities','SELECT');
 assert not has_table_privilege('authenticated','private.listing_mutation_admissions','INSERT');
 assert not has_table_privilege('service_role','public.listing_runs','INSERT');
 assert not private.stage17_qualified(), 'Registration must not silently qualify workers';
 assert (select count(*)=4 from public.packs where pack_key in ('knowledge.etsy-listing-review','worker.listing-specialist','worker.listing-reviewer','workflow.etsy-listing-review') and status='experimental');
 perform pg_temp.expect_error($q$select private.stage17_assert_sources('17000000-1111-4111-8111-000000000002','17000000-1111-4111-8111-000000000001',repeat('a',64),'{}',repeat('a',64))$q$,'listing_source_input_mismatch');
end $$;
-- A forged "passed" Stage6 record alone cannot authorize paid listing work.
-- The nested subtransaction restores the deliberately spoofed evaluation.
do $$ declare d uuid; kh text; wh jsonb;
begin
 begin
  select w.id into d from public.worker_definitions w where w.worker_key='listing.specialist' and w.version='1.0.0';
  update public.worker_definitions set status='qualified' where id=d;
  insert into public.worker_evaluations(worker_definition_id,suite_id,requested_by,source,idempotency_key,status,subject_fingerprint,runtime_capability_hash,evidence)
   select d,id,'17000000-1111-4111-8111-000000000090','owner','forged-stage17-test','passed',private.stage6_worker_fingerprint(d),repeat('a',64),'{"mockProvider":true}' from public.worker_evaluation_suites limit 1;
  assert private.stage6_worker_is_currently_qualified(d), 'Fixture models the old helper weakness';
  select private.stage14_hash(manifest->'knowledge'->0) into kh from public.packs where pack_key='knowledge.etsy-listing-review';
  select jsonb_object_agg(replace(pack_key,'worker.listing-',''),private.stage14_hash(manifest->'workers'->0->'manifest')) into wh from public.packs where pack_key in ('worker.listing-specialist','worker.listing-reviewer');
  perform pg_temp.expect_error(format('select private.stage17_assert_catalog(%L,%L::jsonb)',kh,wh),'listing_trusted_live_qualification_required');
  raise exception 'rollback_spoofed_stage6_fixture';
 exception when raise_exception then if sqlerrm<>'rollback_spoofed_stage6_fixture' then raise; end if;
 end;
 assert not private.stage17_qualified();
 assert not exists(select 1 from private.listing_live_qualifications);
 assert not has_table_privilege('authenticated','private.listing_live_qualifications','SELECT');
 assert not has_table_privilege('service_role','private.listing_live_qualifications','INSERT');
end $$;
set local role authenticated;
do $$ declare result jsonb; begin
 result:=public.listing_owner_transition('17000000-1111-4111-8111-000000000002','workspace');
 assert result->'qualified'='false'; assert result->'authorityConfigured'='false'; assert result->'runs'='[]';
 result:=public.listing_owner_transition('17000000-1111-4111-8111-000000000002','workspace','{}',repeat('server-fixture-only-',3));
 assert result->'authorityConfigured'='true'; assert result::text not like '%server-fixture-only%';
 perform pg_temp.expect_error($q$select public.listing_owner_transition('17000000-1111-4111-8111-000000000092','workspace')$q$,'owner_required');
 perform pg_temp.expect_error($q$select public.listing_owner_transition('17000000-1111-4111-8111-000000000002','start','{"approveModelCalls":true}')$q$,'server_authority_required');
 perform pg_temp.expect_error($q$select public.listing_runtime_transition('17000000-1111-4111-8111-000000000010','17000000-1111-4111-8111-000000000002',repeat('invalid',8),'load')$q$,'listing_capability_denied');
 perform pg_temp.expect_error($q$insert into public.artifacts(business_id,artifact_type,name) values('17000000-1111-4111-8111-000000000002','listing.business-facts.v1','Forged')$q$,'listing_source_is_server_managed');
 perform pg_temp.expect_error($q$update public.artifacts set content='{"listingInputEnvelope":"forged"}' where id='17000000-1111-4111-8111-000000000001'$q$,'listing_source_is_server_managed');
 perform pg_temp.expect_error($q$insert into public.workflow_runs(business_id,workflow_definition_id,idempotency_key) select '17000000-1111-4111-8111-000000000002',id,'generic-listing-launch' from public.workflow_definitions where workflow_key='etsy.listing-review'$q$);
end $$;
reset role;
-- Even an older generic SECURITY DEFINER path has no private admission.
create function pg_temp.generic_definer_launch() returns void language plpgsql security definer as $$ begin
 insert into public.workflow_runs(business_id,workflow_definition_id,idempotency_key) select '17000000-1111-4111-8111-000000000002',id,'generic-definer-listing-launch' from public.workflow_definitions where workflow_key='etsy.listing-review';
end $$;
select pg_temp.expect_error('select pg_temp.generic_definer_launch()','listing_core_runtime_managed');

create temp table listing_fixture(input jsonb,proposal jsonb,review jsonb,catalog jsonb);
insert into listing_fixture(input,proposal,review) values('{"version":"1.0.0","evidenceMode":"synthetic","factsVerifiedAt":"2026-10-01T10:35:29.029Z","productType":"original_design_on_base_product","aiAssisted":true,"product":{"version":"1.0","id":"17000000-1111-4111-8111-000000000001","businessId":"17000000-1111-4111-8111-000000000002","goalId":"17000000-1111-4111-8111-000000000003","workflowRunId":"17000000-1111-4111-8111-000000000004","productIdentity":"synthetic-fern-shirt","candidateId":"17000000-1111-4111-8111-000000000005","decisionId":"17000000-1111-4111-8111-000000000006","creativeApprovalId":"17000000-1111-4111-8111-000000000007","creativeRunId":"17000000-1111-4111-8111-000000000008","printfulResourceId":"17000000-1111-4111-8111-000000000009","printfulReceiptId":"17000000-1111-4111-8111-000000000010","productFactsHash":"b91aa1654c0a786d4e9b510290bb42a0ecf6a56088ecc91e41e6a47d7e915032","approvedAt":"2026-10-01T10:35:29.029Z","expiresAt":"2026-10-01T11:36:29.029Z","title":"Synthetic product input","description":"Synthetic seed data only","quantity":3,"priceMinor":3295,"currency":"NZD","taxonomyId":482,"shippingProfileId":21,"readinessStateId":22,"productionPartnerIds":[23],"tags":["fern shirt"],"materials":["cotton"],"properties":[{"propertyId":100,"valueIds":[200],"values":["White"],"scaleId":null}],"images":[{"assetId":"17000000-1111-4111-8111-000000000011","sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","storagePath":"17000000-1111-4111-8111-000000000002/17000000-1111-4111-8111-000000000008/version-1.png","mediaType":"image/png","altText":"Finished white cotton shirt with a green fern print"}]},"sources":[{"id":"17000000-1111-4111-8111-000000000030","businessId":"17000000-1111-4111-8111-000000000002","recordId":"17000000-1111-4111-8111-000000000010","recordType":"printful_receipt","verifiedAt":"2026-10-01T10:35:29.029Z","snapshotHash":"5e68c8699f8576e891a5c942481f47322b8159f366c4e98b9fef9729d065532b","snapshot":{"garment":"A white cotton T-shirt with a green fern print on the front.","production":"The seller''s design is printed to order by Printful, the declared production partner."}},{"id":"17000000-1111-4111-8111-000000000031","businessId":"17000000-1111-4111-8111-000000000002","recordId":"17000000-1111-4111-8111-000000000007","recordType":"creative_approval","verifiedAt":"2026-10-01T10:35:29.029Z","snapshotHash":"5d9cc1c5d5494a9ed557e89e584496413ea74e48d8c540312e731d4234be423e","snapshot":{"aiDesign":"The seller used AI tools to create the original fern illustration."}}],"facts":[{"id":"garment","statement":"A white cotton T-shirt with a green fern print on the front.","kind":"product","evidence":[{"sourceId":"17000000-1111-4111-8111-000000000030","pointer":"/garment"}]},{"id":"production","statement":"The seller''s design is printed to order by Printful, the declared production partner.","kind":"production","evidence":[{"sourceId":"17000000-1111-4111-8111-000000000030","pointer":"/production"}]},{"id":"ai-design","statement":"The seller used AI tools to create the original fern illustration.","kind":"rights","evidence":[{"sourceId":"17000000-1111-4111-8111-000000000031","pointer":"/aiDesign"}]}],"disclosures":[{"key":"production_partner","text":"Printed to order by our production partner, Printful.","factIds":["production"]},{"key":"ai","text":"This original illustration was created with the assistance of AI tools.","factIds":["ai-design"]}],"imagery":[{"assetId":"17000000-1111-4111-8111-000000000011","sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","productFactsHash":"b91aa1654c0a786d4e9b510290bb42a0ecf6a56088ecc91e41e6a47d7e915032","kind":"finished_product_mockup","finishedProductShown":true,"reviewArtifactId":"17000000-1111-4111-8111-000000000012","reviewedAt":"2026-10-01T10:35:59.029Z","altText":"Finished white cotton shirt with a green fern print","reviewResultHash":"a643edea3fcf72eb924b19fbc01b5a2f76bf6fffef5d414dc674dc6d540a82e0","reviewResult":{"businessId":"17000000-1111-4111-8111-000000000002","outcome":"PASS","observedProduct":"The reviewed synthetic image shows the entire finished white cotton shirt with the green fern print centered on the front. It is a garment mockup rather than standalone artwork.","productMatches":true,"finishedProductShown":true,"imageRightsVerified":true}}]}'::jsonb,'{"version":"1.0.0","title":{"text":"Green Fern Print T-Shirt, White Cotton","factIds":["garment"]},"description":[{"text":"A green fern illustration is printed on the front of this white cotton T-shirt.","factIds":["garment"]}],"tags":[{"text":"fern shirt","factIds":["garment"]},{"text":"botanical tee","factIds":["garment"]}],"attributes":{"taxonomyId":482,"materials":["cotton"],"properties":[{"propertyId":100,"valueIds":[200],"values":["White"],"scaleId":null}]},"imageOrder":["17000000-1111-4111-8111-000000000011"],"disclosureKeys":["production_partner","ai"]}'::jsonb,'{"version":"1.0.0","verdict":"APPROVE","checks":{"title":{"status":"passed","rationale":"The title identifies the white cotton shirt and fern print supported by garment."},"description":{"status":"passed","rationale":"The paragraph describes only the garment and front print in the verified product fact."},"tags":{"status":"passed","rationale":"Both tags describe the documented fern shirt without unsupported audience or material claims."},"attributes":{"status":"passed","rationale":"Category, cotton material and White property exactly preserve the approved product snapshot."},"imageOrder":{"status":"passed","rationale":"The lead mockup is bound to the exact finished white shirt, fern print and reviewed image hash."},"disclosures":{"status":"passed","rationale":"The description includes both exact production-partner and AI-item disclosures from the facts."},"factualClaims":{"status":"passed","rationale":"Every copy unit is entailed by garment; no shipping, certification, sales or rights promise was added."}}}'::jsonb);
update listing_fixture set input=jsonb_set(jsonb_set(jsonb_set(input,'{evidenceMode}','"live"'),'{product,approvedAt}',to_jsonb((clock_timestamp()-interval '1 minute')::text)),'{product,expiresAt}',to_jsonb((clock_timestamp()+interval '1 hour')::text));
update listing_fixture set catalog=(select jsonb_object_agg(replace(p.pack_key,'worker.listing-',''),jsonb_build_object('workerDefinitionId',d.id,'manifest',p.manifest->'workers'->0->'manifest','pack',p.manifest)) from public.packs p join public.worker_definitions d on d.pack_id=p.id where p.pack_key in ('worker.listing-specialist','worker.listing-reviewer'))||jsonb_build_object('knowledge',(select manifest->'knowledge'->0 from public.packs where pack_key='knowledge.etsy-listing-review'));
-- Resolve actual provider/business/image rows using an exact copy of the new
-- source validator, isolating only its separately tested Stage16 readiness call.
-- No deployed function or older Stage16 helper is changed by this probe.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('private.stage17_assert_sources(uuid,uuid,text,jsonb,text)'::regprocedure);
 definition:=replace(definition,'FUNCTION private.stage17_assert_sources','FUNCTION pg_temp.stage17_assert_source_records');
 definition:=replace(definition,'perform private.stage16_assert_package(p_business,p_input->''product'');','null; -- Outer Stage16 readiness separately tested unchanged.');
 execute definition;
end $$;
create temp table listing_source_fixture(input jsonb);
do $$ declare f listing_fixture%rowtype; input jsonb; proof jsonb; src jsonb; business_source uuid:=gen_random_uuid(); intent uuid:=gen_random_uuid(); b uuid:='17000000-1111-4111-8111-000000000002';
begin
 select * into f from listing_fixture; input:=f.input;
 src:=jsonb_set(input->'sources'->0,'{verifiedAt}',to_jsonb(clock_timestamp()::text));
 input:=jsonb_set(jsonb_set(jsonb_set(input,'{sources}',jsonb_build_array(src)),'{aiAssisted}','false'),'{factsVerifiedAt}',to_jsonb(clock_timestamp()::text));
 insert into public.action_intents(id,business_id,action_type,capability,status,idempotency_key,created_by_type) values(intent,b,'printful.product.configure','printful.foundation','completed','stage17-source-probe','system');
 insert into public.action_receipts(id,business_id,action_intent_id,attempt,outcome,provider,request_fingerprint,response_summary) values((src->>'recordId')::uuid,b,intent,1,'succeeded','printful',repeat('b',64),jsonb_build_object('listingFacts',src->'snapshot'));
 insert into public.artifacts(id,business_id,artifact_type,name,content) values(business_source,b,'listing.business-facts.v1','Business source test',jsonb_build_object('listingSourceSnapshot','{"productionPartner":"Printful"}'::jsonb,'listingSourceEnvelope',repeat('source-seal-fixture-',3)));
 src:=jsonb_build_object('id',gen_random_uuid(),'businessId',b,'recordId',business_source,'recordType','business_approval','snapshot','{"productionPartner":"Printful"}'::jsonb,'snapshotHash',private.stage14_hash('{"productionPartner":"Printful"}'),'verifiedAt',clock_timestamp());
 input:=jsonb_set(input,'{sources}',input->'sources'||jsonb_build_array(src));
 proof:=jsonb_set(input->'imagery'->0,'{reviewedAt}',to_jsonb(clock_timestamp()::text)); proof:=jsonb_set(proof,'{reviewResultHash}',to_jsonb(private.stage14_hash(proof-'reviewResultHash')));
 input:=jsonb_set(input,'{imagery}',jsonb_build_array(proof));
 insert into public.artifacts(id,business_id,artifact_type,name,content) values((proof->>'reviewArtifactId')::uuid,b,'listing.image-review.v1','Image proof test',jsonb_build_object('proof',proof,'reviewResultHash',proof->>'reviewResultHash','imageReviewEnvelope',repeat('image-seal-fixture-',3)));
 insert into listing_source_fixture values(input);
end $$;
create function pg_temp.check_source_input(value jsonb) returns void language plpgsql as $$
declare sid uuid:=gen_random_uuid(); content jsonb; b uuid:='17000000-1111-4111-8111-000000000002';
begin
 value:=jsonb_set(value,'{product,id}',to_jsonb(sid::text)); content:=jsonb_build_object('listingInput',value,'listingInputEnvelope',repeat('input-seal-fixture-',3));
 insert into public.artifacts(id,business_id,artifact_type,name,content) values(sid,b,'product.package.v1','Isolated source resolution',content);
 perform pg_temp.stage17_assert_source_records(b,sid,private.stage14_hash(content),value,private.stage14_hash(value));
end $$;
do $$ declare input jsonb; altered jsonb; snapshot jsonb; begin
 select f.input into input from listing_source_fixture f;
 perform pg_temp.check_source_input(input); assert true, 'Actual provider, business and image snapshots resolved';
 altered:=jsonb_set(input,'{factsVerifiedAt}','"2000-01-01T00:00:00Z"'); perform pg_temp.expect_error(format('select pg_temp.check_source_input(%L::jsonb)',altered),'listing_facts_stale');
 snapshot:=(input->'sources'->0->'snapshot')||'{"garment":"Invented silk"}'::jsonb;
 altered:=jsonb_set(jsonb_set(input,'{sources,0,snapshot}',snapshot),'{sources,0,snapshotHash}',to_jsonb(private.stage14_hash(snapshot)));
 perform pg_temp.expect_error(format('select pg_temp.check_source_input(%L::jsonb)',altered),'listing_source_record_mismatch');
 altered:=jsonb_set(input,'{sources,0,recordId}',to_jsonb(gen_random_uuid()::text)); perform pg_temp.expect_error(format('select pg_temp.check_source_input(%L::jsonb)',altered),'listing_receipt_binding_invalid');
 altered:=jsonb_set(input,'{sources,1,recordId}',to_jsonb(gen_random_uuid()::text)); perform pg_temp.expect_error(format('select pg_temp.check_source_input(%L::jsonb)',altered),'listing_source_record_mismatch');
 altered:=jsonb_set(input,'{imagery,0,reviewArtifactId}',to_jsonb(gen_random_uuid()::text)); perform pg_temp.expect_error(format('select pg_temp.check_source_input(%L::jsonb)',altered),'listing_image_proof_mismatch');
 altered:=jsonb_set(input,'{aiAssisted}','true'); perform pg_temp.expect_error(format('select pg_temp.check_source_input(%L::jsonb)',altered),'listing_ai_provenance_mismatch');
end $$;
-- Isolated prerequisite substitutes, restored by final ROLLBACK.
create or replace function private.stage17_assert_sources(p_business uuid,p_source uuid,p_content_hash text,p_input jsonb,p_input_hash text) returns void language plpgsql set search_path='' as $$ begin
 if p_input_hash<>private.stage14_hash(p_input) then raise exception 'test_input_drift'; end if;
end $$;
create or replace function private.stage17_assert_catalog(p_knowledge_hash text,p_worker_hashes jsonb) returns jsonb language sql set search_path='' as $$ select catalog from pg_temp.listing_fixture $$;
create function pg_temp.seed_listing(n integer,expires timestamptz default clock_timestamp()+interval '1 hour') returns uuid language plpgsql as $$
declare rid uuid:=private.stage4_deterministic_uuid('stage17-test-run:'||n); wid uuid:=private.stage4_deterministic_uuid('stage17-test-workflow:'||n); f listing_fixture%rowtype; role_name text; idx integer:=0;
begin
 select * into f from listing_fixture;
 insert into private.listing_mutation_admissions values(txid_current());
 insert into public.workflow_runs(id,business_id,workflow_definition_id,status,current_stage_key,idempotency_key) select wid,'17000000-1111-4111-8111-000000000002',id,'running','specialist','stage17-test:'||n from public.workflow_definitions where workflow_key='etsy.listing-review';
 -- A distinct offline-only input marker provides independent scenarios.
 f.input:=f.input||jsonb_build_object('offlineTestCase',n);
 insert into public.listing_runs(id,business_id,owner_id,workflow_run_id,source_artifact_id,output_artifact_id,input,input_hash,source_content_hash,knowledge_hash,worker_hashes,catalog_snapshot,quote,maximum_microusd,capability_expires_at,status)
 values(rid,'17000000-1111-4111-8111-000000000002','17000000-1111-4111-8111-000000000090',wid,'17000000-1111-4111-8111-000000000001',gen_random_uuid(),f.input,private.stage14_hash(f.input),repeat('a',64),private.stage14_hash(f.catalog->'knowledge'),jsonb_build_object('specialist',private.stage14_hash(f.catalog->'specialist'->'manifest'),'reviewer',private.stage14_hash(f.catalog->'reviewer'->'manifest')),f.catalog,jsonb_build_object('version','listing-estimate-1.0','inputHash',private.stage14_hash(f.input),'maximumCalls',2,'maximumEstimateMicrousd',200000,'ceilings',jsonb_build_object('specialist',100000,'reviewer',100000),'models',jsonb_build_object('specialist','openai/gpt-5.6-luna','reviewer','anthropic/claude-haiku-4.5'),'verifiedAt',clock_timestamp(),'source','https://openrouter.ai/api/v1/models','primaryOnly',true,'estimateOnly',true,'providerInvoiceGuarantee',false),250000,expires,'running');
 insert into private.listing_run_capabilities values(rid,private.stage13_hash(repeat('runtime-fixture-only-',3)),gen_random_uuid());
 foreach role_name in array array['specialist','reviewer'] loop
 idx:=idx+1; insert into public.workflow_stage_runs(id,business_id,workflow_run_id,stage_key,sequence) values(private.stage4_deterministic_uuid('listing:stage:'||rid||':'||role_name),'17000000-1111-4111-8111-000000000002',wid,role_name,idx);
 end loop;
 delete from private.listing_mutation_admissions where transaction_id=txid_current(); return rid;
end $$;
create function pg_temp.reservation_payload(rid uuid,role_name text) returns jsonb language plpgsql as $$
declare r public.listing_runs%rowtype; tid uuid:=private.stage4_deterministic_uuid('listing:task:'||rid||':'||role_name); kid uuid:=private.stage4_deterministic_uuid('listing:knowledge:'||tid); content jsonb; catalog jsonb;
begin
 select * into strict r from public.listing_runs where id=rid; catalog:=r.catalog_snapshot; content:=jsonb_build_object('input',r.input);
 if role_name='reviewer' then content:=content||(select jsonb_build_object('proposal',output,'specialistExecution',execution) from public.listing_phase_outputs where listing_run_id=rid and role='specialist'); end if;
 return jsonb_build_object('role',role_name,'reservedMicrousd',15192,'requestHash',private.stage13_hash(rid||role_name),'estimate',jsonb_build_object('version','listing-estimate-1.0','role',role_name,'inputHash',r.input_hash,'maximumMicrousd',r.maximum_microusd,'approvedPhaseCeilingMicrousd',100000,'requestBytes',1000,'inputTokenAllowance',9192,'outputTokenAllowance',6000,'reservedMicrousd',15192,'transportRequestHash',private.stage13_hash('transport:'||rid||role_name),'primaryOnly',true,'estimateOnly',true,'providerInvoiceGuarantee',false,'quote',jsonb_build_object('modelId',r.quote->'models'->>role_name,'source','https://openrouter.ai/api/v1/models','verifiedAt',clock_timestamp(),'inputPerMillion',1,'outputPerMillion',1,'cacheWritePerMillion',0)),
 'context',jsonb_build_object('taskContract',jsonb_build_object('id',tid,'objective','Isolated offline state machine test','inputArtifactIds',jsonb_build_array(r.source_artifact_id,kid),'permittedCapabilities','[]'::jsonb,'requiredKnowledge','["etsy.listing-review"]'::jsonb,'requiredOutputSchema',catalog->role_name->'manifest'->'outputSchema','completionCriteria','{}'::jsonb,'failureCriteria','{}'::jsonb,'nonGoals','[]'::jsonb,'escalationRules','{"maximumAttempts":1,"retry":false}'::jsonb),
 'inputArtifacts',jsonb_build_array(jsonb_build_object('id',r.source_artifact_id,'content',content),jsonb_build_object('id',kid,'content',catalog->'knowledge'->'content'))));
end $$;
create function pg_temp.settlement_payload(rid uuid,role_name text,charge bigint,validated boolean default true) returns jsonb language plpgsql as $$
declare output jsonb; model text; request_id text:=rid||':'||role_name; completed text:=clock_timestamp()::text;
begin
 select case role_name when 'specialist' then proposal else review end into output from listing_fixture;
 model:=case role_name when 'specialist' then 'openai/gpt-5.6-luna' else 'anthropic/claude-haiku-4.5' end;
 return jsonb_build_object('role',role_name,'reportedMicrousd',charge,'providerRequestId',request_id,'receipt',jsonb_build_object('version','1.0.0','role',role_name,'executionMode','listing.model','mockProvider',false,'requestedModel',model,'actualProviderModelId',model,'provider','openrouter','upstreamProvider',case role_name when 'specialist' then 'OpenAI' else 'Anthropic' end,'providerRequestId',request_id,'reportedMicrousd',charge,'unknownCharge',charge is null,'requestHash',private.stage13_hash(rid||role_name),'transportRequestHash',private.stage13_hash('transport:'||rid||role_name),'outputValidated',validated,'outputHash',private.stage14_hash(output),'completedAt',completed));
end $$;
create function pg_temp.persist_payload(rid uuid,role_name text) returns jsonb language sql as $$
 select jsonb_build_object('role',role_name,'output',case role_name when 'specialist' then f.proposal else f.review end,'execution',jsonb_build_object('version','1.0.0','mode','live_model','taskId',private.stage4_deterministic_uuid('listing:task:'||rid||':'||role_name),'workerKey','listing.'||role_name,'workerVersion','1.0.0','providerModelId',s.receipt->>'actualProviderModelId','providerRequestId',s.provider_request_id,'requestHash',s.receipt->>'requestHash','outputHash',s.receipt->>'outputHash','completedAt',s.receipt->>'completedAt')) from listing_fixture f cross join public.listing_cost_settlements s where s.listing_run_id=rid and s.role=role_name;
$$;
-- Launch serialization and permanent dedup use the actual owner RPC. Only the
-- already documented new source/catalog helper substitutes remain in effect.
do $$ declare f listing_fixture%rowtype; source uuid:=gen_random_uuid(); payload jsonb; result jsonb; result2 jsonb; ih text; b uuid:='17000000-1111-4111-8111-000000000002'; issued_before timestamptz; issued_after timestamptz;
begin
 select * into f from listing_fixture; f.input:=jsonb_set(f.input,'{product,id}',to_jsonb(source::text)); ih:=private.stage14_hash(f.input);
 insert into public.goals(id,business_id,title,status) values((f.input->'product'->>'goalId')::uuid,b,'Rollback isolated launch','active');
 insert into public.artifacts(id,business_id,artifact_type,name,content) values(source,b,'product.package.v1','Rollback sealed fixture',jsonb_build_object('listingInput',f.input,'listingInputEnvelope',repeat('fixture-seal-',4)));
 payload:=jsonb_build_object('sourceArtifactId',source,'sourceEnvelope',repeat('fixture-seal-',4),'sourceContentHash',private.stage14_hash(jsonb_build_object('listingInput',f.input,'listingInputEnvelope',repeat('fixture-seal-',4))),'input',f.input,'inputHash',ih,'quote',jsonb_build_object('version','listing-estimate-1.0','inputHash',ih,'maximumCalls',2,'maximumEstimateMicrousd',200000,'ceilings',jsonb_build_object('specialist',100000,'reviewer',100000),'models',jsonb_build_object('specialist','openai/gpt-5.6-luna','reviewer','anthropic/claude-haiku-4.5'),'verifiedAt',clock_timestamp(),'source','https://openrouter.ai/api/v1/models','primaryOnly',true,'estimateOnly',true,'providerInvoiceGuarantee',false),'maximumMicrousd',250000,'runtimeCapability',repeat('start-capability-',4),'launchNonce',gen_random_uuid(),'knowledgeHash',private.stage14_hash(f.catalog->'knowledge'),'workerHashes','{}'::jsonb,'approveModelCalls',true);
 issued_before:=clock_timestamp();
 result:=public.listing_owner_transition(b,'start',payload,repeat('server-fixture-only-',3));
 issued_after:=clock_timestamp(); assert result->'shouldStart'='true';
 result2:=public.listing_owner_transition(b,'start',payload||jsonb_build_object('runtimeCapability',repeat('replacement-must-fail-',3),'launchNonce',gen_random_uuid()),repeat('server-fixture-only-',3)); assert result2->'shouldStart'='false'; assert result2->'id'=result->'id';
 assert (select capability_hash=private.stage13_hash(repeat('start-capability-',4)) from private.listing_run_capabilities where listing_run_id=(result->>'id')::uuid);
 -- created_at uses transaction-start now(); capability issuance uses the wall
 -- clock. Bracket that exact call, with no timing tolerance or later test work.
 assert (select capability_expires_at between least(issued_before+interval '1 hour',(payload->'input'->'product'->>'expiresAt')::timestamptz) and least(issued_after+interval '1 hour',(payload->'input'->'product'->>'expiresAt')::timestamptz) from public.listing_runs where id=(result->>'id')::uuid);
 perform public.listing_owner_transition(b,'cancel',jsonb_build_object('runId',result->>'id'));
 result2:=public.listing_owner_transition(b,'start',payload,repeat('server-fixture-only-',3)); assert result2->'shouldStart'='false'; assert result2->'id'=result->'id';
 perform pg_temp.expect_error(format('select public.listing_owner_transition(%L,''start'',%L::jsonb,%L)',b,jsonb_set(payload,'{quote,verifiedAt}','"2000-01-01T00:00:00Z"'),repeat('server-fixture-only-',3)),'listing_quote_invalid_or_stale');
 perform pg_temp.expect_error(format('select public.listing_owner_transition(%L,''start'',%L::jsonb,%L)',b,jsonb_set(payload,'{inputHash}',to_jsonb(repeat('f',64))),repeat('server-fixture-only-',3)),'test_input_drift');
end $$;
-- Actual handlers, checks, triggers, Core rows and accounting are exercised below.
do $$ declare rid uuid; rid2 uuid; rid3 uuid; rid4 uuid; rid5 uuid; b uuid:='17000000-1111-4111-8111-000000000002'; cap text:=repeat('runtime-fixture-only-',3); payload jsonb; settled jsonb; result jsonb; altered jsonb; output jsonb; product jsonb; reviewed jsonb; r public.listing_runs%rowtype; f listing_fixture%rowtype;
begin
 rid:=pg_temp.seed_listing(1); rid2:=pg_temp.seed_listing(2); rid3:=pg_temp.seed_listing(3); rid4:=pg_temp.seed_listing(4); rid5:=pg_temp.seed_listing(5);
 perform pg_temp.expect_error(format('select public.listing_runtime_transition(%L,%L,%L,''finish'')',rid,b,cap),'listing_finish_two_known_calls_required');
 perform pg_temp.expect_error(format('select public.listing_owner_transition(%L,''close'',%L::jsonb)',b,jsonb_build_object('runId',rid)),'listing_run_not_expired');
 payload:=pg_temp.reservation_payload(rid,'specialist');
 result:=public.listing_runtime_transition(rid,b,cap,'reserve',payload); assert result->'shouldExecute'='true'; assert result->'committedMicrousd'='15192';
 result:=public.listing_runtime_transition(rid,b,cap,'reserve',payload); assert result->'shouldExecute'='false';
 perform pg_temp.expect_error(format('select public.listing_runtime_transition(%L,%L,%L,''reserve'',%L::jsonb)',rid,b,cap,jsonb_set(payload,'{requestHash}',to_jsonb(repeat('f',64)))),'listing_reservation_replay_mismatch');
 perform pg_temp.expect_error(format('select public.listing_runtime_transition(%L,%L,%L,''reserve'',%L::jsonb)',rid,b,cap,pg_temp.reservation_payload(rid,'reviewer')),'listing_phase_or_lifetime_invalid');
 assert (public.listing_runtime_transition(rid,b,cap,'guard')->>'phase')='specialist';
 settled:=pg_temp.settlement_payload(rid,'specialist',10000);
 perform pg_temp.expect_error(format('select public.listing_runtime_transition(%L,%L,%L,''settle'',%L::jsonb)',rid,b,cap,jsonb_set(settled,'{receipt,actualProviderModelId}','"wrong/model"')),'listing_receipt_mismatch');
 perform public.listing_runtime_transition(rid,b,cap,'settle',settled);
 result:=public.listing_runtime_transition(rid,b,cap,'settle',settled); assert result->'recorded'='false';
 perform pg_temp.expect_error(format('select public.listing_runtime_transition(%L,%L,%L,''settle'',%L::jsonb)',rid,b,cap,settled||'{"reportedMicrousd":0}'::jsonb),'listing_settlement_replay_mismatch');
 payload:=pg_temp.persist_payload(rid,'specialist');
 perform pg_temp.expect_error(format('select public.listing_runtime_transition(%L,%L,%L,''persist'',%L::jsonb)',rid,b,cap,jsonb_set(payload,'{execution,requestHash}',to_jsonb(repeat('f',64)))),'listing_validated_known_settlement_required');
 perform public.listing_runtime_transition(rid,b,cap,'persist',payload);
 assert (select phase='reviewer' from public.listing_runs where id=rid);
 assert (select count(*)=1 from public.listing_phase_outputs where listing_run_id=rid);
 assert (select status='completed' from public.task_contracts where id=private.stage4_deterministic_uuid('listing:task:'||rid||':specialist'));
 payload:=pg_temp.reservation_payload(rid,'reviewer');
 result:=public.listing_runtime_transition(rid,b,cap,'reserve',payload); assert result->'committedMicrousd'='25192';
 settled:=pg_temp.settlement_payload(rid,'reviewer',0); perform public.listing_runtime_transition(rid,b,cap,'settle',settled); perform public.listing_runtime_transition(rid,b,cap,'persist',pg_temp.persist_payload(rid,'reviewer'));
 assert (select phase='issue' from public.listing_runs where id=rid);
 assert private.stage17_costs(rid)->'knownMicrousd'='10000'; assert private.stage17_costs(rid)->'unknownCount'='0';
 select * into r from public.listing_runs where id=rid; select * into f from listing_fixture;
 product:=(r.input->'product')||jsonb_build_object('id',r.output_artifact_id,'title',f.proposal->'title'->>'text','description',(select string_agg(x->>'text',E'\n\n' order by ord) from jsonb_array_elements((f.proposal->'description')||(r.input->'disclosures')) with ordinality t(x,ord)),'tags',(select jsonb_agg(x->'text') from jsonb_array_elements(f.proposal->'tags') x));
 reviewed:=jsonb_build_object('version','1.0.0','input',r.input,'proposal',f.proposal,'review',f.review,'specialist',(select execution from public.listing_phase_outputs where listing_run_id=rid and role='specialist'),'reviewer',(select execution from public.listing_phase_outputs where listing_run_id=rid and role='reviewer'),'knowledgeHash',r.knowledge_hash,'outputArtifactId',r.output_artifact_id,'productPackageHash',private.stage14_hash(product),'publicationAllowed',false);
 payload:=jsonb_build_object('product',product,'reviewedListing',reviewed,'etsyDraftEnvelope',repeat('sealed-fixture-',4),'listingReviewEnvelope',repeat('sealed-review-fixture-',4));
 perform pg_temp.expect_error(format('select public.listing_runtime_transition(%L,%L,%L,''finish'',%L::jsonb)',rid,b,cap,jsonb_set(payload,'{product,priceMinor}','1')),'listing_final_package_changed');
 perform pg_temp.expect_error(format('select public.listing_runtime_transition(%L,%L,%L,''finish'',%L::jsonb)',rid,b,cap,jsonb_set(payload,'{reviewedListing,publicationAllowed}','true')),'listing_final_review_binding_invalid');
 -- Authentic Stage16 gate remains unmodified and still rejects fixture issue.
 perform pg_temp.expect_error(format('select public.listing_runtime_transition(%L,%L,%L,''finish'',%L::jsonb)',rid,b,cap,payload),'goal_or_workflow_stopped');
 assert not exists(select 1 from public.artifacts where id=r.output_artifact_id);
 -- Unknown accounting is permanently retained and stops the second call.
 perform public.listing_runtime_transition(rid2,b,cap,'reserve',pg_temp.reservation_payload(rid2,'specialist'));
 settled:=pg_temp.settlement_payload(rid2,'specialist',null,false); perform public.listing_runtime_transition(rid2,b,cap,'settle',settled);
 assert (select status='failed' and reason='provider_cost_unknown' from public.listing_runs where id=rid2);
 assert private.stage17_costs(rid2)->'committedMicrousd'='15192'; assert private.stage17_costs(rid2)->'unknownCount'='1';
 perform pg_temp.expect_error(format('select public.listing_runtime_transition(%L,%L,%L,''settle'',%L::jsonb)',rid2,b,cap,pg_temp.settlement_payload(rid2,'specialist',0,false)),'listing_settlement_replay_mismatch');
 perform pg_temp.expect_error(format('select public.listing_runtime_transition(%L,%L,%L,''reserve'',%L::jsonb)',rid2,b,cap,pg_temp.reservation_payload(rid2,'reviewer')),'listing_run_terminal');
 perform public.listing_owner_transition(b,'cancel',jsonb_build_object('runId',rid2)); assert (select status='failed' from public.listing_runs where id=rid2);
 -- Late in-flight charge after owner cancellation is append-only and retained.
 perform public.listing_runtime_transition(rid3,b,cap,'reserve',pg_temp.reservation_payload(rid3,'specialist'));
 perform public.listing_owner_transition(b,'cancel',jsonb_build_object('runId',rid3));
 perform public.listing_runtime_transition(rid3,b,cap,'settle',pg_temp.settlement_payload(rid3,'specialist',300000));
 assert (select status='cancelled' from public.listing_runs where id=rid3); assert private.stage17_costs(rid3)->'knownMicrousd'='300000';
 assert (select status='cancelled' from public.worker_runs where id=private.stage4_deterministic_uuid('listing:worker:'||rid3||':specialist'));
 -- Over-cap actual charge is retained, never clamped to the original estimate.
 perform public.listing_runtime_transition(rid4,b,cap,'reserve',pg_temp.reservation_payload(rid4,'specialist'));
 perform public.listing_runtime_transition(rid4,b,cap,'settle',pg_temp.settlement_payload(rid4,'specialist',300000));
 assert (select status='failed' and reason='actual_cost_exceeded_approval' from public.listing_runs where id=rid4);
 assert private.stage17_costs(rid4)->'committedMicrousd'='300000';
 -- Explicit fresh zero-price estimate/settlement is known zero, never NULL.
 payload:=pg_temp.reservation_payload(rid5,'specialist'); payload:=jsonb_set(jsonb_set(jsonb_set(jsonb_set(payload,'{reservedMicrousd}','0'),'{estimate,reservedMicrousd}','0'),'{estimate,quote,inputPerMillion}','0'),'{estimate,quote,outputPerMillion}','0');
 result:=public.listing_runtime_transition(rid5,b,cap,'reserve',payload); assert result->'committedMicrousd'='0';
 perform public.listing_runtime_transition(rid5,b,cap,'settle',pg_temp.settlement_payload(rid5,'specialist',0)); assert private.stage17_costs(rid5)->'unknownCount'='0';
 -- SQL triggers prevent rewriting provenance even by another privileged RPC.
 perform pg_temp.expect_error(format('update public.listing_cost_settlements set reported_microusd=0 where listing_run_id=%L',rid3),'listing_runtime_managed');
 perform pg_temp.expect_error(format('update public.workflow_runs set status=''running'' where id=%L',r.workflow_run_id),'listing_core_runtime_managed');
 insert into private.listing_mutation_admissions values(txid_current());
 perform pg_temp.expect_error(format('delete from public.listing_cost_settlements where listing_run_id=%L',rid3),'listing_provenance_append_only');
 perform pg_temp.expect_error(format('update public.listing_runs set input=''{}'' where id=%L',rid),'listing_identity_immutable');
 perform pg_temp.expect_error(format('update public.artifacts set content=''{}'' where id=%L',private.stage4_deterministic_uuid('listing:output:'||rid||':specialist')),'listing_source_immutable');
 delete from private.listing_mutation_admissions where transaction_id=txid_current();
 assert (select count(*)=0 from private.listing_mutation_admissions), 'Admission must not survive a call';
end $$;
-- Seed an already-dispatched expired call administratively; no production
-- transition is bypassed to obtain another attempt or revive a terminal run.
do $$ declare rid uuid:=pg_temp.seed_listing(6,clock_timestamp()-interval '1 second'); r public.listing_runs%rowtype; payload jsonb; task uuid; worker uuid; b uuid:='17000000-1111-4111-8111-000000000002'; cap text:=repeat('runtime-fixture-only-',3);
begin
 select * into r from public.listing_runs where id=rid; payload:=pg_temp.reservation_payload(rid,'specialist');
 task:=private.stage4_deterministic_uuid('listing:task:'||rid||':specialist'); worker:=private.stage4_deterministic_uuid('listing:worker:'||rid||':specialist');
 insert into private.listing_mutation_admissions values(txid_current());
 insert into public.task_contracts(id,business_id,workflow_run_id,workflow_stage_run_id,worker_definition_id,status,objective) values(task,b,r.workflow_run_id,private.stage4_deterministic_uuid('listing:stage:'||rid||':specialist'),(r.catalog_snapshot->'specialist'->>'workerDefinitionId')::uuid,'running','Already dispatched before expiry');
 insert into public.worker_runs(id,business_id,workflow_run_id,task_contract_id,worker_definition_id,status) values(worker,b,r.workflow_run_id,task,(r.catalog_snapshot->'specialist'->>'workerDefinitionId')::uuid,'running');
 insert into public.listing_cost_reservations(listing_run_id,business_id,role,reserved_microusd,request_hash,model,provider,estimate,context,task_contract_id,worker_run_id) values(rid,b,'specialist',15192,payload->>'requestHash','openai/gpt-5.6-luna','openrouter',payload->'estimate',payload->'context',task,worker);
 delete from private.listing_mutation_admissions where transaction_id=txid_current();
 perform pg_temp.expect_error(format('select public.listing_runtime_transition(%L,%L,%L,''guard'')',rid,b,cap),'listing_capability_expired');
 perform public.listing_runtime_transition(rid,b,cap,'settle',pg_temp.settlement_payload(rid,'specialist',75));
 assert private.stage17_costs(rid)->'knownMicrousd'='75';
 perform public.listing_owner_transition(b,'close',jsonb_build_object('runId',rid)); assert (select status='cancelled' and reason='expired' from public.listing_runs where id=rid);
end $$;
-- Reviewer uncertainty is a terminal non-product outcome, not issued success.
do $$ declare rid uuid:=pg_temp.seed_listing(7); b uuid:='17000000-1111-4111-8111-000000000002'; cap text:=repeat('runtime-fixture-only-',3); original jsonb;
begin
 perform public.listing_runtime_transition(rid,b,cap,'reserve',pg_temp.reservation_payload(rid,'specialist'));
 perform public.listing_runtime_transition(rid,b,cap,'settle',pg_temp.settlement_payload(rid,'specialist',0));
 perform public.listing_runtime_transition(rid,b,cap,'persist',pg_temp.persist_payload(rid,'specialist'));
 select review into original from listing_fixture;
 update listing_fixture set review=jsonb_set(jsonb_set(review,'{verdict}','"NEEDS_EVIDENCE"'),'{checks,imageOrder,status}','"needs_evidence"');
 perform public.listing_runtime_transition(rid,b,cap,'reserve',pg_temp.reservation_payload(rid,'reviewer'));
 perform public.listing_runtime_transition(rid,b,cap,'settle',pg_temp.settlement_payload(rid,'reviewer',0));
 perform public.listing_runtime_transition(rid,b,cap,'persist',pg_temp.persist_payload(rid,'reviewer'));
 assert (select status='needs_evidence' and phase='terminal' from public.listing_runs where id=rid);
 assert not exists(select 1 from public.artifacts a join public.listing_runs r on r.output_artifact_id=a.id where r.id=rid);
 perform public.listing_owner_transition(b,'cancel',jsonb_build_object('runId',rid)); assert (select status='needs_evidence' from public.listing_runs where id=rid);
 update listing_fixture set review=original;
end $$;
-- A malformed paid reviewer response reusing a request ID still records its
-- charge. Reused identity can never persist a valid independent review.
do $$ declare rid uuid:=pg_temp.seed_listing(8); b uuid:='17000000-1111-4111-8111-000000000002'; cap text:=repeat('runtime-fixture-only-',3); payload jsonb; prior_id text;
begin
 perform public.listing_runtime_transition(rid,b,cap,'reserve',pg_temp.reservation_payload(rid,'specialist'));
 perform public.listing_runtime_transition(rid,b,cap,'settle',pg_temp.settlement_payload(rid,'specialist',100));
 perform public.listing_runtime_transition(rid,b,cap,'persist',pg_temp.persist_payload(rid,'specialist'));
 select provider_request_id into prior_id from public.listing_cost_settlements where listing_run_id=rid and role='specialist';
 perform public.listing_runtime_transition(rid,b,cap,'reserve',pg_temp.reservation_payload(rid,'reviewer'));
 payload:=pg_temp.settlement_payload(rid,'reviewer',100,false);
 payload:=jsonb_set(jsonb_set(payload,'{providerRequestId}',to_jsonb(prior_id)),'{receipt,providerRequestId}',to_jsonb(prior_id));
 perform pg_temp.expect_error(format('select public.listing_runtime_transition(%L,%L,%L,''settle'',%L::jsonb)',rid,b,cap,payload),'r05_receipt_already_used');
 assert private.stage17_costs(rid)->'knownMicrousd'='100';
 assert private.stage17_costs(rid)->'pendingCount'='1';
 assert (select count(*)=1 from public.listing_cost_settlements where listing_run_id=rid and provider_request_id=prior_id);
 assert not exists(select 1 from public.listing_phase_outputs where listing_run_id=rid and role='reviewer');
end $$;
set local role authenticated;
do $$ declare w jsonb; begin
 assert (select count(*)=9 from public.listing_runs);
 w:=public.listing_owner_transition('17000000-1111-4111-8111-000000000002','workspace'); assert jsonb_array_length(w->'runs')=9;
 assert w::text not like '%runtime-fixture-only%' and w::text not like '%capability_hash%' and w::text not like '%listingInputEnvelope%';
 assert jsonb_typeof(w->'runs'->0->'costs')='array';
end $$;
select set_config('request.jwt.claim.sub','17000000-1111-4111-8111-000000000091',true);
do $$ begin
 assert (select count(*)=0 from public.listing_runs);
 assert (select count(*)=0 from public.listing_cost_settlements);
 perform pg_temp.expect_error($q$select public.listing_owner_transition('17000000-1111-4111-8111-000000000002','cancel','{"runId":"17000000-1111-4111-8111-000000000001"}')$q$,'owner_required');
end $$;
reset role;
rollback;
