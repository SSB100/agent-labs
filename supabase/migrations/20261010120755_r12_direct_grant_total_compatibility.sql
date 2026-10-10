-- Restore the established owner-initial explicit cumulative grant selection.
-- All four lanes still consume the same locked, cumulative root ledger. No
-- enrollment, limit amendment, refund, or application privilege is installed.
begin;
create or replace function private.r12_direct_grant_total_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare rt private.r12_owner_grant_roots;rv private.r12_owner_grant_root_revisions;gr private.r12_owner_bootstrap_grants;grant_uuid uuid;usage jsonb;max_scopes integer;max_amount bigint;begin
 select * into strict rt from private.r12_owner_grant_roots where id=new.grant_root_id for update;
 if tg_table_name in ('r12_owner_activations','r12_owner_episode_activations') then select grant_id into grant_uuid from private.r12_owner_setups where id=new.setup_id;else grant_uuid:=new.grant_id;end if;
 select * into strict gr from private.r12_owner_bootstrap_grants where id=grant_uuid and root_id=rt.id;
 select * into rv from private.r12_owner_grant_root_revisions where root_id=rt.id and revision=gr.root_revision and content_hash=gr.root_revision_hash;
 if tg_relid='private.r12_owner_activations'::regclass then
  -- 09000728 permits an explicitly reviewed higher cumulative initial grant
  -- without rewriting the immutable root. 09185440 reserves revision grants
  -- for episode continuation; that restriction remains in force here too.
  if gr.root_revision is not null then raise exception 'r12_owner_extension_episode_only';end if;
  max_scopes:=coalesce(gr.maximum_scopes,rt.maximum_scopes);
  max_amount:=coalesce(gr.maximum_allocation_microunits,rt.maximum_allocation_microunits);
 else
  -- Episode, adaptive and direct grants retain their stricter intersection.
  max_scopes:=least(coalesce(rv.maximum_scopes,rt.maximum_scopes),coalesce(gr.maximum_scopes,2147483647));max_amount:=least(coalesce(rv.maximum_allocation_microunits,rt.maximum_allocation_microunits),coalesce(gr.maximum_allocation_microunits,9007199254740991));
 end if;
 usage:=private.r12_direct_grant_usage(rt.id);
 if (usage->>'scopes')::integer>max_scopes or (usage->>'allocationMicrounits')::bigint>max_amount then raise exception 'r12_direct_cumulative_grant_exhausted';end if;return new;
end $$;
commit;
