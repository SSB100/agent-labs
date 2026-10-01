import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {publicationFixture,id} from './etsy-publication-fixtures.mjs';
const require=createRequire(import.meta.url);
const {executeEtsyPublication,safePublicationReason}=require('../.core-tests/etsy-publication/engine.js');
const {PublicationActivationRejected}=require('../.core-tests/etsy-publication/adapter.js');
const {hash,EtsyError}=require('../.core-tests/etsy/contracts.js');
const {publicationRequestHash}=require('../.core-tests/etsy-publication/contracts.js');
const run=f=>executeEtsyPublication(f.store,f.provider);
const patches=f=>f.calls.filter(call=>call==='PATCH active').length;

test('synthetic full-shape draft activates once, independently reads back all facts and emits immutable distinct receipt',async()=>{
  const f=publicationFixture(),result=await run(f);
  assert.equal(result.status,'verified');assert.equal(result.providerState,'active');assert.equal(patches(f),1);
  assert.equal(f.receipts.length,1);assert.equal(f.resources.length,1);assert.equal(f.resources[0].resourceType,'published_listing');
  assert.equal(f.receipts[0].requestFingerprint,f.state.requestHash);assert.equal(f.receipts[0].responseSummary.feeStatus,'unreconciled');assert.equal(f.receipts[0].responseSummary.feeAmountMinor,null);
  assert.deepEqual(f.receipts[0].responseSummary.imageMappings,f.draft.imageMappings);assert.notEqual(f.receipts[0].id,f.draft.receiptId);
  assert.ok(f.calls.lastIndexOf('GET images')>f.calls.indexOf('PATCH active'));assert.ok(f.calls.lastIndexOf('GET return')>f.calls.indexOf('PATCH active'));
  const count=f.calls.length;await run(f);assert.equal(f.calls.length,count);assert.equal(f.receipts.length,1);assert.equal(patches(f),1);
});
for(const [name,change] of [
  ['business',f=>f.connection.businessId=id(90)],['connection',f=>f.connection.connectionId=id(90)],['revision',f=>f.connection.revision=id(90)],
  ['expired connection',f=>f.connection.expiresAt='2000-01-01T00:00:00Z'],['currency',f=>f.connection.currency='USD'],
  ['package content',f=>f.p.title='Tampered after owner review'],['latest source',f=>f.driftSource()],['review hash',f=>f.context.reviewHash='b'.repeat(64)],
  ['draft receipt hash',f=>f.context.draftReceiptHash='b'.repeat(64)],['approval hash',f=>f.context.approvalHash='b'.repeat(64)],['disclosure hash',f=>f.context.disclosureHash='b'.repeat(64)],
  ['request hash',f=>f.context.requestHash='b'.repeat(64)],['preflight hash',f=>f.context.preflightHash='b'.repeat(64)],
  ['foreign draft listing',f=>f.draft.listingId=999],['foreign draft shop',f=>f.draft.shopId=999],['future draft verification',f=>f.draft.verifiedAt=new Date(Date.now()+60000).toISOString()],['image mapping',f=>f.draft.imageMappings[0].listingImageId=999],
  ['foreign provider listing',f=>f.listing.listing_id=999],['foreign provider shop',f=>f.listing.shop_id=999],['listing quantity',f=>f.listing.quantity=2],['auto renewal',f=>f.listing.should_auto_renew=true],
  ['missing return policy',f=>f.listing.return_policy_id=null],['foreign return policy',f=>f.preflight.returnPolicy.shop_id=999],['incomplete shipping',f=>f.preflight.shippingProfile.shipping_profile_destinations=[]],
  ['changed shipping owner',f=>f.preflight.shippingProfile.user_id=999],['missing processing days',f=>delete f.preflight.processingProfile.min_processing_days],
  ['fee evidence absent',f=>f.context.financial=null],['fee quote tamper',f=>f.quote.taxMinor++],['fee cap tamper',f=>f.approval.maximumTotalMinor=1],
  ['consent data sharing',f=>f.approval.dataSharing='different'],['consent quantity',f=>f.approval.approvedQuantity=2],['future approval',f=>f.approval.approvedAt=new Date(Date.now()+60000).toISOString()],
])test(`preflight blocks ${name} without activation`,async()=>{const f=publicationFixture();change(f);const result=await run(f);assert.notEqual(result.status,'verified');assert.equal(patches(f),0);assert.equal(f.receipts.length,0);});

test('original package quantity greater than one remains unchanged and outside initial qualification lane',async()=>{
  const f=publicationFixture();f.p.quantity=2;f.listing.quantity=2;f.state.packageHash=hash(f.p);f.draft.packageHash=hash(f.p);f.approval.approvedQuantity=2;f.state.requestHash=publicationRequestHash(f.state);f.context.requestHash=f.state.requestHash;f.approval.requestHash=f.state.requestHash;f.state.approvalHash=hash(f.approval);f.context.approvalHash=f.state.approvalHash;
  const result=await run(f);assert.equal(result.reason,'publication_initial_qualification_limit');assert.equal(f.listing.quantity,2);assert.equal(patches(f),0);
});
test('cancel before execution makes no provider request',async()=>{const f=publicationFixture();f.cancel();assert.equal((await run(f)).status,'cancelled');assert.deepEqual(f.calls,[]);});
test('cancel after readback but before durable dispatch guard prevents activation',async()=>{
  const f=publicationFixture(),guard=f.store.guard;let n=0;f.store.guard=async mode=>{if(mode==='publish'&&++n===2)f.cancel();return guard(mode);};const result=await run(f);assert.equal(result.stopRequested,true);assert.equal(patches(f),0);assert.equal(result.status,'cancelled');
});
test('cancel after sent marker before dispatch retains marker and never activates on replay',async()=>{
  const f=publicationFixture(),save=f.store.save;f.store.save=async state=>{await save(state);if(state.activation)f.cancel();};await run(f);assert.equal(patches(f),0);assert.ok(f.state.activation);await run(f);assert.equal(patches(f),0);assert.equal(f.state.stopRequested,true);
});
test('late cancellation after accepted activation preserves exact active outcome and fee liability',async()=>{
  const f=publicationFixture(),activate=f.provider.activate;f.provider.activate=async id=>{const result=await activate(id);f.cancel();return result;};const result=await run(f);assert.equal(result.status,'verified');assert.equal(result.providerState,'active');assert.equal(result.stopRequested,true);assert.equal(f.receipts[0].responseSummary.stopRequested,true);assert.equal(f.receipts[0].responseSummary.feeStatus,'unreconciled');
});
test('lost response reconciles the same active listing using only GETs and never repeats activation',async()=>{
  const f=publicationFixture(),activate=f.provider.activate;f.provider.activate=async id=>{await activate(id);throw new EtsyError('provider_timeout');};assert.equal((await run(f)).status,'verified');assert.equal(patches(f),1);await run(f);assert.equal(patches(f),1);
});
test('unknown write retains liability when draft is still observed and replay cannot duplicate PATCH',async()=>{
  const f=publicationFixture();f.provider.activate=async()=>{f.calls.push('PATCH active');throw new EtsyError('provider_timeout');};await run(f);await run(f);assert.equal(patches(f),1);assert.equal(f.state.activation.status,'sent');assert.equal(f.state.reason,'uncertain_activation_not_observed');assert.equal(f.receipts.length,0);
  f.listing.state='active';assert.equal((await run(f)).status,'verified');assert.equal(patches(f),1);
});
test('known HTTP rejection is retained, terminal, and never described as a zero fee',async()=>{
  const f=publicationFixture();f.provider.activate=async()=>{f.calls.push('PATCH active');throw new PublicationActivationRejected('publication_rejected');};const result=await run(f);assert.equal(result.status,'failed');assert.equal(result.activation.status,'rejected');await run(f);assert.equal(patches(f),1);assert.equal(f.receipts.length,0);
});
test('source expiry and drift after dispatch permit only historical same-listing readback',async()=>{
  const f=publicationFixture(),activate=f.provider.activate;f.provider.activate=async id=>{const response=await activate(id);f.driftSource();return response;};assert.equal((await run(f)).status,'verified');assert.equal(patches(f),1);
});
test('expired approval after dispatch can be reconciled while new dispatch cannot use it',async()=>{
  const f=publicationFixture();let now=f.now;const activate=f.provider.activate;f.provider.activate=async id=>{const response=await activate(id);now+=400000;return response;};assert.equal((await executeEtsyPublication(f.store,f.provider,()=>now)).status,'verified');assert.equal(patches(f),1);
  const fresh=publicationFixture();assert.notEqual((await executeEtsyPublication(fresh.store,fresh.provider,()=>fresh.now+400000)).status,'verified');assert.equal(patches(fresh),0);
});
test('post-dispatch revocation retains saved write and cannot bypass account guard',async()=>{
  const f=publicationFixture(),activate=f.provider.activate;f.provider.activate=async listingId=>{const response=await activate(listingId);f.connection.revision='revoked';return response;};const result=await run(f);assert.equal(result.status,'needs_owner');assert.equal(result.activation.status,'accepted');assert.equal(result.providerState,'active');await run(f);assert.equal(patches(f),1);
});
for(const [name,change] of [
  ['price',f=>f.listing.price.amount=1],['title',f=>f.listing.title='Changed'],['image ID',f=>f.images[0].listing_image_id=900],['image rank',f=>f.images[0].rank=2],['extra property',f=>f.properties.push({...f.properties[0],property_id:901})],['missing property',f=>f.properties.pop()],['return policy',f=>f.providerPreflight.returnPolicy.accepts_returns=true],['shipping',f=>f.providerPreflight.shippingProfile.origin_country_iso='AU'],['processing',f=>f.providerPreflight.processingProfile.max_processing_days=10],
])test(`post-publication ${name} drift retains active state but never forges verification`,async()=>{
  const f=publicationFixture(),activate=f.provider.activate;f.provider.activate=async id=>{const result=await activate(id);change(f);return result;};const result=await run(f);assert.equal(result.status,'needs_owner');assert.equal(result.providerState,'active');assert.equal(patches(f),1);assert.equal(f.receipts.length,0);await run(f);assert.equal(patches(f),1);
});
test('already-active same listing before dispatch is observed without claiming our activation',async()=>{const f=publicationFixture();f.listing.state='active';const result=await run(f);assert.equal(result.providerState,'active');assert.equal(result.reason,'publication_already_active_before_dispatch');assert.equal(patches(f),0);assert.equal(f.receipts.length,0);});
test('foreign activation response does not authorize adopting a foreign listing; exact original GET can still settle',async()=>{const f=publicationFixture();f.provider.activate=async()=>{f.calls.push('PATCH active');return{listing_id:999,shop_id:100,state:'active'};};await run(f);assert.equal(f.state.activation.status,'sent');assert.equal(f.state.listingId,500);assert.equal(f.receipts.length,0);await run(f);assert.equal(patches(f),1);});
test('failed durable response save leaves original sent marker and replay uses only reads',async()=>{
  const f=publicationFixture(),save=f.store.save;let failed=false;f.store.save=async state=>{if(!failed&&state.activation?.status==='accepted'){failed=true;throw new Error('synthetic storage failure');}return save(state);};await run(f);assert.equal(patches(f),1);assert.equal((await run(f)).status,'verified');assert.equal(patches(f),1);
});
test('exclusive lease prevents concurrent duplicate execution',async()=>{
  const f=publicationFixture(),shop=f.provider.shop;let release;const held=new Promise(resolve=>{release=resolve;});f.provider.shop=async()=>{await held;return shop();};const first=run(f);await assert.rejects(run(f),/publication_in_progress/);release();await first;assert.equal(patches(f),1);
});
test('errors cannot leak arbitrary provider or repository text',()=>{assert.equal(safePublicationReason(new Error('Bearer secret-token provider response')),'execution_interrupted');assert.equal(safePublicationReason(new EtsyError('secret_token_value')),'execution_interrupted');});

test('malformed missing activation marker is rejected rather than treating a read-only replay as new consent',async()=>{const f=publicationFixture();delete f.state.activation;const result=await run(f);assert.equal(result.reason,'publication_state_invalid');assert.equal(patches(f),0);assert.equal(f.calls.length,0);});
test('known active acceptance cannot be erased by later stale draft GET or stop',async()=>{const f=publicationFixture(),activate=f.provider.activate;f.provider.activate=async id=>{const response=await activate(id);f.listing.state='draft';f.cancel();return response;};const result=await run(f);assert.equal(result.status,'needs_owner');assert.equal(result.providerState,'active');assert.equal(result.stopRequested,true);assert.equal(result.activation.status,'accepted');assert.equal(f.receipts.length,0);});

test('calculated shipping blocks before PATCH even with an otherwise owner-bound snapshot',async()=>{const f=publicationFixture();f.preflight.shippingProfile.profile_type='calculated';f.providerPreflight.shippingProfile.profile_type='calculated';f.state.preflightHash=hash(f.preflight);f.context.preflightHash=f.state.preflightHash;f.state.requestHash=publicationRequestHash(f.state);f.context.requestHash=f.state.requestHash;f.approval.requestHash=f.state.requestHash;f.state.approvalHash=hash(f.approval);f.context.approvalHash=f.state.approvalHash;const result=await run(f);assert.equal(result.reason,'publication_calculated_shipping_not_supported');assert.equal(patches(f),0);assert.equal(f.providerPreflight.shippingProfile.profile_type,'calculated');});
