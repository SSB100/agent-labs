-- Additive account setup boundary. Definitions only: no credentials, enabled
-- authorities, provider requests, existing Etsy changes or account activation.
create function private.account_valid_profile(p jsonb) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(p)='object'
  and p ?& array['email','givenName','familyName','countryCode','locale']
  and p-array['email','givenName','familyName','countryCode','locale']='{}'::jsonb
  and not exists(select 1 from jsonb_each(p) where jsonb_typeof(value)<>'string')
  and length(p->>'email') between 3 and 254 and p->>'email' ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  and length(btrim(p->>'givenName')) between 1 and 100 and length(btrim(p->>'familyName')) between 0 and 100
  and p->>'countryCode' ~ '^[A-Z]{2}$' and p->>'locale' ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$'
  and not exists(select 1 from jsonb_each_text(p) where value ~ '[[:cntrl:]]'),false)
$$;
revoke all on function private.account_valid_profile(jsonb) from public,anon,authenticated,service_role;

create table private.account_server_authority (
 key_hash text primary key check(key_hash ~ '^[a-f0-9]{64}$'), enabled boolean not null default false
);
create table private.account_profiles (
 business_id uuid primary key references public.businesses(id) on delete restrict,
 owner_id uuid not null references auth.users(id) on delete restrict,
 profile jsonb not null check(private.account_valid_profile(profile)),
 revision uuid not null default gen_random_uuid(),
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp()
);
create table private.connected_accounts (
 id uuid primary key, business_id uuid not null references public.businesses(id) on delete restrict,
 owner_id uuid not null references auth.users(id) on delete restrict,
 provider text not null check(provider in ('etsy','printful')), provider_account_id text not null check(length(provider_account_id) between 1 and 120),
 status text not null check(status in ('connected','revoked')), connection_revision uuid not null,
 verified_at timestamptz not null, revoked_at timestamptz,
 unique(business_id,provider), unique(provider,provider_account_id), unique(id,business_id), unique(id,business_id,provider)
);
create table private.provider_connections (
 id uuid primary key, business_id uuid not null,
 provider text not null default 'printful' check(provider='printful'),
 revision uuid not null, store_id bigint not null check(store_id>0), store_kind text not null check(store_kind in ('manual_api','ecommerce_linked')),
 scopes jsonb not null check(scopes='["catalog.read"]'::jsonb),
 provider_scopes jsonb not null check(provider_scopes in ('[]'::jsonb,'["stores_list/read"]'::jsonb)),
 credential_envelope text check(length(credential_envelope) between 32 and 20000 and credential_envelope ~ '^account-v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'),
 expires_at timestamptz not null,
 foreign key(id,business_id,provider) references private.connected_accounts(id,business_id,provider) on delete restrict
);
create table private.account_password_credentials (
 connection_id uuid primary key, business_id uuid not null, provider text not null,
 owner_id uuid not null references auth.users(id) on delete restrict,
 revision uuid not null, saved_connection_revision uuid not null,
 envelope text not null check(length(envelope) between 32 and 20000 and envelope ~ '^account-v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'),
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 foreign key(connection_id,business_id,provider) references private.connected_accounts(id,business_id,provider) on delete restrict
);
create table private.account_setup_runs (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete restrict,
 owner_id uuid not null references auth.users(id) on delete restrict,
 provider text not null check(provider in ('etsy','printful')), mode text not null check(mode in ('create','connect')),
 idempotency_key text not null check(length(idempotency_key) between 16 and 120), connection_id uuid not null,
 expected_connection_revision uuid, profile_revision uuid not null,
 disclosure jsonb not null, disclosure_hash text not null check(disclosure_hash ~ '^[a-f0-9]{64}$'),
 status text not null default 'pending_approval' check(status in ('pending_approval','approved','preparation_started','owner_handoff','verified','cancelled','invalidated','expired')),
 revision integer not null default 0 check(revision>=0), approval_expires_at timestamptz not null,
 approved_at timestamptz, preparation_id uuid, preparation_receipt jsonb, receipt jsonb,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 unique(business_id,idempotency_key), unique(id,business_id),
 check(status not in ('approved','preparation_started','owner_handoff','verified') or approved_at is not null),
 check(status<>'verified' or receipt is not null)
);
create unique index account_setup_one_live_provider on private.account_setup_runs(business_id,provider)
 where status in ('pending_approval','approved','preparation_started','owner_handoff');
create table private.account_browser_handoffs (
 id uuid primary key, business_id uuid not null, setup_run_id uuid not null unique,
 owner_id uuid not null references auth.users(id) on delete restrict,
 preparation_id uuid not null,
 envelope text not null check(length(envelope) between 32 and 20000 and envelope ~ '^account-v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'),
 expires_at timestamptz not null, status text not null default 'awaiting_owner' check(status in ('awaiting_owner','released')),
 created_at timestamptz not null default clock_timestamp(), released_at timestamptz,
 foreign key(setup_run_id,business_id) references private.account_setup_runs(id,business_id) on delete restrict
);
create table private.account_health_events (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete restrict,
 provider text check(provider in ('etsy','printful')), setup_run_id uuid,
 event_type text not null check(event_type in ('profile_saved','prepared','approved','preparation_started','owner_handoff','verified','cancelled','invalidated','expired','local_revoked','password_saved','password_removed')),
 -- Only server-constructed redacted receipts enter this column; never raw evidence.
 summary jsonb not null default '{}'::jsonb, created_at timestamptz not null default clock_timestamp(),
 foreign key(setup_run_id,business_id) references private.account_setup_runs(id,business_id) on delete restrict
);
create index account_health_events_business_time on private.account_health_events(business_id,created_at desc);
do $$ declare n text; begin
 foreach n in array array['account_server_authority','account_profiles','connected_accounts','provider_connections','account_setup_runs','account_health_events','account_browser_handoffs','account_password_credentials'] loop
  execute format('alter table private.%I enable row level security',n);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',n);
 end loop;
end $$;

create function private.account_run_view(r private.account_setup_runs) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',r.id,'runId',r.id,'businessId',r.business_id,'provider',r.provider,'mode',r.mode,
 'connectionId',r.connection_id,'profileRevision',r.profile_revision,'disclosure',r.disclosure,'disclosureHash',r.disclosure_hash,
 'status',case when r.status in ('pending_approval','approved','preparation_started','owner_handoff') and r.approval_expires_at<=clock_timestamp() then 'expired' else r.status end,
 'revision',r.revision,'approvalExpiresAt',r.approval_expires_at,'approvedAt',r.approved_at,
 'preparationId',r.preparation_id,'preparationReceipt',r.preparation_receipt,'receipt',r.receipt,'createdAt',r.created_at,'updatedAt',r.updated_at)
$$;
revoke all on function private.account_run_view(private.account_setup_runs) from public,anon,authenticated,service_role;

create function private.account_registry(p_business_id uuid) returns jsonb
language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(item order by item->>'provider'),'[]'::jsonb) from (
  -- Etsy always projects the unchanged authoritative source, including revocation.
  select jsonb_build_object('id',coalesce(a.id,e.id),'etsyConnectionId',e.id,'provider','etsy','providerAccountId',e.shop_id::text,'shopId',e.shop_id,'shopName',e.shop_name,'label',e.shop_name,'externalAccountId',e.shop_id::text,'expiresAt',null,
   'status',e.status,'revision',e.revision,'scopes','["shops_r","listings_r","listings_w"]'::jsonb,'verifiedAt',e.connected_at,
   'passwordStored',pw.connection_id is not null,'passwordRevision',pw.revision,'source','existing_etsy_connection') item
  from private.etsy_connections e
  left join private.connected_accounts a on a.business_id=e.business_id and a.provider='etsy' and a.owner_id=auth.uid()
  left join private.account_password_credentials pw on pw.connection_id=a.id and pw.owner_id=auth.uid() where e.business_id=p_business_id and e.owner_id=auth.uid()
  union all
  select jsonb_build_object('id',a.id,'provider','printful','providerAccountId',a.provider_account_id,'storeId',p.store_id,'storeKind',p.store_kind,'label','Printful store '||p.store_id,'externalAccountId',p.store_id::text,
   'status',case when a.status='connected' and p.expires_at<=clock_timestamp() then 'expired' else a.status end,
   'revision',a.connection_revision,'scopes',p.scopes,'expiresAt',p.expires_at,'verifiedAt',a.verified_at,'passwordStored',pw.connection_id is not null,'passwordRevision',pw.revision,'source','verified_printful_store')
  from private.connected_accounts a join private.provider_connections p on p.id=a.id and p.business_id=a.business_id
  left join private.account_password_credentials pw on pw.connection_id=a.id and pw.owner_id=auth.uid()
  where a.business_id=p_business_id and a.owner_id=auth.uid() and a.provider='printful'
 ) x
$$;
revoke all on function private.account_registry(uuid) from public,anon,authenticated,service_role;

create function private.account_owner(p_business_id uuid,p_operation text,p_payload jsonb,p_server_key text) returns jsonb
language plpgsql set search_path='' as $$
declare p private.account_profiles%rowtype; r private.account_setup_runs%rowtype; a private.connected_accounts%rowtype;
 c private.provider_connections%rowtype; e private.etsy_connections%rowtype; browser_handoff private.account_browser_handoffs%rowtype; password_record private.account_password_credentials%rowtype; d jsonb; ev jsonb; fields jsonb; data jsonb;
 expected_revision uuid; reserved_id uuid; h text; f text; ttl integer; result jsonb; evidence_revision uuid;
 allowed_fields constant text[]:=array['email','givenName','familyName','countryCode','locale'];
begin
 if not private.is_business_owner(p_business_id) then raise exception 'owner_required' using errcode='42501'; end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>50000 then raise exception 'invalid_request'; end if;
 if p_operation='workspace' then
  return jsonb_build_object('profile',(select profile||jsonb_build_object('revision',revision) from private.account_profiles where business_id=p_business_id and owner_id=auth.uid()),
   'accounts',private.account_registry(p_business_id),
   'runs',coalesce((select jsonb_agg(private.account_run_view(x) order by x.created_at desc) from (select * from private.account_setup_runs where business_id=p_business_id and owner_id=auth.uid() order by created_at desc limit 50) x),'[]'::jsonb),
   'healthEvents',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'provider',x.provider,'runId',x.setup_run_id,'eventType',x.event_type,'summary',x.summary,'occurredAt',x.created_at) order by x.created_at desc) from (select * from private.account_health_events where business_id=p_business_id order by created_at desc limit 100) x),'[]'::jsonb));
 end if;
 if coalesce(length(p_server_key),0)<32 or not exists(select 1 from private.account_server_authority where key_hash=private.stage13_hash(p_server_key) and enabled)
  then raise exception 'server_authority_required' using errcode='42501'; end if;
 -- Same lock as existing Etsy OAuth/connection code: cancellation, profile edits,
 -- provider revision changes, admission and completion serialize per Business.
 perform 1 from public.businesses where id=p_business_id for update;
 -- Ownership may have changed while waiting for the row lock.
 if not private.is_business_owner(p_business_id) then raise exception 'owner_required' using errcode='42501'; end if;
 select * into p from private.account_profiles where business_id=p_business_id and owner_id=auth.uid() for update;
 if p_operation='save_profile' then
  if p_payload-array['profile','expectedRevision']<>'{}'::jsonb or not private.account_valid_profile(p_payload->'profile') then raise exception 'invalid_account_profile'; end if;
  if p.revision is distinct from (p_payload->>'expectedRevision')::uuid then raise exception 'stale_profile_revision'; end if;
  if p.profile is not distinct from p_payload->'profile' then return jsonb_build_object('profile',p.profile||jsonb_build_object('revision',p.revision)); end if;
  insert into private.account_profiles(business_id,owner_id,profile) values(p_business_id,auth.uid(),p_payload->'profile')
   on conflict(business_id) do update set profile=excluded.profile,owner_id=excluded.owner_id,revision=gen_random_uuid(),updated_at=clock_timestamp() returning * into p;
  with changed as (update private.account_setup_runs set status='invalidated',revision=revision+1,updated_at=clock_timestamp()
   where business_id=p_business_id and status in ('pending_approval','approved','preparation_started','owner_handoff') returning *)
  insert into private.account_health_events(business_id,provider,setup_run_id,event_type,summary)
   select business_id,provider,id,'invalidated','{"reasonCode":"profile_changed"}' from changed;
  insert into private.account_health_events(business_id,event_type,summary) values(p_business_id,'profile_saved',jsonb_build_object('profileRevision',p.revision));
  return jsonb_build_object('profile',p.profile||jsonb_build_object('revision',p.revision));
 end if;
 select * into a from private.connected_accounts where business_id=p_business_id and provider=p_payload->>'provider' for update;
 if p_operation='delete_password' then
  if p_payload-array['provider','connectionId','expectedPasswordRevision']<>'{}'::jsonb
   or a.id is null or a.id is distinct from (p_payload->>'connectionId')::uuid or a.owner_id is distinct from auth.uid() then raise exception 'password_owner_required'; end if;
  select * into password_record from private.account_password_credentials where connection_id=a.id and business_id=p_business_id and owner_id=auth.uid() for update;
  if password_record.connection_id is null then return jsonb_build_object('removed',true); end if;
  if password_record.revision is distinct from (p_payload->>'expectedPasswordRevision')::uuid then raise exception 'stale_password_revision'; end if;
  delete from private.account_password_credentials where connection_id=a.id;
  insert into private.account_health_events(business_id,provider,event_type,summary) values(p_business_id,a.provider,'password_removed',jsonb_build_object('connectionId',a.id,'passwordRevision',password_record.revision,'providerPasswordChanged',false));
  return jsonb_build_object('removed',true);
 end if;
 if p_operation='save_password' then
  if p_payload-array['provider','connectionId','expectedConnectionRevision','expectedPasswordRevision','passwordRevision','envelope']<>'{}'::jsonb
   or a.id is null or a.id is distinct from (p_payload->>'connectionId')::uuid or a.owner_id is distinct from auth.uid() or a.status<>'connected'
   or a.connection_revision is distinct from (p_payload->>'expectedConnectionRevision')::uuid then raise exception 'verified_connection_required'; end if;
  if a.provider='etsy' then
   select * into e from private.etsy_connections where business_id=p_business_id and owner_id=auth.uid() for update;
   if e.status is distinct from 'connected' or e.revision is distinct from a.connection_revision or e.envelope is null then raise exception 'account_access_revoked'; end if;
  else
   select * into c from private.provider_connections where id=a.id for update;
   if c.credential_envelope is null or c.expires_at<=clock_timestamp() then raise exception 'account_access_revoked'; end if;
  end if;
  select * into password_record from private.account_password_credentials where connection_id=a.id for update;
  if password_record.revision is distinct from (p_payload->>'expectedPasswordRevision')::uuid then raise exception 'stale_password_revision'; end if;
  evidence_revision:=(p_payload->>'passwordRevision')::uuid;
  if evidence_revision is null or evidence_revision=password_record.revision then raise exception 'fresh_password_revision_required'; end if;
  insert into private.account_password_credentials(connection_id,business_id,provider,owner_id,revision,saved_connection_revision,envelope)
   values(a.id,p_business_id,a.provider,auth.uid(),evidence_revision,a.connection_revision,p_payload->>'envelope')
   on conflict(connection_id) do update set revision=excluded.revision,saved_connection_revision=excluded.saved_connection_revision,envelope=excluded.envelope,updated_at=clock_timestamp();
  insert into private.account_health_events(business_id,provider,event_type,summary) values(p_business_id,a.provider,'password_saved',jsonb_build_object('connectionId',a.id,'passwordRevision',evidence_revision,'providerTransmission',false));
  return jsonb_build_object('passwordStored',true,'passwordRevision',evidence_revision);
 end if;
 if p_operation='connection' then
  if p_payload-array['provider','connectionId','revision']<>'{}'::jsonb or p_payload->>'provider' is distinct from 'printful' then raise exception 'existing_etsy_resolver_required'; end if;
  select * into c from private.provider_connections where id=a.id and business_id=p_business_id for update;
  if a.status is distinct from 'connected' or a.owner_id is distinct from auth.uid() or c.credential_envelope is null or c.expires_at<=clock_timestamp()
   or (p_payload ? 'connectionId' and a.id is distinct from (p_payload->>'connectionId')::uuid) or (p_payload ? 'revision' and a.connection_revision is distinct from (p_payload->>'revision')::uuid) then raise exception 'account_access_revoked'; end if;
  return jsonb_build_object('id',a.id,'businessId',a.business_id,'provider','printful','revision',c.revision,'storeId',c.store_id,'storeKind',c.store_kind,'scopes',c.scopes,'expiresAt',to_char(c.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'verifiedAt',to_char(a.verified_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'providerScopes',c.provider_scopes,'credentialEnvelope',c.credential_envelope);
 elsif p_operation='revoke' then
  if p_payload-array['provider','expectedConnectionRevision','etsyServerKey']<>'{}'::jsonb or coalesce(p_payload->>'provider','') not in ('printful','etsy') or (p_payload->>'provider'='printful' and p_payload ? 'etsyServerKey') then raise exception 'invalid_request'; end if;
  if p_payload->>'provider'='etsy' then
   select * into e from private.etsy_connections where business_id=p_business_id and owner_id=auth.uid() for update;
   if e.id is null or e.revision is distinct from (p_payload->>'expectedConnectionRevision')::uuid then raise exception 'stale_connection_revision'; end if;
   if e.status='connected' then
    -- Existing OAuth/disconnect code uses this same Business row lock. Compare
    -- and unchanged legacy disconnect are one atomic transaction, never a
    -- server read followed by a separately racing disconnect request.
    perform public.etsy_owner_transition(p_business_id,'disconnect','{}'::jsonb,p_payload->>'etsyServerKey');
    select * into e from private.etsy_connections where business_id=p_business_id and owner_id=auth.uid() for update;
   end if;
   if e.status<>'revoked' or e.envelope is not null then raise exception 'existing_etsy_disconnect_required'; end if;
   update private.connected_accounts set status='revoked',revoked_at=clock_timestamp(),connection_revision=e.revision where business_id=p_business_id and provider='etsy';
   with changed as (update private.account_setup_runs set status='invalidated',revision=revision+1,updated_at=clock_timestamp()
    where business_id=p_business_id and provider='etsy' and status in ('pending_approval','approved','preparation_started','owner_handoff') returning *)
   insert into private.account_health_events(business_id,provider,setup_run_id,event_type,summary)
    select business_id,provider,id,'invalidated','{"reasonCode":"existing_etsy_access_revoked"}' from changed;
   if not exists(select 1 from private.account_health_events where business_id=p_business_id and provider='etsy' and event_type='local_revoked' and summary->>'revision'=e.revision::text) then
    insert into private.account_health_events(business_id,provider,event_type,summary) values(p_business_id,'etsy','local_revoked',jsonb_build_object('connectionId',e.id,'revision',e.revision,'remoteTokenRevoked',false));
   end if;
   return jsonb_build_object('revoked',true,'remoteTokenRevoked',false,'revision',e.revision);
  end if;
  if a.id is null or a.owner_id is distinct from auth.uid() or a.connection_revision is distinct from (p_payload->>'expectedConnectionRevision')::uuid then raise exception 'stale_connection_revision'; end if;
  if a.status='revoked' then return jsonb_build_object('revoked',true,'remoteTokenRevoked',false); end if;
  evidence_revision:=gen_random_uuid();
  update private.connected_accounts set status='revoked',revoked_at=clock_timestamp(),connection_revision=evidence_revision where id=a.id;
  update private.provider_connections set credential_envelope=null,revision=evidence_revision where id=a.id;
  with changed as (update private.account_setup_runs set status='invalidated',revision=revision+1,updated_at=clock_timestamp()
   where business_id=p_business_id and provider='printful' and status in ('pending_approval','approved','preparation_started','owner_handoff') returning *)
  insert into private.account_health_events(business_id,provider,setup_run_id,event_type,summary)
   select business_id,provider,id,'invalidated','{"reasonCode":"local_authorization_revoked"}' from changed;
  insert into private.account_health_events(business_id,provider,event_type,summary) values(p_business_id,'printful','local_revoked',jsonb_build_object('connectionId',a.id,'remoteTokenRevoked',false));
  return jsonb_build_object('revoked',true,'remoteTokenRevoked',false,'revision',evidence_revision);
 elsif p_operation='prepare' then
  if p_payload-array['idempotencyKey','provider','mode','profileRevision','disclosure','approvalTtlSeconds']<>'{}'::jsonb
   or p_payload->>'provider' not in ('etsy','printful') or p_payload->>'mode' not in ('create','connect')
   or coalesce(length(p_payload->>'idempotencyKey'),0) not between 16 and 120 then raise exception 'invalid_setup_request'; end if;
  if p.revision is null or p.revision is distinct from (p_payload->>'profileRevision')::uuid then raise exception 'stale_profile_revision'; end if;
  ttl:=coalesce((p_payload->>'approvalTtlSeconds')::integer,1800);
  if ttl not between 60 and 1800 then raise exception 'invalid_approval_ttl'; end if;
  d:=p_payload->'disclosure'; fields:=d->'profileFields'; data:=d->'disclosedData';
  if jsonb_typeof(d) is distinct from 'object' or d-array['provider','mode','profileRevision','profileFields','disclosedData','destination','termsUrl','privacyUrl','purpose','scopes','cost','termsAcknowledgementRequired','secureOwnerSteps','browserProcessing']<>'{}'::jsonb
   or d->>'provider' is distinct from p_payload->>'provider' or d->>'mode' is distinct from p_payload->>'mode' or d->>'profileRevision' is distinct from p.revision::text
   or jsonb_typeof(fields) is distinct from 'array' or jsonb_typeof(data) is distinct from 'object'
   or d->'browserProcessing' is distinct from (case when p_payload->>'mode'='create' then '{"provider":"browserbase","purpose":"registration_preparation_and_owner_handoff","recordSession":false,"logSession":false,"maxSessionSeconds":900,"requiresSeparateActivation":true}'::jsonb else 'null'::jsonb end)
   or d->'cost' is distinct from '{"amountMinor":0,"currency":null,"subscription":false}'::jsonb
   or d->'termsAcknowledgementRequired' is distinct from to_jsonb(p_payload->>'mode'='create')
   or d->'secureOwnerSteps' is distinct from '["password","email_verification","mfa","billing","identity_verification","access_grant"]'::jsonb
   or coalesce(length(d->>'purpose'),0) not between 1 and 300 then raise exception 'invalid_disclosure'; end if;
  if jsonb_array_length(fields)>5 or (select count(*)<>count(distinct value) from jsonb_array_elements(fields))
   or exists(select 1 from jsonb_array_elements(fields) where jsonb_typeof(value)<>'string' or not(value#>>'{}'=any(allowed_fields)))
   or data is distinct from coalesce((select jsonb_object_agg(k,p.profile->k) from jsonb_array_elements_text(fields) k),'{}'::jsonb)
   then raise exception 'disclosed_profile_mismatch'; end if;
  if (p_payload->>'mode'='connect' and fields<>'[]'::jsonb) or (p_payload->>'mode'='create' and ((p_payload->>'provider'='etsy' and fields<>'["email","givenName"]'::jsonb) or (p_payload->>'provider'='printful' and fields<>'["email","givenName","familyName"]'::jsonb))) then raise exception 'provider_profile_fields_mismatch'; end if;
  if (d->>'provider'='etsy' and (d->>'destination' is distinct from 'https://www.etsy.com' or d->>'termsUrl' is distinct from 'https://www.etsy.com/legal/terms-of-use' or d->>'privacyUrl' is distinct from 'https://www.etsy.com/legal/privacy' or d->'scopes' is distinct from '["shops_r","listings_r","listings_w"]'::jsonb))
   or (d->>'provider'='printful' and (d->>'destination' is distinct from 'https://www.printful.com' or d->>'termsUrl' is distinct from 'https://www.printful.com/policies/terms-of-service' or d->>'privacyUrl' is distinct from 'https://www.printful.com/policies/privacy' or d->'scopes' is distinct from '["catalog.read"]'::jsonb)) then raise exception 'provider_disclosure_mismatch'; end if;
  h:=private.stage14_hash(jsonb_build_object('businessId',p_business_id,'provider',p_payload->>'provider','mode',p_payload->>'mode','profileRevision',p.revision,'disclosure',d,'approvalTtlSeconds',ttl));
  select * into r from private.account_setup_runs where business_id=p_business_id and idempotency_key=p_payload->>'idempotencyKey' for update;
  if r.id is not null then
   if r.owner_id is distinct from auth.uid() or r.disclosure_hash<>h then raise exception 'setup_idempotency_mismatch'; end if;
   return jsonb_build_object('run',private.account_run_view(r),'created',false);
  end if;
  with changed as (update private.account_setup_runs set status='expired',revision=revision+1,updated_at=clock_timestamp()
   where business_id=p_business_id and status in ('pending_approval','approved','preparation_started','owner_handoff') and approval_expires_at<=clock_timestamp() returning *)
  insert into private.account_health_events(business_id,provider,setup_run_id,event_type) select business_id,provider,id,'expired' from changed;
  if exists(select 1 from private.account_setup_runs where business_id=p_business_id and provider=p_payload->>'provider' and status in ('pending_approval','approved','preparation_started','owner_handoff')) then raise exception 'setup_already_active'; end if;
  if p_payload->>'mode'='create' and exists(select 1 from private.account_setup_runs where business_id=p_business_id and provider=p_payload->>'provider' and preparation_id is not null) then raise exception 'registration_reconciliation_required'; end if;
  if p_payload->>'provider'='etsy' then
   select * into e from private.etsy_connections where business_id=p_business_id for update;
   expected_revision:=case when e.status='connected' then e.revision else null end;
   if p_payload->>'mode'='create' and e.status='connected' then raise exception 'account_already_connected'; end if;
  else
   expected_revision:=a.connection_revision;
   if p_payload->>'mode'='create' and a.status='connected' then raise exception 'account_already_connected'; end if;
  end if;
  reserved_id:=coalesce(a.id,gen_random_uuid());
  insert into private.account_setup_runs(business_id,owner_id,provider,mode,idempotency_key,connection_id,expected_connection_revision,profile_revision,disclosure,disclosure_hash,approval_expires_at)
   values(p_business_id,auth.uid(),p_payload->>'provider',p_payload->>'mode',p_payload->>'idempotencyKey',reserved_id,expected_revision,p.revision,d,h,clock_timestamp()+make_interval(secs=>ttl)) returning * into r;
  insert into private.account_health_events(business_id,provider,setup_run_id,event_type,summary) values(p_business_id,r.provider,r.id,'prepared',jsonb_build_object('disclosureHash',h,'mode',r.mode,'profileRevision',p.revision));
  return jsonb_build_object('run',private.account_run_view(r),'created',true);
 end if;
 select * into r from private.account_setup_runs where id=(p_payload->>'runId')::uuid and business_id=p_business_id and owner_id=auth.uid() for update;
 if r.id is null then raise exception 'setup_run_not_found'; end if;
 if p_operation in ('browser_handoff_save','browser_handoff_get','browser_handoff_release') then
  if r.preparation_id is null or r.preparation_id is distinct from (p_payload->>'preparationId')::uuid or r.mode<>'create' then raise exception 'browser_handoff_scope_mismatch'; end if;
  select * into browser_handoff from private.account_browser_handoffs where setup_run_id=r.id and business_id=p_business_id and owner_id=auth.uid() for update;
  if p_operation='browser_handoff_release' then
   if p_payload-array['runId','preparationId']<>'{}'::jsonb then raise exception 'invalid_request'; end if;
   if browser_handoff.id is null then return jsonb_build_object('released',true,'handoffId',null,'envelope',null,'remoteReleaseVerified',false); end if;
   update private.account_browser_handoffs set status='released',released_at=coalesce(released_at,clock_timestamp()) where id=browser_handoff.id;
   -- Only the authenticated server receives this cleanup envelope. Keeping it
   -- allows a safe remote-release retry after an uncertain provider response.
   return jsonb_build_object('released',true,'handoffId',browser_handoff.id,'envelope',browser_handoff.envelope,'remoteReleaseVerified',false);
  end if;
  if r.status in ('cancelled','invalidated','expired','verified') or r.approval_expires_at<=clock_timestamp() or r.profile_revision is distinct from p.revision then raise exception 'setup_stopped_or_approval_expired'; end if;
  if p_operation='browser_handoff_get' then
   if p_payload-array['runId','preparationId']<>'{}'::jsonb or r.status<>'owner_handoff' or browser_handoff.status is distinct from 'awaiting_owner' or browser_handoff.expires_at<=clock_timestamp() then raise exception 'browser_handoff_unavailable'; end if;
   return jsonb_build_object('handoffId',browser_handoff.id,'envelope',browser_handoff.envelope,'expiresAt',browser_handoff.expires_at);
  end if;
  if p_payload-array['runId','revision','preparationId','handoffId','envelope','expiresAt']<>'{}'::jsonb or r.status<>'preparation_started'
   or (p_payload->>'revision')::integer is distinct from r.revision
   or coalesce((p_payload->>'expiresAt')::timestamptz,'-infinity')<=clock_timestamp()
   or (p_payload->>'expiresAt')::timestamptz>least(clock_timestamp()+interval '15 minutes',r.approval_expires_at) then raise exception 'invalid_browser_handoff'; end if;
  if browser_handoff.id is not null then
   if browser_handoff.id is distinct from (p_payload->>'handoffId')::uuid or browser_handoff.envelope is distinct from p_payload->>'envelope' or browser_handoff.expires_at is distinct from (p_payload->>'expiresAt')::timestamptz or browser_handoff.status<>'awaiting_owner' then raise exception 'browser_handoff_replay_mismatch'; end if;
   return jsonb_build_object('saved',true,'created',false,'handoffId',browser_handoff.id);
  end if;
  insert into private.account_browser_handoffs(id,business_id,setup_run_id,owner_id,preparation_id,envelope,expires_at)
   values((p_payload->>'handoffId')::uuid,p_business_id,r.id,auth.uid(),r.preparation_id,p_payload->>'envelope',(p_payload->>'expiresAt')::timestamptz);
  return jsonb_build_object('saved',true,'created',true,'handoffId',p_payload->>'handoffId');
 end if;
 if p_operation='resume' then
  if p_payload-array['runId']<>'{}'::jsonb then raise exception 'invalid_request'; end if;
  return jsonb_build_object('run',private.account_run_view(r)); end if;
 if p_operation='cancel' then
  if p_payload-array['runId','revision']<>'{}'::jsonb then raise exception 'invalid_request'; end if;
  if r.status in ('cancelled','verified','invalidated','expired') then return jsonb_build_object('run',private.account_run_view(r)); end if;
  if (p_payload->>'revision')::integer is distinct from r.revision then raise exception 'stale_setup_revision'; end if;
  update private.account_setup_runs set status='cancelled',revision=revision+1,updated_at=clock_timestamp() where id=r.id returning * into r;
  insert into private.account_health_events(business_id,provider,setup_run_id,event_type,summary) values(p_business_id,r.provider,r.id,'cancelled',jsonb_build_object('externalAccountDeleted',false));
  return jsonb_build_object('run',private.account_run_view(r));
 end if;
 if r.status='verified' and p_operation='verify' then
  if p_payload-array['runId','revision','evidence']<>'{}'::jsonb or p_payload->'evidence'->>'connectionId' is distinct from r.connection_id::text or p_payload->'evidence'->'connectionRevision' is distinct from r.receipt->'connectionRevision' then raise exception 'verification_replay_mismatch'; end if;
  return jsonb_build_object('run',private.account_run_view(r),'created',false); end if;
 if r.status in ('cancelled','invalidated','expired','verified') or r.approval_expires_at<=clock_timestamp() then raise exception 'setup_stopped_or_approval_expired'; end if;
 if r.profile_revision is distinct from p.revision then raise exception 'stale_profile_revision'; end if;
 -- Registration replay cannot authorize a second provider-side submission.
 if p_operation='registration_prepare' and r.preparation_id is not null then
  if p_payload-array['runId','revision']<>'{}'::jsonb then raise exception 'invalid_request'; end if;
  return jsonb_build_object('run',private.account_run_view(r),'dispatchAllowed',false,'preparationId',r.preparation_id); end if;
 if (p_payload->>'revision')::integer is distinct from r.revision then raise exception 'stale_setup_revision'; end if;
 if p_operation='approve' then
  if p_payload-array['runId','revision','disclosureHash','acceptTerms','browserConsent']<>'{}'::jsonb or r.status<>'pending_approval' or p_payload->>'disclosureHash' is distinct from r.disclosure_hash
   or (r.mode='create' and (p_payload->'acceptTerms' is distinct from 'true'::jsonb or p_payload->'browserConsent' is distinct from 'true'::jsonb)) then raise exception 'exact_disclosure_approval_required'; end if;
  update private.account_setup_runs set status='approved',approved_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() where id=r.id returning * into r;
  insert into private.account_health_events(business_id,provider,setup_run_id,event_type,summary) values(p_business_id,r.provider,r.id,'approved',jsonb_build_object('disclosureHash',r.disclosure_hash,'profileRevision',r.profile_revision,'termsAcknowledged',r.mode='create','browserProcessingApproved',r.mode='create'));
 elsif p_operation='registration_prepare' then
  if p_payload-array['runId','revision']<>'{}'::jsonb or r.mode<>'create' or r.status<>'approved' then raise exception 'registration_preparation_not_allowed'; end if;
  update private.account_setup_runs set status='preparation_started',preparation_id=gen_random_uuid(),revision=revision+1,updated_at=clock_timestamp() where id=r.id returning * into r;
  insert into private.account_health_events(business_id,provider,setup_run_id,event_type,summary) values(p_business_id,r.provider,r.id,'preparation_started',jsonb_build_object('preparationId',r.preparation_id,'disclosureHash',r.disclosure_hash));
  return jsonb_build_object('run',private.account_run_view(r),'dispatchAllowed',true,'preparationId',r.preparation_id,'disclosedData',r.disclosure->'disclosedData');
 elsif p_operation='owner_handoff' then
  if p_payload-array['runId','revision','receipt']<>'{}'::jsonb or (r.mode='create' and r.status<>'preparation_started') or (r.mode='connect' and r.status<>'approved') then raise exception 'owner_handoff_not_allowed'; end if;
  ev:=p_payload->'receipt';
  if jsonb_typeof(ev) is distinct from 'object' or ev-array['outcome','performedFields','reasonCode','termsState']<>'{}'::jsonb or coalesce(ev->>'outcome','') not in ('prepared','needs_owner')
   or coalesce(ev->>'reasonCode','') not in ('secure_owner_steps','provider_login_required','owner_access_grant','captcha_approval_required','provider_unavailable','registration_uncertain')
   or coalesce(ev->>'termsState','') not in ('not_accepted','checkbox_checked') or (ev->>'termsState'='checkbox_checked' and (r.provider<>'printful' or r.mode<>'create'))
   or jsonb_typeof(ev->'performedFields') is distinct from 'array' then raise exception 'invalid_preparation_receipt'; end if;
  if exists(select 1 from jsonb_array_elements(ev->'performedFields') x where not (r.disclosure->'profileFields' @> jsonb_build_array(x.value))) then raise exception 'undisclosed_field_receipt'; end if;
  update private.account_setup_runs set status='owner_handoff',preparation_receipt=ev,revision=revision+1,updated_at=clock_timestamp() where id=r.id returning * into r;
  insert into private.account_health_events(business_id,provider,setup_run_id,event_type,summary) values(p_business_id,r.provider,r.id,'owner_handoff',ev);
 elsif p_operation='verify' then
  if p_payload-array['runId','revision','evidence']<>'{}'::jsonb or r.status<>'owner_handoff' then raise exception 'trusted_provider_readback_required'; end if;
  ev:=p_payload->'evidence';
  if jsonb_typeof(ev) is distinct from 'object' or ev->>'verifiedBy' is distinct from 'provider_api_readback'
   or ev->>'connectionId' is distinct from r.connection_id::text
   or coalesce((ev->>'verifiedAt')::timestamptz,'-infinity')<clock_timestamp()-interval '5 minutes'
   or (ev->>'verifiedAt')::timestamptz>clock_timestamp()+interval '30 seconds' then raise exception 'trusted_provider_readback_required'; end if;
  evidence_revision:=(ev->>'connectionRevision')::uuid;
  if evidence_revision is null then raise exception 'connection_revision_required'; end if;
  if r.provider='etsy' then
   if ev-array['verifiedBy','verifiedAt','connectionId','connectionRevision','etsyConnectionId']<>'{}'::jsonb then raise exception 'invalid_etsy_evidence'; end if;
   select * into e from private.etsy_connections where business_id=p_business_id and owner_id=auth.uid() for update;
   if e.id is null or e.status<>'connected' or e.envelope is null or e.id is distinct from (ev->>'etsyConnectionId')::uuid or e.revision is distinct from evidence_revision then raise exception 'authoritative_etsy_connection_required'; end if;
   if r.expected_connection_revision is not null and e.revision<>r.expected_connection_revision then raise exception 'connection_changed_during_setup'; end if;
   -- Existing OAuth/session/state validation remains wholly authoritative.
   insert into private.connected_accounts(id,business_id,owner_id,provider,provider_account_id,status,connection_revision,verified_at)
    values(r.connection_id,p_business_id,auth.uid(),'etsy',e.shop_id::text,'connected',e.revision,(ev->>'verifiedAt')::timestamptz)
    on conflict(business_id,provider) do update set owner_id=excluded.owner_id,provider_account_id=excluded.provider_account_id,status='connected',connection_revision=excluded.connection_revision,verified_at=excluded.verified_at,revoked_at=null;
   result:=jsonb_build_object('provider','etsy','verifiedBy','authoritative_etsy_connection','connectionId',e.id,'connectionRevision',e.revision,'shopId',e.shop_id,'verifiedAt',ev->'verifiedAt');
  else
   if ev-array['verifiedBy','verifiedAt','connectionId','connectionRevision','storeId','storeKind','scopes','providerScopes','expiresAt','credentialEnvelope','providerAccountId']<>'{}'::jsonb
    or coalesce((ev->>'storeId')::bigint,0)<=0 or ev->>'storeKind' not in ('manual_api','ecommerce_linked')
    or ev->'providerScopes' is null or ev->'providerScopes' not in ('[]'::jsonb,'["stores_list/read"]'::jsonb) or ev->'scopes' is distinct from '["catalog.read"]'::jsonb or ev->>'providerAccountId' is distinct from (ev->>'storeId')
    or coalesce(length(ev->>'credentialEnvelope'),0) not between 32 and 20000 or ev->>'credentialEnvelope' !~ '^account-v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'
    or coalesce((ev->>'expiresAt')::timestamptz,'-infinity')<=clock_timestamp() or (ev->>'expiresAt')::timestamptz>clock_timestamp()+interval '31 days'
    then raise exception 'invalid_printful_evidence'; end if;
   select * into a from private.connected_accounts where business_id=p_business_id and provider='printful' for update;
   if a.connection_revision is distinct from r.expected_connection_revision then raise exception 'connection_changed_during_setup'; end if;
   if a.id is not null and (a.id<>r.connection_id or a.owner_id<>auth.uid() or a.provider_account_id<>ev->>'providerAccountId') then raise exception 'store_reassignment_denied'; end if;
   if a.connection_revision is not null and evidence_revision=a.connection_revision then raise exception 'fresh_connection_revision_required'; end if;
   insert into private.connected_accounts(id,business_id,owner_id,provider,provider_account_id,status,connection_revision,verified_at)
    values(r.connection_id,p_business_id,auth.uid(),'printful',ev->>'providerAccountId','connected',evidence_revision,(ev->>'verifiedAt')::timestamptz)
    on conflict(business_id,provider) do update set status='connected',connection_revision=excluded.connection_revision,verified_at=excluded.verified_at,revoked_at=null;
   insert into private.provider_connections(id,business_id,provider,revision,store_id,store_kind,scopes,provider_scopes,credential_envelope,expires_at)
    values(r.connection_id,p_business_id,'printful',evidence_revision,(ev->>'storeId')::bigint,ev->>'storeKind',ev->'scopes',ev->'providerScopes',ev->>'credentialEnvelope',(ev->>'expiresAt')::timestamptz)
    on conflict(id) do update set revision=excluded.revision,store_kind=excluded.store_kind,scopes=excluded.scopes,provider_scopes=excluded.provider_scopes,credential_envelope=excluded.credential_envelope,expires_at=excluded.expires_at;
   result:=jsonb_build_object('provider','printful','verifiedBy','provider_api_readback','connectionId',r.connection_id,'connectionRevision',evidence_revision,
    'storeId',ev->'storeId','storeKind',ev->'storeKind','scopes',ev->'scopes','providerScopes',ev->'providerScopes','verifiedAt',ev->'verifiedAt','expiresAt',ev->'expiresAt','accountIdentityVerified',false);
  end if;
  update private.account_setup_runs set status='verified',receipt=result,revision=revision+1,updated_at=clock_timestamp() where id=r.id returning * into r;
  insert into private.account_health_events(business_id,provider,setup_run_id,event_type,summary) values(p_business_id,r.provider,r.id,'verified',result);
 else raise exception 'unsupported_account_operation';
 end if;
 return jsonb_build_object('run',private.account_run_view(r));
end $$;
revoke all on function private.account_owner(uuid,text,jsonb,text) from public,anon,authenticated,service_role;

create function public.account_owner_transition(p_business_id uuid,p_operation text,p_payload jsonb default '{}'::jsonb,p_server_key text default '') returns jsonb
language sql security definer set search_path='' as $$ select private.account_owner(p_business_id,p_operation,p_payload,p_server_key) $$;
revoke all on function public.account_owner_transition(uuid,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.account_owner_transition(uuid,text,jsonb,text) to authenticated;
