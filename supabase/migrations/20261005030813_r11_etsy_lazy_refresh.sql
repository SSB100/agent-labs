-- R11 definitions only: no read window, credential, refresh or provider call seeded.
begin;
create table private.r11_etsy_read_windows (
 id uuid primary key default gen_random_uuid(),business_id uuid not null references public.businesses(id),owner_id uuid not null references auth.users(id),auth_session_id uuid not null,
 connection_id uuid not null,connection_revision uuid not null,setup_grant_id uuid not null references private.r11_connection_grants(id),
 credential_fingerprint text not null check(credential_fingerprint ~ '^[a-f0-9]{64}$'),approval_hash text not null check(approval_hash ~ '^[a-f0-9]{64}$'),purpose_hash text not null check(purpose_hash ~ '^[a-f0-9]{64}$'),
 mode text not null check(mode in ('lazy','qualification')),max_reads integer not null check(max_reads between 1 and 744),max_refreshes integer not null check(max_refreshes between 1 and 744),
 min_refresh_seconds integer not null check(min_refresh_seconds between 3000 and 86400),created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null,
 check(expires_at>created_at and expires_at<=created_at+interval '31 days'),check(mode<>'qualification' or (max_reads=1 and max_refreshes=1)),
 foreign key(connection_id,business_id) references private.connected_accounts(id,business_id)
);
create table private.r11_etsy_read_revocations(window_id uuid primary key references private.r11_etsy_read_windows(id),created_at timestamptz not null default clock_timestamp());
create table private.r11_etsy_read_attempts (
 id uuid primary key,window_id uuid not null references private.r11_etsy_read_windows(id),business_id uuid not null,owner_id uuid not null,auth_session_id uuid not null,
 connection_id uuid not null,connection_revision uuid not null,source_generation_id uuid not null,generation_id uuid not null,needs_refresh boolean not null,
 status text not null check(status in ('reserved','refresh_marked','rotated','read_marked','succeeded','failed','cancelled')),
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null,refresh_marked_at timestamptz,read_marked_at timestamptz,rotated_at timestamptz,token_expires_at timestamptz,completed_at timestamptz,proof jsonb,
 foreign key(connection_id,business_id) references private.connected_accounts(id,business_id),check(expires_at>created_at),check(needs_refresh or source_generation_id=generation_id),check(not needs_refresh or generation_id=id)
);
create unique index r11_etsy_single_flight on private.r11_etsy_read_attempts(connection_id) where status in ('reserved','refresh_marked','rotated','read_marked');
create index r11_etsy_windows_business on private.r11_etsy_read_windows(business_id,created_at desc,id desc);
create index r11_etsy_reads_window on private.r11_etsy_read_attempts(window_id,created_at desc,id desc);
create index r11_etsy_refresh_history on private.r11_etsy_read_attempts(connection_id,refresh_marked_at desc) where refresh_marked_at is not null;
create table private.r11_etsy_token_custody (
 connection_id uuid primary key,business_id uuid not null,connection_revision uuid not null,generation_id uuid not null,
 format text not null check(format in ('setup','generation')),state text not null check(state in ('ready','frozen','candidate','cleared')),
 envelope text,token_expires_at timestamptz not null,updated_at timestamptz not null default clock_timestamp(),
 foreign key(connection_id,business_id) references private.connected_accounts(id,business_id),
 check(envelope is null or (length(envelope) between 32 and 32768 and envelope ~ '^account-v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'))
);
create function private.r11_etsy_read_guard() returns trigger language plpgsql set search_path='' as $$ begin
 if current_user in ('anon','authenticated','service_role') then raise exception 'r11_guarded_rpc_required' using errcode='42501';end if;
 if tg_op='DELETE' then raise exception 'r11_history_retained';end if;
 if tg_op='UPDATE' and tg_table_name in ('r11_etsy_read_windows','r11_etsy_read_revocations') then raise exception 'r11_immutable_history';end if;
 if tg_op='UPDATE' and tg_table_name='r11_etsy_read_attempts' then
  if (to_jsonb(new)-array['status','refresh_marked_at','read_marked_at','rotated_at','token_expires_at','completed_at','proof']) is distinct from (to_jsonb(old)-array['status','refresh_marked_at','read_marked_at','rotated_at','token_expires_at','completed_at','proof'])
   or old.status in ('succeeded','failed','cancelled')
   or (old.refresh_marked_at is not null and new.refresh_marked_at is distinct from old.refresh_marked_at)
   or (old.read_marked_at is not null and new.read_marked_at is distinct from old.read_marked_at)
   or (old.rotated_at is not null and new.rotated_at is distinct from old.rotated_at)
   or (old.token_expires_at is not null and new.token_expires_at is distinct from old.token_expires_at)
   or (old.proof is not null and new.proof is distinct from old.proof) then raise exception 'r11_immutable_attempt_evidence';end if;
 end if;return new;
end $$;
do $$ declare n text;begin foreach n in array array['r11_etsy_read_windows','r11_etsy_read_revocations','r11_etsy_read_attempts','r11_etsy_token_custody'] loop
 execute format('alter table private.%I enable row level security',n);execute format('revoke all on private.%I from public,anon,authenticated,service_role',n);
 execute format('create trigger r11_etsy_read_guard before insert or update or delete on private.%I for each row execute function private.r11_etsy_read_guard()',n);
end loop;end $$;
create function private.r11_etsy_binding_changed() returns trigger language plpgsql set search_path='' as $$ begin
 if (old.provider='etsy' or new.provider='etsy') and (new.status is distinct from old.status or new.connection_revision is distinct from old.connection_revision or new.owner_id is distinct from old.owner_id or new.provider_account_id is distinct from old.provider_account_id or new.business_id is distinct from old.business_id or new.provider is distinct from old.provider or new.id is distinct from old.id) then
  update private.r11_etsy_read_attempts set status='cancelled',completed_at=clock_timestamp() where connection_id in (old.id,new.id) and status in ('reserved','refresh_marked','rotated','read_marked');
  update private.r11_etsy_token_custody set state='cleared',envelope=null,updated_at=clock_timestamp() where connection_id in (old.id,new.id);
 end if;return new;
end $$;
create trigger r11_etsy_binding_changed after update on private.connected_accounts for each row execute function private.r11_etsy_binding_changed();

create function public.r11_etsy_read_owner(p_business_id uuid,p_operation text,p_payload jsonb,p_server_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare w private.r11_etsy_read_windows;a private.r11_etsy_read_attempts;active private.r11_etsy_read_attempts;c private.connected_accounts;v private.r11_credential_versions;g private.r11_connection_grants;s private.r11_etsy_token_custody;original private.r11_etsy_secrets;
 session_id uuid;authority_hash text;op_id uuid;expected_user bigint;expected_shop bigint;refresh_needed boolean;expiry timestamptz;observed timestamptz;last_refresh timestamptz;f jsonb;path text;
begin
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>40000 then raise exception 'r11_invalid_payload';end if;
 perform 1 from public.businesses where id=p_business_id and owner_user_id=auth.uid() for update;if not found then raise exception 'owner_required' using errcode='42501';end if;
 authority_hash:=encode(extensions.digest(convert_to(p_server_key,'UTF8'),'sha256'),'hex');
 if p_operation<>'revoke_window' then perform 1 from private.account_server_authority k where k.key_hash=authority_hash and (k.enabled or p_operation='fail') for share;if not found then raise exception 'r11_server_authority_required';end if;end if;
 session_id:=private.r11_auth_session();perform 1 from auth.sessions where id=session_id and user_id=auth.uid() for share;if not private.r11_session(auth.uid(),session_id) then raise exception 'r11_session_required';end if;
 if p_operation in ('begin','revoke_window') then
  perform private.r04_keys(p_payload,case when p_operation='begin' then array['windowId','operationId','credentialFingerprint'] else array['windowId'] end);
  select * into w from private.r11_etsy_read_windows where id=(p_payload->>'windowId')::uuid and business_id=p_business_id and owner_id=auth.uid() for update;
 else
  select * into a from private.r11_etsy_read_attempts where id=(p_payload->>'operationId')::uuid and business_id=p_business_id and owner_id=auth.uid() for update;
  if a.id is null or a.auth_session_id<>session_id then raise exception 'r11_read_attempt_unavailable';end if;
  select * into w from private.r11_etsy_read_windows where id=a.window_id and business_id=p_business_id and owner_id=auth.uid() for update;
 end if;
 if w.id is null or (p_operation<>'revoke_window' and w.auth_session_id<>session_id) then raise exception 'r11_read_window_unavailable';end if;
 select * into g from private.r11_connection_grants where id=w.setup_grant_id and business_id=p_business_id and owner_id=auth.uid() for update;
 select * into c from private.connected_accounts where id=w.connection_id and business_id=p_business_id and owner_id=auth.uid() for update;
 select * into v from private.r11_credential_versions where connection_id=c.id and revision=c.connection_revision and business_id=p_business_id;
 select * into s from private.r11_etsy_token_custody where connection_id=c.id for update;
 if p_operation='revoke_window' then
  insert into private.r11_etsy_read_revocations(window_id) values(w.id) on conflict do nothing;
  if exists(select 1 from private.r11_etsy_read_attempts x where x.window_id=w.id and x.status in ('reserved','refresh_marked','rotated','read_marked') and x.refresh_marked_at is not null) then update private.r11_etsy_token_custody set state='frozen',envelope=null,updated_at=clock_timestamp() where connection_id=w.connection_id;end if;
  update private.r11_etsy_read_attempts set status='cancelled',completed_at=clock_timestamp() where window_id=w.id and status in ('reserved','refresh_marked','rotated','read_marked');return jsonb_build_object('revoked',true);
 end if;
 if p_operation='fail' then
  perform private.r04_keys(p_payload,array['operationId']);
  if a.status in ('reserved','refresh_marked','rotated','read_marked') then update private.r11_etsy_read_attempts set status='failed',completed_at=clock_timestamp() where id=a.id;end if;
  return jsonb_build_object('closed',true);
 end if;
 if g.id is null or g.provider<>'etsy' or c.id is null or c.provider<>'etsy' or c.status<>'connected' or c.connection_revision<>w.connection_revision or v.revision is null or v.grant_id<>g.id or v.custody<>'encrypted_oauth'
  or v.provider_scopes<>'["shops_r","listings_r"]'::jsonb or w.credential_fingerprint<>v.credential_fingerprint or w.expires_at>v.expires_at or w.expires_at>g.connection_expires_at or w.expires_at<=clock_timestamp() or v.expires_at<=clock_timestamp()
  or not private.r11_session(auth.uid(),session_id) or not exists(select 1 from private.account_server_authority k where k.key_hash=authority_hash and k.enabled)
  or exists(select 1 from private.r11_connection_revocations r where r.grant_id=g.id) or exists(select 1 from private.r11_etsy_read_revocations r where r.window_id=w.id)
  or p_payload->>'credentialFingerprint' is distinct from w.credential_fingerprint then raise exception 'r11_read_authority_inactive';end if;
 select (facts->>'userId')::bigint,(facts->>'shopId')::bigint into expected_user,expected_shop from private.r11_connection_facts where attempt_id=v.attempt_id and step=1;
 if expected_user is null or expected_user<=0 or expected_shop is null or expected_shop<=0 or c.provider_account_id is distinct from expected_shop::text then raise exception 'r11_read_identity_unverified';end if;
 if p_operation='begin' then
  if jsonb_typeof(p_payload->'operationId') is distinct from 'string' then raise exception 'r11_invalid_operation_id';end if;op_id:=(p_payload->>'operationId')::uuid;
  select * into a from private.r11_etsy_read_attempts where id=op_id;
  if a.id is not null then
   if a.window_id<>w.id or a.business_id<>p_business_id or a.owner_id<>auth.uid() or a.auth_session_id<>session_id or a.connection_revision<>w.connection_revision then raise exception 'r11_operation_identity_conflict';end if;
   return jsonb_build_object('shouldDispatch',false,'status',a.status,'proof',a.proof);
  end if;
  select * into active from private.r11_etsy_read_attempts where connection_id=c.id and status in ('reserved','refresh_marked','rotated','read_marked') for update;
  if active.id is not null then
   if active.expires_at>clock_timestamp() then return jsonb_build_object('shouldDispatch',false,'status','busy');end if;
   update private.r11_etsy_read_attempts set status='failed',completed_at=clock_timestamp() where id=active.id;
   if active.refresh_marked_at is not null then return jsonb_build_object('shouldDispatch',false,'status','refresh_unverified');end if;
  end if;
  if s.connection_id is null or s.connection_revision<>c.connection_revision then
   select * into original from private.r11_etsy_secrets where connection_id=c.id and business_id=p_business_id and revision=c.connection_revision for update;
   if original.envelope is null then raise exception 'r11_token_custody_unavailable';end if;
   insert into private.r11_etsy_token_custody values(c.id,p_business_id,c.connection_revision,c.connection_revision,'setup','ready',original.envelope,v.token_expires_at,clock_timestamp())
    on conflict(connection_id) do update set business_id=excluded.business_id,connection_revision=excluded.connection_revision,generation_id=excluded.generation_id,format=excluded.format,state=excluded.state,envelope=excluded.envelope,token_expires_at=excluded.token_expires_at,updated_at=excluded.updated_at returning * into s;
   update private.r11_etsy_secrets set envelope=null where connection_id=c.id;
  end if;
  if s.state<>'ready' or s.envelope is null then return jsonb_build_object('shouldDispatch',false,'status','refresh_unverified');end if;
  if exists(select 1 from private.r11_etsy_read_attempts x where x.connection_id=c.id and x.connection_revision=c.connection_revision and x.source_generation_id=s.generation_id and x.refresh_marked_at is not null) then raise exception 'r11_generation_already_consumed';end if;
  if (select count(*) from private.r11_etsy_read_attempts x where x.window_id=w.id and x.read_marked_at is not null)>=w.max_reads then return jsonb_build_object('shouldDispatch',false,'status','exhausted');end if;
  refresh_needed:=w.mode='qualification' or s.token_expires_at<=clock_timestamp()+interval '60 seconds';
  insert into private.r11_etsy_read_attempts(id,window_id,business_id,owner_id,auth_session_id,connection_id,connection_revision,source_generation_id,generation_id,needs_refresh,status,expires_at)
   values(op_id,w.id,p_business_id,auth.uid(),session_id,c.id,c.connection_revision,s.generation_id,case when refresh_needed then op_id else s.generation_id end,refresh_needed,'reserved',least(w.expires_at,v.expires_at,clock_timestamp()+interval '2 minutes')) returning * into a;
  return jsonb_build_object('shouldDispatch',true,'status','reserved','operationId',a.id,'needsRefresh',refresh_needed,'connectionId',c.id,'bindingRevision',c.connection_revision,'generationId',s.generation_id,'nextGenerationId',a.generation_id,'format',s.format,'envelope',s.envelope,'tokenExpiresAt',s.token_expires_at,'localCutoff',v.expires_at,'userId',expected_user,'shopId',expected_shop,'shopName',g.expected_account,'expiresAt',a.expires_at);
 end if;
 if a.expires_at<=clock_timestamp() or a.connection_revision<>c.connection_revision or s.connection_id is null or s.envelope is null or s.connection_revision is distinct from c.connection_revision then raise exception 'r11_read_attempt_inactive';end if;
 if p_operation='mark_refresh' then
  perform private.r04_keys(p_payload,array['operationId','credentialFingerprint']);
  if a.status<>'reserved' or not a.needs_refresh or s.state<>'ready' or s.generation_id<>a.source_generation_id or a.refresh_marked_at is not null then raise exception 'r11_refresh_not_dispatchable';end if;
  if exists(select 1 from private.r11_etsy_read_attempts x where x.connection_id=c.id and x.connection_revision=c.connection_revision and x.source_generation_id=s.generation_id and x.refresh_marked_at is not null) then raise exception 'r11_generation_already_consumed';end if;
  select max(refresh_marked_at) into last_refresh from private.r11_etsy_read_attempts where connection_id=c.id;
  if (last_refresh is not null and last_refresh+make_interval(secs=>w.min_refresh_seconds)>clock_timestamp()) or (select count(*) from private.r11_etsy_read_attempts where window_id=w.id and refresh_marked_at is not null)>=w.max_refreshes then raise exception 'r11_refresh_budget_or_rate';end if;
  if w.expires_at<=clock_timestamp() or v.expires_at<=clock_timestamp() or a.expires_at<=clock_timestamp() or not private.r11_session(auth.uid(),session_id) then raise exception 'r11_dispatch_expired';end if;
  update private.r11_etsy_read_attempts set status='refresh_marked',refresh_marked_at=clock_timestamp() where id=a.id;
  update private.r11_etsy_token_custody set state='frozen',updated_at=clock_timestamp() where connection_id=c.id;
  return jsonb_build_object('shouldDispatch',true,'attemptId',a.id,'step',0,'method','POST','endpoint','https://api.etsy.com/v3/public/oauth/token','expiresAt',least(a.expires_at,w.expires_at,v.expires_at,clock_timestamp()+interval '15 seconds'));
 elsif p_operation='rotate' then
  perform private.r04_keys(p_payload,array['operationId','credentialFingerprint','envelope','tokenExpiresAt','userId','scopes']);
  if a.status<>'refresh_marked' or s.state<>'frozen' or s.generation_id<>a.source_generation_id or a.rotated_at is not null then raise exception 'r11_stale_generation';end if;
  if jsonb_typeof(p_payload->'envelope') is distinct from 'string' or p_payload->>'envelope' !~ '^account-v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$' or length(p_payload->>'envelope')>32768 or jsonb_typeof(p_payload->'userId') is distinct from 'number' or p_payload->>'userId'<>expected_user::text or p_payload->'scopes' is distinct from '["shops_r","listings_r"]'::jsonb or jsonb_typeof(p_payload->'tokenExpiresAt') is distinct from 'string' then raise exception 'r11_rotated_response_unverified';end if;
  expiry:=(p_payload->>'tokenExpiresAt')::timestamptz;if expiry<=clock_timestamp() or expiry>a.refresh_marked_at+interval '1 hour' then raise exception 'r11_rotated_expiry_unverified';end if;
  update private.r11_etsy_token_custody set generation_id=a.generation_id,format='generation',state='candidate',envelope=p_payload->>'envelope',token_expires_at=expiry,updated_at=clock_timestamp() where connection_id=c.id;
  update private.r11_etsy_read_attempts set status='rotated',rotated_at=clock_timestamp(),token_expires_at=expiry where id=a.id;return jsonb_build_object('saved',true,'generationId',a.generation_id);
 elsif p_operation='mark_read' then
  perform private.r04_keys(p_payload,array['operationId','credentialFingerprint']);
  if a.read_marked_at is not null or s.generation_id<>a.generation_id or s.token_expires_at<=clock_timestamp() or not((not a.needs_refresh and a.status='reserved' and s.state='ready') or (a.needs_refresh and a.status='rotated' and s.state='candidate')) then raise exception 'r11_read_not_dispatchable';end if;
  if (select count(*) from private.r11_etsy_read_attempts where window_id=w.id and read_marked_at is not null)>=w.max_reads then raise exception 'r11_read_budget';end if;
  if w.expires_at<=clock_timestamp() or v.expires_at<=clock_timestamp() or a.expires_at<=clock_timestamp() or s.token_expires_at<=clock_timestamp() or not private.r11_session(auth.uid(),session_id) then raise exception 'r11_dispatch_expired';end if;
  update private.r11_etsy_read_attempts set status='read_marked',read_marked_at=clock_timestamp() where id=a.id;path:='https://api.etsy.com/v3/application/shops/'||expected_shop::text||'/listings?state=draft&limit=1&offset=0';
  return jsonb_build_object('shouldDispatch',true,'attemptId',a.id,'step',1,'method','GET','endpoint',path,'expiresAt',least(a.expires_at,w.expires_at,v.expires_at,s.token_expires_at,clock_timestamp()+interval '15 seconds'));
 elsif p_operation='complete' then
  perform private.r04_keys(p_payload,array['operationId','credentialFingerprint','proof']);f:=p_payload->'proof';perform private.r04_keys(f,array['userId','shopId','shopName','listingCount','totalDrafts','factsHash','verifiedAt']);
  if a.status<>'read_marked' or s.generation_id<>a.generation_id or s.token_expires_at<=clock_timestamp() or s.state not in ('ready','candidate') then raise exception 'r11_stale_read_generation';end if;
  if jsonb_typeof(f->'userId') is distinct from 'number' or jsonb_typeof(f->'shopId') is distinct from 'number' or f->>'userId' is distinct from expected_user::text or f->>'shopId' is distinct from expected_shop::text or jsonb_typeof(f->'shopName') is distinct from 'string' or f->>'shopName' is distinct from g.expected_account or jsonb_typeof(f->'listingCount') is distinct from 'number' or f->>'listingCount' !~ '^[01]$' or jsonb_typeof(f->'totalDrafts') is distinct from 'number' or f->>'totalDrafts' !~ '^(0|[1-9][0-9]{0,9})$' or (f->>'totalDrafts')::bigint<(f->>'listingCount')::integer or jsonb_typeof(f->'factsHash') is distinct from 'string' or jsonb_typeof(f->'verifiedAt') is distinct from 'string' or f->>'factsHash' !~ '^[a-f0-9]{64}$' or f->>'factsHash' is null or f->>'verifiedAt' is null then raise exception 'r11_invalid_read_proof';end if;
  observed:=(f->>'verifiedAt')::timestamptz;if observed<a.read_marked_at or observed>clock_timestamp()+interval '1 second' then raise exception 'r11_invalid_observation_time';end if;
  if w.expires_at<=clock_timestamp() or v.expires_at<=clock_timestamp() or a.expires_at<=clock_timestamp() or s.token_expires_at<=clock_timestamp() or not private.r11_session(auth.uid(),session_id) then raise exception 'r11_read_completion_expired';end if;
  update private.r11_etsy_token_custody set state='ready',updated_at=clock_timestamp() where connection_id=c.id;
  update private.r11_etsy_read_attempts set status='succeeded',completed_at=clock_timestamp(),proof=f where id=a.id;return jsonb_build_object('verified',true,'proof',f,'generationId',s.generation_id);
 else raise exception 'r11_unknown_operation';end if;
end $$;

create function public.r11_etsy_read_workspace(p_business_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;item jsonb;connections jsonb:='[]';s private.r11_etsy_token_custody;begin
 result:=public.r11_connection_read(p_business_id);
 for item in select value from jsonb_array_elements(result->'connections') loop
  if item->>'provider'='etsy' then
   item:=item||jsonb_build_object('tokenExpiresAt',(select token_expires_at from private.r11_credential_versions where connection_id=(item->>'id')::uuid and revision=(item->>'revision')::uuid));
   select * into s from private.r11_etsy_token_custody where connection_id=(item->>'id')::uuid and business_id=p_business_id and connection_revision=(item->>'revision')::uuid;
   if s.connection_id is not null and item->>'status' in ('connected','token_expired') then
    item:=item||jsonb_build_object('status',case when s.state in ('frozen','cleared') then 'refresh_uncertain' when s.state='candidate' then 'refresh_unverified' when s.envelope is null then 'refresh_uncertain' when s.token_expires_at<=clock_timestamp() then 'token_expired' else 'connected' end,'tokenExpiresAt',s.token_expires_at);
   end if;
  end if;connections:=connections||jsonb_build_array(item);
 end loop;
 return result||jsonb_build_object('connections',connections,'readWindowTotal',(select count(*) from private.r11_etsy_read_windows where business_id=p_business_id and owner_id=auth.uid()),
 'readWindows',coalesce((select jsonb_agg(x.item) from (select jsonb_build_object('id',w.id,'connectionId',w.connection_id,'bindingRevision',w.connection_revision,'expiresAt',w.expires_at,'mode',w.mode,'credentialFingerprint',w.credential_fingerprint,'maxReads',w.max_reads,'maxRefreshes',w.max_refreshes,'minRefreshSeconds',w.min_refresh_seconds,
 'readsDispatched',(select count(*) from private.r11_etsy_read_attempts a where a.window_id=w.id and a.read_marked_at is not null),'refreshesDispatched',(select count(*) from private.r11_etsy_read_attempts a where a.window_id=w.id and a.refresh_marked_at is not null),
 'state',case when exists(select 1 from private.r11_etsy_read_revocations r where r.window_id=w.id) then 'revoked' when w.expires_at<=clock_timestamp() or not private.r11_session(w.owner_id,w.auth_session_id) then 'expired'
 when not exists(select 1 from private.connected_accounts c join private.r11_credential_versions v on v.connection_id=c.id and v.revision=c.connection_revision where c.id=w.connection_id and c.business_id=p_business_id and c.owner_id=auth.uid() and c.connection_revision=w.connection_revision and c.status='connected' and v.grant_id=w.setup_grant_id and v.expires_at>clock_timestamp()) or exists(select 1 from private.r11_connection_revocations r where r.grant_id=w.setup_grant_id) then 'blocked'
 when (select count(*) from private.r11_etsy_read_attempts a where a.window_id=w.id and a.read_marked_at is not null)>=w.max_reads then 'exhausted' else 'available' end) item
 from private.r11_etsy_read_windows w where w.business_id=p_business_id and w.owner_id=auth.uid() order by w.created_at desc,w.id desc limit 25) x),'[]'::jsonb),
 'readAttemptTotal',(select count(*) from private.r11_etsy_read_attempts where business_id=p_business_id and owner_id=auth.uid()),
 'readAttempts',coalesce((select jsonb_agg(x.item) from (select jsonb_build_object('id',id,'windowId',window_id,'connectionId',connection_id,'bindingRevision',connection_revision,'status',case when status in ('reserved','refresh_marked','rotated','read_marked') and expires_at<=clock_timestamp() then 'expired_unverified' else status end,'createdAt',created_at,'completedAt',completed_at,'refreshed',refresh_marked_at is not null,'proof',proof) item from private.r11_etsy_read_attempts where business_id=p_business_id and owner_id=auth.uid() order by created_at desc,id desc limit 25) x),'[]'::jsonb));
end $$;
revoke all on function private.r11_etsy_read_guard(),private.r11_etsy_binding_changed() from public,anon,authenticated,service_role;
revoke all on function public.r11_etsy_read_owner(uuid,text,jsonb,text),public.r11_etsy_read_workspace(uuid) from public,anon,authenticated,service_role;
grant execute on function public.r11_etsy_read_owner(uuid,text,jsonb,text),public.r11_etsy_read_workspace(uuid) to authenticated;
commit;
