import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {engineFixture,id} from './etsy-fixtures.mjs';
const require=createRequire(import.meta.url);
const {executeEtsyDraft}=require('../.core-tests/etsy/engine.js');
const {EtsyError,hash}=require('../.core-tests/etsy/contracts.js');
test('complete draft workflow reads back listing, images and properties and emits scoped Core evidence',async()=>{
  const f=engineFixture();const result=await executeEtsyDraft(f.store,f.provider);
  assert.equal(result.status,'verified');assert.equal(f.receipts.length,1);assert.equal(f.resources.length,1);
  assert.equal(f.receipts[0].responseSummary.verifiedBy,'independent_get');assert.equal(f.resources[0].externalId,'shop:100:listing:500');
  assert.equal(f.receipts[0].responseSummary.publicationAllowed,false);assert.equal(f.receipts[0].businessId,f.p.businessId);
  assert.ok(f.calls.lastIndexOf('GET listing')>f.calls.indexOf('PUT property'));
  await executeEtsyDraft(f.store,f.provider);assert.equal(f.calls.filter(v=>v==='POST listing').length,1);assert.equal(f.receipts.length,1);
});
for(const change of ['business','connection','revision','currency','expiry','package','asset'])test(`rejects changed ${change} before external write`,async()=>{
  const f=engineFixture();
  if(change==='business')f.connection.businessId=id(90);
  if(change==='connection')f.connection.connectionId=id(90);
  if(change==='revision')f.connection.revision=id(90);
  if(change==='currency')f.connection.currency='USD';
  if(change==='expiry')f.p.expiresAt='2000-01-01T00:00:00Z';
  if(change==='package')f.p.title='Changed after approval';
  if(change==='asset')f.p.images[0].sha256='b'.repeat(64);
  const r=await executeEtsyDraft(f.store,f.provider);assert.equal(r.status,'needs_owner');assert.ok(!f.calls.some(v=>v.startsWith('POST')));
});
test('lost create response reconciles initial marker and never repeats POST',async()=>{
  const f=engineFixture(),create=f.provider.create;
  f.provider.create=async(...args)=>{await create(...args);throw new EtsyError('provider_timeout');};
  assert.equal((await executeEtsyDraft(f.store,f.provider)).status,'needs_owner');assert.equal(f.state.operations[0].status,'sent');
  assert.equal((await executeEtsyDraft(f.store,f.provider)).status,'verified');assert.equal(f.calls.filter(v=>v==='POST listing').length,1);
});
test('uncertain creation with no observed draft remains stopped across repeated requests',async()=>{
  const f=engineFixture();f.provider.create=async()=>{f.calls.push('POST listing');throw new EtsyError('provider_timeout');};
  await executeEtsyDraft(f.store,f.provider);await executeEtsyDraft(f.store,f.provider);await executeEtsyDraft(f.store,f.provider);
  assert.equal(f.state.reason,'uncertain_creation_not_found');assert.equal(f.calls.filter(v=>v==='POST listing').length,1);
});
test('lost image response stays uncertain even when rank and alt text appear to match',async()=>{
  const f=engineFixture(),upload=f.provider.upload;f.provider.upload=async(...args)=>{await upload(...args);throw new EtsyError('provider_timeout');};
  await executeEtsyDraft(f.store,f.provider);await executeEtsyDraft(f.store,f.provider);
  assert.equal(f.state.reason,'uncertain_image_identity');assert.equal(f.calls.filter(v=>v==='POST image').length,1);assert.equal(f.receipts.length,0);
});
test('known upload identity survives failed read and resumes without another upload',async()=>{
  const f=engineFixture(),images=f.provider.images;let count=0;f.provider.images=async()=>{if(++count===2)throw new EtsyError('provider_timeout');return images();};
  await executeEtsyDraft(f.store,f.provider);assert.equal(f.state.operations[1].externalId,601);
  assert.equal((await executeEtsyDraft(f.store,f.provider)).status,'verified');assert.equal(f.calls.filter(v=>v==='POST image').length,1);
});
test('partial two-image upload retains first image and does not repeat either uncertain operation',async()=>{
  const f=engineFixture();f.p.images.push({...f.p.images[0],assetId:id(12),storagePath:`${f.p.businessId}/${f.p.creativeRunId}/version-2.png`,altText:'Second approved view'});f.state.packageHash=hash(f.p);
  const upload=f.provider.upload;f.provider.upload=async(...args)=>{const r=await upload(...args);if(args[2]===2)throw new EtsyError('provider_timeout');return r;};
  await executeEtsyDraft(f.store,f.provider);await executeEtsyDraft(f.store,f.provider);
  assert.equal(f.calls.filter(v=>v==='POST image').length,2);assert.equal(f.state.operations.find(o=>o.externalId===601).status,'verified');assert.equal(f.state.reason,'uncertain_image_identity');
});
test('uncertain property PUT is settled by exact readback without repeating it',async()=>{
  const f=engineFixture(),put=f.provider.setProperty;f.provider.setProperty=async(...args)=>{await put(...args);throw new EtsyError('provider_timeout');};
  await executeEtsyDraft(f.store,f.provider);assert.equal((await executeEtsyDraft(f.store,f.provider)).status,'verified');assert.equal(f.calls.filter(v=>v==='PUT property').length,1);
});
test('cancellation after create preserves external identity and stops uploads',async()=>{
  const f=engineFixture(),create=f.provider.create;f.provider.create=async(...args)=>{const r=await create(...args);f.cancel();return r;};
  await executeEtsyDraft(f.store,f.provider);assert.equal(f.state.status,'cancelled');assert.equal(f.state.listingId,500);assert.ok(!f.calls.includes('POST image'));assert.equal(f.receipts.length,0);
});
test('revocation during a write prevents the next mutation',async()=>{
  const f=engineFixture(),create=f.provider.create;f.provider.create=async(...args)=>{const r=await create(...args);f.connection.revision=id(91);return r;};
  await executeEtsyDraft(f.store,f.provider);assert.ok(!f.calls.includes('POST image'));assert.equal(f.receipts.length,0);
});
test('externally activated listing cannot receive any subsequent mutation or success receipt',async()=>{
  const f=engineFixture(),create=f.provider.create;f.provider.create=async(...args)=>{await create(...args);f.listing.state='active';return f.listing;};
  await executeEtsyDraft(f.store,f.provider);assert.equal(f.state.reason,'draft_identity_or_state_changed');assert.ok(!f.calls.includes('POST image'));assert.equal(f.receipts.length,0);
});
test('altered price in final readback cannot be called verified',async()=>{
  const f=engineFixture(),read=f.provider.listing;let count=0;f.provider.listing=async()=>{const value=await read();if(++count>=4)value.price.amount=1;return value;};
  await executeEtsyDraft(f.store,f.provider);assert.equal(f.state.status,'needs_owner');assert.equal(f.receipts.length,0);
});
test('concurrent duplicate request cannot acquire the running mutation lease',async()=>{
  const f=engineFixture();let release;const held=new Promise(resolve=>{release=resolve;});const shop=f.provider.shop;f.provider.shop=async()=>{await held;return shop();};
  const first=executeEtsyDraft(f.store,f.provider);await assert.rejects(executeEtsyDraft(f.store,f.provider),/draft_in_progress/);release();await first;assert.equal(f.calls.filter(v=>v==='POST listing').length,1);
});
test('changed downloaded asset bytes cannot reach upload',async()=>{
  const f=engineFixture();f.store.image=async()=>new Uint8Array([1,2,3]);await executeEtsyDraft(f.store,f.provider);assert.equal(f.state.reason,'asset_bytes_changed');assert.ok(!f.calls.includes('POST image'));
});
