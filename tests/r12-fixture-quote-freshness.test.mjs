import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiscoveryR12QuestAdapter} from '../.core-tests/products/discovery-r12-adapter.js';
import {discoveryV2Hash} from '../.core-tests/products/discovery-v2.js';
import {r12QuoteFixture} from './helpers/r12-provider-fixture.mjs';
import {discoveryR12StaticSchema} from '../.core-tests/products/discovery-r12-schemas.js';
import {resolveModelRoute} from '../.core-tests/models/registry.js';

test('a later inert admission obtains a fresh identical quote while the actual adapter still rejects the expired quote',async()=>{
 const started=Date.parse('2026-10-08T02:00:00Z'),later=started+420000,old=r12QuoteFixture(started),fresh=r12QuoteFixture(later);
 assert.equal(fresh.quoteHash,old.quoteHash);assert.deepEqual(fresh.ceilings,old.ceilings);
 assert.equal(Date.parse(fresh.validUntil)-Date.parse(fresh.verifiedAt),300000);
 assert.ok(Date.parse(old.validUntil)<later);assert.ok(Date.parse(fresh.validUntil)>later);
 const scope={id:'12000000-0000-4000-8000-000000000001',businessId:'12000000-0000-4000-8000-000000000002',goalId:'12000000-0000-4000-8000-000000000003',version:'r12.discovery-source-scope.1',allowedDomains:['adult-outdoors.example']};
 const identity={qualificationHash:'a'.repeat(64),workflowDefinitionId:'inert-workflow',workerDefinitionId:'inert-worker',mode:'qualification'};
 const step={...identity,key:'review',adapter:`r12.discovery.${scope.id}.review`,operationKey:`research.r12.${scope.id}.review`,maximumMicrounits:String(old.ceilings.review)};
 const context={plan:{format:'r12.discovery.1',discoveryScopeId:scope.id,discoveryScopeHash:discoveryV2Hash(scope),businessId:scope.businessId,goalId:scope.goalId},step,attempt:{id:'12000000-0000-4000-8000-000000000004',requestId:null}};
 const request={model:resolveModelRoute('reviewer.independent').primary,messages:[{role:'system',content:'Review the same inert research evidence.'}],schemaName:'inert',outputSchema:discoveryR12StaticSchema('review'),maxOutputTokens:4000};
 let builds=0;
 const adapter=(quote,at)=>createDiscoveryR12QuestAdapter({scope,phase:'review',identity,dataClasses:['business_context','public_evidence'],store:{operation:()=>assert.fail('No storage effect permitted')},request:async()=>{builds++;return request;},quote:async()=>quote,project:()=>assert.fail('No projection permitted'),now:()=>at,fetcher:()=>assert.fail('No transport permitted')});
 const original=await adapter(old,started).prepare(context);assert.equal(builds,1);
 await assert.rejects(adapter(old,later).prepare(context),/r12_discovery_adapter_binding_invalid/);assert.equal(builds,1);
 assert.deepEqual(await adapter(fresh,later).prepare(context),original);assert.equal(builds,2);
 assert.equal(old.verifiedAt,r12QuoteFixture(started).verifiedAt,'Historical quote bytes remain unchanged');
});
