/** Inert isolated rehearsal. No network or Production connection. Only the
 * explicit target IDs/full-row hash literals are rendered to fixture pins;
 * production exports, financial baselines, limits, predicates and SQL logic stay unchanged. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {r12PhaseOutputFixture} from './r12-phase-output-fixture.mjs';
import {randomUUID,createHash} from 'node:crypto';
import * as recipes from '../../scripts/r12-research-bootstrap.mjs';
import {REBIND,REBOUND_ACTIVATION_SQL} from '../../scripts/r12-business-scope-rebind.mjs';
const rebindRehearsal=process.env.R12_REBIND_REHEARSAL==='1';
import {r04SqlBootstrap} from './r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './r10-sql-fixture.mjs';
import {r07FixtureSetup,R07_OWNER} from './r07-sql-fixture.mjs';
import {discoveryKnowledgeFixture} from '../discovery-v2-fixtures.mjs';
import {r12QuoteFixture} from './r12-provider-fixture.mjs';
const root=process.cwd(), req=createRequire(root+'/package.json'),ts=req('typescript');
const sqlReq=createRequire((process.env.R12_SQL_TEST_HOST??process.env.R11_SQL_TEST_HOST)+'/package.json'),{PGlite}=sqlReq('@electric-sql/pglite'),{pgcrypto}=sqlReq('@electric-sql/pglite/contrib/pgcrypto');
const db=new PGlite({extensions:{pgcrypto}}),log=[],sqlErrors=[],calls=[];let actor=R07_OWNER,interruptOperation=null;
const sha=s=>createHash('sha256').update(s).digest('hex');
const value=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
function source(file,deps){const m={exports:{}};new Function('require','module','exports',ts.transpileModule(readFileSync(root+'/'+file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{assert.ok(name in deps,name);return deps[name];},m,m.exports);return m.exports;}
const ownerClient={auth:{getClaims:async()=>({data:{claims:{sub:actor}},error:null})},rpc:async(name,args)=>{
 const fields={r04_quest_transition:['p_business_id','p_operation','p_payload','p_submission_id'],r04_research_link_preview:['p_business_id','p_experiment_id'],r04_quest_read:['p_business_id','p_goal_id','p_limit','p_offset'],r05_policy_owner:['p_business_id','p_operation','p_payload','p_submission_id'],r05_admission_read:['p_business_id','p_policy_id','p_limit','p_offset']}[name];assert.ok(fields,name);
 calls.push({name,operation:args.p_operation,actor});await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);await db.exec('set role authenticated');
 try{const data=(await db.query(`select public.${name}(${fields.map((_,i)=>'$'+(i+1)).join(',')}) result`,fields.map(k=>args[k]??null))).rows[0].result;if(name==='r04_quest_transition'&&args.p_operation===interruptOperation){interruptOperation=null;throw Error('inert_saved_response_lost');}return{data,error:null};}
 catch(error){sqlErrors.push(error.message);return{data:null,error};}finally{await db.exec('reset role');}
}};
ownerClient.from=table=>{assert.ok(['businesses','product_experiments'].includes(table));const filters=[];let columns='';const q={select:fields=>{assert.match(fields,/^[a-z_,]+$/);columns=fields;return q;},eq:(key,v)=>{assert.ok(['id','business_id','owner_user_id'].includes(key));filters.push([key,v]);return q;},maybeSingle:async()=>{await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);await db.exec('set role authenticated');try{const rows=(await db.query(`select ${columns} from public.${table} where ${filters.map(([key],i)=>key+'=$'+(i+1)).join(' and ')} limit 2`,filters.map(([,v])=>v))).rows;return{data:rows.length===1?rows[0]:null,error:rows.length>1?Error('ambiguous'):null};}finally{await db.exec('reset role');}}};return q;};
const deps={'@/lib/supabase/server':{createClient:async()=>ownerClient},'@/core/quest-intake':req(root+'/.core-tests/core/quest-intake.js'),'@/core/quest-contract':req(root+'/.core-tests/core/quest-contract.js'),'@/core/admission-contract':req(root+'/.core-tests/core/admission-contract.js')};
const questApi=source('src/app/dashboard/quests/actions.ts',deps),policyApi=source('src/app/dashboard/quests/controls/actions.ts',deps);
const sendQuest=body=>questApi.saveQuestIntent(body.p_business_id,body.p_operation,body.p_payload,body.p_submission_id);
const sendPolicy=body=>policyApi.saveOperatingControl(body.p_business_id,body.p_operation,body.p_payload,body.p_submission_id);
const qok=async body=>{const r=await sendQuest(body);assert.equal(r.ok,true,sqlErrors.at(-1));return r.result;};
let business;
const owned=body=>({...body,p_business_id:business});
const {buildDiscoveryIntentFromGoal}=req(root+'/.core-tests/products/discovery-v2-goal.js');
const {discoveryV2Hash}=req(root+'/.core-tests/products/discovery-v2.js');
try{
 await db.exec(r04SqlBootstrap+sessionBootstrap);
 for(const file of readdirSync(root+'/supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync(root+'/supabase/migrations/'+file,'utf8'));
 await db.exec("set timezone='UTC'");await db.exec(r07FixtureSetup(root));business=(await value('select public.r05_seed(848063) b')).b;
 const f=await value('select * from public.r05_fixture where b=$1',[business]);
 const body=rebindRehearsal?structuredClone(REBIND.previousContent):(await value('select content from private.r04_business_versions where business_id=$1 and revision=1',[business])).content;
 for(let revision=1;revision<6;revision++)await qok({p_business_id:business,p_operation:'business.save',p_payload:{expectedRevision:revision,content:body,preference:'setup'},p_submission_id:randomUUID()});
 const businessHash=(await value('select content_hash hash from private.r04_business_versions where business_id=$1 and revision=6',[business])).hash;
 // Register actual repository manifests, without status promotion or an installation.
 const knowledge=discoveryKnowledgeFixture();for(const release of knowledge.snapshot.releases)await db.query('select private.stage10_register_pack($1)',[release.manifest]);
 const pack=(await value("select id from public.packs where pack_key='workflow.product-discovery-v2' and version='1.0.0'")).id;
 const fd=await value("select id,private.r04_hash(to_jsonb(w)) hash from public.workflow_definitions w where workflow_key='product.discovery-v2.one'");
 const workers=(await db.query("select id,worker_key,private.r04_hash(to_jsonb(w)) hash from public.worker_definitions w where worker_key like 'product.discovery-v2.%'")).rows;
 const snapshotHash=(await value('select private.r04_hash(jsonb_build_object(\'rootPackId\',$1::uuid,\'releases\',private.stage10_resolve($1,true))) hash',[pack])).hash;
 const roots=[];let rootIntent,priorIntent;
 for(let n=0;n<9;n++){
  const id=randomUUID(),wf=randomUUID(),intent=buildDiscoveryIntentFromGoal({id,businessId:business,goal:recipes.TARGET.objective,maximumMicrousd:n?2000000:400000,maximumCollections:1,now:Date.now()-4*86400000});
  if(n===8)intent.limits.maximumNewCollections=0;
  await db.query("insert into public.workflow_runs(id,business_id,workflow_definition_id,idempotency_key,status,input) values($1,$2,$3,$4,'failed',$5)",[wf,business,fd.id,'inert-bootstrap-history-'+n,{intentId:id}]);
  const variables={intent,policyHash:discoveryV2Hash(intent),semanticGoalHash:'a'.repeat(64),budgetAuthorityRootId:n?roots[0].id:id,ownerKickoff:{followUpBasis:n?{rootId:roots[n-1].id,reason:'retry_after_known_failed_call'}:null}};
  await db.query(`insert into public.product_experiments(id,business_id,workflow_run_id,fingerprint,hypothesis,variables,audience,status,measurement_plan,discovery_version,failure,completed_at) values($1,$2,$3,$4,'Synthetic preserved research root',$5,'Adult outdoor and nature enthusiasts','failed','{"version":"pod-discovery-2.0","testPlan":null}','pod-discovery-2.0','Historical inert failure',clock_timestamp())`,[id,business,wf,sha(id),variables]);
  roots.push({id,wf});if(n===0){rootIntent=intent;await db.query("select set_config('request.jwt.claim.sub',$1,false)",[R07_OWNER]);await db.exec('set role authenticated');try{await db.query('select public.approve_product_research_funding($1,$2,400000,2000000,$3)',[id,randomUUID(),'Inert owner-approved cumulative research funding fixture']);}finally{await db.exec('reset role');}}
  priorIntent=intent;
 }
 const rootId=roots[0].id,priorId=roots[8].id;
 // Synthetic retained root charge plus unrelated same-Business legacy charge.
 async function cost(experiment,wf,key,actual){const rid=randomUUID();await db.query('insert into public.product_research_cost_reservations(id,business_id,experiment_id,workflow_run_id,attempt_key,reserved_microusd,request_hash,estimate) values($1,$2,$3,$4,$5,$6,$7,$8)',[rid,business,experiment,wf,key,actual,'1'.repeat(64),{version:'discovery-estimate-2.0'}]);const receipt='gen-inert-'+rid;await db.query('insert into private.r05_legacy_attestations(business_id,workflow_run_id,source_key,reported_microusd,provider_request_id,receipt_hash) values($1,$2,$3,$4,$5,$6)',[business,wf,'research:'+rid,actual,receipt,'2'.repeat(64)]);await db.query('insert into public.product_research_cost_settlements(business_id,reservation_id,reported_microusd,provider_request_id,fingerprint) values($1,$2,$3,$4,$5)',[business,rid,actual,receipt,'3'.repeat(64)]);}
 await cost(rootId,roots[0].wf,'plan:1',109480);
 const unrelated=(await value('select public.r05_legacy($1,$2,537371) id',[business,'selector:luna.standard'])).id;const unrelatedReceipt='gen-inert-unrelated-'+unrelated;await db.query('insert into private.r05_legacy_attestations(business_id,workflow_run_id,source_key,reported_microusd,provider_request_id,receipt_hash) values($1,$2,$3,537371,$4,$5)',[business,f.w,'research:'+unrelated,unrelatedReceipt,'4'.repeat(64)]);await db.query('insert into public.product_research_cost_settlements(business_id,reservation_id,reported_microusd,provider_request_id,fingerprint) values($1,$2,537371,$3,$4)',[business,unrelated,unrelatedReceipt,'5'.repeat(64)]);
 for(let revision=1;revision<6;revision++){
  const payload={...f.payload,businessRevision:6,expectedCapRevision:revision,expectedExposureMicrounits:'646851'};
  const proposed=await ownerClient.rpc('r05_policy_owner',{p_business_id:business,p_operation:'propose',p_payload:payload,p_submission_id:randomUUID()});assert.equal(proposed.error,null);
  const confirmed=await ownerClient.rpc('r05_policy_owner',{p_business_id:business,p_operation:'confirm',p_payload:{policyId:proposed.data.id,policyHash:proposed.data.hash},p_submission_id:randomUUID()});assert.equal(confirmed.error,null);
 }
 // Exercise the actual owner-only prepare route and server HMAC boundary.
 process.env.VERCEL_ENV='production';process.env.R05_ADMISSION_SERVER_KEY='inert-bootstrap-only-root-01234567890123456789';process.env.OPENROUTER_API_KEY='inert-never-used-provider-value';
 const ownerCheck=source('src/lib/core-ui/owner-business.ts',{});
 const server=source('src/products/discovery-r12-server.ts',{'../core/request-deadline':req(root+'/.core-tests/core/request-deadline.js'),'./discovery-r12-focused-successor':req(root+'/.core-tests/products/discovery-r12-focused-successor.js'),'./discovery-r12-owner-episode':req(root+'/.core-tests/products/discovery-r12-owner-episode.js'),'server-only':{},'node:crypto':req('node:crypto'),'../lib/core-ui/owner-business':ownerCheck,'../core/quest-plan':req(root+'/.core-tests/core/quest-plan.js'),'../core/quest-controller':req(root+'/.core-tests/core/quest-controller.js'),'./discovery-v2':req(root+'/.core-tests/products/discovery-v2.js'),'./discovery-r12-runtime':req(root+'/.core-tests/products/discovery-r12-runtime.js'),'./discovery-r12-adapter':req(root+'/.core-tests/products/discovery-r12-adapter.js'),'./discovery-r12-wire':req(root+'/.core-tests/products/discovery-r12-wire.js'),'./discovery-r12-server-dependencies':{discoveryR12ServerDependencies:()=>{throw Error('Prepare must not construct runtime dependencies');}}});
 await db.exec('set role authenticated');let verifiedBusiness;try{verifiedBusiness=await value('select id,name from public.businesses where id=$1 and owner_user_id=$2',[business,R07_OWNER]);}finally{await db.exec('reset role');}assert.equal(verifiedBusiness.id,business);
 const ownerContext={userId:R07_OWNER,businesses:[verifiedBusiness],supabase:ownerClient};
 const captureDirectory=process.env.R12_BOOTSTRAP_NEXT_OUTPUT;
 if(captureDirectory)assert.ok(path.isAbsolute(captureDirectory)&&path.basename(captureDirectory).startsWith('r12-next-'));
 const bootstrapDump=captureDirectory?await db.dumpDataDir('gzip'):null;
 const cutoff=new Date(Math.floor((Date.now()+2*3600000)/1000)*1000).toISOString();
 const preparationContract=req(root+'/.core-tests/products/discovery-r12-preparation-contract.js');
 assert.deepEqual(preparationContract.r12PreparationGoalContent(cutoff),recipes.ownerGoalCreateBody(cutoff,randomUUID()).p_payload.content);
 const preparation=source('src/products/discovery-r12-preparation-server.ts',{'server-only':{},'node:crypto':req('node:crypto'),'../lib/core-ui/owner-business':ownerCheck,'../core/quest-contract':req(root+'/.core-tests/core/quest-contract.js'),'./discovery-v2':req(root+'/.core-tests/products/discovery-v2.js'),'./discovery-r12-server':server,'./discovery-r12-preparation-contract':preparationContract});
 const setupInput={businessId:business,priorRoundId:priorId,preparationId:randomUUID(),sourceCutoff:cutoff};
 const goalCount=async()=>Number((await value('select count(*)::int n from private.r04_goal_state where business_id=$1',[business])).n);
 const beforePreparation=await goalCount();
 process.env.VERCEL_ENV='preview';await assert.rejects(preparation.prepareR12OwnerSetup(ownerContext,setupInput));assert.equal(await goalCount(),beforePreparation);process.env.VERCEL_ENV='production';log.push({check:'preparation configuration failure writes no Goal',status:'passed'});
 actor='95050000-0000-4000-8000-000000000002';await assert.rejects(preparation.prepareR12OwnerSetup(ownerContext,setupInput));actor=R07_OWNER;assert.equal(await goalCount(),beforePreparation);log.push({check:'preparation foreign owner cannot write intent',status:'passed'});
 for(const operation of ['quest.save','quest.preference','research.link']){await db.exec('begin');try{interruptOperation=operation;await assert.rejects(preparation.prepareR12OwnerSetup(ownerContext,setupInput));const recovered=await preparation.prepareR12OwnerSetup(ownerContext,setupInput);assert.equal(recovered.goalRevision,2);assert.equal(await goalCount(),beforePreparation+1);assert.deepEqual(await preparation.readR12Preparation(ownerContext,setupInput),recovered);}finally{interruptOperation=null;await db.exec('rollback');}log.push({check:'preparation recovers saved response loss after '+operation,status:'passed'});}
 await db.exec('begin');try{interruptOperation='quest.save';await assert.rejects(preparation.prepareR12OwnerSetup(ownerContext,setupInput));const recovered=await preparation.prepareR12OwnerSetup(ownerContext,{...setupInput,priorRoundId:roots[7].id,preparationId:randomUUID()});assert.equal(recovered.goalRevision,2);assert.equal(await goalCount(),beforePreparation+1);}finally{interruptOperation=null;await db.exec('rollback');}log.push({check:'different prior round in the same original root cannot duplicate an interrupted Goal save',status:'passed'});
 const preparedSetup=await preparation.prepareR12OwnerSetup(ownerContext,setupInput);
 assert.deepEqual(await preparation.prepareR12OwnerSetup(ownerContext,setupInput),preparedSetup);assert.equal(await goalCount(),beforePreparation+1);assert.equal(preparedSetup.authorityCreated,false);
 const otherTab=await preparation.prepareR12OwnerSetup(ownerContext,{...setupInput,preparationId:randomUUID()});assert.equal(otherTab.goalId,preparedSetup.goalId);assert.equal(await goalCount(),beforePreparation+1);assert.notEqual(otherTab.scopeId,preparedSetup.scopeId);
 await assert.rejects(preparation.prepareR12OwnerSetup(ownerContext,{...setupInput,sourceCutoff:new Date(Date.parse(cutoff)+60000).toISOString()}));assert.equal(await goalCount(),beforePreparation+1);log.push({check:'preparation retries and different tabs retain one original Goal; changed cutoff is rejected',status:'passed'});
 const created={id:preparedSetup.goalId},ready={revision:preparedSetup.goalRevision},goalHash=preparedSetup.goalHash;
 const pins=new Map([
 [recipes.TARGET.businessId,business],[recipes.TARGET.rootId,rootId],[recipes.TARGET.priorId,priorId],[recipes.TARGET.packId,pack],[recipes.TARGET.workflowId,fd.id],
 ['97441d08503e1640763a6da50c191ae13aa4b23e86ffe0e2b25b3789005ead12',businessHash],['92894207fbcc149e7e4cf91c924c5feb9adae732321966f86a70b8fa5d8b75fa',discoveryV2Hash(rootIntent)],['f6be5c7bfde7b19fb4bb09a10f13b9d30d519785f7f9a8508a00b3cfe46d8170',discoveryV2Hash(priorIntent)],['6e174b6a90ce9515abe3d27043501b01329f65dc8f25e93ed814b00f917cfcd7','a'.repeat(64)],['6fe1a97c3667b5a9074a53a5156c2357c362871cd2ebd5735c19c39a9f344db0',snapshotHash],['937e21bb9863a31de0cfbb48d97ae675b7a6a540cb05a029ad83e1dbb876e993',fd.hash]
 ]);
 const prodWorkers=[['plan','98b4ff1e-8791-4403-8cec-0b4fd7fdaa79','3dc803226210cbf285e35791fec8d0b91de987442e0d4d7f38cbf1b5d8575f8a'],['research','c1551958-a0fd-47cc-bf86-fa0398a5261b','f5f7ff8b09c98c1c5fd96146547372e821fe8545c73cdf98a7210d5fc88167e0'],['strategy','ebba060f-6f95-4a3f-93ff-c62b3809d7d2','7537fdf72bdab5857de4549fe713bd9307b5c0ec5c23d0a9c6de1b7468e4451f'],['review','b4632bb9-28b0-4e42-baea-5e661dea2952','bf4b9fc6cc86ba4acb0b9fdb0c9d3406129dfda4e3a90fee48f2ff1d567beaa5']];
 for(const [key,id,hash] of prodWorkers){const worker=workers.find(w=>w.worker_key==='product.discovery-v2.'+key);assert.ok(worker);pins.set(id,worker.id);pins.set(hash,worker.hash);}
 const render=sql=>{for(const [from,to] of pins){assert.ok(sql.includes(from),'Missing fixed source pin '+from);sql=sql.replaceAll(from,to);}return sql;};
 const stageSQL=render(recipes.STAGING_SQL),activationSQL=render(recipes.ACTIVATION_SQL);
 if(captureDirectory){const outputs=r12PhaseOutputFixture(priorIntent.comparisonUniverse.audiences[0]);outputs.search1.annotations.forEach((item,index)=>{item.url_citation.url=index?'https://www.mdpi.com/inert-fixture-report':'https://www.ipsos.com/inert-fixture-report';});writeFileSync(path.join(captureDirectory,'bootstrap.tgz'),Buffer.from(await bootstrapDump.arrayBuffer()));writeFileSync(path.join(captureDirectory,'bootstrap-metadata.json'),JSON.stringify({businessId:business,goalId:null,scopeId:setupInput.preparationId,ownerId:R07_OWNER,priorRoundId:priorId,budgetAuthorityRootId:rootId,sourceCutoff:cutoff,outputs,bootstrapPins:[...pins]}));}
 const input={ownerId:R07_OWNER,goalId:created.id,goalRevision:ready.revision,goalHash,scopeId:preparedSetup.scopeId,installationId:preparedSetup.installationId,sourceCutoff:cutoff,approvalHash:sha('inert-approved-packet'),ipsosReviewHash:sha('inert-ipsos-review'),mdpiReviewHash:sha('inert-mdpi-review'),independentReviewHash:sha('inert-independent-review'),executionReviewHash:sha('inert-execution-review'),eligibilityReviewHash:sha('inert-eligibility-review'),quote:r12QuoteFixture()};
 async function run(sql,input,before){
  const kind=sql===stageSQL?'stage':'activate',original=kind==='stage'?recipes.STAGING_SQL:recipes.ACTIVATION_SQL;
  const client={query:async(statement,args)=>{
   if(statement==='begin'){const result=await db.exec(statement);if(before)await before();return result;}
   if(statement===original)return db.exec(sql);
   return args?db.query(statement,args):(/^\s*(DO|set local|create temporary)/.test(statement)?db.exec(statement):db.query(statement));
  }};
  return recipes.runOperatorRecipe(client,kind,input);
 }
 async function rejected(label,fn,pattern){await assert.rejects(fn,pattern);log.push({check:label,status:'passed'});}
 await rejected('staging owner mismatch',()=>run(stageSQL,{...input,ownerId:'95050000-0000-4000-8000-000000000002'}),/bootstrap_owner_changed/);
 await rejected('staging Goal hash drift',()=>run(stageSQL,{...input,goalHash:'0'.repeat(64)}),/bootstrap_goal_pin_changed/);
 await rejected('staging actual Business transfer rolls back',()=>run(stageSQL,input,()=>db.query('update public.businesses set owner_user_id=$1 where id=$2',['95050000-0000-4000-8000-000000000002',business])),/bootstrap_owner_changed/);
 await rejected('staging actual definition status/hash drift rolls back',()=>run(stageSQL,input,()=>db.query("update public.worker_definitions set status='qualified' where id=$1",[workers.find(w=>w.worker_key==='product.discovery-v2.plan').id])),/bootstrap_worker_definition_drift/);
 await rejected('staging quote ceiling drift',()=>run(stageSQL,{...input,quote:{...input.quote,ceilings:{...input.quote.ceilings,plan:23247}}}),/bootstrap_fresh_exact_quote_required/);
 const appendCapDrift=()=>db.query("insert into private.r05_cap_versions(business_id,currency,revision,maximum_microunits,policy_id) select business_id,currency,revision+1,maximum_microunits+1,policy_id from private.r05_cap_versions where business_id=$1 and currency='USD' order by revision desc limit 1",[business]);
 await rejected('staging actual cap-state drift rolls back',()=>run(stageSQL,input,appendCapDrift),/bootstrap_business_financial_drift/);
 const staged=await run(stageSQL,input);log.push({check:'positive staging, five operations/adapters and zero authority',status:'passed'});
 assert.equal((await value('select count(*)::int n from private.r12_discovery_authorities')).n,0);
 assert.equal((await value('select count(*)::int n from private.r05_operations where operation_key like $1',['research.r12.'+input.scopeId+'.%'])).n,5);
 await rejected('staging replay',()=>run(stageSQL,input),/bootstrap_staging_identity_already_used/);
 actor='95050000-0000-4000-8000-000000000002';assert.equal((await sendPolicy(owned(recipes.ownerPolicyProposeBody(staged,randomUUID())))).ok,false);actor=R07_OWNER;log.push({check:'actual owner policy API rejects other owner',status:'passed'});
 assert.equal((await sendPolicy(owned(recipes.ownerPolicyProposeBody(staged,randomUUID())))).ok,true,sqlErrors.at(-1));
 const read=await ownerClient.rpc('r05_admission_read',{p_business_id:business,p_policy_id:null,p_limit:20,p_offset:0});assert.equal(read.error,null);const proposed=read.data.policies.find(p=>p.policy.goalId===created.id);assert.ok(proposed);
 assert.equal((await sendPolicy(owned(recipes.ownerPolicyConfirmBody(proposed.id,proposed.hash,randomUUID())))).ok,true,sqlErrors.at(-1));log.push({check:'actual authenticated owner policy server APIs propose/confirm',status:'passed'});
 const prepareRoute=source('src/app/api/research/r12/prepare/route.ts',{'@/lib/core-ui/data':{requireOwnerUiContext:async()=>ownerContext},'@/products/discovery-r12-server':server});
 const prepareRequest=origin=>new Request('https://r12-bootstrap.invalid/api/research/r12/prepare',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({businessId:business,scopeId:input.scopeId})});
 assert.equal((await prepareRoute.POST(prepareRequest('https://foreign.invalid'))).status,403);
 actor='95050000-0000-4000-8000-000000000002';assert.equal((await prepareRoute.POST(prepareRequest('https://r12-bootstrap.invalid'))).status,403);actor=R07_OWNER;
 const preparedResponse=await prepareRoute.POST(prepareRequest('https://r12-bootstrap.invalid'));assert.equal(preparedResponse.status,200);const prepared=await preparedResponse.json();assert.equal(prepared.authorityCreated,false);assert.notEqual(prepared.controllerKeyHash,prepared.admissionKeyHash);
 log.push({check:'actual preparation route/server returns distinct nonsecret hashes; foreign origin/claims rejected',status:'passed'});
 const activation={...input,quote:r12QuoteFixture(),amendmentHash:staged.amendmentHash,policyId:proposed.id,policyHash:proposed.hash,policyInterpretationHash:sha('inert-policy-review'),controllerKeyHash:prepared.controllerKeyHash,admissionKeyHash:prepared.admissionKeyHash};
 if(rebindRehearsal){
  const content=JSON.parse(JSON.stringify(REBIND.content).replaceAll(recipes.TARGET.rootId,rootId).replaceAll('3548865c-238a-48ed-8469-6b0f32ac0f95',created.id).replaceAll('33bbb31d-b7ef-4ac2-9937-a282a550c209',input.scopeId));
  const newHash=(await value('select private.r04_hash($1::jsonb) hash',[content])).hash;
  const replacementPins=new Map([...pins,[REBIND.expectedResultHash,newHash],['3548865c-238a-48ed-8469-6b0f32ac0f95',created.id],['33bbb31d-b7ef-4ac2-9937-a282a550c209',input.scopeId],[REBIND.policyRebind.oldPolicyId,proposed.id],[REBIND.policyRebind.oldPolicyHash,proposed.hash]]);
  let reboundSQL=REBOUND_ACTIVATION_SQL;for(const [from,to] of replacementPins){assert.ok(reboundSQL.includes(from),'Missing exact rebind pin '+from);reboundSQL=reboundSQL.replaceAll(from,to);}
  await rejected('rebound activation rejects unchanged R11-only Business6',()=>run(reboundSQL,activation),/bootstrap_business_pin_changed/);
  assert.equal((await sendPolicy({p_business_id:business,p_operation:'revoke',p_payload:{policyId:proposed.id,policyHash:proposed.hash},p_submission_id:randomUUID()})).ok,true,sqlErrors.at(-1));
  log.push({check:'actual owner revokes unused old policy without removing history',status:'passed'});
  const amended=await qok({p_business_id:business,p_operation:'business.save',p_payload:{expectedRevision:6,content,preference:'setup'},p_submission_id:randomUUID()});assert.equal(amended.revision,7);
  assert.equal((await value('select content_hash hash from private.r04_business_versions where business_id=$1 and revision=7',[business])).hash,newHash);
  assert.equal((await value('select content_hash hash from private.r04_business_versions where business_id=$1 and revision=6',[business])).hash,businessHash);
  log.push({check:'actual owner saves exact Business7 rules and preserves Business6',status:'passed'});
  await rejected('rebound activation rejects unrebound cap7 and old policy',()=>run(reboundSQL,activation),/bootstrap_business_financial_drift/);
  const policy={...staged.policyPayload,businessRevision:7,expectedCapRevision:7};
  assert.equal((await sendPolicy({p_business_id:business,p_operation:'propose',p_payload:policy,p_submission_id:randomUUID()})).ok,true,sqlErrors.at(-1));
  const after=await ownerClient.rpc('r05_admission_read',{p_business_id:business,p_policy_id:null,p_limit:20,p_offset:0});assert.equal(after.error,null);const rebound=after.data.policies.find(p=>p.policy.goalId===created.id&&p.policy.businessRevision===7);assert.ok(rebound);
  assert.equal((await sendPolicy(owned(recipes.ownerPolicyConfirmBody(rebound.id,rebound.hash,randomUUID())))).ok,true,sqlErrors.at(-1));
  log.push({check:'actual owner confirms Business7 policy at cap8 with unchanged amount',status:'passed'});
  const live={...activation,quote:r12QuoteFixture(),policyId:rebound.id,policyHash:rebound.hash,policyInterpretationHash:sha('inert-exact-Business7-interpretation')};
  await rejected('rebound activation rejects old revoked policy identity',()=>run(reboundSQL,{...live,policyId:proposed.id,policyHash:proposed.hash}),/bootstrap_exact_owner_policy_required/);
  await rejected('rebound activation rejects new Business revision drift',()=>run(reboundSQL,live,()=>qok({p_business_id:business,p_operation:'business.save',p_payload:{expectedRevision:7,content,preference:'setup'},p_submission_id:randomUUID()})),/bootstrap_business_pin_changed/);
  await rejected('rebound activation rejects stale quote',()=>run(reboundSQL,{...live,quote:r12QuoteFixture(Date.now()-600000)}),/bootstrap_fresh_exact_quote_required/);
  await rejected('rebound activation rejects cap drift',()=>run(reboundSQL,live,appendCapDrift),/bootstrap_business_financial_drift/);
  const qualified=await run(reboundSQL,live);assert.equal(qualified.plan.businessRevision,7);assert.equal(qualified.plan.businessHash,newHash);assert.equal(qualified.plan.policyId,rebound.id);assert.equal(qualified.plan.policyHash,rebound.hash);assert.equal(qualified.plan.maximumMicrounits,'406736');assert.equal(qualified.plan.steps.length,5);
  assert.equal(Date.parse(qualified.dispatchUntil)-Date.parse(qualified.activatedAt),1800000);assert.equal(Date.parse(qualified.receiptUntil)-Date.parse(qualified.dispatchUntil),1800000);
  assert.equal((await value('select revision from private.r04_business_state where business_id=$1',[business])).revision,7);
  const finalCap=await value("select revision,maximum_microunits from private.r05_cap_versions where business_id=$1 and currency='USD' order by revision desc limit 1",[business]);assert.equal(finalCap.revision,8);assert.equal(Number(finalCap.maximum_microunits),1053587);
  assert.equal((await value('select count(*)::int n from private.r05_markers')).n,0);assert.equal((await value('select count(*)::int n from private.r12_discovery_transport_claims')).n,0);
  await rejected('rebound activation replay cannot renew verifiers',()=>run(reboundSQL,live),/bootstrap_fresh_separate_verifier_hashes_required/);
  log.push({check:'rebound exact scoped authority has correct Business7 and final30+30 clock with zero provider work',status:'passed'});
  console.log(JSON.stringify({status:'passed',checks:log,ownerApiCalls:calls.length,pinSubstitutions:replacementPins.size,rebound:true}));
 }else{
 await rejected('activation owner mismatch',()=>run(activationSQL,{...activation,ownerId:'95050000-0000-4000-8000-000000000002'}),/bootstrap_owner_changed/);
 await rejected('activation Goal hash drift',()=>run(activationSQL,{...activation,goalHash:'0'.repeat(64)}),/bootstrap_goal_pin_changed/);
 await rejected('activation policy hash drift',()=>run(activationSQL,{...activation,policyHash:'0'.repeat(64)}),/bootstrap_exact_owner_policy_required/);
 await rejected('activation stale quote',()=>run(activationSQL,{...activation,quote:r12QuoteFixture(Date.now()-600000)}),/bootstrap_fresh_exact_quote_required/);
 const changedQuote=structuredClone(activation.quote);changedQuote.luna.sourceHashes.modelCatalog='0'.repeat(64);const changedQuoteBody={...changedQuote};for(const key of ['quoteHash','verifiedAt','validUntil'])delete changedQuoteBody[key];changedQuote.quoteHash=discoveryV2Hash(changedQuoteBody);
 await rejected('activation fresh quote facts drift with unchanged ceilings',()=>run(activationSQL,{...activation,quote:changedQuote}),/bootstrap_staged_registration_changed/);
 await rejected('activation actual cap-state drift rolls back',()=>run(activationSQL,activation,appendCapDrift),/bootstrap_business_financial_drift/);
 const activated=await run(activationSQL,activation);log.push({check:'positive activation, exact five-step authority',status:'passed'});
 req(root+'/.core-tests/core/quest-plan.js').compileQuestPlan(activated.plan);assert.equal(activated.plan.maximumMicrounits,'406736');assert.equal(activated.plan.steps.length,5);assert.equal(Date.parse(activated.dispatchUntil)-Date.parse(activated.activatedAt),1800000);assert.equal(Date.parse(activated.receiptUntil)-Date.parse(activated.dispatchUntil),1800000);
 assert.equal((await value('select count(*)::int n from private.r07_plans')).n,0);
 await rejected('activation replay refuses enrolled verifiers',()=>run(activationSQL,activation),/bootstrap_fresh_separate_verifier_hashes_required/);
 const workspace=await ownerClient.rpc('r05_admission_read',{p_business_id:business,p_policy_id:proposed.id,p_limit:20,p_offset:0});assert.equal(workspace.error,null);
 assert.equal((await value('select max(revision)::int revision,max(maximum_microunits)::int maximum from private.r05_cap_versions where business_id=$1',[business])).revision,7);
 assert.equal((await value('select count(*)::int n from private.r05_markers')).n,0);assert.equal((await value('select count(*)::int n from private.r12_discovery_transport_claims')).n,0);
 assert.equal(recipes.TARGET.businessId,'91ff7c87-60e4-4dbb-8e84-be63b53c2c79');
 assert.equal((await value('select revision from private.r04_business_state where business_id=$1',[business])).revision,6);
 console.log(JSON.stringify({status:'passed',checks:log,ownerApiCalls:calls.length,pinSubstitutions:pins.size}));
 }
}catch(error){console.error(error);process.exitCode=1;}finally{await db.close();}
