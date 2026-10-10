-- Compatible setup pricing may be revalidated only against the unchanged,
-- still-current private route qualification. This is not a provider price fetch.
begin;
create table private.r12_direct_setup_quote_revalidations(
 proof_hash text primary key check(proof_hash=private.stage14_hash(content-'proofHash')),
 envelope_id uuid not null references private.r12_direct_test_envelopes(id),setup_operation_id uuid not null,operation_id uuid not null,
 kind text not null check(kind in ('setup','verification')),approved_quote_hash text not null,execution_quote_hash text not null,
 content jsonb not null,expires_at timestamptz not null,created_at timestamptz not null default clock_timestamp(),
 unique(operation_id,execution_quote_hash));
create index r12_direct_setup_quote_current on private.r12_direct_setup_quote_revalidations(envelope_id,operation_id,kind,expires_at);
create table private.r12_direct_setup_quote_uses(
 operation_id uuid not null,stage text not null check(stage in ('reservation','marker','transport')),
 envelope_id uuid not null references private.r12_direct_test_envelopes(id),approved_quote_hash text not null,execution_quote_hash text not null,
 proof_hash text references private.r12_direct_setup_quote_revalidations(proof_hash),quote jsonb not null,route_evidence_hash text not null,
 created_at timestamptz not null default clock_timestamp(),primary key(operation_id,stage));
-- A self-hashed browser policy supplied by a form is never a qualification.
create table private.r12_direct_owner_renderer_reviews(
 route_hash text primary key references private.r12_direct_browser_routes(route_hash),provider_project_id uuid not null,
 policy jsonb not null,policy_hash text not null check(policy_hash=private.stage14_hash(policy)),
 review_hash text not null check(review_hash~'^[a-f0-9]{64}$'),valid_from timestamptz not null,valid_until timestamptz not null check(valid_until>valid_from));
create table private.r12_direct_owner_renderer_revocations(route_hash text primary key references private.r12_direct_owner_renderer_reviews(route_hash),created_at timestamptz not null default clock_timestamp());
do $$ declare t text;begin foreach t in array array['r12_direct_setup_quote_revalidations','r12_direct_setup_quote_uses','r12_direct_owner_renderer_reviews','r12_direct_owner_renderer_revocations'] loop
 execute format('alter table private.%I enable row level security',t);execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger direct_setup_immutable before insert or update or delete on private.%I for each row execute function private.r05_guard()',t);end loop;end $$;

create function private.r12_direct_renderer_reference_manifest() returns jsonb language sql immutable set search_path='' as $$ select $manifest${"version":"etsy.renderer-dom-reference-manifest.1","documentUrl":"https://www.etsy.com/","observedAt":"2026-10-10T12:53:26.000Z","observation":"read_only_dom_src_attributes","networkTrace":false,"methodRule":"GET_only_no_non_GET_claim","images":[{"origin":"https://i.etsystatic.com","path":"/ij/e1b3c0/8505434366/ij_fullxfull.8505434366_b9sshy9k.jpg","method":"GET","resourceType":"image"},{"origin":"https://i.etsystatic.com","path":"/ij/5ffde3/8641456553/ij_400x400.8641456553_lyeh58yk.jpg","method":"GET","resourceType":"image"},{"origin":"https://i.etsystatic.com","path":"/62554272/r/il/b5845e/8082037463/il_fullxfull.8082037463_ray8.jpg","method":"GET","resourceType":"image"},{"origin":"https://i.etsystatic.com","path":"/60704290/r/il/72c8b8/7493065691/il_fullxfull.7493065691_e9w7.jpg","method":"GET","resourceType":"image"},{"origin":"https://i.etsystatic.com","path":"/48688437/r/il/3e9faf/8107988409/il_fullxfull.8107988409_1kn5.jpg","method":"GET","resourceType":"image"},{"origin":"https://i.etsystatic.com","path":"/64139495/r/il/45d7e7/8035450831/il_fullxfull.8035450831_j5ms.jpg","method":"GET","resourceType":"image"},{"origin":"https://i.etsystatic.com","path":"/ij/5a0a72/8528399648/ij_300x300.8528399648_dia1s25a.jpg","method":"GET","resourceType":"image"},{"origin":"https://i.etsystatic.com","path":"/ij/36ca24/8646947005/ij_300x300.8646947005_4tbd65ji.jpg","method":"GET","resourceType":"image"},{"origin":"https://i.etsystatic.com","path":"/ij/ad5838/8443890311/ij_300x300.8443890311_h3ps4cra.jpg","method":"GET","resourceType":"image"},{"origin":"https://i.etsystatic.com","path":"/ij/aa46dd/8646907761/ij_300x300.8646907761_m8lhald4.jpg","method":"GET","resourceType":"image"},{"origin":"https://i.etsystatic.com","path":"/ij/e53757/8599334826/ij_300x300.8599334826_g910ojce.jpg","method":"GET","resourceType":"image"}],"optionalTelemetry":[{"origin":"https://ct.pinterest.com","path":"/static/ct/token_create.js","method":"GET","resourceType":"script"},{"origin":"https://bat.bing.com","path":"/p/insights/s/0.8.72","method":"GET","resourceType":"script"},{"origin":"https://bat.bing.com","path":"/p/insights/t/4020083","method":"GET","resourceType":"script"},{"origin":"https://bat.bing.com","path":"/bat.js","method":"GET","resourceType":"script"},{"origin":"https://bat.bing.com","path":"/p/action/4020083.js","method":"GET","resourceType":"script"},{"origin":"https://bat.bing.com","path":"/action/0","method":"GET","resourceType":"image"},{"origin":"https://analytics.tiktok.com","path":"/i18n/pixel/static/identify_0504602d.js","method":"GET","resourceType":"script"},{"origin":"https://analytics.tiktok.com","path":"/i18n/pixel/static/main.MWU2MzIzODM0MQ.js","method":"GET","resourceType":"script"},{"origin":"https://analytics.tiktok.com","path":"/i18n/pixel/events.js","method":"GET","resourceType":"script"},{"origin":"https://s.pinimg.com","path":"/ct/lib/main.f1fea82a.js","method":"GET","resourceType":"script"},{"origin":"https://s.pinimg.com","path":"/ct/core.js","method":"GET","resourceType":"script"},{"origin":"https://www.googletagmanager.com","path":"/gtag/destination","method":"GET","resourceType":"script"},{"origin":"https://www.googletagmanager.com","path":"/gtag/js","method":"GET","resourceType":"script"},{"origin":"https://googleads.g.doubleclick.net","path":"/pagead/viewthroughconversion/995917074/","method":"GET","resourceType":"script"},{"origin":"https://www.facebook.com","path":"/tr","method":"GET","resourceType":"image"},{"origin":"https://tr.snapchat.com","path":"/p","method":"GET","resourceType":"image"},{"origin":"https://pt.ispot.tv","path":"/v2/TC-3512-1.gif","method":"GET","resourceType":"image"}]}$manifest$::jsonb $$;
create function private.r12_direct_renderer_policy_check(p jsonb) returns void language plpgsql immutable set search_path='' as $$
declare item jsonb;seen text[]:='{}';field text;manifest jsonb:=private.r12_direct_renderer_reference_manifest();begin
 perform private.r04_keys(p,array['version','staticOrigins','maximumRequests','navigation','sameOrigin','post','extraction']||case when p->>'version'='etsy.insights-renderer-policy.2' then array['staticAssets','optionalTelemetry','provenanceHash'] else array[]::text[] end);
 if coalesce(p->>'version','') not in ('etsy.insights-renderer-policy.1','etsy.insights-renderer-policy.2') or p->>'navigation' is distinct from 'fixed_insights_get_only'
 or p->>'sameOrigin' is distinct from 'renderer_get_only' or p->>'post' is distinct from 'denied' or p->>'extraction' is distinct from 'visible_aggregate_dom_only'
 or jsonb_typeof(p->'maximumRequests') is distinct from 'number' or coalesce(p->>'maximumRequests','')!~'^[1-9][0-9]{0,2}$'
 or (p->>'maximumRequests')::integer>512 or jsonb_typeof(p->'staticOrigins') is distinct from 'array' or jsonb_array_length(p->'staticOrigins')>8 then raise exception 'r12_direct_renderer_policy_invalid';end if;
 for item in select value from jsonb_array_elements(p->'staticOrigins') loop
 if jsonb_typeof(item) is distinct from 'string' or item#>>'{}' !~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.etsystatic\.com$' or item#>>'{}'=any(seen) then raise exception 'r12_direct_renderer_origin_unreviewed';end if;
 seen:=array_append(seen,item#>>'{}');end loop;
 if p->>'version'='etsy.insights-renderer-policy.2' then
 if p->'staticOrigins'<>'[]'::jsonb or p->>'provenanceHash' is distinct from private.stage14_hash(manifest) then raise exception 'r12_direct_renderer_provenance_unverified';end if;
 foreach field in array array['staticAssets','optionalTelemetry'] loop
 if jsonb_typeof(p->field) is distinct from 'array' or jsonb_array_length(p->field)>32 or (select count(distinct value) from jsonb_array_elements(p->field))<>jsonb_array_length(p->field) then raise exception 'r12_direct_renderer_reference_invalid';end if;
 for item in select value from jsonb_array_elements(p->field) loop
 if not exists(select 1 from jsonb_array_elements(manifest->case when field='staticAssets' then 'images' else 'optionalTelemetry' end) x where x.value=item) then raise exception 'r12_direct_renderer_reference_unobserved';end if;end loop;end loop;end if;
end $$;
create function private.r12_direct_owner_bootstrap_check(p jsonb) returns void language plpgsql immutable set search_path='' as $$ begin
 perform private.r04_keys(p,array['version','documentUrl','documentMethod','maximumRequests','subresources','redirects','auth','childTargets']);
 if p->>'version' is distinct from 'etsy.owner-bootstrap-policy.1' or p->>'documentUrl' is distinct from 'https://www.etsy.com/' or p->>'documentMethod' is distinct from 'GET'
 or p->>'subresources' is distinct from 'deny_without_evidence' or p->>'redirects' is distinct from 'fatal' or p->>'auth' is distinct from 'fatal' or p->>'childTargets' is distinct from 'fatal'
 or jsonb_typeof(p->'maximumRequests') is distinct from 'number' or coalesce(p->>'maximumRequests','')!~'^[1-9][0-9]{0,2}$' or (p->>'maximumRequests')::integer>512 then raise exception 'r12_direct_owner_bootstrap_policy_invalid';end if;
end $$;
create function private.r12_direct_owner_renderer_classify(p jsonb,d jsonb) returns text language plpgsql immutable set search_path='' as $$
declare url text:=d->>'url';origin text;path text;row jsonb;begin
 if p->>'version'='etsy.owner-bootstrap-policy.1' then
 perform private.r12_direct_owner_bootstrap_check(p);
 if jsonb_typeof(d->'navigation') is distinct from 'boolean' or jsonb_typeof(d->'url') is distinct from 'string' or length(url)>4000 then raise exception 'r12_direct_owner_bootstrap_request_invalid';end if;
 if (d->>'navigation')::boolean then
 if url is distinct from 'https://www.etsy.com/' or d->>'method' is distinct from 'GET' or d->>'resourceType' is distinct from 'document' then raise exception 'r12_direct_owner_bootstrap_navigation_denied';end if;return 'allow_owner_document';end if;
 -- A denied owner subresource has deliberately redacted path/query/fragment.
 if url!~'^https?://[a-z0-9][a-z0-9.-]*(:[1-9][0-9]{0,4})?/$' or coalesce(d->>'method','')!~'^[A-Z]{1,12}$' or coalesce(d->>'resourceType','') not in ('script','stylesheet','image','font','fetch','xhr','other','media','manifest') then raise exception 'r12_direct_owner_bootstrap_redaction_required';end if;return 'deny_owner_subresource';end if;
 perform private.r12_direct_renderer_policy_check(p);
 if jsonb_typeof(d->'navigation') is distinct from 'boolean' or d->>'method' is distinct from 'GET' or jsonb_typeof(d->'url') is distinct from 'string' or length(url)>4000 or url~'[[:space:]#\\]' then raise exception 'r12_direct_renderer_request_denied';end if;
 origin:=substring(url from '^(https://[^/?#]+)');path:=coalesce(nullif(substring(url from '^https://[^/?#]+([^?#]*)'),''),'/');
 if origin is null or origin!~'^https://[a-z0-9][a-z0-9.-]*$' then raise exception 'r12_direct_renderer_request_denied';end if;
 if (d->>'navigation')::boolean then
 if url is distinct from 'https://www.etsy.com/' or d->>'resourceType' is distinct from 'document' then raise exception 'r12_direct_renderer_navigation_denied';end if;return 'allow';end if;
 if coalesce(d->>'resourceType','') not in ('script','stylesheet','image','font','fetch','xhr','other') then raise exception 'r12_direct_renderer_request_denied';end if;
 if origin<>'https://www.etsy.com' then
 if p->>'version'='etsy.insights-renderer-policy.2' then
 row:=jsonb_build_object('origin',origin,'path',path,'method','GET','resourceType',d->>'resourceType');
 if p->'optionalTelemetry'@>jsonb_build_array(row) then
 if url<>origin||path then raise exception 'r12_direct_renderer_telemetry_must_be_sanitized';end if;return 'deny_optional_telemetry';end if;
 if url=origin||path and p->'staticAssets'@>jsonb_build_array(row) then return 'allow';end if;
 elsif p->'staticOrigins'@>to_jsonb(array[origin]) and d->>'resourceType' in ('script','stylesheet','image','font') then return 'allow';end if;
 raise exception 'r12_direct_renderer_asset_unreviewed';end if;
 -- Deliberately reject percent-escaped owner-bootstrap paths rather than decode
 -- an unrecognized authentication/private route into a permissive GET.
 if path like '%\%%' escape '\' or path~*'(^|/)(sign-?in|sign-?out|log-?in|log-?out|register|registration|cart|checkout|orders?|messages?|customers?|payments?|billing|finances?|settings|security|password|oauth)(/|$)'
 or url~*'[?&][^=&]*(token|auth|secret|password|session|code|email)[^=&]*='
 or url~*'[?&](query|q|search_query|search_term)=' then raise exception 'r12_direct_renderer_private_path_denied';end if;return 'allow';
end $$;

create function private.r12_direct_setup_quote_current(envelope uuid,operation uuid,kind text,use_stage text default null) returns jsonb language plpgsql set search_path='' as $$
declare e private.r12_direct_test_envelopes;r private.r12_direct_browser_routes;approved jsonb;definition jsonb;q jsonb;p private.r12_direct_setup_quote_revalidations;existing private.r12_direct_setup_quote_uses;begin
 if kind not in ('setup','verification') or operation is null then raise exception 'r12_direct_setup_quote_kind';end if;
 select * into strict e from private.r12_direct_test_envelopes where id=envelope;
 approved:=e.content->case when kind='setup' then 'setupQuote' else 'verificationQuote' end;
 definition:=e.content->case when kind='setup' then 'setupOperation' else 'verificationOperation' end;
 select * into strict r from private.r12_direct_browser_routes where route_hash=definition->>'routeHash';
 if (approved->>'validUntil')::timestamptz>clock_timestamp() then q:=approved;
 else
 select x.* into p from private.r12_direct_setup_quote_revalidations x where x.envelope_id=e.id and x.operation_id=operation and x.kind=r12_direct_setup_quote_current.kind and x.approved_quote_hash=approved->>'browserQuoteHash' and x.expires_at>clock_timestamp() order by x.created_at desc,x.proof_hash desc limit 1;
 if p.proof_hash is null or p.content->>'testEnvelopeHash' is distinct from e.content_hash or p.content->>'routeEvidenceHash' is distinct from r.content_hash or p.content->>'routeQualificationHash' is distinct from r.qualification_hash then raise exception 'r12_direct_setup_quote_revalidation_required';end if;
 q:=p.content->'executionQuote';
 end if;
 if (q-array['verifiedAt','validUntil','browserQuoteHash']) is distinct from (approved-array['verifiedAt','validUntil','browserQuoteHash']) then raise exception 'r12_direct_setup_quote_terms_changed';end if;
 perform private.r12_direct_browser_quote_check(q,r,definition-'quoteHash');
 if use_stage is not null then
 if use_stage not in ('reservation','marker','transport') then raise exception 'r12_direct_setup_quote_stage';end if;
 select * into existing from private.r12_direct_setup_quote_uses where operation_id=operation and stage=use_stage;
 if found then
 if existing.envelope_id<>e.id or existing.execution_quote_hash<>q->>'browserQuoteHash' or existing.quote is distinct from q then raise exception 'r12_direct_setup_quote_use_conflict';end if;
 else insert into private.r12_direct_setup_quote_uses values(operation,use_stage,e.id,approved->>'browserQuoteHash',q->>'browserQuoteHash',p.proof_hash,q,r.content_hash,clock_timestamp());end if;
 end if;return q;
end $$;

create function public.r12_direct_setup_quote_revalidate(p_business_id uuid,p_setup_operation_id uuid,p_kind text,p_server_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare k private.r12_etsy_steel_keys;e private.r12_direct_test_envelopes;r private.r12_direct_browser_routes;s private.r12_etsy_steel_setups;prior private.r12_direct_setup_quote_revalidations;operation uuid;q jsonb;approved jsonb;definition jsonb;body jsonb;at timestamptz;expires timestamptz;begin
 if p_kind not in ('setup','verification') or p_setup_operation_id is null then raise exception 'r12_direct_setup_quote_kind';end if;
 select * into k from private.r12_etsy_steel_keys where key_hash=encode(extensions.digest(p_server_key,'sha256'),'hex') and purpose=case when p_kind='setup' then 'handoff' else 'verification' end and valid_until>clock_timestamp();
 if k.key_hash is null or exists(select 1 from private.r12_etsy_steel_key_revocations where key_hash=k.key_hash) then raise exception 'r12_direct_setup_quote_key_required' using errcode='42501';end if;
 select * into strict e from private.r12_direct_test_envelopes where id=k.envelope_id and business_id=p_business_id;
 perform private.r12_direct_test_current(e.id);perform private.r12_direct_financial_check(e.id,0);
 select * into strict r from private.r12_direct_browser_routes where route_hash=k.route_hash;
 if p_kind='verification' then s:=private.r12_etsy_steel_current(p_setup_operation_id,true);
 if s.envelope_id<>e.id or s.route_hash<>r.route_hash then raise exception 'r12_direct_setup_quote_scope';end if;operation:=(s.scope->>'verificationOperationId')::uuid;
 else operation:=p_setup_operation_id;
 if exists(select 1 from private.r12_etsy_steel_setups where operation_id=operation and envelope_id<>e.id) then raise exception 'r12_direct_setup_quote_scope';end if;end if;
 if exists(select 1 from private.r12_direct_browser_operations where id=operation) then raise exception 'r12_direct_setup_quote_after_reservation';end if;
 approved:=e.content->case when p_kind='setup' then 'setupQuote' else 'verificationQuote' end;
 definition:=e.content->case when p_kind='setup' then 'setupOperation' else 'verificationOperation' end;
 select * into prior from private.r12_direct_setup_quote_revalidations where envelope_id=e.id and operation_id=operation and kind=p_kind and expires_at>clock_timestamp() order by created_at desc,proof_hash desc limit 1;
 if found then perform private.r12_direct_setup_quote_current(e.id,operation,p_kind);return prior.content;end if;
 at:=date_trunc('milliseconds',clock_timestamp());expires:=least(at+interval '5 minutes',r.valid_until,e.expires_at,k.valid_until);
 q:=(approved-'browserQuoteHash')||jsonb_build_object('verifiedAt',to_char(at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'validUntil',to_char(expires at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 q:=q||jsonb_build_object('browserQuoteHash',private.stage14_hash(q));perform private.r12_direct_browser_quote_check(q,r,definition-'quoteHash');
 body:=jsonb_build_object('version','r12.direct-setup-quote-revalidation.1','testEnvelopeId',e.id,'testEnvelopeHash',e.content_hash,'setupOperationId',p_setup_operation_id,'operationId',operation,'operationKind',p_kind,'approvedQuoteHash',approved->>'browserQuoteHash','executionQuote',q,
 'routeEvidenceHash',r.content_hash,'routeQualificationHash',r.qualification_hash,'routeQualifiedFrom',to_char(r.valid_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'routeQualifiedUntil',to_char(r.valid_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'revalidatedAt',to_char(at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'reason','still_valid_private_route_revalidation');
 body:=body||jsonb_build_object('proofHash',private.stage14_hash(body));insert into private.r12_direct_setup_quote_revalidations values(body->>'proofHash',e.id,p_setup_operation_id,operation,p_kind,approved->>'browserQuoteHash',q->>'browserQuoteHash',body,expires,clock_timestamp());return body;
end $$;

create function private.r12_direct_owner_renderer(operation uuid) returns jsonb language plpgsql set search_path='' as $$
declare s private.r12_etsy_steel_setups;r private.r12_direct_owner_renderer_reviews;e private.r12_direct_test_envelopes;route private.r12_direct_browser_routes;body jsonb;begin
 s:=private.r12_etsy_steel_current(operation,true);select * into strict e from private.r12_direct_test_envelopes where id=s.envelope_id;perform private.r12_direct_test_current(e.id);
 select * into strict route from private.r12_direct_browser_routes where route_hash=s.route_hash;
 select * into r from private.r12_direct_owner_renderer_reviews where route_hash=s.route_hash and provider_project_id=route.provider_project_id and valid_from<=clock_timestamp() and valid_until>clock_timestamp();
 if r.route_hash is null or exists(select 1 from private.r12_direct_owner_renderer_revocations where route_hash=r.route_hash) then raise exception 'r12_direct_owner_renderer_qualification_required';end if;
 if r.policy->>'version'='etsy.owner-bootstrap-policy.1' then perform private.r12_direct_owner_bootstrap_check(r.policy);else perform private.r12_direct_renderer_policy_check(r.policy);end if;
 body:=jsonb_build_object('version',case when r.policy->>'version'='etsy.owner-bootstrap-policy.1' then 'etsy.owner-bootstrap-qualification.1' else 'etsy.owner-handoff-renderer-qualification.1' end,'operationId',operation,'providerProjectId',r.provider_project_id,'policy',r.policy,'policyHash',r.policy_hash,'expiresAt',to_char(least(r.valid_until,route.valid_until,e.expires_at,s.approval_expires_at) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 return body||jsonb_build_object('qualificationHash',private.stage14_hash(body));
end $$;
create function public.r12_direct_owner_renderer_qualification(p_business_id uuid,p_operation_id uuid,p_server_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare k private.r12_etsy_steel_keys;s private.r12_etsy_steel_setups;begin
 select * into k from private.r12_etsy_steel_keys where key_hash=encode(extensions.digest(p_server_key,'sha256'),'hex') and purpose='handoff' and valid_until>clock_timestamp();
 select * into s from private.r12_etsy_steel_setups where operation_id=p_operation_id and business_id=p_business_id and envelope_id=k.envelope_id and route_hash=k.route_hash;
 if k.key_hash is null or s.operation_id is null or exists(select 1 from private.r12_etsy_steel_key_revocations where key_hash=k.key_hash) then raise exception 'r12_direct_owner_renderer_key_required' using errcode='42501';end if;
 return private.r12_direct_owner_renderer(s.operation_id);
end $$;

create table private.r12_direct_owner_renderer_decisions(operation_id uuid not null references private.r12_etsy_steel_setups(operation_id),sequence integer not null check(sequence between 1 and 512),content jsonb not null,content_hash text not null check(content_hash=private.stage14_hash(content)),created_at timestamptz not null default clock_timestamp(),primary key(operation_id,sequence));
alter table private.r12_direct_owner_renderer_decisions enable row level security;
revoke all on private.r12_direct_owner_renderer_decisions from public,anon,authenticated,service_role;
create trigger direct_owner_renderer_immutable before insert or update or delete on private.r12_direct_owner_renderer_decisions for each row execute function private.r05_guard();
create function private.r12_direct_owner_renderer_decision(b uuid,payload jsonb,server_key text) returns jsonb language plpgsql set search_path='' as $$
declare d jsonb:=payload->'decision';q jsonb;p jsonb;operation uuid;disposition text;n integer;bootstrap boolean;begin
 perform private.r04_safe(payload);perform private.r04_keys(payload,array['operationId','decision']);operation:=(payload->>'operationId')::uuid;
 q:=public.r12_direct_owner_renderer_qualification(b,operation,server_key);p:=q->'policy';bootstrap:=p->>'version'='etsy.owner-bootstrap-policy.1';
 perform private.r04_keys(d,array['version','operationId','providerProjectId','qualificationHash','policyHash','sequence','url','method','resourceType','navigation','disposition']||case when bootstrap then array[]::text[] else array['provenanceHash'] end);
 if d->>'version' is distinct from (case when bootstrap then 'etsy.owner-bootstrap-request.1' else 'etsy.owner-handoff-renderer-request.2' end) or (not bootstrap and p->>'version' is distinct from 'etsy.insights-renderer-policy.2')
 or d->>'operationId' is distinct from operation::text or d->'providerProjectId' is distinct from q->'providerProjectId' or d->'qualificationHash' is distinct from q->'qualificationHash'
 or d->'policyHash' is distinct from q->'policyHash' or (not bootstrap and d->'provenanceHash' is distinct from p->'provenanceHash')
 or jsonb_typeof(d->'sequence') is distinct from 'number' or coalesce(d->>'sequence','')!~'^[1-9][0-9]{0,2}$'
 or not exists(select 1 from private.r12_etsy_steel_dispatches where operation_id=operation)
 or exists(select 1 from private.r12_etsy_steel_handoffs where operation_id=operation) then raise exception 'r12_direct_renderer_decision_unverified';end if;
 n:=(d->>'sequence')::integer;
 if n<>(select count(*)+1 from private.r12_direct_owner_renderer_decisions where operation_id=operation) or n>(p->>'maximumRequests')::integer then raise exception 'r12_direct_renderer_decision_replay';end if;
 disposition:=private.r12_direct_owner_renderer_classify(p,d);
 if d->>'disposition' is distinct from disposition then raise exception 'r12_direct_renderer_disposition_mismatch';end if;
 insert into private.r12_direct_owner_renderer_decisions values(operation,n,d,private.stage14_hash(d),clock_timestamp());return jsonb_build_object('accepted',true);
end $$;

-- Verification may read the signed-in landing UI only under its own renderer
-- review. An owner-only, asset-independent login bootstrap is not admissible here.
create table private.r12_direct_verification_renderer_reviews(
 route_hash text primary key references private.r12_direct_browser_routes(route_hash),provider_project_id uuid not null,
 policy jsonb not null,policy_hash text not null check(policy_hash=private.stage14_hash(policy)),review_hash text not null check(review_hash~'^[a-f0-9]{64}$'),
 valid_from timestamptz not null,valid_until timestamptz not null check(valid_until>valid_from));
create table private.r12_direct_verification_renderer_revocations(route_hash text primary key references private.r12_direct_verification_renderer_reviews(route_hash),created_at timestamptz not null default clock_timestamp());
create table private.r12_direct_verification_renderer_qualifications(operation_id uuid primary key references private.r12_etsy_steel_verification_runs(operation_id),content jsonb not null,qualification_hash text not null unique check(qualification_hash=private.stage14_hash(content-'qualificationHash')),created_at timestamptz not null default clock_timestamp());
create table private.r12_direct_verification_renderer_requests(operation_id uuid not null references private.r12_etsy_steel_verification_runs(operation_id),sequence integer not null check(sequence between 1 and 512),content jsonb not null,content_hash text not null check(content_hash=private.stage14_hash(content)),created_at timestamptz not null default clock_timestamp(),primary key(operation_id,sequence));
do $$ declare t text;begin foreach t in array array['r12_direct_verification_renderer_reviews','r12_direct_verification_renderer_revocations','r12_direct_verification_renderer_qualifications','r12_direct_verification_renderer_requests'] loop
 execute format('alter table private.%I enable row level security',t);execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger direct_verification_renderer_immutable before insert or update or delete on private.%I for each row execute function private.r05_guard()',t);end loop;end $$;
create function private.r12_direct_verification_renderer(operation uuid,mode text,payload jsonb default '{}'::jsonb) returns jsonb language plpgsql set search_path='' as $$
declare v private.r12_etsy_steel_verification_runs;s private.r12_etsy_steel_setups;r private.r12_direct_verification_renderer_reviews;e private.r12_direct_test_envelopes;route private.r12_direct_browser_routes;old private.r12_direct_verification_renderer_qualifications;body jsonb;d jsonb;n integer;disposition text;v2 boolean;begin
 select * into strict v from private.r12_etsy_steel_verification_runs where operation_id=operation;s:=private.r12_etsy_steel_current(v.setup_operation_id,true);
 select * into strict e from private.r12_direct_test_envelopes where id=s.envelope_id;perform private.r12_direct_test_current(e.id);
 if v.expires_at<=clock_timestamp() or not exists(select 1 from private.r05_reservations where request_id=v.request_id) then raise exception 'r12_direct_verification_renderer_authority';end if;
 select * into strict route from private.r12_direct_browser_routes where route_hash=s.route_hash;
 select * into r from private.r12_direct_verification_renderer_reviews where route_hash=s.route_hash and provider_project_id=route.provider_project_id and valid_from<=clock_timestamp() and valid_until>clock_timestamp();
 if r.route_hash is null or exists(select 1 from private.r12_direct_verification_renderer_revocations where route_hash=r.route_hash) then raise exception 'r12_direct_verification_renderer_review_required';end if;
 perform private.r12_direct_renderer_policy_check(r.policy);v2:=r.policy->>'version'='etsy.insights-renderer-policy.2';
 select * into old from private.r12_direct_verification_renderer_qualifications where operation_id=operation;
 if mode='qualify_renderer' then
 perform private.r04_keys(payload,array['operationId']);
 if old.operation_id is not null then return old.content;end if;
 body:=jsonb_build_object('version','r12.etsy-insights-renderer-qualification.1','requestHash',v.scope_hash,'expiresAt',to_char(least(v.expires_at,r.valid_until,route.valid_until,e.expires_at) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'maximumRequests',r.policy->'maximumRequests','policy',r.policy,'policyHash',r.policy_hash);
 body:=body||jsonb_build_object('qualificationHash',private.stage14_hash(body));insert into private.r12_direct_verification_renderer_qualifications values(operation,body,body->>'qualificationHash',clock_timestamp());return body;end if;
 if old.operation_id is null or (old.content->>'expiresAt')::timestamptz<=clock_timestamp() or old.content->>'policyHash' is distinct from r.policy_hash then raise exception 'r12_direct_verification_renderer_qualification_required';end if;
 if mode='check' then return old.content;end if;
 if mode<>'admit_renderer' then raise exception 'r12_direct_verification_renderer_operation';end if;
 perform private.r04_keys(payload,array['operationId','request']);d:=payload->'request';
 perform private.r04_keys(d,array['version','operationId','requestId','scopeHash','qualificationHash','sequence','url','method','resourceType','navigation']||case when v2 then array['disposition','policyHash','provenanceHash'] else array[]::text[] end);
 if d->>'version' is distinct from (case when v2 then 'etsy.insights-verification-renderer-request.2' else 'etsy.insights-verification-renderer-request.1' end)
 or d->>'operationId' is distinct from operation::text or d->>'requestId' is distinct from v.request_id::text or d->>'scopeHash' is distinct from v.scope_hash or d->>'qualificationHash' is distinct from old.qualification_hash
 or (v2 and (d->>'policyHash' is distinct from r.policy_hash or d->'provenanceHash' is distinct from r.policy->'provenanceHash'))
 or jsonb_typeof(d->'sequence') is distinct from 'number' or coalesce(d->>'sequence','')!~'^[1-9][0-9]{0,2}$'
 or not exists(select 1 from private.r12_etsy_steel_verification_dispatches where operation_id=operation)
 or exists(select 1 from private.r12_etsy_steel_verification_release where operation_id=operation) then raise exception 'r12_direct_verification_renderer_request_unverified';end if;
 n:=(d->>'sequence')::integer;if n<>(select count(*)+1 from private.r12_direct_verification_renderer_requests where operation_id=operation) or n>(r.policy->>'maximumRequests')::integer then raise exception 'r12_direct_verification_renderer_replay';end if;
 if d->'navigation'='true'::jsonb then
 if d->>'method' is distinct from 'GET' or d->>'url' is distinct from 'https://www.etsy.com/your/shops/me/marketplace-insights' or d->>'resourceType' is distinct from 'document' then raise exception 'r12_direct_verification_renderer_navigation_denied';end if;disposition:='allow';
 else disposition:=private.r12_direct_owner_renderer_classify(r.policy,d);end if;
 if v2 and d->>'disposition' is distinct from disposition then raise exception 'r12_direct_verification_renderer_disposition_mismatch';end if;
 insert into private.r12_direct_verification_renderer_requests values(operation,n,d,private.stage14_hash(d),clock_timestamp());return jsonb_build_object('accepted',true,'allowed',disposition='allow','disposition',disposition,'sequence',n);
end $$;

-- Setup sessions are real, separately counted R05 provider operations. They do
-- not invent R07 children or phase dispatches, and retries never recreate them.
create function private.r12_direct_setup_operation_guard() returns trigger language plpgsql set search_path='' as $$
declare m private.r12_direct_request_bindings;e private.r12_direct_test_envelopes;o private.r12_direct_browser_operations;prior bigint;used bigint;baseline integer;ceiling integer;begin
 select * into m from private.r12_direct_request_bindings where request_id=new.request_id;if m.request_id is null then return new;end if;
 select * into strict e from private.r12_direct_test_envelopes where id=m.envelope_id;if e.content->>'version'<>'r12.owner-direct-test-envelope.1' then return new;end if;
 perform 1 from public.businesses where id=e.business_id for update;
 if m.kind='owner_setup' then
 select * into strict o from private.r12_direct_browser_operations where request_id=new.request_id;
 if o.scope->>'version' not in ('etsy.steel-owner-handoff-scope.1','etsy.steel-account-verification-scope.1') then raise exception 'r12_direct_setup_operation_kind';end if;
 select count(*) into prior from private.r12_direct_browser_operations x join private.r05_reservations v on v.request_id=x.request_id where x.envelope_id=e.id and x.operation_kind='owner_setup' and x.scope->>'version'=o.scope->>'version' and x.request_id<>new.request_id;
 if prior>0 then raise exception 'r12_direct_setup_session_limit';end if;
 end if;
 select count(*) into used from private.r12_direct_request_bindings x join private.r05_reservations v on v.request_id=x.request_id where x.envelope_id=e.id and x.request_id<>new.request_id;
 baseline:=(e.content->'origin'->'predecessor'->'closure'->>'baseDispatches')::integer;
 select least(64,r.cumulative_dispatches_ceiling) into ceiling from private.r12_direct_grant_reviews r where r.grant_id=(e.content->>'grantId')::uuid;
 if ceiling is null or baseline+used+1>ceiling or used+1>2+4*(e.content->>'maximumAttemptsInWindow')::integer then raise exception 'r12_direct_provider_operation_limit';end if;
 return new;
end $$;
create trigger r12_direct_setup_operation_guard before insert on private.r05_reservations for each row execute function private.r12_direct_setup_operation_guard();
create trigger r12_direct_setup_operation_guard before insert on private.r05_markers for each row execute function private.r12_direct_setup_operation_guard();
create function private.r12_direct_provider_operation_counts(envelope uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('historicalResearchDispatches',(e.content->'origin'->'predecessor'->'closure'->>'baseDispatches')::integer,
 'researchDispatches',count(v.request_id) filter(where m.kind in ('research_model','research_source')),
 'ownerLoginDispatches',count(v.request_id) filter(where o.scope->>'version'='etsy.steel-owner-handoff-scope.1'),
 'ownerVerificationDispatches',count(v.request_id) filter(where o.scope->>'version'='etsy.steel-account-verification-scope.1'),
 'providerDispatchesTotal',(e.content->'origin'->'predecessor'->'closure'->>'baseDispatches')::integer+count(v.request_id))
 from private.r12_direct_test_envelopes e left join private.r12_direct_request_bindings m on m.envelope_id=e.id left join private.r05_markers v on v.request_id=m.request_id left join private.r12_direct_browser_operations o on o.request_id=m.request_id where e.id=envelope group by e.id
$$;

-- Change only the four earlier quote-expiry checks. Original identity, owner,
-- key, cash, Stop, one-shot transport and all receipt checks remain in place.
do $$ declare src text;old text;replacement text;begin
 src:=pg_get_functiondef('public.r12_direct_browser_ledger(uuid,uuid,text,jsonb,text)'::regprocedure);
 old:=$a$not (body->>'scopeHash'=o.scope_hash or body->>'requestHash'=o.request_hash)$a$;
 replacement:=$a$(body->>'scopeHash'=o.scope_hash or body->>'requestHash'=o.request_hash) is not true
 or ((o.operation_kind='owner_setup' and o.scope->>'version'='etsy.steel-owner-handoff-scope.1' and body->>'version'='etsy.steel-owner-handoff-receipt.1')
 or (o.operation_kind='owner_setup' and o.scope->>'version'='etsy.steel-account-verification-scope.1' and body->>'version'='etsy.steel-account-verification-receipt.1')
 or (o.operation_kind='research_source' and body->>'version'='r12.etsy-insights-source-receipt.1')) is not true$a$;
 if strpos(src,old)=0 then raise exception 'r12_direct_receipt_pin_patch_required';end if;execute replace(src,old,replacement);
 src:=pg_get_functiondef('private.r12_direct_prepare_test(uuid,jsonb,text)'::regprocedure);
 old:=$a$(origin->'predecessor'->'closure'->>'baseDispatches')::integer+4*n>least(64,r.cumulative_dispatches_ceiling)$a$;
 replacement:=$a$(origin->'predecessor'->'closure'->>'baseDispatches')::integer+2+4*n>least(64,r.cumulative_dispatches_ceiling)$a$;
 if strpos(src,old)=0 then raise exception 'r12_direct_setup_lifetime_patch_required';end if;execute replace(src,old,replacement);
 src:=pg_get_functiondef('public.r12_etsy_steel_server(uuid,text,jsonb,text)'::regprocedure);
 old:=$a$if p_operation='prepare' then$a$;replacement:=$a$if p_operation='renderer_decision' then return private.r12_direct_owner_renderer_decision(p_business_id,p_payload,p_server_key);end if;
 if p_operation='prepare' then$a$;
 if strpos(src,old)=0 then raise exception 'r12_direct_renderer_decision_patch_required';end if;src:=replace(src,old,replacement);
 old:=$a$if e.content->>'version'='r12.owner-direct-test-envelope.1' and least(coalesce((e.content->'setupQuote'->>'validUntil')::timestamptz,'-infinity'::timestamptz),coalesce((e.content->'verificationQuote'->>'validUntil')::timestamptz,'-infinity'::timestamptz))<=clock_timestamp() then raise exception 'etsy_handoff_quote_expired';end if;$a$;
 replacement:=$a$if e.content->>'version'='r12.owner-direct-test-envelope.1' then perform private.r12_direct_setup_quote_current(e.id,(scope->>'operationId')::uuid,'setup');end if;$a$;
 if strpos(src,old)=0 then raise exception 'r12_direct_setup_prepare_patch_required';end if;src:=replace(src,old,replacement);
 old:=$a$if e.content->>'version'='r12.owner-direct-test-envelope.1' and coalesce((e.content->'setupQuote'->>'validUntil')::timestamptz,'-infinity'::timestamptz)<=clock_timestamp() then raise exception 'etsy_handoff_quote_expired';end if;$a$;
 replacement:=$a$if e.content->>'version'='r12.owner-direct-test-envelope.1' then perform private.r12_direct_setup_quote_current(e.id,s.operation_id,'setup','transport');perform private.r12_direct_owner_renderer(s.operation_id);end if;$a$;
 if strpos(src,old)=0 then raise exception 'r12_direct_setup_transport_patch_required';end if;execute replace(src,old,replacement);
 src:=pg_get_functiondef('public.r12_etsy_steel_verification_server(uuid,text,jsonb,text)'::regprocedure);
 old:=$a$if p_operation='cleanup_complete' then$a$;
 replacement:=$a$if p_operation in ('qualify_renderer','admit_renderer') then return private.r12_direct_verification_renderer(v.operation_id,p_operation,p_payload);end if;
 if p_operation='cleanup_complete' then$a$;
 if strpos(src,old)=0 then raise exception 'r12_direct_verification_renderer_patch_required';end if;src:=replace(src,old,replacement);
 old:=$a$insert into private.r12_etsy_steel_verification_dispatches(operation_id) values(v.operation_id);$a$;
 replacement:=$a$if e.content->>'version'='r12.owner-direct-test-envelope.1' then perform private.r12_direct_verification_renderer(v.operation_id,'check');end if;
 insert into private.r12_etsy_steel_verification_dispatches(operation_id) values(v.operation_id);$a$;
 if strpos(src,old)=0 then raise exception 'r12_direct_verification_renderer_dispatch_patch_required';end if;src:=replace(src,old,replacement);
 old:=$a$if e.content->>'version'='r12.owner-direct-test-envelope.1' and coalesce((e.content->'verificationQuote'->>'validUntil')::timestamptz,'-infinity'::timestamptz)<=clock_timestamp() then raise exception 'etsy_verification_quote_expired';end if;$a$;
 if (length(src)-length(replace(src,old,'')))/length(old)<>2 then raise exception 'r12_direct_verification_patch_required';end if;
 replacement:=$a$if e.content->>'version'='r12.owner-direct-test-envelope.1' then perform private.r12_direct_setup_quote_current(e.id,(s.scope->>'verificationOperationId')::uuid,'verification',case when p_operation='transport' then 'transport' else null end);end if;$a$;
 execute replace(src,old,replacement);
 src:=pg_get_functiondef('private.r12_direct_authority_admission_guard()'::regprocedure);
 old:=$a$if q is null or q->>'browserQuoteHash' is distinct from o.quote_hash or (q->>'validUntil')::timestamptz<=clock_timestamp() then raise exception 'r12_direct_current_setup_quote_required';end if;$a$;
 replacement:=$a$if q is null or q->>'browserQuoteHash' is distinct from o.quote_hash then raise exception 'r12_direct_current_setup_quote_required';end if;
 perform private.r12_direct_setup_quote_current(e.id,o.id,case when o.scope->>'version'='etsy.steel-owner-handoff-scope.1' then 'setup' else 'verification' end,case when tg_table_name='r05_markers' then 'marker' else 'reservation' end);$a$;
 if strpos(src,old)=0 then raise exception 'r12_direct_setup_admission_patch_required';end if;execute replace(src,old,replacement);
end $$;
do $$ declare f record;begin for f in select p.oid::regprocedure name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'r12_direct_%' loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.name);end loop;end $$;
revoke all on function public.r12_direct_setup_quote_revalidate(uuid,uuid,text,text),public.r12_direct_owner_renderer_qualification(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.r12_direct_setup_quote_revalidate(uuid,uuid,text,text),public.r12_direct_owner_renderer_qualification(uuid,uuid,text) to anon;
commit;
