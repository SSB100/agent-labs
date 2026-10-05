import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {observePublicResearchResponse,validateResearchObservation}=require('../.core-tests/research/qualification-outcome.js');
const {RESEARCH_INFERENCE_ROUTE_FAILURE_CODES}=require('../.core-tests/research/qualification-owner-contract.js');
const diagnosticKeys=['responseProviderHash','inferenceRouteStatus','inferenceRouteProofHash'];
const failureKeys=['inferenceRouteFailureCode','inferenceRouteHttpStatus','inferenceRouteAttempts'];
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
  for(const key of failureKeys)assert.equal(observation[key],null);
  assert.equal(Object.keys(observation).length,17);assert.deepEqual(validate(observation),observation);
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
 const current=observe('Azure'),legacy=structuredClone(current),historical=structuredClone(current);
 for(const key of failureKeys)delete historical[key];
 assert.equal(Object.keys(historical).length,14);assert.deepEqual(validate(historical),historical);
 for(const key of [...diagnosticKeys,...failureKeys])delete legacy[key];
 assert.equal(Object.keys(legacy).length,11);assert.deepEqual(validate(legacy),legacy);
 for(const key of [...diagnosticKeys,...failureKeys]){
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

test('R11 receipt failure details retain bounded HTTP, transport and validation distinctions',()=>{
 const base={...observe('Azure'),inferenceRouteStatus:'unavailable'};
 const cases=[['api_failure',404,3],['api_failure',401,1],['transport_failure',null,3],['timeout',null,3],['json_invalid',200,1],['response_invalid',200,1]];
 const saved=cases.map(([inferenceRouteFailureCode,inferenceRouteHttpStatus,inferenceRouteAttempts])=>{
  const observation={...base,inferenceRouteFailureCode,inferenceRouteHttpStatus,inferenceRouteAttempts};
  assert.deepEqual(validate(observation),observation);return validate(observation);
 });
 assert.notDeepEqual(saved[0],saved[1]);assert.notDeepEqual(saved[2],saved[3]);assert.notDeepEqual(saved[4],saved[5]);
 for(const inferenceRouteFailureCode of RESEARCH_INFERENCE_ROUTE_FAILURE_CODES)assert.deepEqual(validate({...base,inferenceRouteFailureCode,inferenceRouteHttpStatus:null,inferenceRouteAttempts:0}),{...base,inferenceRouteFailureCode,inferenceRouteHttpStatus:null,inferenceRouteAttempts:0});
 for(const inferenceRouteHttpStatus of [100,599])validate({...base,inferenceRouteFailureCode:'api_failure',inferenceRouteHttpStatus,inferenceRouteAttempts:3});
});

test('R11 receipt fields reject partial, raw, out-of-range and inconsistent diagnostics',()=>{
 const base={...observe('Azure'),inferenceRouteStatus:'unavailable',inferenceRouteFailureCode:'api_failure',inferenceRouteHttpStatus:404,inferenceRouteAttempts:3};
 const mutations=[...failureKeys.map(key=>o=>delete o[key]),o=>o.inferenceRouteFailureCode='PRIVATE_ERROR_BODY',o=>o.inferenceRouteFailureCode=404,
  o=>o.inferenceRouteFailureCode=null,o=>o.inferenceRouteHttpStatus='404',o=>o.inferenceRouteHttpStatus=99,o=>o.inferenceRouteHttpStatus=600,o=>o.inferenceRouteHttpStatus=404.5,o=>o.inferenceRouteHttpStatus={},
  o=>o.inferenceRouteAttempts='3',o=>o.inferenceRouteAttempts=null,o=>o.inferenceRouteAttempts=-1,o=>o.inferenceRouteAttempts=4,o=>o.inferenceRouteAttempts=1.5,
  o=>o.inferenceRouteStatus='unrequested',o=>{o.inferenceRouteStatus='verified';o.inferenceRouteProofHash='a'.repeat(64);},o=>o.rawBody='PRIVATE_ERROR_BODY'];
 for(const mutate of mutations){const observation=structuredClone(base);mutate(observation);assert.throws(()=>validate(observation),/public_research_observation_invalid/);}
 for(const key of failureKeys){const observation=observe('Azure');observation[key]=base[key];assert.throws(()=>validate(observation),/public_research_observation_invalid/);}
 const historical=structuredClone(base);for(const key of failureKeys)delete historical[key];
 for(const key of failureKeys)assert.throws(()=>validate({...historical,[key]:base[key]}),/public_research_observation_invalid/);
});

test('R11 safe route-error normalizer drops raw messages and malformed or unrelated errors',()=>{
 const {readResearchRouteFailureDetails}=require('../.core-tests/research/qualification-owner-contract.js');
 const {GenerationRouteProofError}=require('../.core-tests/research/generation-route.js');
 const error=new GenerationRouteProofError('api_failure',404,3);error.message='PRIVATE_BODY';error.body='PRIVATE_BODY';
 assert.deepEqual(readResearchRouteFailureDetails(error),{code:'api_failure',httpStatus:404,attempts:3});
 for(const code of RESEARCH_INFERENCE_ROUTE_FAILURE_CODES)assert.deepEqual(readResearchRouteFailureDetails(new GenerationRouteProofError(code)),{code,httpStatus:null,attempts:0});
 for(const bad of [null,undefined,'PRIVATE_BODY',new Error('PRIVATE_BODY'),{},[],{...error,name:'OtherError'},{...error,code:'PRIVATE_BODY'},{...error,httpStatus:'404'},{...error,httpStatus:600},{...error,attempts:4},{...error,attempts:null}])assert.equal(readResearchRouteFailureDetails(bad),null);
});
