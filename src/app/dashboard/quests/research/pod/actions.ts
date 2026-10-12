"use server";
import {start} from "workflow/api";
import {requireOwnerUiContext} from "@/lib/core-ui/data";
import {confirmPodResearch,preparePodResearch,readPodResearch,stopPodResearch} from "@/products/discovery-r12-pod-owner-server";
import {podResearchRuntimeWorkflow} from "@/workflows/pod-research-runtime";
import type {PodResearchEntry,PodResearchSetupAction} from "@/products/discovery-r12-pod-owner-contract";
function message(error:unknown){const code=error instanceof Error?error.message:"";
 if(/unresolved_liability|unknown/.test(code))return "An earlier charge is still unresolved. New spending is blocked until its existing receipt is reconciled.";
 if(/quote_exceeds_budget/.test(code))return `The current maximum quote is $${(Number(code.split(":")[1])/1000000).toFixed(4)}. Increase your run limit explicitly if you want to review that amount.`;
 if(/business_not_ready/.test(code))return "Review your Business operating rules before starting research.";
 if(/template|catalog/.test(code))return "The reviewed public-research capability is not available yet. No run or permission was created.";
 if(/expired|window|stale|changed/.test(code))return "This review is no longer current. Reload its saved status, then prepare a fresh review if needed. Existing attempts are never restarted.";
 return "The result could not be verified. Reload this saved research before retrying. No completion or new permission has been assumed.";}
export async function preparePodResearchAction(input:PodResearchEntry){try{return{ok:true as const,receipt:await preparePodResearch(await requireOwnerUiContext(),input)};}catch(error){return{ok:false as const,message:message(error)};}}
export async function confirmPodResearchAction(input:PodResearchSetupAction){
 try{const context=await requireOwnerUiContext(),receipt=await confirmPodResearch(context,input);
  try{await start(podResearchRuntimeWorkflow,[{businessId:receipt.businessId,scopeId:receipt.scopeId}]);return{ok:true as const,receipt,runtimeStarted:true};}
  catch{return{ok:true as const,receipt,runtimeStarted:false};}
 }catch(error){return{ok:false as const,message:message(error)};}
}
export async function resumePodResearchAction(input:PodResearchSetupAction){try{const catalog=await readPodResearch(await requireOwnerUiContext(),input.businessId,input.setupId),r=catalog.setups.find(s=>s.setupId===input.setupId&&s.setupHash===input.setupHash);if(!r?.activated)throw Error("missing confirmed run");await start(podResearchRuntimeWorkflow,[{businessId:r.businessId,scopeId:r.scopeId}]);return{ok:true as const};}catch(error){return{ok:false as const,message:message(error)};}}
export async function stopPodResearchAction(input:PodResearchSetupAction){try{return{ok:true as const,receipt:await stopPodResearch(await requireOwnerUiContext(),input)};}catch(error){return{ok:false as const,message:message(error)};}}
