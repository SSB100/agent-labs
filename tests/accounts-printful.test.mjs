import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const P=require('../.core-tests/accounts/printful.js');
const {sealAccountSecret}=require('../.core-tests/accounts/vault.js');
const businessId='11111111-1111-4111-8111-111111111111',connectionId='22222222-2222-4222-8222-222222222222',revision='33333333-3333-4333-8333-333333333333',other='44444444-4444-4444-8444-444444444444';
const credential='fixture-only-owner-private-token';
const request=()=>({businessId,connectionId,revision,storeId:12,storeKind:'manual_api',credential,expiresAt:new Date(Date.now()+60000).toISOString()});
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const normal={scopes:{code:200,result:{scopes:[{scope:'stores_list/read',display_name:'Store identity only'}]}},stores:{code:200,paging:{total:1,offset:0,limit:20},result:[{id:12,type:'native',name:'Owner store'}]},store:{code:200,result:{id:12,type:'native',name:'Owner store'}}};
function transport(changes={},calls=[]){return async(url,init)=>{
 calls.push({url,init});assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.equal(init.body,undefined);
 assert.equal(init.headers.Authorization,`Bearer ${credential}`);assert.equal(init.headers['X-PF-Store-Id'],undefined);assert.ok(init.signal instanceof AbortSignal);
 const part=url==='https://api.printful.com/oauth/scopes'?'scopes':url==='https://api.printful.com/stores'?'stores':url==='https://api.printful.com/stores/12'?'store':null;
 assert.ok(part,`unapproved endpoint ${url}`);const body=Object.hasOwn(changes,part)?changes[part]:normal[part];return body instanceof Response?body:json(body);
};}
const verify=(changes={},input=request(),options={})=>P.verifyPrintfulConnection(input,{fetcher:transport(changes),...options});
async function stored(){const verified=await verify(),key='a'.repeat(64);return {verified,key,row:{...verified.binding,envelope:sealAccountSecret(verified.secret,{businessId,provider:'printful',connectionId,revision},key)}};}
test('real verification requires scope evidence, complete exact-store inventory and selected store detail',async()=>{
 const calls=[],result=await P.verifyPrintfulConnection(request(),{fetcher:transport({},calls)});
 assert.deepEqual(calls.map(x=>x.url),['https://api.printful.com/oauth/scopes','https://api.printful.com/stores','https://api.printful.com/stores/12']);
 assert.equal(result.binding.connectionResourceId,connectionId);assert.equal(result.binding.storeId,12);assert.equal(result.binding.revision,revision);
 assert.deepEqual(result.receipt.permittedOperations,['catalog.read']);assert.deepEqual(result.receipt.providerScopes,['stores_list/read']);
 assert.equal(result.receipt.providerExpiryVerified,false);assert.equal(result.receipt.tokenAccessLevel,'not_reported');assert.equal(result.receipt.accessibleStoresAtVerification,1);
 assert.equal(result.receipt.externalMutation,false);assert.equal(result.receipt.productExecutionAuthorized,false);assert.equal(result.receipt.liveQualified,false);
 assert.ok(!JSON.stringify({binding:result.binding,receipt:result.receipt}).includes(credential));assert.equal(result.secret.credential,credential);
});
test('only an explicit provider-verified empty scope set can activate a public-catalog connection',async()=>{
 const result=await verify({scopes:{code:200,result:{scopes:[]}}});assert.deepEqual(result.binding.providerScopes,[]);
 for(const scopes of [null,{}, {code:200,result:{}},{code:200,result:{scopes:null}},{code:200,result:{scopes:['stores_list/read']}},{code:201,result:{scopes:[]}}])await assert.rejects(verify({scopes}));
});
test('provider write, unrelated read, unknown and duplicate scopes fail closed before store reads',async()=>{
 for(const scope of ['orders','orders/read','sync_products','sync_products/read','file_library/read','catalog.read','catalog/read','*',credential]){
  const calls=[];await assert.rejects(P.verifyPrintfulConnection(request(),{fetcher:transport({scopes:{code:200,result:{scopes:[{scope}]}}},calls)}),/^PrintfulConnectionError: credential_scope_rejected$/);assert.equal(calls.length,1);
 }
 await assert.rejects(verify({scopes:{code:200,result:{scopes:[{scope:'stores_list/read'},{scope:'stores_list/read'}]}}}));
});
test('wrong store, broader inventory, truncated pagination and native/ecommerce mismatch never bind',async()=>{
 for(const stores of [{code:200,result:[{id:12}]},{code:200,result:[]},{code:200,result:[{id:999}]},{code:200,result:[{id:12},{id:13}]},
  {...normal.stores,paging:{total:2,offset:0,limit:1}},{...normal.stores,paging:{total:1,offset:1,limit:20}},
  {...normal.stores,paging:{total:1,offset:0}},{...normal.stores,paging:{total:'1',offset:0,limit:20}}])await assert.rejects(verify({stores}));
 for(const store of [{code:200,result:{id:13,type:'native',name:'Wrong store'}},{code:200,result:{id:12,type:'shopify',name:'Other kind'}},
  {code:200,result:{id:12,type:'native',name:''}},{code:200,result:{id:'12',type:'native',name:'Bad ID'}}])await assert.rejects(verify({store}),/^PrintfulConnectionError: store_identity_mismatch$/);
 const result=await verify({store:{code:200,result:{id:12,type:'etsy',name:'Owner Etsy store'}}},{...request(),storeKind:'ecommerce_linked'});assert.equal(result.binding.storeKind,'ecommerce_linked');
});
test('provider content and credential echoes cannot leak into receipts, error messages or error causes',async()=>{
 const result=await verify({scopes:{code:200,result:{scopes:[{scope:'stores_list/read',display_name:credential}],debug:credential}},
  stores:{...normal.stores,debug:credential},store:{code:200,result:{id:12,type:'native',name:credential},debug:credential}});
 assert.ok(!JSON.stringify({binding:result.binding,receipt:result.receipt}).includes(credential));
 for(const status of [301,302,307,308,400,401,403,404,429,500]){
  let count=0;await assert.rejects(P.verifyPrintfulConnection(request(),{fetcher:async()=>{count++;return new Response(credential,{status,headers:{location:`https://evil.test/${credential}`}})}}),error=>!String(error).includes(credential)&&error.cause===undefined);assert.equal(count,1);
 }
 await assert.rejects(P.verifyPrintfulConnection(request(),{fetcher:async()=>{throw new Error(`Bearer ${credential} ${JSON.stringify(normal)}`)}}),/^PrintfulConnectionError: provider_failure$/);
 await assert.rejects(verify({scopes:new Response(credential,{headers:{'content-type':'application/json'}})}),/^PrintfulConnectionError: invalid_provider_response$/);
});
test('redirected fetch results, malformed JSON, media types and bounded bodies are rejected',async()=>{
 const response=json(normal.scopes);Object.defineProperty(response,'redirected',{value:true});await assert.rejects(verify({scopes:response}));
 const wrongUrl=json(normal.scopes);Object.defineProperty(wrongUrl,'url',{value:'https://evil.test'});await assert.rejects(verify({scopes:wrongUrl}));
 for(const response of [new Response(JSON.stringify(normal.scopes)),new Response('x'.repeat(65537),{headers:{'content-type':'application/json'}}),new Response('{}',{headers:{'content-type':'application/json','content-length':'999999'}}),new Response('{}',{headers:{'content-type':'application/json','content-length':'bad'}}),new Response('{}',{headers:{'content-type':'application/json-evil'}})])await assert.rejects(verify({scopes:response}));
});
test('timeout bounds fetch and body streams with no automatic retry or leaking abort causes',async()=>{
 let calls=0;await assert.rejects(P.verifyPrintfulConnection(request(),{timeoutMs:5,fetcher:async()=>{calls++;return new Promise(()=>{})}}),/^PrintfulConnectionError: provider_timeout$/);assert.equal(calls,1);
 let canceled=false;const stream=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'))},cancel(){canceled=true}});
 await assert.rejects(verify({scopes:new Response(stream,{headers:{'content-type':'application/json'}})},request(),{timeoutMs:5}),/^PrintfulConnectionError: provider_timeout$/);assert.equal(canceled,true);
});
test('invalid credentials, targets, expiries and expiration during verification stop activation',async()=>{
 for(const change of [{credential:'short'},{credential:'Bearer token with spaces'},{credential:'x'.repeat(8193)},{credential:'secret\r\nInjected'},{businessId:other+'x'},{connectionId:'bad'}, {revision:'bad'},{storeId:1.5},{storeId:0},{storeKind:'unknown'},{expiresAt:'bad'},{expiresAt:new Date(0).toISOString()},{expiresAt:new Date(Date.now()+32*86400000).toISOString()}]){
  let calls=0;await assert.rejects(P.verifyPrintfulConnection({...request(),...change},{fetcher:async()=>{calls++;return json(normal.scopes)}}),/^PrintfulConnectionError: invalid_connection_request$/);assert.equal(calls,0);
 }
 const input=request(),start=Date.now();let clocks=0;await assert.rejects(verify({},input,{now:()=>clocks++===0?start:Date.parse(input.expiresAt)+1}));
});
test('submitted input cannot mutate store binding while provider reads are in flight',async()=>{
 const input=request(),fetcher=transport();let calls=0;const result=await P.verifyPrintfulConnection(input,{fetcher:async(...args)=>{if(calls++===0){input.storeId=99;input.connectionId=other;input.credential='replacement-token'}return fetcher(...args)}});
 assert.equal(result.binding.storeId,12);assert.equal(result.binding.connectionResourceId,connectionId);assert.equal(result.secret.credential,credential);
});
test('trusted persisted resolver checks owner, current binding, AEAD context and exact secret before catalog access',async()=>{
 const {row,key}=await stored(),calls=[];
 const authorize=P.printfulAccountReadAuthorization({requireBusinessOwner:async id=>{assert.equal(id,businessId);calls.push('owner')},loadConnection:async id=>{assert.equal(id,businessId);calls.push('connection');return row},vaultKey:key});
 const connection=await authorize(businessId);assert.deepEqual(calls,['owner','connection']);assert.equal(connection.credential,credential);assert.equal(connection.storeId,12);assert.deepEqual(connection.permittedOperations,['catalog.read']);
});
test('disconnect, revoked access, expiry, cross-Business replay and revision rotation deny old credentials',async()=>{
 const {row,key}=await stored();
 for(const change of [{status:'revoked'},{businessId:other},{connectionResourceId:other},{revision:other},{storeId:13},{storeKind:'ecommerce_linked'},
  {expiresAt:new Date(0).toISOString()},{expiresAt:'invalid'},{verifiedAt:new Date(0).toISOString()},{providerScopes:['orders']},{envelope:'bad'}]){
  const authorize=P.printfulAccountReadAuthorization({requireBusinessOwner:async()=>{},loadConnection:async()=>({...row,...change}),vaultKey:key});await assert.rejects(authorize(businessId),/^PrintfulConnectionError: account_connection_required$/);
 }
 const wrongKey=P.printfulAccountReadAuthorization({requireBusinessOwner:async()=>{},loadConnection:async()=>row,vaultKey:'b'.repeat(64)});await assert.rejects(wrongKey(businessId));
 let loads=0;const notOwner=P.printfulAccountReadAuthorization({requireBusinessOwner:async()=>{throw new Error(credential)},loadConnection:async()=>{loads++;return row},vaultKey:key});await assert.rejects(notOwner(businessId),/^PrintfulConnectionError: account_connection_required$/);assert.equal(loads,0);
 const notice=P.PRINTFUL_LOCAL_DISCONNECT_NOTICE;assert.equal(notice.providerRevoked,false);assert.equal(notice.providerRevocationUrl,'https://developers.printful.com/tokens');assert.match(notice.message,/Delete the private token/);
});
test('resolver reloads authoritative status each time instead of caching a connected token',async()=>{
 const {row,key}=await stored();let current=row;
 const authorize=P.printfulAccountReadAuthorization({requireBusinessOwner:async()=>{},loadConnection:async()=>current,vaultKey:key});await authorize(businessId);current={...row,status:'revoked'};await assert.rejects(authorize(businessId));
});
