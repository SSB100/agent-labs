-- R11 definitions-only extension: fixed V2 authority of at most 30 minutes,
-- independently fresh at-most-five-minute quotes bound to each paid phase.
-- Legacy policies, immutable history and every R05 function/ACL remain intact.
begin;
alter table private.r11_research_bindings add column quote_valid_until timestamptz
 check(quote_valid_until is null or isfinite(quote_valid_until));

create or replace function private.r11_research_policy_validate() returns trigger language plpgsql set search_path='' as $$
declare p jsonb:=new.policy; d jsonb; x jsonb; k text;begin
 perform private.r04_keys(p,array['version','id','businessId','ownerId','workflowRunId','goalId','operatingPolicyId','query','allowedDomains','excludedDomains','sourceReviews','queryReviewHash','termsReviewHash','independentReviewHash','approvalHash','modelId','providerEndpoint','recipients','retention','validFrom','validUntil','maximumMicrousd','searchMicrousd','selectorMicrousd','priceLimit','quoteHash','quoteValidUntil']);
 if coalesce(p->>'version','') not in ('r11.public-research.1','r11.public-research.2') or p->>'id' is distinct from new.id::text or p->>'businessId' is distinct from new.business_id::text or p->>'ownerId' is distinct from new.owner_id::text or p->>'workflowRunId' is distinct from new.workflow_run_id::text or p->>'goalId' is distinct from new.goal_id::text or p->>'operatingPolicyId' is distinct from new.operating_policy_id::text then raise exception 'r11_research_policy_binding';end if;
 foreach k in array array['query','modelId','providerEndpoint','validFrom','validUntil','quoteValidUntil','queryReviewHash','termsReviewHash','independentReviewHash','approvalHash','quoteHash'] loop
 if jsonb_typeof(p->k) is distinct from 'string' then raise exception 'r11_research_policy_type';end if;end loop;
 if length(btrim(p->>'query')) not between 5 and 800 or p->>'modelId' !~ '^[a-z0-9-]+/[a-z0-9][a-z0-9._-]{1,100}$' or p->>'providerEndpoint' !~ '^[a-z0-9][a-z0-9-]{1,59}(/[a-z0-9][a-z0-9-]{0,59})?$' then raise exception 'r11_research_policy_scope';end if;
 foreach k in array array['queryReviewHash','termsReviewHash','independentReviewHash','approvalHash','quoteHash'] loop if p->>k !~ '^[a-f0-9]{64}$' then raise exception 'r11_research_review_required';end if;end loop;
 if p->>'queryReviewHash' is distinct from encode(extensions.digest(convert_to('{"classification":"generic_nonpersonal_public_research","query":'||to_jsonb(p->>'query')::text||'}','UTF8'),'sha256'),'hex') then raise exception 'r11_research_query_review_mismatch';end if;
 foreach k in array array['allowedDomains','excludedDomains'] loop
 d:=p->k;if jsonb_typeof(d) is distinct from 'array' or jsonb_array_length(d) not between 1 and 32 then raise exception 'r11_research_domains';end if;
 if exists(select 1 from jsonb_array_elements(d) v where jsonb_typeof(v)<>'string' or length(v#>>'{}')>200 or v#>>'{}' !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' or v#>>'{}' ~ '\.(local|internal)$') or (select count(*) from jsonb_array_elements(d))<>(select count(distinct v) from jsonb_array_elements(d) v) then raise exception 'r11_research_domains';end if;
 end loop;
 if jsonb_array_length(p->'allowedDomains')>6 or not (p->'excludedDomains' @> '["etsy.com","etsy.me","etsystatic.com"]'::jsonb) or exists(select 1 from jsonb_array_elements_text(p->'allowedDomains') a cross join jsonb_array_elements_text(p->'excludedDomains') e where a=e or right(a,length(e)+1)='.'||e or right(e,length(a)+1)='.'||a) then raise exception 'r11_research_exclusions';end if;
 if jsonb_typeof(p->'sourceReviews') is distinct from 'array' or jsonb_array_length(p->'sourceReviews')<>jsonb_array_length(p->'allowedDomains') then raise exception 'r11_research_source_reviews';end if;
 for x in select value from jsonb_array_elements(p->'sourceReviews') loop
 perform private.r04_keys(x,array['domain','basis','reviewHash']);
 if not (p->'allowedDomains' ? (x->>'domain')) or x->>'basis' is distinct from 'documented_api_factual_snippets' or coalesce(x->>'reviewHash','') !~ '^[a-f0-9]{64}$' then raise exception 'r11_research_source_reviews';end if;end loop;
 if (select count(distinct value->>'domain') from jsonb_array_elements(p->'sourceReviews'))<>jsonb_array_length(p->'allowedDomains') then raise exception 'r11_research_source_reviews';end if;
 perform private.r04_keys(p->'recipients',array['router','search','inferenceEndpoint']);perform private.r04_keys(p->'retention',array['inference','search','application']);perform private.r04_keys(p->'priceLimit',array['prompt','completion','request']);
 if p->'recipients' is distinct from jsonb_build_object('router','openrouter.ai','search','exa.ai','inferenceEndpoint',p->>'providerEndpoint') or p->'retention' is distinct from '{"inference":"no_training_zdr","search":"query_retention_improvement_training_possible","application":"bounded_attributed_audit_evidence"}'::jsonb or p->'priceLimit'->'request' is distinct from '0'::jsonb then raise exception 'r11_research_privacy_scope';end if;
 foreach k in array array['prompt','completion'] loop if jsonb_typeof(p->'priceLimit'->k) is distinct from 'number' or (p->'priceLimit'->>k)::numeric<=0 or (p->'priceLimit'->>k)::numeric>1000000 then raise exception 'r11_research_price';end if;end loop;
 foreach k in array array['validFrom','validUntil','quoteValidUntil'] loop if p->>k !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' or not isfinite((p->>k)::timestamptz) then raise exception 'r11_research_policy_date';end if;end loop;
 foreach k in array array['maximumMicrousd','searchMicrousd','selectorMicrousd'] loop if jsonb_typeof(p->k) is distinct from 'number' or p->>k !~ '^[1-9][0-9]{0,5}$' or (p->>k)::bigint>250000 then raise exception 'r11_research_budget';end if;end loop;
 if (p->>'searchMicrousd')::bigint+(p->>'selectorMicrousd')::bigint>(p->>'maximumMicrousd')::bigint or (p->>'validUntil')::timestamptz<=(p->>'validFrom')::timestamptz or (p->>'validUntil')::timestamptz>(p->>'validFrom')::timestamptz+interval '31 days' or (p->>'validUntil')::timestamptz>(p->>'quoteValidUntil')::timestamptz then raise exception 'r11_research_budget_or_expiry';end if;
 -- V2 separates a finite reviewed price ceiling from fresh per-phase quotes.
 if p->>'version'='r11.public-research.2' and ((p->>'validUntil')::timestamptz>(p->>'validFrom')::timestamptz+interval '30 minutes' or p->>'quoteValidUntil' is distinct from p->>'validUntil') then raise exception 'r11_research_v2_authority_window';end if;
 return new;
end $$;

create or replace function private.r11_research_continuation_validate() returns trigger language plpgsql set search_path='' as $$
declare g jsonb:=new.grant_json;c jsonb:=g->'continuation';p jsonb:=g->'researchPolicy';f jsonb:=g->'operatingPolicy';x jsonb;o private.r05_operations;k text;pid uuid;amount bigint;window_limit interval;begin
 window_limit:=case p->>'version' when 'r11.public-research.1' then interval '5 minutes' when 'r11.public-research.2' then interval '30 minutes' else null end;
 if window_limit is null or (p->>'version'='r11.public-research.2' and p->>'quoteValidUntil' is distinct from p->>'validUntil') then raise exception 'r11_research_continuation_window';end if;
 perform private.r04_keys(g,array['version','id','businessId','ownerId','policyId','workflowRunId','runtimeCapabilityHash','serverKeyHash','installationId','installationSnapshotHash','workflowDefinitionId','continuation','businessContent','goalContent','operatingPolicy','researchPolicy','search','interpretationHash','approvalHash']);
 if g->>'version' is distinct from 'r11.owner-continuation-grant.1' or g->>'id' is distinct from new.id::text or g->>'businessId' is distinct from new.business_id::text or g->>'ownerId' is distinct from new.owner_id::text then raise exception 'r11_research_continuation_binding';end if;
 foreach k in array array['runtimeCapabilityHash','serverKeyHash','installationSnapshotHash','interpretationHash','approvalHash'] loop if coalesce(g->>k,'') !~ '^[a-f0-9]{64}$' then raise exception 'r11_research_continuation_hash';end if;end loop;
 foreach k in array array['policyId','workflowRunId','installationId','workflowDefinitionId'] loop if jsonb_typeof(g->k) is distinct from 'string' or (g->>k)::uuid is null then raise exception 'r11_research_continuation_id';end if;end loop;pid:=(g->>'policyId')::uuid;
 perform private.r04_keys(c,array['predecessorPolicyId','predecessorWorkflowRunId','goalId','goalRevision','businessRevision','currentOperatingPolicyId','capRevision','lifetimeCapMicrounits','exposureMicrounits','remainingMicrounits','eligible','reason']);
 if c->'eligible' is distinct from 'true'::jsonb or c->>'reason' is distinct from 'ready' or c is distinct from private.r11_research_continuation_context(new.business_id) then raise exception 'r11_research_stale_continuation';end if;
 if not exists(select 1 from public.installed_packs where id=(g->>'installationId')::uuid and business_id=new.business_id and status='active' and private.r04_hash(snapshot)=g->>'installationSnapshotHash') then raise exception 'r11_research_installation_snapshot';end if;
 perform private.r04_business_content(g->'businessContent');perform private.r04_quest_content(g->'goalContent');perform private.r04_parsed(g->'goalContent'->'parsed',true);
 if g->'goalContent'->'ambiguities' is distinct from '[]'::jsonb then raise exception 'r11_research_continuation_intent';end if;
 perform private.r04_keys(f,array['version','goalRevision','businessRevision','currency','businessLifetimeLimitMicrounits','policyLimitMicrounits','categoryLimits','expectedCapRevision','expectedExposureMicrounits','startsAt','expiresAt','maximumDispatches','minimumIntervalSeconds','stopOnTarget','operations','financialMode']);
 amount:=private.r05_money(f->'policyLimitMicrounits');
 if f->'goalRevision' is distinct from to_jsonb((c->>'goalRevision')::integer+2) or f->'businessRevision' is distinct from to_jsonb((c->>'businessRevision')::integer+1) or f->'expectedCapRevision' is distinct from c->'capRevision' or f->'expectedExposureMicrounits' is distinct from c->'exposureMicrounits' or f->'businessLifetimeLimitMicrounits' is distinct from c->'lifetimeCapMicrounits' or f->'maximumDispatches' is distinct from '2'::jsonb or f->'minimumIntervalSeconds' is distinct from '0'::jsonb or amount not between 1 and 250000 or amount>private.r05_money(c->'remainingMicrounits') or p->'maximumMicrousd' is distinct from to_jsonb(amount) then raise exception 'r11_research_continuation_financial_scope';end if;
 if p ?| array['id','businessId','ownerId','workflowRunId','goalId','operatingPolicyId'] or p->>'approvalHash' is distinct from g->>'approvalHash' or jsonb_typeof(p->'validFrom') is distinct from 'string' or jsonb_typeof(p->'validUntil') is distinct from 'string' or jsonb_typeof(p->'quoteValidUntil') is distinct from 'string' or not isfinite((p->>'validFrom')::timestamptz) or not isfinite((p->>'validUntil')::timestamptz) or not isfinite((p->>'quoteValidUntil')::timestamptz) or (p->>'validUntil')::timestamptz<=(p->>'validFrom')::timestamptz or (p->>'validUntil')::timestamptz>(p->>'validFrom')::timestamptz+window_limit or (p->>'quoteValidUntil')::timestamptz>(p->>'validFrom')::timestamptz+window_limit or f->>'startsAt' is distinct from p->>'validFrom' or f->>'expiresAt' is distinct from p->>'validUntil' then raise exception 'r11_research_continuation_window';end if;
 if not exists(select 1 from private.r05_server_keys where key_hash=g->>'serverKeyHash' and expires_at>(p->>'validUntil')::timestamptz and expires_at<=(p->>'validUntil')::timestamptz+interval '30 minutes') or exists(select 1 from private.r11_research_policies where authority_key_hash=g->>'serverKeyHash') then raise exception 'r11_research_continuation_fresh_key_required';end if;
 perform private.r04_keys(g->'search',array['requestHash','wireHash','wireBytes','maxTokens']);
 if jsonb_typeof(f->'operations') is distinct from 'array' or jsonb_array_length(f->'operations')<>2 then raise exception 'r11_research_continuation_operations';end if;
 for x in select value from jsonb_array_elements(f->'operations') loop
 select * into o from private.r05_operations where operation_key=x->>'operationKey';
 if o.operation_key is null or o.operation_key not in ('research.search.r11v2.'||pid,'research.model.r11v2.'||pid) or x->>'installationId' is distinct from g->>'installationId' or x->>'workflowDefinitionId' is distinct from g->>'workflowDefinitionId' or x->'accountId' is distinct from 'null'::jsonb or x->'accountRevision' is distinct from 'null'::jsonb or x->'sourceDomains' is distinct from p->'allowedDomains' or x->'dataClasses' is distinct from '["generic_public_query","public_evidence"]'::jsonb or o.provider_model_id is distinct from p->>'modelId' or o.quote_hash is distinct from p->>'quoteHash' or o.valid_from>(p->>'validFrom')::timestamptz or o.valid_until<(p->>'validUntil')::timestamptz or o.valid_until>o.valid_from+window_limit or o.liability_microunits<>(p->>case when o.operation_key='research.search.r11v2.'||pid then 'searchMicrousd' else 'selectorMicrousd' end)::bigint then raise exception 'r11_research_continuation_operation_scope';end if;
 end loop;
 if (select count(distinct value->>'operationKey') from jsonb_array_elements(f->'operations'))<>2 then raise exception 'r11_research_continuation_operations';end if;
 return new;
end $$;

create or replace function public.r11_research_server(p_business_id uuid,p_operation text,p_payload jsonb,p_server_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.r11_research_policies;c private.r11_research_collections;r private.r05_requests;v private.r11_research_bindings;key_hash text;result jsonb;a jsonb;phase_name text;k text;s jsonb;e jsonb;url text;host text;found_source boolean;quote_until timestamptz;begin
 if p_server_key is null or length(p_server_key) not between 32 and 200 then raise exception 'r11_research_authority_required' using errcode='42501';end if;
 if p_operation is null or p_operation not in ('load','guard','collect','complete') then raise exception 'r11_research_operation_unavailable';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>262144 then raise exception 'r11_research_payload_invalid';end if;
 perform 1 from public.businesses where id=p_business_id for update;if not found then raise exception 'r11_research_business_unavailable';end if;
 key_hash:=encode(extensions.digest(convert_to(p_server_key,'UTF8'),'sha256'),'hex');perform private.r11_research_key(key_hash);
 if p_operation='complete' then return private.r11_research_complete(p_business_id,p_payload,key_hash);end if;
 p:=private.r11_research_active(p_business_id,(p_payload->>'policyId')::uuid);
 if p.authority_key_hash is not null and p.authority_key_hash<>key_hash then raise exception 'r11_research_authority_required' using errcode='42501';end if;
 if p_operation='load' then
 perform private.r04_keys(p_payload,array['policyId']);select * into c from private.r11_research_collections where policy_id=p.id;
 if c.id is not null then c:=private.r11_research_collection_active(p,c.id);end if;
 perform private.r11_research_key(key_hash);perform private.r11_research_active(p_business_id,p.id);
 return jsonb_build_object('policy',p.policy,'policyHash',p.policy_hash,'search',jsonb_build_object('requestHash',p.search_request_hash,'wireHash',p.search_wire_hash,'wireBytes',p.search_wire_bytes,'maxTokens',p.search_max_tokens),'collection',case when c.id is null then null else jsonb_build_object('id',c.id,'collection',c.collection,'collectionHash',c.collection_hash,'lineage',c.lineage,'lineageHash',c.lineage_hash,'selector',jsonb_build_object('requestHash',c.selector_request_hash,'wireHash',c.selector_wire_hash,'wireBytes',c.selector_wire_bytes,'maxTokens',c.selector_max_tokens)) end);
 elsif p_operation='guard' then
 if p.policy->>'version'='r11.public-research.2' then
 perform private.r04_keys(p_payload,array['policyId','phase','collectionId','admission','quoteValidUntil']);
 if jsonb_typeof(p_payload->'quoteValidUntil') is distinct from 'string' or p_payload->>'quoteValidUntil' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then raise exception 'r11_research_fresh_quote_required';end if;
 quote_until:=(p_payload->>'quoteValidUntil')::timestamptz;
 if not isfinite(quote_until) or quote_until<=clock_timestamp() or quote_until>clock_timestamp()+interval '5 minutes' then raise exception 'r11_research_fresh_quote_required';end if;
 else perform private.r04_keys(p_payload,array['policyId','phase','collectionId','admission']);end if;
 a:=p_payload->'admission';phase_name:=p_payload->>'phase';
 if phase_name='search' and p_payload->'collectionId' is distinct from 'null'::jsonb then raise exception 'r11_research_phase_invalid';end if;
 if phase_name='select' then c:=private.r11_research_collection_active(p,(p_payload->>'collectionId')::uuid);end if;
 perform private.r11_research_descriptor(p,phase_name,c,a);
 result:=public.r05_admission_server(p_business_id,'prepare',a,p_server_key);
 if result->>'decision' is distinct from 'allowed' or result->>'requestId' is null then return result;end if;
 select * into r from private.r05_requests where id=(result->>'requestId')::uuid and business_id=p_business_id;
 if r.policy_id is distinct from p.operating_policy_id or r.workflow_run_id<>p.workflow_run_id or r.request_hash is distinct from private.r04_hash(a-'runtimeCapability') then raise exception 'r11_research_financial_policy_mismatch';end if;
 select * into v from private.r11_research_bindings where policy_id=p.id and phase=phase_name;
 -- Qualified one-search/one-selector slots cannot be renewed through another call key.
 if v.request_id is not null then
 if v.request_id<>r.id or v.collection_id is distinct from c.id or v.descriptor_hash<>r.request_hash or v.logical_request_hash is distinct from a->>'requestHash' or v.wire_hash is distinct from a->>'wireRequestHash' or v.admission_key_hash<>key_hash or (p.policy->>'version'='r11.public-research.2' and v.quote_valid_until is distinct from quote_until) then raise exception 'r11_research_phase_already_bound';end if;
 else insert into private.r11_research_bindings(request_id,business_id,policy_id,phase,collection_id,descriptor_hash,logical_request_hash,wire_hash,admission_key_hash,quote_valid_until) values(r.id,p_business_id,p.id,phase_name,c.id,r.request_hash,a->>'requestHash',a->>'wireRequestHash',key_hash,quote_until);end if;
 return public.r05_admission_server(p_business_id,'guard',a,p_server_key);
 else
 perform private.r04_keys(p_payload,array['policyId','searchRequestId','providerRequestId','collection','collectionCanonical','collectionHash','lineage','lineageCanonical','lineageHash','selectorRequestHash','selectorWireHash','selectorWireBytes','selectorMaxTokens']);
 foreach k in array array['policyId','searchRequestId','providerRequestId','collectionCanonical','collectionHash','lineageCanonical','lineageHash','selectorRequestHash','selectorWireHash'] loop if jsonb_typeof(p_payload->k) is distinct from 'string' then raise exception 'r11_research_collection_type';end if;end loop;
 foreach k in array array['selectorWireBytes','selectorMaxTokens'] loop if jsonb_typeof(p_payload->k) is distinct from 'number' or p_payload->>k !~ '^[1-9][0-9]{0,6}$' then raise exception 'r11_research_collection_type';end if;end loop;
 select * into r from private.r05_requests where id=(p_payload->>'searchRequestId')::uuid and business_id=p_business_id;
 if r.id is null or r.policy_id is distinct from p.operating_policy_id or r.workflow_run_id<>p.workflow_run_id or not exists(select 1 from private.r11_research_bindings z join private.r05_markers m on m.request_id=z.request_id where z.policy_id=p.id and z.phase='search' and z.request_id=r.id) or not exists(select 1 from private.r05_settlements z where z.request_id=r.id and z.provider_request_id=p_payload->>'providerRequestId' and z.actual_microunits is not null) or exists(select 1 from private.r05_settlements z where z.request_id=r.id and z.actual_microunits>(p.policy->>'searchMicrousd')::bigint) or not exists(select 1 from private.r05_receipt_claims q where q.provider='openrouter' and q.provider_request_id=p_payload->>'providerRequestId' and q.business_id=p_business_id and q.workflow_run_id=p.workflow_run_id and q.source_key=r.source_key) then raise exception 'r11_research_search_receipt_required';end if;
 a:=p_payload->'collection';perform private.r04_keys(a,array['collectionVersion','query','sources','evidence','providerMetadata']);
 if a->>'collectionVersion' is distinct from '1.0' or a->>'query' is distinct from p.policy->>'query' or jsonb_typeof(a->'sources') is distinct from 'array' or jsonb_array_length(a->'sources') not between 1 and 4 or jsonb_typeof(a->'evidence') is distinct from 'array' or jsonb_array_length(a->'evidence') not between 1 and 4 then raise exception 'r11_research_collection_invalid';end if;
 if a->'providerMetadata' is distinct from jsonb_build_object('providerRequestId',p_payload->>'providerRequestId','policyId',p.id,'policyHash',p.policy_hash,'searchRequestId',r.id,'searchRequests',1,'engine','exa','requestedInferenceEndpoint',p.policy->>'providerEndpoint') then raise exception 'r11_research_collection_metadata';end if;
 for s in select value from jsonb_array_elements(a->'sources') loop
 perform private.r04_keys(s,array['id','url','title','retrievedAt','publishedAt','retrievalExpiresAt','contentHash','excerpt','provider']);
 url:=s->>'url';host:=substring(url from '^https://([^/?#]+)');
 if jsonb_typeof(s->'url') is distinct from 'string' or host is null or host !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' or url ~ '#' or not private.r11_research_url_query_safe(url) or not exists(select 1 from jsonb_array_elements_text(p.policy->'allowedDomains') d where host=d or right(host,length(d)+1)='.'||d) or exists(select 1 from jsonb_array_elements_text(p.policy->'excludedDomains') d where host=d or right(host,length(d)+1)='.'||d) or s->>'provider' is distinct from 'openrouter.exa' or jsonb_typeof(s->'excerpt') is distinct from 'string' or length(s->>'excerpt') not between 30 and 1800 or jsonb_typeof(s->'title') is distinct from 'string' or length(s->>'title') not between 1 and 250 or s->'publishedAt' is distinct from 'null'::jsonb or s->>'contentHash' is distinct from encode(extensions.digest(convert_to(s->>'excerpt','UTF8'),'sha256'),'hex') or s->>'id' is distinct from 'src-'||left(encode(extensions.digest(convert_to(url||':'||(s->>'contentHash'),'UTF8'),'sha256'),'hex'),24) then raise exception 'r11_research_source_invalid';end if;
 if jsonb_typeof(s->'retrievedAt') is distinct from 'string' or jsonb_typeof(s->'retrievalExpiresAt') is distinct from 'string' or not isfinite((s->>'retrievedAt')::timestamptz) or not isfinite((s->>'retrievalExpiresAt')::timestamptz) or (s->>'retrievedAt')::timestamptz>clock_timestamp()+interval '5 minutes' or (s->>'retrievalExpiresAt')::timestamptz<=clock_timestamp() or (s->>'retrievalExpiresAt')::timestamptz>(s->>'retrievedAt')::timestamptz+interval '1 day' then raise exception 'r11_research_collection_expired';end if;
 end loop;
 if (select count(distinct value->>'id') from jsonb_array_elements(a->'sources'))<>jsonb_array_length(a->'sources') or (select count(distinct value->>'url') from jsonb_array_elements(a->'sources'))<>jsonb_array_length(a->'sources') or (select count(distinct value->>'contentHash') from jsonb_array_elements(a->'sources'))<>jsonb_array_length(a->'sources') then raise exception 'r11_research_duplicate_source';end if;
 for e in select value from jsonb_array_elements(a->'evidence') loop
 perform private.r04_keys(e,array['id','sourceId','quote']);found_source:=false;
 for s in select value from jsonb_array_elements(a->'sources') where value->>'id'=e->>'sourceId' loop
 found_source:=true;if jsonb_typeof(e->'quote') is distinct from 'string' or length(e->>'quote') not between 20 and 320 or position(e->>'quote' in s->>'excerpt')=0 or e->>'id' is distinct from 'evi-'||left(encode(extensions.digest(convert_to((s->>'id')||':'||(e->>'quote'),'UTF8'),'sha256'),'hex'),24) then raise exception 'r11_research_evidence_invalid';end if;end loop;
 if not found_source then raise exception 'r11_research_evidence_invalid';end if;end loop;
 if (select count(distinct value->>'id') from jsonb_array_elements(a->'evidence'))<>jsonb_array_length(a->'evidence') or (select count(distinct value->>'sourceId') from jsonb_array_elements(a->'evidence'))<>jsonb_array_length(a->'sources') then raise exception 'r11_research_evidence_invalid';end if;
 if p_payload->'lineage' is distinct from jsonb_build_object('version',p.policy->>'version','policyId',p.id,'policyHash',p.policy_hash,'collectionHash',p_payload->>'collectionHash','searchRequestId',r.id,'providerRequestId',p_payload->>'providerRequestId','sourceDomains',p.policy->'allowedDomains') then raise exception 'r11_research_lineage_mismatch';end if;
 select * into c from private.r11_research_collections where policy_id=p.id;
 if c.id is not null then
 if c.search_request_id<>r.id or c.provider_request_id is distinct from p_payload->>'providerRequestId' or c.collection is distinct from a or c.collection_canonical is distinct from p_payload->>'collectionCanonical' or c.collection_hash is distinct from p_payload->>'collectionHash' or c.lineage is distinct from p_payload->'lineage' or c.lineage_canonical is distinct from p_payload->>'lineageCanonical' or c.lineage_hash is distinct from p_payload->>'lineageHash' or c.selector_request_hash is distinct from p_payload->>'selectorRequestHash' or c.selector_wire_hash is distinct from p_payload->>'selectorWireHash' or to_jsonb(c.selector_wire_bytes) is distinct from p_payload->'selectorWireBytes' or to_jsonb(c.selector_max_tokens) is distinct from p_payload->'selectorMaxTokens' or c.producer_key_hash<>key_hash then raise exception 'r11_research_collection_conflict';end if;
 perform private.r11_research_key(key_hash);perform private.r11_research_active(p_business_id,p.id);
 return jsonb_build_object('collectionId',c.id,'collectionHash',c.collection_hash,'lineageHash',c.lineage_hash,'replayed',true);
 end if;
 perform private.r11_research_key(key_hash);perform private.r11_research_active(p_business_id,p.id);
 insert into private.r11_research_collections(business_id,policy_id,search_request_id,provider_request_id,collection,collection_canonical,collection_hash,lineage,lineage_canonical,lineage_hash,selector_request_hash,selector_wire_hash,selector_wire_bytes,selector_max_tokens,producer_key_hash) values(p_business_id,p.id,r.id,p_payload->>'providerRequestId',a,p_payload->>'collectionCanonical',p_payload->>'collectionHash',p_payload->'lineage',p_payload->>'lineageCanonical',p_payload->>'lineageHash',p_payload->>'selectorRequestHash',p_payload->>'selectorWireHash',(p_payload->>'selectorWireBytes')::integer,(p_payload->>'selectorMaxTokens')::integer,key_hash) returning * into c;
 return jsonb_build_object('collectionId',c.id,'collectionHash',c.collection_hash,'lineageHash',c.lineage_hash,'replayed',false);
 end if;
end $$;

create or replace function private.r11_research_marker() returns trigger language plpgsql set search_path='' as $$
declare r private.r05_requests;v private.r11_research_bindings;p private.r11_research_policies;c private.r11_research_collections;o private.r05_operations;reason text;begin
 select * into r from private.r05_requests where id=new.request_id and business_id=new.business_id;
 select * into o from private.r05_operations where operation_key=r.payload->>'operationKey';
 if r.payload->>'operationKey' not in ('research.search','research.model') and not exists(select 1 from private.r11_research_attempts a where a.search_operation_key=r.payload->>'operationKey' or a.selector_operation_key=r.payload->>'operationKey') then
 if r.payload->>'operationKey' like 'research.%.r11v2.%' then raise exception 'r11_research_source_operation_unqualified';end if;
 if coalesce(jsonb_array_length(r.payload->'sourceDomains'),0)>0 or coalesce(jsonb_array_length(o.source_domains),0)>0 or r.payload->'dataClasses' ?| array['public_evidence','product_evidence'] or o.data_classes ?| array['public_evidence','product_evidence'] then raise exception 'r11_research_source_operation_unqualified';end if;
 return new;
 end if;
 perform 1 from public.businesses where id=new.business_id for update;
 select * into v from private.r11_research_bindings where request_id=r.id and business_id=r.business_id;
 if v.request_id is null then raise exception 'r11_research_binding_required';end if;
 perform private.r11_research_key(v.admission_key_hash);p:=private.r11_research_active(r.business_id,v.policy_id);
 if v.phase='select' then c:=private.r11_research_collection_active(p,v.collection_id);end if;
 perform private.r11_research_descriptor(p,v.phase,c,r.payload);
 if r.policy_id is distinct from p.operating_policy_id or r.request_hash is distinct from v.descriptor_hash or private.r04_hash(r.payload) is distinct from v.descriptor_hash or r.payload->>'requestHash' is distinct from v.logical_request_hash or r.payload->>'wireRequestHash' is distinct from v.wire_hash then raise exception 'r11_research_binding_mismatch';end if;
 -- Recheck after all possible waits, immediately before the irreversible sent marker.
 perform private.r11_research_key(v.admission_key_hash);perform private.r11_research_active(r.business_id,v.policy_id);
 -- R05 may have waited on its operation/pack locks after checking financial
 -- proof expiry. All those locks are now held; reread every original guard.
 reason:=private.r05_admissible(r);
 if reason is not null then raise exception 'r11_research_financial_recheck: %',reason;end if;
 -- The phase quote deadline is immutable and checked after every lock wait,
 -- immediately before the sent marker. An expired quote rolls back admission.
 if p.policy->>'version'='r11.public-research.2' and (v.quote_valid_until is null or not isfinite(v.quote_valid_until) or v.quote_valid_until<=clock_timestamp()) then raise exception 'r11_research_fresh_quote_required';end if;
 return new;
end $$;
-- CREATE OR REPLACE retains existing ACLs; restate only the existing boundary.
revoke all on function private.r11_research_policy_validate(),private.r11_research_continuation_validate(),private.r11_research_marker() from public,anon,authenticated,service_role;
revoke all on function public.r11_research_server(uuid,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.r11_research_server(uuid,text,jsonb,text) to anon;
commit;
