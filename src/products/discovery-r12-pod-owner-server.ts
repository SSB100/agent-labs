import "server-only";
import {podApplicationCapability} from "./discovery-r12-pod-server-key";
import {createHash} from "node:crypto";
import type {OwnerUiContext} from "../lib/core-ui/data";
import {verifyOwnerBusiness} from "../lib/core-ui/owner-business";
import {boundedRpc,requestDeadline} from "../core/request-deadline";
import {R04_RPC} from "../core/quest-contract";
import {discoveryR12ServerDependencies} from "./discovery-r12-server-dependencies";
import {prepareDiscoveryR12Authority} from "./discovery-r12-server";
import {validatePodResearchPublicBrief} from "./discovery-r12-pod-goal";
import {discoveryV2Hash} from "./discovery-v2";
import {buildPodPlannerRequest,readPodResearchPhaseInputs,reconstructPodResearchResult,inspectPodFailedReview} from "./discovery-r12-pod-runtime";
import {inspectDiscoveryR12Wire,routeDiscoveryR12Request} from "./discovery-r12-wire";
import {podFail,podId,podMoney,podObject,parsePodCatalog,parsePodReceipt,type PodResearchEntry,type PodResearchSetupAction} from "./discovery-r12-pod-owner-contract";
import type {QuestAdapterContext} from "../core/quest-controller";
import type {DiscoveryR12CompletedPhase} from "./discovery-r12-runtime";
async function owned(c:OwnerUiContext,b:string){if(!podId(b)||!await verifyOwnerBusiness(c,b))podFail();const a=await c.supabase.auth.getClaims();if(a.error||a.data?.claims?.sub!==c.userId)podFail();}
function submission(root:string,phase:string){const h=createHash("sha256").update(`${root}:${phase}`).digest("hex");return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;}
async function rpc(c:OwnerUiContext,name:string,args:Record<string,unknown>){const r=await boundedRpc(c.supabase.rpc(name,args),requestDeadline(30000),20000);if(r.error)throw Error(r.error.message);if(!podObject(r.data))podFail();return r.data;}
export async function readPodResearch(c:OwnerUiContext,businessId:string,setupId:string|null=null,submissionId:string|null=null){await owned(c,businessId);if(setupId!==null&&!podId(setupId))podFail();return parsePodCatalog(await rpc(c,"r12_pod_research_read",{p_business_id:businessId,p_goal_id:null,p_setup_id:setupId,p_submission_id:submissionId}),businessId);}
export async function preparePodResearch(c:OwnerUiContext,entry:PodResearchEntry){
 await owned(c,entry.businessId);const brief=validatePodResearchPublicBrief(entry.publicBrief),deadline=Date.parse(entry.deadlineAt);
 if(!podId(entry.submissionId)||!podMoney(entry.maximumMicrounits)||Number(entry.maximumMicrounits)<=0||Number(entry.maximumMicrounits)>10000000||!Number.isFinite(deadline))podFail();
 const recovered=await readPodResearch(c,entry.businessId,null,entry.submissionId);
 const existing=recovered.setups.find(r=>r.submissionId===entry.submissionId);
 if(existing){if(discoveryV2Hash(existing.preview.publicBrief)!==discoveryV2Hash(brief)||existing.preview.finance.runLimitMicrounits!==entry.maximumMicrounits)podFail();return existing;}
 if(deadline<Date.now()+35*60000||deadline>Date.now()+90*60000)throw Error("r12_pod_review_window_expired");
 const catalog=recovered;if(!catalog.business?.ready)throw Error("r12_pod_business_not_ready");if(!catalog.template)throw Error("r12_pod_template_unavailable");if(catalog.finance.hasBlockingUnknown)throw Error("r12_pod_unresolved_liability");
 const quote=await discoveryR12ServerDependencies().quote({podResearch:true});if(quote.maximumMicrousd>Number(entry.maximumMicrounits))throw Error(`r12_pod_quote_exceeds_budget:${quote.maximumMicrousd}`);
 // R04 saves research intent without inventing a revenue/units target or country.
 const iso=new Date(deadline).toISOString();
 const content={title:brief.objective.slice(0,200),originalIntent:brief.objective,objective:brief.objective,parsed:{researchMode:"r12.pod-research-intent.1",target:null,budget:{amount:(Number(entry.maximumMicrounits)/1000000).toFixed(6),currency:"USD"},deadline:{date:iso.slice(0,10),time:iso.slice(11,19),timezone:"UTC"},geography:[],scope:"Public print-on-demand product research for Etsy; recommendations only.",stopConstraints:["Stop on owner request or permission expiry","Stop on unbounded liability, exhausted budget or unavailable permitted evidence","No listing, purchase, account access or commerce"]},ambiguities:[]};
 const goal=await rpc(c,R04_RPC.transition,{p_business_id:entry.businessId,p_operation:"quest.save",p_payload:{goalId:null,expectedRevision:0,content},p_submission_id:submission(entry.submissionId,"goal")});if(!podId(goal.id))podFail();
 const ready=await rpc(c,R04_RPC.transition,{p_business_id:entry.businessId,p_operation:"quest.preference",p_payload:{goalId:goal.id,expectedRevision:1,preference:"ready"},p_submission_id:submission(entry.submissionId,"ready")});
 const maximum=Math.max(Number(catalog.finance.maximumMicrounits),Number(catalog.finance.committedMicrounits)+Number(entry.maximumMicrounits)).toString();
 const input={businessId:entry.businessId,goalId:goal.id,goalRevision:ready.revision,templateId:catalog.template.id,templateHash:catalog.template.hash,publicBrief:brief,maximumMicrounits:entry.maximumMicrounits,businessLifetimeLimitMicrounits:maximum,submissionId:entry.submissionId};
 return parsePodReceipt(await rpc(c,"r12_pod_owner_server",{p_business_id:entry.businessId,p_operation:"prepare",p_payload:{input,quote},p_server_key:podApplicationCapability()}),entry.businessId);
}
export async function confirmPodResearch(c:OwnerUiContext,input:PodResearchSetupAction){
 await owned(c,input.businessId);if(!podId(input.setupId)||!podId(input.submissionId))podFail();
 const catalog=await readPodResearch(c,input.businessId,input.setupId),saved=catalog.setups.find(r=>r.setupId===input.setupId&&r.setupHash===input.setupHash);if(!saved||saved.stopped)podFail();
 if(saved.activated)return saved;
 const recovery=saved.preview.recovery?await inspectPodRecovery(c,input.businessId,saved.preview.recovery.proof.predecessorSetupId):null;
 if(recovery&&(recovery.proofHash!==saved.preview.recovery!.proofHash||recovery.classificationHash!==saved.preview.recovery!.classificationHash))podFail();
 const quote=await discoveryR12ServerDependencies().quote({podResearch:true});
 const raw=buildPodPlannerRequest(saved.setupHash,saved.preview.sourcePolicyHash,saved.preview.publicBrief,saved.preview.sourcePolicy.excludedDomains,recovery?.history??null);
 const request=routeDiscoveryR12Request(raw,"plan",quote.luna,false,false,true),wire=await inspectDiscoveryR12Wire(request,"plan",false,false,false,true);
 const hashes=await prepareDiscoveryR12Authority(c,input.businessId,saved.scopeId);
 return parsePodReceipt(await rpc(c,saved.preview.recovery?"r12_pod_recovery_owner_server":"r12_pod_owner_server",{p_business_id:input.businessId,p_operation:"confirm",p_payload:{setupId:input.setupId,setupHash:input.setupHash,submissionId:input.submissionId,controllerKeyHash:hashes.controllerKeyHash,admissionKeyHash:hashes.admissionKeyHash,quote,preflight:{setupHash:saved.setupHash,sourcePolicyHash:saved.preview.sourcePolicyHash,requestHash:wire.requestHash,wireHash:wire.wireHash,wireBytes:wire.wireBytes}},p_server_key:podApplicationCapability()}),input.businessId,input.setupId);
}
export async function stopPodResearch(c:OwnerUiContext,input:PodResearchSetupAction){await owned(c,input.businessId);return parsePodReceipt(await rpc(c,"r12_pod_owner_server",{p_business_id:input.businessId,p_operation:"stop",p_payload:{setupId:input.setupId,setupHash:input.setupHash,submissionId:input.submissionId},p_server_key:""}),input.businessId,input.setupId);}
export async function readPodResearchResult(c:OwnerUiContext,businessId:string,scopeId:string){
 await owned(c,businessId);if(!podId(scopeId))podFail();const r=await c.supabase.rpc("r12_discovery_result_read",{p_business_id:businessId,p_scope_id:scopeId});if(r.error)throw Error(r.error.message);if(r.data===null)return null;
 const v=r.data;if(!podObject(v)||v.version!=="r12.pod-saved-result.2"||!podObject(v.context)||!podObject(v.inputs)||!podObject(v.current))podFail();
 const ctx=v.context as unknown as QuestAdapterContext;if(ctx.plan.businessId!==businessId||ctx.plan.discoveryScopeId!==scopeId)podFail();
 const result=reconstructPodResearchResult(ctx,readPodResearchPhaseInputs(ctx,v.inputs as Record<string,unknown>),v.current as unknown as DiscoveryR12CompletedPhase);
 if(result.businessId!==businessId||result.scopeId!==scopeId)podFail();return result;
}

async function inspectPodRecovery(c:OwnerUiContext,businessId:string,setupId:string){
 const raw=await rpc(c,"r12_pod_recovery_read",{p_business_id:businessId,p_setup_id:setupId});
 if(!podObject(raw.proof)||raw.proof.businessId!==businessId||raw.proof.predecessorSetupId!==setupId||raw.proofHash!==discoveryV2Hash(raw.proof)||
 !podObject(raw.history)||raw.historyHash!==discoveryV2Hash(raw.history)||raw.proof.historyHash!==raw.historyHash||!podObject(raw.context)||!podObject(raw.inputs)||!podObject(raw.observation)||typeof raw.observation.content!=="string")podFail();
 const ctx=raw.context as unknown as QuestAdapterContext;if(ctx.plan.businessId!==businessId||ctx.planId!==raw.proof.predecessorPlanId||ctx.attempt.id!==raw.proof.failedAttemptId)podFail();
 const classification=inspectPodFailedReview(ctx,readPodResearchPhaseInputs(ctx,raw.inputs),JSON.parse(raw.observation.content));
 if(raw.classificationHash!==discoveryV2Hash(classification))podFail();
 return {proof:raw.proof,proofHash:raw.proofHash,historyHash:raw.historyHash,template:raw.template,finance:raw.finance,history:raw.history as unknown as import("./discovery-r12-pod-recovery").PodFailedPassHistory,classificationHash:discoveryV2Hash(classification)};
}
/** Proposal only. The successor keeps the Goal and original allowance; it does
 * not restart the revoked policy or create runtime keys before confirmation. */
export async function preparePodResearchRecovery(c:OwnerUiContext,input:PodResearchSetupAction){
 await owned(c,input.businessId);if(!podId(input.setupId)||!podId(input.submissionId))podFail();
 const recovered=await readPodResearch(c,input.businessId,null,input.submissionId),existing=recovered.setups.find(r=>r.submissionId===input.submissionId);
 if(existing){if(existing.preview.recovery?.proof.predecessorSetupId!==input.setupId)podFail();return existing;}
 const catalog=await readPodResearch(c,input.businessId,input.setupId),predecessor=catalog.setups.find(r=>r.setupId===input.setupId&&r.setupHash===input.setupHash);
 if(!predecessor?.activated||!predecessor.stopped)podFail();
 const inspected=await inspectPodRecovery(c,input.businessId,input.setupId),template=inspected.template,finance=inspected.finance;
 if(!podObject(template)||!podId(template.id)||typeof template.hash!=="string")throw Error("r12_pod_recovery_template_unavailable");
 if(!podObject(finance)||finance.hasBlockingUnknown!==false||!podMoney(finance.maximumMicrounits)||!podMoney(finance.committedMicrounits)||!podMoney(inspected.proof.remainingMaximumMicrounits))podFail();
 const amount=Math.min(Number(inspected.proof.remainingMaximumMicrounits),Number(finance.maximumMicrounits)-Number(finance.committedMicrounits));
 const quote=await discoveryR12ServerDependencies().quote({podResearch:true});if(amount<quote.maximumMicrousd)throw Error("r12_pod_recovery_remaining_budget_below_quote");
 // Price and serialize the actual bounded failed history before saving a proposal.
 const request=routeDiscoveryR12Request(buildPodPlannerRequest(predecessor.setupHash,predecessor.preview.sourcePolicyHash,predecessor.preview.publicBrief,predecessor.preview.sourcePolicy.excludedDomains,inspected.history),"plan",quote.luna,false,false,true);
 await inspectDiscoveryR12Wire(request,"plan",false,false,false,true);
 return parsePodReceipt(await rpc(c,"r12_pod_recovery_owner_server",{p_business_id:input.businessId,p_operation:"prepare",p_payload:{input:{businessId:input.businessId,goalId:predecessor.goalId,goalRevision:predecessor.preview.goalRevision,templateId:template.id,templateHash:template.hash,publicBrief:predecessor.preview.publicBrief,maximumMicrounits:String(amount),businessLifetimeLimitMicrounits:finance.maximumMicrounits,submissionId:input.submissionId,predecessorSetupId:input.setupId,proofHash:inspected.proofHash,historyHash:inspected.historyHash,classificationHash:inspected.classificationHash},quote},p_server_key:podApplicationCapability()}),input.businessId);
}
