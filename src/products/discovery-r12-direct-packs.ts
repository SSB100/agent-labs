import type { JsonObject } from "../core/contracts";
import type { PackManifest, PackStage } from "../packs/types";
import { publicResearchModelSchema, publicResearchModelSystemInstruction } from "./discovery-r12-public-model";
import { etsyKnowledgePackManifests } from "../packs/etsy-knowledge";
import { discoveryV2PackManifests } from "./discovery-v2-packs";

export const DIRECT_INSIGHTS_PACK_VERSION = "1.0.0";
export const DIRECT_INSIGHTS_CAPABILITY_PACK = "capability.browser-etsy-insights";
export const DIRECT_INSIGHTS_SOURCE_PACK = "worker.etsy-insights-source";
export const DIRECT_INSIGHTS_WORKFLOW_PACK = "workflow.etsy-insights-direct";
export const DIRECT_INSIGHTS_WORKFLOW_KEY = "product.discovery-v2.direct";
export const DIRECT_INSIGHTS_WORKER_KEY = "product.discovery-v2.etsy-insights";
export const DIRECT_INSIGHTS_CAPABILITY = "browser.etsy.insights.read_only";
const evals = ["manifest", "exact-dependencies", "owner-purpose-project-isolation", "before-send-admission", "native-redirect-confinement", "observer-cleanup", "visible-query-account-binding", "private-png-provenance", "unknown-liability", "stop-late-receipts", "counted-cycle-repair-window", "no-commerce-authority", "exact-release-ci"];
const uuid:JsonObject = {type:"string",pattern:"^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"};
const digest:JsonObject = {type:"string",pattern:"^[a-f0-9]{64}$"};
function base(packKey:string,kind:PackManifest["kind"],name:string):PackManifest {
 return {frameworkVersion:"1.0",packKey,version:DIRECT_INSIGHTS_PACK_VERSION,kind,name,
  description:"Bounded authenticated Etsy Insights aggregate research through the separately approved direct controller. Registration is experimental; exact release qualification and owner installation do not replace source, account, budget or per-dispatch approval.",
  dependencies:[],ui:{category:"Etsy POD · Research",summary:"One approved visible aggregate query per counted source attempt, with retained evidence and independent review.",supportedBusinessTypes:["etsy-pod"]},
  evals:[...evals],capabilities:[],knowledge:[],workers:[],workflows:[]};
}
/** Ten separate immutable release manifests. No registration, status promotion,
 * credentials, account/profile IDs, tariff, renderer review or grant is created. */
export function directInsightsPackManifests():PackManifest[] {
 const capability=base(DIRECT_INSIGHTS_CAPABILITY_PACK,"capability","Bounded Etsy Insights visible source");
 capability.capabilities=[{key:DIRECT_INSIGHTS_CAPABILITY,adapter:DIRECT_INSIGHTS_CAPABILITY,description:"Exact approved query, same-context shop verification and visible aggregate capture through R12 source admission; no generic browser capability."}];
 const source=base(DIRECT_INSIGHTS_SOURCE_PACK,"worker","Etsy Insights aggregate source");
 source.dependencies=[{packKey:capability.packKey,version:capability.version}];
 source.workers=[{manifest:{manifestVersion:"1.0",packKey:source.packKey,version:source.version,name:source.name,
  worker:{workerKey:DIRECT_INSIGHTS_WORKER_KEY,version:source.version,role:"etsy_insights_read_only",charter:"Acquire the one already-approved visible Etsy Insights aggregate query within the exact owner, Business, Goal, account, project, source-attempt and budget authority. Preserve literal reporting labels, rounding, currency, window, navigation epoch and private screenshot provenance. Pause on mismatch, missing controls, challenges, quota or uncertain release."},
  inputSchema:{type:"object",required:["version","operationId","sourceAttemptId","scopeId","scopeHash","criteriaHash","questionHash"],properties:{version:{const:"r12.etsy-insights-source-scope.1"},operationId:uuid,sourceAttemptId:uuid,scopeId:uuid,scopeHash:digest,criteriaHash:digest,questionHash:digest}},
  outputSchema:{type:"object",required:["version","operationId","sourceAttemptId","requestHash","receiptHash","status","releaseState"],properties:{version:{const:"r12.etsy-insights-source-receipt.1"},operationId:uuid,sourceAttemptId:uuid,requestHash:digest,receiptHash:digest,status:{enum:["completed","paused"]},releaseState:{enum:["not_required","verified","unconfirmed"]}}},
  capabilityPolicy:{allowed:[DIRECT_INSIGHTS_CAPABILITY],forbidden:["web.research","browser.interact","shell.execute","image.generate","marketplace.publish","money.spend","social.publish","account.modify"]},knowledgeRequirements:[],
  modelRequirements:{executionMode:DIRECT_INSIGHTS_CAPABILITY,qualificationScope:"r12_direct_controller_only",maximumAttempts:1},
  instructions:["Use only the existing R12 guarded source runtime. This manifest supplies no dispatch authority and cannot run through a generic model, mapping or simulation executor.",
   "The runtime must validate the complete exact versioned source scope and receipt; these registration schemas identify the contract and do not replace its exact-key validators.",
   "Recheck admission and the immutable account/shop/query binding before each action and capture. Submit once within the already-counted attempt. Do not visit unrelated account areas or read orders, customers, messages, cookies, headers, replay or hidden endpoints.",
   "Preserve literal aggregates and unknown precision. A new UUID or capture timestamp is not a new fact. Do not infer geography, timezone, conversion, sales, demand, rights or commercial readiness.",
   "Retain bounded text plus a private PNG from one document epoch. Accept only after authenticated storage, verified release, observer disposal and qualified bounded-pending or final accounting. Unknown liability blocks new attempts.",
   "Stop, expiry, revocation, login/challenge, quota and unreviewed material renderer requests pause honestly. Never bypass them, fall back to Exa, or initiate another paid probe."],examples:[],
  negativeExamples:[{name:"Candidate policy is evidence",forbiddenBehaviour:"Treat an approved renderer candidate or a previous no-query landing check as complete query results.",reason:"Actual source query, results, window, metrics and provenance require their own same-attempt checks."},{name:"Hidden account access",forbiddenBehaviour:"Use a generic browser or direct endpoint to fetch private account data.",reason:"Only approved ordinary visible aggregate Insights controls are admitted."}],
  escalationPolicy:{authorityMissing:"pause",wrongShop:"pause",loginOrChallenge:"pause",quota:"pause",unknownCost:"pause",unconfirmedRelease:"retain_full_liability",maximumSourceSubmissions:1}},
  execution:{kind:DIRECT_INSIGHTS_CAPABILITY,authority:"r12.direct-controller"}}];
 const legacy=discoveryV2PackManifests();
 const oldKnowledge=etsyKnowledgePackManifests();
 const requiredKnowledge=legacy.find(p=>p.packKey==="worker.product-discovery-v2-plan")!.dependencies;
 const knowledgePacks=requiredKnowledge.map(pin=>{
  const prior=oldKnowledge.find(p=>p.packKey===pin.packKey&&p.version===pin.version)!;
  const pack=structuredClone(prior);
  pack.packKey=`${prior.packKey}.direct-insights`;pack.name=`${prior.name} · direct research release`;
  // Preserve every source URL, source caveat, content and verifiedAt byte-for-byte.
  // A new release identity is not a fresh source observation or attestation.
  pack.description=`Separate direct research release preserving the original source snapshot. ${prior.description}`;
  return pack;
 });
 const modelPacks=(["plan","strategy","review"] as const).map(phase=>{
  const prior=legacy.find(p=>p.packKey===`worker.product-discovery-v2-${phase}`)!;
  const pack=base(`worker.etsy-insights-${phase}`,"worker",`Direct Insights ${phase}`);
  pack.dependencies=knowledgePacks.map(p=>({packKey:p.packKey,version:p.version}));
  const manifest=structuredClone(prior.workers[0].manifest);
  manifest.packKey=pack.packKey;manifest.name=pack.name;
  manifest.worker={...manifest.worker,workerKey:`product.discovery-direct.${phase}`,charter:phase==="review"?"Independently review the exact direct Insights strategy and authenticated aggregate evidence with the separately reviewed Sonnet route. Retain contrary history and material uncertainty; no execution or commerce approval.":phase==="plan"?"Plan bounded original-product hypotheses and precise research criteria from the retained Goal and negative history. Do not acquire sources or change the approved query/authority.":"Evaluate current approved Insights evidence, original-product alternatives and all unresolved material limits. Preserve literal aggregates and contrary history; propose learning only when substantively supported."};
  manifest.inputSchema={type:"object",required:["version","phase","phaseAttemptId","inputHash"],properties:{version:{enum:["r12.public-research-phase-inputs.1","r12.public-research-phase-inputs.2"]},phase:{const:phase},phaseAttemptId:uuid,inputHash:digest}};
  manifest.outputSchema=publicResearchModelSchema(phase);
  manifest.instructions=[publicResearchModelSystemInstruction(phase),"Only the separately authenticated direct controller may execute this worker. Exact current quote, phase attempt, selected dependencies, source/account proof, cumulative counters and before-send reservation remain mandatory."];
  manifest.modelRequirements={executionMode:"r12.direct-model",qualificationScope:"r12_direct_controller_only",maximumAttempts:1,primaryOnly:true,modelKey:phase==="review"?"claude.sonnet.high-power":"luna.standard",providerModelId:phase==="review"?"anthropic/claude-sonnet-4.6":"openai/gpt-5.6-luna",canonicalModelId:phase==="review"?"anthropic/claude-4.6-sonnet-20260217":"openai/gpt-5.6-luna-20260709",endpoint:phase==="review"?"amazon-bedrock/us":"azure/us"};
  pack.workers=[{manifest,execution:{kind:"r12.direct-model",authority:"r12.direct-controller",phase}}];return pack;
 });
 const workflow=base(DIRECT_INSIGHTS_WORKFLOW_PACK,"workflow","Direct Etsy Insights research cycle");
 workflow.dependencies=[...modelPacks.map(pack=>({packKey:pack.packKey,version:pack.version})),{packKey:source.packKey,version:source.version}];
 const original=legacy.find(p=>p.packKey==="workflow.product-discovery-v2")!.workflows[0];
 const modelStage=(key:"plan"|"strategy"|"review",inputFrom:string,outputContract:string):PackStage=>{
  const stage=structuredClone(original.stages.find(s=>s.key===key)!);
  return {...stage,workerKey:`product.discovery-direct.${key}`,inputFrom,completionCriteria:{outputContract,requiresAuthenticatedDirectPhaseProof:true,...(key==="review"?{independentActualModel:true}:{})}};
 };
 workflow.workflows=[{key:DIRECT_INSIGHTS_WORKFLOW_KEY,version:workflow.version,name:workflow.name,description:workflow.description,
  inputSchema:{type:"object",additionalProperties:false,required:["scopeId","policyHash"],properties:{scopeId:uuid,policyHash:digest}},
  outputSchema:{type:"object",required:["researchStageOutcome","questComplete"],properties:{researchStageOutcome:{enum:[null,"RESEARCH_PASSED_SUPPORTS_TEST","RESEARCH_PASSED_REJECTS_HYPOTHESIS","RESEARCH_FAILED_QUALITY","INSUFFICIENT_EVIDENCE","INVALID_RESEARCH"]},questComplete:{const:false}}},
  sampleInput:{scopeId:"11111111-1111-4111-8111-111111111111",policyHash:"0".repeat(64)},
  stages:[modelStage("plan","workflow","r12_direct_plan_v1"),{key:"source",workerKey:DIRECT_INSIGHTS_WORKER_KEY,workerVersion:source.version,objective:"Acquire one exact approved visible Insights query and retain literal aggregates with immutable source proof.",inputFrom:"plan",knowledgeKeys:[],permittedCapabilities:[DIRECT_INSIGHTS_CAPABILITY],nonGoals:["No hidden endpoint, private customer data, uncounted query, paid probe or source fallback."],completionCriteria:{outputContract:"r12.etsy-insights-source-receipt.1",sameAccountAndQuery:true,privateScreenshotStored:true,releaseVerified:true}},
   modelStage("strategy","source","r12_direct_strategy_v1"),modelStage("review","strategy","r12_direct_review_v1")]}];
 return [...knowledgePacks,capability,source,...modelPacks,workflow];
}
