-- Rollback-only account setup contract. Real PostgreSQL ACL/RLS/constraints and
-- trusted-RPC paths, synthetic tenants/evidence/envelopes, no provider requests.
begin;
create function pg_temp.expect_error(sql text, expected text) returns void language plpgsql as $$
begin
 begin execute sql; exception when others then
  if position(expected in sqlerrm)=0 then raise exception 'Unexpected error: %; wanted %',sqlerrm,expected; end if; return;
 end; raise exception 'Expected failure did not occur: %',sql;
end $$;
create function pg_temp.account_disclosure(p jsonb,provider text,mode text) returns jsonb language sql as $$
 select jsonb_build_object('provider',provider,'mode',mode,'profileRevision',p->>'revision',
  'profileFields',case when mode='connect' then '[]'::jsonb when provider='etsy' then '["email","givenName"]'::jsonb else '["email","givenName","familyName"]'::jsonb end,
  'disclosedData',case when mode='connect' then '{}'::jsonb when provider='etsy' then jsonb_build_object('email',p->'email','givenName',p->'givenName') else jsonb_build_object('email',p->'email','givenName',p->'givenName','familyName',p->'familyName') end,
  'destination','https://www.'||provider||'.com','termsUrl',case when provider='etsy' then 'https://www.etsy.com/legal/terms-of-use' else 'https://www.printful.com/policies/terms-of-service' end,
  'privacyUrl',case when provider='etsy' then 'https://www.etsy.com/legal/privacy' else 'https://www.printful.com/policies/privacy' end,
  'purpose','Connect the selected account with a zero spending limit.',
  'scopes',case when provider='etsy' then '["shops_r","listings_r","listings_w"]'::jsonb else '["catalog.read"]'::jsonb end,
  'cost','{"amountMinor":0,"currency":null,"subscription":false}'::jsonb,'termsAcknowledgementRequired',mode='create',
  'secureOwnerSteps','["password","email_verification","mfa","billing","identity_verification","access_grant"]'::jsonb,
  'browserProcessing',case when mode='create' then '{"provider":"browserbase","purpose":"registration_preparation_and_owner_handoff","recordSession":false,"logSession":false,"maxSessionSeconds":900,"requiresSeparateActivation":true}'::jsonb else 'null'::jsonb end)
$$;
create function pg_temp.prepare_account(b uuid,provider text,mode text,nonce text) returns jsonb language plpgsql as $$
declare p jsonb; begin
 p:=public.account_owner_transition(b,'workspace')->'profile';
 return public.account_owner_transition(b,'prepare',jsonb_build_object('provider',provider,'mode',mode,'idempotencyKey',nonce,'profileRevision',p->'revision','disclosure',pg_temp.account_disclosure(p,provider,mode),'approvalTtlSeconds',1800),repeat('account-fixture-',4));
end $$;
insert into auth.users(id,email) values('19000000-1111-4111-8111-000000000090','account-owner@example.invalid'),('19000000-1111-4111-8111-000000000091','account-other@example.invalid');
insert into public.businesses(id,owner_user_id,name) values
 ('19000000-1111-4111-8111-000000000001','19000000-1111-4111-8111-000000000090','Account fixture'),
 ('19000000-1111-4111-8111-000000000002','19000000-1111-4111-8111-000000000090','Second owner business'),
 ('19000000-1111-4111-8111-000000000003','19000000-1111-4111-8111-000000000091','Other owner business');
insert into private.account_server_authority values(private.stage13_hash(repeat('account-fixture-',4)),true);
insert into private.etsy_server_authority values(private.stage13_hash(repeat('account-etsy-fixture-',4)),true);
insert into private.etsy_connections(id,business_id,owner_id,shop_id,shop_name,currency,revision,status,envelope) values
 ('19000000-1111-4111-8111-000000000020','19000000-1111-4111-8111-000000000001','19000000-1111-4111-8111-000000000090',19001,'Fixture Etsy','USD','19000000-1111-4111-8111-000000000021','connected','existing-etsy-opaque-envelope');
create temporary table account_etsy_before as select to_jsonb(e) value from private.etsy_connections e where business_id='19000000-1111-4111-8111-000000000001';
create temporary table account_fixture(key text primary key,value jsonb);
grant all on account_fixture to authenticated;
select set_config('request.jwt.claim.sub','19000000-1111-4111-8111-000000000090',true);
do $$ declare n text; begin
 assert has_function_privilege('authenticated','public.account_owner_transition(uuid,text,jsonb,text)','execute');
 assert not has_function_privilege('anon','public.account_owner_transition(uuid,text,jsonb,text)','execute');
 assert not has_function_privilege('service_role','public.account_owner_transition(uuid,text,jsonb,text)','execute');
 assert not has_function_privilege('authenticated','private.account_owner(uuid,text,jsonb,text)','execute');
 foreach n in array array['account_server_authority','account_profiles','connected_accounts','provider_connections','account_setup_runs','account_health_events','account_browser_handoffs','account_password_credentials'] loop
  assert not has_table_privilege('authenticated','private.'||n,'select');
  assert not has_table_privilege('service_role','private.'||n,'insert');
  assert not has_table_privilege('anon','private.'||n,'update');
  assert (select relrowsecurity from pg_class where oid=('private.'||n)::regclass);
 end loop;
end $$;
set local role authenticated;
do $$ declare b uuid:='19000000-1111-4111-8111-000000000001'; b2 uuid:='19000000-1111-4111-8111-000000000002'; k text:=repeat('account-fixture-',4);
 p jsonb; x jsonb; r jsonb; req jsonb; ev jsonb; c jsonb; profile jsonb:='{"email":"owner@example.invalid","givenName":"Owner","familyName":"Fixture","countryCode":"NZ","locale":"en-NZ"}'; begin
 assert public.account_owner_transition(b,'workspace')->'runs'='[]';
 assert public.account_owner_transition(b,'workspace')->'accounts'->0->>'source'='existing_etsy_connection';
 perform pg_temp.expect_error(format('select public.account_owner_transition(%L,''save_profile'')',b),'server_authority_required');
 perform pg_temp.expect_error('select * from private.account_profiles','permission denied');
 perform pg_temp.expect_error('select public.account_owner_transition(''19000000-1111-4111-8111-000000000003'',''workspace'')','owner_required');
 perform pg_temp.expect_error(format('select public.account_owner_transition(%L,''save_profile'',%L::jsonb,%L)',b,jsonb_build_object('profile',profile||'{"password":"forbidden"}','expectedRevision',null),k),'invalid_account_profile');
 perform pg_temp.expect_error(format('select public.account_owner_transition(%L,''save_profile'',%L::jsonb,%L)',b,jsonb_build_object('profile',profile-'locale','expectedRevision',null),k),'invalid_account_profile');
 p:=public.account_owner_transition(b,'save_profile',jsonb_build_object('profile',profile,'expectedRevision',null),k)->'profile';
 assert p-'revision'=profile;
 assert public.account_owner_transition(b,'save_profile',jsonb_build_object('profile',profile,'expectedRevision',p->'revision'),k)->'profile'=p;
 perform pg_temp.expect_error(format('select public.account_owner_transition(%L,''save_profile'',%L::jsonb,%L)',b,jsonb_build_object('profile',profile,'expectedRevision',null),k),'stale_profile_revision');
 perform public.account_owner_transition(b2,'save_profile',jsonb_build_object('profile',profile,'expectedRevision',null),k);
 req:=jsonb_build_object('provider','printful','mode','connect','idempotencyKey','account-printful-fixture-1','profileRevision',p->'revision','disclosure',pg_temp.account_disclosure(p,'printful','connect'),'approvalTtlSeconds',1800);
 perform pg_temp.expect_error(format('select public.account_owner_transition(%L,''prepare'',%L::jsonb,%L)',b,jsonb_set(req,'{disclosure,destination}','"https://attacker.invalid"'),k),'provider_disclosure_mismatch');
 perform pg_temp.expect_error(format('select public.account_owner_transition(%L,''prepare'',%L::jsonb,%L)',b,jsonb_set(req,'{disclosure,scopes}','["orders.write"]'),k),'provider_disclosure_mismatch');
 perform pg_temp.expect_error(format('select public.account_owner_transition(%L,''prepare'',%L::jsonb,%L)',b,jsonb_set(req,'{disclosure,disclosedData}','{"email":"different@example.invalid"}'),k),'disclosed_profile_mismatch');
 x:=public.account_owner_transition(b,'prepare',req,k); r:=x->'run';
 assert x->'created'='true'; assert r->>'status'='pending_approval'; assert r->>'connectionId' is not null;
 assert public.account_owner_transition(b,'prepare',req,k)->'created'='false';
 assert public.account_owner_transition(b,'prepare',req,k)->'run'=r;
 perform pg_temp.expect_error(format('select public.account_owner_transition(%L,''prepare'',%L::jsonb,%L)',b,jsonb_set(req,'{approvalTtlSeconds}','60'),k),'setup_idempotency_mismatch');
 perform pg_temp.expect_error(format('select pg_temp.prepare_account(%L,''printful'',''connect'',''another-active-attempt'')',b),'setup_already_active');
 perform pg_temp.expect_error(format('select public.account_owner_transition(%L,''approve'',%L::jsonb,%L)',b,jsonb_build_object('runId',r->'id','revision',0,'disclosureHash',repeat('f',64)),k),'exact_disclosure_approval_required');
 r:=public.account_owner_transition(b,'approve',jsonb_build_object('runId',r->'id','revision',r->'revision','disclosureHash',r->'disclosureHash','acceptTerms',false),k)->'run';
 assert r->>'status'='approved';
 perform pg_temp.expect_error(format('select public.account_owner_transition(%L,''verify'',%L::jsonb,%L)',b,jsonb_build_object('runId',r->'id','revision',r->'revision','evidence','{}'::jsonb),k),'trusted_provider_readback_required');
 perform pg_temp.expect_error(format('select public.account_owner_transition(%L,''resume'',%L::jsonb,%L)',b2,jsonb_build_object('runId',r->'id'),k),'setup_run_not_found');
 r:=public.account_owner_transition(b,'owner_handoff',jsonb_build_object('runId',r->'id','revision',r->'revision','receipt','{"outcome":"needs_owner","performedFields":[],"reasonCode":"owner_access_grant","termsState":"not_accepted"}'::jsonb),k)->'run';
 assert r->>'status'='owner_handoff';
 ev:=jsonb_build_object('verifiedBy','provider_api_readback','verifiedAt',clock_timestamp(),'connectionId',r->'connectionId','connectionRevision',gen_random_uuid(),
  'storeId',190001,'storeKind','manual_api','providerAccountId','190001','scopes','["catalog.read"]'::jsonb,'providerScopes','["stores_list/read"]'::jsonb,
  'expiresAt',date_trunc('milliseconds',clock_timestamp()+interval '1 day'),'credentialEnvelope','account-v1.'||repeat('A',16)||'.'||repeat('B',22)||'.'||repeat('C',64));
 perform pg_temp.expect_error(format('select public.account_owner_transition(%L,''verify'',%L::jsonb)',b,jsonb_build_object('runId',r->'id','revision',r->'revision','evidence',ev)),'server_authority_required');
 perform pg_temp.expect_error(format('select public.account_owner_transition(%L,''verify'',%L::jsonb,%L)',b,jsonb_build_object('runId',r->'id','revision',99,'evidence',ev),k),'stale_setup_revision');
 perform pg_temp.expect_error(format('select public.account_owner_transition(%L,''verify'',%L::jsonb,%L)',b,jsonb_build_object('runId',r->'id','revision',r->'revision','evidence',ev||'{"providerScopes":["orders/write"]}'),k),'invalid_printful_evidence');
 perform pg_temp.expect_error(format('select public.account_owner_transition(%L,''verify'',%L::jsonb,%L)',b,jsonb_build_object('runId',r->'id','revision',r->'revision','evidence',ev||'{"credentialEnvelope":"plaintext-token"}'),k),'invalid_printful_evidence');
 r:=public.account_owner_transition(b,'verify',jsonb_build_object('runId',r->'id','revision',r->'revision','evidence',ev),k)->'run';
 assert r->>'status'='verified'; assert r->'receipt'->'accountIdentityVerified'='false';
 assert public.account_owner_transition(b,'verify',jsonb_build_object('runId',r->'id','revision',2,'evidence',ev),k)->'created'='false';
 c:=public.account_owner_transition(b,'connection','{"provider":"printful"}',k);
 assert c->>'credentialEnvelope'=ev->>'credentialEnvelope'; assert c->'providerScopes'=ev->'providerScopes';
 assert c->>'expiresAt' ~ '[.]\d{3}Z$'; assert c->>'verifiedAt' ~ '[.]\d{3}Z$';
 perform pg_temp.expect_error(format('select public.account_owner_transition(%L,''connection'',%L::jsonb,%L)',b,jsonb_build_object('provider','printful','revision',gen_random_uuid()),k),'account_access_revoked');
 assert position(ev->>'credentialEnvelope' in public.account_owner_transition(b,'workspace')::text)=0;
 assert public.account_owner_transition(b,'workspace')->'accounts'->1->>'externalAccountId'='190001';
 -- Desired website password is stored independently, with no read RPC and no
 -- change to provider token revision/scopes. These opaque bytes are fixtures.
 x:=public.account_owner_transition(b,'save_password',jsonb_build_object('provider','printful','connectionId',r->'connectionId','expectedConnectionRevision',ev->'connectionRevision','expectedPasswordRevision',null,'passwordRevision',gen_random_uuid(),'envelope','account-v1.'||repeat('P',16)||'.'||repeat('Q',22)||'.'||repeat('R',64)),k);
 assert x->'passwordStored'='true';
 assert public.account_owner_transition(b,'workspace')->'accounts'->1->'passwordStored'='true';
 assert public.account_owner_transition(b,'workspace')->'accounts'->1->'passwordRevision'=x->'passwordRevision';
 assert public.account_owner_transition(b,'connection','{"provider":"printful"}',k)->'revision'=ev->'connectionRevision';
 perform pg_temp.expect_error(format('select public.account_owner_transition(%L,''save_password'',%L::jsonb,%L)',b,jsonb_build_object('provider','printful','connectionId',r->'connectionId','expectedConnectionRevision',ev->'connectionRevision','expectedPasswordRevision',null,'passwordRevision',gen_random_uuid(),'envelope','plaintext'),k),'stale_password_revision');
 perform pg_temp.expect_error(format('select public.account_owner_transition(%L,''save_password'',%L::jsonb,%L)',b2,jsonb_build_object('provider','printful','connectionId',r->'connectionId','expectedConnectionRevision',ev->'connectionRevision','expectedPasswordRevision',null,'passwordRevision',gen_random_uuid(),'envelope','plaintext'),k),'verified_connection_required');
 perform pg_temp.expect_error('select * from private.account_password_credentials','permission denied');
 insert into account_fixture values('passwordRevision',x);
 insert into account_fixture values('printful',r),('printfulEvidence',ev),('profile',p);
 -- Same store cannot be adopted by another Business, even with the same owner.
 r:=pg_temp.prepare_account(b2,'printful','connect','cross-business-account-1')->'run';
 r:=public.account_owner_transition(b2,'approve',jsonb_build_object('runId',r->'id','revision',r->'revision','disclosureHash',r->'disclosureHash'),k)->'run';
 r:=public.account_owner_transition(b2,'owner_handoff',jsonb_build_object('runId',r->'id','revision',r->'revision','receipt','{"outcome":"needs_owner","performedFields":[],"reasonCode":"owner_access_grant","termsState":"not_accepted"}'::jsonb),k)->'run';
 perform pg_temp.expect_error(format('select public.account_owner_transition(%L,''verify'',%L::jsonb,%L)',b2,jsonb_build_object('runId',r->'id','revision',r->'revision','evidence',ev||jsonb_build_object('connectionId',r->'connectionId','connectionRevision',gen_random_uuid())),k),'connected_accounts_provider_provider_account_id_key');
 -- Unchanged Etsy authority is projected, then referenced with no secret copy.
 r:=pg_temp.prepare_account(b,'etsy','connect','existing-etsy-connect-1')->'run';
 r:=public.account_owner_transition(b,'approve',jsonb_build_object('runId',r->'id','revision',r->'revision','disclosureHash',r->'disclosureHash'),k)->'run';
 r:=public.account_owner_transition(b,'owner_handoff',jsonb_build_object('runId',r->'id','revision',r->'revision','receipt','{"outcome":"needs_owner","performedFields":[],"reasonCode":"owner_access_grant","termsState":"not_accepted"}'::jsonb),k)->'run';
 r:=public.account_owner_transition(b,'verify',jsonb_build_object('runId',r->'id','revision',r->'revision','evidence',jsonb_build_object('verifiedBy','provider_api_readback','verifiedAt',clock_timestamp(),'connectionId',r->'connectionId','etsyConnectionId','19000000-1111-4111-8111-000000000020','connectionRevision','19000000-1111-4111-8111-000000000021')),k)->'run';
 assert r->'receipt'->>'verifiedBy'='authoritative_etsy_connection';
 insert into account_fixture values('etsy',r);
end $$;
reset role;
do $$ begin
 assert (select to_jsonb(e)=(select value from account_etsy_before) from private.etsy_connections e where business_id='19000000-1111-4111-8111-000000000001');
 assert (select count(*)=1 from private.account_health_events where setup_run_id=((select value from account_fixture where key='printful')->>'id')::uuid and event_type='verified');
 assert not exists(select 1 from private.provider_connections where provider='etsy');
 assert not exists(select 1 from private.account_health_events where summary::text like '%credentialEnvelope%' or summary::text like '%existing-etsy-opaque-envelope%');
end $$;
set local role authenticated;
do $$ declare b uuid:='19000000-1111-4111-8111-000000000002'; k text:=repeat('account-fixture-',4); r jsonb; x jsonb; p jsonb; req jsonb; handoff uuid:=gen_random_uuid(); expiry timestamptz:=date_trunc('milliseconds',clock_timestamp()+interval '10 minutes'); envelope text:='account-v1.'||repeat('D',16)||'.'||repeat('E',22)||'.'||repeat('F',64); begin
 -- Existing active Printful setup in b2 is cancelled before create admission.
 r:=public.account_owner_transition(b,'workspace')->'runs'->0;
 perform public.account_owner_transition(b,'cancel',jsonb_build_object('runId',r->'id','revision',r->'revision'),k);
 r:=pg_temp.prepare_account(b,'etsy','create','registration-etsy-create-1')->'run';
 perform pg_temp.expect_error(format('select public.account_owner_transition(%L,''approve'',%L::jsonb,%L)',b,jsonb_build_object('runId',r->'id','revision',r->'revision','disclosureHash',r->'disclosureHash','acceptTerms',true),k),'exact_disclosure_approval_required');
 r:=public.account_owner_transition(b,'approve',jsonb_build_object('runId',r->'id','revision',r->'revision','disclosureHash',r->'disclosureHash','acceptTerms',true,'browserConsent',true),k)->'run';
 x:=public.account_owner_transition(b,'registration_prepare',jsonb_build_object('runId',r->'id','revision',r->'revision'),k); r:=x->'run';
 assert x->'dispatchAllowed'='true'; assert r->>'status'='preparation_started'; assert x->'disclosedData'=r->'disclosure'->'disclosedData';
 assert public.account_owner_transition(b,'registration_prepare',jsonb_build_object('runId',r->'id','revision',r->'revision'),k)->'dispatchAllowed'='false';
 req:=jsonb_build_object('runId',r->'id','revision',r->'revision','preparationId',r->'preparationId','handoffId',handoff,'envelope',envelope,'expiresAt',expiry);
 perform pg_temp.expect_error(format('select public.account_owner_transition(%L,''browser_handoff_save'',%L::jsonb,%L)',b,req||jsonb_build_object('expiresAt',clock_timestamp()+interval '16 minutes'),k),'invalid_browser_handoff');
 assert public.account_owner_transition(b,'browser_handoff_save',req,k)->'created'='true';
 assert public.account_owner_transition(b,'browser_handoff_save',req,k)->'created'='false';
 perform pg_temp.expect_error(format('select public.account_owner_transition(%L,''browser_handoff_get'',%L::jsonb,%L)',b,jsonb_build_object('runId',r->'id','preparationId',r->'preparationId'),k),'browser_handoff_unavailable');
 perform pg_temp.expect_error(format('select public.account_owner_transition(%L,''browser_handoff_save'',%L::jsonb,%L)',b,req||jsonb_build_object('handoffId',gen_random_uuid()),k),'browser_handoff_replay_mismatch');
 r:=public.account_owner_transition(b,'owner_handoff',jsonb_build_object('runId',r->'id','revision',r->'revision','receipt','{"outcome":"prepared","performedFields":["email","givenName"],"reasonCode":"secure_owner_steps","termsState":"not_accepted"}'::jsonb),k)->'run';
 assert public.account_owner_transition(b,'browser_handoff_get',jsonb_build_object('runId',r->'id','preparationId',r->'preparationId'),k)->>'envelope'=envelope;
 assert position(envelope in public.account_owner_transition(b,'workspace')::text)=0;
 perform pg_temp.expect_error(format('select public.account_owner_transition(%L,''browser_handoff_get'',%L::jsonb)',b,jsonb_build_object('runId',r->'id','preparationId',r->'preparationId')),'server_authority_required');
 r:=public.account_owner_transition(b,'cancel',jsonb_build_object('runId',r->'id','revision',r->'revision'),k)->'run';
 assert r->>'status'='cancelled';
 perform pg_temp.expect_error(format('select public.account_owner_transition(%L,''browser_handoff_get'',%L::jsonb,%L)',b,jsonb_build_object('runId',r->'id','preparationId',r->'preparationId'),k),'setup_stopped_or_approval_expired');
 x:=public.account_owner_transition(b,'browser_handoff_release',jsonb_build_object('runId',r->'id','preparationId',r->'preparationId'),k);
 assert x->>'envelope'=envelope; assert x->'remoteReleaseVerified'='false';
 assert public.account_owner_transition(b,'browser_handoff_release',jsonb_build_object('runId',r->'id','preparationId',r->'preparationId'),k)=x;
 perform pg_temp.expect_error(format('select pg_temp.prepare_account(%L,''etsy'',''create'',''registration-etsy-create-2'')',b),'registration_reconciliation_required');
 perform pg_temp.expect_error(format('select public.account_owner_transition(%L,''verify'',%L::jsonb,%L)',b,jsonb_build_object('runId',r->'id','revision',r->'revision','evidence','{}'::jsonb),k),'setup_stopped_or_approval_expired');
 insert into account_fixture values('cancelledRegistration',r);
 -- A changed ordinary profile invalidates exact prior approval rather than
 -- silently adding new data to an authorized provider action.
 r:=pg_temp.prepare_account(b,'printful','connect','profile-invalidation-1')->'run';
 p:=public.account_owner_transition(b,'workspace')->'profile';
 perform public.account_owner_transition(b,'save_profile',jsonb_build_object('profile',(p-'revision')||'{"givenName":"Updated"}','expectedRevision',p->'revision'),k);
 assert public.account_owner_transition(b,'resume',jsonb_build_object('runId',r->'id'),k)->'run'->>'status'='invalidated';
 perform pg_temp.expect_error(format('select public.account_owner_transition(%L,''approve'',%L::jsonb,%L)',b,jsonb_build_object('runId',r->'id','revision',r->'revision','disclosureHash',r->'disclosureHash'),k),'setup_stopped_or_approval_expired');
end $$;
reset role;
-- Expiry and disabled authority are controlled fixture changes, not sleep races.
update private.account_server_authority set enabled=false;
set local role authenticated;
select pg_temp.expect_error('select public.account_owner_transition(''19000000-1111-4111-8111-000000000001'',''connection'',''{"provider":"printful"}'',repeat(''account-fixture-'',4))','server_authority_required');
reset role;
update private.account_server_authority set enabled=true;
set local role authenticated;
do $$ declare b uuid:='19000000-1111-4111-8111-000000000001'; k text:=repeat('account-fixture-',4); p jsonb; r jsonb; ev jsonb; x jsonb; begin
 select value into ev from account_fixture where key='printfulEvidence';
 r:=pg_temp.prepare_account(b,'printful','connect','revocation-pending-1')->'run';
 x:=public.account_owner_transition(b,'revoke',jsonb_build_object('provider','printful','expectedConnectionRevision',ev->'connectionRevision'),k);
 assert x->'revoked'='true'; assert x->'remoteTokenRevoked'='false';
 assert public.account_owner_transition(b,'resume',jsonb_build_object('runId',r->'id'),k)->'run'->>'status'='invalidated';
 perform pg_temp.expect_error(format('select public.account_owner_transition(%L,''connection'',''{"provider":"printful"}'',%L)',b,k),'account_access_revoked');
 -- Password backup removal is separately requested and works after API revoke.
 assert public.account_owner_transition(b,'workspace')->'accounts'->1->'passwordStored'='true';
 select value into p from account_fixture where key='passwordRevision';
 perform pg_temp.expect_error(format('select public.account_owner_transition(%L,''delete_password'',%L::jsonb,%L)',b,jsonb_build_object('provider','printful','connectionId',((select value from account_fixture where key='printful')->'connectionId'),'expectedPasswordRevision',gen_random_uuid()),k),'stale_password_revision');
 perform pg_temp.expect_error(format('select public.account_owner_transition(''19000000-1111-4111-8111-000000000002'',''delete_password'',%L::jsonb,%L)',jsonb_build_object('provider','printful','connectionId',((select value from account_fixture where key='printful')->'connectionId'),'expectedPasswordRevision',p->'passwordRevision'),k),'password_owner_required');
 assert public.account_owner_transition(b,'delete_password',jsonb_build_object('provider','printful','connectionId',((select value from account_fixture where key='printful')->'connectionId'),'expectedPasswordRevision',p->'passwordRevision'),k)->'removed'='true';
 assert public.account_owner_transition(b,'workspace')->'accounts'->1->'passwordStored'='false';
 assert public.account_owner_transition(b,'delete_password',jsonb_build_object('provider','printful','connectionId',((select value from account_fixture where key='printful')->'connectionId'),'expectedPasswordRevision',p->'passwordRevision'),k)->'removed'='true';
 -- Exact new revision allows idempotent local revoke; stale revision cannot win.
 assert public.account_owner_transition(b,'revoke',jsonb_build_object('provider','printful','expectedConnectionRevision',x->'revision'),k)->'revoked'='true';
 perform pg_temp.expect_error(format('select public.account_owner_transition(%L,''revoke'',%L::jsonb,%L)',b,jsonb_build_object('provider','printful','expectedConnectionRevision',ev->'connectionRevision'),k),'stale_connection_revision');
 r:=pg_temp.prepare_account(b,'etsy','connect','etsy-revocation-pending-1')->'run';
 perform pg_temp.expect_error(format('select public.account_owner_transition(%L,''revoke'',%L::jsonb,%L)',b,jsonb_build_object('provider','etsy','expectedConnectionRevision',gen_random_uuid(),'etsyServerKey',repeat('account-etsy-fixture-',4)),k),'stale_connection_revision');
 assert public.account_owner_transition(b,'workspace')->'accounts'->0->>'status'='connected';
 assert public.account_owner_transition(b,'workspace')->'accounts'->0->>'revision'='19000000-1111-4111-8111-000000000021';
 perform pg_temp.expect_error(format('select public.account_owner_transition(%L,''revoke'',%L::jsonb,%L)',b,jsonb_build_object('provider','etsy','expectedConnectionRevision','19000000-1111-4111-8111-000000000021','etsyServerKey','wrong'),k),'server_authority_required');
 assert public.account_owner_transition(b,'workspace')->'accounts'->0->>'status'='connected';
 x:=public.account_owner_transition(b,'revoke',jsonb_build_object('provider','etsy','expectedConnectionRevision','19000000-1111-4111-8111-000000000021','etsyServerKey',repeat('account-etsy-fixture-',4)),k);
 assert x->'revoked'='true';
 assert public.account_owner_transition(b,'workspace')->'accounts'->0->>'status'='revoked';
 assert public.account_owner_transition(b,'resume',jsonb_build_object('runId',r->'id'),k)->'run'->>'status'='invalidated';
 r:=pg_temp.prepare_account(b,'printful','connect','expiry-fixture-1')->'run';
 insert into account_fixture values('expiredRun',r);
end $$;
reset role;
update private.account_setup_runs set approval_expires_at=clock_timestamp()-interval '1 second' where id=((select value from account_fixture where key='expiredRun')->>'id')::uuid;
set local role authenticated;
do $$ declare r jsonb; begin
 select value into r from account_fixture where key='expiredRun';
 assert public.account_owner_transition('19000000-1111-4111-8111-000000000001','resume',jsonb_build_object('runId',r->'id'),repeat('account-fixture-',4))->'run'->>'status'='expired';
 perform pg_temp.expect_error(format('select public.account_owner_transition(''19000000-1111-4111-8111-000000000001'',''approve'',%L::jsonb,repeat(''account-fixture-'',4))',jsonb_build_object('runId',r->'id','revision',r->'revision','disclosureHash',r->'disclosureHash')),'setup_stopped_or_approval_expired');
end $$;
reset role;
do $$ begin
 assert (select credential_envelope is null from private.provider_connections where business_id='19000000-1111-4111-8111-000000000001');
 assert (select count(*)=1 from private.account_browser_handoffs where status='released');
 assert not exists(select 1 from private.account_password_credentials); -- Separate explicit removal, after retained-on-disconnect verification.
 assert (select count(*)=1 from private.account_health_events where event_type='password_removed');
 assert not exists(select 1 from private.account_health_events where summary::text like '%PPPPPPPPPPPPPPPP%' or summary::text like '%credentialEnvelope%');
 assert not exists(select 1 from private.account_health_events where summary::text like '%account-v1.%');
end $$;
rollback;
