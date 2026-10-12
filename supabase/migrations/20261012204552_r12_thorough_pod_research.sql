-- Thorough POD capacity, exact-data projection and immutable provenance.
-- Definition-only: creates no templates, permissions, grant, paid effect or live source.
begin;

create function private.r12_pod_thorough_profile() returns jsonb language sql immutable set search_path='' as $$ select '{"maximumPasses":5,"maximumCalls":25,"maximumCollections":5,"maximumWorkingHypotheses":16,"maximumDomains":16,"maximumResults":100,"maximumWebSearchResults":25,"maximumExcerptCharacters":8000,"maximumQueryCharacters":4000,"maximumQuotes":48,"maximumQuoteCharacters":2400,"formattingTokenAllowance":8192,"searchInputTokenAllowance":1000000,"searchOutputTokenAllowance":32000,"exaFastSearchFeeMicrousd":17000,"phases":{"plan":{"maximumRequestBytes":786432,"outputTokens":16000,"maximumArtifactBytes":262144},"search1":{"maximumRequestBytes":32768,"outputTokens":16000,"maximumArtifactBytes":1048576},"select1":{"maximumRequestBytes":786432,"outputTokens":16000,"maximumArtifactBytes":131072},"strategy":{"maximumRequestBytes":327680,"outputTokens":48000,"maximumArtifactBytes":262144},"review":{"maximumRequestBytes":155648,"outputTokens":32000,"maximumArtifactBytes":524288}},"maximumSelectorEvidenceBytes":720896,"maximumCurrentEvidenceBytes":131072,"maximumPriorEvidenceBytes":65536,"maximumPlannerEvidenceBytes":524288,"maximumAssessmentEmbeddedBytes":98304,"minimumAssessmentEmbeddedBytes":16384,"preferredAssessmentEmbeddedBytes":49152,"maximumRejectedContentBytes":1048576,"maximumResponseBytes":2097152,"maximumBindingBytes":3407872,"responseTimeoutMs":120000}'::jsonb $$;

create function private.r12_pod_thorough_capacity(phase text,field text) returns integer language sql immutable set search_path='' as $$
 select (private.r12_pod_thorough_profile()->'phases'->phase->>field)::integer
$$;
create function private.r12_pod_thorough_scope(scope uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from private.r12_discovery_scopes s join private.r12_pod_setups st on st.id=s.pod_setup_id and st.scope_id=s.id and st.business_id=s.business_id
 join private.r12_pod_templates t on t.id=st.template_id where s.id=scope and s.origin='pod_goal' and s.amendment->>'version'='r12.pod-research-goal.3'
 and s.amendment_hash=private.stage14_hash(s.amendment) and t.version='r12.pod-template.4' and t.pins->>'profile'='r12.pod-thorough.1'
 and t.pins->>'profileHash'=private.stage14_hash(private.r12_pod_thorough_profile()) and st.preview->>'profileHash'=t.pins->>'profileHash')
$$;
-- PG jsonb whitespace is not part of the compact application envelope.
create function private.r12_pod_compact_bytes(v jsonb) returns integer language sql immutable strict set search_path='' as $$
 select octet_length(private.stage14_canonical(v))
$$;
create function private.r12_pod_embedded_bytes(v jsonb) returns integer language sql immutable strict set search_path='' as $$
 select octet_length(to_jsonb(private.stage14_canonical(v))::text)
$$;

CREATE OR REPLACE FUNCTION private.r12_pod_thorough_safe(v jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare value_text text; child jsonb;
begin
 if v is null or octet_length(v::text)>1048576 then raise exception 'r04_invalid_payload'; end if;
 if jsonb_typeof(v)='object' then
 for value_text,child in select key,value from jsonb_each(v) loop
 if value_text ~* '^(password|passwd|secret|secret[_ -]?key|client[_ -]?secret|token|api[_ -]?key|access[_ -]?token|refresh[_ -]?token)$' then raise exception 'r04_credential_content_rejected'; end if;
 perform private.r12_pod_thorough_safe(child); end loop;
 elsif jsonb_typeof(v)='array' then for child in select value from jsonb_array_elements(v) loop perform private.r12_pod_thorough_safe(child); end loop;
 elsif jsonb_typeof(v)='string' then
 value_text:=v#>>'{}';
 if value_text ~* '(-----BEGIN[^-]*(PRIVATE KEY)|(^|[^[:alnum:]_])(password|passwd|secret|secret[_ -]?key|client[_ -]?secret|token|api[_ -]?key|access[_ -]?token|refresh[_ -]?token)([[:space:]]*[:=]|[[:space:]]+(is[[:space:]]+)?[^[:space:]])|(Bearer|Basic)[[:space:]]+[A-Za-z0-9._+/=-]{8,}|sk-[A-Za-z0-9_-]{12,}|[rs]k_(live|test)_[A-Za-z0-9]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|gh[pousr]_[A-Za-z0-9]{16,}|(AKIA|ASIA)[A-Z0-9]{16}|github_pat_[A-Za-z0-9_]{20,}|[a-z][a-z0-9+.-]*://[^ /:@]+:[^ /@]+@|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})' then raise exception 'r04_credential_content_rejected'; end if;
 end if;
end $function$
;

alter table private.r12_pod_templates drop constraint r12_pod_templates_version_check;
alter table private.r12_pod_templates add constraint r12_pod_templates_version_check check(version in ('r12.pod-template.2','r12.pod-template.3','r12.pod-template.4'));

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_template_check(private.r12_pod_templates,timestamp with time zone,boolean)'::regprocedure);
 if (length(d)-length(replace(d,$old$t.version not in ('r12.pod-template.2','r12.pod-template.3')$old$,'')))/length($old$t.version not in ('r12.pod-template.2','r12.pod-template.3')$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_template_check(private.r12_pod_templates,timestamp with time zone,boolean)';end if;
 execute replace(d,$old$t.version not in ('r12.pod-template.2','r12.pod-template.3')$old$,$new$t.version not in ('r12.pod-template.2','r12.pod-template.3','r12.pod-template.4')$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_template_check(private.r12_pod_templates,timestamp with time zone,boolean)'::regprocedure);
 if (length(d)-length(replace(d,$old$ if not current_use then return;end if;$old$,'')))/length($old$ if not current_use then return;end if;$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_template_check(private.r12_pod_templates,timestamp with time zone,boolean)';end if;
 execute replace(d,$old$ if not current_use then return;end if;$old$,$new$ if t.version='r12.pod-template.4' and (t.pins->>'profile' is distinct from 'r12.pod-thorough.1' or t.pins->>'profileHash' is distinct from private.stage14_hash(private.r12_pod_thorough_profile()) or jsonb_typeof(t.pins->'recovery') is distinct from 'boolean') then raise exception 'r12_pod_profile_pin_required';end if;
 if not current_use then return;end if;$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_template_check(private.r12_pod_templates,timestamp with time zone,boolean)'::regprocedure);
 if (length(d)-length(replace(d,$old$'knowledgeValidUntil','schemas']);$old$,'')))/length($old$'knowledgeValidUntil','schemas']);$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_template_check(private.r12_pod_templates,timestamp with time zone,boolean)';end if;
 execute replace(d,$old$'knowledgeValidUntil','schemas']);$old$,$new$'knowledgeValidUntil','schemas']||case when t.version='r12.pod-template.4' then array['profile','profileHash','recovery'] else array[]::text[] end);$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_template_check(private.r12_pod_templates,timestamp with time zone,boolean)'::regprocedure);
 if (length(d)-length(replace(d,$old$fd.version<>'1.0.0'$old$,'')))/length($old$fd.version<>'1.0.0'$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_template_check(private.r12_pod_templates,timestamp with time zone,boolean)';end if;
 execute replace(d,$old$fd.version<>'1.0.0'$old$,$new$fd.version<>(case when t.version='r12.pod-template.4' then '2.0.0' else '1.0.0' end)$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_template_check(private.r12_pod_templates,timestamp with time zone,boolean)'::regprocedure);
 if (length(d)-length(replace(d,$old$wd.version<>'1.0.0'$old$,'')))/length($old$wd.version<>'1.0.0'$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_template_check(private.r12_pod_templates,timestamp with time zone,boolean)';end if;
 execute replace(d,$old$wd.version<>'1.0.0'$old$,$new$wd.version<>(case when t.version='r12.pod-template.4' then '2.0.0' else '1.0.0' end)$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_quote_check(jsonb,jsonb)'::regprocedure);
 if (length(d)-length(replace(d,$old$q->'plannerRequestBytes' is distinct from '24576'::jsonb or q->>'version' is distinct from 'r12.pod-quote.2'$old$,'')))/length($old$q->'plannerRequestBytes' is distinct from '24576'::jsonb or q->>'version' is distinct from 'r12.pod-quote.2'$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_quote_check(jsonb,jsonb)';end if;
 execute replace(d,$old$q->'plannerRequestBytes' is distinct from '24576'::jsonb or q->>'version' is distinct from 'r12.pod-quote.2'$old$,$new$q->'plannerRequestBytes' is distinct from to_jsonb(case when q->>'version'='r12.pod-quote.3' then 786432 else 24576 end) or not coalesce(q->>'version' in ('r12.pod-quote.2','r12.pod-quote.3'),false)$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_quote_check(jsonb,jsonb)'::regprocedure);
 if (length(d)-length(replace(d,$old$ perform private.r04_safe(q);$old$,'')))/length($old$ perform private.r04_safe(q);$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_quote_check(jsonb,jsonb)';end if;
 execute replace(d,$old$ perform private.r04_safe(q);$old$,$new$ perform private.r04_safe(q);
 if q->>'version'='r12.pod-quote.3' and (q->>'profile' is distinct from 'r12.pod-thorough.1' or q->>'profileHash' is distinct from private.stage14_hash(private.r12_pod_thorough_profile())) then raise exception 'r12_pod_profile_quote_required';end if;
 if reviewed is not null and (q->>'version' is distinct from reviewed->>'version' or q->>'profileHash' is distinct from reviewed->>'profileHash') then raise exception 'r12_pod_profile_quote_changed';end if;$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_quote_check(jsonb,jsonb)'::regprocedure);
 if (length(d)-length(replace(d,$old$total:=total+(q->'ceilings'->>phase)::bigint;$old$,'')))/length($old$total:=total+(q->'ceilings'->>phase)::bigint;$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_quote_check(jsonb,jsonb)';end if;
 execute replace(d,$old$total:=total+(q->'ceilings'->>phase)::bigint;$old$,$new$if q->>'version'='r12.pod-quote.3' and (q->'ceilings'->>phase)::bigint>2000000 then raise exception 'r12_pod_phase_quote_exceeds_binding';end if;
 total:=total+(q->'ceilings'->>phase)::bigint;$new$);end $patch$;

-- Reviewed .4 upgrade only. Existing leases, policies and historical pins are
-- never rewritten or revoked here. A prior installation must already be stopped.
create function private.r12_pod_thorough_installation(b uuid,t private.r12_pod_templates) returns void language plpgsql set search_path='' as $$
declare prior public.installed_packs;target public.installed_packs;pack public.packs;iid uuid;begin
 perform 1 from public.businesses where id=b and owner_user_id=auth.uid() for update;
 if not found or t.version is distinct from 'r12.pod-template.4' then raise exception 'r12_pod_installation_owner_required';end if;
 perform private.r12_pod_template_check(t,clock_timestamp(),true);
 select * into pack from public.packs where id=(t.pins->>'packId')::uuid for share;
 if pack.pack_key is distinct from 'workflow.pod-research' or pack.version is distinct from '2.0.0' then raise exception 'r12_pod_installation_upgrade_invalid';end if;
 select * into target from public.installed_packs where business_id=b and root_pack_id=pack.id for update;
 if target.id is not null then
 if target.status is distinct from 'active' or target.root_pack_key is distinct from pack.pack_key or target.snapshot is distinct from t.pins->'snapshot' then raise exception 'r12_pod_installation_changed';end if;
 return;end if;
 select * into prior from public.installed_packs where business_id=b and root_pack_key=pack.pack_key and status='active' for update;
 if prior.id is null then return;end if;
 if not exists(select 1 from public.packs where id=prior.root_pack_id and pack_key=pack.pack_key and version='1.0.0')
 or prior.snapshot->>'rootPackId' is distinct from prior.root_pack_id::text
 or not exists(select 1 from private.r12_pod_setups st where st.business_id=b and st.installation_id=prior.id)
 or exists(select 1 from private.r12_pod_setups st where st.installation_id=prior.id and (st.business_id<>b or st.owner_id<>auth.uid() or st.preview->'sourcePolicy' is null
 or not exists(select 1 from private.r12_pod_templates old where old.id=st.template_id and old.version in ('r12.pod-template.2','r12.pod-template.3') and old.pins->'snapshot'=prior.snapshot)
 or not exists(select 1 from private.r05_revocations revoked where revoked.policy_id=st.policy_id and revoked.business_id=b)))
 then raise exception 'r12_pod_installation_predecessor_not_stopped';end if;
 -- All authority referencing the old installation, including non-POD policies,
 -- must have an exact stopped POD ancestor. Never strand unrelated grants.
 if exists(select 1 from private.r05_policies policy where exists(select 1 from jsonb_array_elements(policy.payload->'operations') op where op->>'installationId'=prior.id::text)
 and (policy.business_id<>b or not exists(select 1 from private.r12_pod_setups st join private.r05_revocations revoked on revoked.policy_id=st.policy_id and revoked.business_id=st.business_id
 where st.business_id=b and st.installation_id=prior.id and st.policy_id=policy.id and st.policy_hash=policy.content_hash)))
 or exists(select 1 from public.workflow_runs w where w.pack_installation_id=prior.id and (w.business_id<>b or w.pack_snapshot is distinct from prior.snapshot
 or not exists(select 1 from private.r07_attempts a join private.r07_plans p on p.id=a.plan_id join private.r12_pod_setups st on st.policy_id=p.policy_id
 join private.r05_revocations revoked on revoked.policy_id=st.policy_id and revoked.business_id=st.business_id
 where a.id=w.id and a.business_id=b and p.business_id=b and st.business_id=b and st.installation_id=prior.id)))
 then raise exception 'r12_pod_installation_unbound_authority';end if;
 -- Known cost alone cannot erase an outstanding send/receipt. Every old request
 -- is either demonstrably unsent/released or exactly settled with no open read.
 if private.r12_pod_blocking_unknown(b) or exists(select 1 from private.r05_requests r join public.workflow_runs w on w.id=r.workflow_run_id where w.pack_installation_id=prior.id
 and (r.business_id<>b or not (exists(select 1 from private.r05_releases released where released.request_id=r.id and released.business_id=b)
 and not exists(select 1 from private.r05_markers marker where marker.request_id=r.id)
 and not exists(select 1 from private.r07_markers marker where marker.attempt_id=w.id)
 and not exists(select 1 from private.r12_discovery_transport_claims claim where claim.request_id=r.id)) and
 not (exists(select 1 from private.r05_markers marker where marker.request_id=r.id and marker.business_id=b)
 and (select count(distinct actual_microunits)=1 and count(distinct provider_request_id)=1 from private.r05_settlements z where z.request_id=r.id and z.business_id=b)))
 ) or exists(select 1 from private.r12_discovery_receipt_checks q join private.r12_discovery_candidates candidate on candidate.request_id=q.request_id and candidate.receipt_expires_at>clock_timestamp() join private.r05_requests r on r.id=q.request_id join public.workflow_runs w on w.id=r.workflow_run_id
 where w.pack_installation_id=prior.id and not exists(select 1 from private.r12_discovery_receipt_checks later where later.request_id=q.request_id and later.attempt>q.attempt)
 and not exists(select 1 from private.r12_discovery_receipt_observations o where o.check_id=q.id))
 then raise exception 'r12_pod_installation_unsettled';end if;
 update public.installed_packs set status='superseded',superseded_at=clock_timestamp() where id=prior.id;
 iid:=gen_random_uuid();
 insert into public.installed_packs(id,business_id,root_pack_id,root_pack_key,status,snapshot) values(iid,b,pack.id,pack.pack_key,'active',t.pins->'snapshot');
 insert into public.events(business_id,event_type,actor_type,payload) values(b,'pack.activated','owner',jsonb_build_object('installationId',iid,'packKey',pack.pack_key,'version',pack.version));
end $$;
revoke all on function private.r12_pod_thorough_installation(uuid,private.r12_pod_templates) from public,anon,authenticated,service_role;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_pod_owner_server(uuid,text,jsonb,text)'::regprocedure);
 if (length(d)-length(replace(d,$old$ select * into installed from public.installed_packs where business_id=p_business_id and root_pack_id=(t.pins->>'packId')::uuid;$old$,'')))/length($old$ select * into installed from public.installed_packs where business_id=p_business_id and root_pack_id=(t.pins->>'packId')::uuid;$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: public.r12_pod_owner_server(uuid,text,jsonb,text)';end if;
 execute replace(d,$old$ select * into installed from public.installed_packs where business_id=p_business_id and root_pack_id=(t.pins->>'packId')::uuid;$old$,$new$ if t.version='r12.pod-template.4' then perform private.r12_pod_thorough_installation(p_business_id,t);end if;
 select * into installed from public.installed_packs where business_id=p_business_id and root_pack_id=(t.pins->>'packId')::uuid;$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_pod_owner_server(uuid,text,jsonb,text)'::regprocedure);
 if (length(d)-length(replace(d,$old$t.version<>'r12.pod-template.2'$old$,'')))/length($old$t.version<>'r12.pod-template.2'$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: public.r12_pod_owner_server(uuid,text,jsonb,text)';end if;
 execute replace(d,$old$t.version<>'r12.pod-template.2'$old$,$new$t.version not in ('r12.pod-template.2','r12.pod-template.4')$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_pod_owner_server(uuid,text,jsonb,text)'::regprocedure);
 if (length(d)-length(replace(d,$old$ perform private.r12_pod_template_check(t,stamp,true);$old$,'')))/length($old$ perform private.r12_pod_template_check(t,stamp,true);$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: public.r12_pod_owner_server(uuid,text,jsonb,text)';end if;
 execute replace(d,$old$ perform private.r12_pod_template_check(t,stamp,true);$old$,$new$ if t.version='r12.pod-template.4' and t.pins->'recovery' is distinct from 'false'::jsonb then raise exception 'r12_pod_template_mode_mismatch';end if;
 perform private.r12_pod_template_check(t,stamp,true);$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_pod_owner_server(uuid,text,jsonb,text)'::regprocedure);
 if (length(d)-length(replace(d,$old$ perform private.r12_pod_quote_check(q,case when p_operation='confirm' then s.preview->'quote' else null end);$old$,'')))/length($old$ perform private.r12_pod_quote_check(q,case when p_operation='confirm' then s.preview->'quote' else null end);$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: public.r12_pod_owner_server(uuid,text,jsonb,text)';end if;
 execute replace(d,$old$ perform private.r12_pod_quote_check(q,case when p_operation='confirm' then s.preview->'quote' else null end);$old$,$new$ perform private.r12_pod_quote_check(q,case when p_operation='confirm' then s.preview->'quote' else null end);
 if (t.version='r12.pod-template.4') is distinct from (q->>'version'='r12.pod-quote.3') or (t.version='r12.pod-template.4' and q->>'profileHash' is distinct from t.pins->>'profileHash') then raise exception 'r12_pod_template_quote_mismatch';end if;$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_pod_owner_server(uuid,text,jsonb,text)'::regprocedure);
 if (length(d)-length(replace(d,$old$bytes:=case phase when 'plan' then 24576 when 'search1' then 8192 when 'select1' then 16384 else 32768 end;$old$,'')))/length($old$bytes:=case phase when 'plan' then 24576 when 'search1' then 8192 when 'select1' then 16384 else 32768 end;$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: public.r12_pod_owner_server(uuid,text,jsonb,text)';end if;
 execute replace(d,$old$bytes:=case phase when 'plan' then 24576 when 'search1' then 8192 when 'select1' then 16384 else 32768 end;$old$,$new$bytes:=case when t.version='r12.pod-template.4' then private.r12_pod_thorough_capacity(phase,'maximumRequestBytes') else case phase when 'plan' then 24576 when 'search1' then 8192 when 'select1' then 16384 else 32768 end end;$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_pod_owner_server(uuid,text,jsonb,text)'::regprocedure);
 if (length(d)-length(replace(d,$old$tokens:=case phase when 'plan' then 1500 when 'search1' then 4000 when 'select1' then 1000 when 'strategy' then 5000 else 4000 end;$old$,'')))/length($old$tokens:=case phase when 'plan' then 1500 when 'search1' then 4000 when 'select1' then 1000 when 'strategy' then 5000 else 4000 end;$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: public.r12_pod_owner_server(uuid,text,jsonb,text)';end if;
 execute replace(d,$old$tokens:=case phase when 'plan' then 1500 when 'search1' then 4000 when 'select1' then 1000 when 'strategy' then 5000 else 4000 end;$old$,$new$tokens:=case when t.version='r12.pod-template.4' then private.r12_pod_thorough_capacity(phase,'outputTokens') else case phase when 'plan' then 1500 when 'search1' then 4000 when 'select1' then 1000 when 'strategy' then 5000 else 4000 end end;$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_pod_owner_server(uuid,text,jsonb,text)'::regprocedure);
 if (length(d)-length(replace(d,$old$ insert into private.r12_pod_setups(id,business_id$old$,'')))/length($old$ insert into private.r12_pod_setups(id,business_id$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: public.r12_pod_owner_server(uuid,text,jsonb,text)';end if;
 execute replace(d,$old$ insert into private.r12_pod_setups(id,business_id$old$,$new$ if t.version='r12.pod-template.4' then preview:=preview||jsonb_build_object('profile',t.pins->>'profile','profileHash',t.pins->>'profileHash','automaticFormatFailureContinuation',true);end if;
 insert into private.r12_pod_setups(id,business_id$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_pod_owner_server(uuid,text,jsonb,text)'::regprocedure);
 if (length(d)-length(replace(d,$old$not between 1 and 24576 then raise exception 'r12_pod_planner_preflight_required'$old$,'')))/length($old$not between 1 and 24576 then raise exception 'r12_pod_planner_preflight_required'$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: public.r12_pod_owner_server(uuid,text,jsonb,text)';end if;
 execute replace(d,$old$not between 1 and 24576 then raise exception 'r12_pod_planner_preflight_required'$old$,$new$not between 1 and (case when t.version='r12.pod-template.4' then 786432 else 24576 end) then raise exception 'r12_pod_planner_preflight_required'$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_pod_owner_server(uuid,text,jsonb,text)'::regprocedure);
 if (length(d)-length(replace(d,$old$amendment:=jsonb_build_object('version','r12.pod-research-goal.2'$old$,'')))/length($old$amendment:=jsonb_build_object('version','r12.pod-research-goal.2'$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: public.r12_pod_owner_server(uuid,text,jsonb,text)';end if;
 execute replace(d,$old$amendment:=jsonb_build_object('version','r12.pod-research-goal.2'$old$,$new$amendment:=jsonb_build_object('version',case when t.version='r12.pod-template.4' then 'r12.pod-research-goal.3' else 'r12.pod-research-goal.2' end$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_pod_recovery_owner_server(uuid,text,jsonb,text)'::regprocedure);
 if (length(d)-length(replace(d,$old$ select * into installed from public.installed_packs where business_id=p_business_id and root_pack_id=(t.pins->>'packId')::uuid;$old$,'')))/length($old$ select * into installed from public.installed_packs where business_id=p_business_id and root_pack_id=(t.pins->>'packId')::uuid;$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: public.r12_pod_recovery_owner_server(uuid,text,jsonb,text)';end if;
 execute replace(d,$old$ select * into installed from public.installed_packs where business_id=p_business_id and root_pack_id=(t.pins->>'packId')::uuid;$old$,$new$ if t.version='r12.pod-template.4' then perform private.r12_pod_thorough_installation(p_business_id,t);end if;
 select * into installed from public.installed_packs where business_id=p_business_id and root_pack_id=(t.pins->>'packId')::uuid;$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_pod_recovery_owner_server(uuid,text,jsonb,text)'::regprocedure);
 if (length(d)-length(replace(d,$old$t.version<>'r12.pod-template.3'$old$,'')))/length($old$t.version<>'r12.pod-template.3'$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: public.r12_pod_recovery_owner_server(uuid,text,jsonb,text)';end if;
 execute replace(d,$old$t.version<>'r12.pod-template.3'$old$,$new$t.version not in ('r12.pod-template.3','r12.pod-template.4')$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_pod_recovery_owner_server(uuid,text,jsonb,text)'::regprocedure);
 if (length(d)-length(replace(d,$old$ perform private.r12_pod_template_check(t,stamp,true);$old$,'')))/length($old$ perform private.r12_pod_template_check(t,stamp,true);$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: public.r12_pod_recovery_owner_server(uuid,text,jsonb,text)';end if;
 execute replace(d,$old$ perform private.r12_pod_template_check(t,stamp,true);$old$,$new$ if t.version='r12.pod-template.4' and t.pins->'recovery' is distinct from 'true'::jsonb then raise exception 'r12_pod_template_mode_mismatch';end if;
 perform private.r12_pod_template_check(t,stamp,true);$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_pod_recovery_owner_server(uuid,text,jsonb,text)'::regprocedure);
 if (length(d)-length(replace(d,$old$ perform private.r12_pod_quote_check(q,case when p_operation='confirm' then s.preview->'quote' else null end);$old$,'')))/length($old$ perform private.r12_pod_quote_check(q,case when p_operation='confirm' then s.preview->'quote' else null end);$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: public.r12_pod_recovery_owner_server(uuid,text,jsonb,text)';end if;
 execute replace(d,$old$ perform private.r12_pod_quote_check(q,case when p_operation='confirm' then s.preview->'quote' else null end);$old$,$new$ perform private.r12_pod_quote_check(q,case when p_operation='confirm' then s.preview->'quote' else null end);
 if (t.version='r12.pod-template.4') is distinct from (q->>'version'='r12.pod-quote.3') or (t.version='r12.pod-template.4' and q->>'profileHash' is distinct from t.pins->>'profileHash') then raise exception 'r12_pod_template_quote_mismatch';end if;$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_pod_recovery_owner_server(uuid,text,jsonb,text)'::regprocedure);
 if (length(d)-length(replace(d,$old$bytes:=case phase when 'plan' then 24576 when 'search1' then 8192 when 'select1' then 16384 else 32768 end;$old$,'')))/length($old$bytes:=case phase when 'plan' then 24576 when 'search1' then 8192 when 'select1' then 16384 else 32768 end;$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: public.r12_pod_recovery_owner_server(uuid,text,jsonb,text)';end if;
 execute replace(d,$old$bytes:=case phase when 'plan' then 24576 when 'search1' then 8192 when 'select1' then 16384 else 32768 end;$old$,$new$bytes:=case when t.version='r12.pod-template.4' then private.r12_pod_thorough_capacity(phase,'maximumRequestBytes') else case phase when 'plan' then 24576 when 'search1' then 8192 when 'select1' then 16384 else 32768 end end;$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_pod_recovery_owner_server(uuid,text,jsonb,text)'::regprocedure);
 if (length(d)-length(replace(d,$old$tokens:=case phase when 'plan' then 1500 when 'search1' then 4000 when 'select1' then 1000 when 'strategy' then 5000 else 4000 end;$old$,'')))/length($old$tokens:=case phase when 'plan' then 1500 when 'search1' then 4000 when 'select1' then 1000 when 'strategy' then 5000 else 4000 end;$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: public.r12_pod_recovery_owner_server(uuid,text,jsonb,text)';end if;
 execute replace(d,$old$tokens:=case phase when 'plan' then 1500 when 'search1' then 4000 when 'select1' then 1000 when 'strategy' then 5000 else 4000 end;$old$,$new$tokens:=case when t.version='r12.pod-template.4' then private.r12_pod_thorough_capacity(phase,'outputTokens') else case phase when 'plan' then 1500 when 'search1' then 4000 when 'select1' then 1000 when 'strategy' then 5000 else 4000 end end;$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_pod_recovery_owner_server(uuid,text,jsonb,text)'::regprocedure);
 if (length(d)-length(replace(d,$old$ insert into private.r12_pod_setups(id,business_id$old$,'')))/length($old$ insert into private.r12_pod_setups(id,business_id$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: public.r12_pod_recovery_owner_server(uuid,text,jsonb,text)';end if;
 execute replace(d,$old$ insert into private.r12_pod_setups(id,business_id$old$,$new$ if t.version='r12.pod-template.4' then preview:=preview||jsonb_build_object('profile',t.pins->>'profile','profileHash',t.pins->>'profileHash','automaticFormatFailureContinuation',true);end if;
 insert into private.r12_pod_setups(id,business_id$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_pod_recovery_owner_server(uuid,text,jsonb,text)'::regprocedure);
 if (length(d)-length(replace(d,$old$not between 1 and 24576 then raise exception 'r12_pod_planner_preflight_required'$old$,'')))/length($old$not between 1 and 24576 then raise exception 'r12_pod_planner_preflight_required'$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: public.r12_pod_recovery_owner_server(uuid,text,jsonb,text)';end if;
 execute replace(d,$old$not between 1 and 24576 then raise exception 'r12_pod_planner_preflight_required'$old$,$new$not between 1 and (case when t.version='r12.pod-template.4' then 786432 else 24576 end) then raise exception 'r12_pod_planner_preflight_required'$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_pod_recovery_owner_server(uuid,text,jsonb,text)'::regprocedure);
 if (length(d)-length(replace(d,$old$amendment:=jsonb_build_object('version','r12.pod-research-goal.2'$old$,'')))/length($old$amendment:=jsonb_build_object('version','r12.pod-research-goal.2'$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: public.r12_pod_recovery_owner_server(uuid,text,jsonb,text)';end if;
 execute replace(d,$old$amendment:=jsonb_build_object('version','r12.pod-research-goal.2'$old$,$new$amendment:=jsonb_build_object('version',case when t.version='r12.pod-template.4' then 'r12.pod-research-goal.3' else 'r12.pod-research-goal.2' end$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_pod_research_read(uuid,uuid,uuid,uuid)'::regprocedure);
 if (length(d)-length(replace(d,$old$x.version='r12.pod-template.2'$old$,'')))/length($old$x.version='r12.pod-template.2'$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: public.r12_pod_research_read(uuid,uuid,uuid,uuid)';end if;
 execute replace(d,$old$x.version='r12.pod-template.2'$old$,$new$(x.version='r12.pod-template.2' or x.version='r12.pod-template.4' and x.pins->'recovery'='false'::jsonb)$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_pod_research_read(uuid,uuid,uuid,uuid)'::regprocedure);
 if (length(d)-length(replace(d,$old$'validUntil',t.valid_until)$old$,'')))/length($old$'validUntil',t.valid_until)$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: public.r12_pod_research_read(uuid,uuid,uuid,uuid)';end if;
 execute replace(d,$old$'validUntil',t.valid_until)$old$,$new$'validUntil',t.valid_until)||case when t.version='r12.pod-template.4' then jsonb_build_object('profile',t.pins->>'profile','profileHash',t.pins->>'profileHash') else '{}'::jsonb end$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_pod_recovery_read(uuid,uuid)'::regprocedure);
 if (length(d)-length(replace(d,$old$x.version='r12.pod-template.3'$old$,'')))/length($old$x.version='r12.pod-template.3'$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: public.r12_pod_recovery_read(uuid,uuid)';end if;
 execute replace(d,$old$x.version='r12.pod-template.3'$old$,$new$(x.version='r12.pod-template.3' or x.version='r12.pod-template.4' and x.pins->'recovery'='true'::jsonb)$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_pod_recovery_read(uuid,uuid)'::regprocedure);
 if (length(d)-length(replace(d,$old$'validUntil',t.valid_until)$old$,'')))/length($old$'validUntil',t.valid_until)$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: public.r12_pod_recovery_read(uuid,uuid)';end if;
 execute replace(d,$old$'validUntil',t.valid_until)$old$,$new$'validUntil',t.valid_until)||case when t.version='r12.pod-template.4' then jsonb_build_object('profile',t.pins->>'profile','profileHash',t.pins->>'profileHash') else '{}'::jsonb end$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_plan_lineage(private.r07_plans)'::regprocedure);
 if (length(d)-length(replace(d,$old$t.version='r12.pod-template.3'$old$,'')))/length($old$t.version='r12.pod-template.3'$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_plan_lineage(private.r07_plans)';end if;
 execute replace(d,$old$t.version='r12.pod-template.3'$old$,$new$t.version in ('r12.pod-template.3','r12.pod-template.4')$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_scope_resolve(private.r12_discovery_scopes,timestamp with time zone,boolean)'::regprocedure);
 if (length(d)-length(replace(d,$old$a->>'version' is distinct from 'r12.pod-research-goal.2'$old$,'')))/length($old$a->>'version' is distinct from 'r12.pod-research-goal.2'$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_scope_resolve(private.r12_discovery_scopes,timestamp with time zone,boolean)';end if;
 execute replace(d,$old$a->>'version' is distinct from 'r12.pod-research-goal.2'$old$,$new$a->>'version' is distinct from (case when t.version='r12.pod-template.4' then 'r12.pod-research-goal.3' else 'r12.pod-research-goal.2' end) or (t.version='r12.pod-template.4' and (setup.preview->>'profile' is distinct from t.pins->>'profile' or setup.preview->>'profileHash' is distinct from t.pins->>'profileHash'))$new$);end $patch$;

do $constraint$ declare c record;d text;old text:='((amendment ->> ''version''::text) = ''r12.pod-research-goal.2''::text)';begin
 for c in select oid,conname from pg_constraint where conrelid='private.r12_discovery_scopes'::regclass and contype='c' loop
 d:=pg_get_constraintdef(c.oid);
 if position('r12.pod-research-goal.2' in d)>0 then
 if position(old in d)=0 then raise exception 'r12_pod_scope_constraint_drift';end if;
 execute format('alter table private.r12_discovery_scopes drop constraint %I',c.conname);
 d:=replace(d,old,'((amendment ->> ''version''::text) IN (''r12.pod-research-goal.2'',''r12.pod-research-goal.3''))');
 execute format('alter table private.r12_discovery_scopes add constraint %I %s',c.conname,d);end if;end loop;end $constraint$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_discovery_scope_validate()'::regprocedure);
 if (length(d)-length(replace(d,$old$a->>'version'='r12.pod-research-goal.2'$old$,'')))/length($old$a->>'version'='r12.pod-research-goal.2'$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_discovery_scope_validate()';end if;
 execute replace(d,$old$a->>'version'='r12.pod-research-goal.2'$old$,$new$a->>'version' in ('r12.pod-research-goal.2','r12.pod-research-goal.3')$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_discovery_result_read(uuid,uuid)'::regprocedure);
 if (length(d)-length(replace(d,$old$s.amendment->>'version'='r12.pod-research-goal.2'$old$,'')))/length($old$s.amendment->>'version'='r12.pod-research-goal.2'$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: public.r12_discovery_result_read(uuid,uuid)';end if;
 execute replace(d,$old$s.amendment->>'version'='r12.pod-research-goal.2'$old$,$new$s.amendment->>'version' in ('r12.pod-research-goal.2','r12.pod-research-goal.3')$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_plan_qualification(uuid,uuid,jsonb)'::regprocedure);
 if (length(d)-length(replace(d,$old$s.amendment->>'version'='r12.pod-research-goal.2'$old$,'')))/length($old$s.amendment->>'version'='r12.pod-research-goal.2'$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_plan_qualification(uuid,uuid,jsonb)';end if;
 execute replace(d,$old$s.amendment->>'version'='r12.pod-research-goal.2'$old$,$new$s.amendment->>'version' in ('r12.pod-research-goal.2','r12.pod-research-goal.3')$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_discovery_owner_read_before_funding_proof(uuid,uuid,boolean)'::regprocedure);
 if (length(d)-length(replace(d,$old$'r12.pod-research-goal.2'),false)$old$,'')))/length($old$'r12.pod-research-goal.2'),false)$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_discovery_owner_read_before_funding_proof(uuid,uuid,boolean)';end if;
 execute replace(d,$old$'r12.pod-research-goal.2'),false)$old$,$new$'r12.pod-research-goal.2','r12.pod-research-goal.3'),false)$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_accepted_plan(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes)'::regprocedure);
 if (length(d)-length(replace(d,$old$perform private.r04_safe(v);$old$,'')))/length($old$perform private.r04_safe(v);$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_accepted_plan(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes)';end if;
 execute replace(d,$old$perform private.r04_safe(v);$old$,$new$if s.amendment->>'version'='r12.pod-research-goal.3' then perform private.r12_pod_thorough_safe(v);else perform private.r04_safe(v);end if;$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_accepted_plan(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes)'::regprocedure);
 if (length(d)-length(replace(d,$old$40 and 700$old$,'')))/length($old$40 and 700$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_accepted_plan(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes)';end if;
 execute replace(d,$old$40 and 700$old$,$new$40 and (case when s.amendment->>'version'='r12.pod-research-goal.3' then 8000 else 700 end)$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_accepted_plan(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes)'::regprocedure);
 if (length(d)-length(replace(d,$old$20 and 800$old$,'')))/length($old$20 and 800$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_accepted_plan(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes)';end if;
 execute replace(d,$old$20 and 800$old$,$new$20 and (case when s.amendment->>'version'='r12.pod-research-goal.3' then 4000 else 800 end)$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_accepted_plan(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes)'::regprocedure);
 if (length(d)-length(replace(d,$old$30 and 500$old$,'')))/length($old$30 and 500$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_accepted_plan(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes)';end if;
 execute replace(d,$old$30 and 500$old$,$new$30 and (case when s.amendment->>'version'='r12.pod-research-goal.3' then 8000 else 500 end)$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_accepted_plan(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes)'::regprocedure);
 if (length(d)-length(replace(d,$old$1 and 3$old$,'')))/length($old$1 and 3$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_accepted_plan(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes)';end if;
 execute replace(d,$old$1 and 3$old$,$new$1 and (case when s.amendment->>'version'='r12.pod-research-goal.3' then 16 else 3 end)$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_accepted_plan(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes)'::regprocedure);
 if (length(d)-length(replace(d,$old$else 400 end)$old$,'')))/length($old$else 400 end)$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_accepted_plan(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes)';end if;
 execute replace(d,$old$else 400 end)$old$,$new$else case when s.amendment->>'version'='r12.pod-research-goal.3' then 4800 else 400 end end)$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_accepted_plan(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes)'::regprocedure);
 if (length(d)-length(replace(d,$old$perform private.r04_strings(v->'sourceDomains',6);$old$,'')))/length($old$perform private.r04_strings(v->'sourceDomains',6);$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_accepted_plan(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes)';end if;
 execute replace(d,$old$perform private.r04_strings(v->'sourceDomains',6);$old$,$new$perform private.r04_strings(v->'sourceDomains',case when s.amendment->>'version'='r12.pod-research-goal.3' then 16 else 6 end);$new$);end $patch$;

CREATE OR REPLACE FUNCTION private.r12_pod_thorough_domains(v jsonb, policy jsonb)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare d text;begin
 perform private.r04_strings(v,16);
 if jsonb_array_length(v)<1 or v is distinct from (select jsonb_agg(x order by x collate "C") from (select distinct jsonb_array_elements_text(v)x)q) then raise exception 'r12_pod_domains_invalid';end if;
 for d in select jsonb_array_elements_text(v) loop
 if d !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' or length(d)>200 or d ~ '(^|\.)(local|internal|localhost|invalid|test|example|onion)$'
 or exists(select 1 from jsonb_array_elements_text(policy->'excludedDomains')e where d=e or d like '%.'||e or e like '%.'||d)
 then raise exception 'r12_pod_domains_invalid';end if;end loop;
end $function$
;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_accepted_plan(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes)'::regprocedure);
 if (length(d)-length(replace(d,$old$perform private.r12_pod_domains(v->'sourceDomains',s.amendment->'sourcePolicy');$old$,'')))/length($old$perform private.r12_pod_domains(v->'sourceDomains',s.amendment->'sourcePolicy');$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_accepted_plan(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes)';end if;
 execute replace(d,$old$perform private.r12_pod_domains(v->'sourceDomains',s.amendment->'sourcePolicy');$old$,$new$if s.amendment->>'version'='r12.pod-research-goal.3' then perform private.r12_pod_thorough_domains(v->'sourceDomains',s.amendment->'sourcePolicy');else perform private.r12_pod_domains(v->'sourceDomains',s.amendment->'sourcePolicy');end if;$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_accepted_plan(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes)'::regprocedure);
 if (length(d)-length(replace(d,$old$length(v->>'comparisonRationale')$old$,'')))/length($old$length(v->>'comparisonRationale')$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_accepted_plan(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes)';end if;
 execute replace(d,$old$length(v->>'comparisonRationale')$old$,$new$(case when s.amendment->>'version'='r12.pod-research-goal.3' then private.r12_pod_utf16_length(v->>'comparisonRationale') else length(v->>'comparisonRationale') end)$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_accepted_plan(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes)'::regprocedure);
 if (length(d)-length(replace(d,$old$length(v->>'query')$old$,'')))/length($old$length(v->>'query')$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_accepted_plan(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes)';end if;
 execute replace(d,$old$length(v->>'query')$old$,$new$(case when s.amendment->>'version'='r12.pod-research-goal.3' then private.r12_pod_utf16_length(v->>'query') else length(v->>'query') end)$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_accepted_plan(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes)'::regprocedure);
 if (length(d)-length(replace(d,$old$length(v->>'sourceChoiceRationale')$old$,'')))/length($old$length(v->>'sourceChoiceRationale')$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_accepted_plan(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes)';end if;
 execute replace(d,$old$length(v->>'sourceChoiceRationale')$old$,$new$(case when s.amendment->>'version'='r12.pod-research-goal.3' then private.r12_pod_utf16_length(v->>'sourceChoiceRationale') else length(v->>'sourceChoiceRationale') end)$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_accepted_plan(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes)'::regprocedure);
 if (length(d)-length(replace(d,$old$length(h->>t)$old$,'')))/length($old$length(h->>t)$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_accepted_plan(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes)';end if;
 execute replace(d,$old$length(h->>t)$old$,$new$(case when s.amendment->>'version'='r12.pod-research-goal.3' then private.r12_pod_utf16_length(h->>t) else length(h->>t) end)$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_collection(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes)'::regprocedure);
 if (length(d)-length(replace(d,$old$jsonb_array_length(sources) not between 1 and 4$old$,'')))/length($old$jsonb_array_length(sources) not between 1 and 4$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_collection(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes)';end if;
 execute replace(d,$old$jsonb_array_length(sources) not between 1 and 4$old$,$new$jsonb_array_length(sources) not between (case when s.amendment->>'version'='r12.pod-research-goal.3' then 0 else 1 end) and (case when s.amendment->>'version'='r12.pod-research-goal.3' then 25 else 4 end)$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_collection(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes)'::regprocedure);
 if (length(d)-length(replace(d,$old$'queryProvenance','application_submitted_query'));$old$,'')))/length($old$'queryProvenance','application_submitted_query'));$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_collection(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes)';end if;
 execute replace(d,$old$'queryProvenance','application_submitted_query'));$old$,$new$'queryProvenance','application_submitted_query')||case when s.amendment->>'version'='r12.pod-research-goal.3' then jsonb_build_object('sourceMethod',jsonb_build_object('providerHighlight',true,'fullPageRead',false,'requestedResults',25,'requestedCharacters',8000,'localTruncation',false)) else '{}'::jsonb end);$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_candidate_sources(private.r07_attempts,private.r07_plans,jsonb)'::regprocedure);
 if (length(d)-length(replace(d,$old$jsonb_array_length(v->'output'->'annotations')>4$old$,'')))/length($old$jsonb_array_length(v->'output'->'annotations')>4$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_candidate_sources(private.r07_attempts,private.r07_plans,jsonb)';end if;
 execute replace(d,$old$jsonb_array_length(v->'output'->'annotations')>4$old$,$new$jsonb_array_length(v->'output'->'annotations')>(case when s.amendment->>'version'='r12.pod-research-goal.3' then 25 else 4 end)$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_candidate_sources(private.r07_attempts,private.r07_plans,jsonb)'::regprocedure);
 if (length(d)-length(replace(d,$old$length(x->'url_citation'->>'content') not between 30 and 1800$old$,'')))/length($old$length(x->'url_citation'->>'content') not between 30 and 1800$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_candidate_sources(private.r07_attempts,private.r07_plans,jsonb)';end if;
 execute replace(d,$old$length(x->'url_citation'->>'content') not between 30 and 1800$old$,$new$(case when s.amendment->>'version'='r12.pod-research-goal.3' then private.r12_pod_utf16_length(x->'url_citation'->>'content') else length(x->'url_citation'->>'content') end) not between 30 and (case when s.amendment->>'version'='r12.pod-research-goal.3' then 8000 else 1800 end)$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_evidence_view(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes)'::regprocedure);
 if (length(d)-length(replace(d,$old$length(selection->>'quote') not between 20 and 320$old$,'')))/length($old$length(selection->>'quote') not between 20 and 320$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_evidence_view(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes)';end if;
 execute replace(d,$old$length(selection->>'quote') not between 20 and 320$old$,$new$(case when s.amendment->>'version'='r12.pod-research-goal.3' then private.r12_pod_utf16_length(selection->>'quote') else length(selection->>'quote') end) not between 20 and (case when s.amendment->>'version'='r12.pod-research-goal.3' then 2400 else 320 end)$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_evidence_view(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes)'::regprocedure);
 if (length(d)-length(replace(d,$old$ord not between 1 and 4$old$,'')))/length($old$ord not between 1 and 4$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_evidence_view(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes)';end if;
 execute replace(d,$old$ord not between 1 and 4$old$,$new$ord not between (case when s.amendment->>'version'='r12.pod-research-goal.3' then 0 else 1 end) and (case when s.amendment->>'version'='r12.pod-research-goal.3' then 48 else 4 end)$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_evidence_view(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes)'::regprocedure);
 if (length(d)-length(replace(d,$old$ for selection in select value$old$,'')))/length($old$ for selection in select value$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_evidence_view(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes)';end if;
 execute replace(d,$old$ for selection in select value$old$,$new$ if s.amendment->>'version'='r12.pod-research-goal.3' and jsonb_array_length(d->'candidate'->'output'->'selections')=0 and not (d->'candidate'->'output'->'limitations' ? 'limited_sources') then raise exception 'r12_pod_empty_selection_limit_required';end if;
 for selection in select value$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_evidence_view(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes)'::regprocedure);
 if (length(d)-length(replace(d,$old$ ord:=ord+1;$old$,'')))/length($old$ ord:=ord+1;$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_evidence_view(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes)';end if;
 execute replace(d,$old$ ord:=ord+1;$old$,$new$ if s.amendment->>'version'='r12.pod-research-goal.3' and (selection->>'sourceKey' !~ '^S[1-9][0-9]{0,2}$' or selection->>'quote'<>btrim(selection->>'quote') or position('[...]' in selection->>'quote')>0 or exists(select 1 from jsonb_array_elements(result) e where e->>'quote'=selection->>'quote' and e->>'url'=source->>'url') or not exists(select 1 from private.r12_discovery_wires w,jsonb_array_elements(((w.binding->>'requestJson')::jsonb->'messages'->1->>'content')::jsonb->'sources') src where w.attempt_id=dep.id and src->>'sourceKey'=selection->>'sourceKey' and src-'sourceKey'=source)) then raise exception 'r12_pod_exact_span_required';end if;
 ord:=ord+1;$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_pass_history(private.r07_plans,integer)'::regprocedure);
 if (length(d)-length(replace(d,$old$if review is null or jsonb_array_length(queries)<>pass or hypotheses is null$old$,'')))/length($old$if review is null or jsonb_array_length(queries)<>pass or hypotheses is null$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_pass_history(private.r07_plans,integer)';end if;
 execute replace(d,$old$if review is null or jsonb_array_length(queries)<>pass or hypotheses is null$old$,$new$if private.r12_pod_thorough_scope((p.content->>'discoveryScopeId')::uuid) then hypotheses:=coalesce(hypotheses,'[]'::jsonb);end if;
 if review is null or jsonb_array_length(queries)<>pass or hypotheses is null$new$);end $patch$;

-- A projection is a set of complete immutable source records. Every omission
-- is named in original collection order; no quote or provenance may be edited.
create function private.r12_pod_source_projection_check(sources jsonb,coverage jsonb,collection jsonb) returns void language plpgsql immutable set search_path='' as $$
declare src jsonb;expected jsonb;omitted jsonb;begin
 if jsonb_typeof(sources) is distinct from 'array' or jsonb_typeof(collection->'sources') is distinct from 'array' or jsonb_array_length(sources)>100 then raise exception 'r12_pod_source_projection_invalid';end if;
 for src in select value from jsonb_array_elements(sources) loop
 select value||jsonb_build_object('sourceKey','S'||ord) into expected from jsonb_array_elements(collection->'sources') with ordinality x(value,ord) where value->>'id'=src->>'id';
 if expected is null or src is distinct from expected then raise exception 'r12_pod_source_projection_fabricated';end if;end loop;
 if (select count(distinct value->>'id') from jsonb_array_elements(sources))<>jsonb_array_length(sources) then raise exception 'r12_pod_source_projection_duplicate';end if;
 select coalesce(jsonb_agg(value->'id' order by ord),'[]'::jsonb) into omitted from jsonb_array_elements(collection->'sources') with ordinality x(value,ord) where not exists(select 1 from jsonb_array_elements(sources)y where y->>'id'=x.value->>'id');
 if coverage is distinct from jsonb_build_object('available',jsonb_array_length(collection->'sources'),'retained',jsonb_array_length(sources),'omittedSourceIds',omitted,'reason','whole_source_context_budget','providerHighlight',true,'fullPageRead',false,'localTruncation',false) then raise exception 'r12_pod_source_projection_coverage';end if;
end $$;

create function private.r12_pod_thorough_pack(a private.r07_attempts,p private.r07_plans,s private.r12_discovery_scopes) returns jsonb language plpgsql set search_path='' as $$
declare collection jsonb;view jsonb;d jsonb;dep private.r07_attempts;sources jsonb;evidence jsonb;claims jsonb;limits jsonb;pack jsonb;begin
 collection:=private.r12_pod_collection(a,p,s);view:=private.r12_pod_evidence_view(a,p,s);
 select * into dep from private.r07_attempts where id=(select (x->>'attemptId')::uuid from jsonb_array_elements(a.dependency_pins)x where x->>'stepKey'='select1') and plan_id=p.id;
 d:=private.r12_pod_completed_dependency(dep,p);
 select coalesce(jsonb_agg(src order by ord),'[]'::jsonb) into sources from jsonb_array_elements(collection->'sources') with ordinality x(src,ord) where exists(select 1 from jsonb_array_elements(view)e where e->>'url'=src->>'url');
 select coalesce(jsonb_agg(jsonb_build_object('id',e->>'evidenceId','sourceId',src->>'id','quote',e->>'quote') order by ord),'[]'::jsonb),
 coalesce(jsonb_agg(jsonb_build_object('text',e->>'quote','evidenceId',e->>'evidenceId','sourceId',src->>'id') order by ord),'[]'::jsonb) into evidence,claims
 from jsonb_array_elements(view) with ordinality x(e,ord) join jsonb_array_elements(sources)src on src->>'url'=e->>'url';
 select jsonb_agg(value order by first_ord) into limits from(select value,min(ord) first_ord from jsonb_array_elements('["publication_dates_unknown"]'::jsonb||(d->'candidate'->'output'->'limitations')) with ordinality x(value,ord) group by value)q;
 pack:=jsonb_build_object('evidencePackVersion','1.0','question',collection->>'query','sources',sources,'evidence',evidence,'claims',claims,'limitations',limits);
 if d->'response'->'result'->>'evidencePackHash' is distinct from private.stage14_hash(pack) then raise exception 'r12_pod_evidence_pack_hash_changed';end if;
 return pack;
end $$;
create function private.r12_pod_current_evidence_check(v jsonb,a private.r07_attempts,p private.r07_plans,s private.r12_discovery_scopes) returns void language plpgsql set search_path='' as $$
declare collection jsonb;pack jsonb;items jsonb;idx jsonb;begin
 perform private.r04_keys(v,array['items','sourceIndex','retainedSources','coverage']);
 collection:=private.r12_pod_collection(a,p,s);pack:=private.r12_pod_thorough_pack(a,p,s);
 select coalesce(jsonb_agg(jsonb_build_object('key','E'||ord,'sourceKey','S'||source_ord,'quote',e->>'quote','evidenceId',e->>'id') order by ord),'[]'::jsonb) into items
 from jsonb_array_elements(pack->'evidence') with ordinality x(e,ord) join jsonb_array_elements(collection->'sources') with ordinality y(src,source_ord) on src->>'id'=e->>'sourceId';
 select coalesce(jsonb_agg(jsonb_build_object('id',src->>'id','url',src->>'url','title',src->>'title','contentHash',src->>'contentHash','retrievedAt',src->>'retrievedAt','publishedAt',src->'publishedAt','sourceKey','S'||ord) order by ord),'[]'::jsonb) into idx
 from jsonb_array_elements(collection->'sources') with ordinality x(src,ord) where exists(select 1 from jsonb_array_elements(pack->'sources') z where z->>'id'=src->>'id');
 if v->'items' is distinct from items or v->'sourceIndex' is distinct from idx then raise exception 'r12_pod_selected_evidence_changed';end if;
 perform private.r12_pod_source_projection_check(v->'retainedSources',v->'coverage',collection);
end $$;

-- Every prior pass has a ledger entry, including an honest empty entry when
-- that pass never produced accepted selected evidence. Rejected text is absent.
create function private.r12_pod_prior_evidence(p private.r07_plans,pass integer) returns jsonb language plpgsql set search_path='' as $$
declare archive jsonb:='[]';n integer;a private.r07_attempts;ap private.r07_plans;s private.r12_discovery_scopes;r private.r07_responses;collection jsonb;pack jsonb;items jsonb;predecessor uuid;begin
 if pass not between 0 and 4 then raise exception 'r12_pod_archive_pass_invalid';end if;
 select (proof->>'predecessorScopeId')::uuid into predecessor from private.r12_pod_recoveries where scope_id=(p.content->>'discoveryScopeId')::uuid;
 if pass=0 then return archive;end if;
 for n in 0..pass-1 loop
 select x.* into a from private.r12_pod_pass_calls call join private.r07_attempts x on x.id=call.attempt_id
 join private.r07_responses rr on rr.attempt_id=x.id and rr.content->>'outcome'='accepted'
 where call.scope_id in((p.content->>'discoveryScopeId')::uuid,predecessor) and call.ordinal=n and call.phase='select1' and x.status='completed';
 if a.id is null then archive:=archive||jsonb_build_array(jsonb_build_object('pass',n,'collectionHash',private.stage14_hash('null'::jsonb),'evidencePackHash',private.stage14_hash('null'::jsonb),'items','[]'::jsonb));continue;end if;
 select * into ap from private.r07_plans where id=a.plan_id;select * into s from private.r12_discovery_scopes where id=(ap.content->>'discoveryScopeId')::uuid;
 select * into r from private.r07_responses where attempt_id=a.id;
 a.dependency_pins:=a.dependency_pins||jsonb_build_array(jsonb_build_object('stepKey','select1','attemptId',a.id,'resultHash',r.content_hash,'artifactId',r.artifact_id));
 collection:=private.r12_pod_collection(a,ap,s);items:=private.r12_pod_evidence_view(a,ap,s);
 archive:=archive||jsonb_build_array(jsonb_build_object('pass',n,'collectionHash',private.stage14_hash(collection),'evidencePackHash',r.content->'result'->>'evidencePackHash','items',items));
 end loop;return archive;
end $$;
create function private.r12_pod_prior_projection_check(v jsonb,archives jsonb) returns void language plpgsql immutable set search_path='' as $$
declare all_items jsonb;item jsonb;expected jsonb;omitted jsonb;begin
 perform private.r04_keys(v,array['items','coverage']);
 if jsonb_typeof(v->'items') is distinct from 'array' then raise exception 'r12_pod_prior_projection_invalid';end if;
 select coalesce(jsonb_agg(e||jsonb_build_object('key','P'||((a->>'pass')::integer+1)||'E'||ord,'pass',(a->>'pass')::integer,'collectionHash',a->>'collectionHash','evidencePackHash',a->>'evidencePackHash') order by (a->>'pass')::integer,ord),'[]'::jsonb) into all_items
 from jsonb_array_elements(archives)a cross join jsonb_array_elements(a->'items') with ordinality x(e,ord);
 for item in select value from jsonb_array_elements(v->'items') loop
 select value into expected from jsonb_array_elements(all_items)x where x->>'key'=item->>'key';
 if expected is null or expected is distinct from item then raise exception 'r12_pod_prior_projection_fabricated';end if;end loop;
 if (select count(distinct value->>'key') from jsonb_array_elements(v->'items'))<>jsonb_array_length(v->'items') then raise exception 'r12_pod_prior_projection_duplicate';end if;
 select coalesce(jsonb_agg(x->'key' order by ord),'[]'::jsonb) into omitted from jsonb_array_elements(all_items) with ordinality e(x,ord) where not exists(select 1 from jsonb_array_elements(v->'items') y where y->>'key'=x->>'key');
 if v->'coverage' is distinct from jsonb_build_object('available',jsonb_array_length(all_items),'retained',jsonb_array_length(v->'items'),'omittedEvidenceKeys',omitted,'reason','whole_quote_context_budget','quotesTruncated',false) then raise exception 'r12_pod_prior_projection_coverage';end if;
end $$;

create function private.r12_pod_thorough_payload_check(request jsonb,payload jsonb,a private.r07_attempts,p private.r07_plans,s private.r12_discovery_scopes,t private.r12_pod_templates,phase text,research_plan jsonb) returns void language plpgsql set search_path='' as $$
declare collection jsonb;dep private.r07_attempts;d jsonb;strategy_payload jsonb;begin
 if request->'requestMetadata'->>'r12PodProfile' is distinct from 'r12.pod-thorough.1' or payload->'aggregateOutputBytes' is distinct from to_jsonb(private.r12_pod_thorough_capacity(phase,'maximumArtifactBytes')) then raise exception 'r12_pod_profile_payload_required';end if;
 if phase='plan' then
 perform private.r04_keys(payload,array['publicBrief','excludedDomains','sourceMethod','outputLimits','refinement','priorEvidence','aggregateOutputBytes']);
 if payload->'refinement' is distinct from coalesce(private.r12_pod_pass_history(p,a.adaptive_action_ordinal),'null'::jsonb)
 or request->'requestMetadata'->>'r12PodPassHash' is distinct from a.adaptive_action_hash or request->'requestMetadata'->'r12PodPassOrdinal' is distinct from to_jsonb(a.adaptive_action_ordinal)
 or request->'requestMetadata'->>'r12PodHistoryHash' is distinct from private.stage14_hash(coalesce(private.r12_pod_pass_history(p,a.adaptive_action_ordinal),'null'::jsonb))
 or payload->'excludedDomains' is distinct from s.amendment->'sourcePolicy'->'excludedDomains'
 or payload->>'sourceMethod' is distinct from 'One OpenRouter/Exa search, up to twenty-five 8000-character highlights; whole-source context omissions are disclosed. No full-page read or Etsy marketplace access.' then raise exception 'r12_pod_public_projection_required';end if;
 perform private.r12_pod_prior_projection_check(payload->'priorEvidence',private.r12_pod_prior_evidence(p,a.adaptive_action_ordinal));
 elsif phase='select1' then
 perform private.r04_keys(payload,array['publicBrief','submittedQuery','sources','coverage','outputLimits','aggregateOutputBytes']);
 collection:=private.r12_pod_collection(a,p,s);
 if payload->>'submittedQuery' is distinct from research_plan->>'query' then raise exception 'r12_pod_public_projection_required';end if;
 perform private.r12_pod_source_projection_check(payload->'sources',payload->'coverage',collection);
 else
 perform private.r12_pod_current_evidence_check(payload->'evidence',a,p,s);
 perform private.r12_pod_prior_projection_check(payload->'priorEvidence',private.r12_pod_prior_evidence(p,a.adaptive_action_ordinal));
 if phase='strategy' then
 perform private.r04_keys(payload,array['publicBrief','preliminaryPlan','evidence','dimensions','outputLimits','aggregateOutputBytes','priorEvidence','maximumAssessmentEmbeddedBytes']);
 if payload->'preliminaryPlan' is distinct from jsonb_build_object('comparisonRationale',research_plan->>'comparisonRationale','query',research_plan->>'query','hypotheses',research_plan->'hypotheses')
 or payload->'dimensions' is distinct from '["buyer_need","competition_and_differentiation","pod_fulfilment","unit_economics","rights_and_restrictions"]'::jsonb
 or jsonb_typeof(payload->'maximumAssessmentEmbeddedBytes') is distinct from 'number' or payload->>'maximumAssessmentEmbeddedBytes' !~ '^[1-9][0-9]{0,5}$' or (payload->>'maximumAssessmentEmbeddedBytes')::integer not between 16384 and 98304 then raise exception 'r12_pod_public_projection_required';end if;
 elsif phase='review' then
 perform private.r04_keys(payload,array['publicBrief','evidence','assessment','checks','outputLimits','aggregateOutputBytes','priorEvidence']);
 select * into dep from private.r07_attempts where plan_id=p.id and business_id=p.business_id and step_key='strategy' and id=(select (pin->>'attemptId')::uuid from jsonb_array_elements(a.dependency_pins)pin where pin->>'stepKey'='strategy') and adaptive_action_ordinal=a.adaptive_action_ordinal and adaptive_action_hash=a.adaptive_action_hash;
 d:=private.r12_pod_completed_dependency(dep,p);strategy_payload:=(d->'binding'->'request'->'messages'->1->>'content')::jsonb;
 if payload->'assessment' is distinct from d->'candidate'->'output' or payload->'checks' is distinct from '["goal_alignment","source_quality_and_independence","claim_support","counterevidence","pod_feasibility","uncertainty_and_next_test"]'::jsonb
 or payload->'evidence' is distinct from strategy_payload->'evidence' or payload->'priorEvidence' is distinct from strategy_payload->'priorEvidence'
 or private.r12_pod_embedded_bytes(payload->'assessment')>(strategy_payload->>'maximumAssessmentEmbeddedBytes')::integer then raise exception 'r12_pod_assessment_exact_context_required';end if;
 else raise exception 'r12_pod_phase_invalid';end if;
 end if;
end $$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_phase_inputs(private.r07_attempts,private.r07_plans)'::regprocedure);
 if (length(d)-length(replace(d,$old$'hasUncertainCosts',false);$old$,'')))/length($old$'hasUncertainCosts',false);$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_phase_inputs(private.r07_attempts,private.r07_plans)';end if;
 execute replace(d,$old$'hasUncertainCosts',false);$old$,$new$'hasUncertainCosts',false)||case when s.amendment->>'version'='r12.pod-research-goal.3' then jsonb_build_object('priorEvidence',private.r12_pod_prior_evidence(p,a.adaptive_action_ordinal)) else '{}'::jsonb end;$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb)'::regprocedure);
 if (length(d)-length(replace(d,$old$maximum_bytes:=case when p.content->>'format'='r12.discovery-pilot.1'$old$,'')))/length($old$maximum_bytes:=case when p.content->>'format'='r12.discovery-pilot.1'$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb)';end if;
 execute replace(d,$old$maximum_bytes:=case when p.content->>'format'='r12.discovery-pilot.1'$old$,$new$maximum_bytes:=case when s.amendment->>'version'='r12.pod-research-goal.3' then private.r12_pod_thorough_capacity(phase,'maximumRequestBytes') when p.content->>'format'='r12.discovery-pilot.1'$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb)'::regprocedure);
 if (length(d)-length(replace(d,$old$tokens:=case phase when 'plan' then 1500 when 'search1' then 4000 when 'select1' then 1000 when 'strategy' then 5000 when 'review' then 4000 end;$old$,'')))/length($old$tokens:=case phase when 'plan' then 1500 when 'search1' then 4000 when 'select1' then 1000 when 'strategy' then 5000 when 'review' then 4000 end;$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb)';end if;
 execute replace(d,$old$tokens:=case phase when 'plan' then 1500 when 'search1' then 4000 when 'select1' then 1000 when 'strategy' then 5000 when 'review' then 4000 end;$old$,$new$tokens:=case when s.amendment->>'version'='r12.pod-research-goal.3' then private.r12_pod_thorough_capacity(phase,'outputTokens') else case phase when 'plan' then 1500 when 'search1' then 4000 when 'select1' then 1000 when 'strategy' then 5000 when 'review' then 4000 end end;$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb)'::regprocedure);
 if (length(d)-length(replace(d,$old$if maximum_bytes is null or octet_length(v->>'wireBody')>maximum_bytes$old$,'')))/length($old$if maximum_bytes is null or octet_length(v->>'wireBody')>maximum_bytes$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb)';end if;
 execute replace(d,$old$if maximum_bytes is null or octet_length(v->>'wireBody')>maximum_bytes$old$,$new$if maximum_bytes is null or octet_length(v->>'wireBody')>maximum_bytes or (s.amendment->>'version'='r12.pod-research-goal.3' and (octet_length(v->>'requestJson')>maximum_bytes or not private.r12_pod_thorough_scope(s.id) or v->'quote'->>'profileHash' is distinct from t.pins->>'profileHash' or v->'quote'->>'profile' is distinct from 'r12.pod-thorough.1'))$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb)'::regprocedure);
 if (length(d)-length(replace(d,$old$else 'r12.pod-quote.2' end)$old$,'')))/length($old$else 'r12.pod-quote.2' end)$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb)';end if;
 execute replace(d,$old$else 'r12.pod-quote.2' end)$old$,$new$when s.amendment->>'version'='r12.pod-research-goal.3' then 'r12.pod-quote.3' else 'r12.pod-quote.2' end)$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb)'::regprocedure);
 if (length(d)-length(replace(d,$old$'providerPriceLimit','requireReturnedModel']);$old$,'')))/length($old$'providerPriceLimit','requireReturnedModel']);$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb)';end if;
 execute replace(d,$old$'providerPriceLimit','requireReturnedModel']);$old$,$new$'providerPriceLimit','requireReturnedModel']||case when s.amendment->>'version'='r12.pod-research-goal.3' then array['researchProfile'] else array[]::text[] end);
 if s.amendment->>'version'='r12.pod-research-goal.3' and request->>'researchProfile' is distinct from 'r12.pod-thorough.1' then raise exception 'r12_pod_profile_payload_required';end if;$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb)'::regprocedure);
 if (length(d)-length(replace(d,$old$'max_results',4,'max_total_results',4,'max_characters',1800$old$,'')))/length($old$'max_results',4,'max_total_results',4,'max_characters',1800$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb)';end if;
 execute replace(d,$old$'max_results',4,'max_total_results',4,'max_characters',1800$old$,$new$'max_results',case when s.amendment->>'version'='r12.pod-research-goal.3' then 25 else 4 end,'max_total_results',case when s.amendment->>'version'='r12.pod-research-goal.3' then 25 else 4 end,'max_characters',case when s.amendment->>'version'='r12.pod-research-goal.3' then 8000 else 1800 end$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb)'::regprocedure);
 if (length(d)-length(replace(d,$old$'pod_research_'||phase||'_v1'$old$,'')))/length($old$'pod_research_'||phase||'_v1'$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb)';end if;
 execute replace(d,$old$'pod_research_'||phase||'_v1'$old$,$new$'pod_research_'||phase||(case when s.amendment->>'version'='r12.pod-research-goal.3' then '_v2' else '_v1' end)$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_pod_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb)'::regprocedure);
 if (length(d)-length(replace(d,$old$ if phase='plan' then
 perform private.r04_keys(payload$old$,'')))/length($old$ if phase='plan' then
 perform private.r04_keys(payload$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_pod_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb)';end if;
 execute replace(d,$old$ if phase='plan' then
 perform private.r04_keys(payload$old$,$new$ if s.amendment->>'version'='r12.pod-research-goal.3' then
 perform private.r12_pod_thorough_payload_check(request,payload,a,p,s,t,phase,research_plan);
 elsif phase='plan' then
 perform private.r04_keys(payload$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_discovery_server_before_funding_proof(uuid,uuid,text,jsonb,text)'::regprocedure);
 if (length(d)-length(replace(d,$old$(case when p.content->>'format'='r12.discovery-evidence.1' then 196608 else 131072 end)$old$,'')))/length($old$(case when p.content->>'format'='r12.discovery-evidence.1' then 196608 else 131072 end)$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_discovery_server_before_funding_proof(uuid,uuid,text,jsonb,text)';end if;
 execute replace(d,$old$(case when p.content->>'format'='r12.discovery-evidence.1' then 196608 else 131072 end)$old$,$new$(case when p.content->>'format'='r12.pod-research.2' and private.r12_pod_thorough_scope((p.content->>'discoveryScopeId')::uuid) then 3408896 when p.content->>'format'='r12.discovery-evidence.1' then 196608 else 131072 end)$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_discovery_server_before_funding_proof(uuid,uuid,text,jsonb,text)'::regprocedure);
 if (length(d)-length(replace(d,$old$UTF8'))>16384$old$,'')))/length($old$UTF8'))>16384$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_discovery_server_before_funding_proof(uuid,uuid,text,jsonb,text)';end if;
 execute replace(d,$old$UTF8'))>16384$old$,$new$UTF8'))>(case when private.r12_pod_thorough_scope(w.scope_id) then 1048576 else 16384 end)$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_discovery_server_before_funding_proof(uuid,uuid,text,jsonb,text)'::regprocedure);
 if (length(d)-length(replace(d,$old$::numeric<=16384)$old$,'')))/length($old$::numeric<=16384)$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_discovery_server_before_funding_proof(uuid,uuid,text,jsonb,text)';end if;
 execute replace(d,$old$::numeric<=16384)$old$,$new$::numeric<=(case when private.r12_pod_thorough_scope(w.scope_id) then 1048576 else 16384 end))$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_discovery_server_before_funding_proof(uuid,uuid,text,jsonb,text)'::regprocedure);
 if (length(d)-length(replace(d,$old$::numeric not between 1 and 16384)$old$,'')))/length($old$::numeric not between 1 and 16384)$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_discovery_server_before_funding_proof(uuid,uuid,text,jsonb,text)';end if;
 execute replace(d,$old$::numeric not between 1 and 16384)$old$,$new$::numeric not between 1 and (case when private.r12_pod_thorough_scope(w.scope_id) then 1048576 else 16384 end))$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_discovery_server_before_funding_proof(uuid,uuid,text,jsonb,text)'::regprocedure);
 if (length(d)-length(replace(d,$old$jsonb_array_length(v->'issues')>12$old$,'')))/length($old$jsonb_array_length(v->'issues')>12$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_discovery_server_before_funding_proof(uuid,uuid,text,jsonb,text)';end if;
 execute replace(d,$old$jsonb_array_length(v->'issues')>12$old$,$new$jsonb_array_length(v->'issues')>(case when private.r12_pod_thorough_scope(w.scope_id) then 16 else 12 end)$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_discovery_server_before_funding_proof(uuid,uuid,text,jsonb,text)'::regprocedure);
 if (length(d)-length(replace(d,$old$'candidate_storage','domain_validation'),false)$old$,'')))/length($old$'candidate_storage','domain_validation'),false)$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_discovery_server_before_funding_proof(uuid,uuid,text,jsonb,text)';end if;
 execute replace(d,$old$'candidate_storage','domain_validation'),false)$old$,$new$'candidate_storage','domain_validation') or (v->>'code'='next_consumer_capacity' and private.r12_pod_thorough_scope(w.scope_id)),false)$new$);end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_discovery_server_before_funding_proof(uuid,uuid,text,jsonb,text)'::regprocedure);
 if (length(d)-length(replace(d,$old$max_bytes:=case when a.step_key='strategy' then 73728 when a.step_key='search1' then 28672 else 20480 end;$old$,'')))/length($old$max_bytes:=case when a.step_key='strategy' then 73728 when a.step_key='search1' then 28672 else 20480 end;$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_discovery_server_before_funding_proof(uuid,uuid,text,jsonb,text)';end if;
 execute replace(d,$old$max_bytes:=case when a.step_key='strategy' then 73728 when a.step_key='search1' then 28672 else 20480 end;$old$,$new$max_bytes:=case when private.r12_pod_thorough_scope(w.scope_id) then private.r12_pod_thorough_capacity(a.step_key,'maximumArtifactBytes')*2+4096 else case when a.step_key='strategy' then 73728 when a.step_key='search1' then 28672 else 20480 end end;
 if private.r12_pod_thorough_scope(w.scope_id) and (private.r12_pod_compact_bytes(v)>private.r12_pod_thorough_capacity(a.step_key,'maximumArtifactBytes')+2048 or private.r12_pod_compact_bytes(v->'output')>private.r12_pod_thorough_capacity(a.step_key,'maximumArtifactBytes') or (a.step_key='strategy' and private.r12_pod_embedded_bytes(v->'output')>98304)) then raise exception 'r12_pod_artifact_capacity_exceeded';end if;$new$);end $patch$;

alter table private.r12_discovery_wires drop constraint r12_discovery_wires_check;
alter table private.r12_discovery_wires add constraint r12_discovery_wires_check check(binding_hash=private.stage14_hash(binding) and octet_length(binding::text)<=case when private.r12_pod_thorough_scope(scope_id) and binding->'quote'->>'version'='r12.pod-quote.3' and binding->'quote'->>'profileHash'=private.stage14_hash(private.r12_pod_thorough_profile()) then 3407872 when binding->'quote'->>'version'='r12.discovery-evidence-quote.1' then 196608 else 131072 end);
alter table private.r12_discovery_candidates drop constraint r12_discovery_candidates_check;
alter table private.r12_discovery_candidates add constraint r12_discovery_candidates_check check(candidate_hash=private.stage14_hash(candidate) and isfinite(receipt_expires_at) and case when private.r12_pod_thorough_scope((candidate->>'scopeId')::uuid) then private.r12_pod_compact_bytes(candidate)<=private.r12_pod_thorough_capacity(candidate->>'phase','maximumArtifactBytes')+2048 and octet_length(candidate::text)<=private.r12_pod_thorough_capacity(candidate->>'phase','maximumArtifactBytes')*2+4096 else octet_length(candidate::text)<=73728 end);
alter table private.r12_discovery_response_observations drop constraint r12_discovery_response_observations_check;
alter table private.r12_discovery_response_observations add constraint r12_discovery_response_observations_check check(jsonb_typeof(payload)='object' and payload_hash=private.stage14_hash(payload) and octet_length(payload::text)<=case when private.r12_pod_thorough_scope((payload->>'scopeId')::uuid) then 2*1048576+4096 else 131072 end);

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_discovery_response_guard()'::regprocedure);
 if (length(d)-length(replace(d,$old$ return new;
end $function$$old$,'')))/length($old$ return new;
end $function$$old$)<>1 then raise exception 'r12_pod_thorough_patch_drift: private.r12_discovery_response_guard()';end if;
 execute replace(d,$old$ return new;
end $function$$old$,$new$ if private.r12_pod_thorough_scope((p.content->>'discoveryScopeId')::uuid) and a.step_key='strategy' and new.content->>'outcome'='accepted' and exists(select 1 from private.r12_discovery_wires w where w.request_id=c.request_id and private.r12_pod_embedded_bytes(c.candidate->'output')>((((w.binding->>'requestJson')::jsonb->'messages'->1->>'content')::jsonb)->>'maximumAssessmentEmbeddedBytes')::integer) then raise exception 'r12_pod_next_consumer_capacity_exceeded';end if;
 return new;
end $function$$new$);end $patch$;

-- Helpers are internal only; owner-facing entry points retain prior grants.
do $permissions$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('r12_pod_thorough_profile','r12_pod_thorough_capacity','r12_pod_thorough_scope','r12_pod_compact_bytes','r12_pod_embedded_bytes','r12_pod_thorough_safe','r12_pod_thorough_domains','r12_pod_source_projection_check','r12_pod_thorough_pack','r12_pod_current_evidence_check','r12_pod_prior_evidence','r12_pod_prior_projection_check','r12_pod_thorough_payload_check') loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);end loop;end $permissions$;
commit;
