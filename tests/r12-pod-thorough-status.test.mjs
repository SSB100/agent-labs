import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,source,workspace,text,button,elements,releaseRouteHarness} from './helpers/r12-pod-owner-ui-fixture.mjs';
const {podResearchProgress}=source('products/discovery-r12-pod-status');
const {POD_THOROUGH_PROFILE}=source('products/discovery-r12-pod-profile');
const base=()=>({state:'dispatched',reason:null,activeWindow:true,receiptUntil:'2026-10-13T01:00:00Z',phases:[{phase:'review',status:'dispatched',reason:null,responseDiagnostic:{code:'response_schema',observationSaved:true,issues:[]}}],cost:{knownMicrousd:'28912',heldMicrousd:'0',hasUnknown:false},podRuntime:{latestPassOrdinal:0,currentPassOpen:true,latestClosureOutcome:null,failedEffectReceiptStatus:'awaiting_receipt'}});
test('only saved thorough runtime makes known malformed response a counted receipt/research continuation',()=>{
 const status=base();assert.equal(podResearchProgress(status,false).blockedByResponse,true);
 const p=podResearchProgress(status,false,true);assert.equal(p.blockedByResponse,false);assert.equal(p.canContinue,true);assert.match(p.title,/Reconciling/);assert.match(p.explanation,/remains rejected/);
 status.podRuntime={latestPassOrdinal:1,currentPassOpen:true,latestClosureOutcome:'FAILED_OUTPUT',failedEffectReceiptStatus:null};
 assert.equal(podResearchProgress(status,false,true).title,'Research refinement saved');
 for(const change of [{activeWindow:false},{state:'blocked'},{cost:{...status.cost,hasUnknown:true}},{podRuntime:{...status.podRuntime,failedEffectReceiptStatus:'exhausted'}},{podRuntime:{...status.podRuntime,latestPassOrdinal:5}}])assert.equal(podResearchProgress({...status,...change},false,true).blockedByResponse,true);
 assert.equal(podResearchProgress(status,true,true).title,'Stopped');assert.equal(podResearchProgress(status,true,true).canContinue,false);
});
test('owner UI keeps refreshing saved counted recovery, exposes Stop, and does not claim worker liveness',()=>{
 const f=fixture(),receipt={...f.receipt,activated:true,confirmed:true};receipt.preview.profile=POD_THOROUGH_PROFILE;
 const h=workspace(f,{selected:receipt,status:base()}),view=text(h.render());
 assert.match(view,/Reconciling incomplete response/);assert.match(view,/does not verify that the background worker is still running/);assert.match(view,/Known cost: USD 0\.028912/);
 assert.ok(button(h.render(),'Continue saved run'));assert.ok(button(h.render(),'Stop research'));assert.equal(h.intervals.size,1);assert.equal(h.calls.length,0);h.unmount();
});
test('diagnostic limits preserve legacy12 and scoped16 rather than creating storage mismatch',()=>{
 const cache=new Map(),{r12ReviewDiagnostic}=source('products/discovery-r12-observation',{},{},cache),{JsonSchemaValidationError}=source('workers/schema-validator',{},{},cache);
 const error=new JsonSchemaValidationError('inert',Array.from({length:20},()=>({path:'$',message:'must be a string'})));
 const args=[error,'response_schema',{scopeId:'s',attemptId:'a',requestId:'r'},{type:'string'},true,'2026-10-12T21:00:00Z'];
 assert.equal(r12ReviewDiagnostic(...args).issues.length,12);assert.equal(r12ReviewDiagnostic(...args,16).issues.length,16);
});
test('full findings remain intact behind separate display summaries',()=>{
 const f=fixture(),receipt={...f.receipt,activated:true,confirmed:true},long='Research explanation about confidence and uncertainty. '.repeat(100);
 const result={review:{outcome:'INSUFFICIENT_EVIDENCE',rationale:long,nextTest:long,checks:[],missingEvidence:[]},assessment:{explorationSummary:long,candidates:[]},passNumber:1,maximumPasses:5,evidence:[],evidenceLimitations:[],submittedQuery:'inert query',sourceChoiceRationale:'inert public source policy',phaseReceipts:[]};
 const h=workspace(f,{selected:receipt,result}),tree=h.render();assert.match(text(tree),/Full text below/);
 const details=elements(tree,e=>e.type==='details');assert.ok(details.some(d=>text(d).startsWith('Full findings and assessment')&&text(d).includes(long)));assert.ok(details.some(d=>text(d).startsWith('Full independent review')));h.unmount();
});

test('read-only verifier exposes exact new ordinary/recovery schema and pack hashes without authority',async()=>{
 const h=releaseRouteHarness(),response=await h.get(),body=await response.json();
 assert.equal(response.status,200);assert.equal(body.authorityCreated,false);assert.equal(body.thorough.profile,POD_THOROUGH_PROFILE);
 assert.deepEqual(body.thorough.schemas,h.expectedThoroughSchemas(false));assert.deepEqual(body.thorough.recoverySchemas,h.expectedThoroughSchemas(true));assert.deepEqual(body.thorough.packs,h.expectedThoroughPacks());
 assert.ok(body.thorough.packs.every(p=>p.version==='2.0.0'));assert.notEqual(body.thorough.schemas.plan.systemHash,body.thorough.recoverySchemas.plan.systemHash);
 assert.equal(JSON.stringify(body).includes(h.fixtureEnv.R05_ADMISSION_SERVER_KEY),false);
});
