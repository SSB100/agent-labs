/** New-route fixture only: old model/route helpers remain unchanged. */
import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {directRepairModelDispatch, directRepairModelExpectation} from './r12-direct-controller-repair-model-fixture.mjs';
import {one} from './r12-owner-initial-sql-fixture.mjs';
import * as model from '../../.core-tests/products/discovery-r12-public-model.js';
import {qualifyGenerationRouteProof} from '../../.core-tests/research/generation-route.js';
import {qualifyDirectSonnetRouteProof} from '../../.core-tests/products/discovery-r12-public-reviewer-quote.js';
export {directRepairModelDispatch as directSonnetModelDispatch};
export function directSonnetReceipt(f,a,d,output={}){
 const route=f.quote.inference[a.phase==='review'?'reviewer':'luna'],id='gen-inert-direct-sonnet-'+randomUUID();
 const candidate={version:'r12.discovery-response.1',scopeId:f.prepared.scopeId,attemptId:a.attemptId,requestId:a.requestId,phase:a.phase,requestHash:d.wire.requestHash,providerRequestId:id,providerModelId:route.modelId,receivedAt:new Date().toISOString(),reportedMicrousd:1,output};
 const raw={data:{id,provider_name:route.providerName,model:route.modelId}};
 const proof=a.phase==='review'&&f.quote.version==='r12.public-research-quote.3'?qualifyDirectSonnetRouteProof(raw,id):qualifyGenerationRouteProof(raw,{generationId:id,providerName:route.providerName,acceptedResponseModelIds:route.acceptedResponseModelIds,requestedEndpoint:route.endpoint});
 return{candidate,proof};
}
export async function directSonnetModelComplete(f,a,output){
 const dispatched=await directRepairModelDispatch(f,a),d=dispatched.dispatch,r=directSonnetReceipt(f,a,dispatched,output),ctx=model.readPublicResearchModelInputs(d.inputs,directRepairModelExpectation(d.inputs));
 await f.rpc('candidate',{attemptId:a.attemptId,candidate:r.candidate});const recovered=await f.rpc('attempt',{attemptId:a.attemptId});assert.deepEqual(recovered.candidate,r.candidate);assert.deepEqual(recovered.binding,d.binding);
 const expected=model.projectPublicResearchModelPhase(ctx,r.candidate,d.binding,r.proof),done=await f.rpc('model_receipt',{attemptId:a.attemptId,...r});
 const saved=(await one(f.authority.db,'select content from private.r07_responses where attempt_id=$1',[a.attemptId])).content;assert.deepEqual(saved.result,expected);
 return{done,expected,...r,d};
}
