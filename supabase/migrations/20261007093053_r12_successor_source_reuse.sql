-- Definition-only optimization of repeated immutable predecessor reconstruction.
-- No new authority, enrollment, cache, time window, role or provider operation.
begin;

-- The released closure already reconstructs and validates the predecessor's
-- source at clock_timestamp(). Retain that exact check and carry its result to
-- the caller within this single STABLE invocation. Its canonical closure stays
-- byte-identical; the extra result is private, ephemeral and never persisted.
do $patch$
declare d text;old text;replacement text;begin
 d:=pg_get_functiondef('private.r12_pilot_successor_closure(uuid)'::regprocedure);
 old:='FUNCTION private.r12_pilot_successor_closure(';
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_source_reuse_closure_definition_drift';end if;
 d:=replace(d,old,'FUNCTION private.r12_pilot_successor_closure_context(');
 old:=' return jsonb_build_object(''version'',''r12.focused-pilot-closure.1'',';
 replacement:=' return jsonb_build_object(''source'',source,''closure'',jsonb_build_object(''version'',''r12.focused-pilot-closure.1'',';
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_source_reuse_closure_return_drift';end if;
 d:=replace(d,old,replacement);
 old:='''knownMicrousd'',total::text,''phases'',phases);';
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_source_reuse_closure_tail_drift';end if;
 d:=replace(d,old,'''knownMicrousd'',total::text,''phases'',phases));');
 execute d;
end $patch$;

-- Preserve all original lineage, hash, owner, funding and authorization checks.
-- Only the private return value includes the source already checked by closure.
do $patch$
declare d text;old text;replacement text;begin
 d:=pg_get_functiondef('private.r12_pilot_successor_validate(private.r12_discovery_scopes,jsonb)'::regprocedure);
 old:='FUNCTION private.r12_pilot_successor_validate(';
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_source_reuse_validate_definition_drift';end if;
 d:=replace(d,old,'FUNCTION private.r12_pilot_successor_validate_context(');
 old:='declare closed jsonb;';
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_source_reuse_validate_declaration_drift';end if;
 d:=replace(d,old,'declare context jsonb;closed jsonb;');
 old:=' closed:=private.r12_pilot_successor_closure((v->''predecessorClosure''->>''scopeId'')::uuid);';
 replacement:=' context:=private.r12_pilot_successor_closure_context((v->''predecessorClosure''->>''scopeId'')::uuid);closed:=context->''closure'';';
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_source_reuse_validate_closure_drift';end if;
 d:=replace(d,old,replacement);
 old:=' return closed;';
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_source_reuse_validate_return_drift';end if;
 d:=replace(d,old,' return context;');
 execute d;
end $patch$;

-- The original signatures, canonical results and existing ACLs are preserved.
create or replace function private.r12_pilot_successor_closure(p_scope_id uuid)
returns jsonb language plpgsql stable set search_path='' as $$
begin
 return private.r12_pilot_successor_closure_context(p_scope_id)->'closure';
end $$;

create or replace function private.r12_pilot_successor_validate(s private.r12_discovery_scopes,v jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
begin
 return private.r12_pilot_successor_validate_context(s,v)->'closure';
end $$;

-- STABLE calls read the same statement snapshot. Reconstructing the immutable
-- source twice inside this invocation adds no fresh database observation.
-- Time does change: closure's original wall-clock profile check stays intact,
-- and the second caller-effective-time profile check is explicitly retained.
-- Every outer scope/gate invocation, lock and post-write check remains intact.
create or replace function private.r12_pilot_successor_source(s private.r12_discovery_scopes,effective_at timestamptz,p_current boolean)
returns jsonb language plpgsql stable set search_path='' as $$
declare a private.r12_pilot_successor_authorizations;context jsonb;closed jsonb;old_scope private.r12_discovery_scopes;source jsonb;begin
 select * into strict a from private.r12_pilot_successor_authorizations where scope_id=s.id and business_id=s.business_id;
 if a.authorization_hash is distinct from private.stage14_hash(a.authorization_data) then raise exception 'r12_successor_authorization_mutated';end if;
 perform private.r12_pilot_profile_validate(s,effective_at,p_current);
 context:=private.r12_pilot_successor_validate_context(s,a.authorization_data);closed:=context->'closure';
 if a.predecessor_scope_id::text is distinct from closed->>'scopeId' or a.budget_authority_root_id<>s.budget_authority_root_id then raise exception 'r12_successor_row_binding';end if;
 select * into strict old_scope from private.r12_discovery_scopes where id=a.predecessor_scope_id;
 perform private.r12_pilot_profile_validate(old_scope,effective_at,false);
 source:=context->'source';
 if exists(select 1 from private.r04_research_links where business_id=s.business_id and goal_id=s.goal_id) then raise exception 'r12_pilot_no_research_relink';end if;
 return source||jsonb_build_object('closedPlanId',s.amendment->>'closedPlanId','closedPlanHash',s.amendment->>'closedPlanHash','successor',jsonb_build_object('authorization',a.authorization_data,'authorizationHash',a.authorization_hash));
end $$;

revoke all on function private.r12_pilot_successor_closure_context(uuid),
 private.r12_pilot_successor_validate_context(private.r12_discovery_scopes,jsonb)
from public,anon,authenticated,service_role;
commit;
