-- Append-only, cumulative extension of an existing owner grant root. No grant,
-- approval, quota, provider request or production data is enrolled here.
begin;

create table private.r12_owner_grant_root_revisions (
 root_id uuid not null references private.r12_owner_grant_roots(id),
 revision integer not null check(revision between 1 and 32),
 previous_hash text not null check(previous_hash ~ '^[a-f0-9]{64}$'),
 previous_maximum_scopes integer not null check(previous_maximum_scopes>0),
 previous_maximum_allocation_microunits bigint not null check(previous_maximum_allocation_microunits between 1 and 9007199254740991),
 maximum_scopes integer not null check(maximum_scopes between 2 and 32),
 maximum_allocation_microunits bigint not null check(maximum_allocation_microunits between 2 and 9007199254740991),
 approval_hash text not null check(approval_hash ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz not null check(isfinite(expires_at)),
 content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(),
 primary key(root_id,revision),unique(root_id,revision,content_hash),
 check(maximum_scopes>previous_maximum_scopes and maximum_allocation_microunits>previous_maximum_allocation_microunits)
);
alter table private.r12_owner_grant_root_revisions enable row level security;
revoke all on private.r12_owner_grant_root_revisions from public,anon,authenticated,service_role;
create trigger owner_immutable before insert or update or delete on private.r12_owner_grant_root_revisions for each row execute function private.r12_owner_immutable();

create function private.r12_owner_grant_root_genesis(r private.r12_owner_grant_roots) returns text language sql immutable set search_path='' as $$
 select private.stage14_hash(jsonb_build_object('version','r12.owner-grant-root.1','rootId',r.id,'businessId',r.business_id,'bindingId',r.binding_id,'maximumScopes',r.maximum_scopes,'maximumAllocationMicrounits',r.maximum_allocation_microunits::text,'approvalHash',r.approval_hash))
$$;
create function private.r12_owner_grant_root_revision_content(x private.r12_owner_grant_root_revisions) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('version','r12.owner-grant-root-revision.1','rootId',x.root_id,'revision',x.revision,'previousHash',x.previous_hash,'previousMaximumScopes',x.previous_maximum_scopes,'previousMaximumAllocationMicrounits',x.previous_maximum_allocation_microunits::text,'maximumScopes',x.maximum_scopes,'maximumAllocationMicrounits',x.maximum_allocation_microunits::text,'approvalHash',x.approval_hash,'expiresAt',x.expires_at)
$$;
create function private.r12_owner_grant_root_revision_guard() returns trigger language plpgsql set search_path='' as $$
declare r private.r12_owner_grant_roots;last_revision private.r12_owner_grant_root_revisions;begin
 if tg_op<>'INSERT' or current_user in ('anon','authenticated','service_role') then raise exception 'r12_owner_trusted_immutable_record_required' using errcode='42501';end if;
 select * into r from private.r12_owner_grant_roots where id=new.root_id for update;
 if r.id is null then raise exception 'r12_owner_grant_root_required';end if;
 select * into last_revision from private.r12_owner_grant_root_revisions where root_id=r.id order by revision desc limit 1;
 if last_revision.root_id is null then
  if new.revision<>1 or new.previous_hash is distinct from private.r12_owner_grant_root_genesis(r)
  or new.previous_maximum_scopes<>r.maximum_scopes or new.previous_maximum_allocation_microunits<>r.maximum_allocation_microunits then raise exception 'r12_owner_grant_root_chain_invalid';end if;
 else
  if new.revision<>last_revision.revision+1 or new.previous_hash is distinct from last_revision.content_hash
  or new.previous_maximum_scopes<>last_revision.maximum_scopes or new.previous_maximum_allocation_microunits<>last_revision.maximum_allocation_microunits
  or new.expires_at<last_revision.expires_at then raise exception 'r12_owner_grant_root_chain_invalid';end if;
 end if;
 if new.expires_at<=clock_timestamp()+interval '35 minutes' or new.content_hash is distinct from private.stage14_hash(private.r12_owner_grant_root_revision_content(new)) then raise exception 'r12_owner_grant_root_revision_invalid';end if;
 return new;
end $$;

create trigger grant_root_revision_guard before insert or update or delete on private.r12_owner_grant_root_revisions for each row execute function private.r12_owner_grant_root_revision_guard();

alter table private.r12_owner_bootstrap_grants add column root_revision integer,add column root_revision_hash text;
alter table private.r12_owner_bootstrap_grants add constraint r12_owner_grant_revision_pair check((root_revision is null)=(root_revision_hash is null));
alter table private.r12_owner_bootstrap_grants add constraint r12_owner_grant_revision_hash_format check(root_revision_hash is null or root_revision_hash ~ '^[a-f0-9]{64}$');
alter table private.r12_owner_bootstrap_grants add constraint r12_owner_grant_revision_fk foreign key(root_id,root_revision,root_revision_hash) references private.r12_owner_grant_root_revisions(root_id,revision,content_hash);
create function private.r12_owner_extension_grant_guard() returns trigger language plpgsql set search_path='' as $$
declare r private.r12_owner_grant_roots;rv private.r12_owner_grant_root_revisions;begin
 if tg_op<>'INSERT' then raise exception 'r12_owner_trusted_immutable_record_required' using errcode='42501';end if;
 if new.root_revision is null then return new;end if;
 select * into r from private.r12_owner_grant_roots where id=new.root_id for update;
 select * into rv from private.r12_owner_grant_root_revisions where root_id=new.root_id order by revision desc limit 1;
 if r.id is null or r.business_id<>new.business_id or rv.root_id is null or rv.revision<>new.root_revision or rv.content_hash is distinct from new.root_revision_hash
 or rv.expires_at<new.valid_until or new.continuation_bounds is null
 or (new.continuation_bounds->>'expiresAt')::timestamptz>rv.expires_at
 or (new.maximum_scopes is not null and new.maximum_scopes>rv.maximum_scopes)
 or (new.maximum_allocation_microunits is not null and new.maximum_allocation_microunits>rv.maximum_allocation_microunits)
 then raise exception 'r12_owner_extension_grant_binding_invalid';end if;
 return new;
end $$;
create trigger extension_grant_guard before insert or update or delete on private.r12_owner_bootstrap_grants for each row execute function private.r12_owner_extension_grant_guard();

create function private.r12_owner_grant_revision_current(g private.r12_owner_bootstrap_grants,r private.r12_owner_grant_roots,at_time timestamptz) returns jsonb language plpgsql stable set search_path='' as $$
declare rv private.r12_owner_grant_root_revisions;begin
 if g.root_revision is null then return null;end if;
 select * into rv from private.r12_owner_grant_root_revisions where root_id=r.id order by revision desc limit 1;
 if rv.root_id is null or rv.revision<>g.root_revision or rv.content_hash is distinct from g.root_revision_hash or rv.expires_at<=at_time+interval '35 minutes' then raise exception 'r12_owner_extension_grant_stale';end if;
 return jsonb_build_object('rootId',r.id,'revision',rv.revision,'hash',rv.content_hash,'maximumScopes',rv.maximum_scopes,'maximumAllocationMicrounits',rv.maximum_allocation_microunits::text,'expiresAt',rv.expires_at);
end $$;

-- Exact function-body patching is guarded: a changed predecessor migration
-- fails deployment rather than silently dropping a grant check.
DO $extension_patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_owner_research_server(uuid,text,jsonb,text)'::regprocedure);
 if position($old$ if p_operation='stop' then$old$ in d)=0 then raise exception 'r12_extension_initial_patch_missing';end if;
 d:=replace(d,$old$ if p_operation='stop' then$old$,$new$ if gr.root_revision is not null and p_operation in ('prepare','confirm') then raise exception 'r12_owner_extension_episode_only';end if;
 if p_operation='stop' then$new$);
 execute d;
end $extension_patch$;

DO $extension_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_owner_episode_server(uuid,text,jsonb,text)'::regprocedure);
 if position('closure jsonb;episode_number integer;' in d)=0 or position($old$ select * into rt from private.r12_owner_grant_roots where id=gr.root_id and business_id=p_business_id for update;$old$ in d)=0
 or position($old$least(rt.maximum_scopes,coalesce(gr.maximum_scopes,rt.maximum_scopes))$old$ in d)=0
 or position($old$least(rt.maximum_allocation_microunits,coalesce(gr.maximum_allocation_microunits,rt.maximum_allocation_microunits))$old$ in d)=0
 or position($old$'authorityCreated',false);$old$ in d)=0
 or position($old$ if setup.preview->>'goalHash' is distinct from goal.content_hash$old$ in d)=0
 or position($old$cutoff:=least((gr.continuation_bounds->>'expiresAt')::timestamptz,$old$ in d)=0 then raise exception 'r12_extension_episode_patch_missing';end if;
 d:=replace(d,'closure jsonb;episode_number integer;','closure jsonb;grant_revision jsonb;episode_number integer;');
 d:=replace(d,$old$ select * into rt from private.r12_owner_grant_roots where id=gr.root_id and business_id=p_business_id for update;$old$,$new$ select * into rt from private.r12_owner_grant_roots where id=gr.root_id and business_id=p_business_id for update;
 grant_revision:=private.r12_owner_grant_revision_current(gr,rt,stamp);$new$);
 d:=replace(d,$old$least(rt.maximum_scopes,coalesce(gr.maximum_scopes,rt.maximum_scopes))$old$,$new$least(coalesce((grant_revision->>'maximumScopes')::integer,rt.maximum_scopes),coalesce(gr.maximum_scopes,coalesce((grant_revision->>'maximumScopes')::integer,rt.maximum_scopes)))$new$);
 d:=replace(d,$old$least(rt.maximum_allocation_microunits,coalesce(gr.maximum_allocation_microunits,rt.maximum_allocation_microunits))$old$,$new$least(coalesce((grant_revision->>'maximumAllocationMicrounits')::bigint,rt.maximum_allocation_microunits),coalesce(gr.maximum_allocation_microunits,coalesce((grant_revision->>'maximumAllocationMicrounits')::bigint,rt.maximum_allocation_microunits)))$new$);
 d:=replace(d,$old$'authorityCreated',false);$old$,$new$'authorityCreated',false,'grantRootRevision',grant_revision);$new$);
 d:=replace(d,$old$ if setup.preview->>'goalHash' is distinct from goal.content_hash$old$,$new$ if coalesce(setup.preview->'grantRootRevision','null'::jsonb) is distinct from coalesce(grant_revision,'null'::jsonb) then raise exception 'r12_owner_extension_stale_review';end if;
 if setup.preview->>'goalHash' is distinct from goal.content_hash$new$);
 -- The revision's finite expiry participates in the execution window.
 d:=replace(d,$old$cutoff:=least((gr.continuation_bounds->>'expiresAt')::timestamptz,$old$,$new$cutoff:=least(coalesce((grant_revision->>'expiresAt')::timestamptz,'infinity'::timestamptz),(gr.continuation_bounds->>'expiresAt')::timestamptz,$new$);
 execute d;
end $extension_patch$;

DO $extension_patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_owner_research_read(uuid,uuid,uuid)'::regprocedure);
 if position($old$ join private.r12_owner_grant_roots rt on rt.id=gr.root_id and rt.business_id=gr.business_id and rt.binding_id=binding.id$old$ in d)=0
 or position($old$ and (not episode_goal or ($old$ in d)=0
 or position($old$coalesce(gr.maximum_scopes,rt.maximum_scopes)$old$ in d)=0
 or position($old$coalesce(gr.maximum_allocation_microunits,rt.maximum_allocation_microunits)$old$ in d)=0
 or position($old$<rt.maximum_scopes$old$ in d)=0
 or position($old$<rt.maximum_allocation_microunits$old$ in d)=0 then raise exception 'r12_extension_catalog_patch_missing';end if;
 d:=replace(d,$old$ join private.r12_owner_grant_roots rt on rt.id=gr.root_id and rt.business_id=gr.business_id and rt.binding_id=binding.id$old$,$new$ join private.r12_owner_grant_roots rt on rt.id=gr.root_id and rt.business_id=gr.business_id and rt.binding_id=binding.id
 left join private.r12_owner_grant_root_revisions rv on rv.root_id=gr.root_id and rv.revision=gr.root_revision and rv.content_hash=gr.root_revision_hash$new$);
 d:=replace(d,$old$ and (not episode_goal or ($old$,$new$ and (gr.root_revision is null or (rv.root_id is not null and rv.expires_at>clock_timestamp()+interval '35 minutes' and not exists(select 1 from private.r12_owner_grant_root_revisions newer where newer.root_id=rv.root_id and newer.revision>rv.revision)))
 and (episode_goal or gr.root_revision is null)
 and (not episode_goal or ($new$);
 d:=replace(d,$old$coalesce(gr.maximum_scopes,rt.maximum_scopes)$old$,$new$coalesce(gr.maximum_scopes,rv.maximum_scopes,rt.maximum_scopes)$new$);
 d:=replace(d,$old$coalesce(gr.maximum_allocation_microunits,rt.maximum_allocation_microunits)$old$,$new$coalesce(gr.maximum_allocation_microunits,rv.maximum_allocation_microunits,rt.maximum_allocation_microunits)$new$);
 d:=replace(d,$old$<rt.maximum_scopes$old$,$new$<coalesce(rv.maximum_scopes,rt.maximum_scopes)$new$);
 d:=replace(d,$old$<rt.maximum_allocation_microunits$old$,$new$<coalesce(rv.maximum_allocation_microunits,rt.maximum_allocation_microunits)$new$);
 -- Initial catalog predicates also respect the old grant's immutable ceiling.
 execute d;
end $extension_patch$;

revoke all on function private.r12_owner_grant_root_genesis(private.r12_owner_grant_roots),private.r12_owner_grant_root_revision_content(private.r12_owner_grant_root_revisions),private.r12_owner_grant_root_revision_guard(),private.r12_owner_extension_grant_guard(),private.r12_owner_grant_revision_current(private.r12_owner_bootstrap_grants,private.r12_owner_grant_roots,timestamptz) from public,anon,authenticated,service_role;
commit;
