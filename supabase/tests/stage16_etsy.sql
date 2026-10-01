-- Synthetic authorization fixtures. Entire transaction must roll back.
begin;
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('16000000-1111-4111-8111-111111111111','authenticated','authenticated','stage16-a@example.invalid','',now(),'{"provider":"email"}','{}',now(),now()),
('16000000-2222-4222-8222-222222222222','authenticated','authenticated','stage16-b@example.invalid','',now(),'{"provider":"email"}','{}',now(),now());
insert into public.businesses(id,owner_user_id,name) values
('16000001-1111-4111-8111-111111111111','16000000-1111-4111-8111-111111111111','Rollback Etsy A'),
('16000001-2222-4222-8222-222222222222','16000000-2222-4222-8222-222222222222','Rollback Etsy B');
insert into private.etsy_server_authority(key_hash) values(private.stage13_hash(repeat('fixture-only-',4)));
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"16000000-1111-4111-8111-111111111111","role":"authenticated"}',true);
do $$ declare b uuid:='16000001-1111-4111-8111-111111111111'; k text:=repeat('fixture-only-',4); result jsonb; begin
  perform public.etsy_owner_transition(b,'workspace');
  begin perform public.etsy_owner_transition('16000001-2222-4222-8222-222222222222','workspace'); raise exception 'FAIL cross-owner read'; exception when insufficient_privilege then null; end;
  begin perform public.etsy_owner_transition(b,'oauth_begin','{}',''); raise exception 'FAIL missing server authority'; exception when insufficient_privilege then null; end;
  begin perform 1 from private.etsy_connections; raise exception 'FAIL private credentials readable'; exception when insufficient_privilege then null; end;
  begin insert into public.external_resources(business_id,provider,resource_type,external_id) values(b,'etsy','draft_listing','fixture-forged'); raise exception 'FAIL forged resource'; exception when insufficient_privilege then null; end;
  perform public.etsy_owner_transition(b,'oauth_begin',jsonb_build_object('stateHash',repeat('a',64),'envelope','synthetic-encrypted-placeholder'),k);
  result:=public.etsy_owner_transition(b,'oauth_consume',jsonb_build_object('stateHash',repeat('a',64)),k);
  if result->>'envelope'<>'synthetic-encrypted-placeholder' then raise exception 'FAIL OAuth consume'; end if;
  begin perform public.etsy_owner_transition(b,'oauth_consume',jsonb_build_object('stateHash',repeat('a',64)),k); raise exception 'FAIL OAuth replay'; exception when no_data_found then null; end;
  perform public.etsy_owner_transition(b,'connect',jsonb_build_object('stateHash',repeat('a',64),'id','16000002-1111-4111-8111-111111111111','revision','16000003-1111-4111-8111-111111111111','shopId',160001,'shopName','Fixture shop','currency','NZD','envelope','synthetic-encrypted-account'),k);
  result:=public.etsy_owner_transition(b,'workspace');
  if result::text like '%synthetic-encrypted%' then raise exception 'FAIL workspace leaked credential'; end if;
  begin perform public.etsy_owner_transition(b,'connect',jsonb_build_object('stateHash',repeat('a',64)),k); raise exception 'FAIL connect replay'; exception when no_data_found then null; end;
  perform public.etsy_owner_transition(b,'refresh_begin','{"revision":"16000003-1111-4111-8111-111111111111"}',k);
  begin perform public.etsy_owner_transition(b,'refresh_begin','{"revision":"16000003-1111-4111-8111-111111111111"}',k); raise exception 'FAIL uncertain refresh retried'; exception when raise_exception then if sqlerrm<>'account_reconnection_required' then raise; end if; end;
  begin perform public.etsy_owner_transition(b,'validate_package','{"package":{"version":"1.0","businessId":"16000001-1111-4111-8111-111111111111","expiresAt":"2000-01-01"}}',k); raise exception 'FAIL stale package'; exception when raise_exception then if sqlerrm<>'invalid_or_stale_package' then raise; end if; end;
  begin perform public.etsy_owner_transition(b,'prepare','{"package":{}}',k); raise exception 'FAIL invented package'; exception when raise_exception then if sqlerrm<>'invalid_or_stale_package' then raise; end if; end;
  perform public.etsy_owner_transition(b,'disconnect','{}',k);
  begin perform public.etsy_owner_transition(b,'connection','{}',k); raise exception 'FAIL revoked account'; exception when raise_exception then if sqlerrm<>'account_access_revoked' then raise; end if; end;
end $$;
reset role;
-- Seed an explicitly unqualified run as administrator only, to exercise the
-- persistence state machine. No upstream approval is fabricated; guard/finish fail.
insert into public.artifacts(id,business_id,artifact_type,name) values('16000004-1111-4111-8111-111111111111','16000001-1111-4111-8111-111111111111','product.package.v1','Rollback unqualified package');
insert into public.action_intents(id,business_id,action_type,capability,status,idempotency_key,created_by_type)
values('16000005-1111-4111-8111-111111111111','16000001-1111-4111-8111-111111111111','etsy.draft.create','marketplace.etsy','approved','rollback-only','system');
insert into private.etsy_draft_runs(id,business_id,owner_id,connection_id,connection_revision,package_artifact_id,package_hash,package,identity,shop_id,product_identity,state,action_intent_id,approval_expires_at)
values('16000006-1111-4111-8111-111111111111','16000001-1111-4111-8111-111111111111','16000000-1111-4111-8111-111111111111',
'16000002-1111-4111-8111-111111111111','16000003-1111-4111-8111-111111111111','16000004-1111-4111-8111-111111111111',repeat('a',64),'{}','al-'||repeat('b',40),160001,'fixture-only',
'{"id":"16000006-1111-4111-8111-111111111111","resourceId":"16000007-1111-4111-8111-111111111111","receiptId":"16000008-1111-4111-8111-111111111111","listingId":null,"operations":[],"status":"ready","reason":null}',
'16000005-1111-4111-8111-111111111111',now()+interval '1 hour');
set local role authenticated;
do $$ declare b uuid:='16000001-1111-4111-8111-111111111111'; k text:=repeat('fixture-only-',4);
  request jsonb:=jsonb_build_object('runId','16000006-1111-4111-8111-111111111111','lease',repeat('lease-fixture-',4)); s jsonb; r jsonb;
begin
  r:=public.etsy_owner_transition(b,'acquire',request,k);s:=r->'state';
  begin perform public.etsy_owner_transition(b,'acquire',request,k);raise exception 'FAIL duplicate lease';exception when raise_exception then if sqlerrm<>'draft_in_progress' then raise;end if;end;
  begin perform public.etsy_owner_transition(b,'save',request||jsonb_build_object('state',s,'revision',99),k);raise exception 'FAIL stale save';exception when raise_exception then if sqlerrm<>'stale_draft_revision' then raise;end if;end;
  s:=s||'{"status":"running","listingId":160005,"operations":[{"key":"create","status":"sent","externalId":160005}]}'::jsonb;
  perform public.etsy_owner_transition(b,'save',request||jsonb_build_object('state',s,'revision',0),k);
  begin perform public.etsy_owner_transition(b,'save',request||jsonb_build_object('state',s||'{"operations":[]}'::jsonb,'revision',1),k);raise exception 'FAIL history erased';exception when raise_exception then if sqlerrm<>'write_history_cannot_be_reset' then raise;end if;end;
  begin perform public.etsy_owner_transition(b,'save',request||jsonb_build_object('state',s||'{"listingId":160006}'::jsonb,'revision',1),k);raise exception 'FAIL listing changed';exception when raise_exception then if sqlerrm<>'immutable_draft_identity' then raise;end if;end;
  s:=s||'{"status":"needs_owner","reason":"fixture_uncertain"}'::jsonb;
  perform public.etsy_owner_transition(b,'save',request||jsonb_build_object('state',s,'revision',1),k);
  if not exists(select 1 from public.action_receipts where action_intent_id='16000005-1111-4111-8111-111111111111' and outcome='uncertain') then raise exception 'FAIL uncertainty receipt missing';end if;
  if not exists(select 1 from public.external_resources where id='16000007-1111-4111-8111-111111111111' and status='pending') then raise exception 'FAIL partial mapping missing';end if;
  begin perform public.etsy_owner_transition(b,'finish',request||jsonb_build_object('state',s||'{"status":"verified"}'::jsonb,'revision',2),k);raise exception 'FAIL unverified success';exception when raise_exception then if sqlerrm<>'draft_stopped_or_access_revoked' then raise;end if;end;
  perform public.etsy_owner_transition(b,'cancel',request,k);
  perform public.etsy_owner_transition(b,'save',request||jsonb_build_object('state',s,'revision',2),k);
  r:=public.etsy_owner_transition(b,'workspace');
  if r->'runs'->0->>'status'<>'cancelled' then raise exception 'FAIL cancellation lost';end if;
  begin perform public.etsy_owner_transition(b,'guard',request,k);raise exception 'FAIL cancelled guard';exception when raise_exception then if sqlerrm<>'draft_stopped_or_approval_expired' then raise;end if;end;
  perform public.etsy_owner_transition(b,'release',request,k);
end $$;
reset role;
do $$ begin
  if exists(select 1 from private.etsy_connections where business_id='16000001-1111-4111-8111-111111111111' and envelope is not null) then raise exception 'FAIL revoked envelope retained'; end if;
  if has_function_privilege('anon','public.etsy_owner_transition(uuid,text,jsonb,text)','execute') then raise exception 'FAIL anonymous RPC access'; end if;
end $$;
rollback;
