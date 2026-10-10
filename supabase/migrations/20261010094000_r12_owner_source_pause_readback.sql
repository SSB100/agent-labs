begin;
-- Read-only projection of the exact last independent review. A terminal NME
-- alone never implies a source operation, and an open action hides the pause.
create function private.r12_adaptive_owner_source_pause(scope uuid) returns text
language sql stable set search_path='' as $$
 select 'owner_source_operation_required'::text
 from private.r12_adaptive_activations a
 join private.r12_discovery_scopes s on s.id=a.scope_id
 join private.r07_heads h on h.business_id=a.business_id and h.goal_id=a.goal_id and h.plan_id=a.plan_id
 join lateral(select * from private.r12_adaptive_actions decision where decision.scope_id=a.scope_id order by ordinal desc limit 1) latest on true
 join private.r12_adaptive_action_closures closed on closed.scope_id=a.scope_id and closed.action_ordinal=latest.ordinal
  and closed.action_hash=latest.content_hash and closed.state='completed'
 join private.r07_attempts t on t.plan_id=a.plan_id and t.adaptive_action_ordinal=latest.ordinal and t.step_key='review' and t.status='completed'
 join private.r07_responses r on r.attempt_id=t.id and r.content_hash=closed.review_hash
 where h.reason is distinct from 'owner_stopped' and latest.ordinal<a.maximum_extra_actions
  and a.scope_id=scope and s.amendment->>'version'='r12.discovery-owner-adaptive.2'
  and r.content->'result'->'review'->'recommendedNextAction'->>'kind'='followup'
  and not exists(select 1 from private.r05_revocations revoked where revoked.policy_id=a.policy_id)
  and not exists(select 1 from private.r07_attempts pending where pending.plan_id=a.plan_id and pending.status in('scheduled','reserved','dispatched','uncertain','responded'))
$$;
revoke all on function private.r12_adaptive_owner_source_pause(uuid) from public,anon,authenticated,service_role;
do $source_pause$ declare d text;needle text:='''pendingReceiptCount'',pending_receipts);end if;';begin
 d:=pg_get_functiondef('public.r12_owner_adaptive_read(uuid,uuid,uuid)'::regprocedure);
 if position(needle in d)=0 then raise exception 'r12_owner_pause_catalog_source_changed';end if;
 d:=replace(d,needle,'''pendingReceiptCount'',pending_receipts,''pauseReason'',private.r12_adaptive_owner_source_pause((active->>''scopeId'')::uuid));end if;');
 execute d;
end $source_pause$;
commit;
