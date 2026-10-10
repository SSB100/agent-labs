/** Focused final-chain HTTP acceptance. Reviewed enrollment, owner approval,
 * create permits and runtime SQL are genuine; all provider leaves are inert.
 * SQL fixture mode deliberately cannot qualify HTTP or its role deadline. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {steelConfigDatabase,STEEL_CONFIG_MIGRATION,publishInertSteelAttestation} from './helpers/r12-steel-config-sql-fixture.mjs';
import {steelConfigEnrollmentFixture} from './helpers/r12-steel-config-enrollment-fixture.mjs';
import {steelConfigResearchRuntimeComposition} from './helpers/r12-steel-config-source-fixture.mjs';
import {one,ownerInitialRuntimeRpc} from './helpers/r12-owner-initial-sql-fixture.mjs';
import {discoveryV2Hash as hash} from '../.core-tests/products/discovery-v2-hash.js';
import {validatePublicResearchRepairState} from '../.core-tests/products/discovery-r12-public-repair.js';
import {validateR12HttpDatabase,configureR12HttpRoles,startR12Postgrest,r12HttpRpc} from './helpers/r12-postgrest-http.mjs';

const http=process.env.R12_REQUIRE_POSTGREST==='1',fixtureOnly=process.env.R12_MAPPED_HTTP_FIXTURE_ONLY==='1';
assert.ok(!(http&&fixtureOnly),'Native HTTP and dry SQL fixture modes are mutually exclusive');
if(http){
 assert.equal(process.env.R12_REQUIRE_POSTGRES,'1');assert.ok(process.env.R12_POSTGREST_BINARY);
 validateR12HttpDatabase(process.env.R12_POSTGRES_URL);
 assert.ok(existsSync(STEEL_CONFIG_MIGRATION),'Native final-chain qualification requires the promoted 21300 migration');
}
if(fixtureOnly){assert.ok(process.env.R12_SQL_TEST_HOST);assert.ok(!process.env.R12_REQUIRE_POSTGRES&&!process.env.R12_POSTGRES_URL,'Dry mode uses only its isolated PGlite host');}

const argumentsFor={
 r12_steel_create_config_admit:['p_business_id','p_request','p_server_key'],
 r12_etsy_steel_server:['p_business_id','p_operation','p_payload','p_server_key'],
 r12_etsy_steel_verification_server:['p_business_id','p_operation','p_payload','p_server_key'],
 r12_direct_controller_server:['p_business_id','p_scope_id','p_operation','p_payload','p_server_key'],
 r12_direct_browser_ledger:['p_business_id','p_operation_id','p_operation','p_payload','p_server_key'],
};
async function qualify(useHttp){
 const report={version:'r12.mapped-steel-http-qualification.1',mode:useHttp?'native_postgrest':'inert_sql_fixture',passed:false,httpQualified:false,externalProviderCalls:0,trials:[],guards:[],limits:useHttp?[]:['HTTP not run; anon role timeout and native transport remain unqualified']};
 const savedEnv=Object.fromEntries(['R05_ADMISSION_SERVER_KEY','VERCEL_ENV','VERCEL_DEPLOYMENT_ID','VERCEL_GIT_COMMIT_SHA'].map(k=>[k,process.env[k]]));
 const originalFetch=globalThis.fetch;let db,server,restoreRoles,locker;
 globalThis.fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
  if(!useHttp||url.protocol!=='http:'||url.hostname!=='127.0.0.1'){
   report.externalProviderCalls++;throw Error('Only actual isolated loopback PostgREST traffic is allowed');
  }
  return originalFetch(input,init);
 };
 try{
  db=await steelConfigDatabase();
  report.migrations=Object.fromEntries([
   'supabase/migrations/20261010121000_r12_direct_reviewed_enrollment.sql',
   'supabase/migrations/20261010121200_r12_direct_sonnet_quote.sql',
   STEEL_CONFIG_MIGRATION,
  ].map(file=>[path.basename(file),createHash('sha256').update(readFileSync(file)).digest('hex')]));
  for(const signature of [
   'public.r12_steel_create_config_admit(uuid,jsonb,text)',
   'public.r12_etsy_steel_server(uuid,text,jsonb,text)',
   'public.r12_etsy_steel_verification_server(uuid,text,jsonb,text)',
   'public.r12_direct_controller_server(uuid,uuid,text,jsonb,text)',
   'public.r12_direct_browser_ledger(uuid,uuid,text,jsonb,text)',
  ]){
   const acl=await one(db,`select proconfig,prosecdef,has_function_privilege('anon',oid,'EXECUTE') anon,
    has_function_privilege('authenticated',oid,'EXECUTE') authenticated,has_function_privilege('service_role',oid,'EXECUTE') service,
    exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') public_execute from pg_proc where oid=$1::regprocedure`,[signature]);
   assert.deepEqual(acl,{proconfig:['search_path=""'],prosecdef:true,anon:true,authenticated:false,service:false,public_execute:false});
  }
  report.guards.push('final_chain_exact_anon_only_rpc_acls');
  let rpc;
  if(useHttp){
   restoreRoles=await configureR12HttpRoles(db);
   await db.exec(`create function public.r12_mapped_http_settings() returns jsonb language sql set search_path='' as $$select jsonb_build_object('role',current_user,'statementTimeout',current_setting('statement_timeout'),'timezone',current_setting('TimeZone'))$$;revoke all on function public.r12_mapped_http_settings() from public,anon,authenticated,service_role;grant execute on function public.r12_mapped_http_settings() to anon;`);
   server=await startR12Postgrest({binary:process.env.R12_POSTGREST_BINARY,databaseUrl:process.env.R12_POSTGRES_URL});
   report.postgrestVersion=server.version;rpc=r12HttpRpc(server.base,report.trials);
   const {Client}=createRequire(path.resolve(process.env.R12_SQL_TEST_HOST,'package.json'))('pg');
   locker=new Client({connectionString:process.env.R12_POSTGRES_URL});await locker.connect();
  }else rpc=async(name,args)=>{
   assert.ok(argumentsFor[name],'Dry SQL cannot fabricate unrecognized HTTP RPCs');
   try{return{ok:true,data:await ownerInitialRuntimeRpc(db,name,argumentsFor[name].map(k=>args[k]))};}
   catch(error){return{ok:false,data:{code:error.code,message:error.message}};}
  };
  const checked=async(name,args)=>{
   const result=await rpc(name,args);assert.equal(result.ok,true,`${name}/${args.p_operation??'config_admit'}: ${JSON.stringify(result.data)}`);
   if(useHttp)assert.ok(result.elapsedMs<3000,'Each actual anon RPC must fit its unchanged three-second budget');
   return result.data;
  };
  if(useHttp)assert.deepEqual(await checked('r12_mapped_http_settings',{}),{role:'anon',statementTimeout:'3s',timezone:'UTC'});
  const fingerprint=()=>one(db,`select
   (select count(*)::int from private.r12_steel_create_config_requests) requests,
   (select count(*)::int from private.r12_steel_create_config_permits) permits,
   (select count(*)::int from private.r12_steel_create_config_uses) uses,
   (select count(*)::int from private.r12_etsy_steel_dispatches) setup_dispatches,
   (select count(*)::int from private.r12_etsy_steel_verification_dispatches) verification_dispatches,
   (select count(*)::int from private.r12_direct_source_transport_claims) source_claims,
   (select count(*)::int from private.r05_reservations) reservations,
   (select count(*)::int from private.r05_markers) markers`);
  const permits=[];
  const admit=async(businessId,request,key,stage)=>{
   const permit=await checked('r12_steel_create_config_admit',{p_business_id:businessId,p_request:request,p_server_key:key});
   const {admissionHash,...body}=permit;assert.equal(admissionHash,hash(body));
   assert.equal(permit.version,'r12.steel-create-config-permit.1');
   for(const k of ['operationId','scopeHash','providerProjectId','credentialBindingHash','configurationHash','deploymentId','requestBodyHash'])assert.equal(permit[k],request[k]);
   permits.push({stage,operationId:request.operationId,admissionHash});return permit;
  };
  assert.equal((await one(db,'select count(*)::int n from private.r12_direct_enrollment_grants')).n,0);
  const f=await steelConfigEnrollmentFixture(db,{
   afterEnvelope:async({authority})=>publishInertSteelAttestation(db,authority.routeHash),
   setupCreate:async({authority,x,request})=>{
    const args={p_business_id:authority.f.businessId,p_request:request,p_server_key:x.keys.handoff};
    const createArgs={p_business_id:authority.f.businessId,p_operation:'transport',p_payload:{operationId:request.operationId,request:{provider:'steel',operation:'browser.etsy.owner_handoff.create',method:'POST',endpoint:'https://api.steel.dev/v1/sessions'}},p_server_key:x.keys.handoff};
    const before=await fingerprint();
    const missing=await rpc('r12_etsy_steel_server',createArgs);assert.equal(missing.ok,false);assert.match(missing.data.message,/r12_steel_config_permit_required/);
    const wrongKey=await rpc('r12_steel_create_config_admit',{...args,p_server_key:'inert-forbidden-key-01234567890123456789'});assert.equal(wrongKey.ok,false);assert.equal(wrongKey.data.code,'42501');
    assert.deepEqual(await fingerprint(),before);report.guards.push('fresh_mapped_setup_missing_permit_and_wrong_key_have_no_mutation');
    if(useHttp){
     await locker.query('begin');await locker.query('select 1 from public.businesses where id=$1 for update',[authority.f.businessId]);
     try{
      const blocked=await rpc('r12_steel_create_config_admit',args);assert.equal(blocked.ok,false);assert.equal(blocked.data.code,'57014');assert.ok(blocked.elapsedMs>=2800&&blocked.elapsedMs<5000);
     }finally{await locker.query('rollback');}
     assert.deepEqual(await fingerprint(),before);report.guards.push('actual_mapped_config_three_second_lock_timeout_has_no_partial_permit');
    }
    await admit(authority.f.businessId,request,x.keys.handoff,'setup');
    const created=await checked('r12_etsy_steel_server',createArgs);assert.equal(created.allowed,true);return created;
   },
   verificationRuntime:async(runtime,{authority,x})=>{
    runtime.input.createConfigurationGuard.admit=request=>admit(authority.f.businessId,request,x.keys.verification,'verification');
   },
   verificationCreate:async({authority,x,request})=>checked('r12_etsy_steel_verification_server',{
    p_business_id:authority.f.businessId,p_operation:'transport',p_payload:{operationId:request.operationId,request:{provider:'steel',operation:'browser.etsy.insights.create',method:'POST',endpoint:'https://api.steel.dev/v1/sessions'}},p_server_key:x.keys.verification,
   }),
  });
  const mapping=await one(db,`select m.grant_id,m.package_hash,m.owner_id,m.proposal_id,p.business_id,p.goal_id
   from private.r12_direct_enrollment_grants m join private.r12_direct_enrollment_packages p on p.package_hash=m.package_hash where m.grant_id=$1`,[f.authority.f.grantId]);
  assert.equal(mapping.package_hash,f.enrollment.published.reviewedPackageHash);assert.equal(mapping.owner_id,f.authority.f.ownerId);
  assert.equal(mapping.business_id,f.authority.f.businessId);assert.equal(mapping.goal_id,f.authority.f.goalId);
  assert.ok(mapping.proposal_id);assert.equal(f.quote.version,'r12.public-research-quote.3');assert.equal(f.policy.version,'r12.direct-etsy-attempt-policy.2');
  assert.equal(f.quote.inference.reviewer.modelId,'anthropic/claude-sonnet-4.6');
  report.guards.push('fresh_owner_confirmed_mapped_grant_with_quote3_and_policy2');
  const beforeQuoteRead=await fingerprint();
  const quoteContext=await checked('r12_direct_controller_server',{p_business_id:f.authority.f.businessId,p_scope_id:f.prepared.scopeId,p_operation:'quote_context',p_payload:{},p_server_key:f.keys.controller});
  assert.deepEqual(quoteContext.approvedQuote,f.quote);assert.equal(quoteContext.maximumAttemptsInWindow,10);assert.equal(quoteContext.originalRunMaximumMicrounits,'10000000');
  assert.deepEqual(await fingerprint(),beforeQuoteRead,'Mapped quote-context read cannot reserve or consume work');
  const runtime=steelConfigResearchRuntimeComposition(db,f,{
   policyVersion:f.policy.version,rpcTransport:checked,
   configurationAdmit:request=>admit(f.authority.f.businessId,request,f.keys.source,'source'),
  });
  for(const expected of ['accepted','source_recorded','accepted','accepted']){
   const result=await runtime.step();assert.equal(result.reason,expected,JSON.stringify({result,errors:runtime.sqlErrors}));
  }
  const final=await checked('r12_direct_controller_server',{p_business_id:f.authority.f.businessId,p_scope_id:f.prepared.scopeId,p_operation:'read',p_payload:{},p_server_key:f.keys.controller});
  validatePublicResearchRepairState(final.state,f.policy);
  assert.equal(final.state.logicalCyclesStarted,1);assert.equal(final.state.unitsConsumed,1);assert.equal(final.state.modelDispatchesUsed,3);assert.equal(final.state.sourceOperationsStarted,1);assert.equal(final.state.nextAction,'next_cycle');assert.equal(final.state.questComplete,false);
  assert.equal(final.testExposure.knownActualMicrounits,'3');assert.equal(final.testExposure.boundedPendingMicrounits,'3000');assert.equal(final.testExposure.hasUnknownOrUnbounded,false);
  assert.deepEqual(runtime.modelPosts.map(p=>p.phase),['plan','strategy','review']);assert.equal(runtime.browserPosts.length,1);assert.equal(runtime.sourceResults[0].run.receipt.status,'completed');
  assert.deepEqual(permits.map(p=>p.stage),['setup','verification','source']);
  const used=(await db.query('select operation_id,admission_hash from private.r12_steel_create_config_uses')).rows;
  assert.equal(used.length,3);for(const p of permits)assert.ok(used.some(u=>u.operation_id===p.operationId&&u.admission_hash===p.admissionHash));
  const wire=(await one(db,'select binding from private.r12_direct_phase_wires where attempt_id=$1',[runtime.modelPosts.at(-1).attemptId])).binding;
  assert.equal(JSON.parse(wire.wireBody).model,'anthropic/claude-sonnet-4.6');assert.deepEqual(JSON.parse(wire.wireBody).provider.only,['amazon-bedrock/us']);assert.equal(JSON.parse(wire.wireBody).provider.zdr,true);
  report.guards.push('all_three_exact_configuration_permits_consumed_once','actual_mapped_model_and_source_admission_before_inert_provider_calls','real_sonnet_reviewer_and_full_cycle_receipts');
  if(useHttp){
   for(const operation of ['read','quote_context','observe_quote','schedule','attempt','inputs','dispatch','candidate','model_receipt','source_admit','resolve_source','qualify_renderer','admit_renderer','source_transport','source_screenshot','source_receipt','source_finish','cleanup_complete'])assert.ok(report.trials.some(t=>t.rpc==='r12_direct_controller_server'&&t.operation===operation&&t.status===200),'Actual mapped HTTP coverage required: '+operation);
   for(const name of ['r12_etsy_steel_server','r12_etsy_steel_verification_server','r12_direct_browser_ledger'])assert.ok(report.trials.some(t=>t.rpc===name&&t.status===200),'Actual mapped HTTP coverage required: '+name);
   assert.equal(report.trials.filter(t=>t.rpc==='r12_steel_create_config_admit'&&t.status===200).length,3);
   assert.deepEqual(await checked('r12_mapped_http_settings',{}),{role:'anon',statementTimeout:'3s',timezone:'UTC'});
   report.httpQualified=true;
  }
  assert.equal(report.externalProviderCalls,0);report.passed=true;report.inertModelPosts=runtime.modelPosts.length;report.inertResearchBrowserCreates=runtime.browserPosts.length;report.configPermitsConsumed=used.length;report.actualRuntimeSourceHash=runtime.sourceHash;report.exposure=final.testExposure;
 }finally{
  try{if(server)await server.close();if(locker)await locker.end();if(restoreRoles)await restoreRoles();}finally{if(db)await db.close();globalThis.fetch=originalFetch;for(const[k,v]of Object.entries(savedEnv)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
  if(process.env.R12_HTTP_REPORT){const file=path.resolve(process.env.R12_HTTP_REPORT);assert.ok(file.startsWith('/tmp/r12-http-'));writeFileSync(file,JSON.stringify(report,null,2)+'\n');}
  console.log('Mapped Steel HTTP qualification:',JSON.stringify(report));
 }
}
test('native PostgREST qualifies fresh mapped enrollment and Steel create admissions under unchanged anon three-second deadline',{skip:http?false:'Actual loopback PostgREST requires the native CI environment',timeout:300000},()=>qualify(true));
test('dry SQL qualifies the final mapped Steel HTTP fixture without claiming HTTP or role-timeout coverage',{skip:fixtureOnly?false:'Set R12_MAPPED_HTTP_FIXTURE_ONLY=1 for explicit dry SQL qualification',timeout:300000},()=>qualify(false));
