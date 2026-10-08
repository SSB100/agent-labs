import 'server-only';
import {createHash} from 'node:crypto';
import type {OwnerUiContext} from '../lib/core-ui/data';
import {verifyOwnerBusiness} from '../lib/core-ui/owner-business';
import {R04_RPC,type R04Read,type R04Operation,type R04Payloads} from '../core/quest-contract';
import {discoveryV2Hash} from './discovery-v2';
import {readDiscoveryR12Workspace,readDiscoveryR12Result} from './discovery-r12-owner';
import {prepareDiscoveryR12Authority} from './discovery-r12-server';
import {r12PilotGoalContent,validateR12PilotPreparation,type R12PilotPreparationInput,type R12PilotPreparationReceipt} from './discovery-r12-pilot-preparation-contract';
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const fail=():never=>{throw Error('r12_pilot_preparation_unavailable');};
function identity(owner:string,business:string,closedPlan:string,role:string){const h=createHash('sha256').update(JSON.stringify(['r12.pilot-preparation.1',owner,business,closedPlan,role])).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;}
/** Authenticated history checks perform no quote lookup, receipt lookup or paid call. */
export async function readR12PilotPreparationSource(context:OwnerUiContext,input:R12PilotPreparationInput){
 validateR12PilotPreparation(input);if(!id(context.userId)||!await verifyOwnerBusiness(context,input.businessId))return fail();
 const claims=await context.supabase.auth.getClaims();if(claims.error||claims.data?.claims?.sub!==context.userId)return fail();
 const {record:source}=await readDiscoveryR12Workspace(context,input.businessId,input.sourceScopeId);
 const settled=(row:typeof source)=>row&&row.planId&&row.planHash&&row.policyRevoked&&!row.activeWindow&&!row.cost.hasUnknown&&row.cost.heldMicrousd==='0'&&row.rootFunding.hasUncertainCosts===false&&row.rootFunding.pendingExposureMicrousd===0&&row.nextReviewScopeId===null;
 if(!settled(source)||!source)return fail();
 let broad=source;const recovery=source.focusedSuccessor?.authorization.version==='r12.focused-pilot-successor-authorization.1',technical=source.focusedSuccessor?.authorization.version==='r12.focused-pilot-unsent-recovery-authorization.1';let charged=source;
 // A terminal qualification is never an eligible source for another Goal.
 if(source.focusedSuccessor&&!recovery&&!technical)return fail();
 if(source.focusedPilot){
  // The raw controller head can still be running/dispatched after explicit
  // authority closure. Prove final costs and the rejected review, not a fake head.
  if(source.planVersion!==1||source.phases.length!==2||source.priorReviews.length!==0)return fail();
  if(recovery||technical){
   const closure=technical?source.focusedPretransportClosure:source.focusedUnsentClosure;
   if(!source.focusedSuccessor||!closure||closure.planId!==source.planId||closure.planHash!==source.planHash)return fail();
   const old=await readDiscoveryR12Workspace(context,input.businessId,source.focusedSuccessor.authorization.predecessorClosure.scopeId);
   if(!old.record||!settled(old.record)||!old.record.focusedPilot||old.record.focusedSuccessor||old.record.planId!==source.focusedSuccessor.authorization.predecessorClosure.planId||old.record.budgetAuthorityRootId!==source.budgetAuthorityRootId||old.record.priorRoundId!==source.priorRoundId)return fail();
   charged=old.record;
  }
  const [strategy,review]=charged.phases;
  if(strategy.phase!=='strategy'||strategy.status!=='completed'||strategy.outcome!=='TEST'||!strategy.artifactId||
     review.phase!=='review'||review.artifactId!==null||review.outcome!==null||review.responseDiagnostic?.code!=='domain_validation'||
     review.responseDiagnostic.observationSaved!==true||!review.responseObservation||
     charged.phases.some(phase=>!phase.candidateSaved||phase.knownMicrousd===null||phase.heldMicrousd!=='0'||phase.unknownCost||!phase.receipt||!['verified','stopped','expired'].includes(phase.receipt.status)))return fail();
  const found=await readDiscoveryR12Workspace(context,input.businessId,charged.focusedPilot!.closedScopeId);
  if(!found.record||!settled(found.record)||found.record.focusedPilot||found.record.planVersion!==4||found.record.planId!==charged.focusedPilot!.closedPlanId||
     found.record.budgetAuthorityRootId!==source.budgetAuthorityRootId||found.record.priorRoundId!==source.priorRoundId||found.record.goalId===source.goalId)return fail();
  broad=found.record;
 }else if(source.planVersion!==4)return fail();
 const prior=broad.priorReviews.at(-1);if(!prior||source.focusedPilot&&prior.scopeId!==source.focusedPilot.acceptedReviewScopeId)return fail();
 const {record:accepted}=await readDiscoveryR12Result(context,input.businessId,prior.scopeId);
 if(!accepted||accepted.review.outcome!=='NEEDS_MORE_EVIDENCE'||accepted.goalId!==broad.goalId||accepted.originalFundingRootId!==source.budgetAuthorityRootId)return fail();
 return {source,accepted,broad,successor:!!source.focusedPilot,recovery,technical};
}

/** Uses the normal owner Goal actions. A deterministic save identity is tied to
 * the stopped plan, so another tab/cutoff cannot silently create a second pilot.
 * SQL later independently checks the closed lineage and unique pilot scope. */
export async function prepareR12PilotGoal(context:OwnerUiContext,input:R12PilotPreparationInput):Promise<R12PilotPreparationReceipt>{
 validateR12PilotPreparation(input,Date.now());const {source,accepted,broad,successor,recovery,technical}=await readR12PilotPreparationSource(context,input),content=r12PilotGoalContent(input,successor,recovery,technical);
 const hashes=await prepareDiscoveryR12Authority(context,input.businessId,input.preparationId);
 async function save<O extends R04Operation>(operation:O,payload:R04Payloads[O],role:string){
  const {data,error}=await context.supabase.rpc(R04_RPC.transition,{p_business_id:input.businessId,p_operation:operation,p_payload:payload,p_submission_id:identity(context.userId,input.businessId,source.planId!,role)});
  if(error||!object(data)||data.operation!==operation||!id(data.id))return fail();return data;
 }
 const created=await save('quest.save',{goalId:null,expectedRevision:0,content},'save');if(created.revision!==1||[source.goalId,broad.goalId].includes(created.id as string))return fail();
 const ready=await save('quest.preference',{goalId:created.id as string,expectedRevision:1,preference:'ready'},'ready');if(ready.id!==created.id||ready.revision!==2)return fail();
 const {data,error}=await context.supabase.rpc(R04_RPC.read,{p_business_id:input.businessId,p_goal_id:created.id,p_limit:1,p_offset:0});
 const row=object(data)?(data as R04Read).selected:null;
 if(error||!row||row.id!==created.id||row.businessId!==input.businessId||row.revision!==2||row.preference!=='ready'||discoveryV2Hash(row.content)!==discoveryV2Hash(content))return fail();
 return {...input,ownerId:context.userId,goalId:row.id,goalRevision:row.revision,goalHash:row.hash,originalGoalId:broad.goalId,
  ...(recovery?{unsentClosureHash:discoveryV2Hash(source.focusedUnsentClosure)}:{}),
  ...(technical?{pretransportClosureHash:discoveryV2Hash(source.focusedPretransportClosure)}:{}),
  ...(successor?{predecessorGoalId:source.goalId,originalClosedPlanId:broad.planId!,originalClosedPlanHash:broad.planHash!}:{}),
  closedPlanId:source.planId!,closedPlanHash:source.planHash!,acceptedReviewScopeId:accepted.scopeId,acceptedReviewHash:discoveryV2Hash(accepted.review),
  rootId:source.budgetAuthorityRootId,priorId:source.priorRoundId,installationId:identity(context.userId,input.businessId,source.planId!,'installation'),...hashes};
}
