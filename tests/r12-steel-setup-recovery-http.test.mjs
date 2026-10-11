/** Genuine public RPC qualification under the pinned native PostgREST roles.
 * Existing failed-operation provider leaves are inert. Dry SQL mode cannot
 * qualify HTTP, role deadlines, sockets, or concurrent rollback. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {setupRecoveryDatabase,setupRecoveryFixture,publishInertRepairRelease} from './helpers/r12-steel-setup-recovery-fixture.mjs';
import {one,ownerInitialRpc,ownerInitialRuntimeRpc} from './helpers/r12-owner-initial-sql-fixture.mjs';
import {configureR12HttpRoles,startR12Postgrest,validateR12HttpDatabase} from './helpers/r12-postgrest-http.mjs';
import {discoveryV2Hash as hash} from '../.core-tests/products/discovery-v2-hash.js';
const http=process.env.R12_REQUIRE_POSTGREST==='1',dry=process.env.R12_SETUP_RECOVERY_HTTP_FIXTURE_ONLY==='1';
assert.ok(!(http&&dry));
if(http){assert.equal(process.env.R12_REQUIRE_POSTGRES,'1');validateR12HttpDatabase(process.env.R12_POSTGRES_URL);assert.ok(process.env.R12_POSTGREST_BINARY);}
if(dry){assert.ok(process.env.R12_SQL_TEST_HOST);assert.ok(!process.env.R12_POSTGRES_URL&&!process.env.R12_REQUIRE_POSTGRES);}
const argsFor={r12_etsy_steel_recovery_server:['p_business_id','p_operation','p_payload','p_server_key'],r12_owner_steel_replacement:['p_business_id','p_operation','p_payload'],r12_etsy_steel_owner:['p_business_id','p_operation','p_payload']};
function jwt(role,sub){const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),body=enc({alg:'HS256',typ:'JWT'})+'.'+enc({role,...(sub?{sub}:{}),exp:Math.floor(Date.now()/1000)+600});return body+'.'+createHmac('sha256','inert-r12-http-qualification-secret-only-0123456789').update(body).digest('base64url');}
const counts=db=>one(db,`select (select count(*)::int from private.r12_steel_setup_recovery_observations) observations,(select count(*)::int from private.r12_steel_setup_recoveries) proofs,(select count(*)::int from private.r12_steel_setup_replacement_proposals) proposals,(select count(*)::int from private.r12_steel_setup_repair_debits) debits,(select count(*)::int from private.r12_direct_browser_accounting) accounting,(select count(*)::int from private.r05_reservations) reservations,(select count(*)::int from private.r05_markers) markers,(select count(*)::int from private.r12_steel_create_config_uses) config_uses`);
test('native HTTP recovery and owner replacement preserve exact failed-operation liability and one-of-nine debit',{
 skip:http||dry?false:'Actual HTTP requires the permitted isolated native CI environment',timeout:240000,
},async()=>{
 const savedFetch=globalThis.fetch,report={version:'r12.steel-setup-recovery-http.1',mode:http?'native_postgrest':'inert_sql_fixture',passed:false,httpQualified:false,trials:[],externalProviderCalls:0,limits:http?[]:['HTTP and role deadlines are not qualified by dry SQL']};let db,server,restoreRoles,locker;
 globalThis.fetch=async(input,init)=>{const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(!http||url.origin!==server?.base){report.externalProviderCalls++;throw Error('Only isolated loopback PostgREST traffic is allowed');}return savedFetch(input,init);};
 try{
  db=await setupRecoveryDatabase();const x=await setupRecoveryFixture(db),operationId=x.setup.scope.operationId;
  for(const [sig,allowed] of [['public.r12_etsy_steel_recovery_server(uuid,text,jsonb,text)','anon'],['public.r12_owner_steel_replacement(uuid,text,jsonb)','authenticated']]){
   const a=await one(db,`select proconfig,prosecdef,has_function_privilege('anon',oid,'EXECUTE') anon,has_function_privilege('authenticated',oid,'EXECUTE') authenticated,has_function_privilege('service_role',oid,'EXECUTE') service,exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') public_execute from pg_proc where oid=$1::regprocedure`,[sig]);
   assert.deepEqual(a,{proconfig:['search_path=""'],prosecdef:true,anon:allowed==='anon',authenticated:allowed==='authenticated',service:false,public_execute:false});
  }
  if(http){
   restoreRoles=await configureR12HttpRoles(db);
   await db.exec(`create function public.setup_recovery_http_settings() returns jsonb language sql set search_path='' as $$select jsonb_build_object('role',current_user,'statementTimeout',current_setting('statement_timeout'))$$;revoke all on function public.setup_recovery_http_settings() from public,anon,authenticated,service_role;grant execute on function public.setup_recovery_http_settings() to anon,authenticated;`);
   // The pinned launcher performs only a read-only startup GET, before the
   // strict runtime URL is known. Its implementation enforces loopback itself.
   globalThis.fetch=savedFetch;server=await startR12Postgrest({binary:process.env.R12_POSTGREST_BINARY,databaseUrl:process.env.R12_POSTGRES_URL});
   globalThis.fetch=async(input,init)=>{const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);assert.equal(url.origin,server.base);return savedFetch(input,init);};
   const {Client}=createRequire(resolve(process.env.R12_SQL_TEST_HOST,'package.json'))('pg');locker=new Client({connectionString:process.env.R12_POSTGRES_URL});await locker.connect();
  }
  const request=async(name,args,{role='anon',owner=x.f.ownerId}={})=>{
   const start=performance.now();let result;
   if(http){const response=await fetch(server.base+'/rpc/'+name,{method:'POST',headers:{'content-type':'application/json',...(role==='anon'?{}:{authorization:'Bearer '+jwt(role,owner)})},body:JSON.stringify(args),signal:AbortSignal.timeout(12000)});result={ok:response.ok,status:response.status,data:await response.json()};}
   else{assert.ok(argsFor[name]);try{const values=argsFor[name].map(k=>args[k]),data=role==='authenticated'?await ownerInitialRpc(db,owner,name,values):role==='anon'?await ownerInitialRuntimeRpc(db,name,values):null;if(role==='service_role')throw Error('Dry fixture does not simulate service-role HTTP');result={ok:true,status:200,data};}catch(error){result={ok:false,status:400,data:{code:error.code,message:error.message}};}}
   result.elapsedMs=Math.round(performance.now()-start);report.trials.push({rpc:name,operation:args.p_operation??null,role,status:result.status,elapsedMs:result.elapsedMs,code:result.ok?null:result.data.code??null});return result;
  };
  const checked=async(name,args,actor)=>{const r=await request(name,args,actor);assert.equal(r.ok,true,`${name}/${args.p_operation}: ${JSON.stringify(r.data)}`);if(http)assert.ok(r.elapsedMs<(actor?.role==='authenticated'?8000:3000));return r.data;};
  if(http){assert.deepEqual(await checked('setup_recovery_http_settings',{}),{role:'anon',statementTimeout:'3s'});assert.deepEqual(await checked('setup_recovery_http_settings',{}, {role:'authenticated'}),{role:'authenticated',statementTimeout:'8s'});}
  const rec=(op,payload=x.pins,key=x.bridge.keys.evidence)=>({p_business_id:x.f.businessId,p_operation:op,p_payload:payload,p_server_key:key}),own=(op,payload)=>({p_business_id:x.f.businessId,p_operation:op,p_payload:payload});
  const before=await counts(db),oldReceipt=(await one(db,'select receipt from private.r12_etsy_steel_receipts where receipt_hash=$1',[x.receipt.receiptHash])).receipt;
  assert.match((await request('r12_etsy_steel_recovery_server',rec('inputs'))).data.message,/no_handoff_required/);
  // The original Stop also traverses the ordinary owner HTTP endpoint.
  await checked('r12_etsy_steel_owner',own('stop',{operationId}),{role:'authenticated'});
  for(const [args,pattern] of [[rec('inputs',x.pins,'inert-wrong-evidence-key-000000000000'),/evidence_key_required/],[rec('inputs',{...x.pins,failedReceiptHash:hash('wrong')}),/no_handoff_required/],[rec('record',{...x.pins,usage:{...x.usage,sessionId:randomUUID()}}),/terminal_usage_required/]])assert.match((await request('r12_etsy_steel_recovery_server',args)).data.message,pattern);
  if(http){for(const role of ['authenticated','service_role'])assert.equal((await request('r12_etsy_steel_recovery_server',rec('inputs'),{role})).ok,false);for(const role of ['anon','service_role'])assert.equal((await request('r12_owner_steel_replacement',own('read',{operationId}),{role})).ok,false);}
  assert.equal((await request('r12_owner_steel_replacement',own('read',{operationId}),{role:'authenticated',owner:randomUUID()})).ok,false);
  assert.deepEqual(await counts(db),before);
  const context=await checked('r12_etsy_steel_recovery_server',rec('inputs'));const{contextHash,...body}=context;assert.equal(contextHash,hash(body));assert.equal(context.failedReceiptHash,x.receipt.receiptHash);assert.equal(context.operationId,operationId);
  if(http){await locker.query('begin');await locker.query('select 1 from public.businesses where id=$1 for update',[x.f.businessId]);try{const blocked=await request('r12_etsy_steel_recovery_server',rec('record',{...x.pins,usage:x.usage}));assert.equal(blocked.ok,false);assert.equal(blocked.data.code,'57014');assert.ok(blocked.elapsedMs>=2800&&blocked.elapsedMs<5000);}finally{await locker.query('rollback');}assert.deepEqual(await counts(db),before,'Role deadline must roll back all recovery writes');}
  const missing=await checked('r12_etsy_steel_recovery_server',rec('record',{...x.pins,usage:{...x.usage,durationMs:null}}));assert.equal(missing.status,'unknown');assert.equal(missing.testExposure.hasUnknownOrUnbounded,true);
  const recovered=await checked('r12_etsy_steel_recovery_server',rec('record',{...x.pins,usage:x.usage}));assert.equal(recovered.status,'qualified_bounded_pending');assert.equal(recovered.testExposure.knownActualMicrounits,'0');assert.equal(recovered.testExposure.boundedPendingMicrounits,'1000');assert.equal(recovered.testExposure.hasUnknownOrUnbounded,false);assert.deepEqual(await checked('r12_etsy_steel_recovery_server',rec('record',{...x.pins,usage:x.usage})),recovered);
  await publishInertRepairRelease(db,x);
  const proposal=await checked('r12_owner_steel_replacement',own('prepare',{operationId,recoveryHash:recovered.recoveryHash,submissionId:randomUUID()}),{role:'authenticated'}),p=proposal.proposal;assert.equal(p.originalMaximumUnits,9);assert.equal(p.remainingResearchUnits,8);const{proposalHash,...proposalBody}=p;assert.equal(proposalHash,hash(proposalBody));
  const confirmation={proposalId:p.proposalId,proposalHash,submissionId:randomUUID()},confirmed=await checked('r12_owner_steel_replacement',own('confirm',confirmation),{role:'authenticated'});assert.equal(confirmed.confirmed,true);assert.deepEqual(await checked('r12_owner_steel_replacement',own('confirm',confirmation),{role:'authenticated'}),confirmed);assert.deepEqual(await checked('r12_owner_steel_replacement',own('read',{operationId}),{role:'authenticated'}),confirmed);
  assert.match((await request('r12_owner_steel_replacement',own('prepare',{operationId,recoveryHash:recovered.recoveryHash,submissionId:randomUUID()}),{role:'authenticated'})).data.message,/already_used/);
  const after=await counts(db);assert.equal(after.proofs,1);assert.equal(after.debits,1);for(const k of ['reservations','markers','config_uses'])assert.equal(after[k],before[k]);assert.equal((await one(db,'select private.r12_direct_research_unit_limit($1) n',[x.authority.prepared.testEnvelopeId])).n,8);assert.deepEqual((await one(db,'select receipt from private.r12_etsy_steel_receipts where receipt_hash=$1',[x.receipt.receiptHash])).receipt,oldReceipt);
  for(const [name,ops] of [['r12_etsy_steel_recovery_server',['inputs','record']],['r12_owner_steel_replacement',['read','prepare','confirm']]])for(const op of ops)assert.ok(report.trials.some(r=>r.rpc===name&&r.operation===op&&r.status===200),`Actual ${http?'HTTP':'dry SQL'} coverage required: ${name}/${op}`);
  assert.equal(report.externalProviderCalls,0);report.httpQualified=http;report.passed=true;
 }finally{globalThis.fetch=savedFetch;try{await locker?.end();await server?.close();await restoreRoles?.();await db?.close();}finally{if(process.env.R12_HTTP_REPORT){const path=resolve(process.env.R12_HTTP_REPORT);assert.ok(path.startsWith('/tmp/r12-http-'));writeFileSync(path,JSON.stringify(report,null,2)+'\n');}console.log('Setup recovery HTTP qualification:',JSON.stringify(report));}}
});
