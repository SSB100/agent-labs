import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
import {RESEARCH_OWNER,RESEARCH_OTHER,RESEARCH_SESSION,RESEARCH_KEY,authenticate,setupResearchFixture,seedResearch,hash,sha,value,guard,settle,revoke,financial} from './helpers/r11-public-research-fixture.mjs';
import {REPAIR_REASONS,REPAIR_PROVIDER_ERRORS,researchV2,repairWorkspace,repairStop,repairGuard,repairSettle,repairObservation,emptyRepairObservation,repairFailure,repairFail,repairCollect,prepareRepairCompletion,prepareRepairSelectorCompletion,repairPolicy,workflowStatus,r05FunctionSnapshot,repairStateSnapshot,setupContinuationFixture,seedContinuationPredecessor,seedContinuationGrant,importContinuationGrant,repairContinue,activateContinuation,continuationStateSnapshot,repairAdmission,addRepairExposure} from './helpers/r11-public-research-repair-fixture.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),host=process.env.R11_SQL_TEST_HOST;
const reject=/r11_|r05_|r04_|invalid input syntax|violates check constraint|duplicate key|permission denied|not-null constraint/;
const tableSnapshot="select tablename from pg_tables where schemaname='private' and tablename like 'r11_research_%' order by 1";
async function allR05Rows(db){const result={};for(const {tablename} of (await db.query("select tablename from pg_tables where schemaname='private' and tablename like 'r05_%' order by 1")).rows)result[tablename]=(await db.query(`select to_jsonb(t) row from private.${tablename} t order by to_jsonb(t)::text`)).rows;return result;}

// This suite creates an in-memory isolated database only. It cannot select a remote database.
test('R11 additive repair preserves R05 and records truthful terminal outcomes',{skip:!host,timeout:120000},async t=>{
 const require=createRequire(path.resolve(host,'package.json')),{PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
 const db=new PGlite({extensions:{pgcrypto}});let foundRepair=false,newTables=[],oldRows,oldFunctions;
 try{
  await db.exec(r04SqlBootstrap+sessionBootstrap);
  for(const name of readdirSync(path.join(root,'supabase/migrations')).filter(name=>name.endsWith('.sql')).sort()){
   const source=readFileSync(path.join(root,'supabase/migrations',name),'utf8');
   if(/function public\.r11_research_server_v2\(/.test(source)){
    assert.equal(foundRepair,false,'Only one initial repair migration is expected');foundRepair=true;
    await setupResearchFixture(db);
    const existing=await seedResearch(db),marked=await guard(db,existing);await settle(db,existing,marked.requestId,'inert-pre-repair-receipt');
    oldRows=await allR05Rows(db);oldFunctions=(await db.query(r05FunctionSnapshot)).rows;
    const beforeTables=(await db.query(tableSnapshot)).rows;
    assert.match(source,/commit;\s*$/i);
    await assert.rejects(db.exec(source.replace(/commit;\s*$/i,()=>"do $$ begin raise exception 'r11_repair_rollback_probe';end $$;commit;")),/r11_repair_rollback_probe/);await db.exec('rollback');
    assert.deepEqual((await db.query(r05FunctionSnapshot)).rows,oldFunctions);assert.deepEqual(await allR05Rows(db),oldRows);assert.deepEqual((await db.query(tableSnapshot)).rows,beforeTables);
    await db.exec(source);
    newTables=(await db.query(tableSnapshot)).rows.map(row=>row.tablename).filter(name=>!beforeTables.some(row=>row.tablename===name));
   }else await db.exec(source);
  }
  assert.equal(foundRepair,true,'The additive repair migration must exist');
  assert.deepEqual((await db.query(r05FunctionSnapshot)).rows,oldFunctions,'Every R05 function definition and ACL must remain byte-identical');
  assert.deepEqual(await allR05Rows(db),oldRows,'Repair migration must not change, replace or seed any R05 row');
  async function noEffects(s,fn){const before=await repairStateSnapshot(db,s);await assert.rejects(fn(),reject);assert.deepEqual(await repairStateSnapshot(db,s),before);}
  await t.test('new immutable tables and private functions are closed; public wrappers expose only intended roles',async()=>{
   assert.ok(newTables.length>=3,'Repair must persist outcomes, continuation authority and exact phase mappings');
   for(const table of newTables){
    assert.equal(await value(db,`select count(*)::int result from private.${table}`),0,'Definitions-only repair must not mint authority or outcomes');
    for(const role of ['anon','authenticated','service_role'])for(const permission of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal(await value(db,'select has_table_privilege($1,$2,$3) result',[role,`private.${table}`,permission]),false,`${role} ${permission} ${table}`);
   }
   for(const {signature} of (await db.query("select p.oid::regprocedure::text signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'r11_research_%'")).rows)for(const role of ['anon','authenticated','service_role'])assert.equal(await value(db,"select has_function_privilege($1,$2,'EXECUTE') result",[role,signature]),false);
   for(const fn of ['r11_research_stop_v2(uuid,uuid)','r11_research_continue(uuid,uuid,text)','r11_research_workspace_v2(uuid)'])for(const role of ['anon','authenticated','service_role'])assert.equal(await value(db,"select has_function_privilege($1,$2,'EXECUTE') result",[role,`public.${fn}`]),role==='authenticated',`${role} ${fn}`);
   for(const role of ['anon','authenticated','service_role'])assert.equal(await value(db,"select has_function_privilege($1,'public.r11_research_server_v2(uuid,text,jsonb,text)','EXECUTE') result",[role]),role==='anon');
  });
  await t.test('legacy load gains explicit attempt version and immutable operation descriptors',async()=>{
   const s=await seedResearch(db),loaded=await researchV2(db,s,'load',{policyId:s.policy.id});
   assert.equal(loaded.attemptVersion,1);assert.deepEqual(loaded.operationKeys,{search:'research.search',select:'research.model'});assert.deepEqual(loaded.policy,s.policy);
   const workspace=await repairWorkspace(db,s),policy=workspace.policies.find(p=>p.policyId===s.policy.id);assert.equal(policy.attemptVersion,1);assert.deepEqual(policy.outcomes,[]);assert.deepEqual(workspace.continuationGrants,[]);
   assert.equal(JSON.stringify(workspace).includes(RESEARCH_KEY),false);
   await noEffects(s,()=>researchV2(db,s,'load',{policyId:s.policy.id},'wrong'));
   for(const operation of [null,'invented'])await noEffects(s,()=>researchV2(db,s,operation,{policyId:s.policy.id}));
  });
  await t.test('request-bound failure atomically records immutable outcome, source revocation and needs_owner',async()=>{
   const s=await seedResearch(db),marked=await repairGuard(db,s),receipt=`inert-failed-search-${randomUUID()}`;await repairSettle(db,s,marked.requestId,receipt,'20');
   const payload=repairFailure(s,'search',marked.requestId,{reason:'source_contract_invalid',observation:repairObservation(s,{annotationCount:0,approvedDomainCounts:s.policy.allowedDomains.map(domain=>({domain,count:0}))})}),before=await repairStateSnapshot(db,s),saved=await repairFail(db,s,payload);
   assert.ok(saved.outcomeId);assert.equal(saved.recorded,true);assert.equal(saved.replayed,false);assert.equal(saved.workflowStatus,'needs_owner');assert.equal(await workflowStatus(db,s),'needs_owner');
   assert.equal(await value(db,'select count(*)::int result from private.r11_research_revocations where policy_id=$1',[s.policy.id]),1);
   const after=await repairStateSnapshot(db,s);for(const table of ['r05_requests','r05_reservations','r05_markers','r05_settlements','r05_receipt_claims','r11_research_bindings','r11_research_collections'])assert.deepEqual(after[table],before[table],`Failure must preserve ${table}`);
   const replay=await repairFail(db,s,payload);assert.equal(replay.outcomeId,saved.outcomeId);assert.equal(replay.replayed,true);
   const policy=await repairPolicy(db,s);assert.equal(policy.outcomes.length,1);assert.equal(policy.outcomes[0].outcomeId,saved.outcomeId);assert.equal(policy.outcomes[0].reason,payload.reason);assert.deepEqual(policy.outcomes[0].observation,payload.observation);
   await assert.rejects(db.query('delete from private.r11_research_outcomes where id=$1',[saved.outcomeId]),/immutable/);await assert.rejects(db.query("update private.r11_research_outcomes set reason='internal_failure' where id=$1",[saved.outcomeId]),/immutable/);
   await noEffects(s,()=>repairFail(db,s,{...payload,reason:'provider_response_invalid'}));await noEffects(s,()=>repairFail(db,s,{...payload,observation:repairObservation(s)}));await noEffects(s,()=>repairGuard(db,s));
  });
  await t.test('all bounded failure reasons and provider categories can be recorded without arbitrary text',async()=>{
   for(const reason of REPAIR_REASONS){const s=await seedResearch(db),marked=await repairGuard(db,s),payload=repairFailure(s,'search',marked.requestId,{reason,observation:repairObservation(s)});assert.equal((await repairFail(db,s,payload)).recorded,true);}
   for(const providerError of REPAIR_PROVIDER_ERRORS){const s=await seedResearch(db),payload=repairFailure(s,'none',null,{observation:emptyRepairObservation()});payload.observation.providerError=providerError;assert.equal((await repairFail(db,s,payload)).recorded,true);}
  });
  await t.test('reviewed canonical model and categorical absence retain bounded honest observations',async()=>{
   const exact=await seedResearch(db,{policyOverrides:{modelId:'openai/gpt-5.6-luna'}}),observed=repairObservation(exact,{modelIdentity:'canonical',observedModelId:'openai/gpt-5.6-luna-20260709'});assert.equal((await repairFail(db,exact,repairFailure(exact,'none',null,{observation:observed}))).recorded,true);
   const wrong=await seedResearch(db);await noEffects(wrong,()=>repairFail(db,wrong,repairFailure(wrong,'none',null,{observation:repairObservation(wrong,{modelIdentity:'canonical',observedModelId:'openai/gpt-5.6-luna-20260709'})})));
   for(const identity of ['other','missing','invalid']){const s=await seedResearch(db);assert.equal((await repairFail(db,s,repairFailure(s,'none',null,{observation:repairObservation(s,{modelIdentity:identity,observedModelId:null,providerIdentity:identity,observedProvider:null,searchRequests:null,annotationCount:null})}))).recorded,true);}
   for(const finishReason of ['stop','length','content_filter','tool_calls','error','other','missing']){const s=await seedResearch(db);assert.equal((await repairFail(db,s,repairFailure(s,'none',null,{observation:repairObservation(s,{finishReason})}))).recorded,true);}
   const absent=await seedResearch(db);assert.equal((await repairFail(db,absent,repairFailure(absent,'none',null,{observation:null}))).recorded,true);
  });
  await t.test('route diagnostics preserve legacy shape and reject partial, incoherent or raw observations',async()=>{
   const legacy=await seedResearch(db),legacyObservation=repairObservation(legacy);
   assert.equal(Object.keys(legacyObservation).length,11);
   assert.equal((await repairFail(db,legacy,repairFailure(legacy,'none',null,{observation:legacyObservation}))).recorded,true);
   assert.deepEqual((await repairPolicy(db,legacy)).outcomes[0].observation,legacyObservation);
   for(const inferenceRouteStatus of ['unrequested','verified','unavailable','invalid']){
    const s=await seedResearch(db),observation=repairObservation(s,{providerIdentity:'other',observedProvider:null,responseProviderHash:sha('PRIVATE_PROVIDER_LABEL_SENTINEL'),inferenceRouteStatus,inferenceRouteProofHash:inferenceRouteStatus==='verified'?sha('inert-normalized-route-proof'):null});
    assert.equal(Object.keys(observation).length,14);
    assert.equal((await repairFail(db,s,repairFailure(s,'none',null,{observation}))).recorded,true);
    const saved=(await repairPolicy(db,s)).outcomes[0].observation;assert.deepEqual(saved,observation);assert.doesNotMatch(JSON.stringify(saved),/PRIVATE_PROVIDER_LABEL_SENTINEL/);
   }
   const s=await seedResearch(db),base=repairObservation(s,{responseProviderHash:sha('Azure'),inferenceRouteStatus:'verified',inferenceRouteProofHash:sha('inert-normalized-route-proof')});
   const check=observation=>db.query('select private.r11_research_observation_validate(p,$2::jsonb) from private.r11_research_policies p where p.id=$1',[s.policy.id,observation]);
   await check(base);
   await check({...base,providerIdentity:'missing',observedProvider:null,responseProviderHash:null});
   await check({...base,providerIdentity:'other',observedProvider:null,responseProviderHash:null});
   const mutations=[o=>delete o.responseProviderHash,o=>delete o.inferenceRouteStatus,o=>delete o.inferenceRouteProofHash,
    o=>o.responseProviderHash='raw provider',o=>o.responseProviderHash=42,o=>o.responseProviderHash='A'.repeat(64),o=>o.responseProviderHash='a'.repeat(65),o=>o.responseProviderHash=null,
    o=>o.inferenceRouteStatus='unknown',o=>o.inferenceRouteStatus=null,o=>o.inferenceRouteStatus='unrequested',o=>o.inferenceRouteStatus='invalid',o=>o.inferenceRouteStatus='unavailable',
    o=>o.inferenceRouteProofHash=null,o=>o.inferenceRouteProofHash=42,o=>o.inferenceRouteProofHash='A'.repeat(64),o=>o.inferenceRouteProofHash='a'.repeat(63),
    o=>{o.providerIdentity='missing';o.observedProvider=null;},o=>o.rawProvider='PRIVATE',o=>o.routeProof={provider_name:'PRIVATE'},
    o=>o.annotationCount=0,o=>o.observedModelId='wrong/model',o=>o.observedProvider='Unknown provider',o=>o.providerError='PRIVATE_ERROR'];
   for(const mutate of mutations){const observation=structuredClone(base);mutate(observation);await assert.rejects(check(observation),reject);}
   for(const key of ['responseProviderHash','inferenceRouteStatus','inferenceRouteProofHash'])await assert.rejects(check({...repairObservation(s),[key]:base[key]}),reject);
   assert.deepEqual((await repairPolicy(db,s)).outcomes,[]);
  });
  await t.test('fail rejects malformed metadata, unsafe raw content, enum mismatches and unbounded counters atomically',async()=>{
   const s=await seedResearch(db),marked=await repairGuard(db,s),exact=repairFailure(s,'search',marked.requestId,{observation:repairObservation(s)});
   const mutations=[p=>p.extra='raw response',p=>p.reason='provider timed out with SECRET',p=>p.phase='selector',p=>p.observation=false,p=>p.observation.rawResponse='private',p=>p.observation.errorMessage='private',p=>p.observation.modelIdentity='canonical-but-unreviewed',p=>p.observation.observedModelId='other/model',p=>p.observation.providerIdentity='canonical',p=>p.observation.observedProvider='Other provider',p=>p.observation.finishReason='unsafe text',p=>p.observation.providerError='unsafe provider error',p=>p.observation.searchRequests=-1,p=>p.observation.searchRequests=1001,p=>p.observation.searchRequests=1.5,p=>p.observation.searchRequests='1',p=>p.observation.annotationCount=1001,p=>p.observation.rejectedDomainCount=-1,p=>p.observation.malformedAnnotationCount=1001,p=>p.observation.approvedDomainCounts=[{domain:'private.example',count:1}],p=>p.observation.approvedDomainCounts=[{domain:s.policy.allowedDomains[0],count:1001}],p=>p.observation.approvedDomainCounts=[{domain:s.policy.allowedDomains[0],count:1,url:'https://private.example/?token=private'}],p=>p.observation.approvedDomainCounts=[{domain:s.policy.allowedDomains[0],count:1},{domain:s.policy.allowedDomains[0],count:1}],p=>delete p.observation.finishReason];
   for(const mutate of mutations){const payload=structuredClone(exact);mutate(payload);await noEffects(s,()=>repairFail(db,s,payload));}
   for(const identity of ['other','missing','invalid'])await noEffects(s,()=>repairFail(db,s,{...exact,observation:repairObservation(s,{modelIdentity:identity})}));
   for(const identity of ['other','missing','invalid'])await noEffects(s,()=>repairFail(db,s,{...exact,observation:repairObservation(s,{providerIdentity:identity})}));
   assert.deepEqual((await repairPolicy(db,s)).outcomes,[]);assert.equal(await workflowStatus(db,s),'running');
  });
  await t.test('observation domain totals are bounded and agree with every nonnull annotation count',async()=>{
   const s=await seedResearch(db),marked=await repairGuard(db,s),exact=repairFailure(s,'search',marked.requestId,{observation:repairObservation(s)}),domains=counts=>s.policy.allowedDomains.map((domain,index)=>({domain,count:counts[index]}));
   const bad=[{annotationCount:0},{annotationCount:2},{annotationCount:1,rejectedDomainCount:1},{annotationCount:1,malformedAnnotationCount:1},{annotationCount:null,approvedDomainCounts:domains([600,401])},{annotationCount:1000,approvedDomainCounts:domains([600,400]),rejectedDomainCount:1},{annotationCount:null,approvedDomainCounts:domains([999,0]),rejectedDomainCount:1,malformedAnnotationCount:1},{annotationCount:null,approvedDomainCounts:domains([1000,1000]),rejectedDomainCount:1000,malformedAnnotationCount:1000}];
   for(const fields of bad)await noEffects(s,()=>repairFail(db,s,{...exact,observation:repairObservation(s,fields)}));assert.deepEqual((await repairPolicy(db,s)).outcomes,[]);
   for(const [counts,rejected,malformed,annotationCount] of [[[600,399],1,0,1000],[[0,0],500,500,1000],[[1000,0],0,0,null],[[0,0],0,0,0]]){
    const valid=await seedResearch(db),observation=repairObservation(valid,{annotationCount,approvedDomainCounts:valid.policy.allowedDomains.map((domain,index)=>({domain,count:counts[index]})),rejectedDomainCount:rejected,malformedAnnotationCount:malformed});assert.equal((await repairFail(db,valid,repairFailure(valid,'none',null,{observation}))).recorded,true);
   }
  });
  await t.test('fail is exact-policy, exact-phase, exact-request and exact-authority scoped',async()=>{
   const s=await seedResearch(db),other=await seedResearch(db),marked=await repairGuard(db,s),otherMarked=await repairGuard(db,other),payload=repairFailure(s,'search',marked.requestId,{observation:repairObservation(s)});
   for(const bad of [{...payload,policyId:other.policy.id},{...payload,requestId:otherMarked.requestId},{...payload,requestId:randomUUID()},{...payload,phase:'select'},{...payload,phase:'none',requestId:marked.requestId},{...payload,phase:'none',requestId:null}])await noEffects(s,()=>repairFail(db,s,bad));
   await noEffects(s,()=>repairFail(db,s,payload,'not-an-authority'));
   const wrongKey=`inert-wrong-repair-key-${randomUUID()}`;await db.query("insert into private.r05_server_keys values($1,clock_timestamp()+interval '1 hour')",[sha(wrongKey)]);await noEffects(s,()=>repairFail(db,s,payload,wrongKey));
   const empty=await seedResearch(db);await noEffects(empty,()=>repairFail(db,empty,repairFailure(empty,'search',randomUUID())));assert.equal((await repairFail(db,empty)).recorded,true);
  });
  await t.test('current actual owner session is required for Stop and workspace',async()=>{
   const s=await seedResearch(db),other=await seedResearch(db),before=await repairStateSnapshot(db,s);
   for(const [actor,session] of [[RESEARCH_OTHER,undefined],[RESEARCH_OWNER,randomUUID()]]){
    await authenticate(db,actor,session);for(const fn of [repairStop,repairWorkspace])await assert.rejects(fn(db,s),reject);
   }
   await authenticate(db);await db.query("update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=$1",[RESEARCH_SESSION]);
   try{for(const fn of [repairStop,repairWorkspace])await assert.rejects(fn(db,s),reject);}finally{await db.query('update auth.sessions set not_after=null where id=$1',[RESEARCH_SESSION]);}
   for(const fn of [repairStop])await assert.rejects(fn(db,{...other,policy:s.policy}),reject);
   assert.deepEqual(await repairStateSnapshot(db,s),before);
  });
  await t.test('Stop is idempotent, key-free and projects cancelled without losing prior receipts',async()=>{
   const s=await seedResearch(db),marked=await repairGuard(db,s);await repairSettle(db,s,marked.requestId,'inert-stop-receipt');const before=await repairStateSnapshot(db,s);
   await db.exec('set role authenticated');let stopped;try{stopped=await repairStop(db,s);}finally{await db.exec('reset role');}
   assert.equal(stopped.revoked,true);assert.ok(stopped.outcomeId);assert.equal(stopped.workflowStatus,'cancelled');assert.equal(await workflowStatus(db,s),'cancelled');
   const again=await repairStop(db,s);assert.equal(again.outcomeId,stopped.outcomeId);assert.equal((await repairPolicy(db,s)).outcomes.length,1);assert.equal((await repairPolicy(db,s)).outcomes[0].reason,'owner_stopped');
   const after=await repairStateSnapshot(db,s);assert.deepEqual(after.r05_settlements,before.r05_settlements);assert.deepEqual(after.r05_markers,before.r05_markers);await noEffects(s,()=>repairGuard(db,s));
  });
  await t.test('late completion persists valid evidence but cannot overwrite failed or cancelled workflow',async()=>{
   for(const terminal of ['needs_owner','cancelled']){
    const s=await seedResearch(db),ready=await prepareRepairCompletion(db,s);
    if(terminal==='needs_owner')await repairFail(db,s,repairFailure(s,'select',ready.selected.requestId,{reason:'result_persistence_failed',observation:repairObservation(s)}));else await repairStop(db,s);
    const saved=await researchV2(db,s,'complete',ready.completion);assert.ok(saved.resultId);assert.equal(await workflowStatus(db,s),terminal);assert.equal((await repairPolicy(db,s)).result.resultId,saved.resultId);
    assert.equal((await researchV2(db,s,'complete',ready.completion)).replayed,true);assert.equal(await workflowStatus(db,s),terminal);
   }
  });
  await t.test('completion committed before Stop remains completed with both result and owner-stop history',async()=>{
   const s=await seedResearch(db),ready=await prepareRepairCompletion(db,s),saved=await researchV2(db,s,'complete',ready.completion);
   assert.equal(await workflowStatus(db,s),'completed');await repairStop(db,s);assert.equal(await workflowStatus(db,s),'completed');const policy=await repairPolicy(db,s);assert.equal(policy.result.resultId,saved.resultId);assert.equal(policy.revoked,true);assert.equal(policy.outcomes.at(-1).reason,'owner_stopped');
  });
  await t.test('Stop reconciles historical revocation using database facts without inventing provider cause',async()=>{
   const expires=Date.now()+1000,failed=await seedResearch(db,{policyOverrides:{validUntil:new Date(expires).toISOString(),quoteValidUntil:new Date(expires).toISOString()}}),marked=await repairGuard(db,failed);await repairSettle(db,failed,marked.requestId,'inert-reconcile-receipt');await revoke(db,failed);await pause(Math.max(0,expires+20-Date.now()));
   const before=await repairPolicy(db,failed);assert.equal(before.terminalReconciliationRequired,true);
   const recorded=await repairStop(db,failed);assert.ok(recorded.outcomeId);const events=(await repairPolicy(db,failed)).outcomes;assert.ok(events.some(event=>event.reason==='legacy_failure_undetermined'));assert.equal(await workflowStatus(db,failed),'cancelled');assert.equal((await repairStop(db,failed)).outcomeId,recorded.outcomeId);
   const stopped=await seedResearch(db);await revoke(db,stopped);await repairStop(db,stopped);assert.equal((await repairPolicy(db,stopped)).outcomes[0].reason,'owner_stopped');assert.equal(await workflowStatus(db,stopped),'cancelled');
   for(const s of [failed,stopped])for(const event of (await repairPolicy(db,s)).outcomes)assert.equal(event.observation,null,'No observed response metadata can be inferred from accounting rows');
  });
  await t.test('lost or duplicate admission response cannot terminalize another owned invocation',async()=>{
   const s=await seedResearch(db),ready=await prepareRepairCompletion(db,s),before=await repairStateSnapshot(db,s);
   for(const phase of ['search','select'])await noEffects(s,()=>repairFail(db,s,repairFailure(s,phase,null,{observation:repairObservation(s)})));
   assert.deepEqual(await repairStateSnapshot(db,s),before);assert.deepEqual((await repairPolicy(db,s)).outcomes,[]);assert.equal(await workflowStatus(db,s),'running');
   const completed=await researchV2(db,s,'complete',ready.completion);assert.ok(completed.resultId);assert.equal(await workflowStatus(db,s),'completed');assert.deepEqual((await repairPolicy(db,s)).outcomes,[]);
  });
  await t.test('lost collect reply cannot terminalize a durably progressed selector invocation',async()=>{
   for(const stage of ['collection_committed','selector_admitted','selector_completed']){
    const original=await seedResearch(db);let collected;
    await assert.rejects(async()=>{collected=await repairCollect(db,original);throw Error('inert collect reply lost after durable commit');},/reply lost after durable commit/);
    const observer={...original},loaded=await researchV2(db,observer,'load',{policyId:observer.policy.id});assert.equal(loaded.collection.id,collected.result.collectionId);
    let ready;if(stage!=='collection_committed')ready=await prepareRepairSelectorCompletion(db,observer,collected);
    if(stage==='selector_completed')await researchV2(db,observer,'complete',ready.completion);
    const expectedStatus=stage==='selector_completed'?'completed':'running',before=await repairStateSnapshot(db,original),response=await repairFail(db,original,repairFailure(original,'search',collected.marked.requestId,{reason:'collection_persistence_failed',observation:repairObservation(original)}));
    assert.deepEqual(response,{outcomeId:null,recorded:false,replayed:false,superseded:true,reason:'phase_progressed',workflowStatus:expectedStatus});assert.deepEqual(await repairStateSnapshot(db,original),before);assert.deepEqual((await repairPolicy(db,original)).outcomes,[]);assert.equal((await repairPolicy(db,original)).revoked,false);
    assert.deepEqual(await repairFail(db,original,repairFailure(original,'search',collected.marked.requestId,{reason:'collection_persistence_failed',observation:repairObservation(original)})),response);assert.deepEqual(await repairStateSnapshot(db,original),before);
    if(!ready)ready=await prepareRepairSelectorCompletion(db,observer,collected);
    const result=await researchV2(db,observer,'complete',ready.completion);assert.ok(result.resultId);assert.equal(result.replayed,stage==='selector_completed');assert.equal(await workflowStatus(db,observer),'completed');assert.deepEqual((await repairPolicy(db,observer)).outcomes,[]);assert.equal((await repairPolicy(db,observer)).revoked,false);
   }
  });
  await t.test('failure arriving after committed completion explicitly returns nonmutating superseded status',async()=>{
   const s=await seedResearch(db),ready=await prepareRepairCompletion(db,s);await researchV2(db,s,'complete',ready.completion);const before=await repairStateSnapshot(db,s);
   for(const [phase,requestId] of [['search',ready.marked.requestId],['select',ready.selected.requestId]]){
    const response=await repairFail(db,s,repairFailure(s,phase,requestId,{reason:'internal_failure',observation:repairObservation(s)}));assert.deepEqual(response,{outcomeId:null,recorded:false,replayed:false,superseded:true,reason:'phase_progressed',workflowStatus:'completed'});assert.deepEqual(await repairStateSnapshot(db,s),before);assert.deepEqual((await repairPolicy(db,s)).outcomes,[]);
   }
  });
  await t.test('late failure preserves settled accounting; expired or revoked keys cannot invent outcomes',async()=>{
   const s=await seedResearch(db),key=`inert-short-repair-authority-${randomUUID()}`;s.serverKey=key;
   await db.query("insert into private.r05_server_keys values($1,clock_timestamp()+interval '1 hour')",[sha(key)]);
   const marked=await repairGuard(db,s);await repairSettle(db,s,marked.requestId,'inert-key-revoked-receipt');await db.query('insert into private.r05_server_revocations(key_hash) values($1)',[sha(key)]);
   await noEffects(s,()=>repairFail(db,s,repairFailure(s,'search',marked.requestId)));assert.equal((await repairStateSnapshot(db,s)).r05_settlements.length,1);
   const expired=await seedResearch(db),expiredKey=`inert-expired-repair-authority-${randomUUID()}`;await db.query("insert into private.r05_server_keys values($1,clock_timestamp()-interval '1 second')",[sha(expiredKey)]);await noEffects(expired,()=>repairFail(db,expired,repairFailure(expired),expiredKey));
  });
  await t.test('final key and owner-session rechecks roll back the whole terminal transition',async()=>{
   const failed=await seedResearch(db),marked=await repairGuard(db,failed);
   await db.exec(`create function private.r11_repair_test_key_recheck() returns trigger language plpgsql as $$ begin if new.id='${failed.workflowRunId}' and new.status='needs_owner' then insert into private.r05_server_revocations(key_hash) values('${sha(RESEARCH_KEY)}');end if;return new;end $$;create trigger r11_repair_test_key_recheck before update on public.workflow_runs for each row execute function private.r11_repair_test_key_recheck();`);
   try{await noEffects(failed,()=>repairFail(db,failed,repairFailure(failed,'search',marked.requestId)));assert.deepEqual((await repairPolicy(db,failed)).outcomes,[]);}finally{await db.exec('drop trigger r11_repair_test_key_recheck on public.workflow_runs;drop function private.r11_repair_test_key_recheck();');}
   const stopped=await seedResearch(db);
   await db.exec(`create function private.r11_repair_test_session_recheck() returns trigger language plpgsql as $$ begin if new.id='${stopped.workflowRunId}' and new.status='cancelled' then update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='${RESEARCH_SESSION}';end if;return new;end $$;create trigger r11_repair_test_session_recheck before update on public.workflow_runs for each row execute function private.r11_repair_test_session_recheck();`);
   try{await noEffects(stopped,()=>repairStop(db,stopped));assert.deepEqual((await repairPolicy(db,stopped)).outcomes,[]);}finally{await db.exec('drop trigger r11_repair_test_session_recheck on public.workflow_runs;drop function private.r11_repair_test_session_recheck();');}
  });
  await t.test('failure after source-policy expiry remains audit persistence and never authorizes a retry',async()=>{
   const expires=Date.now()+600,s=await seedResearch(db,{policyOverrides:{validUntil:new Date(expires).toISOString(),quoteValidUntil:new Date(expires).toISOString()}}),marked=await repairGuard(db,s);await repairSettle(db,s,marked.requestId,'inert-expired-source-receipt');
   await pause(Math.max(0,expires+30-Date.now()));const saved=await repairFail(db,s,repairFailure(s,'search',marked.requestId,{reason:'source_contract_invalid',observation:repairObservation(s)}));assert.equal(saved.recorded,true);assert.equal((await repairPolicy(db,s)).expired,true);await noEffects(s,()=>repairGuard(db,s));
  });
 }finally{await db.close();}
});


test('R11 owner continuation preserves lifetime cap and immutable attempt mappings',{skip:!host,timeout:120000},async t=>{
 const require=createRequire(path.resolve(host,'package.json')),{PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto'),db=new PGlite({extensions:{pgcrypto}});
 try{
  await db.exec(r04SqlBootstrap+sessionBootstrap);for(const name of readdirSync(path.join(root,'supabase/migrations')).filter(name=>name.endsWith('.sql')).sort())await db.exec(readFileSync(path.join(root,'supabase/migrations',name),'utf8'));
  const options=await setupContinuationFixture(db);
  const seed=()=>seedContinuationPredecessor(db,options);
  async function noContinuationEffects(s,fn){const before=await continuationStateSnapshot(db,s);await assert.rejects(fn(),reject);assert.deepEqual(await continuationStateSnapshot(db,s),before);}
  await t.test('read-only continuation reflects known 608131 exposure against the unchanged 848063 lifetime cap',async()=>{
   const old=await seed(),before=await continuationStateSnapshot(db,old),workspace=await repairWorkspace(db,old),context=workspace.continuation;
   assert.deepEqual(workspace.exposure,{currency:'USD',heldMicrounits:'608131',hasUnknown:false});
   assert.deepEqual(context,{predecessorPolicyId:old.policy.id,predecessorWorkflowRunId:old.workflowRunId,goalId:old.goalId,goalRevision:2,businessRevision:1,currentOperatingPolicyId:old.operatingPolicyId,capRevision:1,lifetimeCapMicrounits:'848063',exposureMicrounits:'608131',remainingMicrounits:'239932',eligible:true,reason:'ready'});
   assert.deepEqual(await continuationStateSnapshot(db,old),before);assert.deepEqual(workspace.continuationGrants,[]);
  });
  await t.test('exact continuation advances existing Business and same Goal, issuing one fresh bounded attempt',async()=>{
   const old=await seed(),s=await seedContinuationGrant(db,old),oldRows=await allR05Rows(db),oldHistorical=await value(db,'select to_jsonb(w) result from public.workflow_runs w where id=$1',[old.historicalWorkflowRunId]);
   await noContinuationEffects(s,()=>repairContinue(db,s,'0'.repeat(64)));
   await db.exec('set role authenticated');let activated;try{activated=await repairContinue(db,s);}finally{await db.exec('reset role');}const activation=await activateContinuation(db,s,activated);
   assert.equal(activation.result.policyId,s.grant.policyId);assert.equal(activation.result.workflowRunId,s.workflowRunId);assert.equal(activation.result.replayed,false);assert.equal(activation.loaded.attemptVersion,2);assert.deepEqual(activation.loaded.operationKeys,s.operationKeys);
   assert.equal(s.policy.goalId,old.goalId);assert.notEqual(s.policy.id,old.policy.id);assert.notEqual(s.workflowRunId,old.workflowRunId);
   const policy=await repairPolicy(db,s);assert.equal(policy.attemptVersion,2);assert.deepEqual(policy.operations,s.operationKeys);assert.equal(policy.result,null);assert.deepEqual(policy.outcomes,[]);
   assert.equal(await value(db,'select revision result from private.r04_business_state where business_id=$1',[s.businessId]),2);assert.equal(await value(db,'select revision result from private.r04_goal_state where goal_id=$1',[s.goalId]),4);
   assert.deepEqual((await db.query('select revision from private.r04_goal_versions where goal_id=$1 order by revision',[s.goalId])).rows.map(row=>row.revision),[1,2,3,4]);
   assert.deepEqual((await db.query('select revision,maximum_microunits::text maximum from private.r05_cap_versions where business_id=$1 order by revision',[s.businessId])).rows,[{revision:1,maximum:'848063'},{revision:2,maximum:'848063'}]);
   assert.equal(await value(db,'select count(*)::int result from public.goals where business_id=$1',[s.businessId]),2,'One historical Goal and the same current Goal, never a fresh budget root');
   assert.equal(await value(db,'select count(*)::int result from private.r05_requests where workflow_run_id=$1',[s.workflowRunId]),0,'Activation cannot dispatch');assert.equal(await value(db,'select count(*)::int result from private.r11_research_attempts where business_id=$1',[s.businessId]),1);
   assert.deepEqual(await value(db,'select to_jsonb(w) result from public.workflow_runs w where id=$1',[old.historicalWorkflowRunId]),oldHistorical);
   const newRows=await allR05Rows(db);for(const [table,rows] of Object.entries(oldRows))for(const row of rows)assert.ok(newRows[table].some(value=>JSON.stringify(value)===JSON.stringify(row)),`Existing ${table} row must survive unchanged`);
   const snapshot=await continuationStateSnapshot(db,s);assert.equal((await repairContinue(db,s)).replayed,true);assert.deepEqual(await continuationStateSnapshot(db,s),snapshot);
   await assert.rejects(db.query('delete from private.r11_research_attempts where policy_id=$1',[s.policy.id]),/immutable/);await assert.rejects(db.query("update private.r11_research_continuation_grants set grant_hash=repeat('a',64) where id=$1",[s.grant.id]),/immutable/);
   await assert.rejects(researchV2(db,s,'load',{policyId:s.policy.id},old.serverKey),reject);
   const ready=await prepareRepairCompletion(db,s),completed=await researchV2(db,s,'complete',ready.completion);assert.ok(completed.resultId);assert.equal(await workflowStatus(db,s),'completed');assert.equal((await repairPolicy(db,s)).result.resultId,completed.resultId);
  });
  await t.test('new registry keys are per-policy exact phase mappings and cannot bypass the R11 marker fence',async()=>{
   const old=await seed(),s=await seedContinuationGrant(db,old);await activateContinuation(db,s);
   const exact=repairAdmission(s),before=await repairStateSnapshot(db,s);await assert.rejects(financial(db,s,'guard',exact,s.serverKey),reject);assert.deepEqual(await repairStateSnapshot(db,s),before);
   const prepared=await financial(db,s,'prepare',exact,s.serverKey);assert.ok(prepared.requestId);await assert.rejects(financial(db,s,'dispatch',{requestId:prepared.requestId},s.serverKey),reject);
   const prior=await repairStateSnapshot(db,s);for(const operationKey of ['research.search','research.model',s.operationKeys.select,`research.search.r11v2.${randomUUID()}`]){await assert.rejects(repairGuard(db,s,'search',{operationKey}),reject);assert.deepEqual(await repairStateSnapshot(db,s),prior);}
   const admitted=await repairGuard(db,s);assert.equal(admitted.shouldDispatch,true);assert.equal(admitted.requestId,prepared.requestId);assert.equal((await repairGuard(db,s)).shouldDispatch,false);
   assert.equal(await value(db,'select count(*)::int result from private.r05_markers where request_id=$1',[prepared.requestId]),1);
   await assert.rejects(db.query('update private.r11_research_attempts set policy_id=$1 where policy_id=$2',[randomUUID(),s.policy.id]),/immutable/);
   const otherKey=`research.search.r11v2.${randomUUID()}`;await assert.rejects(db.query("insert into private.r05_operations select $1,pack_id,workflow_definition_id,provider,provider_model_id,purpose,currency,category,maximum_request_bytes,maximum_output_tokens,liability_microunits,source_domains,data_classes,qualification_hash,eligibility_hash,quote_hash,valid_from,valid_until from private.r05_operations where operation_key='research.search'",[otherKey.replace('.r11v2.','.unreviewed.')]),reject);
  });
  await t.test('grants cannot expand remaining budget, change lifetime ceiling, reuse key, or forge lineage and fresh scope',async()=>{
   for(const mutate of [g=>g.operatingPolicy.policyLimitMicrounits='239933',g=>g.operatingPolicy.businessLifetimeLimitMicrounits='848064',g=>g.researchPolicy.maximumMicrousd=239933,g=>g.continuation.remainingMicrounits='239933',g=>g.continuation.predecessorPolicyId=randomUUID(),g=>g.continuation.goalId=randomUUID(),g=>g.operatingPolicy.goalRevision=2,g=>g.operatingPolicy.businessRevision=1,g=>g.operatingPolicy.expectedCapRevision=0,g=>g.operatingPolicy.expectedExposureMicrounits='0',(g,old)=>g.serverKeyHash=sha(old.serverKey),g=>g.operatingPolicy.maximumDispatches=3,g=>g.operatingPolicy.operations[0].operationKey='research.search',g=>g.operatingPolicy.operations[0].sourceDomains=['private.example'],g=>g.researchPolicy.validUntil=new Date(Date.parse(g.researchPolicy.validUntil)+3600000).toISOString(),g=>g.extra='unsafe unreviewed context']){
    const old=await seed(),s=await seedContinuationGrant(db,old,{enroll:false});mutate(s.grant,old);s.grantHash=hash(s.grant);await noContinuationEffects(s,()=>importContinuationGrant(db,s));
   }
  });
  await t.test('unknown liabilities and exposure drift fence continuation without resetting existing history',async()=>{
   const old=await seed(),s=await seedContinuationGrant(db,old);await addRepairExposure(db,old,1);
   const workspace=await repairWorkspace(db,old);assert.equal(workspace.exposure.hasUnknown,true);assert.equal(workspace.continuation.eligible,false);await noContinuationEffects(s,()=>repairContinue(db,s));
   const changed=await seed(),stale=await seedContinuationGrant(db,changed),settled=(await db.query("select v.request_id,z.provider_request_id from private.r11_research_bindings v join private.r05_settlements z on z.request_id=v.request_id where v.policy_id=$1 and v.phase='search'",[changed.policy.id])).rows[0];await repairSettle(db,changed,settled.request_id,settled.provider_request_id,'10069');assert.equal((await repairWorkspace(db,changed)).exposure.hasUnknown,false);assert.equal((await repairWorkspace(db,changed)).exposure.heldMicrounits,'608132');await noContinuationEffects(stale,()=>repairContinue(db,stale));
  });
  await t.test('continuation requires current actual owner session, exact business and live unrevoked grant',async()=>{
   const old=await seed(),s=await seedContinuationGrant(db,old);
   await authenticate(db,RESEARCH_OTHER);try{await noContinuationEffects(s,()=>repairContinue(db,s));}finally{await authenticate(db);}
   await authenticate(db,RESEARCH_OWNER,randomUUID());try{await noContinuationEffects(s,()=>repairContinue(db,s));}finally{await authenticate(db);}
   const other=await seed();await assert.rejects(repairContinue(db,{...s,businessId:other.businessId}),reject);
   await db.query('insert into private.r11_research_continuation_revocations(grant_id) values($1)',[s.grant.id]);await noContinuationEffects(s,()=>repairContinue(db,s));
  });
  await t.test('grant revocation after activation fences new dispatch without deleting the immutable mapping',async()=>{
   const old=await seed(),s=await seedContinuationGrant(db,old);await activateContinuation(db,s);const before=await repairStateSnapshot(db,s);
   await db.query('insert into private.r11_research_continuation_revocations(grant_id) values($1)',[s.grant.id]);await assert.rejects(repairGuard(db,s),reject);assert.deepEqual(await repairStateSnapshot(db,s),before);assert.equal((await repairPolicy(db,s)).revoked,true);assert.equal(await value(db,'select count(*)::int result from private.r11_research_attempts where policy_id=$1',[s.policy.id]),1);
  });
  await t.test('continuation rechecks owner session and fresh key after new-workflow projection',async()=>{
   for(const kind of ['session','key']){
    const old=await seed(),s=await seedContinuationGrant(db,old),action=kind==='session'?`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='${RESEARCH_SESSION}'`:`insert into private.r05_server_revocations(key_hash) values('${sha(s.serverKey)}')`;
    await db.exec(`create function private.r11_repair_test_continue_recheck() returns trigger language plpgsql as $$ begin if new.id='${s.workflowRunId}' then ${action};end if;return new;end $$;create trigger r11_repair_test_continue_recheck after insert on public.workflow_runs for each row execute function private.r11_repair_test_continue_recheck();`);
    try{await noContinuationEffects(s,()=>repairContinue(db,s));}finally{await db.exec('drop trigger r11_repair_test_continue_recheck on public.workflow_runs;drop function private.r11_repair_test_continue_recheck();');}
   }
  });
  await t.test('changed current revisions and finite key revocation invalidate a previously imported grant atomically',async()=>{
   const old=await seed(),s=await seedContinuationGrant(db,old);await value(db,"select public.r04_quest_transition($1,'business.save',$2,$3) result",[s.businessId,{expectedRevision:1,content:s.grant.businessContent,preference:'setup'},randomUUID()]);await noContinuationEffects(s,()=>repairContinue(db,s));
   const keyOld=await seed(),keyAttempt=await seedContinuationGrant(db,keyOld);await db.query('insert into private.r05_server_revocations(key_hash) values($1)',[sha(keyAttempt.serverKey)]);await noContinuationEffects(keyAttempt,()=>repairContinue(db,keyAttempt));
  });
 }finally{await db.close();}
});


test('R11 continuation works after original immutable operation expiry without renewing those rows',{skip:!host,timeout:30000},async()=>{
 const require=createRequire(path.resolve(host,'package.json')),{PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto'),db=new PGlite({extensions:{pgcrypto}});
 try{
  await db.exec(r04SqlBootstrap+sessionBootstrap);for(const name of readdirSync(path.join(root,'supabase/migrations')).filter(name=>name.endsWith('.sql')).sort())await db.exec(readFileSync(path.join(root,'supabase/migrations',name),'utf8'));
  const options=await setupContinuationFixture(db,{windowMs:2200}),old=await seedContinuationPredecessor(db,options),s=await seedContinuationGrant(db,old),rows=(await db.query("select to_jsonb(o) row from private.r05_operations o where operation_key in ('research.search','research.model') order by operation_key")).rows;
  await pause(Math.max(0,Date.parse(options.validUntil)+40-Date.now()));await activateContinuation(db,s);assert.equal((await repairGuard(db,s)).shouldDispatch,true);
  assert.deepEqual((await db.query("select to_jsonb(o) row from private.r05_operations o where operation_key in ('research.search','research.model') order by operation_key")).rows,rows);assert.equal(await value(db,"select count(*)::int result from private.r05_operations where operation_key in ('research.search','research.model') and valid_until<clock_timestamp()"),2);
  assert.equal((await repairPolicy(db,old)).expired,true);assert.equal((await repairPolicy(db,s)).attemptVersion,2);
 }finally{await db.close();}
});
