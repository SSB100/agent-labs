import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {qualifyDiscoveryR12Quote,qualifyDiscoveryR12EvidenceQuote,discoveryR12PhaseCeiling,fetchDiscoveryR12Quote} from '../.core-tests/products/discovery-r12-quote.js';
const saved=JSON.parse(readFileSync('tests/fixtures/r12-provider-catalogs.json','utf8'));
const now=Date.parse('2026-10-05T23:53:20.000Z'),base='https://openrouter.ai/api/v1';
function fixture(){const [luna,haiku]=structuredClone(saved.endpoints);delete luna.canonicalModelId;delete haiku.canonicalModelId;const snapshot=(url,payload)=>({url,fetchedAt:new Date(now).toISOString(),payload});return{
 models:snapshot(`${base}/models`,{data:saved.endpoints.map(e=>({id:e.model_id,canonical_slug:e.canonicalModelId,links:{details:`/api/v1/models/${e.canonicalModelId}/endpoints`}}))}),
 lunaAlias:snapshot(`${base}/models/${luna.model_id}/endpoints`,{data:{id:luna.model_id,endpoints:[luna]}}),lunaCanonical:snapshot(`${base}/models/${saved.endpoints[0].canonicalModelId}/endpoints`,{data:{id:luna.model_id,endpoints:[structuredClone(luna)]}}),
 reviewerAlias:snapshot(`${base}/models/${haiku.model_id}/endpoints`,{data:{id:haiku.model_id,endpoints:[haiku]}}),reviewerCanonical:snapshot(`${base}/models/${saved.endpoints[1].canonicalModelId}/endpoints`,{data:{id:haiku.model_id,endpoints:[structuredClone(haiku)]}}),
 zdr:snapshot(`${base}/endpoints/zdr`,{data:[structuredClone(luna),structuredClone(haiku)]})};}
test('R12 endpoint-specific quote includes worst tiers, reviewer one-hour cache price and separate Exa fee',()=>{const quote=qualifyDiscoveryR12Quote(fixture(),now);assert.equal(quote.dispatchAuthorized,false);assert.equal(quote.maximumCalls,5);assert.equal(quote.maximumMicrousd,406736);assert.deepEqual(quote.ceilings,{plan:23246,search1:149560,select1:26311,strategy:50451,review:157168});assert.equal(quote.luna.endpoint,'azure/us');assert.equal(quote.reviewer.endpoint,'amazon-bedrock/us');assert.equal(quote.reviewer.tokenPricesUsd.cacheWrite,'0.0000022');assert.equal(quote.retention.search,'query_retention_improvement_training_possible');});
for(const [name,change] of [
 ['reviewer ZDR missing',f=>f.zdr.payload.data.pop()],['reviewer endpoint mismatch',f=>f.reviewerCanonical.payload.data.endpoints[0].tag='anthropic'],['identity remapped',f=>f.models.payload.data[1].canonical_slug='anthropic/other'],['price drift',f=>f.zdr.payload.data[1].pricing.prompt='0.000002'],['missing structured output',f=>f.reviewerAlias.payload.data.endpoints[0].supported_parameters=['max_tokens']],['duplicate endpoint',f=>f.reviewerAlias.payload.data.endpoints.push(structuredClone(f.reviewerAlias.payload.data.endpoints[0]))],['unknown price field',f=>f.reviewerAlias.payload.data.endpoints[0].pricing.unexplained='1'],['expired catalog',f=>f.models.fetchedAt=new Date(now-300000).toISOString()],['future catalog',f=>f.models.fetchedAt=new Date(now+1).toISOString()],['wrong source URL',f=>f.reviewerAlias.url='https://other.invalid/models'],
])test(`R12 quote rejects ${name}`,()=>{const f=fixture();change(f);assert.throws(()=>qualifyDiscoveryR12Quote(f,now));});
test('R12 quote fetch is exactly six public reads without credential or private input',async()=>{const f=fixture(),byUrl=new Map(Object.values(f).map(s=>[s.url,s])),calls=[];const quote=await fetchDiscoveryR12Quote({now:()=>now,fetch:async(url,init)=>{calls.push(url);assert.equal(init.method,'GET');assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');assert.equal(init.body,undefined);assert.equal(init.headers.Authorization,undefined);assert.ok(byUrl.has(url));return new Response(JSON.stringify(byUrl.get(url).payload),{status:200,headers:{'Content-Type':'application/json','Age':'0'}});}});assert.equal(calls.length,6);assert.equal(new Set(calls).size,6);assert.equal(quote.maximumMicrousd,406736);});

test('evidence continuation quotes exactly two64KiB text calls without changing original five-phase prices',()=>{
 const f=fixture(),baseQuote=qualifyDiscoveryR12Quote(f,now),quote=qualifyDiscoveryR12EvidenceQuote(f,now);
 assert.equal(quote.version,'r12.discovery-evidence-quote.1');assert.equal(quote.maximumCalls,2);assert.equal(quote.maximumCollections,0);assert.equal(quote.maximumRequestBytes,65536);
 assert.deepEqual(quote.ceilings,{strategy:82891,review:265303});assert.equal(quote.maximumMicrousd,348194);
 assert.equal(quote.dispatchAuthorized,false);assert.equal(quote.retention.sourceAcquisition,'reviewed_public_observations_no_search');
 assert.equal(discoveryR12PhaseCeiling(quote,'review'),265303);assert.throws(()=>discoveryR12PhaseCeiling(quote,'search1'));
 assert.deepEqual(qualifyDiscoveryR12Quote(f,now),baseQuote);
 for(const row of [f.reviewerAlias.payload.data.endpoints[0],f.reviewerCanonical.payload.data.endpoints[0],f.zdr.payload.data[1]])row.context_length=60000;
 assert.doesNotThrow(()=>qualifyDiscoveryR12Quote(f,now));assert.throws(()=>qualifyDiscoveryR12EvidenceQuote(f,now));
});
