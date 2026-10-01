-- OFFLINE rollback-only Stage14 v2 decision dispatch regression. All model/source records below
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
create function pg_temp.v2_terminal_settle(p_root uuid,p_key text,p_request text) returns void language plpgsql as $$
declare e public.product_experiments%rowtype; rid uuid; begin
  select * into strict e from public.product_experiments where id=p_root;
  insert into public.product_research_cost_reservations(business_id,experiment_id,workflow_run_id,attempt_key,reserved_microusd,request_hash,estimate)
    values(e.business_id,e.id,e.workflow_run_id,p_key,100,private.stage13_hash(p_key),jsonb_build_object('version','discovery-estimate-2.0','intentId',e.id,'policyHash',e.variables->>'policyHash')) returning id into rid;
  insert into public.product_research_cost_settlements(business_id,reservation_id,reported_microusd,provider_request_id,fingerprint)
    values(e.business_id,rid,100,p_request,private.stage13_hash(p_key||':settled'));
end; $$;
create function pg_temp.v2_terminal_receipt(p_root uuid,p_stage text,p_prepared jsonb,p_output jsonb) returns jsonb language plpgsql as $$
declare receipt jsonb; phase jsonb:=p_prepared->'discoveryPhase'; pool jsonb:='[]'; keys jsonb; ref jsonb; src jsonb; ordinal integer:=0; binding text; begin
  receipt:=jsonb_build_object('receiptVersion','1.0','taskContractId',p_prepared->'context'->'taskContract'->>'id','inputArtifactIds',p_prepared->'context'->'taskContract'->'inputArtifactIds',
    'packKey','worker.product-discovery-v2-'||(case when p_stage like 'research%' then 'research' else p_stage end),'packVersion','1.0.0',
    'workerKey','product.discovery-v2.'||(case when p_stage like 'research%' then 'research' else p_stage end),'workerVersion','1.0.0',
    'outputValidated',true,'executionMode',(case when p_stage like 'research%' then 'web.research' else 'discovery.'||p_stage end),'provider','openrouter',
    'actualProviderModelId',(case when p_stage='review' then 'anthropic/claude-haiku-4.5' else 'openai/gpt-5.6-luna' end),'providerRequestId','local-terminal-'||p_stage,
    'primaryOnly',true,'mockProvider',false,'intentId',p_root,'callKey',(case when p_stage like 'research%' then 'select:'||right(p_stage,1) else p_stage||':1' end),
    'stopReason',(case when p_stage like 'research%' then 'evidence_collected' else 'bounded_discovery_phase_completed' end));
  if p_stage like 'research%' then return receipt||jsonb_build_object('queryId',phase->>'queryId'); end if;
  if p_stage in ('strategy','review') then
    for ref in select value from jsonb_array_elements(phase->'evidenceReferences') order by private.stage14_hash(value) loop
      ordinal:=ordinal+1;
      select source.value into strict src from jsonb_array_elements(phase->'validation'->'packs') p cross join lateral jsonb_array_elements(p->'evidencePack'->'sources') source
        where p->>'artifactId'=ref->>'artifactId' and source.value->>'id'=ref->>'sourceId';
      pool:=pool||jsonb_build_array(jsonb_build_object('key','E'||ordinal,'reference',ref,'quote',substring(src->>'excerpt' from (ref->>'start')::integer+1 for (ref->>'end')::integer-(ref->>'start')::integer),
        'url',src->>'url','retrievedAt',src->>'retrievedAt','expiresAt',src->>'retrievalExpiresAt'));
    end loop;
    select jsonb_agg(jsonb_build_object('key','C'||n,'candidateId',x->>'id') order by n) into keys from
      (select x,row_number() over(order by x->>'id') n from jsonb_array_elements(phase->'dossier'->'shortlist') x) q;
    binding:=private.stage14_hash(jsonb_build_object('intent',p_prepared->'productScope'->'intent','dossier',phase->'dossier','evidencePool',pool,'candidateKeys',keys,
      'knowledgePinHash',private.stage14_hash(phase->'validation'->'knowledge'),'committedMicrousd',phase->'validation'->'committedMicrousd','ownerRightsConfirmedCandidateIds','[]'::jsonb,'sellerBankCountry',null));
    receipt:=receipt||jsonb_build_object('dossierHash',private.stage14_hash(phase->'dossier'),'contextBindingHash',binding,'outputHash',private.stage14_hash(p_output));
  end if;
  return receipt;
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
create function pg_temp.creative_provenance(p_output jsonb,p_webp boolean default false) returns jsonb language sql as $$
 select jsonb_build_object('version','creative-image-normalization-1.0',
 'providerMediaType',case when p_webp then 'image/webp' else 'image/png' end,'detectedMediaType',case when p_webp then 'image/webp' else 'image/png' end,
 'originalSha256',case when p_webp then repeat('b',64) else p_output->'inspection'->>'sha256' end,'normalizedSha256',p_output->'inspection'->>'sha256',
 'originalBytes',case when p_webp then 1024 else (p_output->'inspection'->>'bytes')::integer end,'normalizedBytes',p_output->'inspection'->'bytes',
 'width',p_output->'inspection'->'width','height',p_output->'inspection'->'height',
 'conversion',case when p_webp then 'lossless_webp_to_png' else 'none' end,'verification',case when p_webp then 'decoded_pixels_equal' else 'byte_identity' end,
 'decodedPixelSha256',case when p_webp then repeat('c',64) else null end,'normalizedDecodedPixelSha256',case when p_webp then repeat('c',64) else null end,
 'decodedChannels',case when p_webp then 3 else null end,'decodedHasAlpha',case when p_webp then false else null end,
 'decoder','sharp@fixture;vips@fixture','encoder',case when p_webp then 'sharp@fixture;png@fixture' else null end,
 'originalStoragePath',case when p_webp then regexp_replace(p_output->>'storagePath','\.png$','.original.webp') else p_output->>'storagePath' end,
 'normalizedStoragePath',p_output->>'storagePath');
$$;
create function pg_temp.creative_output(p_run uuid,p_key text,p_fail boolean default false,p_binary_fail boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.creative_runs%rowtype; a public.creative_approvals%rowtype; brief jsonb; bh text; v integer:=split_part(p_key,':',2)::integer; phase text:=split_part(p_key,':',1); ih text; repair text; generated jsonb;
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
 generated:=jsonb_build_object('inspection',jsonb_build_object('sha256',private.stage13_hash('synthetic-png-'||r.id||':'||v),'mediaType','image/png','bytes',2048,'width',case when p_binary_fail then 100 else 1024 end,'height',1024,'colorSpace','srgb','hasAlpha',false,'transparentPixelFraction',0,'effectiveDpi',case when p_binary_fail then 15.38 else 157.53 end,'failedCriteria',case when p_binary_fail then '["effective_dpi"]'::jsonb else '[]'::jsonb end),
 'storagePath',r.business_id::text||'/'||r.id::text||'/version-'||v||'.png','prompt',(brief->>'imagePrompt')||case when v=2 then E'\n\nRepair instruction: '||repair else '' end,'model','recraft/recraft-v4.1-pro','provider','openrouter','generatedAt',now());
 return generated||jsonb_build_object('provenance',pg_temp.creative_provenance(generated));
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
create function pg_temp.creative_record(p_run uuid,p_business uuid,p_cap text,p_key text,p_actual bigint default 1000,p_valid boolean default true,p_no_id boolean default false,p_provenance jsonb default null) returns jsonb language sql as $$
 select public.creative_runtime_transition(p_run,p_business,p_cap,'record_call',jsonb_build_object('callKey',p_key,'reportedMicrousd',p_actual,
 'providerRequestId',case when p_no_id then null else 'stage14-rollback-'||p_run||':'||p_key end,
 'receipt',jsonb_build_object('model',case split_part(p_key,':',1) when 'brief' then 'openai/gpt-5.6-luna' when 'generate' then 'recraft/recraft-v4.1-pro' else 'anthropic/claude-haiku-4.5' end,
 'provider','openrouter','providerRequestId',case when p_no_id then null else 'stage14-rollback-'||p_run||':'||p_key end,'outputValidated',p_valid,'mockProvider',false,
 'executionMode',case when split_part(p_key,':',1)='generate' then 'image.generate' else 'creative.model' end)||
 case when split_part(p_key,':',1)='generate' and p_valid then jsonb_build_object('provenance',coalesce(p_provenance,pg_temp.creative_output(p_run,p_key)->'provenance')) else '{}'::jsonb end));
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
 perform pg_temp.creative_record(p_run,p_business,p_cap,p_key,p_actual,true,false,output->'provenance');
 return public.creative_runtime_transition(p_run,p_business,p_cap,'persist_phase',jsonb_build_object('callKey',p_key,'output',output));
end; $$;
create function pg_temp.flux_quote() returns jsonb language sql as $$
 select pg_temp.creative_quote()||jsonb_build_object(
   'generatorModel','black-forest-labs/flux.2-klein-4b',
   'providerBinding','{"provider":"openrouter","upstreamProvider":"black-forest-labs","adapterVersion":"flux-klein-png-1.0","outputFormat":"png","requestedSize":"1024x1024","nativePngRequired":true,"disclosureVersion":"bfl-openrouter-data-use-1.0","ownerAcknowledged":true}'::jsonb,
   'sourceUrls','["https://openrouter.ai/api/v1/models","https://openrouter.ai/api/v1/images/models/black-forest-labs/flux.2-klein-4b/endpoints","https://bfl.ai/legal/developer-terms-of-service","https://bfl.ai/legal/flux-api-service-terms"]'::jsonb,
   'maximaMicrousd','{"brief":33992,"screen":107304,"generation":70000,"review":131880}'::jsonb,
   'maximumEstimateMicrousd',343176,'maximumCalls',4);
$$;
create function pg_temp.flux_payload(p_run uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare prompt text; body jsonb; estimate jsonb; request_hash text;
begin
 select output->>'imagePrompt' into strict prompt from public.creative_phase_outputs where creative_run_id=p_run and call_key='brief:1';
 body:=jsonb_build_object('model','black-forest-labs/flux.2-klein-4b','prompt',prompt,'aspect_ratio','1:1','n',1,'output_format','png','size','1024x1024','provider',jsonb_build_object('only',jsonb_build_array('black-forest-labs'),'allow_fallbacks',false));
 request_hash:=private.stage14_hash(body);
 estimate:=jsonb_build_object('version','flux-klein-png-1.0','provider','openrouter','upstreamProvider','black-forest-labs','modelId','black-forest-labs/flux.2-klein-4b',
   'requestHash',request_hash,'promptHash',private.stage13_hash(prompt),'pricingFingerprint',repeat('a',64),'estimatedMicrousd',70000,'verifiedAt',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'source','https://openrouter.ai/api/v1/images/models/black-forest-labs/flux.2-klein-4b/endpoints','estimateOnly',true,'providerInvoiceGuarantee',false);
 estimate:=estimate||jsonb_build_object('quoteId',private.stage14_hash(estimate));
 return jsonb_build_object('callKey','generate:1','model','black-forest-labs/flux.2-klein-4b','provider','openrouter','reservedMicrousd',70000,'requestHash',request_hash,'estimate',estimate);
end; $$;
create function pg_temp.flux_record(p_run uuid,p_business uuid,p_cap text,p_output jsonb,p_valid boolean default true) returns jsonb language sql as $$
 select public.creative_runtime_transition(p_run,p_business,p_cap,'record_call',jsonb_build_object('callKey','generate:1','reportedMicrousd',14000,'providerRequestId','stage14-bfl-rollback-'||p_run,
 'receipt',jsonb_build_object('model','black-forest-labs/flux.2-klein-4b','provider','openrouter','providerRequestId','stage14-bfl-rollback-'||p_run,'outputValidated',p_valid,'mockProvider',false,'executionMode','image.generate','provenance',p_output->'provenance')));
$$;

do $$ declare b uuid:=current_setting('v2context.business')::uuid; launched jsonb; root uuid; run uuid; prepared jsonb; plan jsonb; strategy jsonb; review jsonb; receipt jsonb;
  collection jsonb; pack jsonb; source jsonb; evidence jsonb; raw_evidence jsonb; content text; quote text; source_id text; evidence_id text; query_id uuid; question text;
  dossier jsonb; identity jsonb; ref jsonb; dimensions jsonb:='[]'; reviewed jsonb:='[]'; markets jsonb:='[]'; dimension text; comparison jsonb; checks jsonb:='[]'; check_key text;
  creative_input jsonb; creative_approval jsonb; creative_launch jsonb; creative_run uuid; creative_cap text:=repeat('v2-production-capability-',3);
  creative_output jsonb; final_output jsonb; newer_decision uuid; blocked boolean; saved_cost bigint; saved_assets jsonb;
  result jsonb; child uuid; decision uuid; count_children integer; denied boolean; malformed jsonb;
begin
  launched:=public.begin_installed_pack_run(b,null,'product.discovery-v2.one',pg_temp.v2_context_envelope(b),'terminal:first',gen_random_uuid(),repeat('terminal-capability-',3));
  root:=(launched->>'rootId')::uuid; run:=(launched->>'workflowRunId')::uuid;
  perform public.installed_pack_runtime_transition(run,b,repeat('terminal-capability-',3),'load','{"runtimeRunId":"local-terminal-run"}');
  prepared:=public.installed_pack_runtime_transition(run,b,repeat('terminal-capability-',3),'prepare','{"stageKey":"plan"}');
  question:='Compare US and GB with inspectable public original-art shirt observations and bounded production constraints.';
  query_id:=private.stage4_deterministic_uuid('discovery:v2:query:'||root||':1');
  plan:=jsonb_build_object('version','pod-discovery-2.0','intentId',root,'comparisonRationale','Compare every declared geography before recommending one bounded original-art learning experiment.',
    'queries',jsonb_build_array(jsonb_build_object('queryId',query_id,'ordinal',1,'question',question,'sourceDomains','["etsy.com","printful.com"]'::jsonb)),
    'proposals','[{"proposalKey":"candidate-1","concept":"Synthetic original abstract design","audience":"Adult original-art buyers","hypothesis":"An independently composed design may support a narrow learning question without establishing candidate demand.","differentiationHypothesis":"Use original abstract composition and preserve unknown demand instead of copying an existing listing."}]'::jsonb);
  perform pg_temp.v2_terminal_settle(root,'plan:1','local-terminal-plan');
  receipt:=pg_temp.v2_terminal_receipt(root,'plan',prepared,plan);
  perform public.installed_pack_runtime_transition(run,b,repeat('terminal-capability-',3),'persist',jsonb_build_object('stageKey','plan','output',plan,'receipt',receipt));
  prepared:=public.installed_pack_runtime_transition(run,b,repeat('terminal-capability-',3),'prepare','{"stageKey":"research1"}');
  content:='This is a synthetic retained public excerpt for local SQL regression. It is not live market evidence. '||repeat('Opening context for a local fixture. ',8)||'A later exact observation distinguishes a bounded original-art question from proven sales or demand.';
  quote:='A later exact observation distinguishes a bounded original-art question from proven sales or demand.';
  source_id:='src-'||left(private.stage13_hash('https://www.etsy.com/listing/local-synthetic:'||private.stage13_hash(content)),24);
  evidence_id:='evi-'||left(private.stage13_hash(source_id||':'||quote),24);
  source:=jsonb_build_object('id',source_id,'url','https://www.etsy.com/listing/local-synthetic','title','Synthetic retained source fixture','retrievedAt',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'publishedAt',null,'retrievalExpiresAt',to_char((now()+interval '23 hours') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'contentHash',private.stage13_hash(content),'excerpt',content,'provider','openrouter.exa');
  evidence:=jsonb_build_object('id',evidence_id,'sourceId',source_id,'quote',quote);
  raw_evidence:=jsonb_build_object('id','evi-'||left(private.stage13_hash(source_id||':'||left(content,320)),24),'sourceId',source_id,'quote',left(content,320));
  receipt:=jsonb_build_object('executionMode','web.research','provider','openrouter','actualProviderModelId','openai/gpt-5.6-luna','providerRequestId','local-terminal-search','primaryOnly',true,'mockProvider',false,'outputValidated',true,'intentId',root,'queryId',query_id,'callKey','search:1');
  collection:=jsonb_build_object('collectionVersion','1.0','query',question,'sources',jsonb_build_array(source),'evidence',jsonb_build_array(raw_evidence),
    'providerMetadata',jsonb_build_object('providerRequestId','local-terminal-search','searchRequests',1,'engine','exa','intentId',root,'queryId',query_id,'callKey','search:1','receipt',receipt));
  perform pg_temp.v2_terminal_settle(root,'search:1','local-terminal-search');
  perform public.append_pack_research_sources(run,b,repeat('terminal-capability-',3),'research1',collection);
  prepared:=public.installed_pack_runtime_transition(run,b,repeat('terminal-capability-',3),'prepare','{"stageKey":"research1"}');
  pack:=jsonb_build_object('evidencePackVersion','1.0','question',question,'sources',jsonb_build_array(source),'evidence',jsonb_build_array(evidence),
    'claims',jsonb_build_array(jsonb_build_object('text',quote,'evidenceId',evidence_id,'sourceId',source_id)),'limitations','["Synthetic local fixture; no real demand conclusion"]'::jsonb);
  perform pg_temp.v2_terminal_settle(root,'select:1','local-terminal-research1');
  receipt:=pg_temp.v2_terminal_receipt(root,'research1',prepared,pack);
  perform public.installed_pack_runtime_transition(run,b,repeat('terminal-capability-',3),'persist',jsonb_build_object('stageKey','research1','output',jsonb_build_object('decision','complete','evidencePack',pack,'stopReason','evidence_collected'),'receipt',receipt));
  prepared:=public.installed_pack_runtime_transition(run,b,repeat('terminal-capability-',3),'prepare','{"stageKey":"strategy"}');
  dossier:=prepared->'discoveryPhase'->'dossier'; identity:=dossier->'shortlist'->0; ref:=prepared->'discoveryPhase'->'evidenceReferences'->0;
  assert (ref->>'start')::integer>320,'V2 exact source spans can come after the old prefix';
  assert identity->>'rightsStatus'='unclear' and not(identity ? 'marketCountryCode'),'A concept is appended without owner rights or preselected geography';
  assert (select a.content=collection from public.artifacts a where a.id=private.stage4_deterministic_uuid('research:sources:'||run||':research1')),'Raw collection and its original prefix evidence remain immutable';
  foreach dimension in array array['demand','competition','differentiation','estimated_margin','creative_opportunity','seasonality','production_complexity','policy_ip_risk','marketing_potential'] loop
    dimensions:=dimensions||jsonb_build_array(jsonb_build_object('dimension',dimension,'finding','supported','evidenceStrength','direct',
      'facts',jsonb_build_array(jsonb_build_object('reference',ref,'relevance','Synthetic local reference is linked to this exact dimension for contract validation.')),
      'rationale','This is an explicit synthetic local reasoning fixture, never a verified market or production conclusion.','uncertainties','[]'::jsonb,'hardFailure',false));
    reviewed:=reviewed||jsonb_build_array(jsonb_build_object('dimension',dimension,'verdict','sufficient_for_test','rationale','Synthetic independent review supplies test-specific reasoning for the exact fixture and narrow learning question.','evidenceRefs',jsonb_build_array(ref)));
  end loop;
  for comparison in select value from jsonb_array_elements(prepared->'productScope'->'intent'->'comparisonUniverse'->'markets') loop
    markets:=markets||jsonb_build_array(comparison||jsonb_build_object('assessment','Synthetic geography comparison explains relative limits without claiming verified conversion or demand.','evidenceRefs',jsonb_build_array(ref),
      'assumptions','["Synthetic comparison assumption is explicit"]'::jsonb,'limitations','["No real provider or market conclusion is represented"]'::jsonb,'sellerBankCountry',null,
      'feeScenarios',jsonb_build_array(jsonb_build_object('sellerBankCountry','US','hypothetical',true,'explanation','The seller bank country is unknown; this is a hypothetical fee scenario only.','evidenceRefs',jsonb_build_array(ref)))));
  end loop;
  strategy:=jsonb_build_object('version','pod-discovery-2.0','intentId',root,'dossierHash',private.stage14_hash(dossier),
    'execution',jsonb_build_object('modelId','openai/gpt-5.6-luna','providerRequestId','local-terminal-strategy','primaryOnly',true),'marketComparisons',markets,
    'candidates',jsonb_build_array(jsonb_build_object('candidateId',identity->>'id','identityHash',private.stage14_hash(identity),'dimensions',dimensions)),
    'recommendation',jsonb_build_object('proposedOutcome','TEST','marketCountryCode','US','candidateId',identity->>'id','rationale','The synthetic learning question is narrowly scoped and compares both declared geographies without live authority.','alternatives','[]'::jsonb),
    'testPlan',jsonb_build_object('scope','private_original_design_test','name','Synthetic bounded learning test','hypothesis','A narrow original-design question can be answered by a later explicitly approved private experiment.',
      'deliverable','A proposed private original-design draft for a specific learning question.','successCriteria','["Answer the named synthetic learning question"]'::jsonb,'failureCriteria','["Stop if the named learning criterion remains unclear"]'::jsonb,
      'stopRule','Stop at the proposed deliverable and require separate owner, budget, IP and print prerequisites before any execution.','maximumMicrousd',550000,'maximumGenerations',1,'evidenceRefs',jsonb_build_array(ref),
      'budgetStatus','proposal_only','generationAuthorized',false,'spendingAuthorized',false,'publicationAllowed',false,'commerceAllowed',false),'missingQuestions','[]'::jsonb,'publicationAllowed',false,'commerceAllowed',false);
  perform pg_temp.v2_terminal_settle(root,'strategy:1','local-terminal-strategy'); receipt:=pg_temp.v2_terminal_receipt(root,'strategy',prepared,strategy);
  perform public.installed_pack_runtime_transition(run,b,repeat('terminal-capability-',3),'persist',jsonb_build_object('stageKey','strategy','output',strategy,'receipt',receipt));
  prepared:=public.installed_pack_runtime_transition(run,b,repeat('terminal-capability-',3),'prepare','{"stageKey":"review"}');
  foreach check_key in array array['source_support','alternative_comparison','test_learnability','uncertainty_handling','hard_gates'] loop
    checks:=checks||jsonb_build_array(jsonb_build_object('check',check_key,'outcome','PASS','rationale','Synthetic independent review addresses this exact check and does not authorize execution or commerce.'));
  end loop;
  review:=jsonb_build_object('version','pod-discovery-2.0','intentId',root,'dossierHash',private.stage14_hash(dossier),'assessmentHash',private.stage14_hash(strategy),
    'execution',jsonb_build_object('modelId','anthropic/claude-haiku-4.5','providerRequestId','local-terminal-review','primaryOnly',true),'marketCountryCode','US','candidateId',identity->>'id','outcome','TEST',
    'sufficiencyRationale','This synthetic review explains why the exact bounded learning purpose is supported within explicit fixture limitations and never grants execution authority.',
    'dimensions',reviewed,'checks',checks,'executionPrerequisites','{"ownerCreativeApproval":"required","freshBudgetApproval":"required","conceptSpecificIpScreen":"required","printValidation":"required"}'::jsonb,
    'additionalUncertainties','[]'::jsonb,'missingQuestions','[]'::jsonb,'publicationAllowed',false,'commerceAllowed',false);
  perform pg_temp.v2_terminal_settle(root,'review:1','local-terminal-review'); receipt:=pg_temp.v2_terminal_receipt(root,'review',prepared,review);
  perform public.installed_pack_runtime_transition(run,b,repeat('terminal-capability-',3),'persist',jsonb_build_object('stageKey','review','output',review,'receipt',receipt));
  result:=private.stage13v2_validate_persisted(root,true);
  assert result->'decisionValidated'='true' and result->'productionEligible'='false' and result->'generationAuthorized'='false','Even fully validated TEST remains a non-authorizing recommendation';
  assert result->'committedMicrousd'='500','Terminal validator accounts for all five settled attempts';
  result:=public.installed_pack_runtime_transition(run,b,repeat('terminal-capability-',3),'output','{}');
  assert result->'productScope'->>'rootId'=root::text,'Output selects completion mode from the authoritative root';
  -- Administrator-only rollback subtransactions corrupt all dependent output
  -- copies together, proving the qualitative validator catches semantic errors
  -- beyond an output hash mismatch. Production owners cannot perform these writes.
  foreach malformed in array array[
    jsonb_set(review,'{dimensions,0,verdict}','"nonblocking_unknown"'),
    jsonb_set(review,'{dimensions,0,evidenceRefs}',jsonb_build_array('{}'::jsonb)),
    jsonb_set(review,'{executionPrerequisites,printValidation}','"satisfied"'),
    jsonb_set(review,'{marketCountryCode}','"AU"'),
    jsonb_set(review,'{missingQuestions}','["An unclassified missing question cannot be silently added"]'),
    jsonb_set(jsonb_set(review,'{additionalUncertainties}','[{"dimension":"demand","question":"Does this concern block the exact proposed experiment?","blockingForTest":true,"reason":"This additional concern blocks the exact proposed learning purpose until it is answered."}]'),'{missingQuestions}','["Does this concern block the exact proposed experiment?"]')
  ] loop
    denied:=false;
    begin
      receipt:=pg_temp.v2_terminal_receipt(root,'review',prepared,malformed);
      update public.artifacts set content=malformed,metadata=jsonb_build_object('stageKey','review','receipt',receipt) where id=private.stage4_deterministic_uuid('pack:output:'||run||':review');
      update public.workflow_stage_runs set output=malformed where workflow_run_id=run and stage_key='review';
      update public.worker_runs set output=malformed,execution_metadata=execution_metadata||jsonb_build_object('receipt',receipt) where id=private.stage4_deterministic_uuid('pack:worker:'||run||':review');
      perform private.stage13v2_validate_persisted(root,true);
    exception when others then denied:=true;
    end;
    assert denied,'Reviewer cannot waive unknowns, alter geography, forge evidence or satisfy future execution prerequisites';
  end loop;
  result:=public.installed_pack_runtime_transition(run,b,repeat('terminal-capability-',3),'complete','{}');
  decision:=(result->>'decisionId')::uuid; child:=(result->'childExperimentIds'->>0)::uuid;
  assert (select assessment=review from public.product_decisions where id=decision),'Reviewer decision is persisted unchanged, without v1 scoring fields';
  assert (select measurement_plan->'testPlan'=strategy->'testPlan' and variables->'recommendedMarketCountryCode'='"US"' from public.product_experiments where id=child),'Selected geography is bound only in the terminal child';
  assert (select measurement_plan->'testPlan'='null'::jsonb from public.product_experiments where id=root),'Root plan was never rewritten';
  count_children:=(select count(*) from public.product_experiments where parent_discovery_id=root);
  perform public.installed_pack_runtime_transition(run,b,repeat('terminal-capability-',3),'complete','{}');
  assert (select count(*) from public.product_experiments where parent_discovery_id=root)=count_children and (select count(*) from public.product_decisions where experiment_id=child)=1,'Complete replay is append-only and idempotent';
  -- A TEST recommendation alone has not created a creative approval or run.
  assert not exists(select 1 from public.creative_approvals where candidate_id=(identity->>'id')::uuid),'Independent recommendation has no implicit generation/spending authority';
  creative_input:=pg_temp.creative_approval((identity->>'id')::uuid)||jsonb_build_object('purpose','candidate_production','decisionId',decision,'candidateAssessment',review,'maximumGenerations',1,'maximumMicrousd',700000);
  perform private.stage14_assert_approval((identity->>'id')::uuid,creative_input);
  denied:=false; begin perform private.stage14_assert_approval((identity->>'id')::uuid,jsonb_set(creative_input,'{maximumGenerations}','2')); exception when others then denied:=true; end;
  assert denied,'The separate owner approval cannot exceed the independently reviewed image-count limit';
  denied:=false; begin perform private.stage14_assert_approval((identity->>'id')::uuid,jsonb_set(creative_input,'{rightsConfirmed}','false')); exception when others then denied:=true; end;
  assert denied,'V2 recommendation does not waive explicit owner rights approval';
  denied:=false; begin perform private.stage14_assert_approval((identity->>'id')::uuid,jsonb_set(creative_input,'{policyScreen,0,status}','"unknown"')); exception when others then denied:=true; end;
  assert denied,'V2 recommendation does not waive concept-specific IP screening';
  denied:=false; begin perform private.stage14_assert_approval((identity->>'id')::uuid,jsonb_set(creative_input,'{printSpecification,verifiedAt}',to_jsonb((now()-interval '31 days')::text))); exception when others then denied:=true; end;
  assert denied,'V2 recommendation does not waive fresh exact print requirements';
  creative_approval:=public.approve_creative_candidate((identity->>'id')::uuid,creative_input,pg_temp.flux_quote());
  assert creative_approval->'snapshot'->'candidateAssessment'=review and not(creative_approval->'snapshot'->'candidateAssessment' ? 'totalScore'),'Typed independent review is bound without fabricated legacy scores';
  assert creative_approval->'snapshot'->'maximumMicrousd'='700000' and strategy->'testPlan'->'maximumMicrousd'='550000','Proposed test budget grants nothing; the explicit fresh creative approval owns its separately approved cap';
  creative_launch:=public.begin_creative_run((creative_approval->>'approvalId')::uuid,gen_random_uuid(),creative_cap);
  creative_run:=(creative_launch->>'creativeRunId')::uuid;
  perform public.creative_runtime_transition(creative_run,b,creative_cap,'load',jsonb_build_object('runtimeRunId','local-v2-creative-'||creative_run));
  perform pg_temp.creative_phase(creative_run,b,creative_cap,'brief:1');
  perform pg_temp.creative_phase(creative_run,b,creative_cap,'screen:1');
  perform public.creative_runtime_transition(creative_run,b,creative_cap,'reserve_call',pg_temp.flux_payload(creative_run));
  creative_output:=pg_temp.creative_output(creative_run,'generate:1')||'{"model":"black-forest-labs/flux.2-klein-4b"}'::jsonb;
  insert into storage.objects(bucket_id,name,metadata) values('creative-assets',creative_output->>'storagePath','{"mimetype":"image/png","size":2048}');
  perform pg_temp.flux_record(creative_run,b,creative_cap,creative_output);
  perform public.creative_runtime_transition(creative_run,b,creative_cap,'persist_phase',jsonb_build_object('callKey','generate:1','output',creative_output));
  perform pg_temp.creative_reserve(creative_run,b,creative_cap,'review:1');
  final_output:=pg_temp.creative_output(creative_run,'review:1');
  perform pg_temp.creative_record(creative_run,b,creative_cap,'review:1');
  saved_cost:=private.stage14_committed_cost(creative_run);
  select jsonb_agg(to_jsonb(a) order by a.version) into saved_assets from public.creative_assets a where a.creative_run_id=creative_run;
  -- A temporary administrator fixture adds a later selected-candidate decision
  -- while the visual review is in flight. Rolling this subtransaction back lets
  -- the same saved final receipt also exercise the unchanged positive path.
  blocked:=false;
  begin
    newer_decision:=gen_random_uuid();
    insert into public.product_decisions(id,business_id,candidate_id,experiment_id,assessment,assessment_fingerprint)
      values(newer_decision,b,(identity->>'id')::uuid,child,review||'{"outcome":"NEEDS_MORE_EVIDENCE"}',private.stage14_hash(review||'{"outcome":"NEEDS_MORE_EVIDENCE"}'));
    result:=public.creative_runtime_transition(creative_run,b,creative_cap,'persist_phase',jsonb_build_object('callKey','review:1','output',final_output));
    assert result->>'status'='needs_owner' and result->'productionReady'='false','Terminal v2 eligibility recheck stops when a newer decision appears';
    assert private.stage14_committed_cost(creative_run)=saved_cost,'Changed eligibility never erases already incurred charges';
    assert (select jsonb_agg(to_jsonb(a) order by a.version) from public.creative_assets a where a.creative_run_id=creative_run)=saved_assets,'Changed eligibility preserves generated source assets';
    raise exception 'rollback_successful_terminal_invalidation_fixture' using errcode='ZX021';
  exception when sqlstate 'ZX021' then blocked:=true;
  end;
  assert blocked,'The invalidation fixture exercised the existing terminal helper path';
  result:=public.creative_runtime_transition(creative_run,b,creative_cap,'persist_phase',jsonb_build_object('callKey','review:1','output',final_output));
  assert result->>'status'='completed' and result->'productionReady'='true','Fresh independently reviewed v2 TEST can complete the explicitly approved native-PNG creative pipeline';
  assert (select count(*) from public.creative_cost_reservations where creative_run_id=creative_run)=4,'Reviewed one-image bound retains the exact four creative calls';
  assert not exists(select 1 from public.workflow_stage_runs s where s.workflow_run_id=(creative_launch->>'workflowRunId')::uuid and s.stage_key in ('generate:2','review:2')),'V2 test image bound does not acquire a repair phase';

end; $$;
rollback;
