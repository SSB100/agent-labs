/** New21300 local database qualification. All provider IO is inert. The reviewed
 * enrollment, owner approval, R05 reservations, verification and source are real. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {steelConfigDatabase,inertSteelAttestation,publishInertSteelAttestation,steelConfigRequest,admitSteelConfig} from './helpers/r12-steel-config-sql-fixture.mjs';
import {prepareSteelConfigSetup} from './helpers/r12-steel-config-prepared-setup-fixture.mjs';
import {steelConfigEnrollmentFixture} from './helpers/r12-steel-config-enrollment-fixture.mjs';
import {steelConfigResearchRuntimeComposition} from './helpers/r12-steel-config-source-fixture.mjs';
import {directSonnetModelComplete} from './helpers/r12-direct-sonnet-model-fixture.mjs';
import {r12PhaseOutputFixture} from './helpers/r12-phase-output-fixture.mjs';
import {one,ownerInitialRuntimeRpc} from './helpers/r12-owner-initial-sql-fixture.mjs';
import {discoveryV2Hash as hash} from '../.core-tests/products/discovery-v2-hash.js';

const options={skip:!process.env.R12_SQL_TEST_HOST&&!process.env.R12_REQUIRE_POSTGRES&&!process.env.R12_POSTGRES_URL,timeout:240000};
const rejection=/steel_|scope|scoped|configuration|keys|request_changed|42501|query returned no rows/;
async function snapshots(db){return one(db,`select
 (select count(*)::int from private.r12_steel_config_attestations) attestations,
 (select count(*)::int from private.r12_steel_create_config_requests) requests,
 (select count(*)::int from private.r12_steel_create_config_permits) permits,
 (select count(*)::int from private.r12_steel_create_config_uses) uses,
 (select count(*)::int from private.r12_etsy_steel_dispatches) setup,
 (select count(*)::int from private.r12_etsy_steel_verification_dispatches) verification,
 (select count(*)::int from private.r12_direct_source_transport_claims) source,
 (select count(*)::int from private.r05_reservations) reservations,
 (select count(*)::int from private.r05_markers) markers,
 (select count(*)::int from private.r12_direct_browser_operations) browser_operations`);}
async function deniedUnchanged(db,work,pattern=rejection){
 const before=await snapshots(db);
 if(db.steelConfigProbeTransaction)await db.exec('savepoint expected_config_denial');
 await assert.rejects(work,pattern);
 if(db.steelConfigProbeTransaction)await db.exec('rollback to savepoint expected_config_denial');
 assert.deepEqual(await snapshots(db),before,'Denied configuration/create cannot write an admission, consume, dispatch, reservation or marker');
}
async function exerciseAdmission(db,{name,businessId,request,key,send,routeHash,expiry=false,extraInvalidRequests=[],afterPermit=null}){
 console.log('Steel config admission stage:',name);
 await deniedUnchanged(db,send);
 const preflightAttestation=expiry?await publishInertSteelAttestation(db,routeHash):null;
 for(const change of [
  {version:'r12.steel-create-config-admission.0'},{operationId:randomUUID()},{scopeHash:hash('wrong scope')},
  {providerProjectId:randomUUID()},{credentialBindingHash:hash('wrong credential')},{configurationHash:hash('wrong config')},
  {deploymentId:'dpl_wrong_deployment'},{requestBodyHash:hash('wrong actual body')},{apiKey:'inert-secret-must-never-enter-contract'},
 ]){
  await deniedUnchanged(db,()=>admitSteelConfig(db,businessId,{...request,...change},key));
 }
 for(const changed of extraInvalidRequests)await deniedUnchanged(db,()=>admitSteelConfig(db,businessId,changed,key));
 await deniedUnchanged(db,()=>admitSteelConfig(db,businessId,request,'inert-wrong-key-with-at-least-thirty-two-characters'));
 await deniedUnchanged(db,()=>admitSteelConfig(db,businessId,request,'x'.repeat(201)));
 const admit=()=>admitSteelConfig(db,businessId,request,key);
 if(expiry){
  const wrongRelease=await publishInertSteelAttestation(db,routeHash,{mutate:a=>{a.deploymentEvidenceHash=hash('unreviewed deployment');}});
  await deniedUnchanged(db,admit,/r12_steel_config_reviewed_release_changed/);
  await db.query('insert into private.r12_steel_config_attestation_revocations(attestation_hash) values($1)',[wrongRelease.attestation.attestationHash]);
  await db.query('insert into private.r12_steel_config_attestation_revocations(attestation_hash) values($1)',[preflightAttestation.attestation.attestationHash]);
  await publishInertSteelAttestation(db,routeHash,{validUntil:new Date(Date.now()+900).toISOString()});
 }
 let permit=await admit();assert.equal(permit.version,'r12.steel-create-config-permit.1');
 assert.deepEqual(await admit(),permit,'An exact current retry returns the original immutable permit');
 const {admissionHash,...body}=permit;assert.equal(admissionHash,hash(body));
 for(const key of ['operationId','scopeHash','providerProjectId','credentialBindingHash','configurationHash','deploymentId','requestBodyHash'])assert.equal(permit[key],request[key]);
 assert.equal((await snapshots(db)).uses,0+(name==='setup'?0:name==='verification'?1:2));
 if(expiry){
  await delay(Math.max(0,Date.parse(permit.validUntil)-Date.now())+30);
  await deniedUnchanged(db,send,/steel_.*(permit|expired|admission)/);
  await publishInertSteelAttestation(db,routeHash);
  const fresh=await admit();assert.notEqual(fresh.admissionHash,permit.admissionHash);assert.equal(fresh.operationId,permit.operationId);permit=fresh;
 }
 if(name==='verification'){
  await db.query('insert into private.r12_steel_config_attestation_revocations(attestation_hash) values($1)',[permit.attestationHash]);
  await deniedUnchanged(db,send,/steel_.*(permit|attestation)/);
  await deniedUnchanged(db,admit,/steel_.*attestation/);
  await publishInertSteelAttestation(db,routeHash);
  const replacement=await admit();assert.notEqual(replacement.attestationHash,permit.attestationHash);permit=replacement;
 }
 for(const change of [{credentialBindingHash:hash('changed bound credential')},{requestBodyHash:hash('changed bound body')},{deploymentId:'dpl_changed'}]){
  await deniedUnchanged(db,()=>admitSteelConfig(db,businessId,{...request,...change},key));
 }
 if(afterPermit)await afterPermit(permit);
 return permit;
}
async function exerciseConsumption(db,{name,businessId,request,key,send},permit){
 const admit=()=>admitSteelConfig(db,businessId,request,key);
 const before=await snapshots(db),result=await send();assert.equal(result.allowed,true);
 const after=await snapshots(db);assert.deepEqual(after,{...before,uses:before.uses+1,[name]:before[name]+1});
 await deniedUnchanged(db,admit,/steel_.*(consum|used|already|dispatch|inactive)/);
 await deniedUnchanged(db,send,/steel_|duplicate key|already/);
 return{result,permit};
}

async function rollbackFenceProbe(db,mutate,consume,pattern){
 const before=await snapshots(db),nested=!!db.steelConfigProbeTransaction;
 await db.exec(nested?'savepoint before_guard_mutation':'begin');
 try{
  await mutate();const changed=await snapshots(db);
  await db.exec('savepoint expected_guard_denial');
  await assert.rejects(consume,pattern);await db.exec('rollback to savepoint expected_guard_denial');
  assert.deepEqual(await snapshots(db),changed,'The trigger itself must reject without a use or transport claim');
 }finally{await db.exec(nested?'rollback to savepoint before_guard_mutation':'rollback');}
 assert.deepEqual(await snapshots(db),before,'Rollback keeps the genuine original permitted setup intact');
}
async function rollbackProbe(db,work){
 assert.equal(db.steelConfigProbeTransaction,undefined);await db.exec('begin');db.steelConfigProbeTransaction=true;
 // Existing frozen role helpers reset their role in finally. Preserve the real
 // denial while clearing PostgreSQL's aborted-statement state inside this
 // test-only rollback branch, so that their reset remains possible.
 const originalQuery=db.query,query=originalQuery.bind(db);
 db.query=async(...args)=>{
  // Native exec delegates to query. Wrapping SAVEPOINT/ROLLBACK TO/RELEASE
  // would release the wrapper's parent and destroy the caller's nested fence.
  // Transaction controls must reach the connection directly; ordinary RPC
  // statements still recover before the frozen role helper's finally reset.
  if(typeof args[0]==='string'&&/^\s*(?:begin|start\s+transaction|commit|end|rollback|abort|savepoint|release)\b/i.test(args[0]))return query(...args);
  await query('savepoint rollback_probe_statement');
  try{const result=await query(...args);await query('release savepoint rollback_probe_statement');return result;}
  catch(error){await query('rollback to savepoint rollback_probe_statement');await query('release savepoint rollback_probe_statement');throw error;}
 };
 try{return await work();}finally{db.query=originalQuery;await db.exec('rollback');delete db.steelConfigProbeTransaction;}
}
async function exerciseCreate(db,stage){return exerciseConsumption(db,stage,await exerciseAdmission(db,stage));}

// This is a transaction-control trace regression, not a database substitute.
// The genuine lifecycle below also uses this exact native exec delegation.
test('Steel rollback probe keeps native delegated transaction controls outside statement recovery',async()=>{
 const trace=[],denial=new Error('inert statement denial');
 const db={query:async sql=>{trace.push(sql);if(sql==='select inert_denial()')throw denial;return{rows:[]};}};
 db.exec=sql=>db.query(sql);const originalQuery=db.query,originalExec=db.exec;
 await rollbackProbe(db,async()=>{
  await db.exec('savepoint expected_config_denial');
  await db.exec('set role anon');
  await assert.rejects(db.query('select inert_denial()'),error=>error===denial);
  await db.exec('reset role');
  await db.exec('rollback to savepoint expected_config_denial');
  await db.exec('release savepoint expected_config_denial');
  await db.exec('savepoint before_guard_mutation');
  await db.query('select inert_mutation()');
  await db.exec('savepoint expected_guard_denial');
  await assert.rejects(db.query('select inert_denial()'),error=>error===denial);
  await db.exec('rollback to savepoint expected_guard_denial');
  await db.exec('rollback to savepoint before_guard_mutation');
 });
 const recovered=sql=>['savepoint rollback_probe_statement',sql,'release savepoint rollback_probe_statement'];
 const rejected=['savepoint rollback_probe_statement','select inert_denial()','rollback to savepoint rollback_probe_statement','release savepoint rollback_probe_statement'];
 assert.deepEqual(trace,['begin','savepoint expected_config_denial',...recovered('set role anon'),...rejected,...recovered('reset role'),
  'rollback to savepoint expected_config_denial','release savepoint expected_config_denial','savepoint before_guard_mutation',
  ...recovered('select inert_mutation()'),'savepoint expected_guard_denial',...rejected,'rollback to savepoint expected_guard_denial',
  'rollback to savepoint before_guard_mutation','rollback']);
 assert.equal(db.query,originalQuery);assert.equal(db.exec,originalExec);assert.equal(db.steelConfigProbeTransaction,undefined);
 trace.length=0;
 await assert.rejects(rollbackProbe(db,async()=>{throw denial;}),error=>error===denial);
 assert.deepEqual(trace,['begin','rollback']);assert.equal(db.query,originalQuery);assert.equal(db.steelConfigProbeTransaction,undefined);
});

test('Steel config attestation is independent, private and mandatory for every genuine paid-create stage',options,async()=>{
 const db=await steelConfigDatabase(),oldFetch=globalThis.fetch;let externalCalls=0,latestAttestation,setup,source;
 // Exercise the native Client's dynamic exec -> query path even on PGlite.
 // Migration loading has finished; every remaining exec is one control statement.
 db.exec=sql=>db.query(sql);
 globalThis.fetch=async()=>{externalCalls++;throw Error('External provider traffic forbidden in Steel SQL qualification');};
 try{
  const f=await steelConfigEnrollmentFixture(db,{
   afterEnvelope:async({authority})=>{
    const invalid=[
     a=>{a.configuration.environment='preview';},a=>{a.configuration.baseUrl='https://evil.invalid';},
     a=>{a.configuration.providerProjectId=randomUUID();},a=>{a.configurationHash=hash('different configuration');},
     a=>{a.credentialBindingHash=hash('different credential');},a=>{a.providerAccountHash=hash('different account');},
     a=>{a.tariffHash=hash('different tariff');},a=>{a.dashboardTariffEvidenceHash=hash('unrelated tariff evidence');},
     a=>{a.independentReadback.returnedSessionId=randomUUID();},a=>{a.independentReadback.returnedProjectId=randomUUID();},
     a=>{a.independentReadback.method='POST';},a=>{a.independentReadback.providerStatus='live';},
     a=>{a.independentReadback.endpoint='https://api.steel.dev/v1/sessions';},
     a=>{a.independentReadback.credentialBindingHash=hash('different readback credential');},
     a=>{a.independentReadback.configurationHash=hash('different readback configuration');},
     a=>{a.validUntil=new Date(Date.now()-1).toISOString();},
     a=>{a.validFrom='-infinity';},a=>{a.validUntil='infinity';},a=>{a.validFrom=null;},
     a=>{a.independentReadback.observedAt=null;},a=>{a.independentReadback.sessionCreatedAt='-infinity';},
     a=>{a.validFrom=a.validFrom.replace('Z','+00:00');},
    ];
    for(const mutate of invalid){
     const candidate=await inertSteelAttestation(db,authority.routeHash,{mutate});
     await deniedUnchanged(db,()=>db.query('select private.r12_steel_publish_config_attestation($1)',[candidate]));
    }
   },
   setupCreate:async({authority,x,a,request,send})=>{
    setup=await exerciseCreate(db,{name:'setup',businessId:authority.f.businessId,request,key:x.keys.handoff,send,routeHash:authority.routeHash,expiry:true,extraInvalidRequests:[steelConfigRequest({...a.scope,maximumSessionMs:a.scope.maximumSessionMs-1},{setup:true})],
     afterPermit:async()=>{
      const admission=await one(db,"select request_hash from private.r12_etsy_steel_admissions where operation_id=$1 and stage='create'",[a.scope.operationId]);
      const consume=()=>db.query('insert into private.r12_etsy_steel_dispatches(operation_id,request_hash) values($1,$2)',[a.scope.operationId,admission.request_hash]);
      await rollbackFenceProbe(db,()=>x.owner('stop',{operationId:a.scope.operationId}),consume,/authority_inactive|stopped/);
      await rollbackFenceProbe(db,()=>db.query('insert into private.r12_direct_owner_renderer_revocations(route_hash) values($1)',[authority.routeHash]),consume,/renderer|review|inactive/);
      await rollbackFenceProbe(db,()=>db.query("insert into private.r05_cap_versions(business_id,currency,revision,maximum_microunits,policy_id) select business_id,currency,revision+1,0,policy_id from private.r05_cap_versions where business_id=$1 and currency='USD' order by revision desc limit 1",[authority.f.businessId]),consume,/r12_steel_config_business_limit/);
     }});return setup.result;
   },
   verificationRuntime:async(runtime,ctx)=>{
    await rollbackProbe(db,async()=>{
     const prepared=await ctx.rawVerifier('prepare',{setupOperationId:ctx.a.scope.operationId}),operationId=prepared.scope.operationId;
     await ctx.rawVerifier('admit',{operationId});await ctx.rawVerifier('qualify_renderer',{operationId});
     const request=steelConfigRequest(prepared.scope),send=()=>ctx.rawVerifier('transport',{operationId,request:{provider:'steel',operation:'browser.etsy.insights.create',method:'POST',endpoint:'https://api.steel.dev/v1/sessions'}});
     await exerciseCreate(db,{name:'verification',businessId:ctx.authority.f.businessId,request,key:ctx.x.keys.verification,send,routeHash:ctx.authority.routeHash});
    });
    runtime.input.createConfigurationGuard.admit=async request=>admitSteelConfig(db,ctx.authority.f.businessId,request,ctx.x.keys.verification);
   },
   verificationCreate:async({request,admit,send})=>{
    const permit=await admit();assert.equal(permit.operationId,request.operationId);return send();
   },
  });
  const plan=r12PhaseOutputFixture(f.profile.audience).plan;plan.queryFocus=[];
  await directSonnetModelComplete(f,await f.schedule('plan'),plan);
  const sourceAfterPermit=async permit=>{
   const a=await one(db,"select attempt_id from private.r12_direct_phase_attempts where source_scope->>'operationId'=$1",[permit.operationId]);
   await rollbackFenceProbe(db,()=>db.query("update private.r07_heads set state='paused',reason='explicit_owner_pause',revision=revision+1 where goal_id=$1",[f.authority.f.goalId]),()=>db.query('insert into private.r12_direct_source_transport_claims(attempt_id) values($1)',[a.attempt_id]),/r12_.*(inactive|paused|head|current)/);
  };
  const a=await f.schedule('source'),scope=a.inputs;
  const sourceAdmission={version:'r12.etsy-insights-source-admission.1',operation:'create',sequence:0,requestHash:hash(scope),
   ...Object.fromEntries(['operationId','sourceAttemptId','businessId','goalId','authorityRootId','scopeId','scopeHash','providerProjectId','originDirectRunId','windowAttemptOrdinal','attemptOrdinal','criteriaHash','questionHash','quoteHash','executionQuoteHash','executionQuoteProofHash','sourcePolicyHash','capturePolicyHash','maximumBrowserMicrounits'].map(k=>[k,scope[k]])),
   windowId:scope.window.windowId,windowOrdinal:scope.window.windowOrdinal,accountBindingHash:scope.accountBinding.bindingHash,accountVerificationHash:scope.accountBinding.accountVerificationHash,
   sessionId:null,contextId:null,pageId:null,documentEpoch:null,targetId:null,captureHash:null};
  await rollbackProbe(db,async()=>{
   await f.rpc('source_admit',{request:sourceAdmission},'source');await f.rpc('resolve_source',{attemptId:a.attemptId},'source');await f.rpc('qualify_renderer',{attemptId:a.attemptId},'source');
   const request=steelConfigRequest(scope,{profileId:f.approved.profileId}),send=()=>f.rpc('source_transport',{attemptId:a.attemptId,request:{provider:'steel',operation:'browser.etsy.insights.create',method:'POST',endpoint:'https://api.steel.dev/v1/sessions'}},'source');
   await exerciseCreate(db,{name:'source',businessId:f.authority.f.businessId,request,key:f.keys.source,send,routeHash:f.authority.routeHash,afterPermit:sourceAfterPermit});
  });
  const runtime=steelConfigResearchRuntimeComposition(db,f,{policyVersion:f.policy.version,
   configurationAdmit:async request=>{
    const permit=await admitSteelConfig(db,f.authority.f.businessId,request,f.keys.source);source={request,permit};return permit;
   },rpcTransport:async(name,args)=>{
    const send=()=>ownerInitialRuntimeRpc(db,name,name==='r12_direct_browser_ledger'?[args.p_business_id,args.p_operation_id,args.p_operation,args.p_payload,args.p_server_key]:[args.p_business_id,args.p_scope_id,args.p_operation,args.p_payload,args.p_server_key]);
    if(args.p_operation==='source_transport'&&args.p_payload.request.operation==='browser.etsy.insights.create'){
     const request=steelConfigRequest(scope,{profileId:f.approved.profileId}),permit=await admitSteelConfig(db,f.authority.f.businessId,request,f.keys.source);
     source={request,permit};return send();
    }
    return send();
   }});

  const result=await runtime.step();assert.equal(result.reason,'source_recorded',JSON.stringify({result,errors:runtime.sqlErrors,sourceResults:runtime.sourceResults,browserPosts:runtime.browserPosts}));
  assert.equal(runtime.browserPosts.length,1);assert.equal(runtime.sourceResults[0].run.receipt.status,'completed');
  assert.equal((await snapshots(db)).uses,3);assert.equal(externalCalls,0);

  latestAttestation=source.permit.attestationHash;
  await db.query('insert into private.r12_steel_config_attestation_revocations(attestation_hash) values($1)',[latestAttestation]);
  const setupId=f.approved.setupOperation,verificationId=f.approved.verificationOperation,sourceId=source.permit.operationId,attemptId=runtime.browserPosts[0].attemptId;
  for(const [operationId,call]of [
   [setupId,(request)=>f.approved.server('transport',{operationId:setupId,request},'cleanup')],
   [verificationId,(request)=>f.approved.verifier('transport',{operationId:verificationId,request})],
   [sourceId,(request)=>f.rpc('source_transport',{attemptId,request},'source')],
  ])for(const [operation,method,suffix]of [['browser.etsy.session.release','POST','/release'],['browser.etsy.session.release_readback','GET','']]){
   const reply=await call({provider:'steel',operation,method,endpoint:'https://api.steel.dev/v1/sessions/'+operationId+suffix});
   assert.deepEqual(reply,{allowed:true,operationId});
  }
  assert.equal((await snapshots(db)).uses,3,'Cleanup cannot consume another create permit');
  const tables=(await db.query("select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname like 'r12_steel_%' and c.relkind='r' order by c.relname")).rows;
  assert.equal(tables.length,5);assert.ok(tables.every(x=>x.relrowsecurity));
  const exposed=(await db.query("select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'r12_steel_%' and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute') or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE'))")).rows;
  assert.deepEqual(exposed,[]);
  assert.deepEqual(await one(db,"select has_function_privilege('anon','public.r12_steel_create_config_admit(uuid,jsonb,text)','execute') anon,has_function_privilege('authenticated','public.r12_steel_create_config_admit(uuid,jsonb,text)','execute') authenticated,has_function_privilege('service_role','public.r12_steel_create_config_admit(uuid,jsonb,text)','execute') service_role"),{anon:true,authenticated:false,service_role:false});
  const contender=await prepareSteelConfigSetup(db);
  assert.equal(contender.permit.operationId,contender.operationId);
  assert.deepEqual(contender.request,steelConfigRequest(contender.setup.scope,{setup:true}));
  assert.equal((await one(db,'select count(*)::int n from private.r12_steel_create_config_uses where operation_id=$1',[contender.operationId])).n,0);
  assert.equal((await one(db,'select count(*)::int n from private.r12_etsy_steel_dispatches where operation_id=$1',[contender.operationId])).n,0);
  console.log('Steel21300 genuine local stages',JSON.stringify({setup:true,verification:true,source:true,expiredDenied:true,consumedExactlyOnce:3,cleanupAfterRevocation:true,externalProviderCalls:externalCalls}));
 }finally{globalThis.fetch=oldFetch;await db.close();}
});
