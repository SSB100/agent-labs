// Synthetic coherent-time catalogs for inert tests. These observations cannot
// establish live provider availability or authorize dispatch.
import {readFileSync} from 'node:fs';
const saved=JSON.parse(readFileSync(new URL('../fixtures/r12-provider-catalogs.json',import.meta.url),'utf8'));
export function directSonnetCatalogFixture(now=Date.parse('2026-10-10T12:00:00.000Z')){
 const base='https://openrouter.ai/api/v1',luna=structuredClone(saved.endpoints[0]);delete luna.canonicalModelId;
 const reviewer={name:'Synthetic Sonnet4.6 Bedrock US',model_id:'anthropic/claude-sonnet-4.6',provider_name:'Amazon Bedrock',tag:'amazon-bedrock/us',status:0,context_length:1000000,max_completion_tokens:128000,max_prompt_tokens:null,supported_parameters:['response_format','structured_outputs','max_tokens'],pricing:{prompt:'0.0000033',completion:'0.0000165',input_cache_read:'0.00000033',input_cache_write:'0.000004125',input_cache_write_1h:'0.0000066',web_search:'0.01',discount:0}};
 const canonical='anthropic/claude-4.6-sonnet-20260217',lunaCanonical=saved.endpoints[0].canonicalModelId,snapshot=(url,payload)=>({url,fetchedAt:new Date(now-1000).toISOString(),payload});
 const models={data:[[luna.model_id,lunaCanonical],[reviewer.model_id,canonical]].map(([id,canonical_slug])=>({id,canonical_slug,links:{details:`/api/v1/models/${canonical_slug}/endpoints`}}))};
 return {models:snapshot(`${base}/models`,models),lunaAlias:snapshot(`${base}/models/${luna.model_id}/endpoints`,{data:{id:luna.model_id,endpoints:[luna]}}),lunaCanonical:snapshot(`${base}/models/${lunaCanonical}/endpoints`,{data:{id:luna.model_id,endpoints:[structuredClone(luna)]}}),reviewerAlias:snapshot(`${base}/models/${reviewer.model_id}/endpoints`,{data:{id:reviewer.model_id,endpoints:[reviewer]}}),reviewerCanonical:snapshot(`${base}/models/${canonical}/endpoints`,{data:{id:reviewer.model_id,endpoints:[structuredClone(reviewer)]}}),zdr:snapshot(`${base}/endpoints/zdr`,{data:[structuredClone(luna),structuredClone(reviewer)]})};
}
