-- Late receipt qualification may settle the original paid work, but cannot
-- revive owner controls or rewrite a different current plan's head.
begin;
create function private.r12_direct_project_closed_head(s private.r12_direct_research_setups,next_state jsonb) returns void
language plpgsql set search_path='' as $$
declare h private.r07_heads;next_status text;next_reason text;begin
 perform 1 from public.businesses where id=s.business_id for update;
 select * into h from private.r07_heads where business_id=s.business_id and goal_id=s.goal_id for update;
 if h.goal_id is null or h.plan_id is distinct from s.plan_id then return;end if;
 if h.state in ('stopped','completed','paused','blocked','needs_owner','waiting') or h.reason='owner_stopped' then return;end if;
 if exists(select 1 from private.r12_direct_test_revocations where envelope_id=s.envelope_id) then next_status:='stopped';next_reason:='owner_stopped';
 elsif exists(select 1 from private.r05_revocations where policy_id=(select policy_id from private.r12_direct_test_envelopes where id=s.envelope_id)) then next_status:='blocked';next_reason:='policy_revoked';
 elsif private.r05_paused(s.business_id,'business',s.business_id) or private.r05_paused(s.business_id,'quest',s.goal_id) then next_status:='paused';next_reason:='scope_paused';
 else next_status:=case when next_state->'researchWindowComplete'='true'::jsonb then 'paused' else 'ready' end;next_reason:=coalesce(next_state->>'terminal','direct_next_attempt_ready');end if;
 update private.r07_heads set revision=revision+1,state=next_status,reason=next_reason
  where business_id=s.business_id and goal_id=s.goal_id and plan_id=s.plan_id;
end $$;
do $$ declare src text;old text;begin
 src:=pg_get_functiondef('private.r12_direct_close_cycle(uuid,integer,jsonb,text)'::regprocedure);
 old:=$a$update private.r07_heads set revision=revision+1,state=case when exists(select 1 from private.r12_direct_test_revocations where envelope_id=s.envelope_id) then 'stopped' when next_state->'researchWindowComplete'='true'::jsonb then 'paused' else 'ready' end,reason=case when exists(select 1 from private.r12_direct_test_revocations where envelope_id=s.envelope_id) then 'owner_stopped' else coalesce(next_state->>'terminal','direct_next_attempt_ready') end where goal_id=s.goal_id;$a$;
 if strpos(src,old)=0 then raise exception 'r12_direct_closed_head_fence_patch_required';end if;
 execute replace(src,old,'perform private.r12_direct_project_closed_head(s,next_state);');
end $$;
revoke all on function private.r12_direct_project_closed_head(private.r12_direct_research_setups,jsonb) from public,anon,authenticated,service_role;
commit;
