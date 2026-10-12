import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {validateOwnerInitialRaceEnvironment} from './r12-owner-initial-postgres-races.mjs';
import {setupRecoveryFixture} from './r12-steel-setup-recovery-fixture.mjs';
import {podSqlFixture,podQuoteFixture,podPlannerPreflight,podRpc,podOne,podHash,podSource} from './r12-pod-sql-fixture.mjs';
export async function historicalPodActivate(db){
 const x=await setupRecoveryFixture(db),business=x.f.businessId;
 await x.stop();const recovered=await x.recovery('record',{...x.pins,usage:x.usage});assert.equal(recovered.status,'qualified_bounded_pending');
 const catalog=await podSqlFixture(db),content=structuredClone(catalog.content);
 const goal=await x.f.rpc('r04_quest_transition',[business,'quest.save',{goalId:null,expectedRevision:0,content},randomUUID()]);
 await x.f.rpc('r04_quest_transition',[business,'quest.preference',{goalId:goal.id,expectedRevision:1,preference:'ready'},randomUUID()]);
 const finance=(await podOne(db,'select private.r12_pod_finance($1) finance',[business])).finance,quote=podQuoteFixture();
 const owner=(op,payload)=>podRpc(db,'authenticated',x.f.ownerId,'r12_pod_owner_server',[business,op,payload,catalog.bootstrapKey]);
 const input={...catalog.input,businessId:business,goalId:goal.id,submissionId:randomUUID(),businessLifetimeLimitMicrounits:String(BigInt(finance.maximumMicrounits)>BigInt(finance.committedMicrounits)+10000000n?BigInt(finance.maximumMicrounits):BigInt(finance.committedMicrounits)+10000000n)};
 const prepared=await owner('prepare',{input,quote});Object.defineProperty(prepared,'_preflight',{value:{quote,receipt:await podPlannerPreflight(prepared,quote)}});
 const activated=await owner('confirm',catalog.confirmPayload(prepared));
 const f={...catalog,businessId:business,goalId:goal.id,ownerId:x.f.ownerId,input,server:owner,read:()=>podRpc(db,'authenticated',x.f.ownerId,'r12_pod_research_read',[business,goal.id,null])};
 const controller='inert-pod-controller-'+prepared.scopeId,admission='inert-pod-admission-'+prepared.scopeId,lease='inert-pod-controller-lease-'+prepared.scopeId;
 const command=(operation,payload,epoch=null)=>podRpc(db,'anon',null,'r07_controller',[f.businessId,f.goalId,operation,payload,randomUUID(),controller,lease,epoch,admission]);
 const authority=await podOne(db,"select a.plan,p.payload->'operations' operations from private.r12_discovery_authorities a join private.r12_pod_setups s on s.scope_id=a.scope_id join private.r05_policies p on p.id=s.policy_id where a.scope_id=$1",[prepared.scopeId]);
 await command('plan',{plan:authority.plan,expectedVersion:0,reason:'Inert historical-business POD diagnostic',evidenceHash:'7'.repeat(64)});
 const pass=(operation,payload={})=>podRpc(db,'anon',null,'r12_pod_pass_server',[f.businessId,prepared.scopeId,operation,payload,controller]);
 const store={read:()=>command('read',{}),readAdaptiveAction:()=>pass('context'),command:(op,payload,epoch)=>op==='adaptive_complete_action'?pass('complete',payload):command(op,['schedule','reserve'].includes(op)?{...payload,runtimeCapability:'inert-pod-runtime-'+prepared.scopeId}:payload,epoch)};
 const inputs=attemptId=>podRpc(db,'anon',null,'r12_discovery_server',[f.businessId,attemptId,'inputs',{},controller]);
 return{f,prepared,activated,controller,admission,lease,command,store,inputs,pass,operations:authority.operations,plan:authority.plan,scope:(await podOne(db,'select amendment from private.r12_discovery_scopes where id=$1',[prepared.scopeId])).amendment};
}

export async function seedPodDiagnosticHistory(db,a){
 for(let i=0;i<23;i++){
  const w=randomUUID(),r=randomUUID(),key='diagnostic-settled-history:'+r;
  await db.query("insert into public.workflow_runs(id,business_id,workflow_definition_id,idempotency_key,status,input) values($1,$2,$3,$4,'completed',$5)",[w,a.f.businessId,a.plan.steps[0].workflowDefinitionId,key,{syntheticDiagnosticHistory:true}]);
  const policy=(await podOne(db,'select policy_id from private.r12_pod_setups where scope_id=$1',[a.scope.id])).policy_id;
  await db.query('insert into private.r05_requests(id,business_id,workflow_run_id,policy_id,idempotency_key,request_hash,payload,source_key,currency,liability_microunits) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[r,a.f.businessId,w,policy,key,podHash({syntheticDiagnosticHistory:i}),{operationKey:'diagnostic.synthetic.settled-history',accounting:{kind:'r05'}},key,'USD',1]);
  await db.query('insert into private.r05_reservations(request_id,business_id) values($1,$2)',[r,a.f.businessId]);
  if(i<22){
   await db.query('insert into private.r05_markers(request_id,business_id) values($1,$2)',[r,a.f.businessId]);
   for(let n=0;n<(i<12?2:1);n++)await db.query('insert into private.r05_settlements(request_id,business_id,currency,actual_microunits,provider_request_id,receipt_hash) values($1,$2,$3,1,$4,$5)',[r,a.f.businessId,'USD','inert-history-'+r,podHash({syntheticDiagnosticHistory:i,revision:n})]);
  }else await db.query('insert into private.r05_releases(request_id,business_id,evidence_hash) values($1,$2,$3)',[r,a.f.businessId,podHash({syntheticUnsent:r})]);
 }

}

export async function preparePodDispatchProfile(db){
 const fixtureDb={exec:(...args)=>db.exec(...args),query:async(sql,args)=>{
  if(sql.startsWith('insert into private.r12_pod_templates(')){
   args=[...args];args[2]={...args[2],excludedDomains:['etsy.com','etsy.me','etsystatic.com','nrf.com','printify.com','printifyapp.com']};args[3]=podHash(args[2]);
  }
  return db.query(sql,args);
 }};
 const a=await historicalPodActivate(fixtureDb);await seedPodDiagnosticHistory(db,a);
 await a.pass('admit',{quote:podQuoteFixture()});const action=await a.pass('context'),claim=await a.command('claim',{seconds:120}),attemptId=randomUUID();
 await a.store.command('schedule',{stepKey:'plan',attemptId,actionHash:action.actionHash,actionOrdinal:action.ordinal,reason:'Inert first planner dispatch profile',evidenceHash:'8'.repeat(64)},claim.epoch);
 let snapshot=await a.store.read();const context=()=>({planId:snapshot.planId,planHash:snapshot.planHash,plan:snapshot.plan,attempt:snapshot.attempts.find(a=>a.id===attemptId),step:snapshot.plan.steps[0],knowledge:snapshot.knowledge});
 const runtime=podSource('products/discovery-r12-runtime'),step=context().step;
 const adapter=podSource('products/discovery-r12-adapter').createDiscoveryR12QuestAdapter({scope:a.scope,phase:'plan',identity:{qualificationHash:step.qualificationHash,workflowDefinitionId:step.workflowDefinitionId,workerDefinitionId:step.workerDefinitionId,mode:'qualification'},
  executingRelease:{version:'r12.executing-release.1',repository:'SSB100/agent-labs',environment:'production',commitSha:'a'.repeat(40),deploymentId:'dpl_inert_dispatch_profile'},
  dataClasses:a.operations.find(o=>o.operationKey===step.operationKey).dataClasses,
  store:{operation:(id,op,payload)=>podRpc(db,'anon',null,'r12_discovery_server',[a.f.businessId,id,op,payload,a.controller])},
  request:async ctx=>runtime.buildDiscoveryR12PhaseRequest(ctx,runtime.readDiscoveryR12PhaseInputs(ctx,await a.inputs(ctx.attempt.id))),quote:async()=>podQuoteFixture(),
  config:{apiKey:'inert-no-network',baseUrl:'https://openrouter.ai/api/v1',appUrl:'https://agent-labs-two.vercel.app',appName:'Agent Labs'},
  fetcher:async()=>{throw Error('No provider transport permitted in POD dispatch profiling');},
 });
 const call=await adapter.prepare(context());await a.store.command('reserve',{attemptId,descriptor:call.descriptor},claim.epoch);
 snapshot=await a.store.read();await adapter.prepare(context());
 return{...a,attempt:context().attempt};
}

const counters=async db=>Object.fromEntries((await db.query("select schemaname||'.'||funcname name,calls,total_time,self_time from pg_stat_xact_user_functions where schemaname in ('private','public')")).rows.map(r=>[r.name,{calls:Number(r.calls),totalMs:Number(r.total_time),selfMs:Number(r.self_time)}]));
const delta=(before,after)=>Object.fromEntries(Object.entries(after).map(([name,r])=>[name,{calls:r.calls-(before[name]?.calls??0),totalMs:+(r.totalMs-(before[name]?.totalMs??0)).toFixed(3),selfMs:+(r.selfMs-(before[name]?.selfMs??0)).toFixed(3)}]).filter(([,r])=>r.calls));

/** Invoke after the existing native suite migrated its guarded isolated DB.
 * Synthetic history is scoped to a fresh fixture Business. It is not a replay
 * of private production rows, a paid operation, or proof of live performance. */
export async function exercisePodDispatchProfile(db,{native=false}={}){
 const root=fileURLToPath(new URL('../../',import.meta.url));
 const migrationSql=readFileSync(root+'/supabase/migrations/20261012084203_r12_pod_scope_projection_cost.sql','utf8');
 const signature='private.r12_pod_scope_resolve(private.r12_discovery_scopes,timestamp with time zone,boolean)';
 if(native){const target=validateOwnerInitialRaceEnvironment(process.env);assert.deepEqual(await podOne(db,'select current_user role,current_database() db,host(inet_server_addr()) host'),{role:'r12_test',db:'r12_test',host:target.address});}
 const candidate=(await podOne(db,'select pg_get_functiondef($1::regprocedure) definition',[signature])).definition;
 const projection="return jsonb_build_object('setupId',setup.id,'policyId',setup.policy_id,'templateId',t.id,'pins',t.pins);";
 assert.equal(candidate.split(projection).length,2);assert.equal(candidate.includes("'finance',private.r12_pod_finance(s.business_id)"),false);
 // Reconstruct only the superseded return projection inside trial savepoints;
 // all authorization/financial guard bodies remain byte-identical.
 const original=candidate.replace(projection,projection.replace(');',",'finance',private.r12_pod_finance(s.business_id));"));
 const report={version:'r12.pod-dispatch-profile.1',engine:native?'native-postgresql':'PGlite',nativeDeadlineQualified:false,providerCalls:0,migrationSha256:createHash('sha256').update(migrationSql).digest('hex'),trials:[],guards:[],syntheticHistory:true};
 const oldFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('All external HTTP forbidden in isolated POD dispatch profiling');};
 try{
  const a=await preparePodDispatchProfile(db),attempt=a.attempt,foreignOwner=randomUUID();
  await db.query('insert into auth.users(id,email) values($1,$2)',[foreignOwner,foreignOwner+'@example.invalid']);
  report.shape=await podOne(db,`select octet_length(t.pins::text) pins_bytes,octet_length(t.source_policy::text) source_policy_bytes,(select count(*)::int from private.r05_requests where business_id=s.business_id) requests,(select count(*)::int from private.r05_markers where business_id=s.business_id) markers,(select count(*)::int from private.r05_settlements where business_id=s.business_id) settlements,(select count(*)::int from private.r12_direct_browser_operations o join private.r12_direct_test_envelopes e on e.id=o.envelope_id where e.business_id=s.business_id) direct_browser_operations from private.r12_discovery_scopes s join private.r12_pod_setups u on u.id=s.pod_setup_id join private.r12_pod_templates t on t.id=u.template_id where s.id=$1`,[a.scope.id]);
  assert.deepEqual(report.shape,{pins_bytes:27731,source_policy_bytes:919,requests:30,markers:28,settlements:44,direct_browser_operations:1});
  const fingerprint=()=>podOne(db,`select (select count(*)::int from private.r05_markers where request_id=$1) admission_markers,(select count(*)::int from private.r07_markers where attempt_id=$2) controller_markers,(select count(*)::int from private.r12_discovery_transport_claims where request_id=$1) transport_claims,(select status from private.r07_attempts where id=$2) attempt_status,private.r12_pod_finance($3) finance`,[attempt.requestId,attempt.id,a.f.businessId]);
  const initial=await fingerprint();assert.equal(initial.finance.hasUnknown,true);assert.equal(initial.finance.hasBlockingUnknown,false);assert.equal(initial.finance.boundedPendingMicrounits,'1000');
  assert.equal(initial.admission_markers,0);assert.equal(initial.controller_markers,0);assert.equal(initial.transport_claims,0);assert.equal(initial.attempt_status,'reserved');
  await db.exec("begin;set local track_functions='all'");
  try{
   const trial=async(label,definition,mutate=null)=>{
    await db.exec('savepoint pod_profile');let outcome,before;
    try{
     await db.exec("set local statement_timeout='30s'");await db.exec(definition);if(label.endsWith('_cold'))await db.exec('discard plans');
     const claim=await a.command('claim',{seconds:120});if(mutate)await mutate();
     await db.exec("set local statement_timeout='3s';set local role anon");
     assert.deepEqual(await podOne(db,"select current_user actor,current_setting('statement_timeout') timeout"),{actor:'anon',timeout:'3s'});
     before=await counters(db);const start=performance.now();
     try{const row=await podOne(db,'select public.r07_controller($1,$2,$3,$4,$5,$6,$7,$8,$9) result',[a.f.businessId,a.f.goalId,'dispatch',{attemptId:attempt.id,wireHash:attempt.wireHash},randomUUID(),a.controller,a.lease,claim.epoch,a.admission]);outcome={label,result:row.result,elapsedMs:Math.round(performance.now()-start)};}
     catch(error){outcome={label,error:error.message,sqlState:error.code,where:error.where,elapsedMs:Math.round(performance.now()-start)};}
    }finally{await db.exec('rollback to savepoint pod_profile');await db.exec('release savepoint pod_profile');}
    outcome.functions=delta(before,await counters(db));assert.deepEqual(await fingerprint(),initial,'Every trial restores reservations, markers, transport claims, attempt and all financial exposure');
    report.trials.push(outcome);return outcome;
   };
   for(const [label,definition]of [['original_cold',original],['original_warm',original],['candidate_cold',candidate],['candidate_warm',candidate]]){
    const result=await trial(label,definition);
    if(result.error){assert.ok(native&&label.startsWith('original'));assert.equal(result.sqlState,'57014',result.error);continue;}
    assert.equal(result.result.shouldDispatch,true);assert.equal(result.functions['private.r12_pod_scope_resolve'].calls,16);assert.equal(result.functions['private.r12_discovery_scope_current'].calls,7);assert.equal(result.functions['private.r07_gate'].calls,3);assert.equal(result.functions['private.r12_pod_financial_guard'].calls,2);assert.equal(result.functions['private.r12_pod_template_check'].calls,16);
    assert.equal(result.functions['private.r12_pod_finance'].calls,label.startsWith('candidate')?2:18);
    if(native)assert.ok(result.elapsedMs<3000,'Successful measured dispatch stays within ordinary anon 3s deadline');
   }
   const success=report.trials.filter(t=>t.result);for(const t of success)assert.deepEqual(t.result,success[0].result,'Original and candidate dispatch decisions are exactly equal');
   const denied=async(label,mutate)=>{const t=await trial(label,candidate,mutate);
    assert.notEqual(t.sqlState,'57014','A timeout cannot prove an authorization guard');
    if(label==='owner_changed'){
     assert.equal(t.sqlState,'P0001');assert.equal(t.error,'r12_exact_scoped_controller_authority_required');
    }else{
     assert.equal(t.error,undefined,t.error);assert.deepEqual(t.result,{reason:'discovery_scope_unavailable',decision:'blocked',replayed:false,shouldDispatch:false});
    }
    report.guards.push(label);
   };
   await denied('owner_changed',()=>db.query('update public.businesses set owner_user_id=$1 where id=$2',[foreignOwner,a.f.businessId]));
   await denied('stopped',()=>a.f.server('stop',{setupId:a.prepared.setupId,setupHash:a.prepared.setupHash,submissionId:randomUUID()}));
   await denied('template_revoked',()=>db.query('insert into private.r12_pod_template_revocations(template_id,reason) values($1,$2)',[a.f.templateId,'Inert negative dispatch-profile test']));
   report.guards.push('sixteen_scope_checks','seven_outer_scope_checks','three_gate_checks','two_financial_guards','bounded_historical_unknown_preserved','financial_and_transport_trial_rollback');
  }finally{await db.exec('rollback');}
  assert.equal((await podOne(db,'select pg_get_functiondef($1::regprocedure) definition',[signature])).definition,candidate);
  // Require a positively observed native cancellation; PGlite is never reported
  // as timing qualification even when elapsed execution happens below 3s.
  if(native){const prior=(await podOne(db,"select current_setting('statement_timeout') value")).value;try{await db.exec("set statement_timeout='3s'");await assert.rejects(db.query('select pg_sleep(3.2)'),error=>error.code==='57014');report.nativeDeadlineQualified=true;}finally{await db.query("select set_config('statement_timeout',$1,false)",[prior]);}}
  assert.equal(network,0);report.passed=true;return report;
 }finally{globalThis.fetch=oldFetch;console.log('POD dispatch profile:',JSON.stringify(report));if(process.env.R12_POD_PROFILE_REPORT){const destination=path.resolve(process.env.R12_POD_PROFILE_REPORT);assert.ok(destination.startsWith('/tmp/r12-pod-profile-'));writeFileSync(destination,JSON.stringify(report,null,2)+'\n');}}
}
