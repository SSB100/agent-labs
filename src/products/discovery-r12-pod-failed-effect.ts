import { publicResearchHash } from "../research/qualification";
import type { GenerationRouteExpectation } from "../research/generation-route";

/** A rejected effect is accounting/history, never accepted research evidence. */
export type PodFailedEffectSubject = {
 version:"r12.pod-failed-effect.3";scopeId:string;scopeHash:string;planId:string;planHash:string;actionOrdinal:number;actionHash:string;
 attemptId:string;requestId:string;phase:string;bindingHash:string;wireHash:string;requestHash:string;
 providerRequestId:string;providerModelId:string;actualMicrounits:string;observationHash:string;diagnosticHash:string;
 failureKind:"json_parse"|"response_schema"|"response_size"|"finish_reason"|"next_consumer_capacity";receiptExpiresAt:string;
};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
export function validatePodFailedEffect(raw:unknown,expected:Pick<PodFailedEffectSubject,"scopeId"|"scopeHash"|"planId"|"planHash"|"actionOrdinal"|"actionHash"|"attemptId"|"requestId"|"phase"|"bindingHash"|"wireHash"|"requestHash">,maximumMicrounits:number) {
 const fail=():never=>{throw Error("r12_pod_failed_effect_unverified");};
 if(!object(raw)||!object(raw.subject)||raw.subjectHash!==publicResearchHash(raw.subject)||!object(raw.receipt))return fail();
 const s=raw.subject;
 if(Object.keys(s).sort().join(',')!=="version,scopeId,scopeHash,planId,planHash,actionOrdinal,actionHash,attemptId,requestId,phase,bindingHash,wireHash,requestHash,providerRequestId,providerModelId,actualMicrounits,observationHash,diagnosticHash,failureKind,receiptExpiresAt".split(',').sort().join(',')||s.version!=="r12.pod-failed-effect.3"||
 Object.entries(expected).some(([k,v])=>s[k]!==v)||!Number.isInteger(s.actionOrdinal)||Number(s.actionOrdinal)<0||Number(s.actionOrdinal)>4||
 typeof s.providerRequestId!=="string"||!/^gen-[A-Za-z0-9_-]{1,296}$/.test(s.providerRequestId)||
 typeof s.actualMicrounits!=="string"||!/^(0|[1-9][0-9]{0,7})$/.test(s.actualMicrounits)||Number(s.actualMicrounits)>maximumMicrounits||
 ![s.observationHash,s.diagnosticHash].every(h=>typeof h==="string"&&/^[a-f0-9]{64}$/.test(h))||
 !["json_parse","response_schema","response_size","finish_reason","next_consumer_capacity"].includes(String(s.failureKind))||
 typeof s.receiptExpiresAt!=="string"||!Number.isFinite(Date.parse(s.receiptExpiresAt)))return fail();
 const subject=structuredClone(s) as PodFailedEffectSubject;
 if(!podFailedReceiptExpectation(subject).acceptedResponseModelIds.includes(subject.providerModelId))return fail();
 return {subject,subjectHash:String(raw.subjectHash),receipt:structuredClone(raw.receipt),proof:raw.proof};
}
export function podFailedReceiptExpectation(s:PodFailedEffectSubject):GenerationRouteExpectation {
 return {generationId:s.providerRequestId,providerName:s.phase==="review"?"Amazon Bedrock":"Azure",requestedEndpoint:s.phase==="review"?"amazon-bedrock/us":"azure/us",
 acceptedResponseModelIds:s.phase==="review"?["anthropic/claude-haiku-4.5","anthropic/claude-4.5-haiku-20251001"]:["openai/gpt-5.6-luna","openai/gpt-5.6-luna-20260709"]};
}
