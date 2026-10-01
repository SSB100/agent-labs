import {discoveryKnowledgeFixture} from './discovery-v2-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {normalizeDiscoveryPlanV2,planDiscoveryV2,discoveryDeterministicId,discoveryPlanModelSchemaV2}=require('../.core-tests/products/discovery-v2-plan.js');
const {discoveryV2Hash}=require('../.core-tests/products/discovery-v2.js');
const {discoveryV2PackManifests}=require('../.core-tests/products/discovery-v2-packs.js');
const {validatePackManifest}=require('../.core-tests/packs/registry.js');
const {resolvePackDependencies}=require('../.core-tests/packs/dependencies.js');
const {etsyKnowledgePackManifests}=require('../.core-tests/packs/etsy-knowledge.js');
const {researchPackManifests}=require('../.core-tests/research/packs.js');
function fixture(){const intent={version:'pod-discovery-2.0',id:'11111111-1111-4111-8111-111111111111',businessId:'22222222-2222-4222-8222-222222222222',objective:'Research the best-supported geographic market for original outdoor shirts.',comparisonUniverse:{productType:'original_pod_tshirt',markets:[{countryCode:'US',currency:'USD'},{countryCode:'GB',currency:'GBP'},{countryCode:'AU',currency:'AUD'},{countryCode:'NZ',currency:'NZD'}],audiences:['Adult nature enthusiasts'],sourceDomains:['etsy.com','printful.com'],selectionQuestion:'Which compared geographic market has the strongest relevant evidence for a bounded original-shirt experiment?'},limits:{maximumAlternatives:3,maximumNewCollections:1,maximumMicrousd:500000,maximumGenerations:1},expiresAt:new Date(Date.now()+3600000).toISOString()};const output={comparisonRationale:'Compare the bounded geographic set without claiming a universal winner or treating a planning hypothesis as a sourced fact.',queryFocus:['Find dated adult nature-shirt observations and destination-sensitive delivered-price limitations.'],proposals:[{concept:'Original geometric woodland shirt',audience:intent.comparisonUniverse.audiences[0],hypothesis:'A subtle original woodland motif may appeal to adult nature enthusiasts; the hypothesis is unproven.',differentiationHypothesis:'Test restrained composition and original negative-space treatment without copying adjacent listings.'}]};return{intent,knowledge:discoveryKnowledgeFixture(),output,scope:{intentId:intent.id,maximumCollections:1,maximumMicrousd:500000,policyHash:discoveryV2Hash(intent)}};}
test('planner normalizes finite country-scoped queries and local proposal keys without declaring rights',()=>{const f=fixture(),p=normalizeDiscoveryPlanV2(f.intent,f.output);assert.equal(p.queries.length,1);assert.match(p.queries[0].question,/US, GB, AU, NZ/);assert.equal(p.queries[0].queryId,discoveryDeterministicId(`discovery:v2:query:${f.intent.id}:1`));assert.equal(p.proposals[0].proposalKey,'candidate-1');assert.equal(p.proposals[0].rightsStatus,undefined);assert.equal(p.proposals[0].id,undefined);assert.ok(p.queries[0].question.length<=800);});
test('planner denies scope widening, duplicate candidates and an unquoted extra collection',()=>{const f=fixture();assert.throws(()=>normalizeDiscoveryPlanV2(f.intent,{...f.output,queryFocus:[...f.output.queryFocus,...f.output.queryFocus]}),/exactly|JSON schema/);assert.throws(()=>normalizeDiscoveryPlanV2(f.intent,{...f.output,proposals:[{...f.output.proposals[0],audience:'An unrelated audience outside the scope'}]}),/outside|JSON schema/);assert.throws(()=>normalizeDiscoveryPlanV2(f.intent,{...f.output,proposals:[f.output.proposals[0],f.output.proposals[0]]}),/repeats/);assert.throws(()=>normalizeDiscoveryPlanV2(f.intent,{...f.output,publicationAllowed:true}),/did not match its JSON schema/);});
test('planner requires exact immutable policy hash before pricing or reservation',async()=>{const f=fixture();let prices=0;await assert.rejects(()=>planDiscoveryV2({intent:f.intent,scope:{...f.scope,policyHash:'f'.repeat(64)},ledger:{reserve:async()=>{throw Error('unexpected reserve');},settle:async()=>{}},prices:async()=>{prices++;throw Error('unexpected prices');}}),/persisted intent/);assert.equal(prices,0);});
test('experimental manifests retain finite one/two workflow lists and no automatic global qualification',()=>{const manifests=discoveryV2PackManifests();for(const m of manifests)validatePackManifest(m);const catalog=[...etsyKnowledgePackManifests(),...researchPackManifests(),...manifests].map((manifest,i)=>({id:`pack-${i}`,status:'experimental',manifest}));for(const m of manifests)resolvePackDependencies(catalog,{packKey:m.packKey,version:m.version},true);const workflows=manifests.find(m=>m.kind==='workflow').workflows;assert.deepEqual(workflows.map(w=>w.stages.map(s=>s.key)),[['plan','research1','strategy','review'],['plan','research1','research2','strategy','review']]);assert.ok(manifests.filter(m=>m.kind==='worker').every(m=>m.workers[0].manifest.modelRequirements.primaryOnly===true));assert.ok(workflows.every(w=>Object.keys(w.inputSchema.properties).join(',')==='intentId'));});
test('planner receives pinned domain knowledge and visible bounds inside its declared12KB task-specific request cap',async()=>{const f=fixture(),requests=[];const result=await planDiscoveryV2({...f,ledger:{reserve:async()=>({shouldCall:true,totalReservedMicrousd:10000}),settle:async()=>{}},prices:async modelId=>({modelId,source:'https://openrouter.ai/api/v1/models',verifiedAt:new Date().toISOString(),inputPerMillion:.4,outputPerMillion:1.8,cacheWritePerMillion:.5}),provider:{invokeWebSearch:async()=>{throw Error('No search during planning');},invokeStructured:async request=>{requests.push(request);return{provider:'openrouter',providerModelId:request.model.providerModelId,providerRequestId:'synthetic-plan-receipt',output:f.output,latencyMs:1,metadata:{},usage:{inputTokens:1,outputTokens:1,totalTokens:2,reportedCostUsd:0,estimatedCostUsd:0,cachedInputTokens:0,reasoningTokens:0}};}}});assert.equal(result.plan.intentId,f.intent.id);assert.match(requests[0].messages[0].content,/must copy one exact value/);const body=JSON.parse(requests[0].messages[1].content);assert.equal(body.knowledge.knowledge.length,4);assert.match(body.outputLimits,/queryFocus\[\]:30|queryFocus\[\]: 30/);assert.ok(Buffer.byteLength(JSON.stringify(requests[0]),'utf8')<=12288);});

// Synthetic regression for the diagnosed schema/validator mismatch; the live rejected wording was not retained.
test('planner exposes exact audience identities to the provider instead of inviting paraphrases',()=>{
  const f=fixture(); f.intent.comparisonUniverse.audiences.push('Adult coastal walkers');
  const schema=discoveryPlanModelSchemaV2(f.intent);
  const {projectProviderJsonSchema}=require('../.core-tests/models/openrouter.js');
  const projected=projectProviderJsonSchema(schema);
  assert.deepEqual(projected.properties.proposals.items.properties.audience.enum,f.intent.comparisonUniverse.audiences);
  assert.match(projected.properties.proposals.items.properties.audience.description,/exact declared audience/);
  for(const audience of f.intent.comparisonUniverse.audiences){
    const output={...f.output,proposals:[{...f.output.proposals[0],audience}]};
    assert.equal(normalizeDiscoveryPlanV2(f.intent,output).proposals[0].audience,audience);
  }
  for(const audience of ['Nature-loving adult hikers','Children who enjoy cartoons','Adult nature enthusiasts and families']){
    assert.throws(()=>normalizeDiscoveryPlanV2(f.intent,{...f.output,proposals:[{...f.output.proposals[0],audience}]}),/JSON schema|outside/);
  }
  assert.equal(f.intent.comparisonUniverse.audiences[0],'Adult nature enthusiasts');
});

test('query-focus suffix guidance survives provider projection while assembled questions retain their exact bound',()=>{
  const {projectProviderJsonSchema}=require('../.core-tests/models/openrouter.js');
  for(const count of [1,2]){
    const f=fixture();f.intent.limits.maximumNewCollections=count;
    // Use the actual failed live run's declared scope, not its discarded response.
    f.intent.comparisonUniverse.audiences=['Adult outdoor and nature enthusiasts'];
    f.output.proposals[0].audience=f.intent.comparisonUniverse.audiences[0];
    const schema=discoveryPlanModelSchemaV2(f.intent),focus=schema.properties.queryFocus;
    const projected=projectProviderJsonSchema(schema).properties.queryFocus;
    assert.equal(projected.items.maxLength,undefined);
    assert.match(projected.description,/suffix.*not complete research questions/);
    assert.ok(projected.items.description.includes(`30 to ${focus.items.maxLength} characters including spaces`));
    assert.match(projected.items.description,/Do not repeat the country comparison/);
    const phrase=projected.items.description.split('Example: ')[1];
    const example={...f.output,queryFocus:Array(count).fill(phrase)};
    assert.equal(normalizeDiscoveryPlanV2(f.intent,example).queries.length,count);
    const atLimit={...f.output,queryFocus:Array(count).fill('x'.repeat(focus.items.maxLength))};
    const plan=normalizeDiscoveryPlanV2(f.intent,atLimit);
    assert.ok(plan.queries.every(q=>q.question.length<=800));
    assert.ok(plan.queries.every(q=>q.question.includes('US, GB, AU, NZ')&&q.question.includes(f.intent.comparisonUniverse.audiences[0])));
    assert.ok(plan.queries.every(q=>q.question.endsWith('Do not infer sales from listing or shop counts. Return inspectable public source excerpts only.')));
    assert.throws(()=>normalizeDiscoveryPlanV2(f.intent,{...atLimit,queryFocus:Array(count).fill('x'.repeat(focus.items.maxLength+1))}),/JSON schema/);
  }
});
