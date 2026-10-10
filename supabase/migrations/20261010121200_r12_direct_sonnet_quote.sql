-- Explicit new direct-only reviewer quote. Existing envelopes, quote versions,
-- adaptive catalog validators and legacy receipt routes remain unchanged.
begin;

create function private.r12_direct_inference_quote_check(q jsonb,reviewed jsonb default null) returns void language plpgsql set search_path='' as $$
declare route_name text;rate_name text;source_name text;phase text;r jsonb;identity jsonb;rates jsonb;v bigint;begin
 perform private.r04_safe(q);
 perform private.r04_keys(q,array['version','baseQuoteHash','luna','reviewer','ceilings','requestBytes','outputTokens','retention','proposalOnly','dispatchAuthorized','quoteHash','verifiedAt','validUntil']);
 if q->>'version' is distinct from 'r12.direct-inference-quote.1'
 or (reviewed is not null and reviewed->>'version' is distinct from 'r12.direct-inference-quote.1')
 or q->'proposalOnly' is distinct from 'true'::jsonb or q->'dispatchAuthorized' is distinct from 'false'::jsonb
 or q->>'quoteHash' is distinct from private.stage14_hash(q-array['quoteHash','verifiedAt','validUntil'])
 or q->>'baseQuoteHash' is distinct from private.stage14_hash(jsonb_build_object('version','r12.direct-inference-catalog.1','luna',q->'luna','reviewer',q->'reviewer'))
 or jsonb_typeof(q->'verifiedAt') is distinct from 'string' or jsonb_typeof(q->'validUntil') is distinct from 'string'
 or coalesce(q->>'verifiedAt','')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$' or coalesce(q->>'validUntil','')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$'
 or not isfinite((q->>'verifiedAt')::timestamptz) or not isfinite((q->>'validUntil')::timestamptz)
 or (q->>'verifiedAt')::timestamptz>clock_timestamp() or (q->>'validUntil')::timestamptz<=clock_timestamp()
 or (q->>'validUntil')::timestamptz-(q->>'verifiedAt')::timestamptz<>interval '5 minutes'
 or q->'requestBytes' is distinct from '{"plan":32768,"strategy":65536,"review":65536}'::jsonb
 or q->'outputTokens' is distinct from '{"plan":1500,"strategy":5000,"review":4000}'::jsonb
 or q->'retention' is distinct from '{"inference":"no_training_zdr","sourceAcquisition":"separately_quoted_browser","schemas":"static_nonprivate_schema_only"}'::jsonb
 then raise exception 'r12_direct_inference_quote_unqualified';end if;
 foreach route_name in array array['luna','reviewer'] loop
  r:=q->route_name;rates:=r->'tokenPricesUsd';
  identity:=case when route_name='luna' then '{"modelId":"openai/gpt-5.6-luna","canonicalModelId":"openai/gpt-5.6-luna-20260709"}'::jsonb else '{"modelId":"anthropic/claude-sonnet-4.6","canonicalModelId":"anthropic/claude-4.6-sonnet-20260217"}'::jsonb end;
  perform private.r04_keys(r,array['modelId','canonicalModelId','endpoint','providerName','acceptedResponseModelIds','tokenPricesUsd','priceLimit','sourceHashes']);
  perform private.r04_keys(rates,array['prompt','completion','cacheRead','cacheWrite','reasoning']);
  perform private.r04_keys(r->'priceLimit',array['prompt','completion','request']);
  perform private.r04_keys(r->'sourceHashes',array['identity','alias','canonical','zdr']);
  if r->>'modelId' is distinct from identity->>'modelId' or r->>'canonicalModelId' is distinct from identity->>'canonicalModelId'
  or r->'acceptedResponseModelIds' is distinct from jsonb_build_array(identity->>'modelId',identity->>'canonicalModelId')
  or r->>'endpoint' is distinct from (case when route_name='luna' then 'azure/us' else 'amazon-bedrock/us' end)
  or r->>'providerName' is distinct from (case when route_name='luna' then 'Azure' else 'Amazon Bedrock' end)
  or r->'sourceHashes'->>'identity' is distinct from private.stage14_hash(identity)
  or r->'sourceHashes'->>'alias' is distinct from r->'sourceHashes'->>'canonical'
  or r->'sourceHashes'->>'alias' is distinct from r->'sourceHashes'->>'zdr'
  then raise exception 'r12_direct_inference_route_unqualified';end if;
  foreach source_name in array array['identity','alias','canonical','zdr'] loop
   if jsonb_typeof(r->'sourceHashes'->source_name) is distinct from 'string' or coalesce(r->'sourceHashes'->>source_name,'')!~'^[a-f0-9]{64}$' then raise exception 'r12_direct_inference_source_unqualified';end if;
  end loop;
  foreach rate_name in array array['prompt','completion','cacheRead','cacheWrite','reasoning'] loop
   if jsonb_typeof(rates->rate_name) is distinct from 'string' or coalesce(rates->>rate_name,'')!~'^(0|1|0\.[0-9]{0,17}[1-9])$'
   then raise exception 'r12_direct_inference_price_invalid';end if;
  end loop;
  if (rates->>'prompt')::numeric<=0 or (rates->>'completion')::numeric<=0
  or r->'priceLimit' is distinct from jsonb_build_object('prompt',ceil((rates->>'prompt')::numeric*1000000000000)/1000000,'completion',ceil(greatest((rates->>'completion')::numeric,(rates->>'reasoning')::numeric)*1000000000000)/1000000,'request',0)
  then raise exception 'r12_direct_inference_price_limit_invalid';end if;
  if reviewed is not null and ((r->'priceLimit'->>'prompt')::numeric>(reviewed->route_name->'priceLimit'->>'prompt')::numeric or (r->'priceLimit'->>'completion')::numeric>(reviewed->route_name->'priceLimit'->>'completion')::numeric) then raise exception 'r12_direct_inference_price_limit_expanded';end if;
  if reviewed is not null and r-array['sourceHashes','tokenPricesUsd','priceLimit'] is distinct from (reviewed->route_name)-array['sourceHashes','tokenPricesUsd','priceLimit'] then raise exception 'r12_direct_inference_route_changed';end if;
 end loop;
 perform private.r04_keys(q->'ceilings',array['plan','strategy','review']);
 foreach phase in array array['plan','strategy','review'] loop
  rates:=q->case when phase='review' then 'reviewer' else 'luna' end->'tokenPricesUsd';
  v:=ceil(1000000*((((q->'requestBytes'->>phase)::integer+8192)*(greatest((rates->>'prompt')::numeric,(rates->>'cacheRead')::numeric)+(rates->>'cacheWrite')::numeric))+((q->'outputTokens'->>phase)::integer*greatest((rates->>'completion')::numeric,(rates->>'reasoning')::numeric))))::bigint;
  if v not between 1 and 2000000 or q->'ceilings'->phase is distinct from to_jsonb(v)
  or (reviewed is not null and v>(reviewed->'ceilings'->>phase)::bigint) then raise exception 'r12_direct_inference_ceiling_invalid';end if;
 end loop;
end $$;

-- A new model route is chosen only by the authentic reviewed enrollment
-- mapping. Worker labels, quote hashes supplied by clients, and legacy grants
-- cannot opt an existing envelope into the new inference contract.
create function private.r12_direct_sonnet_package(e private.r12_direct_test_envelopes) returns text language plpgsql set search_path='' as $$
declare c private.r12_direct_test_confirmations;m private.r12_direct_enrollment_grants;p private.r12_direct_enrollment_packages;begin
 select * into c from private.r12_direct_test_confirmations where envelope_id=e.id;
 select * into m from private.r12_direct_enrollment_grants where grant_id=c.grant_id;
 if m.grant_id is null then return null;end if;
 perform private.r12_direct_enrollment_grant_ancestor(m.grant_id);
 select * into strict p from private.r12_direct_enrollment_packages where package_hash=m.package_hash;
 if p.business_id is distinct from e.business_id or p.goal_id is distinct from e.goal_id or p.owner_id is distinct from e.owner_id
 or p.grant_id is distinct from c.grant_id or c.grant_id::text is distinct from e.content->>'grantId'
 or p.content->'grantReview'->'researchPins' is distinct from e.content->'researchPins'
 or p.review_evidence->'model'->>'inferenceCatalogHash' is distinct from e.content->'researchPins'->>'inferenceCatalogHash'
 or p.review_evidence->'model'->'inferenceContract' is distinct from '{"version":"r12.direct-inference-contract.1","publicQuoteVersion":"r12.public-research-quote.3","inferenceQuoteVersion":"r12.direct-inference-quote.1","catalogVersion":"r12.direct-inference-catalog.1","luna":{"modelId":"openai/gpt-5.6-luna","canonicalModelId":"openai/gpt-5.6-luna-20260709","endpoint":"azure/us","providerName":"Azure"},"reviewer":{"modelId":"anthropic/claude-sonnet-4.6","canonicalModelId":"anthropic/claude-4.6-sonnet-20260217","endpoint":"amazon-bedrock/us","providerName":"Amazon Bedrock"}}'::jsonb
 then raise exception 'r12_direct_enrolled_inference_contract_required';end if;
 return p.package_hash;
end $$;

-- OIDs of existing direct entrypoints survive. The older implementations are
-- retained as inaccessible exact delegates; no old validator is expanded.
do $quote3$ declare d text;old text;begin
 d:=pg_get_functiondef('private.r12_direct_research_quote(private.r12_direct_test_envelopes,jsonb,jsonb)'::regprocedure);
 execute replace(d,'FUNCTION private.r12_direct_research_quote(','FUNCTION private.r12_direct_research_quote_before_sonnet(');
 d:=replace(d,'FUNCTION private.r12_direct_research_quote(','FUNCTION private.r12_direct_research_quote_sonnet(');
 old:=$x$perform private.r12_adaptive_quote_check_etsy(q->'inference',approved->'inference');$x$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_sonnet_research_checker_changed';end if;
 d:=replace(d,old,$x$perform private.r12_direct_inference_quote_check(q->'inference',approved->'inference');$x$);
 d:=replace(d,$x$q->>'version'='r12.public-research-quote.2'$x$,$x$q->>'version'='r12.public-research-quote.3'$x$);
 old:=$x$q->>'version' not in ('r12.public-research-quote.1','r12.public-research-quote.2')$x$;
 if position(old in d)=0 then raise exception 'r12_sonnet_research_version_guard_changed';end if;
 d:=replace(d,old,$x$q->>'version' is distinct from 'r12.public-research-quote.3'$x$);execute d;
 d:=pg_get_functiondef('private.r12_direct_observe_quote(uuid,jsonb)'::regprocedure);
 execute replace(d,'FUNCTION private.r12_direct_observe_quote(','FUNCTION private.r12_direct_observe_quote_before_sonnet(');
 d:=replace(d,'FUNCTION private.r12_direct_observe_quote(','FUNCTION private.r12_direct_observe_quote_sonnet(');
 old:=$x$perform private.r12_adaptive_quote_check_etsy(inference,s.quote->'inference');$x$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_sonnet_observation_checker_changed';end if;
 d:=replace(d,old,$x$perform private.r12_direct_inference_quote_check(inference,s.quote->'inference');$x$);
 d:=replace(d,$x$s.quote->>'version'='r12.public-research-quote.2'$x$,$x$s.quote->>'version'='r12.public-research-quote.3'$x$);execute d;
end $quote3$;
create or replace function private.r12_direct_research_quote(e private.r12_direct_test_envelopes,q jsonb,approved jsonb default null) returns void language plpgsql set search_path='' as $$
declare package_hash text;begin
 package_hash:=private.r12_direct_sonnet_package(e);
 if package_hash is not null and q->>'version' is distinct from 'r12.public-research-quote.3' then raise exception 'r12_direct_enrolled_sonnet_quote_required';end if;
 if package_hash is null and q->>'version'='r12.public-research-quote.3' then raise exception 'r12_direct_sonnet_enrollment_required';end if;
 if q->>'version'='r12.public-research-quote.3' or approved->>'version'='r12.public-research-quote.3' then
  if q->>'version' is distinct from 'r12.public-research-quote.3' or (approved is not null and approved->>'version' is distinct from 'r12.public-research-quote.3') then raise exception 'r12_direct_quote_version_change_requires_fresh_envelope';end if;
  perform private.r12_direct_research_quote_sonnet(e,q,approved);return;
 end if;
 perform private.r12_direct_research_quote_before_sonnet(e,q,approved);
end $$;
create or replace function private.r12_direct_observe_quote(p_scope uuid,payload jsonb) returns jsonb language plpgsql set search_path='' as $$
begin
 if exists(select 1 from private.r12_direct_research_setups where scope_id=p_scope and quote->>'version'='r12.public-research-quote.3') then return private.r12_direct_observe_quote_sonnet(p_scope,payload);end if;
 return private.r12_direct_observe_quote_before_sonnet(p_scope,payload);
end $$;
create or replace function private.r12_direct_model_request_bytes(q jsonb) returns jsonb language sql immutable set search_path='' as $$
 select case when q->>'version' in ('r12.public-research-quote.2','r12.public-research-quote.3') then q->'modelRequestBytes' else q->'inference'->'requestBytes' end
$$;

-- The owner server consumes this explicit authenticated discriminator before
-- fetching catalogs. Old grants keep the exact prior five-key context.
do $owner_context$ declare d text;begin
 d:=pg_get_functiondef('private.r12_direct_owner_quote_context(uuid,jsonb,text)'::regprocedure);
 execute replace(d,'FUNCTION private.r12_direct_owner_quote_context(','FUNCTION private.r12_direct_owner_quote_context_before_sonnet(');
end $owner_context$;
create or replace function private.r12_direct_owner_quote_context(b uuid,payload jsonb,server_key text) returns jsonb language plpgsql set search_path='' as $$
declare base jsonb;e private.r12_direct_test_envelopes;package_hash text;body jsonb;begin
 base:=private.r12_direct_owner_quote_context_before_sonnet(b,payload,server_key);
 select * into strict e from private.r12_direct_test_envelopes where id=(payload->>'testEnvelopeId')::uuid and business_id=b and content_hash=payload->>'testEnvelopeHash';
 package_hash:=private.r12_direct_sonnet_package(e);if package_hash is null then return base;end if;
 body:=base||jsonb_build_object('version','r12.direct-owner-research-quote-context.2','businessId',e.business_id,'goalId',e.goal_id,'grantId',e.content->>'grantId','testEnvelopeId',e.id,'testEnvelopeHash',e.content_hash,'reviewedPackageHash',package_hash,'inferenceQuoteVersion','r12.direct-inference-quote.1');
 return body||jsonb_build_object('contextHash',private.stage14_hash(body));
end $$;

-- Only an actual immutable direct attempt with quote.3 may qualify the new
-- reviewer identity. Receipt recovery keeps the original admitted quote; it
-- must not require today's catalog freshness after the provider has billed.
create function private.r12_direct_model_proof_validate(a private.r12_direct_phase_attempts,c private.r12_discovery_candidates,v jsonb) returns void language plpgsql set search_path='' as $$
declare models jsonb;x jsonb;begin
 if a.quote->>'version' is distinct from 'r12.public-research-quote.3' or a.phase<>'review' then perform private.r12_discovery_proof_validate(c,v);return;end if;
 models:='["anthropic/claude-sonnet-4.6","anthropic/claude-4.6-sonnet-20260217"]'::jsonb;
 if a.attempt_id is null or c.candidate->>'attemptId' is distinct from a.attempt_id::text or c.candidate->>'phase' is distinct from 'review'
 or a.quote->'inference'->>'version' is distinct from 'r12.direct-inference-quote.1'
 or a.quote->'inference'->'reviewer'->'acceptedResponseModelIds' is distinct from models
 or a.quote->'inference'->'reviewer'->>'modelId' is distinct from 'anthropic/claude-sonnet-4.6'
 or a.quote->'inference'->'reviewer'->>'canonicalModelId' is distinct from 'anthropic/claude-4.6-sonnet-20260217'
 or a.quote->'inference'->'reviewer'->>'endpoint' is distinct from 'amazon-bedrock/us'
 or a.quote->'inference'->'reviewer'->>'providerName' is distinct from 'Amazon Bedrock'
 then raise exception 'r12_direct_sonnet_attempt_required';end if;
 perform private.r04_keys(v,array['generationId','providerName','modelId','requestedEndpoint','providerResponses','proofHash']);
 if v->>'generationId' is distinct from c.candidate->>'providerRequestId' or v->>'providerName' is distinct from 'Amazon Bedrock'
 or v->>'requestedEndpoint' is distinct from 'amazon-bedrock/us' or not coalesce(models ? (v->>'modelId'),false)
 or v->>'proofHash' is distinct from private.stage14_hash(v-'proofHash') or jsonb_typeof(v->'providerResponses') is distinct from 'array' or jsonb_array_length(v->'providerResponses')>64 then raise exception 'r12_receipt_proof_invalid';end if;
 for x in select value from jsonb_array_elements(v->'providerResponses') loop
  perform private.r04_keys(x,array['providerName','modelId','status']);
  if x->>'providerName' is distinct from 'Amazon Bedrock' or not coalesce(models ? (x->>'modelId'),false) or x->'status' is distinct from '200'::jsonb then raise exception 'r12_receipt_proof_invalid';end if;
 end loop;
end $$;
do $receipt3$ declare sig text;d text;old text:='perform private.r12_discovery_proof_validate(candidate_row,proof);';begin
 foreach sig in array array['private.r12_direct_model_receipt_v1(uuid,jsonb)','private.r12_direct_repair_model_receipt(uuid,jsonb)'] loop
  d:=pg_get_functiondef(sig::regprocedure);
  if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_sonnet_receipt_implementation_changed';end if;
  execute replace(d,old,'perform private.r12_direct_model_proof_validate(a,candidate_row,proof);');
 end loop;
end $receipt3$;
revoke all on function private.r12_direct_sonnet_package(private.r12_direct_test_envelopes),private.r12_direct_owner_quote_context_before_sonnet(uuid,jsonb,text),private.r12_direct_inference_quote_check(jsonb,jsonb),private.r12_direct_research_quote_before_sonnet(private.r12_direct_test_envelopes,jsonb,jsonb),private.r12_direct_research_quote_sonnet(private.r12_direct_test_envelopes,jsonb,jsonb),private.r12_direct_observe_quote_before_sonnet(uuid,jsonb),private.r12_direct_observe_quote_sonnet(uuid,jsonb),private.r12_direct_model_proof_validate(private.r12_direct_phase_attempts,private.r12_discovery_candidates,jsonb) from public,anon,authenticated,service_role;
commit;
