import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { engineFixture, packageFixture } from './etsy-fixtures.mjs';
const require = createRequire(import.meta.url);
const { beginOAuth, exchangeOAuth, discoverShop } = require('../.core-tests/etsy/oauth.js');
const { seal, unseal } = require('../.core-tests/etsy/vault.js');
const { EtsyDraftAdapter, etsyJson } = require('../.core-tests/etsy/adapter.js');
const { draftIdentity } = require('../.core-tests/etsy/contracts.js');
const config = { keystring:'fixture-key',sharedSecret:'fixture-secret',redirectUri:'https://example.com/api/etsy/callback' };
const json = value => new Response(JSON.stringify(value), { headers:{'content-type':'application/json'} });
test('OAuth requests fresh state and browser binding, PKCE and only bounded scopes',()=>{
  const a=beginOAuth(config),b=beginOAuth(config),url=new URL(a.url);
  assert.notEqual(a.state,b.state);assert.notEqual(a.browserNonce,b.browserNonce);
  assert.equal(url.searchParams.get('code_challenge'),createHash('sha256').update(a.verifier).digest('base64url'));
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  assert.equal(url.searchParams.get('scope'),'shops_r listings_r listings_w');
  assert.ok(!a.url.includes(config.sharedSecret));
  assert.throws(()=>beginOAuth({...config,redirectUri:'http://example.com/api/etsy/callback'}));
});
test('encrypted account records cannot cross Businesses, types or keys',()=>{
  const key='1'.repeat(64),value={accessToken:'fixture-private-token'};
  const encrypted=seal(value,'account:business-a:connection-a',key);
  assert.ok(!encrypted.includes(value.accessToken));
  assert.deepEqual(unseal(encrypted,'account:business-a:connection-a',key),value);
  for(const context of ['account:business-b:connection-a','product-package:business-a:connection-a'])assert.throws(()=>unseal(encrypted,context,key),/invalid_sealed_record/);
  assert.throws(()=>unseal(encrypted,'account:business-a:connection-a','2'.repeat(64)));
});
const tokens={access_token:'100.fixture-access',refresh_token:'100.fixture-refresh',token_type:'Bearer',expires_in:3600,scope:'shops_r listings_r listings_w'};
test('Etsy OAuth and draft reads require purpose admission before any provider call',async()=>{
 let calls=0;const fetcher=async()=>{calls++;throw Error('must not call');};
 await assert.rejects(exchangeOAuth(config,{code:'fixture-code',verifier:'fixture-verifier'},fetcher));
 const {connection}=engineFixture();const adapter=new EtsyDraftAdapter({authorize:async()=>connection,apiKey:'key:secret',fetcher});
 await assert.rejects(adapter.listing(500));assert.equal(calls,0);
});
test('OAuth exchange is first-party, no redirect or retry, with verified token identity and scopes',async()=>{
  let calls=0;
  const result=await exchangeOAuth(config,{code:'fixture-code',verifier:'fixture-verifier'},async(url,init)=>{
    calls++;assert.equal(url,'https://api.etsy.com/v3/public/oauth/token');assert.equal(init.redirect,'error');
    assert.equal(init.body.get('code_verifier'),'fixture-verifier');assert.equal(init.headers['x-api-key'],'fixture-key:fixture-secret');return json(tokens);
  },async()=>{});assert.equal(calls,1);assert.equal(result.userId,100);
  for(const change of [{scope:'listings_w'},{scope:tokens.scope+' transactions_w'},{scope:null},{refresh_token:'101.fixture-refresh'}]){
    await assert.rejects(exchangeOAuth(config,{code:'fixture-code',verifier:'fixture-verifier'},async()=>json({...tokens,...change}),async()=>{}));
  }
  await assert.rejects(discoverShop(config,result,async()=>json({shop_id:200,user_id:999,shop_name:'Wrong shop',currency_code:'NZD'}),async()=>{}),/shop_identity_mismatch/);
});
test('provider errors never expose bodies and are not retried',async()=>{
  let calls=0;await assert.rejects(etsyJson(async()=>{calls++;return new Response('secret-token',{status:401});},'https://api.etsy.com/v3/application/shops/1',{}),/^EtsyError: account_access_denied$/);assert.equal(calls,1);
});
test('adapter sends only draft creation fields and enforces tenant at transport',async()=>{
  const {connection}=engineFixture(),{package:p}=packageFixture();let request;
  const adapter=new EtsyDraftAdapter({ admitDispatch: async () => {},authorize:async()=>connection,apiKey:'key:secret',fetcher:async(url,init)=>{request={url,init};return json({listing_id:500});}});
  await adapter.create({...p,state:'active',should_auto_renew:true},draftIdentity(connection,p));
  assert.match(request.url,/\/shops\/100\/listings\?legacy=false$/);
  assert.equal(request.init.method,'POST');assert.equal(request.init.body.has('state'),false);assert.equal(request.init.body.get('should_auto_renew'),'false');assert.equal(request.init.body.get('price'),'32.95');
  await assert.rejects(adapter.create({...p,businessId:'foreign'},draftIdentity(connection,p)));
  connection.revision='changed';await assert.rejects(adapter.listing(500),/account_access_revoked/);
});
test('connection changes between authorization and dispatch cannot redirect a write',async()=>{
  const {connection,p}=engineFixture();let authorizations=0,calls=0;
  const adapter=new EtsyDraftAdapter({ admitDispatch: async () => {},authorize:async()=>({...connection,shopId:++authorizations===1?100:200}),apiKey:'key:secret',fetcher:async()=>{calls++;return json({});}});
  await assert.rejects(adapter.create(p,draftIdentity(connection,p)),/account_scope_mismatch/);assert.equal(calls,0);
});
test('draft processing profile is independently read from inventory when listing omits it',async()=>{
  const {connection}=engineFixture();const calls=[];
  const adapter=new EtsyDraftAdapter({ admitDispatch: async () => {},authorize:async()=>connection,apiKey:'key:secret',fetcher:async url=>{calls.push(url);return json(url.includes('/inventory')?{products:[{is_deleted:false,offerings:[{is_deleted:false,readiness_state_id:22}]}]}:{listing_id:500,readiness_state_id:null});}});
  const result=await adapter.listing(500);assert.equal(result.readiness_state_id,22);assert.equal(calls.length,2);assert.ok(result.processing_readback);
});
