import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateKnowledgeReview,reviewedKnowledgeManifest,readQuestKnowledge} from '../.core-tests/core/reviewed-knowledge.js';
import {driveQuestOnce} from '../.core-tests/core/quest-controller.js';
const id=n=>`99090000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const now=Date.parse('2026-10-04T00:00:00Z');
const source=(url='https://alpha.org/guidance')=>({url,title:'Public evidence',verifiedAt:'2026-10-03T00:00:00Z',expiresAt:'2026-10-20T00:00:00Z',contentHash:'a'.repeat(64),stance:'supports'});
const review=()=>({redactionStatus:'accepted',proofPreserved:true,generalizable:true,privateContentRemoved:true,independentSourcesVerified:true,content:{guidance:'Preserve provenance before comparing observations.',scope:'Evidence comparison only.',limitations:['A local result is not a causal or commercial claim.'],conflicts:[],generalizability:'Two independently reviewed public methods support this bounded process.'},sources:[source(),source('https://beta.org/evidence')],expiresAt:'2026-10-15T00:00:00Z',notes:'Semantic evidence and redacted text checked independently.'});
const pin=()=>({applicationId:id(1),applicationReason:"Useful for this Business evidence-comparison plan.",releaseId:id(2),installationId:id(3),packKey:'knowledge.learned.provenance',packVersion:'1.0.0',knowledgeKey:'knowledge.learned.provenance',knowledgeVersion:'1.0.0',manifestHash:'a'.repeat(64),contentHash:'b'.repeat(64),verifiedAt:'2026-10-03T00:00:00Z',expiresAt:'2026-10-15T00:00:00Z',content:review().content,sources:review().sources,reviewerIdentity:id(4),reviewerFingerprint:'c'.repeat(64)});
const snapshot=()=>({format:'r09.1',businessId:id(5),planId:id(6),pins:[pin()]});

test('R09 review preflight is detached and builds an information-only immutable pack preview',()=>{
 const r=review(),validated=validateKnowledgeReview(r,now);assert.deepEqual(validated,r);assert.notEqual(validated.content,r.content);
 const manifest=reviewedKnowledgeManifest({packKey:'knowledge.learned.provenance',version:'1.0.0',name:'Provenance comparison'},r,now);
 assert.equal(manifest.kind,'knowledge');for(const name of ['dependencies','capabilities','workers','workflows'])assert.deepEqual(manifest[name],[]);
 assert.equal(manifest.knowledge.length,1);assert.equal(manifest.knowledge[0].version,'1.0.0');assert.equal(manifest.knowledge[0].content.scope,r.content.scope);
 assert.equal('businessId' in manifest.knowledge[0].content,false);assert.equal('authorized' in manifest,false);
});
for(const [name,change] of [
 ['redaction rejected',r=>r.redactionStatus='rejected'],['proof destroyed',r=>r.proofPreserved=false],['local success alone',r=>r.generalizable=false],['private content retained',r=>r.privateContentRemoved=false],['unverified independence',r=>r.independentSourcesVerified=false],['missing generalizability',r=>r.content.generalizability=''],['missing limitations',r=>r.content.limitations=[]],['contradictory source',r=>r.sources[1].stance='contradicts'],['single source',r=>r.sources.pop()],['same host',r=>r.sources[1].url='https://alpha.org/other'],['duplicate source',r=>r.sources[1]=r.sources[0]],['stale source',r=>r.sources[0].expiresAt='2026-10-03T12:00:00Z'],['future verification',r=>r.sources[0].verifiedAt='2026-10-05T00:00:00Z'],['expiry beyond source',r=>r.expiresAt='2026-10-30T00:00:00Z'],['expired review',r=>r.expiresAt='2026-10-04T00:00:00Z'],['unbounded refresh',r=>r.expiresAt='2027-10-04T00:00:00Z'],['authority injection',r=>r.content.allowedOperations=['publish']],['private tenant identity field',r=>r.content.businessId=id(9)],['credential content',r=>r.content.guidance='api_key: confidential-fixture-value'],['credential URL',r=>r.sources[0].url='https://user:password@alpha.org/evidence'],['query tokens',r=>r.sources[0].url='https://alpha.org/evidence?token=hidden'],['private host',r=>r.sources[0].url='https://internal.local/evidence'],['loopback IP',r=>r.sources[0].url='https://127.0.0.1/evidence'],['non-TLS source',r=>r.sources[0].url='http://alpha.org/evidence'],['source key injection',r=>r.sources[0].accountAccess='yes'],['forged true',r=>r.proofPreserved='true'],
])test(`R09 review preflight rejects ${name}`,()=>{const r=review();change(r);assert.throws(()=>validateKnowledgeReview(r,now),/r09_/);});

test('R09 exact historical snapshots remain readable after expiry and retain original bytes',()=>{
 const s=snapshot(),copy=readQuestKnowledge(s,id(5),id(6));assert.deepEqual(copy,s);copy.pins[0].content.guidance='changed';assert.notEqual(s.pins[0].content.guidance,copy.pins[0].content.guidance);
 // No current-time freshness rejection in a historical read. SQL alone gates new work.
 assert.equal(readQuestKnowledge(s,id(5),id(6)).pins[0].knowledgeVersion,'1.0.0');
});
for(const [name,change] of [
 ['different Business',s=>s.businessId=id(9)],['different plan',s=>s.planId=id(9)],['duplicate lesson keys',s=>s.pins.push(pin())],['version mismatch',s=>s.pins[0].knowledgeVersion='2.0.0'],['bad content hash',s=>s.pins[0].contentHash='owner-asserted'],['account capability field',s=>s.pins[0].accountAccess=true],['missing review fingerprint',s=>delete s.pins[0].reviewerFingerprint],['missing scope',s=>delete s.pins[0].content.scope],['malformed wrapper',s=>delete s.format],['nested authority',s=>s.pins[0].content.authorization={spend:true}],
])test(`R09 worker snapshot rejects ${name}`,()=>{const s=snapshot();change(s);assert.throws(()=>readQuestKnowledge(s,id(5),id(6)),/r09_/);});
test('R09 runtime reader fails closed on missing knowledge projection',()=>assert.throws(()=>readQuestKnowledge(undefined,id(5),id(6)),/r09_/));
test('R09 accepts the bounded twenty-lesson snapshot without scanner truncation',()=>{
 const s=snapshot();s.pins=Array.from({length:20},(_,i)=>({...pin(),applicationId:id(100+i),releaseId:id(200+i),installationId:id(300+i),packKey:`knowledge.learned.lesson-${i}`,knowledgeKey:`knowledge.learned.lesson-${i}`,applicationReason:'A'.repeat(1800)}));
 assert.equal(readQuestKnowledge(s,id(5),id(6)).pins.length,20);s.pins.push({...pin(),packKey:'knowledge.learned.overflow'});assert.throws(()=>readQuestKnowledge(s,id(5),id(6)),/r09_/);
});
test('R09 manifest preview rejects a credential-like release name',()=>assert.throws(()=>reviewedKnowledgeManifest({packKey:'knowledge.learned.provenance',version:'1.0.0',name:'secret: do-not-retain'},review(),now),/r09_/));

function plan(){
 const p={format:'r07.1',businessId:id(5),goalId:id(7),goalRevision:1,goalHash:'a'.repeat(64),businessRevision:1,businessHash:'b'.repeat(64),policyId:id(8),policyHash:'c'.repeat(64),authorityRootId:id(5),plannerWorkerDefinitionId:id(10),currency:'USD',maximumMicrounits:'600',deadline:'2027-01-01T00:00:00Z',expiresAt:'2027-01-01T00:00:00Z',maximumRepairs:1,maximumPivots:1,maximumChildren:3,maximumDispatches:3,requiredChecks:['challenge'],finishCondition:'all_required_outputs_verified',stopConditions:['no_permitted_work','deadline','repair_exhausted','owner_stopped'],steps:[]};
 for(const [i,key] of ['research','challenge'].entries())p.steps.push({key,kind:key,objective:'Bounded evidence comparison',reason:'Review scoped evidence',adapter:`fixture.${key}`,qualificationHash:'d'.repeat(64),installationId:id(20),packSnapshotHash:'e'.repeat(64),workflowDefinitionId:id(21),workerDefinitionId:id(22+i),role:key,operationKey:'research.model',purpose:'Research planning',dependsOn:i?['research']:[],expectedArtifactType:`r07.${key}`,maximumMicrounits:'300',expiresAt:p.expiresAt,notBefore:'2026-10-01T00:00:00Z',measurement:null,maximumRepairs:1});return p;
}
for(const status of ['scheduled','reserved','dispatched','uncertain','responded'])test(`R09 ${status} adapter receives exact deeply immutable lesson snapshot`,async()=>{
 const p=plan(),attempt={id:id(30),stepKey:'research',attempt:1,status,reason:'test',inputHash:'a'.repeat(64),dependencyPins:[],repairEvidenceHash:'a'.repeat(64),wireHash:null,requestId:null,responseHash:null};
 const saved={businessId:id(5),goalId:id(7),planId:id(6),version:1,planHash:'a'.repeat(64),plan:p,head:{state:'ready'},attempts:[attempt],reused:[],knowledge:snapshot()};
 const observed=[];const check=context=>{observed.push(context);assert.deepEqual(context.knowledge,snapshot());assert.ok(Object.isFrozen(context.knowledge.pins[0].content.limitations));assert.throws(()=>context.knowledge.pins[0].content.guidance='changed',TypeError);};
 const body=JSON.stringify({model:'inert',max_tokens:10,stream:false});const response={outcome:'accepted',result:{finding:'Inert result'},checkedArtifacts:[],settlement:{actualMicrounits:'0',providerRequestId:'inert',receiptHash:'f'.repeat(64)}};
 const adapter={qualificationHash:p.steps[0].qualificationHash,workflowDefinitionId:id(21),workerDefinitionId:id(22),mode:'simulation',prepare:async context=>{check(context);return {descriptor:{workflowRunId:attempt.id,idempotencyKey:`r07:${attempt.id}`,operationKey:'research.model',wireRequestHash:createHash('sha256').update(body).digest('hex'),wireRequestBytes:Buffer.byteLength(body),accounting:{kind:'r05'},providerModelId:'inert',maximumOutputTokens:10},wire:{url:'https://openrouter.ai/api/v1/chat/completions',method:'POST',body}};},dispatch:async(call,context)=>{check(context);return response;},reconcile:async context=>{check(context);return {status:'found',response};}};
 let finishes=0;const store={read:async()=>structuredClone(saved),command:async operation=>operation==='claim'?{epoch:1}:operation==='reserve'?{status:'reserved'}:operation==='dispatch'?{shouldDispatch:true}:operation==='finish'?{reason:++finishes===1?'unresolved_liability':'done'}:{}};
 await driveQuestOnce(store,{adapters:{'fixture.research':adapter},reconcile:true});assert.ok(observed.length>=1);assert.deepEqual(saved.knowledge,snapshot());
});
