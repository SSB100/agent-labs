-- One exact, independently approved metadata read. No R05 root is renewed,
-- no historical policy is changed, and no paid or persistent-login authority
-- is created. This migration installs definitions only; it seeds no approval.
begin;

create table private.r12_steel_readback_authorizations(
 target_hash text primary key references private.r12_steel_readback_targets(target_hash),
 business_id uuid not null references public.businesses(id),owner_id uuid not null references auth.users(id),
 goal_id uuid not null,goal_revision integer not null check(goal_revision>0),goal_hash text not null check(goal_hash~'^[a-f0-9]{64}$'),
 server_key_hash text not null references private.r05_server_keys(key_hash),
 r11_policy_id uuid not null references private.r11_research_policies(id),r11_policy_hash text not null check(r11_policy_hash~'^[a-f0-9]{64}$'),
 purpose text not null check(purpose='steel_existing_session_readback'),
 approval_hash text not null check(approval_hash~'^[a-f0-9]{64}$'),review_evidence_hash text not null check(review_evidence_hash~'^[a-f0-9]{64}$'),
 valid_from timestamptz not null,expires_at timestamptz not null,
 content jsonb not null,authorization_hash text not null unique check(authorization_hash=private.stage14_hash(content-'authorizationHash')),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(goal_id,business_id,goal_revision) references private.r04_goal_versions(goal_id,business_id,revision),
 check(isfinite(valid_from) and isfinite(expires_at) and expires_at>valid_from and expires_at<=valid_from+interval '2 hours'),
 check(content=jsonb_build_object('version','r12.steel-config-readback-authorization.1','targetHash',target_hash,
  'businessId',business_id,'ownerId',owner_id,'goalId',goal_id,'goalRevision',goal_revision,'goalHash',goal_hash,
  'serverKeyHash',server_key_hash,'r11PolicyId',r11_policy_id,'r11PolicyHash',r11_policy_hash,'purpose',purpose,
  'approvalHash',approval_hash,'reviewEvidenceHash',review_evidence_hash,'validFrom',private.r12_direct_time(valid_from),
  'expiresAt',private.r12_direct_time(expires_at),'authorizationHash',authorization_hash)));
alter table private.r12_steel_readback_authorizations enable row level security;
revoke all on private.r12_steel_readback_authorizations from public,anon,authenticated,service_role;
create trigger steel_readback_authorization_immutable before insert or update or delete on private.r12_steel_readback_authorizations
 for each row execute function private.r12_steel_readback_guard();

create function private.r12_steel_readback_authorization_goal(b uuid,g uuid,p_revision integer,h text) returns boolean
language sql stable set search_path='' as $$
 select exists(select 1 from private.r04_goal_state s join private.r04_goal_versions v using(business_id,goal_id,revision)
  where s.business_id=b and s.goal_id=g and s.revision=p_revision and v.content_hash=h and v.preference='ready')
 and not private.r05_paused(b,'business',b) and not private.r05_paused(b,'quest',g)
$$;

create function private.r12_steel_readback_authorization_check(body jsonb) returns void language plpgsql set search_path='' as $$
declare t private.r12_steel_readback_targets;p private.r11_research_policies;starts timestamptz;ends timestamptz;k text;begin
 perform private.r04_keys(body,array['version','targetHash','businessId','ownerId','goalId','goalRevision','goalHash','serverKeyHash','r11PolicyId','r11PolicyHash','purpose','approvalHash','reviewEvidenceHash','validFrom','expiresAt','authorizationHash']);
 if octet_length(body::text)>6000 then raise exception 'r12_steel_readback_authorization_invalid';end if;
 foreach k in array array['targetHash','goalHash','serverKeyHash','r11PolicyHash','approvalHash','reviewEvidenceHash','authorizationHash'] loop
  if coalesce(body->>k,'')!~'^[a-f0-9]{64}$' then raise exception 'r12_steel_readback_authorization_invalid';end if;
 end loop;
 foreach k in array array['businessId','ownerId','goalId','r11PolicyId'] loop
  if (body->>k)::uuid is null or ((body->>k)::uuid)::text is distinct from body->>k then raise exception 'r12_steel_readback_authorization_invalid';end if;
 end loop;
 starts:=private.r12_steel_readback_time(body->'validFrom');ends:=private.r12_steel_readback_time(body->'expiresAt');
 if body->>'version' is distinct from 'r12.steel-config-readback-authorization.1'
 or body->>'purpose' is distinct from 'steel_existing_session_readback'
 or body->>'authorizationHash' is distinct from private.stage14_hash(body-'authorizationHash')
 or jsonb_typeof(body->'goalRevision') is distinct from 'number' or coalesce(body->>'goalRevision','')!~'^[1-9][0-9]{0,8}$'
 or not isfinite(starts) or not isfinite(ends) or ends<=starts or ends>starts+interval '2 hours'
 then raise exception 'r12_steel_readback_authorization_invalid';end if;
 select * into t from private.r12_steel_readback_targets where target_hash=body->>'targetHash';
 if t.target_hash is null or t.business_id::text is distinct from body->>'businessId' or t.owner_id::text is distinct from body->>'ownerId'
 or starts<t.valid_from or ends>t.expires_at then raise exception 'r12_steel_readback_authorization_target_required';end if;
 perform private.r12_steel_readback_target_check(t.content);
 select * into p from private.r11_research_policies where id=(body->>'r11PolicyId')::uuid;
 if p.id is null or p.business_id is distinct from t.business_id or p.owner_id is distinct from t.owner_id
 or p.authority_key_hash is distinct from body->>'serverKeyHash' or p.policy_hash is distinct from body->>'r11PolicyHash'
 or p.policy_hash is distinct from encode(extensions.digest(convert_to(p.policy_canonical,'UTF8'),'sha256'),'hex')
 or p.policy is distinct from p.policy_canonical::jsonb
 or (select count(*) from private.r11_research_policies where authority_key_hash=body->>'serverKeyHash')<>1
 then raise exception 'r12_steel_readback_authorization_provenance_required' using errcode='42501';end if;
 if not exists(select 1 from private.r04_goal_versions where business_id=t.business_id and goal_id=(body->>'goalId')::uuid
  and revision=(body->>'goalRevision')::integer and content_hash=body->>'goalHash')
 then raise exception 'r12_steel_readback_authorization_goal_required' using errcode='42501';end if;
end $$;

-- Called only after the public RPC has locked the current owner's Business.
-- Historical targets keep their exact root gate. An exceptional target has one
-- immutable authorization and can never fall back after its expiry/revocation.
create function private.r12_steel_readback_authority(t private.r12_steel_readback_targets,h text,new_claim boolean) returns timestamptz
language plpgsql set search_path='' as $$
declare a private.r12_steel_readback_authorizations;key_expires timestamptz;effective_expires timestamptz;begin
 select k.expires_at into key_expires from private.r05_server_keys k where k.key_hash=h for share;
 -- A fresh statement after the registry lock observes a committed revocation
 -- that completed while we waited. The original immutable expiry is untouched.
 if key_expires is null or exists(select 1 from private.r05_server_revocations where key_hash=h)
 then raise exception 'r12_steel_readback_server_required' using errcode='42501';end if;
 select * into a from private.r12_steel_readback_authorizations where target_hash=t.target_hash;
 if a.target_hash is null then
  if key_expires<=clock_timestamp() then raise exception 'r12_steel_readback_server_required' using errcode='42501';end if;
  effective_expires:=key_expires;
 else
  if a.server_key_hash is distinct from h or a.business_id is distinct from t.business_id or a.owner_id is distinct from t.owner_id
   or a.valid_from>clock_timestamp() or a.expires_at<=clock_timestamp()
   or not exists(select 1 from public.businesses where id=a.business_id and owner_user_id=a.owner_id)
   or exists(select 1 from private.r12_steel_readback_revocations where target_hash=t.target_hash)
   then raise exception 'r12_steel_readback_authorization_required' using errcode='42501';end if;
  perform private.r12_steel_readback_authorization_check(a.content);
  if new_claim and private.r12_steel_readback_authorization_goal(a.business_id,a.goal_id,a.goal_revision,a.goal_hash) is distinct from true
   then raise exception 'r12_steel_readback_authorization_goal_required' using errcode='42501';end if;
  effective_expires:=a.expires_at;
 end if;
 begin
  perform private.r12_admission_key_scope(t.business_id,'steel_existing_session_readback','{}'::jsonb,h);
  perform private.r12_focused_creative_admission_key(t.business_id,'steel_existing_session_readback','{}'::jsonb,h);
 exception when raise_exception then
  if sqlerrm not in ('r12_exact_scoped_admission_authority_required','r12_direct_dedicated_admission_required','r12_creative_exact_admission_operation','r12_creative_scoped_admission_key_required') then raise;end if;
  raise exception 'r12_steel_readback_root_required' using errcode='42501';
 end;
 if a.target_hash is null and exists(select 1 from private.r11_research_policies where authority_key_hash=h)
  then raise exception 'r12_steel_readback_root_required' using errcode='42501';end if;
 return effective_expires;
end $$;

create function private.r12_steel_publish_readback_authorization(body jsonb) returns jsonb language plpgsql set search_path='' as $$
declare t private.r12_steel_readback_targets;a private.r12_steel_readback_authorizations;root_expiry timestamptz;begin
 if current_user in ('anon','authenticated','service_role') or not pg_has_role(current_user,(select proowner from pg_proc where oid='private.r12_steel_publish_readback_authorization(jsonb)'::regprocedure),'USAGE')
 then raise exception 'r12_steel_readback_authorization_operator_required' using errcode='42501';end if;
 perform private.r04_keys(body,array['version','targetHash','businessId','ownerId','goalId','goalRevision','goalHash','serverKeyHash','r11PolicyId','r11PolicyHash','purpose','approvalHash','reviewEvidenceHash','validFrom','expiresAt','authorizationHash']);
 perform 1 from public.businesses where id=(body->>'businessId')::uuid and owner_user_id=(body->>'ownerId')::uuid for update;
 if not found then raise exception 'r12_steel_readback_owner_required' using errcode='42501';end if;
 select * into a from private.r12_steel_readback_authorizations where target_hash=body->>'targetHash';
 if a.target_hash is not null then
  if a.content is distinct from body then raise exception 'r12_steel_readback_authorization_conflict';end if;
  -- This returns the original receipt only, even after consumption or expiry.
  return jsonb_build_object('version','r12.steel-config-readback-authorization-publication.1','targetHash',a.target_hash,'authorizationHash',a.authorization_hash,'expiresAt',private.r12_direct_time(a.expires_at),'metadataOnly',true);
 end if;
 perform private.r12_steel_readback_authorization_check(body);
 select * into strict t from private.r12_steel_readback_targets where target_hash=body->>'targetHash';
 select expires_at into root_expiry from private.r05_server_keys where key_hash=body->>'serverKeyHash' for share;
 if root_expiry is null or root_expiry>clock_timestamp() or exists(select 1 from private.r05_server_revocations where key_hash=body->>'serverKeyHash')
 then raise exception 'r12_steel_readback_authorization_expired_root_required' using errcode='42501';end if;
 if (body->>'validFrom')::timestamptz>clock_timestamp() or (body->>'expiresAt')::timestamptz<=clock_timestamp()
 or t.valid_from>clock_timestamp() or t.expires_at<=clock_timestamp()
 or exists(select 1 from private.r12_steel_readback_revocations where target_hash=t.target_hash)
 or exists(select 1 from private.r12_steel_readback_claims where target_hash=t.target_hash)
 or exists(select 1 from private.r12_steel_readback_results where target_hash=t.target_hash)
 then raise exception 'r12_steel_readback_authorization_target_inactive';end if;
 if private.r12_steel_readback_authorization_goal(t.business_id,(body->>'goalId')::uuid,(body->>'goalRevision')::integer,body->>'goalHash') is distinct from true
 then raise exception 'r12_steel_readback_authorization_goal_required' using errcode='42501';end if;
 -- Both guards still exclude delegated keys. The reviewed R11 provenance is
 -- the only identity exception and is private to this fixed metadata target.
 perform private.r12_admission_key_scope(t.business_id,'steel_existing_session_readback','{}'::jsonb,body->>'serverKeyHash');
 perform private.r12_focused_creative_admission_key(t.business_id,'steel_existing_session_readback','{}'::jsonb,body->>'serverKeyHash');
 insert into private.r12_steel_readback_authorizations(target_hash,business_id,owner_id,goal_id,goal_revision,goal_hash,server_key_hash,r11_policy_id,r11_policy_hash,purpose,approval_hash,review_evidence_hash,valid_from,expires_at,content,authorization_hash)
 values(t.target_hash,t.business_id,t.owner_id,(body->>'goalId')::uuid,(body->>'goalRevision')::integer,body->>'goalHash',body->>'serverKeyHash',(body->>'r11PolicyId')::uuid,body->>'r11PolicyHash',body->>'purpose',body->>'approvalHash',body->>'reviewEvidenceHash',(body->>'validFrom')::timestamptz,(body->>'expiresAt')::timestamptz,body,body->>'authorizationHash') returning * into a;
 return jsonb_build_object('version','r12.steel-config-readback-authorization-publication.1','targetHash',a.target_hash,'authorizationHash',a.authorization_hash,'expiresAt',private.r12_direct_time(a.expires_at),'metadataOnly',true);
end $$;

-- Preserve the established RPC OID/ACL and every payload, proof, claim and
-- terminal-result branch. Counted exact anchors reject unexpected body drift.
do $patch$ declare d text;old text;replacement text;begin
 d:=pg_get_functiondef('public.r12_steel_config_readback_server(uuid,text,jsonb,text)'::regprocedure);
 old:=$old$ select k.expires_at into key_expires from private.r05_server_keys k where k.key_hash=root_key_hash for share;
 -- Recheck in a new statement after acquiring the key lock: a revocation may
 -- have committed while this transaction waited for the same registry row.
 if key_expires is null or key_expires<=clock_timestamp() or exists(select 1 from private.r05_server_revocations z where z.key_hash=root_key_hash)
 then raise exception 'r12_steel_readback_server_required' using errcode='42501';end if;
 begin
  perform private.r12_admission_key_scope(p_business_id,'steel_existing_session_readback','{}'::jsonb,root_key_hash);
  perform private.r12_focused_creative_admission_key(p_business_id,'steel_existing_session_readback','{}'::jsonb,root_key_hash);
 exception when raise_exception then
  if sqlerrm not in ('r12_exact_scoped_admission_authority_required','r12_direct_dedicated_admission_required','r12_creative_exact_admission_operation','r12_creative_scoped_admission_key_required') then raise;end if;
  -- A scope guard denial is definitive authority failure, never a lost claim
  -- acknowledgment that the server should present as still-ready metadata.
  raise exception 'r12_steel_readback_root_required' using errcode='42501';
 end;
 if exists(select 1 from private.r11_research_policies p where p.authority_key_hash=root_key_hash) then raise exception 'r12_steel_readback_root_required' using errcode='42501';end if;$old$;
 replacement:=$new$ key_expires:=private.r12_steel_readback_authority(target,root_key_hash,p_operation='claim'
  and not exists(select 1 from private.r12_steel_readback_claims where target_hash=target.target_hash)
  and not exists(select 1 from private.r12_steel_readback_results where target_hash=target.target_hash));$new$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_steel_readback_authorization_patch_drift';end if;
 execute replace(d,old,replacement);
 d:=pg_get_functiondef('private.r12_steel_readback_status(uuid,text)'::regprocedure);
 old:='declare target private.r12_steel_readback_targets;claim private.r12_steel_readback_claims;result private.r12_steel_readback_results;state text:=''review_required'';begin';
 replacement:='declare target private.r12_steel_readback_targets;claim private.r12_steel_readback_claims;result private.r12_steel_readback_results;readback_auth private.r12_steel_readback_authorizations;state text:=''review_required'';begin';
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_steel_readback_authorization_status_drift';end if;d:=replace(d,old,replacement);
 old:=' select * into result from private.r12_steel_readback_results where target_hash=target.target_hash;';
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_steel_readback_authorization_status_drift';end if;
 d:=replace(d,old,old||E'\n select * into readback_auth from private.r12_steel_readback_authorizations where target_hash=target.target_hash;');
 old:=' elsif target.expires_at<=clock_timestamp() or (claim.id is not null and claim.expires_at<=clock_timestamp()) then state:=''expired'';';
 replacement:=' elsif target.expires_at<=clock_timestamp() or (claim.id is not null and claim.expires_at<=clock_timestamp()) or (readback_auth.target_hash is not null and readback_auth.expires_at<=clock_timestamp()) then state:=''expired'';';
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_steel_readback_authorization_status_drift';end if;d:=replace(d,old,replacement);
 old:=' elsif claim.id is not null then state:=''pending'';else state:=''ready'';end if;';
 replacement:=$new$ elsif readback_auth.target_hash is not null and (readback_auth.valid_from>clock_timestamp()
  or exists(select 1 from private.r05_server_revocations where key_hash=readback_auth.server_key_hash)
  or (select count(*) from private.r11_research_policies where authority_key_hash=readback_auth.server_key_hash)<>1
  or not exists(select 1 from private.r11_research_policies where id=readback_auth.r11_policy_id and policy_hash=readback_auth.r11_policy_hash and authority_key_hash=readback_auth.server_key_hash)) then state:='review_required';
 elsif claim.id is not null then state:='pending';
 elsif readback_auth.target_hash is not null and private.r12_steel_readback_authorization_goal(readback_auth.business_id,readback_auth.goal_id,readback_auth.goal_revision,readback_auth.goal_hash) is distinct from true then state:='review_required';
 else state:='ready';end if;$new$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_steel_readback_authorization_status_drift';end if;
 execute replace(d,old,replacement);
end $patch$;
revoke all on function private.r12_steel_readback_authorization_goal(uuid,uuid,integer,text),private.r12_steel_readback_authorization_check(jsonb),private.r12_steel_readback_authority(private.r12_steel_readback_targets,text,boolean),private.r12_steel_publish_readback_authorization(jsonb) from public,anon,authenticated,service_role;
commit;
