-- R10 is an empty, separately enrolled, one-shot controlled-public viewer boundary.
-- This migration does not create any provider session, credential or viewing grant.
begin;
insert into public.packs(id,pack_key,version,name,kind,status,manifest)
 values('a1100000-0000-4000-8000-000000000001','r10.public-viewer','1.0.0','Controlled public viewer qualification','workflow','experimental','{"purpose":"separately approved R10 qualification only","executionEnabled":false}');
insert into public.workflow_definitions(id,pack_id,workflow_key,version,name,status,stage_definition)
 values('a1100000-0000-4000-8000-000000000002','a1100000-0000-4000-8000-000000000001','r10.public-viewer','1.0.0','Controlled public viewer qualification','experimental','{"policyVersion":"r10.controlled-public.v1","oneShot":true,"nativeEndpoints":false}');

insert into public.worker_definitions(id,pack_id,worker_key,version,name,role,charter,status)
 values('a1100000-0000-4000-8000-000000000003','a1100000-0000-4000-8000-000000000001','r10.controlled-capture','1.0.0','Controlled public capture worker','read-only capture','Render only the fixed reviewed public R10 source in a fresh confined context; publish bounded read-only frames; drain and close on uncertainty. No arbitrary browsing or account access.','experimental');

create table private.r10_server_keys (
 key_hash text primary key check(key_hash ~ '^[a-f0-9]{64}$'), expires_at timestamptz not null
);
create table private.r10_enrollments (
 session_id uuid primary key, workflow_run_id uuid not null unique, business_id uuid not null, quest_id uuid not null,
 owner_id uuid not null references auth.users(id) on delete restrict, auth_session_id uuid not null,
 business_revision integer not null, quest_revision integer not null,
 policy_version text not null check(policy_version='r10.controlled-public.v1'), source_hash text not null check(source_hash='9165948e0a968e0a00be7bc22d4ec89862b84733577ca4a4fb9622238c2c42cd'),
 cost jsonb not null check(jsonb_typeof(cost)='object'),
 definition_hash text not null check(definition_hash ~ '^[a-f0-9]{64}$'), approval_reference text not null check(approval_reference ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,159}$'),
 task_contract_id uuid not null references public.task_contracts(id) on delete restrict, worker_run_id uuid not null references public.worker_runs(id) on delete restrict,
 grant_seconds integer not null check(grant_seconds between 1 and 120), max_runtime_seconds integer not null check(max_runtime_seconds between 1 and 120),
 created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null,
 foreign key(workflow_run_id,business_id) references public.workflow_runs(id,business_id) on delete restrict,
 foreign key(quest_id,business_id,quest_revision) references private.r04_goal_versions(goal_id,business_id,revision) on delete restrict,
 foreign key(business_id,business_revision) references private.r04_business_versions(business_id,revision) on delete restrict,
 check(expires_at>created_at and expires_at<=created_at+interval '120 seconds')
);
create index r10_enrollments_scope on private.r10_enrollments(business_id,quest_id,created_at desc,session_id desc);
create table private.r10_writers (
 session_id uuid primary key references private.r10_enrollments(session_id) on delete restrict,
 writer_id uuid unique, claimed_at timestamptz, hard_deadline timestamptz,
 epoch integer not null default 1 check(epoch=1), context_id uuid, page_id uuid,
 create_dispatched_at timestamptz, provider_session_id text check(provider_session_id ~ '^[A-Za-z0-9_-]{1,160}$'),
 attested_at timestamptz, suspended_at timestamptz, revoke_requested_at timestamptz,
 permits_issued integer not null default 0 check(permits_issued between 0 and 240), last_permit_until timestamptz,
 closed_at timestamptz, close_outcome text check(close_outcome in ('ended','failed','uncertain')),
 provider_receipt_hash text check(provider_receipt_hash ~ '^[a-f0-9]{64}$'), recovery_evidence_hash text check(recovery_evidence_hash ~ '^[a-f0-9]{64}$'),
 release_result text check(release_result in ('released','failed','unknown','not_created')),
 updated_at timestamptz not null default clock_timestamp(),
 check((writer_id is null)=(claimed_at is null)), check((writer_id is null)=(hard_deadline is null)),
 check((closed_at is null)=(close_outcome is null)), check((closed_at is null)=(release_result is null))
);

create table private.r10_close_audits (
 session_id uuid primary key references private.r10_enrollments(session_id) on delete restrict,
 artifact_id uuid not null unique references public.artifacts(id) on delete restrict,
 payload jsonb not null, payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp()
);

create function private.r10_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user in ('anon','authenticated','service_role') then raise exception 'r10_guarded_rpc_required' using errcode='42501'; end if;
 if tg_op='DELETE' or (tg_table_name in ('r10_enrollments','r10_close_audits') and tg_op='UPDATE') then raise exception 'r10_immutable_enrollment'; end if;
 return new;
end $$;
do $$ declare t text; begin
 foreach t in array array['r10_server_keys','r10_enrollments','r10_writers','r10_close_audits'] loop
 execute format('alter table private.%I enable row level security',t);
 execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 if t<>'r10_server_keys' then execute format('create trigger r10_guard before insert or update or delete on private.%I for each row execute function private.r10_guard()',t); end if;
 end loop;
end $$;

create function private.r10_auth_session() returns uuid language plpgsql stable set search_path='' as $$
declare j jsonb; s text; begin
 j:=coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}');
 s:=coalesce(nullif(current_setting('request.jwt.claim.session_id',true),''),j->>'session_id');
 if s is null or s !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return null; end if;
 return s::uuid;
end $$;
create function private.r10_owner(b uuid,q uuid) returns uuid language plpgsql stable set search_path='' as $$
declare u uuid:=auth.uid(); s uuid:=private.r10_auth_session(); begin
 if u is null or s is null or not exists(select 1 from public.businesses where id=b and owner_user_id=u)
 or not exists(select 1 from auth.sessions where id=s and user_id=u and (not_after is null or not_after>clock_timestamp()))
 or not exists(select 1 from private.r04_goal_state where goal_id=q and business_id=b)
 then raise exception 'r10_owner_required' using errcode='42501'; end if;
 return u;
end $$;

-- Admission reads are also repeated after every lock wait. No caller timestamp is trusted.
create function private.r10_gate(e private.r10_enrollments,lock_rows boolean default false) returns text language plpgsql set search_path='' as $$
declare w public.workflow_runs; d public.workflow_definitions; b private.r04_business_state; q private.r04_goal_state; begin
 if lock_rows then
 perform 1 from public.businesses where id=e.business_id for share;
 perform 1 from auth.sessions where id=e.auth_session_id for share;
 select * into b from private.r04_business_state where business_id=e.business_id for share;
 select * into q from private.r04_goal_state where goal_id=e.quest_id and business_id=e.business_id for share;
 select * into w from public.workflow_runs where id=e.workflow_run_id and business_id=e.business_id for share;
 select * into d from public.workflow_definitions where id=w.workflow_definition_id for share;
 else
 select * into b from private.r04_business_state where business_id=e.business_id;
 select * into q from private.r04_goal_state where goal_id=e.quest_id and business_id=e.business_id;
 select * into w from public.workflow_runs where id=e.workflow_run_id and business_id=e.business_id;
 select * into d from public.workflow_definitions where id=w.workflow_definition_id;
 end if;
 if not exists(select 1 from public.businesses where id=e.business_id and owner_user_id=e.owner_id) then return 'owner_changed'; end if;
 if not exists(select 1 from auth.sessions where id=e.auth_session_id and user_id=e.owner_id and (not_after is null or not_after>clock_timestamp())) then return 'auth_session_ended'; end if;
 if b.revision is distinct from e.business_revision or q.revision is distinct from e.quest_revision
 or not exists(select 1 from private.r04_business_versions where business_id=e.business_id and revision=e.business_revision and preference='setup')
 or not exists(select 1 from private.r04_goal_versions where goal_id=e.quest_id and business_id=e.business_id and revision=e.quest_revision and preference='ready') then return 'intent_changed'; end if;
 if w.goal_id is distinct from e.quest_id or w.workflow_definition_id is distinct from 'a1100000-0000-4000-8000-000000000002'::uuid
 or w.status not in ('queued','running') or private.r04_hash(to_jsonb(d)) is distinct from e.definition_hash
 or exists(select 1 from public.browser_sessions where workflow_run_id=e.workflow_run_id)
 or exists(select 1 from private.r04_research_links where workflow_run_id=e.workflow_run_id) or exists(select 1 from public.product_experiments where workflow_run_id=e.workflow_run_id) then return 'workflow_changed'; end if;
 if clock_timestamp()>=(e.cost->>'quoteValidUntil')::timestamptz then return 'quote_expired'; end if;
 if clock_timestamp()>=e.expires_at then return 'expired'; end if;
 return null;
end $$;
create function private.r10_summary(e private.r10_enrollments,w private.r10_writers) returns jsonb language plpgsql set search_path='' as $$
declare s text; reason text:=private.r10_gate(e); begin
 s:=case when w.closed_at is not null and w.revoke_requested_at is not null then 'revoked'
 when w.closed_at is not null then case when w.close_outcome='ended' then 'ended' else 'unavailable' end
 when w.revoke_requested_at is not null then 'revocation_pending'
 when clock_timestamp()>=least(e.expires_at,coalesce(w.hard_deadline,e.expires_at)) then 'expired'
 when reason is not null or w.suspended_at is not null then 'unavailable'
 when w.writer_id is null then 'available'
 when w.attested_at is not null and w.attested_at>clock_timestamp()-interval '4 seconds' then 'watching'
 else 'starting' end;
 return jsonb_build_object('sessionId',e.session_id,'businessId',e.business_id,'questId',e.quest_id,'workflowRunId',e.workflow_run_id,
 'status',s,'expiresAt',least(e.expires_at,coalesce(w.hard_deadline,e.expires_at)),'policyVersion',e.policy_version,'updatedAt',w.updated_at,
 'approvedExposure',jsonb_build_object('currency',e.cost->>'currency','maximumMicrounits',e.cost->>'maximumMicrounits','estimatedMaximumMicrounits',e.cost->>'estimatedMaximumMicrounits','liabilityStatus',case when w.create_dispatched_at is null then 'not_dispatched' else 'unknown' end,'actualMicrounits',null),
 'streamClosure',case when w.closed_at is not null then 'acknowledged' else 'unconfirmed' end);
end $$;

-- Administrator-only deliberate enrollment. Retry cannot refresh or widen the original grant.
create function private.r10_enroll(p_owner_id uuid,p_auth_session_id uuid,p_business_id uuid,p_quest_id uuid,p_source_hash text,p_approval_reference text,p_cost jsonb,
 p_grant_seconds integer default 120,p_max_runtime_seconds integer default 120,p_workflow_run_id uuid default gen_random_uuid(),p_session_id uuid default gen_random_uuid())
 returns jsonb language plpgsql set search_path='' as $$
declare e private.r10_enrollments; w private.r10_writers; br integer; qr integer; dh text; stamp timestamptz; amount numeric; rate numeric; quantum integer; minimum_charge numeric; estimate numeric; task_id uuid:=gen_random_uuid(); worker_id uuid:=gen_random_uuid(); begin
 if current_user in ('anon','authenticated','service_role') then raise exception 'r10_admin_required' using errcode='42501'; end if;
 if p_owner_id is null or p_auth_session_id is null or p_business_id is null or p_quest_id is null or p_workflow_run_id is null or p_session_id is null
 or p_source_hash is distinct from '9165948e0a968e0a00be7bc22d4ec89862b84733577ca4a4fb9622238c2c42cd' or p_approval_reference is null or p_approval_reference !~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{0,159}$'
 or p_grant_seconds is null or p_grant_seconds not between 1 and 120 or p_max_runtime_seconds is null or p_max_runtime_seconds not between 1 and 120 then raise exception 'r10_invalid_enrollment'; end if;
 perform private.r04_keys(p_cost,array['provider','purpose','currency','maximumMicrounits','rateMicrounitsPerMinute','billingQuantumSeconds','minimumChargeMicrounits','estimatedMaximumMicrounits','quoteHash','quoteValidFrom','quoteValidUntil']);
 if p_cost->>'provider' is distinct from 'steel' or p_cost->>'purpose' is distinct from 'r10.controlled-public-viewer-qualification' or p_cost->>'currency' is distinct from 'USD'
 or jsonb_typeof(p_cost->'maximumMicrounits') is distinct from 'string' or p_cost->>'maximumMicrounits' !~ '^[1-9][0-9]{0,6}$'
 or jsonb_typeof(p_cost->'rateMicrounitsPerMinute') is distinct from 'string' or p_cost->>'rateMicrounitsPerMinute' !~ '^(0|[1-9][0-9]{0,6})$'
 or jsonb_typeof(p_cost->'minimumChargeMicrounits') is distinct from 'string' or p_cost->>'minimumChargeMicrounits' !~ '^(0|[1-9][0-9]{0,6})$'
 or jsonb_typeof(p_cost->'estimatedMaximumMicrounits') is distinct from 'string' or p_cost->>'estimatedMaximumMicrounits' !~ '^(0|[1-9][0-9]{0,6})$'
 or jsonb_typeof(p_cost->'billingQuantumSeconds') is distinct from 'number' or p_cost->>'billingQuantumSeconds' !~ '^[1-9][0-9]{0,2}$'
 or jsonb_typeof(p_cost->'quoteHash') is distinct from 'string' or p_cost->>'quoteHash' !~ '^[a-f0-9]{64}$'
 or jsonb_typeof(p_cost->'quoteValidFrom') is distinct from 'string' or p_cost->>'quoteValidFrom' !~ '^\d{4}-\d\d-\d\dT.+(Z|[+-]\d\d:\d\d)$'
 or jsonb_typeof(p_cost->'quoteValidUntil') is distinct from 'string' or p_cost->>'quoteValidUntil' !~ '^\d{4}-\d\d-\d\dT.+(Z|[+-]\d\d:\d\d)$'
 then raise exception 'r10_invalid_cost_quote'; end if;
 amount:=(p_cost->>'maximumMicrounits')::numeric; rate:=(p_cost->>'rateMicrounitsPerMinute')::numeric; quantum:=(p_cost->>'billingQuantumSeconds')::integer; minimum_charge:=(p_cost->>'minimumChargeMicrounits')::numeric;
 if amount>1000000 or quantum not between 1 and 120 then raise exception 'r10_invalid_cost_quote'; end if;
 estimate:=greatest(minimum_charge,ceil(ceil(p_max_runtime_seconds::numeric/quantum)*quantum*rate/60));
 if estimate<>(p_cost->>'estimatedMaximumMicrounits')::numeric or estimate>amount then raise exception 'r10_cost_bound_exceeded'; end if;
 perform pg_advisory_xact_lock(hashtextextended('r10:'||p_session_id::text,0));
 select * into e from private.r10_enrollments where session_id=p_session_id;
 if found then
 if e.owner_id<>p_owner_id or e.auth_session_id<>p_auth_session_id or e.business_id<>p_business_id or e.quest_id<>p_quest_id or e.workflow_run_id<>p_workflow_run_id
 or e.source_hash<>p_source_hash or e.approval_reference<>p_approval_reference or e.cost is distinct from p_cost or e.grant_seconds<>p_grant_seconds or e.max_runtime_seconds<>p_max_runtime_seconds then raise exception 'r10_enrollment_conflict'; end if;
 select * into strict w from private.r10_writers where session_id=e.session_id; return private.r10_summary(e,w);
 end if;
 perform 1 from public.businesses where id=p_business_id and owner_user_id=p_owner_id for share;
 if not found then raise exception 'r10_owner_required'; end if;
 perform 1 from auth.sessions where id=p_auth_session_id and user_id=p_owner_id and (not_after is null or not_after>clock_timestamp()) for share;
 if not found then raise exception 'r10_auth_session_required'; end if;
 select revision into br from private.r04_business_state where business_id=p_business_id for share;
 select revision into qr from private.r04_goal_state where goal_id=p_quest_id and business_id=p_business_id for share;
 if br is null or qr is null or not exists(select 1 from private.r04_business_versions where business_id=p_business_id and revision=br and preference='setup')
 or not exists(select 1 from private.r04_goal_versions where goal_id=p_quest_id and business_id=p_business_id and revision=qr and preference='ready') then raise exception 'r10_managed_ready_quest_required'; end if;
 select private.r04_hash(to_jsonb(d)) into dh from public.workflow_definitions d where id='a1100000-0000-4000-8000-000000000002' and workflow_key='r10.public-viewer' and version='1.0.0' for share;
 if dh is null then raise exception 'r10_definition_unavailable'; end if;
 -- INSERT only: legacy or owner-forged workflow IDs, even same-scope ones, cannot be reused.
 insert into public.workflow_runs(id,business_id,goal_id,workflow_definition_id,idempotency_key,input)
 values(p_workflow_run_id,p_business_id,p_quest_id,'a1100000-0000-4000-8000-000000000002','r10:'||p_session_id::text,'{}');
 insert into public.task_contracts(id,business_id,workflow_run_id,worker_definition_id,status,objective,permitted_capabilities,required_output_schema,completion_criteria,non_goals)
 values(task_id,p_business_id,p_workflow_run_id,'a1100000-0000-4000-8000-000000000003','ready','Render the fixed reviewed public R10 source, relay only bounded read-only frames, then acknowledge producer drain.',array['browser.observe'],'{"type":"object","format":"r10.close-audit.v1"}','{"requires":"trusted physical stream/context closure acknowledgement"}',array['No external requests','No account or saved profile','No input authority','No arbitrary navigation']);
 insert into public.worker_runs(id,business_id,workflow_run_id,task_contract_id,worker_definition_id,status)
 values(worker_id,p_business_id,p_workflow_run_id,task_id,'a1100000-0000-4000-8000-000000000003','queued');
 stamp:=clock_timestamp();
 if (p_cost->>'quoteValidFrom')::timestamptz>stamp or (p_cost->>'quoteValidUntil')::timestamptz<stamp+make_interval(secs=>p_grant_seconds) or (p_cost->>'quoteValidUntil')::timestamptz>stamp+interval '24 hours' then raise exception 'r10_stale_cost_quote'; end if;
 insert into private.r10_enrollments values(p_session_id,p_workflow_run_id,p_business_id,p_quest_id,p_owner_id,p_auth_session_id,br,qr,'r10.controlled-public.v1',p_source_hash,p_cost,dh,p_approval_reference,task_id,worker_id,p_grant_seconds,p_max_runtime_seconds,stamp,stamp+make_interval(secs=>p_grant_seconds)) returning * into e;
 insert into private.r10_writers(session_id) values(p_session_id) returning * into w;
 if private.r10_gate(e,true) is not null then raise exception 'r10_enrollment_stale'; end if;
 return private.r10_summary(e,w);
end $$;

create function private.r10_close_projection(e private.r10_enrollments,w private.r10_writers,captured integer,delivered integer) returns void language plpgsql set search_path='' as $$
declare payload jsonb; aid uuid:=gen_random_uuid(); outcome text; begin
 if w.closed_at is null or captured not between 0 and 120 or delivered not between 0 and captured then raise exception 'r10_invalid_close_counts'; end if;
 outcome:=case when w.close_outcome='ended' then 'completed' else 'failed' end;
 payload:=jsonb_build_object('format','r10.close-audit.v1','sessionId',e.session_id,'businessId',e.business_id,'questId',e.quest_id,'workflowRunId',e.workflow_run_id,
 'taskContractId',e.task_contract_id,'workerRunId',e.worker_run_id,'policyVersion',e.policy_version,'sourceHash',e.source_hash,'capturedFrames',captured,'deliveredFrames',delivered,'permitsIssued',w.permits_issued,
 'createDispatched',w.create_dispatched_at is not null,'closeOutcome',w.close_outcome,'closedAt',w.closed_at,'streamClosure','acknowledged','providerReceiptHash',w.provider_receipt_hash,'releaseResult',w.release_result,
 'closureAuthority',case when w.recovery_evidence_hash is null then 'writer_acknowledgement' else 'administrator_verified_recovery' end,'recoveryEvidenceHash',w.recovery_evidence_hash,
 'liabilityStatus',case when w.create_dispatched_at is null then 'not_dispatched' else 'unknown' end,'actualMicrounits',null);
 insert into public.artifacts(id,business_id,workflow_run_id,task_contract_id,artifact_type,name,content)
 values(aid,e.business_id,e.workflow_run_id,e.task_contract_id,'r10.viewer.close-audit','Controlled public viewer closure audit',payload);
 insert into private.r10_close_audits(session_id,artifact_id,payload,payload_hash) values(e.session_id,aid,payload,private.r04_hash(payload));
 update public.workflow_runs set status=outcome,completed_at=w.closed_at,current_stage_key='closed',state=jsonb_build_object('policyVersion',e.policy_version,'viewerAuditArtifactId',aid,'streamClosure','acknowledged') where id=e.workflow_run_id;
 update public.task_contracts set status=outcome where id=e.task_contract_id;
 update public.worker_runs set status=outcome,completed_at=w.closed_at,output=jsonb_build_object('auditArtifactId',aid,'capturedFrames',captured,'deliveredFrames',delivered,'streamClosure','acknowledged') where id=e.worker_run_id;
 insert into public.events(business_id,workflow_run_id,event_type,actor_type,actor_id,payload) values(e.business_id,e.workflow_run_id,'r10.viewer.closed','worker',e.worker_run_id::text,jsonb_build_object('auditArtifactId',aid,'streamClosure','acknowledged','capturedFrames',captured,'deliveredFrames',delivered));
end $$;

-- Exceptional administrator recovery requires independently verified provider release and
-- physical writer/transport closure evidence, never just a timestamp. No cost is inferred.
create function private.r10_recover_close(p_session_id uuid,p_provider_receipt_hash text,p_closure_evidence_hash text) returns jsonb language plpgsql set search_path='' as $$
declare e private.r10_enrollments; w private.r10_writers; begin
 if current_user in ('anon','authenticated','service_role') then raise exception 'r10_admin_required' using errcode='42501'; end if;
 if p_provider_receipt_hash is null or p_provider_receipt_hash !~ '^[a-f0-9]{64}$' or p_closure_evidence_hash is null or p_closure_evidence_hash !~ '^[a-f0-9]{64}$' then raise exception 'r10_recovery_evidence_required'; end if;
 select * into strict e from private.r10_enrollments where session_id=p_session_id;
 select * into strict w from private.r10_writers where session_id=e.session_id for update;
 if w.closed_at is not null then
 if w.recovery_evidence_hash is distinct from p_closure_evidence_hash or w.provider_receipt_hash is distinct from p_provider_receipt_hash then raise exception 'r10_recovery_conflict'; end if;
 return private.r10_summary(e,w);
 end if;
 if w.writer_id is null or w.provider_session_id is null or w.revoke_requested_at is null or clock_timestamp()<=w.hard_deadline+interval '2 seconds' then raise exception 'r10_recovery_preconditions_required'; end if;
 update private.r10_writers set closed_at=clock_timestamp(),suspended_at=coalesce(suspended_at,clock_timestamp()),attested_at=null,close_outcome='uncertain',release_result='released',provider_receipt_hash=p_provider_receipt_hash,recovery_evidence_hash=p_closure_evidence_hash,updated_at=clock_timestamp() where session_id=e.session_id returning * into w;
 perform private.r10_close_projection(e,w,null,null);
 return private.r10_summary(e,w);
end $$;

create function public.r10_viewer_catalog(p_business_id uuid,p_quest_id uuid,p_workflow_run_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid; s uuid:=private.r10_auth_session(); items jsonb; selected jsonb; begin
 u:=private.r10_owner(p_business_id,p_quest_id);
 select coalesce(jsonb_agg(v.item order by v.created_at desc,v.session_id desc),'[]') into items from(
 select e.created_at,e.session_id,private.r10_summary(e,w) item from private.r10_enrollments e join private.r10_writers w using(session_id)
 where e.business_id=p_business_id and e.quest_id=p_quest_id and e.owner_id=u and e.auth_session_id=s order by e.created_at desc,e.session_id desc limit 40) v;
 if p_workflow_run_id is not null then
 select private.r10_summary(e,w) into selected from private.r10_enrollments e join private.r10_writers w using(session_id)
 where e.business_id=p_business_id and e.quest_id=p_quest_id and e.workflow_run_id=p_workflow_run_id and e.owner_id=u and e.auth_session_id=s;
 end if;
 return jsonb_build_object('businessId',p_business_id,'questId',p_quest_id,'items',items,'selected',selected);
end $$;
create function public.r10_viewer_owner(p_business_id uuid,p_quest_id uuid,p_workflow_run_id uuid,p_session_id uuid default null,p_operation text default 'read') returns jsonb language plpgsql security definer set search_path='' as $$
declare e private.r10_enrollments; w private.r10_writers; u uuid; begin
 u:=private.r10_owner(p_business_id,p_quest_id);
 if p_operation is null or p_operation not in ('read','revoke') or (p_operation='revoke' and p_session_id is null) then raise exception 'r10_invalid_owner_operation'; end if;
 select * into e from private.r10_enrollments where business_id=p_business_id and quest_id=p_quest_id and workflow_run_id=p_workflow_run_id and (p_session_id is null or session_id=p_session_id) and owner_id=u and auth_session_id=private.r10_auth_session();
 if e.session_id is null then return null; end if;
 if p_operation='revoke' then
 select * into strict w from private.r10_writers where session_id=e.session_id for update;
 if w.closed_at is not null then return private.r10_summary(e,w); end if;
 update private.r10_writers set revoke_requested_at=coalesce(revoke_requested_at,clock_timestamp()),suspended_at=coalesce(suspended_at,clock_timestamp()),attested_at=null,closed_at=case when writer_id is null then clock_timestamp() else closed_at end,close_outcome=case when writer_id is null then 'ended' else close_outcome end,release_result=case when writer_id is null then 'not_created' else release_result end,updated_at=clock_timestamp() where session_id=e.session_id returning * into w;
 if w.writer_id is null then perform private.r10_close_projection(e,w,0,0); end if;
 else select * into strict w from private.r10_writers where session_id=e.session_id; end if;
 return private.r10_summary(e,w);
end $$;

create function public.r10_viewer_server(p_business_id uuid,p_quest_id uuid,p_workflow_run_id uuid,p_session_id uuid,p_owner_id uuid,p_auth_session_id uuid,p_operation text,p_payload jsonb,p_server_key text)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare e private.r10_enrollments; w private.r10_writers; reason text; stamp timestamptz; until_at timestamptz; writer uuid; result jsonb; begin
 if p_server_key is null or length(p_server_key) not between 32 and 512 or not exists(select 1 from private.r10_server_keys where key_hash=encode(extensions.digest(convert_to(p_server_key,'UTF8'),'sha256'),'hex') and expires_at>clock_timestamp()) then raise exception 'r10_server_authority_required' using errcode='42501'; end if;
 if p_operation is null or p_operation not in ('read','claim','create_dispatched','created','attest','suspend','permit','revoke','close') or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>2048 then raise exception 'r10_invalid_server_operation'; end if;
 select * into e from private.r10_enrollments where session_id=p_session_id and business_id=p_business_id and quest_id=p_quest_id and workflow_run_id=p_workflow_run_id and owner_id=p_owner_id and auth_session_id=p_auth_session_id;
 if e.session_id is null then raise exception 'r10_scope_unavailable' using errcode='42501'; end if;
 select * into strict w from private.r10_writers where session_id=e.session_id for update;
 if not exists(select 1 from private.r10_server_keys where key_hash=encode(extensions.digest(convert_to(p_server_key,'UTF8'),'sha256'),'hex') and expires_at>clock_timestamp()) then raise exception 'r10_server_authority_required' using errcode='42501'; end if;
 if p_operation='read' then
 perform private.r10_gate(e,true);
 if not exists(select 1 from private.r10_server_keys where key_hash=encode(extensions.digest(convert_to(p_server_key,'UTF8'),'sha256'),'hex') and expires_at>clock_timestamp()) then raise exception 'r10_server_authority_required' using errcode='42501'; end if;
 perform private.r04_keys(p_payload,array[]::text[]); return private.r10_summary(e,w)||jsonb_build_object('serverNow',clock_timestamp(),'writerId',w.writer_id,'providerSessionId',w.provider_session_id,'epoch',w.epoch,'createDispatched',w.create_dispatched_at is not null,'createDispatchedAt',w.create_dispatched_at,'releaseResult',w.release_result,'providerReceiptHash',w.provider_receipt_hash); end if;
 if p_operation in ('claim','create_dispatched','revoke') then perform private.r04_keys(p_payload,array['writerId']);
 elsif p_operation='created' then perform private.r04_keys(p_payload,array['writerId','providerSessionId']);
 elsif p_operation='attest' then perform private.r04_keys(p_payload,array['writerId','contextId','pageId','epoch','sourceHash']);
 elsif p_operation='permit' then perform private.r04_keys(p_payload,array['writerId','contextId','pageId','epoch']);
 elsif p_operation='suspend' then perform private.r04_keys(p_payload,array['writerId','epoch']);
 elsif p_operation='close' then perform private.r04_keys(p_payload,array['writerId','outcome','providerReceiptHash','releaseResult','capturedFrames','deliveredFrames']); end if;
 writer:=(p_payload->>'writerId')::uuid;
 if writer is null then raise exception 'r10_writer_required'; end if;
 if p_operation<>'claim' and w.writer_id is distinct from writer then raise exception 'r10_writer_fenced' using errcode='42501'; end if;
 -- Cleanup never depends on current owner/session/grant: loss of access must not prevent closing.
 if p_operation in ('revoke','suspend','close') then
 if p_operation='suspend' and (p_payload->>'epoch')::integer is distinct from w.epoch then raise exception 'r10_epoch_fenced'; end if;
 if p_operation='close' then
 if jsonb_typeof(p_payload->'capturedFrames') is distinct from 'number' or p_payload->>'capturedFrames' !~ '^(0|[1-9][0-9]{0,2})$'
 or jsonb_typeof(p_payload->'deliveredFrames') is distinct from 'number' or p_payload->>'deliveredFrames' !~ '^(0|[1-9][0-9]{0,2})$'
 or (p_payload->>'capturedFrames')::integer>120 or (p_payload->>'deliveredFrames')::integer>(p_payload->>'capturedFrames')::integer then raise exception 'r10_invalid_close_counts'; end if;
 if p_payload->>'outcome' is null or p_payload->>'outcome' not in ('ended','failed','uncertain') or p_payload->>'releaseResult' is null or p_payload->>'releaseResult' not in ('released','failed','unknown','not_created')
 or (p_payload->'providerReceiptHash'<>'null' and (jsonb_typeof(p_payload->'providerReceiptHash')<>'string' or p_payload->>'providerReceiptHash' !~ '^[a-f0-9]{64}$')) then raise exception 'r10_invalid_close'; end if;
 if w.create_dispatched_at is not null and p_payload->>'releaseResult'='not_created' then raise exception 'r10_ambiguous_create_cannot_be_unsent'; end if;
 if w.create_dispatched_at is null and (p_payload->>'releaseResult'<>'not_created' or p_payload->>'providerReceiptHash' is not null) then raise exception 'r10_provider_not_dispatched'; end if;
 if w.closed_at is not null then
 if exists(select 1 from private.r10_close_audits where session_id=e.session_id and (payload->'capturedFrames' is distinct from p_payload->'capturedFrames' or payload->'deliveredFrames' is distinct from p_payload->'deliveredFrames')) or w.close_outcome is distinct from p_payload->>'outcome' or w.release_result is distinct from p_payload->>'releaseResult' or w.provider_receipt_hash is distinct from p_payload->>'providerReceiptHash' then raise exception 'r10_close_conflict'; end if;
 return private.r10_summary(e,w);
 end if;
 update private.r10_writers set closed_at=clock_timestamp(),close_outcome=p_payload->>'outcome',provider_receipt_hash=p_payload->>'providerReceiptHash',release_result=p_payload->>'releaseResult',suspended_at=coalesce(suspended_at,clock_timestamp()),attested_at=null,updated_at=clock_timestamp() where session_id=e.session_id returning * into w;
 perform private.r10_close_projection(e,w,(p_payload->>'capturedFrames')::integer,(p_payload->>'deliveredFrames')::integer);
 else
 update private.r10_writers set suspended_at=coalesce(suspended_at,clock_timestamp()),revoke_requested_at=case when p_operation='revoke' then coalesce(revoke_requested_at,clock_timestamp()) else revoke_requested_at end,attested_at=null,updated_at=clock_timestamp() where session_id=e.session_id returning * into w;
 end if;
 return private.r10_summary(e,w);
 end if;
 reason:=private.r10_gate(e,true); stamp:=clock_timestamp();
 -- Recheck key expiry after all potentially blocking locks too.
 if not exists(select 1 from private.r10_server_keys where key_hash=encode(extensions.digest(convert_to(p_server_key,'UTF8'),'sha256'),'hex') and expires_at>stamp) then reason:='server_authority_expired'; end if;
 if w.closed_at is not null then reason:='closed'; elsif w.revoke_requested_at is not null then reason:='revoked'; elsif w.suspended_at is not null then reason:='suspended'; elsif w.hard_deadline is not null and stamp>=w.hard_deadline then reason:='expired'; end if;
 if reason is not null then
 -- A late provider reply cannot restore eligibility, but its private cleanup identity
 -- must survive a denied capture admission. Never store native endpoints or profiles.
 if p_operation='created' then
 if w.create_dispatched_at is null or w.provider_session_id is not null or jsonb_typeof(p_payload->'providerSessionId') is distinct from 'string' or p_payload->>'providerSessionId' !~ '^[A-Za-z0-9_-]{1,160}$' then raise exception 'r10_invalid_created'; end if;
 update private.r10_writers set provider_session_id=p_payload->>'providerSessionId',updated_at=stamp where session_id=e.session_id returning * into w;
 end if;
 return jsonb_build_object('allowed',false,'reason',reason,'serverNow',stamp,'leaseUntil',stamp)||private.r10_summary(e,w);
 end if;
 if p_operation='claim' then
 if w.writer_id is not null then raise exception 'r10_one_shot_consumed'; end if;
 update public.workflow_runs set status='running',started_at=stamp,current_stage_key='controlled_capture' where id=e.workflow_run_id;
 update public.task_contracts set status='running' where id=e.task_contract_id;
 update public.worker_runs set status='running',started_at=stamp where id=e.worker_run_id;
 if private.r10_gate(e,true) is not null then raise exception 'r10_claim_stale'; end if;
 stamp:=clock_timestamp();
 if not exists(select 1 from private.r10_server_keys where key_hash=encode(extensions.digest(convert_to(p_server_key,'UTF8'),'sha256'),'hex') and expires_at>stamp) then raise exception 'r10_server_authority_required'; end if;
 update private.r10_writers set writer_id=writer,claimed_at=stamp,hard_deadline=least(e.expires_at,stamp+make_interval(secs=>e.max_runtime_seconds)),updated_at=stamp where session_id=e.session_id returning * into w;
 return private.r10_summary(e,w)||jsonb_build_object('allowed',true,'status','starting','writerId',writer,'epoch',w.epoch,'serverNow',stamp,'timeoutMs',floor(extract(epoch from w.hard_deadline-stamp)*1000)::integer,'maxFrames',120,'sourceHash',e.source_hash,'cost',e.cost);
 elsif p_operation='create_dispatched' then
 if w.create_dispatched_at is not null then raise exception 'r10_create_already_dispatched'; end if;
 update private.r10_writers set create_dispatched_at=stamp,updated_at=stamp where session_id=e.session_id returning * into w;
 elsif p_operation='created' then
 if w.create_dispatched_at is null or w.provider_session_id is not null or jsonb_typeof(p_payload->'providerSessionId') is distinct from 'string' or p_payload->>'providerSessionId' !~ '^[A-Za-z0-9_-]{1,160}$' then raise exception 'r10_invalid_created'; end if;
 update private.r10_writers set provider_session_id=p_payload->>'providerSessionId',updated_at=stamp where session_id=e.session_id returning * into w;
 elsif p_operation in ('attest','permit') then
 if jsonb_typeof(p_payload->'epoch') is distinct from 'number' or (p_payload->>'epoch')::integer is distinct from w.epoch or (p_payload->>'contextId')::uuid is null or (p_payload->>'pageId')::uuid is null then raise exception 'r10_epoch_fenced'; end if;
 if w.provider_session_id is null then raise exception 'r10_provider_not_created'; end if;
 if p_operation='attest' then
 if p_payload->>'sourceHash' is distinct from e.source_hash or (w.context_id is not null and (w.context_id is distinct from (p_payload->>'contextId')::uuid or w.page_id is distinct from (p_payload->>'pageId')::uuid)) then raise exception 'r10_attestation_fenced'; end if;
 update private.r10_writers set context_id=(p_payload->>'contextId')::uuid,page_id=(p_payload->>'pageId')::uuid,attested_at=stamp,updated_at=stamp where session_id=e.session_id returning * into w;
 else
 if w.context_id is distinct from (p_payload->>'contextId')::uuid or w.page_id is distinct from (p_payload->>'pageId')::uuid or w.attested_at is null or w.attested_at<=stamp-interval '4 seconds' or w.permits_issued>=240 then return jsonb_build_object('allowed',false,'reason','capture_stale_or_exhausted','serverNow',stamp,'leaseUntil',stamp); end if;
 until_at:=least(stamp+interval '2 seconds',e.expires_at,w.hard_deadline);
 update private.r10_writers set permits_issued=permits_issued+1,last_permit_until=until_at,updated_at=stamp where session_id=e.session_id;
 return jsonb_build_object('allowed',true,'epoch',w.epoch,'serverNow',stamp,'leaseUntil',until_at);
 end if;
 end if;
 return private.r10_summary(e,w)||jsonb_build_object('allowed',true,'serverNow',stamp,'epoch',w.epoch);
end $$;

-- An admitted writer must acknowledge drain before identities can be reassigned.
-- Never set revoke then raise: transaction rollback would silently undo the revoke.
create function private.r10_identity_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare blocked boolean:=false; begin
 if tg_table_name='businesses' then
 if tg_op='DELETE' or new.owner_user_id is distinct from old.owner_user_id then select exists(select 1 from private.r10_enrollments e join private.r10_writers w using(session_id) where e.business_id=old.id and w.writer_id is not null and w.closed_at is null) into blocked; end if;
 elsif tg_table_name='workflow_runs' then
 if tg_op='DELETE' or new.business_id is distinct from old.business_id or new.goal_id is distinct from old.goal_id or new.workflow_definition_id is distinct from old.workflow_definition_id or new.status is distinct from old.status then select exists(select 1 from private.r10_enrollments e join private.r10_writers w using(session_id) where e.workflow_run_id=old.id and w.writer_id is not null and w.closed_at is null) into blocked; end if;
 elsif tg_table_name='r04_goal_state' then
 if tg_op='DELETE' or new.business_id is distinct from old.business_id or new.goal_id is distinct from old.goal_id or new.revision is distinct from old.revision then select exists(select 1 from private.r10_enrollments e join private.r10_writers w using(session_id) where e.quest_id=old.goal_id and w.writer_id is not null and w.closed_at is null) into blocked; end if;
 elsif tg_table_name='r04_business_state' then
 if tg_op='DELETE' or new.business_id is distinct from old.business_id or new.revision is distinct from old.revision then select exists(select 1 from private.r10_enrollments e join private.r10_writers w using(session_id) where e.business_id=old.business_id and w.writer_id is not null and w.closed_at is null) into blocked; end if;
 elsif (tg_table_name='worker_definitions' and old.id='a1100000-0000-4000-8000-000000000003') or (tg_table_name='workflow_definitions' and old.id='a1100000-0000-4000-8000-000000000002') or (tg_table_name='packs' and old.id='a1100000-0000-4000-8000-000000000001') then raise exception 'r10_immutable_definition';
 end if;
 if blocked then raise exception 'r10_revoke_and_close_ack_required'; end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger r10_identity_guard before update or delete on public.businesses for each row execute function private.r10_identity_guard();
create trigger r10_identity_guard before update or delete on public.workflow_runs for each row execute function private.r10_identity_guard();
create trigger r10_identity_guard before update or delete on private.r04_goal_state for each row execute function private.r10_identity_guard();
create trigger r10_identity_guard before update or delete on private.r04_business_state for each row execute function private.r10_identity_guard();
create trigger r10_identity_guard before update or delete on public.workflow_definitions for each row execute function private.r10_identity_guard();
create trigger r10_identity_guard before update or delete on public.worker_definitions for each row execute function private.r10_identity_guard();
create trigger r10_identity_guard before update or delete on public.packs for each row execute function private.r10_identity_guard();

create function private.r10_projection_guard() returns trigger language plpgsql set search_path='' as $$
declare old_run uuid; new_run uuid; protected boolean:=false; begin
 if tg_table_name='workflow_runs' then
 protected:=(tg_op<>'INSERT' and old.workflow_definition_id='a1100000-0000-4000-8000-000000000002') or (tg_op<>'DELETE' and new.workflow_definition_id='a1100000-0000-4000-8000-000000000002');
 else
 if tg_op<>'INSERT' then old_run:=old.workflow_run_id; end if;
 if tg_op<>'DELETE' then new_run:=new.workflow_run_id; end if;
 select exists(select 1 from public.workflow_runs where id in (old_run,new_run) and workflow_definition_id='a1100000-0000-4000-8000-000000000002') into protected;
 end if;
 if protected and current_user in ('anon','authenticated','service_role') then raise exception 'r10_projection_guarded_rpc_required' using errcode='42501'; end if;
 if protected and tg_table_name in ('artifacts','events') and tg_op<>'INSERT' then raise exception 'r10_immutable_close_audit'; end if;
 if protected and tg_table_name in ('r04_research_links','product_experiments','browser_sessions') and tg_op<>'DELETE' then raise exception 'r10_dedicated_workflow_only'; end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger r10_projection_guard before insert or update or delete on public.workflow_runs for each row execute function private.r10_projection_guard();
create trigger r10_projection_guard before insert or update or delete on public.task_contracts for each row execute function private.r10_projection_guard();
create trigger r10_projection_guard before insert or update or delete on public.worker_runs for each row execute function private.r10_projection_guard();
create trigger r10_projection_guard before insert or update or delete on public.artifacts for each row execute function private.r10_projection_guard();
create trigger r10_projection_guard before insert or update or delete on public.events for each row execute function private.r10_projection_guard();
create trigger r10_projection_guard before insert or update or delete on private.r04_research_links for each row execute function private.r10_projection_guard();
create trigger r10_projection_guard before insert or update or delete on public.product_experiments for each row execute function private.r10_projection_guard();
create trigger r10_projection_guard before insert or update or delete on public.browser_sessions for each row execute function private.r10_projection_guard();

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname like 'r10_%' loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
end $$;
grant execute on function public.r10_viewer_catalog(uuid,uuid,uuid),public.r10_viewer_owner(uuid,uuid,uuid,uuid,text) to authenticated;
-- The empty hash authority is an additional gate; an anon key alone grants no viewer authority.
grant execute on function public.r10_viewer_server(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb,text) to anon,authenticated;
commit;
