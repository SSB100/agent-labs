-- Separately versioned, disabled-by-default browser accounting. No grants,
-- provider credentials, tariff qualifications or live routes are seeded.
begin;
create table private.r12_direct_test_envelopes(
 id uuid primary key,business_id uuid not null references public.businesses(id),goal_id uuid not null,owner_id uuid not null references auth.users(id),
 binding_id uuid not null references private.r12_owner_funding_bindings(id),authority_root_id uuid not null,policy_id uuid not null,
 origin_direct_run_id uuid not null unique,maximum_microunits bigint not null check(maximum_microunits between 1 and 10000000),
 business_limit_microunits bigint not null check(business_limit_microunits>=0),root_limit_microunits bigint not null check(root_limit_microunits>=0),
 content jsonb not null,content_hash text not null unique check(content_hash=private.stage14_hash(content)),expires_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(),foreign key(policy_id,business_id) references private.r05_policies(id,business_id));
create table private.r12_direct_test_revocations(envelope_id uuid primary key references private.r12_direct_test_envelopes(id),reason text not null,created_at timestamptz not null default clock_timestamp());
create table private.r12_direct_browser_routes(
 route_hash text primary key check(route_hash~'^[a-f0-9]{64}$'),tariff_hash text not null check(tariff_hash~'^[a-f0-9]{64}$'),
 qualification_hash text not null check(qualification_hash~'^[a-f0-9]{64}$'),credential_binding_hash text not null check(credential_binding_hash~'^[a-f0-9]{64}$'),
 provider_project_id uuid not null,provider_account_hash text not null check(provider_account_hash~'^[a-f0-9]{64}$'),
 maximum_session_ms integer not null check(maximum_session_ms between 15000 and 900000),
 maximum_session_microunits bigint not null check(maximum_session_microunits between 1 and 10000000),
 settlement_contract_hash text not null check(settlement_contract_hash~'^[a-f0-9]{64}$'),content jsonb not null,
 content_hash text not null check(content_hash=private.stage14_hash(content)),valid_from timestamptz not null,valid_until timestamptz not null check(valid_until>valid_from));
create table private.r12_direct_browser_route_revocations(route_hash text primary key references private.r12_direct_browser_routes(route_hash),created_at timestamptz not null default clock_timestamp());
create table private.r12_direct_request_bindings(request_id uuid primary key references private.r05_requests(id),envelope_id uuid not null references private.r12_direct_test_envelopes(id),kind text not null check(kind in ('owner_setup','research_source','research_model')));
create table private.r12_direct_browser_operations(
 id uuid primary key,envelope_id uuid not null references private.r12_direct_test_envelopes(id),request_id uuid not null unique references private.r05_requests(id),
 operation_kind text not null check(operation_kind in ('owner_setup','research_source')),request_hash text not null check(request_hash~'^[a-f0-9]{64}$'),
 reservation_hash text not null check(reservation_hash~'^[a-f0-9]{64}$'),quote_hash text not null check(quote_hash~'^[a-f0-9]{64}$'),route_hash text not null references private.r12_direct_browser_routes(route_hash),
 maximum_microunits bigint not null check(maximum_microunits between 1 and 10000000),scope jsonb not null,scope_hash text not null check(scope_hash=private.stage14_hash(scope)),created_at timestamptz not null default clock_timestamp());
create table private.r12_direct_browser_sessions(operation_id uuid primary key references private.r12_direct_browser_operations(id),provider_session_id text not null unique,provider_project_id uuid not null,usage_identity_hash text not null unique check(usage_identity_hash~'^[a-f0-9]{64}$'),content jsonb not null,content_hash text not null check(content_hash=private.stage14_hash(content)),created_at timestamptz not null default clock_timestamp());
create table private.r12_direct_browser_receipts(operation_id uuid primary key references private.r12_direct_browser_operations(id),receipt_hash text not null unique check(receipt_hash=private.stage14_hash(content-'receiptHash')),content jsonb not null,created_at timestamptz not null default clock_timestamp());
create table private.r12_direct_browser_evidence(evidence_hash text primary key check(evidence_hash=private.stage14_hash(content)),operation_id uuid not null references private.r12_direct_browser_operations(id),kind text not null check(kind in ('release','usage_bound','billing')),provider_record_id text not null,provider_session_id text not null,provider_project_id uuid not null,content jsonb not null,created_at timestamptz not null default clock_timestamp(),unique(kind,provider_record_id));
create table private.r12_direct_browser_accounting(operation_id uuid not null references private.r12_direct_browser_operations(id),revision integer not null check(revision>0),previous_record_hash text,record_hash text not null unique check(record_hash=private.stage14_hash(content-'recordHash')),status text not null check(status in ('qualified_bounded_pending','final_actual')),actual_microunits bigint,provider_billing_record_hash text,content jsonb not null,created_at timestamptz not null default clock_timestamp(),primary key(operation_id,revision),check((status='qualified_bounded_pending' and actual_microunits is null and provider_billing_record_hash is null) or(status='final_actual' and actual_microunits between 0 and 10000000 and provider_billing_record_hash~'^[a-f0-9]{64}$')));
create table private.r12_direct_browser_anomalies(operation_id uuid not null references private.r12_direct_browser_operations(id),reason text not null check(reason in ('actual_above_reserved_bound','unbounded_usage','unqualified_billing')),provider_evidence_hash text not null,observed_actual_microunits bigint check(observed_actual_microunits between 0 and 9007199254740991),content jsonb not null,anomaly_hash text primary key check(anomaly_hash=private.stage14_hash(content-'anomalyHash')),created_at timestamptz not null default clock_timestamp(),unique(operation_id,reason,provider_evidence_hash));
create table private.r12_direct_browser_evidence_keys(key_hash text primary key check(key_hash~'^[a-f0-9]{64}$'),envelope_id uuid not null references private.r12_direct_test_envelopes(id),route_hash text not null references private.r12_direct_browser_routes(route_hash),valid_until timestamptz not null);
create table private.r12_direct_browser_evidence_key_revocations(key_hash text primary key references private.r12_direct_browser_evidence_keys(key_hash),created_at timestamptz not null default clock_timestamp());
create index r12_direct_browser_envelope on private.r12_direct_browser_operations(envelope_id);
create index r12_direct_request_envelope on private.r12_direct_request_bindings(envelope_id);
create index r12_direct_root on private.r12_direct_test_envelopes(authority_root_id);
create index r12_direct_accounting_operation on private.r12_direct_browser_accounting(operation_id,status);

do $$ declare n text;begin
 foreach n in array array['r12_direct_test_envelopes','r12_direct_test_revocations','r12_direct_browser_routes','r12_direct_browser_route_revocations','r12_direct_request_bindings','r12_direct_browser_operations','r12_direct_browser_sessions','r12_direct_browser_receipts','r12_direct_browser_evidence','r12_direct_browser_accounting','r12_direct_browser_anomalies','r12_direct_browser_evidence_keys','r12_direct_browser_evidence_key_revocations'] loop
 execute format('alter table private.%I enable row level security',n);execute format('revoke all on private.%I from public,anon,authenticated,service_role',n);
 execute format('create trigger r12_direct_immutable before insert or update or delete on private.%I for each row execute function private.r05_guard()',n);end loop;
end $$;

-- Only the new direct lane may treat a qualified held maximum as bounded.
-- Old r05_exposure is deliberately untouched and remains stricter.
create function private.r12_direct_browser_exposure(b uuid) returns table(operation_id uuid,request_id uuid,source_key text,policy_id uuid,known_actual bigint,pending_maximum bigint,held bigint,unknown boolean) language sql stable set search_path='' as $$
 select o.id,r.id,r.source_key,r.policy_id,coalesce(a.actual,0),
 case when z.n>0 then greatest(o.maximum_microunits,coalesce(z.observed,0),coalesce(a.actual,0))-coalesce(a.actual,0) when a.actual is null then o.maximum_microunits else 0 end,
 case when z.n>0 then greatest(o.maximum_microunits,coalesce(z.observed,0),coalesce(a.actual,0)) else coalesce(a.actual,o.maximum_microunits) end,
 z.n>0 or (a.actual is null and (a.records=0 or exists(select 1 from private.r12_direct_browser_route_revocations v where v.route_hash=o.route_hash)))
 from private.r12_direct_browser_operations o join private.r12_direct_test_envelopes e on e.id=o.envelope_id
 join private.r05_requests r on r.id=o.request_id join private.r05_reservations v on v.request_id=r.id
 left join lateral(select max(actual_microunits) filter(where status='final_actual') actual,count(*) records from private.r12_direct_browser_accounting a where a.operation_id=o.id) a on true
 left join lateral(select count(*) n,max(observed_actual_microunits) observed from private.r12_direct_browser_anomalies z where z.operation_id=o.id) z on true where e.business_id=b
$$;
create function private.r12_direct_exposure(b uuid) returns table(source_key text,currency text,held bigint,unknown boolean,policy_id uuid) language sql stable set search_path='' as $$
 select x.* from private.r05_exposure(b) x where not exists(select 1 from private.r12_direct_browser_operations o join private.r05_requests r on r.id=o.request_id where r.business_id=b and r.source_key=x.source_key)
 union all select source_key,'USD',held,unknown,policy_id from private.r12_direct_browser_exposure(b)
$$;
create function private.r12_direct_root_exposure(root_id uuid) returns table(request_id uuid,business_id uuid,held bigint,actual bigint,is_pending boolean,unknown boolean) language sql stable set search_path='' as $$
 select r.id,r.business_id,x.held,x.known_actual,x.pending_maximum>0,x.unknown from private.r12_direct_test_envelopes e
 join private.r12_direct_browser_operations o on o.envelope_id=e.id join private.r05_requests r on r.id=o.request_id
 join lateral private.r12_direct_browser_exposure(e.business_id) x on x.operation_id=o.id where e.authority_root_id=root_id
 union all
 select r.id,r.business_id,coalesce(s.actual,r.liability_microunits),coalesce(s.actual,0),s.actual is null,s.actual is null and exists(select 1 from private.r05_markers m where m.request_id=r.id)
 from private.r12_direct_test_envelopes e join private.r12_direct_request_bindings m on m.envelope_id=e.id and m.kind='research_model'
 join private.r05_requests r on r.id=m.request_id join private.r05_reservations v on v.request_id=r.id
 left join lateral(select max(actual_microunits) actual from private.r05_settlements where request_id=r.id and provider_request_id is not null) s on true
 where e.authority_root_id=root_id and not exists(select 1 from private.r05_releases z where z.request_id=r.id)
$$;

alter function private.stage13v2_budget_authority(uuid,boolean) rename to stage13v2_budget_authority_before_direct;
create function private.stage13v2_budget_authority(root_id uuid,lock_root boolean default false) returns jsonb language plpgsql set search_path='' as $$
declare result jsonb;known bigint;pending bigint;uncertain boolean;begin
 result:=private.stage13v2_budget_authority_before_direct(root_id,lock_root);
 select coalesce(sum(actual),0),coalesce(sum(held-actual),0),coalesce(bool_or(unknown or is_pending),false) into known,pending,uncertain from private.r12_direct_root_exposure((result->>'authorityRootId')::uuid);
 return result||jsonb_build_object('knownActualMicrousd',(result->>'knownActualMicrousd')::bigint+known,'pendingExposureMicrousd',(result->>'pendingExposureMicrousd')::bigint+pending,'committedMicrousd',(result->>'committedMicrousd')::bigint+known+pending,'hasUncertainCosts',coalesce((result->>'hasUncertainCosts')::boolean,false) or uncertain);
end $$;
create function private.r12_direct_test_exposure(envelope uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare e private.r12_direct_test_envelopes;known bigint;pending bigint;uncertain boolean;begin
 select * into strict e from private.r12_direct_test_envelopes where id=envelope;
 select coalesce(sum(x.actual),0),coalesce(sum(x.held-x.actual),0),coalesce(bool_or(x.unknown),false) into known,pending,uncertain
 from private.r12_direct_root_exposure(e.authority_root_id) x join private.r12_direct_request_bindings m on m.request_id=x.request_id and m.envelope_id=e.id;
 return jsonb_build_object('version','r12.direct-test-exposure.1','testEnvelopeId',e.id,'testEnvelopeHash',e.content_hash,'knownActualMicrounits',known::text,'boundedPendingMicrounits',pending::text,'committedMicrounits',(known+pending)::text,'maximumMicrounits',e.maximum_microunits::text,'hasUnknownOrUnbounded',uncertain,'allBillingFinal',pending=0 and not uncertain);
end $$;

create function private.r12_direct_financial_check(envelope uuid,additional bigint) returns void language plpgsql set search_path='' as $$
declare e private.r12_direct_test_envelopes;binding private.r12_owner_funding_bindings;cap bigint;total bigint;root_total bigint;root_unknown boolean;budget jsonb;test jsonb;begin
 if additional<0 then raise exception 'r12_direct_invalid_liability';end if;
 select * into strict e from private.r12_direct_test_envelopes where id=envelope;
 perform 1 from public.businesses where id=e.business_id and owner_user_id=e.owner_id for update;if not found then raise exception 'r12_direct_owner_changed';end if;
 select * into strict binding from private.r12_owner_funding_bindings where id=e.binding_id and business_id=e.business_id for update;
 if binding.authority_root_id<>e.authority_root_id or clock_timestamp()>=e.expires_at or exists(select 1 from private.r12_direct_test_revocations where envelope_id=e.id)
 or not exists(select 1 from private.r05_confirmations where policy_id=e.policy_id and actor_id=e.owner_id)
 or exists(select 1 from private.r05_revocations where policy_id=e.policy_id) or private.r05_paused(e.business_id,'business',e.business_id) or private.r05_paused(e.business_id,'quest',e.goal_id) then raise exception 'r12_direct_authority_unavailable';end if;
 if exists(select 1 from private.r12_direct_exposure(e.business_id) where unknown or currency<>'USD') then raise exception 'r12_direct_unresolved_liability';end if;
 select maximum_microunits into cap from private.r05_cap_versions where business_id=e.business_id and currency='USD' order by revision desc limit 1;
 select coalesce(sum(held),0) into total from private.r12_direct_exposure(e.business_id);
 if cap is null or total+additional>least(cap,e.business_limit_microunits) then raise exception 'r12_direct_business_limit';end if;
 if binding.kind='legacy_research_root' then
 budget:=private.stage13v2_budget_authority_before_direct(binding.authority_root_id,true);
 select coalesce(sum(held),0),coalesce(bool_or(unknown),false) into root_total,root_unknown from private.r12_direct_root_exposure(e.authority_root_id);
 if coalesce((budget->>'hasUncertainCosts')::boolean,false) or root_unknown then raise exception 'r12_direct_unresolved_root_liability';end if;
 root_total:=root_total+(budget->>'committedMicrousd')::bigint;
 select coalesce((select maximum_microunits from private.r12_owner_funding_revisions where binding_id=binding.id order by revision desc limit 1),(budget->>'maximumMicrousd')::bigint) into cap;
 else root_total:=total;cap:=e.root_limit_microunits;end if;
 if root_total+additional>least(cap,e.root_limit_microunits) then raise exception 'r12_direct_root_limit';end if;
 test:=private.r12_direct_test_exposure(e.id);
 if (test->>'hasUnknownOrUnbounded')::boolean then raise exception 'r12_direct_unresolved_liability';end if;
 if (test->>'committedMicrounits')::bigint+additional>e.maximum_microunits then raise exception 'r12_direct_test_limit';end if;
end $$;

create function private.r12_direct_browser_anomaly(op_id uuid,reason_text text,evidence_hash text,actual bigint default null) returns jsonb language plpgsql set search_path='' as $$
declare o private.r12_direct_browser_operations;e private.r12_direct_test_envelopes;s private.r12_direct_browser_sessions;r private.r12_direct_browser_routes;body jsonb;begin
 select * into strict o from private.r12_direct_browser_operations where id=op_id;select * into strict e from private.r12_direct_test_envelopes where id=o.envelope_id;
 select * into strict s from private.r12_direct_browser_sessions where operation_id=o.id;select * into strict r from private.r12_direct_browser_routes where route_hash=o.route_hash;
 select content into body from private.r12_direct_browser_anomalies where operation_id=o.id and reason=reason_text and provider_evidence_hash=evidence_hash;if found then return body;end if;
 body:=jsonb_build_object('version','r12.public-browser-accounting-anomaly.1','businessId',e.business_id,'goalId',e.goal_id,'authorityRootId',e.authority_root_id,'envelopeHash',e.content_hash,'providerProjectId',r.provider_project_id,'operationId',o.id,'reservationId',o.request_id,'reservationHash',o.reservation_hash,'usageIdentityHash',s.usage_identity_hash,'maximumMicrounits',o.maximum_microunits::text,'reason',reason_text,'observedActualMicrounits',actual::text,'providerEvidenceHash',evidence_hash,'recordedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 body:=body||jsonb_build_object('anomalyHash',private.stage14_hash(body));
 insert into private.r12_direct_browser_anomalies values(o.id,reason_text,evidence_hash,actual,body,body->>'anomalyHash',clock_timestamp());return body;
end $$;

-- The evidence reader may attest only observations actually made by the trusted
-- provider/observer bridge. A generic release acknowledgement has no cost meaning.
create function private.r12_direct_browser_usage_qualified(o private.r12_direct_browser_operations,r private.r12_direct_browser_routes,s private.r12_direct_browser_sessions,u jsonb,rel jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare k text;bound jsonb:=r.content->'usageBound';begin
 if bound is distinct from '{"version":"r12.steel-usage-bound.1","maximumProxyBytes":0,"tariffCoversSessionAndProfileLifecycle":true,"captchaDisabled":true,"extraServicesDisabled":true}'::jsonb
 or u->>'usageIdentityHash' is distinct from s.usage_identity_hash or u->>'tariffHash' is distinct from r.tariff_hash or u->>'qualificationHash' is distinct from r.qualification_hash
 or u->'withinQualifiedLimits' is distinct from 'true'::jsonb or u->>'maximumMicrounits' is distinct from r.maximum_session_microunits::text or r.maximum_session_microunits>o.maximum_microunits
 or u->'proxySource' is distinct from 'null'::jsonb or u->'solveCaptcha' is distinct from 'false'::jsonb or u->'extraServicesDisabled' is distinct from 'true'::jsonb
 or coalesce(u->>'providerReadbackHash','')!~'^[a-f0-9]{64}$' or u->>'providerReadbackHash' is distinct from rel->>'providerReadbackHash' then return false;end if;
 foreach k in array array['requestedTimeoutMs','providerTimeoutMs','durationMs','proxyBytesUsed'] loop
 if jsonb_typeof(u->k) is distinct from 'number' or coalesce(u->>k,'')!~'^(0|[1-9][0-9]{0,8})$' then return false;end if;end loop;
 return (u->>'requestedTimeoutMs')::bigint between 15000 and r.maximum_session_ms
 and (u->>'providerTimeoutMs')::bigint=(u->>'requestedTimeoutMs')::bigint
 and (u->>'durationMs')::bigint<=(u->>'providerTimeoutMs')::bigint and (u->>'proxyBytesUsed')::bigint=0;
end $$;

create function private.r12_direct_browser_reconcile(op_id uuid,release_hash text,usage_hash text,billing_hash text default null) returns jsonb language plpgsql set search_path='' as $$
declare o private.r12_direct_browser_operations;e private.r12_direct_test_envelopes;s private.r12_direct_browser_sessions;r private.r12_direct_browser_routes;receipt private.r12_direct_browser_receipts;
 rel private.r12_direct_browser_evidence;usage private.r12_direct_browser_evidence;bill private.r12_direct_browser_evidence;last private.r12_direct_browser_accounting;body jsonb;actual bigint;anomaly jsonb;begin
 select * into strict o from private.r12_direct_browser_operations where id=op_id;select * into strict e from private.r12_direct_test_envelopes where id=o.envelope_id;
 perform 1 from public.businesses where id=e.business_id for update;perform 1 from private.r12_direct_browser_operations where id=o.id for update;
 select * into strict s from private.r12_direct_browser_sessions where operation_id=o.id;select * into strict r from private.r12_direct_browser_routes where route_hash=o.route_hash;
 select * into receipt from private.r12_direct_browser_receipts where operation_id=o.id;
 select * into rel from private.r12_direct_browser_evidence where evidence_hash=release_hash and operation_id=o.id and kind='release';
 select * into usage from private.r12_direct_browser_evidence where evidence_hash=usage_hash and operation_id=o.id and kind='usage_bound';
 if receipt.operation_id is null or rel.operation_id is null or usage.operation_id is null or rel.provider_session_id<>s.provider_session_id or usage.provider_session_id<>s.provider_session_id
 or rel.provider_project_id<>r.provider_project_id or usage.provider_project_id<>r.provider_project_id
 or rel.content->'terminal' is distinct from 'true'::jsonb or rel.content->'observersDisposed' is distinct from 'true'::jsonb
 or coalesce(rel.content->>'providerStatus','') not in ('released','failed') or coalesce(rel.content->>'providerReadbackHash','')!~'^[a-f0-9]{64}$' or coalesce(rel.content->>'disposalProofHash','')!~'^[a-f0-9]{64}$' then raise exception 'r12_direct_release_proof_required';end if;
 if private.r12_direct_browser_usage_qualified(o,r,s,usage.content,rel.content) is distinct from true then
 anomaly:=private.r12_direct_browser_anomaly(o.id,'unbounded_usage',usage_hash);return jsonb_build_object('accepted',false,'anomaly',anomaly);end if;
 select * into last from private.r12_direct_browser_accounting where operation_id=o.id order by revision desc limit 1;
 if last.operation_id is not null and last.content->>'releaseProofHash'<>release_hash then raise exception 'r12_direct_accounting_pin_conflict';end if;
 if billing_hash is null then
 if last.operation_id is not null then return jsonb_build_object('accepted',true,'accounting',last.content,'replayed',true);end if;
 if exists(select 1 from private.r12_direct_browser_route_revocations where route_hash=r.route_hash) then raise exception 'r12_direct_route_revoked';end if;
 else
 select * into bill from private.r12_direct_browser_evidence where evidence_hash=billing_hash and operation_id=o.id and kind='billing';
 if bill.operation_id is null then raise exception 'r12_direct_billing_evidence_required';end if;
 if bill.provider_session_id<>s.provider_session_id or bill.provider_project_id<>r.provider_project_id or bill.content->'qualified' is distinct from 'true'::jsonb
 or bill.content->>'usageIdentityHash' is distinct from s.usage_identity_hash or bill.content->>'tariffHash' is distinct from r.tariff_hash or bill.content->>'qualificationHash' is distinct from r.qualification_hash
 or bill.content->>'currency' is distinct from 'USD' or coalesce(bill.content->>'actualMicrounits','')!~'^(0|[1-9][0-9]{0,15})$' or (bill.content->>'actualMicrounits')::numeric>9007199254740991 then
 anomaly:=private.r12_direct_browser_anomaly(o.id,'unqualified_billing',billing_hash);return jsonb_build_object('accepted',false,'anomaly',anomaly);end if;
 actual:=(bill.content->>'actualMicrounits')::bigint;
 -- Authoritative above-bound amounts remain truthful in the common ledger,
 -- but cannot be promoted to a within-bound qualified record.
 insert into private.r05_settlements(request_id,business_id,currency,actual_microunits,provider_request_id,receipt_hash) values(o.request_id,e.business_id,'USD',actual,'steel:'||s.provider_session_id,billing_hash) on conflict(request_id,receipt_hash) do nothing;
 if actual>o.maximum_microunits then anomaly:=private.r12_direct_browser_anomaly(o.id,'actual_above_reserved_bound',billing_hash,actual);return jsonb_build_object('accepted',false,'anomaly',anomaly);end if;
 select content into body from private.r12_direct_browser_accounting where operation_id=o.id and provider_billing_record_hash=billing_hash;
 if found then return jsonb_build_object('accepted',true,'accounting',body,'replayed',true);end if;
 end if;
 body:=jsonb_build_object('version','r12.public-browser-accounting.1','businessId',e.business_id,'goalId',e.goal_id,'authorityRootId',e.authority_root_id,'envelopeHash',e.content_hash,'providerProjectId',r.provider_project_id,
 'operationKind',o.operation_kind,'operationId',o.id,'operationReceiptHash',receipt.receipt_hash,'requestHash',o.request_hash,'reservationId',o.request_id,'reservationHash',o.reservation_hash,'quoteHash',o.quote_hash,'routeHash',r.route_hash,'tariffHash',r.tariff_hash,'qualificationHash',r.qualification_hash,'releaseProofHash',release_hash,'usageIdentityHash',s.usage_identity_hash,
 'maximumMicrounits',o.maximum_microunits::text,'currency','USD','revision',coalesce(last.revision,0)+1,'previousRecordHash',last.record_hash,'recordedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'status',case when billing_hash is null then 'qualified_bounded_pending' else 'final_actual' end,'actualMicrounits',actual::text,'providerBillingRecordHash',billing_hash);
 body:=body||jsonb_build_object('recordHash',private.stage14_hash(body));
 insert into private.r12_direct_browser_accounting values(o.id,coalesce(last.revision,0)+1,last.record_hash,body->>'recordHash',body->>'status',actual,billing_hash,body,clock_timestamp());
 return jsonb_build_object('accepted',true,'accounting',body,'replayed',false);
end $$;

-- The caller first authenticates the exact owner setup approval or current
-- research attempt. This helper never enrolls a route, grant or policy.
create function private.r12_direct_browser_register(envelope uuid,op_id uuid,request uuid,kind text,scope jsonb,quote_hash text,route_hash text) returns jsonb language plpgsql set search_path='' as $$
declare e private.r12_direct_test_envelopes;r private.r05_requests;route private.r12_direct_browser_routes;reservation text;begin
 select * into strict e from private.r12_direct_test_envelopes where id=envelope;
 select * into strict r from private.r05_requests where id=request and business_id=e.business_id and policy_id=e.policy_id;
 select q.* into route from private.r12_direct_browser_routes q where q.route_hash=r12_direct_browser_register.route_hash and q.valid_from<=clock_timestamp() and q.valid_until>clock_timestamp();
 if route.route_hash is null or exists(select 1 from private.r12_direct_browser_route_revocations q where q.route_hash=route.route_hash) then raise exception 'r12_direct_qualified_route_required';end if;
 if kind not in ('owner_setup','research_source') or quote_hash!~'^[a-f0-9]{64}$' or scope->>'businessId' is distinct from e.business_id::text or scope->>'goalId' is distinct from e.goal_id::text
 or scope->>'authorityRootId' is distinct from e.authority_root_id::text or scope->>'testEnvelopeId' is distinct from e.id::text or scope->>'testEnvelopeHash' is distinct from e.content_hash
 or scope->>'providerProjectId' is distinct from route.provider_project_id::text or scope->>'quoteHash' is distinct from quote_hash or scope->>'maximumBrowserMicrounits' is distinct from r.liability_microunits::text
 or r.currency<>'USD' or r.payload->'accounting' is distinct from '{"kind":"r05"}'::jsonb or r.liability_microunits<route.maximum_session_microunits
 or (kind='research_source' and scope->>'sourceAttemptId' is distinct from r.workflow_run_id::text) then raise exception 'r12_direct_browser_scope_mismatch';end if;
 if exists(select 1 from private.r12_direct_browser_operations where id=op_id or request_id=r.id) or exists(select 1 from private.r05_reservations where request_id=r.id) then raise exception 'r12_direct_create_recovery_required';end if;
 perform private.r12_direct_financial_check(e.id,r.liability_microunits);
 reservation:=private.stage14_hash(jsonb_build_object('version','r12.direct-browser-reservation.1','businessId',e.business_id,'operationId',op_id,'requestId',r.id,'requestHash',r.request_hash,'envelopeHash',e.content_hash,'maximumMicrounits',r.liability_microunits::text,'quoteHash',quote_hash,'routeHash',route.route_hash));
 insert into private.r12_direct_request_bindings values(r.id,e.id,kind);
 insert into private.r12_direct_browser_operations values(op_id,e.id,r.id,kind,r.request_hash,reservation,quote_hash,route.route_hash,r.liability_microunits,scope,private.stage14_hash(scope),clock_timestamp());
 insert into private.r05_reservations(request_id,business_id) values(r.id,e.business_id);
 insert into private.r05_markers(request_id,business_id) values(r.id,e.business_id);
 return jsonb_build_object('operationId',op_id,'reservationId',r.id,'reservationHash',reservation,'maximumMicrounits',r.liability_microunits::text,'shouldDispatch',true);
end $$;

create function public.r12_direct_browser_ledger(p_business_id uuid,p_operation_id uuid,p_operation text,p_payload jsonb,p_server_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare o private.r12_direct_browser_operations;e private.r12_direct_test_envelopes;route private.r12_direct_browser_routes;s private.r12_direct_browser_sessions;k private.r12_direct_browser_evidence_keys;body jsonb;h text;identity_hash text;existing jsonb;begin
 perform private.r04_safe(p_payload);
 select * into o from private.r12_direct_browser_operations where id=p_operation_id;select * into e from private.r12_direct_test_envelopes where id=o.envelope_id and business_id=p_business_id;
 select * into k from private.r12_direct_browser_evidence_keys where key_hash=encode(extensions.digest(p_server_key,'sha256'),'hex') and envelope_id=e.id and route_hash=o.route_hash and valid_until>clock_timestamp();
 if e.id is null or k.key_hash is null or exists(select 1 from private.r12_direct_browser_evidence_key_revocations where key_hash=k.key_hash) then raise exception 'r12_direct_evidence_key_required' using errcode='42501';end if;
 select * into strict route from private.r12_direct_browser_routes where route_hash=o.route_hash;
 perform 1 from public.businesses where id=e.business_id for update;
 if p_operation='bind_session' then
 perform private.r04_keys(p_payload,array['sessionId','providerProjectId','providerAccountHash']);
 if p_payload->>'providerProjectId' is distinct from route.provider_project_id::text or p_payload->>'providerAccountHash' is distinct from route.provider_account_hash or coalesce(p_payload->>'sessionId','')!~'^[A-Za-z0-9_-]{1,200}$' or (o.operation_kind='owner_setup' and p_payload->>'sessionId'<>o.id::text) then raise exception 'r12_direct_session_scope_mismatch';end if;
 identity_hash:=private.stage14_hash(jsonb_build_object('provider','steel','providerProjectId',route.provider_project_id,'providerAccountHash',route.provider_account_hash,'sessionId',p_payload->>'sessionId'));
 select content into existing from private.r12_direct_browser_sessions where operation_id=o.id;
 if found then if existing is distinct from p_payload then raise exception 'r12_direct_session_conflict';end if;else insert into private.r12_direct_browser_sessions values(o.id,p_payload->>'sessionId',route.provider_project_id,identity_hash,p_payload,private.stage14_hash(p_payload),clock_timestamp());end if;
 return jsonb_build_object('operationId',o.id,'usageIdentityHash',identity_hash);
 elsif p_operation='receipt' then
 body:=p_payload;h:=body->>'receiptHash';
 if h is distinct from private.stage14_hash(body-'receiptHash') or body->>'operationId' is distinct from o.id::text or not (body->>'scopeHash'=o.scope_hash or body->>'requestHash'=o.request_hash) then raise exception 'r12_direct_receipt_mismatch';end if;
 select content into existing from private.r12_direct_browser_receipts where operation_id=o.id;if found then if existing is distinct from body then raise exception 'r12_direct_receipt_conflict';end if;else insert into private.r12_direct_browser_receipts values(o.id,h,body,clock_timestamp());end if;
 return jsonb_build_object('operationId',o.id,'receiptHash',h,'persisted',true);
 elsif p_operation='evidence' then
 perform private.r04_keys(p_payload,array['kind','providerRecordId','content']);body:=p_payload->'content';
 select * into s from private.r12_direct_browser_sessions where operation_id=o.id;
 if s.operation_id is null or body->>'operationId' is distinct from o.id::text or body->>'sessionId' is distinct from s.provider_session_id or body->>'providerProjectId' is distinct from s.provider_project_id::text or coalesce(p_payload->>'providerRecordId','')!~'^[A-Za-z0-9_.:-]{1,240}$' or p_payload->>'kind' not in ('release','usage_bound','billing') then raise exception 'r12_direct_provider_evidence_mismatch';end if;
 h:=private.stage14_hash(body);select x.content into existing from private.r12_direct_browser_evidence x where x.kind=p_payload->>'kind' and x.provider_record_id=p_payload->>'providerRecordId';
 if found then if existing is distinct from body then raise exception 'r12_direct_provider_evidence_conflict';end if;else
 insert into private.r12_direct_browser_evidence values(h,o.id,p_payload->>'kind',p_payload->>'providerRecordId',s.provider_session_id,s.provider_project_id,body,clock_timestamp());end if;
 return jsonb_build_object('evidenceHash',h);
 elsif p_operation='reconcile' then
 perform private.r04_keys(p_payload,array['releaseProofHash','usageProofHash','billingProofHash']);
 return private.r12_direct_browser_reconcile(o.id,p_payload->>'releaseProofHash',p_payload->>'usageProofHash',p_payload->>'billingProofHash');
 elsif p_operation='read' then
 perform private.r04_keys(p_payload,array[]::text[]);
 return jsonb_build_object('operationId',o.id,'operationMaximumMicrounits',o.maximum_microunits::text,'scopeHash',o.scope_hash,'requestHash',o.request_hash,'qualification',jsonb_build_object('providerProjectId',route.provider_project_id,'providerAccountHash',route.provider_account_hash,'routeHash',route.route_hash,'tariffHash',route.tariff_hash,'qualificationHash',route.qualification_hash,'maximumSessionMs',route.maximum_session_ms,'maximumSessionMicrounits',route.maximum_session_microunits::text,'settlementContractHash',route.settlement_contract_hash,'priceEvidenceHash',route.content->'priceEvidenceHash','retentionDisclosure',route.content->'retentionDisclosure','validFrom',to_char(route.valid_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'validUntil',to_char(route.valid_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'revoked',exists(select 1 from private.r12_direct_browser_route_revocations where route_hash=route.route_hash),'usageBound',case when route.content->'usageBound'='{"version":"r12.steel-usage-bound.1","maximumProxyBytes":0,"tariffCoversSessionAndProfileLifecycle":true,"captchaDisabled":true,"extraServicesDisabled":true}'::jsonb then route.content->'usageBound' else null end),'accounting',coalesce((select jsonb_agg(content order by revision) from private.r12_direct_browser_accounting where operation_id=o.id),'[]'::jsonb),'anomalies',coalesce((select jsonb_agg(content order by created_at,anomaly_hash) from private.r12_direct_browser_anomalies where operation_id=o.id),'[]'::jsonb),'testExposure',private.r12_direct_test_exposure(e.id));
 end if;raise exception 'r12_direct_unknown_ledger_operation';
end $$;

do $$ declare f record;begin for f in select p.oid::regprocedure name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and (p.proname like 'r12_direct_%' or p.proname='stage13v2_budget_authority_before_direct') loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.name);end loop;end $$;
revoke all on function private.stage13v2_budget_authority(uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.r12_direct_browser_ledger(uuid,uuid,text,jsonb,text) from public,authenticated,service_role;
grant execute on function public.r12_direct_browser_ledger(uuid,uuid,text,jsonb,text) to anon;
commit;
