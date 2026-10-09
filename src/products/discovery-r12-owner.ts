import "server-only";
import {validateR12FocusedSuccessor,validateR12FocusedUnsentClosure,validateR12MarkedPretransportClosure,type R12FocusedUnsentClosure,type R12FocusedSuccessor} from "./discovery-r12-focused-successor";
import type { OwnerUiContext } from "../lib/core-ui/data";
import { verifyOwnerBusiness } from "../lib/core-ui/owner-business";
import { reconstructDiscoveryR12Result, type DiscoveryR12Result } from "./discovery-r12-runtime";
import type { DiscoveryR12Phase } from "./discovery-r12-wire";
import { validateR12ReviewOwnerEvidence, type R12ReviewObservationMetadata, type R12ReviewDiagnosticMetadata } from "./discovery-r12-observation";
import { validateOwnerEpisodeClosure, type OwnerEpisodeClosure } from "./discovery-r12-owner-episode";
import { discoveryV2Hash } from "./discovery-v2";
export { r12ReviewDiagnosticSummary } from "./discovery-r12-observation";
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const money=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,15})$/.test(v)&&Number.isSafeInteger(Number(v));
const id=(v:unknown):v is string=>typeof v==='string'&&UUID.test(v);
type OwnerEpisodeWorkspace = {profileId:string;profileHash:string;fundingKind:"legacy_research_root"|"r05_business";episodeNumber:number;predecessorClosure:OwnerEpisodeClosure;predecessorClosureHash:string};
export type DiscoveryR12Workspace={version:'r12.discovery-workspace.1';businessId:string;scopeId:string;goalId:string;title:string;approvedQuery:string;sourceDomains:string[];priorRoundId:string|null;budgetAuthorityRootId:string;ownerInitial?:{profileId:string;profileHash:string;fundingKind:"legacy_research_root"|"r05_business"};ownerEpisode?:OwnerEpisodeWorkspace;focusedPilot?:{profileHash:string;closedScopeId:string;closedPlanId:string;acceptedReviewScopeId:string};focusedSuccessor?:R12FocusedSuccessor;focusedUnsentClosure?:R12FocusedUnsentClosure;focusedPretransportClosure?:ReturnType<typeof validateR12MarkedPretransportClosure>;planId:string|null;planHash:string|null;planVersion:number|null;addendumHash?:string;priorStrategy?:{scopeId:string;attemptId:string;knownMicrousd:string};nextReviewScopeId:string|null;priorReviews:Array<{scopeId:string;attemptId:string;knownMicrousd:string}>;state:string;reason:string|null;policyRevoked:boolean;paused:boolean;activeWindow:boolean;dispatchUntil:string|null;receiptUntil:string|null;continueAfter?:string;phases:Array<{phase:DiscoveryR12Phase;status:string;reason:string|null;attemptId:string|null;artifactId:string|null;candidateSaved:boolean;pretransportReconciled?:boolean;responseObservation?:R12ReviewObservationMetadata|null;responseDiagnostic?:R12ReviewDiagnosticMetadata|null;receipt:null|{status:string;attempts:number;nextCheckAt:string|null;receiptExpiresAt:string;diagnostic:null|{code:string;httpStatus:number|null}};knownMicrousd:string|null;heldMicrousd:string;unknownCost:boolean;outcome:string|null}>;cost:{knownMicrousd:string;heldMicrousd:string;hasUnknown:boolean};rootFunding:Record<string,unknown>;activation:null};
export function parseDiscoveryR12Workspace(raw:unknown,businessId:string,scopeId:string):DiscoveryR12Workspace{
 const date=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v));
 const nullableId=(v:unknown)=>v===null||id(v), nullableCode=(v:unknown)=>v===null||typeof v==='string'&&/^[a-z][a-z0-9_]{0,100}$/.test(v);
 const nullablePhaseReason=(v:unknown)=>v===null||typeof v==='string'&&v.trim().length>0&&v.length<=240;
 const evidence=record(raw)&&typeof raw.addendumHash==='string'&&/^[a-f0-9]{64}$/.test(raw.addendumHash);
 const pilot=record(raw)&&record(raw.focusedPilot);
 const ownerInitial=record(raw)&&record(raw.ownerInitial);
 const ownerEpisode=record(raw)&&record(raw.ownerEpisode);
 if(ownerEpisode){
  const info=raw.ownerEpisode as Record<string,unknown>,closure=validateOwnerEpisodeClosure(info.predecessorClosure);
  if(ownerInitial||pilot||evidence||Object.keys(info).sort().join(',')!=='episodeNumber,fundingKind,predecessorClosure,predecessorClosureHash,profileHash,profileId'||!id(info.profileId)||typeof info.profileHash!=='string'||!/^[a-f0-9]{64}$/.test(info.profileHash)||!['legacy_research_root','r05_business'].includes(String(info.fundingKind))||!Number.isSafeInteger(info.episodeNumber)||Number(info.episodeNumber)<1||Number(info.episodeNumber)>5||info.predecessorClosureHash!==discoveryV2Hash(closure)||closure.businessId!==businessId||closure.goalId!==raw.goalId||closure.authorityRootId!==raw.budgetAuthorityRootId||closure.priorRoundId!==raw.priorRoundId||closure.predecessorScopeId===scopeId||raw.planVersion!==closure.predecessorPlanVersion+1||raw.planId===closure.predecessorPlanId||((info.fundingKind==='r05_business')!==(closure.authorityRootId===businessId)))throw Error('r12_discovery_workspace_unavailable');
 }else if(record(raw)&&raw.ownerEpisode!==undefined)throw Error('r12_discovery_workspace_unavailable');
 const ownerFunding=ownerInitial?raw.ownerInitial:ownerEpisode?raw.ownerEpisode:null;
 if(ownerInitial){const info=raw.ownerInitial as Record<string,unknown>;if(pilot||evidence||Object.keys(info).sort().join(',')!=='fundingKind,profileHash,profileId'||!id(info.profileId)||typeof info.profileHash!=='string'||!/^[a-f0-9]{64}$/.test(info.profileHash)||!['legacy_research_root','r05_business'].includes(String(info.fundingKind)))throw Error('r12_discovery_workspace_unavailable');}
 else if(record(raw)&&raw.ownerInitial!==undefined)throw Error('r12_discovery_workspace_unavailable');
 if(pilot){const f=raw.focusedPilot as Record<string,unknown>;if(Object.keys(f).sort().join(',')!=='acceptedReviewScopeId,closedPlanId,closedScopeId,profileHash'||typeof f.profileHash!=='string'||!/^[a-f0-9]{64}$/.test(f.profileHash)||![f.closedScopeId,f.closedPlanId,f.acceptedReviewScopeId].every(id)||[f.closedScopeId,f.acceptedReviewScopeId].includes(scopeId))throw Error('r12_discovery_workspace_unavailable');}
 else if(record(raw)&&raw.focusedPilot!==undefined)throw Error('r12_discovery_workspace_unavailable');
 if(record(raw)&&Object.hasOwn(raw,"focusedSuccessor")){if(!pilot)throw Error("r12_discovery_workspace_unavailable");validateR12FocusedSuccessor(raw.focusedSuccessor,{businessId,scopeId,goalId:String(raw.goalId),budgetAuthorityRootId:String(raw.budgetAuthorityRootId),priorRoundId:String(raw.priorRoundId),focusedPilot:raw.focusedPilot as DiscoveryR12Workspace["focusedPilot"]});}
 if(record(raw)&&Object.hasOwn(raw,'focusedUnsentClosure')){
  if(!record(raw.focusedSuccessor)||!record(raw.focusedSuccessor.authorization)||raw.focusedSuccessor.authorization.version!=='r12.focused-pilot-successor-authorization.1'||!id(raw.planId)||typeof raw.planHash!=='string')throw Error('r12_discovery_workspace_unavailable');
  validateR12FocusedUnsentClosure(raw.focusedUnsentClosure,{businessId,scopeId,goalId:String(raw.goalId),planId:raw.planId,planHash:raw.planHash,budgetAuthorityRootId:String(raw.budgetAuthorityRootId),priorRoundId:String(raw.priorRoundId),successorAuthorizationHash:String(raw.focusedSuccessor.authorizationHash)});
 }
 if(record(raw)&&Object.hasOwn(raw,'focusedPretransportClosure')){
  if(!record(raw.focusedSuccessor)||!record(raw.focusedSuccessor.authorization)||raw.focusedSuccessor.authorization.version!=='r12.focused-pilot-unsent-recovery-authorization.1'||!id(raw.planId)||typeof raw.planHash!=='string')throw Error('r12_discovery_workspace_unavailable');
  validateR12MarkedPretransportClosure(raw.focusedPretransportClosure,{businessId,scopeId,goalId:String(raw.goalId),planId:raw.planId,planHash:raw.planHash,budgetAuthorityRootId:String(raw.budgetAuthorityRootId),priorRoundId:String(raw.priorRoundId),recoveryAuthorizationHash:String(raw.focusedSuccessor.authorizationHash)});
 }
 if(record(raw)&&Object.hasOwn(raw,'continueAfter')){
  if(!date(raw.continueAfter)||raw.policyRevoked!==false||raw.paused!==false||!(raw.activeWindow===true||date(raw.receiptUntil)&&Array.isArray(raw.phases)&&raw.phases.some(phase=>record(phase)&&['dispatched','uncertain','responded'].includes(String(phase.status))&&phase.candidateSaved===true&&record(phase.receipt)&&['awaiting_receipt','checking_receipt','verified'].includes(String(phase.receipt.status))))||!['ready','running','waiting'].includes(String(raw.state))||!record(raw.focusedSuccessor)||!record(raw.focusedSuccessor.authorization)||!['r12.focused-pilot-unsent-recovery-authorization.1','r12.focused-pilot-terminal-qualification-authorization.1'].includes(String(raw.focusedSuccessor.authorization.version)))throw Error('r12_discovery_workspace_unavailable');
 }
 const expectedPhases=pilot?2:5;
 const states=['awaiting_authority','prepared','ready','running','waiting','paused','blocked','needs_owner','stopped','completed'];
 const statuses=['not_started','scheduled','reserved','dispatched','uncertain','responded','completed','rejected','failed','cancelled'];
 if(!record(raw)||raw.version!=='r12.discovery-workspace.1'||raw.businessId!==businessId||raw.scopeId!==scopeId||![raw.businessId,raw.scopeId,raw.goalId,raw.budgetAuthorityRootId].every(id)||!(record(ownerFunding)&&ownerFunding.fundingKind==='r05_business'?raw.priorRoundId===null&&raw.budgetAuthorityRootId===businessId:id(raw.priorRoundId))||typeof raw.title!=='string'||raw.title.length>400||typeof raw.approvedQuery!=='string'||raw.approvedQuery.length<20||raw.approvedQuery.length>800||!Array.isArray(raw.sourceDomains)||raw.sourceDomains.length<1||raw.sourceDomains.length>(evidence?8:4)||raw.sourceDomains.some(x=>typeof x!=='string'||!/^[a-z0-9.-]+$/.test(x))||!nullableId(raw.planId)||!(raw.planHash===null||typeof raw.planHash==='string'&&/^[a-f0-9]{64}$/.test(raw.planHash))||!states.includes(String(raw.state))||!nullableCode(raw.reason)||typeof raw.activeWindow!=='boolean'||typeof raw.policyRevoked!=='boolean'||typeof raw.paused!=='boolean'||!Array.isArray(raw.phases)||![0,expectedPhases].includes(raw.phases.length)||!record(raw.cost)||!money(raw.cost.knownMicrousd)||!money(raw.cost.heldMicrousd)||typeof raw.cost.hasUnknown!=='boolean'||!record(raw.rootFunding)||raw.activation!==null)throw Error('r12_discovery_workspace_unavailable');
 if(!nullableId(raw.nextReviewScopeId)||raw.nextReviewScopeId===scopeId||!(raw.planVersion===null||Number.isInteger(raw.planVersion)&&Number(raw.planVersion)>=1&&Number(raw.planVersion)<=(ownerEpisode?32:4))||(raw.planId===null)!==(raw.planVersion===null)||!Array.isArray(raw.priorReviews)||raw.priorReviews.length>2)throw Error('r12_discovery_workspace_unavailable');
 const priorScopes=new Set<string>(),priorAttempts=new Set<string>();let priorKnown=0;
 for(const previous of raw.priorReviews){if(!record(previous)||Object.keys(previous).sort().join(',')!=='attemptId,knownMicrousd,scopeId'||!id(previous.scopeId)||previous.scopeId===scopeId||!id(previous.attemptId)||!money(previous.knownMicrousd)||priorScopes.has(previous.scopeId)||priorAttempts.has(previous.attemptId))throw Error('r12_discovery_workspace_unavailable');priorScopes.add(previous.scopeId);priorAttempts.add(previous.attemptId);priorKnown+=Number(previous.knownMicrousd);}
 if(ownerInitial&&(raw.priorReviews.length!==0||raw.planVersion!==null&&raw.planVersion!==1||raw.nextReviewScopeId!==null||raw.focusedSuccessor!==undefined||raw.addendumHash!==undefined||raw.priorStrategy!==undefined))throw Error('r12_discovery_workspace_unavailable');
 if(pilot&&(raw.priorReviews.length!==0||raw.planVersion!==null&&raw.planVersion!==1||raw.addendumHash!==undefined||raw.priorStrategy!==undefined))throw Error('r12_discovery_workspace_unavailable');
 if(ownerEpisode&&(raw.priorReviews.length!==0||raw.nextReviewScopeId!==null||raw.focusedSuccessor!==undefined||raw.priorStrategy!==undefined))throw Error('r12_discovery_workspace_unavailable');
 if(!ownerEpisode&&raw.planVersion!==null&&raw.priorReviews.length!==Math.max(0,Number(raw.planVersion)-2))throw Error('r12_discovery_workspace_unavailable');
 if(evidence){const prior=raw.priorStrategy;if(!record(prior)||Object.keys(prior).sort().join(',')!=='attemptId,knownMicrousd,scopeId'||!id(prior.scopeId)||prior.scopeId===scopeId||!id(prior.attemptId)||!money(prior.knownMicrousd)||priorAttempts.has(prior.attemptId))throw Error('r12_discovery_workspace_unavailable');priorKnown+=Number(prior.knownMicrousd);}
 else if(raw.priorStrategy!==undefined||raw.addendumHash!==undefined)throw Error('r12_discovery_workspace_unavailable');
 const funding=raw.rootFunding;
 const units=['maximumMicrousd','knownActualMicrousd','pendingExposureMicrousd','committedMicrousd','remainingMicrousd'];
 if(funding.businessId!==businessId||funding.authorityRootId!==raw.budgetAuthorityRootId||funding.accounting!=='known_final_actual_plus_pending_reserved_exposure'||units.some(key=>typeof funding[key]!=='number'||!Number.isSafeInteger(funding[key])||Number(funding[key])<0)||Number(funding.maximumMicrousd)<1||!ownerInitial&&!ownerEpisode&&Number(funding.maximumMicrousd)>2000000||funding.committedMicrousd!==Number(funding.knownActualMicrousd)+Number(funding.pendingExposureMicrousd)||funding.remainingMicrousd!==Math.max(0,Number(funding.maximumMicrousd)-Number(funding.committedMicrousd))||typeof funding.hasUncertainCosts!=='boolean'||Number(funding.pendingExposureMicrousd)>0&&!funding.hasUncertainCosts)throw Error('r12_discovery_workspace_unavailable');
 if(raw.phases.length===0){if(raw.state!=='awaiting_authority'||raw.planId!==null||raw.planHash!==null||raw.activeWindow||raw.dispatchUntil!==null||raw.receiptUntil!==null)throw Error('r12_discovery_workspace_unavailable');}
 else if(raw.state==='awaiting_authority'){if(raw.planId!==null||raw.planHash!==null||raw.activeWindow||raw.dispatchUntil!==null||raw.receiptUntil!==null||raw.phases.some((phase,index)=>!record(phase)||phase.status!==(pilot||index>=(evidence?3:4)?'not_started':'completed')))throw Error('r12_discovery_workspace_unavailable');}
 else if(!date(raw.dispatchUntil)||!date(raw.receiptUntil)||Date.parse(raw.receiptUntil)-Date.parse(raw.dispatchUntil)!==1800000||(raw.planId===null)!==(raw.planHash===null)||raw.activeWindow&&(raw.policyRevoked||raw.paused))throw Error('r12_discovery_workspace_unavailable');
 const keys=pilot?['strategy','review']:['plan','search1','select1','strategy','review'];let known=priorKnown,held=0,unknown=false;
 for(const [index,phase] of raw.phases.entries()){
  if(!record(phase)||phase.phase!==keys[index]||!statuses.includes(String(phase.status))||!nullablePhaseReason(phase.reason)||typeof phase.candidateSaved!=='boolean'||typeof phase.unknownCost!=='boolean'||!money(phase.heldMicrousd)||!(phase.knownMicrousd===null||money(phase.knownMicrousd))||!nullableId(phase.attemptId)||!nullableId(phase.artifactId)||(phase.status==='not_started')!==(phase.attemptId===null)||!(phase.outcome===null||['TEST','REJECT','NEEDS_MORE_EVIDENCE'].includes(String(phase.outcome))))throw Error('r12_discovery_workspace_unavailable');
  if(phase.pretransportReconciled!==undefined&&typeof phase.pretransportReconciled!=='boolean')throw Error('r12_discovery_workspace_unavailable');
  if(phase.pretransportReconciled===true&&(!record(raw.focusedSuccessor)||!record(raw.focusedSuccessor.authorization)||raw.focusedSuccessor.authorization.version!=='r12.focused-pilot-unsent-recovery-authorization.1'||!raw.policyRevoked||raw.activeWindow||phase.phase!=='strategy'||phase.status!=='dispatched'||phase.candidateSaved||phase.artifactId!==null||phase.outcome!==null||phase.knownMicrousd!==null||phase.heldMicrousd!=='0'||phase.unknownCost||phase.receipt!==null||phase.responseObservation||phase.responseDiagnostic))throw Error('r12_discovery_workspace_unavailable');
  validateR12ReviewOwnerEvidence(phase.responseObservation,phase.responseDiagnostic,String(phase.phase),raw.focusedSuccessor!==undefined);
  if(phase.receipt!==null){const r=phase.receipt;if(!record(r)||!['awaiting_receipt','checking_receipt','verified','terminal','exhausted','expired','stopped'].includes(String(r.status))||!Number.isInteger(r.attempts)||Number(r.attempts)<0||Number(r.attempts)>3||!date(r.receiptExpiresAt)||!(r.nextCheckAt===null||date(r.nextCheckAt))||!phase.candidateSaved)throw Error('r12_discovery_workspace_unavailable');
   if(r.diagnostic!==null&&(!record(r.diagnostic)||!nullableCode(r.diagnostic.code)||r.diagnostic.code===null||!(r.diagnostic.httpStatus===null||Number.isInteger(r.diagnostic.httpStatus)&&Number(r.diagnostic.httpStatus)>=100&&Number(r.diagnostic.httpStatus)<=599)))throw Error('r12_discovery_workspace_unavailable');
  }
  if(phase.status==='completed'&&(!id(phase.artifactId)||!phase.candidateSaved||phase.knownMicrousd===null||!record(phase.receipt)||!['verified','stopped','expired'].includes(String(phase.receipt.status))))throw Error('r12_discovery_workspace_unavailable');
  known+=Number(phase.knownMicrousd??0);held+=Number(phase.heldMicrousd);unknown||=phase.unknownCost;
 }
 if(raw.focusedPretransportClosure!==undefined){
  const closure=raw.focusedPretransportClosure as ReturnType<typeof validateR12MarkedPretransportClosure>;
  const strategy=raw.phases[0],review=raw.phases[1];
  if(!raw.policyRevoked||raw.activeWindow||!record(strategy)||!record(review)||strategy.phase!=='strategy'||strategy.attemptId!==closure.attemptId||strategy.status!=='dispatched'||strategy.pretransportReconciled!==true||strategy.candidateSaved||strategy.artifactId!==null||strategy.outcome!==null||strategy.knownMicrousd!==null||strategy.heldMicrousd!=='0'||strategy.unknownCost||strategy.receipt!==null||strategy.responseObservation||strategy.responseDiagnostic||review.status!=='not_started'||review.attemptId!==null||held!==0||unknown)throw Error('r12_discovery_workspace_unavailable');
 }
 if(known!==Number(raw.cost.knownMicrousd)||held!==Number(raw.cost.heldMicrousd)||unknown!==raw.cost.hasUnknown||raw.state==='completed'&&(raw.phases.length!==expectedPhases||raw.phases.some(p=>!record(p)||p.status!=='completed')))throw Error('r12_discovery_workspace_unavailable');
 return structuredClone(raw) as DiscoveryR12Workspace;
}
/** Read-only owner projection. This never fetches prices, providers or receipts. */
export async function readDiscoveryR12Workspace(context:OwnerUiContext,businessId:string,scopeId:string):Promise<{available:boolean;record:DiscoveryR12Workspace|null}>{
 if(!id(businessId)||!id(scopeId)||!await verifyOwnerBusiness(context,businessId))return{available:false,record:null};
 const {data,error}=await context.supabase.rpc('r12_discovery_owner_read',{p_business_id:businessId,p_scope_id:scopeId,p_activation:false});
 if(error)return{available:false,record:null};if(data===null)return{available:true,record:null};
 try{return{available:true,record:parseDiscoveryR12Workspace(data,businessId,scopeId)};}catch{return{available:false,record:null};}
}
/** A valid negative remains a completed accepted strategy, never a synthetic
 * failed response. Its terminal meaning is separate from receipt settlement. */
export function discoveryR12SuccessorStopReason(record:DiscoveryR12Workspace):string|null{
 if(!record.focusedSuccessor)return null;
 const strategy=record.phases.find(phase=>phase.phase==='strategy');
 if(strategy?.status==='completed'&&strategy.outcome==='NEEDS_MORE_EVIDENCE')return 'The strategy needs more evidence. The approved successor stops before independent review.';
 if(strategy?.status==='completed'&&strategy.outcome==='REJECT')return 'The strategy rejected this proposal. The approved successor stops before independent review.';
 if(strategy&&(strategy.responseDiagnostic||['rejected','failed','cancelled'].includes(strategy.status)))return 'The strategy was invalid, inconsistent or unsuccessful. The approved successor stops before independent review.';
 return null;
}
export function discoveryR12CanContinue(record:DiscoveryR12Workspace,now=Date.now()):boolean{
 if(discoveryR12SuccessorStopReason(record))return false;
 if(record.focusedSuccessor&&record.phases.some(phase=>phase.phase==='strategy'&&phase.status==='completed'&&phase.outcome!=='TEST'))return false;
 if(record.policyRevoked||record.paused||record.state==='stopped'||record.state==='completed')return false;
 if(record.continueAfter&&Date.parse(record.continueAfter)>now)return false;
 if(record.phases.some(phase=>phase.responseDiagnostic&&phase.status!=='completed'))return false;
 const pending=record.phases.find(p=>p.receipt&&p.status!=='completed');
 if(pending?.receipt){const receipt=pending.receipt;return ['awaiting_receipt','checking_receipt','verified'].includes(receipt.status)&&Date.parse(receipt.receiptExpiresAt)>now&&(receipt.nextCheckAt===null||Date.parse(receipt.nextCheckAt)<=now);}
 const current=record.phases.find(p=>p.status!=='completed');
 if(current&&['dispatched','uncertain'].includes(current.status)&&!current.candidateSaved)return false;
 return record.activeWindow&&record.dispatchUntil!==null&&Date.parse(record.dispatchUntil)>now;
}

/** Private candidate joins remain server-side; only validated history reaches UI. */
export async function readDiscoveryR12Result(context:OwnerUiContext,businessId:string,scopeId:string):Promise<{available:boolean;record:DiscoveryR12Result|null}>{
 if(!id(businessId)||!id(scopeId)||!await verifyOwnerBusiness(context,businessId))return{available:false,record:null};
 const {data,error}=await context.supabase.rpc('r12_discovery_result_read',{p_business_id:businessId,p_scope_id:scopeId});
 if(error)return{available:false,record:null};if(data===null)return{available:true,record:null};
 try{if(!record(data))throw Error('invalid');return{available:true,record:reconstructDiscoveryR12Result(data,businessId,scopeId)};}catch{return{available:false,record:null};}
}
