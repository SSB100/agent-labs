import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,phase,complete,archive} from './helpers/r12-adaptive-inputs-fixture.mjs';
import {id,now} from './helpers/r12-adaptive-fixture.mjs';
import {discoveryV2Hash as hash} from '../.core-tests/products/discovery-v2.js';
import {readAdaptivePhaseInputs} from '../.core-tests/products/discovery-r12-adaptive-inputs.js';
import {buildAdaptivePhaseRequest} from '../.core-tests/products/discovery-r12-adaptive-runtime.js';
import {preflightAdaptiveOwnerPlanner} from '../.core-tests/products/discovery-r12-adaptive-planner-preflight.js';
import {inspectAdaptiveResearchWire} from '../.core-tests/products/discovery-r12-adaptive-wire.js';
const originalNow=Date.now;test.before(()=>{Date.now=()=>now;});test.after(()=>{Date.now=originalNow;});
function observed(){
  const f=fixture(),stamp=new Date(now-1000).toISOString();
  const observations=['candidate nature','candidate botanical','negative reference'].map((term,i)=>{
    const content=`${term}: conversion Very low. No numerical conversion rate or buyer country was displayed.`;
    return{id:id(600+i),sourceId:`owner-source-${i}`,provenance:'owner_reported_capture',source:{url:'https://market.example/owner/insights',interface:'Owner keyword insights',capturedAt:stamp,captureHash:String(i+1).repeat(64)},context:{productFormat:'Original adult printed T-shirt',category:'Adult apparel',query:term,windowStart:new Date(now-86400000).toISOString(),windowEnd:stamp,locale:'en-NZ',geography:{kind:'unknown',countries:[],basis:'Buyer segmentation was not displayed.'}},content,contentHash:hash(content),metrics:[{id:'conversion',label:'Conversion band',displayed:'Very low',start:0,end:Array.from(content).length,kind:'ordinal',scale:['Very low','Low','High'],value:'Very low',definition:'Provider relative conversion band; no numeric rate supplied.'}],limitations:['Negative signal retained; no candidate sales or country-level demand demonstrated.'],dataClass:'aggregate_nonpersonal'};
  });
  const c=observations[0].context,baseline={version:'r12.owner-observation-baseline.1',declaredAt:stamp,timing:'retrospective',productFormat:c.productFormat,category:c.category,windowStart:c.windowStart,windowEnd:c.windowEnd,locale:c.locale,candidateObservationIds:observations.slice(0,2).map(o=>o.id),referenceObservationId:observations[2].id,hypothesis:'A narrower adult interest may justify a bounded original design experiment.',positiveCriterion:'A supported contrast supplies an informative bounded learning test.',negativeCriterion:'Contrary observations defeat the specific premise.',inconclusiveCriterion:'Missing comparable exposure leaves demand unknown.'};
  const body={version:'r12.owner-observations.1',id:id(590),businessId:f.raw.businessId,ownerId:id(591),createdAt:stamp,observations,baseline,privacyAttestation:'reviewed_aggregate_only_no_credentials_or_customer_data'},bundle={...body,bundleHash:hash(body)};
  const manifest=[{bundleId:bundle.id,bundleHash:bundle.bundleHash,selectedObservationIds:observations.map(o=>o.id)}],selection={manifestHash:hash(manifest),manifest};
  f.raw.preview.ownerObservationRef=selection;f.raw.scope.ownerObservationRef=selection;
  f.ctx.plan.discoveryScopeHash=hash(f.raw.scope);f.ctx.planHash=hash(f.ctx.plan);f.raw.planHash=f.ctx.planHash;
  f.raw.action.scopeHash=hash(f.raw.scope);f.raw.actionHash=hash(f.raw.action);
  Object.assign(f.raw.intentPins,{ownerObservationRef:selection,scopeHash:hash(f.raw.scope),actionHash:f.raw.actionHash});f.ctx.attempt.adaptiveActionHash=f.raw.actionHash;
  f.raw.ownerObservationContext={version:'r12.owner-observation-context.1',intentId:f.raw.intent.id,businessId:f.raw.businessId,ownerId:bundle.ownerId,scopeId:f.raw.scope.id,scopeHash:hash(f.raw.scope),approvalHash:f.raw.scope.approvalHash,...selection,bundles:[bundle]};
  return f;
}
function packet(f){return{version:'r12.owner-adaptive-planner-preflight-input.1',setupId:f.raw.scope.setupId,setupHash:f.raw.scope.setupHash,scopeId:f.raw.scope.id,cutoff:f.raw.intent.expiresAt,intent:f.raw.intent,intentPins:f.raw.intentPins,knowledgeSnapshot:f.raw.knowledgeSnapshot,quoteHash:f.quote.quoteHash,inputHash:'f'.repeat(64),ownerObservationContext:f.raw.ownerObservationContext};}
test('initial planner preflight and actual phase serialize identical selected observations and baseline',async()=>{
  const f=observed();f.raw.intentPins.materialHistory=[{kind:'negative_finding',recordHash:'a'.repeat(64),statement:'The saved reference comparison is weak; this does not establish any niche success.',evidenceArtifactIds:[id(602)]}];
  const inputs=phase(f,'plan'),request=buildAdaptivePhaseRequest(inputs,now),body=JSON.parse(request.messages[1].content);
  assert.equal(body.ownerObservationContext.selectedObservations.length,3);assert.equal(body.ownerObservationContext.baselines[0].baseline.timing,'retrospective');
  assert.match(request.messages[1].content,/negative reference/);assert.match(request.messages[1].content,/No numerical conversion rate/);
  const a=await preflightAdaptiveOwnerPlanner(packet(f),f.quote,now),b=await inspectAdaptiveResearchWire(request,'plan',f.quote,now);
  assert.equal(a.requestHash,b.requestHash);assert.equal(a.wireHash,b.wireHash);assert.equal(a.wireBytes,b.wireBytes);
});
test('all five genuine phase receipts preserve citable owner negatives alongside actual Exa evidence',()=>{
  const f=observed();complete(f,'plan',f.outputs.plan);complete(f,'search1',f.outputs.search1);complete(f,'select1',f.outputs.select1);archive(f);
  const s=phase(f,'strategy'),pool=s.prepared.evidencePool;assert.equal(pool.filter(e=>e.sourceContext?.provenance==='owner_reported_capture').length,3);assert.equal(s.prepared.dossier.packRefs.length,1);
  assert.match(JSON.stringify(buildAdaptivePhaseRequest(s,now)),/Negative signal retained/);
  complete(f,'strategy',{assessment:f.outputs.strategy,measurement:null});const r=phase(f,'review');
  assert.deepEqual(r.reviewContext.allowedEvidenceRefs,r.prepared.evidencePool.map(e=>e.key));
  const review={version:'r12.adaptive-review.1',proposalHash:r.strategy.proposalHash,outcome:'NEEDS_MORE_EVIDENCE',ratings:Object.fromEntries(['evidence','learningValue','testDesign','feasibility'].map(k=>[k,{score:0,rationale:'These attributed negative signals do not establish this proposed test.',evidenceRefs:[]}])),proposalConcerns:[],executionPrerequisites:[],additionalQuestions:[],sufficiencyRationale:'Keep the weak conversion signal and geographic uncertainty; no bounded test has been supplied.'};
  const done=complete(f,'review',review);assert.equal(done.projected.result.outcome,'NEEDS_MORE_EVIDENCE');assert.equal(done.projected.result.review.executionAuthorized,false);assert.equal(f.raw.dependencies.length,5);
});
test('tenant, selection, frozen scope/approval, content and unselected records fail before request construction',()=>{
  const f=observed();phase(f,'plan');
  for(const change of [r=>r.ownerObservationContext.ownerId=id(999),r=>r.ownerObservationContext.businessId=id(999),r=>r.ownerObservationContext.scopeHash='f'.repeat(64),r=>r.ownerObservationContext.approvalHash='f'.repeat(64),r=>r.ownerObservationContext.intentId=id(999),r=>r.ownerObservationContext.bundles[0].observations[0].content+=' changed',r=>r.ownerObservationContext.manifest[0].selectedObservationIds.pop(),r=>r.intentPins.ownerObservationRef=null,r=>r.ownerObservationContext=null]){
    const raw=structuredClone(f.raw);change(raw);assert.throws(()=>readAdaptivePhaseInputs(f.ctx,raw));
  }
});
test('missing observation context never falls back; explicit null preserves the unextended source path',async()=>{
  const f=fixture(),request=buildAdaptivePhaseRequest(phase(f,'plan'),now);assert.equal(JSON.parse(request.messages[1].content).ownerObservationContext,undefined);
  const result=await preflightAdaptiveOwnerPlanner(packet(f),f.quote,now),wire=await inspectAdaptiveResearchWire(request,'plan',f.quote,now);assert.equal(result.wireHash,wire.wireHash);
  const bad=structuredClone(f.raw);delete bad.ownerObservationContext;assert.throws(()=>readAdaptivePhaseInputs(f.ctx,bad));
  const p=packet(f);delete p.intentPins.ownerObservationRef;await assert.rejects(preflightAdaptiveOwnerPlanner(p,f.quote,now));
});
test('complete owner context plus material history over quote fails preflight without truncation',async()=>{
  const f=observed();f.raw.intentPins.materialHistory=Array.from({length:60},(_,i)=>({kind:'negative_finding',recordHash:String(i).padStart(64,'0'),statement:'Preserve the exact prior unresolved limitation. '.repeat(10),evidenceArtifactIds:[]}));
  await assert.rejects(preflightAdaptiveOwnerPlanner(packet(f),f.quote,now),/preflight_failed/);
});
