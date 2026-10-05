-- R11 definitions only. No grant, credential, account or provider call is seeded.
begin;
create function private.r11_provider_scopes(v jsonb) returns boolean language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(v)='array' and jsonb_array_length(v)<=64 and not exists(select 1 from jsonb_array_elements(v) x where jsonb_typeof(x)<>'string' or x#>>'{}' !~ '^[a-z][a-z0-9_/-]{0,79}$') and (select count(*)=count(distinct x) from jsonb_array_elements(v) x),false)
$$;
create table private.r11_connection_grants (
 id uuid primary key default gen_random_uuid(),business_id uuid not null references public.businesses(id),owner_id uuid not null references auth.users(id),
 auth_session_id uuid not null,approved_credential_fingerprint text not null check(approved_credential_fingerprint ~ '^[a-f0-9]{64}$'),provider text not null check(provider in ('etsy','printful')),application_id text not null check(length(application_id) between 1 and 120),
 expected_account text not null check(expected_account ~ '^[A-Za-z0-9_]{1,120}$'),purpose_hash text not null check(purpose_hash ~ '^[a-f0-9]{64}$'),
 provider_scope_mode text not null check(provider_scope_mode in ('exact','inspect_and_record')),provider_scopes jsonb check(provider_scopes is null or private.r11_provider_scopes(provider_scopes)),
 approval_hash text not null check(approval_hash ~ '^[a-f0-9]{64}$'),credential_alias text,
 provider_type text check(provider_type ~ '^[a-z][a-z0-9_-]{0,79}$'),store_kind text check(store_kind in ('manual_api','ecommerce_linked')),created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null,
 connection_expires_at timestamptz not null,check(expires_at>created_at and expires_at<=created_at+interval '1 day'),
 check(connection_expires_at>expires_at and connection_expires_at<=created_at+interval '31 days'),
 check((provider='etsy' and provider_scope_mode='exact' and provider_scopes is not null and provider_scopes='["shops_r","listings_r"]'::jsonb and credential_alias is null and store_kind is null and provider_type is null) or (provider='printful' and ((provider_scope_mode='exact' and provider_scopes is not null) or (provider_scope_mode='inspect_and_record' and provider_scopes is null)) and credential_alias is not null and credential_alias ~ '^PRINTFUL_[A-Z0-9_]{1,64}_TOKEN$' and store_kind is not null and provider_type is not null and expected_account ~ '^[1-9][0-9]{0,14}$'))
);
create table private.r11_connection_revocations(grant_id uuid primary key references private.r11_connection_grants(id),created_at timestamptz not null default clock_timestamp());
create table private.r11_connection_attempts (
 id uuid primary key,grant_id uuid not null unique references private.r11_connection_grants(id),business_id uuid not null references public.businesses(id),
 owner_id uuid not null references auth.users(id),auth_session_id uuid not null,provider text not null check(provider in ('etsy','printful')),
 revision uuid not null,connection_id uuid not null,expected_connection_revision uuid,expected_connection_status text,state_hash text check(state_hash ~ '^[a-f0-9]{64}$'),envelope text,credential_fingerprint text not null check(credential_fingerprint ~ '^[a-f0-9]{64}$'),
 status text not null check(status in ('awaiting_owner','verifying','verified','failed','cancelled')),reason text check(reason in ('provider_unverified','owner_cancelled','access_expired')),
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null,completed_at timestamptz,
 check(envelope is null or (length(envelope) between 32 and 32768 and envelope ~ '^account-v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'))
);
create table private.r11_connection_markers(attempt_id uuid not null references private.r11_connection_attempts(id),step integer not null check(step between 0 and 2),method text not null check(method in ('GET','POST')),endpoint text not null,marked_at timestamptz not null default clock_timestamp(),primary key(attempt_id,step));
create table private.r11_connection_facts(attempt_id uuid not null references private.r11_connection_attempts(id),step integer not null check(step between 0 and 2),facts jsonb not null,recorded_at timestamptz not null default clock_timestamp(),primary key(attempt_id,step),foreign key(attempt_id,step) references private.r11_connection_markers(attempt_id,step));
create table private.r11_credential_versions(
 connection_id uuid not null,business_id uuid not null,provider text not null,revision uuid not null,grant_id uuid not null references private.r11_connection_grants(id),attempt_id uuid not null unique references private.r11_connection_attempts(id),
 custody text not null check(custody in ('encrypted_oauth','environment')),credential_alias text,credential_fingerprint text not null check(credential_fingerprint ~ '^[a-f0-9]{64}$'),
 permitted_operations jsonb not null,provider_scopes jsonb not null,token_expires_at timestamptz,expires_at timestamptz not null,verified_at timestamptz not null default clock_timestamp(),
 primary key(connection_id,revision),foreign key(connection_id,business_id,provider) references private.connected_accounts(id,business_id,provider),
 check((provider='etsy' and custody='encrypted_oauth' and credential_alias is null and permitted_operations='["shop.read","listing.read"]'::jsonb and provider_scopes='["shops_r","listings_r"]'::jsonb and token_expires_at is not null) or
 (provider='printful' and custody='environment' and credential_alias ~ '^PRINTFUL_[A-Z0-9_]{1,64}_TOKEN$' and permitted_operations='["catalog.read"]'::jsonb and private.r11_provider_scopes(provider_scopes)))
);
create table private.r11_etsy_secrets(connection_id uuid primary key,business_id uuid not null,provider text not null default 'etsy' check(provider='etsy'),revision uuid not null,envelope text,
 foreign key(connection_id,business_id,provider) references private.connected_accounts(id,business_id,provider),
 check(envelope is null or (length(envelope) between 32 and 32768 and envelope ~ '^account-v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$')));
create index r11_grants_business on private.r11_connection_grants(business_id,created_at desc,id desc);
create index r11_attempts_business on private.r11_connection_attempts(business_id,created_at desc,id desc);
create function private.r11_guard() returns trigger language plpgsql set search_path='' as $$ begin
 if current_user in ('anon','authenticated','service_role') then raise exception 'r11_guarded_rpc_required' using errcode='42501'; end if;
 if tg_table_name not in ('r11_connection_attempts','r11_etsy_secrets') and tg_op<>'INSERT' then raise exception 'r11_immutable_history'; end if;
 if tg_op='DELETE' then raise exception 'r11_history_retained'; end if;return new;
end $$;
do $$ declare n text; begin
 foreach n in array array['r11_connection_grants','r11_connection_revocations','r11_connection_attempts','r11_connection_markers','r11_connection_facts','r11_credential_versions','r11_etsy_secrets'] loop
 execute format('alter table private.%I enable row level security',n);execute format('revoke all on private.%I from public,anon,authenticated,service_role',n);
 execute format('create trigger r11_guard before insert or update or delete on private.%I for each row execute function private.r11_guard()',n);
 end loop;
end $$;
create function private.r11_auth_session() returns uuid language plpgsql stable set search_path='' as $$
declare j jsonb;s text;begin
 j:=coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}');s:=coalesce(nullif(current_setting('request.jwt.claim.session_id',true),''),j->>'session_id');
 if s is null or s !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return null;end if;return s::uuid;
end $$;
create function private.r11_session(o uuid,s uuid) returns boolean language plpgsql stable set search_path='' as $$
begin return s is not null and s=private.r11_auth_session() and exists(select 1 from auth.sessions where id=s and user_id=o and (not_after is null or not_after>clock_timestamp()));end
$$;
create function public.r11_connection_read(p_business_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_business_owner(p_business_id) then raise exception 'owner_required' using errcode='42501'; end if;
 return jsonb_build_object('businessId',p_business_id,
 'grantTotal',(select count(*) from private.r11_connection_grants where business_id=p_business_id and owner_id=auth.uid()),'attemptTotal',(select count(*) from private.r11_connection_attempts where business_id=p_business_id and owner_id=auth.uid()),
 'grants',coalesce((select jsonb_agg(x.item) from (select jsonb_build_object('id',g.id,'provider',g.provider,'expectedAccount',g.expected_account,'applicationId',g.application_id,'expiresAt',g.expires_at,'purposeHash',g.purpose_hash,'approvedCredentialFingerprint',g.approved_credential_fingerprint,'credentialAlias',g.credential_alias,'providerScopes',g.provider_scopes,'providerScopeMode',g.provider_scope_mode,
 'state',case when exists(select 1 from private.r11_connection_revocations r where r.grant_id=g.id) then 'revoked' when exists(select 1 from private.r11_connection_attempts a where a.grant_id=g.id) then 'used' when g.expires_at<=clock_timestamp() or not private.r11_session(g.owner_id,g.auth_session_id) then 'expired' else 'available' end) item
 from private.r11_connection_grants g where g.business_id=p_business_id and g.owner_id=auth.uid() order by (g.expires_at>clock_timestamp() and not exists(select 1 from private.r11_connection_attempts a where a.grant_id=g.id) and not exists(select 1 from private.r11_connection_revocations z where z.grant_id=g.id)) desc,g.created_at desc,g.id desc limit 25) x),'[]'::jsonb),
 'connections',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'provider',a.provider,'externalAccountId',a.provider_account_id,'label',coalesce(g.expected_account,a.provider_account_id),'revision',a.connection_revision,'status',case when a.status='revoked' then 'revoked' when exists(select 1 from private.r11_connection_revocations z where z.grant_id=v.grant_id) then 'revoked' when v.expires_at<=clock_timestamp() then 'expired' when a.provider='etsy' and v.token_expires_at<=clock_timestamp() then 'token_expired' else a.status end,'custody',v.custody,'verifiedAt',v.verified_at,'expiresAt',v.expires_at,'permittedOperations',v.permitted_operations,'providerScopes',v.provider_scopes,'providerExpiryVerified',false,'credentialAlias',v.credential_alias,'credentialFingerprint',v.credential_fingerprint)) from private.connected_accounts a join private.r11_credential_versions v on v.connection_id=a.id and v.revision=a.connection_revision and v.business_id=a.business_id join private.r11_connection_grants g on g.id=v.grant_id where a.business_id=p_business_id and a.owner_id=auth.uid()),'[]'::jsonb),
 'attempts',coalesce((select jsonb_agg(x.item) from (select jsonb_build_object('id',id,'provider',provider,'status',case when status in ('awaiting_owner','verifying') and expires_at<=clock_timestamp() then 'expired' else status end,'createdAt',created_at,'completedAt',completed_at,'reason',reason) item from private.r11_connection_attempts where business_id=p_business_id and owner_id=auth.uid() order by created_at desc,id desc limit 25) x),'[]'::jsonb));
end $$;
create function public.r11_connection_owner(p_business_id uuid,p_operation text,p_payload jsonb,p_server_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare g private.r11_connection_grants;a private.r11_connection_attempts;c private.connected_accounts;step_no integer;path text;method text;f jsonb;prior jsonb;target_connection_id uuid;expiry timestamptz;session_id uuid;authority_hash text;
begin
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>40000 then raise exception 'r11_invalid_payload'; end if;
 perform 1 from public.businesses where id=p_business_id and owner_user_id=auth.uid() for update;
 if not found then raise exception 'owner_required' using errcode='42501'; end if;
 authority_hash:=encode(extensions.digest(convert_to(p_server_key,'UTF8'),'sha256'),'hex');
 if p_operation<>'disconnect' then
 perform 1 from private.account_server_authority k where k.key_hash=authority_hash and (k.enabled or p_operation in ('fail','cancel','complete')) for share;
 if not found then raise exception 'r11_server_authority_required' using errcode='42501'; end if;end if;
 session_id:=private.r11_auth_session();
 perform 1 from auth.sessions where id=session_id and user_id=auth.uid() for share;
 if not private.r11_session(auth.uid(),session_id) then raise exception 'r11_session_required'; end if;
 if p_operation='disconnect' then
 perform private.r04_keys(p_payload,array['connectionId','revision']);
 select * into c from private.connected_accounts where id=(p_payload->>'connectionId')::uuid and business_id=p_business_id and owner_id=auth.uid() for update;
 if c.id is null or c.connection_revision is distinct from (p_payload->>'revision')::uuid or not exists(select 1 from private.r11_credential_versions v where v.connection_id=c.id and v.revision=c.connection_revision) then raise exception 'r11_connection_unavailable';end if;
 update private.connected_accounts set status='revoked',revoked_at=clock_timestamp() where id=c.id and status<>'revoked';
 update private.r11_etsy_secrets set envelope=null where connection_id=c.id and business_id=p_business_id;
 update private.r11_connection_attempts set status='cancelled',reason='owner_cancelled',envelope=null,completed_at=clock_timestamp() where business_id=p_business_id and provider=c.provider and status in ('awaiting_owner','verifying');
 return jsonb_build_object('disconnected',true,'providerRevoked',false);
 end if;
 if p_operation='begin' then
 perform private.r04_keys(p_payload,array['grantId','attemptId','revision','stateHash','envelope','credentialFingerprint']);
 select * into g from private.r11_connection_grants where id=(p_payload->>'grantId')::uuid and business_id=p_business_id and owner_id=auth.uid() for update;
 else
 select * into a from private.r11_connection_attempts where id=(p_payload->>'attemptId')::uuid and business_id=p_business_id and owner_id=auth.uid() for update;
 if a.id is null or a.auth_session_id<>session_id then raise exception 'r11_attempt_unavailable'; end if;
 select * into g from private.r11_connection_grants where id=a.grant_id and business_id=p_business_id and owner_id=auth.uid() for update;
 end if;
 if g.id is null or g.auth_session_id<>session_id then raise exception 'r11_grant_unavailable'; end if;
 if p_operation in ('cancel','fail') then
 perform private.r04_keys(p_payload,array['attemptId']);
 update private.r11_connection_attempts set status=case when p_operation='cancel' then 'cancelled' else 'failed' end,reason=case when p_operation='cancel' then 'owner_cancelled' else 'provider_unverified' end,envelope=null,completed_at=clock_timestamp() where id=a.id and status in ('awaiting_owner','verifying');
 return jsonb_build_object('closed',true);
 end if;
 -- All relevant locks are now held. Revocation insertion locks this grant via FK.
 if not private.r11_session(auth.uid(),session_id) or g.expires_at<=clock_timestamp() or exists(select 1 from private.r11_connection_revocations r where r.grant_id=g.id) or not exists(select 1 from private.account_server_authority k where k.key_hash=authority_hash and k.enabled) then raise exception 'r11_grant_inactive'; end if;
 if p_operation='begin' then
 select * into c from private.connected_accounts where business_id=p_business_id and provider=g.provider for update;
 if c.id is not null and c.owner_id<>auth.uid() then raise exception 'r11_owner_rebinding_required';end if;
 if not private.r11_session(auth.uid(),session_id) or g.expires_at<=clock_timestamp() then raise exception 'r11_grant_inactive';end if;
 if exists(select 1 from private.r11_connection_attempts where grant_id=g.id) then raise exception 'r11_grant_already_used'; end if;
 if jsonb_typeof(p_payload->'credentialFingerprint') is distinct from 'string' or jsonb_typeof(p_payload->'attemptId') is distinct from 'string' or jsonb_typeof(p_payload->'revision') is distinct from 'string' or p_payload->>'credentialFingerprint' !~ '^[a-f0-9]{64}$' then raise exception 'r11_invalid_credential_binding'; end if;
 if p_payload->>'credentialFingerprint' is distinct from g.approved_credential_fingerprint then raise exception 'r11_unapproved_credential';end if;
 if g.provider='etsy' and (jsonb_typeof(p_payload->'stateHash') is distinct from 'string' or jsonb_typeof(p_payload->'envelope') is distinct from 'string' or p_payload->>'stateHash' !~ '^[a-f0-9]{64}$' or p_payload->>'envelope' is null) then raise exception 'r11_oauth_binding_required'; end if;
 if g.provider='printful' and (p_payload->'stateHash'<>'null'::jsonb or p_payload->'envelope'<>'null'::jsonb) then raise exception 'r11_unexpected_secret'; end if;
 insert into private.r11_connection_attempts(id,grant_id,business_id,owner_id,auth_session_id,provider,revision,connection_id,expected_connection_revision,expected_connection_status,state_hash,envelope,credential_fingerprint,status,expires_at)
 values((p_payload->>'attemptId')::uuid,g.id,p_business_id,auth.uid(),session_id,g.provider,(p_payload->>'revision')::uuid,coalesce(c.id,(p_payload->>'attemptId')::uuid),c.connection_revision,c.status,p_payload->>'stateHash',p_payload->>'envelope',p_payload->>'credentialFingerprint',case when g.provider='etsy' then 'awaiting_owner' else 'verifying' end,least(g.expires_at,clock_timestamp()+interval '10 minutes')) returning * into a;
 return jsonb_build_object('attemptId',a.id,'connectionId',a.connection_id,'revision',a.revision,'expiresAt',a.expires_at,'expectedAccount',g.expected_account,'storeKind',g.store_kind,'providerType',g.provider_type,'providerScopes',g.provider_scopes,'connectionExpiresAt',g.connection_expires_at,'applicationId',g.application_id);
 end if;
 if a.expires_at<=clock_timestamp() or a.status not in ('awaiting_owner','verifying') then raise exception 'r11_attempt_inactive'; end if;
 if p_operation='consume' then
 perform private.r04_keys(p_payload,array['attemptId','stateHash','credentialFingerprint']);
 if g.provider<>'etsy' or a.status<>'awaiting_owner' or a.state_hash is distinct from p_payload->>'stateHash' or a.credential_fingerprint is distinct from p_payload->>'credentialFingerprint' then raise exception 'r11_oauth_binding_mismatch'; end if;
 prior:=jsonb_build_object('envelope',a.envelope,'connectionId',a.connection_id,'revision',a.revision,'expiresAt',a.expires_at,'expectedAccount',g.expected_account,'applicationId',g.application_id,'connectionExpiresAt',g.connection_expires_at);
 update private.r11_connection_attempts set status='verifying',envelope=null where id=a.id;
 return prior;
 elsif p_operation='mark' then
 perform private.r04_keys(p_payload,array['attemptId','step','facts','credentialFingerprint']);
 if a.status<>'verifying' or a.credential_fingerprint is distinct from p_payload->>'credentialFingerprint' then raise exception 'r11_credential_changed'; end if;
 if jsonb_typeof(p_payload->'step') is distinct from 'number' or jsonb_typeof(p_payload->'facts') is distinct from 'object' then raise exception 'r11_invalid_step';end if;
 step_no:=(p_payload->>'step')::integer;f:=p_payload->'facts';
 if (step_no<0 or step_no>(case when g.provider='etsy' then 2 else 1 end)) or exists(select 1 from private.r11_connection_markers where attempt_id=a.id and step=step_no) then raise exception 'r11_already_dispatched'; end if;
 if step_no>0 and not exists(select 1 from private.r11_connection_markers where attempt_id=a.id and step=step_no-1) then raise exception 'r11_sequence_required'; end if;
 if g.provider='etsy' then
 if step_no=0 then if f<>'{}'::jsonb then raise exception 'r11_invalid_facts'; end if;path:='/v3/public/oauth/token';method:='POST';
 elsif step_no=1 then
 perform private.r04_keys(f,array['userId','scopes','tokenExpiresAt']);
 if jsonb_typeof(f->'userId') is distinct from 'number' or jsonb_typeof(f->'scopes') is distinct from 'array' or jsonb_typeof(f->'tokenExpiresAt') is distinct from 'string' or f->>'userId' !~ '^[1-9][0-9]{0,14}$' or f->'scopes'<>'["shops_r","listings_r"]'::jsonb or (f->>'tokenExpiresAt')::timestamptz<=clock_timestamp() or (f->>'tokenExpiresAt')::timestamptz>clock_timestamp()+interval '1 hour' then raise exception 'r11_read_scope_required'; end if;
 insert into private.r11_connection_facts values(a.id,0,f,clock_timestamp());path:='/v3/application/users/'||(f->>'userId')||'/shops';method:='GET';
 else
 perform private.r04_keys(f,array['userId','shopId','shopName','currency']);select facts into prior from private.r11_connection_facts where attempt_id=a.id and step=0;
 if jsonb_typeof(f->'userId') is distinct from 'number' or jsonb_typeof(f->'shopId') is distinct from 'number' or jsonb_typeof(f->'shopName') is distinct from 'string' or jsonb_typeof(f->'currency') is distinct from 'string' or f->>'userId' is distinct from prior->>'userId' or f->>'shopId' !~ '^[1-9][0-9]{0,14}$' or f->>'shopName' is distinct from g.expected_account or f->>'currency' !~ '^[A-Z]{3}$' then raise exception 'r11_shop_mismatch'; end if;
 insert into private.r11_connection_facts values(a.id,1,f,clock_timestamp());path:='/v3/application/shops/'||(f->>'shopId')||'/listings?state=draft&limit=1&offset=0';method:='GET';
 end if;path:='https://api.etsy.com'||path;
 else
 if f<>'{}'::jsonb then raise exception 'r11_invalid_facts'; end if;
 path:='https://api.printful.com'||case step_no when 0 then '/oauth/scopes' else '/stores/'||g.expected_account end;method:='GET';
 end if;
 if not private.r11_session(auth.uid(),session_id) or g.expires_at<=clock_timestamp() or a.expires_at<=clock_timestamp() then raise exception 'r11_dispatch_expired'; end if;
 insert into private.r11_connection_markers(attempt_id,step,method,endpoint) values(a.id,step_no,method,path);
 return jsonb_build_object('shouldDispatch',true,'attemptId',a.id,'step',step_no,'method',method,'endpoint',path,'expiresAt',least(g.expires_at,a.expires_at,clock_timestamp()+interval '15 seconds'));
 elsif p_operation='complete' then
 perform private.r04_keys(p_payload,array['attemptId','proof','envelope','credentialFingerprint']);f:=p_payload->'proof';
 select * into c from private.connected_accounts where business_id=p_business_id and provider=g.provider for update;
 if c.connection_revision is distinct from a.expected_connection_revision or c.status is distinct from a.expected_connection_status or (c.id is not null and (c.id<>a.connection_id or c.owner_id<>auth.uid())) then raise exception 'r11_stale_connection_revision';end if;
 if a.credential_fingerprint is distinct from p_payload->>'credentialFingerprint' or (select count(*) from private.r11_connection_markers where attempt_id=a.id)<>(case when g.provider='etsy' then 3 else 2 end) then raise exception 'r11_incomplete_verification'; end if;
 if g.provider='etsy' then
 perform private.r04_keys(f,array['userId','shopId','shopName','currency','listingCount','totalDrafts','factsHash','verifiedAt']);
 select facts into prior from private.r11_connection_facts where attempt_id=a.id and step=1;
 if jsonb_typeof(f->'userId') is distinct from 'number' or jsonb_typeof(f->'shopId') is distinct from 'number' or jsonb_typeof(f->'listingCount') is distinct from 'number' or jsonb_typeof(f->'totalDrafts') is distinct from 'number' or jsonb_typeof(f->'factsHash') is distinct from 'string' or jsonb_typeof(p_payload->'envelope') is distinct from 'string' or f->>'shopId' is distinct from prior->>'shopId' or f->>'userId' is distinct from prior->>'userId' or f->>'shopName' is distinct from g.expected_account or f->>'currency' is distinct from prior->>'currency' or f->>'listingCount' !~ '^[01]$' or f->>'totalDrafts' !~ '^(0|[1-9][0-9]{0,9})$' or (f->>'totalDrafts')::bigint<(f->>'listingCount')::integer or f->>'factsHash' !~ '^[a-f0-9]{64}$' or p_payload->>'envelope' !~ '^account-v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$' then raise exception 'r11_invalid_proof'; end if;
 select * into c from private.connected_accounts where business_id=p_business_id and provider='etsy' for update;
 if c.id is not null and c.provider_account_id<>f->>'shopId' then raise exception 'r11_store_reassignment_denied'; end if;
 target_connection_id:=a.connection_id;
 if exists(select 1 from private.etsy_connections where business_id=p_business_id or shop_id::text=f->>'shopId') then raise exception 'r11_legacy_binding_requires_review';end if;
 insert into private.connected_accounts(id,business_id,owner_id,provider,provider_account_id,status,connection_revision,verified_at) values(target_connection_id,p_business_id,auth.uid(),'etsy',f->>'shopId','connected',a.revision,clock_timestamp()) on conflict(id) do update set connection_revision=excluded.connection_revision,status='connected',verified_at=excluded.verified_at,revoked_at=null;
 insert into private.r11_etsy_secrets(connection_id,business_id,revision,envelope) values(target_connection_id,p_business_id,a.revision,p_payload->>'envelope') on conflict(connection_id) do update set revision=excluded.revision,envelope=excluded.envelope;
 select (facts->>'tokenExpiresAt')::timestamptz into expiry from private.r11_connection_facts where attempt_id=a.id and step=0;
 insert into private.r11_credential_versions values(target_connection_id,p_business_id,'etsy',a.revision,g.id,a.id,'encrypted_oauth',null,a.credential_fingerprint,'["shop.read","listing.read"]','["shops_r","listings_r"]',expiry,g.connection_expires_at,clock_timestamp());
 else
 perform private.r04_keys(f,array['storeId','storeKind','providerType','providerScopes','responseHash','verifiedAt']);
 if jsonb_typeof(f->'storeId') is distinct from 'number' or jsonb_typeof(f->'providerScopes') is distinct from 'array' or jsonb_typeof(f->'responseHash') is distinct from 'string' or f->>'storeId' is distinct from g.expected_account or f->>'storeKind' is distinct from g.store_kind or not private.r11_provider_scopes(f->'providerScopes') or (g.provider_scope_mode='exact' and (not((f->'providerScopes') @> g.provider_scopes) or not(g.provider_scopes @> (f->'providerScopes')))) or f->>'providerType' is distinct from g.provider_type or jsonb_typeof(f->'providerType') is distinct from 'string' or f->>'providerType' !~ '^[a-z][a-z0-9_-]{0,79}$' or (g.store_kind='manual_api' and f->>'providerType'<>'native') or (g.store_kind='ecommerce_linked' and f->>'providerType'='native') or f->>'responseHash' !~ '^[a-f0-9]{64}$' or p_payload->'envelope'<>'null'::jsonb then raise exception 'r11_invalid_proof'; end if;
 select * into c from private.connected_accounts where business_id=p_business_id and provider='printful' for update;
 if c.id is not null and c.provider_account_id<>g.expected_account then raise exception 'r11_store_reassignment_denied'; end if;
 target_connection_id:=a.connection_id;
 insert into private.connected_accounts(id,business_id,owner_id,provider,provider_account_id,status,connection_revision,verified_at) values(target_connection_id,p_business_id,auth.uid(),'printful',g.expected_account,'connected',a.revision,clock_timestamp()) on conflict(id) do update set connection_revision=excluded.connection_revision,status='connected',verified_at=excluded.verified_at,revoked_at=null;
 if exists(select 1 from private.provider_connections where id=target_connection_id) then raise exception 'r11_legacy_binding_requires_review';end if;
 insert into private.r11_credential_versions values(target_connection_id,p_business_id,'printful',a.revision,g.id,a.id,'environment',g.credential_alias,a.credential_fingerprint,'["catalog.read"]',f->'providerScopes',null,g.connection_expires_at,clock_timestamp());
 end if;
 if not private.r11_session(auth.uid(),session_id) or g.expires_at<=clock_timestamp() or a.expires_at<=clock_timestamp() or not exists(select 1 from public.businesses where id=p_business_id and owner_user_id=auth.uid()) or not exists(select 1 from private.account_server_authority k where k.key_hash=authority_hash and k.enabled) or exists(select 1 from private.r11_connection_revocations r where r.grant_id=g.id) or (g.provider='etsy' and expiry<=clock_timestamp()) then raise exception 'r11_completion_expired';end if;
 if f->>'verifiedAt' is null or (f->>'verifiedAt')::timestamptz<a.created_at or (f->>'verifiedAt')::timestamptz>clock_timestamp()+interval '1 second' then raise exception 'r11_invalid_observation_time';end if;
 insert into private.r11_connection_facts values(a.id,case when g.provider='etsy' then 2 else 1 end,f,clock_timestamp());update private.r11_connection_attempts set status='verified',completed_at=clock_timestamp(),envelope=null where id=a.id;
 return jsonb_build_object('verified',true,'connectionId',target_connection_id,'revision',a.revision);
 else raise exception 'r11_unknown_operation';end if;
end $$;
revoke all on function private.r11_provider_scopes(jsonb),private.r11_guard(),private.r11_auth_session(),private.r11_session(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.r11_connection_read(uuid),public.r11_connection_owner(uuid,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.r11_connection_read(uuid),public.r11_connection_owner(uuid,text,jsonb,text) to authenticated;
commit;
