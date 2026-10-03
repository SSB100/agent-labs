import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {publicationFixture,id} from './etsy-publication-fixtures.mjs';
const require=createRequire(import.meta.url);
const {EtsyPublicationAdapter,PublicationActivationRejected}=require('../.core-tests/etsy-publication/adapter.js');
const {executeEtsyPublication}=require('../.core-tests/etsy-publication/engine.js');
const {ETSY_SCOPES}=require('../.core-tests/etsy/contracts.js');
function wire(f,override){
  const calls=[];
  const fetcher=async(url,init)=>{
    calls.push({url:String(url),...init});
    const special=await override?.(url,init);if(special)return special;
    const path=new URL(url).pathname;
    let body;
    if(init.method==='PATCH'){f.listing.state='active';body=f.listing;}
    else if(path==='/v3/application/shops/100')body={shop_id:100,user_id:101,currency_code:'NZD'};
    else if(path==='/v3/application/listings/500')body=f.listing;
    else if(path.endsWith('/images'))body={count:f.images.length,results:f.images};
    else if(path.endsWith('/properties'))body={count:f.properties.length,results:f.properties};
    else if(path.endsWith(`/shipping-profiles/${f.p.shippingProfileId}`))body=f.providerPreflight.shippingProfile;
    else if(path.endsWith('/policies/return/77'))body=f.providerPreflight.returnPolicy;
    else if(path.endsWith(`/readiness-state-definitions/${f.p.readinessStateId}`))body=f.providerPreflight.processingProfile;
    else throw new Error(`Unexpected synthetic request ${path}`);
    return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
  };
  const adapter=new EtsyPublicationAdapter({ admitDispatch: async () => {},authorize:async()=>structuredClone(f.connection),apiKey:'synthetic-key:synthetic-secret',scope:f.state,connectionRevision:f.state.connectionRevision,listingId:500,fetcher});
  return{adapter,calls};
}
test('complete engine wire performs exactly one bounded PATCH with state only and fresh independent GETs',async()=>{
  const f=publicationFixture(),w=wire(f);const result=await executeEtsyPublication(f.store,w.adapter);assert.equal(result.status,'verified');
  const writes=w.calls.filter(call=>call.method!=='GET');assert.equal(writes.length,1);const request=writes[0];assert.equal(request.method,'PATCH');assert.equal(request.url,'https://api.etsy.com/v3/application/shops/100/listings/500');assert.equal(request.body.toString(),'state=active');assert.equal(request.headers['Content-Type'],'application/x-www-form-urlencoded');
  assert.ok(w.calls.every(call=>call.redirect==='error'&&call.cache==='no-store'&&call.signal instanceof AbortSignal));assert.ok(w.calls.every(call=>!call.url.includes('legacy=')));assert.ok(w.calls.every(call=>call.url.startsWith('https://api.etsy.com/v3/application/')));
  assert.deepEqual(ETSY_SCOPES,['shops_r','listings_r','listings_w']);
  assert.equal(typeof w.adapter.create,'undefined');assert.equal(typeof w.adapter.upload,'undefined');assert.equal(typeof w.adapter.renew,'undefined');
  const count=w.calls.length;await executeEtsyPublication(f.store,w.adapter);assert.equal(w.calls.length,count);
});
test('adapter independently prevents two activation dispatches',async()=>{const f=publicationFixture(),w=wire(f);await w.adapter.activate(500);await assert.rejects(w.adapter.activate(500),/publication_already_dispatched/);assert.equal(w.calls.length,1);});
for(const operation of ['listing','images','properties','activate'])test(`adapter refuses foreign listing for ${operation}`,async()=>{const f=publicationFixture(),w=wire(f);await assert.rejects(w.adapter[operation](999),/publication_identity_or_state_changed/);assert.equal(w.calls.length,0);});
for(const [name,change] of [['business',f=>f.connection.businessId=id(91)],['connection',f=>f.connection.connectionId=id(91)],['revision',f=>f.connection.revision=id(91)],['expiry',f=>f.connection.expiresAt='2000-01-01T00:00:00Z'],['empty token',f=>f.connection.accessToken=''],['header token',f=>f.connection.accessToken='token\nsecret']])test(`adapter reauthorizes ${name} before every request`,async()=>{const f=publicationFixture(),w=wire(f);await w.adapter.listing(500);const count=w.calls.length;change(f);await assert.rejects(w.adapter.activate(500));assert.equal(w.calls.length,count);});
for(const status of [400,401,403,404,422])test(`definitive HTTP ${status} rejection remains distinct and never retries`,async()=>{const f=publicationFixture(),w=wire(f,()=>new Response('PRIVATE PROVIDER ERROR',{status}));await assert.rejects(w.adapter.activate(500),error=>error instanceof PublicationActivationRejected&&!error.message.includes('PRIVATE'));await assert.rejects(w.adapter.activate(500),/publication_already_dispatched/);assert.equal(w.calls.length,1);});
for(const status of [408,409,429,500,503])test(`HTTP ${status} stays uncertain rather than asserting a zero charge`,async()=>{const f=publicationFixture(),w=wire(f,()=>new Response('PRIVATE BODY',{status}));await assert.rejects(w.adapter.activate(500),error=>!(error instanceof PublicationActivationRejected)&&!error.message.includes('PRIVATE'));assert.equal(w.calls.length,1);});
test('malformed success remains unknown and cannot trigger fallback transport',async()=>{const f=publicationFixture(),w=wire(f,()=>new Response('{invalid PRIVATE',{headers:{'content-type':'application/json'}}));await assert.rejects(w.adapter.activate(500),/provider_response_failed/);await assert.rejects(w.adapter.activate(500),/publication_already_dispatched/);assert.equal(w.calls.length,1);});
test('oversized success is bounded without retaining provider body',async()=>{const f=publicationFixture(),w=wire(f,()=>new Response('x'.repeat(2_000_001),{headers:{'content-type':'application/json'}}));await assert.rejects(w.adapter.activate(500),/response_too_large/);assert.equal(w.calls.length,1);});
test('processing fallback reads actual enabled offerings using current inventory endpoint',async()=>{
  const f=publicationFixture();f.listing.readiness_state_id=null;const inventory={products:[{is_deleted:false,offerings:[{is_deleted:false,is_enabled:false,readiness_state_id:99},{is_deleted:false,is_enabled:true,readiness_state_id:f.p.readinessStateId}]},{is_deleted:true,offerings:[{is_enabled:true,readiness_state_id:999}]}]};
  const w=wire(f,url=>String(url).endsWith('/inventory')?new Response(JSON.stringify(inventory),{headers:{'content-type':'application/json'}}):null);const listing=await w.adapter.listing(500);assert.equal(listing.readiness_state_id,f.p.readinessStateId);assert.deepEqual(listing.processing_readback,inventory);assert.equal(f.listing.readiness_state_id,null);assert.ok(w.calls.some(call=>call.url==='https://api.etsy.com/v3/application/listings/500/inventory'));
});
for(const offerings of [[],[{is_deleted:false,is_enabled:false,readiness_state_id:22}],[{is_deleted:false,is_enabled:true,readiness_state_id:null}],[{is_deleted:false,is_enabled:true,readiness_state_id:22},{is_deleted:false,is_enabled:true,readiness_state_id:23}]])test('missing or contradictory processing linkage is never synthesized',async()=>{
  const f=publicationFixture();f.listing.readiness_state_id=null;const w=wire(f,url=>String(url).endsWith('/inventory')?new Response(JSON.stringify({products:[{is_deleted:false,offerings}]}),{headers:{'content-type':'application/json'}}):null);await assert.rejects(w.adapter.listing(500));assert.equal(w.calls.filter(call=>call.method==='PATCH').length,0);
});
test('foreign shop provider response fails read-only identity validation',async()=>{const f=publicationFixture();f.listing.shop_id=999;const w=wire(f);await assert.rejects(w.adapter.listing(500),/publication_identity_or_state_changed/);assert.equal(w.calls.length,1);});
