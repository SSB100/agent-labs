-- Separate owner Steel login handoff. Definition only: no authority, credentials,
-- profiles, routes, funding envelopes or provider calls are installed here.
-- Existing Accounts/OAuth semantics are intentionally unchanged.
begin;
create table private.r12_etsy_steel_keys (
 key_hash text primary key check(key_hash ~ '^[a-f0-9]{64}$'),
 envelope_id uuid not null references private.r12_direct_test_envelopes(id),
 route_hash text not null references private.r12_direct_browser_routes(route_hash),
 purpose text not null check(purpose in ('handoff','verification','cleanup')),valid_until timestamptz not null
);
create table private.r12_etsy_steel_key_revocations(key_hash text primary key references private.r12_etsy_steel_keys(key_hash),created_at timestamptz not null default clock_timestamp());
create table private.r12_etsy_steel_setups (
 operation_id uuid primary key,business_id uuid not null references public.businesses(id),owner_id uuid not null references auth.users(id),
 envelope_id uuid not null references private.r12_direct_test_envelopes(id),route_hash text not null references private.r12_direct_browser_routes(route_hash),
 request_id uuid not null unique references private.r05_requests(id),workflow_run_id uuid not null unique references public.workflow_runs(id),
 account_id uuid not null,account_revision uuid not null unique,approval_id uuid not null unique,approval_revision uuid not null unique,
 scope jsonb not null,scope_hash text not null unique check(scope_hash=private.stage14_hash(scope)),
 disclosure jsonb not null,disclosure_hash text not null check(disclosure_hash=private.stage14_hash(disclosure)),
 approval_expires_at timestamptz not null,profile_expires_at timestamptz not null,
 sequence bigint generated always as identity unique,created_at timestamptz not null default clock_timestamp()
);
create index r12_etsy_steel_current_account on private.r12_etsy_steel_setups(business_id,account_id,sequence desc);
create table private.r12_etsy_steel_approvals(operation_id uuid primary key references private.r12_etsy_steel_setups(operation_id),owner_id uuid not null references auth.users(id),scope_hash text not null,disclosure_hash text not null,approval_revision uuid not null,created_at timestamptz not null default clock_timestamp());
create table private.r12_etsy_steel_stops(operation_id uuid primary key references private.r12_etsy_steel_setups(operation_id),owner_id uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp());
create table private.r12_etsy_steel_admissions (
 request_id uuid primary key,operation_id uuid not null references private.r12_etsy_steel_setups(operation_id),stage text not null,
 request jsonb not null,request_hash text not null unique check(request_hash=private.stage14_hash(request)),permit jsonb not null,
 expires_at timestamptz not null,created_at timestamptz not null default clock_timestamp()
);
create table private.r12_etsy_steel_dispatches(operation_id uuid primary key references private.r12_etsy_steel_setups(operation_id),request_hash text not null unique references private.r12_etsy_steel_admissions(request_hash),created_at timestamptz not null default clock_timestamp());
create table private.r12_etsy_steel_permit_uses(request_hash text primary key references private.r12_etsy_steel_admissions(request_hash),created_at timestamptz not null default clock_timestamp());
create table private.r12_etsy_steel_handoffs (
 id uuid primary key,operation_id uuid not null unique references private.r12_etsy_steel_setups(operation_id),
 record jsonb not null,record_hash text not null unique check(record_hash=private.stage14_hash(record-'recordHash')),
 expires_at timestamptz not null,created_at timestamptz not null default clock_timestamp()
);
create table private.r12_etsy_steel_consumptions(handoff_id uuid primary key references private.r12_etsy_steel_handoffs(id),action text not null check(action in ('return','stop','expiry')),record_hash text not null,created_at timestamptz not null default clock_timestamp());
-- Registered before dispatch, so create ambiguity or a failed encrypted store
-- cannot lose cleanup responsibility. A durable worker scans outstanding rows.
create table private.r12_etsy_steel_cleanup (
 operation_id uuid primary key references private.r12_etsy_steel_setups(operation_id),provider_session_id uuid not null,
 provider_project_id uuid not null,due_at timestamptz not null,created_at timestamptz not null default clock_timestamp()
);
create table private.r12_etsy_steel_cleanup_proofs (
 operation_id uuid primary key references private.r12_etsy_steel_cleanup(operation_id),release_evidence_hash text not null references private.r12_direct_browser_evidence(evidence_hash),created_at timestamptz not null default clock_timestamp()
);
create table private.r12_etsy_steel_candidates (
 binding_id uuid primary key,binding_revision uuid not null unique,operation_id uuid not null unique references private.r12_etsy_steel_setups(operation_id),
 candidate jsonb not null,candidate_hash text not null unique check(candidate_hash=private.stage14_hash(candidate-'candidateHash')),
 created_at timestamptz not null default clock_timestamp()
);
create table private.r12_etsy_steel_receipts (
 receipt_hash text primary key check(receipt_hash ~ '^[a-f0-9]{64}$'),operation_id uuid not null references private.r12_etsy_steel_setups(operation_id),
 receipt jsonb not null check(receipt_hash=private.stage14_hash(receipt-'receiptHash')),created_at timestamptz not null default clock_timestamp()
);
create table private.r12_etsy_steel_verifications (
 binding_id uuid primary key references private.r12_etsy_steel_candidates(binding_id),verification jsonb not null,
 verification_hash text not null unique check(verification_hash=private.stage14_hash(verification-'verificationHash')),
 binding jsonb not null,binding_hash text not null unique check(binding_hash=private.stage14_hash(binding-'bindingHash')),
 created_at timestamptz not null default clock_timestamp()
);
create table private.r12_etsy_steel_verification_runs (
 operation_id uuid primary key,setup_operation_id uuid not null unique references private.r12_etsy_steel_setups(operation_id),
 request_id uuid not null unique references private.r05_requests(id),workflow_run_id uuid not null unique references public.workflow_runs(id),
 scope jsonb not null,scope_hash text not null unique check(scope_hash=private.stage14_hash(scope)),expires_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp()
);
create table private.r12_etsy_steel_verification_dispatches(operation_id uuid primary key references private.r12_etsy_steel_verification_runs(operation_id),created_at timestamptz not null default clock_timestamp());
create table private.r12_etsy_steel_verification_cleanup(operation_id uuid primary key references private.r12_etsy_steel_verification_runs(operation_id),provider_session_id uuid not null,provider_project_id uuid not null,due_at timestamptz not null,created_at timestamptz not null default clock_timestamp());
create table private.r12_etsy_steel_verification_release(operation_id uuid primary key references private.r12_etsy_steel_verification_runs(operation_id),release_evidence_hash text not null references private.r12_direct_browser_evidence(evidence_hash),created_at timestamptz not null default clock_timestamp());
do $$ declare t text;begin
 for t in select tablename from pg_tables where schemaname='private' and tablename like 'r12_etsy_steel_%' loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
  execute format('create trigger r12_etsy_steel_immutable before insert or update or delete on private.%I for each row execute function private.r05_guard()',t);
 end loop;
end $$;
revoke all on sequence private.r12_etsy_steel_setups_sequence_seq from public,anon,authenticated,service_role;

create function private.r12_etsy_steel_disclosure(s jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select '{"version":"etsy.steel-owner-handoff-disclosure.1","provider":"steel","destination":"https://www.etsy.com","recording":"provider_records_session","manualPasswordMasking":"not_verified","manualMfaMasking":"not_verified","networkSecretRedaction":"not_verified","profilePersistence":"provider_managed_browser_state","providerRetention":"plan_dependent_not_independently_verified","providerProfileDeletion":"not_qualified","ownerCredentials":"owner_entry_only","agentObservationDuringOwnerEntry":"physically_disconnected","profileReuse":"requires_separate_current_read_authority","initialVerification":"one_separate_read_only_shop_identity_and_insights_landing_session_no_query"}'::jsonb
 ||(s-'version'-'operationId'-'goalId'-'authorityRootId'-'approvalId'-'approvalRevision'-'approvedAt'-'approvalExpiresAt'-'disclosureHash')
$$;
create function private.r12_etsy_steel_scope_check(s jsonb,e private.r12_direct_test_envelopes,r private.r12_direct_browser_routes) returns void
language plpgsql set search_path='' as $$
declare k text;start_at timestamptz;end_at timestamptz;profile_at timestamptz;begin
 perform private.r04_keys(s,array['version','operationId','ownerId','businessId','goalId','authorityRootId','testEnvelopeId','testEnvelopeHash','providerProjectId','verificationOperationId','verificationMaximumMicrounits','verificationQuoteHash','accountId','accountRevision','expectedShopName','expectedShopId','purpose','approvalId','approvalRevision','approvedAt','approvalExpiresAt','profileAccessExpiresAt','maximumSessionMs','maximumBrowserMicrounits','currency','quoteHash','disclosureHash']);
 foreach k in array array['operationId','ownerId','businessId','goalId','authorityRootId','testEnvelopeId','providerProjectId','verificationOperationId','accountId','accountRevision','approvalId','approvalRevision'] loop
  if s->>k is null or (s->>k)::uuid is null then raise exception 'etsy_handoff_scope_invalid';end if;
 end loop;
 start_at:=(s->>'approvedAt')::timestamptz;end_at:=(s->>'approvalExpiresAt')::timestamptz;profile_at:=(s->>'profileAccessExpiresAt')::timestamptz;
 if s->>'version' is distinct from 'etsy.steel-owner-handoff-scope.1' or s->>'purpose' is distinct from 'etsy_insights_read_only'
 or s->>'currency' is distinct from 'USD' or s->>'ownerId' is distinct from e.owner_id::text or s->>'businessId' is distinct from e.business_id::text
 or s->>'goalId' is distinct from e.goal_id::text or s->>'authorityRootId' is distinct from e.authority_root_id::text
 or s->>'testEnvelopeId' is distinct from e.id::text or s->>'testEnvelopeHash' is distinct from e.content_hash
 or s->>'providerProjectId' is distinct from r.provider_project_id::text or s->>'quoteHash' is distinct from e.content->'setupOperation'->>'quoteHash'
 or s->>'maximumBrowserMicrounits' is distinct from e.content->'setupOperation'->>'maximumMicrounits'
 or s->>'verificationOperationId'=s->>'operationId'
 or s->>'verificationMaximumMicrounits' is distinct from e.content->'verificationOperation'->>'maximumMicrounits'
 or s->>'verificationQuoteHash' is distinct from e.content->'verificationOperation'->>'quoteHash'
 or private.r05_money(s->'verificationMaximumMicrounits')<r.maximum_session_microunits
 or private.r05_money(s->'maximumBrowserMicrounits')<r.maximum_session_microunits
 or jsonb_typeof(s->'maximumSessionMs') is distinct from 'number' or (s->>'maximumSessionMs')::int not between 15000 and r.maximum_session_ms
 or jsonb_typeof(s->'expectedShopName') is distinct from 'string' or length(btrim(s->>'expectedShopName')) not between 1 and 120 or s->>'expectedShopName' ~ '[[:cntrl:]]'
 or (s->'expectedShopId'<>'null'::jsonb and s->>'expectedShopId' !~ '^[1-9][0-9]{0,19}$')
 or start_at is null or end_at is null or profile_at is null or start_at>clock_timestamp()+interval '5 seconds'
 or start_at<clock_timestamp()-interval '5 minutes' or end_at<=clock_timestamp() or end_at<=start_at or end_at>start_at+interval '30 minutes'
 or end_at>e.expires_at or profile_at<end_at or profile_at>start_at+interval '30 days'
 or s->>'disclosureHash' is distinct from private.stage14_hash(private.r12_etsy_steel_disclosure(s))
 then raise exception 'etsy_handoff_scope_invalid';end if;
 perform private.r04_safe(s);
end $$;

-- Current account/owner/revocation fences are shared by every read stage. The
-- owner Stop and cleanup functions deliberately do not depend on this function.
create function private.r12_etsy_steel_current(p_operation uuid,p_login boolean default true) returns private.r12_etsy_steel_setups
language plpgsql set search_path='' as $$
declare s private.r12_etsy_steel_setups;e private.r12_direct_test_envelopes;r private.r12_direct_browser_routes;begin
 select * into strict s from private.r12_etsy_steel_setups where operation_id=p_operation;
 perform 1 from public.businesses where id=s.business_id and owner_user_id=s.owner_id for update;
 if not found then raise exception 'etsy_handoff_owner_changed';end if;
 select * into strict e from private.r12_direct_test_envelopes where id=s.envelope_id;
 select * into strict r from private.r12_direct_browser_routes where route_hash=s.route_hash;
 if exists(select 1 from private.r12_etsy_steel_stops where operation_id=s.operation_id)
 or exists(select 1 from private.r12_etsy_steel_setups x where x.business_id=s.business_id and x.account_id=s.account_id and x.sequence>s.sequence)
 or not exists(select 1 from private.r12_etsy_steel_approvals a where a.operation_id=s.operation_id and a.owner_id=s.owner_id and a.scope_hash=s.scope_hash and a.disclosure_hash=s.disclosure_hash and a.approval_revision=s.approval_revision)
 or (p_login and s.approval_expires_at<=clock_timestamp()) or s.profile_expires_at<=clock_timestamp()
 or e.expires_at<=clock_timestamp() or r.valid_from>clock_timestamp() or r.valid_until<=clock_timestamp()
 or exists(select 1 from private.r12_direct_test_revocations where envelope_id=e.id)
 or exists(select 1 from private.r12_direct_browser_route_revocations where route_hash=s.route_hash)
 or exists(select 1 from private.r05_revocations where policy_id=e.policy_id)
 or private.r05_paused(s.business_id,'business',s.business_id) or private.r05_paused(s.business_id,'quest',e.goal_id)
 then raise exception 'etsy_handoff_authority_inactive';end if;
 return s;
end $$;
create function private.r12_etsy_steel_spend_permit(p_permit jsonb,p_operation uuid,p_stage text) returns jsonb
language plpgsql set search_path='' as $$
declare a private.r12_etsy_steel_admissions;begin
 select * into a from private.r12_etsy_steel_admissions where request_hash=p_permit->>'requestHash' and operation_id=p_operation and stage=p_stage;
 if a.request_id is null or a.permit is distinct from p_permit or a.expires_at<=clock_timestamp()
 then raise exception 'etsy_handoff_permit_invalid';end if;
 insert into private.r12_etsy_steel_permit_uses(request_hash) values(a.request_hash);
 return a.request;
end $$;

create function public.r12_etsy_steel_owner(p_business_id uuid,p_operation text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s private.r12_etsy_steel_setups;result jsonb;begin
 perform private.r05_owner(p_business_id);
 select * into s from private.r12_etsy_steel_setups where operation_id=(p_payload->>'operationId')::uuid and business_id=p_business_id and owner_id=auth.uid();
 if s.operation_id is null then raise exception 'etsy_handoff_owner_required' using errcode='42501';end if;
 if p_operation='approve' then
  perform private.r04_keys(p_payload,array['operationId','scopeHash','disclosureHash','expectedApprovalRevision','persistentAccessApproved','budgetApproved']);
  if p_payload->>'scopeHash' is distinct from s.scope_hash or p_payload->>'disclosureHash' is distinct from s.disclosure_hash
  or p_payload->>'expectedApprovalRevision' is distinct from s.approval_revision::text
  or p_payload->'persistentAccessApproved' is distinct from 'true'::jsonb or p_payload->'budgetApproved' is distinct from 'true'::jsonb
  or s.approval_expires_at<=clock_timestamp() or exists(select 1 from private.r12_etsy_steel_stops where operation_id=s.operation_id)
  or exists(select 1 from private.r12_etsy_steel_setups x where x.business_id=s.business_id and x.account_id=s.account_id and x.sequence>s.sequence)
  then raise exception 'etsy_handoff_approval_changed';end if;
  perform private.r12_direct_financial_check(s.envelope_id,(s.scope->>'maximumBrowserMicrounits')::bigint+(s.scope->>'verificationMaximumMicrounits')::bigint);
  insert into private.r12_etsy_steel_approvals(operation_id,owner_id,scope_hash,disclosure_hash,approval_revision)
   values(s.operation_id,auth.uid(),s.scope_hash,s.disclosure_hash,s.approval_revision) on conflict(operation_id) do nothing;
 elsif p_operation='stop' then
  perform private.r04_keys(p_payload,array['operationId']);
  insert into private.r12_etsy_steel_stops(operation_id,owner_id) values(s.operation_id,auth.uid()) on conflict(operation_id) do nothing;
  insert into private.r12_etsy_steel_consumptions(handoff_id,action,record_hash)
   select id,'stop',record_hash from private.r12_etsy_steel_handoffs where operation_id=s.operation_id on conflict(handoff_id) do nothing;
 elsif p_operation='read' then perform private.r04_keys(p_payload,array['operationId']);
 else raise exception 'etsy_handoff_owner_operation';end if;
 result:=jsonb_build_object('operationId',s.operation_id,'scope',s.scope,'scopeHash',s.scope_hash,'disclosure',s.disclosure,
  'status',case when exists(select 1 from private.r12_etsy_steel_stops where operation_id=s.operation_id) then 'stopped'
  when s.approval_expires_at<=clock_timestamp() then 'expired'
  when exists(select 1 from private.r12_etsy_steel_approvals where operation_id=s.operation_id) then 'approved' else 'pending_approval' end,
  'cleanupPending',exists(select 1 from private.r12_etsy_steel_cleanup c where c.operation_id=s.operation_id and not exists(select 1 from private.r12_etsy_steel_cleanup_proofs p where p.operation_id=c.operation_id)),
  'receipts',coalesce((select jsonb_agg(receipt order by created_at,receipt_hash) from private.r12_etsy_steel_receipts where operation_id=s.operation_id),'[]'::jsonb));
 return result;
end $$;

-- Trusted server bridge. Runtime, independent visible-account verifier and
-- durable cleanup each need a distinct, bounded capability. No enrollment RPC.
create function public.r12_etsy_steel_server(p_business_id uuid,p_operation text,p_payload jsonb,p_server_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
<<bridge>>
declare k private.r12_etsy_steel_keys;e private.r12_direct_test_envelopes;r private.r12_direct_browser_routes;
 s private.r12_etsy_steel_setups;h private.r12_etsy_steel_handoffs;c private.r12_etsy_steel_candidates;
 a private.r12_etsy_steel_admissions;v private.r12_etsy_steel_verifications;o private.r12_direct_browser_operations;vr private.r12_etsy_steel_verification_runs;
 body jsonb;scope jsonb;request jsonb;permit jsonb;candidate jsonb;proof jsonb;binding jsonb;receipt jsonb;context jsonb;reservation jsonb;
 operation_id uuid;request_id uuid;workflow_id uuid;binding_id uuid;revision uuid;key text;hash text;expires timestamptz;stage text;
begin
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>150000 then raise exception 'etsy_handoff_payload_invalid';end if;
 select * into k from private.r12_etsy_steel_keys where key_hash=encode(extensions.digest(convert_to(p_server_key,'UTF8'),'sha256'),'hex');
 if k.key_hash is null or k.valid_until<=clock_timestamp() or exists(select 1 from private.r12_etsy_steel_key_revocations where key_hash=k.key_hash)
 or (p_operation='verify' and k.purpose<>'verification')
 or (p_operation in ('cleanup_due','cleanup_complete') and k.purpose<>'cleanup')
 or (p_operation='transport' and k.purpose not in ('handoff','cleanup'))
 or (p_operation not in ('verify','cleanup_due','cleanup_complete','transport') and k.purpose<>'handoff')
 then raise exception 'etsy_handoff_server_authority_required' using errcode='42501';end if;
 select * into strict e from private.r12_direct_test_envelopes where id=k.envelope_id and business_id=p_business_id;
 select * into strict r from private.r12_direct_browser_routes where route_hash=k.route_hash;
 perform 1 from public.businesses where id=p_business_id for update;
 if p_operation='prepare' then
  perform private.r04_keys(p_payload,array['scope','disclosure']);scope:=p_payload->'scope';
  perform private.r12_etsy_steel_scope_check(scope,e,r);
  if e.content->>'version'='r12.owner-direct-test-envelope.1' and least(coalesce((e.content->'setupQuote'->>'validUntil')::timestamptz,'-infinity'::timestamptz),coalesce((e.content->'verificationQuote'->>'validUntil')::timestamptz,'-infinity'::timestamptz))<=clock_timestamp() then raise exception 'etsy_handoff_quote_expired';end if;
  if p_payload->'disclosure' is distinct from private.r12_etsy_steel_disclosure(scope)
  or e.content->'setupOperation'->>'routeHash' is distinct from r.route_hash
  or e.content->'setupOperation'->>'qualificationHash' is distinct from r.qualification_hash
  or not exists(select 1 from public.workflow_definitions w where w.id=(e.content->'setupOperation'->>'workflowDefinitionId')::uuid and private.r04_hash(to_jsonb(w))=e.content->'setupOperation'->>'workflowHash')
  or e.content->'setupOperation'->>'operationKey' is distinct from 'browser.etsy.owner_handoff.create'
  or e.content->'verificationOperation'->>'operationKey' is distinct from 'browser.etsy.account_verification.create'
  or e.content->'verificationOperation'->>'routeHash' is distinct from r.route_hash
  or e.content->'verificationOperation'->>'qualificationHash' is distinct from r.qualification_hash
  or r.valid_from>clock_timestamp() or r.valid_until<=clock_timestamp()
  or exists(select 1 from private.r12_direct_browser_route_revocations where route_hash=r.route_hash)
  then raise exception 'etsy_handoff_reviewed_setup_required';end if;
  perform private.r12_direct_financial_check(e.id,(scope->>'maximumBrowserMicrounits')::bigint+(scope->>'verificationMaximumMicrounits')::bigint);
  operation_id:=(scope->>'operationId')::uuid;
  if exists(select 1 from private.r12_etsy_steel_setups where operation_id=bridge.operation_id) then raise exception 'etsy_handoff_prepare_replay';end if;
  request_id:=gen_random_uuid();workflow_id:=gen_random_uuid();
  insert into public.workflow_runs(id,business_id,goal_id,workflow_definition_id,idempotency_key,status,input)
   values(workflow_id,e.business_id,e.goal_id,(e.content->'setupOperation'->>'workflowDefinitionId')::uuid,
    'etsy.steel.setup.'||operation_id::text,'running',jsonb_build_object('version','etsy.steel-owner-setup-workflow.1','operationId',operation_id,'scopeHash',private.stage14_hash(scope),'testEnvelopeHash',e.content_hash));
  body:=jsonb_build_object('operationKey',e.content->'setupOperation'->>'operationKey','accounting',jsonb_build_object('kind','r05'),
   'requestHash',private.stage14_hash(jsonb_build_object('scope',scope,'setupOperation',e.content->'setupOperation')),
   'scopeHash',private.stage14_hash(scope),'testEnvelopeHash',e.content_hash,'qualificationHash',r.qualification_hash);
  insert into private.r05_requests(id,business_id,workflow_run_id,policy_id,idempotency_key,request_hash,payload,source_key,currency,liability_microunits)
   values(request_id,e.business_id,workflow_id,e.policy_id,'etsy.steel.setup.'||operation_id::text,private.stage14_hash(body),body,
    'r05:etsy-steel-setup:'||operation_id::text,'USD',(scope->>'maximumBrowserMicrounits')::bigint);
  insert into private.r12_etsy_steel_setups(operation_id,business_id,owner_id,envelope_id,route_hash,request_id,workflow_run_id,account_id,account_revision,approval_id,approval_revision,scope,scope_hash,disclosure,disclosure_hash,approval_expires_at,profile_expires_at)
   values(operation_id,e.business_id,e.owner_id,e.id,r.route_hash,request_id,workflow_id,(scope->>'accountId')::uuid,(scope->>'accountRevision')::uuid,
    (scope->>'approvalId')::uuid,(scope->>'approvalRevision')::uuid,scope,private.stage14_hash(scope),p_payload->'disclosure',scope->>'disclosureHash',
    (scope->>'approvalExpiresAt')::timestamptz,(scope->>'profileAccessExpiresAt')::timestamptz);
  return jsonb_build_object('operationId',operation_id,'scope',scope,'scopeHash',private.stage14_hash(scope),'disclosure',p_payload->'disclosure',
   'requestId',request_id,'workflowRunId',workflow_id,'status','pending_approval');
 elsif p_operation='cleanup_due' then
  perform private.r04_keys(p_payload,array[]::text[]);
  -- CAS invalidates all owner-view leases before the worker releases anything.
  insert into private.r12_etsy_steel_consumptions(handoff_id,action,record_hash)
   select h.id,'expiry',h.record_hash from private.r12_etsy_steel_handoffs h join private.r12_etsy_steel_setups s on s.operation_id=h.operation_id
   where s.envelope_id=e.id and s.route_hash=r.route_hash and (h.expires_at<=clock_timestamp() or exists(select 1 from private.r12_direct_test_revocations z where z.envelope_id=e.id) or exists(select 1 from private.r12_etsy_steel_stops z where z.operation_id=s.operation_id)
    or exists(select 1 from private.r12_etsy_steel_setups z where z.business_id=s.business_id and z.account_id=s.account_id and z.sequence>s.sequence)) on conflict(handoff_id) do nothing;
  return jsonb_build_object('operations',coalesce((select jsonb_agg(jsonb_build_object('operationId',q.operation_id,'sessionId',q.provider_session_id,'providerProjectId',q.provider_project_id,'dueAt',q.due_at))
   from private.r12_etsy_steel_cleanup q join private.r12_etsy_steel_setups s on s.operation_id=q.operation_id
   where s.envelope_id=e.id and s.route_hash=r.route_hash and not exists(select 1 from private.r12_etsy_steel_cleanup_proofs p where p.operation_id=q.operation_id)
   and (q.due_at<=clock_timestamp() or exists(select 1 from private.r12_direct_test_revocations z where z.envelope_id=e.id) or exists(select 1 from private.r12_etsy_steel_consumptions x join private.r12_etsy_steel_handoffs h on h.id=x.handoff_id where h.operation_id=q.operation_id)
    or exists(select 1 from private.r12_etsy_steel_stops z where z.operation_id=q.operation_id)
    or exists(select 1 from private.r12_etsy_steel_setups z where z.business_id=s.business_id and z.account_id=s.account_id and z.sequence>s.sequence))),'[]'::jsonb));
 end if;
 if p_operation in ('load','consume') then
  select * into h from private.r12_etsy_steel_handoffs where id=coalesce((p_payload->>'handoffId')::uuid,(p_payload->'record'->>'id')::uuid);
  operation_id:=h.operation_id;
 elsif p_operation='candidate' then
  select * into h from private.r12_etsy_steel_handoffs where id=(p_payload->'candidate'->>'handoffId')::uuid;operation_id:=h.operation_id;
 elsif p_operation in ('verify','resolve') then
  select * into c from private.r12_etsy_steel_candidates where binding_id=(p_payload->'binding'->>'profileBindingId')::uuid;operation_id:=c.operation_id;
 else operation_id:=coalesce((p_payload->>'operationId')::uuid,(p_payload->'request'->>'operationId')::uuid,
  (p_payload->'record'->'scope'->>'operationId')::uuid,(p_payload->'receipt'->>'operationId')::uuid);end if;
 select * into s from private.r12_etsy_steel_setups x where x.operation_id=bridge.operation_id and x.envelope_id=e.id and x.route_hash=r.route_hash and x.business_id=e.business_id;
 if s.operation_id is null then raise exception 'etsy_handoff_scope_unavailable';end if;
 if p_operation='transport' then
  perform private.r04_keys(p_payload,array['operationId','request']);request:=p_payload->'request';
  perform private.r04_keys(request,array['provider','operation','method','endpoint']);
  if bridge.request->>'provider' is distinct from 'steel' or not exists(select 1 from private.r12_etsy_steel_cleanup q where q.operation_id=s.operation_id and q.provider_session_id=s.operation_id and q.provider_project_id=r.provider_project_id)
  then raise exception 'etsy_handoff_transport_denied';end if;
  if bridge.request->>'operation'='browser.etsy.owner_handoff.create' then
   if e.content->>'version'='r12.owner-direct-test-envelope.1' and coalesce((e.content->'setupQuote'->>'validUntil')::timestamptz,'-infinity'::timestamptz)<=clock_timestamp() then raise exception 'etsy_handoff_quote_expired';end if;
   if k.purpose<>'handoff' or bridge.request->>'method' is distinct from 'POST' or bridge.request->>'endpoint' is distinct from 'https://api.steel.dev/v1/sessions' then raise exception 'etsy_handoff_transport_denied';end if;
   s:=private.r12_etsy_steel_current(s.operation_id,true);
   select * into a from private.r12_etsy_steel_admissions z where z.operation_id=s.operation_id and z.stage='create' and z.expires_at>clock_timestamp();
   if a.request_id is null then raise exception 'etsy_handoff_create_permit_expired';end if;
   insert into private.r12_etsy_steel_dispatches(operation_id,request_hash) values(s.operation_id,a.request_hash);
  elsif bridge.request->>'operation'='browser.etsy.session.release' then
   if bridge.request->>'method' is distinct from 'POST' or bridge.request->>'endpoint' is distinct from 'https://api.steel.dev/v1/sessions/'||s.operation_id::text||'/release' then raise exception 'etsy_handoff_transport_denied';end if;
  elsif bridge.request->>'operation'='browser.etsy.session.release_readback' then
   if bridge.request->>'method' is distinct from 'GET' or bridge.request->>'endpoint' is distinct from 'https://api.steel.dev/v1/sessions/'||s.operation_id::text then raise exception 'etsy_handoff_transport_denied';end if;
  elsif bridge.request->>'operation'='browser.etsy.owner_handoff.status' then
   if k.purpose<>'handoff' or bridge.request->>'method' is distinct from 'GET' or bridge.request->>'endpoint' is distinct from 'https://api.steel.dev/v1/sessions/'||s.operation_id::text then raise exception 'etsy_handoff_transport_denied';end if;
   s:=private.r12_etsy_steel_current(s.operation_id,true);
  elsif bridge.request->>'operation'='browser.etsy.profile.readback' then
   if k.purpose<>'handoff' or bridge.request->>'method' is distinct from 'GET' or not exists(select 1 from private.r12_etsy_steel_admissions z
    join private.r12_etsy_steel_handoffs h on h.operation_id=z.operation_id join private.r12_etsy_steel_consumptions co on co.handoff_id=h.id and co.action='return'
    where z.operation_id=s.operation_id and z.stage='profile_readback' and z.expires_at>clock_timestamp() and bridge.request->>'endpoint'='https://api.steel.dev/v1/profiles/'||(z.request->>'profileId')) then raise exception 'etsy_handoff_transport_denied';end if;
   s:=private.r12_etsy_steel_current(s.operation_id,true);
  else raise exception 'etsy_handoff_transport_denied';end if;
  return jsonb_build_object('allowed',true,'operationId',s.operation_id);
 elsif p_operation='admit' then
  perform private.r04_keys(p_payload,array['request']);request:=p_payload->'request';
  perform private.r04_keys(request,array['version','operation','requestId','scopeHash','operationId','ownerId','businessId','authorityRootId','testEnvelopeId','testEnvelopeHash','providerProjectId','accountId','accountRevision','approvalId','approvalRevision','disclosureHash','quoteHash','maximumBrowserMicrounits','handoffId','sessionId','profileId','reservationId','reservationHash']);
  s:=private.r12_etsy_steel_current(s.operation_id,true);stage:=bridge.request->>'operation';
  if bridge.request->>'version' is distinct from 'etsy.steel-owner-handoff-admission.1' or bridge.request->>'scopeHash' is distinct from s.scope_hash
  or stage not in ('create','publish_handoff','owner_view','owner_return','profile_readback','accept_profile')
  then raise exception 'etsy_handoff_admission_invalid';end if;
  foreach key in array array['operationId','ownerId','businessId','authorityRootId','testEnvelopeId','testEnvelopeHash','providerProjectId','accountId','accountRevision','approvalId','approvalRevision','disclosureHash','quoteHash','maximumBrowserMicrounits'] loop
   if bridge.request->key is distinct from s.scope->key then raise exception 'etsy_handoff_admission_pin_changed';end if;
  end loop;
  if stage='create' then
   if exists(select 1 from private.r12_direct_browser_operations z where z.id=s.operation_id) then raise exception 'etsy_handoff_create_recovery_required';end if;
   if bridge.request->'handoffId'<>'null'::jsonb or bridge.request->'sessionId'<>'null'::jsonb or bridge.request->'profileId'<>'null'::jsonb or bridge.request->'reservationId'<>'null'::jsonb or bridge.request->'reservationHash'<>'null'::jsonb then raise exception 'etsy_handoff_create_shape';end if;
   reservation:=private.r12_direct_browser_register(e.id,s.operation_id,s.request_id,'owner_setup',s.scope,s.scope->>'quoteHash',s.route_hash);
   insert into private.r12_etsy_steel_cleanup(operation_id,provider_session_id,provider_project_id,due_at)
    values(s.operation_id,s.operation_id,r.provider_project_id,least(s.approval_expires_at,clock_timestamp()+make_interval(secs=>(s.scope->>'maximumSessionMs')::double precision/1000)));
  else
   select * into strict o from private.r12_direct_browser_operations x where x.id=s.operation_id;
   if bridge.request->>'reservationId' is distinct from o.request_id::text or bridge.request->>'reservationHash' is distinct from o.reservation_hash
   or bridge.request->>'sessionId' is distinct from s.operation_id::text or (bridge.request->>'profileId')::uuid is null or (bridge.request->>'handoffId')::uuid is null
   then raise exception 'etsy_handoff_session_pin_changed';end if;
   if stage='publish_handoff' then
    if exists(select 1 from private.r12_etsy_steel_handoffs x where x.operation_id=s.operation_id) then raise exception 'etsy_handoff_already_published';end if;
   else
    select * into h from private.r12_etsy_steel_handoffs x where x.id=(bridge.request->>'handoffId')::uuid and x.operation_id=s.operation_id;
    if h.id is null or h.expires_at<=clock_timestamp() or not exists(select 1 from private.r12_etsy_steel_admissions x where x.operation_id=s.operation_id and x.stage='publish_handoff' and x.request->>'handoffId'=h.id::text and x.request->>'profileId'=bridge.request->>'profileId')
    or (stage in ('owner_view','owner_return') and exists(select 1 from private.r12_etsy_steel_consumptions z where z.handoff_id=h.id))
    or (stage in ('profile_readback','accept_profile') and not exists(select 1 from private.r12_etsy_steel_consumptions z where z.handoff_id=h.id and z.action='return'))
    then raise exception 'etsy_handoff_consumed_or_expired';end if;
   end if;
   reservation:=jsonb_build_object('reservationId',o.request_id,'reservationHash',o.reservation_hash,'reservedBrowserMicrounits',o.maximum_microunits::text);
  end if;
  reservation:=jsonb_build_object('reservationId',reservation->>'reservationId','reservationHash',reservation->>'reservationHash','reservedBrowserMicrounits',s.scope->>'maximumBrowserMicrounits');
  expires:=least(s.approval_expires_at,clock_timestamp()+interval '30 seconds');
  permit:=reservation||jsonb_build_object('version','etsy.steel-owner-handoff-permit.1','requestHash',private.stage14_hash(request),
   'approval','explicit_owner_persistent_access_and_budget','expiresAt',to_char(expires at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  insert into private.r12_etsy_steel_admissions(request_id,operation_id,stage,request,request_hash,permit,expires_at)
   values((bridge.request->>'requestId')::uuid,s.operation_id,stage,request,private.stage14_hash(request),permit,expires);
  return permit;
 elsif p_operation='store' then
  perform private.r04_keys(p_payload,array['record','permit']);s:=private.r12_etsy_steel_current(s.operation_id,true);body:=p_payload->'record';
  request:=private.r12_etsy_steel_spend_permit(p_payload->'permit',s.operation_id,'publish_handoff');
  perform private.r04_keys(body,array['version','id','scope','scopeHash','reservationId','reservationHash','envelope','disconnectProof','createdAt','expiresAt','recordHash']);
  if body->>'version' is distinct from 'etsy.steel-owner-handoff-record.1' or body->'scope' is distinct from s.scope or body->>'scopeHash' is distinct from s.scope_hash
  or body->>'id' is distinct from bridge.request->>'handoffId' or body->>'reservationId' is distinct from bridge.request->>'reservationId' or body->>'reservationHash' is distinct from bridge.request->>'reservationHash'
  or body->'disconnectProof' is distinct from jsonb_build_object('version','etsy.steel-owner-disconnect.1','sessionId',s.operation_id,'cdpDisconnected',true,'observersDrained',true,'inFlightCommandsSettled',true,'appCaptureStopped',true,'routeHandlersDrained',true,'eventListenersRemoved',true)
  or body->>'recordHash' is distinct from private.stage14_hash(body-'recordHash') or body->>'envelope' !~ '^account-v1\.[A-Za-z0-9_.-]+$'
  or length(body->>'envelope') not between 30 and 90000 or (body->>'expiresAt')::timestamptz>least(s.approval_expires_at,(body->>'createdAt')::timestamptz+make_interval(secs=>(s.scope->>'maximumSessionMs')::double precision/1000))
  or (body->>'expiresAt')::timestamptz<=clock_timestamp() or (body->>'createdAt')::timestamptz>clock_timestamp()
  or not exists(select 1 from private.r12_etsy_steel_cleanup q where q.operation_id=s.operation_id)
  then raise exception 'etsy_handoff_record_invalid';end if;
  insert into private.r12_etsy_steel_handoffs(id,operation_id,record,record_hash,expires_at)
   values((body->>'id')::uuid,s.operation_id,body,body->>'recordHash',(body->>'expiresAt')::timestamptz);
  return jsonb_build_object('recordHash',body->>'recordHash','cleanupRegistered',true);
 elsif p_operation='load' then
  perform private.r04_keys(p_payload,array['owner','handoffId']);perform private.r04_keys(p_payload->'owner',array['ownerId','businessId']);
  if p_payload->'owner'->>'ownerId' is distinct from s.owner_id::text or p_payload->'owner'->>'businessId' is distinct from s.business_id::text
  or not exists(select 1 from public.businesses where id=s.business_id and owner_user_id=s.owner_id)
  or exists(select 1 from private.r12_etsy_steel_consumptions x where x.handoff_id=h.id)
  then raise exception 'etsy_handoff_record_unavailable';end if;
  -- Expired unconsumed records remain loadable only by the server bridge so an
  -- authenticated Stop can decrypt and release. Owner view still needs admit.
  return h.record;
 elsif p_operation='consume' then
  perform private.r04_keys(p_payload,array['record','owner','action','permit']);perform private.r04_keys(p_payload->'owner',array['ownerId','businessId']);
  if p_payload->'record' is distinct from h.record or p_payload->'owner'->>'ownerId' is distinct from s.owner_id::text
  or p_payload->'owner'->>'businessId' is distinct from s.business_id::text or p_payload->>'action' not in ('return','stop')
  or not exists(select 1 from public.businesses where id=s.business_id and owner_user_id=s.owner_id) then raise exception 'etsy_handoff_consume_invalid';end if;
  if p_payload->>'action'='return' then
   s:=private.r12_etsy_steel_current(s.operation_id,true);
   request:=private.r12_etsy_steel_spend_permit(p_payload->'permit',s.operation_id,'owner_return');
   if bridge.request->>'handoffId' is distinct from h.id::text or h.expires_at<=clock_timestamp() then raise exception 'etsy_handoff_consume_invalid';end if;
  elsif p_payload->'permit'<>'null'::jsonb then raise exception 'etsy_handoff_stop_permit_invalid';end if;
  insert into private.r12_etsy_steel_consumptions(handoff_id,action,record_hash) values(h.id,p_payload->>'action',h.record_hash);
  if p_payload->>'action'='stop' then insert into private.r12_etsy_steel_stops(operation_id,owner_id) values(s.operation_id,s.owner_id) on conflict(operation_id) do nothing;end if;
  return jsonb_build_object('recordHash',h.record_hash,'consumed',true);
 elsif p_operation='candidate' then
  perform private.r04_keys(p_payload,array['candidate','permit']);s:=private.r12_etsy_steel_current(s.operation_id,true);candidate:=p_payload->'candidate';
  request:=private.r12_etsy_steel_spend_permit(p_payload->'permit',s.operation_id,'accept_profile');
  perform private.r04_keys(candidate,array['version','handoffId','scopeHash','ownerId','businessId','testEnvelopeId','testEnvelopeHash','accountId','accountRevision','expectedShopName','expectedShopId','approvalId','approvalRevision','purpose','providerProjectId','profileId','sourceSessionId','expiresAt','accountIdentityVerified','insightsAccessVerified','reuseRequiresFreshAuthority','candidateHash']);
  if candidate->>'version' is distinct from 'etsy.steel-profile-candidate.1' or candidate->>'scopeHash' is distinct from s.scope_hash
  or candidate->>'handoffId' is distinct from h.id::text or candidate->>'handoffId' is distinct from bridge.request->>'handoffId'
  or candidate->>'profileId' is distinct from bridge.request->>'profileId' or candidate->>'sourceSessionId' is distinct from s.operation_id::text
  or candidate->>'expiresAt' is distinct from s.scope->>'profileAccessExpiresAt' or candidate->'accountIdentityVerified' is distinct from 'false'::jsonb
  or candidate->'insightsAccessVerified' is distinct from 'false'::jsonb or candidate->'reuseRequiresFreshAuthority' is distinct from 'true'::jsonb
  or candidate->>'candidateHash' is distinct from private.stage14_hash(candidate-'candidateHash')
  or not exists(select 1 from private.r12_etsy_steel_consumptions x where x.handoff_id=h.id and x.action='return') then raise exception 'etsy_handoff_candidate_invalid';end if;
  foreach key in array array['ownerId','businessId','testEnvelopeId','testEnvelopeHash','accountId','accountRevision','expectedShopName','expectedShopId','approvalId','approvalRevision','purpose','providerProjectId'] loop
   if candidate->key is distinct from s.scope->key then raise exception 'etsy_handoff_candidate_pin_changed';end if;
  end loop;
  binding_id:=gen_random_uuid();revision:=gen_random_uuid();
  insert into private.r12_etsy_steel_candidates(binding_id,binding_revision,operation_id,candidate,candidate_hash)
   values(binding_id,revision,s.operation_id,candidate,candidate->>'candidateHash');
  return jsonb_build_object('candidateHash',candidate->>'candidateHash','bindingId',binding_id,'revision',revision);
 elsif p_operation='receipt' then
  perform private.r04_keys(p_payload,array['receipt']);body:=p_payload->'receipt';
  perform private.r04_keys(body,array['version','operationId','scopeHash','handoffId','status','reason','releaseState','liabilityState','reservationId','reservationHash','profileBindingId','profileBindingRevision','accountIdentityVerified','insightsAccessVerified','receiptHash']);
  perform private.r04_safe(body);
  if body->>'version' is distinct from 'etsy.steel-owner-handoff-receipt.1' or body->>'operationId' is distinct from s.operation_id::text
  or body->>'scopeHash' is distinct from s.scope_hash or body->>'receiptHash' is distinct from private.stage14_hash(body-'receiptHash')
  or body->'accountIdentityVerified' is distinct from 'false'::jsonb or body->'insightsAccessVerified' is distinct from 'false'::jsonb
  or body->>'status' not in ('awaiting_owner','profile_pending_verification','stopped','failed')
  or body->>'releaseState' not in ('not_created','held_for_owner','verified','unconfirmed')
  or body->>'liabilityState' not in ('not_dispatched','held','receipt_required','unknown')
  then raise exception 'etsy_handoff_receipt_invalid';end if;
  if body->>'status'='profile_pending_verification' and not exists(select 1 from private.r12_etsy_steel_candidates z where z.operation_id=s.operation_id and z.binding_id::text=body->>'profileBindingId' and z.binding_revision::text=body->>'profileBindingRevision') then raise exception 'etsy_handoff_candidate_required';end if;
  insert into private.r12_etsy_steel_receipts(receipt_hash,operation_id,receipt) values(body->>'receiptHash',s.operation_id,body) on conflict(receipt_hash) do nothing;
  return jsonb_build_object('receiptHash',body->>'receiptHash','persisted',true);
 elsif p_operation='cleanup_complete' then
  perform private.r04_keys(p_payload,array['operationId','releaseEvidenceHash']);
  if not exists(select 1 from private.r12_direct_browser_evidence z join private.r12_etsy_steel_cleanup q on q.operation_id=z.operation_id
   where z.operation_id=s.operation_id and z.evidence_hash=p_payload->>'releaseEvidenceHash' and z.kind='release'
   and z.provider_session_id=q.provider_session_id::text and z.provider_project_id=q.provider_project_id
   and z.content->'terminal'='true'::jsonb and z.content->'observersDisposed'='true'::jsonb
   and z.content->>'providerStatus' in ('released','failed') and coalesce(z.content->>'providerReadbackHash','')~'^[a-f0-9]{64}$' and coalesce(z.content->>'disposalProofHash','')~'^[a-f0-9]{64}$')
  then raise exception 'etsy_handoff_release_evidence_required';end if;
  insert into private.r12_etsy_steel_cleanup_proofs(operation_id,release_evidence_hash) values(s.operation_id,p_payload->>'releaseEvidenceHash') on conflict(operation_id) do nothing;
  return jsonb_build_object('operationId',s.operation_id,'releaseVerified',true,'billingStillRequiresLedger',true);
 elsif p_operation='verify' then
  perform private.r04_keys(p_payload,array['binding','verification']);s:=private.r12_etsy_steel_current(s.operation_id,false);
  binding:=p_payload->'binding';proof:=p_payload->'verification';
  select * into vr from private.r12_etsy_steel_verification_runs z where z.operation_id=(proof->>'operationId')::uuid and z.setup_operation_id=s.operation_id;
  if vr.operation_id is null or vr.expires_at<=clock_timestamp()
  or not exists(select 1 from private.r12_etsy_steel_verification_dispatches z where z.operation_id=vr.operation_id)
  or not exists(select 1 from private.r12_etsy_steel_verification_release z where z.operation_id=vr.operation_id)
  or not exists(select 1 from private.r12_direct_browser_receipts z where z.operation_id=vr.operation_id and z.content->>'scopeHash'=vr.scope_hash and z.content->>'version'='etsy.steel-account-verification-receipt.1' and z.content->>'status'='verified' and z.content->>'releaseState'='verified' and z.content->>'liabilityState'='receipt_required')
  then raise exception 'etsy_handoff_verification_operation_required';end if;
  perform private.r04_keys(proof,array['version','operationId','setupOperationId','handoffId','profileBindingId','profileBindingRevision','providerProjectId','testEnvelopeId','testEnvelopeHash','profileId','sessionId','contextId','pageId','observedShopName','observedShopId','verifiedAt','expiresAt','accountIdentityVerified','insightsAccessVerified','visibleShopHref','canonicalUrl','insightsHeading','queryControlWitnessHash','documentEpoch','verifiedContextHash','verificationHash']);
  perform private.r04_keys(binding,array['version','businessId','goalId','authorityRootId','testEnvelopeId','testEnvelopeHash','purpose','providerProjectId','profileBindingId','profileBindingRevision','approvalId','approvalRevision','disclosureHash','handoffReceiptHash','profileCandidateHash','accountVerificationHash','verifiedContextHash','observedShopName','observedShopId','verifiedAt','expiresAt','bindingHash']);
  perform private.r04_safe(proof);perform private.r04_safe(binding);
  context:=jsonb_build_object('version','etsy.steel-visible-account-context.1')||(proof-'version'-'expiresAt'-'accountIdentityVerified'-'insightsAccessVerified'-'verifiedContextHash'-'verificationHash');
  if proof->>'version' is distinct from 'etsy.steel-account-verification.1' or binding->>'version' is distinct from 'r12.etsy-insights-account-binding.1'
  or proof->>'operationId' is distinct from vr.operation_id::text or proof->>'setupOperationId' is distinct from s.operation_id::text
  or proof->>'sessionId' is distinct from vr.operation_id::text or proof->>'handoffId' is distinct from c.candidate->>'handoffId'
  or proof->>'profileBindingId' is distinct from c.binding_id::text or proof->>'profileBindingRevision' is distinct from c.binding_revision::text
  or proof->>'profileId' is distinct from c.candidate->>'profileId' or proof->>'providerProjectId' is distinct from r.provider_project_id::text
  or proof->>'testEnvelopeId' is distinct from e.id::text or proof->>'testEnvelopeHash' is distinct from e.content_hash
  or s.scope->'expectedShopId' is distinct from 'null'::jsonb
  or proof->>'observedShopName' is distinct from s.scope->>'expectedShopName' or proof->'observedShopId' is distinct from s.scope->'expectedShopId'
  or proof->>'canonicalUrl' is distinct from 'https://www.etsy.com/your/shops/me/marketplace-insights'
  or proof->>'visibleShopHref' is distinct from 'https://www.etsy.com/shop/'||(proof->>'observedShopName')||'?ref=seller-platform-mcnav'
  or proof->>'insightsHeading' is distinct from 'Marketplace Insights' or jsonb_typeof(proof->'documentEpoch') is distinct from 'number'
  or (proof->>'documentEpoch')::int<0
  or proof->>'queryControlWitnessHash' is distinct from private.stage14_hash('{"formAriaLabel":"search bar form","inputAriaLabel":"Input to search for keywords","inputType":"text","buttonName":"Search","buttonType":"submit","formVisible":true,"inputVisible":true,"inputEnabled":true,"buttonVisible":true,"buttonEnabled":true}'::jsonb)
  or proof->'accountIdentityVerified' is distinct from 'true'::jsonb or proof->'insightsAccessVerified' is distinct from 'true'::jsonb
  or proof->>'verificationHash' is distinct from private.stage14_hash(proof-'verificationHash') or proof->>'verifiedContextHash' is distinct from private.stage14_hash(context)
  or (proof->>'sessionId')::uuid is null or (proof->>'contextId')::uuid is null or (proof->>'pageId')::uuid is null
  or (proof->>'verifiedAt')::timestamptz>clock_timestamp() or (proof->>'verifiedAt')::timestamptz<clock_timestamp()-interval '5 minutes'
  or (proof->>'expiresAt')::timestamptz<=clock_timestamp() or proof->>'expiresAt' is distinct from s.scope->>'profileAccessExpiresAt'
  or binding->>'profileCandidateHash' is distinct from c.candidate_hash or binding->>'accountVerificationHash' is distinct from proof->>'verificationHash'
  or binding->>'bindingHash' is distinct from private.stage14_hash(binding-'bindingHash')
  or not exists(select 1 from private.r12_etsy_steel_cleanup_proofs z where z.operation_id=s.operation_id)
  then raise exception 'etsy_handoff_same_context_verification_required';end if;
  foreach key in array array['businessId','goalId','authorityRootId','testEnvelopeId','testEnvelopeHash','purpose','providerProjectId','approvalId','approvalRevision','disclosureHash'] loop
   if binding->key is distinct from s.scope->key then raise exception 'etsy_handoff_binding_pin_changed';end if;
  end loop;
  foreach key in array array['profileBindingId','profileBindingRevision','verifiedContextHash','observedShopName','observedShopId','verifiedAt','expiresAt'] loop
   if binding->key is distinct from proof->key then raise exception 'etsy_handoff_verification_pin_changed';end if;
  end loop;
  if not exists(select 1 from private.r12_etsy_steel_receipts z where z.operation_id=s.operation_id and z.receipt_hash=binding->>'handoffReceiptHash'
   and z.receipt->>'status'='profile_pending_verification' and z.receipt->>'releaseState'='verified' and z.receipt->>'liabilityState'='receipt_required'
   and z.receipt->>'profileBindingId'=c.binding_id::text and z.receipt->>'profileBindingRevision'=c.binding_revision::text)
  then raise exception 'etsy_handoff_terminal_receipt_required';end if;
  insert into private.r12_etsy_steel_verifications(binding_id,verification,verification_hash,binding,binding_hash)
   values(c.binding_id,proof,proof->>'verificationHash',binding,binding->>'bindingHash');
  return jsonb_build_object('binding',binding,'verified',true);
 elsif p_operation='resolve' then
  perform private.r04_keys(p_payload,array['binding']);return private.r12_etsy_steel_account_binding_check(p_payload->'binding');
 end if;
 raise exception 'etsy_handoff_server_operation';
end $$;

create function private.r12_etsy_steel_account_binding_check(p_binding jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare v private.r12_etsy_steel_verifications;c private.r12_etsy_steel_candidates;s private.r12_etsy_steel_setups;begin
 select * into v from private.r12_etsy_steel_verifications where binding_hash=p_binding->>'bindingHash';
 if v.binding_id is null or v.binding is distinct from p_binding or (v.binding->>'expiresAt')::timestamptz<=clock_timestamp()
 then raise exception 'etsy_handoff_verified_binding_required';end if;
 select * into strict c from private.r12_etsy_steel_candidates where binding_id=v.binding_id;
 s:=private.r12_etsy_steel_current(c.operation_id,false);
 return jsonb_build_object('binding',v.binding,'profileId',c.candidate->>'profileId','providerProjectId',s.scope->>'providerProjectId',
  'testEnvelopeId',s.envelope_id,'testEnvelopeHash',s.scope->>'testEnvelopeHash','verified',true);
end $$;

-- A single separate no-query verification was included in the original exact
-- owner disclosure. It gets its own real R05 request, session and full maximum.
create function public.r12_etsy_steel_verification_server(p_business_id uuid,p_operation text,p_payload jsonb,p_server_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare k private.r12_etsy_steel_keys;e private.r12_direct_test_envelopes;r private.r12_direct_browser_routes;
 s private.r12_etsy_steel_setups;c private.r12_etsy_steel_candidates;v private.r12_etsy_steel_verification_runs;o private.r12_direct_browser_operations;
 definition jsonb;target uuid;request_id uuid;workflow_id uuid;scope jsonb;body jsonb;transport jsonb;reserved jsonb;expires timestamptz;
begin
 perform private.r04_safe(p_payload);
 select * into k from private.r12_etsy_steel_keys where key_hash=encode(extensions.digest(convert_to(p_server_key,'UTF8'),'sha256'),'hex');
 if k.key_hash is null or k.valid_until<=clock_timestamp() or exists(select 1 from private.r12_etsy_steel_key_revocations where key_hash=k.key_hash)
 or (p_operation in ('cleanup_due','cleanup_complete') and k.purpose not in ('cleanup','verification'))
 or (p_operation='transport' and k.purpose not in ('cleanup','verification'))
 or (p_operation not in ('cleanup_due','cleanup_complete','transport') and k.purpose<>'verification')
 then raise exception 'etsy_verification_server_authority_required' using errcode='42501';end if;
 select * into strict e from private.r12_direct_test_envelopes where id=k.envelope_id and business_id=p_business_id;
 select * into strict r from private.r12_direct_browser_routes where route_hash=k.route_hash;
 perform 1 from public.businesses where id=e.business_id for update;
 if p_operation='cleanup_due' then
  perform private.r04_keys(p_payload,array[]::text[]);
  return jsonb_build_object('operations',coalesce((select jsonb_agg(jsonb_build_object('operationId',q.operation_id,'sessionId',q.provider_session_id,'providerProjectId',q.provider_project_id,'dueAt',q.due_at))
   from private.r12_etsy_steel_verification_cleanup q join private.r12_etsy_steel_verification_runs vr on vr.operation_id=q.operation_id
   join private.r12_etsy_steel_setups st on st.operation_id=vr.setup_operation_id
   where st.envelope_id=e.id and st.route_hash=r.route_hash and not exists(select 1 from private.r12_etsy_steel_verification_release z where z.operation_id=q.operation_id)
   and (q.due_at<=clock_timestamp() or exists(select 1 from private.r12_etsy_steel_stops z where z.operation_id=st.operation_id)
    or exists(select 1 from private.r12_direct_test_revocations z where z.envelope_id=e.id)
    or exists(select 1 from private.r12_etsy_steel_setups z where z.business_id=st.business_id and z.account_id=st.account_id and z.sequence>st.sequence))),'[]'::jsonb));
 elsif p_operation='prepare' then
  perform private.r04_keys(p_payload,array['setupOperationId']);
  select * into s from private.r12_etsy_steel_setups where operation_id=(p_payload->>'setupOperationId')::uuid and envelope_id=e.id and route_hash=r.route_hash;
  if s.operation_id is null then raise exception 'etsy_verification_setup_required';end if;
  s:=private.r12_etsy_steel_current(s.operation_id,true);
  select * into c from private.r12_etsy_steel_candidates where operation_id=s.operation_id;
  definition:=e.content->'verificationOperation';
  if e.content->>'version'='r12.owner-direct-test-envelope.1' and coalesce((e.content->'verificationQuote'->>'validUntil')::timestamptz,'-infinity'::timestamptz)<=clock_timestamp() then raise exception 'etsy_verification_quote_expired';end if;
  if c.binding_id is null or s.scope->'expectedShopId' is distinct from 'null'::jsonb
  or not exists(select 1 from private.r12_etsy_steel_cleanup_proofs where operation_id=s.operation_id)
  or definition->>'routeHash' is distinct from r.route_hash or definition->>'qualificationHash' is distinct from r.qualification_hash
  or definition->>'quoteHash' is distinct from s.scope->>'verificationQuoteHash'
  or definition->>'maximumMicrounits' is distinct from s.scope->>'verificationMaximumMicrounits'
  or definition->>'operationKey' is distinct from 'browser.etsy.account_verification.create'
  or not exists(select 1 from public.workflow_definitions w where w.id=(definition->>'workflowDefinitionId')::uuid and private.r04_hash(to_jsonb(w))=definition->>'workflowHash')
  then raise exception 'etsy_verification_reviewed_operation_required';end if;
  if exists(select 1 from private.r12_etsy_steel_verification_runs where setup_operation_id=s.operation_id) then raise exception 'etsy_verification_recovery_required';end if;
  perform private.r12_direct_financial_check(e.id,private.r05_money(definition->'maximumMicrounits'));
  target:=(s.scope->>'verificationOperationId')::uuid;request_id:=gen_random_uuid();workflow_id:=gen_random_uuid();
  expires:=least(s.approval_expires_at,e.expires_at,clock_timestamp()+interval '120 seconds');
  scope:=jsonb_build_object('version','etsy.steel-account-verification-scope.1','operationId',target,'setupOperationId',s.operation_id,
   'ownerId',s.owner_id,'businessId',s.business_id,'goalId',e.goal_id,'authorityRootId',e.authority_root_id,'testEnvelopeId',e.id,'testEnvelopeHash',e.content_hash,
   'providerProjectId',r.provider_project_id,'profileBindingId',c.binding_id,'profileBindingRevision',c.binding_revision,'profileCandidateHash',c.candidate_hash,'profileId',c.candidate->>'profileId','handoffId',c.candidate->>'handoffId','profileAccessExpiresAt',s.scope->>'profileAccessExpiresAt',
   'approvalId',s.approval_id,'approvalRevision',s.approval_revision,'disclosureHash',s.disclosure_hash,'purpose','etsy_insights_verify_only',
   'expectedShopName',s.scope->>'expectedShopName','expectedShopId',null,'quoteHash',definition->>'quoteHash','maximumBrowserMicrounits',definition->>'maximumMicrounits',
   'maximumSessionMs',least(120000,r.maximum_session_ms),'expiresAt',to_char(expires at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  insert into public.workflow_runs(id,business_id,goal_id,workflow_definition_id,idempotency_key,status,input)
   values(workflow_id,e.business_id,e.goal_id,(definition->>'workflowDefinitionId')::uuid,'etsy.steel.verify.'||target::text,'running',jsonb_build_object('version','etsy.steel-verification-workflow.1','operationId',target,'scopeHash',private.stage14_hash(scope)));
  body:=jsonb_build_object('operationKey',definition->>'operationKey','accounting',jsonb_build_object('kind','r05'),'requestHash',private.stage14_hash(scope),'scopeHash',private.stage14_hash(scope));
  insert into private.r05_requests(id,business_id,workflow_run_id,policy_id,idempotency_key,request_hash,payload,source_key,currency,liability_microunits)
   values(request_id,e.business_id,workflow_id,e.policy_id,'etsy.steel.verify.'||target::text,private.stage14_hash(body),body,'r05:etsy-steel-verify:'||target::text,'USD',private.r05_money(definition->'maximumMicrounits'));
  insert into private.r12_etsy_steel_verification_runs(operation_id,setup_operation_id,request_id,workflow_run_id,scope,scope_hash,expires_at)
   values(target,s.operation_id,request_id,workflow_id,scope,private.stage14_hash(scope),expires) returning * into v;
  return jsonb_build_object('scope',v.scope,'scopeHash',v.scope_hash,'requestId',v.request_id,'workflowRunId',v.workflow_run_id);
 end if;
 target:=coalesce((p_payload->>'operationId')::uuid,(p_payload->'verification'->>'operationId')::uuid);
 select * into v from private.r12_etsy_steel_verification_runs where operation_id=target;
 select * into s from private.r12_etsy_steel_setups where operation_id=v.setup_operation_id and envelope_id=e.id and route_hash=r.route_hash;
 if s.operation_id is null then raise exception 'etsy_verification_scope_required';end if;
 if p_operation='cleanup_complete' then
  perform private.r04_keys(p_payload,array['operationId','releaseEvidenceHash']);
  if not exists(select 1 from private.r12_direct_browser_evidence z where z.operation_id=v.operation_id and z.evidence_hash=p_payload->>'releaseEvidenceHash'
   and z.kind='release' and z.provider_session_id=v.operation_id::text and z.provider_project_id=r.provider_project_id
   and z.content->'terminal'='true'::jsonb and z.content->'observersDisposed'='true'::jsonb
   and z.content->>'providerStatus' in ('released','failed') and coalesce(z.content->>'providerReadbackHash','')~'^[a-f0-9]{64}$' and coalesce(z.content->>'disposalProofHash','')~'^[a-f0-9]{64}$')
  then raise exception 'etsy_verification_release_required';end if;
  insert into private.r12_etsy_steel_verification_release(operation_id,release_evidence_hash) values(v.operation_id,p_payload->>'releaseEvidenceHash') on conflict(operation_id) do nothing;
  return jsonb_build_object('operationId',v.operation_id,'releaseVerified',true,'billingStillRequiresLedger',true);
 elsif p_operation='transport' then
  perform private.r04_keys(p_payload,array['operationId','request']);transport:=p_payload->'request';perform private.r04_keys(transport,array['provider','operation','method','endpoint']);
  if transport->>'provider' is distinct from 'steel' or not exists(select 1 from private.r12_etsy_steel_verification_cleanup z where z.operation_id=v.operation_id) then raise exception 'etsy_verification_transport_denied';end if;
  if transport->>'operation'='browser.etsy.session.release' then
   if transport->>'method' is distinct from 'POST' or transport->>'endpoint' is distinct from 'https://api.steel.dev/v1/sessions/'||v.operation_id::text||'/release' then raise exception 'etsy_verification_transport_denied';end if;
  elsif transport->>'operation'='browser.etsy.session.release_readback' then
   if transport->>'method' is distinct from 'GET' or transport->>'endpoint' is distinct from 'https://api.steel.dev/v1/sessions/'||v.operation_id::text then raise exception 'etsy_verification_transport_denied';end if;
  else
   if k.purpose<>'verification' or v.expires_at<=clock_timestamp() then raise exception 'etsy_verification_transport_denied';end if;
   s:=private.r12_etsy_steel_current(s.operation_id,true);
   if transport->>'operation'='browser.etsy.insights.create' and transport->>'method'='POST' and transport->>'endpoint'='https://api.steel.dev/v1/sessions' then
    if e.content->>'version'='r12.owner-direct-test-envelope.1' and coalesce((e.content->'verificationQuote'->>'validUntil')::timestamptz,'-infinity'::timestamptz)<=clock_timestamp() then raise exception 'etsy_verification_quote_expired';end if;
    if not exists(select 1 from private.r12_etsy_steel_verification_cleanup z where z.operation_id=v.operation_id and z.created_at>clock_timestamp()-interval '30 seconds') then raise exception 'etsy_verification_permit_expired';end if;
    insert into private.r12_etsy_steel_verification_dispatches(operation_id) values(v.operation_id);
   elsif transport->>'operation'='browser.etsy.owner_handoff.status' and transport->>'method'='GET' and transport->>'endpoint'='https://api.steel.dev/v1/sessions/'||v.operation_id::text then
    if not exists(select 1 from private.r12_etsy_steel_verification_dispatches z where z.operation_id=v.operation_id) then raise exception 'etsy_verification_not_dispatched';end if;
   else raise exception 'etsy_verification_transport_denied';end if;
  end if;
  return jsonb_build_object('allowed',true,'operationId',v.operation_id);
 end if;
 s:=private.r12_etsy_steel_current(s.operation_id,true);
 if v.expires_at<=clock_timestamp() then raise exception 'etsy_verification_expired';end if;
 if p_operation='inputs' then
  perform private.r04_keys(p_payload,array['operationId']);
  return jsonb_build_object('scope',v.scope,'scopeHash',v.scope_hash,'requestId',v.request_id,'workflowRunId',v.workflow_run_id);
 elsif p_operation='admit' then
  perform private.r04_keys(p_payload,array['operationId']);
  reserved:=private.r12_direct_browser_register(e.id,v.operation_id,v.request_id,'owner_setup',v.scope,v.scope->>'quoteHash',r.route_hash);
  insert into private.r12_etsy_steel_verification_cleanup(operation_id,provider_session_id,provider_project_id,due_at)
   values(v.operation_id,v.operation_id,r.provider_project_id,least(v.expires_at,clock_timestamp()+make_interval(secs=>(v.scope->>'maximumSessionMs')::double precision/1000)));
  return jsonb_build_object('version','etsy.steel-account-verification-permit.1','operationId',v.operation_id,'scopeHash',v.scope_hash,
   'reservationId',reserved->>'reservationId','reservationHash',reserved->>'reservationHash','reservedBrowserMicrounits',v.scope->>'maximumBrowserMicrounits',
   'expiresAt',to_char(least(v.expires_at,clock_timestamp()+interval '30 seconds') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 elsif p_operation='verify' then
  perform private.r04_keys(p_payload,array['binding','verification']);
  return public.r12_etsy_steel_server(p_business_id,'verify',p_payload,p_server_key);
 end if;
 raise exception 'etsy_verification_operation_invalid';
end $$;
revoke all on function public.r12_etsy_steel_verification_server(uuid,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.r12_etsy_steel_verification_server(uuid,text,jsonb,text) to anon;

do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'r12_etsy_steel_%' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
end $$;
revoke all on function public.r12_etsy_steel_owner(uuid,text,jsonb),public.r12_etsy_steel_server(uuid,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.r12_etsy_steel_owner(uuid,text,jsonb) to authenticated;
grant execute on function public.r12_etsy_steel_server(uuid,text,jsonb,text) to anon;
commit;
