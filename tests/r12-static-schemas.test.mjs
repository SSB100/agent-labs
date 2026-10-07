import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveModelRoute} from '../.core-tests/models/registry.js';
import {routeDiscoveryR12Request,inspectDiscoveryR12Wire} from '../.core-tests/products/discovery-r12-wire.js';
import {focusedPilotStrategySchema} from '../.core-tests/products/discovery-r12-focused-pilot-contract.js';
import {discoveryR12StaticSchema} from '../.core-tests/products/discovery-r12-schemas.js';
import {discoveryV2Hash} from '../.core-tests/products/discovery-v2.js';
import {readFileSync} from 'node:fs';
const migration=readFileSync('supabase/migrations/20261006003319_r12_discovery_durable_receipts.sql','utf8');
function request(phase,privateValue='PRIVATE_SELLER_COUNTRY'){
 const model=resolveModelRoute(phase==='review'?'reviewer.independent':'standard.default').primary;
 return routeDiscoveryR12Request({model,messages:[{role:'user',content:'Authorized prompt context'}],schemaName:privateValue,outputSchema:{type:'object',properties:{secret:{const:privateValue}}},maxOutputTokens:{plan:1500,select1:1000,strategy:5000,review:4000}[phase]},phase,{modelId:model.providerModelId,endpoint:phase==='review'?'amazon-bedrock/us':'azure/us',priceLimit:{prompt:1,completion:1,request:0}});
}
for(const phase of ['plan','select1','strategy','review']){
 test(`R12 ${phase} grammar and SQL pins are static across private input changes`,async()=>{
  const first=request(phase),second=request(phase,'OTHER_PRIVATE_VALUE');assert.deepEqual(first,second);assert.deepEqual(first.outputSchema,discoveryR12StaticSchema(phase));
  const wire=await inspectDiscoveryR12Wire(first,phase),schema=JSON.parse(wire.wire.body).response_format;
  assert.equal(schema.json_schema.strict,true);assert.equal(JSON.stringify(schema).includes('PRIVATE'),false);
  assert.ok(migration.includes(discoveryV2Hash(first.outputSchema)));assert.ok(migration.includes(discoveryV2Hash(schema.json_schema.schema)));
 });
 test(`R12 ${phase} replay cannot inspect a changed cached grammar/name`,async()=>{
  const value=request(phase);value.outputSchema={type:'object',properties:{country:{const:'PRIVATE'}}};await assert.rejects(inspectDiscoveryR12Wire(value,phase));
  const renamed=request(phase);renamed.schemaName='PRIVATE_SCOPE_CANARY';await assert.rejects(inspectDiscoveryR12Wire(renamed,phase));
 });
}
test('Static schema calls return owned copies, not a mutable global grammar',()=>{const first=discoveryR12StaticSchema('review');first.properties.candidateKey={const:'private'};assert.notDeepEqual(first,discoveryR12StaticSchema('review'));});


test('focused pilot serializer preserves its static explicit-plan grammar within48KiB',async()=>{
 const base=request('strategy');const route={modelId:base.model.providerModelId,endpoint:'azure/us',priceLimit:base.providerPriceLimit};
 const pilot=routeDiscoveryR12Request(base,'strategy',route,true);
 assert.deepEqual(pilot.outputSchema,focusedPilotStrategySchema());assert.equal(pilot.outputSchema.properties.testPlan,undefined);assert.equal(pilot.outputSchema.properties.usesPinnedLearningPlan.type,'boolean');
 const wire=await inspectDiscoveryR12Wire(pilot,'strategy',false,true),body=JSON.parse(wire.wire.body);
 assert.equal(discoveryV2Hash(pilot.outputSchema),'0eeaa5590d1945e34be684d637f069f7787bfd992c4d89182d0d44831aac8ba0');
 assert.equal(discoveryV2Hash(body.response_format.json_schema.schema),'6af47351df9096251feb5bc4f2f710f109ae73b27003a55576446bcfbe04727d');
 await assert.rejects(inspectDiscoveryR12Wire(pilot,'strategy'));
 await assert.rejects(inspectDiscoveryR12Wire(pilot,'strategy',true,true));
 const oversized=structuredClone(pilot);oversized.messages[0].content='x'.repeat(49152);await assert.rejects(inspectDiscoveryR12Wire(oversized,'strategy',false,true));
 assert.throws(()=>routeDiscoveryR12Request(request('plan'),'plan',route,true));
});
