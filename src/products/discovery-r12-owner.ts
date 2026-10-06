import "server-only";
import type { OwnerUiContext } from "../lib/core-ui/data";
import { verifyOwnerBusiness } from "../lib/core-ui/owner-business";
import { reconstructDiscoveryR12Result, type DiscoveryR12Result } from "./discovery-r12-runtime";
import type { DiscoveryR12Phase } from "./discovery-r12-wire";
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const money=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,15})$/.test(v)&&Number.isSafeInteger(Number(v));
const id=(v:unknown):v is string=>typeof v==='string'&&UUID.test(v);
export type DiscoveryR12Workspace={version:'r12.discovery-workspace.1';businessId:string;scopeId:string;goalId:string;title:string;approvedQuery:string;sourceDomains:string[];priorRoundId:string;budgetAuthorityRootId:string;planId:string|null;planHash:string|null;state:string;reason:string|null;policyRevoked:boolean;paused:boolean;activeWindow:boolean;dispatchUntil:string|null;receiptUntil:string|null;phases:Array<{phase:DiscoveryR12Phase;status:string;reason:string|null;attemptId:string|null;artifactId:string|null;candidateSaved:boolean;receipt:null|{status:string;attempts:number;nextCheckAt:string|null;receiptExpiresAt:string;diagnostic:null|{code:string;httpStatus:number|null}};knownMicrousd:string|null;heldMicrousd:string;unknownCost:boolean;outcome:string|null}>;cost:{knownMicrousd:string;heldMicrousd:string;hasUnknown:boolean};rootFunding:Record<string,unknown>;activation:null};
export function parseDiscoveryR12Workspace(raw:unknown,businessId:string,scopeId:string):DiscoveryR12Workspace{
 const date=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v));
 const nullableId=(v:unknown)=>v===null||id(v), nullableCode=(v:unknown)=>v===null||typeof v==='string'&&/^[a-z][a-z0-9_]{0,100}$/.test(v);
 const nullablePhaseReason=(v:unknown)=>v===null||typeof v==='string'&&v.trim().length>0&&v.length<=240;
 const states=['awaiting_authority','prepared','ready','running','waiting','paused','blocked','needs_owner','stopped','completed'];
 const statuses=['not_started','scheduled','reserved','dispatched','uncertain','responded','completed','rejected','failed','cancelled'];
 if(!record(raw)||raw.version!=='r12.discovery-workspace.1'||raw.businessId!==businessId||raw.scopeId!==scopeId||![raw.businessId,raw.scopeId,raw.goalId,raw.priorRoundId,raw.budgetAuthorityRootId].every(id)||typeof raw.title!=='string'||raw.title.length>400||typeof raw.approvedQuery!=='string'||raw.approvedQuery.length<20||raw.approvedQuery.length>800||!Array.isArray(raw.sourceDomains)||raw.sourceDomains.length<1||raw.sourceDomains.length>4||raw.sourceDomains.some(x=>typeof x!=='string'||!/^[a-z0-9.-]+$/.test(x))||!nullableId(raw.planId)||!(raw.planHash===null||typeof raw.planHash==='string'&&/^[a-f0-9]{64}$/.test(raw.planHash))||!states.includes(String(raw.state))||!nullableCode(raw.reason)||typeof raw.activeWindow!=='boolean'||typeof raw.policyRevoked!=='boolean'||typeof raw.paused!=='boolean'||!Array.isArray(raw.phases)||![0,5].includes(raw.phases.length)||!record(raw.cost)||!money(raw.cost.knownMicrousd)||!money(raw.cost.heldMicrousd)||typeof raw.cost.hasUnknown!=='boolean'||!record(raw.rootFunding)||raw.activation!==null)throw Error('r12_discovery_workspace_unavailable');
 const funding=raw.rootFunding;
 const units=['maximumMicrousd','knownActualMicrousd','pendingExposureMicrousd','committedMicrousd','remainingMicrousd'];
 if(funding.businessId!==businessId||funding.authorityRootId!==raw.budgetAuthorityRootId||funding.accounting!=='known_final_actual_plus_pending_reserved_exposure'||units.some(key=>typeof funding[key]!=='number'||!Number.isSafeInteger(funding[key])||Number(funding[key])<0)||Number(funding.maximumMicrousd)<1||Number(funding.maximumMicrousd)>2000000||funding.committedMicrousd!==Number(funding.knownActualMicrousd)+Number(funding.pendingExposureMicrousd)||funding.remainingMicrousd!==Math.max(0,Number(funding.maximumMicrousd)-Number(funding.committedMicrousd))||typeof funding.hasUncertainCosts!=='boolean'||Number(funding.pendingExposureMicrousd)>0&&!funding.hasUncertainCosts)throw Error('r12_discovery_workspace_unavailable');
 if(raw.phases.length===0){if(raw.state!=='awaiting_authority'||raw.planId!==null||raw.planHash!==null||raw.activeWindow||raw.dispatchUntil!==null||raw.receiptUntil!==null)throw Error('r12_discovery_workspace_unavailable');}
 else if(raw.state==='awaiting_authority'){if(raw.planId!==null||raw.planHash!==null||raw.activeWindow||raw.dispatchUntil!==null||raw.receiptUntil!==null||raw.phases.some((phase,index)=>!record(phase)||phase.status!==(index===4?'not_started':'completed')))throw Error('r12_discovery_workspace_unavailable');}
 else if(!date(raw.dispatchUntil)||!date(raw.receiptUntil)||Date.parse(raw.receiptUntil)-Date.parse(raw.dispatchUntil)!==1800000||(raw.planId===null)!==(raw.planHash===null)||raw.activeWindow&&(raw.policyRevoked||raw.paused))throw Error('r12_discovery_workspace_unavailable');
 const keys=['plan','search1','select1','strategy','review'];let known=0,held=0,unknown=false;
 for(const [index,phase] of raw.phases.entries()){
  if(!record(phase)||phase.phase!==keys[index]||!statuses.includes(String(phase.status))||!nullablePhaseReason(phase.reason)||typeof phase.candidateSaved!=='boolean'||typeof phase.unknownCost!=='boolean'||!money(phase.heldMicrousd)||!(phase.knownMicrousd===null||money(phase.knownMicrousd))||!nullableId(phase.attemptId)||!nullableId(phase.artifactId)||(phase.status==='not_started')!==(phase.attemptId===null)||!(phase.outcome===null||['TEST','REJECT','NEEDS_MORE_EVIDENCE'].includes(String(phase.outcome))))throw Error('r12_discovery_workspace_unavailable');
  if(phase.receipt!==null){const r=phase.receipt;if(!record(r)||!['awaiting_receipt','checking_receipt','verified','terminal','exhausted','expired','stopped'].includes(String(r.status))||!Number.isInteger(r.attempts)||Number(r.attempts)<0||Number(r.attempts)>3||!date(r.receiptExpiresAt)||!(r.nextCheckAt===null||date(r.nextCheckAt))||!phase.candidateSaved)throw Error('r12_discovery_workspace_unavailable');
   if(r.diagnostic!==null&&(!record(r.diagnostic)||!nullableCode(r.diagnostic.code)||r.diagnostic.code===null||!(r.diagnostic.httpStatus===null||Number.isInteger(r.diagnostic.httpStatus)&&Number(r.diagnostic.httpStatus)>=100&&Number(r.diagnostic.httpStatus)<=599)))throw Error('r12_discovery_workspace_unavailable');
  }
  if(phase.status==='completed'&&(!id(phase.artifactId)||!phase.candidateSaved||phase.knownMicrousd===null||!record(phase.receipt)||!['verified','stopped','expired'].includes(String(phase.receipt.status))))throw Error('r12_discovery_workspace_unavailable');
  known+=Number(phase.knownMicrousd??0);held+=Number(phase.heldMicrousd);unknown||=phase.unknownCost;
 }
 if(known!==Number(raw.cost.knownMicrousd)||held!==Number(raw.cost.heldMicrousd)||unknown!==raw.cost.hasUnknown||raw.state==='completed'&&(raw.phases.length!==5||raw.phases.some(p=>!record(p)||p.status!=='completed')))throw Error('r12_discovery_workspace_unavailable');
 return structuredClone(raw) as DiscoveryR12Workspace;
}
/** Read-only owner projection. This never fetches prices, providers or receipts. */
export async function readDiscoveryR12Workspace(context:OwnerUiContext,businessId:string,scopeId:string):Promise<{available:boolean;record:DiscoveryR12Workspace|null}>{
 if(!id(businessId)||!id(scopeId)||!await verifyOwnerBusiness(context,businessId))return{available:false,record:null};
 const {data,error}=await context.supabase.rpc('r12_discovery_owner_read',{p_business_id:businessId,p_scope_id:scopeId,p_activation:false});
 if(error)return{available:false,record:null};if(data===null)return{available:true,record:null};
 try{return{available:true,record:parseDiscoveryR12Workspace(data,businessId,scopeId)};}catch{return{available:false,record:null};}
}
export function discoveryR12CanContinue(record:DiscoveryR12Workspace,now=Date.now()):boolean{
 if(record.policyRevoked||record.paused||record.state==='stopped'||record.state==='completed')return false;
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
