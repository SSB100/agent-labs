import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {productFixture,id} from './printful-product-fixtures.mjs';
const require=createRequire(import.meta.url);
const {executePrintfulProduct,safeProductReason}=require('../.core-tests/printful/product-engine.js');
const P=require('../.core-tests/printful/production.js');
const run=f=>executePrintfulProduct(f.repository,f.provider);
const posts=f=>f.calls.filter(x=>x==='POST product').length;

test('durable engine creates once, independently reads exact association, records only uncertain fixture qualification',async()=>{
  const f=productFixture(),s=await run(f);assert.equal(s.status,'needs_owner');assert.equal(s.receiptRecorded,true);assert.equal(s.reason,'product_placement_not_observable');
  assert.equal(posts(f),1);assert.equal(f.markers.length,1);assert.equal(f.receipts.length,1);assert.equal(f.resources[0],null);
  const receipt=f.receipts[0],summary=receipt.responseSummary;assert.equal(receipt.provider,'mock.printful');assert.equal(receipt.outcome,'uncertain');
  for(const key of ['configurationVerified','physicalPlacementVerified','techniqueVerified','liveQualified','listingReady','publicationAuthorized','orderSubmissionAuthorized'])assert.equal(summary[key],false);
  assert.equal(summary.associationVerified,true);assert.equal(summary.assetBindingVerified,true);assert.ok(summary.providerFactsHash);assert.equal(summary.productFactsHash,undefined);
  assert.ok(f.calls.indexOf('POST product')<f.calls.lastIndexOf('GET product'));const count=f.calls.length;await run(f);assert.equal(f.calls.length,count);assert.equal(posts(f),1);
});
for(const [name,change]of[
  ['scope',f=>f.source.businessId=id(99)],['revision',f=>f.source.connectionRevision=id(99)],['asset hash',f=>f.source.assetSha256='e'.repeat(64)],
  ['plan dimensions',f=>f.source.plan.designWidthIn=7],['source fingerprint',f=>f.ctx.sourceHash='e'.repeat(64)],['approval fingerprint',f=>f.ctx.approvalHash='e'.repeat(64)],
  ['current TEST drift',f=>f.drift()],['connection revocation',f=>f.revoke()],['uploaded file',f=>f.file.hash='e'.repeat(32)],['file dimensions',f=>f.file.width=99],
  ['temporary file',f=>f.file.is_temporary=true],['asset bytes',f=>f.bytes[0]++],['missing placement producer',f=>{f.source.placementEvidence=null;f.state.sourceHash=P.productHash(f.source);f.ctx.sourceHash=f.state.sourceHash;f.state.requestHash=P.productRequestHash(f.source,f.state.sourceHash);f.approval.sourceHash=f.state.sourceHash;f.approval.requestHash=f.state.requestHash;f.state.approvalHash=P.productHash(f.approval);f.ctx.approvalHash=f.state.approvalHash;}],
])test(`preflight blocks ${name} without dispatch`,async()=>{const f=productFixture();change(f);const s=await run(f);assert.equal(s.receiptRecorded,false);assert.equal(posts(f),0);assert.equal(f.receipts.length,0);});
test('preexisting matching identity cannot be adopted as our create or cause a new POST',async()=>{const f=productFixture();f.appear();const s=await run(f);assert.equal(s.reason,'product_identity_already_exists');assert.equal(posts(f),0);assert.equal(f.receipts.length,0);});
test('cancel before start makes no provider request',async()=>{const f=productFixture();f.cancel();assert.equal((await run(f)).status,'cancelled');assert.deepEqual(f.calls,[]);});
test('cancel immediately after durable marker prevents dispatch and replay remains GET-only',async()=>{
  const f=productFixture(),save=f.repository.save;f.repository.save=async state=>{await save(state);if(state.dispatch)f.cancel();};await run(f);await run(f);assert.equal(posts(f),0);assert.ok(f.state.dispatch);assert.equal(f.state.stopRequested,true);
});
test('late cancellation preserves actual association and receipt without claiming physical verification',async()=>{const f=productFixture(),create=f.provider.create;f.provider.create=async()=>{const value=await create();f.cancel();return value;};await run(f);assert.equal(posts(f),1);assert.equal(f.receipts.length,1);assert.equal(f.receipts[0].responseSummary.stopRequested,true);});
test('lost write response reconciles original external identity without second POST',async()=>{const f=productFixture(),create=f.provider.create;f.provider.create=async()=>{await create();throw new Error('untrusted body with a token');};await run(f);assert.equal(f.state.receiptRecorded,true);await run(f);assert.equal(posts(f),1);});
test('uncertain absent product never retries write, can reconcile a delayed appearance',async()=>{
  const f=productFixture();f.provider.create=async()=>{f.calls.push('POST product');throw new Error('timeout');};await run(f);await run(f);assert.equal(posts(f),1);assert.equal(f.receipts.length,0);assert.equal(f.state.reason,'product_creation_uncertain');f.appear();await run(f);assert.equal(posts(f),1);assert.equal(f.receipts.length,1);
});
test('source expiry or TEST drift after dispatch still permits original read-only reconciliation',async()=>{const f=productFixture(),create=f.provider.create;f.provider.create=async()=>{const value=await create();f.drift();return value;};await run(f);assert.equal(f.receipts.length,1);assert.equal(posts(f),1);});
test('revocation after dispatch prevents further reads but retains write marker',async()=>{const f=productFixture(),create=f.provider.create;f.provider.create=async()=>{const value=await create();f.revoke();return value;};await run(f);assert.equal(posts(f),1);assert.ok(f.state.dispatch);assert.equal(f.receipts.length,0);assert.equal(f.state.reason,'product_write_access_revoked');});
for(const [name,change]of[
  ['catalog variant',f=>f.response.result.sync_variants[0].variant_id=900],['price',f=>f.response.result.sync_variants[0].retail_price='1.00'],['currency',f=>f.response.result.sync_variants[0].currency='GBP'],
  ['product name',f=>f.response.result.sync_product.name='Different'],['extra variant',f=>f.response.result.sync_variants.push({...f.response.result.sync_variants[0],id:900})],
  ['file association',f=>f.response.result.sync_variants[0].files[0].id=900],
])test(`post-dispatch ${name} mismatch cannot produce a receipt or repeat POST`,async()=>{const f=productFixture(),create=f.provider.create;f.provider.create=async()=>{const value=await create();change(f);return value;};await run(f);await run(f);assert.equal(posts(f),1);assert.equal(f.receipts.length,0);assert.equal(f.state.receiptRecorded,false);});
test('finish failure cannot save receiptRecorded without atomic receipt persistence',async()=>{
  const f=productFixture(),finish=f.repository.finish;let fail=true;f.repository.finish=async(...args)=>{if(fail){fail=false;throw Error('database interrupted');}return finish(...args);};await run(f);assert.equal(f.state.receiptRecorded,false);assert.equal(f.receipts.length,0);await run(f);assert.equal(f.receipts.length,1);assert.equal(posts(f),1);
});
test('concurrent starts acquire one lease and dispatch at most once',async()=>{
  const f=productFixture(),store=f.provider.store;let release;const held=new Promise(resolve=>{release=resolve;});f.provider.store=async()=>{await held;return store();};const first=run(f);await assert.rejects(run(f),/in_progress/);release();await first;assert.equal(posts(f),1);
});
test('state missing a marker property cannot silently restart as new',async()=>{const f=productFixture();delete f.state.dispatch;await run(f);assert.equal(posts(f),0);assert.equal(f.state.reason,'product_state_invalid');});
test('untrusted exception strings and arbitrary codes stay redacted',()=>{assert.equal(safeProductReason(new Error('secret')),'product_execution_interrupted');assert.equal(safeProductReason(new P.PrintfulProductError('secret')),'product_execution_interrupted');});

for(const [name,change]of[['owner Stop',f=>f.cancel()],['latest TEST drift',f=>f.drift()],['approval change',f=>{f.approval.expiresAt='2000-01-01T00:00:00.000Z';}],['connection revocation',f=>f.revoke()],['lease loss',f=>f.invalidateLease()]])test(`actual adapter rechecks ${name} after paused credential authorization and sends no POST`,async()=>{
  const f=productFixture(),{PrintfulProductAdapter}=require('../.core-tests/printful/product-adapter.js');let authCalls=0,posts=0,release,entered;const waiting=new Promise(resolve=>{entered=resolve;}),pause=new Promise(resolve=>{release=resolve;});
  const provider=new PrintfulProductAdapter({ admitDispatch: async () => {},scope:f.source,mode:'fixture',authorize:async()=>{if(++authCalls===4){entered();await pause;}return{...f.source,provider:'printful',status:'connected',permittedOperations:['product.configure'],providerScopes:['sync_products','file_library/read','stores_list/read'],expiresAt:f.source.expiresAt,credential:'synthetic-not-a-real-token'};},fetcher:async(url,init)=>{
    if(init.method==='POST')posts++;
    if(url.includes('/store/products/@'))return new Response('{}',{status:404,headers:{'content-type':'application/json'}});
    return new Response(JSON.stringify(url.includes('/stores/')?{code:200,result:{id:123,type:'native'}}:url.includes('/files/')?{code:200,result:f.file}:{code:200,result:f.summary}),{headers:{'content-type':'application/json'}});
  }});
  const active=executePrintfulProduct(f.repository,provider);await waiting;change(f);release();
  if(name==='lease loss')await assert.rejects(active,/lease_lost/);else await active;
  assert.equal(posts,0);assert.ok(f.state.dispatch);assert.equal(f.receipts.length,0);
});
