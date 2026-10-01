-- Offline rollback-only Stage18 contract tests. Synthetic records never qualify
-- real products. Source provenance is tested with the real helper; state-machine
-- tests isolate upstream live freshness plus the explicitly unavailable all-in
-- fee authority. No provider, account, marketplace or paid operation occurs.
begin;
create function pg_temp.expect_error(sql text, expected text default null) returns void language plpgsql as $$
begin
 begin execute sql; exception when others then
  if expected is not null and position(expected in sqlerrm)=0 then raise exception 'Unexpected error: %; wanted %',sqlerrm,expected; end if; return;
 end; raise exception 'Expected failure did not occur: %',sql;
end $$;
insert into auth.users(id,email) values('18000000-1111-4111-8111-000000000090','stage18-owner@example.invalid'),('18000000-1111-4111-8111-000000000091','stage18-other@example.invalid');
insert into public.businesses(id,owner_user_id,name) values('18000000-1111-4111-8111-000000000002','18000000-1111-4111-8111-000000000090','Rollback publication'),('18000000-1111-4111-8111-000000000092','18000000-1111-4111-8111-000000000091','Other rollback publication');
insert into private.etsy_server_authority values(private.stage13_hash(repeat('stage18-server-fixture-',3)),true);
select set_config('request.jwt.claim.sub','18000000-1111-4111-8111-000000000090',true);
do $$ begin
 assert has_function_privilege('authenticated','public.etsy_publication_owner_transition(uuid,text,jsonb,text)','EXECUTE');
 assert not has_function_privilege('anon','public.etsy_publication_owner_transition(uuid,text,jsonb,text)','EXECUTE');
 assert not has_function_privilege('service_role','public.etsy_publication_owner_transition(uuid,text,jsonb,text)','EXECUTE');
 assert not has_function_privilege('authenticated','private.stage18_owner(uuid,text,jsonb,text)','EXECUTE');
 assert not has_function_privilege('authenticated','private.stage18_assert_fee_authority(uuid,uuid,jsonb)','EXECUTE');
 assert not has_table_privilege('authenticated','private.etsy_publication_runs','SELECT');
 assert not has_table_privilege('service_role','private.etsy_publication_operations','INSERT');
 assert not has_table_privilege('authenticated','private.etsy_publication_mutation_admissions','INSERT');
 assert (select bool_and(relrowsecurity) from pg_class where oid in ('private.etsy_publication_runs'::regclass,'private.etsy_publication_operations'::regclass,'private.etsy_publication_mutation_admissions'::regclass));
 assert not exists(select 1 from private.etsy_publication_runs);
 perform pg_temp.expect_error('select private.stage18_assert_fee_authority(null,null,''{}'')','publication_all_in_fee_authority_unavailable');
end $$;
set local role authenticated;
do $$ declare b uuid:='18000000-1111-4111-8111-000000000002'; begin
 assert public.etsy_publication_owner_transition(b,'workspace')->'runs'='[]';
 assert public.etsy_publication_owner_transition(b,'workspace')->'feeAuthorityAvailable'='false';
 perform pg_temp.expect_error('select public.etsy_publication_owner_transition(''18000000-1111-4111-8111-000000000092'',''workspace'')','owner_required');
 perform pg_temp.expect_error(format('select public.etsy_publication_owner_transition(%L,''source'')',b),'server_authority_required');
 perform pg_temp.expect_error('select * from private.etsy_publication_runs','permission denied');
 perform pg_temp.expect_error('insert into private.etsy_publication_mutation_admissions values(txid_current())','permission denied');
 perform pg_temp.expect_error(format('insert into public.action_intents(business_id,action_type,capability,idempotency_key,created_by_type) values(%L,''etsy.publication.activate'',''marketplace.etsy.publish'',''forged'',''owner'')',b));
 perform pg_temp.expect_error(format('insert into public.external_resources(business_id,provider,resource_type,external_id) values(%L,''etsy'',''published_listing'',''forged'')',b));
end $$;
reset role;
-- This administrative fixture reproduces immutable completed Stage17 and
-- verified Stage16 relational bindings, never claiming upstream live truth.
create function pg_temp.seed_publication_source(n integer) returns uuid language plpgsql as $$
declare b uuid:='18000000-1111-4111-8111-000000000002'; owner_id uuid:='18000000-1111-4111-8111-000000000090';
 did uuid:=private.stage4_deterministic_uuid('publication-draft-'||n); wid uuid:=gen_random_uuid(); lid uuid:=gen_random_uuid(); aid uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid();
 tid uuid; worker_run uuid; worker uuid; artifact uuid; role_name text; cid uuid; revision uuid; intent uuid:=gen_random_uuid(); receipt uuid:=gen_random_uuid(); resource uuid:=gen_random_uuid();
 product jsonb; input jsonb; reviewed jsonb; output jsonb; execution jsonb; state jsonb; mappings jsonb; identity text:='al-'||substr(private.stage13_hash('publication-'||n),1,40); ph text; listing bigint:=180000+n;
begin
 select id,etsy_connections.revision into cid,revision from private.etsy_connections where business_id=b;
 if cid is null then cid:=gen_random_uuid();revision:=gen_random_uuid();
  insert into private.etsy_connections values(cid,b,owner_id,18001,'Offline shop','USD',revision,'connected','offline-encrypted-placeholder',false,clock_timestamp(),null);
 end if;
 input:=private.stage17_qualification_suite()->'cases'->0->'input';
 product:=(input->'product')||jsonb_build_object('id',aid,'businessId',b,'quantity',1,'currency','USD','approvedAt',clock_timestamp()-interval '1 minute','expiresAt',clock_timestamp()+interval '1 hour');
 input:=input||jsonb_build_object('product',product,'evidenceMode','live'); ph:=private.stage14_hash(product);
 reviewed:=jsonb_build_object('version','1.0.0','input',input,'proposal','{}'::jsonb,'review','{"verdict":"APPROVE"}'::jsonb,'specialist','{}'::jsonb,'reviewer','{}'::jsonb,
  'knowledgeHash',repeat('a',64),'outputArtifactId',aid,'productPackageHash',ph,'publicationAllowed',false);
 insert into private.listing_mutation_admissions values(txid_current());
 insert into public.workflow_runs(id,business_id,workflow_definition_id,status,idempotency_key) select wid,b,id,'completed','stage18-fixture:'||n from public.workflow_definitions where workflow_key='etsy.listing-review';
 insert into public.artifacts(id,business_id,artifact_type,name,content) values(sid,b,'product.package.v1','Offline source','{}');
 insert into public.listing_runs(id,business_id,owner_id,workflow_run_id,source_artifact_id,output_artifact_id,input,input_hash,source_content_hash,knowledge_hash,worker_hashes,catalog_snapshot,quote,maximum_microusd,capability_expires_at,status,phase,completed_at)
 values(lid,b,owner_id,wid,sid,aid,input,private.stage14_hash(input),repeat('b',64),repeat('a',64),'{}','{}','{}',1,clock_timestamp()+interval '1 hour','completed','terminal',clock_timestamp());
 insert into public.artifacts(id,business_id,workflow_run_id,artifact_type,name,content,checksum) values(aid,b,wid,'product.package.v1','Offline reviewed package',jsonb_build_object('product',product,'reviewedListing',reviewed,'etsyDraftEnvelope',repeat('fixture-package-',4),'listingReviewEnvelope',repeat('fixture-review-',4)),ph);
 foreach role_name in array array['specialist','reviewer'] loop
  tid:=gen_random_uuid(); worker_run:=gen_random_uuid(); artifact:=gen_random_uuid();
  select id into worker from public.worker_definitions where worker_key='listing.'||role_name;
  insert into public.task_contracts(id,business_id,workflow_run_id,worker_definition_id,status,objective) values(tid,b,wid,worker,'completed','Offline publication relational fixture');
  insert into public.worker_runs(id,business_id,workflow_run_id,task_contract_id,worker_definition_id,status) values(worker_run,b,wid,tid,worker,'completed');
  insert into public.listing_cost_reservations(listing_run_id,business_id,role,reserved_microusd,request_hash,model,provider,estimate,context,task_contract_id,worker_run_id) values(lid,b,role_name,1,repeat('b',64),'offline-fixture','openrouter','{}','{}',tid,worker_run);
  output:=case role_name when 'reviewer' then reviewed->'review' else reviewed->'proposal' end;
  insert into public.artifacts(id,business_id,workflow_run_id,artifact_type,name,content) values(artifact,b,wid,'listing.'||role_name||'.v1','Offline phase',output);
  insert into public.listing_phase_outputs values(lid,b,wid,role_name,artifact,output,private.stage14_hash(output),'{}',clock_timestamp());
 end loop;
 delete from private.listing_mutation_admissions where transaction_id=txid_current();
 mappings:=jsonb_build_array(jsonb_build_object('assetId',product->'images'->0->>'assetId','sha256',product->'images'->0->>'sha256','listingImageId',180001));
 state:=jsonb_build_object('id',did,'businessId',b,'connectionId',cid,'connectionRevision',revision,'shopId',18001,'actionIntentId',intent,'resourceId',resource,'receiptId',receipt,'packageHash',ph,'identity',identity,'listingId',listing,'status','verified','reason',null,
  'operations',jsonb_build_array(jsonb_build_object('key','create','status','verified','externalId',listing),jsonb_build_object('key','image:'||(product->'images'->0->>'assetId')||':'||(product->'images'->0->>'sha256'),'status','verified','externalId',180001)));
 insert into public.action_intents(id,business_id,action_type,capability,status,idempotency_key,created_by_type) values(intent,b,'etsy.draft.create','marketplace.etsy','completed','draft-fixture-'||n,'system');
 insert into public.external_resources(id,business_id,provider,resource_type,external_id,status,metadata) values(resource,b,'etsy','draft_listing','shop:18001:listing:'||listing,'active',jsonb_build_object('state','draft','packageHash',ph,'identity',identity,'publicationAllowed',false));
 insert into public.action_receipts(id,business_id,action_intent_id,external_resource_id,attempt,outcome,provider,request_fingerprint,response_summary) values(receipt,b,intent,resource,1,'succeeded','etsy',ph,jsonb_build_object('state','draft','verifiedBy','independent_get','publicationAllowed',false,'listingId',listing,'shopId',18001,'packageHash',ph,'responseHash',repeat('d',64),'imageMappings',mappings));
 insert into private.etsy_draft_runs(id,business_id,owner_id,connection_id,connection_revision,package_artifact_id,package_hash,package,identity,shop_id,product_identity,state,action_intent_id,approval_expires_at)
 values(did,b,owner_id,cid,revision,aid,ph,product,identity,18001,'stage18-offline-'||n,state,intent,clock_timestamp()+interval '1 hour');
 return did;
end $$;
create temp table publication_fixture(draft uuid,source jsonb,payload jsonb,run uuid);
insert into publication_fixture(draft) select pg_temp.seed_publication_source(1);
update publication_fixture set source=private.stage18_source('18000000-1111-4111-8111-000000000002',draft,false);
do $$ declare f publication_fixture%rowtype; begin
 select * into f from publication_fixture;
 assert f.source->'draft'->>'runId'=f.draft::text;
 assert f.source->>'packageHash'=private.stage14_hash(f.source->'package');
 assert f.source->>'draftReceiptHash'=private.stage14_hash(f.source->'draftReceipt');
 assert f.source->>'reviewHash'=private.stage14_hash(f.source->'review');
 perform pg_temp.expect_error(format('select private.stage18_source(%L,%L,true)','18000000-1111-4111-8111-000000000002',f.draft),'goal_or_workflow_stopped');
 -- Alter only a synthetic pre-adoption row inside an exception rollback.
 begin
  update private.etsy_draft_runs set package_hash=repeat('f',64) where id=f.draft;
  perform pg_temp.expect_error(format('select private.stage18_source(%L,%L,false)','18000000-1111-4111-8111-000000000002',f.draft),'publication_verified_draft_required');
  raise exception 'fixture_rollback';
 exception when raise_exception then if sqlerrm<>'fixture_rollback' then raise; end if; end;
 begin
  update public.action_receipts set response_summary=response_summary||'{"imageMappings":[]}' where id=(f.source->'draft'->>'receiptId')::uuid;
  perform pg_temp.expect_error(format('select private.stage18_source(%L,%L,false)','18000000-1111-4111-8111-000000000002',f.draft),'publication_image_mapping_mismatch');
  raise exception 'fixture_rollback';
 exception when raise_exception then if sqlerrm<>'fixture_rollback' then raise; end if; end;
end $$;
-- Duplicate the complete source validator, disabling ONLY its existing upstream
-- readiness calls for synthetic fixtures; preserve all Stage18 provenance checks.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('private.stage18_source(uuid,uuid,boolean)'::regprocedure);
 definition:=replace(definition,'FUNCTION private.stage18_source','FUNCTION pg_temp.stage18_fixture_source');
 definition:=replace(definition,'if p_fresh then','if false then'); execute definition;
end $$;
create or replace function private.stage18_source(p_business uuid,p_draft uuid,p_fresh boolean default true) returns jsonb language sql set search_path='' as $$ select pg_temp.stage18_fixture_source(p_business,p_draft,p_fresh) $$;
create function pg_temp.approval_payload(did uuid) returns jsonb language plpgsql as $$
declare source jsonb:=private.stage18_source('18000000-1111-4111-8111-000000000002',did,false); preflight jsonb; disclosure jsonb:='{"version":"offline-policy","allInFeeEvidence":"isolated-fixture-only"}'; quote jsonb; approval jsonb; request_hash text; approved timestamptz:=clock_timestamp();
begin
 preflight:=jsonb_build_object('quantity',1,'shouldAutoRenew',false,'shippingProfileId',source->'package'->'shippingProfileId','returnPolicyId',18,'shippingProfile','{"profile_type":"manual"}'::jsonb,'returnPolicy','{}'::jsonb,'processingProfile','{}'::jsonb);
 request_hash:=private.stage14_hash(jsonb_build_object('version','etsy-assisted-publication-1.0','businessId','18000000-1111-4111-8111-000000000002','connectionId',source->'connectionId','connectionRevision',source->'connectionRevision','shopId',source->'shopId','listingId',source->'draft'->'listingId','identity',source->'draft'->>'identity','packageHash',source->>'packageHash','reviewHash',source->>'reviewHash','draftReceiptHash',source->>'draftReceiptHash','disclosureHash',private.stage14_hash(disclosure),'preflightHash',private.stage14_hash(preflight),'method','PATCH','path','/shops/'||(source->>'shopId')||'/listings/'||(source->'draft'->>'listingId'),'body','{"state":"active"}'::jsonb));
 quote:=jsonb_build_object('version','1.0','provider','etsy','scope','one_listing_activation','sourceKind','verified_provider_checkout','sourceReceiptId',gen_random_uuid(),'sourceHash',repeat('a',64),'shopId',source->'shopId','listingId',source->'draft'->'listingId','billingCurrency','USD','listingFeeMinor',20,'taxMinor',3,'fxMinor',0,'otherMandatoryFeesMinor',0,'maximumTotalMinor',23,'verifiedAt',approved,'expiresAt',approved+interval '30 minutes','disclosureHash',private.stage14_hash(disclosure));
 approval:=jsonb_build_object('id',gen_random_uuid(),'requestHash',request_hash,'quoteHash',private.stage14_hash(quote),'disclosureHash',private.stage14_hash(disclosure),'billingCurrency','USD','maximumTotalMinor',23,'approvedQuantity',1,'paymentMethod','etsy_payment_account','commitment','publish_existing_quantity_manual_renewal','dataSharing','make_exact_reviewed_listing_public','approvedAt',approved,'expiresAt',approved+interval '30 minutes');
 return jsonb_build_object('draftRunId',did,'packageHash',source->>'packageHash','reviewHash',source->>'reviewHash','draftReceiptHash',source->>'draftReceiptHash','connectionRevision',source->>'connectionRevision','preflight',preflight,'preflightHash',private.stage14_hash(preflight),'disclosure',disclosure,'disclosureHash',private.stage14_hash(disclosure),'feeEvidence',quote,'approval',approval,'approvalHash',private.stage14_hash(approval),'requestHash',request_hash,'approvePublication',true,'approveFee',true);
end $$;
update publication_fixture set payload=pg_temp.approval_payload(draft);
-- Even correct-shaped server-submitted fields cannot override the unavailable fee source.
do $$ declare f publication_fixture%rowtype; b uuid:='18000000-1111-4111-8111-000000000002'; k text:=repeat('stage18-server-fixture-',3); begin
 select * into f from publication_fixture;
 perform pg_temp.expect_error(format('select public.etsy_publication_owner_transition(%L,''prepare'',%L::jsonb,%L)',b,f.payload,k),'publication_all_in_fee_authority_unavailable');
 assert not exists(select 1 from private.etsy_publication_runs);
 perform pg_temp.expect_error(format('select public.etsy_publication_owner_transition(%L,''prepare'',%L::jsonb,%L)',b,f.payload||'{"approveFee":false}',k),'publication_and_fee_consent_required');
 perform pg_temp.expect_error(format('select public.etsy_publication_owner_transition(%L,''prepare'',%L::jsonb,%L)',b,jsonb_set(f.payload,'{approval,maximumTotalMinor}','1'),k),'publication_approval_binding_mismatch');
 assert not exists(select 1 from private.etsy_publication_mutation_admissions);
end $$;
-- Only this new unavailable prerequisite is isolated for positive runtime tests.
create or replace function private.stage18_assert_fee_authority(p_business uuid,p_draft uuid,p_quote jsonb) returns void language plpgsql set search_path='' as $$ begin null; end $$;
update publication_fixture set run=(public.etsy_publication_owner_transition('18000000-1111-4111-8111-000000000002','prepare',payload,repeat('stage18-server-fixture-',3))->>'runId')::uuid;
do $$ declare f publication_fixture%rowtype; b uuid:='18000000-1111-4111-8111-000000000002'; k text:=repeat('stage18-server-fixture-',3); req jsonb; result jsonb; s jsonb; revision integer; summary jsonb; receipt jsonb; resource jsonb; before_draft jsonb; before_receipt jsonb; before_resource jsonb; begin
 select * into f from publication_fixture;
 assert public.etsy_publication_owner_transition(b,'prepare',f.payload,k)->'created'='false';
 assert (select count(*)=1 from private.etsy_publication_runs);
 assert public.etsy_publication_owner_transition(b,'workspace')->'drafts'='[]';
 perform pg_temp.expect_error(format('select public.etsy_publication_owner_transition(%L,''prepare'',%L::jsonb,%L)',b,f.payload||jsonb_build_object('approvalHash',repeat('f',64)),k),'publication_approval_replay_mismatch');
 select to_jsonb(d) into before_draft from private.etsy_draft_runs d where id=f.draft;
 select to_jsonb(a) into before_receipt from public.action_receipts a where id=(f.source->'draft'->>'receiptId')::uuid;
 select to_jsonb(x) into before_resource from public.external_resources x where id=(f.source->'draft'->>'resourceId')::uuid;
 req:=jsonb_build_object('runId',f.run,'lease',repeat('stage18-lease-fixture-',3));
 result:=public.etsy_publication_owner_transition(b,'acquire',req,k); s:=result->'state';revision:=(result->>'revision')::integer;
 assert s->>'status'='ready'; assert s->'activation'='null';
 perform pg_temp.expect_error(format('select public.etsy_publication_owner_transition(%L,''acquire'',%L::jsonb,%L)',b,req,k),'publication_in_progress');
 perform pg_temp.expect_error(format('select public.etsy_publication_owner_transition(%L,''save'',%L::jsonb,%L)',b,req||jsonb_build_object('state',s,'revision',99),k),'stale_publication_revision');
 perform pg_temp.expect_error(format('select public.etsy_publication_owner_transition(%L,''save'',%L::jsonb,%L)',b,req||jsonb_build_object('state',s||'{"listingId":99}','revision',revision),k),'publication_state_identity_immutable');
 s:=s||'{"status":"running","providerState":"draft"}';
 result:=public.etsy_publication_owner_transition(b,'save',req||jsonb_build_object('state',s,'revision',revision),k);revision:=(result->>'revision')::integer;
 result:=public.etsy_publication_owner_transition(b,'guard',req||'{"mode":"publish"}',k);
 assert result->>'requestHash'=s->>'requestHash'; assert result->'draft'=f.source->'draft';
 s:=s||jsonb_build_object('activation',jsonb_build_object('key','activate','requestHash',s->>'requestHash','status','sent','sentAt',clock_timestamp(),'responseHash',null,'reason',null));
 result:=public.etsy_publication_owner_transition(b,'save',req||jsonb_build_object('state',s,'revision',revision),k); revision:=(result->>'revision')::integer;
 assert (select count(*)=1 from private.etsy_publication_operations);
 assert public.etsy_publication_owner_transition(b,'workspace')->'runs'->0->'feeExposure'->>'chargeStatus'='unknown';
 assert public.etsy_publication_owner_transition(b,'workspace')->'runs'->0->'feeExposure'->'knownChargeMinor'='null';
 perform pg_temp.expect_error(format('select public.etsy_publication_owner_transition(%L,''save'',%L::jsonb,%L)',b,req||jsonb_build_object('state',s||'{"activation":null}','revision',revision),k),'publication_attempt_cannot_be_reset');
 perform pg_temp.expect_error(format('update private.etsy_publication_operations set sent_at=clock_timestamp() where publication_run_id=%L',f.run),'publication_runtime_managed');
 perform pg_temp.expect_error(format('update public.action_intents set request=''{}'' where id=%L',(s->>'actionIntentId')::uuid),'publication_core_runtime_managed');
 perform pg_temp.expect_error(format('update public.action_intents set action_type=''ordinary'' where id=%L',(s->>'actionIntentId')::uuid),'publication_core_runtime_managed');
 perform pg_temp.expect_error(format('update private.etsy_draft_runs set state=state||''{"status":"cancelled"}'' where id=%L',f.draft),'publication_draft_history_immutable');
 perform pg_temp.expect_error(format('update public.external_resources set metadata=''{}'' where id=%L',f.source->'draft'->>'resourceId'),'publication_draft_history_immutable');
 perform pg_temp.expect_error(format('update public.action_receipts set response_summary=''{}'' where id=%L',f.source->'draft'->>'receiptId'),'publication_draft_history_immutable');
 perform public.etsy_publication_owner_transition(b,'cancel',jsonb_build_object('runId',f.run));
 assert public.etsy_publication_owner_transition(b,'workspace')->'runs'->0->'stopRequested'='true';
 assert (select count(*)=1 from public.owner_interventions where action_intent_id=(s->>'actionIntentId')::uuid and status='open' and intervention_type='etsy.publication.reconcile' and options='[]');
 perform pg_temp.expect_error(format('update public.owner_interventions set status=''resolved'' where action_intent_id=%L',s->>'actionIntentId'),'publication_core_runtime_managed');
 perform pg_temp.expect_error(format('update public.owner_interventions set options=''[{"action":"retry"}]'' where action_intent_id=%L',s->>'actionIntentId'),'publication_core_runtime_managed');
 perform pg_temp.expect_error(format('select public.etsy_publication_owner_transition(%L,''guard'',%L::jsonb,%L)',b,req||'{"mode":"publish"}',k),'publication_stopped_or_approval_expired');
 result:=public.etsy_publication_owner_transition(b,'guard',req||'{"mode":"reconcile"}',k);
 assert result->'stopRequested'='true';
 -- A late observed active state is retained despite cancellation, and cannot be
 -- rewritten into an unpublished claim. No second activation can be admitted.
 s:=s||'{"providerState":"active"}';
 result:=public.etsy_publication_owner_transition(b,'save',req||jsonb_build_object('state',s,'revision',revision),k);revision:=(result->>'revision')::integer;s:=result->'state';
 assert s->'stopRequested'='true'; assert s->>'providerState'='active'; assert s->>'status'='needs_owner';
 assert (select count(*)=1 from public.owner_interventions where action_intent_id=(s->>'actionIntentId')::uuid and status='open');
 perform pg_temp.expect_error(format('select public.etsy_publication_owner_transition(%L,''save'',%L::jsonb,%L)',b,req||jsonb_build_object('state',s||'{"status":"cancelled"}','revision',revision),k),'publication_active_not_unpublished');
 perform pg_temp.expect_error(format('select public.etsy_publication_owner_transition(%L,''save'',%L::jsonb,%L)',b,req||jsonb_build_object('state',s||'{"providerState":"draft"}','revision',revision),k),'publication_observed_active_immutable');
 s:=jsonb_set(s||'{"status":"verified","reason":null}','{activation,status}','"verified"');
 summary:=jsonb_build_object('listingId',s->'listingId','shopId',s->'shopId','state','active','verifiedBy','independent_get','responseHash',repeat('e',64),
  'packageHash',s->>'packageHash','reviewHash',s->>'reviewHash','draftReceiptHash',s->>'draftReceiptHash','approvalHash',s->>'approvalHash','disclosureHash',s->>'disclosureHash','preflightHash',s->>'preflightHash','requestHash',s->>'requestHash',
  'feeStatus','unreconciled','feeAmountMinor',null,'feeCurrency',null,'approvedMaximumTotalMinor',23,'approvedBillingCurrency','USD','stopRequested',true,'imageMappings',f.source->'draft'->'imageMappings');
 receipt:=jsonb_build_object('id',s->'receiptId','businessId',b,'actionIntentId',s->'actionIntentId','externalResourceId',s->'resourceId','attempt',1,'outcome','succeeded','provider','etsy','requestFingerprint',s->>'requestHash','responseSummary',summary);
 resource:=jsonb_build_object('id',s->'resourceId','businessId',b,'provider','etsy','resourceType','published_listing','externalId','shop:'||(s->>'shopId')||':listing:'||(s->>'listingId'),'status','active','canonicalUrl','https://www.etsy.com/listing/'||(s->>'listingId'),
  'metadata',jsonb_build_object('state','active','packageHash',s->>'packageHash','listingId',s->'listingId','shopId',s->'shopId'));
 perform pg_temp.expect_error(format('select public.etsy_publication_owner_transition(%L,''finish'',%L::jsonb,%L)',b,req||jsonb_build_object('state',s,'revision',revision,'receipt',jsonb_set(receipt,'{responseSummary,feeAmountMinor}','0'),'resource',resource),k),'publication_fee_charge_unknown');
 result:=public.etsy_publication_owner_transition(b,'finish',req||jsonb_build_object('state',s,'revision',revision,'receipt',receipt,'resource',resource),k);revision:=(result->>'revision')::integer;
 assert result->'state'->>'status'='verified'; assert result->'state'->'stopRequested'='true';
 assert (select count(*)=1 from public.action_receipts where action_intent_id=(s->>'actionIntentId')::uuid);
 assert (select count(*)=1 from private.etsy_publication_operations);
 assert (select status='completed' from public.action_intents where id=(s->>'actionIntentId')::uuid);
 assert not exists(select 1 from public.owner_interventions where action_intent_id=(s->>'actionIntentId')::uuid and status='open');
 assert (select count(*)=1 from public.owner_interventions where action_intent_id=(s->>'actionIntentId')::uuid and status='resolved' and resolution->>'result'='active_listing_verified' and resolution->>'feeStatus'='unreconciled');
 assert (select to_jsonb(d)=before_draft from private.etsy_draft_runs d where id=f.draft);
 assert (select to_jsonb(a)=before_receipt from public.action_receipts a where id=(f.source->'draft'->>'receiptId')::uuid);
 assert (select to_jsonb(x)=before_resource from public.external_resources x where id=(f.source->'draft'->>'resourceId')::uuid);
 perform pg_temp.expect_error(format('update public.action_receipts set response_summary=''{}'' where id=%L',s->>'receiptId'),'publication_core_runtime_managed');
 perform pg_temp.expect_error(format('delete from public.external_resources where id=%L',s->>'resourceId'),'publication_core_runtime_managed');
 result:=public.etsy_publication_owner_transition(b,'finish',req||jsonb_build_object('state',s,'revision',revision,'receipt',receipt,'resource',resource),k);
 assert (result->>'revision')::integer=revision;
 perform public.etsy_publication_owner_transition(b,'release',req,k);
 assert not exists(select 1 from private.etsy_publication_mutation_admissions);
end $$;
-- A stop before dispatch cannot ever reserve activation; expiry likewise blocks
-- publish while current-account read-only reconciliation remains available.
do $$ declare did uuid:=pg_temp.seed_publication_source(2); payload jsonb; rid uuid; req jsonb; result jsonb; s jsonb; k text:=repeat('stage18-server-fixture-',3); b uuid:='18000000-1111-4111-8111-000000000002'; begin
 payload:=pg_temp.approval_payload(did); rid:=(public.etsy_publication_owner_transition(b,'prepare',payload,k)->>'runId')::uuid;
 req:=jsonb_build_object('runId',rid,'lease',repeat('stage18-second-lease-',3));result:=public.etsy_publication_owner_transition(b,'acquire',req,k);s:=result->'state';
 s:=s||'{"status":"needs_owner","reason":"fixture_pre_dispatch_blocker"}';
 result:=public.etsy_publication_owner_transition(b,'save',req||jsonb_build_object('state',s,'revision',0),k);
 assert (select count(*)=1 from public.owner_interventions where action_intent_id=(s->>'actionIntentId')::uuid and status='open');
 perform public.etsy_publication_owner_transition(b,'cancel',jsonb_build_object('runId',rid));
 assert (select count(*)=1 from public.owner_interventions where action_intent_id=(s->>'actionIntentId')::uuid and status='resolved' and resolution->>'result'='stopped_before_dispatch' and resolution->'activationSent'='false');
 assert public.etsy_publication_owner_transition(b,'guard',req||'{"mode":"reconcile"}',k)->'stopRequested'='true';
 s:=s||jsonb_build_object('activation',jsonb_build_object('key','activate','requestHash',s->>'requestHash','status','sent','sentAt',clock_timestamp(),'responseHash',null,'reason',null));
 perform pg_temp.expect_error(format('select public.etsy_publication_owner_transition(%L,''save'',%L::jsonb,%L)',b,req||jsonb_build_object('state',s,'revision',1),k),'publication_stopped_or_approval_expired');
 assert not exists(select 1 from private.etsy_publication_operations where publication_run_id=rid);
 update private.etsy_connections set status='revoked' where business_id=b;
 perform pg_temp.expect_error(format('select public.etsy_publication_owner_transition(%L,''guard'',%L::jsonb,%L)',b,req||'{"mode":"reconcile"}',k),'account_access_revoked');
end $$;
-- Definite rejection terminates the Core intent without asserting zero charge.
update private.etsy_connections set status='connected' where business_id='18000000-1111-4111-8111-000000000002';
do $$ declare did uuid:=pg_temp.seed_publication_source(4); payload jsonb; rid uuid; req jsonb; result jsonb; s jsonb; k text:=repeat('stage18-server-fixture-',3); b uuid:='18000000-1111-4111-8111-000000000002'; begin
 payload:=pg_temp.approval_payload(did);rid:=(public.etsy_publication_owner_transition(b,'prepare',payload,k)->>'runId')::uuid;
 req:=jsonb_build_object('runId',rid,'lease',repeat('stage18-rejected-lease-',3));result:=public.etsy_publication_owner_transition(b,'acquire',req,k);s:=result->'state';
 s:=s||jsonb_build_object('status','running','providerState','draft','activation',jsonb_build_object('key','activate','requestHash',s->>'requestHash','status','sent','sentAt',clock_timestamp(),'responseHash',null,'reason',null));
 result:=public.etsy_publication_owner_transition(b,'save',req||jsonb_build_object('state',s,'revision',0),k);
 s:=jsonb_set(jsonb_set(s||'{"status":"failed","reason":"publication_rejected"}','{activation,status}','"rejected"'),'{activation,reason}','"publication_rejected"');
 result:=public.etsy_publication_owner_transition(b,'save',req||jsonb_build_object('state',s,'revision',1),k);
 assert (select status='failed' from public.action_intents where id=(s->>'actionIntentId')::uuid);
 assert (select count(*)=1 from private.etsy_publication_operations where publication_run_id=rid);
 assert (select financial_exposure->'knownChargeMinor'='null' from private.etsy_publication_runs where id=rid);
 assert not exists(select 1 from public.action_receipts where action_intent_id=(s->>'actionIntentId')::uuid);
 perform public.etsy_publication_owner_transition(b,'cancel',jsonb_build_object('runId',rid));
 s:=s||'{"status":"needs_owner","stopRequested":true}';
 perform public.etsy_publication_owner_transition(b,'save',req||jsonb_build_object('state',s,'revision',2),k);
 assert (select status='failed' from public.action_intents where id=(s->>'actionIntentId')::uuid);
 assert (select count(*)=1 from public.owner_interventions where action_intent_id=(s->>'actionIntentId')::uuid and status='open');
end $$;
-- Expiry is time-based and never grants a new attempt or discards exposure.
update private.etsy_connections set status='connected' where business_id='18000000-1111-4111-8111-000000000002';
do $$ declare did uuid:=pg_temp.seed_publication_source(3); payload jsonb; rid uuid; req jsonb; result jsonb; s jsonb; k text:=repeat('stage18-server-fixture-',3); b uuid:='18000000-1111-4111-8111-000000000002'; quote jsonb; approval jsonb; begin
 payload:=pg_temp.approval_payload(did);
 quote:=jsonb_set(payload->'feeEvidence','{expiresAt}',to_jsonb(clock_timestamp()+interval '1 second'));
 approval:=jsonb_set(jsonb_set(payload->'approval','{expiresAt}',quote->'expiresAt'),'{quoteHash}',to_jsonb(private.stage14_hash(quote)));
 payload:=payload||jsonb_build_object('feeEvidence',quote,'approval',approval,'approvalHash',private.stage14_hash(approval));
 rid:=(public.etsy_publication_owner_transition(b,'prepare',payload,k)->>'runId')::uuid;
 req:=jsonb_build_object('runId',rid,'lease',repeat('stage18-expiry-lease-',3));result:=public.etsy_publication_owner_transition(b,'acquire',req,k);s:=result->'state';
 perform pg_sleep(1.1);
 perform pg_temp.expect_error(format('select public.etsy_publication_owner_transition(%L,''guard'',%L::jsonb,%L)',b,req||'{"mode":"publish"}',k),'publication_stopped_or_approval_expired');
 result:=public.etsy_publication_owner_transition(b,'guard',req||'{"mode":"reconcile"}',k);
 assert result->>'requestHash'=s->>'requestHash';
 s:=s||jsonb_build_object('activation',jsonb_build_object('key','activate','requestHash',s->>'requestHash','status','sent','sentAt',clock_timestamp(),'responseHash',null,'reason',null));
 perform pg_temp.expect_error(format('select public.etsy_publication_owner_transition(%L,''save'',%L::jsonb,%L)',b,req||jsonb_build_object('state',s,'revision',0),k),'publication_stopped_or_approval_expired');
 assert not exists(select 1 from private.etsy_publication_operations where publication_run_id=rid);
 insert into private.etsy_publication_mutation_admissions values(txid_current());
 update private.etsy_publication_runs set lease_expires_at=clock_timestamp()-interval '1 second' where id=rid;
 delete from private.etsy_publication_mutation_admissions where transaction_id=txid_current();
 perform pg_temp.expect_error(format('select public.etsy_publication_owner_transition(%L,''guard'',%L::jsonb,%L)',b,req||'{"mode":"reconcile"}',k),'publication_lease_expired');
 result:=public.etsy_publication_owner_transition(b,'acquire',req,k);
 assert result->'state'->'activation'='null';
 update private.etsy_server_authority set enabled=false;
 perform pg_temp.expect_error(format('select public.etsy_publication_owner_transition(%L,''guard'',%L::jsonb,%L)',b,req||'{"mode":"reconcile"}',k),'server_authority_required');
 assert public.etsy_publication_owner_transition(b,'workspace')->'feeAuthorityAvailable'='false';
end $$;
-- A Needs You link must still locate its exact owned run once more than fifty
-- newer records exist. Resolved targets remain readable after late completion.
update private.etsy_server_authority set enabled=true;
do $$ declare b uuid:='18000000-1111-4111-8111-000000000002'; k text:=repeat('stage18-server-fixture-',3); f publication_fixture%rowtype; target uuid; foreign_type uuid:=gen_random_uuid(); mismatched uuid:=gen_random_uuid(); wrong_action uuid:=gen_random_uuid(); d uuid; result jsonb; n integer; begin
 select * into f from publication_fixture;
 select oi.id into strict target from public.owner_interventions oi join private.etsy_publication_runs pr on pr.action_intent_id=oi.action_intent_id where pr.id=f.run and oi.intervention_type='etsy.publication.reconcile' and oi.status='resolved';
 for n in 10..59 loop
  d:=pg_temp.seed_publication_source(n);
  perform public.etsy_publication_owner_transition(b,'prepare',pg_temp.approval_payload(d),k);
 end loop;
 result:=public.etsy_publication_owner_transition(b,'workspace');
 assert jsonb_array_length(result->'runs')=50;
 assert not exists(select 1 from jsonb_array_elements(result->'runs') x where x->>'id'=f.run::text);
 result:=public.etsy_publication_owner_transition(b,'workspace',jsonb_build_object('interventionId',target));
 assert jsonb_array_length(result->'runs')=50;
 assert result->'runs'->0->>'id'=f.run::text;
 assert result->'runs'->0->>'status'='verified';
 assert (select count(*)=1 from jsonb_array_elements(result->'runs') x where x->>'id'=f.run::text);
 assert (select status='resolved' from public.owner_interventions where id=target);
 perform pg_temp.expect_error(format('select public.etsy_publication_owner_transition(%L,''workspace'',%L::jsonb)',b,jsonb_build_object('interventionId',gen_random_uuid())),'publication_intervention_not_found');
 perform pg_temp.expect_error(format('select public.etsy_publication_owner_transition(%L,''workspace'',''{"interventionId":"not-a-uuid"}'')',b),'publication_intervention_not_found');
 perform pg_temp.expect_error(format('select public.etsy_publication_owner_transition(%L,''workspace'',''{"interventionId":null}'')',b),'publication_intervention_not_found');
 insert into public.owner_interventions(id,business_id,intervention_type,title,description) values(foreign_type,b,'ordinary.test','Ordinary request','An unrelated request is not a publication link');
 perform pg_temp.expect_error(format('select public.etsy_publication_owner_transition(%L,''workspace'',%L::jsonb)',b,jsonb_build_object('interventionId',foreign_type)),'publication_intervention_not_found');
 insert into public.action_intents(id,business_id,action_type,capability,idempotency_key,created_by_type) values(wrong_action,b,'ordinary.test','ordinary.test','stage18-mismatched-target','system');
 insert into private.etsy_publication_mutation_admissions values(txid_current());
 insert into public.owner_interventions(id,business_id,action_intent_id,intervention_type,title,description) values(mismatched,b,wrong_action,'etsy.publication.reconcile','Mismatched request','This isolated fixture has no matching publication run');
 delete from private.etsy_publication_mutation_admissions where transaction_id=txid_current();
 perform pg_temp.expect_error(format('select public.etsy_publication_owner_transition(%L,''workspace'',%L::jsonb)',b,jsonb_build_object('interventionId',mismatched)),'publication_intervention_not_found');
 perform set_config('request.jwt.claim.sub','18000000-1111-4111-8111-000000000091',true);
 perform pg_temp.expect_error(format('select public.etsy_publication_owner_transition(%L,''workspace'',%L::jsonb)','18000000-1111-4111-8111-000000000092',jsonb_build_object('interventionId',target)),'publication_intervention_not_found');
 perform pg_temp.expect_error(format('select public.etsy_publication_owner_transition(%L,''workspace'',%L::jsonb)',b,jsonb_build_object('interventionId',target)),'owner_required');
 perform set_config('request.jwt.claim.sub','18000000-1111-4111-8111-000000000090',true);
 assert not exists(select 1 from private.etsy_publication_mutation_admissions);
end $$;
rollback;
