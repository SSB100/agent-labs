-- Preserve the exact qualified bounded-liability predicate and all authority.
-- PostgreSQL17 SQL-language functions repeatedly plan this large proof. Cache
-- its plan, never its result; each invocation still evaluates the same rows.
-- No timeout, grant, cap, cost, history, revocation or retention changes.
do $patch$
declare before_row record;after_row record;definition text;body text;wrapped text;
begin
 select p.*,l.lanname,pg_get_functiondef(p.oid) definition into before_row
 from pg_proc p join pg_language l on l.oid=p.prolang
 where p.oid='private.r12_pod_bounded_source(uuid,text,bigint)'::regprocedure;
 if before_row.lanname<>'sql' or md5(before_row.prosrc)<>'20ed7e9a838b13a6d824ad4e43f57952'
 or before_row.provolatile<>'s' or before_row.prosecdef or before_row.proisstrict
 or before_row.proleakproof or before_row.proparallel<>'u'
 or before_row.proconfig is distinct from array['search_path=""']::text[]
 then raise exception 'r12_pod_bounded_plan_precondition_changed';end if;
 body:=before_row.prosrc;
 wrapped:='BEGIN RETURN ('||btrim(body)||'); END';
 definition:=before_row.definition;
 if position('LANGUAGE sql' in definition)=0
 or position('SET search_path TO '||chr(39)||chr(39) in definition)=0
 or position('AS $function$'||body||'$function$' in definition)=0
 then raise exception 'r12_pod_bounded_plan_definition_shape_changed';end if;
 definition:=replace(definition,'LANGUAGE sql','LANGUAGE plpgsql');
 definition:=replace(definition,'SET search_path TO '||chr(39)||chr(39),
 'SET search_path TO '||chr(39)||chr(39)||E'\n SET plan_cache_mode TO '||quote_literal('force_generic_plan'));
 definition:=replace(definition,'AS $function$'||body||'$function$','AS $function$'||wrapped||'$function$');
 execute definition;
 select p.*,l.lanname into after_row from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=before_row.oid;
 if after_row.lanname<>'plpgsql' or after_row.prosrc<>wrapped
 or after_row.proconfig is distinct from array['search_path=""','plan_cache_mode=force_generic_plan']::text[]
 or (to_jsonb(after_row)-array['prolang','lanname','prosrc','proconfig'])
 is distinct from (to_jsonb(before_row)-array['prolang','lanname','prosrc','proconfig','definition'])
 then raise exception 'r12_pod_bounded_plan_identity_or_authority_changed';end if;
end $patch$;
