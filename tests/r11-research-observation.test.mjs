import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {observePublicResearchResponse,validateResearchObservation}=require('../.core-tests/research/qualification-outcome.js');
const context={modelId:'openai/gpt-5.6-luna',acceptedResponseModelIds:['openai/gpt-5.6-luna','openai/gpt-5.6-luna-20260709'],allowedDomains:['gardening.example'],excludedDomains:[]};
const hash=value=>createHash('sha256').update(value,'utf8').digest('hex');
const observe=provider=>observePublicResearchResponse({model:context.modelId,provider,choices:[{finish_reason:'stop',message:{annotations:[]}}]},context);
const validate=observation=>validateResearchObservation(observation,context.allowedDomains,context.modelId);

test('R11 diagnostics hash the complete bounded response provider before identity rejection',()=>{
 for(const provider of ['Azure','Unknown provider','unknown provider','', 'x'.repeat(300),'é'.repeat(150)]){
  const observation=observe(provider);
  assert.equal(observation.responseProviderHash,hash(provider));
  assert.equal(observation.observedProvider,provider==='Azure'?'Azure':null);
  assert.equal(observation.providerIdentity,provider==='Azure'?'exact':provider===''?'invalid':'other');
  assert.equal(observation.inferenceRouteStatus,'unrequested');assert.equal(observation.inferenceRouteProofHash,null);
  assert.equal(Object.keys(observation).length,14);assert.deepEqual(validate(observation),observation);
 }
 assert.notEqual(observe('Unknown provider').responseProviderHash,observe('unknown provider').responseProviderHash);
 const secret='PRIVATE_PROVIDER_LABEL_SENTINEL',observation=observePublicResearchResponse({model:'PRIVATE_MODEL_SENTINEL',provider:secret,error:{message:'PRIVATE_ERROR_SENTINEL'},choices:[{message:{content:'PRIVATE_BODY_SENTINEL'}}]},context,'PRIVATE_ERROR_SENTINEL');
 assert.equal(observation.responseProviderHash,hash(secret));assert.doesNotMatch(JSON.stringify(observation),/PRIVATE_(PROVIDER_LABEL|MODEL|ERROR|BODY)_SENTINEL/);
});

test('R11 provider hashing is absent for missing, nonstring and oversized labels without truncation',()=>{
 for(const provider of [undefined,null,0,false,{},[], 'x'.repeat(301),'é'.repeat(151)]){
  const observation=observe(provider);assert.equal(observation.responseProviderHash,null);assert.equal(observation.observedProvider,null);
  assert.deepEqual(validate(observation),observation);
 }
});

test('R11 legacy observation shape stays unchanged and diagnostics are all-or-none',()=>{
 const current=observe('Azure'),legacy=structuredClone(current);
 for(const key of ['responseProviderHash','inferenceRouteStatus','inferenceRouteProofHash'])delete legacy[key];
 assert.equal(Object.keys(legacy).length,11);assert.deepEqual(validate(legacy),legacy);
 for(const key of ['responseProviderHash','inferenceRouteStatus','inferenceRouteProofHash']){
  const partial=structuredClone(current);delete partial[key];assert.throws(()=>validate(partial),/public_research_observation_invalid/);
  assert.throws(()=>validate({...legacy,[key]:current[key]}),/public_research_observation_invalid/);
 }
});

test('R11 route diagnostic statuses require a proof hash only for verified inference',()=>{
 const current=observe('Unknown provider');
 for(const inferenceRouteStatus of ['unrequested','unavailable','invalid','verified']){
  const observation={...current,inferenceRouteStatus,inferenceRouteProofHash:inferenceRouteStatus==='verified'?'a'.repeat(64):null};
  assert.deepEqual(validate(observation),observation);
 }
 const mutations=[o=>o.inferenceRouteStatus='private route response',o=>o.inferenceRouteStatus=null,o=>o.inferenceRouteProofHash='a'.repeat(64),
  o=>o.inferenceRouteStatus='verified',o=>{o.inferenceRouteStatus='verified';o.inferenceRouteProofHash='A'.repeat(64);},
  o=>{o.inferenceRouteStatus='verified';o.inferenceRouteProofHash='a'.repeat(63);},o=>{o.inferenceRouteStatus='verified';o.inferenceRouteProofHash=42;},
  o=>o.responseProviderHash='private provider',o=>o.responseProviderHash='A'.repeat(64),o=>o.responseProviderHash=42,o=>o.responseProviderHash='a'.repeat(65),
  o=>{o.providerIdentity='missing';},o=>{o.providerIdentity='exact';o.observedProvider='Azure';},o=>o.routeProof={provider_name:'PRIVATE'},
  o=>{o.annotationCount=1;},o=>{o.observedModelId='other/model';},o=>{o.observedProvider='Unknown provider';}];
 for(const mutate of mutations){const observation=structuredClone(current);mutate(observation);assert.throws(()=>validate(observation),/public_research_observation_invalid/);}
 assert.throws(()=>validate({...observe('Azure'),responseProviderHash:null}),/public_research_observation_invalid/);
});
