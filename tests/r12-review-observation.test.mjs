import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {observeR12ReviewResponse,r12ReviewDiagnostic,R12_REVIEW_OBSERVATION_CONTENT_BYTES} from '../.core-tests/products/discovery-r12-observation.js';
import {createDiscoveryR12QuestAdapter,DiscoveryR12ReceiptPending} from '../.core-tests/products/discovery-r12-adapter.js';
import {discoveryR12StaticSchema} from '../.core-tests/products/discovery-r12-schemas.js';
import {inspectDiscoveryR12Wire,routeDiscoveryR12Request} from '../.core-tests/products/discovery-r12-wire.js';
import {discoveryV2Hash} from '../.core-tests/products/discovery-v2.js';
import {resolveModelRoute} from '../.core-tests/models/registry.js';
import {projectProviderJsonSchema} from '../.core-tests/models/openrouter.js';
import {assertJsonSchemaValue,JsonSchemaValidationError} from '../.core-tests/workers/schema-validator.js';
import {workerOutputLimits} from '../.core-tests/workers/output-limits.js';
import {r12PhaseOutputFixture} from './helpers/r12-phase-output-fixture.mjs';
const id=n=>`12000000-0000-4000-8000-${String(n).padStart(12,'0')}`,stamp='2026-10-06T10:05:20.000Z';
const identity={scopeId:id(1),attemptId:id(2),requestId:id(3)};
const model='anthropic/claude-4.5-haiku-20251001';
const body=content=>({id:'gen-r12-observation-inert',model,choices:[{finish_reason:'stop',native_finish_reason:'end_turn',message:{content}}],usage:{prompt_tokens:7652,completion_tokens:1690,total_tokens:9342,cost:.0177122}});

test('R12 review observation captures only bounded unqualified response fields',()=>{
 const raw={...body('{"outcome":"NEEDS_MORE_EVIDENCE"}'),headers:{Authorization:'must-not-survive'},request:'private-prompt-must-not-survive',error:{message:'arbitrary-provider-error'}};
 const observed=observeR12ReviewResponse(raw,identity,stamp);
 assert.equal(observed.contentState,'complete');assert.equal(observed.content,raw.choices[0].message.content);assert.equal(observed.contentBytes,Buffer.byteLength(observed.content));assert.equal(observed.contentHash,createHash('sha256').update(observed.content).digest('hex'));assert.equal(observed.nativeFinishReason,'end_turn');
 assert.equal(JSON.stringify(observed).includes('must-not-survive'),false);assert.equal('output' in observed,false);assert.equal('qualified' in observed,false);
 assert.equal(observeR12ReviewResponse(body(['{', {type:'text',text:'"x":1'}, '}']),identity,stamp).content,'{"x":1}');
});
test('oversized or credential-like observations retain no text prefix',()=>{
 const large='é'.repeat(R12_REVIEW_OBSERVATION_CONTENT_BYTES),a=observeR12ReviewResponse(body(large),identity,stamp);
 assert.equal(a.contentState,'oversized');assert.equal(a.content,null);assert.equal(a.contentBytes,32768);assert.equal(a.contentHash,createHash('sha256').update(large).digest('hex'));
 const secretLike='sk-or-v1-'+ 'a'.repeat(64),b=observeR12ReviewResponse(body(secretLike),identity,stamp);assert.equal(b.contentState,'redacted');assert.equal(b.content,null);assert.ok(!JSON.stringify(b).includes(secretLike));
 for(const text of ['a\0b','unpaired\ud800']){const value=observeR12ReviewResponse(body(text),identity,stamp);assert.equal(value.contentState,'redacted');assert.equal(value.content,null);assert.ok(value.contentHash);}
});
test('reviewer output limits communicate constraints omitted by the supported provider grammar',()=>{
 const schema=discoveryR12StaticSchema('review'),projected=projectProviderJsonSchema(schema),output=r12PhaseOutputFixture('Inert adult audience').review;
 assert.equal(projected.properties.checks.items.properties.rationale.maxLength,undefined);
 assert.match(workerOutputLimits(schema),/checks\[\]\.rationale: 30–240 characters/);
 assert.deepEqual(projected.properties.outcome.enum,['TEST','REJECT','NEEDS_MORE_EVIDENCE']);
 output.checks[0].rationale='x'.repeat(241);assertJsonSchemaValue(projected,output,'Projected grammar');
 let error;try{assertJsonSchemaValue(schema,output,'Local contract');}catch(e){error=e;}assert.ok(error instanceof JsonSchemaValidationError);
 const diagnostic=r12ReviewDiagnostic(error,'response_schema',identity,schema,true,stamp);assert.deepEqual(diagnostic.issues,[{path:'$.checks[0].rationale',constraint:'max_length',limit:240}]);
 const malicious=new JsonSchemaValidationError('private text',[{path:'$.untrusted_secret_name',message:'secret value'},{path:'$.checks[0].rationale',message:'private text'}]);
 assert.deepEqual(r12ReviewDiagnostic(malicious,'response_schema',identity,schema,true,stamp).issues,[{path:'$',constraint:'shape',limit:null},{path:'$.checks[0].rationale',constraint:'shape',limit:null}]);
});

async function fixture({content,finish='stop',failObservation=false,failStage=false,failBinding=false}={}){
 const scope={version:'r12.discovery-review-continuation.1',id:identity.scopeId,businessId:id(4),goalId:id(5),allowedDomains:['ipsos.com','mdpi.com']};
 const schema=discoveryR12StaticSchema('review'),output=r12PhaseOutputFixture('Inert adult audience').review;
 const request=routeDiscoveryR12Request({model:resolveModelRoute('reviewer.independent').primary,messages:[{role:'system',content:'Complete the independently reviewed inert output contract.'}],schemaName:'inert',outputSchema:schema,maxOutputTokens:4000},'review',{modelId:'anthropic/claude-haiku-4.5',endpoint:'amazon-bedrock/us',priceLimit:{prompt:1,completion:5,request:0}});
 const wire=await inspectDiscoveryR12Wire(request,'review'),qualificationHash='a'.repeat(64),workflowDefinitionId=id(6),workerDefinitionId=id(7),step={key:'review',adapter:`r12.discovery.${scope.id}.review`,operationKey:`research.r12.${scope.id}.review`,qualificationHash,workflowDefinitionId,workerDefinitionId,maximumMicrounits:'157168'};
 const ctx={plan:{format:'r12.discovery-review.1',discoveryScopeId:scope.id,discoveryScopeHash:discoveryV2Hash(scope),businessId:scope.businessId,goalId:scope.goalId,expiresAt:'2026-10-06T10:33:00.000Z'},step,attempt:{id:identity.attemptId,requestId:identity.requestId,wireHash:wire.wireHash,dependencyPins:[]}};
 const binding={version:'r12.discovery-wire.1',...identity,scopeHash:discoveryV2Hash(scope),phase:'review',requestJson:JSON.stringify(request),requestHash:wire.requestHash,wireBody:wire.wire.body,wireHash:wire.wireHash,dependencyPins:[]};
 const state={events:[],posts:0,gets:0,settlements:[],observation:null,diagnostic:null,candidate:null};
 const store={operation:async(_attempt,operation,payload)=>{state.events.push(operation);if(operation==='load')return{binding,candidate:state.candidate,proof:null,diagnostic:state.diagnostic,observationSaved:!!state.observation,receipt:state.candidate?{status:'awaiting_receipt'}:null};if(operation==='send')return{shouldDispatch:true};if(operation==='observe'){if(failObservation)throw Error('inert observation storage failure');state.observation=payload.observation;return{observed:true};}if(operation==='diagnose'){state.diagnostic=payload.diagnostic;return{recorded:true};}if(operation==='stage'){if(failStage)throw Error('inert candidate storage failure');state.candidate=payload.candidate;return{staged:true};}if(operation==='claim')return{claimed:true,claimId:id(8)};if(operation==='record')return{recorded:true};throw Error(operation);},dispatchedAt:async()=>{state.events.push('dispatchedAt');if(failBinding)throw Error('inert dispatch read failure');return'2026-10-06T10:05:03.000Z';},settle:async(_attempt,s)=>{state.events.push('settle');state.settlements.push(s);}};
 const adapter=createDiscoveryR12QuestAdapter({scope,phase:'review',identity:{qualificationHash,workflowDefinitionId,workerDefinitionId,mode:'qualification'},dataClasses:['business_context','public_evidence'],store,request:async()=>request,quote:async()=>{throw Error('No live quote')},project:async()=>{throw Error('Receipt never completes in this fixture')},now:()=>Date.parse(stamp),config:{apiKey:'inert-config-no-secret',baseUrl:'https://openrouter.ai/api/v1',appUrl:'https://agent-labs-two.vercel.app',appName:'Agent Labs'},fetcher:async(_url,init)=>{if(init.method==='GET'){state.gets++;return new Response('{"error":{"message":"Inert delayed receipt"}}',{status:404});}state.posts++;const response=body(content===undefined?JSON.stringify(output):content);response.choices[0].finish_reason=finish;return new Response(JSON.stringify(response),{status:200});}});
 return{adapter,ctx,call:{wire:wire.wire},state};
}
for(const [name,options,code] of [
 ['malformed JSON',{content:'{"outcome":'},'json_parse'],
 ['overlong rationale',{content:JSON.stringify({...r12PhaseOutputFixture('Inert adult audience').review,checks:r12PhaseOutputFixture('Inert adult audience').review.checks.map((x,i)=>i===0?{...x,rationale:'x'.repeat(241)}:x)})},'response_schema'],
 ['incomplete completion',{finish:'length'},'finish_reason'],
 ['failed observation storage',{failObservation:true},'observation_storage'],
 ['failed dispatch timestamp read',{failBinding:true},'candidate_binding'],
 ['failed candidate storage',{failStage:true},'candidate_storage']
])test(`R12 preserves accounting and a typed diagnostic for ${name}`,async()=>{
 const {adapter,ctx,call,state}=await fixture(options);await assert.rejects(adapter.dispatch(call,ctx));
 assert.equal(state.posts,1);assert.equal(state.gets,0);assert.equal(state.candidate,null);assert.equal(state.settlements.length,1);assert.equal(state.settlements[0].actualMicrounits,'17713');assert.equal(state.diagnostic.code,code);assert.equal(state.diagnostic.observationSaved,!options.failObservation);
 if(!options.failObservation)assert.ok(state.observation);assert.deepEqual(await adapter.reconcile(ctx),{status:'unknown'});assert.equal(state.posts,1);assert.equal(state.gets,0);
});
test('successful review saves its unqualified observation before validation and receipt lookups',async()=>{
 const {adapter,ctx,call,state}=await fixture();await assert.rejects(adapter.dispatch(call,ctx),DiscoveryR12ReceiptPending);
 assert.equal(state.posts,1);assert.equal(state.gets,1);assert.ok(state.candidate);assert.ok(state.observation);assert.equal(state.diagnostic,null);
 assert.ok(state.events.indexOf('observe')<state.events.indexOf('dispatchedAt'));assert.ok(state.events.indexOf('observe')<state.events.indexOf('stage'));assert.ok(state.events.indexOf('stage')<state.events.indexOf('claim'));assert.equal(state.settlements[0].actualMicrounits,'17713');
});
