import type { AdaptiveFundingProof } from './discovery-r12-adaptive-funding-proof';
import {createHash} from 'node:crypto';
import type {QuestAdapterContext,QuestAdaptiveActionProjection} from '../core/quest-controller';
import {discoveryV2Hash as hash} from './discovery-v2';
import {validateAdaptiveExecutionScope,type DiscoveryAdaptiveOwnerScope} from './discovery-r12-adaptive-execution-scope';
import {validateAdaptiveResearchPlan,type AdaptiveResearchPreview} from './discovery-r12-adaptive-scope';
import {inspectAdaptiveResearchWire} from './discovery-r12-adaptive-wire';
import {adaptiveResearchPhaseLimits,validateAdaptiveExecutionQuote,type AdaptiveResearchQuote} from './discovery-r12-adaptive-quote';
import {validateDiscoveryR12Candidate,qualifyDiscoveryR12Candidate} from './discovery-r12-receipt';
import type {DiscoveryR12Phase} from './discovery-r12-wire';
import type {GenerationRouteProof} from '../research/generation-route';
import type {StructuredModelRequest,WebSearchModelRequest} from '../models/types';
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const fail=():never=>{throw new Error('r12_adaptive_receipt_resume_unverified');};
/** Read-only recovery eligibility. Caller supplies fresh same-owner SQL reads.
 * expectedPlanHash is the authenticated activation/snapshot identity. SQL
 * JSONB plan hashes are distinct from the JS canonical body hash; the complete
 * plan body is independently validated against the approved scope above.
 * No dispatch, claim, settlement, action admission or authority is created. */
export async function validateAdaptiveReceiptResume(input:{context:QuestAdapterContext;expectedPlanId:string;expectedPlanHash:string;leaseExpiresAt?:string;scope:DiscoveryAdaptiveOwnerScope;
  fundingProof?:AdaptiveFundingProof|null; preview:AdaptiveResearchPreview;approvedQuote:AdaptiveResearchQuote;action:QuestAdaptiveActionProjection;saved:unknown;now?:number}){
 const {context:c,scope,preview,action,approvedQuote}=input,now=input.now??Date.now(),s=input.saved as Record<string,unknown>;
 validateAdaptiveExecutionScope(scope,preview,Date.parse(scope.createdAt),input.fundingProof??null);validateAdaptiveResearchPlan(c.plan,preview,{id:scope.id,hash:hash(scope)},Date.parse(scope.createdAt));
 if(!Number.isFinite(now)||!object(s)||s.diagnostic||!object(s.binding)||!object(s.receipt)||!s.candidate||
   !['dispatched','responded','uncertain'].includes(c.attempt.status)||action.actionHash!==c.attempt.adaptiveActionHash||action.ordinal!==c.attempt.adaptiveActionOrdinal||
   !action.attemptIds.includes(c.attempt.id)||!action.phaseKeys.includes(c.step.key)||
   !/^[a-f0-9]{64}$/.test(input.expectedPlanHash)||c.planHash!==input.expectedPlanHash||
   !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.expectedPlanId)||c.planId!==input.expectedPlanId)fail();
 const b=s.binding as Record<string,unknown>,r=s.receipt as Record<string,unknown>;
 if(b.version!==(scope.version==='r12.discovery-owner-adaptive.2'?'r12.adaptive-wire.2':'r12.adaptive-wire.1')||b.scopeId!==scope.id||b.scopeHash!==hash(scope)||b.attemptId!==c.attempt.id||b.requestId!==c.attempt.requestId||
   b.actionHash!==action.actionHash||b.actionOrdinal!==action.ordinal||b.phase!==c.step.key||!['plan','search1','select1','strategy','review'].includes(String(b.phase))||
   typeof b.requestJson!=='string'||typeof b.wireBody!=='string'||b.wireHash!==c.attempt.wireHash||!object(b.quote)||
   hash(b.dependencyPins)!==hash(c.attempt.dependencyPins)||!['awaiting_receipt','checking_receipt','verified'].includes(String(r.status))||
   r.requestId!==c.attempt.requestId||!Number.isSafeInteger(r.attempts)||Number(r.attempts)<0||Number(r.attempts)>3||typeof s.dispatchedAt!=='string')fail();
 const quote=b.quote as AdaptiveResearchQuote;
 validateAdaptiveExecutionQuote(quote,approvedQuote,scope.quoteHash,Date.parse(quote.verifiedAt));
 const request=JSON.parse(b.requestJson as string) as StructuredModelRequest|WebSearchModelRequest;
 if(hash(request)!==b.requestHash||createHash('sha256').update(b.wireBody as string).digest('hex')!==b.wireHash)fail();
 const phase=b.phase==='search1'?'search':b.phase==='select1'?'select':b.phase as 'plan'|'strategy'|'review';
 const wire=await inspectAdaptiveResearchWire(request,phase,quote,Date.parse(quote.verifiedAt));
 if(wire.wire.body!==b.wireBody||wire.requestHash!==b.requestHash)fail();
 const expires=Math.min(Date.parse(c.plan.expiresAt)+1800000,Date.parse(s.dispatchedAt as string)+3600000);
 if(!Number.isFinite(expires)||now>=expires||typeof r.receiptExpiresAt!=='string'||Date.parse(r.receiptExpiresAt)!==expires||
   Date.parse(s.dispatchedAt as string)>=Date.parse(c.plan.expiresAt)||Date.parse(s.dispatchedAt as string)>now)fail();
 const binding={scopeId:scope.id,attemptId:c.attempt.id,requestId:c.attempt.requestId!,phase:b.phase as DiscoveryR12Phase,request,
   maximumMicrousd:adaptiveResearchPhaseLimits(quote,phase).maximumMicrousd,dispatchedAt:s.dispatchedAt as string,receiptExpiresAt:r.receiptExpiresAt as string};
 const candidate=validateDiscoveryR12Candidate(s.candidate,binding);
 if(candidate.reportedMicrousd===null||r.candidateHash!==hash(candidate)||Date.parse(candidate.receivedAt)>now)fail();
 if(r.status==='verified'){if(!s.proof)fail();const qualified=qualifyDiscoveryR12Candidate(candidate,binding,s.proof as GenerationRouteProof);if(r.proofHash!==qualified.route.proofHash)fail();}
 else if(s.proof)fail();
 if(r.nextCheckAt!==null&&(typeof r.nextCheckAt!=='string'||!Number.isFinite(Date.parse(r.nextCheckAt))))fail();
 const lease=input.leaseExpiresAt===undefined?null:Date.parse(input.leaseExpiresAt);
 if(lease!==null){
  const stamp=input.leaseExpiresAt!,parts=/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(?:Z|[+-]\d\d:\d\d)$/.exec(stamp);
  if(!parts||!Number.isFinite(lease))return fail();
  const wall=parts[1]+'.'+(parts[2]??'').padEnd(3,'0').slice(0,3)+'Z',parsed=Date.parse(wall);
  if(!Number.isFinite(parsed)||new Date(parsed).toISOString()!==wall)fail();
 }
 // Lease timing only delays a fresh wake. It never replaces a claim or permits
 // a new provider send; an expired lease contributes no additional wait.
 const wakeAt=lease===null?(typeof r.nextCheckAt==='string'?r.nextCheckAt:undefined):new Date(Math.max(now,lease,typeof r.nextCheckAt==='string'?Date.parse(r.nextCheckAt):now)).toISOString();
 return{eligible:true as const,authorityCreated:false as const,mode:r.status==='verified'?'project_saved_receipt' as const:'receipt_lookup_only' as const,
   receiptProgressHash:hash({actionHash:action.actionHash,attemptId:c.attempt.id,requestHash:b.requestHash,candidateHash:r.candidateHash,status:r.status,attempts:r.attempts,nextCheckAt:r.nextCheckAt,proofHash:r.proofHash??null}),
   ...(wakeAt?{wakeAt}:{})};
}
