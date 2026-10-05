-- R11 bounded private receipt staging. No authority, generation, queue, cleanup,
-- renewal, or public permission is created. Existing R05 bodies/ACLs and all
-- prior failed histories remain unchanged. Retained normalized payload is audit
-- data, not trusted evidence; eligibility/access ends at the original grace.
begin;
create table private.r11_research_receipt_candidates(
 request_id uuid primary key,business_id uuid not null,policy_id uuid not null,phase text not null check(phase in ('search','select')),
 candidate jsonb not null,candidate_hash text not null check(candidate_hash ~ '^[a-f0-9]{64}$'),
 producer_key_hash text not null references private.r05_server_keys(key_hash),receipt_expires_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(),unique(policy_id,phase),
 foreign key(request_id,business_id) references private.r05_requests(id,business_id),
 foreign key(policy_id,business_id) references private.r11_research_policies(id,business_id),
 check(octet_length(candidate::text)<=24576 and candidate_hash=private.stage14_hash(candidate) and isfinite(receipt_expires_at))
);
create table private.r11_research_receipt_checks(
 id uuid primary key default gen_random_uuid(),request_id uuid not null references private.r11_research_receipt_candidates(request_id),
 attempt integer not null check(attempt between 1 and 3),created_at timestamptz not null default clock_timestamp(),
 unique(request_id,attempt),check(isfinite(created_at))
);
create table private.r11_research_receipt_observations(
 check_id uuid primary key references private.r11_research_receipt_checks(id),
 proof jsonb,diagnostic jsonb,retry_after_at timestamptz,terminal boolean not null,
 created_at timestamptz not null default clock_timestamp(),
 check((proof is not null)<>(diagnostic is not null)),
 check(octet_length(coalesce(proof::text,''))<=16384 and octet_length(coalesce(diagnostic::text,''))<=256),
 check(retry_after_at is null or isfinite(retry_after_at))
);
do $$ declare t text;begin
 foreach t in array array['r11_research_receipt_candidates','r11_research_receipt_checks','r11_research_receipt_observations'] loop
 execute format('alter table private.%I enable row level security',t);
 execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger r11_research_guard before insert or update or delete on private.%I for each row execute function private.r11_research_history_guard()',t);
 end loop;
end $$;

-- Metadata contains no candidate content or raw provider response. An unreturned
-- claim still counts and holds its exclusive 120-second lease. Longer Retry-After
-- dates are preserved, including dates outside the grace (which cannot renew it).
create function private.r11_research_receipt_status(c private.r11_research_receipt_candidates) returns jsonb language plpgsql stable set search_path='' as $$
declare q private.r11_research_receipt_checks;o private.r11_research_receipt_observations;p private.r11_research_policies;s text;n timestamptz;begin
 select * into p from private.r11_research_policies where id=c.policy_id;
 select * into q from private.r11_research_receipt_checks where request_id=c.request_id order by attempt desc limit 1;
 select * into o from private.r11_research_receipt_observations where check_id=q.id;
 n:=case when q.id is null then null else greatest(q.created_at+interval '120 seconds',o.retry_after_at) end;
 if exists(select 1 from private.r11_research_outcomes where policy_id=c.policy_id and kind='owner_stopped') or (not coalesce(o.terminal,false) and (exists(select 1 from private.r11_research_revocations where policy_id=c.policy_id) or private.r11_research_activation_revoked(c.policy_id) or exists(select 1 from private.r05_revocations where policy_id=p.operating_policy_id))) then s:='stopped';
 elsif clock_timestamp()>=c.receipt_expires_at then s:='expired';
 elsif o.proof is not null then s:='verified';
 elsif o.terminal then s:='terminal';
 elsif q.attempt=3 and (o.check_id is not null or clock_timestamp()>=n) then s:='exhausted';
 elsif q.id is not null and o.check_id is null and clock_timestamp()<n then s:='checking_receipt';
 else s:='awaiting_receipt';end if;
 return jsonb_build_object('phase',c.phase,'requestId',c.request_id,'candidateHash',c.candidate_hash,'status',s,'attempts',coalesce(q.attempt,0),'nextCheckAt',case when s in ('awaiting_receipt','checking_receipt') then n else null end,'receiptExpiresAt',c.receipt_expires_at,'diagnostic',o.diagnostic,'proofHash',o.proof->>'proofHash');
end $$;

create function private.r11_research_receipt_policy(b uuid,pid uuid,h text) returns private.r11_research_policies language plpgsql set search_path='' as $$
declare p private.r11_research_policies;begin
 -- Same business -> policy lock order as admission and Stop. All new receipt
 -- transactions serialize with Stop and every paid marker for this business.
 perform 1 from public.businesses where id=b for update;
 select * into p from private.r11_research_policies where id=pid and business_id=b for share;
 perform private.r11_research_key(h);
 if p.id is null or not exists(select 1 from public.businesses where id=b and owner_user_id=p.owner_id) or (p.authority_key_hash is not null and p.authority_key_hash<>h) then raise exception 'r11_research_receipt_scope' using errcode='42501';end if;
 return p;
end $$;

create function private.r11_research_receipt_normalized(t text) returns boolean language sql immutable set search_path='' as $$
 select t=btrim(regexp_replace(t,'[[:space:]'||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279)||']+',' ','g'))
$$;

create function private.r11_research_receipt_candidate_validate(p private.r11_research_policies,v private.r11_research_bindings,a jsonb) returns void language plpgsql set search_path='' as $$
declare x jsonb;s jsonb;c private.r11_research_collections;u text;host text;k text;begin
 perform private.r04_keys(a,array['version','phase','providerRequestId','providerModelId','receivedAt','reportedMicrousd','output','observation']);
 if octet_length(a::text)>24576 or a->>'version' is distinct from 'r11.receipt-candidate.1' or a->>'phase' is distinct from v.phase then raise exception 'r11_research_receipt_candidate_invalid';end if;
 foreach k in array array['providerRequestId','providerModelId','receivedAt'] loop if jsonb_typeof(a->k) is distinct from 'string' then raise exception 'r11_research_receipt_candidate_invalid';end if;end loop;
 if (a->>'providerRequestId' !~ '^gen-[A-Za-z0-9_-]+$' or length(a->>'providerRequestId')>300) or (a->>'providerModelId' is distinct from p.policy->>'modelId' and not(p.policy->>'modelId'='openai/gpt-5.6-luna' and a->>'providerModelId'='openai/gpt-5.6-luna-20260709')) or a->>'receivedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' or not isfinite((a->>'receivedAt')::timestamptz) or (a->>'receivedAt')::timestamptz>clock_timestamp()+interval '5 minutes' or (a->>'receivedAt')::timestamptz<(select created_at-interval '5 minutes' from private.r05_markers where request_id=v.request_id) then raise exception 'r11_research_receipt_candidate_identity';end if;
 if jsonb_typeof(a->'reportedMicrousd') is distinct from 'number' or a->>'reportedMicrousd' !~ '^(0|[1-9][0-9]{0,5})$' or (a->>'reportedMicrousd')::bigint>(p.policy->>case v.phase when 'search' then 'searchMicrousd' else 'selectorMicrousd' end)::bigint then raise exception 'r11_research_receipt_candidate_cost';end if;
 perform private.r11_research_observation_validate(p,a->'observation');
 if jsonb_typeof(a->'observation') is distinct from 'object' or a->'observation'->>'modelIdentity' not in ('request_alias','canonical') or a->'observation'->>'observedModelId' is distinct from a->>'providerModelId' or a->'observation'->>'finishReason' is distinct from 'stop' or a->'observation'->'providerError' is distinct from 'null'::jsonb or (a->'observation' ? 'inferenceRouteStatus' and a->'observation'->>'inferenceRouteStatus'<>'unrequested') then raise exception 'r11_research_receipt_candidate_observation';end if;
 if v.phase='search' then
 if a->'observation'->'searchRequests' is distinct from '1'::jsonb or a->'observation'->'annotationCount' is distinct from to_jsonb(jsonb_array_length(a->'output')) or a->'observation'->'malformedAnnotationCount' is distinct from '0'::jsonb or a->'observation'->'rejectedDomainCount' is distinct from '0'::jsonb or jsonb_typeof(a->'output') is distinct from 'array' or jsonb_array_length(a->'output') not between 1 and 4 then raise exception 'r11_research_receipt_candidate_sources';end if;
 for x in select value from jsonb_array_elements(a->'output') loop
 perform private.r04_keys(x,array['type','url_citation']);perform private.r04_keys(x->'url_citation',array['url','title','content']);s:=x->'url_citation';u:=s->>'url';host:=substring(u from '^https://([^/?#]+)');
 if x->>'type' is distinct from 'url_citation' or jsonb_typeof(s->'url') is distinct from 'string' or length(u)>2048 or host is null or host !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' or u ~ '#' or not private.r11_research_url_query_safe(u) or not exists(select 1 from jsonb_array_elements_text(p.policy->'allowedDomains') d where host=d or right(host,length(d)+1)='.'||d) or exists(select 1 from jsonb_array_elements_text(p.policy->'excludedDomains') d where host=d or right(host,length(d)+1)='.'||d) or jsonb_typeof(s->'content') is distinct from 'string' or length(s->>'content') not between 30 and 1800 or jsonb_typeof(s->'title') is distinct from 'string' or length(s->>'title') not between 1 and 250 or not private.r11_research_receipt_normalized(s->>'content') or not private.r11_research_receipt_normalized(s->>'title') then raise exception 'r11_research_receipt_candidate_sources';end if;
 end loop;
 else
 select * into c from private.r11_research_collections where id=v.collection_id and policy_id=p.id;
 perform private.r04_keys(a->'output',array['selections','limitations']);
 if jsonb_typeof(a->'output'->'selections') is distinct from 'array' or jsonb_array_length(a->'output'->'selections') not between 1 and 4 or jsonb_typeof(a->'output'->'limitations') is distinct from 'array' or jsonb_array_length(a->'output'->'limitations')>4 then raise exception 'r11_research_receipt_candidate_selection';end if;
 for x in select value from jsonb_array_elements(a->'output'->'selections') loop
 perform private.r04_keys(x,array['sourceKey','quote']);
 if jsonb_typeof(x->'sourceKey') is distinct from 'string' or x->>'sourceKey' !~ '^S[1-4]$' or jsonb_typeof(x->'quote') is distinct from 'string' or length(x->>'quote') not between 20 and 320 or btrim(x->>'quote',E' \t\n\r\f\v'||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279))<>x->>'quote' then raise exception 'r11_research_receipt_candidate_selection';end if;
 s:=c.collection->'sources'->(substring(x->>'sourceKey' from 2)::integer-1);
 if s is null or position(x->>'quote' in s->>'excerpt')=0 then raise exception 'r11_research_receipt_candidate_selection';end if;end loop;
 if (select count(distinct value) from jsonb_array_elements(a->'output'->'selections'))<>jsonb_array_length(a->'output'->'selections') or (select count(distinct value) from jsonb_array_elements(a->'output'->'limitations'))<>jsonb_array_length(a->'output'->'limitations') then raise exception 'r11_research_receipt_candidate_selection';end if;
 for x in select value from jsonb_array_elements(a->'output'->'limitations') loop if jsonb_typeof(x) is distinct from 'string' or x#>>'{}' not in ('limited_sources','publication_dates_unknown','no_sales_metrics','no_current_prices') then raise exception 'r11_research_receipt_candidate_selection';end if;end loop;
 end if;
end $$;

create function private.r11_research_receipt_proof_validate(c private.r11_research_receipt_candidates,a jsonb) returns void language plpgsql set search_path='' as $$
declare x jsonb;begin
 perform private.r04_keys(a,array['generationId','providerName','modelId','requestedEndpoint','providerResponses','proofHash']);
 if c.candidate->>'providerModelId' not in ('openai/gpt-5.6-luna','openai/gpt-5.6-luna-20260709') or a->>'generationId' is distinct from c.candidate->>'providerRequestId' or a->>'providerName' is distinct from 'Azure' or a->>'requestedEndpoint' is distinct from 'azure/us' or a->>'modelId' not in ('openai/gpt-5.6-luna','openai/gpt-5.6-luna-20260709') or jsonb_typeof(a->'modelId') is distinct from 'string' or jsonb_typeof(a->'providerResponses') is distinct from 'array' or jsonb_array_length(a->'providerResponses')>64 or a->>'proofHash' is distinct from private.stage14_hash(a-'proofHash') then raise exception 'r11_research_receipt_proof_invalid';end if;
 for x in select value from jsonb_array_elements(a->'providerResponses') loop
 perform private.r04_keys(x,array['providerName','modelId','status']);
 if x->>'providerName' is distinct from 'Azure' or jsonb_typeof(x->'modelId') is distinct from 'string' or x->>'modelId' not in ('openai/gpt-5.6-luna','openai/gpt-5.6-luna-20260709') or x->'status' is distinct from '200'::jsonb then raise exception 'r11_research_receipt_proof_invalid';end if;end loop;
end $$;

create function private.r11_research_receipt_operation(b uuid,op text,a jsonb,h text) returns jsonb language plpgsql set search_path='' as $$
declare p private.r11_research_policies;v private.r11_research_bindings;c private.r11_research_receipt_candidates;q private.r11_research_receipt_checks;o private.r11_research_receipt_observations;
 s jsonb;observed jsonb;expiry timestamptz;retry_at timestamptz;is_terminal boolean;code text;http integer;phase_name text;begin
 p:=private.r11_research_receipt_policy(b,(a->>'policyId')::uuid,h);
 if op='stage_receipt' then
 perform private.r04_keys(a,array['policyId','requestId','candidate','candidateHash']);
 select * into v from private.r11_research_bindings where request_id=(a->>'requestId')::uuid and policy_id=p.id and business_id=b;
 if v.request_id is null or v.admission_key_hash<>h or not exists(select 1 from private.r05_markers where request_id=v.request_id) then raise exception 'r11_research_receipt_marked_required';end if;
 perform private.r11_research_receipt_candidate_validate(p,v,a->'candidate');
 if a->>'candidateHash' is distinct from private.stage14_hash(a->'candidate') then raise exception 'r11_research_receipt_hash';end if;
 -- Known-cost settlement and global exact receipt ownership are required before
 -- retaining output. Staging cannot settle or move financial liability itself.
 if not exists(select 1 from private.r05_settlements z where z.request_id=v.request_id and z.provider_request_id=a->'candidate'->>'providerRequestId' and z.actual_microunits=(a->'candidate'->>'reportedMicrousd')::bigint and z.currency='USD') or exists(select 1 from private.r05_settlements z where z.request_id=v.request_id and z.actual_microunits>(p.policy->>case v.phase when 'search' then 'searchMicrousd' else 'selectorMicrousd' end)::bigint) or not exists(select 1 from private.r05_requests r join private.r05_receipt_claims z on z.business_id=r.business_id and z.workflow_run_id=r.workflow_run_id and z.source_key=r.source_key where r.id=v.request_id and z.provider='openrouter' and z.provider_request_id=a->'candidate'->>'providerRequestId') then raise exception 'r11_research_receipt_settlement_required';end if;
 select * into c from private.r11_research_receipt_candidates where policy_id=p.id and phase=v.phase;
 if c.request_id is not null then
 if c.request_id<>v.request_id or c.candidate is distinct from a->'candidate' or c.candidate_hash is distinct from a->>'candidateHash' or c.producer_key_hash<>h then raise exception 'r11_research_receipt_candidate_conflict';end if;
 return private.r11_research_receipt_status(c)||jsonb_build_object('staged',true,'replayed',true);end if;
 select least(expires_at,(p.policy->>'validUntil')::timestamptz+interval '30 minutes') into expiry from private.r05_server_keys where key_hash=h;
 if clock_timestamp()>=expiry or exists(select 1 from private.r11_research_revocations where policy_id=p.id) or private.r11_research_activation_revoked(p.id) or exists(select 1 from private.r05_revocations where policy_id=p.operating_policy_id) then raise exception 'r11_research_receipt_inactive';end if;
 insert into private.r11_research_receipt_candidates(request_id,business_id,policy_id,phase,candidate,candidate_hash,producer_key_hash,receipt_expires_at) values(v.request_id,b,p.id,v.phase,a->'candidate',a->>'candidateHash',h,expiry) returning * into c;
 perform private.r11_research_key(h);return private.r11_research_receipt_status(c)||jsonb_build_object('staged',true,'replayed',false);
 end if;
 if op='claim_receipt' then perform private.r04_keys(a,array['policyId','phase','candidateHash']);
 elsif op='record_receipt' then perform private.r04_keys(a,array['policyId','phase','candidateHash','claimId','proof','diagnostic','retryAfterAt']);
 else raise exception 'r11_research_operation_unavailable';end if;
 phase_name:=a->>'phase';select * into c from private.r11_research_receipt_candidates where policy_id=p.id and phase=phase_name;
 if c.request_id is null or c.candidate_hash is distinct from a->>'candidateHash' or c.producer_key_hash<>h then raise exception 'r11_research_receipt_candidate_required';end if;
 s:=private.r11_research_receipt_status(c);
 if op='claim_receipt' then
 if s->>'status' in ('verified','terminal','exhausted','expired','stopped') then return s||jsonb_build_object('claimed',false,'claimId',null,'reason',s->>'status');end if;
 if s->>'nextCheckAt' is not null and clock_timestamp()<(s->>'nextCheckAt')::timestamptz then return s||jsonb_build_object('claimed',false,'claimId',null,'reason','cooldown');end if;
 insert into private.r11_research_receipt_checks(request_id,attempt) values(c.request_id,(s->>'attempts')::integer+1) returning * into q;
 perform private.r11_research_key(h);
 return private.r11_research_receipt_status(c)||jsonb_build_object('claimed',true,'claimId',q.id,'reason','claimed');
 end if;
 select * into q from private.r11_research_receipt_checks where id=(a->>'claimId')::uuid and request_id=c.request_id;
 if q.id is null or exists(select 1 from private.r11_research_receipt_checks where request_id=c.request_id and attempt>q.attempt) then raise exception 'r11_research_receipt_claim_invalid';end if;
 if (a->'proof'='null'::jsonb)=(a->'diagnostic'='null'::jsonb) then raise exception 'r11_research_receipt_record_invalid';end if;
 if a->'proof'<>'null'::jsonb then
 perform private.r11_research_receipt_proof_validate(c,a->'proof');is_terminal:=false;
 if a->'retryAfterAt' is distinct from 'null'::jsonb then raise exception 'r11_research_receipt_retry_after';end if;
 else
 perform private.r04_keys(a->'diagnostic',array['code','httpStatus']);code:=a->'diagnostic'->>'code';
 if jsonb_typeof(a->'diagnostic'->'code') is distinct from 'string' or code not in ('invalid_request','configuration_unavailable','transport_failure','timeout','redirect_rejected','api_failure','response_too_large','json_invalid','response_invalid','generation_mismatch','provider_mismatch','model_mismatch','provider_responses_invalid') then raise exception 'r11_research_receipt_diagnostic';end if;
 if a->'diagnostic'->'httpStatus'<>'null'::jsonb then
 if jsonb_typeof(a->'diagnostic'->'httpStatus') is distinct from 'number' or a->'diagnostic'->>'httpStatus' !~ '^[1-5][0-9]{2}$' then raise exception 'r11_research_receipt_diagnostic';end if;http:=(a->'diagnostic'->>'httpStatus')::integer;end if;
 is_terminal:=not(code in ('transport_failure','timeout') or (code='api_failure' and coalesce(http in (404,429) or http between 500 and 599,false)));
 if a->'retryAfterAt'<>'null'::jsonb then
 if is_terminal or jsonb_typeof(a->'retryAfterAt') is distinct from 'string' or a->>'retryAfterAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then raise exception 'r11_research_receipt_retry_after';end if;
 retry_at:=(a->>'retryAfterAt')::timestamptz;if not isfinite(retry_at) then raise exception 'r11_research_receipt_retry_after';end if;end if;
 end if;
 select * into o from private.r11_research_receipt_observations where check_id=q.id;
 if o.check_id is not null then
 if o.proof is distinct from nullif(a->'proof','null'::jsonb) or o.diagnostic is distinct from nullif(a->'diagnostic','null'::jsonb) or o.retry_after_at is distinct from retry_at then raise exception 'r11_research_receipt_record_conflict';end if;
 return s||jsonb_build_object('recorded',true,'replayed',true);end if;
 if s->>'status' in ('expired','stopped') then raise exception 'r11_research_receipt_inactive';end if;
 insert into private.r11_research_receipt_observations(check_id,proof,diagnostic,retry_after_at,terminal) values(q.id,nullif(a->'proof','null'::jsonb),nullif(a->'diagnostic','null'::jsonb),retry_at,is_terminal);
 if is_terminal then
 observed:=c.candidate->'observation'||jsonb_build_object('responseProviderHash',case when c.candidate->'observation'->>'providerIdentity'='exact' then to_jsonb('3140d22d8cb307e2e7ffbae4a07225e09537ce90c32033582f01d979c0ad8f26'::text) else coalesce(c.candidate->'observation'->'responseProviderHash','null'::jsonb) end,'inferenceRouteStatus',case when code in ('generation_mismatch','provider_mismatch','model_mismatch','provider_responses_invalid','response_invalid','json_invalid','response_too_large','redirect_rejected') then 'invalid' else 'unavailable' end,'inferenceRouteProofHash',null,'inferenceRouteFailureCode',code,'inferenceRouteHttpStatus',http,'inferenceRouteAttempts',q.attempt);
 perform private.r11_research_observation_validate(p,observed);
 perform private.r11_research_outcome_write(p,'failure',c.phase,c.request_id,'response_provider_unqualified',observed,null,h);
 end if;
 perform private.r11_research_key(h);return private.r11_research_receipt_status(c)||jsonb_build_object('recorded',true,'replayed',false);
end $$;

-- Neither the v1 nor v2 server entry point can promote staged content without
-- exact verified proof. Existing collection/result checks still run unchanged.
create function private.r11_research_receipt_promotion() returns trigger language plpgsql set search_path='' as $$
declare c private.r11_research_receipt_candidates;s jsonb;expected jsonb;projected jsonb:='[]';annotation jsonb;seen_urls text[]:='{}';seen_content text[]:='{}';begin
 select * into c from private.r11_research_receipt_candidates where policy_id=new.policy_id and phase=case tg_table_name when 'r11_research_collections' then 'search' else 'select' end;
 if c.request_id is null then return new;end if;
 s:=private.r11_research_receipt_status(c);
 if s->>'status'<>'verified' or new.provider_request_id is distinct from c.candidate->>'providerRequestId' or new.producer_key_hash<>c.producer_key_hash then raise exception 'r11_research_verified_receipt_required';end if;
 if tg_table_name='r11_research_collections' then
 -- Match the existing source extractor's greedy URL OR content deduplication.
 -- A skipped annotation adds neither its URL nor its content to the seen sets.
 -- Every annotation was fully source/shape validated before immutable staging.
 for annotation in select value from jsonb_array_elements(c.candidate->'output') loop
 if annotation->'url_citation'->>'url'=any(seen_urls) or annotation->'url_citation'->>'content'=any(seen_content) then continue;end if;
 projected:=projected||jsonb_build_array(annotation);
 seen_urls:=array_append(seen_urls,annotation->'url_citation'->>'url');seen_content:=array_append(seen_content,annotation->'url_citation'->>'content');
 end loop;
 select jsonb_agg(jsonb_build_object('type','url_citation','url_citation',jsonb_build_object('url',x->>'url','title',x->>'title','content',x->>'excerpt')) order by ord) into expected from jsonb_array_elements(new.collection->'sources') with ordinality z(x,ord);
 if new.search_request_id<>c.request_id or expected is distinct from projected or exists(select 1 from jsonb_array_elements(new.collection->'sources') x where (x->>'retrievedAt')::timestamptz<>(c.candidate->>'receivedAt')::timestamptz) then raise exception 'r11_research_staged_output_mismatch';end if;
 else
 if new.selector_request_id<>c.request_id or new.selection is distinct from c.candidate->'output' then raise exception 'r11_research_staged_output_mismatch';end if;
 end if;return new;
end $$;
create trigger r11_research_receipt_promotion before insert on private.r11_research_collections for each row execute function private.r11_research_receipt_promotion();
create trigger r11_research_receipt_promotion before insert on private.r11_research_results for each row execute function private.r11_research_receipt_promotion();

create or replace function public.r11_research_server_v2(p_business_id uuid,p_operation text,p_payload jsonb,p_server_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.r11_research_policies;key_hash text;result jsonb;rid uuid;phase_name text;c private.r11_research_receipt_candidates;col private.r11_research_collections;pending jsonb:='[]';check_state jsonb;proof_value jsonb;begin
 if p_operation in ('stage_receipt','claim_receipt','record_receipt') then
 if p_server_key is null or length(p_server_key) not between 32 and 200 or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>32768 then raise exception 'r11_research_authority_required' using errcode='42501';end if;
 key_hash:=encode(extensions.digest(convert_to(p_server_key,'UTF8'),'sha256'),'hex');return private.r11_research_receipt_operation(p_business_id,p_operation,p_payload,key_hash);end if;
 if p_operation='load' and exists(select 1 from private.r11_research_receipt_candidates where policy_id=(p_payload->>'policyId')::uuid) then
 perform private.r04_keys(p_payload,array['policyId']);
 if p_server_key is null or length(p_server_key) not between 32 and 200 then raise exception 'r11_research_authority_required' using errcode='42501';end if;
 key_hash:=encode(extensions.digest(convert_to(p_server_key,'UTF8'),'sha256'),'hex');p:=private.r11_research_receipt_policy(p_business_id,(p_payload->>'policyId')::uuid,key_hash);
 for c in select * from private.r11_research_receipt_candidates where policy_id=p.id order by phase loop
 if c.producer_key_hash<>key_hash then raise exception 'r11_research_authority_required' using errcode='42501';end if;
 check_state:=private.r11_research_receipt_status(c);
 if check_state->>'status' in ('expired','stopped') or exists(select 1 from private.r11_research_revocations where policy_id=p.id) or private.r11_research_activation_revoked(p.id) or exists(select 1 from private.r05_revocations where policy_id=p.operating_policy_id) then raise exception 'r11_research_receipt_inactive';end if;
 select o.proof into proof_value from private.r11_research_receipt_checks q join private.r11_research_receipt_observations o on o.check_id=q.id where q.request_id=c.request_id order by q.attempt desc limit 1;
 pending:=pending||jsonb_build_array(check_state||jsonb_build_object('candidate',c.candidate,'proof',proof_value));end loop;
 select * into col from private.r11_research_collections where policy_id=p.id;
 perform private.r11_research_key(key_hash);
 return jsonb_build_object('policy',p.policy,'policyHash',p.policy_hash,'search',jsonb_build_object('requestHash',p.search_request_hash,'wireHash',p.search_wire_hash,'wireBytes',p.search_wire_bytes,'maxTokens',p.search_max_tokens),'collection',case when col.id is null then null else jsonb_build_object('id',col.id,'collection',col.collection,'collectionHash',col.collection_hash,'lineage',col.lineage,'lineageHash',col.lineage_hash,'selector',jsonb_build_object('requestHash',col.selector_request_hash,'wireHash',col.selector_wire_hash,'wireBytes',col.selector_wire_bytes,'maxTokens',col.selector_max_tokens)) end,'operationKeys',private.r11_research_operation_keys(p.id),'attemptVersion',case when exists(select 1 from private.r11_research_attempts where policy_id=p.id) then 2 else 1 end,'receiptCandidates',pending);end if;
 if p_operation in ('load','guard','collect','complete') then
 result:=public.r11_research_server(p_business_id,p_operation,p_payload,p_server_key);
 if p_operation='load' then result:=result||jsonb_build_object('receiptCandidates','[]'::jsonb,'operationKeys',private.r11_research_operation_keys((p_payload->>'policyId')::uuid),'attemptVersion',case when exists(select 1 from private.r11_research_attempts where policy_id=(p_payload->>'policyId')::uuid) then 2 else 1 end);end if;
 return result;end if;
 if p_operation is distinct from 'fail' then raise exception 'r11_research_operation_unavailable';end if;
 if p_server_key is null or length(p_server_key) not between 32 and 200 then raise exception 'r11_research_authority_required' using errcode='42501';end if;
 perform private.r04_keys(p_payload,array['policyId','phase','requestId','reason','observation']);
 if octet_length(p_payload::text)>12288 or jsonb_typeof(p_payload->'policyId') is distinct from 'string' or p_payload->>'policyId' !~ '^[a-f0-9-]{36}$' or jsonb_typeof(p_payload->'phase') is distinct from 'string' or p_payload->>'phase' not in ('none','search','select') or jsonb_typeof(p_payload->'reason') is distinct from 'string' or p_payload->>'reason' not in ('provider_response_invalid','response_model_unqualified','response_provider_unqualified','source_contract_invalid','collection_persistence_failed','selector_output_invalid','result_persistence_failed','cost_unverified_or_over_cap','internal_failure') then raise exception 'r11_research_outcome_invalid';end if;
 perform 1 from public.businesses where id=p_business_id for update;
 select * into p from private.r11_research_policies where id=(p_payload->>'policyId')::uuid and business_id=p_business_id for share;
 if p.id is null or not exists(select 1 from public.businesses where id=p_business_id and owner_user_id=p.owner_id) then raise exception 'r11_research_outcome_scope';end if;
 key_hash:=encode(extensions.digest(convert_to(p_server_key,'UTF8'),'sha256'),'hex');perform private.r11_research_key(key_hash);
 if p.authority_key_hash is not null and p.authority_key_hash<>key_hash then raise exception 'r11_research_authority_required' using errcode='42501';end if;
 phase_name:=p_payload->>'phase';
 if phase_name='none' and exists(select 1 from private.r11_research_bindings where policy_id=p.id) then raise exception 'r11_research_outcome_phase';end if;
 select request_id into rid from private.r11_research_bindings where policy_id=p.id and phase=phase_name;
 if (p_payload->'requestId'='null'::jsonb and rid is not null) or (p_payload->'requestId'<>'null'::jsonb and (jsonb_typeof(p_payload->'requestId') is distinct from 'string' or p_payload->>'requestId' is distinct from rid::text)) then raise exception 'r11_research_outcome_request';end if;
 if rid is not null and not exists(select 1 from private.r11_research_bindings where request_id=rid and admission_key_hash=key_hash) then raise exception 'r11_research_outcome_key';end if;
 perform private.r11_research_observation_validate(p,p_payload->'observation');
 result:=private.r11_research_outcome_write(p,'failure',phase_name,rid,p_payload->>'reason',p_payload->'observation',null,key_hash);
 -- Projection may wait on workflow locks; expiry after the wait rolls back all.
 perform private.r11_research_key(key_hash);return result;
end $$;

create or replace function public.r11_research_workspace_v2(p_business_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare answer jsonb;policies jsonb:='[]';item jsonb;events jsonb;pid uuid;ws text;begin
 answer:=public.r11_research_workspace(p_business_id);
 for item in select value from jsonb_array_elements(answer->'policies') loop
 pid:=(item->>'policyId')::uuid;select status into ws from public.workflow_runs where id=(item->>'workflowRunId')::uuid and business_id=p_business_id;
 select coalesce(jsonb_agg(jsonb_build_object('outcomeId',id,'kind',kind,'phase',phase,'requestId',request_id,'reason',reason,'observation',observation,'createdAt',created_at) order by created_at,id),'[]'::jsonb) into events from private.r11_research_outcomes where policy_id=pid;
 item:=item||jsonb_build_object('receiptChecks',coalesce((select jsonb_agg(private.r11_research_receipt_status(c) order by c.phase) from private.r11_research_receipt_candidates c where c.policy_id=pid),'[]'::jsonb),'attemptVersion',case when exists(select 1 from private.r11_research_attempts where policy_id=pid) then 2 else 1 end,'operations',private.r11_research_operation_keys(pid),'outcomes',events,'terminalReconciliationRequired',(item->>'revoked')::boolean and ws in ('queued','running','waiting','review') and item->'result'='null'::jsonb);
 if item->'result'='null'::jsonb and ws in ('needs_owner','cancelled','failed') then item:=item||jsonb_build_object('status',ws);end if;
 policies:=policies||jsonb_build_array(item);
 end loop;
 return answer||jsonb_build_object('policies',policies,'continuation',private.r11_research_continuation_context(p_business_id),
 'continuationGrantTotal',(select count(*) from private.r11_research_continuation_grants where business_id=p_business_id and owner_id=auth.uid()),'continuationGrants',coalesce((select jsonb_agg(grant_rows.item order by grant_rows.created_at desc,grant_rows.id desc) from (
 select g.id,g.created_at,jsonb_build_object('grantId',g.id,'grantHash',g.grant_hash,'grant',g.grant_json,'used',exists(select 1 from private.r11_research_attempts where grant_id=g.id),'expired',now()>=(g.grant_json->'researchPolicy'->>'validUntil')::timestamptz,'revoked',exists(select 1 from private.r11_research_continuation_revocations where grant_id=g.id)) item from private.r11_research_continuation_grants g where g.business_id=p_business_id and g.owner_id=auth.uid() order by g.created_at desc,g.id desc limit 25) grant_rows),'[]'::jsonb));
end $$;


-- Existing public server_v2/workspace_v2 ACLs are retained by replacement.
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'r11_research_receipt_%' loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);end loop;
end $$;
commit;
