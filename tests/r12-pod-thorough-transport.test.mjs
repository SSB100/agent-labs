import test from 'node:test';
import assert from 'node:assert/strict';
import {source} from './helpers/r12-pod-owner-ui-fixture.mjs';
const {OpenRouterAdapter,structuredOpenRouterBody}=source('models/openrouter');
const {resolveModelRoute}=source('models/registry');
const {ModelProviderError}=source('models/types');
const {r12ReviewDiagnostic}=source('products/discovery-r12-observation',{'../models/types':{ModelProviderError}});
const config={apiKey:'inert-local-test-only',baseUrl:'https://openrouter.ai/api/v1',appUrl:'https://example.invalid',appName:'inert'};
const request={model:resolveModelRoute('standard.default').primary,messages:[{role:'user',content:'Inert local fixture.'}],schemaName:'inert',outputSchema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false},maxOutputTokens:16000,requestMetadata:{},requireReturnedModel:true};
const envelope=content=>({id:'gen-inert-response',model:request.model.providerModelId,provider:'Azure',choices:[{finish_reason:'stop',message:{content}}],usage:{prompt_tokens:1,completion_tokens:1,cost:.000123}});

test('streamed response accepts exact byte limit and rejects one byte over without replay',async()=>{
 const body=JSON.stringify(envelope(JSON.stringify({text:'界🧵\\"'.repeat(40000)}))),size=Buffer.byteLength(body);
 for(const limit of [size,size-1]){
  let calls=0,admissions=0;
  const adapter=new OpenRouterAdapter({config,maximumResponseBytes:limit,admitDispatch:async()=>{admissions++;},fetcher:async()=>{calls++;return new Response(body);}});
  if(limit===size){const result=await adapter.invokeStructured(request);assert.equal(result.output.text,'界🧵\\"'.repeat(40000));}
  else await assert.rejects(adapter.invokeStructured(request),e=>e.details?.validationGate==='response_size');
  assert.equal(calls,1);assert.equal(admissions,1);
 }
});

test('declared oversized response is cancelled before body read and never retried',async()=>{
 let cancelled=false,calls=0;
 const stream=new ReadableStream({cancel(){cancelled=true;}});
 const adapter=new OpenRouterAdapter({config,maximumResponseBytes:100,admitDispatch:async()=>{},fetcher:async()=>{calls++;return new Response(stream,{headers:{'content-length':'101'}});}});
 await assert.rejects(adapter.invokeStructured(request),e=>e.details?.validationGate==='response_size');
 assert.equal(cancelled,true);assert.equal(calls,1);
});

test('full body timeout remains bounded after successful headers',async()=>{
 let cancelled=false,calls=0;
 const stream=new ReadableStream({cancel(){cancelled=true;}});
 const adapter=new OpenRouterAdapter({config,timeoutMs:10,admitDispatch:async()=>{},fetcher:async()=>{calls++;return new Response(stream);}});
 await assert.rejects(adapter.invokeStructured(request),e=>e.category==='provider_timeout');
 assert.equal(cancelled,true);assert.equal(calls,1);
});

test('invalid transport bounds fail before any dispatch',()=>{
 for(const timeoutMs of [0,-1,Infinity,NaN,120001,1.5])assert.throws(()=>new OpenRouterAdapter({config,timeoutMs}));
 for(const maximumResponseBytes of [0,-1,Infinity,NaN,16*1024*1024+1,1.5])assert.throws(()=>new OpenRouterAdapter({config,maximumResponseBytes}));
});

test('pure capacity serializer is byte-identical to actual structured dispatch',async()=>{
 const expected=JSON.stringify(structuredOpenRouterBody(request));let observed;
 const adapter=new OpenRouterAdapter({config,admitDispatch:async wire=>{observed=wire.body;},fetcher:async()=>new Response(JSON.stringify(envelope('{"text":"ok"}')))});
 await adapter.invokeStructured(request);assert.equal(observed,expected);
});

test('verified length plus partial JSON is a truncation diagnostic; identity failures stay identity failures',()=>{
 const identity={scopeId:'scope',attemptId:'attempt',requestId:'request'},stamp='2026-10-12T21:00:00Z';
 const error=gate=>new ModelProviderError('malformed_model_output','fixed',false,{validationGate:gate,providerReceipt:{finishReason:'length'}});
 assert.equal(r12ReviewDiagnostic(error('structured_output'),'transport',identity,request.outputSchema,true,stamp).code,'finish_reason');
 assert.equal(r12ReviewDiagnostic(error('response_model'),'transport',identity,request.outputSchema,true,stamp).code,'response_identity');
 assert.equal(r12ReviewDiagnostic(error('provider_envelope'),'transport',identity,request.outputSchema,true,stamp).code,'provider_envelope');
 assert.equal(r12ReviewDiagnostic(Error('r12_pod_next_consumer_capacity_exceeded'),'domain_validation',identity,request.outputSchema,true,stamp).code,'next_consumer_capacity');
});
