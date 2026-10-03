import assert from 'node:assert/strict';
import test from 'node:test';
import adapterModule from '../.core-tests/models/openrouter.js';
import registryModule from '../.core-tests/models/registry.js';
const {OpenRouterAdapter}=adapterModule;
const config={apiKey:'inert-fixture',baseUrl:'https://provider.invalid/api/v1',appUrl:'https://app.invalid',appName:'Inert test'};
const request=()=>({model:registryModule.resolveModelRoute('standard.default').primary,schemaName:'test',outputSchema:{type:'object'},messages:[{role:'user',content:'Original exact prompt'}],requestMetadata:{}});
test('model dispatch is closed without admission, including an injected transport',async()=>{
 let calls=0;
 const adapter=new OpenRouterAdapter({config,fetcher:async()=>{calls++;throw Error('must not dispatch');}});
 await assert.rejects(adapter.invokeStructured(request()),e=>e.retryable===false&&/admission is required/.test(e.message));
 assert.equal(calls,0);
});
test('rejected authority sends no request and does not expose private database errors',async()=>{
 let calls=0;
 const adapter=new OpenRouterAdapter({config,admitDispatch:async()=>{throw Error('private-capability-must-not-leak');},fetcher:async()=>{calls++;throw Error('must not dispatch');}});
 await assert.rejects(adapter.invokeStructured(request()),e=>e.retryable===false&&/no provider request was sent/.test(e.message)&&!e.message.includes('private-capability'));
 assert.equal(calls,0);
});
test('admission observes the exact immutable wire bytes before the single provider call',async()=>{
 const input=request(),events=[];let admittedBody;
 const adapter=new OpenRouterAdapter({config,admitDispatch:async wire=>{
   events.push('admit');admittedBody=wire.body;assert.equal(wire.method,'POST');assert.equal(wire.url,config.baseUrl+'/chat/completions');
   input.messages[0].content='Mutation during authorization';wire.body='callback mutation';
 },fetcher:async(_url,options)=>{
   events.push('fetch');assert.equal(options.body,admittedBody);assert.match(options.body,/Original exact prompt/);assert.ok(!options.body.includes('Mutation during'));
   return new Response(JSON.stringify({id:'inert-receipt',model:input.model.providerModelId,choices:[{message:{content:'{}'},finish_reason:'stop'}],usage:{cost:0.001}}),{status:200});
 }});
 await adapter.invokeStructured(input);assert.deepEqual(events,['admit','fetch']);
});
