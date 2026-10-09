-- The planner sees the exact bounded intent and installed knowledge before the
-- owner confirms. Confirmation recomputes the same input under its existing
-- authority/funding/head locks, before the first confirmation write.
begin;

create function private.r12_owner_preflight_input(s private.r12_owner_setups,q jsonb,lock_installation boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.r12_owner_profiles;i public.installed_packs;intent jsonb;body jsonb;begin
 if s.id is null or s.setup_hash is distinct from private.stage14_hash(s.preview) then raise exception 'r12_owner_exact_setup_required';end if;
 select * into p from private.r12_owner_profiles where id=s.profile_id;
 perform private.r12_owner_profile_check(p,clock_timestamp());
 perform private.r12_owner_pins_check(p);
 if p.profile_hash is distinct from s.preview->>'profileHash' or p.pins->'snapshot' is null then raise exception 'r12_owner_profile_changed';end if;
 perform private.r12_owner_quote_check(q,s.preview->'quote');
 if lock_installation then
  select * into i from public.installed_packs where id=s.installation_id and business_id=s.business_id and root_pack_id=(p.pins->>'packId')::uuid for update;
 else
  select * into i from public.installed_packs where id=s.installation_id and business_id=s.business_id and root_pack_id=(p.pins->>'packId')::uuid;
 end if;
 if i.id is null or i.status<>'active' or i.snapshot is distinct from p.pins->'snapshot' or private.r04_hash(i.snapshot) is distinct from p.pins->>'snapshotHash' then raise exception 'r12_owner_installation_changed';end if;
 intent:=jsonb_build_object('version','pod-discovery-2.0','id',s.scope_id,'businessId',s.business_id,'objective',s.preview->>'objective',
  'comparisonUniverse',jsonb_build_object('productType','original_pod_tshirt','markets',s.preview->'markets','audiences',jsonb_build_array(s.preview->>'audience'),'sourceDomains',s.preview->'sourceDomains','selectionQuestion',s.preview->>'approvedQuery'),
  'limits',jsonb_build_object('maximumAlternatives',3,'maximumNewCollections',1,'maximumMicrousd',(s.preview->'quote'->>'maximumMicrousd')::bigint,'maximumGenerations',1),'expiresAt',s.cutoff);
 body:=jsonb_build_object('version','r12.owner-planner-preflight-input.1','setupId',s.id,'setupHash',s.setup_hash,'scopeId',s.scope_id,'cutoff',s.cutoff,'intent',intent,'knowledgeSnapshot',i.snapshot,
  'fingerprint',jsonb_build_object('businessId',s.business_id,'ownerId',s.owner_id,'goalId',s.goal_id,'profileId',s.profile_id,'grantId',s.grant_id,'bindingId',s.binding_id,'installationId',s.installation_id,'policyId',s.policy_id,'policyHash',s.policy_hash,'purposeHash',s.purpose_hash,'input',s.input,'preview',s.preview,'profile',p.profile,'profileHash',p.profile_hash,'pins',p.pins,'installationStatus',i.status,'installationSnapshot',i.snapshot,'quote',q));
 -- The fingerprint is covered by the hash but is not sent to the planner.
 return (body-'fingerprint')||jsonb_build_object('inputHash',private.stage14_hash(body));
end $$;

create function public.r12_owner_research_preflight(p_business_id uuid,p_setup_id uuid,p_setup_hash text,p_quote jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.r12_owner_setups;begin
 if auth.uid() is null or private.is_business_owner(p_business_id) is distinct from true then raise exception 'r12_owner_required' using errcode='42501';end if;
 select * into s from private.r12_owner_setups where id=p_setup_id and business_id=p_business_id and owner_id=auth.uid() and setup_hash=p_setup_hash;
 if s.id is null then raise exception 'r12_owner_exact_setup_required';end if;
 if exists(select 1 from private.r05_revocations where policy_id=s.policy_id) then raise exception 'r12_owner_setup_stopped';end if;
 return private.r12_owner_preflight_input(s,p_quote);
end $$;

create function private.r12_owner_preflight_confirm(s private.r12_owner_setups,q jsonb,receipt jsonb) returns void language plpgsql security definer set search_path='' as $$
declare current_input jsonb;begin
 if jsonb_typeof(receipt) is distinct from 'object' or receipt->>'version' is distinct from 'r12.owner-planner-preflight.1'
 or receipt->>'inputHash' !~ '^[a-f0-9]{64}$'
 or jsonb_typeof(receipt->'requestBytes') is distinct from 'number' or receipt->>'requestBytes' !~ '^[1-9][0-9]{0,4}$'
 or (receipt->>'requestBytes')::integer>12288
 or jsonb_typeof(receipt->'wireBytes') is distinct from 'number' or receipt->>'wireBytes' !~ '^[1-9][0-9]{0,4}$'
 or (receipt->>'wireBytes')::integer>12288 then raise exception 'r12_owner_planner_preflight_required';end if;
 perform private.r04_keys(receipt,array['version','inputHash','requestBytes','wireBytes']);
 current_input:=private.r12_owner_preflight_input(s,q,true);
 if receipt->>'inputHash' is distinct from current_input->>'inputHash' then raise exception 'r12_owner_planner_preflight_stale';end if;
end $$;

-- Preserve the old idempotency key: refreshed planner receipts and quotes do
-- not turn an already activated or stopped replay into a new submission.
do $patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_owner_research_server(uuid,text,jsonb,text)'::regprocedure);
 if position($old$perform private.r04_keys(p_payload,case when p_operation='stop'$old$ in d)=0 or position($old$'payload',p_payload-'quote'$old$ in d)=0
 or position($old$ perform public.r05_policy_owner(p_business_id,'confirm',jsonb_build_object('policyId',setup.policy_id,'policyHash',setup.policy_hash),submission);$old$ in d)=0 then raise exception 'r12_owner_preflight_initial_patch_missing';end if;
 d:=replace(d,$old$perform private.r04_keys(p_payload,case when p_operation='stop'$old$,$new$perform private.r04_keys(case when p_operation='stop' then p_payload else p_payload-'preflight' end,case when p_operation='stop'$new$);
 d:=replace(d,$old$'payload',p_payload-'quote'$old$,$new$'payload',p_payload-array['quote','preflight']$new$);
 d:=replace(d,$old$ perform public.r05_policy_owner(p_business_id,'confirm',jsonb_build_object('policyId',setup.policy_id,'policyHash',setup.policy_hash),submission);$old$,$new$ perform private.r12_owner_preflight_confirm(setup,q,p_payload->'preflight');
 perform public.r05_policy_owner(p_business_id,'confirm',jsonb_build_object('policyId',setup.policy_id,'policyHash',setup.policy_hash),submission);$new$);
 execute d;
end $patch$;

do $patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_owner_episode_server(uuid,text,jsonb,text)'::regprocedure);
 if position($old$perform private.r04_keys(p_payload,case when p_operation='stop'$old$ in d)=0 or position($old$'payload',p_payload-'quote'$old$ in d)=0
 or position($old$ perform public.r05_policy_owner(p_business_id,'confirm',jsonb_build_object('policyId',setup.policy_id,'policyHash',setup.policy_hash),submission);$old$ in d)=0 then raise exception 'r12_owner_preflight_episode_patch_missing';end if;
 d:=replace(d,$old$perform private.r04_keys(p_payload,case when p_operation='stop'$old$,$new$perform private.r04_keys(case when p_operation='stop' then p_payload else p_payload-'preflight' end,case when p_operation='stop'$new$);
 d:=replace(d,$old$'payload',p_payload-'quote'$old$,$new$'payload',p_payload-array['quote','preflight']$new$);
 d:=replace(d,$old$ perform public.r05_policy_owner(p_business_id,'confirm',jsonb_build_object('policyId',setup.policy_id,'policyHash',setup.policy_hash),submission);$old$,$new$ perform private.r12_owner_preflight_confirm(setup,q,p_payload->'preflight');
 perform public.r05_policy_owner(p_business_id,'confirm',jsonb_build_object('policyId',setup.policy_id,'policyHash',setup.policy_hash),submission);$new$);
 execute d;
end $patch$;

revoke all on function private.r12_owner_preflight_input(private.r12_owner_setups,jsonb,boolean),private.r12_owner_preflight_confirm(private.r12_owner_setups,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.r12_owner_research_preflight(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.r12_owner_research_preflight(uuid,uuid,text,jsonb) to authenticated;
commit;
