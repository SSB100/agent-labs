-- Separate, owner-requested metadata read precursor. No route/grant/credential
-- or create authority is enrolled. A private operator review pins one already
-- known session; only the existing R05-root server can claim/save its GET.
begin;
create table private.r12_steel_readback_targets(
 target_hash text primary key check(target_hash=private.stage14_hash(content-'targetHash')),
 business_id uuid not null references public.businesses(id),owner_id uuid not null references auth.users(id),
 content jsonb not null,
 valid_from timestamptz not null,expires_at timestamptz not null check(expires_at>valid_from),created_at timestamptz not null default clock_timestamp());
create index r12_steel_readback_owner on private.r12_steel_readback_targets(business_id,owner_id,created_at desc);
create table private.r12_steel_readback_revocations(target_hash text primary key references private.r12_steel_readback_targets(target_hash),reason text not null check(reason='operator_revoked'),created_at timestamptz not null default clock_timestamp());
create table private.r12_steel_readback_claims(
 target_hash text primary key references private.r12_steel_readback_targets(target_hash),id uuid not null unique,submission_id uuid not null,
 server_key_hash text not null references private.r05_server_keys(key_hash),
 content jsonb not null,claim_hash text not null unique check(claim_hash=private.stage14_hash(content)),
 expires_at timestamptz not null,created_at timestamptz not null default clock_timestamp());
create table private.r12_steel_readback_results(
 target_hash text primary key references private.r12_steel_readback_targets(target_hash),claim_id uuid unique references private.r12_steel_readback_claims(id),
 status text not null check(status in ('verified','failed','cancelled')),proof jsonb,proof_hash text,observed_at timestamptz,reason text,
 created_at timestamptz not null default clock_timestamp(),check(status='cancelled' or claim_id is not null),
 check((status='verified' and proof is not null and proof_hash=private.stage14_hash(proof) and observed_at is not null and reason is null)
 or(status in ('failed','cancelled') and proof is null and proof_hash is null and observed_at is null and reason in ('provider_readback_unverified','readback_cancelled'))));
create function private.r12_steel_readback_guard() returns trigger language plpgsql set search_path='' as $$
declare business uuid;begin
 if tg_op<>'INSERT' or current_user in ('anon','authenticated','service_role') then raise exception 'r12_steel_readback_trusted_immutable_required' using errcode='42501';end if;
 if tg_table_name='r12_steel_readback_revocations' then
 select business_id into strict business from private.r12_steel_readback_targets where target_hash=new.target_hash;
 perform 1 from public.businesses where id=business for update;
 end if;return new;
end $$;
do $$ declare n text;begin foreach n in array array['r12_steel_readback_targets','r12_steel_readback_revocations','r12_steel_readback_claims','r12_steel_readback_results'] loop
 execute format('alter table private.%I enable row level security',n);execute format('revoke all on private.%I from public,anon,authenticated,service_role',n);
 execute format('create trigger steel_readback_immutable before insert or update or delete on private.%I for each row execute function private.r12_steel_readback_guard()',n);end loop;end $$;

create function private.r12_steel_readback_time(v jsonb) returns timestamptz language plpgsql immutable set search_path='' as $$
declare t timestamptz;begin
 if jsonb_typeof(v) is distinct from 'string' or (v#>>'{}')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' then raise exception 'r12_steel_readback_time_invalid';end if;
 t:=(v#>>'{}')::timestamptz;if private.r12_direct_time(t) is distinct from v#>>'{}' then raise exception 'r12_steel_readback_time_invalid';end if;return t;
end $$;
create function private.r12_steel_readback_target_check(body jsonb) returns void language plpgsql set search_path='' as $$
declare config jsonb;k text;known timestamptz;starts timestamptz;ends timestamptz;begin
 perform private.r04_keys(body,array['version','businessId','ownerId','providerProjectId','knownSessionId','knownBefore','observedTerminalState','expectedCreatedAt','expectedProviderStatus','configuration','configurationHash','deploymentEvidenceHash','routeReviewHash','tariffEvidenceHash','validFrom','expiresAt','targetHash']);
 if octet_length(body::text)>12000 then raise exception 'r12_steel_readback_target_invalid';end if;
 config:=body->'configuration';perform private.r04_keys(config,array['version','provider','baseUrl','region','providerProjectId','environment','deploymentId','releaseCommitSha']);
 foreach k in array array['configurationHash','deploymentEvidenceHash','routeReviewHash','tariffEvidenceHash','targetHash'] loop if coalesce(body->>k,'')!~'^[a-f0-9]{64}$' then raise exception 'r12_steel_readback_target_invalid';end if;end loop;
 foreach k in array array['businessId','ownerId','providerProjectId','knownSessionId'] loop if (body->>k)::uuid is null or ((body->>k)::uuid)::text is distinct from body->>k then raise exception 'r12_steel_readback_target_invalid';end if;end loop;
 known:=private.r12_steel_readback_time(body->'knownBefore');starts:=private.r12_steel_readback_time(body->'validFrom');ends:=private.r12_steel_readback_time(body->'expiresAt');
 if body->'expectedCreatedAt' is distinct from 'null'::jsonb then if private.r12_steel_readback_time(body->'expectedCreatedAt')>=known then raise exception 'r12_steel_readback_target_invalid';end if;end if;
 if body->>'version' is distinct from 'r12.steel-config-readback-target.1' or body->>'targetHash' is distinct from private.stage14_hash(body-'targetHash')
 or body->>'observedTerminalState' is distinct from 'Completed'
 or (body->'expectedProviderStatus' is distinct from 'null'::jsonb and coalesce(body->>'expectedProviderStatus','') not in ('released','failed'))
 or config->>'version' is distinct from 'r12.steel-runtime-configuration.1' or config->>'provider' is distinct from 'steel' or config->>'baseUrl' is distinct from 'https://api.steel.dev'
 or config->>'environment' is distinct from 'production' or config->'providerProjectId' is distinct from body->'providerProjectId'
 or coalesce(config->>'deploymentId','')!~'^dpl_[A-Za-z0-9_-]{1,124}$' or coalesce(config->>'releaseCommitSha','')!~'^([a-f0-9]{40}|[a-f0-9]{64})$'
 or (config->'region' is distinct from 'null'::jsonb and (jsonb_typeof(config->'region') is distinct from 'string' or coalesce(config->>'region','')!~'^[A-Za-z0-9_-]{1,64}$'))
 or body->>'configurationHash' is distinct from private.stage14_hash(config) or known>starts or ends<=starts or ends>starts+interval '24 hours'
 or exists(select 1 from private.r12_direct_browser_operations where id=(body->>'knownSessionId')::uuid)
 then raise exception 'r12_steel_readback_target_invalid';end if;
end $$;
create function private.r12_steel_publish_readback_target(body jsonb) returns jsonb language plpgsql set search_path='' as $$
begin
 perform private.r12_steel_readback_target_check(body);
 perform 1 from public.businesses where id=(body->>'businessId')::uuid and owner_user_id=(body->>'ownerId')::uuid for update;
 if not found then raise exception 'r12_steel_readback_owner_required' using errcode='42501';end if;
 if (body->>'validFrom')::timestamptz>clock_timestamp() or (body->>'expiresAt')::timestamptz<=clock_timestamp() then raise exception 'r12_steel_readback_target_inactive';end if;
 insert into private.r12_steel_readback_targets(target_hash,business_id,owner_id,content,valid_from,expires_at)
 values(body->>'targetHash',(body->>'businessId')::uuid,(body->>'ownerId')::uuid,body,(body->>'validFrom')::timestamptz,(body->>'expiresAt')::timestamptz) on conflict do nothing;
 return jsonb_build_object('version','r12.steel-config-readback-target-publication.1','targetHash',body->>'targetHash','authorityCreated',false);
end $$;
create function private.r12_steel_readback_status(b uuid,h text) returns jsonb language plpgsql stable set search_path='' as $$
declare target private.r12_steel_readback_targets;claim private.r12_steel_readback_claims;result private.r12_steel_readback_results;state text:='review_required';begin
 if h is not null then select * into target from private.r12_steel_readback_targets where target_hash=h and business_id=b and owner_id=auth.uid();
 else select * into target from private.r12_steel_readback_targets where business_id=b and owner_id=auth.uid() order by created_at desc,target_hash desc limit 1;end if;
 if h is not null and target.target_hash is null then raise exception 'r12_steel_readback_target_unavailable';end if;
 if target.target_hash is not null then
 select * into claim from private.r12_steel_readback_claims where target_hash=target.target_hash;
 select * into result from private.r12_steel_readback_results where target_hash=target.target_hash;
 if result.status is not null then state:=result.status;
 elsif target.expires_at<=clock_timestamp() or (claim.id is not null and claim.expires_at<=clock_timestamp()) then state:='expired';
 elsif exists(select 1 from private.r12_steel_readback_revocations where target_hash=target.target_hash) or target.valid_from>clock_timestamp() then state:='review_required';
 elsif claim.id is not null then state:='pending';else state:='ready';end if;
 end if;
 return jsonb_build_object('version','r12.owner-steel-config-readback.1','businessId',b,'targetHash',target.target_hash,'status',state,'observedAt',case when result.observed_at is null then null else private.r12_direct_time(result.observed_at) end,'proofHash',result.proof_hash);
end $$;
create function public.r12_owner_steel_config_readback(p_business_id uuid,p_target_hash text default null) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.businesses where id=p_business_id and owner_user_id=auth.uid()) then raise exception 'r12_steel_readback_owner_required' using errcode='42501';end if;
 if p_target_hash is not null and p_target_hash!~'^[a-f0-9]{64}$' then raise exception 'r12_steel_readback_target_invalid';end if;
 return private.r12_steel_readback_status(p_business_id,p_target_hash);
end $$;

create function public.r12_steel_config_readback_server(p_business_id uuid,p_operation text,p_payload jsonb,p_server_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare target private.r12_steel_readback_targets;claim private.r12_steel_readback_claims;result private.r12_steel_readback_results;
 body jsonb;proof jsonb;observed timestamptz;created timestamptz;expires timestamptz;new_claim_id uuid;status text;root_key_hash text;key_expires timestamptz;begin
 if auth.uid() is null then raise exception 'r12_steel_readback_owner_required' using errcode='42501';end if;
 if p_server_key is null or length(p_server_key) not between 32 and 200 then raise exception 'r12_steel_readback_server_required' using errcode='42501';end if;
 if p_operation='claim' then perform private.r04_keys(p_payload,array['targetHash','submissionId']);
 elsif p_operation='record' then perform private.r04_keys(p_payload,array['targetHash','claimId','claimHash','proof']);
 elsif p_operation='fail' then perform private.r04_keys(p_payload,array['targetHash','claimId','claimHash','reason']);
 elsif p_operation='cancel' then perform private.r04_keys(p_payload,array['targetHash']);
 else raise exception 'r12_steel_readback_operation_invalid';end if;
 if octet_length(p_payload::text)>12000 or coalesce(p_payload->>'targetHash','')!~'^[a-f0-9]{64}$' then raise exception 'r12_steel_readback_target_invalid';end if;
 perform 1 from public.businesses where id=p_business_id and owner_user_id=auth.uid() for update;
 if not found then raise exception 'r12_steel_readback_owner_required' using errcode='42501';end if;
 select * into target from private.r12_steel_readback_targets where target_hash=p_payload->>'targetHash' and business_id=p_business_id and owner_id=auth.uid();
 if target.target_hash is null then raise exception 'r12_steel_readback_target_unavailable';end if;
 -- Reuse the already enrolled R05 server root. No operator-extracted purpose
 -- verifier is needed, and a delegated research/creative key cannot become root.
 root_key_hash:=encode(extensions.digest(convert_to(p_server_key,'UTF8'),'sha256'),'hex');
 select k.expires_at into key_expires from private.r05_server_keys k where k.key_hash=root_key_hash for share;
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
 if exists(select 1 from private.r11_research_policies p where p.authority_key_hash=root_key_hash) then raise exception 'r12_steel_readback_root_required' using errcode='42501';end if;
 perform private.r12_steel_readback_target_check(target.content);
 select * into claim from private.r12_steel_readback_claims where target_hash=target.target_hash;
 select * into result from private.r12_steel_readback_results where target_hash=target.target_hash;
 if p_operation='claim' then
 if (p_payload->>'submissionId')::uuid is null then raise exception 'r12_steel_readback_submission_invalid';end if;
 if result.target_hash is not null or claim.id is not null or target.valid_from>clock_timestamp() or target.expires_at<=clock_timestamp() or exists(select 1 from private.r12_steel_readback_revocations where target_hash=target.target_hash) then
 return jsonb_build_object('version','r12.steel-config-readback-claim-response.1','targetHash',target.target_hash,'mayFetch',false,'status',private.r12_steel_readback_status(p_business_id,target.target_hash));end if;
 new_claim_id:=gen_random_uuid();expires:=(private.r12_direct_time(least(target.expires_at,key_expires,clock_timestamp()+interval '20 seconds')))::timestamptz;
 if expires<=clock_timestamp() then raise exception 'r12_steel_readback_claim_expired';end if;
 body:=jsonb_build_object('version','r12.steel-config-readback-claim.1','id',new_claim_id,'targetHash',target.target_hash,'submissionId',p_payload->>'submissionId','expiresAt',private.r12_direct_time(expires));
 insert into private.r12_steel_readback_claims(target_hash,id,submission_id,server_key_hash,content,claim_hash,expires_at) values(target.target_hash,new_claim_id,(p_payload->>'submissionId')::uuid,root_key_hash,body,private.stage14_hash(body),expires);
 return jsonb_build_object('version','r12.steel-config-readback-claim-response.1','targetHash',target.target_hash,'mayFetch',true,'claim',jsonb_build_object('id',new_claim_id,'hash',private.stage14_hash(body),'expiresAt',private.r12_direct_time(expires)),'target',target.content);
 end if;
 if p_operation='cancel' then
 if result.target_hash is null then insert into private.r12_steel_readback_results(target_hash,claim_id,status,reason) values(target.target_hash,claim.id,'cancelled','readback_cancelled');end if;
 return private.r12_steel_readback_status(p_business_id,target.target_hash);end if;
 if claim.id is null or claim.server_key_hash is distinct from root_key_hash or p_payload->>'claimId' is distinct from claim.id::text or p_payload->>'claimHash' is distinct from claim.claim_hash then raise exception 'r12_steel_readback_claim_required';end if;
 if p_operation='record' then
 proof:=p_payload->'proof';perform private.r04_keys(proof,array['version','method','endpoint','requestedSessionId','returnedSessionId','returnedProjectId','providerStatus','sessionCreatedAt','observedAt','responseHash','credentialBindingHash','configurationHash']);
 created:=private.r12_steel_readback_time(proof->'sessionCreatedAt');observed:=private.r12_steel_readback_time(proof->'observedAt');
 if proof->>'version' is distinct from 'r12.steel-existing-session-readback.1' or proof->>'method' is distinct from 'GET'
 or proof->>'endpoint' is distinct from 'https://api.steel.dev/v1/sessions/'||(target.content->>'knownSessionId')
 or proof->>'requestedSessionId' is distinct from target.content->>'knownSessionId' or proof->>'returnedSessionId' is distinct from target.content->>'knownSessionId'
 or proof->'returnedProjectId' is distinct from target.content->'providerProjectId' or coalesce(proof->>'providerStatus','') not in ('released','failed')
 or (target.content->'expectedProviderStatus' is distinct from 'null'::jsonb and proof->'providerStatus' is distinct from target.content->'expectedProviderStatus')
 or (target.content->'expectedCreatedAt' is distinct from 'null'::jsonb and proof->'sessionCreatedAt' is distinct from target.content->'expectedCreatedAt')
 or created>=(target.content->>'knownBefore')::timestamptz or observed<(private.r12_direct_time(claim.created_at))::timestamptz or observed>clock_timestamp() or observed>claim.expires_at
 or coalesce(proof->>'responseHash','')!~'^[a-f0-9]{64}$' or coalesce(proof->>'credentialBindingHash','')!~'^[a-f0-9]{64}$'
 or proof->'configurationHash' is distinct from target.content->'configurationHash'
 then raise exception 'r12_steel_readback_proof_invalid';end if;
 if result.target_hash is not null then
 if result.status is distinct from 'verified' or result.proof is distinct from proof then raise exception 'r12_steel_readback_result_conflict';end if;
 return private.r12_steel_readback_status(p_business_id,target.target_hash);end if;
 if target.expires_at<=clock_timestamp() or claim.expires_at<=clock_timestamp() or exists(select 1 from private.r12_steel_readback_revocations where target_hash=target.target_hash) then raise exception 'r12_steel_readback_claim_expired';end if;
 insert into private.r12_steel_readback_results(target_hash,claim_id,status,proof,proof_hash,observed_at) values(target.target_hash,claim.id,'verified',proof,private.stage14_hash(proof),observed);
 else
 status:=case when p_operation='cancel' then 'cancelled' else 'failed' end;
 if p_operation='fail' and p_payload->>'reason' is distinct from 'provider_readback_unverified' then raise exception 'r12_steel_readback_failure_invalid';end if;
 if result.target_hash is null then insert into private.r12_steel_readback_results(target_hash,claim_id,status,reason) values(target.target_hash,claim.id,status,case when status='cancelled' then 'readback_cancelled' else 'provider_readback_unverified' end);end if;
 end if;
 return private.r12_steel_readback_status(p_business_id,target.target_hash);
end $$;

do $$ declare f record;begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and (p.proname like 'r12_steel_readback_%' or p.proname='r12_steel_publish_readback_target') loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);end loop;end $$;
revoke all on function public.r12_owner_steel_config_readback(uuid,text),public.r12_steel_config_readback_server(uuid,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.r12_owner_steel_config_readback(uuid,text),public.r12_steel_config_readback_server(uuid,text,jsonb,text) to authenticated;
commit;
