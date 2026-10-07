-- Definition-only bounded traversal optimization. No authority, cache or grants.
-- Every key and scalar still uses the unchanged released r04 credential rules.
begin;
do $guard$
declare p record;expected text;begin
 for p in select oid,proname,prosrc,prorettype,prolang,provolatile,proparallel,proisstrict,prosecdef,proleakproof,proconfig,proowner,proacl
 from pg_proc where oid in('private.r04_safe(jsonb)'::regprocedure,'private.r12_pilot_safe(jsonb)'::regprocedure) loop
 expected:=case p.proname when 'r04_safe' then '56b69803bb4e1df99bf7402343d2fc2e05dfb6750642a73d33000f7b098b08f1' else 'f9584ae06cf0ca889297120bc9754ecaa8ae9edbc33adeedb97a4bf43056c2a8' end;
 if encode(extensions.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')<>expected
 or p.prorettype<>'void'::regtype or p.prolang<>(select oid from pg_language where lanname='plpgsql')
 or p.provolatile<>'v' or p.proparallel<>'u' or p.proisstrict or p.prosecdef or p.proleakproof
 or p.proconfig is distinct from array['search_path=""']::text[]
 or p.proacl is null or exists(select 1 from aclexplode(p.proacl) acl where acl.grantee<>p.proowner)
 or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE')
 or has_function_privilege('service_role',p.oid,'EXECUTE')
 then raise exception 'r12_pilot_scanner_definition_drift';end if;
 end loop;
end $guard$;

-- A JSON null takes four bytes; the shortest scalar takes one. For an object
-- already under 19,997 serialized bytes, each original {key:null} check is
-- therefore under the unchanged 20,000-byte r04 bound. The three-byte reserve
-- matters for nearly 20KB keys paired with zero/true/empty-string values.
-- Larger containers retain the released key-wrapper and recursive traversal.
-- Both branches retain the 65,536-byte pilot root bound; r04 remains unchanged.
create or replace function private.r12_pilot_safe(v jsonb) returns void language plpgsql set search_path='' as $$
declare k text;child jsonb;bytes integer;begin
 if v is null then raise exception 'r12_pilot_payload_bound';end if;
 bytes:=octet_length(v::text);
 if bytes>65536 then raise exception 'r12_pilot_payload_bound';end if;
 -- A null-valued key wrapper is at most three bytes longer than the same
 -- key paired with a one-byte scalar. Reserve those bytes before delegation.
 if bytes<=19997 then perform private.r04_safe(v);return;end if;
 if jsonb_typeof(v)='object' then
 for k,child in select key,value from jsonb_each(v) loop
 perform private.r04_safe(jsonb_build_object(k,null));perform private.r12_pilot_safe(child);end loop;
 elsif jsonb_typeof(v)='array' then
 for child in select value from jsonb_array_elements(v) loop perform private.r12_pilot_safe(child);end loop;
 else perform private.r04_safe(v);end if;
end $$;

commit;
