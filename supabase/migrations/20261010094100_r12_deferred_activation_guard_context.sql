begin;
-- A deferred constraint fires at transaction end, after the owner RPC's
-- SECURITY DEFINER frame has returned. Execute only this fixed row validator
-- as its existing owner; callers retain no access to private checks/tables.
do $guard_context$ begin
 if not exists(select 1 from pg_proc p join pg_class c on c.oid='private.r12_adaptive_activations'::regclass
  where p.oid='private.r12_adaptive_activation_guard()'::regprocedure and p.proowner=c.relowner
   and regexp_replace(lower(p.prosrc),'[[:space:]]','','g')='beginperformprivate.r12_adaptive_activation_check(new);returnnew;end')
 then raise exception 'r12_deferred_guard_source_or_owner_changed';end if;
end $guard_context$;
alter function private.r12_adaptive_activation_guard() security definer;
alter function private.r12_adaptive_activation_guard() set search_path='';
revoke all on function private.r12_adaptive_activation_guard(),
 private.r12_adaptive_activation_check(private.r12_adaptive_activations)
 from public,anon,authenticated,service_role;
commit;
