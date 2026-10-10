-- Preserve the established legacy function identity and all previously admitted
-- plan formats after the additive direct controller. No authority is enrolled.
begin;

do $compatibility$
declare legacy_definition text;
begin
 if (select proargnames from pg_proc where oid='private.stage13v2_budget_authority_before_direct(uuid,boolean)'::regprocedure)
    is distinct from array['p_root_id','p_lock_authority']::text[] or
    (select pg_get_function_arguments(oid) from pg_proc where oid='private.stage13v2_budget_authority_before_direct(uuid,boolean)'::regprocedure)
    is distinct from 'p_root_id uuid, p_lock_authority boolean DEFAULT false' or
    (select proargnames from pg_proc where oid='private.stage13v2_budget_authority(uuid,boolean)'::regprocedure)
    is distinct from array['root_id','lock_root']::text[] then
  raise exception 'r12_direct_legacy_budget_signature_changed';
 end if;
 legacy_definition:=pg_get_functiondef('private.stage13v2_budget_authority_before_direct(uuid,boolean)'::regprocedure);
 -- Restore the original OID as well as its named-argument interface. The direct
 -- exposure implementation remains unchanged behind a private revoked helper.
 alter function private.stage13v2_budget_authority(uuid,boolean) rename to r12_direct_budget_authority_with_exposure;
 alter function private.stage13v2_budget_authority_before_direct(uuid,boolean) rename to stage13v2_budget_authority;
 execute legacy_definition;
end $compatibility$;

create or replace function private.stage13v2_budget_authority(p_root_id uuid,p_lock_authority boolean default false)
returns jsonb language plpgsql set search_path='' as $$
begin
 return private.r12_direct_budget_authority_with_exposure(p_root_id,p_lock_authority);
end $$;
revoke all on function private.stage13v2_budget_authority(uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function private.stage13v2_budget_authority_before_direct(uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function private.r12_direct_budget_authority_with_exposure(uuid,boolean) from public,anon,authenticated,service_role;

-- Existing sessions may have compiled calls to the old delegate OID. Reissue
-- each exact unchanged caller definition after restoring names, so cached plans
-- resolve the new legacy delegate rather than entering the exposure wrapper.
do $replan$ declare f record;begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('private','public') and p.prokind='f'
   and position('stage13v2_budget_authority_before_direct' in p.prosrc)>0
 loop execute pg_get_functiondef(f.oid);end loop;
end $replan$;

-- 083000 already admitted adaptive.2 for versions 5..9. 20600 added direct.1
-- but accidentally omitted that existing branch. Preserve every original range.
alter table private.r07_plans drop constraint r07_plans_version_check;
alter table private.r07_plans add constraint r07_plans_version_check check(version between 1 and 4 or
 (version between 5 and 9 and content->>'format' in ('r12.discovery-episode.1','r12.discovery-adaptive.1','r12.discovery-adaptive.2')) or
 (version between 2 and 10 and content->>'format'='r12.discovery-direct.1'));
commit;
