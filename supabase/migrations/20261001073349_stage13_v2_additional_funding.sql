-- Owner-approved increases append to the same goal; old intents and costs stay immutable.
-- Funding alone never launches a workflow or grants creative/commerce authority.
create table public.product_research_funding_approvals (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete restrict,
  authority_root_id uuid not null references public.product_experiments(id) on delete restrict,
  latest_root_id uuid not null references public.product_experiments(id) on delete restrict,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  previous_maximum_microusd integer not null check(previous_maximum_microusd between 1 and 2000000),
  maximum_microusd integer not null check(maximum_microusd between 1 and 2000000 and maximum_microusd>previous_maximum_microusd),
  reason text not null check(length(btrim(reason)) between 20 and 600),
  approved_at timestamptz not null default now(),
  unique(authority_root_id,maximum_microusd)
);
create index product_research_funding_business_root_idx on public.product_research_funding_approvals(business_id,authority_root_id);
alter table public.product_research_funding_approvals enable row level security;
revoke all on public.product_research_funding_approvals from public,anon,authenticated,service_role;
grant select on public.product_research_funding_approvals to authenticated;
create policy product_research_funding_owner_select on public.product_research_funding_approvals for select to authenticated using(private.is_business_owner(business_id));
create function private.stage13v2_funding_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op<>'INSERT' or current_user in ('anon','authenticated','service_role') then
    raise exception 'Research funding approvals are append-only through the owner RPC.' using errcode='42501';
  end if;
  return new;
end; $$;
revoke all on function private.stage13v2_funding_guard() from public,anon,authenticated,service_role;
create trigger product_research_funding_guard before insert or update or delete on public.product_research_funding_approvals for each row execute function private.stage13v2_funding_guard();

create function private.stage13v2_funded_ceiling(p_authority_id uuid) returns bigint language sql stable set search_path='' as $$
  select greatest((e.variables->'intent'->'limits'->>'maximumMicrousd')::bigint,coalesce(max(a.maximum_microusd),0))
  from public.product_experiments e left join public.product_research_funding_approvals a on a.authority_root_id=e.id and a.business_id=e.business_id
  where e.id=p_authority_id and e.discovery_version='pod-discovery-2.0' and e.parent_discovery_id is null and e.candidate_id is null
  group by e.id;
$$;
revoke all on function private.stage13v2_funded_ceiling(uuid) from public,anon,authenticated,service_role;

-- Guard each exact edit against drift. CREATE OR REPLACE preserves existing owners,
-- ACLs, signatures, definer settings and search paths. No v1 branch is changed.
do $migration$
declare patch record; definition text;
begin
  for patch in select * from (values
    ('private.stage13v2_budget_authority(uuid,boolean)',
     $old$root.variables->'intent'->'limits'->'maximumMicrousd' is distinct from authority.variables->'intent'->'limits'->'maximumMicrousd' or$old$,
     $new$(root.variables->'intent'->'limits'->'maximumMicrousd' is distinct from authority.variables->'intent'->'limits'->'maximumMicrousd' and not exists(select 1 from public.product_research_funding_approvals a where a.authority_root_id=authority.id and a.business_id=root.business_id and to_jsonb(a.maximum_microusd)=root.variables->'intent'->'limits'->'maximumMicrousd' and a.approved_at<=root.created_at)) or$new$),
    ('private.stage13v2_budget_authority(uuid,boolean)',
     $old$'maximumMicrousd',authority.variables->'intent'->'limits'->'maximumMicrousd'$old$,
     $new$'maximumMicrousd',private.stage13v2_funded_ceiling(authority.id)$new$),
    ('private.stage13v2_budget_authority(uuid,boolean)',
     $old$(authority.variables->'intent'->'limits'->>'maximumMicrousd')::bigint-known-pending$old$,
     $new$private.stage13v2_funded_ceiling(authority.id)-known-pending$new$),
    ('private.stage13_registry_guard()',
     $old$parent.variables->'intent'->'limits'->'maximumMicrousd' is distinct from new.variables->'intent'->'limits'->'maximumMicrousd' or$old$,
     $new$(parent.variables->'intent'->'limits'->'maximumMicrousd' is distinct from new.variables->'intent'->'limits'->'maximumMicrousd' and not exists(select 1 from public.product_research_funding_approvals a where a.authority_root_id=(parent.variables->>'budgetAuthorityRootId')::uuid and a.business_id=new.business_id and to_jsonb(a.maximum_microusd)=new.variables->'intent'->'limits'->'maximumMicrousd' and a.approved_at<=new.created_at)) or$new$),
    ('private.stage13v2_validate_persisted(uuid,boolean)',
     $old$(limits->>'maximumMicrousd')::numeric not between 1 and 1000000$old$,
     $new$(limits->>'maximumMicrousd')::numeric not between 1 and 2000000$new$),
    ('private.stage13v2_validate_persisted(uuid,boolean)',
     $old$(chain_scope->>'maximumMicrousd')::bigint<>maximum$old$,
     $new$(chain_scope->>'maximumMicrousd')::bigint<maximum$new$),
    ('private.stage13v2_validate_persisted(uuid,boolean)',
     $old$or has_uncertain or committed>maximum$old$,
     $new$or has_uncertain or committed>(chain_scope->>'maximumMicrousd')::bigint$new$),
    ('public.reserve_product_research_cost(uuid,uuid,text,text,integer,text,jsonb)',
     $old$if v_total+amount>(scope->>'maximumMicrousd')::bigint$old$,
     $new$if v_total+amount>(chain_scope->>'maximumMicrousd')::bigint$new$)
  ) as edits(signature,old_text,new_text) loop
    definition:=pg_get_functiondef(patch.signature::regprocedure);
    if (length(definition)-length(replace(definition,patch.old_text,'')))/length(patch.old_text)<>1 then
      raise exception 'Funding migration refused unexpected function drift: %',patch.signature;
    end if;
    execute replace(definition,patch.old_text,patch.new_text);
  end loop;
end; $migration$;

create function public.approve_product_research_funding(p_root_id uuid,p_approval_id uuid,p_expected_maximum_microusd integer,p_maximum_microusd integer,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare root public.product_experiments%rowtype; approval public.product_research_funding_approvals%rowtype; scope jsonb;
begin
  select * into root from public.product_experiments where id=p_root_id and discovery_version='pod-discovery-2.0' and parent_discovery_id is null and candidate_id is null;
  if auth.uid() is null or root.id is null or not private.is_business_owner(root.business_id) then raise exception 'Business ownership required.' using errcode='42501'; end if;
  if p_approval_id is null or p_maximum_microusd is null or p_maximum_microusd not between 1 and 2000000 or p_reason is null or length(btrim(p_reason)) not between 20 and 600 then
    raise exception 'An explicit bounded USD funding approval is required.';
  end if;
  perform 1 from public.businesses where id=root.business_id for update;
  scope:=private.stage13v2_budget_authority(root.id,true);
  select * into approval from public.product_research_funding_approvals where id=p_approval_id;
  if found then
    if approval.business_id<>root.business_id or approval.latest_root_id<>root.id or approval.owner_user_id<>auth.uid() or approval.previous_maximum_microusd is distinct from p_expected_maximum_microusd or approval.maximum_microusd<>p_maximum_microusd or approval.reason<>btrim(p_reason) then raise exception 'Funding replay differs from its immutable approval.'; end if;
    return jsonb_build_object('approvalId',approval.id,'maximumMicrousd',approval.maximum_microusd,'cached',true,'researchStarted',false);
  end if;
  if root.status not in ('completed','failed') or exists(select 1 from public.product_experiments successor where successor.business_id=root.business_id and successor.discovery_version='pod-discovery-2.0' and successor.parent_discovery_id is null and successor.variables->'ownerKickoff'->'followUpBasis'->>'rootId'=root.id::text) then raise exception 'Funding requires the latest terminal round of this preserved goal.'; end if;
  if scope->'hasUncertainCosts'='true'::jsonb then raise exception 'Reconcile unknown charges before increasing research authority.'; end if;
  if p_expected_maximum_microusd is distinct from (scope->>'maximumMicrousd')::integer or p_maximum_microusd<=p_expected_maximum_microusd then raise exception 'The approval must increase the current total ceiling, retaining all charges.'; end if;
  insert into public.product_research_funding_approvals(id,business_id,authority_root_id,latest_root_id,owner_user_id,previous_maximum_microusd,maximum_microusd,reason)
    values(p_approval_id,root.business_id,(scope->>'authorityRootId')::uuid,root.id,auth.uid(),p_expected_maximum_microusd,p_maximum_microusd,btrim(p_reason));
  return jsonb_build_object('approvalId',p_approval_id,'maximumMicrousd',p_maximum_microusd,'cached',false,'researchStarted',false);
end; $$;
revoke all on function public.approve_product_research_funding(uuid,uuid,integer,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.approve_product_research_funding(uuid,uuid,integer,integer,text) to authenticated;
