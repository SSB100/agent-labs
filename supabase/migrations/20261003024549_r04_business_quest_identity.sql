-- R04 intent persistence only. No dispatcher, grants, budgets or historical rows are rewritten.
begin;
create table private.r04_business_versions (
 business_id uuid not null references public.businesses(id) on delete restrict,
 revision integer not null check(revision>0), content jsonb not null, preference text not null check(preference in ('setup','paused','stopped')),
 content_hash text not null, actor_id uuid not null references auth.users(id) on delete restrict, created_at timestamptz not null default clock_timestamp(),
 primary key(business_id,revision)
);
create table private.r04_business_state (
 business_id uuid primary key references public.businesses(id) on delete restrict, revision integer not null,
 current_goal_id uuid, foreign key(business_id,revision) references private.r04_business_versions(business_id,revision),
 foreign key(current_goal_id,business_id) references public.goals(id,business_id)
);
create table private.r04_goal_versions (
 goal_id uuid not null, business_id uuid not null, revision integer not null check(revision>0), content jsonb not null,
 preference text not null check(preference in ('draft','ready','paused','stopped','completed')), content_hash text not null,
 actor_id uuid not null references auth.users(id) on delete restrict, created_at timestamptz not null default clock_timestamp(),
 primary key(goal_id,business_id,revision), foreign key(goal_id,business_id) references public.goals(id,business_id) on delete restrict
);
create table private.r04_goal_state (
 goal_id uuid primary key, business_id uuid not null, revision integer not null,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 unique(goal_id,business_id), foreign key(goal_id,business_id,revision) references private.r04_goal_versions(goal_id,business_id,revision)
);
create index r04_goal_business_created on private.r04_goal_state(business_id,created_at desc,goal_id desc);
create table private.r04_envelopes (
 id uuid primary key default gen_random_uuid(), business_id uuid not null, goal_id uuid not null, goal_revision integer not null, business_revision integer not null,
 envelope jsonb not null, content_hash text not null, actor_id uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp(), unique(id,business_id),
 foreign key(goal_id,business_id,goal_revision) references private.r04_goal_versions(goal_id,business_id,revision),
 foreign key(business_id,business_revision) references private.r04_business_versions(business_id,revision)
);
create index r04_envelopes_goal on private.r04_envelopes(business_id,goal_id,created_at desc,id desc);
create table private.r04_confirmations (
 id uuid primary key default gen_random_uuid(), proposal_id uuid not null unique, business_id uuid not null,
 proposal_hash text not null, actor_id uuid not null references auth.users(id) on delete restrict, created_at timestamptz not null default clock_timestamp(),
 foreign key(proposal_id,business_id) references private.r04_envelopes(id,business_id)
);
create table private.r04_revocations (
 proposal_id uuid primary key, business_id uuid not null, actor_id uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp(), foreign key(proposal_id,business_id) references private.r04_envelopes(id,business_id)
);
create table private.r04_research_links (
 experiment_id uuid primary key, business_id uuid not null, goal_id uuid not null, goal_revision integer not null,
 workflow_run_id uuid not null, authority_root_id uuid, evidence jsonb not null, evidence_hash text not null,
 actor_id uuid not null references auth.users(id) on delete restrict, created_at timestamptz not null default clock_timestamp(),
 foreign key(experiment_id,business_id) references public.product_experiments(id,business_id),
 foreign key(goal_id,business_id,goal_revision) references private.r04_goal_versions(goal_id,business_id,revision),
 foreign key(workflow_run_id,business_id) references public.workflow_runs(id,business_id),
 foreign key(authority_root_id,business_id) references public.product_experiments(id,business_id)
);
create table private.r04_submissions (
 business_id uuid not null references public.businesses(id) on delete restrict, submission_id uuid not null,
 request_hash text not null, result jsonb not null, actor_id uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp(), primary key(business_id,submission_id)
);

create function private.r04_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user in ('anon','authenticated','service_role') then raise exception 'r04_guarded_rpc_required' using errcode='42501'; end if;
 if tg_op<>'INSERT' and tg_table_name not in ('r04_business_state','r04_goal_state') then raise exception 'r04_immutable_history'; end if;
 if tg_op='DELETE' then raise exception 'r04_history_delete_forbidden'; end if;
 return new;
end $$;
do $$ declare t text; begin
 foreach t in array array['r04_business_versions','r04_business_state','r04_goal_versions','r04_goal_state','r04_envelopes','r04_confirmations','r04_revocations','r04_research_links','r04_submissions'] loop
 execute format('alter table private.%I enable row level security',t);
 execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger r04_guard before insert or update or delete on private.%I for each row execute function private.r04_guard()',t);
 end loop;
end $$;
create function private.r04_core_goal_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.r04_goal_state where goal_id=old.id) then raise exception 'r04_managed_goal_immutable'; end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger r04_managed_goal_guard before update or delete on public.goals for each row execute function private.r04_core_goal_guard();

create function private.r04_hash(v jsonb) returns text language sql immutable strict set search_path='' as $$
 select encode(extensions.digest(convert_to(v::text,'UTF8'),'sha256'),'hex')
$$;
create function private.r04_safe(v jsonb) returns void language plpgsql set search_path='' as $$
declare value_text text; child jsonb;
begin
 if v is null or octet_length(v::text)>20000 then raise exception 'r04_invalid_payload'; end if;
 if jsonb_typeof(v)='object' then
 for value_text,child in select key,value from jsonb_each(v) loop
 if value_text ~* '^(password|passwd|secret|secret[_ -]?key|client[_ -]?secret|token|api[_ -]?key|access[_ -]?token|refresh[_ -]?token)$' then raise exception 'r04_credential_content_rejected'; end if;
 perform private.r04_safe(child); end loop;
 elsif jsonb_typeof(v)='array' then for child in select value from jsonb_array_elements(v) loop perform private.r04_safe(child); end loop;
 elsif jsonb_typeof(v)='string' then
 value_text:=v#>>'{}';
 if value_text ~* '(-----BEGIN[^-]*(PRIVATE KEY)|(^|[^[:alnum:]_])(password|passwd|secret|secret[_ -]?key|client[_ -]?secret|token|api[_ -]?key|access[_ -]?token|refresh[_ -]?token)([[:space:]]*[:=]|[[:space:]]+(is[[:space:]]+)?[^[:space:]])|(Bearer|Basic)[[:space:]]+[A-Za-z0-9._+/=-]{8,}|sk-[A-Za-z0-9_-]{12,}|[rs]k_(live|test)_[A-Za-z0-9]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|gh[pousr]_[A-Za-z0-9]{16,}|(AKIA|ASIA)[A-Z0-9]{16}|github_pat_[A-Za-z0-9_]{20,}|[a-z][a-z0-9+.-]*://[^ /:@]+:[^ /@]+@|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})' then raise exception 'r04_credential_content_rejected'; end if;
 end if;
end $$;
create function private.r04_keys(v jsonb, keys text[]) returns void language plpgsql set search_path='' as $$
begin
 if jsonb_typeof(v) is distinct from 'object' or not(v ?& keys) or v-keys<>'{}'::jsonb then raise exception 'r04_invalid_fields'; end if;
end $$;
create function private.r04_strings(v jsonb, maximum integer) returns void language plpgsql set search_path='' as $$
begin
 if jsonb_typeof(v) is distinct from 'array' or jsonb_array_length(v)>maximum then raise exception 'r04_invalid_list'; end if;
 if exists(select 1 from jsonb_array_elements(v) x where jsonb_typeof(x)<>'string' or length(btrim(x#>>'{}')) not between 1 and 1000) then raise exception 'r04_invalid_list'; end if;
end $$;
create function private.r04_business_content(v jsonb) returns void language plpgsql set search_path='' as $$
declare k text;
begin
 perform private.r04_safe(v); perform private.r04_keys(v,array['brandContext','operatingRules','allowedActivity','restrictions']);
 foreach k in array array['brandContext','operatingRules','allowedActivity','restrictions'] loop
 if jsonb_typeof(v->k)<>'string' or length(v->>k)>4000 then raise exception 'r04_invalid_business_content'; end if;
 end loop;
end $$;
create function private.r04_parsed(v jsonb, ready boolean default false) returns void language plpgsql set search_path='' as $$
declare x jsonb; k text;
begin
 perform private.r04_keys(v,array['target','budget','deadline','geography','scope','stopConstraints']);
 perform private.r04_strings(v->'geography',30); perform private.r04_strings(v->'stopConstraints',30);
 if ready and (v->'target'='null'::jsonb or v->'budget'='null'::jsonb or v->'deadline'='null'::jsonb or jsonb_array_length(v->'geography')=0) then raise exception 'r04_consequential_facts_required'; end if;
 if v->'scope'<>'null'::jsonb and (jsonb_typeof(v->'scope')<>'string' or length(btrim(v->>'scope')) not between 1 and 4000) then raise exception 'r04_invalid_scope'; end if;
 if ready and (v->'scope'='null'::jsonb or jsonb_array_length(v->'stopConstraints')=0) then raise exception 'r04_scope_and_stop_required'; end if;
 foreach k in array array['target','budget'] loop
 x:=v->k;
 if x='null'::jsonb then continue; end if;
 perform private.r04_keys(x,case when k='target' then array['amount','currency','metric'] else array['amount','currency'] end);
 if jsonb_typeof(x->'amount')<>'string' or x->>'amount'!~'^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$' then raise exception 'r04_invalid_amount'; end if;
 if x->'currency'<>'null'::jsonb and (jsonb_typeof(x->'currency')<>'string' or x->>'currency'!~'^[A-Z]{3}$') then raise exception 'r04_invalid_currency'; end if;
 if k='target' then
 if x->'metric'<>'null'::jsonb and x->>'metric' not in ('revenue','realised_profit','units','orders') then raise exception 'r04_invalid_metric'; end if;
 if x->>'metric' in ('units','orders') and x->'currency'<>'null'::jsonb then raise exception 'r04_count_currency_forbidden'; end if;
 if ready and ((x->>'amount')::numeric<=0 or x->'metric'='null'::jsonb or (x->>'metric' in ('revenue','realised_profit') and x->'currency'='null'::jsonb)) then raise exception 'r04_unresolved_target'; end if;
 elsif ready and x->'currency'='null'::jsonb then raise exception 'r04_unresolved_budget'; end if;
 end loop;
 x:=v->'deadline';
 if x<>'null'::jsonb then
 perform private.r04_keys(x,array['date','time','timezone']);
 if jsonb_typeof(x->'date')<>'string' or x->>'date'!~'^\d{4}-\d{2}-\d{2}$' or to_char((x->>'date')::date,'YYYY-MM-DD')<>x->>'date' then raise exception 'r04_invalid_deadline'; end if;
 if x->'time'<>'null'::jsonb and (jsonb_typeof(x->'time')<>'string' or x->>'time'!~'^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$') then raise exception 'r04_invalid_deadline_time'; end if;
 if jsonb_typeof(x->'timezone')<>'string' or not exists(select 1 from pg_catalog.pg_timezone_names where name=x->>'timezone') then raise exception 'r04_invalid_timezone'; end if;
 if ready and x->'time'='null'::jsonb then raise exception 'r04_unresolved_deadline_time'; end if;
 end if;
end $$;
create function private.r04_quest_content(v jsonb) returns void language plpgsql set search_path='' as $$
begin
 perform private.r04_safe(v); perform private.r04_keys(v,array['title','originalIntent','objective','parsed','ambiguities']);
 if jsonb_typeof(v->'title')<>'string' or length(btrim(v->>'title')) not between 1 and 200
 or jsonb_typeof(v->'originalIntent')<>'string' or length(btrim(v->>'originalIntent')) not between 1 and 4000
 or jsonb_typeof(v->'objective')<>'string' or length(btrim(v->>'objective')) not between 1 and 4000
 or jsonb_typeof(v->'parsed')<>'object' then raise exception 'r04_invalid_quest_content'; end if;
 perform private.r04_strings(v->'ambiguities',30);
 perform private.r04_parsed(v->'parsed',false);
end $$;
create function private.r04_envelope_valid(b uuid,v jsonb) returns void language plpgsql set search_path='' as $$
declare x jsonb; aid uuid; rid uuid;
begin
 perform private.r04_safe(v); perform private.r04_keys(v,array['purposes','operations','accounts','packs','dataSharing','limits','startsAt','expiresAt','stopRules']);
 perform private.r04_strings(v->'purposes',20); perform private.r04_strings(v->'operations',20); perform private.r04_strings(v->'dataSharing',20); perform private.r04_strings(v->'stopRules',20);
 if jsonb_array_length(v->'purposes')=0 or jsonb_array_length(v->'operations')=0 or jsonb_array_length(v->'stopRules')=0 then raise exception 'r04_incomplete_envelope'; end if;
 if jsonb_typeof(v->'accounts')<>'array' or jsonb_array_length(v->'accounts')>20 or jsonb_typeof(v->'packs')<>'array' or jsonb_array_length(v->'packs')>20
 or jsonb_typeof(v->'limits')<>'array' or jsonb_array_length(v->'limits') not between 1 and 20 then raise exception 'r04_invalid_references'; end if;
 if jsonb_typeof(v->'startsAt')<>'string' or jsonb_typeof(v->'expiresAt')<>'string'
 or (v->>'startsAt')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' or (v->>'expiresAt')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$'
 or (v->>'expiresAt')::timestamptz<=(v->>'startsAt')::timestamptz then raise exception 'r04_invalid_envelope_time'; end if;
 for x in select value from jsonb_array_elements(v->'limits') loop
 perform private.r04_keys(x,array['category','currency','maximum']);
 if jsonb_typeof(x->'category')<>'string' or length(btrim(x->>'category')) not between 1 and 100 or jsonb_typeof(x->'currency')<>'string' or x->>'currency'!~'^[A-Z]{3}$'
 or jsonb_typeof(x->'maximum')<>'string' or x->>'maximum'!~'^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$' then raise exception 'r04_invalid_money'; end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(v->'limits') item group by item->>'category',item->>'currency' having count(*)>1) then raise exception 'r04_duplicate_limit'; end if;
 for x in select value from jsonb_array_elements(v->'accounts') loop
 perform private.r04_keys(x,array['id','revision']); aid:=(x->>'id')::uuid; rid:=(x->>'revision')::uuid;
 if not exists(select 1 from private.connected_accounts where id=aid and business_id=b and owner_id=auth.uid() and connection_revision=rid and status='connected' and revoked_at is null) then raise exception 'r04_account_unavailable'; end if;
 end loop;
 for x in select value from jsonb_array_elements(v->'packs') loop
 perform private.r04_keys(x,array['installationId','packId']);
 if not exists(select 1 from public.installed_packs i join public.packs p on p.id=i.root_pack_id where i.id=(x->>'installationId')::uuid and i.business_id=b and i.root_pack_id=(x->>'packId')::uuid and i.status='active' and p.status<>'retired') then raise exception 'r04_pack_unavailable'; end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(v->'accounts') item group by item->>'id' having count(*)>1) or exists(select 1 from jsonb_array_elements(v->'packs') item group by item->>'installationId' having count(*)>1) then raise exception 'r04_duplicate_reference'; end if;
end $$;
create function private.r04_proposal_status(e private.r04_envelopes) returns text language plpgsql set search_path='' as $$
begin
 if exists(select 1 from private.r04_revocations where proposal_id=e.id) then return 'revoked'; end if;
 if (e.envelope->>'expiresAt')::timestamptz<=clock_timestamp() then return 'expired'; end if;
 if not exists(select 1 from private.r04_business_state where business_id=e.business_id and revision=e.business_revision)
 or not exists(select 1 from private.r04_goal_state where goal_id=e.goal_id and business_id=e.business_id and revision=e.goal_revision) then return 'stale'; end if;
 begin perform private.r04_envelope_valid(e.business_id,e.envelope); exception when others then return 'stale'; end;
 if exists(select 1 from private.r04_confirmations where proposal_id=e.id) then return 'confirmed_intent_only'; end if;
 return 'proposed';
end $$;

create function public.r04_quest_read(p_business_id uuid,p_goal_id uuid default null,p_limit integer default 20,p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b private.r04_business_state; bv private.r04_business_versions; g private.r04_goal_state; gv private.r04_goal_versions;
 total bigint; items jsonb; selected jsonb:=null; proposals jsonb; complete boolean:=true; selection text:='none';
begin
 if not private.is_business_owner(p_business_id) then raise exception 'r04_owner_required' using errcode='42501'; end if;
 if p_limit is null or p_limit not between 1 and 50 or p_offset is null or p_offset not between 0 and 100000 then raise exception 'r04_invalid_page'; end if;
 select * into b from private.r04_business_state where business_id=p_business_id;
 select * into bv from private.r04_business_versions where business_id=p_business_id and revision=b.revision;
 select count(*) into total from private.r04_goal_state where business_id=p_business_id;
 select coalesce(jsonb_agg(x.item order by x.created_at desc,x.goal_id desc),'[]') into items from (
 select s.created_at,s.goal_id,jsonb_build_object('id',s.goal_id,'businessId',s.business_id,'revision',s.revision,'title',v.content->'title','preference',v.preference,'createdAt',s.created_at,'updatedAt',s.updated_at) item
 from private.r04_goal_state s join private.r04_goal_versions v using(goal_id,business_id,revision) where s.business_id=p_business_id order by s.created_at desc,s.goal_id desc limit p_limit offset p_offset) x;
 if p_goal_id is not null then
 select * into g from private.r04_goal_state where goal_id=p_goal_id and business_id=p_business_id;
 if g.goal_id is null then raise exception 'r04_quest_unavailable'; end if; selection:='explicit';
 elsif b.current_goal_id is not null then
 select * into g from private.r04_goal_state where goal_id=b.current_goal_id and business_id=p_business_id;
 if g.goal_id is null then raise exception 'r04_current_quest_unavailable'; end if; selection:='current';
 else select * into g from private.r04_goal_state where business_id=p_business_id order by created_at desc,goal_id desc limit 1;
 if g.goal_id is not null then selection:='last'; end if;
 end if;
 if g.goal_id is not null then
 select * into strict gv from private.r04_goal_versions where goal_id=g.goal_id and business_id=p_business_id and revision=g.revision;
 select count(*)<=10 into complete from private.r04_envelopes where goal_id=g.goal_id and business_id=p_business_id;
 select coalesce(jsonb_agg(x.item order by x.created_at desc,x.id desc),'[]') into proposals from (
 select e.created_at,e.id,jsonb_build_object('id',e.id,'goalId',e.goal_id,'goalRevision',e.goal_revision,'businessRevision',e.business_revision,'envelope',e.envelope,'hash',e.content_hash,'createdAt',e.created_at,
 'confirmation',(select jsonb_build_object('id',c.id,'confirmedAt',c.created_at) from private.r04_confirmations c where proposal_id=e.id),
 'revoked',exists(select 1 from private.r04_revocations where proposal_id=e.id),'effective',false,'status',private.r04_proposal_status(e)) item
 from private.r04_envelopes e where goal_id=g.goal_id and business_id=p_business_id order by created_at desc,id desc limit 10) x;
 selected:=jsonb_build_object('id',g.goal_id,'businessId',g.business_id,'revision',g.revision,'title',gv.content->'title','preference',gv.preference,'createdAt',g.created_at,'updatedAt',g.updated_at,'content',gv.content,'hash',gv.content_hash,'proposals',proposals);
 end if;
 return jsonb_build_object('businessId',p_business_id,'business',jsonb_build_object('revision',coalesce(b.revision,0),'content',bv.content,'preference',coalesce(bv.preference,'legacy_unmanaged'),'currentGoalId',b.current_goal_id),
 'quests',items,'total',total,'limit',p_limit,'offset',p_offset,'selection',selection,'selected',selected,'proposalsComplete',complete,
 'references',jsonb_build_object(
 'accounts',(select coalesce(jsonb_agg(x.item order by x.id),'[]') from (select a.id,jsonb_build_object('id',a.id,'revision',a.connection_revision,'label',a.provider||' account '||a.provider_account_id) item from private.connected_accounts a where a.business_id=p_business_id and a.owner_id=auth.uid() and a.status='connected' and a.revoked_at is null order by a.id limit 20) x),
 'accountsComplete',(select count(*)<=20 from private.connected_accounts where business_id=p_business_id and owner_id=auth.uid() and status='connected' and revoked_at is null),
 'packs',(select coalesce(jsonb_agg(x.item order by x.id),'[]') from (select i.id,jsonb_build_object('installationId',i.id,'packId',p.id,'label',p.name,'version',p.version) item from public.installed_packs i join public.packs p on p.id=i.root_pack_id where i.business_id=p_business_id and i.status='active' and p.status<>'retired' order by i.id limit 20) x),
 'packsComplete',(select count(*)<=20 from public.installed_packs i join public.packs p on p.id=i.root_pack_id where i.business_id=p_business_id and i.status='active' and p.status<>'retired')),
 'executionAvailable',false,'executionBlockedReason','r05_admission_required');
end $$;

create function public.r04_research_link_preview(p_business_id uuid,p_experiment_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.product_experiments; r public.product_experiments; w public.workflow_runs; a uuid; ids uuid[]; goal_ids uuid[]; budget jsonb; n integer; chain_root uuid;
begin
 if not private.is_business_owner(p_business_id) then raise exception 'r04_owner_required' using errcode='42501'; end if;
 select * into e from public.product_experiments where id=p_experiment_id and business_id=p_business_id;
 if e.id is null then raise exception 'r04_experiment_unavailable'; end if;
 select * into w from public.workflow_runs where id=e.workflow_run_id and business_id=p_business_id;
 if w.id is null then return jsonb_build_object('status','unlinked_ambiguous','reason','workflow_unavailable'); end if;
 if e.discovery_version<>'pod-discovery-2.0' then
 return jsonb_build_object('status',case when w.goal_id is null then 'unlinked_ambiguous' when exists(select 1 from private.r04_goal_state where goal_id=w.goal_id and business_id=p_business_id) then 'linkable' else 'legacy_bound' end,'reason','legacy_workflow_goal','businessId',p_business_id,'experimentIds',jsonb_build_array(e.id),'goalId',w.goal_id,'authorityRootId',null,'evidence',jsonb_build_object('workflowId',w.id,'goalId',w.goal_id)); end if;
 begin
 select * into strict r from public.product_experiments where id=coalesce(e.parent_discovery_id,e.id) and business_id=p_business_id and parent_discovery_id is null and discovery_version='pod-discovery-2.0';
 if w.input is distinct from jsonb_build_object('intentId',r.id) or r.workflow_run_id<>w.id then raise exception 'identity_mismatch'; end if;
 a:=(r.variables->>'budgetAuthorityRootId')::uuid;
 select count(*) into n from (select id from public.product_experiments where business_id=p_business_id and discovery_version='pod-discovery-2.0' and parent_discovery_id is null and variables->>'budgetAuthorityRootId'=a::text limit 101) bounded;
 if n>100 then return jsonb_build_object('status','unavailable','reason','chain_exceeds_100_roots'); end if;
 budget:=private.stage13v2_budget_authority(r.id,false);
 for chain_root in select jsonb_array_elements_text(budget->'chainRootIds')::uuid loop
 perform private.stage13v2_budget_authority(chain_root,false);
 if not exists(select 1 from public.product_experiments pe join public.workflow_runs wr on wr.id=pe.workflow_run_id and wr.business_id=pe.business_id
 where pe.id=chain_root and pe.business_id=p_business_id and wr.input=jsonb_build_object('intentId',pe.id) and pe.variables->'intent'->>'id'=pe.id::text and pe.variables->'intent'->>'businessId'=p_business_id::text) then raise exception 'chain_identity_mismatch'; end if;
 end loop;
 select count(*) into n from (select x.id from public.product_experiments x where business_id=p_business_id and discovery_version='pod-discovery-2.0' and (x.id in(select jsonb_array_elements_text(budget->'chainRootIds')::uuid) or x.parent_discovery_id in(select jsonb_array_elements_text(budget->'chainRootIds')::uuid)) limit 501) bounded;
 if n>500 then return jsonb_build_object('status','unavailable','reason','chain_exceeds_500_records'); end if;
 select array_agg(x.id order by x.id) into ids from public.product_experiments x where business_id=p_business_id and discovery_version='pod-discovery-2.0' and (x.id in(select jsonb_array_elements_text(budget->'chainRootIds')::uuid) or x.parent_discovery_id in(select jsonb_array_elements_text(budget->'chainRootIds')::uuid));
 if cardinality(ids)>500 then return jsonb_build_object('status','unavailable','reason','chain_exceeds_500_records'); end if;
 select array_agg(distinct id) filter(where id is not null) into goal_ids from (
 select wr.goal_id id from public.product_experiments pe join public.workflow_runs wr on wr.id=pe.workflow_run_id and wr.business_id=pe.business_id where pe.id=any(ids) and pe.business_id=p_business_id
 union select l.goal_id from private.r04_research_links l where l.experiment_id=any(ids) and l.business_id=p_business_id) matches;
 if cardinality(goal_ids)>1 then return jsonb_build_object('status','unlinked_ambiguous','reason','conflicting_goals'); end if;
 return jsonb_build_object('status',case when goal_ids[1] is not null and not exists(select 1 from private.r04_goal_state where goal_id=goal_ids[1] and business_id=p_business_id) then 'legacy_bound' else 'linkable' end,'businessId',p_business_id,'experimentIds',to_jsonb(ids),'goalId',goal_ids[1],'authorityRootId',a,
 'evidence',jsonb_build_object('rootId',r.id,'authorityRootId',a,'semanticGoalHash',r.variables->'semanticGoalHash','originalIntentHash',private.r04_hash(r.variables->'intent'),'originalObjective',r.variables->'intent'->>'objective','budgetUnchanged',true));
 exception when others then return jsonb_build_object('status','unlinked_ambiguous','reason','lineage_could_not_be_verified'); end;
end $$;

create function public.r04_quest_transition(p_business_id uuid,p_operation text,p_payload jsonb,p_submission_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); b private.r04_business_state; bv private.r04_business_versions; g private.r04_goal_state; gv private.r04_goal_versions;
 e private.r04_envelopes; previous private.r04_submissions; request_hash text; result jsonb; gid uuid; eid uuid; rev integer; pref text; content jsonb; preview jsonb; linked uuid;
begin
 if actor is null then raise exception 'r04_owner_required' using errcode='42501'; end if;
 perform 1 from public.businesses where id=p_business_id and owner_user_id=actor for update;
 if not found then raise exception 'r04_owner_required' using errcode='42501'; end if;
 if p_submission_id is null or p_operation is null or p_operation not in ('business.save','quest.save','quest.preference','quest.select','envelope.propose','envelope.confirm','envelope.revoke','research.link') then raise exception 'r04_invalid_operation'; end if;
 perform private.r04_safe(p_payload);
 request_hash:=private.r04_hash(jsonb_build_object('operation',p_operation,'payload',p_payload,'actor',actor));
 select * into previous from private.r04_submissions where business_id=p_business_id and submission_id=p_submission_id;
 if previous.submission_id is not null then
 if previous.request_hash<>request_hash then raise exception 'r04_idempotency_conflict'; end if;
 if p_operation in ('envelope.confirm','envelope.revoke','envelope.propose') then
 select * into e from private.r04_envelopes where id=(previous.result->>'id')::uuid and business_id=p_business_id;
 return previous.result||jsonb_build_object('replayed',true,'status',private.r04_proposal_status(e));
 end if;
 return previous.result||jsonb_build_object('replayed',true);
 end if;
 select * into b from private.r04_business_state where business_id=p_business_id for update;
 if p_operation='business.save' then
 perform private.r04_keys(p_payload,array['expectedRevision','content','preference']);
 if (p_payload->>'expectedRevision')::integer is distinct from coalesce(b.revision,0) then raise exception 'r04_stale_revision'; end if;
 content:=p_payload->'content'; perform private.r04_business_content(content); pref:=p_payload->>'preference';
 if pref not in ('setup','paused','stopped') or pref is null then raise exception 'r04_invalid_preference'; end if;
 rev:=coalesce(b.revision,0)+1;
 insert into private.r04_business_versions values(p_business_id,rev,content,pref,private.r04_hash(content),actor,clock_timestamp());
 insert into private.r04_business_state(business_id,revision) values(p_business_id,rev) on conflict(business_id) do update set revision=excluded.revision;
 eid:=p_business_id;
 elsif p_operation='quest.save' then
 perform private.r04_keys(p_payload,array['goalId','expectedRevision','content']); content:=p_payload->'content'; perform private.r04_quest_content(content);
 gid:=(p_payload->>'goalId')::uuid;
 if gid is null then
 if (p_payload->>'expectedRevision')::integer is distinct from 0 then raise exception 'r04_stale_revision'; end if;
 gid:=gen_random_uuid(); rev:=1;
 insert into public.goals(id,business_id,title,description,status) values(gid,p_business_id,content->>'title',content->>'objective','draft');
 else
 select * into g from private.r04_goal_state where goal_id=gid and business_id=p_business_id for update;
 if g.goal_id is null then raise exception 'r04_quest_unavailable'; end if;
 if (p_payload->>'expectedRevision')::integer is distinct from g.revision then raise exception 'r04_stale_revision'; end if;
 rev:=g.revision+1;
 end if;
 insert into private.r04_goal_versions values(gid,p_business_id,rev,content,'draft',private.r04_hash(content),actor,clock_timestamp());
 insert into private.r04_goal_state(goal_id,business_id,revision) values(gid,p_business_id,rev) on conflict(goal_id) do update set revision=excluded.revision,updated_at=clock_timestamp(); eid:=gid;
 elsif p_operation in ('quest.preference','quest.select','envelope.propose','research.link') then
 if p_operation='quest.preference' then perform private.r04_keys(p_payload,array['goalId','expectedRevision','preference']);
 elsif p_operation='quest.select' then perform private.r04_keys(p_payload,array['goalId','expectedRevision']);
 elsif p_operation='envelope.propose' then perform private.r04_keys(p_payload,array['goalId','expectedRevision','businessRevision','envelope']);
 else perform private.r04_keys(p_payload,array['goalId','expectedRevision','experimentId']); end if;
 gid:=(p_payload->>'goalId')::uuid;
 select * into g from private.r04_goal_state where goal_id=gid and business_id=p_business_id for update;
 if g.goal_id is null then raise exception 'r04_quest_unavailable'; end if;
 if (p_payload->>'expectedRevision')::integer is distinct from g.revision then raise exception 'r04_stale_revision'; end if;
 select * into strict gv from private.r04_goal_versions where goal_id=gid and business_id=p_business_id and revision=g.revision;
 rev:=g.revision; eid:=gid;
 if p_operation='quest.preference' then
 pref:=p_payload->>'preference'; if pref is null or pref not in ('draft','ready','paused','stopped','completed') then raise exception 'r04_invalid_preference'; end if;
 if pref='ready' and jsonb_array_length(gv.content->'ambiguities')>0 then raise exception 'r04_ambiguous_intent'; end if;
 if pref='ready' then perform private.r04_parsed(gv.content->'parsed',true); end if;
 rev:=rev+1; insert into private.r04_goal_versions values(gid,p_business_id,rev,gv.content,pref,gv.content_hash,actor,clock_timestamp());
 update private.r04_goal_state set revision=rev,updated_at=clock_timestamp() where goal_id=gid;
 elsif p_operation='quest.select' then
 if b.business_id is null then raise exception 'r04_business_settings_required'; end if;
 update private.r04_business_state set current_goal_id=gid where business_id=p_business_id;
 elsif p_operation='envelope.propose' then
 if b.business_id is null or (p_payload->>'businessRevision')::integer is distinct from b.revision then raise exception 'r04_stale_business_revision'; end if;
 if gv.preference<>'ready' or jsonb_array_length(gv.content->'ambiguities')>0 then raise exception 'r04_quest_not_ready'; end if;
 perform private.r04_parsed(gv.content->'parsed',true);
 content:=p_payload->'envelope'; perform private.r04_envelope_valid(p_business_id,content);
 if (content->>'expiresAt')::timestamptz<=clock_timestamp() then raise exception 'r04_envelope_expired'; end if;
 eid:=gen_random_uuid();
 insert into private.r04_envelopes(id,business_id,goal_id,goal_revision,business_revision,envelope,content_hash,actor_id)
 values(eid,p_business_id,gid,g.revision,b.revision,content,private.r04_hash(jsonb_build_object('businessId',p_business_id,'goalId',gid,'goalRevision',g.revision,'businessRevision',b.revision,'envelope',content)),actor);
 else
 preview:=public.r04_research_link_preview(p_business_id,(p_payload->>'experimentId')::uuid);
 if preview->>'status'<>'linkable' or ((preview->>'goalId') is not null and (preview->>'goalId')::uuid<>gid) then raise exception 'r04_ambiguous_lineage'; end if;
 if preview->>'goalId' is null and gv.content->>'originalIntent' is distinct from preview->'evidence'->>'originalObjective' then raise exception 'r04_lineage_intent_mismatch'; end if;
 for linked in select jsonb_array_elements_text(preview->'experimentIds')::uuid loop
 if exists(select 1 from private.r04_research_links where experiment_id=linked and (goal_id<>gid or business_id<>p_business_id)) then raise exception 'r04_lineage_conflict'; end if;
 insert into private.r04_research_links(experiment_id,business_id,goal_id,goal_revision,workflow_run_id,authority_root_id,evidence,evidence_hash,actor_id)
 select linked,p_business_id,gid,g.revision,pe.workflow_run_id,(preview->>'authorityRootId')::uuid,preview->'evidence',private.r04_hash(preview->'evidence'),actor
 from public.product_experiments pe where pe.id=linked and pe.business_id=p_business_id on conflict(experiment_id) do nothing;
 end loop;
 end if;
 else
 if p_operation='envelope.confirm' then perform private.r04_keys(p_payload,array['proposalId','proposalHash']); else perform private.r04_keys(p_payload,array['proposalId']); end if;
 select * into e from private.r04_envelopes where id=(p_payload->>'proposalId')::uuid and business_id=p_business_id for update;
 if e.id is null then raise exception 'r04_proposal_unavailable'; end if; eid:=e.id;
 if p_operation='envelope.confirm' then
 if p_payload->>'proposalHash' is distinct from e.content_hash then raise exception 'r04_proposal_hash_mismatch'; end if;
 perform 1 from private.connected_accounts a where a.business_id=p_business_id and a.id in(select (value->>'id')::uuid from jsonb_array_elements(e.envelope->'accounts')) order by a.id for share;
 perform 1 from public.installed_packs i where i.business_id=p_business_id and i.id in(select (value->>'installationId')::uuid from jsonb_array_elements(e.envelope->'packs')) order by i.id for share;
 perform 1 from public.packs p where p.id in(select (value->>'packId')::uuid from jsonb_array_elements(e.envelope->'packs')) order by p.id for share;
 if private.r04_proposal_status(e) not in ('proposed','confirmed_intent_only') then raise exception 'r04_proposal_stale'; end if;
 insert into private.r04_confirmations(proposal_id,business_id,proposal_hash,actor_id) values(e.id,p_business_id,e.content_hash,actor) on conflict(proposal_id) do nothing;
 else insert into private.r04_revocations(proposal_id,business_id,actor_id) values(e.id,p_business_id,actor) on conflict(proposal_id) do nothing;
 end if;
 end if;
 result:=jsonb_strip_nulls(jsonb_build_object('operation',p_operation,'id',eid,'revision',rev,'replayed',false,'executionAvailable',false,'executionBlockedReason','r05_admission_required'));
 if p_operation in ('envelope.confirm','envelope.revoke','envelope.propose') then
 select * into e from private.r04_envelopes where id=eid and business_id=p_business_id;
 result:=result||jsonb_build_object('status',private.r04_proposal_status(e)); end if;
 insert into private.r04_submissions(business_id,submission_id,request_hash,result,actor_id) values(p_business_id,p_submission_id,request_hash,result,actor);
 return result;
end $$;

revoke all on function private.r04_guard(),private.r04_core_goal_guard(),private.r04_hash(jsonb),private.r04_safe(jsonb),private.r04_keys(jsonb,text[]),private.r04_strings(jsonb,integer),private.r04_business_content(jsonb),private.r04_parsed(jsonb,boolean),private.r04_quest_content(jsonb),private.r04_envelope_valid(uuid,jsonb),private.r04_proposal_status(private.r04_envelopes) from public,anon,authenticated,service_role;
revoke all on function public.r04_quest_read(uuid,uuid,integer,integer),public.r04_research_link_preview(uuid,uuid),public.r04_quest_transition(uuid,text,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.r04_quest_read(uuid,uuid,integer,integer),public.r04_research_link_preview(uuid,uuid),public.r04_quest_transition(uuid,text,jsonb,uuid) to authenticated;
commit;
