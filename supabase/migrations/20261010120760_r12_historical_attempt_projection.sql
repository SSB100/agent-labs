-- Preserve authenticated historical JSON identities across the single known
-- nullable R07 column addition. No saved record is changed and no authority,
-- grant, receipt, allocation or provider operation is introduced.
begin;

create function private.r12_historical_attempt_row(v jsonb,shape text) returns jsonb
language plpgsql immutable set search_path='' as $$
begin
 perform private.r04_keys(v,array['id','business_id','goal_id','plan_id','child_id','step_key','attempt','input_hash','dependency_pins','status','reason','repair_evidence_hash','created_at','adaptive_action_ordinal','adaptive_action_hash','direct_cycle_ordinal']);
 if v->'direct_cycle_ordinal' is distinct from 'null'::jsonb then raise exception 'r12_historical_direct_attempt_not_legacy';end if;
 if shape='pre20600' then return v-'direct_cycle_ordinal';
 elsif shape='post20600' then return v;
 else raise exception 'r12_historical_unknown_attempt_shape';end if;
end $$;

create function private.r12_historical_prefix(b uuid,g uuid,last_version integer,shape text) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object(
 'plans',(select jsonb_agg(to_jsonb(p) order by p.version) from private.r07_plans p where p.business_id=b and p.goal_id=g and p.version<=last_version),
 'attempts',(select jsonb_agg(private.r12_historical_attempt_row(to_jsonb(a),shape) order by a.id) from private.r07_attempts a join private.r07_plans p on p.id=a.plan_id where a.business_id=b and a.goal_id=g and p.business_id=b and p.goal_id=g and p.version<=last_version),
 'settlements',(select jsonb_agg(to_jsonb(z) order by z.id) from private.r05_settlements z join private.r05_requests r on r.id=z.request_id join private.r07_attempts a on a.id=r.workflow_run_id join private.r07_plans p on p.id=a.plan_id where a.business_id=b and a.goal_id=g and p.business_id=b and p.goal_id=g and p.version<=last_version))
$$;

-- Intrinsic immutable-artifact authentication only. Today's owner, grant expiry,
-- revocation and head gates stay in their existing runtime callers.
create function private.r12_historical_setup_artifact(kind text,setup_id uuid,expected_hash text) returns jsonb
language plpgsql stable set search_path='' as $$
declare o private.r12_owner_setups;a private.r12_adaptive_setups;c jsonb;ch text;b uuid;g uuid;owner_uuid uuid;grant_uuid uuid;p private.r07_plans;s private.r12_discovery_scopes;
begin
 if kind='owner_setup' then
  select * into o from private.r12_owner_setups where id=setup_id and setup_hash=expected_hash;
  if o.id is null or o.setup_hash is distinct from private.stage14_hash(o.preview) or o.preview->>'version' is distinct from 'r12.owner-research-episode-preview.1' then raise exception 'r12_historical_exact_setup_required';end if;
  c:=o.preview->'predecessorClosure';ch:=o.preview->>'predecessorClosureHash';b:=o.business_id;g:=o.goal_id;owner_uuid:=o.owner_id;grant_uuid:=o.grant_id;
  if o.preview->>'businessId' is distinct from b::text or o.preview->>'goalId' is distinct from g::text then raise exception 'r12_historical_setup_lineage_required';end if;
 elsif kind='adaptive_setup' then
  select * into a from private.r12_adaptive_setups where id=setup_id and setup_hash=expected_hash;
  if a.id is null or a.setup_hash is distinct from private.stage14_hash(private.r12_adaptive_setup_packet(a.selection,a.grant_id,a.approval_hash,a.quote,a.preview,a.submission_id,a.owner_observation_ref))
   or coalesce(a.preview->>'version','') not in ('r12.adaptive-research-preview.1','r12.adaptive-research-preview.2') or a.owner_observation_ref is distinct from a.preview->'ownerObservationRef'
   then raise exception 'r12_historical_exact_setup_required';end if;
  c:=a.preview->'predecessor';ch:=a.preview->>'predecessorHash';b:=a.business_id;g:=a.goal_id;owner_uuid:=a.owner_id;grant_uuid:=a.grant_id;
  if a.preview->>'businessId' is distinct from b::text or a.preview->>'goalId' is distinct from g::text then raise exception 'r12_historical_setup_lineage_required';end if;
 else raise exception 'r12_historical_unknown_setup_kind';end if;
 select * into p from private.r07_plans where id=(c->>'predecessorPlanId')::uuid and business_id=b and goal_id=g;
 select * into s from private.r12_discovery_scopes where id=(c->>'predecessorScopeId')::uuid and business_id=b and goal_id=g;
 if c->>'version' is distinct from 'r12.owner-episode-closure.1' or ch is distinct from private.stage14_hash(c)
 or c->>'businessId' is distinct from b::text or c->>'goalId' is distinct from g::text
 or p.id is null or s.id is null or p.owner_id is distinct from owner_uuid or p.version is distinct from (c->>'predecessorPlanVersion')::integer
 or p.content_hash is distinct from c->>'predecessorPlanHash' or p.content_hash is distinct from private.r04_hash(p.content)
 or p.content->>'discoveryScopeId' is distinct from s.id::text or p.content->>'discoveryScopeHash' is distinct from s.amendment_hash
 or s.amendment_hash is distinct from c->>'predecessorScopeHash' or s.amendment_hash is distinct from private.stage14_hash(s.amendment)
 or not exists(select 1 from private.r12_owner_bootstrap_grants gr where gr.id=grant_uuid and gr.business_id=b and gr.owner_id=owner_uuid)
 then raise exception 'r12_historical_setup_lineage_required';end if;
 return jsonb_build_object('businessId',b,'goalId',g,'ownerId',owner_uuid,'closure',c,'closureHash',ch);
end $$;

create table private.r12_historical_setup_projections(
 artifact_kind text not null check(artifact_kind in ('owner_setup','adaptive_setup')),
 setup_id uuid not null,setup_hash text not null,closure_hash text not null,
 business_id uuid not null,goal_id uuid not null,predecessor_plan_id uuid not null references private.r07_plans(id),
 predecessor_version integer not null,disposition text not null check(disposition in ('pinned','non_reconstructible')),
 attempt_shape text check(attempt_shape in ('pre20600','post20600')),
 check((disposition='pinned' and attempt_shape is not null) or (disposition='non_reconstructible' and attempt_shape is null)),
 history_hash text not null,created_at timestamptz not null default clock_timestamp(),
 primary key(artifact_kind,setup_id,setup_hash));
create table private.r12_historical_attempt_projections(
 artifact_kind text not null,setup_id uuid not null,setup_hash text not null,
 attempt_id uuid not null references private.r07_attempts(id),attempt_hash text not null,
 stopped_proof_hash text,created_at timestamptz not null default clock_timestamp(),
 primary key(artifact_kind,setup_id,setup_hash,attempt_id),
 foreign key(artifact_kind,setup_id,setup_hash) references private.r12_historical_setup_projections(artifact_kind,setup_id,setup_hash));
DO $$ declare n text;begin foreach n in array array['r12_historical_setup_projections','r12_historical_attempt_projections'] loop
 execute format('alter table private.%I enable row level security',n);
 execute format('revoke all on private.%I from public,anon,authenticated,service_role',n);
 execute format('create trigger historical_projection_immutable before insert or update or delete on private.%I for each row execute function private.r12_owner_immutable()',n);
end loop;end $$;

-- Only this migration classifies the two published fieldsets, using the exact
-- saved whole-history hash. Runtime never accepts either of two candidate hashes.
DO $backfill$ declare item record;artifact jsonb;c jsonb;history jsonb;shape text;v integer;row_value jsonb;proof jsonb;proof_count integer;attempt_uuid uuid;b uuid;g uuid;begin
 for item in select 'owner_setup'::text kind,id,setup_hash from private.r12_owner_setups where preview->>'version'='r12.owner-research-episode-preview.1'
  union all select 'adaptive_setup',id,setup_hash from private.r12_adaptive_setups loop
  artifact:=private.r12_historical_setup_artifact(item.kind,item.id,item.setup_hash);c:=artifact->'closure';b:=(artifact->>'businessId')::uuid;g:=(artifact->>'goalId')::uuid;v:=(c->>'predecessorPlanVersion')::integer;
  history:=private.r12_historical_prefix(b,g,v,'post20600');shape:='post20600';
  if private.stage14_hash(history) is distinct from c->>'historyHash' then
   history:=private.r12_historical_prefix(b,g,v,'pre20600');shape:='pre20600';
   if private.stage14_hash(history) is distinct from c->>'historyHash' then
    -- The packet remains authentic but its full prefix is no longer the saved
    -- one. Preserve it as permanently ineligible; never guess or refresh a pin.
    insert into private.r12_historical_setup_projections(artifact_kind,setup_id,setup_hash,closure_hash,business_id,goal_id,predecessor_plan_id,predecessor_version,disposition,attempt_shape,history_hash)
     values(item.kind,item.id,item.setup_hash,artifact->>'closureHash',b,g,(c->>'predecessorPlanId')::uuid,v,'non_reconstructible',null,c->>'historyHash');
    continue;
   end if;
  end if;
  if c?'stoppedBeforeReservation' and (jsonb_typeof(c->'stoppedBeforeReservation') is distinct from 'array' or jsonb_array_length(c->'stoppedBeforeReservation')=0) then raise exception 'r12_historical_stopped_proofs_invalid';end if;
  insert into private.r12_historical_setup_projections(artifact_kind,setup_id,setup_hash,closure_hash,business_id,goal_id,predecessor_plan_id,predecessor_version,disposition,attempt_shape,history_hash)
   values(item.kind,item.id,item.setup_hash,artifact->>'closureHash',b,g,(c->>'predecessorPlanId')::uuid,v,'pinned',shape,c->>'historyHash');
  for row_value in select value from jsonb_array_elements(coalesce(nullif(history->'attempts','null'::jsonb),'[]'::jsonb)) loop
   attempt_uuid:=(row_value->>'id')::uuid;
   select count(*) into proof_count from jsonb_array_elements(coalesce(c->'stoppedBeforeReservation','[]'::jsonb)) q where q->>'attemptId'=attempt_uuid::text;
   if proof_count>1 then raise exception 'r12_historical_duplicate_stopped_proof';end if;
   select q into proof from jsonb_array_elements(coalesce(c->'stoppedBeforeReservation','[]'::jsonb)) q where q->>'attemptId'=attempt_uuid::text;
   if proof is not null then
    perform private.r04_keys(proof,array['version','businessId','goalId','ownerId','scopeId','scopeHash','planId','planHash','planVersion','attemptId','attemptHash','childId','childHash','policyId','policyHash','revocationsHash','absenceHash']);
    if proof->>'version' is distinct from 'r12.owner-stopped-before-reservation.1' or proof->>'attemptHash' is distinct from private.stage14_hash(row_value)
     or proof->>'businessId' is distinct from b::text or proof->>'goalId' is distinct from g::text or proof->>'ownerId' is distinct from artifact->>'ownerId'
     or proof->>'planId' is distinct from row_value->>'plan_id' or proof->>'childId' is distinct from row_value->>'child_id'
     or row_value->>'status' is distinct from 'scheduled' or row_value->>'step_key' is distinct from 'plan' or row_value->'attempt' is distinct from '1'::jsonb
     or not exists(select 1 from private.r07_plans p join private.r07_children child on child.plan_id=p.id join private.r12_discovery_scopes s on s.id=(p.content->>'discoveryScopeId')::uuid
      where p.id=(row_value->>'plan_id')::uuid and child.id=(row_value->>'child_id')::uuid and p.content_hash=proof->>'planHash' and p.version=(proof->>'planVersion')::integer
       and child.business_id=b and child.goal_id=g and private.stage14_hash(to_jsonb(child))=proof->>'childHash'
       and s.id=(proof->>'scopeId')::uuid and s.amendment_hash=proof->>'scopeHash' and p.policy_id=(proof->>'policyId')::uuid and p.content->>'policyHash'=proof->>'policyHash')
     then raise exception 'r12_historical_saved_stopped_proof_mismatch';end if;
   end if;
   insert into private.r12_historical_attempt_projections values(item.kind,item.id,item.setup_hash,attempt_uuid,private.stage14_hash(row_value),case when proof is null then null else private.stage14_hash(proof) end,clock_timestamp());
  end loop;
  if (select count(*) from private.r12_historical_attempt_projections where artifact_kind=item.kind and setup_id=item.id and setup_hash=item.setup_hash and stopped_proof_hash is not null)
   <>jsonb_array_length(coalesce(c->'stoppedBeforeReservation','[]'::jsonb)) then raise exception 'r12_historical_unmapped_stopped_proof';end if;
 end loop;
end $backfill$;

create function private.r12_historical_setup_predecessor(kind text,setup_id uuid,expected_hash text,current_closure jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare artifact jsonb;c jsonb;binding private.r12_historical_setup_projections;pin private.r12_historical_attempt_projections;history jsonb;row_value jsonb;proof jsonb;current_proof jsonb;result jsonb;proofs jsonb:='[]'::jsonb;n integer:=0;
begin
 artifact:=private.r12_historical_setup_artifact(kind,setup_id,expected_hash);c:=artifact->'closure';
 select * into binding from private.r12_historical_setup_projections h where h.artifact_kind=kind and h.setup_id=r12_historical_setup_predecessor.setup_id and h.setup_hash=expected_hash;
 if binding.setup_id is null then return current_closure;end if;
 if binding.disposition='non_reconstructible' then raise exception 'r12_historical_setup_non_reconstructible';end if;
 if binding.closure_hash is distinct from artifact->>'closureHash' or binding.business_id::text is distinct from artifact->>'businessId' or binding.goal_id::text is distinct from artifact->>'goalId'
  or binding.predecessor_plan_id::text is distinct from current_closure->>'predecessorPlanId' or binding.predecessor_version is distinct from (current_closure->>'predecessorPlanVersion')::integer
  or private.stage14_hash(private.r12_historical_prefix(binding.business_id,binding.goal_id,binding.predecessor_version,'post20600')) is distinct from current_closure->>'historyHash'
  then raise exception 'r12_historical_setup_changed';end if;
 history:=private.r12_historical_prefix(binding.business_id,binding.goal_id,binding.predecessor_version,binding.attempt_shape);
 if private.stage14_hash(history) is distinct from binding.history_hash or binding.history_hash is distinct from c->>'historyHash' then raise exception 'r12_historical_saved_history_changed';end if;
 for row_value in select value from jsonb_array_elements(coalesce(nullif(history->'attempts','null'::jsonb),'[]'::jsonb)) loop
  n:=n+1;select * into pin from private.r12_historical_attempt_projections h where h.artifact_kind=kind and h.setup_id=r12_historical_setup_predecessor.setup_id and h.setup_hash=expected_hash and h.attempt_id=(row_value->>'id')::uuid;
  if pin.attempt_id is null or pin.attempt_hash is distinct from private.stage14_hash(row_value) then raise exception 'r12_historical_attempt_changed';end if;
 end loop;
 if n<>(select count(*) from private.r12_historical_attempt_projections h where h.artifact_kind=kind and h.setup_id=r12_historical_setup_predecessor.setup_id and h.setup_hash=expected_hash)
  or jsonb_array_length(coalesce(c->'stoppedBeforeReservation','[]'::jsonb))<>jsonb_array_length(coalesce(current_closure->'stoppedBeforeReservation','[]'::jsonb)) then raise exception 'r12_historical_attempt_set_changed';end if;
 for proof in select value from jsonb_array_elements(coalesce(c->'stoppedBeforeReservation','[]'::jsonb)) loop
  select * into pin from private.r12_historical_attempt_projections h where h.artifact_kind=kind and h.setup_id=r12_historical_setup_predecessor.setup_id and h.setup_hash=expected_hash and h.attempt_id=(proof->>'attemptId')::uuid;
  select q into strict current_proof from jsonb_array_elements(current_closure->'stoppedBeforeReservation') q where q->>'attemptId'=proof->>'attemptId';
  if pin.stopped_proof_hash is distinct from private.stage14_hash(proof) or pin.attempt_hash is distinct from proof->>'attemptHash'
   or current_proof-'attemptHash' is distinct from proof-'attemptHash' then raise exception 'r12_historical_stopped_proof_changed';end if;
  proofs:=proofs||jsonb_build_array(jsonb_set(current_proof,'{attemptHash}',to_jsonb(pin.attempt_hash)));
 end loop;
 result:=jsonb_set(current_closure,'{historyHash}',to_jsonb(binding.history_hash));
 if c?'stoppedBeforeReservation' then result:=jsonb_set(result,'{stoppedBeforeReservation}',proofs);end if;
 if result is distinct from c then raise exception 'r12_historical_setup_changed';end if;
 return result;
end $$;

-- Reissue bodies at their existing OIDs; no ambient projection or fresh-producer
-- change. Only an exact already-loaded saved setup selects a historical shape.
DO $patch$ declare d text;old text;replacement text;signature text;begin
 signature:='private.r12_owner_episode_server(uuid,text,jsonb,text)';d:=pg_get_functiondef(signature::regprocedure);
 old:='closure:=private.r12_owner_episode_predecessor(p_business_id,goal.goal_id);';
 replacement:=old||E'\n if p_operation=''confirm_episode'' then closure:=private.r12_historical_setup_predecessor(''owner_setup'',setup.id,setup.setup_hash,closure);end if;';
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_historical_episode_patch_drift';end if;execute replace(d,old,replacement);
 foreach signature in array array['private.r12_adaptive_planner_input(private.r12_adaptive_setups,jsonb,boolean)','private.r12_adaptive_planner_input_etsy(private.r12_adaptive_setups,jsonb,boolean)'] loop
  d:=pg_get_functiondef(signature::regprocedure);old:='closure:=private.r12_owner_episode_predecessor(s.business_id,s.goal_id);';
  replacement:=old||E'\n closure:=private.r12_historical_setup_predecessor(''adaptive_setup'',s.id,s.setup_hash,closure);';
  if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_historical_preflight_patch_drift';end if;execute replace(d,old,replacement);
 end loop;
 foreach signature in array array['private.r12_owner_adaptive_confirm(uuid,jsonb,text)','private.r12_owner_adaptive_confirm_etsy(uuid,jsonb,text)'] loop
  d:=pg_get_functiondef(signature::regprocedure);old:='closure:=private.r12_owner_episode_predecessor(p_business_id,setup.goal_id);';
  replacement:=old||E'\n closure:=private.r12_historical_setup_predecessor(''adaptive_setup'',setup.id,setup.setup_hash,closure);';
  if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_historical_confirm_patch_drift';end if;execute replace(d,old,replacement);
 end loop;
end $patch$;

-- Preserve the public-private function identity for warm compiled callers, and
-- retain its original full-row producer under a new non-authority helper.
DO $$ declare d text;begin
 d:=pg_get_functiondef('private.r12_direct_origin_snapshot(uuid,uuid,integer)'::regprocedure);
 if position('FUNCTION private.r12_direct_origin_snapshot(' in d)=0 then raise exception 'r12_historical_origin_definition_drift';end if;
 execute replace(d,'FUNCTION private.r12_direct_origin_snapshot(','FUNCTION private.r12_historical_origin_current(');
end $$;
create or replace function private.r12_direct_origin_snapshot(b uuid,g uuid,last_version integer) returns jsonb
language plpgsql stable set search_path='' as $$
declare f private.r12_direct_origin_freezes;current_value jsonb;projected jsonb;plan_value jsonb;attempt_value jsonb;saved_plan jsonb;saved_attempt jsonb;row_value jsonb;shape text;row_shape text;i integer;j integer;expected_keys text[];
begin
 current_value:=private.r12_historical_origin_current(b,g,last_version);
 select * into f from private.r12_direct_origin_freezes x where x.business_id=b and x.goal_id=g and (x.packet->'predecessor'->'closure'->>'predecessorPlanVersion')::integer=last_version;
 if f.predecessor_plan_id is null then return current_value;end if;
 if f.origin_hash is distinct from private.stage14_hash(f.packet) or f.history_snapshot_hash is distinct from private.stage14_hash(f.history_snapshot)
  or f.packet->'predecessor'->'closure'->>'predecessorPlanId' is distinct from f.predecessor_plan_id::text
  or f.history_snapshot->>'version' is distinct from 'r12.direct-origin-snapshot.1' or f.history_snapshot->>'businessId' is distinct from b::text or f.history_snapshot->>'goalId' is distinct from g::text
  or jsonb_array_length(current_value->'plans')<>jsonb_array_length(f.history_snapshot->'plans') then raise exception 'r12_historical_origin_binding_changed';end if;
 projected:=current_value;
 for plan_value,i in select value,(ordinality-1)::integer from jsonb_array_elements(current_value->'plans') with ordinality loop
  saved_plan:=f.history_snapshot->'plans'->i;
  if plan_value->'plan' is distinct from saved_plan->'plan' or jsonb_array_length(plan_value->'attempts')<>jsonb_array_length(saved_plan->'attempts') then raise exception 'r12_historical_origin_plan_changed';end if;
  for attempt_value,j in select value,(ordinality-1)::integer from jsonb_array_elements(plan_value->'attempts') with ordinality loop
   saved_attempt:=saved_plan->'attempts'->j;
   row_shape:=case when saved_attempt->'attempt'?'direct_cycle_ordinal' then 'post20600' else 'pre20600' end;
   if shape is null then shape:=row_shape;elsif shape<>row_shape then raise exception 'r12_historical_origin_mixed_attempt_shape';end if;
   row_value:=private.r12_historical_attempt_row(attempt_value->'attempt',shape);
   select array_agg(k order by k) into expected_keys from jsonb_object_keys(row_value) k;
   perform private.r04_keys(saved_attempt->'attempt',expected_keys);
   if row_value is distinct from saved_attempt->'attempt' then raise exception 'r12_historical_origin_attempt_changed';end if;
   projected:=jsonb_set(projected,array['plans',i::text,'attempts',j::text,'attempt'],row_value);
  end loop;
 end loop;
 if projected is distinct from f.history_snapshot then raise exception 'r12_historical_origin_snapshot_changed';end if;
 return projected;
end $$;

DO $$ declare p regprocedure;begin
 for p in select x.oid::regprocedure from pg_proc x join pg_namespace n on n.oid=x.pronamespace where n.nspname='private' and x.proname like 'r12_historical_%' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',p);
 end loop;
end $$;
commit;
