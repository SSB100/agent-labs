import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {publicationFixture,id} from './etsy-publication-fixtures.mjs';
const require=createRequire(import.meta.url);
const {existingEffectReadAdmission}=require('../.core-tests/core/existing-effect-read.js');
const {EtsyPublicationAdapter}=require('../.core-tests/etsy-publication/adapter.js');
const {PrintfulProductAdapter}=require('../.core-tests/printful/product-adapter.js');
const {requireExistingEffectReadEligibility}=require('../.core-tests/lib/existing-effect-read-runtime.js');
const binding=(provider,endpoints)=>({businessId:id(1),runId:id(2),requestHash:'a'.repeat(64),sentAt:'2026-01-01T00:00:00Z',connectionId:id(3),connectionRevision:id(4),provider,endpoints});
const read=(provider,endpoint)=>({provider,operation:provider==='etsy'?'listing.read':'product.read',method:'GET',endpoint});
const json=body=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});

test('existing-effect read is exact, immutable, checked on every call and closed without independent eligibility',async()=>{
 const endpoint='https://api.etsy.com/v3/application/listings/500',original=binding('etsy',[endpoint]);let checks=0;
 const admit=existingEffectReadAdmission(original,async saved=>{checks++;assert.equal(saved.runId,id(2));assert.ok(Object.isFrozen(saved));assert.ok(Object.isFrozen(saved.endpoints));});
 original.runId=id(99);original.endpoints.push(endpoint+'/images');
 await admit(read('etsy',endpoint));await admit(read('etsy',endpoint));assert.equal(checks,2);
 for(const request of [{...read('etsy',endpoint),method:'PATCH'},{...read('etsy',endpoint),operation:'listing.activate'},read('printful',endpoint),read('etsy',endpoint+'/images'),read('etsy',endpoint+'?expand=all'),read('etsy',endpoint.replace('500','501'))])await assert.rejects(admit(request));
 assert.equal(checks,2);
 await assert.rejects(existingEffectReadAdmission(binding('etsy',[endpoint]))(read('etsy',endpoint)));
 await assert.rejects(existingEffectReadAdmission(binding('etsy',[endpoint]),async()=>{throw Error('eligibility_unavailable');})(read('etsy',endpoint)),/eligibility_unavailable/);
});

test('Etsy reconciliation can read exact historical effect while writes and other reads stay denied; revocation during guard sends nothing',async()=>{
 const f=publicationFixture(),endpoint='https://api.etsy.com/v3/application/listings/500';let calls=0,revoked=false;
 const options={authorize:async()=>({...structuredClone(f.connection),status:revoked?'revoked':'connected'}),apiKey:'inert:inert',scope:f.state,connectionRevision:f.state.connectionRevision,listingId:500,fetcher:async()=>{calls++;return json({...f.listing,readiness_state_id:1});}};
 const admit=existingEffectReadAdmission(binding('etsy',[endpoint]),async()=>{});
 const adapter=new EtsyPublicationAdapter({...options,admitReconciliation:admit});
 await adapter.listing(500);assert.equal(calls,1);
 await assert.rejects(adapter.activate(500));await assert.rejects(adapter.images(500));await assert.rejects(adapter.listing(501));assert.equal(calls,1);
 const revokedAdapter=new EtsyPublicationAdapter({...options,admitReconciliation:existingEffectReadAdmission(binding('etsy',[endpoint]),async()=>{revoked=true;})});
 await assert.rejects(revokedAdapter.listing(500));assert.equal(calls,1);
});

test('Printful reconciliation requires independent eligibility and current credentials after guard; never authorizes arbitrary file/product reads',async()=>{
 const scope={businessId:id(1),connectionId:id(3),connectionRevision:id(4),storeId:123,storeKind:'manual_api'};
 const endpoint='https://api.printful.com/stores/123';let calls=0,revoked=false;
 const options={scope,mode:'fixture',authorize:async()=>({...scope,provider:'printful',status:revoked?'revoked':'connected',permittedOperations:['product.configure'],providerScopes:['sync_products','file_library/read','stores_list/read'],expiresAt:new Date(Date.now()+60000).toISOString(),credential:'inert-credential'}),fetcher:async()=>{calls++;return json({code:200,result:{id:123,type:'native'}});}};
 const adapter=new PrintfulProductAdapter({...options,admitReconciliation:existingEffectReadAdmission(binding('printful',[endpoint]),async()=>{})});
 await adapter.store();assert.equal(calls,1);
 await assert.rejects(adapter.file(999));await assert.rejects(adapter.product(999));assert.equal(calls,1);
 const revokedAdapter=new PrintfulProductAdapter({...options,admitReconciliation:existingEffectReadAdmission(binding('printful',[endpoint]),async()=>{revoked=true;})});
 await assert.rejects(revokedAdapter.store());assert.equal(calls,1);
});

test('runtime readback sends one exact endpoint and no credential; missing key and rejected or ambiguous proof fail closed',async t=>{
 const calls=[];let response={decision:'allowed',shouldRead:true};
 const server=createServer(async(req,res)=>{let body='';for await(const part of req)body+=part;calls.push(JSON.parse(body));res.setHeader('content-type','application/json');res.end(JSON.stringify(response));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const keys=['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','R05_ADMISSION_SERVER_KEY'],previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 t.after(async()=>{for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}await new Promise(resolve=>server.close(resolve));});
 process.env.NEXT_PUBLIC_SUPABASE_URL=`http://127.0.0.1:${server.address().port}`;process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='inert-key';
 const endpoint='https://api.etsy.com/v3/application/listings/500',saved=binding('etsy',[endpoint]);
 delete process.env.R05_ADMISSION_SERVER_KEY;await assert.rejects(requireExistingEffectReadEligibility(saved,endpoint));assert.equal(calls.length,0);
 process.env.R05_ADMISSION_SERVER_KEY='inert-server-key';await requireExistingEffectReadEligibility(saved,endpoint);
 assert.deepEqual(calls[0],{p_business_id:saved.businessId,p_operation:'existing_effect_read',p_server_key:'inert-server-key',p_payload:{provider:saved.provider,runId:saved.runId,requestHash:saved.requestHash,sentAt:saved.sentAt,connectionId:saved.connectionId,connectionRevision:saved.connectionRevision,endpoint}});
 for(const value of [null,{}, {decision:'allowed'}, {decision:'blocked',shouldRead:true}, {decision:'allowed',shouldRead:false}]){response=value;await assert.rejects(requireExistingEffectReadEligibility(saved,endpoint),/eligibility_unavailable/);}
});
