-- R07 coordination only. No controller keys, qualifications, providers or paid effects are seeded.
begin;
create table private.r07_server_keys (
 key_hash text primary key check(key_hash ~ '^[a-f0-9]{64}$'), expires_at timestamptz not null
);
create table private.r07_server_revocations (
 key_hash text primary key references private.r07_server_keys(key_hash), created_at timestamptz not null default clock_timestamp()
);
create table private.r07_adapters (
 adapter_key text primary key check(length(adapter_key) between 1 and 100),
 qualification_hash text not null check(qualification_hash ~ '^[a-f0-9]{64}$'),
 workflow_definition_id uuid not null references public.workflow_definitions(id),
 worker_definition_id uuid not null references public.worker_definitions(id),
 workflow_hash text not null check(workflow_hash ~ '^[a-f0-9]{64}$'), worker_hash text not null check(worker_hash ~ '^[a-f0-9]{64}$'),
 operation_key text not null references private.r05_operations(operation_key),
 role text not null, purpose text not null, artifact_type text not null,
 mode text not null check(mode in ('simulation','production')),
 valid_from timestamptz not null, valid_until timestamptz not null, knowledge_valid_until timestamptz not null,
 check(valid_until>valid_from), check(knowledge_valid_until>valid_from)
);
create table private.r07_adapter_revocations (
 adapter_key text primary key references private.r07_adapters(adapter_key), created_at timestamptz not null default clock_timestamp()
);
create table private.r07_plans (
 id uuid primary key default gen_random_uuid(), business_id uuid not null, goal_id uuid not null,
 version integer not null check(version between 1 and 4), previous_plan_id uuid,
 policy_id uuid not null, owner_id uuid not null references auth.users(id), content jsonb not null,
 content_hash text not null, reason text not null, evidence_hash text not null check(evidence_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(), unique(id,business_id), unique(business_id,goal_id,version),
 foreign key(goal_id,business_id) references private.r04_goal_state(goal_id,business_id),
 foreign key(previous_plan_id,business_id) references private.r07_plans(id,business_id),
 foreign key(policy_id,business_id) references private.r05_policies(id,business_id)
);
create table private.r07_heads (
 business_id uuid not null, goal_id uuid primary key, plan_id uuid not null,
 revision bigint not null default 0, state text not null default 'ready' check(state in ('ready','running','waiting','paused','blocked','needs_owner','stopped','completed')),
 reason text not null default 'plan_saved', lease_epoch bigint not null default 0, lease_hash text, lease_expires_at timestamptz,
 repairs_used integer not null default 0, pivots_used integer not null default 0, children_created integer not null default 0, dispatches integer not null default 0,
 foreign key(goal_id,business_id) references private.r04_goal_state(goal_id,business_id), foreign key(plan_id,business_id) references private.r07_plans(id,business_id)
);
create table private.r07_children (
 id uuid primary key default gen_random_uuid(), business_id uuid not null, goal_id uuid not null, plan_id uuid not null, step_key text not null,
 authority_root_id uuid not null, policy_id uuid not null, scope jsonb not null,
 created_at timestamptz not null default clock_timestamp(), unique(id,business_id), unique(plan_id,step_key),
 check(authority_root_id=business_id), foreign key(plan_id,business_id) references private.r07_plans(id,business_id),
 foreign key(goal_id,business_id) references private.r04_goal_state(goal_id,business_id), foreign key(policy_id,business_id) references private.r05_policies(id,business_id)
);
create table private.r07_attempts (
 id uuid primary key, business_id uuid not null, goal_id uuid not null, plan_id uuid not null, child_id uuid not null,
 step_key text not null, attempt integer not null check(attempt between 1 and 4),
 input_hash text not null, dependency_pins jsonb not null,
 status text not null check(status in ('scheduled','reserved','dispatched','uncertain','responded','completed','rejected','failed','cancelled')),
 reason text not null, repair_evidence_hash text not null check(repair_evidence_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(), unique(id,business_id), unique(plan_id,step_key,attempt),
 foreign key(id,business_id) references public.workflow_runs(id,business_id), foreign key(plan_id,business_id) references private.r07_plans(id,business_id),
 foreign key(goal_id,business_id) references private.r04_goal_state(goal_id,business_id), foreign key(child_id,business_id) references private.r07_children(id,business_id)
);
create table private.r07_bindings (
 attempt_id uuid primary key, business_id uuid not null, request_id uuid not null unique,
 wire_hash text not null check(wire_hash ~ '^[a-f0-9]{64}$'), descriptor_hash text not null,
 foreign key(attempt_id,business_id) references private.r07_attempts(id,business_id), foreign key(request_id,business_id) references private.r05_requests(id,business_id)
);
create table private.r07_markers (
 attempt_id uuid primary key, business_id uuid not null, lease_epoch bigint not null, created_at timestamptz not null default clock_timestamp(),
 foreign key(attempt_id,business_id) references private.r07_attempts(id,business_id)
);
create table private.r07_responses (
 attempt_id uuid primary key, business_id uuid not null, artifact_id uuid not null, content jsonb not null, content_hash text not null,
 created_at timestamptz not null default clock_timestamp(),
 foreign key(attempt_id,business_id) references private.r07_attempts(id,business_id), foreign key(artifact_id,business_id) references public.artifacts(id,business_id)
);
create table private.r07_reused (
 plan_id uuid not null, step_key text not null, business_id uuid not null, attempt_id uuid not null,
 primary key(plan_id,step_key), foreign key(plan_id,business_id) references private.r07_plans(id,business_id),
 foreign key(attempt_id,business_id) references private.r07_attempts(id,business_id)
);
create table private.r07_events (
 id bigint generated always as identity primary key, business_id uuid not null, goal_id uuid not null, plan_id uuid not null,
 attempt_id uuid, operation text not null, payload jsonb not null, created_at timestamptz not null default clock_timestamp(),
 foreign key(plan_id,business_id) references private.r07_plans(id,business_id), foreign key(attempt_id,business_id) references private.r07_attempts(id,business_id)
);
-- Transaction-local, exact-run admission. Cleared before every RPC return.
create table private.r07_core_admissions (
 transaction_id bigint not null, workflow_run_id uuid not null, primary key(transaction_id,workflow_run_id)
);
create table private.r07_submissions (
 business_id uuid not null references public.businesses(id), id uuid not null, request_hash text not null, result jsonb not null,
 primary key(business_id,id)
);
create index r07_plans_page on private.r07_plans(business_id,goal_id,version desc);
create index r07_attempts_scope on private.r07_attempts(business_id,goal_id,plan_id,step_key,attempt desc);
create index r07_children_scope on private.r07_children(business_id,goal_id);
create index r07_events_page on private.r07_events(business_id,goal_id,id desc);

create function private.r07_guard() returns trigger language plpgsql set search_path='' as $$ begin
 if current_user in ('anon','authenticated','service_role') then raise exception 'r07_guarded_rpc_required' using errcode='42501'; end if;
 if tg_table_name='r07_core_admissions' then
 if tg_op='UPDATE' then raise exception 'r07_immutable_admission'; end if;
 return case when tg_op='DELETE' then old else new end; end if;
 if tg_op='DELETE' or (tg_op='UPDATE' and tg_table_name not in ('r07_heads','r07_attempts')) then raise exception 'r07_immutable_history'; end if;
 if tg_op='UPDATE' and tg_table_name='r07_attempts' and (to_jsonb(new)-array['status','reason']) is distinct from (to_jsonb(old)-array['status','reason']) then raise exception 'r07_immutable_attempt_identity'; end if;
 return new;
end $$;
do $$ declare t text; begin
 for t in select tablename from pg_tables where schemaname='private' and tablename like 'r07_%' loop
 execute format('alter table private.%I enable row level security',t);
 execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger r07_guard before insert or update or delete on private.%I for each row execute function private.r07_guard()',t);
 end loop;
end $$;
create function private.r07_artifact_guard() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if exists(select 1 from private.r07_responses where artifact_id=old.id) then raise exception 'r07_immutable_output'; end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger r07_artifact_guard before update or delete on public.artifacts for each row execute function private.r07_artifact_guard();

create function private.r07_safe(p jsonb) returns void language plpgsql set search_path='' as $$ declare v jsonb; begin
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>65536 then raise exception 'r07_invalid_payload'; end if;
 for v in select value from jsonb_each(p) loop
 if jsonb_typeof(v)='array' then for v in select value from jsonb_array_elements(v) loop perform private.r04_safe(v); end loop;
 else perform private.r04_safe(v); end if;
 end loop;
end $$;
create function private.r07_validate_plan(b uuid,g uuid,p jsonb) returns void language plpgsql set search_path='' as $$
declare s jsonb; k text; seen text[]:='{}'; first_key text; challenge_key text; total numeric:=0; policy private.r05_policies; scope jsonb; n integer:=0; dep text; begin
 perform private.r07_safe(p);
 perform private.r04_keys(p,array['format','businessId','goalId','goalRevision','goalHash','businessRevision','businessHash','policyId','policyHash','authorityRootId','plannerWorkerDefinitionId','currency','maximumMicrounits','deadline','expiresAt','maximumRepairs','maximumPivots','maximumChildren','maximumDispatches','requiredChecks','finishCondition','stopConditions','steps']);
 if p->>'format' is distinct from 'r07.1' or p->>'businessId' is distinct from b::text or p->>'goalId' is distinct from g::text or p->>'authorityRootId' is distinct from b::text or p->>'currency' is distinct from 'USD' then raise exception 'r07_invalid_lineage'; end if;
 foreach k in array array['goalRevision','businessRevision','maximumRepairs','maximumPivots','maximumChildren','maximumDispatches'] loop
 if jsonb_typeof(p->k) is distinct from 'number' or p->>k !~ '^(0|[1-9][0-9]{0,8})$' then raise exception 'r07_invalid_integer'; end if;
 end loop;
 if (p->>'maximumRepairs')::integer>8 or (p->>'maximumPivots')::integer>3 or (p->>'maximumChildren')::integer not between 2 and 32 or (p->>'maximumDispatches')::integer not between 2 and 64 then raise exception 'r07_invalid_bounds'; end if;
 if not exists(select 1 from private.r04_goal_versions where business_id=b and goal_id=g and revision=(p->>'goalRevision')::integer and content_hash=p->>'goalHash') or not exists(select 1 from private.r04_business_versions where business_id=b and revision=(p->>'businessRevision')::integer and content_hash=p->>'businessHash') then raise exception 'r07_invalid_version_pins'; end if;
 select * into policy from private.r05_policies where id=(p->>'policyId')::uuid and business_id=b and goal_id=g;
 if policy.id is null or policy.content_hash is distinct from p->>'policyHash' or policy.goal_revision<>(p->>'goalRevision')::integer or policy.business_revision<>(p->>'businessRevision')::integer then raise exception 'r07_policy_pin_mismatch'; end if;
 if not exists(select 1 from public.worker_definitions where id=(p->>'plannerWorkerDefinitionId')::uuid and status in ('qualified','assisted','autonomous')) then raise exception 'r07_planner_unqualified'; end if;
 foreach k in array array['deadline','expiresAt'] loop
 if jsonb_typeof(p->k) is distinct from 'string' or p->>k !~ '^\d{4}-\d\d-\d\dT.+(Z|[+-]\d\d:\d\d)$' then raise exception 'r07_invalid_time'; end if;
 end loop;
 if (p->>'expiresAt')::timestamptz>(policy.payload->>'expiresAt')::timestamptz or (p->>'expiresAt')::timestamptz>(p->>'deadline')::timestamptz or (p->>'expiresAt')::timestamptz<=clock_timestamp() or private.r05_money(p->'maximumMicrounits') not between 1 and private.r05_money(policy.payload->'policyLimitMicrounits') or (p->>'maximumDispatches')::integer>(policy.payload->>'maximumDispatches')::integer then raise exception 'r07_parent_scope_exceeded'; end if;
 if p->>'finishCondition' is distinct from 'all_required_outputs_verified' or p->'stopConditions' is distinct from '["no_permitted_work","deadline","repair_exhausted","owner_stopped"]'::jsonb then raise exception 'r07_invalid_stop_conditions'; end if;
 if jsonb_typeof(p->'steps') is distinct from 'array' or jsonb_array_length(p->'steps') not between 2 and 16 or jsonb_array_length(p->'steps')>(p->>'maximumChildren')::integer or jsonb_array_length(p->'steps')>(p->>'maximumDispatches')::integer then raise exception 'r07_invalid_steps'; end if;
 for s in select value from jsonb_array_elements(p->'steps') loop
 perform private.r04_keys(s,array['key','kind','objective','reason','adapter','qualificationHash','installationId','packSnapshotHash','workflowDefinitionId','workerDefinitionId','role','operationKey','purpose','dependsOn','expectedArtifactType','maximumMicrounits','expiresAt','notBefore','measurement','maximumRepairs']);
 foreach k in array array['key','kind','objective','reason','adapter','qualificationHash','installationId','packSnapshotHash','workflowDefinitionId','workerDefinitionId','role','operationKey','purpose','expectedArtifactType','expiresAt','notBefore'] loop
 if jsonb_typeof(s->k) is distinct from 'string' or length(btrim(s->>k)) not between 1 and 240 then raise exception 'r07_invalid_step_type'; end if;
 end loop;
 if s->>'key' !~ '^[a-z][a-z0-9_-]{0,39}$' or s->>'key'=any(seen) or s->>'qualificationHash' !~ '^[a-f0-9]{64}$' or s->>'packSnapshotHash' !~ '^[a-f0-9]{64}$' then raise exception 'r07_invalid_step_identity'; end if;
 if jsonb_typeof(s->'maximumRepairs') is distinct from 'number' or s->>'maximumRepairs' !~ '^[0-3]$' or (s->>'maximumRepairs')::integer>(p->>'maximumRepairs')::integer then raise exception 'r07_invalid_repair_bound'; end if;
 perform private.r04_strings(s->'dependsOn',16);
 if (select count(*)<>count(distinct x) from jsonb_array_elements_text(s->'dependsOn') x) then raise exception 'r07_duplicate_dependency'; end if;
 for dep in select jsonb_array_elements_text(s->'dependsOn') loop if not dep=any(seen) then raise exception 'r07_invalid_dependencies'; end if; end loop;
 if s->>'kind' not in ('research','challenge','work','review','measure') then raise exception 'r07_invalid_kind'; end if;
 if n=0 then first_key:=s->>'key'; if s->>'kind'<>'research' or s->'dependsOn'<>'[]' then raise exception 'r07_research_first'; end if;
 elsif n=1 then challenge_key:=s->>'key'; if s->>'kind'<>'challenge' or not(s->'dependsOn' ? first_key) then raise exception 'r07_challenge_second'; end if;
 elsif not(s->'dependsOn' ? challenge_key) then raise exception 'r07_challenge_required'; end if;
 if s->>'kind' in ('challenge','review') and (s->>'workerDefinitionId'=p->>'plannerWorkerDefinitionId' or exists(select 1 from jsonb_array_elements(p->'steps') x where s->'dependsOn' ? (x->>'key') and x->>'workerDefinitionId'=s->>'workerDefinitionId')) then raise exception 'r07_independent_check_required'; end if;
 select value into scope from jsonb_array_elements(policy.payload->'operations') x where x->>'operationKey'=s->>'operationKey';
 if scope is null or scope->>'purpose' is distinct from s->>'purpose' or scope->>'workflowDefinitionId' is distinct from s->>'workflowDefinitionId' or scope->>'installationId' is distinct from s->>'installationId' then raise exception 'r07_child_scope_widened'; end if;
 if not exists(select 1 from public.installed_packs where id=(s->>'installationId')::uuid and business_id=b and private.r04_hash(snapshot)=s->>'packSnapshotHash') then raise exception 'r07_snapshot_mismatch'; end if;
 foreach k in array array['expiresAt','notBefore'] loop
 if s->>k !~ '^\d{4}-\d\d-\d\dT.+(Z|[+-]\d\d:\d\d)$' then raise exception 'r07_invalid_time'; end if;
 end loop;
 if private.r05_money(s->'maximumMicrounits') not between 1 and private.r05_money(p->'maximumMicrounits') or (s->>'expiresAt')::timestamptz>(p->>'expiresAt')::timestamptz or (s->>'notBefore')::timestamptz>=(s->>'expiresAt')::timestamptz then raise exception 'r07_child_scope_widened'; end if;
 if s->'measurement'<>'null'::jsonb then
 perform private.r04_keys(s->'measurement',array['minimumObservations','closesAt']);
 if jsonb_typeof(s->'measurement'->'closesAt') is distinct from 'string' or s->'measurement'->>'closesAt' !~ '^\d{4}-\d\d-\d\dT.+(Z|[+-]\d\d:\d\d)$' or s->>'kind'<>'measure' or jsonb_typeof(s->'measurement'->'minimumObservations') is distinct from 'number' or s->'measurement'->>'minimumObservations' !~ '^[1-9][0-9]{0,8}$' or (s->'measurement'->>'closesAt')::timestamptz<=(s->>'notBefore')::timestamptz or (s->'measurement'->>'closesAt')::timestamptz>(s->>'expiresAt')::timestamptz then raise exception 'r07_invalid_measurement'; end if;
 elsif s->>'kind'='measure' then raise exception 'r07_measurement_required'; end if;
 total:=total+private.r05_money(s->'maximumMicrounits'); seen:=array_append(seen,s->>'key'); n:=n+1;
 end loop;
 if total>private.r05_money(p->'maximumMicrounits') then raise exception 'r07_plan_budget_exceeded'; end if;
 perform private.r04_strings(p->'requiredChecks',16);
 if not(p->'requiredChecks' ? challenge_key) or exists(select 1 from jsonb_array_elements_text(p->'requiredChecks') ck where not exists(select 1 from jsonb_array_elements(p->'steps') cs where cs->>'key'=ck and cs->>'kind' in ('challenge','review'))) or (select count(*)<>count(distinct ck) from jsonb_array_elements_text(p->'requiredChecks') ck) then raise exception 'r07_invalid_required_checks'; end if;
end $$;

create function private.r07_gate(p private.r07_plans,s jsonb default null) returns text language plpgsql set search_path='' as $$
declare pol private.r05_policies; a private.r07_adapters; scope jsonb; begin
 select * into pol from private.r05_policies where id=p.policy_id;
 if not exists(select 1 from public.businesses where id=p.business_id and owner_user_id=p.owner_id and owner_user_id=pol.actor_id) then return 'owner_changed'; end if;
 if not exists(select 1 from private.r05_confirmations where policy_id=pol.id and actor_id=p.owner_id) or exists(select 1 from private.r05_revocations where policy_id=pol.id) then return 'policy_not_confirmed'; end if;
 if not exists(select 1 from private.r04_goal_state where goal_id=p.goal_id and business_id=p.business_id and revision=(p.content->>'goalRevision')::integer) or not exists(select 1 from private.r04_business_state where business_id=p.business_id and revision=(p.content->>'businessRevision')::integer) then return 'intent_revision_changed'; end if;
 if not exists(select 1 from private.r04_goal_versions where goal_id=p.goal_id and business_id=p.business_id and revision=(p.content->>'goalRevision')::integer and preference='ready') or not exists(select 1 from private.r04_business_versions where business_id=p.business_id and revision=(p.content->>'businessRevision')::integer and preference='setup') then return 'owner_stopped'; end if;
 if clock_timestamp()>=(p.content->>'expiresAt')::timestamptz or clock_timestamp()>=(p.content->>'deadline')::timestamptz or clock_timestamp()>=(pol.payload->>'expiresAt')::timestamptz then return 'deadline'; end if;
 if clock_timestamp()<(pol.payload->>'startsAt')::timestamptz then return 'not_started'; end if;
 if not exists(select 1 from private.r05_policy_proofs where policy_id=pol.id and policy_hash=pol.content_hash and valid_until>clock_timestamp()) then return 'rules_interpretation_unqualified'; end if;
 if private.r05_paused(p.business_id,'business',p.business_id) or private.r05_paused(p.business_id,'quest',p.goal_id) then return 'scope_paused'; end if;
 if s is null then return null; end if;
 select * into a from private.r07_adapters where adapter_key=s->>'adapter' for share;
 if a.adapter_key is null or a.qualification_hash is distinct from s->>'qualificationHash' or a.workflow_definition_id::text is distinct from s->>'workflowDefinitionId' or a.worker_definition_id::text is distinct from s->>'workerDefinitionId' or a.role is distinct from s->>'role' or a.operation_key is distinct from s->>'operationKey' or a.purpose is distinct from s->>'purpose' or a.artifact_type is distinct from s->>'expectedArtifactType' or exists(select 1 from private.r07_adapter_revocations where adapter_key=a.adapter_key) then return 'adapter_unqualified'; end if;
 if clock_timestamp()<a.valid_from or clock_timestamp()>=a.valid_until or clock_timestamp()>=a.knowledge_valid_until then return 'qualification_or_knowledge_expired'; end if;
 if clock_timestamp()>=(s->>'expiresAt')::timestamptz then return 'step_expired'; end if;
 if clock_timestamp()<(s->>'notBefore')::timestamptz or (s->>'kind'='measure' and clock_timestamp()<(s->'measurement'->>'closesAt')::timestamptz) then return 'measurement_wait'; end if;
 perform 1 from public.worker_definitions wd where id=a.worker_definition_id and status in ('qualified','assisted','autonomous') and private.r04_hash(to_jsonb(wd))=a.worker_hash for share;
 if not found then return 'worker_unqualified'; end if;
 perform 1 from public.workflow_definitions fd where id=a.workflow_definition_id and status in ('qualified','assisted','autonomous') and private.r04_hash(to_jsonb(fd))=a.workflow_hash for share;
 if not found then return 'workflow_unqualified'; end if;
 perform 1 from public.installed_packs where id=(s->>'installationId')::uuid and business_id=p.business_id and status='active' and private.r04_hash(snapshot)=s->>'packSnapshotHash' for share;
 if not found then return 'pack_unavailable'; end if;
 select value into scope from jsonb_array_elements(pol.payload->'operations') x where x->>'operationKey'=s->>'operationKey';
 if private.r05_paused(p.business_id,'pack',(s->>'installationId')::uuid) or (scope->>'accountId' is not null and private.r05_paused(p.business_id,'account',(scope->>'accountId')::uuid)) then return 'scope_paused'; end if;
 if scope->>'accountId' is not null then
 perform 1 from private.connected_accounts where id=(scope->>'accountId')::uuid and business_id=p.business_id and owner_id=p.owner_id and connection_revision::text=scope->>'accountRevision' and status='connected' and revoked_at is null for share;
 if not found then return 'account_unavailable'; end if;
 end if;
 return null;
end $$;

create function private.r07_result_attempt(p uuid,k text) returns uuid language sql stable set search_path='' as $$
 select id from private.r07_attempts where plan_id=p and step_key=k and status='completed'
 union all select attempt_id from private.r07_reused where plan_id=p and step_key=k limit 1
$$;
create function private.r07_dependencies(p uuid,s jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare k text; a uuid; pins jsonb:='[]'; r private.r07_responses; begin
 for k in select jsonb_array_elements_text(s->'dependsOn') order by 1 loop
 a:=private.r07_result_attempt(p,k);
 if a is null then return null; end if;
 select * into r from private.r07_responses where attempt_id=a;
 if r.attempt_id is null or r.content->>'outcome'<>'accepted' then return null; end if;
 pins:=pins||jsonb_build_array(jsonb_build_object('stepKey',k,'attemptId',a,'resultHash',r.content_hash));
 end loop;
 return pins;
end $$;
create function private.r07_budget(p private.r07_plans,s jsonb,a uuid,amount bigint) returns boolean language sql stable set search_path='' as $$
 select coalesce(sum(e.held),0)+amount<=private.r05_money(p.content->'maximumMicrounits')
 and coalesce(sum(e.held) filter(where t.step_key=s->>'key'),0)+amount<=private.r05_money(s->'maximumMicrounits')
 from private.r07_attempts t join private.r07_bindings b on b.attempt_id=t.id
 join private.r05_requests r on r.id=b.request_id
 join lateral private.r05_exposure(p.business_id) e on e.source_key=r.source_key
 where t.business_id=p.business_id and t.goal_id=p.goal_id and t.id<>a
$$;
create function private.r07_snapshot(b uuid,g uuid,pid uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('businessId',b,'goalId',g,'planId',p.id,'version',p.version,'planHash',p.content_hash,'plan',p.content,
 'head',jsonb_build_object('planId',h.plan_id,'revision',h.revision,'state',h.state,'reason',h.reason,'epoch',h.lease_epoch,'leaseExpiresAt',h.lease_expires_at,'repairsUsed',h.repairs_used,'pivotsUsed',h.pivots_used,'childrenCreated',h.children_created,'dispatches',h.dispatches),
 'attempts',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'stepKey',a.step_key,'attempt',a.attempt,'status',a.status,'reason',a.reason,'inputHash',a.input_hash,'dependencyPins',a.dependency_pins,'repairEvidenceHash',a.repair_evidence_hash,'requestId',binding.request_id,'wireHash',binding.wire_hash,'responseHash',response.content_hash,'resultEvidenceHash',private.r04_hash(response.content->'result'),'outcome',response.content->>'outcome','artifactId',response.artifact_id) order by a.step_key,a.attempt),'[]') from private.r07_attempts a left join private.r07_bindings binding on binding.attempt_id=a.id left join private.r07_responses response on response.attempt_id=a.id where a.plan_id=p.id),
 'reused',(select coalesce(jsonb_agg(jsonb_build_object('stepKey',r.step_key,'attemptId',r.attempt_id,'resultHash',v.content_hash) order by r.step_key),'[]') from private.r07_reused r join private.r07_responses v on v.attempt_id=r.attempt_id where r.plan_id=p.id),
 'executionEnabled',false,'capabilityGate','R10-R18','targetAchievement','unverified')
 from private.r07_plans p join private.r07_heads h on h.goal_id=g and h.business_id=b where p.id=pid and p.business_id=b and p.goal_id=g
$$;

create function public.r07_quest_read(p_business_id uuid,p_goal_id uuid,p_plan_id uuid default null,p_limit integer default 20,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$ declare result jsonb; selected uuid; begin
 if not private.is_business_owner(p_business_id) then raise exception 'r07_owner_required' using errcode='42501'; end if;
 if not exists(select 1 from private.r04_goal_state where goal_id=p_goal_id and business_id=p_business_id) then raise exception 'r07_quest_unavailable'; end if;
 if p_limit is null or p_limit not between 1 and 50 or p_offset is null or p_offset not between 0 and 1000000 then raise exception 'r07_invalid_page'; end if;
 selected:=coalesce(p_plan_id,(select plan_id from private.r07_heads where goal_id=p_goal_id and business_id=p_business_id));
 if p_plan_id is not null and not exists(select 1 from private.r07_plans where id=p_plan_id and business_id=p_business_id and goal_id=p_goal_id) then raise exception 'r07_plan_unavailable'; end if;
 result:=jsonb_build_object('selected',private.r07_snapshot(p_business_id,p_goal_id,selected),
 'plans',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'version',version,'hash',content_hash,'previousPlanId',previous_plan_id,'createdAt',created_at) order by version desc),'[]') from private.r07_plans where business_id=p_business_id and goal_id=p_goal_id),
 'events',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id desc),'[]') from(select id,plan_id,attempt_id,operation,payload,created_at from private.r07_events where business_id=p_business_id and goal_id=p_goal_id order by id desc limit p_limit offset p_offset) x),
 'eventTotal',(select count(*) from private.r07_events where business_id=p_business_id and goal_id=p_goal_id),'limit',p_limit,'offset',p_offset);
 if octet_length(result::text)>262144 then raise exception 'r07_read_too_large_reduce_page'; end if;
 return result;
end $$;

create function public.r07_controller(p_business_id uuid,p_goal_id uuid,p_operation text,p_payload jsonb,p_submission_id uuid,p_server_key text,p_lease_token text default null,p_epoch bigint default null,p_admission_key text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
<<ctl>>
declare h private.r07_heads; p private.r07_plans; prior private.r07_plans; a private.r07_attempts; old private.r07_attempts;
 s jsonb; clean jsonb; descriptor jsonb; request private.r05_requests; binding private.r07_bindings; response private.r07_responses;
 result jsonb; saved private.r07_submissions; request_hash text; reason text; scope jsonb; pins jsonb; child uuid; aid uuid; artifact uuid;
 k text; n integer; held numeric; lease text; output jsonb; outcome text; reused uuid; checks jsonb; initial jsonb;
begin
 if p_server_key is null or length(p_server_key) not between 32 and 200 then raise exception 'r07_server_authority_required' using errcode='42501'; end if;
 perform 1 from public.businesses where id=p_business_id for update;
 if not found then raise exception 'r07_business_unavailable'; end if;
 perform 1 from private.r07_server_keys key where key_hash=encode(extensions.digest(convert_to(p_server_key,'UTF8'),'sha256'),'hex') for share;
 if not found then raise exception 'r07_server_authority_required' using errcode='42501'; end if;
 -- Re-read revocation in a fresh statement after a possible lock wait.
 if not exists(select 1 from private.r07_server_keys key where key_hash=encode(extensions.digest(convert_to(p_server_key,'UTF8'),'sha256'),'hex') and expires_at>clock_timestamp() and not exists(select 1 from private.r07_server_revocations r where r.key_hash=key.key_hash)) then raise exception 'r07_server_authority_required' using errcode='42501'; end if;
 if p_operation in ('reserve','dispatch','response','settle','cancel') then
 perform 1 from private.r05_server_keys key where key_hash=encode(extensions.digest(convert_to(p_admission_key,'UTF8'),'sha256'),'hex') for share;
 if not found then raise exception 'r07_admission_authority_required' using errcode='42501'; end if;
 if not exists(select 1 from private.r05_server_keys key where key_hash=encode(extensions.digest(convert_to(p_admission_key,'UTF8'),'sha256'),'hex') and expires_at>clock_timestamp() and not exists(select 1 from private.r05_server_revocations r where r.key_hash=key.key_hash)) then raise exception 'r07_admission_authority_required' using errcode='42501'; end if;
 end if;
 if not exists(select 1 from private.r04_goal_state where goal_id=p_goal_id and business_id=p_business_id) then raise exception 'r07_quest_unavailable'; end if;
 select * into h from private.r07_heads where business_id=p_business_id and goal_id=p_goal_id for update;
 select * into p from private.r07_plans where id=h.plan_id;
 if p_operation='read' then return private.r07_snapshot(p_business_id,p_goal_id,h.plan_id); end if;
 if p_submission_id is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'r07_submission_required'; end if;
 clean:=p_payload-'runtimeCapability'; perform private.r07_safe(clean);
 request_hash:=private.r04_hash(jsonb_build_object('operation',p_operation,'goalId',p_goal_id,'payload',clean));
 select * into saved from private.r07_submissions where business_id=p_business_id and id=p_submission_id;
 -- Never cache a reusable dispatch authorization. Readback/receipt retries need no lease.
 if saved.id is not null then
 if saved.request_hash<>request_hash then raise exception 'r07_submission_conflict'; end if;
 return saved.result||jsonb_build_object('replayed',true,'shouldDispatch',false);
 end if;
 lease:=encode(extensions.digest(convert_to(p_lease_token,'UTF8'),'sha256'),'hex');
 if p_operation='claim' then
 perform private.r04_keys(clean,array['seconds']);
 if p_lease_token is null or length(p_lease_token) not between 32 and 200 or jsonb_typeof(clean->'seconds') is distinct from 'number' or clean->>'seconds' !~ '^[0-9]{1,3}$' or (clean->>'seconds')::integer not between 5 and 120 or h.goal_id is null then raise exception 'r07_invalid_lease'; end if;
 if h.lease_expires_at>clock_timestamp() and h.lease_hash is distinct from lease then raise exception 'r07_lease_held'; end if;
 update private.r07_heads set lease_epoch=case when lease_hash=lease and lease_expires_at>clock_timestamp() then lease_epoch else lease_epoch+1 end,lease_hash=lease,lease_expires_at=clock_timestamp()+make_interval(secs=>(clean->>'seconds')::integer) where goal_id=p_goal_id returning * into h;
 result:=jsonb_build_object('epoch',h.lease_epoch,'expiresAt',h.lease_expires_at,'shouldDispatch',false);
 elsif p_operation='plan' then
 perform private.r04_keys(clean,array['plan','expectedVersion','reason','evidenceHash']);
 if clean->>'evidenceHash' !~ '^[a-f0-9]{64}$' or length(btrim(clean->>'reason')) not between 1 and 240 or jsonb_typeof(clean->'expectedVersion') is distinct from 'number' or (clean->>'expectedVersion')::integer<>coalesce(p.version,0) then raise exception 'r07_plan_compare_and_swap'; end if;
 if h.goal_id is not null and (h.lease_epoch is distinct from p_epoch or h.lease_hash is distinct from lease or h.lease_expires_at<=clock_timestamp() or lease is null) then raise exception 'r07_stale_controller'; end if;
 perform private.r07_validate_plan(p_business_id,p_goal_id,clean->'plan');
 if p.id is not null then
 select content into initial from private.r07_plans where business_id=p_business_id and goal_id=p_goal_id and version=1;
 if not exists(select 1 from private.r07_attempts failed join private.r07_responses rr on rr.attempt_id=failed.id where failed.plan_id=p.id and failed.status in ('rejected','failed') and private.r04_hash(rr.content->'result')=clean->>'evidenceHash') or h.state='completed' or h.reason='owner_stopped' or h.pivots_used>=(p.content->>'maximumPivots')::integer or clean->>'evidenceHash'=p.evidence_hash then raise exception 'r07_pivot_exhausted_or_unchanged'; end if;
 if exists(select 1 from private.r07_attempts where business_id=p_business_id and goal_id=p_goal_id and status in ('scheduled','reserved','dispatched','uncertain','responded')) then raise exception 'r07_reconcile_before_pivot'; end if;
 foreach k in array array['businessId','goalId','goalRevision','goalHash','businessRevision','businessHash','policyId','policyHash','authorityRootId','currency','plannerWorkerDefinitionId'] loop
 if clean->'plan'->k is distinct from p.content->k then raise exception 'r07_pivot_authority_changed'; end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(clean->'plan'->'steps') ns where not exists(select 1 from jsonb_array_elements(p.content->'steps') os where ns->>'operationKey'=os->>'operationKey' and ns->>'purpose'=os->>'purpose' and ns->>'installationId'=os->>'installationId' and ns->>'workflowDefinitionId'=os->>'workflowDefinitionId')) then raise exception 'r07_pivot_operation_widened'; end if;
 foreach k in array array['maximumMicrounits','maximumRepairs','maximumPivots','maximumChildren','maximumDispatches'] loop
 if (clean->'plan'->>k)::numeric>(p.content->>k)::numeric then raise exception 'r07_pivot_scope_widened'; end if;
 end loop;
 if (clean->'plan'->>'expiresAt')::timestamptz>(p.content->>'expiresAt')::timestamptz or (clean->'plan'->>'deadline')::timestamptz>(p.content->>'deadline')::timestamptz then raise exception 'r07_pivot_scope_widened'; end if;
 end if;
 prior:=p;
 insert into private.r07_plans(business_id,goal_id,version,previous_plan_id,policy_id,owner_id,content,content_hash,reason,evidence_hash)
 values(p_business_id,p_goal_id,coalesce(prior.version,0)+1,prior.id,(clean->'plan'->>'policyId')::uuid,(select owner_user_id from public.businesses where id=p_business_id),clean->'plan',private.r04_hash(clean->'plan'),clean->>'reason',clean->>'evidenceHash') returning * into p;
 insert into private.r07_heads(business_id,goal_id,plan_id) values(p_business_id,p_goal_id,p.id)
 on conflict(goal_id) do update set plan_id=excluded.plan_id,pivots_used=private.r07_heads.pivots_used+1,state='ready',reason='plan_pivoted' returning * into h;
 -- Reuse only exact successful work with identical immutable dependency results.
 -- New-plan challenge/review must always run against its own plan hash.
 for s in select value from jsonb_array_elements(p.content->'steps') loop
 if s->>'kind' in ('challenge','review') then continue; end if;
 pins:=private.r07_dependencies(p.id,s);
 if pins is null then continue; end if;
 select t.id into reused from private.r07_attempts t join private.r07_plans oldp on oldp.id=t.plan_id
 where t.business_id=p_business_id and t.goal_id=p_goal_id and t.status='completed' and t.dependency_pins=pins
 and exists(select 1 from jsonb_array_elements(oldp.content->'steps') oldstep where oldstep=s)
 order by oldp.version desc,t.attempt desc limit 1;
 if reused is not null then insert into private.r07_reused(plan_id,step_key,business_id,attempt_id) values(p.id,s->>'key',p_business_id,reused); end if;
 end loop;
 result:=jsonb_build_object('planId',p.id,'version',p.version,'planHash',p.content_hash,'shouldDispatch',false);
 else
 if h.goal_id is null then raise exception 'r07_plan_required'; end if;
 if p_operation not in ('response','settle') and (h.lease_epoch is distinct from p_epoch or h.lease_hash is distinct from lease or h.lease_expires_at<=clock_timestamp() or lease is null) then raise exception 'r07_stale_controller'; end if;
 if p_operation='schedule' then
 perform private.r04_keys(clean,array['stepKey','attemptId','reason','evidenceHash']);
 if clean->>'evidenceHash' !~ '^[a-f0-9]{64}$' or length(btrim(clean->>'reason')) not between 1 and 240 then raise exception 'r07_reason_required'; end if;
 select value into s from jsonb_array_elements(p.content->'steps') x where x->>'key'=clean->>'stepKey';
 if s is null then raise exception 'r07_step_unavailable'; end if;
 if h.state='completed' or (h.state='stopped' and h.reason<>'no_permitted_work') then raise exception 'r07_controller_terminal'; end if;
 if private.r07_result_attempt(p.id,s->>'key') is not null then raise exception 'r07_success_already_persisted'; end if;
 select * into old from private.r07_attempts where plan_id=p.id and step_key=s->>'key' order by attempt desc limit 1;
 if old.id is not null and old.status not in ('rejected','failed') then raise exception 'r07_attempt_already_pending'; end if;
 if old.id is not null and (not exists(select 1 from private.r07_responses rr where rr.attempt_id=old.id and private.r04_hash(rr.content->'result')=clean->>'evidenceHash') or old.repair_evidence_hash=clean->>'evidenceHash' or old.attempt>(s->>'maximumRepairs')::integer or h.repairs_used>=(p.content->>'maximumRepairs')::integer) then raise exception 'r07_repair_exhausted_or_unchanged'; end if;
 pins:=private.r07_dependencies(p.id,s);
 if pins is null then raise exception 'r07_prerequisites_required'; end if;
 if old.id is not null then
 pins:=pins||jsonb_build_array(jsonb_build_object('stepKey','repair:'||old.step_key,'attemptId',old.id,'resultHash',(select content_hash from private.r07_responses where attempt_id=old.id)));
 end if;
 reason:=private.r07_gate(p,s);
 if reason is not null then
 update private.r07_heads set state=case when ctl.reason='scope_paused' then 'paused' when ctl.reason in ('deadline','step_expired','owner_stopped') then 'stopped' when ctl.reason in ('measurement_wait','not_started') then 'waiting' else 'blocked' end,reason=ctl.reason where goal_id=p_goal_id;
 result:=jsonb_build_object('decision','blocked','reason',reason,'shouldDispatch',false);
 else
 if h.dispatches>=(p.content->>'maximumDispatches')::integer then raise exception 'r07_dispatch_bound'; end if;
 select id into child from private.r07_children where plan_id=p.id and step_key=s->>'key';
 if child is null then
 if h.children_created>=(p.content->>'maximumChildren')::integer then raise exception 'r07_child_bound'; end if;
 select value into scope from jsonb_array_elements((select payload from private.r05_policies where id=p.policy_id)->'operations') x where x->>'operationKey'=s->>'operationKey';
 insert into private.r07_children(business_id,goal_id,plan_id,step_key,authority_root_id,policy_id,scope) values(p_business_id,p_goal_id,p.id,s->>'key',p_business_id,p.policy_id,jsonb_build_object('step',s,'operation',scope,'parentPlanHash',p.content_hash,'objective',s->>'objective','reason',s->>'reason','maximumMicrounits',s->>'maximumMicrounits','expiresAt',s->>'expiresAt')) returning id into child;
 update private.r07_heads set children_created=children_created+1 where goal_id=p_goal_id;
 end if;
 aid:=(clean->>'attemptId')::uuid;
 if p_payload->>'runtimeCapability' is null or length(p_payload->>'runtimeCapability') not between 32 and 200 then raise exception 'r07_runtime_capability_required'; end if;
 insert into private.r07_core_admissions values(txid_current(),aid) on conflict do nothing;
 insert into public.workflow_runs(id,business_id,goal_id,workflow_definition_id,idempotency_key,status,input,state,runtime_capability_hash,pack_installation_id,pack_snapshot)
 select aid,p_business_id,p_goal_id,(s->>'workflowDefinitionId')::uuid,'r07:'||aid,'queued','{}',jsonb_build_object('r07PlanId',p.id,'r07ChildId',child,'r07StepKey',s->>'key'),encode(extensions.digest(convert_to(p_payload->>'runtimeCapability','UTF8'),'sha256'),'hex'),i.id,i.snapshot from public.installed_packs i where i.id=(s->>'installationId')::uuid and i.business_id=p_business_id;
 insert into private.r07_attempts(id,business_id,goal_id,plan_id,child_id,step_key,attempt,input_hash,dependency_pins,status,reason,repair_evidence_hash) values(aid,p_business_id,p_goal_id,p.id,child,s->>'key',coalesce(old.attempt,0)+1,private.r04_hash(pins),pins,'scheduled',clean->>'reason',clean->>'evidenceHash') returning * into a;
 insert into public.workflow_stage_runs(id,business_id,workflow_run_id,stage_key,sequence,attempt,status) values(private.stage4_deterministic_uuid('r07:stage:'||aid),p_business_id,aid,'bounded',1,1,'pending');
 insert into public.task_contracts(id,business_id,workflow_run_id,workflow_stage_run_id,worker_definition_id,status,objective,input_artifact_ids,permitted_capabilities,completion_criteria,non_goals,escalation_rules)
 values(private.stage4_deterministic_uuid('r07:task:'||aid),p_business_id,aid,private.stage4_deterministic_uuid('r07:stage:'||aid),(s->>'workerDefinitionId')::uuid,'ready',s->>'objective',array(select r.artifact_id from jsonb_array_elements(pins) x join private.r07_responses r on r.attempt_id=(x->>'attemptId')::uuid),array[s->>'operationKey'],jsonb_build_object('planHash',p.content_hash,'expectedArtifactType',s->>'expectedArtifactType','inputHash',a.input_hash),array['Broaden authority','Mint a new allowance','Claim measured profit from review'],jsonb_build_object('maximumAttempts',1,'controllerRepairsOnly',true));
 insert into public.worker_runs(id,business_id,workflow_run_id,task_contract_id,worker_definition_id,status) values(private.stage4_deterministic_uuid('r07:worker:'||aid),p_business_id,aid,private.stage4_deterministic_uuid('r07:task:'||aid),(s->>'workerDefinitionId')::uuid,'queued');
 update private.r07_heads set state='running',reason='scheduled',repairs_used=repairs_used+case when old.id is null then 0 else 1 end where goal_id=p_goal_id;
 result:=jsonb_build_object('attemptId',a.id,'status','scheduled','shouldDispatch',false);
 end if;
 elsif p_operation='exception' then
 perform private.r04_keys(clean,array['code','evidenceHash']);
 if clean->>'code' not in ('new_account','new_purpose','new_budget','new_risk','unsupported_operation') or jsonb_typeof(clean->'code') is distinct from 'string' or clean->>'evidenceHash' !~ '^[a-f0-9]{64}$' or jsonb_typeof(clean->'evidenceHash') is distinct from 'string' then raise exception 'r07_invalid_exception'; end if;
 update private.r07_heads set state=case when clean->>'code'='unsupported_operation' then 'blocked' else 'needs_owner' end,reason=clean->>'code' where goal_id=p_goal_id returning * into h;
 result:=jsonb_build_object('state',h.state,'reason',h.reason,'evidenceHash',clean->>'evidenceHash','shouldDispatch',false);
 elsif p_operation='evaluate' then
 perform private.r04_keys(clean,array[]::text[]);
 -- Responses are finished separately; unknown work remains explicit until readback.
 if exists(select 1 from private.r07_attempts where plan_id=p.id and status in ('scheduled','reserved','dispatched','uncertain','responded')) then
 result:=jsonb_build_object('state',h.state,'reason','pending_work','shouldDispatch',false);
 else
 reason:=private.r07_gate(p);
 if reason is null and not exists(select 1 from jsonb_array_elements(p.content->'steps') es where private.r07_result_attempt(p.id,es->>'key') is null) then reason:='all_required_outputs_verified';
 elsif reason is null and exists(select 1 from jsonb_array_elements(p.content->'steps') es where private.r07_result_attempt(p.id,es->>'key') is null and private.r07_dependencies(p.id,es) is not null and not exists(select 1 from private.r07_attempts ea where ea.plan_id=p.id and ea.step_key=es->>'key')) then reason:='ready';
 elsif reason is null then reason:='no_permitted_work'; end if;
 update private.r07_heads set state=case when ctl.reason='all_required_outputs_verified' then 'completed' when ctl.reason='ready' then 'ready' when ctl.reason='scope_paused' then 'paused' when ctl.reason in ('not_started','measurement_wait') then 'waiting' when ctl.reason in ('no_permitted_work','deadline','owner_stopped') then 'stopped' else 'blocked' end,reason=ctl.reason where goal_id=p_goal_id returning * into h;
 result:=jsonb_build_object('state',h.state,'reason',reason,'targetAchievement','unverified','shouldDispatch',false);
 end if;
 else
 aid:=(clean->>'attemptId')::uuid;
 select * into a from private.r07_attempts where id=aid and business_id=p_business_id and goal_id=p_goal_id for update;
 if a.id is null then raise exception 'r07_attempt_unavailable'; end if;
 if p_operation not in ('response','settle') and a.plan_id<>h.plan_id then raise exception 'r07_superseded_plan'; end if;
 select * into p from private.r07_plans where id=a.plan_id;
 select value into s from jsonb_array_elements(p.content->'steps') x where x->>'key'=a.step_key;
 select * into binding from private.r07_bindings where attempt_id=a.id;
 insert into private.r07_core_admissions values(txid_current(),a.id) on conflict do nothing;
 if p_operation='reserve' then
 perform private.r04_keys(clean,array['attemptId','descriptor']);
 if a.status<>'scheduled' then raise exception 'r07_not_scheduled'; end if;
 descriptor:=clean->'descriptor';
 if descriptor->>'workflowRunId' is distinct from a.id::text or descriptor->>'operationKey' is distinct from s->>'operationKey' or descriptor->'accounting' is distinct from '{"kind":"r05"}'::jsonb or descriptor->>'idempotencyKey' is distinct from 'r07:'||a.id then raise exception 'r07_descriptor_mismatch'; end if;
 reason:=private.r07_gate(p,s);
 if reason is null and not private.r07_budget(p,s,a.id,private.r05_money(descriptor->'liabilityMicrounits')) then reason:='plan_budget_exhausted'; end if;
 if reason is null then
 result:=public.r05_admission_server(p_business_id,'prepare',descriptor||jsonb_build_object('runtimeCapability',p_payload->>'runtimeCapability'),p_admission_key);
 select * into request from private.r05_requests where id=(result->>'requestId')::uuid;
 if request.policy_id is distinct from p.policy_id or request.workflow_run_id<>a.id then raise exception 'r07_policy_pin_mismatch'; end if;
 result:=public.r05_admission_server(p_business_id,'reserve',jsonb_build_object('requestId',request.id),p_admission_key);
 if result->>'decision'='allowed' then
 insert into private.r07_bindings(attempt_id,business_id,request_id,wire_hash,descriptor_hash) values(a.id,p_business_id,request.id,descriptor->>'wireRequestHash',private.r04_hash(descriptor));
 update private.r07_attempts set status='reserved',reason='admitted' where id=a.id;
 result:=result||jsonb_build_object('status','reserved','attemptId',a.id);
 else reason:=result->>'reason'; end if;
 end if;
 if reason is not null then
 update private.r07_heads set state=case when ctl.reason='scope_paused' then 'paused' else 'blocked' end,reason=ctl.reason where goal_id=p_goal_id;
 result:=jsonb_build_object('decision','blocked','reason',reason,'shouldDispatch',false);
 end if;
 elsif p_operation='dispatch' then
 perform private.r04_keys(clean,array['attemptId','wireHash']);
 if exists(select 1 from private.r07_markers where attempt_id=a.id) then result:=jsonb_build_object('reason','already_marked','shouldDispatch',false);
 else
 if a.status<>'reserved' or binding.attempt_id is null or clean->>'wireHash' is distinct from binding.wire_hash then raise exception 'r07_dispatch_binding_invalid'; end if;
 reason:=private.r07_gate(p,s);
 if reason is null and h.dispatches>=(p.content->>'maximumDispatches')::integer then reason:='dispatch_bound'; end if;
 if reason is null and not private.r07_budget(p,s,a.id,(select liability_microunits from private.r05_requests where id=binding.request_id)) then reason:='plan_budget_exhausted'; end if;
 if reason is null then
 result:=public.r05_admission_server(p_business_id,'dispatch',jsonb_build_object('requestId',binding.request_id),p_admission_key);
 if result->'shouldDispatch'='true' then
 -- R05 may itself have waited for registry/account locks. Expired lease or
 -- narrower child time bounds roll back its marker before any permission leaves SQL.
 if h.lease_expires_at<=clock_timestamp() then raise exception 'r07_stale_controller'; end if;
 reason:=private.r07_gate(p,s);
 if reason is not null then raise exception 'r07_dispatch_gate_changed'; end if;
 insert into private.r07_markers(attempt_id,business_id,lease_epoch) values(a.id,p_business_id,p_epoch);
 update private.r07_attempts set status='dispatched',reason='marked' where id=a.id;
 update private.r07_heads set state='running',reason='dispatched',dispatches=dispatches+1 where goal_id=p_goal_id;
 update public.workflow_runs set status='running',started_at=clock_timestamp() where id=a.id;
 update public.worker_runs set status='running',started_at=clock_timestamp() where id=private.stage4_deterministic_uuid('r07:worker:'||a.id);
 update public.task_contracts set status='running' where id=private.stage4_deterministic_uuid('r07:task:'||a.id);
 update public.workflow_stage_runs set status='running',started_at=clock_timestamp() where id=private.stage4_deterministic_uuid('r07:stage:'||a.id);
 else reason:=result->>'reason'; end if;
 end if;
 if reason is not null then result:=jsonb_build_object('decision','blocked','reason',reason,'shouldDispatch',false); end if;
 end if;
 elsif p_operation='response' then
 perform private.r04_keys(clean,array['attemptId','planHash','inputHash','outcome','result','checkedArtifacts','settlement']);
 if not exists(select 1 from private.r07_markers where attempt_id=a.id) or clean->>'planHash' is distinct from p.content_hash or clean->>'inputHash' is distinct from a.input_hash or jsonb_typeof(clean->'outcome') is distinct from 'string' or clean->>'outcome' not in ('accepted','rejected','failed') or jsonb_typeof(clean->'result') is distinct from 'object' then raise exception 'r07_response_binding_invalid'; end if;
 if s->>'kind' in ('challenge','review') and (clean->'checkedArtifacts' is distinct from a.dependency_pins or clean->'result'->>'verdict' is distinct from case when clean->>'outcome'='accepted' then 'pass' else 'reject' end) then raise exception 'r07_independent_receipt_required'; end if;
 if s->>'kind'='measure' and clean->>'outcome'='accepted' and (clock_timestamp()<(s->'measurement'->>'closesAt')::timestamptz or coalesce(clean->'result'->>'observations','') !~ '^[0-9]{1,10}$' or (clean->'result'->>'observations')::bigint<(s->'measurement'->>'minimumObservations')::bigint) then raise exception 'r07_insufficient_measurement'; end if;
 output:=clean-array['attemptId','settlement'];
 select * into response from private.r07_responses where attempt_id=a.id;
 if response.attempt_id is not null and response.content is distinct from output then raise exception 'r07_response_conflict'; end if;
 result:=public.r05_admission_server(p_business_id,'settle',(clean->'settlement')||jsonb_build_object('requestId',binding.request_id,'currency','USD'),p_admission_key);
 if result->>'decision'<>'allowed' then raise exception 'r07_settlement_unverified'; end if;
 if response.attempt_id is null then
 artifact:=private.stage4_deterministic_uuid('r07:artifact:'||a.id);
 insert into public.artifacts(id,business_id,workflow_run_id,task_contract_id,artifact_type,name,content,checksum,metadata) values(artifact,p_business_id,a.id,private.stage4_deterministic_uuid('r07:task:'||a.id),s->>'expectedArtifactType','Quest step '||a.step_key,output,private.r04_hash(output),jsonb_build_object('r07PlanId',p.id,'r07AttemptId',a.id,'qualificationHash',s->>'qualificationHash','purpose',s->>'purpose'));
 insert into private.r07_responses(attempt_id,business_id,artifact_id,content,content_hash) values(a.id,p_business_id,artifact,output,private.r04_hash(output));
 update private.r07_attempts set status='responded',reason='response_persisted' where id=a.id;
 end if;
 result:=jsonb_build_object('recorded',true,'responseHash',private.r04_hash(output),'shouldDispatch',false);
 elsif p_operation='settle' then
 perform private.r04_keys(clean,array['attemptId','settlement']);
 if binding.attempt_id is null or not exists(select 1 from private.r07_markers where attempt_id=a.id) then raise exception 'r07_dispatch_required'; end if;
 result:=public.r05_admission_server(p_business_id,'readback',(clean->'settlement')||jsonb_build_object('requestId',binding.request_id,'currency','USD'),p_admission_key);
 elsif p_operation='finish' then
 perform private.r04_keys(clean,array['attemptId']);
 select * into response from private.r07_responses where attempt_id=a.id;
 if response.attempt_id is null then raise exception 'r07_response_required'; end if;
 if a.status in ('completed','rejected','failed') then
 result:=jsonb_build_object('status',a.status,'artifactId',response.artifact_id,'shouldDispatch',false);
 elsif not exists(select 1 from private.r05_settlements where request_id=binding.request_id and actual_microunits is not null) then
 result:=jsonb_build_object('reason','unresolved_liability','shouldDispatch',false);
 else
 outcome:=case response.content->>'outcome' when 'accepted' then 'completed' when 'rejected' then 'rejected' else 'failed' end;
 update private.r07_attempts set status=outcome,reason=case when outcome='completed' then 'verified_output' else 'output_not_accepted' end where id=a.id;
 update public.workflow_runs set status=case when outcome='completed' then 'completed' else 'failed' end,completed_at=clock_timestamp() where id=a.id;
 update public.task_contracts set status=case when outcome='completed' then 'completed' else 'failed' end where id=private.stage4_deterministic_uuid('r07:task:'||a.id);
 update public.worker_runs set status=case when outcome='completed' then 'completed' else 'failed' end,output=response.content,completed_at=clock_timestamp() where id=private.stage4_deterministic_uuid('r07:worker:'||a.id);
 update public.workflow_stage_runs set status=case when outcome='completed' then 'completed' else 'failed' end,output=jsonb_build_object('artifactId',response.artifact_id),completed_at=clock_timestamp() where id=private.stage4_deterministic_uuid('r07:stage:'||a.id);
 result:=jsonb_build_object('status',outcome,'artifactId',response.artifact_id,'shouldDispatch',false);
 end if;
 elsif p_operation in ('uncertain','cancel') then
 perform private.r04_keys(clean,array['attemptId','evidenceHash']);
 if clean->>'evidenceHash' !~ '^[a-f0-9]{64}$' then raise exception 'r07_evidence_required'; end if;
 if a.status in ('completed','rejected','failed','cancelled','responded') then result:=jsonb_build_object('status',a.status,'shouldDispatch',false);
 elsif exists(select 1 from private.r07_markers where attempt_id=a.id) then
 update private.r07_attempts set status='uncertain',reason='readback_required' where id=a.id;
 result:=jsonb_build_object('status','uncertain','reason','readback_required','shouldDispatch',false);
 else
 if p_operation='uncertain' then raise exception 'r07_dispatch_required'; end if;
 if binding.attempt_id is not null then
 result:=public.r05_admission_server(p_business_id,'release_unsent',jsonb_build_object('requestId',binding.request_id,'evidenceHash',clean->>'evidenceHash'),p_admission_key);
 if result->>'reason'<>'released_unsent' then raise exception 'r07_release_unverified'; end if;
 end if;
 update private.r07_attempts set status='cancelled',reason='cancelled_unsent' where id=a.id;
 update public.workflow_runs set status='cancelled',completed_at=clock_timestamp() where id=a.id;
 update public.task_contracts set status='cancelled' where id=private.stage4_deterministic_uuid('r07:task:'||a.id);
 update public.worker_runs set status='cancelled',completed_at=clock_timestamp() where id=private.stage4_deterministic_uuid('r07:worker:'||a.id);
 update public.workflow_stage_runs set status='skipped',completed_at=clock_timestamp() where id=private.stage4_deterministic_uuid('r07:stage:'||a.id);
 result:=jsonb_build_object('status','cancelled','shouldDispatch',false);
 end if;
 else raise exception 'r07_unknown_operation'; end if;
 end if;
 end if;
 delete from private.r07_core_admissions where transaction_id=txid_current() and workflow_run_id=aid;
 update private.r07_heads set revision=revision+1 where goal_id=p_goal_id;
 insert into private.r07_events(business_id,goal_id,plan_id,attempt_id,operation,payload) values(p_business_id,p_goal_id,p.id,a.id,p_operation,result);
 insert into private.r07_submissions(business_id,id,request_hash,result) values(p_business_id,p_submission_id,request_hash,result);
 -- Even a Core row update or FK check can wait. The last authority check is
 -- after all writes and before the one-time send permission leaves SQL.
 if result->'shouldDispatch'='true'::jsonb then
 if h.lease_expires_at<=clock_timestamp() then raise exception 'r07_stale_controller'; end if;
 if not exists(select 1 from private.r07_server_keys where key_hash=encode(extensions.digest(convert_to(p_server_key,'UTF8'),'sha256'),'hex') and expires_at>clock_timestamp()) or not exists(select 1 from private.r05_server_keys where key_hash=encode(extensions.digest(convert_to(p_admission_key,'UTF8'),'sha256'),'hex') and expires_at>clock_timestamp()) then raise exception 'r07_authority_expired'; end if;
 reason:=private.r07_gate(p,s);
 if reason is not null then raise exception 'r07_dispatch_gate_changed'; end if;
 select * into request from private.r05_requests where id=binding.request_id;
 if private.r05_admissible(request) is not null then raise exception 'r07_admission_changed'; end if;
 end if;
 return result||jsonb_build_object('replayed',false);
end $$;

create function private.r07_core_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare old_run uuid; new_run uuid; run uuid; declared_r07 boolean:=false; begin
 if tg_table_name='workflow_runs' then
 if tg_op<>'INSERT' then old_run:=old.id; end if;
 if tg_op<>'DELETE' then new_run:=new.id; declared_r07:=new.state ? 'r07PlanId'; end if;
 else
 if tg_op<>'INSERT' then old_run:=old.workflow_run_id; end if;
 if tg_op<>'DELETE' then new_run:=new.workflow_run_id; end if;
 end if;
 for run in select distinct x from unnest(array[old_run,new_run]) x where x is not null loop
 if exists(select 1 from private.r07_attempts where id=run) or declared_r07 then
 if not exists(select 1 from private.r07_core_admissions where transaction_id=txid_current() and workflow_run_id=run) then raise exception 'r07_core_rpc_required' using errcode='42501'; end if;
 if tg_op='DELETE' then raise exception 'r07_immutable_core_history'; end if;
 end if;
 end loop;
 if tg_op='UPDATE' then
 if tg_table_name='workflow_runs' then
 if exists(select 1 from private.r07_attempts where id=old.id) and (new.business_id,new.goal_id,new.workflow_definition_id,new.pack_installation_id,new.pack_snapshot,new.input,new.runtime_capability_hash,new.idempotency_key) is distinct from (old.business_id,old.goal_id,old.workflow_definition_id,old.pack_installation_id,old.pack_snapshot,old.input,old.runtime_capability_hash,old.idempotency_key) then raise exception 'r07_immutable_workflow_identity'; end if;
 elsif (new.business_id,new.workflow_run_id) is distinct from (old.business_id,old.workflow_run_id) then
 if exists(select 1 from private.r07_attempts where id=any(array[old_run,new_run])) then raise exception 'r07_immutable_core_identity'; end if;
 end if;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
do $$ declare tbl text; begin
 foreach tbl in array array['workflow_runs','workflow_stage_runs','task_contracts','worker_runs','artifacts'] loop
 execute format('create trigger r07_core_guard before insert or update or delete on public.%I for each row execute function private.r07_core_guard()',tbl);
 end loop;
end $$;
create function private.r07_revoke_lock() returns trigger language plpgsql set search_path='' as $$ begin
 if tg_table_name='r07_adapter_revocations' then perform 1 from private.r07_adapters where adapter_key=new.adapter_key for update;
 else perform 1 from private.r07_server_keys where key_hash=new.key_hash for update; end if;
 return new;
end $$;
create trigger r07_revoke_lock before insert on private.r07_adapter_revocations for each row execute function private.r07_revoke_lock();
create trigger r07_revoke_lock before insert on private.r07_server_revocations for each row execute function private.r07_revoke_lock();

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'r07_%' loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
end $$;
revoke all on function public.r07_quest_read(uuid,uuid,uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.r07_quest_read(uuid,uuid,uuid,integer,integer) to authenticated;
revoke all on function public.r07_controller(uuid,uuid,text,jsonb,uuid,text,text,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.r07_controller(uuid,uuid,text,jsonb,uuid,text,text,bigint,text) to anon;
commit;
