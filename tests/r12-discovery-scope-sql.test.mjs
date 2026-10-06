import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {r12QuoteFixture} from './helpers/r12-provider-fixture.mjs';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
import {r07FixtureSetup,R07_OWNER,R07_KEY,R05_KEY,R07_LEASE} from './helpers/r07-sql-fixture.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),host=process.env.R12_SQL_TEST_HOST??process.env.R11_SQL_TEST_HOST;
const require=createRequire(import.meta.url),ts=require('typescript');
function source(file,deps){const m={exports:{}};new Function('require','module','exports',ts.transpileModule(readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{assert.ok(name in deps,name);return deps[name];},m,m.exports);return m.exports;}
test('R12 actual scope loader and migrated SQL preserve original funding without creating authority',{skip:!host,timeout:120000},async()=>{
 const sqlRequire=createRequire(path.resolve(host,'package.json')),{PGlite}=sqlRequire('@electric-sql/pglite'),{pgcrypto}=sqlRequire('@electric-sql/pglite/contrib/pgcrypto');
 const db=new PGlite({extensions:{pgcrypto}});
 const {buildDiscoveryIntentFromGoal,DISCOVERY_GOAL_DEFAULT}=require('../.core-tests/products/discovery-v2-goal.js'),{discoveryV2Hash}=require('../.core-tests/products/discovery-v2.js');
 const scope=require('../.core-tests/products/discovery-r12-scope.js');
 const owner=source('src/lib/core-ui/owner-business.ts',{}),server=source('src/products/discovery-r12-scope-server.ts',{'server-only':{},'../lib/core-ui/owner-business':owner,'./discovery-r12-scope':scope});
 try{
  await db.exec(r04SqlBootstrap+sessionBootstrap);
  for(const file of readdirSync(path.join(root,'supabase/migrations')).filter(x=>x.endsWith('.sql')).sort())try{await db.exec(readFileSync(path.join(root,'supabase/migrations',file),'utf8'));}catch(error){throw new Error(`${file}: ${error.message}`,{cause:error});}
  assert.equal((await db.query('select count(*)::int n from private.r12_discovery_scopes')).rows[0].n,0);
  await db.exec(r07FixtureSetup(root));
  const business=(await db.query('select public.r05_seed(848063) b')).rows[0].b;
  const f=(await db.query('select * from public.r05_fixture where b=$1',[business])).rows[0];
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[R07_OWNER]);
  const content=(await db.query('select content from private.r04_goal_versions where goal_id=$1 order by revision desc limit 1',[f.g])).rows[0].content;
  content.objective=DISCOVERY_GOAL_DEFAULT;content.originalIntent=DISCOVERY_GOAL_DEFAULT;content.parsed.geography=["US","GB","AU","NZ"];
  await db.query("select public.r04_quest_transition($1,'quest.save',$2,$3)",[business,{goalId:f.g,expectedRevision:2,content},randomUUID()]);
  await db.query("select public.r04_quest_transition($1,'quest.preference',$2,$3)",[business,{goalId:f.g,expectedRevision:3,preference:'ready'},randomUUID()]);
  const now=Date.now(),rootId=randomUUID(),scopeId=randomUUID();
  const prior=buildDiscoveryIntentFromGoal({id:rootId,businessId:business,goal:DISCOVERY_GOAL_DEFAULT,maximumMicrousd:2000000,maximumCollections:1,now:now-4*86400000});
  const variables={intent:prior,policyHash:discoveryV2Hash(prior),semanticGoalHash:'a'.repeat(64),budgetAuthorityRootId:rootId,ownerKickoff:{followUpBasis:null}};
  await db.query(`insert into public.product_experiments(id,business_id,candidate_id,workflow_run_id,fingerprint,hypothesis,variables,audience,status,measurement_plan,discovery_version,failure,completed_at) values($1,$2,null,$3,$4,'Original research scope',$5,'Adult outdoor and nature enthusiasts','failed','{"version":"pod-discovery-2.0","testPlan":null}','pod-discovery-2.0','Retained prior failure',clock_timestamp())`,[rootId,business,f.w,'f'.repeat(64),variables]);
  const oldReservation=randomUUID();
  await db.query('insert into public.product_research_cost_reservations(id,business_id,experiment_id,workflow_run_id,attempt_key,reserved_microusd,request_hash,estimate) values($1,$2,$3,$4,$5,130000,$6,$7)',[oldReservation,business,rootId,f.w,'search:1','1'.repeat(64),{version:'discovery-estimate-2.0'}]);
  // Historical fixture is seeded with its matching trusted financial attestation.
  await db.query('insert into private.r05_legacy_attestations(business_id,workflow_run_id,source_key,reported_microusd,provider_request_id,receipt_hash) values($1,$2,$3,109480,$4,$5)',[business,f.w,`research:${oldReservation}`,'gen-inert-prior-receipt','3'.repeat(64)]);
  await db.query('insert into public.product_research_cost_settlements(business_id,reservation_id,reported_microusd,provider_request_id,fingerprint) values($1,$2,109480,$3,$4)',[business,oldReservation,'gen-inert-prior-receipt','2'.repeat(64)]);
  const amendment={version:'r12.discovery-source-scope.1',id:scopeId,businessId:business,goalId:f.g,budgetAuthorityRootId:rootId,priorRoundId:rootId,originalIntentHash:discoveryV2Hash(prior),originalSemanticGoalHash:'a'.repeat(64),allowedDomains:['adult-outdoors.example'],excludedDomains:['etsy.com','etsy.me','etsystatic.com'],sourceReviews:[{domain:'adult-outdoors.example',basis:'documented_api_factual_snippets',reviewHash:'b'.repeat(64)}],approvalHash:'c'.repeat(64),independentReviewHash:'d'.repeat(64),purposeReviewHash:'e'.repeat(64),createdAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+3600000).toISOString()};
  const insert=(a=amendment)=>db.query('insert into private.r12_discovery_scopes(id,business_id,goal_id,budget_authority_root_id,prior_round_id,amendment,amendment_hash) values($1,$2,$3,$4,$5,$6,$7)',[a.id,a.businessId,a.goalId,a.budgetAuthorityRootId,a.priorRoundId,a,discoveryV2Hash(a)]);
  for(const change of [{excludedDomains:[]},{excludedDomains:[],allowedDomains:['etsy.com'],sourceReviews:[{domain:'etsy.com',basis:'documented_api_factual_snippets',reviewHash:'b'.repeat(64)}]},{allowedDomains:['etsy.com']},{originalIntentHash:'0'.repeat(64)},{sourceReviews:[{domain:'adult-outdoors.example',basis:'documented_api_factual_snippets',reviewHash:null}]},{originalSemanticGoalHash:'0'.repeat(64)}])await assert.rejects(insert({...amendment,id:randomUUID(),...change}));
  await insert();
  // Actual R05 policy preparation and SQL plan validation, still with no
  // adapter enrollment, sent marker or external transport.
  const phaseKeys=['plan','search1','select1','strategy','review'], quote=r12QuoteFixture(now);
  for(const phase of phaseKeys)await db.query(`insert into private.r05_operations select $1,pack_id,workflow_definition_id,provider,$2,purpose,currency,category,32768,5000,$3,$4,data_classes,qualification_hash,eligibility_hash,quote_hash,valid_from,valid_until from private.r05_operations where operation_key='browser.planner'`,[`research.r12.${scopeId}.${phase}`,phase==='review'?'anthropic/claude-haiku-4.5':'openai/gpt-5.6-luna',quote.ceilings[phase],JSON.stringify(amendment.allowedDomains)]);
  const policy={...f.payload,goalRevision:4,maximumDispatches:5,expectedCapRevision:1,expectedExposureMicrounits:'109480',policyLimitMicrounits:'500000',categoryLimits:[{category:'model',microunits:'500000'}],operations:phaseKeys.map(phase=>({...f.payload.operations[0],operationKey:`research.r12.${scopeId}.${phase}`,sourceDomains:amendment.allowedDomains,maximumPerOperationMicrounits:String(quote.ceilings[phase])}))};
  const proposed=(await db.query("select public.r05_policy_owner($1,'propose',$2,$3) result",[business,policy,randomUUID()])).rows[0].result;
  await db.query("select public.r05_policy_owner($1,'confirm',$2,$3)",[business,{policyId:proposed.id,policyHash:proposed.hash},randomUUID()]);
  const pins=(await db.query('select g.content_hash gh,b.content_hash bh,private.r04_hash(i.snapshot) sh from private.r04_goal_versions g join private.r04_business_versions b on b.business_id=g.business_id and b.revision=1 join public.installed_packs i on i.id=$3 where g.goal_id=$1 and g.business_id=$2 and g.revision=4',[f.g,business,f.installation])).rows[0];
  const plan={format:'r12.discovery.1',discoveryScopeId:scopeId,discoveryScopeHash:discoveryV2Hash(amendment),businessId:business,goalId:f.g,goalRevision:4,goalHash:pins.gh,businessRevision:1,businessHash:pins.bh,policyId:proposed.id,policyHash:proposed.hash,authorityRootId:business,plannerWorkerDefinitionId:'97070000-0000-4000-8000-000000000001',currency:'USD',maximumMicrounits:'500000',deadline:amendment.expiresAt,expiresAt:new Date(now+30*60000).toISOString(),maximumRepairs:0,maximumPivots:0,maximumChildren:5,maximumDispatches:5,requiredChecks:['review'],finishCondition:'all_required_outputs_verified',stopConditions:['no_permitted_work','deadline','repair_exhausted','owner_stopped'],steps:[]};
  plan.steps=phaseKeys.map((phase,index)=>({key:phase,kind:phase==='search1'?'research':phase==='review'?'review':'work',objective:'One finite discovery phase',reason:'Evidence-led phase continuation',adapter:`r12.discovery.${scopeId}.${phase}`,qualificationHash:'d'.repeat(64),installationId:f.installation,packSnapshotHash:pins.sh,workflowDefinitionId:'95050000-0000-4000-8000-000000000012',workerDefinitionId:phase==='review'?'97070000-0000-4000-8000-000000000003':'97070000-0000-4000-8000-000000000002',role:phase,operationKey:`research.r12.${scopeId}.${phase}`,purpose:'Research planning',dependsOn:phaseKeys.slice(0,index),expectedArtifactType:`r12.discovery.${phase}`,maximumMicrounits:String(quote.ceilings[phase]),expiresAt:plan.expiresAt,notBefore:new Date(now-1000).toISOString(),measurement:null,maximumRepairs:0}));
  const {compileQuestPlan}=require('../.core-tests/core/quest-plan.js');compileQuestPlan(plan);
  await db.query('select private.r07_validate_plan($1,$2,$3)',[business,f.g,plan]);
  for(const mutate of [p=>p.maximumDispatches=6,p=>p.steps[4].dependsOn=['strategy'],p=>p.steps[4].workerDefinitionId=p.steps[0].workerDefinitionId,p=>p.discoveryScopeHash='0'.repeat(64),p=>p.steps[1].operationKey='browser.planner',p=>p.plannerWorkerDefinitionId='{97070000-0000-4000-8000-000000000003}',p=>p.steps[4].workerDefinitionId='{97070000-0000-4000-8000-000000000002}']){const bad=structuredClone(plan);mutate(bad);await assert.rejects(db.query('select private.r07_validate_plan($1,$2,$3)',[business,f.g,bad]));}
  await assert.rejects(db.query('update private.r12_discovery_scopes set amendment_hash=$1 where id=$2',['0'.repeat(64),scopeId]),/immutable/);
  await assert.rejects(db.query('delete from private.r12_discovery_scopes where id=$1',[scopeId]),/immutable/);
  const before=(await db.query('select variables from public.product_experiments where id=$1',[rootId])).rows[0].variables;
  const calls=[];
  await db.exec('set role authenticated');
  const context={userId:R07_OWNER,businesses:[{id:business,name:'Inert Business'}],supabase:{rpc:async(name,args)=>{calls.push({name,args});assert.equal(name,'r12_discovery_scope_read');try{return{data:(await db.query('select public.r12_discovery_scope_read($1,$2) result',[args.p_business_id,args.p_scope_id])).rows[0].result,error:null};}catch(error){return{data:null,error};}}}};
  const result=await server.loadAmendedDiscoveryScope(context,business,scopeId,now);
  assert.equal(result.executionAuthorized,false);assert.equal(result.budgetAuthorityRootId,rootId);assert.equal(result.remainingMicrousd,1890520);assert.deepEqual(result.intent.comparisonUniverse.markets,prior.comparisonUniverse.markets);assert.deepEqual(result.intent.comparisonUniverse.sourceDomains,['adult-outdoors.example']);assert.equal(calls.length,1);
  const {discoveryKnowledgeFixture}=await import('./discovery-v2-fixtures.mjs');
  const {buildDiscoveryPlannerRequestV2}=require('../.core-tests/products/discovery-v2-plan.js');
  const {routeDiscoveryR12Request,inspectDiscoveryR12Wire}=require('../.core-tests/products/discovery-r12-wire.js');
  const proposedRequest=buildDiscoveryPlannerRequestV2(result.intent,discoveryKnowledgeFixture(),undefined,'qualified_public').request;
  const routed=routeDiscoveryR12Request(proposedRequest,'plan',{modelId:'openai/gpt-5.6-luna',endpoint:'azure/us',priceLimit:{prompt:.44,completion:1.98,request:0}});
  const inspected=await inspectDiscoveryR12Wire(routed,'plan'),wire=JSON.parse(inspected.wire.body);
  assert.equal(wire.model,'openai/gpt-5.6-luna');assert.equal(wire.max_tokens,1500);assert.deepEqual(wire.provider.only,['azure/us']);assert.equal(wire.provider.zdr,true);assert.equal(wire.provider.data_collection,'deny');
  assert.equal(inspected.wireBytes,Buffer.byteLength(inspected.wire.body));assert.equal(inspected.requestHash,discoveryV2Hash(routed));
  assert.equal(JSON.parse(wire.messages[1].content).intent.id,scopeId);

  await assert.rejects(db.query('select * from private.r12_discovery_scopes'),/permission denied/);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",['95050000-0000-4000-8000-000000000002']);
  await assert.rejects(server.loadAmendedDiscoveryScope(context,business,scopeId,now),/scope_unavailable/);
  await db.exec('reset role');
  assert.deepEqual((await db.query('select variables from public.product_experiments where id=$1',[rootId])).rows[0].variables,before);
  assert.equal((await db.query('select count(*)::int n from private.r05_markers')).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from private.r07_attempts')).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from public.product_research_cost_reservations')).rows[0].n,1);
  await db.query("insert into private.r05_policy_proofs values($1,$2,$3,clock_timestamp()+interval '1 hour')",[proposed.id,proposed.hash,'4'.repeat(64)]);
  for(const step of plan.steps)await db.query(`insert into private.r07_adapters(adapter_key,qualification_hash,workflow_definition_id,worker_definition_id,workflow_hash,worker_hash,operation_key,role,purpose,artifact_type,mode,valid_from,valid_until,knowledge_valid_until) select $1,$2,fd.id,wd.id,private.r04_hash(to_jsonb(fd)),private.r04_hash(to_jsonb(wd)),$3,$4,$5,$6,'simulation',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 hour' from public.workflow_definitions fd cross join public.worker_definitions wd where fd.id=$7 and wd.id=$8`,[step.adapter,step.qualificationHash,step.operationKey,step.role,step.purpose,step.expectedArtifactType,step.workflowDefinitionId,step.workerDefinitionId]);
  const rpc=async(operation,payload,epoch=null)=>(await db.query('select public.r07_controller($1,$2,$3,$4,$5,$6,$7,$8,$9) result',[business,f.g,operation,payload,randomUUID(),R07_KEY,R07_LEASE,epoch,R05_KEY])).rows[0].result;
  await rpc('plan',{plan,expectedVersion:0,reason:'Inert scoped controller qualification',evidenceHash:'5'.repeat(64)});
  const store={read:()=>rpc('read',{}),command:(operation,payload,epoch)=>rpc(operation,['schedule','reserve'].includes(operation)?{...payload,runtimeCapability:'inert-r12-runtime-capability-123456789'}:payload,epoch)};
  const {driveQuestOnce}=require('../.core-tests/core/quest-controller.js');let dispatched=0;
  const adapters=Object.fromEntries(plan.steps.map(step=>[step.adapter,{qualificationHash:step.qualificationHash,workflowDefinitionId:step.workflowDefinitionId,workerDefinitionId:step.workerDefinitionId,mode:'simulation',prepare:async ctx=>({wire:inspected.wire,descriptor:{workflowRunId:ctx.attempt.id,operationKey:ctx.step.operationKey,requestHash:inspected.requestHash,idempotencyKey:`r07:${ctx.attempt.id}`,wireRequestHash:inspected.wireHash,wireRequestBytes:inspected.wireBytes,providerModelId:'openai/gpt-5.6-luna',maximumOutputTokens:1500,accounting:{kind:'r05'},sourceDomains:amendment.allowedDomains,dataClasses:['business_context'],accountId:null,accountRevision:null,currency:'USD',liabilityMicrounits:String(quote.ceilings.plan)}}),dispatch:async()=>{dispatched++;throw Error('Source bridge is closed; adapter dispatch must not run');},reconcile:async()=>({status:'unknown'})}]));
  assert.equal((await driveQuestOnce(store,{adapters})).reason,'scheduled');
  assert.equal((await driveQuestOnce(store,{adapters})).reason,'reserved');
  const held=(await db.query('select private.stage13v2_budget_authority($1,false) result',[rootId])).rows[0].result;
  assert.equal(held.knownActualMicrousd,109480);assert.equal(held.pendingExposureMicrousd,quote.ceilings.plan);assert.equal(held.committedMicrousd,109480+quote.ceilings.plan);assert.equal(held.hasUncertainCosts,true);
  assert.equal((await db.query('select count(*)::int n from public.product_research_cost_reservations')).rows[0].n,1,'New R05 liability is not duplicated into legacy rows');
  await assert.rejects(driveQuestOnce(store,{adapters}),/r12_source_dispatch_bridge_unavailable/);assert.equal(dispatched,0);
  assert.equal((await db.query('select count(*)::int n from private.r05_markers')).rows[0].n,0);
  // Positive path uses the same actual controller, SQL admission, wire binding
  // and OpenRouter serializer. Only transport is inert; no real key is loaded.
  const {createDiscoveryR12QuestAdapter,DiscoveryR12ReceiptPending}=require('../.core-tests/products/discovery-r12-adapter.js');
  const {normalizeDiscoveryPlanV2}=require('../.core-tests/products/discovery-v2-plan.js');
  const operation=async(attemptId,operation,payload)=>(await db.query('select public.r12_discovery_server($1,$2,$3,$4,$5) result',[business,attemptId,operation,payload,R07_KEY])).rows[0].result;
  const effectStore={operation,settle:async(attemptId,settlement)=>{await rpc('settle',{attemptId,settlement});},dispatchedAt:async attemptId=>(await operation(attemptId,'load',{})).dispatchedAt};
  const output={comparisonRationale:'Compare all supplied countries without treating adjacent outdoor interest as proven shirt demand.',queryFocus:['Dated outdoor apparel purchase criteria and nature motifs'],proposals:[{concept:'Original woodland linework',audience:result.intent.comparisonUniverse.audiences[0],hypothesis:'Test whether an original woodland design communicates adult outdoor identity clearly.',differentiationHypothesis:'Use original restrained linework rather than copied marketplace or branded artwork.'}]};
  let postCount=0,getCount=0;
  const fetcher=async(url,init)=>{
   if(init.method==='POST'){postCount++;assert.equal((await db.query('select count(*)::int n from private.r12_discovery_transport_claims')).rows[0].n,1);assert.equal(JSON.parse(init.body).model,'openai/gpt-5.6-luna');return new Response(JSON.stringify({id:'gen-r12-inert-planner',model:'openai/gpt-5.6-luna-20260709',choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150,cost:0.00001}}),{status:200});}
   assert.equal(init.method,'GET');getCount++;assert.match(String(url),/generation\?id=gen-r12-inert-planner$/);assert.equal((await db.query('select count(*)::int n from private.r12_discovery_candidates')).rows[0].n,1,'Useful output is durable before metadata GET');
   return new Response(JSON.stringify({error:{message:'Not indexed yet'}}),{status:404});
  };
  const step=plan.steps[0],options={scope:amendment,phase:'plan',identity:{qualificationHash:step.qualificationHash,workflowDefinitionId:step.workflowDefinitionId,workerDefinitionId:step.workerDefinitionId,mode:'simulation'},dataClasses:['business_context'],store:effectStore,request:async()=>proposedRequest,quote:async()=>quote,project:async qualified=>({outcome:'accepted',result:{plan:normalizeDiscoveryPlanV2(result.intent,qualified.candidate.output,'qualified_public')},checkedArtifacts:[]}),config:{apiKey:'inert-r12-adapter-fixture',baseUrl:'https://openrouter.ai/api/v1',appUrl:'https://agent-labs-two.vercel.app',appName:'Agent Labs'},fetcher};
  adapters[step.adapter]=createDiscoveryR12QuestAdapter(options);
  await assert.rejects(driveQuestOnce(store,{adapters}),error=>error instanceof DiscoveryR12ReceiptPending);
  assert.equal(postCount,1);assert.equal(getCount,1);
  const snapshot=await store.read(),attempt=snapshot.attempts[0],saved=await operation(attempt.id,'load',{});
  assert.equal(saved.candidate.output.comparisonRationale,output.comparisonRationale);assert.equal(saved.receipt.attempts,1);assert.equal(saved.receipt.diagnostic.httpStatus,404);
  assert.equal((await driveQuestOnce(store,{adapters,reconcile:true})).reason,'effect_still_uncertain');assert.equal(postCount,1);assert.equal(getCount,1,'Cooldown prevents eager metadata polling after restart');
  assert.equal((await operation(attempt.id,'send',{wireHash:attempt.wireHash})).shouldDispatch,false,'Duplicate transport claim cannot regenerate');
  const paid=(await db.query('select private.stage13v2_budget_authority($1,false) result',[rootId])).rows[0].result;
  assert.equal(paid.knownActualMicrousd,109490);assert.equal(paid.pendingExposureMicrousd,0);assert.equal(paid.hasUncertainCosts,false);
  await assert.rejects(operation(attempt.id,'stage',{candidate:{...saved.candidate,receivedAt:new Date().toISOString()},candidateHash:'0'.repeat(64)}),/candidate_invalid/);
  await db.exec('set role authenticated');
  await assert.rejects(db.query('select * from private.r12_discovery_candidates'),/permission denied/);await db.exec('reset role');
  // Test-only virtual time moves the private clock source, never production
  // payloads. A fresh adapter/process resumes the saved output, no second POST.
  await db.exec('alter table private.r12_discovery_receipt_checks disable trigger r12_discovery_history_guard');
  await db.query("update private.r12_discovery_receipt_checks set created_at=clock_timestamp()-interval '121 seconds'");
  await db.exec('alter table private.r12_discovery_receipt_checks enable trigger r12_discovery_history_guard');
  adapters[step.adapter]=createDiscoveryR12QuestAdapter({...options,fetcher:async(url,init)=>{assert.equal(init.method,'GET');getCount++;return new Response(JSON.stringify({data:{id:'gen-r12-inert-planner',provider_name:'Azure',model:'openai/gpt-5.6-luna-20260709'}}),{status:200});}});
  assert.equal((await driveQuestOnce(store,{adapters,reconcile:true})).reason,'readback_persisted');
  assert.equal((await driveQuestOnce(store,{adapters})).reason,'response_projected');
  assert.equal(postCount,1);assert.equal(getCount,2);assert.equal((await store.read()).attempts[0].status,'completed');
  assert.equal((await operation(attempt.id,'load',{})).candidate.receivedAt,saved.candidate.receivedAt);
  assert.equal((await db.query('select private.stage13v2_budget_authority($1,false) result',[rootId])).rows[0].result.knownActualMicrousd,109490,'Repeated settlement does not double the original funding exposure');


 }finally{await db.close();}
});
