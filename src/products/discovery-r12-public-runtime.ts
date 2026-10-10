import {getSteelCreateDeployment} from '../browser/etsy-steel-create-binding';
import{validatePublicResearchRepairPolicy,validatePublicResearchRepairState}from './discovery-r12-public-repair';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {awaitRequestDeadline,boundedRpc,requestDeadline} from '../core/request-deadline';
import {createRuntimeClient} from '../lib/supabase/runtime';
import {deriveDirectServerKey,type DirectServerKeyPurpose} from './discovery-r12-public-server-key';
import {publicResearchHash as hash,publicUuid,publicHash} from './discovery-r12-public-utils';
import {validatePublicResearchPolicy} from './discovery-r12-public-contracts';
import {validatePublicResearchProfile,validatePublicResearchQuote} from './discovery-r12-public-preparation';
import {fetchDirectSonnetInferenceQuote} from './discovery-r12-public-reviewer-quote';
import {fetchAdaptiveResearchQuote} from './discovery-r12-adaptive-quote';
import {validatePublicResearchState} from './discovery-r12-public-cycle';
import {decidePublicResearchDriverAction} from './discovery-r12-public-driver';
import {createPublicResearchModelRpc,runPublicResearchModelAttempt} from './discovery-r12-public-model-runtime';
import {createEtsyInsightsRpcRuntime} from '../browser/etsy-insights-rpc-runtime';
import type {EtsyInsightsScope} from '../browser/etsy-insights-contracts';
/** Nonsecret immutable identifiers only. Server keys are derived inside each
 * durable step; never serialized into workflow history or returned to a form. */
export type PublicResearchRuntimeInput={businessId:string;goalId:string;ownerId:string;grantId:string;testEnvelopeId:string;envelopeHash:string;routeHash:string;scopeId:string;scopeHash:string;planHash:string;profileHash:string;policyHash:string};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function check(v:unknown):asserts v{if(!v)throw Error('r12_direct_runtime_unconfirmed');}
export async function executePublicResearchRuntimeStep(input:PublicResearchRuntimeInput,runtimeRunId:string){
 check(Object.keys(input).sort().join(',')==='businessId,envelopeHash,goalId,grantId,ownerId,planHash,policyHash,profileHash,routeHash,scopeHash,scopeId,testEnvelopeId');
 check([input.businessId,input.goalId,input.ownerId,input.grantId,input.testEnvelopeId,input.scopeId].every(publicUuid)&&[input.envelopeHash,input.routeHash,input.scopeHash,input.planHash,input.profileHash,input.policyHash].every(publicHash));
 check(typeof runtimeRunId==='string'&&runtimeRunId.length>0&&runtimeRunId.length<=200);
 const root=process.env.R05_ADMISSION_SERVER_KEY?.trim();check(process.env.VERCEL_ENV==='production'&&root&&root.length>=32&&root.length<=200);
 const bootstrap=createHmac('sha256',root).update(JSON.stringify({version:'r12.owner-bootstrap.1',businessId:input.businessId,ownerId:input.ownerId,grantId:input.grantId})).digest('base64url');
 const key=(purpose:DirectServerKeyPurpose)=>deriveDirectServerKey(bootstrap,{businessId:input.businessId,goalId:input.goalId,testEnvelopeId:input.testEnvelopeId,envelopeHash:input.envelopeHash,routeHash:input.routeHash,purpose});
 const client=createRuntimeClient(),signal=requestDeadline(180000);
 const rpc=async(purpose:DirectServerKeyPurpose,operation:string,payload:Record<string,unknown>={})=>{const cleanup=['source_receipt','cleanup_complete'].includes(operation)||operation==='source_transport'&&object(payload.request)&&['browser.etsy.session.release','browser.etsy.session.release_readback'].includes(String(payload.request.operation));const r=await boundedRpc(client.rpc('r12_direct_controller_server',{p_business_id:input.businessId,p_scope_id:input.scopeId,p_operation:operation,p_payload:payload,p_server_key:key(purpose)}),cleanup?requestDeadline(15000):AbortSignal.any([signal,requestDeadline(15000)]),10000);check(!r.error&&r.data!==null);return r.data as unknown;};
 let raw=await rpc('controller','read');check(object(raw));
 if(raw.runtime!==null&&raw.runtime!==undefined){check(object(raw.runtime));if(raw.runtime.runtimeRunId!==runtimeRunId)return{continue:false,reason:'existing_runtime_requires_reconciliation',questComplete:false};}
 else{const attached=await rpc('controller','attach_runtime',{runtimeRunId});check(object(attached));if(attached.currentRuntimeRunId!==runtimeRunId)return{continue:false,reason:'existing_runtime_requires_reconciliation',questComplete:false};raw=await rpc('controller','read');}
 // Existing immutable attachment permits receipt recovery after Stop/expiry;
 // only a first attachment requires live scheduling authority.
 check(object(raw)&&object(raw.setup)&&object(raw.setup.preview));const setup=raw.setup;check(object(setup.preview));const p=setup.preview;
 check(setup.confirmed===true&&setup.businessId===input.businessId&&setup.goalId===input.goalId&&setup.scopeId===input.scopeId&&setup.scopeHash===input.scopeHash&&setup.planHash===input.planHash&&setup.testEnvelopeId===input.testEnvelopeId&&p.testEnvelopeHash===input.envelopeHash&&hash(p)===setup.setupHash);
 const policy=object(p.policy)&&p.policy.version==='r12.direct-etsy-attempt-policy.2'?validatePublicResearchRepairPolicy(p.policy):validatePublicResearchPolicy(p.policy),profile=validatePublicResearchProfile(p.profile);
 check(policy.policyHash===input.policyHash&&profile.profileHash===input.profileHash);
 const decision=decidePublicResearchDriverAction(policy,raw.state as Parameters<typeof decidePublicResearchDriverAction>[1]);
 if(decision.kind==='stage_complete'||decision.kind==='pause')return{continue:false,reason:decision.kind==='pause'?decision.reason:'research_window_complete',questComplete:false};
 let attemptId:string;const phase=decision.phase;
 if(decision.kind==='schedule'){
  // Public inference catalog is fetched independently. SQL supplies browser
  // revalidation and preserves its original private qualification timestamps.
  check(object(p.quote)&&typeof p.quote.verifiedAt==='string');
  const savedQuote=validatePublicResearchQuote(p.quote,Date.parse(p.quote.verifiedAt));check(savedQuote.quoteHash===policy.quoteHash);
  const inferenceQuote=savedQuote.version==='r12.public-research-quote.3'?await awaitRequestDeadline(fetchDirectSonnetInferenceQuote(),signal):await awaitRequestDeadline(fetchAdaptiveResearchQuote({version:'r12.adaptive-quote.2'}),signal);
  const observed=await rpc('controller','observe_quote',{inferenceQuote});check(object(observed)&&object(observed.quote));
  attemptId=randomUUID();const scheduled=await rpc('controller','schedule',{phase,attemptId,runtimeCapability:randomBytes(32).toString('base64url'),expectedStateHash:decision.expectedStateHash,executionQuote:observed.quote});check(object(scheduled)&&scheduled.attemptId===attemptId&&scheduled.phase===phase);
 }else attemptId=decision.attemptId;
 const attempt=await rpc('controller','attempt',{attemptId});check(object(attempt)&&attempt.attemptId===attemptId&&attempt.phase===phase);
 if(phase!=='source'){
  const result=await runPublicResearchModelAttempt({authority:{businessId:input.businessId,goalId:input.goalId,scopeId:input.scopeId,scopeHash:input.scopeHash,planHash:input.planHash,profileHash:input.profileHash,policyHash:input.policyHash},attemptId,mode:attempt.dispatched?'receipt_only':'execute'},{rpc:createPublicResearchModelRpc(client,{businessId:input.businessId,scopeId:input.scopeId,controllerKey:key('controller'),admissionKey:key('admission')},signal)});
  return{continue:result.status==='accepted'||result.status==='failed_settled',reason:result.status,questComplete:false};
 }
 if(attempt.dispatched){
  // Recovery never creates another session. SQL can finish only an already
  // captured immutable receipt with qualified cleanup and bounded accounting.
  const settled=await rpc('source','source_finish',{attemptId});check(object(settled));const current=await rpc('controller','read');check(object(current));const state=policy.version==='r12.direct-etsy-attempt-policy.2'?validatePublicResearchRepairState(current.state,policy):validatePublicResearchState(current.state,policy),before=policy.version==='r12.direct-etsy-attempt-policy.2'?validatePublicResearchRepairState(raw.state,policy):validatePublicResearchState(raw.state,policy);const progressed=state.stateHash!==before.stateHash;return{continue:progressed,reason:progressed?'source_reconciled':'source_recovery_pending',questComplete:false};
 }
 const pending:Promise<void>[]=[];
 const source=createEtsyInsightsRpcRuntime({scope:attempt.inputs as EtsyInsightsScope,routeHash:input.routeHash,signal,createConfigurationGuard:{scopeHash:hash(attempt.inputs),deployment:getSteelCreateDeployment(),admit:async(request,admissionSignal)=>{const r=await boundedRpc(client.rpc('r12_steel_create_config_admit',{p_business_id:input.businessId,p_request:request,p_server_key:key('source')}),AbortSignal.any([signal,admissionSignal,requestDeadline(15000)]),10000);check(!r.error&&r.data!==null);return r.data;}},registerCleanup:work=>{pending.push(work);},sourceRpc:(operation,payload)=>rpc('source',operation,payload),ledgerRpc:async(operation,payload)=>{const s=attempt.inputs as EtsyInsightsScope;const r=await boundedRpc(client.rpc('r12_direct_browser_ledger',{p_business_id:input.businessId,p_operation_id:s.operationId,p_operation:operation,p_payload:payload,p_server_key:key('evidence')}),requestDeadline(15000),10000);check(!r.error&&r.data!==null);return r.data;}});
 try{const result=await source.run();return{continue:result.completion?.accepted===true,reason:result.completion?.accepted===true?'source_recorded':'source_recovery_pending',questComplete:false};}
 finally{await awaitRequestDeadline(Promise.allSettled(pending),requestDeadline(5000));}
}
