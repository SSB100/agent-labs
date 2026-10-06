import { readFileSync } from 'node:fs';
import { qualifyDiscoveryR12Quote } from '../../.core-tests/products/discovery-r12-quote.js';
const saved = JSON.parse(readFileSync(new URL('../fixtures/r12-provider-catalogs.json', import.meta.url), 'utf8'));
export function r12QuoteFixture(now = Date.now()) {
 const base='https://openrouter.ai/api/v1', [luna,haiku]=structuredClone(saved.endpoints);
 delete luna.canonicalModelId;delete haiku.canonicalModelId;
 const snapshot=(url,payload)=>({url,fetchedAt:new Date(now-1000).toISOString(),payload});
 return qualifyDiscoveryR12Quote({
 models:snapshot(`${base}/models`,{data:saved.endpoints.map(e=>({id:e.model_id,canonical_slug:e.canonicalModelId,links:{details:`/api/v1/models/${e.canonicalModelId}/endpoints`}}))}),
 lunaAlias:snapshot(`${base}/models/${luna.model_id}/endpoints`,{data:{id:luna.model_id,endpoints:[luna]}}),lunaCanonical:snapshot(`${base}/models/${saved.endpoints[0].canonicalModelId}/endpoints`,{data:{id:luna.model_id,endpoints:[structuredClone(luna)]}}),
 reviewerAlias:snapshot(`${base}/models/${haiku.model_id}/endpoints`,{data:{id:haiku.model_id,endpoints:[haiku]}}),reviewerCanonical:snapshot(`${base}/models/${saved.endpoints[1].canonicalModelId}/endpoints`,{data:{id:haiku.model_id,endpoints:[structuredClone(haiku)]}}),
 zdr:snapshot(`${base}/endpoints/zdr`,{data:[structuredClone(luna),structuredClone(haiku)]})}, now);
}
