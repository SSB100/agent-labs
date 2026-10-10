-- Pre-create equality proof for the captured Steel configuration. This installs
-- no credentials, routes, tariff reviews, grants or paid sessions. The private
-- operator publisher records independent read-only provider evidence; it cannot
-- derive account or price qualification from the session being created.
begin;
create table private.r12_steel_config_attestations(
 attestation_hash text primary key check(attestation_hash=private.stage14_hash(content-'attestationHash')),
 route_hash text not null references private.r12_direct_browser_routes(route_hash),
 configuration_hash text not null check(configuration_hash~'^[a-f0-9]{64}$'),
 credential_binding_hash text not null check(credential_binding_hash~'^[a-f0-9]{64}$'),
 provider_project_id uuid not null,deployment_id text not null,content jsonb not null,
 valid_from timestamptz not null,valid_until timestamptz not null check(valid_until>valid_from),
 created_at timestamptz not null default clock_timestamp());
create index r12_steel_config_lookup on private.r12_steel_config_attestations(route_hash,configuration_hash,credential_binding_hash,valid_until);
create table private.r12_steel_config_attestation_revocations(
 attestation_hash text primary key references private.r12_steel_config_attestations(attestation_hash),created_at timestamptz not null default clock_timestamp());
create table private.r12_steel_create_config_requests(
 operation_id uuid primary key references private.r12_direct_browser_operations(id),
 business_id uuid not null references public.businesses(id),envelope_id uuid not null references private.r12_direct_test_envelopes(id),
 key_hash text not null check(key_hash~'^[a-f0-9]{64}$'),request jsonb not null,
 request_hash text not null check(request_hash=private.stage14_hash(request)),created_at timestamptz not null default clock_timestamp());
create table private.r12_steel_create_config_permits(
 admission_hash text primary key check(admission_hash=private.stage14_hash(permit-'admissionHash')),
 operation_id uuid not null references private.r12_steel_create_config_requests(operation_id),
 attestation_hash text not null references private.r12_steel_config_attestations(attestation_hash),
 permit jsonb not null,valid_until timestamptz not null,created_at timestamptz not null default clock_timestamp());
create index r12_steel_config_permit_operation on private.r12_steel_create_config_permits(operation_id,valid_until);
create table private.r12_steel_create_config_uses(
 operation_id uuid primary key references private.r12_steel_create_config_requests(operation_id),
 admission_hash text not null unique references private.r12_steel_create_config_permits(admission_hash),
 created_at timestamptz not null default clock_timestamp());
do $$ declare n text;begin
 foreach n in array array['r12_steel_config_attestations','r12_steel_config_attestation_revocations','r12_steel_create_config_requests','r12_steel_create_config_permits','r12_steel_create_config_uses'] loop
 execute format('alter table private.%I enable row level security',n);
 execute format('revoke all on private.%I from public,anon,authenticated,service_role',n);
 execute format('create trigger r12_steel_config_immutable before insert or update or delete on private.%I for each row execute function private.r05_guard()',n);
 end loop;
end $$;

create function private.r12_steel_config_attestation_check(body jsonb) returns void language plpgsql set search_path='' as $$
declare r private.r12_direct_browser_routes;c jsonb;proof jsonb;k text;observed timestamptz;valid_from timestamptz;valid_until timestamptz;begin
 perform private.r04_keys(body,array['version','routeHash','providerProjectId','providerAccountHash','tariffHash','credentialBindingHash','configuration','configurationHash','deploymentEvidenceHash','dashboardTariffEvidenceHash','independentReadback','validFrom','validUntil','attestationHash']);
 if octet_length(body::text)>16000 then raise exception 'r12_steel_config_attestation_invalid';end if;
 c:=body->'configuration';proof:=body->'independentReadback';
 perform private.r04_keys(c,array['version','provider','baseUrl','region','providerProjectId','environment','deploymentId','releaseCommitSha']);
 perform private.r04_keys(proof,array['version','method','endpoint','requestedSessionId','returnedSessionId','returnedProjectId','providerStatus','sessionCreatedAt','observedAt','responseHash','credentialBindingHash','configurationHash']);
 foreach k in array array['routeHash','providerAccountHash','tariffHash','credentialBindingHash','configurationHash','deploymentEvidenceHash','dashboardTariffEvidenceHash','attestationHash'] loop
 if coalesce(body->>k,'')!~'^[a-f0-9]{64}$' then raise exception 'r12_steel_config_attestation_invalid';end if;end loop;
 foreach k in array array['validFrom','validUntil'] loop
 if jsonb_typeof(body->k) is distinct from 'string' or coalesce(body->>k,'')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' or private.r12_direct_time((body->>k)::timestamptz) is distinct from body->>k then raise exception 'r12_steel_config_attestation_invalid';end if;end loop;
 foreach k in array array['sessionCreatedAt','observedAt'] loop
 if jsonb_typeof(proof->k) is distinct from 'string' or coalesce(proof->>k,'')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' or private.r12_direct_time((proof->>k)::timestamptz) is distinct from proof->>k then raise exception 'r12_steel_config_attestation_invalid';end if;end loop;
 select * into r from private.r12_direct_browser_routes where route_hash=body->>'routeHash';
 observed:=(proof->>'observedAt')::timestamptz;valid_from:=(body->>'validFrom')::timestamptz;valid_until:=(body->>'validUntil')::timestamptz;
 if body->>'version' is distinct from 'r12.steel-config-attestation.1' or r.route_hash is null
 or body->>'attestationHash' is distinct from private.stage14_hash(body-'attestationHash')
 or body->>'providerProjectId' is distinct from r.provider_project_id::text
 or body->>'providerAccountHash' is distinct from r.provider_account_hash or body->>'tariffHash' is distinct from r.tariff_hash
 or body->>'credentialBindingHash' is distinct from r.credential_binding_hash
 or body->>'dashboardTariffEvidenceHash' is distinct from r.content->>'priceEvidenceHash'
 or body->>'configurationHash' is distinct from private.stage14_hash(c)
 or c->>'version' is distinct from 'r12.steel-runtime-configuration.1' or c->>'provider' is distinct from 'steel'
 or c->>'baseUrl' is distinct from 'https://api.steel.dev' or c->>'environment' is distinct from 'production'
 or c->>'providerProjectId' is distinct from r.provider_project_id::text
 or coalesce(c->>'deploymentId','')!~'^dpl_[A-Za-z0-9_-]{1,124}$'
 or coalesce(c->>'releaseCommitSha','')!~'^([a-f0-9]{40}|[a-f0-9]{64})$'
 or (c->'region' is distinct from 'null'::jsonb and (jsonb_typeof(c->'region') is distinct from 'string' or coalesce(c->>'region','')!~'^[A-Za-z0-9_-]{1,64}$'))
 or proof->>'version' is distinct from 'r12.steel-existing-session-readback.1' or proof->>'method' is distinct from 'GET'
 or (proof->>'requestedSessionId')::uuid is null or proof->>'returnedSessionId' is distinct from proof->>'requestedSessionId'
 or proof->>'endpoint' is distinct from 'https://api.steel.dev/v1/sessions/'||(proof->>'requestedSessionId')
 or proof->>'returnedProjectId' is distinct from r.provider_project_id::text
 or coalesce(proof->>'providerStatus','') not in ('released','failed') or coalesce(proof->>'responseHash','')!~'^[a-f0-9]{64}$'
 or proof->>'credentialBindingHash' is distinct from body->>'credentialBindingHash' or proof->>'configurationHash' is distinct from body->>'configurationHash'
 or observed is null or (proof->>'sessionCreatedAt')::timestamptz is null or (proof->>'sessionCreatedAt')::timestamptz>=observed
 or valid_from is null or valid_until is null or valid_from<r.valid_from or valid_until>r.valid_until or valid_until<=valid_from
 or observed>valid_from or observed<valid_from-interval '5 minutes' or valid_until>observed+interval '24 hours'
 or exists(select 1 from private.r12_direct_browser_operations where id=(proof->>'requestedSessionId')::uuid)
 then raise exception 'r12_steel_config_attestation_invalid';end if;
end $$;

-- Invoker-only and API roles revoked. External response/dashboard/deployment
-- truth is an explicit trusted-operator review, never a caller self-hash grant.
create function private.r12_steel_publish_config_attestation(body jsonb) returns jsonb language plpgsql set search_path='' as $$
declare prior private.r12_steel_config_attestations;begin
 perform private.r12_steel_config_attestation_check(body);
 perform private.r12_renderer_review_lock_businesses(body->>'routeHash');
 if (body->>'validFrom')::timestamptz>clock_timestamp() or (body->>'validUntil')::timestamptz<=clock_timestamp()
 or exists(select 1 from private.r12_direct_browser_route_revocations where route_hash=body->>'routeHash')
 then raise exception 'r12_steel_config_attestation_inactive';end if;
 select * into prior from private.r12_steel_config_attestations where attestation_hash=body->>'attestationHash';
 if prior.attestation_hash is not null and prior.content is distinct from body then raise exception 'r12_steel_config_attestation_changed';end if;
 insert into private.r12_steel_config_attestations(attestation_hash,route_hash,configuration_hash,credential_binding_hash,provider_project_id,deployment_id,content,valid_from,valid_until)
 values(body->>'attestationHash',body->>'routeHash',body->>'configurationHash',body->>'credentialBindingHash',(body->>'providerProjectId')::uuid,body->'configuration'->>'deploymentId',body,(body->>'validFrom')::timestamptz,(body->>'validUntil')::timestamptz) on conflict do nothing;
 return jsonb_build_object('version','r12.steel-config-attestation-publication.1','attestationHash',body->>'attestationHash','authorityCreated',false);
end $$;
create function private.r12_steel_config_revocation_lock() returns trigger language plpgsql set search_path='' as $$
declare route text;begin
 select route_hash into strict route from private.r12_steel_config_attestations where attestation_hash=new.attestation_hash;
 perform private.r12_renderer_review_lock_businesses(route);return new;
end $$;
create trigger r12_steel_config_revocation_business_lock before insert on private.r12_steel_config_attestation_revocations for each row execute function private.r12_steel_config_revocation_lock();

-- A newly enrolled package is qualified for an exact application release and
-- deployment receipt. A sidecar may not silently move it to another build.
create function private.r12_steel_config_release_check(envelope uuid,attestation jsonb) returns void language plpgsql set search_path='' as $$
declare evidence jsonb;begin
 select p.review_evidence into evidence from private.r12_direct_test_confirmations c
 join private.r12_direct_enrollment_grants g on g.grant_id=c.grant_id
 join private.r12_direct_enrollment_packages p on p.package_hash=g.package_hash where c.envelope_id=envelope;
 if found and (attestation->'configuration'->>'releaseCommitSha' is distinct from evidence->'release'->>'commitSha'
 or attestation->>'deploymentEvidenceHash' is distinct from evidence->'release'->>'deploymentReceiptHash')
 then raise exception 'r12_steel_config_reviewed_release_changed';end if;
end $$;

-- The exact reserved operation has not crossed its one-shot transport marker.
-- Its maximum stays fully held. Only its pre-create unknown bit is excepted;
-- every other unknown, any anomaly, and every current cap remains a stop gate.
create function private.r12_steel_create_financial_current(operation uuid) returns void language plpgsql set search_path='' as $$
declare o private.r12_direct_browser_operations;e private.r12_direct_test_envelopes;b private.r12_owner_funding_bindings;
 source text;budget jsonb;total bigint;cap bigint;root_total bigint;root_unknown boolean;test_total bigint;begin
 select * into strict o from private.r12_direct_browser_operations where id=operation;
 select * into strict e from private.r12_direct_test_envelopes where id=o.envelope_id;
 select * into strict b from private.r12_owner_funding_bindings where id=e.binding_id for update;
 select source_key into strict source from private.r05_requests where id=o.request_id;
 if b.business_id<>e.business_id or b.authority_root_id<>e.authority_root_id
 or private.r05_paused(e.business_id,'business',e.business_id) or private.r05_paused(e.business_id,'quest',e.goal_id)
 or exists(select 1 from private.r12_direct_browser_anomalies where operation_id=o.id)
 or exists(select 1 from private.r12_direct_exposure(e.business_id) x where x.currency<>'USD' or (x.unknown and x.source_key<>source))
 then raise exception 'r12_steel_config_unresolved_liability';end if;
 select maximum_microunits into cap from private.r05_cap_versions where business_id=e.business_id and currency='USD' order by revision desc limit 1;
 select coalesce(sum(held),0) into total from private.r12_direct_exposure(e.business_id);
 if cap is null or total>least(cap,e.business_limit_microunits) then raise exception 'r12_steel_config_business_limit';end if;
 if b.kind='legacy_research_root' then
 budget:=private.stage13v2_budget_authority_before_direct(b.authority_root_id,true);
 select coalesce(sum(held),0),coalesce(bool_or(unknown and request_id<>o.request_id),false) into root_total,root_unknown from private.r12_direct_root_exposure(e.authority_root_id);
 if coalesce((budget->>'hasUncertainCosts')::boolean,false) or root_unknown then raise exception 'r12_steel_config_unresolved_liability';end if;
 root_total:=root_total+(budget->>'committedMicrousd')::bigint;
 select coalesce((select maximum_microunits from private.r12_owner_funding_revisions where binding_id=b.id order by revision desc limit 1),(budget->>'maximumMicrousd')::bigint) into cap;
 else root_total:=total;cap:=e.root_limit_microunits;end if;
 if cap is null or root_total>least(cap,e.root_limit_microunits) then raise exception 'r12_steel_config_root_limit';end if;
 select coalesce(sum(x.held),0) into test_total from private.r12_direct_root_exposure(e.authority_root_id) x join private.r12_direct_request_bindings m on m.request_id=x.request_id and m.envelope_id=e.id;
 if test_total>e.maximum_microunits then raise exception 'r12_steel_config_test_limit';end if;
end $$;

-- All operation identities and expected create settings come from immutable
-- admitted scopes. No caller-supplied profile, timeout, route or envelope.
create function private.r12_steel_create_config_context(operation uuid,key_hash text) returns jsonb language plpgsql set search_path='' as $$
declare o private.r12_direct_browser_operations;e private.r12_direct_test_envelopes;r private.r12_direct_browser_routes;
 s private.r12_etsy_steel_setups;v private.r12_etsy_steel_verification_runs;a private.r12_direct_phase_attempts;
 research private.r12_direct_research_setups;activation private.r12_direct_research_activations;k private.r12_etsy_steel_keys;
 scope jsonb;renderer jsonb;q jsonb;body jsonb;profile uuid;expires timestamptz;kind text;timeout integer;begin
 select * into strict o from private.r12_direct_browser_operations where id=operation;
 select * into strict e from private.r12_direct_test_envelopes where id=o.envelope_id;
 perform 1 from public.businesses where id=e.business_id and owner_user_id=e.owner_id for update;
 if not found then raise exception 'r12_steel_config_owner_changed';end if;
 perform 1 from private.r12_owner_funding_bindings where id=e.binding_id for update;
 perform private.r12_direct_test_current(e.id);
 select * into strict r from private.r12_direct_browser_routes where route_hash=o.route_hash;
 if r.valid_from>clock_timestamp() or r.valid_until<=clock_timestamp() or exists(select 1 from private.r12_direct_browser_route_revocations where route_hash=r.route_hash)
 or not exists(select 1 from private.r05_reservations where request_id=o.request_id) or not exists(select 1 from private.r05_markers where request_id=o.request_id) or exists(select 1 from private.r05_releases where request_id=o.request_id)
 or exists(select 1 from private.r12_direct_browser_sessions where operation_id=o.id)
 or exists(select 1 from private.r12_direct_browser_receipts where operation_id=o.id)
 or exists(select 1 from private.r12_direct_browser_evidence evidence where evidence.operation_id=o.id and evidence.kind='release')
 then raise exception 'r12_steel_config_operation_inactive';end if;
 select * into s from private.r12_etsy_steel_setups where operation_id=o.id;
 select * into v from private.r12_etsy_steel_verification_runs where operation_id=o.id;
 select * into a from private.r12_direct_phase_attempts where phase='source' and source_scope->>'operationId'=o.id::text;
 if (case when s.operation_id is null then 0 else 1 end)+(case when v.operation_id is null then 0 else 1 end)+(case when a.attempt_id is null then 0 else 1 end)<>1 then raise exception 'r12_steel_config_operation_ambiguous';end if;
 expires:=least(e.expires_at,r.valid_until);
 if s.operation_id is not null or v.operation_id is not null then
 select * into k from private.r12_etsy_steel_keys x where x.key_hash=r12_steel_create_config_context.key_hash;
 if v.operation_id is not null then select * into strict s from private.r12_etsy_steel_setups where operation_id=v.setup_operation_id;kind:='verification';else kind:='setup';end if;
 if k.key_hash is null or k.purpose is distinct from (case when kind='setup' then 'handoff' else 'verification' end) or k.envelope_id<>e.id or k.route_hash<>r.route_hash or k.valid_until<=clock_timestamp()
 or exists(select 1 from private.r12_etsy_steel_key_revocations x where x.key_hash=k.key_hash)
 then raise exception 'r12_steel_config_server_key_required' using errcode='42501';end if;
 if s.envelope_id<>e.id or s.business_id<>e.business_id or s.route_hash<>o.route_hash
 or (kind='setup' and s.request_id<>o.request_id) or (kind='verification' and v.request_id<>o.request_id) then raise exception 'r12_steel_config_operation_binding';end if;
 s:=private.r12_etsy_steel_current(s.operation_id,true);
 q:=private.r12_direct_setup_quote_current(e.id,o.id,kind);
 expires:=least(expires,s.approval_expires_at,k.valid_until,(q->>'validUntil')::timestamptz);
 if kind='setup' then
 scope:=s.scope;renderer:=private.r12_direct_owner_renderer(s.operation_id);timeout:=(scope->>'maximumSessionMs')::integer;
 select least(expires,expires_at) into expires from private.r12_etsy_steel_admissions where operation_id=s.operation_id and stage='create';
 if expires is null or not exists(select 1 from private.r12_etsy_steel_cleanup where operation_id=o.id) or exists(select 1 from private.r12_etsy_steel_dispatches where operation_id=o.id) then raise exception 'r12_steel_config_operation_inactive';end if;
 else
 scope:=v.scope;renderer:=private.r12_direct_verification_renderer(v.operation_id,'check');timeout:=(scope->>'maximumSessionMs')::integer;profile:=(scope->>'profileId')::uuid;
 select least(expires,v.expires_at,created_at+interval '30 seconds') into expires from private.r12_etsy_steel_verification_cleanup where operation_id=o.id;
 if expires is null or exists(select 1 from private.r12_etsy_steel_verification_dispatches where operation_id=o.id) then raise exception 'r12_steel_config_operation_inactive';end if;
 end if;
 else
 kind:='source';research:=private.r12_direct_research_current(a.scope_id);
 if research.envelope_id<>e.id or research.business_id<>e.business_id or a.request_id<>o.request_id or a.source_scope->>'sourceAttemptId' is distinct from a.attempt_id::text then raise exception 'r12_steel_config_operation_binding';end if;
 select * into strict activation from private.r12_direct_research_activations where scope_id=a.scope_id;
 if key_hash is distinct from activation.source_key_hash then raise exception 'r12_steel_config_server_key_required' using errcode='42501';end if;
 if not exists(select 1 from private.r07_heads where business_id=e.business_id and goal_id=e.goal_id and plan_id=research.plan_id and state='running') or not exists(select 1 from private.r07_attempts where id=a.attempt_id and status='dispatched') or exists(select 1 from private.r12_direct_phase_receipts where attempt_id=a.attempt_id)
 or not exists(select 1 from private.r12_direct_source_cleanup where attempt_id=a.attempt_id) or exists(select 1 from private.r12_direct_source_transport_claims where attempt_id=a.attempt_id)
 then raise exception 'r12_steel_config_operation_inactive';end if;
 scope:=a.source_scope;timeout:=(scope->'limits'->>'maximumSessionMs')::integer;
 select (candidate->>'profileId')::uuid into strict profile from private.r12_etsy_steel_candidates where binding_id=(scope->'accountBinding'->>'profileBindingId')::uuid and binding_revision=(scope->'accountBinding'->>'profileBindingRevision')::uuid;
 renderer:=private.r12_landing_source(a.attempt_id);
 select least(expires,(scope->>'expiresAt')::timestamptz,(a.quote->>'validUntil')::timestamptz,(permit->>'expiresAt')::timestamptz) into expires from private.r12_direct_source_admissions where attempt_id=a.attempt_id and sequence=0;
 end if;
 expires:=least(expires,(renderer->>'expiresAt')::timestamptz);
 if expires is null or expires<=clock_timestamp() or (case when kind='source' then scope||jsonb_build_object('testEnvelopeId',e.id,'testEnvelopeHash',e.content_hash) else scope end) is distinct from o.scope or private.stage14_hash(o.scope) is distinct from o.scope_hash or timeout is null or timeout<15000 or timeout>r.maximum_session_ms then raise exception 'r12_steel_config_operation_inactive';end if;
 perform private.r12_steel_create_financial_current(o.id);
 body:=jsonb_build_object('sessionId',o.id,'projectId',r.provider_project_id,'timeout',timeout,'persistProfile',kind='setup','debugConfig',jsonb_build_object('interactive',kind='setup','systemCursor',kind='setup'),'useProxy',false,'solveCaptcha',false,'stealthConfig',jsonb_build_object('autoCaptchaSolving',false,'humanizeInteractions',false,'skipFingerprintInjection',true));
 if kind<>'setup' then if profile is null then raise exception 'r12_steel_config_profile_required';end if;body:=body||jsonb_build_object('profileId',profile);end if;
 return jsonb_build_object('businessId',e.business_id,'envelopeId',e.id,'authorityRootId',e.authority_root_id,'routeHash',r.route_hash,'providerProjectId',r.provider_project_id,'scopeHash',private.stage14_hash(scope),'requestBodyHash',private.stage14_hash(body),'expiresAt',private.r12_direct_time(expires));
end $$;

create function public.r12_steel_create_config_admit(p_business_id uuid,p_request jsonb,p_server_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb;att private.r12_steel_config_attestations;old private.r12_steel_create_config_requests;prior private.r12_steel_create_config_permits;key_hash text;op uuid;body jsonb;expires timestamptz;k text;begin
 if p_server_key is null or length(p_server_key) not between 32 and 200 then raise exception 'r12_steel_config_server_key_required' using errcode='42501';end if;
 perform private.r04_keys(p_request,array['version','operationId','scopeHash','providerProjectId','credentialBindingHash','configurationHash','deploymentId','requestBodyHash']);
 if octet_length(p_request::text)>4000 or p_request->>'version' is distinct from 'r12.steel-create-config-admission.1' or coalesce(p_request->>'deploymentId','')!~'^dpl_[A-Za-z0-9_-]{1,124}$' then raise exception 'r12_steel_config_request_invalid';end if;
 foreach k in array array['scopeHash','credentialBindingHash','configurationHash','requestBodyHash'] loop if coalesce(p_request->>k,'')!~'^[a-f0-9]{64}$' then raise exception 'r12_steel_config_request_invalid';end if;end loop;
 op:=(p_request->>'operationId')::uuid;if op is null or (p_request->>'providerProjectId')::uuid is null or p_server_key is null then raise exception 'r12_steel_config_request_invalid';end if;
 key_hash:=encode(extensions.digest(convert_to(p_server_key,'UTF8'),'sha256'),'hex');ctx:=private.r12_steel_create_config_context(op,key_hash);
 if ctx->>'businessId' is distinct from p_business_id::text or ctx->'scopeHash' is distinct from p_request->'scopeHash' or ctx->'providerProjectId' is distinct from p_request->'providerProjectId' or ctx->'requestBodyHash' is distinct from p_request->'requestBodyHash' then raise exception 'r12_steel_config_request_binding';end if;
 if exists(select 1 from private.r12_steel_create_config_uses where operation_id=op) then raise exception 'r12_steel_config_create_already_consumed';end if;
 select * into old from private.r12_steel_create_config_requests where operation_id=op;
 if old.operation_id is not null and (old.request is distinct from p_request or old.key_hash is distinct from key_hash) then raise exception 'r12_steel_config_request_changed';end if;
 select * into att from private.r12_steel_config_attestations x where x.route_hash=ctx->>'routeHash' and x.configuration_hash=p_request->>'configurationHash' and x.credential_binding_hash=p_request->>'credentialBindingHash' and x.provider_project_id=(p_request->>'providerProjectId')::uuid and x.deployment_id=p_request->>'deploymentId' and x.valid_from<=clock_timestamp() and x.valid_until>clock_timestamp() and not exists(select 1 from private.r12_steel_config_attestation_revocations z where z.attestation_hash=x.attestation_hash) order by x.created_at desc,x.attestation_hash desc limit 1;
 if att.attestation_hash is null then raise exception 'r12_steel_config_attestation_required';end if;perform private.r12_steel_config_attestation_check(att.content);perform private.r12_steel_config_release_check((ctx->>'envelopeId')::uuid,att.content);
 select * into prior from private.r12_steel_create_config_permits where operation_id=op and attestation_hash=att.attestation_hash and valid_until>clock_timestamp() order by created_at desc,admission_hash desc limit 1;
 if prior.admission_hash is not null then return prior.permit;end if;
 expires:=least(clock_timestamp()+interval '30 seconds',att.valid_until,(ctx->>'expiresAt')::timestamptz);expires:=(private.r12_direct_time(expires))::timestamptz;
 if expires<=clock_timestamp() then raise exception 'r12_steel_config_permit_expired';end if;
 body:=jsonb_build_object('version','r12.steel-create-config-permit.1','operationId',op,'scopeHash',p_request->>'scopeHash','providerProjectId',p_request->>'providerProjectId','requestBodyHash',p_request->>'requestBodyHash','configurationHash',p_request->>'configurationHash','credentialBindingHash',p_request->>'credentialBindingHash','deploymentId',p_request->>'deploymentId','attestationHash',att.attestation_hash,'validUntil',private.r12_direct_time(expires));body:=body||jsonb_build_object('admissionHash',private.stage14_hash(body));
 insert into private.r12_steel_create_config_requests(operation_id,business_id,envelope_id,key_hash,request,request_hash) values(op,p_business_id,(ctx->>'envelopeId')::uuid,key_hash,p_request,private.stage14_hash(p_request)) on conflict do nothing;
 insert into private.r12_steel_create_config_permits(admission_hash,operation_id,attestation_hash,permit,valid_until) values(body->>'admissionHash',op,att.attestation_hash,body,expires);return body;
end $$;

-- Guards are on the actual one-shot transport markers, independent of public
-- wrapper routing, so every direct create requires a current matching permit.
create function private.r12_steel_create_config_consume() returns trigger language plpgsql set search_path='' as $$
declare op uuid;r private.r12_steel_create_config_requests;p private.r12_steel_create_config_permits;a private.r12_steel_config_attestations;ctx jsonb;begin
 if tg_table_schema<>'private' or tg_op<>'INSERT' then raise exception 'r12_steel_config_guard_target';end if;
 if tg_table_name in ('r12_etsy_steel_dispatches','r12_etsy_steel_verification_dispatches') then op:=new.operation_id;
 elsif tg_table_name='r12_direct_source_transport_claims' then select (source_scope->>'operationId')::uuid into strict op from private.r12_direct_phase_attempts where attempt_id=new.attempt_id and phase='source';
 else raise exception 'r12_steel_config_guard_target';end if;
 select * into r from private.r12_steel_create_config_requests where operation_id=op;
 if r.operation_id is null then raise exception 'r12_steel_config_permit_required';end if;
 ctx:=private.r12_steel_create_config_context(op,r.key_hash);
 select x.* into p from private.r12_steel_create_config_permits x where x.operation_id=op and x.valid_until>clock_timestamp() and not exists(select 1 from private.r12_steel_config_attestation_revocations z where z.attestation_hash=x.attestation_hash) order by x.created_at desc,x.admission_hash desc limit 1;
 select * into a from private.r12_steel_config_attestations where attestation_hash=p.attestation_hash;
 if p.admission_hash is null or a.attestation_hash is null or a.valid_from>clock_timestamp() or a.valid_until<=clock_timestamp() then raise exception 'r12_steel_config_permit_required';end if;
 perform private.r12_steel_config_attestation_check(a.content);perform private.r12_steel_config_release_check((ctx->>'envelopeId')::uuid,a.content);
 if a.route_hash is distinct from ctx->>'routeHash' or p.permit->'scopeHash' is distinct from ctx->'scopeHash' or p.permit->'requestBodyHash' is distinct from ctx->'requestBodyHash' or p.permit->'providerProjectId' is distinct from ctx->'providerProjectId'
 or p.permit->'configurationHash' is distinct from r.request->'configurationHash' or p.permit->'credentialBindingHash' is distinct from r.request->'credentialBindingHash' or p.permit->'deploymentId' is distinct from r.request->'deploymentId'
 then raise exception 'r12_steel_config_permit_binding';end if;
 insert into private.r12_steel_create_config_uses(operation_id,admission_hash) values(op,p.admission_hash);return new;
end $$;
create trigger r12_steel_create_configuration before insert on private.r12_etsy_steel_dispatches for each row execute function private.r12_steel_create_config_consume();
create trigger r12_steel_create_configuration before insert on private.r12_etsy_steel_verification_dispatches for each row execute function private.r12_steel_create_config_consume();
create trigger r12_steel_create_configuration before insert on private.r12_direct_source_transport_claims for each row execute function private.r12_steel_create_config_consume();
do $$ declare f record;begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'r12_steel_%' loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);end loop;end $$;
revoke all on function public.r12_steel_create_config_admit(uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.r12_steel_create_config_admit(uuid,jsonb,text) to anon;
commit;
