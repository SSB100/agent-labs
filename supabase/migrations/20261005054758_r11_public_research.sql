-- R11 public-research definitions only. No policy, authority key, grant or paid call is seeded.
-- Historical R05 functions, ACLs and financial ledgers remain unchanged.
begin;
create table private.r11_research_policies(
 id uuid primary key,business_id uuid not null references public.businesses(id),owner_id uuid not null references auth.users(id),
 workflow_run_id uuid not null,goal_id uuid not null,operating_policy_id uuid not null,
 policy jsonb not null,policy_canonical text not null,policy_hash text not null check(policy_hash ~ '^[a-f0-9]{64}$'),
 search_request_hash text not null check(search_request_hash ~ '^[a-f0-9]{64}$'),search_wire_hash text not null check(search_wire_hash ~ '^[a-f0-9]{64}$'),
 search_wire_bytes integer not null check(search_wire_bytes between 1 and 8192),search_max_tokens integer not null check(search_max_tokens=4000),
 authority_key_hash text references private.r05_server_keys(key_hash),
 created_at timestamptz not null default clock_timestamp(),unique(id,business_id),
 foreign key(workflow_run_id,business_id) references public.workflow_runs(id,business_id),
 foreign key(goal_id,business_id) references public.goals(id,business_id),
 foreign key(operating_policy_id,business_id) references private.r05_policies(id,business_id),
 check(octet_length(policy_canonical)<=65536 and policy_canonical::jsonb=policy),
 check(encode(extensions.digest(convert_to(policy_canonical,'UTF8'),'sha256'),'hex')=policy_hash)
);
create table private.r11_research_revocations(
 policy_id uuid primary key references private.r11_research_policies(id),created_at timestamptz not null default clock_timestamp()
);
create table private.r11_research_collections(
 id uuid primary key default gen_random_uuid(),business_id uuid not null,policy_id uuid not null,search_request_id uuid not null unique,
 provider_request_id text not null check(length(provider_request_id) between 3 and 300),
 collection jsonb not null,collection_canonical text not null,collection_hash text not null check(collection_hash ~ '^[a-f0-9]{64}$'),
 lineage jsonb not null,lineage_canonical text not null,lineage_hash text not null check(lineage_hash ~ '^[a-f0-9]{64}$'),
 selector_request_hash text not null check(selector_request_hash ~ '^[a-f0-9]{64}$'),selector_wire_hash text not null check(selector_wire_hash ~ '^[a-f0-9]{64}$'),
 selector_wire_bytes integer not null check(selector_wire_bytes between 1 and 16384),selector_max_tokens integer not null check(selector_max_tokens=1000),
 producer_key_hash text not null references private.r05_server_keys(key_hash),created_at timestamptz not null default clock_timestamp(),
 unique(id,business_id),unique(policy_id),foreign key(policy_id,business_id) references private.r11_research_policies(id,business_id),
 foreign key(search_request_id,business_id) references private.r05_requests(id,business_id),
 check(octet_length(collection_canonical)<=65536 and collection_canonical::jsonb=collection),
 check(octet_length(lineage_canonical)<=8192 and lineage_canonical::jsonb=lineage),
 check(encode(extensions.digest(convert_to(collection_canonical,'UTF8'),'sha256'),'hex')=collection_hash),
 check(encode(extensions.digest(convert_to(lineage_canonical,'UTF8'),'sha256'),'hex')=lineage_hash)
);
create table private.r11_research_bindings(
 request_id uuid primary key,business_id uuid not null,policy_id uuid not null,phase text not null check(phase in ('search','select')),
 collection_id uuid,descriptor_hash text not null check(descriptor_hash ~ '^[a-f0-9]{64}$'),
 logical_request_hash text not null check(logical_request_hash ~ '^[a-f0-9]{64}$'),wire_hash text not null check(wire_hash ~ '^[a-f0-9]{64}$'),
 admission_key_hash text not null references private.r05_server_keys(key_hash),created_at timestamptz not null default clock_timestamp(),
 unique(policy_id,phase),foreign key(request_id,business_id) references private.r05_requests(id,business_id),
 foreign key(policy_id,business_id) references private.r11_research_policies(id,business_id),
 foreign key(collection_id,business_id) references private.r11_research_collections(id,business_id),
 check((phase='search' and collection_id is null) or (phase='select' and collection_id is not null))
);
create function private.r11_research_history_guard() returns trigger language plpgsql set search_path='' as $$ begin
 if current_user in ('anon','authenticated','service_role') then raise exception 'r11_research_guarded_rpc_required' using errcode='42501'; end if;
 if tg_op<>'INSERT' then raise exception 'r11_research_immutable_history'; end if;return new;
end $$;
do $$ declare t text;begin
 foreach t in array array['r11_research_policies','r11_research_revocations','r11_research_collections','r11_research_bindings'] loop
 execute format('alter table private.%I enable row level security',t);
 execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger r11_research_guard before insert or update or delete on private.%I for each row execute function private.r11_research_history_guard()',t);
 end loop;
end $$;
create function private.r11_research_policy_validate() returns trigger language plpgsql set search_path='' as $$
declare p jsonb:=new.policy; d jsonb; x jsonb; k text;begin
 perform private.r04_keys(p,array['version','id','businessId','ownerId','workflowRunId','goalId','operatingPolicyId','query','allowedDomains','excludedDomains','sourceReviews','queryReviewHash','termsReviewHash','independentReviewHash','approvalHash','modelId','providerEndpoint','recipients','retention','validFrom','validUntil','maximumMicrousd','searchMicrousd','selectorMicrousd','priceLimit','quoteHash','quoteValidUntil']);
 if p->>'version' is distinct from 'r11.public-research.1' or p->>'id' is distinct from new.id::text or p->>'businessId' is distinct from new.business_id::text or p->>'ownerId' is distinct from new.owner_id::text or p->>'workflowRunId' is distinct from new.workflow_run_id::text or p->>'goalId' is distinct from new.goal_id::text or p->>'operatingPolicyId' is distinct from new.operating_policy_id::text then raise exception 'r11_research_policy_binding';end if;
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
 return new;
end $$;
create trigger r11_research_validate before insert on private.r11_research_policies for each row execute function private.r11_research_policy_validate();
create function private.r11_research_revoke_lock() returns trigger language plpgsql set search_path='' as $$ declare b uuid;begin
 select business_id into b from private.r11_research_policies where id=new.policy_id;
 perform 1 from public.businesses where id=b for update;
 perform 1 from private.r11_research_policies where id=new.policy_id for update;return new;
end $$;
create trigger r11_research_revoke_lock before insert on private.r11_research_revocations for each row execute function private.r11_research_revoke_lock();
create function private.r11_research_key(h text) returns void language plpgsql set search_path='' as $$ begin
 perform 1 from private.r05_server_keys where key_hash=h for share;
 if not found or not exists(select 1 from private.r05_server_keys k where k.key_hash=h and k.expires_at>clock_timestamp() and not exists(select 1 from private.r05_server_revocations z where z.key_hash=h)) then raise exception 'r11_research_authority_required' using errcode='42501';end if;
end $$;
create function private.r11_research_active(b uuid,pid uuid) returns private.r11_research_policies language plpgsql set search_path='' as $$
declare p private.r11_research_policies;owner_id uuid;w public.workflow_runs;f private.r05_policies;begin
 select owner_user_id into owner_id from public.businesses where id=b for update;
 select * into p from private.r11_research_policies where id=pid and business_id=b for share;
 if p.id is null or owner_id is distinct from p.owner_id or exists(select 1 from private.r11_research_revocations where policy_id=p.id) or private.r11_research_activation_revoked(p.id) or clock_timestamp()<(p.policy->>'validFrom')::timestamptz or clock_timestamp()>=(p.policy->>'validUntil')::timestamptz or clock_timestamp()>=(p.policy->>'quoteValidUntil')::timestamptz then raise exception 'r11_research_policy_inactive';end if;
 select * into w from public.workflow_runs where id=p.workflow_run_id and business_id=b for share;
 select * into f from private.r05_policies where id=p.operating_policy_id and business_id=b for share;
 if w.id is null or w.goal_id is distinct from p.goal_id or w.status not in ('queued','running','waiting','review') or f.actor_id is distinct from p.owner_id or f.goal_id is distinct from p.goal_id or not exists(select 1 from private.r05_confirmations where policy_id=f.id and actor_id=p.owner_id) or exists(select 1 from private.r05_revocations where policy_id=f.id) then raise exception 'r11_research_operating_scope';end if;
 return p;
end $$;
create function private.r11_research_collection_active(p private.r11_research_policies,cid uuid) returns private.r11_research_collections language plpgsql set search_path='' as $$
declare c private.r11_research_collections;r private.r05_requests;s jsonb;begin
 select * into c from private.r11_research_collections where id=cid and policy_id=p.id and business_id=p.business_id for share;
 if c.id is null then raise exception 'r11_research_collection_unavailable';end if;
 perform private.r11_research_key(c.producer_key_hash);
 select * into r from private.r05_requests where id=c.search_request_id and business_id=p.business_id;
 if not exists(select 1 from private.r11_research_bindings v join private.r05_markers m on m.request_id=v.request_id where v.request_id=r.id and v.policy_id=p.id and v.phase='search') or r.workflow_run_id<>p.workflow_run_id or r.policy_id<>p.operating_policy_id or not exists(select 1 from private.r05_settlements z where z.request_id=r.id and z.provider_request_id=c.provider_request_id and z.actual_microunits is not null) or exists(select 1 from private.r05_settlements z where z.request_id=r.id and z.actual_microunits>(p.policy->>'searchMicrousd')::bigint) or not exists(select 1 from private.r05_receipt_claims q where q.provider='openrouter' and q.provider_request_id=c.provider_request_id and q.business_id=p.business_id and q.workflow_run_id=p.workflow_run_id and q.source_key=r.source_key) then raise exception 'r11_research_search_receipt_required';end if;
 for s in select value from jsonb_array_elements(c.collection->'sources') loop
 if jsonb_typeof(s->'retrievedAt') is distinct from 'string' or jsonb_typeof(s->'retrievalExpiresAt') is distinct from 'string' or not isfinite((s->>'retrievedAt')::timestamptz) or not isfinite((s->>'retrievalExpiresAt')::timestamptz) or clock_timestamp()>=(s->>'retrievalExpiresAt')::timestamptz or (s->>'retrievedAt')::timestamptz>clock_timestamp()+interval '5 minutes' then raise exception 'r11_research_collection_expired';end if;end loop;
 return c;
end $$;
-- The trusted producer canonicalizes URLs; reject credential/tracker query keys
-- again in storage, including percent-encoded spellings, before model ingestion.
create function private.r11_research_url_query_safe(u text) returns boolean language plpgsql immutable set search_path='' as $$
declare part text;raw_key text;decoded_key text;octets bytea;i integer;ch text;begin
 if position('?' in u)=0 then return true;end if;
 for part in select value from regexp_split_to_table(substring(u from position('?' in u)+1),'&') value loop
 raw_key:=split_part(part,'=',1);octets:=''::bytea;i:=1;
 while i<=length(raw_key) loop
 ch:=substring(raw_key from i for 1);
 if ch='%' then
 if substring(raw_key from i+1 for 2) !~ '^[a-fA-F0-9]{2}$' then return false;end if;
 octets:=octets||decode(substring(raw_key from i+1 for 2),'hex');i:=i+3;
 else octets:=octets||convert_to(case when ch='+' then ' ' else ch end,'UTF8');i:=i+1;end if;
 end loop;
 decoded_key:=convert_from(octets,'UTF8');
 if decoded_key ~* '^(token|access_token|api_key|auth|password|fbclid|gclid)$|^utm_' then return false;end if;
 end loop;return true;
end $$;
create function private.r11_research_descriptor(p private.r11_research_policies,phase text,c private.r11_research_collections,a jsonb) returns void language plpgsql set search_path='' as $$
declare logical text;wire text;bytes integer;tokens integer;amount bigint;begin
 if phase='search' then logical:=p.search_request_hash;wire:=p.search_wire_hash;bytes:=p.search_wire_bytes;tokens:=p.search_max_tokens;amount:=(p.policy->>'searchMicrousd')::bigint;
 elsif phase='select' and c.id is not null then logical:=c.selector_request_hash;wire:=c.selector_wire_hash;bytes:=c.selector_wire_bytes;tokens:=c.selector_max_tokens;amount:=(p.policy->>'selectorMicrousd')::bigint;
 else raise exception 'r11_research_phase_invalid';end if;
 if a->>'workflowRunId' is distinct from p.workflow_run_id::text or a->>'operationKey' is distinct from (case when phase='search' then 'research.search' else 'research.model' end) or a->>'requestHash' is distinct from logical or a->>'wireRequestHash' is distinct from wire or a->'wireRequestBytes' is distinct from to_jsonb(bytes) or a->'maximumOutputTokens' is distinct from to_jsonb(tokens) or a->>'providerModelId' is distinct from p.policy->>'modelId' or a->>'idempotencyKey' is distinct from 'r11:'||p.id||':'||phase or a->'accounting' is distinct from '{"kind":"r05"}'::jsonb or a->'sourceDomains' is distinct from p.policy->'allowedDomains' or a->'dataClasses' is distinct from '["generic_public_query","public_evidence"]'::jsonb or a->'accountId' is distinct from 'null'::jsonb or a->'accountRevision' is distinct from 'null'::jsonb or a->>'currency' is distinct from 'USD' or a->'liabilityMicrounits' is distinct from to_jsonb(amount::text) then raise exception 'r11_research_descriptor_mismatch';end if;
end $$;
create function private.r11_research_marker() returns trigger language plpgsql set search_path='' as $$
declare r private.r05_requests;v private.r11_research_bindings;p private.r11_research_policies;c private.r11_research_collections;o private.r05_operations;reason text;begin
 select * into r from private.r05_requests where id=new.request_id and business_id=new.business_id;
 select * into o from private.r05_operations where operation_key=r.payload->>'operationKey';
 if r.payload->>'operationKey' not in ('research.search','research.model') then
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
 return new;
end $$;
create trigger r11_research_source_marker before insert on private.r05_markers for each row execute function private.r11_research_marker();
create function public.r11_research_revoke(p_business_id uuid,p_policy_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$ declare session_id uuid:=private.r11_auth_session();begin
 perform private.r05_owner(p_business_id);
 perform 1 from auth.sessions where id=session_id and user_id=auth.uid() for share;
 if not private.r11_session(auth.uid(),session_id) then raise exception 'r11_research_owner_session_required' using errcode='42501';end if;
 perform 1 from private.r11_research_policies where id=p_policy_id and business_id=p_business_id for update;
 if not found then raise exception 'r11_research_policy_unavailable';end if;
 if not private.r11_session(auth.uid(),session_id) then raise exception 'r11_research_owner_session_required' using errcode='42501';end if;
 insert into private.r11_research_revocations(policy_id) values(p_policy_id) on conflict do nothing;
 return jsonb_build_object('policyId',p_policy_id,'revoked',true);
end $$;
create function public.r11_research_server(p_business_id uuid,p_operation text,p_payload jsonb,p_server_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.r11_research_policies;c private.r11_research_collections;r private.r05_requests;v private.r11_research_bindings;key_hash text;result jsonb;a jsonb;phase_name text;k text;s jsonb;e jsonb;url text;host text;found_source boolean;begin
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
 perform private.r04_keys(p_payload,array['policyId','phase','collectionId','admission']);a:=p_payload->'admission';phase_name:=p_payload->>'phase';
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
 if v.request_id<>r.id or v.collection_id is distinct from c.id or v.descriptor_hash<>r.request_hash or v.logical_request_hash is distinct from a->>'requestHash' or v.wire_hash is distinct from a->>'wireRequestHash' or v.admission_key_hash<>key_hash then raise exception 'r11_research_phase_already_bound';end if;
 else insert into private.r11_research_bindings(request_id,business_id,policy_id,phase,collection_id,descriptor_hash,logical_request_hash,wire_hash,admission_key_hash) values(r.id,p_business_id,p.id,phase_name,c.id,r.request_hash,a->>'requestHash',a->>'wireRequestHash',key_hash);end if;
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
 if p_payload->'lineage' is distinct from jsonb_build_object('version','r11.public-research.1','policyId',p.id,'policyHash',p.policy_hash,'collectionHash',p_payload->>'collectionHash','searchRequestId',r.id,'providerRequestId',p_payload->>'providerRequestId','sourceDomains',p.policy->'allowedDomains') then raise exception 'r11_research_lineage_mismatch';end if;
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
-- Owner proof admission remains disabled until an administrator installs one exact,
-- independently reviewed grant. Neither authenticated owners nor the server key
-- can mint a grant or change its source/financial scope.
create table private.r11_research_grants(
 id uuid primary key,business_id uuid not null references public.businesses(id),owner_id uuid not null references auth.users(id),
 grant_json jsonb not null,grant_canonical text not null,grant_hash text not null check(grant_hash ~ '^[a-f0-9]{64}$'),created_at timestamptz not null default clock_timestamp(),
 check(octet_length(grant_canonical)<=65536 and grant_canonical::jsonb=grant_json),
 check(encode(extensions.digest(convert_to(grant_canonical,'UTF8'),'sha256'),'hex')=grant_hash)
);
create table private.r11_research_grant_revocations(grant_id uuid primary key references private.r11_research_grants(id),created_at timestamptz not null default clock_timestamp());
create table private.r11_research_activations(
 grant_id uuid primary key references private.r11_research_grants(id),policy_id uuid not null unique references private.r11_research_policies(id),
 actor_id uuid not null references auth.users(id),grant_hash text not null,created_at timestamptz not null default clock_timestamp()
);
create table private.r11_research_results(
 id uuid primary key default gen_random_uuid(),business_id uuid not null,policy_id uuid not null unique,collection_id uuid not null,
 selector_request_id uuid not null unique,provider_request_id text not null,selection jsonb not null,
 evidence_pack jsonb not null,evidence_pack_canonical text not null,evidence_pack_hash text not null check(evidence_pack_hash ~ '^[a-f0-9]{64}$'),
 producer_key_hash text not null references private.r05_server_keys(key_hash),created_at timestamptz not null default clock_timestamp(),
 foreign key(policy_id,business_id) references private.r11_research_policies(id,business_id),
 foreign key(collection_id,business_id) references private.r11_research_collections(id,business_id),
 foreign key(selector_request_id,business_id) references private.r05_requests(id,business_id),
 check(octet_length(evidence_pack_canonical)<=65536 and evidence_pack_canonical::jsonb=evidence_pack),
 check(encode(extensions.digest(convert_to(evidence_pack_canonical,'UTF8'),'sha256'),'hex')=evidence_pack_hash)
);
do $$ declare t text;begin
 foreach t in array array['r11_research_grants','r11_research_grant_revocations','r11_research_activations','r11_research_results'] loop
 execute format('alter table private.%I enable row level security',t);
 execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger r11_research_guard before insert or update or delete on private.%I for each row execute function private.r11_research_history_guard()',t);
 end loop;
end $$;
create function private.r11_research_activation_revoked(pid uuid) returns boolean language sql stable set search_path='' as $$ select exists(select 1 from private.r11_research_activations a join private.r11_research_grant_revocations r on r.grant_id=a.grant_id where a.policy_id=pid) $$;
create function private.r11_research_grant_validate() returns trigger language plpgsql set search_path='' as $$
declare g jsonb:=new.grant_json;p jsonb:=g->'researchPolicy';f jsonb:=g->'operatingPolicy';x jsonb;o private.r05_operations;k text;begin
 perform private.r04_keys(g,array['version','id','businessId','ownerId','policyId','workflowRunId','runtimeCapabilityHash','serverKeyHash','installationId','installationSnapshotHash','workflowDefinitionId','businessContent','goalContent','operatingPolicy','researchPolicy','search','interpretationHash','approvalHash']);
 if g->>'version' is distinct from 'r11.owner-proof-grant.1' or g->>'id' is distinct from new.id::text or g->>'businessId' is distinct from new.business_id::text or g->>'ownerId' is distinct from new.owner_id::text then raise exception 'r11_research_grant_binding';end if;
 foreach k in array array['runtimeCapabilityHash','serverKeyHash','installationSnapshotHash','interpretationHash','approvalHash'] loop if coalesce(g->>k,'') !~ '^[a-f0-9]{64}$' then raise exception 'r11_research_grant_hash';end if;end loop;
 foreach k in array array['policyId','workflowRunId','installationId','workflowDefinitionId'] loop if jsonb_typeof(g->k) is distinct from 'string' or (g->>k)::uuid is null then raise exception 'r11_research_grant_id';end if;end loop;
 if not exists(select 1 from public.installed_packs where id=(g->>'installationId')::uuid and business_id=new.business_id and status='active' and private.r04_hash(snapshot)=g->>'installationSnapshotHash') then raise exception 'r11_research_installation_snapshot';end if;
 perform private.r04_business_content(g->'businessContent');perform private.r04_quest_content(g->'goalContent');perform private.r04_parsed(g->'goalContent'->'parsed',true);
 if g->'goalContent'->'ambiguities' is distinct from '[]'::jsonb then raise exception 'r11_research_grant_intent';end if;
 perform private.r04_keys(f,array['version','goalRevision','businessRevision','currency','businessLifetimeLimitMicrounits','policyLimitMicrounits','categoryLimits','expectedCapRevision','expectedExposureMicrounits','startsAt','expiresAt','maximumDispatches','minimumIntervalSeconds','stopOnTarget','operations','financialMode']);
 if f->'goalRevision' is distinct from '2'::jsonb or f->'businessRevision' is distinct from '1'::jsonb or f->'expectedCapRevision' is distinct from '0'::jsonb or f->'maximumDispatches' is distinct from '2'::jsonb or f->'minimumIntervalSeconds' is distinct from '0'::jsonb or f->>'policyLimitMicrounits' is distinct from '250000' or private.r05_money(f->'businessLifetimeLimitMicrounits')<>private.r05_money(f->'expectedExposureMicrounits')+250000 then raise exception 'r11_research_grant_financial_scope';end if;
 if p ?| array['id','businessId','ownerId','workflowRunId','goalId','operatingPolicyId'] or p->'maximumMicrousd' is distinct from '250000'::jsonb or p->>'approvalHash' is distinct from g->>'approvalHash' or jsonb_typeof(p->'validFrom') is distinct from 'string' or jsonb_typeof(p->'validUntil') is distinct from 'string' or jsonb_typeof(p->'quoteValidUntil') is distinct from 'string' or not isfinite((p->>'validFrom')::timestamptz) or not isfinite((p->>'validUntil')::timestamptz) or (p->>'validUntil')::timestamptz<=(p->>'validFrom')::timestamptz or (p->>'validUntil')::timestamptz>(p->>'validFrom')::timestamptz+interval '5 minutes' or (p->>'quoteValidUntil')::timestamptz>(p->>'validFrom')::timestamptz+interval '5 minutes' or f->>'startsAt' is distinct from p->>'validFrom' or f->>'expiresAt' is distinct from p->>'validUntil' then raise exception 'r11_research_grant_window';end if;
 if not exists(select 1 from private.r05_server_keys where key_hash=g->>'serverKeyHash' and expires_at>(p->>'validUntil')::timestamptz and expires_at<=(p->>'validUntil')::timestamptz+interval '30 minutes') then raise exception 'r11_research_grant_key_window';end if;
 perform private.r04_keys(g->'search',array['requestHash','wireHash','wireBytes','maxTokens']);
 if jsonb_array_length(f->'operations')<>2 then raise exception 'r11_research_grant_operations';end if;
 for x in select value from jsonb_array_elements(f->'operations') loop
 select * into o from private.r05_operations where operation_key=x->>'operationKey';
 if o.operation_key not in ('research.search','research.model') or o.operation_key is null or x->>'installationId' is distinct from g->>'installationId' or x->>'workflowDefinitionId' is distinct from g->>'workflowDefinitionId' or x->'accountId' is distinct from 'null'::jsonb or x->'accountRevision' is distinct from 'null'::jsonb or x->'sourceDomains' is distinct from p->'allowedDomains' or x->'dataClasses' is distinct from '["generic_public_query","public_evidence"]'::jsonb or o.provider_model_id is distinct from p->>'modelId' or o.quote_hash is distinct from p->>'quoteHash' or o.valid_from>(p->>'validFrom')::timestamptz or o.valid_until<(p->>'validUntil')::timestamptz or o.valid_until>o.valid_from+interval '5 minutes' or o.liability_microunits<>(p->>case when o.operation_key='research.search' then 'searchMicrousd' else 'selectorMicrousd' end)::bigint then raise exception 'r11_research_grant_operation_scope';end if;
 end loop;return new;
end $$;
create trigger r11_research_grant_validate before insert on private.r11_research_grants for each row execute function private.r11_research_grant_validate();
create function private.r11_research_grant_revoke_lock() returns trigger language plpgsql set search_path='' as $$ declare b uuid;begin
 select business_id into b from private.r11_research_grants where id=new.grant_id;perform 1 from public.businesses where id=b for update;perform 1 from private.r11_research_grants where id=new.grant_id for update;return new;
end $$;
create trigger r11_research_grant_revoke_lock before insert on private.r11_research_grant_revocations for each row execute function private.r11_research_grant_revoke_lock();
create function public.r11_research_bootstrap(p_business_id uuid,p_grant_id uuid,p_grant_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare g private.r11_research_grants;a private.r11_research_activations;j jsonb;p jsonb;f jsonb;goal uuid;op jsonb;w public.installed_packs;canon text;session_id uuid:=private.r11_auth_session();begin
 perform private.r05_owner(p_business_id);
 perform 1 from auth.sessions where id=session_id and user_id=auth.uid() for share;
 if not private.r11_session(auth.uid(),session_id) then raise exception 'r11_research_owner_session_required' using errcode='42501';end if;
 select * into g from private.r11_research_grants where id=p_grant_id and business_id=p_business_id and owner_id=auth.uid() for share;
 if g.id is null or g.grant_hash is distinct from p_grant_hash then raise exception 'r11_research_exact_grant_required';end if;
 select * into a from private.r11_research_activations where grant_id=g.id;
 if a.grant_id is not null then return jsonb_build_object('policyId',a.policy_id,'workflowRunId',g.grant_json->>'workflowRunId','replayed',true);end if;
 j:=g.grant_json;p:=j->'researchPolicy';
 if exists(select 1 from private.r11_research_grant_revocations where grant_id=g.id) or clock_timestamp()<(p->>'validFrom')::timestamptz or clock_timestamp()>=(p->>'validUntil')::timestamptz then raise exception 'r11_research_grant_inactive';end if;
 perform private.r11_research_key(j->>'serverKeyHash');
 -- This entrypoint initializes only absent current authority. Never reset a
 -- Business, replace current intent, rename a historical root or reuse its cap.
 if exists(select 1 from private.r04_business_state where business_id=p_business_id) or exists(select 1 from private.r04_goal_state where business_id=p_business_id) or exists(select 1 from private.r05_policies where business_id=p_business_id) or exists(select 1 from private.r05_cap_versions where business_id=p_business_id) or exists(select 1 from private.r11_research_activations x join private.r11_research_grants y on y.id=x.grant_id where y.business_id=p_business_id) then raise exception 'r11_research_bootstrap_requires_empty_current_authority';end if;
 select * into w from public.installed_packs where id=(j->>'installationId')::uuid and business_id=p_business_id and status='active' for share;
 if w.id is null or private.r04_hash(w.snapshot) is distinct from j->>'installationSnapshotHash' then raise exception 'r11_research_installation_unavailable';end if;
 perform 1 from public.packs where id=w.root_pack_id and status='qualified' for share;
 if not found then raise exception 'r11_research_pack_unavailable';end if;
 perform 1 from public.workflow_definitions where id=(j->>'workflowDefinitionId')::uuid and pack_id=w.root_pack_id and status='qualified' for share;
 if not found then raise exception 'r11_research_workflow_unavailable';end if;
 perform public.r04_quest_transition(p_business_id,'business.save',jsonb_build_object('expectedRevision',0,'content',j->'businessContent','preference','setup'),gen_random_uuid());
 op:=public.r04_quest_transition(p_business_id,'quest.save',jsonb_build_object('goalId',null,'expectedRevision',0,'content',j->'goalContent'),gen_random_uuid());goal:=(op->>'id')::uuid;
 perform public.r04_quest_transition(p_business_id,'quest.preference',jsonb_build_object('goalId',goal,'expectedRevision',1,'preference','ready'),gen_random_uuid());
 perform public.r04_quest_transition(p_business_id,'quest.select',jsonb_build_object('goalId',goal,'expectedRevision',2),gen_random_uuid());
 insert into public.workflow_runs(id,business_id,goal_id,workflow_definition_id,idempotency_key,status,runtime_capability_hash,pack_installation_id,pack_snapshot)
 values((j->>'workflowRunId')::uuid,p_business_id,goal,(j->>'workflowDefinitionId')::uuid,'r11-owner-proof:'||g.id,'running',j->>'runtimeCapabilityHash',w.id,w.snapshot);
 f:=(j->'operatingPolicy')||jsonb_build_object('goalId',goal);
 op:=public.r05_policy_owner(p_business_id,'propose',f,gen_random_uuid());
 perform public.r05_policy_owner(p_business_id,'confirm',jsonb_build_object('policyId',op->>'id','policyHash',op->>'hash'),gen_random_uuid());
 insert into private.r05_policy_proofs(policy_id,policy_hash,evidence_hash,valid_until) values((op->>'id')::uuid,op->>'hash',j->>'interpretationHash',(p->>'validUntil')::timestamptz);
 p:=p||jsonb_build_object('id',j->>'policyId','businessId',p_business_id,'ownerId',auth.uid(),'workflowRunId',j->>'workflowRunId','goalId',goal,'operatingPolicyId',op->>'id');canon:=private.stage14_canonical(p);
 insert into private.r11_research_policies(id,business_id,owner_id,workflow_run_id,goal_id,operating_policy_id,policy,policy_canonical,policy_hash,search_request_hash,search_wire_hash,search_wire_bytes,search_max_tokens,authority_key_hash)
 values((j->>'policyId')::uuid,p_business_id,auth.uid(),(j->>'workflowRunId')::uuid,goal,(op->>'id')::uuid,p,canon,encode(extensions.digest(convert_to(canon,'UTF8'),'sha256'),'hex'),j->'search'->>'requestHash',j->'search'->>'wireHash',(j->'search'->>'wireBytes')::integer,(j->'search'->>'maxTokens')::integer,j->>'serverKeyHash');
 -- Recheck after every possible wait. Failure rolls back all owner transitions.
 perform private.r11_research_key(j->>'serverKeyHash');perform private.r11_research_active(p_business_id,(j->>'policyId')::uuid);
 if not private.r11_session(auth.uid(),session_id) then raise exception 'r11_research_owner_session_required' using errcode='42501';end if;
 insert into private.r11_research_activations(grant_id,policy_id,actor_id,grant_hash) values(g.id,(j->>'policyId')::uuid,auth.uid(),g.grant_hash);
 return jsonb_build_object('policyId',j->>'policyId','workflowRunId',j->>'workflowRunId','replayed',false);
end $$;
-- Completing a dispatched run is accounting/audit persistence, not new dispatch
-- authority. A late valid response may be retained after Stop or policy expiry,
-- within the separately bounded key settlement grace. No marker is created here.
create function private.r11_research_complete(b uuid,a jsonb,key_hash text) returns jsonb language plpgsql set search_path='' as $$
declare p private.r11_research_policies;c private.r11_research_collections;r private.r05_requests;v private.r11_research_bindings;prior private.r11_research_results;
 selection jsonb;item jsonb;source jsonb;ev jsonb;evs jsonb:='[]';sources jsonb;claims jsonb:='[]';limits jsonb:='["publication_dates_unknown"]';pack jsonb;k text;begin
 perform private.r04_keys(a,array['policyId','collectionId','selectorRequestId','providerRequestId','selection','evidencePack','evidencePackCanonical','evidencePackHash']);
 foreach k in array array['policyId','collectionId','selectorRequestId','providerRequestId','evidencePackCanonical','evidencePackHash'] loop if jsonb_typeof(a->k) is distinct from 'string' then raise exception 'r11_research_result_type';end if;end loop;
 if length(a->>'providerRequestId') not between 3 and 300 or jsonb_typeof(a->'selection') is distinct from 'object' or jsonb_typeof(a->'evidencePack') is distinct from 'object' then raise exception 'r11_research_result_type';end if;
 select * into p from private.r11_research_policies where id=(a->>'policyId')::uuid and business_id=b for share;
 if p.id is null or not exists(select 1 from public.businesses where id=b and owner_user_id=p.owner_id) or (p.authority_key_hash is not null and p.authority_key_hash<>key_hash) then raise exception 'r11_research_result_scope';end if;
 select * into c from private.r11_research_collections where id=(a->>'collectionId')::uuid and policy_id=p.id and business_id=b;
 select * into r from private.r05_requests where id=(a->>'selectorRequestId')::uuid and business_id=b;
 select * into v from private.r11_research_bindings where policy_id=p.id and phase='select';
 if c.id is null or r.id is null or v.request_id is distinct from r.id or v.collection_id is distinct from c.id or v.admission_key_hash<>key_hash or c.producer_key_hash<>key_hash or r.policy_id is distinct from p.operating_policy_id or r.workflow_run_id<>p.workflow_run_id or not exists(select 1 from private.r05_markers where request_id=r.id) then raise exception 'r11_research_selector_receipt_required';end if;
 -- Both receipts must be claimed by these exact requests; null/over-cap reports
 -- cannot be converted into a successful proof by submitting output alone.
 if not exists(select 1 from private.r05_settlements z where z.request_id=r.id and z.provider_request_id=a->>'providerRequestId' and z.actual_microunits is not null) or exists(select 1 from private.r05_settlements z where z.request_id=r.id and z.actual_microunits>(p.policy->>'selectorMicrousd')::bigint) or not exists(select 1 from private.r05_receipt_claims q where q.provider='openrouter' and q.provider_request_id=a->>'providerRequestId' and q.business_id=b and q.workflow_run_id=p.workflow_run_id and q.source_key=r.source_key) then raise exception 'r11_research_selector_receipt_required';end if;
 select * into r from private.r05_requests where id=c.search_request_id and business_id=b;
 if not exists(select 1 from private.r11_research_bindings z join private.r05_markers m on m.request_id=z.request_id where z.policy_id=p.id and z.phase='search' and z.request_id=r.id) or not exists(select 1 from private.r05_settlements z where z.request_id=r.id and z.provider_request_id=c.provider_request_id and z.actual_microunits is not null) or exists(select 1 from private.r05_settlements z where z.request_id=r.id and z.actual_microunits>(p.policy->>'searchMicrousd')::bigint) or not exists(select 1 from private.r05_receipt_claims q where q.provider='openrouter' and q.provider_request_id=c.provider_request_id and q.business_id=b and q.workflow_run_id=p.workflow_run_id and q.source_key=r.source_key) then raise exception 'r11_research_search_receipt_required';end if;
 selection:=a->'selection';perform private.r04_keys(selection,array['selections','limitations']);
 if jsonb_typeof(selection->'selections') is distinct from 'array' or jsonb_array_length(selection->'selections') not between 1 and 4 or jsonb_typeof(selection->'limitations') is distinct from 'array' or jsonb_array_length(selection->'limitations')>4 then raise exception 'r11_research_result_selection';end if;
 for item in select value from jsonb_array_elements(selection->'selections') loop
 perform private.r04_keys(item,array['sourceKey','quote']);
 if jsonb_typeof(item->'sourceKey') is distinct from 'string' or item->>'sourceKey' !~ '^S[1-4]$' or jsonb_typeof(item->'quote') is distinct from 'string' or length(item->>'quote') not between 20 and 320 or btrim(item->>'quote',E' \t\n\r\f\v'||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279))<>item->>'quote' then raise exception 'r11_research_result_selection';end if;
 source:=c.collection->'sources'->(substring(item->>'sourceKey' from 2)::integer-1);
 if source is null or position(item->>'quote' in source->>'excerpt')=0 then raise exception 'r11_research_result_attribution';end if;
 ev:=jsonb_build_object('id','evi-'||left(encode(extensions.digest(convert_to((source->>'id')||':'||(item->>'quote'),'UTF8'),'sha256'),'hex'),24),'sourceId',source->>'id','quote',item->>'quote');
 if exists(select 1 from jsonb_array_elements(evs) e where e->>'id'=ev->>'id') then raise exception 'r11_research_result_duplicate';end if;
 evs:=evs||jsonb_build_array(ev);claims:=claims||jsonb_build_array(jsonb_build_object('text',ev->>'quote','evidenceId',ev->>'id','sourceId',ev->>'sourceId'));
 end loop;
 if (select count(distinct value) from jsonb_array_elements(selection->'limitations'))<>jsonb_array_length(selection->'limitations') then raise exception 'r11_research_result_limitations';end if;
 for item in select value from jsonb_array_elements(selection->'limitations') loop
 if jsonb_typeof(item) is distinct from 'string' or item#>>'{}' not in ('limited_sources','publication_dates_unknown','no_sales_metrics','no_current_prices') then raise exception 'r11_research_result_limitations';end if;
 if not limits @> jsonb_build_array(item) then limits:=limits||jsonb_build_array(item);end if;end loop;
 foreach k in array array['no_sales_metrics','not_profitability_proof'] loop if not limits ? k then limits:=limits||to_jsonb(k);end if;end loop;
 select jsonb_agg(s.value order by s.ord) into sources from jsonb_array_elements(c.collection->'sources') with ordinality s(value,ord) where exists(select 1 from jsonb_array_elements(evs) e where e->>'sourceId'=s.value->>'id');
 pack:=jsonb_build_object('evidencePackVersion','1.0','question',p.policy->>'query','sources',sources,'evidence',evs,'claims',claims,'limitations',limits,'sourceLineage',c.lineage);
 if a->'evidencePack' is distinct from pack or a->>'evidencePackCanonical' is distinct from private.stage14_canonical(pack) or a->>'evidencePackHash' is distinct from private.stage14_hash(pack) then raise exception 'r11_research_result_mismatch';end if;
 select * into prior from private.r11_research_results where policy_id=p.id;
 if prior.id is not null then
 if prior.collection_id<>c.id or prior.selector_request_id<>v.request_id or prior.provider_request_id is distinct from a->>'providerRequestId' or prior.selection is distinct from selection or prior.evidence_pack is distinct from pack or prior.evidence_pack_hash is distinct from a->>'evidencePackHash' or prior.producer_key_hash<>key_hash then raise exception 'r11_research_result_conflict';end if;
 return jsonb_build_object('resultId',prior.id,'evidencePackHash',prior.evidence_pack_hash,'replayed',true);end if;
 perform private.r11_research_key(key_hash);
 insert into private.r11_research_results(business_id,policy_id,collection_id,selector_request_id,provider_request_id,selection,evidence_pack,evidence_pack_canonical,evidence_pack_hash,producer_key_hash)
 values(b,p.id,c.id,v.request_id,a->>'providerRequestId',selection,pack,a->>'evidencePackCanonical',a->>'evidencePackHash',key_hash) returning * into prior;
 update public.workflow_runs set status='completed',completed_at=clock_timestamp() where id=p.workflow_run_id and business_id=b and goal_id=p.goal_id and status in ('queued','running','waiting','review');
 -- The workflow UPDATE may wait. Recheck grace after that final lock wait; an
 -- expired authority rolls back both the immutable result and workflow update.
 perform private.r11_research_key(key_hash);
 return jsonb_build_object('resultId',prior.id,'evidencePackHash',prior.evidence_pack_hash,'replayed',false);
end $$;
create function public.r11_research_workspace(p_business_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare answer jsonb;begin
 if auth.uid() is null or not private.r11_session(auth.uid(),private.r11_auth_session()) or not exists(select 1 from public.businesses where id=p_business_id and owner_user_id=auth.uid()) then raise exception 'r11_research_owner_required' using errcode='42501';end if;
 select jsonb_build_object('businessId',p_business_id,'ownerId',auth.uid(),
 'exposure',jsonb_build_object('currency','USD','heldMicrounits',(select coalesce(sum(held),0)::text from private.r05_exposure(p_business_id) where currency='USD'),'hasUnknown',exists(select 1 from private.r05_exposure(p_business_id) where unknown)),
 'policyTotal',(select count(*) from private.r11_research_policies where business_id=p_business_id),'grantTotal',(select count(*) from private.r11_research_grants where business_id=p_business_id and owner_id=auth.uid()),
 'policies',coalesce((select jsonb_agg(item order by created_at desc,id desc) from (
 select p.id,p.created_at,jsonb_build_object('policyId',p.id,'workflowRunId',p.workflow_run_id,'goalId',p.goal_id,'operatingPolicyId',p.operating_policy_id,'policy',p.policy,'policyHash',p.policy_hash,
 'status',case when rr.id is not null then 'completed' when exists(select 1 from private.r11_research_revocations where policy_id=p.id) or exists(select 1 from private.r05_revocations where policy_id=p.operating_policy_id) or private.r11_research_activation_revoked(p.id) then 'revoked' when now()>=(p.policy->>'validUntil')::timestamptz then 'expired' when exists(select 1 from private.r11_research_bindings v join private.r05_markers m on m.request_id=v.request_id where v.policy_id=p.id and v.phase='select') then 'selection_recording_pending' when c.id is not null then 'collection_ready' when exists(select 1 from private.r11_research_bindings v join private.r05_markers m on m.request_id=v.request_id where v.policy_id=p.id and v.phase='search') then 'search_recording_pending' else 'ready' end,
 'revoked',(exists(select 1 from private.r11_research_revocations where policy_id=p.id) or exists(select 1 from private.r05_revocations where policy_id=p.operating_policy_id) or private.r11_research_activation_revoked(p.id)),'expired',now()>=(p.policy->>'validUntil')::timestamptz,
 'phases',coalesce((select jsonb_agg(jsonb_build_object('phase',v.phase,'requestId',v.request_id,'marked',exists(select 1 from private.r05_markers where request_id=v.request_id),'settled',exists(select 1 from private.r05_settlements where request_id=v.request_id and actual_microunits is not null),'actualMicrounits',(select max(actual_microunits)::text from private.r05_settlements where request_id=v.request_id),'providerRequestId',(select provider_request_id from private.r05_settlements where request_id=v.request_id order by id desc limit 1)) order by v.phase) from private.r11_research_bindings v where v.policy_id=p.id),'[]'::jsonb),
 'result',case when rr.id is null then null else jsonb_build_object('resultId',rr.id,'evidencePack',rr.evidence_pack,'evidencePackHash',rr.evidence_pack_hash,'collectionId',rr.collection_id,'selectorRequestId',rr.selector_request_id,'providerRequestId',rr.provider_request_id,'createdAt',rr.created_at) end) item
 from private.r11_research_policies p left join private.r11_research_results rr on rr.policy_id=p.id left join private.r11_research_collections c on c.policy_id=p.id where p.business_id=p_business_id order by p.created_at desc,p.id desc limit 25) items),'[]'::jsonb),
 'grants',coalesce((select jsonb_agg(item order by created_at desc,id desc) from (
 select g.id,g.created_at,jsonb_build_object('grantId',g.id,'grantHash',g.grant_hash,'grant',g.grant_json,'used',exists(select 1 from private.r11_research_activations where grant_id=g.id),'expired',now()>=(g.grant_json->'researchPolicy'->>'validUntil')::timestamptz,'revoked',exists(select 1 from private.r11_research_grant_revocations where grant_id=g.id)) item from private.r11_research_grants g where g.business_id=p_business_id and g.owner_id=auth.uid() order by g.created_at desc,g.id desc limit 25) items),'[]'::jsonb)) into answer;
 return answer;
end $$;

do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'r11_research_%' loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);end loop;
end $$;
revoke all on function public.r11_research_server(uuid,text,jsonb,text),public.r11_research_revoke(uuid,uuid),public.r11_research_workspace(uuid),public.r11_research_bootstrap(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.r11_research_server(uuid,text,jsonb,text) to anon;
grant execute on function public.r11_research_revoke(uuid,uuid),public.r11_research_workspace(uuid),public.r11_research_bootstrap(uuid,uuid,text) to authenticated;
commit;
