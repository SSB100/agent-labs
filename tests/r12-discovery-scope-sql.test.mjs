import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomUUID,createHash,createHmac} from 'node:crypto';
import path from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadSource} from './helpers/guided-ui.mjs';
import {fileURLToPath} from 'node:url';
import {r12PhaseOutputFixture} from './helpers/r12-phase-output-fixture.mjs';
import {discoveryKnowledgeFixture} from './discovery-v2-fixtures.mjs';
import {r12QuoteFixture} from './helpers/r12-provider-fixture.mjs';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
import {r07FixtureSetup,R07_OWNER,R07_LEASE} from './helpers/r07-sql-fixture.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),host=process.env.R12_SQL_TEST_HOST??process.env.R11_SQL_TEST_HOST;
const require=createRequire(import.meta.url),ts=require('typescript');
function validatePg(value){const u=new URL(value);assert.ok(u.protocol==='postgresql:'&&u.hostname==='127.0.0.1'&&u.username==='r12_test'&&u.pathname==='/r12_test'&&!u.search&&!u.hash,'Only a fresh isolated loopback r12_test database is allowed');return value;}
test('R12 SQL harness refuses remote, wrong-identity and options-bearing database targets',()=>{for(const url of ['postgresql://r12_test:x@production.example/r12_test','postgresql://postgres:x@127.0.0.1/r12_test','postgresql://r12_test:x@127.0.0.1/production','postgresql://r12_test:x@127.0.0.1/r12_test?options=-csearch_path%3Dpublic'])assert.throws(()=>validatePg(url));});

function source(file,deps){const m={exports:{}};new Function('require','module','exports',ts.transpileModule(readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{assert.ok(name in deps,name);return deps[name];},m,m.exports);return m.exports;}
test('R12 actual scope loader and migrated SQL preserve original funding without creating authority',{skip:!host,timeout:120000},async()=>{
 const sqlRequire=createRequire(path.resolve(host,'package.json'));let db;
 if(process.env.R12_REQUIRE_POSTGRES==='1')assert.ok(process.env.R12_POSTGRES_URL,'Actual PostgreSQL is required by this gate');
 if(process.env.R12_POSTGRES_URL){validatePg(process.env.R12_POSTGRES_URL);const {Client}=sqlRequire('pg');db=new Client({connectionString:process.env.R12_POSTGRES_URL});await db.connect();assert.equal(Number((await db.query("select count(*) from pg_tables where schemaname in ('public','private')")).rows[0].count),0,'Fresh fixture database required');db.exec=sql=>db.query(sql);db.close=()=>db.end();}
 else{const {PGlite}=sqlRequire('@electric-sql/pglite'),{pgcrypto}=sqlRequire('@electric-sql/pglite/contrib/pgcrypto');db=new PGlite({extensions:{pgcrypto}});}

 const priorEnv={VERCEL_ENV:process.env.VERCEL_ENV,R05_ADMISSION_SERVER_KEY:process.env.R05_ADMISSION_SERVER_KEY,OPENROUTER_API_KEY:process.env.OPENROUTER_API_KEY};
 process.env.VERCEL_ENV='production';process.env.R05_ADMISSION_SERVER_KEY='inert-r12-owner-root-configuration-0123456789';process.env.OPENROUTER_API_KEY='inert-r12-provider-configuration';
 const {buildDiscoveryIntentFromGoal,DISCOVERY_GOAL_DEFAULT}=require('../.core-tests/products/discovery-v2-goal.js'),{discoveryV2Hash}=require('../.core-tests/products/discovery-v2.js');
 const scope=require('../.core-tests/products/discovery-r12-scope.js');
 const owner=source('src/lib/core-ui/owner-business.ts',{}),server=source('src/products/discovery-r12-scope-server.ts',{'server-only':{},'../lib/core-ui/owner-business':owner,'./discovery-r12-scope':scope});
 try{
  await db.exec(r04SqlBootstrap+sessionBootstrap);
  for(const file of readdirSync(path.join(root,'supabase/migrations')).filter(x=>x.endsWith('.sql')).sort())try{await db.exec(readFileSync(path.join(root,'supabase/migrations',file),'utf8'));}catch(error){throw new Error(`${file}: ${error.message}`,{cause:error});}
  assert.equal((await db.query('select count(*)::int n from private.r12_discovery_scopes')).rows[0].n,0);
  const rootId=randomUUID(),scopeId=randomUUID();
  const fixtureKnowledge=discoveryKnowledgeFixture();
  const installationSeed=r07FixtureSetup(root).replace('values(w,b,g,','values(w,b,null,').replace('runtime_capability_hash,pack_installation_id,pack_snapshot)','runtime_capability_hash,pack_installation_id,pack_snapshot,input)').replace("i,'{}');","i,'{}',jsonb_build_object('intentId','"+rootId+"'));").replaceAll("clock_timestamp()+interval '1 day'","clock_timestamp()+interval '1 hour'").replaceAll("'Finite fixture','qualified'","'Finite fixture','experimental'").replace("'r05.inert','1.0.0','R05 inert workflow','qualified'","'product.discovery-v2.one','1.0.0','R05 inert workflow','experimental'").replaceAll("'r07.planner'","'product.discovery-v2.plan'").replaceAll("'r07.research'","'product.discovery-v2.research'").replaceAll("'r07.challenge'","'product.discovery-v2.review'").replaceAll("'r07.work'","'product.discovery-v2.strategy'"),seedAnchor="'r05.inert','active','{}'";assert.equal(installationSeed.split(seedAnchor).length,2);
  await db.exec(installationSeed.replace(seedAnchor,"'r05.inert','active',$r12_snapshot$"+JSON.stringify(fixtureKnowledge.snapshot)+"$r12_snapshot$::jsonb"));
  const business=(await db.query('select public.r05_seed(848063) b')).rows[0].b;
  const f=(await db.query('select * from public.r05_fixture where b=$1',[business])).rows[0];
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[R07_OWNER]);
  const bootstrapCalls=[],bootstrapErrors=[];
  const bootstrapClient={auth:{getClaims:async()=>({data:{claims:{sub:R07_OWNER}},error:null})},rpc:async(name,args)=>{
   const keys={r04_quest_transition:['p_business_id','p_operation','p_payload','p_submission_id'],r04_research_link_preview:['p_business_id','p_experiment_id'],r05_policy_owner:['p_business_id','p_operation','p_payload','p_submission_id'],r05_admission_read:['p_business_id','p_policy_id','p_limit','p_offset']}[name];assert.ok(keys,name);bootstrapCalls.push({name,operation:args.p_operation});
   await db.exec('set role authenticated');try{return{data:(await db.query(`select public.${name}(${keys.map((_,i)=>`$${i+1}`).join(',')}) result`,keys.map(k=>args[k]??null))).rows[0].result,error:null};}catch(error){bootstrapErrors.push(error.message);return{data:null,error};}finally{await db.exec('reset role');}
  }};
  const apiDeps={'@/lib/supabase/server':{createClient:async()=>bootstrapClient},'@/core/quest-intake':require('../.core-tests/core/quest-intake.js'),'@/core/quest-contract':require('../.core-tests/core/quest-contract.js'),'@/core/admission-contract':require('../.core-tests/core/admission-contract.js')};
  const questApi=source('src/app/dashboard/quests/actions.ts',apiDeps),policyApi=source('src/app/dashboard/quests/controls/actions.ts',apiDeps);
  const oldGoalId=f.g,oldGoalContent=(await db.query('select content from private.r04_goal_versions where goal_id=$1 order by revision desc limit 1',[f.g])).rows[0].content,content=structuredClone(oldGoalContent);
  content.title='Original nature-shirt geographic research';content.objective=DISCOVERY_GOAL_DEFAULT;content.originalIntent=DISCOVERY_GOAL_DEFAULT;content.parsed.geography=["US","GB","AU","NZ"];content.parsed.budget.amount='2';
  const createdGoal=await questApi.saveQuestIntent(business,'quest.save',{goalId:null,expectedRevision:0,content},randomUUID());assert.equal(createdGoal.ok,true,bootstrapErrors.join(';'));f.g=createdGoal.result.id;assert.notEqual(f.g,oldGoalId);
  const readyGoal=await questApi.saveQuestIntent(business,'quest.preference',{goalId:f.g,expectedRevision:createdGoal.result.revision,preference:'ready'},randomUUID());assert.equal(readyGoal.ok,true,bootstrapErrors.join(';'));const goalRevision=readyGoal.result.revision;
  assert.deepEqual((await db.query('select content from private.r04_goal_versions where goal_id=$1 order by revision desc limit 1',[oldGoalId])).rows[0].content,oldGoalContent,'Existing unrelated Goal is not repurposed');
  const now=Date.now();
  const derived=role=>createHmac('sha256',process.env.R05_ADMISSION_SERVER_KEY).update(JSON.stringify({version:'r12.scoped-authority.1',role,businessId:business,ownerId:R07_OWNER,scopeId})).digest('base64url');
  const R07_KEY=derived('controller'),R05_KEY=derived('admission');
  for(const [table,key] of [['r07_server_keys',R07_KEY],['r05_server_keys',R05_KEY]])await db.query(`insert into private.${table} select $1,min(expires_at) from private.${table}`,[createHash('sha256').update(key).digest('hex')]);

  const prior=buildDiscoveryIntentFromGoal({id:rootId,businessId:business,goal:DISCOVERY_GOAL_DEFAULT,maximumMicrousd:2000000,maximumCollections:1,now:now-4*86400000});
  const variables={intent:prior,policyHash:discoveryV2Hash(prior),semanticGoalHash:'a'.repeat(64),budgetAuthorityRootId:rootId,ownerKickoff:{followUpBasis:null}};
  await db.query(`insert into public.product_experiments(id,business_id,candidate_id,workflow_run_id,fingerprint,hypothesis,variables,audience,status,measurement_plan,discovery_version,failure,completed_at) values($1,$2,null,$3,$4,'Original research scope',$5,'Adult outdoor and nature enthusiasts','failed','{"version":"pod-discovery-2.0","testPlan":null}','pod-discovery-2.0','Retained prior failure',clock_timestamp())`,[rootId,business,f.w,'f'.repeat(64),variables]);
  const oldReservation=randomUUID();
  await db.query('insert into public.product_research_cost_reservations(id,business_id,experiment_id,workflow_run_id,attempt_key,reserved_microusd,request_hash,estimate) values($1,$2,$3,$4,$5,130000,$6,$7)',[oldReservation,business,rootId,f.w,'search:1','1'.repeat(64),{version:'discovery-estimate-2.0'}]);
  // Historical fixture is seeded with its matching trusted financial attestation.
  await db.query('insert into private.r05_legacy_attestations(business_id,workflow_run_id,source_key,reported_microusd,provider_request_id,receipt_hash) values($1,$2,$3,109480,$4,$5)',[business,f.w,`research:${oldReservation}`,'gen-inert-prior-receipt','3'.repeat(64)]);
  await db.query('insert into public.product_research_cost_settlements(business_id,reservation_id,reported_microusd,provider_request_id,fingerprint) values($1,$2,109480,$3,$4)',[business,oldReservation,'gen-inert-prior-receipt','2'.repeat(64)]);
  const linkPreview=await questApi.previewResearchLink(business,rootId);assert.equal(linkPreview.status,'linkable');assert.equal(linkPreview.authorityRootId,rootId);
  assert.equal((await questApi.saveQuestIntent(business,'research.link',{experimentId:rootId,goalId:f.g,expectedRevision:goalRevision},randomUUID())).ok,true,bootstrapErrors.join(';'));
  assert.equal((await db.query('select goal_id from private.r04_research_links where experiment_id=$1',[rootId])).rows[0].goal_id,f.g);
  const amendment={version:'r12.discovery-source-scope.1',id:scopeId,businessId:business,goalId:f.g,budgetAuthorityRootId:rootId,priorRoundId:rootId,originalIntentHash:discoveryV2Hash(prior),originalSemanticGoalHash:'a'.repeat(64),allowedDomains:['adult-outdoors.example'],excludedDomains:['etsy.com','etsy.me','etsystatic.com'],sourceReviews:[{domain:'adult-outdoors.example',basis:'documented_api_factual_snippets',reviewHash:'b'.repeat(64)}],approvalHash:'c'.repeat(64),independentReviewHash:'d'.repeat(64),approvedQuery:'Compare dated adult outdoor-apparel purchase criteria across US, GB, AU and NZ. Preserve exact population, geography, survey date and denominator limits; original nature-shirt demand, willingness to pay and operating costs remain unproven unless directly measured.',purposeReviewHash:'e'.repeat(64),createdAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+30*60000).toISOString()};
  amendment.purposeReviewHash=discoveryV2Hash({query:amendment.approvedQuery,classification:'generic_nonpersonal_public_research'});
  const insert=(a=amendment)=>db.query('insert into private.r12_discovery_scopes(id,business_id,goal_id,budget_authority_root_id,prior_round_id,amendment,amendment_hash) values($1,$2,$3,$4,$5,$6,$7)',[a.id,a.businessId,a.goalId,a.budgetAuthorityRootId,a.priorRoundId,a,discoveryV2Hash(a)]);
  for(const change of [{excludedDomains:[]},{excludedDomains:[],allowedDomains:['etsy.com'],sourceReviews:[{domain:'etsy.com',basis:'documented_api_factual_snippets',reviewHash:'b'.repeat(64)}]},{allowedDomains:['etsy.com']},{originalIntentHash:'0'.repeat(64)},{sourceReviews:[{domain:'adult-outdoors.example',basis:'documented_api_factual_snippets',reviewHash:null}]},{originalSemanticGoalHash:'0'.repeat(64)}])await assert.rejects(insert({...amendment,id:randomUUID(),...change}));
  await insert();
  // Actual R05 policy preparation and SQL plan validation, still with no
  // adapter enrollment, sent marker or external transport.
  const phaseKeys=['plan','search1','select1','strategy','review'], quote=r12QuoteFixture(now);
  const phaseData=phase=>phase==='search1'?['generic_public_query','public_evidence']:['business_context','public_evidence'];
  const byteLimits={plan:12288,search1:8192,select1:16384,strategy:32768,review:32768},tokenLimits={plan:1500,search1:4000,select1:1000,strategy:5000,review:4000};
  for(const phase of phaseKeys)await db.query(`insert into private.r05_operations select $1,pack_id,workflow_definition_id,provider,$2,purpose,currency,category,$5,$6,$3,$4,$7,qualification_hash,eligibility_hash,quote_hash,valid_from,valid_until from private.r05_operations where operation_key='browser.planner'`,[`research.r12.${scopeId}.${phase}`,phase==='review'?'anthropic/claude-haiku-4.5':'openai/gpt-5.6-luna',quote.ceilings[phase],JSON.stringify(amendment.allowedDomains),byteLimits[phase],tokenLimits[phase],JSON.stringify(phaseData(phase))]);
  const policy={...f.payload,goalId:f.g,goalRevision,maximumDispatches:5,expectedCapRevision:1,expectedExposureMicrounits:'109480',policyLimitMicrounits:'500000',categoryLimits:[{category:'model',microunits:'500000'}],operations:phaseKeys.map(phase=>({...f.payload.operations[0],operationKey:`research.r12.${scopeId}.${phase}`,sourceDomains:amendment.allowedDomains,dataClasses:phaseData(phase),maximumPerOperationMicrounits:String(quote.ceilings[phase])}))};
  assert.equal((await policyApi.saveOperatingControl(business,'propose',policy,randomUUID())).ok,true,bootstrapErrors.join(';'));
  const admissionRead=await bootstrapClient.rpc('r05_admission_read',{p_business_id:business,p_policy_id:null,p_limit:20,p_offset:0});assert.equal(admissionRead.error,null);const proposed=admissionRead.data.policies.find(p=>p.policy.goalId===f.g);assert.ok(proposed);
  assert.equal((await policyApi.saveOperatingControl(business,'confirm',{policyId:proposed.id,policyHash:proposed.hash},randomUUID())).ok,true,bootstrapErrors.join(';'));
  assert.deepEqual(bootstrapCalls.filter(c=>c.operation).map(c=>c.operation),['quest.save','quest.preference','research.link','propose','confirm']);
  const pins=(await db.query('select g.content_hash gh,b.content_hash bh,private.r04_hash(i.snapshot) sh from private.r04_goal_versions g join private.r04_business_versions b on b.business_id=g.business_id and b.revision=1 join public.installed_packs i on i.id=$3 where g.goal_id=$1 and g.business_id=$2 and g.revision=$4',[f.g,business,f.installation,goalRevision])).rows[0];
  const receiptUntil=new Date((await db.query('select least((select min(expires_at) from private.r05_server_keys),(select min(expires_at) from private.r07_server_keys)) expiry')).rows[0].expiry).toISOString(),paidUntil=new Date(Date.parse(receiptUntil)-30*60000).toISOString();
  const plan={format:'r12.discovery.1',discoveryScopeId:scopeId,discoveryScopeHash:discoveryV2Hash(amendment),businessId:business,goalId:f.g,goalRevision,goalHash:pins.gh,businessRevision:1,businessHash:pins.bh,policyId:proposed.id,policyHash:proposed.hash,authorityRootId:business,plannerWorkerDefinitionId:'97070000-0000-4000-8000-000000000001',currency:'USD',maximumMicrounits:'500000',deadline:amendment.expiresAt,expiresAt:paidUntil,maximumRepairs:0,maximumPivots:0,maximumChildren:5,maximumDispatches:5,requiredChecks:['review'],finishCondition:'all_required_outputs_verified',stopConditions:['no_permitted_work','deadline','repair_exhausted','owner_stopped'],steps:[]};
  plan.steps=phaseKeys.map((phase,index)=>({key:phase,kind:phase==='search1'?'research':phase==='review'?'review':'work',objective:'One finite discovery phase',reason:'Evidence-led phase continuation',adapter:`r12.discovery.${scopeId}.${phase}`,qualificationHash:'d'.repeat(64),installationId:f.installation,packSnapshotHash:pins.sh,workflowDefinitionId:'95050000-0000-4000-8000-000000000012',workerDefinitionId:phase==='review'?'97070000-0000-4000-8000-000000000003':phase==='plan'?'97070000-0000-4000-8000-000000000001':phase==='strategy'?'97070000-0000-4000-8000-000000000004':'97070000-0000-4000-8000-000000000002',role:phase,operationKey:`research.r12.${scopeId}.${phase}`,purpose:'Research planning',dependsOn:phaseKeys.slice(0,index),expectedArtifactType:`r12.discovery.${phase}`,maximumMicrounits:String(quote.ceilings[phase]),expiresAt:plan.expiresAt,notBefore:new Date(now-1000).toISOString(),measurement:null,maximumRepairs:0}));
  const {compileQuestPlan}=require('../.core-tests/core/quest-plan.js');compileQuestPlan(plan);
  await assert.rejects(db.query('select private.r07_validate_plan($1,$2,$3)',[business,f.g,plan]),/planner_unqualified/,'Experimental definitions remain closed before exact authority registration');
  for(const mutate of [p=>p.maximumDispatches=6,p=>p.steps[4].dependsOn=['strategy'],p=>p.steps[4].workerDefinitionId=p.steps[0].workerDefinitionId,p=>p.discoveryScopeHash='0'.repeat(64),p=>p.steps[1].operationKey='browser.planner',p=>p.plannerWorkerDefinitionId='{97070000-0000-4000-8000-000000000003}',p=>p.steps[4].workerDefinitionId='{97070000-0000-4000-8000-000000000002}']){const bad=structuredClone(plan);mutate(bad);await assert.rejects(db.query('select private.r07_validate_plan($1,$2,$3)',[business,f.g,bad]));}
  await assert.rejects(db.query('update private.r12_discovery_scopes set amendment_hash=$1 where id=$2',['0'.repeat(64),scopeId]),/immutable/);
  await assert.rejects(db.query('delete from private.r12_discovery_scopes where id=$1',[scopeId]),/immutable/);
  const before=(await db.query('select variables from public.product_experiments where id=$1',[rootId])).rows[0].variables;
  const calls=[];
  await db.exec('set role authenticated');
  const context={userId:R07_OWNER,businesses:[{id:business,name:'Inert Business'}],supabase:{rpc:async(name,args)=>{calls.push({name,args});assert.equal(name,'r12_discovery_scope_read');try{return{data:(await db.query('select public.r12_discovery_scope_read($1,$2) result',[args.p_business_id,args.p_scope_id])).rows[0].result,error:null};}catch(error){return{data:null,error};}}}};
  const result=await server.loadAmendedDiscoveryScope(context,business,scopeId,now);
  assert.equal(result.executionAuthorized,false);assert.equal(result.budgetAuthorityRootId,rootId);assert.equal(result.remainingMicrousd,1890520);assert.deepEqual(result.intent.comparisonUniverse.markets,prior.comparisonUniverse.markets);assert.deepEqual(result.intent.comparisonUniverse.sourceDomains,['adult-outdoors.example']);assert.equal(calls.length,1);
  const {buildDiscoveryPlannerRequestV2}=require('../.core-tests/products/discovery-v2-plan.js');
  const {routeDiscoveryR12Request,inspectDiscoveryR12Wire}=require('../.core-tests/products/discovery-r12-wire.js');
  const proposedRequest=buildDiscoveryPlannerRequestV2(result.intent,fixtureKnowledge,undefined,'qualified_public').request;
  proposedRequest.requestMetadata={...proposedRequest.requestMetadata,r12CommittedBeforeAttemptMicrousd:109480,r12KnowledgeHash:discoveryV2Hash(fixtureKnowledge)};
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
  for(const step of plan.steps)await db.query(`insert into private.r07_adapters(adapter_key,qualification_hash,workflow_definition_id,worker_definition_id,workflow_hash,worker_hash,operation_key,role,purpose,artifact_type,mode,valid_from,valid_until,knowledge_valid_until) select $1,$2,fd.id,wd.id,private.r04_hash(to_jsonb(fd)),private.r04_hash(to_jsonb(wd)),$3,$4,$5,$6,'qualification',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 hour' from public.workflow_definitions fd cross join public.worker_definitions wd where fd.id=$7 and wd.id=$8`,[step.adapter,step.qualificationHash,step.operationKey,step.role,step.purpose,step.expectedArtifactType,step.workflowDefinitionId,step.workerDefinitionId]);
  await db.query("insert into private.r12_discovery_authorities(scope_id,business_id,goal_id,controller_key_hash,admission_key_hash,plan,plan_hash,mode,approval_hash,execution_review_hash,valid_until,receipt_until) values($1,$2,$3,encode(extensions.digest(convert_to($4,'UTF8'),'sha256'),'hex'),encode(extensions.digest(convert_to($5,'UTF8'),'sha256'),'hex'),$6,private.r04_hash($6),'qualification',$7,$8,$9,$10)",[scopeId,business,f.g,R07_KEY,R05_KEY,plan,'9'.repeat(64),'8'.repeat(64),paidUntil,receiptUntil]);
  await db.query('select private.r07_validate_plan($1,$2,$3)',[business,f.g,plan]);
  assert.equal((await db.query("select count(*)::int n from public.worker_definitions where id=any($1::uuid[]) and status='experimental'",[[...new Set(plan.steps.map(s=>s.workerDefinitionId))]])).rows[0].n,4,'The scoped grant does not promote underlying definitions');
  const captureNext=async(name)=>{
   if(!process.env.R12_NEXT_FIXTURE_OUTPUT)return;
   assert.ok(!process.env.R12_POSTGRES_URL,'Next snapshots use an isolated PGlite database only');
   const out=path.resolve(process.env.R12_NEXT_FIXTURE_OUTPUT);assert.ok(path.basename(out).startsWith('r12-next-'),'Designated temporary fixture directory required');await mkdir(out,{recursive:true});
   const blob=await db.dumpDataDir('gzip');await writeFile(path.join(out,`${name}.tgz`),Buffer.from(await blob.arrayBuffer()));
   await writeFile(path.join(out,'metadata.json'),JSON.stringify({businessId:business,goalId:f.g,scopeId,ownerId:R07_OWNER,plan,quote,outputs:r12PhaseOutputFixture(result.intent.comparisonUniverse.audiences[0])}));
  };
  const rpc=async(operation,payload,epoch=null)=>{await db.exec('set role anon');try{return(await db.query('select public.r07_controller($1,$2,$3,$4,$5,$6,$7,$8,$9) result',[business,f.g,operation,payload,randomUUID(),R07_KEY,R07_LEASE,epoch,R05_KEY])).rows[0].result;}finally{await db.exec('reset role');}};
  assert.equal(await rpc('read',{}),null,'Exact scoped read before plan creation remains supported');
  const foreignBusiness=(await db.query('select public.r05_seed(1000) b')).rows[0].b,foreignFixture=(await db.query('select * from public.r05_fixture where b=$1',[foreignBusiness])).rows[0];
  await assert.rejects(db.query('select public.r07_controller($1,$2,$3,$4,$5,$6,$7,$8,$9)',[foreignBusiness,foreignFixture.g,'read',{},randomUUID(),R07_KEY,R07_LEASE,null,R05_KEY]),/r12_exact_scoped_controller_authority_required/);
  await assert.rejects(rpc('plan',{plan:{...plan,format:'r07.1'},expectedVersion:0,reason:'Denied legacy escape',evidenceHash:'5'.repeat(64)}),/r12_exact_scoped_controller_authority_required/);
  for(const [b,op,payload] of [[business,'legacy_settle',{}],[business,'existing_effect_read',{}],[business,'prepare',{workflowRunId:f.w,operationKey:'browser.planner'}],[foreignBusiness,'prepare',{workflowRunId:randomUUID(),operationKey:'browser.planner'}]])await assert.rejects(db.query('select public.r05_admission_server($1,$2,$3,$4)',[b,op,payload,R05_KEY]),/r12_exact_scoped_admission_authority_required/);
  for(const endpoint of ['r11_research_server','r11_research_server_v2'])await assert.rejects(db.query(`select public.${endpoint}($1,$2,$3,$4)`,[business,'load',{},R05_KEY]),/r12_scoped_key_not_r11_authority/);
  const legacyRequest=randomUUID();await db.query('insert into private.r05_requests(id,business_id,workflow_run_id,policy_id,idempotency_key,request_hash,payload,source_key,currency,liability_microunits) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[legacyRequest,foreignBusiness,foreignFixture.w,foreignFixture.policy,'legacy-boundary-check','6'.repeat(64),{operationKey:'browser.planner'},'r05:legacy-boundary-check','USD',10]);
  for(const op of ['reserve','dispatch','release_unsent','settle','readback'])await assert.rejects(db.query('select public.r05_admission_server($1,$2,$3,$4)',[foreignBusiness,op,{requestId:legacyRequest},R05_KEY]),/r12_exact_scoped_admission_authority_required/);
  await rpc('plan',{plan,expectedVersion:0,reason:'Inert scoped controller qualification',evidenceHash:'5'.repeat(64)});
  await captureNext('current');
  const store={read:()=>rpc('read',{}),command:(operation,payload,epoch)=>rpc(operation,['schedule','reserve'].includes(operation)?{...payload,runtimeCapability:'inert-r12-runtime-capability-123456789'}:payload,epoch)};
  const {driveQuestOnce}=require('../.core-tests/core/quest-controller.js');let dispatched=0;
  const {buildDiscoveryR12PhaseRequest,projectDiscoveryR12Phase,readDiscoveryR12PhaseInputs}=require('../.core-tests/products/discovery-r12-runtime.js');
  const operation=async(attemptId,operation,payload)=>{await db.exec('set role anon');try{return(await db.query('select public.r12_discovery_server($1,$2,$3,$4,$5) result',[business,attemptId,operation,payload,R07_KEY])).rows[0].result;}finally{await db.exec('reset role');}};
  const adapters=Object.fromEntries(plan.steps.map(step=>[step.adapter,{qualificationHash:step.qualificationHash,workflowDefinitionId:step.workflowDefinitionId,workerDefinitionId:step.workerDefinitionId,mode:'qualification',prepare:async ctx=>{const actualRequest=buildDiscoveryR12PhaseRequest(ctx,readDiscoveryR12PhaseInputs(ctx,await operation(ctx.attempt.id,'inputs',{}))),inspected=await inspectDiscoveryR12Wire(routeDiscoveryR12Request(actualRequest,'plan',quote.luna),'plan');return {wire:inspected.wire,descriptor:{workflowRunId:ctx.attempt.id,operationKey:ctx.step.operationKey,requestHash:inspected.requestHash,idempotencyKey:`r07:${ctx.attempt.id}`,wireRequestHash:inspected.wireHash,wireRequestBytes:inspected.wireBytes,providerModelId:'openai/gpt-5.6-luna',maximumOutputTokens:1500,accounting:{kind:'r05'},sourceDomains:amendment.allowedDomains,dataClasses:phaseData('plan'),accountId:null,accountRevision:null,currency:'USD',liabilityMicrounits:String(quote.ceilings.plan)}};},dispatch:async()=>{dispatched++;throw Error('Source bridge is closed; adapter dispatch must not run');},reconcile:async()=>({status:'unknown'})}]));
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
  const effectStore={operation,settle:async(attemptId,settlement)=>{await rpc('settle',{attemptId,settlement});},dispatchedAt:async attemptId=>(await operation(attemptId,'load',{})).dispatchedAt};
  const outputs=r12PhaseOutputFixture(result.intent.comparisonUniverse.audiences[0]),output=outputs.plan;
  let postCount=0,getCount=0;
  const fetcher=async(url,init)=>{
   if(init.method==='POST'){postCount++;assert.equal((await db.query('select count(*)::int n from private.r12_discovery_transport_claims')).rows[0].n,1);assert.equal(JSON.parse(init.body).model,'openai/gpt-5.6-luna');return new Response(JSON.stringify({id:'gen-r12-inert-planner',model:'openai/gpt-5.6-luna-20260709',choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150,cost:0.00001}}),{status:200});}
   assert.equal(init.method,'GET');getCount++;assert.match(String(url),/generation\?id=gen-r12-inert-planner$/);assert.equal((await db.query('select count(*)::int n from private.r12_discovery_candidates')).rows[0].n,1,'Useful output is durable before metadata GET');
   return new Response(JSON.stringify({error:{message:'Not indexed yet'}}),{status:404});
  };
  const step=plan.steps[0],options={scope:amendment,phase:'plan',identity:{qualificationHash:step.qualificationHash,workflowDefinitionId:step.workflowDefinitionId,workerDefinitionId:step.workerDefinitionId,mode:'qualification'},dataClasses:phaseData('plan'),store:effectStore,request:async ctx=>buildDiscoveryR12PhaseRequest(ctx,readDiscoveryR12PhaseInputs(ctx,await operation(ctx.attempt.id,'inputs',{}))),quote:async()=>quote,project:async(qualified,ctx,request)=>projectDiscoveryR12Phase(ctx,readDiscoveryR12PhaseInputs(ctx,await operation(ctx.attempt.id,'inputs',{})),qualified,request),config:{apiKey:'inert-r12-adapter-fixture',baseUrl:'https://openrouter.ai/api/v1',appUrl:'https://agent-labs-two.vercel.app',appName:'Agent Labs'},fetcher};
  adapters[step.adapter]=createDiscoveryR12QuestAdapter(options);
  await assert.rejects(driveQuestOnce(store,{adapters}),error=>error instanceof DiscoveryR12ReceiptPending);
  assert.equal(postCount,1);assert.equal(getCount,1);
  const snapshot=await store.read(),attempt=snapshot.attempts[0],saved=await operation(attempt.id,'load',{});
  await captureNext('pending');
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
  const phaseFetchers={};let ownerContinuationCalls=0;
  const ownerContext={userId:R07_OWNER,businesses:[{id:business,name:'Inert Business'}],supabase:{auth:{getClaims:async()=>({data:{claims:{sub:R07_OWNER}},error:null})},rpc:async(name,args)=>{await db.exec('set role authenticated');try{
   if(name==='r12_discovery_owner_read')return{data:(await db.query('select public.r12_discovery_owner_read($1,$2,$3) result',[args.p_business_id,args.p_scope_id,args.p_activation])).rows[0].result,error:null};
   assert.equal(name,'r05_policy_owner');return{data:(await db.query('select public.r05_policy_owner($1,$2,$3,$4) result',[args.p_business_id,args.p_operation,args.p_payload,args.p_submission_id])).rows[0].result,error:null};
  }catch(error){return{data:null,error};}finally{await db.exec('reset role');}}}};
  const ownerActions=source('src/products/discovery-r12-server.ts',{'server-only':{},'node:crypto':require('node:crypto'),'../lib/core-ui/owner-business':owner,'../core/quest-plan':require('../.core-tests/core/quest-plan.js'),'../core/quest-controller':require('../.core-tests/core/quest-controller.js'),'./discovery-v2':require('../.core-tests/products/discovery-v2.js'),'./discovery-r12-runtime':require('../.core-tests/products/discovery-r12-runtime.js'),'./discovery-r12-adapter':require('../.core-tests/products/discovery-r12-adapter.js'),'./discovery-r12-wire':require('../.core-tests/products/discovery-r12-wire.js'),'./discovery-r12-server-dependencies':{discoveryR12ServerDependencies:()=>({
   createController:(b,g,keys)=>{assert.equal(b,business);assert.equal(g,f.g);assert.deepEqual(keys,{controllerKey:R07_KEY,admissionKey:R05_KEY});return store;},
   createClient:()=>({rpc:async(name,args)=>{assert.equal(name,'r12_discovery_server');assert.equal(args.p_server_key,R07_KEY);assert.equal(args.p_business_id,business);return{data:await operation(args.p_attempt_id,args.p_operation,args.p_payload),error:null};}}),
   quote:async()=>quote,createAdapter:opts=>createDiscoveryR12QuestAdapter({...opts,config:options.config,fetcher:(url,init)=>{ownerContinuationCalls++;assert.equal(opts.phase,'review','Only the final phase remains');return phaseFetchers[opts.phase](url,init);}})
  })}});
  await assert.rejects(ownerActions.continueDiscoveryR12(ownerContext,business,scopeId),/owner_action_unavailable/,'SQL ownership defeats stale owner context');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[R07_OWNER]);
  assert.deepEqual(await ownerActions.prepareDiscoveryR12Authority(ownerContext,business,scopeId),{controllerKeyHash:createHash('sha256').update(R07_KEY).digest('hex'),admissionKeyHash:createHash('sha256').update(R05_KEY).digest('hex'),authorityCreated:false});
  const ownerApi=source('src/products/discovery-r12-owner.ts',{'server-only':{},'../lib/core-ui/owner-business':owner,'./discovery-r12-runtime':require('../.core-tests/products/discovery-r12-runtime.js')});
  for(const phase of phaseKeys.slice(1)){
   const phaseStep=plan.steps.find(step=>step.key===phase);
   phaseFetchers[phase]=async(url,init)=>{
    const model=phase==='review'?'anthropic/claude-4.5-haiku-20251001':'openai/gpt-5.6-luna-20260709',id=`gen-r12-inert-${phase}`;
    if(init.method==='POST'){
     postCount++;const body=JSON.parse(init.body);assert.deepEqual(body.provider.only,[phase==='review'?'amazon-bedrock/us':'azure/us']);
     const message=phase==='search1'?{content:'Bounded cited source context.',annotations:outputs.search1.annotations}:{content:JSON.stringify(outputs[phase])};
     return new Response(JSON.stringify({id,model,choices:[{finish_reason:'stop',message}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150,cost:0.00001,...(phase==='search1'?{server_tool_use_details:{web_search_requests:1}}:{})}}),{status:200});
    }
    getCount++;assert.equal(init.method,'GET');assert.ok((await db.query("select 1 from private.r12_discovery_candidates where candidate->>'providerRequestId'=$1",[id])).rows.length,'Every phase is staged before its receipt GET');
    return new Response(JSON.stringify({data:{id,provider_name:phase==='review'?'Amazon Bedrock':'Azure',model}}),{status:200});
   };
   adapters[phaseStep.adapter]=createDiscoveryR12QuestAdapter({...options,phase,dataClasses:phaseData(phase),identity:{qualificationHash:phaseStep.qualificationHash,workflowDefinitionId:phaseStep.workflowDefinitionId,workerDefinitionId:phaseStep.workerDefinitionId,mode:'qualification'},fetcher:phaseFetchers[phase]});
   if(phase==='review'){
    assert.equal((await driveQuestOnce(store,{adapters})).reason,'scheduled');
    const saved=(await ownerContext.supabase.rpc('r12_discovery_owner_read',{p_business_id:business,p_scope_id:scopeId,p_activation:false})).data;
    const scheduled=ownerApi.parseDiscoveryR12Workspace(saved,business,scopeId);
    assert.equal(scheduled.phases[4].status,'scheduled');assert.equal(scheduled.phases[4].reason,phaseStep.reason);
    assert.equal(scheduled.phases.filter(p=>p.status==='completed').length,4);assert.equal(scheduled.cost.knownMicrousd,'40');
    assert.equal(ownerApi.discoveryR12CanContinue(scheduled),true);
    for(const value of ['', ' ', 'x'.repeat(241), 1, {}]){const bad=structuredClone(saved);bad.phases[4].reason=value;assert.throws(()=>ownerApi.parseDiscoveryR12Workspace(bad,business,scopeId));}
    for(const target of ['reason','diagnostic']){const bad=structuredClone(saved);if(target==='reason')bad.reason='A sentence is not a state code';else bad.phases[0].receipt.diagnostic={code:'Not a diagnostic code',httpStatus:404};assert.throws(()=>ownerApi.parseDiscoveryR12Workspace(bad,business,scopeId));}
    await captureNext('scheduled-review');
    assert.equal((await ownerActions.continueDiscoveryR12(ownerContext,business,scopeId)).status,'completed');continue;
   }
   assert.equal((await driveQuestOnce(store,{adapters})).reason,'scheduled',`${phase} schedule`);
   assert.equal((await driveQuestOnce(store,{adapters})).reason,'reserved',`${phase} reserve`);
   assert.equal((await driveQuestOnce(store,{adapters})).reason,'response_persisted',`${phase} response`);
   assert.equal((await driveQuestOnce(store,{adapters})).reason,'response_projected',`${phase} complete`);
  }
  assert.equal((await driveQuestOnce(store,{adapters})).status,'completed');
  assert.equal(postCount,5);assert.equal(getCount,6);assert.equal(ownerContinuationCalls,2);
  assert.equal((await ownerActions.continueDiscoveryR12(ownerContext,business,scopeId)).status,'completed');assert.equal(ownerContinuationCalls,2,'Repeated owner Continue cannot create another effect');
  await captureNext('completed');
  const final=await store.read();assert.equal(final.attempts.length,5);assert.ok(final.attempts.every(attempt=>attempt.status==='completed'));
  const decision=(await db.query("select content->'result' result from private.r07_responses where attempt_id=$1",[final.attempts.find(attempt=>attempt.stepKey==='review').id])).rows[0].result;
  assert.equal(decision.outcome,'NEEDS_MORE_EVIDENCE');assert.equal(decision.candidateId,null);
  assert.equal((await db.query('select private.stage13v2_budget_authority($1,false) result',[rootId])).rows[0].result.knownActualMicrousd,109530);
  assert.equal((await db.query('select count(*)::int n from public.product_research_cost_reservations')).rows[0].n,1,'Five new paid identities remain R05-only, not copied legacy reservations');

  // Historical projection uses the original marked-time input view, never an
  // expiry rewrite. A future live-scope check remains denied at the same cutoff.
  const reviewAttempt=final.attempts.find(attempt=>attempt.stepKey==='review'),reviewStep=plan.steps[4];
  const reviewContext={planId:final.planId,planHash:final.planHash,plan,step:reviewStep,attempt:reviewAttempt,knowledge:final.knowledge};
  const rawInput=await operation(reviewAttempt.id,'inputs',{}),readback=await operation(reviewAttempt.id,'load',{});
  assert.equal(rawInput.inputMode,'receipt');assert.equal(rawInput.validationAt,readback.dispatchedAt);
  const future=Date.parse(amendment.expiresAt)+1000;assert.ok(future<Date.parse(readback.receipt.receiptExpiresAt));
  await assert.rejects(db.query('select private.r12_discovery_scope_at(p,$2::timestamptz) from private.r07_plans p where p.id=$1',[final.planId,new Date(future).toISOString()]),/scope_no_longer_current/);
  const {qualifyDiscoveryR12Candidate}=require('../.core-tests/products/discovery-r12-receipt.js');
  const qualified=qualifyDiscoveryR12Candidate(readback.candidate,{scopeId,attemptId:reviewAttempt.id,requestId:reviewAttempt.requestId,phase:'review',request:JSON.parse(readback.binding.requestJson),maximumMicrousd:quote.ceilings.review,dispatchedAt:readback.dispatchedAt,receiptExpiresAt:readback.receipt.receiptExpiresAt},readback.proof);
  const originalClock=Date.now;
  try{
   Date.now=()=>future;const inputs=readDiscoveryR12PhaseInputs(reviewContext,rawInput);
   assert.equal(projectDiscoveryR12Phase(reviewContext,inputs,qualified,JSON.parse(readback.binding.requestJson)).result.reviewHash,decision.reviewHash);
   assert.throws(()=>buildDiscoveryR12PhaseRequest(reviewContext,inputs),/inputs_unverified/,'Receipt reconstruction grants no new request authority');
  }finally{Date.now=originalClock;}
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[R07_OWNER]);
  const ownerRead=async(activation=false)=>{await db.exec('set role authenticated');try{return(await db.query('select public.r12_discovery_owner_read($1,$2,$3) result',[business,scopeId,activation])).rows[0].result;}finally{await db.exec('reset role');}};
  const historyRead=async()=>{await db.exec('set role authenticated');try{return(await db.query('select public.r12_discovery_result_read($1,$2) result',[business,scopeId])).rows[0].result;}finally{await db.exec('reset role');}};
  const {reconstructDiscoveryR12Result}=require('../.core-tests/products/discovery-r12-runtime.js');
  const savedHistory=await historyRead(),fullResult=reconstructDiscoveryR12Result(savedHistory,business,scopeId);
  const presentation=loadSource('src/app/dashboard/research-qualification/presentation.ts',{'../../../research/qualification-owner-contract':require('../.core-tests/research/qualification-owner-contract.js')});
  const resultView=loadSource('src/components/console/console-r12-result.tsx',{'@/app/dashboard/research-qualification/presentation':presentation});
  const markup=renderToStaticMarkup(React.createElement(resultView.ConsoleR12Result,{result:fullResult,observedAt:Date.now()}));
  for(const text of ['Needs more evidence','Original concepts and hypotheses','Geographic comparison','Independent review and missing evidence','Sources and exact evidence','No learning test qualified','grants no creative generation'])assert.ok(markup.includes(text),text);
  for(const country of ['US','GB','AU','NZ'])assert.ok(markup.includes(country));
  assert.doesNotMatch(markup,/requestJson|wireBody|controllerKey|admissionKey/);
  assert.equal(fullResult.review.outcome,'NEEDS_MORE_EVIDENCE');assert.equal(fullResult.dossier.shortlist.length,3);assert.equal(fullResult.assessment.marketComparisons.length,4);assert.equal(fullResult.evidence.evidencePack.evidence.length,2);assert.deepEqual(new Set(fullResult.assessment.marketComparisons[0].evidenceRefs.map(ref=>ref.evidenceId)),new Set(fullResult.evidence.evidencePack.evidence.map(item=>item.id)));assert.equal(fullResult.executionAuthorized,false);assert.equal(fullResult.phaseReceipts.length,5);
  for(const mutate of [r=>r.current.response.result.reviewHash='0'.repeat(64),r=>r.inputs.dependencies[1].candidate.output.annotations=[],r=>r.context.plan.businessId=randomUUID()]){const bad=structuredClone(savedHistory);mutate(bad);assert.throws(()=>reconstructDiscoveryR12Result(bad,business,scopeId));}
  const ownerView=ownerApi.parseDiscoveryR12Workspace(await ownerRead(),business,scopeId);
  assert.equal(ownerView.state,'completed');assert.equal(ownerView.phases.length,5);assert.deepEqual(ownerView.cost,{knownMicrousd:'50',heldMicrousd:'0',hasUnknown:false});
  assert.equal(ownerApi.discoveryR12CanContinue(ownerView),false);
  for(const field of ['requestJson','wireBody','providerRequestId','controllerKeyHash','admissionKeyHash'])assert.equal(JSON.stringify(ownerView).includes(field),false,'Ordinary owner metadata does not expose private runtime material');
  for(const mutate of [v=>v.phases=[],v=>v.dispatchUntil='invalid',v=>v.phases[0].status='corrupt',v=>v.cost.knownMicrousd='0',v=>v.planHash='bad',v=>v.rootFunding.knownActualMicrousd=0,v=>{v.state='running';v.activeWindow=true;v.paused=true;}]){const bad=structuredClone(ownerView);mutate(bad);assert.throws(()=>ownerApi.parseDiscoveryR12Workspace(bad,business,scopeId));}
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",['95050000-0000-4000-8000-000000000002']);
  await assert.rejects(ownerRead(),/owner_required/);await assert.rejects(historyRead(),/owner_required/);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[R07_OWNER]);
  // A real owner pause blocks further receipt activity while preserving output.
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[R07_OWNER]);
  await db.query("select public.r05_policy_owner($1,'pause',$2,$3)",[business,{kind:'business',id:business},randomUUID()]);
  const pausedView=ownerApi.parseDiscoveryR12Workspace(await ownerRead(),business,scopeId);assert.equal(pausedView.paused,true);assert.equal(pausedView.policyRevoked,false);
  const stopped=await operation(reviewAttempt.id,'load',{});assert.equal(stopped.receipt.status,'stopped');assert.deepEqual(stopped.candidate,readback.candidate);
  assert.equal((await operation(reviewAttempt.id,'claim',{candidateHash:stopped.receipt.candidateHash})).claimed,false);
  assert.equal((await adapters[reviewStep.adapter].reconcile(reviewContext)).status,'unknown');assert.equal(getCount,6);assert.equal(postCount,5);
  assert.deepEqual(await ownerActions.stopDiscoveryR12(ownerContext,business,scopeId),{stopped:true});
  assert.deepEqual(reconstructDiscoveryR12Result(await historyRead(),business,scopeId),fullResult,'Completed history survives pause and revocation without renewing authority');
  const originalHistoryClock=Date.now;try{Date.now=()=>future+86400000;assert.deepEqual(reconstructDiscoveryR12Result(await historyRead(),business,scopeId),fullResult,'Expired history remains inspectable without renewed freshness');}finally{Date.now=originalHistoryClock;}
  await db.query("update public.installed_packs set status='superseded',superseded_at=clock_timestamp() where id=$1",[f.installation]);
  const laterWorkflow=randomUUID();await db.query('insert into public.workflow_runs(id,business_id,workflow_definition_id,status,idempotency_key) values($1::uuid,$2,$3,$4,($1::uuid)::text)',[laterWorkflow,business,plan.steps[0].workflowDefinitionId,'failed']);
  const laterId=randomUUID(),laterIntent={...prior,id:laterId,expiresAt:new Date(now+86400000).toISOString()},laterVariables={...variables,intent:laterIntent,policyHash:discoveryV2Hash(laterIntent),ownerKickoff:{followUpBasis:{rootId}}};
  await db.query(`insert into public.product_experiments(id,business_id,candidate_id,workflow_run_id,fingerprint,hypothesis,variables,audience,status,measurement_plan,discovery_version,failure,completed_at) values($1,$2,null,$3,$4,'Later retained research round',$5,'Adult outdoor and nature enthusiasts','failed','{"version":"pod-discovery-2.0","testPlan":null}','pod-discovery-2.0','Unrelated later failure',clock_timestamp())`,[laterId,business,laterWorkflow,'e'.repeat(64),laterVariables]);
  for(const [index,amount] of [100000,50000].entries())await db.query('insert into public.product_research_cost_reservations(id,business_id,experiment_id,workflow_run_id,attempt_key,reserved_microusd,request_hash,estimate) values($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),business,laterId,laterWorkflow,`search:${index+1}`,amount,'7'.repeat(64),{version:'discovery-estimate-2.0'}]);
  assert.equal((await db.query('select private.stage13v2_budget_authority($1,false) result',[rootId])).rows[0].result.remainingMicrousd,1740470);
  const rowsBefore=(await db.query('select (select count(*) from private.r07_attempts) attempts,(select count(*) from private.r05_requests) requests,(select count(*) from private.r12_discovery_receipt_checks) checks')).rows[0];
  assert.deepEqual(reconstructDiscoveryR12Result(await historyRead(),business,scopeId),fullResult,'History survives superseded Knowledge, a successor and unresolved later funding');
  assert.deepEqual((await db.query('select (select count(*) from private.r07_attempts) attempts,(select count(*) from private.r05_requests) requests,(select count(*) from private.r12_discovery_receipt_checks) checks')).rows[0],rowsBefore,'History read creates no work or receipt checks');
  assert.equal(postCount,5);assert.equal(getCount,6);
  const revokedView=ownerApi.parseDiscoveryR12Workspace(await ownerRead(),business,scopeId);assert.equal(revokedView.policyRevoked,true);assert.equal(revokedView.state,'completed','Completed research stays completed after its policy is stopped');
  await db.query('update public.businesses set owner_user_id=$1 where id=$2',['95050000-0000-4000-8000-000000000002',business]);
  await assert.rejects(rpc('read',{}),/r12_exact_scoped_controller_authority_required/,'Old authority cannot read a transferred Business');
  await assert.rejects(operation(reviewAttempt.id,'load',{}),/r12_exact_scoped_controller_authority_required|r12_attempt_scope_required/);
  await assert.rejects(db.query('select public.r05_admission_server($1,$2,$3,$4)',[business,'readback',{requestId:reviewAttempt.requestId},R05_KEY]),/r12_exact_scoped_admission_authority_required/);
  await assert.rejects(historyRead(),/owner_required/);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",['95050000-0000-4000-8000-000000000002']);
  assert.deepEqual(reconstructDiscoveryR12Result(await historyRead(),business,scopeId),fullResult,'The current owner can inspect preserved Business history');




 }finally{for(const [key,value] of Object.entries(priorEnv)){if(value===undefined)delete process.env[key];else process.env[key]=value;}await db.close();}
});
