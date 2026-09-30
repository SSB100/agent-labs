-- Administrator-only structural regression; run after the proposed migration in one
-- BEGIN/SAVEPOINT/ROLLBACK rehearsal. ALL provider responses below are SYNTHETIC.
-- No HTTP calls, real evidence, worker promotion, spending or publication occur here.
begin;
select set_config('stage14.owner',gen_random_uuid()::text,true);
select set_config('stage14.other',gen_random_uuid()::text,true);
select set_config('stage14.business',gen_random_uuid()::text,true);
select set_config('stage14.foreign',gen_random_uuid()::text,true);
insert into auth.users(id,email) values(current_setting('stage14.owner')::uuid,'stage14-owner@example.invalid'),(current_setting('stage14.other')::uuid,'stage14-other@example.invalid');
insert into public.businesses(id,owner_user_id,name) values
 (current_setting('stage14.business')::uuid,current_setting('stage14.owner')::uuid,'Stage 14 rollback fixture'),
 (current_setting('stage14.foreign')::uuid,current_setting('stage14.other')::uuid,'Foreign creative fixture');

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
-- These helper lookups are admin-only synthetic test scaffolding, never public APIs.
create function pg_temp.creative_output(p_run uuid,p_key text,p_fail boolean default false,p_binary_fail boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.creative_runs%rowtype; a public.creative_approvals%rowtype; brief jsonb; bh text; v integer:=split_part(p_key,':',2)::integer; phase text:=split_part(p_key,':',1); ih text; repair text;
begin
 select * into strict r from public.creative_runs where id=p_run;
 select * into strict a from public.creative_approvals where id=r.approval_id;
 select output,output_hash into brief,bh from public.creative_phase_outputs where creative_run_id=r.id and call_key='brief:1';
 if phase='brief' then return jsonb_build_object('version','1.0','approvalId',a.id,'audience',a.snapshot->>'audience','concept',a.snapshot->>'concept','style','Original geometric vector-style minimal artwork',
 'hierarchy','A single stylized sun above three original pine silhouettes','typography','No typography or written text in this design','placement',a.snapshot->'printSpecification'->>'placement',
 'garmentCompatibility',a.snapshot->'printSpecification'->>'garment','colors',jsonb_build_array('#F2E4CA','#1F4D3A'),'forbiddenElements',jsonb_build_array('brand names','copied artwork','protected characters'),
 'originalityRequirements','Use only newly created geometric shapes without protected source references.','imagePrompt','Create original minimalist geometric pine trees and a sun on an opaque cream square, centered with generous margins and no words.');
 elsif phase='screen' then return jsonb_build_object('version','1.0','briefHash',bh,'approvalHash',a.approval_hash,
 'checks',(select jsonb_agg(jsonb_build_object('category',k,'status',case when p_fail and k='trademarks' then 'unknown' else 'clear' end,'rationale','Synthetic independent screen inspected this exact brief and policy category.')) from unnest(array['brand_names','trademarks','copyrighted_characters','sports_teams','logos','celebrity_likeness','copied_artwork','marketplace_policy']) k),
 'outcome',case when p_fail then 'NEEDS_OWNER' else 'PASS' end);
 elsif phase='generate' then
 select x.review->>'repairInstruction' into repair from public.creative_reviews x join public.creative_assets v on v.id=x.asset_id where v.creative_run_id=r.id and v.version=1;
 return jsonb_build_object('inspection',jsonb_build_object('sha256',private.stage13_hash('synthetic-png-'||r.id||':'||v),'mediaType','image/png','bytes',2048,'width',case when p_binary_fail then 100 else 1024 end,'height',1024,'colorSpace','srgb','hasAlpha',false,'transparentPixelFraction',0,'effectiveDpi',case when p_binary_fail then 15.38 else 157.53 end,'failedCriteria',case when p_binary_fail then '["effective_dpi"]'::jsonb else '[]'::jsonb end),
 'storagePath',r.business_id::text||'/'||r.id::text||'/version-'||v||'.png','prompt',(brief->>'imagePrompt')||case when v=2 then E'\n\nRepair instruction: '||repair else '' end,'model','recraft/recraft-v4.1-pro','provider','openrouter','generatedAt',now());
 else
 select asset_hash into strict ih from public.creative_assets where creative_run_id=r.id and version=v;
 return jsonb_build_object('version','1.0','assetHash',ih,'briefHash',bh,
 'checks',(select jsonb_agg(jsonb_build_object('criterion',k,'outcome',case when p_fail and k='visual_clarity' then 'FAIL' else 'PASS' end,'rationale','Synthetic independent visual review inspects this exact asset against its brief.')) from unnest(array['brief_alignment','print_constraints','originality_policy','target_audience','visual_clarity']) k),
 'outcome',case when p_fail then 'FAIL' else 'PASS' end,'repairInstruction',case when p_fail then 'Restore the exact approved composition using only the approved subjects and background. Remove unrequested elements; add no new subjects, names, text or references.' else null end);
 end if;
end; $$;
create function pg_temp.creative_reserve(p_run uuid,p_business uuid,p_cap text,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare phase text:=split_part(p_key,':',1); model text; amount integer; estimate jsonb; brief jsonb; repair text; request_hash text:=repeat(md5(p_run||p_key),2);
begin
 model:=case phase when 'brief' then 'openai/gpt-5.6-luna' when 'generate' then 'recraft/recraft-v4.1-pro' else 'anthropic/claude-haiku-4.5' end;
 amount:=case phase when 'brief' then 33992 when 'screen' then 107304 when 'generate' then 210000 else 131880 end;
 if phase='generate' then
   select output into brief from public.creative_phase_outputs where creative_run_id=p_run and call_key='brief:1';
   select review->>'repairInstruction' into repair from public.creative_reviews x join public.creative_assets v on v.id=x.asset_id where v.creative_run_id=p_run and v.version=1;
   estimate:=jsonb_build_object('version','recraft-image-1.0','provider','openrouter','upstreamProvider','recraft','modelId',model,
     'requestHash',request_hash,'promptHash',private.stage13_hash((brief->>'imagePrompt')||case when p_key='generate:2' then E'\n\nRepair instruction: '||repair else '' end),
     'pricingFingerprint',repeat('a',64),'quoteId','rollback-quote-'||p_run||p_key,'estimatedMicrousd',amount,'verifiedAt',now(),
     'source','https://openrouter.ai/api/v1/images/models/recraft/recraft-v4.1-pro/endpoints','estimateOnly',true,'providerInvoiceGuarantee',false);
 else
   estimate:=jsonb_build_object('version','creative-estimate-1.0','inputTokenAllowance',case when phase='review' then 40960 else 32768 end,'outputTokenAllowance',case when phase='brief' then 2500 else 1800 end,
     'textRequestBytes',24576,'quote',jsonb_build_object('modelId',model,'verifiedAt',now(),'source','https://openrouter.ai/api/v1/models','inputPerMillion',case when phase='brief' then 0.8 else 3 end,
     'outputPerMillion',case when phase='brief' then 3.11104 else 5 end,'cacheWritePerMillion',0),'estimateOnly',true,'providerInvoiceGuarantee',false);
 end if;
 return public.creative_runtime_transition(p_run,p_business,p_cap,'reserve_call',jsonb_build_object('callKey',p_key,'reservedMicrousd',amount,'requestHash',request_hash,'model',model,'provider','openrouter','estimate',estimate));
end; $$;
create function pg_temp.creative_record(p_run uuid,p_business uuid,p_cap text,p_key text,p_actual bigint default 1000,p_valid boolean default true,p_no_id boolean default false) returns jsonb language sql as $$
 select public.creative_runtime_transition(p_run,p_business,p_cap,'record_call',jsonb_build_object('callKey',p_key,'reportedMicrousd',p_actual,
 'providerRequestId',case when p_no_id then null else 'stage14-rollback-'||p_run||':'||p_key end,
 'receipt',jsonb_build_object('model',case split_part(p_key,':',1) when 'brief' then 'openai/gpt-5.6-luna' when 'generate' then 'recraft/recraft-v4.1-pro' else 'anthropic/claude-haiku-4.5' end,
 'provider','openrouter','providerRequestId',case when p_no_id then null else 'stage14-rollback-'||p_run||':'||p_key end,'outputValidated',p_valid,'mockProvider',false,
 'executionMode',case when split_part(p_key,':',1)='generate' then 'image.generate' else 'creative.model' end)));
$$;
create function pg_temp.creative_phase(p_run uuid,p_business uuid,p_cap text,p_key text,p_fail boolean default false,p_binary_fail boolean default false,p_actual bigint default 1000) returns jsonb language plpgsql security definer set search_path='' as $$
declare output jsonb; result jsonb;
begin
 perform pg_temp.creative_reserve(p_run,p_business,p_cap,p_key);
 output:=pg_temp.creative_output(p_run,p_key,p_fail,p_binary_fail);
 if split_part(p_key,':',1)='generate' then
   -- Fake object metadata ONLY; no bytes are uploaded by this rollback suite.
   insert into storage.objects(bucket_id,name,metadata) values('creative-assets',output->>'storagePath','{"mimetype":"image/png","size":2048}') on conflict do nothing;
 end if;
 perform pg_temp.creative_record(p_run,p_business,p_cap,p_key,p_actual);
 return public.creative_runtime_transition(p_run,p_business,p_cap,'persist_phase',jsonb_build_object('callKey',p_key,'output',output));
end; $$;

select set_config('request.jwt.claim.sub',current_setting('stage14.owner'),true);
set local role authenticated;
do $$
declare candidate jsonb; approval jsonb; created jsonb; replay jsonb; launch jsonb; denied boolean; bad jsonb;
begin
 candidate:=public.create_product_candidate(current_setting('stage14.business')::uuid,'{"concept":"Original pines and sun square","audience":"Weekend hiking enthusiasts","hypothesis":"An unvalidated original geometric pine design might interest hiking enthusiasts.","originalDesign":true,"rightsStatus":"confirmed","sourceDomains":["etsy.com"]}');
 perform set_config('stage14.candidate',candidate->>'candidateId',true);
 approval:=pg_temp.creative_approval((candidate->>'candidateId')::uuid);
 denied:=false; begin perform public.approve_creative_candidate((candidate->>'candidateId')::uuid,jsonb_set(approval,'{rightsConfirmed}','false'),pg_temp.creative_quote()); exception when others then denied:=true; end; assert denied,'Rights cannot be waived';
 denied:=false; begin perform public.approve_creative_candidate((candidate->>'candidateId')::uuid,jsonb_set(approval,'{printSpecification,verifiedAt}',to_jsonb((now()-interval '31 days')::text)),pg_temp.creative_quote()); exception when others then denied:=true; end; assert denied,'Stale print source denied';
 denied:=false; begin perform public.approve_creative_candidate((candidate->>'candidateId')::uuid,jsonb_set(approval,'{policyScreen,0,status}','"unknown"'),pg_temp.creative_quote()); exception when others then denied:=true; end; assert denied,'Unknown IP screen denied';
 bad:=approval||jsonb_build_object('purpose','candidate_production','decisionId',gen_random_uuid(),'candidateAssessment','{"outcome":"TEST","assessmentOrigin":"owner_assessment","totalScore":100,"missingEvidence":[]}'::jsonb);
 denied:=false; begin perform public.approve_creative_candidate((candidate->>'candidateId')::uuid,bad,pg_temp.creative_quote()); exception when others then denied:=true; end; assert denied,'Client-supplied TEST cannot authorize production';
 denied:=false; begin perform public.approve_creative_candidate((candidate->>'candidateId')::uuid,approval||'{"maximumMicrousd":2000001}',pg_temp.creative_quote()); exception when others then denied:=true; end; assert denied,'Budget cannot exceed US$2';
 denied:=false; begin perform public.approve_creative_candidate((candidate->>'candidateId')::uuid,approval||'{"maximumMicrousd":1000}',pg_temp.creative_quote()); exception when others then denied:=true; end; assert denied,'Approval must cover quoted six-call bound';
 created:=public.approve_creative_candidate((candidate->>'candidateId')::uuid,approval,pg_temp.creative_quote());
 replay:=public.approve_creative_candidate((candidate->>'candidateId')::uuid,approval,pg_temp.creative_quote());
 assert created=replay,'Repeated approval reuses immutable server snapshot';
 perform set_config('stage14.approval',created->>'approvalId',true);
 perform set_config('stage14.nonce',gen_random_uuid()::text,true);
 launch:=public.begin_creative_run((created->>'approvalId')::uuid,current_setting('stage14.nonce')::uuid,repeat('creative-capability-',3));
 replay:=public.begin_creative_run((created->>'approvalId')::uuid,gen_random_uuid(),repeat('replacement-secret-',3));
 assert launch->'shouldStart'='true' and replay->'shouldStart'='false' and launch->>'creativeRunId'=replay->>'creativeRunId';
 perform set_config('stage14.run',launch->>'creativeRunId',true); perform set_config('stage14.workflow',launch->>'workflowRunId',true);
 denied:=false; begin update public.creative_approvals set maximum_microusd=2000000 where id=(created->>'approvalId')::uuid; exception when insufficient_privilege then denied:=true; end; assert denied,'Owner cannot rewrite approval';
 denied:=false; begin update public.workflow_runs set status='completed',state='{"productionReady":true}' where id=(launch->>'workflowRunId')::uuid; exception when insufficient_privilege then denied:=true; end; assert denied,'Owner cannot forge Core completion';
 denied:=false; begin insert into public.creative_reviews(id,creative_run_id,business_id,asset_id,brief_hash,asset_hash,review,reviewer_model,artifact_id) values(gen_random_uuid(),(launch->>'creativeRunId')::uuid,current_setting('stage14.business')::uuid,gen_random_uuid(),repeat('a',64),repeat('b',64),'{}','forged',gen_random_uuid()); exception when insufficient_privilege then denied:=true; end; assert denied,'Owner cannot insert fake reviews';
end; $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('stage14.other'),true);
set local role authenticated;
do $$ declare denied boolean:=false; begin
 assert (select count(*) from public.creative_approvals where business_id=current_setting('stage14.business')::uuid)=0;
 assert (select count(*) from public.creative_runs where business_id=current_setting('stage14.business')::uuid)=0;
 begin perform public.begin_creative_run(current_setting('stage14.approval')::uuid,gen_random_uuid(),repeat('foreign-secret-',3)); exception when insufficient_privilege then denied:=true; end; assert denied,'Foreign owner cannot launch';
 denied:=false; begin perform public.approve_creative_candidate(current_setting('stage14.candidate')::uuid,pg_temp.creative_approval(current_setting('stage14.candidate')::uuid),pg_temp.creative_quote()); exception when insufficient_privilege then denied:=true; end; assert denied,'Foreign owner cannot approve';
end; $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$
declare r uuid:=current_setting('stage14.run')::uuid; b uuid:=current_setting('stage14.business')::uuid; cap text:=repeat('creative-capability-',3); denied boolean; result jsonb; ctx jsonb; out jsonb; path text;
begin
 denied:=false; begin perform public.creative_runtime_transition(r,b,repeat('replacement-secret-',3),'load','{"runtimeRunId":"rollback-main"}'); exception when insufficient_privilege then denied:=true; end; assert denied,'Replay launch cannot replace secret';
 denied:=false; begin perform public.creative_runtime_transition(r,current_setting('stage14.foreign')::uuid,cap,'load','{"runtimeRunId":"rollback-main"}'); exception when insufficient_privilege then denied:=true; end; assert denied,'Capability cannot cross Business';
 denied:=false; begin perform public.installed_pack_runtime_transition(current_setting('stage14.workflow')::uuid,b,cap,'complete','{}'); exception when insufficient_privilege then denied:=true; end; assert denied,'Generic runtime cannot bypass creative gates';
 perform public.creative_runtime_transition(r,b,cap,'load','{"runtimeRunId":"rollback-main"}');
 denied:=false; begin perform public.creative_runtime_transition(r,b,cap,'load','{"runtimeRunId":"other-runtime"}'); exception when others then denied:=true; end; assert denied,'Runtime ID cannot be replaced';
 ctx:=public.creative_runtime_transition(r,b,cap,'prepare','{"callKey":"brief:1"}');
 assert ctx->'worker'->'manifest'->'worker'->>'workerKey'='etsy.creative-director';
 assert jsonb_array_length(ctx->'context'->'inputArtifacts')=3,'Brief receives only approval and two scoped knowledge artifacts';
 result:=pg_temp.creative_reserve(r,b,cap,'brief:1'); assert result->'shouldExecute'='true';
 result:=pg_temp.creative_reserve(r,b,cap,'brief:1'); assert result->'shouldExecute'='false','Reserved model calls are never automatically repeated';
 denied:=false; begin perform public.creative_runtime_transition(r,b,cap,'reserve_call','{"callKey":"brief:1","reservedMicrousd":1,"requestHash":"bad","model":"other","provider":"openrouter","estimate":{}}'); exception when others then denied:=true; end; assert denied,'Changed reservation rejected';
 denied:=false; begin perform public.creative_runtime_transition(r,b,cap,'persist_phase',jsonb_build_object('callKey','brief:1','output',pg_temp.creative_output(r,'brief:1'))); exception when others then denied:=true; end; assert denied,'Unsettled output cannot advance';
 -- Negative attempt is in an exception subtransaction so its synthetic settlement rolls back.
 denied:=false; begin
   perform pg_temp.creative_record(r,b,cap,'brief:1',999,false);
   perform public.creative_runtime_transition(r,b,cap,'persist_phase',jsonb_build_object('callKey','brief:1','output',pg_temp.creative_output(r,'brief:1')));
 exception when others then denied:=true; end; assert denied,'Paid but invalid output cannot advance';
 result:=pg_temp.creative_record(r,b,cap,'brief:1',1000); assert (result->>'committedMicrousd')::bigint=33992,'Lower actual never releases reservation';
 result:=pg_temp.creative_record(r,b,cap,'brief:1',1000); assert result->'recorded'='false';
 denied:=false; begin perform pg_temp.creative_record(r,b,cap,'brief:1',1001); exception when others then denied:=true; end; assert denied,'Reported-cost replay cannot rewrite ledger';
 out:=pg_temp.creative_output(r,'brief:1');
 result:=public.creative_runtime_transition(r,b,cap,'persist_phase',jsonb_build_object('callKey','brief:1','output',out)); assert result->>'phaseKey'='screen:1';
 result:=public.creative_runtime_transition(r,b,cap,'persist_phase',jsonb_build_object('callKey','brief:1','output',out)); assert result->>'phaseKey'='screen:1','Output replay idempotent';
 perform pg_temp.creative_reserve(r,b,cap,'screen:1'); perform pg_temp.creative_record(r,b,cap,'screen:1');
 denied:=false; begin perform public.creative_runtime_transition(r,b,cap,'persist_phase',jsonb_build_object('callKey','screen:1','output',pg_temp.creative_output(r,'screen:1')||jsonb_build_object('briefHash',repeat('f',64)))); exception when others then denied:=true; end; assert denied,'IP screen cannot refer to another brief';
 perform public.creative_runtime_transition(r,b,cap,'persist_phase',jsonb_build_object('callKey','screen:1','output',pg_temp.creative_output(r,'screen:1')));
 perform pg_temp.creative_reserve(r,b,cap,'generate:1');
 path:=b::text||'/'||r::text||'/version-1.png';
 perform set_config('request.headers','{}',true);
 denied:=false; begin insert into storage.objects(bucket_id,name,metadata) values('creative-assets',path,'{"mimetype":"image/png","size":2048}'); exception when insufficient_privilege then denied:=true; end; assert denied,'Storage insert needs exact capability';
 perform set_config('request.headers',jsonb_build_object('x-creative-capability',cap)::text,true);
 denied:=false; begin insert into storage.objects(bucket_id,name,metadata) values('creative-assets',b::text||'/'||r::text||'/version-2.png','{"mimetype":"image/png","size":2048}'); exception when insufficient_privilege then denied:=true; end; assert denied,'Only current generation path is writable';
 denied:=false; begin insert into storage.objects(bucket_id,name,metadata) values('creative-assets',current_setting('stage14.foreign')||'/'||r::text||'/version-1.png','{"mimetype":"image/png","size":2048}'); exception when insufficient_privilege then denied:=true; end; assert denied,'Storage path cannot cross Business';
 insert into storage.objects(bucket_id,name,metadata) values('creative-assets',path,'{"mimetype":"image/png","size":2048}');
 assert (select count(*) from storage.objects where bucket_id='creative-assets' and name=path)=1,'Active capability can read exact-run bytes';
 update storage.objects set metadata='{}' where bucket_id='creative-assets' and name=path;
 assert (select metadata->>'mimetype' from storage.objects where bucket_id='creative-assets' and name=path)='image/png','No UPDATE granted';
 begin delete from storage.objects where bucket_id='creative-assets' and name=path; exception when insufficient_privilege then null; end;
 assert (select count(*) from storage.objects where bucket_id='creative-assets' and name=path)=1,'No DELETE granted';
 perform pg_temp.creative_record(r,b,cap,'generate:1',210000,true,true);
 result:=public.creative_runtime_transition(r,b,cap,'persist_phase',jsonb_build_object('callKey','generate:1','output',pg_temp.creative_output(r,'generate:1'))); assert result->>'phaseKey'='review:1','Known cost with absent opaque provider ID preserves image and advances';
 perform pg_temp.creative_reserve(r,b,cap,'review:1'); perform pg_temp.creative_record(r,b,cap,'review:1');
 denied:=false; begin perform public.creative_runtime_transition(r,b,cap,'persist_phase',jsonb_build_object('callKey','review:1','output',pg_temp.creative_output(r,'review:1',true)||jsonb_build_object('assetHash',repeat('f',64)))); exception when others then denied:=true; end; assert denied,'Review cannot inspect another asset';
 result:=public.creative_runtime_transition(r,b,cap,'persist_phase',jsonb_build_object('callKey','review:1','output',pg_temp.creative_output(r,'review:1',true))); assert result->>'phaseKey'='generate:2';
 perform pg_temp.creative_phase(r,b,cap,'generate:2');
 result:=pg_temp.creative_phase(r,b,cap,'review:2',true); assert result->>'status'='needs_owner' and result->'productionReady'='false','Second failure consumes the single repair and escalates';
 denied:=false; begin perform pg_temp.creative_reserve(r,b,cap,'generate:3'); exception when others then denied:=true; end; assert denied,'Third image always forbidden';
 denied:=false; begin perform public.creative_runtime_transition(r,b,cap,'prepare','{"callKey":"generate:2"}'); exception when others then denied:=true; end; assert denied,'Terminal run cannot resume';
 assert (select count(*) from storage.objects where bucket_id='creative-assets' and name=path)=0,'Terminal capability cannot read storage';
end; $$;
reset role;

-- Additional fresh scopes have distinct physical placement, rather than resetting the
-- original approval. The original run and its two-version limit remain immutable.
select set_config('request.jwt.claim.sub',current_setting('stage14.owner'),true);
do $$
declare c uuid:=current_setting('stage14.candidate')::uuid; b uuid:=current_setting('stage14.business')::uuid; approval jsonb; created jsonb; launch jsonb; r uuid; result jsonb; key text; denied boolean;
 cap text:=repeat('additional-capability-',3);
begin
 -- Identical intent with new form UUID, expiry and verifiedAt cannot buy another run.
 approval:=pg_temp.creative_approval(c);
 created:=public.approve_creative_candidate(c,approval,pg_temp.creative_quote());
 assert created->>'approvalId'=current_setting('stage14.approval'),'Identical refreshed approval reuses prior spending scope';
 launch:=public.begin_creative_run((created->>'approvalId')::uuid,gen_random_uuid(),cap);
 assert launch->'shouldStart'='false' and launch->>'creativeRunId'=current_setting('stage14.run'),'Duplicate scope cannot reset two-version budget';
 -- Technical PASS does not mutate research or become productionReady.
 approval:=jsonb_set(jsonb_set(pg_temp.creative_approval(c),'{printSpecification,designWidthInches}','6.25'),'{printSpecification,designHeightInches}','6.25');
 created:=public.approve_creative_candidate(c,approval,pg_temp.creative_quote());
 launch:=public.begin_creative_run((created->>'approvalId')::uuid,gen_random_uuid(),cap); r:=(launch->>'creativeRunId')::uuid;
 perform public.creative_runtime_transition(r,b,cap,'load',jsonb_build_object('runtimeRunId','rollback-pass-'||r));
 foreach key in array array['brief:1','screen:1','generate:1','review:1'] loop result:=pg_temp.creative_phase(r,b,cap,key); end loop;
 assert result->>'status'='completed' and result->'productionReady'='false','Technical PASS never means production ready';
 assert (select count(*) from public.creative_assets where creative_run_id=r)=1;
 assert (select count(*) from public.workflow_stage_runs where workflow_run_id=(launch->>'workflowRunId')::uuid and status='skipped')=2;
 assert (select count(*) from public.product_decisions where candidate_id=c)=0,'Technical test creates no research decisions';
 result:=public.creative_runtime_transition(r,b,cap,'load','{}'); assert result->>'status'='completed','Load after first claim requires no repeat runtime ID';
 assert result->'assets'->0 ? 'inspection' and result->'assets'->0 ? 'storagePath' and result->'reviews'->0 ? 'output','CamelCase phase state preserved';
 assert public.creative_runtime_transition(r,b,cap,'fail','{"reason":"Late failure cannot rewrite success"}')->>'status'='completed';
 -- Binary failure cannot be overruled by model PASS.
 approval:=jsonb_set(jsonb_set(pg_temp.creative_approval(c),'{printSpecification,designWidthInches}','6.3'),'{printSpecification,designHeightInches}','6.3');
 created:=public.approve_creative_candidate(c,approval,pg_temp.creative_quote()); launch:=public.begin_creative_run((created->>'approvalId')::uuid,gen_random_uuid(),cap); r:=(launch->>'creativeRunId')::uuid;
 perform public.creative_runtime_transition(r,b,cap,'load',jsonb_build_object('runtimeRunId','rollback-binary-'||r));
 perform pg_temp.creative_phase(r,b,cap,'brief:1'); perform pg_temp.creative_phase(r,b,cap,'screen:1'); perform pg_temp.creative_phase(r,b,cap,'generate:1',false,true);
 result:=pg_temp.creative_phase(r,b,cap,'review:1'); assert result->>'status'='needs_owner' and result->'productionReady'='false','Model PASS cannot override binary print gate';
 -- Unknown reported charge preserves the paid image, consumes reservation and stops.
 approval:=jsonb_set(jsonb_set(pg_temp.creative_approval(c),'{printSpecification,designWidthInches}','6.35'),'{printSpecification,designHeightInches}','6.35');
 created:=public.approve_creative_candidate(c,approval,pg_temp.creative_quote()); launch:=public.begin_creative_run((created->>'approvalId')::uuid,gen_random_uuid(),cap); r:=(launch->>'creativeRunId')::uuid;
 perform public.creative_runtime_transition(r,b,cap,'load',jsonb_build_object('runtimeRunId','rollback-uncertain-'||r));
 perform pg_temp.creative_phase(r,b,cap,'brief:1'); perform pg_temp.creative_phase(r,b,cap,'screen:1');
 result:=pg_temp.creative_phase(r,b,cap,'generate:1',false,false,null);
 assert result->>'status'='needs_owner' and (select count(*) from public.creative_assets where creative_run_id=r)=1,'Uncertain charge never discards paid asset';
 assert private.stage14_committed_cost(r)=351296,'Unknown charge retains full image reservation';
 denied:=false; begin perform pg_temp.creative_reserve(r,b,cap,'review:1'); exception when others then denied:=true; end; assert denied,'No further paid call after uncertain charge';
 -- Actual above reservation is retained, and the next call must include it.
 approval:=jsonb_set(jsonb_set(pg_temp.creative_approval(c),'{printSpecification,designWidthInches}','6.4'),'{printSpecification,designHeightInches}','6.4');
 created:=public.approve_creative_candidate(c,approval,pg_temp.creative_quote()); launch:=public.begin_creative_run((created->>'approvalId')::uuid,gen_random_uuid(),cap); r:=(launch->>'creativeRunId')::uuid;
 perform public.creative_runtime_transition(r,b,cap,'load',jsonb_build_object('runtimeRunId','rollback-budget-'||r));
 perform pg_temp.creative_phase(r,b,cap,'brief:1',false,false,950000);
 result:=pg_temp.creative_reserve(r,b,cap,'screen:1'); assert result->'allowed'='false' and result->'shouldExecute'='false','Next cost cannot exceed total after actual overrun';
 assert private.stage14_committed_cost(r)=950000;
 -- Screen concern creates Needs You before any generation.
 approval:=jsonb_set(jsonb_set(pg_temp.creative_approval(c),'{printSpecification,designWidthInches}','6.45'),'{printSpecification,designHeightInches}','6.45');
 created:=public.approve_creative_candidate(c,approval,pg_temp.creative_quote()); launch:=public.begin_creative_run((created->>'approvalId')::uuid,gen_random_uuid(),cap); r:=(launch->>'creativeRunId')::uuid;
 perform public.creative_runtime_transition(r,b,cap,'load',jsonb_build_object('runtimeRunId','rollback-ip-'||r));
 perform pg_temp.creative_phase(r,b,cap,'brief:1'); result:=pg_temp.creative_phase(r,b,cap,'screen:1',true);
 assert result->>'status'='needs_owner' and (select count(*) from public.creative_assets where creative_run_id=r)=0;
 -- Pre-launch failure is nonce-bound and cannot be used as a post-launch cancellation.
 approval:=jsonb_set(jsonb_set(pg_temp.creative_approval(c),'{printSpecification,designWidthInches}','6.48'),'{printSpecification,designHeightInches}','6.48');
 created:=public.approve_creative_candidate(c,approval,pg_temp.creative_quote()); launch:=public.begin_creative_run((created->>'approvalId')::uuid,current_setting('stage14.nonce')::uuid,cap); r:=(launch->>'creativeRunId')::uuid;
 denied:=false; begin perform public.fail_creative_launch(r,gen_random_uuid()); exception when insufficient_privilege then denied:=true; end; assert denied;
 result:=public.fail_creative_launch(r,current_setting('stage14.nonce')::uuid); assert result->>'status'='needs_owner';
 assert (select count(*) from public.creative_cost_reservations where creative_run_id=r)=0;
end; $$;

set local role authenticated;
do $$ declare denied boolean:=false; path text:=current_setting('stage14.business')||'/'||current_setting('stage14.run')||'/version-1.png'; begin
 assert (select count(*) from storage.objects where bucket_id='creative-assets' and name=path)=1,'Owner retains private read after runtime stops';
 begin perform capability_hash from private.creative_run_capabilities; exception when insufficient_privilege then denied:=true; end; assert denied,'Owner cannot read runtime secrets';
 begin delete from storage.objects where bucket_id='creative-assets' and name=path; exception when insufficient_privilege then null; end;
 assert (select count(*) from storage.objects where bucket_id='creative-assets' and name=path)=1,'Owner cannot delete immutable creative images';
end; $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('stage14.other'),true);
set local role authenticated;
do $$ begin
 assert (select count(*) from public.creative_assets where business_id=current_setting('stage14.business')::uuid)=0;
 assert (select count(*) from public.creative_reviews where business_id=current_setting('stage14.business')::uuid)=0;
 assert (select count(*) from public.creative_cost_reservations where business_id=current_setting('stage14.business')::uuid)=0;
 assert (select count(*) from storage.objects where bucket_id='creative-assets' and name like current_setting('stage14.business')||'/%')=0,'Foreign owner cannot read private assets';
end; $$;
reset role;
do $$ declare denied boolean:=false; begin
 assert (select not public and file_size_limit=7000000 and allowed_mime_types=array['image/png'] from storage.buckets where id='creative-assets'),'Private PNG-only7MB bucket';
 assert not has_function_privilege('anon','public.approve_creative_candidate(uuid,jsonb,jsonb)','execute');
 assert not has_function_privilege('authenticated','public.creative_runtime_transition(uuid,uuid,text,text,jsonb)','execute');
 assert not has_function_privilege('service_role','public.creative_runtime_transition(uuid,uuid,text,text,jsonb)','execute');
 assert private.stage14_canonical('{"z":1.00,"b":[{"x":2,"a":true}],"a":"x"}'::jsonb)='{"a":"x","b":[{"a":true,"x":2}],"z":1}','Canonical hash matches compact recursive JS key order';
 begin update public.creative_assets set model='rewritten' where creative_run_id=current_setting('stage14.run')::uuid; exception when insufficient_privilege then denied:=true; end; assert denied,'Even administrator may not rewrite immutable assets';
end; $$;
-- Expiry fixture changes only this transaction's synthetic capability deadline.
alter table public.creative_runs disable trigger creative_runs_immutable;
update public.creative_runs set capability_expires_at=now()-interval '1 second' where id=current_setting('stage14.run')::uuid;
alter table public.creative_runs enable trigger creative_runs_immutable;
set local role anon;
do $$ declare denied boolean:=false; begin
 begin perform public.creative_runtime_transition(current_setting('stage14.run')::uuid,current_setting('stage14.business')::uuid,repeat('creative-capability-',3),'load','{}'); exception when insufficient_privilege then denied:=true; end; assert denied,'Expired secret cannot use runtime';
end; $$;
reset role;
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

-- Synthetic positive production linkage, including Stage13's later explicit rights confirmation.
-- These test-only registry qualification changes are rolled back and are NOT live proof.
update public.packs set status='qualified' where pack_key in ('capability.web-research','knowledge.research-evidence','worker.market-researcher','workflow.web-research') and version='1.0.0';
update public.workflow_definitions set status='qualified' where workflow_key='research.public-evidence' and version='1.0.0';
update public.worker_definitions set status='qualified' where worker_key='market.researcher' and version='1.0.0';
select set_config('request.jwt.claim.sub',current_setting('stage14.owner'),true);
do $$
declare c jsonb; launch jsonb; e public.product_experiments%rowtype; d public.product_decisions%rowtype; dimensions jsonb; assessment jsonb; approved jsonb; input jsonb;
 cap text:=repeat('stage14-research-fixture-',3);
begin
 c:=public.create_product_candidate(current_setting('stage14.business')::uuid,'{"concept":"Rights confirmation production fixture","audience":"Rollback-only hikers","hypothesis":"Synthetic source-backed production gate fixture, never live qualification evidence.","originalDesign":true,"rightsStatus":"unclear","sourceDomains":["etsy.com"]}');
 launch:=public.begin_product_discovery((c->>'candidateId')::uuid,gen_random_uuid(),cap);
 perform pg_temp.stage13_fixture((launch->>'workflowRunId')::uuid,current_setting('stage14.business')::uuid,cap);
 perform public.product_discovery_runtime((launch->>'workflowRunId')::uuid,current_setting('stage14.business')::uuid,cap,'finalize');
 select * into strict e from public.product_experiments where id=(launch->>'experimentId')::uuid;
 select * into strict d from public.product_decisions where experiment_id=e.id;
 -- now() is transaction-stable; place only the earlier synthetic provisional decision
 -- earlier in fixture time so the production current-decision tie gate is testable.
 alter table public.product_decisions disable trigger stage13_decision_append_only;
 update public.product_decisions set created_at=now()-interval '1 minute' where id=d.id;
 alter table public.product_decisions enable trigger stage13_decision_append_only;
 select jsonb_agg(x||jsonb_build_object('score',4,'rationale','Owner-scored synthetic rollback evidence only',
   'evidenceKind',case when x->>'dimension'='policy_ip_risk' then 'policy' when x->>'dimension' in ('estimated_margin','production_complexity') then 'operational_fact' else 'market_observation' end,
   'evidenceIds',jsonb_build_array(e.evidence_pack->'evidence'->case when x->>'dimension'='policy_ip_risk' then 2 when x->>'dimension' in ('estimated_margin','production_complexity') then 1 else 0 end->>'id')))
   into dimensions from jsonb_array_elements(d.assessment->'dimensions') x;
 assessment:=public.record_product_assessment(e.id,dimensions,true);
 assert assessment->'assessment'->>'outcome'='TEST' and assessment->'assessment'->'ownerRightsConfirmed'='true';
 assert (select rights_status from public.product_candidates where id=(c->>'candidateId')::uuid)='unclear','Stage13 original rights history remains immutable';
 input:=pg_temp.creative_approval((c->>'candidateId')::uuid)||jsonb_build_object('purpose','candidate_production','decisionId',assessment->>'decisionId','candidateAssessment',assessment->'assessment');
 approved:=public.approve_creative_candidate((c->>'candidateId')::uuid,input,pg_temp.creative_quote());
 assert approved->'snapshot'->'candidateAssessment'->'ownerRightsConfirmed'='true','Production gate honors persisted later owner-confirmed rights';
 assert (select count(*) from public.creative_runs where approval_id=(approved->>'approvalId')::uuid)=0,'Separate approval does not execute production';
end; $$;
-- Recovery never refreshes an expired secret or releases its spent reservation.
select set_config('request.jwt.claim.sub',current_setting('stage14.owner'),true);
do $$
declare c jsonb; a jsonb; r jsonb; run_id uuid; denied boolean:=false; result jsonb;
begin
 c:=public.create_product_candidate(current_setting('stage14.business')::uuid,jsonb_build_object('concept','Expired creative recovery fixture','audience','Adult synthetic recovery audience','hypothesis','Synthetic expiry recovery fixture, not real demand.','originalDesign',true,'rightsStatus','confirmed','sourceDomains',jsonb_build_array('etsy.com','printful.com')));
 a:=public.approve_creative_candidate((c->>'candidateId')::uuid,pg_temp.creative_approval((c->>'candidateId')::uuid),pg_temp.creative_quote());
 r:=public.begin_creative_run((a->>'approvalId')::uuid,gen_random_uuid(),repeat('expired-test-capability-',3)); run_id:=(r->>'creativeRunId')::uuid;
 begin perform public.close_expired_creative_run(run_id); exception when raise_exception then denied:=true; end; assert denied,'Live capability cannot be closed through expired recovery';
 alter table public.creative_runs disable trigger creative_runs_immutable;
 update public.creative_runs set capability_expires_at=now()-interval '1 second' where id=run_id;
 alter table public.creative_runs enable trigger creative_runs_immutable;
 perform set_config('request.jwt.claim.sub',current_setting('stage14.other'),true);
 denied:=false; begin perform public.close_expired_creative_run(run_id); exception when insufficient_privilege then denied:=true; end; assert denied,'Foreign owner cannot close run';
 perform set_config('request.jwt.claim.sub',current_setting('stage14.owner'),true);
 result:=public.close_expired_creative_run(run_id); assert result->>'status'='needs_owner';
 assert (select status='needs_owner' from public.workflow_runs where id=(r->>'workflowRunId')::uuid);
 assert not has_function_privilege('anon','public.close_expired_creative_run(uuid)','execute');
 assert private.stage14_safe_repair('Restore the exact approved composition using only the approved subjects and background. Remove unrequested elements; add no new subjects, names, text or references.');
 assert not private.stage14_safe_repair('Add a protected branded character beside the trees.');
end; $$;
-- This temporary trigger delays only the designated synthetic final review
-- after output insertion. The fixed deadline crosses during the same persist,
-- exercising the post-wait check rather than the already-expired entry guard.
create function pg_temp.stage14_delay_terminal_fixture() returns trigger language plpgsql set search_path='' as $$
begin
  if new.creative_run_id::text=current_setting('stage14.delay_terminal_run',true) and new.call_key='review:1' then
    perform pg_sleep(1.25);
  end if;
  return new;
end; $$;
create trigger stage14_terminal_delay_fixture after insert on public.creative_phase_outputs
  for each row execute function pg_temp.stage14_delay_terminal_fixture();

-- Terminal eligibility regressions for the later Stage14 guard migration.
-- Each scenario is synthetic, lives only in this rollback transaction, and
-- exercises real provenance, reservations and receipt persistence without HTTP.
select set_config('request.jwt.claim.sub',current_setting('stage14.owner'),true);
do $$
declare scenario text; b uuid:=current_setting('stage14.business')::uuid; c jsonb; research jsonb; launch jsonb; approved jsonb;
  e public.product_experiments%rowtype; provisional public.product_decisions%rowtype; dimensions jsonb; assessment jsonb; replacement jsonb;
  r uuid; workflow_id uuid; approval_id uuid; final_key text; final_output jsonb; result jsonb; replay jsonb; receipt_before jsonb; assets_before jsonb; cost_before bigint;
  denied boolean; denial_message text; research_cap text:=repeat('terminal-research-fixture-',3); cap text:=repeat('terminal-creative-fixture-',3);
begin
  foreach scenario in array array['unchanged','reject','needs_more_evidence','approval_expired','print_source_expired','repair_reject','capability_expired','capability_expires_during_persist'] loop
    c:=public.create_product_candidate(b,jsonb_build_object('concept','Terminal eligibility fixture '||scenario,'audience','Adult synthetic terminal review audience',
      'hypothesis','Synthetic source-backed terminal race fixture, never live market evidence.','originalDesign',true,'rightsStatus','confirmed','sourceDomains',jsonb_build_array('etsy.com')));
    research:=public.begin_product_discovery((c->>'candidateId')::uuid,gen_random_uuid(),research_cap);
    perform pg_temp.stage13_fixture((research->>'workflowRunId')::uuid,b,research_cap);
    perform public.product_discovery_runtime((research->>'workflowRunId')::uuid,b,research_cap,'finalize');
    select * into strict e from public.product_experiments where id=(research->>'experimentId')::uuid;
    select * into strict provisional from public.product_decisions where experiment_id=e.id;
    -- Distinguish the earlier provisional decision in transaction-stable time.
    alter table public.product_decisions disable trigger stage13_decision_append_only;
    update public.product_decisions set created_at=now()-interval '1 minute' where id=provisional.id;
    alter table public.product_decisions enable trigger stage13_decision_append_only;
    select jsonb_agg(x||jsonb_build_object('score',4,'rationale','Owner-scored synthetic terminal race evidence only',
      'evidenceKind',case when x->>'dimension'='policy_ip_risk' then 'policy' when x->>'dimension' in ('estimated_margin','production_complexity') then 'operational_fact' else 'market_observation' end,
      'evidenceIds',jsonb_build_array(e.evidence_pack->'evidence'->case when x->>'dimension'='policy_ip_risk' then 2 when x->>'dimension' in ('estimated_margin','production_complexity') then 1 else 0 end->>'id')))
      into dimensions from jsonb_array_elements(provisional.assessment->'dimensions') x;
    assessment:=public.record_product_assessment(e.id,dimensions,true);
    assert assessment->'assessment'->>'outcome'='TEST';
    approved:=public.approve_creative_candidate((c->>'candidateId')::uuid,pg_temp.creative_approval((c->>'candidateId')::uuid)||
      jsonb_build_object('purpose','candidate_production','decisionId',assessment->>'decisionId','candidateAssessment',assessment->'assessment'),pg_temp.creative_quote());
    approval_id:=(approved->>'approvalId')::uuid;
    launch:=public.begin_creative_run(approval_id,gen_random_uuid(),cap);
    r:=(launch->>'creativeRunId')::uuid; workflow_id:=(launch->>'workflowRunId')::uuid;
    perform public.creative_runtime_transition(r,b,cap,'load',jsonb_build_object('runtimeRunId','terminal-fixture-'||r));
    perform pg_temp.creative_phase(r,b,cap,'brief:1');
    perform pg_temp.creative_phase(r,b,cap,'screen:1');
    perform pg_temp.creative_phase(r,b,cap,'generate:1');
    final_key:='review:1';
    if scenario='repair_reject' then
      perform pg_temp.creative_phase(r,b,cap,'review:1',true);
      perform pg_temp.creative_phase(r,b,cap,'generate:2');
      final_key:='review:2';
    end if;
    -- Eligibility passes when this paid final review is reserved.
    result:=pg_temp.creative_reserve(r,b,cap,final_key);
    assert result->'shouldExecute'='true';
    final_output:=pg_temp.creative_output(r,final_key);
    assert final_output->>'outcome'='PASS';
    if scenario in ('reject','repair_reject') then
      replacement:=public.record_product_assessment(e.id,jsonb_set(dimensions,'{7,score}','0'),true);
      assert replacement->'assessment'->>'outcome'='REJECT';
    elsif scenario='needs_more_evidence' then
      replacement:=public.record_product_assessment(e.id,jsonb_set(dimensions,'{0,score}','2'),true);
      assert replacement->'assessment'->>'outcome'='NEEDS_MORE_EVIDENCE';
    elsif scenario='approval_expired' then
      -- Controlled time-boundary fixture: make only the approval invalid while
      -- leaving an active run capability, so the terminal branch is exercised.
      -- Real capabilities are min(approval expiry,2h); their hard boundary is
      -- separately asserted below. No production approval is actually mutable.
      alter table public.creative_approvals disable trigger creative_approvals_immutable;
      update public.creative_approvals set approved_at=now()-interval '1 day',expires_at=now()-interval '1 second',
        snapshot=snapshot||jsonb_build_object('approvedAt',now()-interval '1 day','expiresAt',now()-interval '1 second') where id=approval_id;
      alter table public.creative_approvals enable trigger creative_approvals_immutable;
    elsif scenario='print_source_expired' then
      alter table public.creative_approvals disable trigger creative_approvals_immutable;
      update public.creative_approvals set snapshot=jsonb_set(snapshot,'{printSpecification,verifiedAt}',to_jsonb((now()-interval '31 days')::text)) where id=approval_id;
      alter table public.creative_approvals enable trigger creative_approvals_immutable;
    end if;
    -- Already incurred charges must be recorded despite changed eligibility.
    perform pg_temp.creative_record(r,b,cap,final_key);
    select to_jsonb(s) into strict receipt_before from public.creative_cost_settlements s where s.creative_run_id=r and s.call_key=final_key;
    select jsonb_agg(to_jsonb(v) order by v.version) into assets_before from public.creative_assets v where v.creative_run_id=r;
    cost_before:=private.stage14_committed_cost(r);
    if scenario in ('capability_expired','capability_expires_during_persist') then
      alter table public.creative_runs disable trigger creative_runs_immutable;
      -- The immediate recovery branch compares against transaction-stable now(),
      -- so its already-expired fixture must precede that timestamp, not merely
      -- wall time. The in-persistence branch keeps a real future wall deadline.
      update public.creative_runs set capability_expires_at=(case when scenario='capability_expired' then now()-interval '1 second' else clock_timestamp()+interval '1 second' end) where id=r;
      alter table public.creative_runs enable trigger creative_runs_immutable;
      if scenario='capability_expires_during_persist' then perform set_config('stage14.delay_terminal_run',r::text,true); end if;
      denied:=false; denial_message:=null;
      begin perform public.creative_runtime_transition(r,b,cap,'persist_phase',jsonb_build_object('callKey',final_key,'output',final_output));
      exception when insufficient_privilege then denied:=true; get stacked diagnostics denial_message=message_text; end;
      perform set_config('stage14.delay_terminal_run','',true);
      assert denied,'The final eligibility fix must not extend an expired runtime capability';
      assert not exists(select 1 from public.creative_phase_outputs o where o.creative_run_id=r and o.call_key=final_key),'Expired secret cannot retain late output inserts';
      assert not exists(select 1 from public.artifacts a where a.id=private.stage4_deterministic_uuid('creative:output:'||r||':'||final_key)),'The whole late persist, including Core Artifact, rolls back';
      assert not exists(select 1 from public.creative_reviews review where review.creative_run_id=r),'Late final review insert rolls back';
      if scenario='capability_expires_during_persist' then
        assert denial_message='Creative capability expired before final production publication.','The call passed admission, then expired after output insertion and before terminal publication';
        assert (select status='running' and state->'productionReady'='false' from public.workflow_runs where id=workflow_id),'Expired persist cannot change terminal state';
        assert (select status='running' from public.workflow_stage_runs where workflow_run_id=workflow_id and stage_key=final_key),'Completed stage update also rolls back';
        -- Owner recovery runs in a later request/transaction in production; this
        -- transaction-stable now() fixture deliberately leaves the run untouched.
      else
        result:=public.close_expired_creative_run(r);
        assert result->>'status'='needs_owner';
      end if;
    else
      result:=public.creative_runtime_transition(r,b,cap,'persist_phase',jsonb_build_object('callKey',final_key,'output',final_output));
      if scenario='unchanged' then
        assert result->>'status'='completed' and result->'productionReady'='true','Current valid production eligibility still completes';
      else
        assert result->>'status'='needs_owner' and result->'productionReady'='false','Changed final eligibility must never publish productionReady: '||scenario;
        assert exists(select 1 from public.owner_interventions i where i.workflow_run_id=workflow_id and i.status='open' and i.description like 'Production eligibility changed or expired%'),'Eligibility failure requests owner review';
      end if;
      assert (select o.output=final_output from public.creative_phase_outputs o where o.creative_run_id=r and o.call_key=final_key),'Paid final phase output is retained';
      assert exists(select 1 from public.creative_reviews review join public.creative_assets asset on asset.id=review.asset_id
        where review.creative_run_id=r and review.review=final_output and asset.version=split_part(final_key,':',2)::integer),'Paid hash-bound final review is retained';
      assert (select a.content=final_output and a.metadata->'receipt'=receipt_before->'receipt' from public.artifacts a where a.id=(result->>'artifactId')::uuid),'Core final artifact retains the exact receipt';
      replay:=public.creative_runtime_transition(r,b,cap,'persist_phase',jsonb_build_object('callKey',final_key,'output',final_output));
      assert replay->>'status'=result->>'status' and replay->'productionReady'=result->'productionReady','Terminal replay cannot reset eligibility result';
    end if;
    assert (select to_jsonb(s)=receipt_before from public.creative_cost_settlements s where s.creative_run_id=r and s.call_key=final_key),'Final paid settlement is immutable after terminal decision';
    assert (select jsonb_agg(to_jsonb(v) order by v.version)=assets_before from public.creative_assets v where v.creative_run_id=r),'Existing paid asset versions are preserved';
    assert private.stage14_committed_cost(r)=cost_before,'Terminal eligibility failure never releases reserved/actual cost';
    assert (select state->'productionReady'=to_jsonb(scenario='unchanged') and state->'publicationAllowed'='false' from public.workflow_runs where id=workflow_id);
    replay:=public.begin_creative_run(approval_id,gen_random_uuid(),repeat('replacement-terminal-secret-',3));
    assert replay->'shouldStart'='false' and replay->>'creativeRunId'=r::text,'Begin replay does not bypass expiry or reset the approved run';
  end loop;
  assert has_function_privilege('anon','public.creative_runtime_transition(uuid,uuid,text,text,jsonb)','execute');
  assert not has_function_privilege('authenticated','public.creative_runtime_transition(uuid,uuid,text,text,jsonb)','execute');
  assert not has_function_privilege('service_role','public.creative_runtime_transition(uuid,uuid,text,text,jsonb)','execute');
end; $$;
rollback;
