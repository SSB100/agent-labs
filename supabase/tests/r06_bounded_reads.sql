-- Rollback-only, inert SQL fixtures. Fake envelope strings below prove only
-- structural candidate pagination, never product eligibility or live authority.
begin;
create function pg_temp.r06_expect_error(statement text, expected text default null) returns void language plpgsql as $$
begin
 begin execute statement; exception when others then
  if expected is not null and position(expected in sqlerrm)=0 then raise exception 'Unexpected error: %; wanted %',sqlerrm,expected; end if;
  return;
 end;
 raise exception 'Expected failure did not occur: %',statement;
end $$;

insert into auth.users(id,email) values
 ('96060000-0000-4000-8000-000000000090','r06-owner@example.invalid'),
 ('96060000-0000-4000-8000-000000000091','r06-foreign@example.invalid');
insert into public.businesses(id,owner_user_id,name) values
 ('96060000-0000-4000-8000-000000000001','96060000-0000-4000-8000-000000000090','R06 first Business'),
 ('96060000-0000-4000-8000-000000000002','96060000-0000-4000-8000-000000000090','R06 second owned Business'),
 ('96060000-0000-4000-8000-000000000003','96060000-0000-4000-8000-000000000091','R06 foreign Business');
insert into public.goals(id,business_id,title) values
 ('96060000-0000-4000-8000-000000000011','96060000-0000-4000-8000-000000000001','R06 first Quest'),
 ('96060000-0000-4000-8000-000000000012','96060000-0000-4000-8000-000000000002','R06 second Quest');

-- 125 equal-timestamp historical rows, plus an old unresolved request and a
-- persisted approved request whose effective read status has already expired.
insert into private.account_setup_runs(id,business_id,owner_id,provider,mode,idempotency_key,connection_id,profile_revision,disclosure,disclosure_hash,status,approval_expires_at,created_at)
 select ('96060000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'96060000-0000-4000-8000-000000000001','96060000-0000-4000-8000-000000000090','etsy','connect','r06-history-'||lpad(i::text,8,'0'),
 '96060000-0000-4000-8000-000000000201','96060000-0000-4000-8000-000000000202','{}',repeat('a',64),'cancelled',clock_timestamp()+interval '1 hour',transaction_timestamp()-interval '1 hour'
 from generate_series(1,125) i;
insert into private.account_setup_runs(id,business_id,owner_id,provider,mode,idempotency_key,connection_id,profile_revision,disclosure,disclosure_hash,status,approval_expires_at,approved_at,created_at) values
 ('96060000-0000-4000-8000-000000000501','96060000-0000-4000-8000-000000000001','96060000-0000-4000-8000-000000000090','etsy','connect','r06-old-open-0001','96060000-0000-4000-8000-000000000201','96060000-0000-4000-8000-000000000202','{}',repeat('a',64),'pending_approval',transaction_timestamp()+interval '1 hour',null,transaction_timestamp()-interval '1000 days'),
 ('96060000-0000-4000-8000-000000000502','96060000-0000-4000-8000-000000000001','96060000-0000-4000-8000-000000000090','printful','connect','r06-expired-00001','96060000-0000-4000-8000-000000000203','96060000-0000-4000-8000-000000000202','{}',repeat('b',64),'approved',transaction_timestamp()-interval '1 hour',transaction_timestamp()-interval '2 hours',transaction_timestamp()-interval '500 days'),
 ('96060000-0000-4000-8000-000000000601','96060000-0000-4000-8000-000000000002','96060000-0000-4000-8000-000000000090','etsy','connect','r06-other-owned-01','96060000-0000-4000-8000-000000000204','96060000-0000-4000-8000-000000000202','{}',repeat('c',64),'pending_approval',transaction_timestamp()+interval '1 hour',null,transaction_timestamp()),
 ('96060000-0000-4000-8000-000000000701','96060000-0000-4000-8000-000000000003','96060000-0000-4000-8000-000000000091','etsy','connect','r06-other-owner-01','96060000-0000-4000-8000-000000000205','96060000-0000-4000-8000-000000000202','{}',repeat('d',64),'pending_approval',transaction_timestamp()+interval '1 hour',null,transaction_timestamp());
insert into private.account_health_events(id,business_id,event_type,created_at)
 select ('96060000-0000-4000-8000-'||(100000+i)::text||'000000')::uuid,'96060000-0000-4000-8000-000000000001','profile_saved',transaction_timestamp() from generate_series(1,130) i;

-- Newer irrelevant artifacts cannot hide the older structurally eligible set.
insert into public.artifacts(id,business_id,artifact_type,name,content,created_at)
 select ('96060000-0000-4000-8000-'||lpad((1000+i)::text,12,'0'))::uuid,'96060000-0000-4000-8000-000000000001','product.package.v1','Older structural candidate '||i,
 '{"etsyDraftEnvelope":"synthetic-not-authenticated","listingReviewEnvelope":"synthetic-not-authenticated","listingInputEnvelope":"synthetic-not-authenticated"}',transaction_timestamp()-interval '1 day'
 from generate_series(1,135) i;
insert into public.artifacts(id,business_id,artifact_type,name,content,created_at)
 select ('96060000-0000-4000-8000-'||lpad((2000+i)::text,12,'0'))::uuid,'96060000-0000-4000-8000-000000000001','product.package.v1','Newer irrelevant artifact '||i,'{}',transaction_timestamp()
 from generate_series(1,140) i;
insert into public.artifacts(id,business_id,artifact_type,name,content) values
 ('96060000-0000-4000-8000-000000003001','96060000-0000-4000-8000-000000000002','product.package.v1','Other owned candidate','{"etsyDraftEnvelope":"synthetic","listingReviewEnvelope":"synthetic","listingInputEnvelope":"synthetic"}'),
 ('96060000-0000-4000-8000-000000003002','96060000-0000-4000-8000-000000000003','product.package.v1','Foreign candidate','{"etsyDraftEnvelope":"synthetic","listingReviewEnvelope":"synthetic","listingInputEnvelope":"synthetic"}');

-- Versioned research projections need latest state per candidate, not the
-- latest global sample. These administrative records are inert read fixtures.
insert into public.workflow_runs(id,business_id,goal_id,workflow_definition_id,status,idempotency_key)
 select '96060000-0000-4000-8000-000000009000','96060000-0000-4000-8000-000000000001','96060000-0000-4000-8000-000000000011',id,'completed','r06-projection-workflow'
 from public.workflow_definitions where workflow_key not in ('etsy.listing-review','etsy.listing-qualification') order by id limit 1;
insert into public.artifacts(id,business_id,workflow_run_id,artifact_type,name,content) values
 ('96060000-0000-4000-8000-000000009200','96060000-0000-4000-8000-000000000001','96060000-0000-4000-8000-000000009000','research.r06-fixture','Exact synthetic evidence pointer','{"syntheticFixture":true}');
insert into public.product_candidates(id,business_id,fingerprint,concept,audience,hypothesis,original_design,rights_status,source_domains,created_at)
 select ('96060000-0000-4000-8000-'||lpad((10000+i)::text,12,'0'))::uuid,'96060000-0000-4000-8000-000000000001',private.stage13_hash('r06-candidate-'||i),'Synthetic candidate '||i,'Synthetic adult collectors','A synthetic projection fixture, never evidence of demand',true,'confirmed',array['etsy.com'],transaction_timestamp()-interval '30 days'
 from generate_series(1,125) i;
insert into public.product_candidates(id,business_id,fingerprint,concept,audience,hypothesis,original_design,rights_status,source_domains) values
 ('96060000-0000-4000-8000-000000020001','96060000-0000-4000-8000-000000000002',repeat('a',64),'Second owned candidate','Synthetic adult collectors','A separate synthetic projection fixture',true,'confirmed',array['etsy.com']),
 ('96060000-0000-4000-8000-000000020002','96060000-0000-4000-8000-000000000003',repeat('b',64),'Foreign candidate','Synthetic adult collectors','A separate synthetic projection fixture',true,'confirmed',array['etsy.com']);
insert into public.product_experiments(id,business_id,candidate_id,workflow_run_id,fingerprint,hypothesis,variables,audience,status,measurement_plan,evidence_pack,source_artifact_id,completed_at,created_at)
 select ('96060000-0000-4000-8000-'||lpad((20000+i)::text,12,'0'))::uuid,'96060000-0000-4000-8000-000000000001',('96060000-0000-4000-8000-'||lpad((10000+i)::text,12,'0'))::uuid,'96060000-0000-4000-8000-000000009000',private.stage13_hash('r06-experiment-'||i),'Synthetic projection hypothesis','{}','Synthetic adult collectors','completed',private.stage13_plan(),'{"syntheticFixture":true}','96060000-0000-4000-8000-000000009200',transaction_timestamp()-interval '20 days',transaction_timestamp()-interval '25 days'
 from generate_series(1,125) i;
insert into public.product_decisions(id,business_id,candidate_id,experiment_id,assessment,assessment_fingerprint,created_at)
 select ('96060000-0000-4000-8000-'||lpad((30000+i)::text,12,'0'))::uuid,'96060000-0000-4000-8000-000000000001',('96060000-0000-4000-8000-'||lpad((10000+i)::text,12,'0'))::uuid,('96060000-0000-4000-8000-'||lpad((20000+i)::text,12,'0'))::uuid,
 '{"outcome":"TEST","assessmentOrigin":"deterministic_provisional","review":{"status":"contract_checked","liveQualified":false,"creativeProductionAllowed":false,"publicationAllowed":false}}',private.stage13_hash('r06-decision-'||i),transaction_timestamp()-interval '20 days'
 from generate_series(1,125) i;
insert into public.product_decisions(id,business_id,candidate_id,experiment_id,assessment,assessment_fingerprint,created_at)
 select ('96060000-0000-4000-8000-'||lpad((32000+i)::text,12,'0'))::uuid,'96060000-0000-4000-8000-000000000001',('96060000-0000-4000-8000-'||lpad((10000+i)::text,12,'0'))::uuid,('96060000-0000-4000-8000-'||lpad((20000+i)::text,12,'0'))::uuid,
 jsonb_build_object('outcome',case i when 2 then 'NEEDS_MORE_EVIDENCE' else 'REJECT' end,'assessmentOrigin','deterministic_provisional','review','{"status":"contract_checked","liveQualified":false,"creativeProductionAllowed":false,"publicationAllowed":false}'::jsonb),private.stage13_hash('r06-newer-decision-'||i),transaction_timestamp()-interval '10 days'
 from generate_series(1,3) i;
insert into public.product_decisions(id,business_id,candidate_id,experiment_id,assessment,assessment_fingerprint,created_at)
 select '96060000-0000-4000-8000-000000033003',business_id,candidate_id,experiment_id,assessment,private.stage13_hash('r06-equal-time-TEST'),transaction_timestamp()-interval '10 days'
 from public.product_decisions where id='96060000-0000-4000-8000-000000030003';

-- A completed v2 reassessment with no decision is newer than the old TEST but
-- older than two later non-completed reassessments. The superseding experiment
-- must still reach the consumer rather than disappearing behind a recent cap.
do $$ declare b uuid:='96060000-0000-4000-8000-000000000001'; c public.product_candidates%rowtype;
 root uuid; child uuid; workflow uuid; artifact uuid; intent jsonb; state text; begin
 select * into strict c from public.product_candidates where id='96060000-0000-4000-8000-000000010004';
 for i in 1..3 loop
  root:=('96060000-0000-4000-8000-'||lpad((40000+i)::text,12,'0'))::uuid;
  child:=('96060000-0000-4000-8000-'||lpad((41000+i)::text,12,'0'))::uuid;
  workflow:=('96060000-0000-4000-8000-'||lpad((42000+i)::text,12,'0'))::uuid;
  artifact:=('96060000-0000-4000-8000-'||lpad((43000+i)::text,12,'0'))::uuid;
  insert into public.workflow_runs(id,business_id,goal_id,workflow_definition_id,status,idempotency_key)
   select workflow,b,'96060000-0000-4000-8000-000000000011',workflow_definition_id,'completed','r06-v2-projection-'||i from public.workflow_runs where id='96060000-0000-4000-8000-000000009000';
  insert into public.artifacts(id,business_id,workflow_run_id,artifact_type,name,content) values(artifact,b,workflow,'research.r06-fixture','Synthetic v2 evidence pointer','{"syntheticFixture":true}');
  intent:=jsonb_build_object('id',root,'businessId',b,'version','pod-discovery-2.0','comparisonUniverse',jsonb_build_object('audiences',jsonb_build_array(c.audience)));
  insert into public.product_experiments(id,business_id,candidate_id,workflow_run_id,fingerprint,hypothesis,variables,audience,status,measurement_plan,discovery_version,created_at)
   values(root,b,null,workflow,private.stage13_hash('r06-v2-root-'||i),'Synthetic v2 root',jsonb_build_object('intent',intent,'policyHash',private.stage14_hash(intent),'budgetAuthorityRootId',root),c.audience,'reserved','{"version":"pod-discovery-2.0","testPlan":null}','pod-discovery-2.0',transaction_timestamp()-make_interval(days=>10-i));
  state:=case i when 1 then 'completed' when 2 then 'failed' else 'reserved' end;
  insert into public.product_experiments(id,business_id,candidate_id,workflow_run_id,fingerprint,hypothesis,variables,audience,status,measurement_plan,evidence_pack,source_artifact_id,completed_at,discovery_version,parent_discovery_id,created_at)
   values(child,b,c.id,workflow,private.stage13_hash('r06-v2-child-'||i),'Synthetic v2 child',jsonb_build_object('intentId',root,'identity',jsonb_build_object('id',c.id,'businessId',b,'concept',c.concept,'audience',c.audience,'productType',c.product_type,'originalDesign',c.original_design,'rightsStatus',c.rights_status)),c.audience,state,'{"version":"pod-discovery-2.0","testPlan":null}',
    case when i=1 then '{"syntheticFixture":true}'::jsonb else null end,case when i=1 then artifact else null end,case when i=1 then transaction_timestamp()-interval '9 days' else null end,'pod-discovery-2.0',root,transaction_timestamp()-make_interval(days=>10-i));
 end loop;
end $$;

-- A v2 decision must carry its exact child and root even when candidate-wide
-- history has other experiments. This is a structural fixture, not a qualified TEST.
do $$ declare c public.product_candidates%rowtype; root uuid:='96060000-0000-4000-8000-000000040001'; begin
 select * into strict c from public.product_candidates where id='96060000-0000-4000-8000-000000010005';
 insert into public.product_experiments(id,business_id,candidate_id,workflow_run_id,fingerprint,hypothesis,variables,audience,status,measurement_plan,evidence_pack,source_artifact_id,completed_at,discovery_version,parent_discovery_id,created_at)
  values('96060000-0000-4000-8000-000000041005',c.business_id,c.id,'96060000-0000-4000-8000-000000042001',private.stage13_hash('r06-v2-child-exact-root'),'Synthetic exact v2 child',jsonb_build_object('intentId',root,'identity',jsonb_build_object('id',c.id,'businessId',c.business_id,'concept',c.concept,'audience',c.audience,'productType',c.product_type,'originalDesign',c.original_design,'rightsStatus',c.rights_status)),c.audience,'completed','{"version":"pod-discovery-2.0","testPlan":null}',
   '{"syntheticFixture":true}','96060000-0000-4000-8000-000000043001',transaction_timestamp()-interval '9 days','pod-discovery-2.0',root,transaction_timestamp()-interval '9 days');
 insert into public.product_decisions(id,business_id,candidate_id,experiment_id,assessment,assessment_fingerprint,created_at)
  values('96060000-0000-4000-8000-000000034005',c.business_id,c.id,'96060000-0000-4000-8000-000000041005',jsonb_build_object('version','pod-discovery-2.0','intentId',root,'candidateId',c.id,'outcome','TEST','publicationAllowed',false,'commerceAllowed',false,
   'executionPrerequisites','{"ownerCreativeApproval":"required","freshBudgetApproval":"required","conceptSpecificIpScreen":"required","printValidation":"required"}'::jsonb,'execution','{"modelId":"anthropic/claude-haiku-4.5","primaryOnly":true}'::jsonb),private.stage13_hash('r06-v2-decision-exact-root'),transaction_timestamp()-interval '8 days');
end $$;

select set_config('request.jwt.claim.sub','96060000-0000-4000-8000-000000000090',true);
do $$ declare table_name text; begin
 assert has_function_privilege('authenticated','public.r06_read(uuid,text,jsonb)','EXECUTE');
 assert not has_function_privilege('anon','public.r06_read(uuid,text,jsonb)','EXECUTE');
 assert not has_function_privilege('service_role','public.r06_read(uuid,text,jsonb)','EXECUTE');
 foreach table_name in array array['account_profiles','account_setup_runs','account_health_events','account_password_credentials','account_browser_handoffs','provider_connections','etsy_connections','etsy_draft_runs','etsy_publication_runs','printful_product_sources','printful_product_runs','listing_qualification_runs'] loop
  assert not has_table_privilege('authenticated','private.'||table_name,'SELECT,INSERT,UPDATE,DELETE');
  assert not has_table_privilege('anon','private.'||table_name,'SELECT');
  assert not has_table_privilege('service_role','private.'||table_name,'SELECT');
  assert (select relrowsecurity from pg_class where oid=('private.'||table_name)::regclass);
 end loop;
 assert not has_function_privilege('authenticated','private.account_run_view(private.account_setup_runs)','EXECUTE');
 assert not has_function_privilege('authenticated','private.stage18_view(uuid)','EXECUTE');
end $$;

set local role authenticated;
do $$ declare b uuid:='96060000-0000-4000-8000-000000000001'; b2 uuid:='96060000-0000-4000-8000-000000000002';
 p jsonb; p2 jsonb; ids text[]:='{}'; i integer; dataset text; begin
 for i in 0..5 loop
  p:=public.r06_read(b,'account_runs',jsonb_build_object('offset',i*25));
  assert (p->>'total')::int=127;
  assert jsonb_array_length(p->'items')=case when i=5 then 2 else 25 end;
  assert (p->>'hasNext')::boolean=(i<5);
  ids:=ids||array(select value->>'id' from jsonb_array_elements(p->'items'));
 end loop;
 assert cardinality(ids)=127 and (select count(distinct x) from unnest(ids) x)=127;
 assert ids[1]='96060000-0000-4000-8000-000000000125';
 assert ids[25]='96060000-0000-4000-8000-000000000101';
 assert ids[127]='96060000-0000-4000-8000-000000000501';
 p:=public.r06_read(b,'account_runs','{"offset":500}');
 assert p->'items'='[]' and p->>'total'='127' and p->>'hasNext'='false';
 p:=public.r06_read(b,'account_runs','{"query":"does not match","status":"cancelled","selectedId":"96060000-0000-4000-8000-000000000501"}');
 assert p->>'total'='0' and p->'items'='[]' and p->'selection'->>'status'='found';
 assert p->'selection'->'item'->>'status'='pending_approval';
 assert p->'selection'->'item'->>'businessId'=b::text;
 p:=public.r06_read(b,'account_runs','{"selectedId":"96060000-0000-4000-8000-000000000601"}');
 assert p->'selection'->>'status'='missing', 'Same-owner other Business must not satisfy an exact selection';
 p:=public.r06_read(b,'account_runs','{"selectedId":"96060000-0000-4000-8000-000000000701"}');
 assert p->'selection'->>'status'='missing';
 p:=public.r06_read(b,'account_runs','{"query":"ETs"}'); assert p->>'total'='126';
 p:=public.r06_read(b,'account_runs',jsonb_build_object('query','etsy%'' OR true --')); assert p->>'total'='0';
 p:=public.r06_read(b,'account_runs','{"status":"expired"}'); assert p->>'total'='1' and p->'items'->0->>'status'='expired';
 p:=public.r06_read(b,'account_unresolved'); assert p->>'total'='1' and p->'items'->0->>'id'='96060000-0000-4000-8000-000000000501';
 assert p->>'ownerTotal'='2', 'Owner-wide unresolved total is independent of the selected Business';
 p:=public.r06_read(b,'account_unresolved','{"query":"no matching provider"}'); assert p->>'total'='0' and p->>'ownerTotal'='2', 'Filtered empty page does not zero the owner unresolved total';
 p:=public.r06_read(null,'account_unresolved','{"limit":1}'); assert p->>'total'='2' and p->>'hasNext'='true';
 p2:=public.r06_read(null,'account_unresolved','{"limit":1,"offset":1}'); assert p2->>'total'='2' and p2->>'hasNext'='false';
 assert p->'items'->0->>'businessId'<>p2->'items'->0->>'businessId';
 p:=public.r06_read(b,'account_health','{"offset":125}'); assert p->>'total'='130' and jsonb_array_length(p->'items')=5;
 foreach dataset in array array['etsy_packages','listing_sources'] loop
  p:=public.r06_read(b,dataset); assert p->>'total'='135' and jsonb_array_length(p->'items')=25;
  assert not exists(select 1 from jsonb_array_elements(p->'items') x where x->>'name' not like 'Older structural candidate %');
  p:=public.r06_read(b,dataset,'{"offset":125}'); assert p->>'total'='135' and jsonb_array_length(p->'items')=10 and p->>'hasNext'='false';
  p:=public.r06_read(b,dataset,'{"query":"candidate 135","selectedId":"96060000-0000-4000-8000-000000001001"}');
  assert p->>'total'='1' and p->'selection'->>'status'='found';
  p:=public.r06_read(b,dataset,'{"selectedId":"96060000-0000-4000-8000-000000003001"}'); assert p->'selection'->>'status'='missing';
  p:=public.r06_read(b2,dataset); assert p->>'total'='1';
 end loop;
 foreach dataset in array array['etsy_runs','publication_runs','publication_drafts','printful_runs','printful_sources','listing_runs','listing_qualifications'] loop
  p:=public.r06_read(b,dataset); assert p->>'total'='0' and p->'items'='[]';
 end loop;
 p:=public.r06_read(b,'product_candidates'); assert p->>'total'='125' and jsonb_array_length(p->'items')=25;
 p:=public.r06_read(null,'product_candidates'); assert p->>'total'='126', 'Owner total includes second owned Business but no foreign candidate';
 p:=public.r06_read(b,'product_candidates','{"status":"TEST"}'); assert p->>'total'='123', 'Latest outcome filter must run before pagination';
 p:=public.r06_read(b,'product_candidates','{"status":"REJECT"}'); assert p->>'total'='1' and p->'items'->0->'candidate'->>'id'='96060000-0000-4000-8000-000000010001';
 p:=public.r06_read(b,'product_candidates','{"query":"no matching concept","selectedId":"96060000-0000-4000-8000-000000010001"}');
 assert p->>'total'='0' and p->'selection'->>'status'='found';
 assert p->'selection'->'item'->'decisions'->0->'assessment'->>'outcome'='REJECT';
 assert p->'selection'->'item'->'decisions'->1->'assessment'->>'outcome'='TEST';
 assert p->'selection'->'item'->'decisions'->0->>'experiment_id'='96060000-0000-4000-8000-000000020001';
 assert exists(select 1 from jsonb_array_elements(p->'selection'->'item'->'experiments') e where e->>'id'='96060000-0000-4000-8000-000000020001' and e->>'source_artifact_id'='96060000-0000-4000-8000-000000009200');
 p:=public.r06_read(b,'production_candidates','{"candidateId":"96060000-0000-4000-8000-000000010001"}'); assert p->>'total'='0', 'New REJECT cannot revive old TEST';
 p:=public.r06_read(b,'production_candidates','{"candidateId":"96060000-0000-4000-8000-000000010002"}'); assert p->>'total'='0', 'New evidence request cannot revive old TEST';
 p:=public.r06_read(b,'product_candidates','{"selectedId":"96060000-0000-4000-8000-000000010003"}');
 assert p->'selection'->'item'->'decisions'->0->>'id'='96060000-0000-4000-8000-000000033003';
 assert p->'selection'->'item'->'decisions'->0->>'created_at'=p->'selection'->'item'->'decisions'->1->>'created_at', 'Both tied latest decisions must remain visible for fail-closed eligibility';
 p:=public.r06_read(b,'production_candidates','{"candidateId":"96060000-0000-4000-8000-000000010004"}');
 assert p->>'total'='1';
 assert exists(select 1 from jsonb_array_elements(p->'items'->0->'experiments') e where e->>'id'='96060000-0000-4000-8000-000000041001' and e->>'status'='completed'), 'Newer completed v2 supersession must survive two later non-completed experiments';
 p:=public.r06_read(b,'product_candidates','{"selectedId":"96060000-0000-4000-8000-000000010005","query":"no match"}');
 assert p->'selection'->'item'->'decisions'->0->>'experiment_id'='96060000-0000-4000-8000-000000041005';
 assert exists(select 1 from jsonb_array_elements(p->'selection'->'item'->'experiments') e where e->>'id'='96060000-0000-4000-8000-000000041005' and e->>'parent_discovery_id'='96060000-0000-4000-8000-000000040001' and e->>'source_artifact_id'='96060000-0000-4000-8000-000000043001');
 assert exists(select 1 from jsonb_array_elements(p->'selection'->'item'->'experiments') e where e->>'id'='96060000-0000-4000-8000-000000040001' and e->'candidate_id'='null'), 'Exact v2 parent root is included';
 p:=public.r06_read(b,'product_experiments','{"candidateId":"96060000-0000-4000-8000-000000010004"}'); assert p->>'total'='4';
 p:=public.r06_read(b,'product_experiments','{"workflowRunId":"96060000-0000-4000-8000-000000009000","selectedId":"96060000-0000-4000-8000-000000020001","offset":100}');
 assert p->>'total'='125' and jsonb_array_length(p->'items')=25 and p->'selection'->>'status'='found';
 p:=public.r06_read(b,'product_decisions','{"candidateId":"96060000-0000-4000-8000-000000010003"}'); assert p->>'total'='3';
 p:=public.r06_read(b,'product_candidates','{"selectedId":"96060000-0000-4000-8000-000000020001"}'); assert p->'selection'->>'status'='missing';
 p:=public.r06_read(b,'product_candidates','{"candidateId":"96060000-0000-4000-8000-000000020001"}'); assert p->>'total'='0';
 perform pg_temp.r06_expect_error('select * from private.account_setup_runs','permission denied');
 perform pg_temp.r06_expect_error('select * from private.etsy_connections','permission denied');
 perform pg_temp.r06_expect_error('select * from private.printful_product_sources','permission denied');
 perform pg_temp.r06_expect_error(format('select public.r06_read(%L,''account_runs'')','96060000-0000-4000-8000-000000000003'),'owner_required');
 perform pg_temp.r06_expect_error(format('select public.r06_read(%L,%L)',b,'account_runs; drop table public.businesses; --'),'read_dataset_invalid');
 perform pg_temp.r06_expect_error(format('select public.r06_read(%L,''account_runs'',''{"goalId":"96060000-0000-4000-8000-000000000011"}'')',b),'quest_scope_invalid');
 perform pg_temp.r06_expect_error(format('select public.r06_read(%L,''etsy_packages'',''{"goalId":"96060000-0000-4000-8000-000000000012"}'')',b),'quest_scope_invalid');
 perform pg_temp.r06_expect_error(format('select public.r06_read(%L,''account_runs'',''{"limit":26}'')',b));
 perform pg_temp.r06_expect_error(format('select public.r06_read(%L,''account_runs'',''{"limit":0}'')',b));
 perform pg_temp.r06_expect_error(format('select public.r06_read(%L,''account_runs'',''{"limit":1.5}'')',b));
 perform pg_temp.r06_expect_error(format('select public.r06_read(%L,''account_runs'',''{"offset":-1}'')',b));
 perform pg_temp.r06_expect_error(format('select public.r06_read(%L,''account_runs'',''{"offset":250000}'')',b));
 perform pg_temp.r06_expect_error(format('select public.r06_read(%L,''account_runs'',''{"serverKey":"forbidden"}'')',b),'read_query_invalid');
 perform pg_temp.r06_expect_error(format('select public.r06_read(%L,''account_runs'',''{"status":null}'')',b));
 perform pg_temp.r06_expect_error(format('select public.r06_read(%L,''account_runs'',''{"selectedId":null}'')',b));
 perform pg_temp.r06_expect_error(format('select public.r06_read(%L,''account_runs'',''{"selectedId":""}'')',b));
 perform pg_temp.r06_expect_error(format('select public.r06_read(%L,''product_candidates'',''{"candidateId":""}'')',b));
 perform pg_temp.r06_expect_error(format('select public.r06_read(%L,''product_candidates'',''{"workflowRunId":123}'')',b));
 perform pg_temp.r06_expect_error(format('select public.r06_read(%L,''account_runs'',''{"goalId":[]}'')',b));
 perform pg_temp.r06_expect_error(format('select public.r06_read(%L,''account_runs'',''{"interventionId":false}'')',b));
 perform pg_temp.r06_expect_error(format('select public.r06_read(%L,''account_runs'',''{"selectedId":"x'' OR true --"}'')',b));
 perform pg_temp.r06_expect_error(format('select public.r06_read(%L,''publication_runs'',''{"interventionId":"96060000-0000-4000-8000-000000000601"}'')',b),'intervention_not_found');
end $$;
select set_config('request.jwt.claim.sub','',true);
do $$ begin perform pg_temp.r06_expect_error('select public.r06_read(''96060000-0000-4000-8000-000000000001'',''account_runs'')','owner_required'); end $$;
set local role anon;
do $$ begin perform pg_temp.r06_expect_error('select public.r06_read(''96060000-0000-4000-8000-000000000001'',''account_runs'')','permission denied'); end $$;
reset role;
do $$ begin
 assert not exists(select 1 from private.listing_mutation_admissions);
 assert not exists(select 1 from private.etsy_publication_mutation_admissions);
 assert not exists(select 1 from private.printful_product_mutation_admissions);
 assert not exists(select 1 from private.account_server_authority);
end $$;
-- Canonical Quest links and direct-workflow links must agree. A later failed
-- attempt in Quest B must not erase the candidate's retained Quest A history.
insert into public.goals(id,business_id,title) values('96060000-0000-4000-8000-000000000013','96060000-0000-4000-8000-000000000001','R06 same-Business Quest B');
insert into private.r04_goal_versions(goal_id,business_id,revision,content,preference,content_hash,actor_id)
 select id,business_id,1,jsonb_build_object('title',title),'draft',repeat('a',64),'96060000-0000-4000-8000-000000000090' from public.goals where id in ('96060000-0000-4000-8000-000000000011','96060000-0000-4000-8000-000000000013');
insert into private.r04_goal_state(goal_id,business_id,revision)
 select goal_id,business_id,revision from private.r04_goal_versions where business_id='96060000-0000-4000-8000-000000000001';
insert into public.workflow_runs(id,business_id,goal_id,workflow_definition_id,status,idempotency_key)
 select ('96060000-0000-4000-8000-'||lpad((45000+i*1000)::text,12,'0'))::uuid,business_id,case i when 2 then null else '96060000-0000-4000-8000-000000000013'::uuid end,workflow_definition_id,case i when 1 then 'failed' else 'completed' end,'r06-quest-scope-'||i
 from public.workflow_runs cross join generate_series(1,3) i where id='96060000-0000-4000-8000-000000009000';
insert into public.artifacts(id,business_id,workflow_run_id,artifact_type,name,content)
 select ('96060000-0000-4000-8000-'||lpad((45100+i*1000)::text,12,'0'))::uuid,'96060000-0000-4000-8000-000000000001',('96060000-0000-4000-8000-'||lpad((45000+i*1000)::text,12,'0'))::uuid,'research.r06-fixture','Quest scope synthetic pointer','{"syntheticFixture":true}' from generate_series(1,3) i;
insert into public.product_experiments(id,business_id,candidate_id,workflow_run_id,fingerprint,hypothesis,variables,audience,status,measurement_plan,evidence_pack,source_artifact_id,basis_artifact_id,completed_at,created_at)
 select ('96060000-0000-4000-8000-'||lpad((45005+i*1001)::text,12,'0'))::uuid,'96060000-0000-4000-8000-000000000001',('96060000-0000-4000-8000-'||lpad((10005+i)::text,12,'0'))::uuid,('96060000-0000-4000-8000-'||lpad((45000+i*1000)::text,12,'0'))::uuid,private.stage13_hash('r06-quest-attempt-'||i),'Synthetic Quest-specific attempt','{}','Synthetic adult collectors',case i when 1 then 'failed' else 'completed' end,private.stage13_plan(),'{"syntheticFixture":true}',('96060000-0000-4000-8000-'||lpad((45100+i*1000)::text,12,'0'))::uuid,('96060000-0000-4000-8000-'||lpad((45100+i*1000)::text,12,'0'))::uuid,transaction_timestamp()-interval '1 day',transaction_timestamp()-interval '1 day'
 from generate_series(1,3) i;
insert into public.product_decisions(id,business_id,candidate_id,experiment_id,assessment,assessment_fingerprint,created_at)
 select '96060000-0000-4000-8000-000000046016',business_id,candidate_id,'96060000-0000-4000-8000-000000046006',jsonb_set(assessment,'{outcome}','"REJECT"'),private.stage13_hash('r06-other-quest-rejection'),transaction_timestamp()
 from public.product_decisions where id='96060000-0000-4000-8000-000000030006';
insert into private.r04_research_links(experiment_id,business_id,goal_id,goal_revision,workflow_run_id,evidence,evidence_hash,actor_id)
 select id,business_id,'96060000-0000-4000-8000-000000000011',1,workflow_run_id,'{"syntheticFixture":true}',repeat('b',64),'96060000-0000-4000-8000-000000000090'
 from public.product_experiments where id in ('96060000-0000-4000-8000-000000047007','96060000-0000-4000-8000-000000048008');

-- Reviewed completed v2 row sorts first among tied timestamps, and two newer
-- failed/reserved rows occupy the ordinary recent window. The competing row is
-- in Quest B: filtering the preview to Quest A must not remove its safety flag.
do $$ declare c public.product_candidates%rowtype; intent jsonb; root uuid:='96060000-0000-4000-8000-000000049001'; begin
 select * into strict c from public.product_candidates where id='96060000-0000-4000-8000-000000010005';
 insert into public.workflow_runs(id,business_id,goal_id,workflow_definition_id,status,idempotency_key)
  select '96060000-0000-4000-8000-000000049002',business_id,'96060000-0000-4000-8000-000000000013',workflow_definition_id,'completed','r06-tied-completion-workflow' from public.workflow_runs where id='96060000-0000-4000-8000-000000009000';
 insert into public.artifacts(id,business_id,workflow_run_id,artifact_type,name,content) values('96060000-0000-4000-8000-000000049003',c.business_id,'96060000-0000-4000-8000-000000049002','research.r06-fixture','Tied completion synthetic pointer','{"syntheticFixture":true}');
 intent:=jsonb_build_object('id',root,'businessId',c.business_id,'version','pod-discovery-2.0','comparisonUniverse',jsonb_build_object('audiences',jsonb_build_array(c.audience)));
 insert into public.product_experiments(id,business_id,workflow_run_id,fingerprint,hypothesis,variables,audience,status,measurement_plan,discovery_version,created_at)
  values(root,c.business_id,'96060000-0000-4000-8000-000000049002',private.stage13_hash('r06-tied-root'),'Synthetic tied root',jsonb_build_object('intent',intent,'policyHash',private.stage14_hash(intent),'budgetAuthorityRootId',root),c.audience,'reserved','{"version":"pod-discovery-2.0","testPlan":null}','pod-discovery-2.0',transaction_timestamp()-interval '9 days');
 insert into public.product_experiments(id,business_id,candidate_id,workflow_run_id,fingerprint,hypothesis,variables,audience,status,measurement_plan,evidence_pack,source_artifact_id,completed_at,discovery_version,parent_discovery_id,created_at)
  select '96060000-0000-4000-8000-000000040505',business_id,candidate_id,'96060000-0000-4000-8000-000000049002',private.stage13_hash('r06-tied-child'),hypothesis,jsonb_set(variables,'{intentId}',to_jsonb(root)),audience,status,measurement_plan,evidence_pack,'96060000-0000-4000-8000-000000049003',completed_at,discovery_version,root,created_at
  from public.product_experiments where id='96060000-0000-4000-8000-000000041005';
 for i in 2..3 loop
  insert into public.product_experiments(id,business_id,candidate_id,workflow_run_id,fingerprint,hypothesis,variables,audience,status,measurement_plan,discovery_version,parent_discovery_id,created_at)
   select ('96060000-0000-4000-8000-'||lpad((41005+i*10)::text,12,'0'))::uuid,business_id,candidate_id,('96060000-0000-4000-8000-'||lpad((42000+i)::text,12,'0'))::uuid,private.stage13_hash('r06-later-noncomplete-'||i),hypothesis,jsonb_set(variables,'{intentId}',to_jsonb(('96060000-0000-4000-8000-'||lpad((40000+i)::text,12,'0'))::uuid)),audience,case i when 2 then 'failed' else 'reserved' end,measurement_plan,discovery_version,('96060000-0000-4000-8000-'||lpad((40000+i)::text,12,'0'))::uuid,transaction_timestamp()-make_interval(days=>10-i)
   from public.product_experiments where id='96060000-0000-4000-8000-000000041005';
 end loop;
end $$;
select set_config('request.jwt.claim.sub','96060000-0000-4000-8000-000000000090',true);
set local role authenticated;
do $$ declare b uuid:='96060000-0000-4000-8000-000000000001'; a uuid:='96060000-0000-4000-8000-000000000011'; q_b uuid:='96060000-0000-4000-8000-000000000013'; p jsonb; item jsonb; dataset text; begin
 assert not has_function_privilege('authenticated','private.r06_experiment_goal(uuid,uuid)','EXECUTE');
 assert not has_function_privilege('anon','private.r06_experiment_goal(uuid,uuid)','EXECUTE');
 assert not has_function_privilege('service_role','private.r06_experiment_goal(uuid,uuid)','EXECUTE');
 perform pg_temp.r06_expect_error(format('select private.r06_experiment_goal(%L,%L)',b,'96060000-0000-4000-8000-000000020006'),'permission denied');
 p:=public.r06_read(b,'product_candidates',jsonb_build_object('goalId',a,'candidateId','96060000-0000-4000-8000-000000010006'));
 assert p->>'total'='1', 'Quest A membership survives later failed Quest B history'; item:=p->'items'->0;
 assert item->'candidate'->>'current_decision_id'='96060000-0000-4000-8000-000000046016';
 assert item->'decisions'->0->>'id'='96060000-0000-4000-8000-000000030006';
 assert not exists(select 1 from jsonb_array_elements(item->'decisions') d where d->>'experiment_id'='96060000-0000-4000-8000-000000046006'), 'Quest A preview must not disclose unrelated Quest B decisions';
 assert not exists(select 1 from jsonb_array_elements(item->'experiments') e where e->>'id'='96060000-0000-4000-8000-000000046006');
 p:=public.r06_read(b,'product_experiments',jsonb_build_object('goalId',a,'selectedId','96060000-0000-4000-8000-000000047007'));
 assert p->'selection'->>'status'='found', 'Exact R04 mapping resolves a null workflow goal';
 p:=public.r06_read(b,'product_experiments',jsonb_build_object('goalId',a,'selectedId','96060000-0000-4000-8000-000000048008')); assert p->'selection'->>'status'='missing';
 p:=public.r06_read(b,'product_experiments',jsonb_build_object('goalId',q_b,'selectedId','96060000-0000-4000-8000-000000048008')); assert p->'selection'->>'status'='missing', 'Conflicting direct and explicit mappings remain ambiguous in both Quests';
 p:=public.r06_read(b,'product_experiments','{"selectedId":"96060000-0000-4000-8000-000000048008"}'); assert p->'selection'->>'status'='found', 'Ambiguous historical row stays inspectable without invented Quest membership';
 p:=public.r06_read(b,'product_candidates','{"candidateId":"96060000-0000-4000-8000-000000010003"}'); assert p->'items'->0->'candidate'->>'current_decision_ambiguous'='true';
 p:=public.r06_read(b,'production_candidates','{"candidateId":"96060000-0000-4000-8000-000000010005"}'); item:=p->'items'->0;
 assert (select count(*) from jsonb_array_elements(item->'experiments') e where e->>'id' in ('96060000-0000-4000-8000-000000041005','96060000-0000-4000-8000-000000040505'))=2, 'Both tied completed v2 rows survive newer failed/reserved records';
 p:=public.r06_read(b,'production_candidates',jsonb_build_object('goalId',a,'candidateId','96060000-0000-4000-8000-000000010005')); item:=p->'items'->0;
 assert exists(select 1 from jsonb_array_elements(item->'experiments') e where e->>'id'='96060000-0000-4000-8000-000000041005' and e->>'has_competing_completed_v2'='true'), 'Quest filtering cannot revive globally ambiguous production eligibility';
 assert not exists(select 1 from jsonb_array_elements(item->'experiments') e where e->>'id'='96060000-0000-4000-8000-000000040505');
 -- Workflow-scoped previews must not leak the candidate's other workflows,
 -- while the global competing-completion flag still prevents unsafe revival.
 foreach dataset in array array['product_candidates','production_candidates'] loop
  p:=public.r06_read(b,dataset,'{"workflowRunId":"96060000-0000-4000-8000-000000042001","candidateId":"96060000-0000-4000-8000-000000010005"}');
  assert p->>'total'='1' and jsonb_array_length(p->'items')=1, 'Requested workflow retains its candidate in both datasets';
  item:=p->'items'->0;
  assert jsonb_array_length(item->'experiments')>0;
  assert not exists(select 1 from jsonb_array_elements(item->'experiments') e where e->>'workflow_run_id' is distinct from '96060000-0000-4000-8000-000000042001'), 'Candidate preview contains only the requested workflow experiments';
  assert exists(select 1 from jsonb_array_elements(item->'experiments') e where e->>'id'='96060000-0000-4000-8000-000000041005' and e->>'has_competing_completed_v2'='true'), 'Workflow filtering preserves global competing-completion safety';
 end loop;
end $$;
reset role;
-- Byte caps fail explicitly, never by returning a fabricated empty page/detail.
insert into private.account_setup_runs(id,business_id,owner_id,provider,mode,idempotency_key,connection_id,profile_revision,disclosure,disclosure_hash,status,approval_expires_at)
 select ('96060000-0000-4000-8000-'||lpad((99000+i)::text,12,'0'))::uuid,business_id,owner_id,provider,mode,'r06-payload-limit-'||i,connection_id,profile_revision,jsonb_build_object('syntheticOversizedField',repeat('x',3000000)),disclosure_hash,'cancelled',approval_expires_at
 from private.account_setup_runs cross join generate_series(1,3) i where id='96060000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','96060000-0000-4000-8000-000000000090',true);
set local role authenticated;
do $$ begin
 perform pg_temp.r06_expect_error('select public.r06_read(''96060000-0000-4000-8000-000000000001'',''account_runs'')','read_payload_limit');
 perform pg_temp.r06_expect_error('select public.r06_read(''96060000-0000-4000-8000-000000000001'',''account_runs'',''{"query":"no matching provider","selectedId":"96060000-0000-4000-8000-000000099001"}'')','read_payload_limit');
end $$;
reset role;
rollback;
