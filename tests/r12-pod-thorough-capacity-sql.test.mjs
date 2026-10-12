// Isolated current-source qualification. Every provider response is synthetic;
// the only HTTP implementation below is an in-memory response fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
import {podThoroughSqlActivation,podThoroughSqlQuote,podThoroughSqlTemplate} from './helpers/r12-pod-thorough-sql-fixture.mjs';
import {podSource,podHash,podOne,podInertOutputs,podSqlFixture,podQuoteFixture,podRuntimeFixture,podRpc} from './helpers/r12-pod-sql-fixture.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),host=process.env.R12_SQL_TEST_HOST??process.env.R11_SQL_TEST_HOST;
const limits=podSource('products/discovery-r12-pod-profile').POD_THOROUGH_LIMITS;
const migration=readFileSync(root+'supabase/migrations/20261012204552_r12_thorough_pod_research.sql','utf8');
const cloned=v=>structuredClone(v);

async function thoroughRuntime(db,{empty=false,long=false}={}){
 const a=await podThoroughSqlActivation(db),posted=[],got=[],sent=[],outputs=Array.from({length:5},(_,passOrdinal)=>podInertOutputs({passOrdinal,useful:passOrdinal===1}));
 const store={read:a.read,readAdaptiveAction:()=>a.pass('context'),command:(op,payload,epoch)=>op==='adaptive_complete_action'?a.pass('complete',payload):a.command(op,['schedule','reserve'].includes(op)?{...payload,runtimeCapability:'inert-thorough-runtime-'+a.scope.id}:payload,epoch)};
 const rt=podSource('products/discovery-r12-runtime'),registry={};
 if(empty){outputs[0].search1.annotations=[];outputs[0].select1={selections:[],limitations:['limited_sources']};outputs[0].strategy.candidates=[];outputs[0].review.checks.forEach(c=>c.evidence=[]);}
 if(long){
  const o=outputs[0],sample=o.plan.hypotheses[0];o.plan.hypotheses=Array.from({length:16},(_,i)=>({...sample,productType:'Synthetic hypothesis '+i,hypothesis:'Unverified longer hypothesis with independent contrary reasoning. '.repeat(30).trim(),contraryExplanation:'There may be no genuine buyer intent or commercial opportunity. '.repeat(30).trim()}));
  o.plan.comparisonRationale='Synthetic research compares meaningful alternatives without any claim of verified buyer demand. '.repeat(50).trim();
  const quote='A synthetic long Unicode observation 🧪 漢字 stays fully attributed and does not establish purchase demand. ';
  o.search1.annotations=Array.from({length:25},(_,i)=>({type:'url_citation',url_citation:{url:'https://census.gov/inert-thorough-'+i,title:'Inert complete source '+i,content:('Source '+i+' '+quote.repeat(40)).trim()}}));
  o.select1.selections=Array.from({length:48},(_,i)=>({sourceKey:'S'+(Math.floor(i/2)+1),quote:i%2?quote.trim():('Source '+Math.floor(i/2)+' '+quote).trim()}));
 }
 const executingRelease={version:'r12.executing-release.1',repository:'SSB100/agent-labs',environment:'production',commitSha:'c'.repeat(40),deploymentId:'dpl_inert_thorough_capacity_sql'};
 for(const step of a.plan.steps){const phase=step.key;
 registry[step.adapter]=podSource('products/discovery-r12-adapter').createDiscoveryR12QuestAdapter({scope:a.scope,phase,identity:{qualificationHash:step.qualificationHash,workflowDefinitionId:step.workflowDefinitionId,workerDefinitionId:step.workerDefinitionId,mode:'qualification'},executingRelease,
 dataClasses:a.operations.find(o=>o.operationKey===step.operationKey).dataClasses,
 store:{operation:a.effect,settle:async(attemptId,settlement)=>a.command('settle',{attemptId,settlement},(await a.read()).head.epoch),dispatchedAt:async id=>(await a.effect(id,'load')).dispatchedAt},
 request:async ctx=>rt.buildDiscoveryR12PhaseRequest(ctx,rt.readDiscoveryR12PhaseInputs(ctx,await a.effect(ctx.attempt.id,'inputs'))),quote:async()=>podThoroughSqlQuote(),
 project:async(q,ctx,request)=>rt.projectDiscoveryR12Phase(ctx,rt.readDiscoveryR12PhaseInputs(ctx,await a.effect(ctx.attempt.id,'inputs')),q,request),
 config:{apiKey:'inert-thorough-no-network',baseUrl:'https://openrouter.ai/api/v1',appUrl:'https://agent-labs-two.vercel.app',appName:'Agent Labs'},
 fetcher:async(url,init)=>{const model=phase==='review'?'anthropic/claude-4.5-haiku-20251001':'openai/gpt-5.6-luna-20260709';
 if(init.method==='GET'){got.push(phase);return new Response(JSON.stringify({data:{id:new URL(url).searchParams.get('id'),provider_name:phase==='review'?'Amazon Bedrock':'Azure',model}}));}
 assert.equal(init.method,'POST');const state=await a.read(),attempt=state.attempts.find(x=>x.stepKey===phase&&x.status==='dispatched'),ordinal=attempt.adaptiveActionOrdinal;
 posted.push(phase);sent.push({phase,ordinal,request:JSON.parse(init.body)});const output=outputs[ordinal];
 return new Response(JSON.stringify({id:'gen-inert-thorough-'+attempt.id,model,choices:[{finish_reason:'stop',message:phase==='search1'?{content:'Synthetic offline research fixture.',annotations:output.search1.annotations}:{content:JSON.stringify(output[phase])}}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150,cost:0.00001,...(phase==='search1'?{server_tool_use_details:{web_search_requests:1}}:{})}}));}
 });}
 const tick=async()=>{if(!await store.readAdaptiveAction()){const admission=await a.pass('admit',{quote:podThoroughSqlQuote()});if(!admission.admitted)return{status:admission.completed?'completed':'waiting',reason:admission.reason};}return podSource('core/quest-controller').driveQuestOnce(store,{adapters:registry,reconcile:true});};
 return{...a,store,registry,outputs,posted,got,sent,tick};
}
async function runUntil(a,predicate,max=60){for(let i=0;i<max;i++){if(await predicate())return;let r;try{r=await a.tick();}catch(e){if(e.message==='r12_discovery_receipt_pending')continue;throw e;}assert.ok(['progress','completed'].includes(r.status),JSON.stringify(r));}assert.fail('Expected inert state not reached');}

// Direct composite calls below exercise the genuine independent SQL validator,
// with immutable DB dependencies and request pins, before any synthetic send.
async function checkWire(db,a,phase,mutate){
 const snapshot=await a.read(),attempt=snapshot.attempts.filter(x=>x.stepKey===phase&&x.status==='reserved').at(-1);assert.ok(attempt);
 const row=await podOne(db,'select binding from private.r12_discovery_wires where attempt_id=$1',[attempt.id]);assert.ok(row);
 const binding=cloned(row.binding);const request=JSON.parse(binding.requestJson),body=JSON.parse(binding.wireBody),payload=phase==='search1'?null:JSON.parse(request.messages[1].content);
 mutate({binding,request,body,payload});if(payload){request.messages[1].content=JSON.stringify(payload);body.messages=request.messages;}
 binding.requestJson=JSON.stringify(request);binding.wireBody=JSON.stringify(body);binding.requestHash=podHash(request);binding.wireHash=podSource('research/qualification').sha256?.(binding.wireBody)??(await import('node:crypto')).createHash('sha256').update(binding.wireBody).digest('hex');
 return db.query(`select private.r12_pod_wire_validate(jsonb_populate_record(null::private.r05_requests,to_jsonb(r)||jsonb_build_object('payload',r.payload||jsonb_build_object('requestHash',$2::jsonb->>'requestHash','wireRequestHash',$2::jsonb->>'wireHash','wireRequestBytes',octet_length($2::jsonb->>'wireBody')))),a,p,s,$2::jsonb) from private.r07_attempts a join private.r07_plans p on p.id=a.plan_id join private.r05_requests r on r.workflow_run_id=a.id join private.r12_discovery_scopes s on s.id=(p.content->>'discoveryScopeId')::uuid where a.id=$1`,[attempt.id,JSON.stringify(binding)]);
}

test('migration remains definition-only and does not widen global control scanners',()=>{
 assert.match(migration,/r12\.pod-template\.4/);assert.match(migration,/r12\.pod-research-goal\.3/);
 assert.match(migration,/octet_length\(v->>'requestJson'\)>maximum_bytes/);
 assert.doesNotMatch(migration,/alter (role|system)|insert into private\.r12_pod_templates|create or replace function private\.r04_safe/i);
});
test('thorough capacity is exact-profile-bound from SQL admission through inert review',{skip:!host,timeout:180000},async t=>{
 const require=createRequire(path.resolve(host,'package.json')),{PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto'),db=new PGlite({extensions:{pgcrypto}});
 try{
 await db.exec(r04SqlBootstrap+sessionBootstrap);for(const file of readdirSync(root+'supabase/migrations').filter(x=>x.endsWith('.sql')).sort())await db.exec(readFileSync(root+'supabase/migrations/'+file,'utf8'));
 await t.test('SQL/TS profile and every phase capacity match exactly',async()=>{assert.deepEqual((await podOne(db,'select private.r12_pod_thorough_profile() p')).p,limits);assert.equal((await podOne(db,'select private.stage14_hash(private.r12_pod_thorough_profile()) h')).h,podHash(limits));for(const[phase,bounds]of Object.entries(limits.phases))for(const[field,n]of Object.entries(bounds))assert.equal((await podOne(db,'select private.r12_pod_thorough_capacity($1,$2) n',[phase,field])).n,n);});
 await t.test('ordinary and recovery .4 templates cannot select each other or reuse the wrong planner pin',async()=>{
 const a=await podThoroughSqlActivation(db),recovery=await podThoroughSqlTemplate(db,a.f,{recovery:true}),catalog=await a.f.read();
 assert.equal(catalog.template.id,a.prepared.preview.templateId,'A newer recovery template is excluded from ordinary admission');
 assert.equal(recovery.pins.recovery,true);assert.notEqual(recovery.pins.schemas.plan.systemHash,(await podOne(db,'select pins from private.r12_pod_templates where id=$1',[a.prepared.preview.templateId])).pins.schemas.plan.systemHash);
 await assert.rejects(a.f.server('prepare',{input:{...a.f.input,templateId:recovery.templateId,templateHash:recovery.templateHash,submissionId:(await import('node:crypto')).randomUUID()},quote:podThoroughSqlQuote()}),/template_mode_mismatch/);
 });
 await t.test('reviewed .4 upgrade requires stopped exact old authority and preserves installation history atomically',async()=>{
 const f=await podSqlFixture(db),legacy=await f.prepare(),old=await podOne(db,'select * from public.installed_packs where business_id=$1',[f.businessId]);
 const target=await podThoroughSqlTemplate(db,f),input={...f.input,templateId:target.templateId,templateHash:target.templateHash,submissionId:randomUUID()};
 const prepare=()=>f.server('prepare',{input,quote:podThoroughSqlQuote()});
 await assert.rejects(prepare(),/installation_predecessor_not_stopped/);
 assert.deepEqual(await podOne(db,'select * from public.installed_packs where id=$1',[old.id]),old);
 await f.server('stop',{setupId:legacy.setupId,setupHash:legacy.setupHash,submissionId:randomUUID()});
 const saved=await podOne(db,'select to_jsonb(s) record from private.r12_pod_setups s where id=$1',[legacy.setupId]);
 await db.exec('begin');try{
 await db.query('insert into private.r05_policies(id,business_id,goal_id,goal_revision,business_revision,payload,content_hash,actor_id) select $1,business_id,goal_id,goal_revision,business_revision,payload,content_hash,actor_id from private.r05_policies where id=$2',[randomUUID(),legacy.policyId]);
 await assert.rejects(db.query('select public.r12_pod_owner_server($1,$2,$3,$4)',[f.businessId,'prepare',{input,quote:podThoroughSqlQuote()},f.bootstrapKey]),/installation_unbound_authority/);
 }finally{await db.exec('rollback');}
 // Force a later proposal failure: superseding the old pack must roll back too.
 await db.exec("create function private.inert_capacity_upgrade_fail() returns trigger language plpgsql as $$begin raise exception 'inert_capacity_upgrade_rollback';end$$; create trigger inert_capacity_upgrade_fail before insert on private.r12_pod_setups for each row execute function private.inert_capacity_upgrade_fail()");
 await assert.rejects(prepare(),/inert_capacity_upgrade_rollback/);
 assert.deepEqual(await podOne(db,'select * from public.installed_packs where id=$1',[old.id]),old);
 await db.exec('drop trigger inert_capacity_upgrade_fail on private.r12_pod_setups;drop function private.inert_capacity_upgrade_fail()');
 const upgraded=await prepare(),rows=(await db.query('select * from public.installed_packs where business_id=$1 order by status',[f.businessId])).rows;
 assert.equal(rows.length,2);const current=rows.find(x=>x.status==='active'),prior=rows.find(x=>x.id===old.id);
 assert.equal(current.root_pack_id,target.pins.packId);assert.deepEqual(current.snapshot,target.pins.snapshot);
 assert.equal(prior.status,'superseded');assert.ok(prior.superseded_at);assert.deepEqual({...prior,status:old.status,superseded_at:old.superseded_at},old);
 assert.deepEqual(await podOne(db,'select to_jsonb(s) record from private.r12_pod_setups s where id=$1',[legacy.setupId]),saved);
 assert.equal(upgraded.preview.profile,'r12.pod-thorough.1');assert.equal((await prepare()).setupId,upgraded.setupId);
 await assert.rejects(f.server('prepare',{input:{...f.input,submissionId:randomUUID()},quote:podQuoteFixture()}),/installation_changed/);
 assert.equal((await podOne(db,"select count(*)::int n from public.events where business_id=$1 and event_type='pack.activated'",[f.businessId])).n,1);
 });
 await t.test('legacy failed-review recovery blocks conflicting NULL-cost receipt identity and an outstanding latest read',async()=>{
 const a=await podRuntimeFixture(db,{usefulPass:null});
 for(const i of [1,2,3,4,5])a.output.review.checks[i].rationale='The source does not establish relevant independent demand, competitive advantage, fulfilment reliability, delivered economics, or rights clearance. '.repeat(2);
 a.output.review.nextTest='Seek independent aggregate public evidence under the approved source policy before recommending a product test. '.repeat(4);
 let rejected=false;for(let n=0;n<30;n++){try{await a.tick();}catch(error){assert.match(error.message,/schema|characters|validation|output/i);rejected=true;break;}}
 assert.equal(rejected,true);assert.equal(a.posted.length,5);
 await a.f.server('stop',{setupId:a.prepared.setupId,setupHash:a.prepared.setupHash,submissionId:randomUUID()},'');
 const target=await podThoroughSqlTemplate(db,a.f,{recovery:true}),c=await podRpc(db,'authenticated',a.f.ownerId,'r12_pod_recovery_read',[a.f.businessId,a.prepared.setupId]);
 const input={...a.f.input,templateId:target.templateId,templateHash:target.templateHash,maximumMicrounits:c.proof.remainingMaximumMicrounits,businessLifetimeLimitMicrounits:c.finance.maximumMicrounits,submissionId:randomUUID(),predecessorSetupId:a.prepared.setupId,proofHash:c.proofHash,historyHash:c.historyHash,classificationHash:c.classificationHash,approveGoalDeadlineRevision:true};
 const prepare=()=>db.query('select public.r12_pod_recovery_owner_server($1,$2,$3,$4) result',[a.f.businessId,'prepare',{input,quote:podThoroughSqlQuote()},a.f.bootstrapKey]);
 const request=(await podOne(db,"select request_id from private.r12_pod_pass_calls where scope_id=$1 and phase='plan'",[a.scope.id])).request_id;
 await db.exec('begin');try{
 await db.query("insert into private.r05_settlements(request_id,business_id,currency,actual_microunits,provider_request_id,receipt_hash) values($1,$2,'USD',null,'gen-inert-conflicting-unknown',$3)",[request,a.f.businessId,'f'.repeat(64)]);
 await assert.rejects(prepare(),/installation_unsettled/);
 }finally{await db.exec('rollback');}
 await db.exec('begin');try{
 await db.query('insert into private.r12_discovery_receipt_checks(request_id,attempt) select $1,max(attempt)+1 from private.r12_discovery_receipt_checks where request_id=$1',[request]);
 await assert.rejects(prepare(),/installation_unsettled/);
 }finally{await db.exec('rollback');}
 const oldInstall=await podOne(db,'select * from public.installed_packs where business_id=$1',[a.f.businessId]);
 // An abandoned latest lookup blocks only during its saved receipt window.
 await db.query('insert into private.r12_discovery_receipt_checks(request_id,attempt) select $1,max(attempt)+1 from private.r12_discovery_receipt_checks where request_id=$1',[request]);
 const expiresAt=(await podOne(db,'select receipt_expires_at from private.r12_discovery_candidates where request_id=$1',[request])).receipt_expires_at;
 const realNow=Date.now,offset=Date.parse(expiresAt)-realNow()+1000;let prepared;
 try{Date.now=()=>realNow()+offset;const sqlNow=(await podOne(db,'select extract(epoch from clock_timestamp())::double precision*1000 ms')).ms;assert.ok(sqlNow>Date.parse(expiresAt));assert.ok(Math.abs(sqlNow-Date.now())<1000);
 prepared=(await prepare()).rows[0].result;
 }finally{Date.now=realNow;}
 assert.equal(prepared.preview.profile,'r12.pod-thorough.1');assert.equal(prepared.preview.recovery.originalReviewAccepted,false);
 assert.equal(prepared.preview.finance.runLimitMicrounits,'9999950');assert.equal(prepared.preview.goalRevision,a.prepared.preview.goalRevision+2);
 const oldAfter=await podOne(db,'select * from public.installed_packs where id=$1',[oldInstall.id]);assert.equal(oldAfter.status,'superseded');assert.deepEqual(oldAfter.snapshot,oldInstall.snapshot);
 assert.deepEqual(a.posted,['plan','search1','select1','strategy','review']);
 });
 await t.test('UTF-8, JSON escaping and storage ceilings remain scoped to a real profile',async()=>{
 const escaped={text:'漢字 🧪 \" \\ \t\n'.repeat(3000)},wire=JSON.stringify(escaped),row=await podOne(db,'select private.r12_pod_compact_bytes($1::jsonb) compact,private.r12_pod_embedded_bytes($1::jsonb) embedded,octet_length($1::jsonb::text) stored',[wire]);
 assert.equal(row.compact,Buffer.byteLength(wire));assert.equal(row.embedded,Buffer.byteLength(JSON.stringify(wire)));assert.ok(row.stored>=row.compact);
 await assert.rejects(db.query('select private.r04_safe($1::jsonb)',[JSON.stringify({text:'x'.repeat(20001)})]),/r04_invalid_payload/);
 assert.equal((await podOne(db,"select private.r12_pod_thorough_scope('00000000-0000-4000-8000-000000000000') qualified")).qualified,false);
 const a=await podThoroughSqlActivation(db),quote=podThoroughSqlQuote(),constraints=(await db.query("select conname,pg_get_constraintdef(oid) definition from pg_constraint where conrelid='private.r12_discovery_wires'::regclass and conname='r12_discovery_wires_check'")).rows[0];
 const predicate=constraints.definition.slice(7,-1),binding={scopeId:a.scope.id,quote,requestJson:'\\'.repeat(786432),wireBody:'\\'.repeat(786432)};
 const evaluate=async(value,scopeId=a.scope.id)=>(await podOne(db,'select '+predicate+' ok from(select $1::uuid scope_id,$2::jsonb binding,private.stage14_hash($2::jsonb) binding_hash)x',[scopeId,JSON.stringify(value)])).ok;
 assert.equal(await evaluate(binding),true,'Both maximally escaped complete request strings fit with quote/pin headroom');
 assert.equal(await evaluate(binding,'00000000-0000-4000-8000-000000000000'),false,'A profile-labelled quote does not widen an unqualified scope');
 assert.equal(await evaluate({...binding,wireBody:'x'.repeat(limits.maximumBindingBytes)}),false,'The SQL JSONB binding storage cap is finite');
 });
 await t.test('one MiB rejected content and all sixteen diagnostic issues persist only within finite bounds',async()=>{
 const a=await thoroughRuntime(db);await a.tick();await a.tick();const state=await a.read(),attempt=state.attempts[0],step=state.plan.steps[0],ctx={planId:state.planId,planHash:state.planHash,plan:state.plan,step,attempt,knowledge:state.knowledge};
 const prepared=await a.registry[step.adapter].prepare(ctx);assert.equal((await a.command('dispatch',{attemptId:attempt.id,wireHash:prepared.descriptor.wireRequestHash},state.head.epoch)).shouldDispatch,true);
 const executingRelease={version:'r12.executing-release.1',repository:'SSB100/agent-labs',environment:'production',commitSha:'c'.repeat(40),deploymentId:'dpl_inert_thorough_capacity_sql'};
 assert.equal((await a.effect(attempt.id,'send',{wireHash:prepared.descriptor.wireRequestHash,executingRelease})).shouldDispatch,true);
 const sha=async text=>(await import('node:crypto')).createHash('sha256').update(text).digest('hex'),content='x'.repeat(1048576),scope={scopeId:a.scope.id,attemptId:attempt.id,requestId:attempt.requestId};
 const observation={...scope,version:'r12.review-observation.1',receivedAt:new Date().toISOString(),providerRequestId:'gen-inert-byte-limit',providerModelId:'openai/gpt-5.6-luna-20260709',finishReason:'stop',nativeFinishReason:null,contentState:'complete',content,contentBytes:1048576,contentHash:await sha(content)};
 const oversized={...observation,content:content+'x',contentBytes:1048577,contentHash:await sha(content+'x')};await assert.rejects(a.effect(attempt.id,'observe',{observation:oversized,observationHash:podHash(oversized)}),/observation_content_invalid/);
 assert.equal((await a.effect(attempt.id,'observe',{observation,observationHash:podHash(observation)})).saved,true);
 const diagnostic={...scope,version:'r12.review-diagnostic.1',recordedAt:new Date().toISOString(),code:'response_schema',httpStatus:null,observationSaved:true,issues:Array.from({length:16},(_,i)=>({path:'$.hypotheses['+i+'].hypothesis',constraint:'max_length',limit:4800}))};
 const tooMany={...diagnostic,issues:[...diagnostic.issues,diagnostic.issues[0]]};await assert.rejects(a.effect(attempt.id,'diagnose',{diagnostic:tooMany,diagnosticHash:podHash(tooMany)}),/diagnostic_invalid/);
 assert.equal((await a.effect(attempt.id,'diagnose',{diagnostic,diagnosticHash:podHash(diagnostic)})).saved,true);
 const saved=await a.effect(attempt.id,'load');assert.equal(saved.diagnostic.issues.length,16);assert.equal((await podOne(db,"select payload->>'contentHash' h,octet_length(payload->>'content') bytes from private.r12_discovery_response_observations where request_id=$1 and kind='received'",[attempt.requestId])).bytes,1048576);
 assert.equal(a.posted.length,0,'Storage qualification never calls even the inert model transport');
 });
 await t.test('whole source/quote projections disclose all omissions and reject fabrication',async()=>{
 const ev=podSource('products/discovery-r12-pod-evidence'),excerpt='Synthetic Unicode 漢字 🧪 source with no demand claim. '.repeat(30).trim(),annotations=[0,1,2].map(i=>({type:'url_citation',url_citation:{url:'https://census.gov/fixture-'+i,title:'Synthetic '+i,content:excerpt+i}})),request={query:'Synthetic independent public research question only',allowedDomains:['census.gov']};
 const c=ev.extractThoroughPodSources(request,{annotations,metadata:{}},new Date().toISOString()),projection=ev.podSourceProjection(c,5000);
 const call=p=>db.query('select private.r12_pod_source_projection_check($1::jsonb,$2::jsonb,$3::jsonb)',[JSON.stringify(p.sources),JSON.stringify(p.coverage),JSON.stringify(c)]);await call(projection);
 for(const mutate of [p=>p.sources[0].excerpt+='invented',p=>p.sources[0].title='Invented metadata',p=>p.coverage.omittedSourceIds=[],p=>p.sources.push(p.sources[0])]){const p=cloned(projection);mutate(p);await assert.rejects(call(p),/projection/);}
 const archive=[{pass:0,collectionHash:'a'.repeat(64),evidencePackHash:'b'.repeat(64),items:[{key:'E1',quote:excerpt,url:'https://census.gov/fixture-0',title:'Synthetic',retrievedAt:new Date().toISOString(),publishedAt:null,contentHash:'c'.repeat(64),evidenceId:'evi-'+'a'.repeat(24)}]}];
 const prior=ev.podPriorEvidenceProjection(archive,0),priorCall=p=>db.query('select private.r12_pod_prior_projection_check($1::jsonb,$2::jsonb)',[JSON.stringify(p),JSON.stringify(archive)]);await priorCall(prior);await assert.rejects(priorCall({...prior,coverage:{...prior.coverage,omittedEvidenceKeys:[]}}),/coverage/);
 });
 await t.test('large real five-phase bindings preserve all 48 quotes and exact review assessment',async()=>{
 const a=await thoroughRuntime(db,{long:true});await runUntil(a,async()=>{const s=await a.read();return s.attempts.some(x=>x.stepKey==='select1'&&x.status==='reserved');});
 // Second prepare materializes the reserved exact wire, as in the controller.
 let state=await a.read(),attempt=state.attempts.find(x=>x.stepKey==='select1');await a.registry[state.plan.steps[2].adapter].prepare({planId:state.planId,planHash:state.planHash,plan:state.plan,step:state.plan.steps[2],attempt,knowledge:state.knowledge});
 await checkWire(db,a,'select1',()=>{});await assert.rejects(checkWire(db,a,'select1',({payload})=>payload.sources[0].excerpt+=' fabricated'),/projection_fabricated/);await assert.rejects(checkWire(db,a,'select1',({payload})=>payload.coverage.omittedSourceIds=['src-invented']),/projection_coverage/);
 await runUntil(a,async()=>{const s=await a.read();return s.attempts.some(x=>x.stepKey==='review'&&x.status==='reserved');});
 state=await a.read();attempt=state.attempts.find(x=>x.stepKey==='review');await a.registry[state.plan.steps[4].adapter].prepare({planId:state.planId,planHash:state.planHash,plan:state.plan,step:state.plan.steps[4],attempt,knowledge:state.knowledge});
 await checkWire(db,a,'review',()=>{});await assert.rejects(checkWire(db,a,'review',({request})=>request.requestMetadata.padding='漢'.repeat(Math.ceil(limits.phases.review.maximumRequestBytes/3))),/wire_bound_mismatch/);await assert.rejects(checkWire(db,a,'review',({body})=>body.extra='🧪'.repeat(Math.ceil(limits.phases.review.maximumRequestBytes/4))),/wire_bound_mismatch/);await assert.rejects(checkWire(db,a,'review',({payload})=>payload.evidence.items.pop()),/selected_evidence_changed/);await assert.rejects(checkWire(db,a,'review',({payload})=>payload.evidence.sourceIndex[0].contentHash='0'.repeat(64)),/selected_evidence_changed/);await assert.rejects(checkWire(db,a,'review',({payload})=>payload.assessment.explorationSummary+=' fabricated'),/assessment_exact_context/);
 await runUntil(a,async()=>{const s=await a.read();return s.attempts.filter(x=>x.stepKey==='review'&&x.status==='completed').length===2;},60);
 assert.deepEqual(a.posted,['plan','search1','select1','strategy','review','plan','search1','select1','strategy','review']);assert.deepEqual(a.got,a.posted);
 const strategy=JSON.parse(a.sent.find(x=>x.phase==='strategy').request.messages[1].content),review=JSON.parse(a.sent.find(x=>x.phase==='review').request.messages[1].content);assert.equal(strategy.evidence.items.length,48);assert.deepEqual(review.evidence,strategy.evidence);assert.deepEqual(review.assessment,a.outputs[0].strategy);
 assert.equal(JSON.parse(a.sent.find(x=>x.phase==='plan'&&x.ordinal===1).request.messages[1].content).priorEvidence.coverage.available,48);
 });
 await t.test('truthful zero-source pass reaches independent insufficient review and a different counted search',async()=>{
 const a=await thoroughRuntime(db,{empty:true});await runUntil(a,async()=>(await a.read()).attempts.filter(x=>x.stepKey==='review'&&x.status==='completed').length===2,65);assert.equal(a.posted.filter(x=>x==='search1').length,2);assert.deepEqual(a.outputs[0].select1.selections,[]);assert.equal(a.outputs[0].review.outcome,'INSUFFICIENT_EVIDENCE');assert.notEqual(a.outputs[0].plan.query,a.outputs[1].plan.query);
 const final=await a.read();assert.equal(final.head.dispatches,10);assert.equal((await a.f.read()).finance.committedMicrounits,'100');assert.equal((await a.f.read()).finance.hasUnknown,false);
 });
 }finally{await db.close();}
});
