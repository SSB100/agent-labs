import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
const C=require('../.core-tests/listing/contracts.js');
const R=require('../.core-tests/listing/runtime.js');
const K=require('../.core-tests/listing/knowledge.js');
const {listingFixture,listingFixtureId:id}=require('../.core-tests/listing/fixtures.js');
const {runListingSyntheticEvaluation}=require('../.core-tests/listing/evaluations.js');
const {listingPackManifests,listingWorker}=require('../.core-tests/listing/packs.js');
const {validatePackManifest}=require('../.core-tests/packs/registry.js');
const {resolvePackDependencies}=require('../.core-tests/packs/dependencies.js');
const {assertJsonSchemaValue}=require('../.core-tests/workers/schema-validator.js');
const {projectProviderJsonSchema}=require('../.core-tests/models/openrouter.js');
const {hash}=require('../.core-tests/etsy/contracts.js');
const {seal}=require('../.core-tests/etsy/vault.js');
const {authenticateListingReview}=require('../.core-tests/listing/intake.js');
const canonical=v=>JSON.parse(JSON.stringify(v,(_key,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x));

test('synthetic suite scores every required case without live competence or promotion',()=>{
 const r=runListingSyntheticEvaluation();assert.equal(r.status,'passed');assert.equal(r.passedCaseCount,22);assert.equal(r.failedCaseCount,0);assert.equal(r.score,100);
 assert.equal(r.evidenceMode,'synthetic');assert.equal(r.qualification,'experimental');assert.equal(r.liveCompetence,false);assert.equal(r.realDraftMatched,false);assert.equal(r.promotionAllowed,false);
 assert.deepEqual(r.dimensions,C.LISTING_DIMENSIONS);assert.ok(r.results.every(c=>c.modelTelemetry===null&&c.evidence.externalCalls===0));
});
test('new packs and training examples are valid, pinned and experimental',()=>{
 const packs=listingPackManifests();for(const p of packs)validatePackManifest(p);
 assert.deepEqual(packs.flatMap(p=>p.workflows).map(w=>w.key),['etsy.listing-review','etsy.listing-qualification']);const releases=packs.map((manifest,n)=>({id:id(100+n),status:'experimental',manifest}));
 for(const p of packs){resolvePackDependencies(releases,{packKey:p.packKey,version:p.version},true);assert.throws(()=>resolvePackDependencies(releases,{packKey:p.packKey,version:p.version}));}
 for(const role of ['specialist','reviewer']){const w=listingWorker(role);assert.equal(w.manifest.modelRequirements.qualificationScope,'stage17_listing_review');assert.equal(w.manifest.modelRequirements.maximumAttempts,1);assert.equal(w.manifest.modelRequirements.primaryOnly,true);assert.deepEqual(w.manifest.capabilityPolicy.allowed,[]);for(const example of w.manifest.examples)assertJsonSchemaValue(w.manifest.outputSchema,example.expectedOutput,example.name);}
 assert.deepEqual(JSON.parse(readFileSync('packs/listing-catalog.json','utf8')),packs);
});
test('request exposes full facts, policy and exact local bounds with no truncation',()=>{
 const f=listingFixture(),s=R.prepareListingTask(f.input,'specialist',id(20),undefined,f.now),r=R.prepareListingTask(f.input,'reviewer',id(21),f.proposal,f.now,f.execution('specialist',f.proposal));
 for(const prepared of [s,r]){const joined=prepared.request.messages.map(m=>m.content).join('\n');for(const fact of f.input.facts)assert.ok(joined.includes(fact.statement));for(const source of f.input.sources)assert.ok(joined.includes(source.snapshotHash));assert.ok(joined.includes(f.input.imagery[0].reviewResult.observedProduct));assert.ok(joined.includes('30–400')||joined.includes('1–140'));assert.ok(joined.includes('Exact output limits'));assert.equal(prepared.request.maxOutputTokens,6000);assert.ok(Buffer.byteLength(JSON.stringify(prepared.request))<=64000);assert.equal(prepared.request.requireReturnedModel,true);assert.deepEqual(prepared.context.taskContract.permittedCapabilities,[]);}
 assert.notEqual(s.request.model.providerModelId,r.request.model.providerModelId);assert.equal(s.requestHash,hash(s.request));
 assert.ok(JSON.stringify(r.context).includes('renderedProduct'));assert.ok(JSON.stringify(r.context).includes('specialistExecution'));
});
test('JSON key order does not invalidate semantically identical immutable attributes',()=>{
 const f=listingFixture();f.proposal.attributes={properties:f.proposal.attributes.properties.map(p=>({values:p.values,scaleId:p.scaleId,valueIds:p.valueIds,propertyId:p.propertyId})),materials:f.proposal.attributes.materials,taxonomyId:f.proposal.attributes.taxonomyId};
 C.validateListingProposal(f.input,f.proposal,f.now);
});
test('representative full-shaped provider responses satisfy projected and local contract',()=>{
 const f=listingFixture();f.proposal.title.text='x'.repeat(140);f.proposal.description=Array.from({length:8},(_,n)=>({text:`Paragraph ${n} `+'x'.repeat(888),factIds:['garment']}));
 f.proposal.tags=Array.from({length:13},(_,n)=>({text:`tag ${n}`,factIds:['garment']}));
 C.validateListingProposal(f.input,f.proposal,f.now);assertJsonSchemaValue(projectProviderJsonSchema(C.listingProposalSchema(f.input)),canonical(f.proposal),'Projected full response');
 for(const check of Object.values(f.review.checks))check.rationale='x'.repeat(400);C.validateListingReview(f.review);assertJsonSchemaValue(projectProviderJsonSchema(C.LISTING_REVIEW_SCHEMA),f.review,'Projected full review');
 for(const field of C.LISTING_DIMENSIONS){const altered=structuredClone(f.review);altered.checks[field].rationale+='x';assert.throws(()=>C.validateListingReview(altered));}
});
test('oversized complete context stops before dispatch rather than dropping facts',()=>{
 const f=listingFixture();f.input.facts=Array.from({length:40},(_,n)=>({id:`fact-${n}`,statement:'x'.repeat(600),kind:'product',evidence:[{sourceId:f.input.sources[0].id,pointer:'/garment'}]}));
 f.input.disclosures[0].factIds=['fact-0'];f.input.disclosures[1].factIds=['fact-1'];f.input.product.description='x'.repeat(10000);
 f.input.product.properties=Array.from({length:30},(_,n)=>({propertyId:n+1,valueIds:[100+n],values:['x'.repeat(200)],scaleId:null}));
 f.input.product.productFactsHash=C.listingFactsHash(f.input);f.input.imagery[0].productFactsHash=f.input.product.productFactsHash;f.input.imagery[0].reviewResultHash=C.listingImageReviewHash(f.input.imagery[0]);
 assert.throws(()=>R.prepareListingTask(f.input,'specialist',id(20),undefined,f.now),/listing_request_too_large/);
});
test('current source knowledge hash/freshness is immutable and excludes future-dated policy',()=>{
 const pack=K.listingKnowledgePackManifest(),record=pack.knowledge[0],start=Date.parse(record.verifiedAt);
 const original=K.listingKnowledgeHash();record.content.injected='changed';assert.equal(K.listingKnowledgeHash(),original);
 K.assertListingKnowledgeFresh(start);K.assertListingKnowledgeFresh(start+30*86400000-1);
 assert.throws(()=>K.assertListingKnowledgeFresh(start-1));assert.throws(()=>K.assertListingKnowledgeFresh(start+30*86400000));assert.throws(()=>K.assertListingKnowledgeFresh(NaN));
 const text=JSON.stringify(K.listingKnowledgePackManifest());assert.match(text,/2026-10-05/);assert.match(text,/10 reviewed images/);assert.match(text,/20/);
});
test('no owner JSON or synthetic receipt may satisfy authenticated Stage16 intake',()=>{
 const f=listingFixture(),p=C.assembleListingProduct(f.input,f.proposal,f.now),key='1'.repeat(64),record=f.record();
 assert.throws(()=>authenticateListingReview(record,p,key,f.now),/authenticated_listing_review_required/);
 const envelope=seal(record,`listing-review:${p.businessId}:${p.id}`,key);
 assert.throws(()=>authenticateListingReview(envelope,p,key,f.now),/live_listing_review_required/);
 assert.throws(()=>authenticateListingReview(envelope,{...p,businessId:id(90)},key,f.now),/invalid_sealed_record/);
 assert.throws(()=>authenticateListingReview(envelope,{...p,id:id(90)},key,f.now),/invalid_sealed_record/);
 assert.throws(()=>authenticateListingReview(envelope,p,'2'.repeat(64),f.now),/invalid_sealed_record/);
});
// These fixture-created envelopes test the transport boundary only. They are not
// genuine live receipts and are never persisted, installed or used for a draft.
function wireFixture(){const f=listingFixture();f.input.evidenceMode='live';const specialist=f.execution('specialist',f.proposal),reviewer=f.execution('reviewer',f.review);specialist.mode=reviewer.mode='live_model';const record=R.reviewListing(f.input,f.proposal,f.review,specialist,reviewer,f.now);return{...f,record,p:C.assembleListingProduct(f.input,f.proposal,f.now)};}
test('authenticated review wire binding rejects edits to exact package and receipts',()=>{
 const f=wireFixture(),key='1'.repeat(64);const envelope=seal(f.record,`listing-review:${f.p.businessId}:${f.p.id}`,key);
 assert.equal(authenticateListingReview(envelope,f.p,key,f.now).publicationAllowed,false);
 for(const change of [p=>p.title+=' changed',p=>p.priceMinor++,p=>p.images[0].altText+=' changed',p=>p.tags.push('new tag'),p=>p.productFactsHash='a'.repeat(64)]){const p=structuredClone(f.p);change(p);assert.throws(()=>authenticateListingReview(envelope,p,key,f.now),/reviewed_listing_package_changed/);}
 const record=structuredClone(f.record);record.specialist.providerRequestId=record.reviewer.providerRequestId;assert.throws(()=>R.assertReviewedListing(record,f.p,f.now),/independent_listing_review_required/);
 record.specialist=f.record.specialist;record.knowledgeHash='0'.repeat(64);assert.throws(()=>R.assertReviewedListing(record,f.p,f.now),/listing_policy_changed/);
});
test('future, stale and altered image evidence fail independently of product approval',()=>{
 for(const mutation of [f=>f.input.imagery[0].reviewedAt=new Date(f.now+1).toISOString(),f=>f.input.imagery[0].reviewedAt=new Date(f.now-86400000).toISOString(),f=>f.input.imagery[0].sha256='0'.repeat(64),f=>f.input.imagery[0].productFactsHash='0'.repeat(64),f=>f.input.imagery[0].altText='Unverified caption']){const f=listingFixture();mutation(f);assert.throws(()=>C.validateListingInput(f.input,f.now),/listing_image_evidence_mismatch/);}
});
test('custom manufacturing requires photos and AI-copy usage alone does not force AI-item disclosure',()=>{
 const f=listingFixture();f.input.productType='custom_manufactured';f.input.product.productFactsHash=C.listingFactsHash(f.input);f.input.imagery[0].productFactsHash=f.input.product.productFactsHash;f.input.imagery[0].reviewResultHash=C.listingImageReviewHash(f.input.imagery[0]);
 assert.throws(()=>C.validateListingInput(f.input,f.now),/finished_product_photo_required/);f.input.imagery[0].kind='finished_product_photo';f.input.imagery[0].reviewResultHash=C.listingImageReviewHash(f.input.imagery[0]);C.validateListingInput(f.input,f.now);
 f.input.aiAssisted=false;f.input.disclosures=f.input.disclosures.slice(0,1);f.input.product.productFactsHash=C.listingFactsHash(f.input);f.input.imagery[0].productFactsHash=f.input.product.productFactsHash;f.input.imagery[0].reviewResultHash=C.listingImageReviewHash(f.input.imagery[0]);f.proposal.disclosureKeys=['production_partner'];C.validateListingProposal(f.input,f.proposal,f.now);
});
test('request identifiers, actual model and exact output hashes are all required',()=>{
 for(const mutation of [e=>e.providerRequestId='',e=>e.providerModelId='other/model',e=>e.requestHash='0'.repeat(64),e=>e.outputHash='0'.repeat(64),e=>e.mode='live_model',e=>e.completedAt='2099-01-01T00:00:00Z']){const f=listingFixture(),e=f.execution('specialist',f.proposal);mutation(e);assert.throws(()=>R.reviewListing(f.input,f.proposal,f.review,e,f.execution('reviewer',f.review),f.now),/listing_execution_mismatch/);}
});
test('facts must resolve exact same-Business current source snapshots and receipt identities',()=>{
 const cases=[
  [f=>f.input.sources=[],/listing_source_evidence_required/],
  [f=>f.input.sources[0].businessId=id(99),/invalid_listing_source_evidence/],
  [f=>f.input.sources[0].snapshot.garment='Counterfeit source change',/invalid_listing_source_evidence/],
  [f=>f.input.sources[0].recordId=id(99),/listing_source_receipt_mismatch/],
  [f=>f.input.sources[1].recordId=id(99),/listing_source_approval_mismatch/],
  [f=>f.input.sources[0].verifiedAt=new Date(f.now-86400000).toISOString(),/invalid_listing_source_evidence/],
  [f=>f.input.facts[0].evidence=[],/listing_fact_source_required/],
  [f=>f.input.facts[0].evidence[0].sourceId=id(99),/listing_fact_source_required/],
  [f=>f.input.facts[0].evidence[0].pointer='/nonexistent',/unresolved_listing_source_pointer/],
  [f=>f.input.facts[0].evidence[0].pointer='/__proto__',/unresolved_listing_source_pointer/],
 ];
 for(const [change,pattern] of cases){const f=listingFixture();change(f);assert.throws(()=>C.validateListingInput(f.input,f.now),pattern);}
 const f=listingFixture();assert.equal(C.listingEvidenceValue(f.input.sources[0],'/garment'),f.input.facts[0].statement);
});
test('resolved visual-review outcome is hash-bound and substantive, never an opaque label',()=>{
 for(const change of [f=>f.input.imagery[0].reviewResult.observedProduct='Changed without a new result hash',f=>f.input.imagery[0].reviewResultHash='0'.repeat(64),f=>{f.input.imagery[0].reviewResult.productMatches=false;f.input.imagery[0].reviewResultHash=C.listingImageReviewHash(f.input.imagery[0]);},f=>{f.input.imagery[0].reviewResult.observedProduct='Too short';f.input.imagery[0].reviewResultHash=C.listingImageReviewHash(f.input.imagery[0]);}]){const f=listingFixture();change(f);assert.throws(()=>C.validateListingInput(f.input,f.now),/resolved_listing_image_review_required/);}
});
test('a worker receipt cannot predate source and image verification',()=>{
 const f=listingFixture(),e=f.execution('specialist',f.proposal);e.completedAt=new Date(f.now-45000).toISOString();assert.throws(()=>R.reviewListing(f.input,f.proposal,f.review,e,f.execution('reviewer',f.review),f.now),/listing_execution_mismatch/);
});
test('review explanations cannot be blank, padded or contain control characters',()=>{
 for(const rationale of [' '.repeat(30),'  A sufficiently long but padded review explanation.','A sufficiently long explanation with a\nline break.']){const f=listingFixture();for(const check of Object.values(f.review.checks))check.rationale=rationale;assert.throws(()=>C.validateListingReview(f.review),/invalid_listing_review_rationale/);}
});
