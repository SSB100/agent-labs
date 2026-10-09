-- Read-only closure of a stopped owner planner that never reached reservation.
-- No history/status edits, release, refund, table, enrollment or authority.
begin;
create function private.r12_owner_stopped_before_reservation(b uuid,g uuid,aid uuid)
returns jsonb language plpgsql stable set search_path='' as $$
declare a private.r07_attempts;p private.r07_plans;s private.r12_discovery_scopes;
 q private.r12_discovery_authorities;setup private.r12_owner_setups;c private.r07_children;
 step jsonb;absence jsonb;revocations jsonb;
begin
 select * into a from private.r07_attempts where id=aid and business_id=b and goal_id=g;
 select * into p from private.r07_plans where id=a.plan_id and business_id=b and goal_id=g;
 select * into s from private.r12_discovery_scopes where id=(p.content->>'discoveryScopeId')::uuid and business_id=b and goal_id=g;
 select * into q from private.r12_discovery_authorities where scope_id=s.id and business_id=b and goal_id=g;
 select * into setup from private.r12_owner_setups where id=s.owner_setup_id and business_id=b and goal_id=g and scope_id=s.id;
 select * into c from private.r07_children where id=a.child_id and business_id=b and goal_id=g and plan_id=p.id;
 step:=p.content->'steps'->0;
 if a.id is null or p.id is null or s.id is null or q.scope_id is null or setup.id is null or c.id is null
 or s.origin not in ('owner_initial','owner_episode') or a.status<>'scheduled' or a.step_key<>'plan' or a.attempt<>1
 or a.dependency_pins is distinct from '[]'::jsonb or a.input_hash is distinct from private.r04_hash(a.dependency_pins)
 or step->>'key' is distinct from 'plan' or step->'dependsOn' is distinct from '[]'::jsonb
 or c.step_key<>'plan' or c.policy_id<>p.policy_id or c.scope->'step' is distinct from step
 or c.scope->>'parentPlanHash' is distinct from p.content_hash
 or p.content_hash is distinct from private.r04_hash(p.content) or q.plan is distinct from p.content or q.plan_hash is distinct from p.content_hash
 or p.content->>'discoveryScopeHash' is distinct from s.amendment_hash or s.amendment_hash is distinct from private.stage14_hash(s.amendment)
 or setup.owner_id<>p.owner_id or setup.policy_id<>p.policy_id or setup.policy_hash is distinct from p.content->>'policyHash'
 or not exists(select 1 from public.businesses where id=b and owner_user_id=setup.owner_id)
 or (select count(*) from private.r07_attempts where plan_id=p.id)<>1
 or (select count(*) from private.r07_children where plan_id=p.id)<>1
 or exists(select 1 from private.r07_reused where plan_id=p.id)
 then raise exception 'r12_owner_stopped_unreserved_identity_required';end if;
 -- Historical validation only: expiry cannot reopen or prevent closed readback.
 if s.origin='owner_initial' then
  perform private.r12_owner_scope_resolve(s,(s.amendment->>'createdAt')::timestamptz,false);
  if not exists(select 1 from private.r12_owner_activations where setup_id=setup.id and scope_id=s.id and business_id=b and goal_id=g)
  then raise exception 'r12_owner_stopped_unreserved_activation_required';end if;
 else
  perform private.r12_owner_episode_scope_resolve(s,(s.amendment->>'createdAt')::timestamptz,false);
  if not exists(select 1 from private.r12_owner_episode_activations where setup_id=setup.id and scope_id=s.id and plan_id=p.id and business_id=b and goal_id=g)
  then raise exception 'r12_owner_stopped_unreserved_activation_required';end if;
 end if;
 if not exists(select 1 from private.r05_revocations where policy_id=p.policy_id and business_id=b)
 or not exists(select 1 from private.r07_server_revocations where key_hash=q.controller_key_hash)
 or not exists(select 1 from private.r05_server_revocations where key_hash=q.admission_key_hash)
 then raise exception 'r12_owner_stopped_unreserved_revocations_required';end if;
 -- No request is allowed, even an unreserved/released one. Request/wire FKs
 -- also exclude reservations, R05 markers/releases/settlements, transport,
 -- candidates, response observations and receipt checks/observations.
 absence:=jsonb_build_object(
 'requests',(select count(*) from private.r05_requests where workflow_run_id=a.id or policy_id=p.policy_id or (business_id=b and source_key='r07:'||a.id)),
 'bindings',(select count(*) from private.r07_bindings where attempt_id=a.id),
 'wires',(select count(*) from private.r12_discovery_wires where attempt_id=a.id or scope_id=s.id),
 'markers',(select count(*) from private.r07_markers where attempt_id=a.id),
 'responses',(select count(*) from private.r07_responses where attempt_id=a.id),
 'artifacts',(select count(*) from public.artifacts where workflow_run_id=a.id),
 'modelInvocations',(select count(*) from public.model_invocations where workflow_run_id=a.id or task_contract_id=private.stage4_deterministic_uuid('r07:task:'||a.id) or worker_run_id=private.stage4_deterministic_uuid('r07:worker:'||a.id)),
 'receiptClaims',(select count(*) from private.r05_receipt_claims where workflow_run_id=a.id or (business_id=b and source_key='r07:'||a.id)),
 'legacyAttestations',(select count(*) from private.r05_legacy_attestations where workflow_run_id=a.id or (business_id=b and source_key='r07:'||a.id)),
 'legacyExposure',(select count(*) from private.r05_legacy_exposure(b) where workflow_id=a.id or source_key='r07:'||a.id),
 'workerOutput',(select count(*) from public.worker_runs where workflow_run_id=a.id and (output is distinct from '{}'::jsonb or status<>'queued')),
 'stageOutput',(select count(*) from public.workflow_stage_runs where workflow_run_id=a.id and (output is distinct from '{}'::jsonb or status<>'pending')));
 if exists(select 1 from jsonb_each(absence) x where x.value<>'0'::jsonb) then raise exception 'r12_owner_stopped_unreserved_effect_evidence';end if;
 revocations:=jsonb_build_object('policy',(select to_jsonb(x) from private.r05_revocations x where policy_id=p.policy_id and business_id=b),
 'controller',(select to_jsonb(x) from private.r07_server_revocations x where key_hash=q.controller_key_hash),
 'admission',(select to_jsonb(x) from private.r05_server_revocations x where key_hash=q.admission_key_hash));
 return jsonb_build_object('version','r12.owner-stopped-before-reservation.1','businessId',b,'goalId',g,'ownerId',setup.owner_id,
 'scopeId',s.id,'scopeHash',s.amendment_hash,'planId',p.id,'planHash',p.content_hash,'planVersion',p.version,
 'attemptId',a.id,'attemptHash',private.stage14_hash(to_jsonb(a)),'childId',c.id,'childHash',private.stage14_hash(to_jsonb(c)),
 'policyId',p.policy_id,'policyHash',setup.policy_hash,'revocationsHash',private.stage14_hash(revocations),'absenceHash',private.stage14_hash(absence));
end $$;

-- V1 retains its old exact bytes when there is no such attempt. The optional
-- nonempty field documents the narrow proof, rather than silently declaring
-- a scheduled historical row terminal. Proofs span the whole lineage and are
-- freshly reconstructed even after a later accepted episode.
DO $patch$ declare d text;old text;begin
 d:=pg_get_functiondef('private.r12_owner_episode_predecessor(uuid,uuid)'::regprocedure);
 old:='children integer;dispatches integer;repairs integer;known bigint;history jsonb;source jsonb;genesis integer;begin';
 if position(old in d)=0 then raise exception 'r12_stopped_unreserved_declaration_patch_missing';end if;
 d:=replace(d,old,'children integer;dispatches integer;repairs integer;known bigint;history jsonb;source jsonb;genesis integer;stopped_proofs jsonb;begin');
 old:=$o$ if exists(select 1 from private.r07_attempts a where a.business_id=b and a.goal_id=g and a.status in('scheduled','reserved'))$o$;
 if position(old in d)=0 then raise exception 'r12_stopped_unreserved_guard_patch_missing';end if;
 d:=replace(d,old,$n$ select coalesce(jsonb_agg(private.r12_owner_stopped_before_reservation(b,g,a.id) order by plan_row.version,a.id),'[]'::jsonb) into stopped_proofs
 from private.r07_attempts a join private.r07_plans plan_row on plan_row.id=a.plan_id
 where a.business_id=b and a.goal_id=g and a.status='scheduled';
 if exists(select 1 from private.r07_attempts a where a.business_id=b and a.goal_id=g and a.status='reserved')$n$);
 old:=$o$'historyHash',private.stage14_hash(history));$o$;
 if position(old in d)=0 then raise exception 'r12_stopped_unreserved_proof_patch_missing';end if;
 d:=replace(d,old,$n$'historyHash',private.stage14_hash(history))||case when jsonb_array_length(stopped_proofs)>0 then jsonb_build_object('stoppedBeforeReservation',stopped_proofs) else '{}'::jsonb end;$n$);
 execute d;
end $patch$;
revoke all on function private.r12_owner_stopped_before_reservation(uuid,uuid,uuid) from public,anon,authenticated,service_role;
commit;
