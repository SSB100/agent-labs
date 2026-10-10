import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { discoveryV2Hash as hash, validateDiscoveryDossierV2, resolveDiscoveryEvidenceV2 } from '../.core-tests/products/discovery-v2.js';
import { discoveryV2Hash as sharedHash } from '../.core-tests/products/discovery-v2-hash.js';
import { prepareDiscoveryWorkerContextV2, buildStrategistRequestV2 } from '../.core-tests/products/discovery-v2-worker-contract.js';
import { extractResearchSources, assembleEvidencePack } from '../.core-tests/research/sources.js';
import { discoveryKnowledgeFixture } from './discovery-v2-fixtures.mjs';
const id=n=>`00110000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const now=Date.parse('2026-09-30T23:10:00Z'), stamp=new Date(now).toISOString();
function fixture(){
  const intent={version:'pod-discovery-2.0',id:id(1),businessId:id(2),objective:'Compare an original adult shirt hypothesis using observed signals and bounded independent learning.',comparisonUniverse:{productType:'original_pod_tshirt',markets:[{countryCode:'NZ',currency:'NZD'},{countryCode:'US',currency:'USD'}],audiences:['Adult nature enthusiasts'],sourceDomains:['research.example'],selectionQuestion:'Investigate bounded original adult shirt learning and operating constraints.'},limits:{maximumAlternatives:3,maximumNewCollections:1,maximumMicrousd:500000,maximumGenerations:1},expiresAt:new Date(now+86400000).toISOString()};
  const request={query:intent.comparisonUniverse.selectionQuestion,allowedDomains:['research.example']};
  const collection=extractResearchSources(request,{annotations:[{type:'url_citation',url_citation:{url:'https://research.example/report',title:'Synthetic operating context',content:'A synthetic report describes an ordinary garment specification. This is contextual operating information and cannot establish measured customer demand.'}}],metadata:{}},stamp);
  const pack=assembleEvidencePack(collection,{selectedEvidenceIds:collection.evidence.map(e=>e.id),limitations:['no_sales_metrics']},now);
  const p={artifactId:id(3),businessId:id(2),workflowRunId:id(4),queryId:id(5),collectedForIntentId:id(1),question:request.query,sourceDomains:request.allowedDomains,evidencePack:pack,lineage:{status:'completed',executionMode:'web.research',provider:'openrouter.exa',sourceArtifactId:id(6),providerRequestId:'provider-search-verified',workerRequestId:'provider-selector-verified'}};
  const candidate={id:id(7),businessId:id(2),concept:'An original adult nature illustration',audience:'Adult nature enthusiasts',productType:'original_pod_tshirt',originalDesign:true,rightsStatus:'unclear'};
  const content='Visits 0. No eligible exposure in this observation window.';
  const o={id:id(11),sourceId:'owner-source',provenance:'owner_reported_capture',source:{url:'https://market.example/owner/stats',interface:'Owner shop traffic',capturedAt:stamp,captureHash:'a'.repeat(64)},context:{productFormat:'Adult original printed shirt',category:'Apparel',query:'Own listing traffic',windowStart:new Date(now-86400000).toISOString(),windowEnd:stamp,locale:'en-NZ',geography:{kind:'unknown',countries:[],basis:'No buyer geography supplied.'}},content,contentHash:hash(content),metrics:[{id:'visits',label:'Visits',displayed:'0',start:0,end:Array.from(content).length,kind:'count',unit:'visits',value:0,precision:'exact'}],limitations:['Zero exposure is inconclusive; it does not demonstrate niche failure.'],dataClass:'aggregate_nonpersonal'};
  const body={version:'r12.owner-observations.1',id:id(10),businessId:id(2),ownerId:id(20),createdAt:stamp,observations:[o],baseline:null,privacyAttestation:'reviewed_aggregate_only_no_credentials_or_customer_data'};
  const bundle={...body,bundleHash:hash(body)},manifest=[{bundleId:bundle.id,bundleHash:bundle.bundleHash,selectedObservationIds:[o.id]}];
  const pins={scopeId:id(30),scopeHash:'b'.repeat(64),approvalHash:'c'.repeat(64),manifestHash:hash(manifest)};
  const dossier={version:'pod-discovery-2.0',intentId:id(1),businessId:id(2),packRefs:[{artifactId:p.artifactId,sha256:hash(pack),origin:'new',query:{id:p.queryId,question:p.question,sourceDomains:p.sourceDomains}}],shortlist:[candidate],comparisonRationale:'Compare the actual observations while keeping unknown demand and operating limits explicit.',ownerObservationRef:pins};
  const context={knowledge:discoveryKnowledgeFixture(now),packs:new Map([[p.artifactId,p]]),candidates:new Map([[candidate.id,candidate]]),committedMicrousd:0,ownerObservations:{version:'r12.owner-observation-context.1',intentId:id(1),businessId:id(2),ownerId:id(20),...pins,manifest,bundles:new Map([[bundle.id,bundle]])}};
  const ref={artifactId:o.id,evidenceId:'visits',sourceId:o.sourceId,sourceContentHash:o.contentHash,start:0,end:Array.from(content).length};
  return{intent,dossier,context,ref,bundle,o,p};
}
function rehash(f){const {bundleHash,...body}=f.bundle;void bundleHash;f.bundle.bundleHash=hash(body);f.context.ownerObservations.manifest[0].bundleHash=f.bundle.bundleHash;f.context.ownerObservations.manifestHash=hash(f.context.ownerObservations.manifest);f.dossier.ownerObservationRef={...f.dossier.ownerObservationRef,manifestHash:f.context.ownerObservations.manifestHash};}
test('citable owner negative observation retains source limitations in actual strategist request',()=>{
  const f=fixture(),prepared=prepareDiscoveryWorkerContextV2(f.intent,f.dossier,f.context,[f.ref],now);
  const request=buildStrategistRequestV2(prepared,now),serialized=JSON.stringify(request);
  assert.match(serialized,/Zero exposure is inconclusive/);assert.match(serialized,/owner_reported_capture/);assert.match(serialized,/independentVerification/);
  assert.equal(prepared.evidencePool[0].expiresAt,null);assert.equal(prepared.evidencePool[0].sourceContext.context.geography.kind,'unknown');
});
test('manifest membership, approval pins and actual bundle ownership cannot be substituted',()=>{
  for(const mutate of [f=>f.context.ownerObservations.ownerId=id(99),f=>f.bundle.businessId=id(99),f=>f.dossier.ownerObservationRef.approvalHash='d'.repeat(64),f=>f.context.ownerObservations.manifest[0].selectedObservationIds=[id(99)],f=>f.context.ownerObservations.manifest.push(structuredClone(f.context.ownerObservations.manifest[0])),f=>f.context.ownerObservations.bundles.set(id(99),f.bundle),f=>f.context.ownerObservations.intentId=id(99)]) {
    const f=fixture();mutate(f);assert.throws(()=>validateDiscoveryDossierV2(f.intent,f.dossier,f.context,now));
  }
  const f=fixture();f.bundle.observations.push({...structuredClone(f.o),id:id(12),sourceId:'unselected-source'});rehash(f);
  validateDiscoveryDossierV2(f.intent,f.dossier,f.context,now);
  assert.throws(()=>resolveDiscoveryEvidenceV2({...f.ref,artifactId:id(12),sourceId:'unselected-source'},f.dossier,f.context));
});
test('artifact/source collisions reject even correctly rehashed bundle rows',()=>{
  for(const mutate of [f=>f.o.id=f.p.artifactId,f=>f.o.sourceId=f.p.evidencePack.sources[0].id,f=>f.bundle.observations.push({...structuredClone(f.o),id:id(12)}),f=>f.o.id=f.bundle.id]){
    const f=fixture();mutate(f);f.context.ownerObservations.manifest[0].selectedObservationIds=[f.o.id];rehash(f);
    assert.throws(()=>validateDiscoveryDossierV2(f.intent,f.dossier,f.context,now));
  }
});
test('scope extension cannot silently activate via another mode or fabricated Exa pack',()=>{
  for(const mutate of [f=>delete f.context.ownerObservations,f=>delete f.dossier.ownerObservationRef,f=>f.context.ownerInitial={},f=>f.context.focusedPilot={},f=>f.context.evidenceAddendum={},f=>f.context.previousDecision={},f=>f.context.packs.set(f.o.id,f.bundle)]){
    const f=fixture();mutate(f);assert.throws(()=>validateDiscoveryDossierV2(f.intent,f.dossier,f.context,now));
  }
  const f=fixture();f.dossier.packRefs=[];assert.throws(()=>validateDiscoveryDossierV2(f.intent,f.dossier,f.context,now),'This pure slice does not relax the current pack minimum.');
});
test('worker preparation clones trusted map and binds selected source context and negatives',()=>{
  const f=fixture(),prepared=prepareDiscoveryWorkerContextV2(f.intent,f.dossier,f.context,[f.ref],now);
  f.o.limitations[0]='Changed after prepare';f.context.ownerObservations.bundles.clear();
  assert.match(JSON.stringify(buildStrategistRequestV2(prepared,now)),/Zero exposure is inconclusive/);
  prepared.validation.ownerObservations.bundles.get(id(10)).observations[0].limitations[0]='Negative removed';
  assert.throws(()=>buildStrategistRequestV2(prepared,now));
  const g=fixture(),p=prepareDiscoveryWorkerContextV2(g.intent,g.dossier,g.context,[g.ref],now);
  p.evidencePool[0].sourceContext.limitations=[];assert.throws(()=>buildStrategistRequestV2(p,now));
});
test('altered spans and hashes cannot cite another observation',()=>{
  const f=fixture();for(const patch of [{start:1},{end:4},{sourceContentHash:'f'.repeat(64)},{evidenceId:'made-up'}]) assert.throws(()=>prepareDiscoveryWorkerContextV2(f.intent,f.dossier,f.context,[{...f.ref,...patch}],now));
});
test('canonical hash extraction preserves prior algorithm bytes and failures',()=>{
  const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v);
  for(const v of [null,true,0,'🌿',{z:[1,{b:'b',a:'a'}],a:null},[]]) assert.equal(sharedHash(v),createHash('sha256').update(canonical(v)).digest('hex'));
  for(const v of [undefined,NaN,Infinity,{a:undefined}])assert.throws(()=>sharedHash(v));
  assert.equal(sharedHash({b:2,a:1}),hash({a:1,b:2}));
});
