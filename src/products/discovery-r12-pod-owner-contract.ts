import { discoveryV2Hash } from "./discovery-v2";
import { validatePodResearchPublicBrief, validatePodResearchSourcePolicy, type PodResearchGoalScope } from "./discovery-r12-pod-goal";
import type { DiscoveryR12ExecutionQuote } from "./discovery-r12-quote";
import type {PodRecoveryProof} from "./discovery-r12-pod-recovery";
export type PodRecoveryPreview={version:"r12.pod-next-pass-recovery.1";proof:PodRecoveryProof;proofHash:string;historyHash:string;classificationHash:string;originalReviewAccepted:false};
export type PodPublicBrief = PodResearchGoalScope["publicBrief"];
export type PodResearchEntry = { businessId: string; publicBrief: PodPublicBrief; maximumMicrounits: string; deadlineAt: string; submissionId: string };
export type PodResearchSetupAction = { businessId: string; setupId: string; setupHash: string; submissionId: string };
export type PodResearchReceipt = { version:"r12.pod-setup-receipt.2"; businessId:string; goalId:string; setupId:string; scopeId:string; setupHash:string; policyId:string; policyHash:string; submissionId:string;
 confirmed:boolean;activated:boolean;stopped:boolean;preview:{recovery?:PodRecoveryPreview;version:"r12.pod-research-preview.2";businessId:string;goalId:string;goalRevision:number;goalHash:string;businessRevision:number;businessHash:string;publicBrief:PodPublicBrief;
 templateId:string;templateHash:string;sourcePolicy:PodResearchGoalScope["sourcePolicy"];sourcePolicyHash:string;finance:{authorityRootId:string;capRevision:number;maximumMicrounits:string;committedMicrounits:string;hasUnknown:boolean;hasBlockingUnknown:boolean;boundedPendingMicrounits:string;pendingMicrounits:string;proposedBusinessLimitMicrounits:string;runLimitMicrounits:string};quote:DiscoveryR12ExecutionQuote;maximumPasses:5;maximumCalls:25;maximumCollections:5;maximumRepairs:0;dispatchMinutes:30;receiptMinutes:30;maximumReceiptChecks:75;authorityCreated:false} };
export type PodResearchCatalog = {version:"r12.pod-catalog.2";businessId:string;business:{revision:number;hash:string;ready:boolean}|null;goal:null|{id:string;revision:number;hash:string;preference:string;content:Record<string,unknown>;initialRunExists:boolean};
 finance:PodResearchReceipt["preview"]["finance"];template:null|{id:string;hash:string;sourcePolicy:PodResearchGoalScope["sourcePolicy"];sourcePolicyHash:string;validUntil:string};setups:PodResearchReceipt[]};
export const podId=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
export const podObject=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
export const podMoney=(v:unknown):v is string=>typeof v==="string"&&/^(0|[1-9][0-9]{0,15})$/.test(v)&&Number.isSafeInteger(Number(v));
const hash=(v:unknown)=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);
export function podFail():never{throw Error("r12_pod_owner_result_unverified");}
export function parsePodReceipt(raw:unknown,businessId:string,setupId?:string):PodResearchReceipt {
 if(!podObject(raw)||raw.version!=="r12.pod-setup-receipt.2"||raw.businessId!==businessId||setupId!==undefined&&raw.setupId!==setupId||
 ![raw.goalId,raw.setupId,raw.scopeId,raw.policyId,raw.submissionId].every(podId)||![raw.setupHash,raw.policyHash].every(hash)||![raw.confirmed,raw.activated,raw.stopped].every(v=>typeof v==="boolean")||raw.activated===true&&raw.confirmed!==true||!podObject(raw.preview))podFail();
 const r=raw as unknown as PodResearchReceipt,p=r.preview;
 if(p.version!=="r12.pod-research-preview.2"||p.businessId!==businessId||p.goalId!==r.goalId||discoveryV2Hash(p)!==r.setupHash||p.maximumPasses!==5||p.maximumCalls!==25||p.maximumCollections!==5||p.maximumRepairs!==0||p.dispatchMinutes!==30||p.receiptMinutes!==30||p.maximumReceiptChecks!==75||p.authorityCreated!==false||!podObject(p.finance)||![p.goalHash,p.businessHash,p.templateHash,p.sourcePolicyHash].every(hash)||!podId(p.templateId))podFail();
 validatePodResearchPublicBrief(p.publicBrief);validatePodResearchSourcePolicy(p.sourcePolicy,Date.parse(p.sourcePolicy.validFrom));
 if(discoveryV2Hash(p.sourcePolicy)!==p.sourcePolicyHash||p.finance.authorityRootId!==businessId||![p.finance.maximumMicrounits,p.finance.committedMicrounits,p.finance.pendingMicrounits,p.finance.proposedBusinessLimitMicrounits,p.finance.runLimitMicrounits].every(podMoney)||typeof p.finance.hasUnknown!=="boolean"||typeof p.finance.hasBlockingUnknown!=="boolean"||!podMoney(p.finance.boundedPendingMicrounits))podFail();
 if(p.recovery){const x=p.recovery,q=x.proof;if(x.version!=="r12.pod-next-pass-recovery.1"||x.originalReviewAccepted!==false||!podObject(q)||q.version!=="r12.pod-recovery-proof.1"||q.businessId!==businessId||q.goalId!==r.goalId||discoveryV2Hash(q)!==x.proofHash||q.historyHash!==x.historyHash||!hash(x.classificationHash)||!Number.isInteger(q.usedPasses)||q.usedPasses<1||q.usedPasses>4||q.usedCalls!==q.usedPasses*5||q.usedSearches!==q.usedPasses||![q.originalMaximumMicrounits,q.spentMicrounits,q.remainingMaximumMicrounits].every(podMoney)||Number(q.remainingMaximumMicrounits)!==Number(q.originalMaximumMicrounits)-Number(q.spentMicrounits)||Number(p.finance.runLimitMicrounits)>Number(q.remainingMaximumMicrounits))podFail();}
 return structuredClone(r);
}
export function parsePodCatalog(raw:unknown,businessId:string):PodResearchCatalog {
 if(!podObject(raw)||raw.version!=="r12.pod-catalog.2"||raw.businessId!==businessId||!Array.isArray(raw.setups)||!podObject(raw.finance))podFail();
 const c=structuredClone(raw) as unknown as PodResearchCatalog;
 if(c.finance.authorityRootId!==businessId||![c.finance.maximumMicrounits,c.finance.committedMicrounits,c.finance.pendingMicrounits].every(podMoney)||typeof c.finance.hasUnknown!=="boolean"||typeof c.finance.hasBlockingUnknown!=="boolean"||!podMoney(c.finance.boundedPendingMicrounits))podFail();
 if(c.template){if(!podId(c.template.id)||!hash(c.template.hash)||discoveryV2Hash(c.template.sourcePolicy)!==c.template.sourcePolicyHash)podFail();validatePodResearchSourcePolicy(c.template.sourcePolicy,Date.now());}
 c.setups=c.setups.map(r=>parsePodReceipt(r,businessId));return c;
}
