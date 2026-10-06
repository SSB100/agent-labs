import 'server-only';
import {createHash} from 'node:crypto';
import type {OwnerUiContext} from '../lib/core-ui/data';
import {verifyOwnerBusiness} from '../lib/core-ui/owner-business';
import {R04_RPC,type R04Read,type R04Operation,type R04Payloads,type R04Result} from '../core/quest-contract';
import {discoveryV2Hash} from './discovery-v2';
import {prepareDiscoveryR12Authority} from './discovery-r12-server';
import {R12_ORIGINAL_OBJECTIVE,r12PreparationGoalContent,validateR12Preparation,validateR12PreparationIdentity,type R12PreparationInput,type R12PreparationReceipt} from './discovery-r12-preparation-contract';
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const fail=():never=>{throw Error('r12_preparation_unavailable');};
/** Opaque request identities, never credentials or execution grants. */
function identity(ownerId:string,businessId:string,lineage:string,role:string){const h=createHash('sha256').update(JSON.stringify(['r12.owner-preparation.1',ownerId,businessId,lineage,role])).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;}
async function owned(context:OwnerUiContext,input:R12PreparationInput,mutating=true){
 if(mutating)validateR12Preparation(input);else validateR12PreparationIdentity(input);if(!id(context.userId)||!await verifyOwnerBusiness(context,input.businessId))return fail();
 const claims=await context.supabase.auth.getClaims();if(claims.error||claims.data?.claims?.sub!==context.userId)return fail();
}
async function lineage(context:OwnerUiContext,input:R12PreparationInput){
 const {data,error}=await context.supabase.rpc(R04_RPC.research,{p_business_id:input.businessId,p_experiment_id:input.priorRoundId});
 if(error||!object(data)||data.status!=='linkable'||data.businessId!==input.businessId||!id(data.authorityRootId)||!object(data.evidence)||data.evidence.originalObjective!==R12_ORIGINAL_OBJECTIVE||data.evidence.budgetUnchanged!==true||data.evidence.rootId!==input.priorRoundId||!(data.goalId===null||id(data.goalId)))return fail();
 const prior=await context.supabase.from('product_experiments').select('id,business_id,discovery_version,parent_discovery_id,candidate_id,status,variables').eq('business_id',input.businessId).eq('id',input.priorRoundId).maybeSingle();
 if(prior.error||!prior.data||prior.data.discovery_version!=='pod-discovery-2.0'||prior.data.parent_discovery_id!==null||prior.data.candidate_id!==null||!['failed','completed'].includes(prior.data.status)||!object(prior.data.variables)||prior.data.variables.budgetAuthorityRootId!==data.authorityRootId||!object(prior.data.variables.intent))return fail();
 const intent=prior.data.variables.intent;
 if(intent.objective!==R12_ORIGINAL_OBJECTIVE||!object(intent.limits)||intent.limits.maximumMicrousd!==2000000||!object(intent.comparisonUniverse)||!Array.isArray(intent.comparisonUniverse.markets)||intent.comparisonUniverse.markets.map(m=>object(m)?m.countryCode:null).sort().join(',')!=='AU,GB,NZ,US')return fail();
 return {rootId:data.authorityRootId,goalId:data.goalId as string|null};
}
async function exactGoal(context:OwnerUiContext,input:R12PreparationInput,goalId:string){
 const {data,error}=await context.supabase.rpc(R04_RPC.read,{p_business_id:input.businessId,p_goal_id:goalId,p_limit:1,p_offset:0});
 if(error||!object(data)||data.businessId!==input.businessId)return fail();const row=(data as R04Read).selected;
 if(!row||row.id!==goalId||row.businessId!==input.businessId||row.revision!==2||row.preference!=='ready'||!/^[a-f0-9]{64}$/.test(row.hash)||discoveryV2Hash(row.content)!==discoveryV2Hash(r12PreparationGoalContent(input.sourceCutoff)))return fail();return row;
}
async function receipt(context:OwnerUiContext,input:R12PreparationInput,goalId:string,hashes:Awaited<ReturnType<typeof prepareDiscoveryR12Authority>>):Promise<R12PreparationReceipt>{
 const goal=await exactGoal(context,input,goalId),after=await lineage(context,input);if(after.goalId!==goal.id)return fail();
 return {...input,ownerId:context.userId,scopeId:input.preparationId,priorId:input.priorRoundId,rootId:after.rootId,goalId:goal.id,goalRevision:2,goalHash:goal.hash,installationId:identity(context.userId,input.businessId,input.preparationId,'installation'),...hashes};
}
/** Readback exposes only the already linked exact Goal and nonsecret hashes. */
export async function readR12Preparation(context:OwnerUiContext,input:R12PreparationInput):Promise<R12PreparationReceipt|null>{
 await owned(context,input,false);const before=await lineage(context,input);if(!before.goalId)return null;
 await exactGoal(context,input,before.goalId);return receipt(context,input,before.goalId,await prepareDiscoveryR12Authority(context,input.businessId,input.preparationId));
}
/** Genuine owner RPCs persist intent/link only. No operator or provider access. */
export async function prepareR12OwnerSetup(context:OwnerUiContext,input:R12PreparationInput):Promise<R12PreparationReceipt>{
 await owned(context,input);const before=await lineage(context,input);
 const hashes=await prepareDiscoveryR12Authority(context,input.businessId,input.preparationId);
 if(before.goalId)return receipt(context,input,before.goalId,hashes);
 async function save<O extends R04Operation>(operation:O,payload:R04Payloads[O],submissionId:string){const {data,error}=await context.supabase.rpc(R04_RPC.transition,{p_business_id:input.businessId,p_operation:operation,p_payload:payload,p_submission_id:submissionId});if(error||!object(data)||data.operation!==operation||!id(data.id))return fail();return data as R04Result;}
 // One save identity for this original authority root across tabs and prior rounds. A different cutoff
 // conflicts with the persisted request instead of creating a second Goal.
 const created=await save('quest.save',{goalId:null,expectedRevision:0,content:r12PreparationGoalContent(input.sourceCutoff)},identity(context.userId,input.businessId,before.rootId,'save-original-goal'));
 if(created.revision!==1)return fail();
 const ready=await save('quest.preference',{goalId:created.id,expectedRevision:1,preference:'ready'},identity(context.userId,input.businessId,created.id,'ready-v1'));
 if(ready.id!==created.id||ready.revision!==2)return fail();
 await save('research.link',{goalId:created.id,expectedRevision:2,experimentId:input.priorRoundId},identity(context.userId,input.businessId,created.id,'link-v2'));
 return receipt(context,input,created.id,hashes);
}
