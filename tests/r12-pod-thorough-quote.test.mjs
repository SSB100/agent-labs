// Offline regression fixture copied from the six public catalog observations of
// 2026-10-12, recorded in model-route-readback-20261012.json. The snapshot is
// historical evidence, not a current quote or live dispatch authorization.
// This file embeds only exact route facts needed for qualification; it does not
// depend on the audit workspace, new network calls, credentials, or a database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { source } from './helpers/r12-pod-owner-ui-fixture.mjs';
const modules=new Map(),load=file=>source(file,{}, {},modules);
const { qualifyPodResearchQuote,qualifyDiscoveryR12Quote,fetchDiscoveryR12Quote,discoveryR12PhaseCeiling }=load('products/discovery-r12-quote');
const { quoteTextTokenCost }=load('research/qualification-quote');
const { POD_THOROUGH_PROFILE,POD_THOROUGH_LIMITS:limits }=load('products/discovery-r12-pod-profile');
const { podResearchSchema }=load('products/discovery-r12-pod-analysis');
const { routeDiscoveryR12Request,inspectDiscoveryR12Wire }=load('products/discovery-r12-wire');
const { buildPodPlannerRequest }=load('products/discovery-r12-pod-runtime');
const { resolveModelRoute }=load('models/registry');
const { publicResearchHash:hash }=load('research/qualification');
const { createDiscoveryR12Candidate,validateDiscoveryR12Candidate }=load('products/discovery-r12-receipt');
const clone=structuredClone, bytes=value=>Buffer.byteLength(JSON.stringify(value),'utf8');
const now=Date.parse('2026-10-12T21:33:12.747Z');
const phases=['plan','search1','select1','strategy','review'];
const capture={
  "models": {
    "url": "https://openrouter.ai/api/v1/models",
    "effectiveFetchedAt": "2026-10-12T21:29:24.565Z",
    "sha256": "ab6cd97db76e4a71c04e3c47d55298a8d1d2e0573f5f332b3290e53748f7cbf3"
  },
  "lunaAlias": {
    "url": "https://openrouter.ai/api/v1/models/openai/gpt-5.6-luna/endpoints",
    "effectiveFetchedAt": "2026-10-12T21:30:57.565Z",
    "sha256": "b59fb0981533c939cbf21e211c93aa02a945e23fab2ff7ffa1f6358dde5af767"
  },
  "lunaCanonical": {
    "url": "https://openrouter.ai/api/v1/models/openai/gpt-5.6-luna-20260709/endpoints",
    "effectiveFetchedAt": "2026-10-12T21:30:57.566Z",
    "sha256": "b59fb0981533c939cbf21e211c93aa02a945e23fab2ff7ffa1f6358dde5af767"
  },
  "reviewerAlias": {
    "url": "https://openrouter.ai/api/v1/models/anthropic/claude-haiku-4.5/endpoints",
    "effectiveFetchedAt": "2026-10-12T21:30:57.566Z",
    "sha256": "5fe47b081665ac81a6d12b71b3b9d3afd7d4e6f5306edd27b7866622b43a05bd"
  },
  "reviewerCanonical": {
    "url": "https://openrouter.ai/api/v1/models/anthropic/claude-4.5-haiku-20251001/endpoints",
    "effectiveFetchedAt": "2026-10-12T21:30:57.567Z",
    "sha256": "2d3e6dfd190029dc1bc659135e2b4c1ee6e0c10323f4e05964c9685f24af7da0"
  },
  "zdr": {
    "url": "https://openrouter.ai/api/v1/endpoints/zdr",
    "effectiveFetchedAt": "2026-10-12T21:30:57.568Z",
    "sha256": "7f08d1f8b5991407468ac3fb8912ad894f9fe4949049c35cb13519101d4af7eb"
  }
};
const endpointFacts={
  "standardDefault": {
    "name": "Azure | openai/gpt-5.6-luna-20260709",
    "model_id": "openai/gpt-5.6-luna",
    "provider_name": "Azure",
    "tag": "azure/us",
    "status": 0,
    "context_length": 1050000,
    "max_completion_tokens": 128000,
    "max_prompt_tokens": null,
    "supported_parameters": [
      "include_reasoning",
      "max_completion_tokens",
      "reasoning",
      "reasoning_effort",
      "response_format",
      "seed",
      "structured_outputs",
      "tool_choice",
      "tools",
      "verbosity"
    ],
    "pricing": {
      "prompt": "0.00000022",
      "completion": "0.00000132",
      "web_search": "0.01",
      "input_cache_read": "0.000000022",
      "input_cache_write": "0.000000275",
      "discount": 0,
      "overrides": [
        {
          "min_prompt_tokens": 272000,
          "prompt": "0.00000044",
          "completion": "0.00000198",
          "input_cache_read": "0.000000044",
          "input_cache_write": "0.00000055"
        }
      ]
    }
  },
  "reviewerIndependent": {
    "name": "Amazon Bedrock | anthropic/claude-4.5-haiku-20251001",
    "model_id": "anthropic/claude-haiku-4.5",
    "provider_name": "Amazon Bedrock",
    "tag": "amazon-bedrock/us",
    "status": 0,
    "context_length": 200000,
    "max_completion_tokens": 64000,
    "max_prompt_tokens": null,
    "supported_parameters": [
      "include_reasoning",
      "max_tokens",
      "reasoning",
      "response_format",
      "stop",
      "structured_outputs",
      "temperature",
      "tool_choice",
      "tools",
      "top_k",
      "top_p"
    ],
    "pricing": {
      "prompt": "0.0000011",
      "completion": "0.0000055",
      "web_search": "0.01",
      "input_cache_read": "0.00000011",
      "input_cache_write": "0.000001375",
      "input_cache_write_1h": "0.0000022",
      "discount": 0
    }
  }
};

function fixture() {
  const luna=clone(endpointFacts.standardDefault),reviewer=clone(endpointFacts.reviewerIndependent);
  const snapshot=(key,payload)=>({url:capture[key].url,fetchedAt:capture[key].effectiveFetchedAt,payload});
  const models=[{id:luna.model_id,canonical_slug:'openai/gpt-5.6-luna-20260709'},
    {id:reviewer.model_id,canonical_slug:'anthropic/claude-4.5-haiku-20251001'}].map(row=>({...row,links:{details:`/api/v1/models/${row.canonical_slug}/endpoints`}}));
  return {models:snapshot('models',{data:models}),
    lunaAlias:snapshot('lunaAlias',{data:{id:luna.model_id,endpoints:[luna]}}),
    lunaCanonical:snapshot('lunaCanonical',{data:{id:luna.model_id,endpoints:[clone(luna)]}}),
    reviewerAlias:snapshot('reviewerAlias',{data:{id:reviewer.model_id,endpoints:[reviewer]}}),
    reviewerCanonical:snapshot('reviewerCanonical',{data:{id:reviewer.model_id,endpoints:[clone(reviewer)]}}),
    zdr:snapshot('zdr',{data:[clone(luna),clone(reviewer)]})};
}
const quote=()=>qualifyPodResearchQuote(fixture(),now,true);
function changeEndpoint(catalogs,kind,changes) {
  const modelId=kind==='luna'?endpointFacts.standardDefault.model_id:endpointFacts.reviewerIndependent.model_id;
  const rows=[...catalogs[`${kind}Alias`].payload.data.endpoints,...catalogs[`${kind}Canonical`].payload.data.endpoints,...catalogs.zdr.payload.data.filter(row=>row.model_id===modelId)];
  rows.forEach(row=>Object.assign(row,clone(changes)));
}
function requestFor(phase,qualified=quote()) {
  const model=resolveModelRoute(phase==='review'?'reviewer.independent':'standard.default').primary;
  const request=phase==='search1'?{model,query:'Compare aggregate independent buyer need and limitations of printed products.',allowedDomains:['census.gov','printful.com'],excludedDomains:['etsy.com','etsy.me','etsystatic.com'],researchProfile:POD_THOROUGH_PROFILE}
    :{model,messages:[{role:'system',content:'Synthetic capacity and quote binding inspection. No external action.'},{role:'user',content:'Full synthetic evidence remains untrusted data.'}],schemaName:`pod_research_${phase}_v2`,outputSchema:podResearchSchema(phase,true),maxOutputTokens:limits.phases[phase].outputTokens,requestMetadata:{r12PodProfile:POD_THOROUGH_PROFILE}};
  return routeDiscoveryR12Request(request,phase,phase==='review'?qualified.reviewer:qualified.luna,false,false,true,true);
}

test('captured exact regional prices qualify the current thorough limits without refreshing historical evidence',()=>{
  const catalogs=fixture(),before=clone(catalogs),qualified=qualifyPodResearchQuote(catalogs,now,true);
  assert.equal(qualified.version,'r12.pod-quote.3'); assert.equal(qualified.profile,POD_THOROUGH_PROFILE);
  assert.equal(qualified.profileHash,hash(limits)); assert.equal(qualified.plannerRequestBytes,786432);
  assert.equal(qualified.luna.endpoint,'azure/us'); assert.equal(qualified.reviewer.endpoint,'amazon-bedrock/us');
  assert.deepEqual(qualified.luna.tokenPricesUsd,{prompt:'0.00000044',completion:'0.00000198',cacheRead:'0.000000044',cacheWrite:'0.00000055',reasoning:'0'});
  assert.deepEqual(qualified.reviewer.tokenPricesUsd,{prompt:'0.0000011',completion:'0.0000055',cacheRead:'0.00000011',cacheWrite:'0.0000022',reasoning:'0'});
  assert.deepEqual(qualified.luna.priceLimit,{prompt:0.44,completion:1.98,request:0});
  assert.deepEqual(qualified.reviewer.priceLimit,{prompt:1.1,completion:5.5,request:0});
  assert.equal(qualified.verifiedAt,'2026-10-12T21:29:24.565Z'); assert.equal(qualified.validUntil,'2026-10-12T21:34:24.565Z');
  const {quoteHash,verifiedAt,validUntil,...body}=qualified; void verifiedAt;void validUntil;
  assert.equal(quoteHash,hash(body)); assert.equal(qualified.proposalOnly,true); assert.equal(qualified.dispatchAuthorized,false);
  assert.deepEqual(catalogs,before);
  assert.throws(()=>qualifyPodResearchQuote(catalogs,Date.parse(qualified.validUntil),true),/quote_unavailable/);
});

test('current conservative four-model ceiling is USD 2.780942, excluding separately priced search and any repeat-pass promise',()=>{
  const qualified=quote();
  assert.deepEqual(qualified.ceilings,{plan:818358,search1:1070360,select1:818358,strategy:427554,review:716672});
  const modelsOnly=qualified.ceilings.plan+qualified.ceilings.select1+qualified.ceilings.strategy+qualified.ceilings.review;
  assert.equal(modelsOnly,2780942); assert.equal(qualified.maximumMicrousd,3851302);
  for(const phase of phases) {
    const p=limits.phases[phase],rates=phase==='review'?qualified.reviewer.tokenPricesUsd:qualified.luna.tokenPricesUsd;
    const input=phase==='search1'?limits.searchInputTokenAllowance:p.maximumRequestBytes+limits.formattingTokenAllowance;
    const output=phase==='search1'?limits.searchOutputTokenAllowance:p.outputTokens;
    assert.equal(discoveryR12PhaseCeiling(qualified,phase),quoteTextTokenCost(rates,input,output)+(phase==='search1'?17000:0));
  }
  const remainingMicrousd=9971088;
  assert.equal(modelsOnly*4,11123768); assert.ok(modelsOnly*4>remainingMicrousd);
  assert.equal(Math.floor(remainingMicrousd/qualified.maximumMicrousd),2,'remaining money cannot reserve four maximum-sized passes');
  assert.equal(qualified.maximumCalls,5); assert.equal(qualified.maximumCollections,1);
  assert.equal(limits.maximumPasses,5); assert.equal(limits.maximumCalls,25);
});

test('current complete-byte-plus-formatting reservations fit the actual regional endpoint context and output caps',()=>{
  const reservations={plan:[794624,16000,810624],select1:[794624,16000,810624],strategy:[335872,48000,383872],review:[163840,32000,195840],search1:[1000000,32000,1032000]};
  for(const phase of phases) {
    const endpoint=phase==='review'?endpointFacts.reviewerIndependent:endpointFacts.standardDefault,p=limits.phases[phase];
    const input=phase==='search1'?limits.searchInputTokenAllowance:p.maximumRequestBytes+limits.formattingTokenAllowance;
    const output=phase==='search1'?limits.searchOutputTokenAllowance:p.outputTokens;
    assert.deepEqual([input,output,input+output],reservations[phase]);
    assert.ok(input+output<=endpoint.context_length); assert.ok(output<=endpoint.max_completion_tokens);
    assert.equal(endpoint.max_prompt_tokens,null,'no separate prompt cap was published; do not invent one');
  }
  assert.equal(endpointFacts.reviewerIndependent.context_length-reservations.review[2],4160);
  assert.equal(endpointFacts.standardDefault.context_length,1050000); assert.equal(endpointFacts.reviewerIndependent.context_length,200000);
  assert.ok(endpointFacts.standardDefault.supported_parameters.includes('max_completion_tokens'));
  assert.equal(endpointFacts.standardDefault.supported_parameters.includes('max_tokens'),false,'retain the observed naming difference rather than manufacturing catalog support');
});

test('quote rejects one-token-too-small exact endpoint context, output, or separate prompt capacity',()=>{
  for(const [kind,field,at] of [
    ['luna','context_length',1032000],['luna','max_completion_tokens',48000],['luna','max_prompt_tokens',1000000],
    ['reviewer','context_length',195840],['reviewer','max_completion_tokens',32000],['reviewer','max_prompt_tokens',163840],
  ]) {
    const exact=fixture();changeEndpoint(exact,kind,{[field]:at}); assert.doesNotThrow(()=>qualifyPodResearchQuote(exact,now,true),`${kind}/${field} boundary`);
    const tooSmall=fixture();changeEndpoint(tooSmall,kind,{[field]:at-1});
    assert.throws(()=>qualifyPodResearchQuote(tooSmall,now,true),/quote_unavailable/,`${kind}/${field} one token short`);
  }
});

test('quote requires mutually matching exact alias, canonical and ZDR regional facts',()=>{
  for(const change of [
    c=>c.lunaCanonical.payload.data.endpoints[0].pricing.overrides[0].completion='0.00000199',
    c=>c.reviewerCanonical.payload.data.endpoints[0].context_length=210000,
    c=>c.zdr.payload.data[0].tag='azure',c=>c.zdr.payload.data[1].tag='amazon-bedrock',
    c=>c.reviewerAlias.payload.data.endpoints[0].provider_name='Anthropic',
    c=>c.models.payload.data[0].canonical_slug='openai/a-different-model',
    c=>c.models.payload.data[1].links.details='/api/v1/models/another-reviewer/endpoints',
    c=>c.lunaAlias.payload.data.endpoints.push(clone(c.lunaAlias.payload.data.endpoints[0])),
    c=>c.reviewerAlias.url+='?unapproved=1',
  ]) {const catalogs=fixture();change(catalogs);assert.throws(()=>qualifyPodResearchQuote(catalogs,now,true),/quote_unavailable/);}
});

test('thorough quote is a separate commitment and does not alter the legacy quote or profile',()=>{
  const catalogs=fixture(),legacy=qualifyPodResearchQuote(catalogs,now),baseQuote=qualifyDiscoveryR12Quote(catalogs,now),thorough=qualifyPodResearchQuote(catalogs,now,true);
  assert.equal(legacy.version,'r12.pod-quote.2');assert.equal(legacy.plannerRequestBytes,24576);
  assert.equal(legacy.profile,undefined);assert.equal(legacy.profileHash,undefined);
  assert.notEqual(legacy.quoteHash,thorough.quoteHash);
  assert.deepEqual(qualifyPodResearchQuote(catalogs,now,false),legacy);assert.deepEqual(qualifyDiscoveryR12Quote(catalogs,now),baseQuote);
  const oldLimits=clone(limits);oldLimits.phases.select1.maximumRequestBytes=262144;
  assert.notEqual(thorough.profileHash,hash(oldLimits),'the former 256 KiB selector contract cannot share this quote commitment');
});

test('offline public-catalog fetch supplies the current thorough quote only under explicit POD profile flags',async()=>{
  const catalogs=fixture(),byUrl=new Map(Object.values(catalogs).map(s=>[s.url,s])),calls=[];
  const fetcher=async(url,init)=>{
    calls.push(url);assert.ok(byUrl.has(url));assert.equal(init.method,'GET');assert.equal(init.credentials,'omit');
    assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.equal(init.body,undefined);assert.equal(init.headers.Authorization,undefined);
    return Response.json(byUrl.get(url).payload,{headers:{age:'0'}});
  };
  const qualified=await fetchDiscoveryR12Quote({podResearch:true,podThorough:true,now:()=>now,fetch:fetcher});
  assert.equal(qualified.profileHash,hash(limits));assert.equal(calls.length,6);assert.equal(new Set(calls).size,6);
  for(const flags of [{podThorough:true},{podResearch:true,podThorough:true,evidenceContinuation:true},{podResearch:true,podThorough:true,focusedPilot:true}]) {
    const previous=calls.length;
    await assert.rejects(fetchDiscoveryR12Quote({...flags,now:()=>now,fetch:fetcher}),/quote_unavailable/);
    assert.equal(calls.length,previous,'invalid profile combinations fail before even an offline catalog read');
  }
});

test('real wire binds the priced model, regional recipient, max-token budget and complete-body hashes for every phase',async()=>{
  const qualified=quote();
  for(const phase of phases) {
    const request=requestFor(phase,qualified),wire=await inspectDiscoveryR12Wire(request,phase,false,false,false,true,true),body=JSON.parse(wire.wire.body);
    const route=phase==='review'?qualified.reviewer:qualified.luna;
    assert.equal(body.model,route.modelId);assert.deepEqual(body.provider.only,[route.endpoint]);
    assert.equal(body.provider.allow_fallbacks,false);assert.equal(body.provider.zdr,true);assert.equal(body.provider.data_collection,'deny');
    assert.deepEqual(request.providerPriceLimit,route.priceLimit);assert.deepEqual(body.provider.max_price,route.priceLimit);
    assert.equal(wire.maximumOutputTokens,limits.phases[phase].outputTokens);assert.equal(body.max_tokens,limits.phases[phase].outputTokens);
    assert.equal(wire.requestHash,hash(request));assert.equal(wire.wireHash,createHash('sha256').update(wire.wire.body).digest('hex'));
    assert.equal(wire.wireBytes,Buffer.byteLength(wire.wire.body,'utf8'));assert.ok(Math.max(bytes(request),wire.wireBytes)<=limits.phases[phase].maximumRequestBytes);
    if(phase!=='search1') {assert.equal(body.tools,undefined);assert.deepEqual(body.messages,request.messages);assert.equal(body.response_format.json_schema.name,`pod_research_${phase}_v2`);}
    else {assert.equal(body.max_tool_calls,1);assert.equal(body.tools[0].parameters.max_results,25);}
  }
});

test('wire rejects mismatched output budgets, profile/schema and region rather than silently repricing or widening requests',async()=>{
  for(const phase of ['plan','select1','strategy','review']) {
    const request=requestFor(phase);
    for(const change of [r=>r.maxOutputTokens--,r=>r.maxOutputTokens++,r=>delete r.requestMetadata.r12PodProfile,
      r=>r.requestMetadata.r12PodProfile='r12.pod-thorough.other',r=>r.outputSchema=podResearchSchema(phase,false),
      r=>r.providerOnly=[phase==='review'?'amazon-bedrock':'azure'],r=>r.providerOnly.push('openai'),r=>r.providerZdr=false,
      r=>r.messages[1].content+='界'.repeat(limits.phases[phase].maximumRequestBytes),
    ]) {const invalid=clone(request);change(invalid);await assert.rejects(inspectDiscoveryR12Wire(invalid,phase,false,false,false,true,true),/r12_discovery_wire_unavailable/);}
    await assert.rejects(inspectDiscoveryR12Wire(request,phase,false,false,false,true,false),/r12_discovery_wire_unavailable/);
    await assert.rejects(inspectDiscoveryR12Wire(request,phase,false,false,false,false,true),/r12_discovery_wire_unavailable/);
  }
});

test('actual planner candidate receipt stays bound to its fully priced immutable request',async()=>{
  const qualified=quote(),brief={objective:'Research viable print-on-demand products to sell on Etsy.',publicConstraints:[],fulfilmentContext:'unspecified'};
  const raw=buildPodPlannerRequest('1'.repeat(64),'2'.repeat(64),brief,['etsy.com','etsy.me','etsystatic.com'],null,true);
  const request=routeDiscoveryR12Request(raw,'plan',qualified.luna,false,false,true,true),wire=await inspectDiscoveryR12Wire(request,'plan',false,false,false,true,true);
  const id=n=>`12150000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const binding={scopeId:id(1),attemptId:id(2),requestId:id(3),phase:'plan',request,maximumMicrousd:qualified.ceilings.plan,dispatchedAt:new Date(now).toISOString(),receiptExpiresAt:new Date(now+1800000).toISOString()};
  const output={comparisonRationale:'Compare independent buyer observations with production limitations and possible alternative explanations.',query:'Compare unmet aggregate buyer needs and practical production constraints for printed products.',sourceDomains:['census.gov','printful.com'],sourceChoiceRationale:'Use primary aggregate research and official production documentation.',hypotheses:[{productType:'Synthetic printed object',niche:'An unmeasured buyer need',audience:'An aggregate group of adult buyers',hypothesis:'A printed product might address an independently observed unmet practical need.',contraryExplanation:'Observed interest might not become a willingness to pay or sustainable margin.'}]};
  const candidate=createDiscoveryR12Candidate(binding,{providerModelId:qualified.luna.canonicalModelId,providerRequestId:'gen-inert-priced-plan',usage:{reportedCostUsd:0.00001},metadata:{finishReason:'stop'},output},new Date(now+1).toISOString());
  assert.equal(candidate.requestHash,wire.requestHash);assert.deepEqual(validateDiscoveryR12Candidate(candidate,binding),candidate);
  for(const change of [r=>r.maxOutputTokens=8000,r=>r.requestMetadata.r12PodProfile='r12.pod-thorough.other',r=>r.providerPriceLimit.completion=1.32,r=>r.messages[1].content+=' changed',r=>r.providerOnly=['azure']]) {
    const altered=clone(binding);change(altered.request);assert.throws(()=>validateDiscoveryR12Candidate(candidate,altered));
  }
});
