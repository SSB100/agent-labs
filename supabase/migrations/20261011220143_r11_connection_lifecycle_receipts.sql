-- Add executing-release provenance to existing R11 one-shot read/refresh
-- receipts. The existing exact-tree release gate remains authoritative. No new
-- release registry, account authority, grant, token or provider call is seeded.
begin;
create table private.r11_etsy_execution_receipts(
 operation_id uuid not null references private.r11_etsy_read_attempts(id),
 stage text not null check(stage in ('begin','mark_refresh','mark_read')),
 execution_release jsonb not null,
 business_id uuid not null references public.businesses(id),
 connection_id uuid not null,connection_revision uuid not null,
 window_id uuid not null references private.r11_etsy_read_windows(id),
 recorded_at timestamptz not null default clock_timestamp(),primary key(operation_id,stage),
 foreign key(connection_id,business_id) references private.connected_accounts(id,business_id));
alter table private.r11_etsy_execution_receipts enable row level security;
revoke all on private.r11_etsy_execution_receipts from public,anon,authenticated,service_role;
create function private.r11_execution_receipt_immutable() returns trigger language plpgsql set search_path='' as $$begin
 if tg_op<>'INSERT' then raise exception 'r11_execution_history_immutable';end if;
 if current_user in ('anon','authenticated','service_role') then raise exception 'r11_execution_trusted_only' using errcode='42501';end if;
 return new;
end $$;
create trigger execution_receipt_immutable before insert or update or delete on private.r11_etsy_execution_receipts for each row execute function private.r11_execution_receipt_immutable();

-- Original owner/session/account/scope/budget/one-shot marker checks run in the
-- same transaction. Only their successful first dispatch writes provenance.
-- Legacy callers remain valid during migration-first rollout. Provenance is not
-- a new authority or compatibility claim; the qualified app supplies it from
-- trusted runtime metadata. It never changes or substitutes for owner grants.
alter function public.r11_etsy_read_owner(uuid,text,jsonb,text) rename to r11_etsy_read_owner_before_execution_receipt;
alter function public.r11_etsy_read_owner_before_execution_receipt(uuid,text,jsonb,text) set schema private;
revoke all on function private.r11_etsy_read_owner_before_execution_receipt(uuid,text,jsonb,text) from public,anon,authenticated,service_role;
create function public.r11_etsy_read_owner(p_business_id uuid,p_operation text,p_payload jsonb,p_server_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare session_id uuid;execution jsonb:=p_payload->'executionRelease';a private.r11_etsy_read_attempts;outcome jsonb;begin
 if p_operation='reconcile' then
  -- Status-only reconciliation never decrypts credentials, creates a permit,
  -- consumes a new read, promotes an uncertain token, or sends a provider call.
  perform private.r04_keys(p_payload,array['operationId']);
  perform 1 from public.businesses where id=p_business_id and owner_user_id=auth.uid() for update;
  if not found then raise exception 'owner_required' using errcode='42501';end if;
  session_id:=private.r11_auth_session();
  perform 1 from auth.sessions where id=session_id and user_id=auth.uid() for share;
  if not private.r11_session(auth.uid(),session_id) then raise exception 'r11_session_required';end if;
  select * into a from private.r11_etsy_read_attempts where id=(p_payload->>'operationId')::uuid and business_id=p_business_id and owner_id=auth.uid() for update;
  if a.id is null then raise exception 'r11_read_attempt_unavailable';end if;
  if not private.r11_session(auth.uid(),session_id) then raise exception 'r11_session_required';end if;
  if a.status in ('reserved','refresh_marked','rotated','read_marked') and a.expires_at<=clock_timestamp() then
   update private.r11_etsy_read_attempts set status='failed',completed_at=clock_timestamp() where id=a.id returning * into a;
  end if;
  return jsonb_build_object('shouldDispatch',false,'status',a.status,'proof',a.proof,'expiresAt',a.expires_at);
 end if;
 if p_operation not in ('begin','mark_refresh','mark_read') or not(p_payload ? 'executionRelease') then
  return private.r11_etsy_read_owner_before_execution_receipt(p_business_id,p_operation,p_payload,p_server_key);
 end if;
 perform private.r04_keys(execution,array['version','repository','environment','commitSha','deploymentId']);
 if octet_length(execution::text)>1000 or execution->>'version' is distinct from 'r11.execution-release.1'
 or execution->>'repository' is distinct from 'SSB100/agent-labs' or execution->>'environment' is distinct from 'production'
 or coalesce(execution->>'commitSha','')!~'^[a-f0-9]{40}$' or coalesce(execution->>'deploymentId','')!~'^dpl_[A-Za-z0-9_-]{1,124}$'
 then raise exception 'r11_execution_release_required';end if;
 outcome:=private.r11_etsy_read_owner_before_execution_receipt(p_business_id,p_operation,p_payload-'executionRelease',p_server_key);
 if outcome->>'shouldDispatch' is distinct from 'true' then return outcome;end if;
 select * into strict a from private.r11_etsy_read_attempts where id=(p_payload->>'operationId')::uuid and business_id=p_business_id and owner_id=auth.uid();
 insert into private.r11_etsy_execution_receipts(operation_id,stage,execution_release,business_id,connection_id,connection_revision,window_id)
 values(a.id,p_operation,execution,a.business_id,a.connection_id,a.connection_revision,a.window_id);
 return outcome;
end $$;
revoke all on function public.r11_etsy_read_owner(uuid,text,jsonb,text) from public,anon,service_role;
grant execute on function public.r11_etsy_read_owner(uuid,text,jsonb,text) to authenticated;
revoke all on function private.r11_execution_receipt_immutable() from public,anon,authenticated,service_role;
-- Add owner-safe diagnostics to the existing read-only workspace. The current
-- session equality is already enforced by dispatch; this makes it visible.
alter function public.r11_etsy_read_workspace(uuid) rename to r11_etsy_read_workspace_before_lifecycle;
alter function public.r11_etsy_read_workspace_before_lifecycle(uuid) set schema private;
revoke all on function private.r11_etsy_read_workspace_before_lifecycle(uuid) from public,anon,authenticated,service_role;
create function public.r11_etsy_read_workspace(p_business_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;windows jsonb;attempts jsonb;begin
 result:=private.r11_etsy_read_workspace_before_lifecycle(p_business_id);
 select coalesce(jsonb_agg(j.item||jsonb_build_object(
  'currentSessionMatches',w.auth_session_id=private.r11_auth_session(),
  'refreshNotBefore',(select max(a.refresh_marked_at)+make_interval(secs=>w.min_refresh_seconds) from private.r11_etsy_read_attempts a where a.connection_id=w.connection_id)) order by j.ordinality),'[]'::jsonb)
 into windows from jsonb_array_elements(result->'readWindows') with ordinality j(item,ordinality)
 join private.r11_etsy_read_windows w on w.id=(j.item->>'id')::uuid and w.business_id=p_business_id and w.owner_id=auth.uid();
 select coalesce(jsonb_agg(j.item||jsonb_build_object(
  'expiresAt',a.expires_at,'readDispatched',a.read_marked_at is not null,
  'canReconcile',a.status in ('reserved','refresh_marked','rotated','read_marked') and a.expires_at<=clock_timestamp(),
  'executionReceipts',coalesce((select jsonb_agg(jsonb_build_object('stage',r.stage,'release',r.execution_release,'recordedAt',r.recorded_at) order by r.recorded_at,r.stage) from private.r11_etsy_execution_receipts r where r.operation_id=a.id),'[]'::jsonb)) order by j.ordinality),'[]'::jsonb)
 into attempts from jsonb_array_elements(result->'readAttempts') with ordinality j(item,ordinality)
 join private.r11_etsy_read_attempts a on a.id=(j.item->>'id')::uuid and a.business_id=p_business_id and a.owner_id=auth.uid();
 return result||jsonb_build_object('readWindows',windows,'readAttempts',attempts);
end $$;
revoke all on function public.r11_etsy_read_workspace(uuid) from public,anon,service_role;
grant execute on function public.r11_etsy_read_workspace(uuid) to authenticated;
commit;
