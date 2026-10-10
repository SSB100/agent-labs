import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const require=createRequire(import.meta.url),core=resolve(process.env.R12_PACKS_CORE_DIR??'.core-tests'),load=n=>require(resolve(core,n+'.js'));
const direct=load('products/discovery-r12-direct-packs'),{validatePackManifest}=load('packs/registry'),{resolvePackDependencies}=load('packs/dependencies');
const {discoveryV2PackManifests}=load('products/discovery-v2-packs'),{researchPackManifests}=load('research/packs'),{etsyKnowledgePackManifests}=load('packs/etsy-knowledge');
const root={packKey:direct.DIRECT_INSIGHTS_WORKFLOW_PACK,version:'1.0.0'};
function catalog(status='qualified'){return[...etsyKnowledgePackManifests(),...researchPackManifests(),...discoveryV2PackManifests(),...direct.directInsightsPackManifests()].map((manifest,n)=>({id:`dd120000-0000-4000-8000-${String(n+1).padStart(12,'0')}`,manifest,status}));}
const source=()=>direct.directInsightsPackManifests().find(p=>p.packKey===direct.DIRECT_INSIGHTS_SOURCE_PACK);
test('actual ten-release manifests validate without mixed-kind definitions or hardcoded provider authority',()=>{
 const ms=direct.directInsightsPackManifests();assert.deepEqual(ms.map(m=>m.kind),['knowledge','knowledge','knowledge','knowledge','capability','worker','worker','worker','worker','workflow']);for(const m of ms)validatePackManifest(m);
 assert.deepEqual(JSON.parse(readFileSync('packs/etsy-insights-direct-catalog.json','utf8')),ms);
 const text=JSON.stringify(ms);for(const forbidden of ['providerProjectId','profileId','apiKey','serverKey','debugUrl','qualifiedAt','maximumAttemptsInWindow'])assert.equal(text.includes('"'+forbidden+'"'),false,forbidden);
 assert.equal(ms.some(m=>m.status),false);assert.equal(ms.find(m=>m.kind==='workflow').workflows[0].outputSchema.properties.questComplete.const,false);
});
test('resolved source closure uses only exact model, knowledge and guarded source dependencies without old Exa path',()=>{
 const rs=resolvePackDependencies(catalog(),root);assert.equal(rs.length,10);
 assert.deepEqual(rs.flatMap(r=>r.manifest.capabilities).map(c=>c.key),['browser.etsy.insights.read_only']);
 const ws=rs.flatMap(r=>r.manifest.workers);assert.equal(ws.length,4);assert.ok(ws.every(w=>w.execution.kind!=='web.research'));
 const workflow=rs.at(-1).manifest.workflows[0];assert.deepEqual(workflow.stages.map(s=>s.key),['plan','source','strategy','review']);assert.equal(workflow.stages[2].inputFrom,'source');assert.equal(workflow.stages[3].inputFrom,'strategy');
 assert.equal(ws.find(w=>w.manifest.worker.workerKey.endsWith('.review')).manifest.modelRequirements.modelKey,'claude.sonnet.high-power');
 assert.equal(rs.some(r=>r.manifest.packKey==='workflow.product-discovery-v2'),false);
});
test('experimental or missing dependencies do not become owner-installable from manifest registration',()=>{
 assert.throws(()=>resolvePackDependencies(catalog('experimental'),root),/not qualified/);
 for(const missing of [direct.DIRECT_INSIGHTS_SOURCE_PACK,direct.DIRECT_INSIGHTS_CAPABILITY_PACK,'worker.etsy-insights-review'])assert.throws(()=>resolvePackDependencies(catalog().filter(r=>r.manifest.packKey!==missing),root),/unavailable/);
});
for(const[name,change]of[
 ['arbitrary URL',p=>{p.workers[0].execution.url='https://untrusted.invalid';}],['arbitrary module',p=>{p.workers[0].execution.module='node:fs';}],['generic executor',p=>{p.workers[0].execution.kind='guarded_browser';}],['wrong controller',p=>{p.workers[0].execution.authority='generic.browser';}],['changed source worker',p=>{p.workers[0].manifest.worker.workerKey='unreviewed.source';}],['extra capability',p=>{p.workers[0].manifest.capabilityPolicy.allowed.push('unrestricted.browser');}],['source model route',p=>{p.workers[0].manifest.modelRequirements.routeKey='standard.default';}],['unbounded source retries',p=>{p.workers[0].manifest.modelRequirements.maximumAttempts=2;}],
])test(`registry rejects ${name}`,()=>{const p=source();change(p);assert.throws(()=>validatePackManifest(p));});
test('trusted adapter cannot be assigned to an arbitrary capability key or release',()=>{
 for(const change of[p=>{p.capabilities[0].key='browser.all';},p=>{p.packKey='capability.other';},p=>{p.version='2.0.0';}]){const p=direct.directInsightsPackManifests().find(p=>p.kind==='capability');change(p);assert.throws(()=>validatePackManifest(p),/Insights capability identity mismatch/);}
});
test('generic mapping and local simulation cannot execute the source declaration or invoke provider transport',()=>{
 const w=source().workers[0];assert.throws(()=>load('packs/executor').executePackMapping(w,{}),/Mapping executor required/);
 const workflow=direct.directInsightsPackManifests().at(-1).workflows[0];assert.throws(()=>load('packs/simulation').simulatePackWorkflow({mode:'simulation',releases:catalog(),root,workflowKey:workflow.key,input:workflow.sampleInput,fixtures:{plan:{},source:{},strategy:{},review:{}},now:'2026-10-10T12:00:00Z'}),/external executor/);
});
test('durable generic simulation rejects the complete direct workflow before any provider invocation',async()=>{
 const {runDurablePackSimulation,MemorySimulationRepository}=load('packs/durable-simulation');
 const workflow=direct.directInsightsPackManifests().at(-1).workflows[0];let calls=0;
 const result=await runDurablePackSimulation({mode:'simulation',providerType:'mock',runKey:'direct-insights-generic-denial',repository:new MemorySimulationRepository(),releases:catalog(),root,workflowKey:workflow.key,input:workflow.sampleInput,adapter:{invokeStructured:async()=>{calls++;throw new Error('Unexpected provider invocation');}},now:'2026-10-10T12:00:00Z'});
 assert.equal(calls,0);assert.equal(result.status,'needs_you');assert.match(result.failure.reason,/requires model_router/);assert.equal(result.qualificationEvaluated,false);
 assert.ok(result.stages.every(s=>s.invocations.length===0));assert.deepEqual(result.receipts,[]);
});
test('declared stage output names match actual direct serializer and retain all outcome states',()=>{
 const w=direct.directInsightsPackManifests().at(-1).workflows[0];assert.deepEqual(w.stages.filter(s=>s.key!=='source').map(s=>s.completionCriteria.outputContract),['r12_direct_plan_v1','r12_direct_strategy_v1','r12_direct_review_v1']);
 assert.ok(w.outputSchema.properties.researchStageOutcome.enum.includes('INVALID_RESEARCH'));assert.ok(w.outputSchema.properties.researchStageOutcome.enum.includes(null));
 assert.deepEqual(source().workers[0].manifest.outputSchema.properties.releaseState.enum,['not_required','verified','unconfirmed']);
});

for(const[name,change]of [
 ['global Haiku reviewer route',p=>{p.workers[0].manifest.modelRequirements.modelKey='claude.haiku.review';}],
 ['changed reviewer endpoint',p=>{p.workers[0].manifest.modelRequirements.endpoint='anthropic';}],
 ['model module escape',p=>{p.workers[0].execution.module='unreviewed-adapter';}],
 ['model generic executor',p=>{p.workers[0].execution.authority='generic';}],
 ['model fallback',p=>{p.workers[0].manifest.modelRequirements.primaryOnly=false;}],
])test(`direct model declaration rejects ${name}`,()=>{const p=direct.directInsightsPackManifests().find(p=>p.packKey==='worker.etsy-insights-review');change(p);assert.throws(()=>validatePackManifest(p));});
test('fresh direct release qualification leaves the historical experimental resolver snapshot byte-exact',()=>{
 const before=catalog('experimental').filter(r=>!direct.directInsightsPackManifests().some(m=>m.packKey===r.manifest.packKey)),original=cloneCatalog(before);
 const pin={packKey:'workflow.product-discovery-v2',version:'1.0.0'},history=JSON.stringify(resolvePackDependencies(before,pin,true));
 const directReleases=direct.directInsightsPackManifests().map((manifest,n)=>({id:`ee120000-0000-4000-8000-${String(n+1).padStart(12,'0')}`,manifest,status:'qualified'})),after=[...before,...directReleases];
 assert.equal(JSON.stringify(resolvePackDependencies(after,pin,true)),history);assert.deepEqual(before,original);
 assert.equal(resolvePackDependencies(after,root).length,10);assert.ok(resolvePackDependencies(after,root).every(r=>r.status==='qualified'));
 const prior=etsyKnowledgePackManifests();for(const m of direct.directInsightsPackManifests().filter(m=>m.kind==='knowledge'))assert.deepEqual(m.knowledge,prior.find(p=>p.packKey+'.direct-insights'===m.packKey).knowledge,'New IDs do not re-date or rewrite inherited source observations');
});
function cloneCatalog(value){return structuredClone(value);}
