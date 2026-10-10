"use server";

import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { prepareOwnerResearch, prepareOwnerResearchEpisode, confirmOwnerResearch, stopOwnerResearch } from "@/products/discovery-r12-goal-preparation-server";
import { OwnerResearchBudgetError, type OwnerResearchPreparationInput, type OwnerResearchEpisodePreparationInput, type OwnerResearchSetupAction, type OwnerResearchSetupReceipt } from "@/products/discovery-r12-goal-preparation-contract";

import { ownerResearchUsd } from "@/lib/core-ui/owner-research-form";
import { prepareAdaptiveOwnerResearch, confirmAdaptiveOwnerResearch, stopAdaptiveOwnerResearch } from "@/products/discovery-r12-adaptive-owner-server";
import type { AdaptiveResearchPreparationInput } from "@/products/discovery-r12-adaptive-preparation";
import type { AdaptiveOwnerReceipt, AdaptiveOwnerSetupAction } from "@/products/discovery-r12-adaptive-owner-contract";
import { continueAdaptiveOwnerResearch } from "@/products/discovery-r12-adaptive-server";
import type { QuestTickResult } from "@/core/quest-controller";

type Result = { ok: true; receipt: OwnerResearchSetupReceipt } | { ok: false; message: string };

function failure(error: unknown): Result {
  if (error instanceof OwnerResearchBudgetError) return { ok: false, message: `The fresh whole-run quote is ${ownerResearchUsd(error.quoteMaximumMicrousd)}. This requires a cumulative Business limit of at least ${ownerResearchUsd(error.minimumBusinessLimitMicrounits)} and a cumulative research limit of at least ${ownerResearchUsd(error.minimumResearchLimitMicrounits)}. For native Business funding, both use the one Business cap. Adjust the limits explicitly and prepare again. No proposal or authority was created.` };
  const code = error instanceof Error ? error.message : "";
  if (/r12_owner_planner_preflight/.test(code)) return { ok: false, message: "The saved planner request could not pass its size and input checks. This confirmation did not activate research or consume an episode. Reload the saved packet; if the problem persists, it needs a software fix before confirmation." };
  if (/quote.*(?:expired|unavailable)|expired.*quote/.test(code)) return { ok: false, message: "A current quote could not be verified. Reload the saved packet. If its quote has expired, prepare a fresh packet and review it again before confirmation." };
  if (/unresolved_liability/.test(code)) return { ok: false, message: "Existing pending or unknown charges block this research. Review the saved costs and reload before trying again." };
  if (/initial_run_already_exists/.test(code)) return { ok: false, message: "This Quest already has its initial research episode. Open its saved workspace; another setup cannot restart it." };
  if (/episode_(?:unavailable|changed|bounds_exceeded|input_invalid)/.test(code)) return { ok: false, message: "Continuation is no longer eligible under this exact closed predecessor or finite profile. Reload the Quest and review its current continuation record before preparing again. No new authority was created." };
  return { ok: false, message: "The result could not be verified. Reload to check this exact saved setup, or retry the unchanged request to recover its receipt. Changed revisions, expired or unavailable profiles and permissions require a new review." };
}

/** Authenticated server boundaries; browser input contains selectors and ceilings only. */
export async function prepareOwnerResearchAction(input: OwnerResearchPreparationInput): Promise<Result> {
  try { return { ok: true, receipt: await prepareOwnerResearch(await requireOwnerUiContext(), input) }; }
  catch (error) { return failure(error); }
}

export async function prepareOwnerResearchEpisodeAction(input: OwnerResearchEpisodePreparationInput): Promise<Result> {
  try { return { ok: true, receipt: await prepareOwnerResearchEpisode(await requireOwnerUiContext(), input) }; }
  catch (error) { return failure(error); }
}

export async function confirmOwnerResearchAction(input: OwnerResearchSetupAction): Promise<Result> {
  try { return { ok: true, receipt: await confirmOwnerResearch(await requireOwnerUiContext(), input) }; }
  catch (error) { return failure(error); }
}

export async function stopOwnerResearchAction(input: OwnerResearchSetupAction): Promise<Result> {
  try { return { ok: true, receipt: await stopOwnerResearch(await requireOwnerUiContext(), input) }; }
  catch (error) { return failure(error); }
}

type AdaptiveResult = { ok: true; receipt: AdaptiveOwnerReceipt } | { ok: false; message: string };
function adaptiveFailure(error: unknown): AdaptiveResult {
  const code = error instanceof Error ? error.message : "";
  if (/unresolved_liability|unknown_liability|pending/.test(code)) return { ok: false, message: "Pending or unknown charges block new research. Review the saved exposure and reload before trying again." };
  if (/stale|changed|predecessor|revision|closure/.test(code)) return { ok: false, message: "The exact predecessor, financial revision or approved grant changed. Reload and prepare a new packet; this one cannot activate." };
  if (/quote|expired|window/.test(code)) return { ok: false, message: "The quote or authority window is no longer current. Prepare a fresh packet and review it before confirmation." };
  if (/budget|grant|limit|capacity|actions|dispatch/.test(code)) return { ok: false, message: "The whole-run request no longer fits the finite grant, Business cap, research root or remaining Quest capacity. Reload the current limits. No extra authority was assumed." };
  return { ok: false, message: "The adaptive result could not be verified. Reload the exact saved packet or retry the unchanged request to recover its receipt. No completion or permission was assumed." };
}
export async function prepareAdaptiveOwnerResearchAction(input: AdaptiveResearchPreparationInput): Promise<AdaptiveResult> {
  try { return { ok: true, receipt: await prepareAdaptiveOwnerResearch(await requireOwnerUiContext(), input) }; }
  catch (error) { return adaptiveFailure(error); }
}
export async function confirmAdaptiveOwnerResearchAction(input: AdaptiveOwnerSetupAction): Promise<AdaptiveResult> {
  try { return { ok: true, receipt: await confirmAdaptiveOwnerResearch(await requireOwnerUiContext(), input) }; }
  catch (error) { return adaptiveFailure(error); }
}
export async function stopAdaptiveOwnerResearchAction(input: AdaptiveOwnerSetupAction): Promise<AdaptiveResult> {
  try { return { ok: true, receipt: await stopAdaptiveOwnerResearch(await requireOwnerUiContext(), input) }; }
  catch (error) { return adaptiveFailure(error); }
}
export async function continueAdaptiveOwnerResearchAction(businessId: string, scopeId: string): Promise<{ok:true;result:QuestTickResult}|{ok:false;message:string}> {
  try { return {ok:true,result:await continueAdaptiveOwnerResearch(await requireOwnerUiContext(),businessId,scopeId)}; }
  catch { return {ok:false,message:"The saved adaptive run could not be advanced or verified. Reload its exact setup and review current authority, costs and findings before resuming."}; }
}
export async function checkAdaptiveOwnerReceiptsAction(businessId: string, scopeId: string): Promise<{ok:true;result:QuestTickResult}|{ok:false;message:string}> {
  try { return {ok:true,result:await continueAdaptiveOwnerResearch(await requireOwnerUiContext(),businessId,scopeId,"receipt_only")}; }
  catch { return {ok:false,message:"The existing paid receipt could not be verified. Reload its saved status before checking again; no new research call was authorized."}; }
}


/** Saving aggregate owner evidence never starts a model or Etsy operation. */
export async function saveOwnerObservationAction(businessId:string,grantId:string,input:import("@/products/discovery-r12-owner-observation-intake").OwnerObservationIntake) {
  try {
    const context=await requireOwnerUiContext();
    const {buildOwnerObservationIntake}=await import("@/products/discovery-r12-owner-observation-intake");
    const {saveOwnerResearchObservation,selectWholeOwnerObservationBundle}=await import("@/products/discovery-r12-owner-observation-server");
    const bundle=await saveOwnerResearchObservation(context,businessId,grantId,buildOwnerObservationIntake(input,businessId,context.userId));
    return {ok:true as const,bundle,selection:selectWholeOwnerObservationBundle(bundle)};
  } catch {return {ok:false as const,message:"The capture could not be saved and verified. Check exact Etsy text, source URL without query parameters, dates, required fields and privacy review; retry the unchanged capture to recover its receipt."};}
}
export async function listOwnerObservationsAction(businessId:string,grantId:string) {
  try {
    const {listOwnerResearchObservations,selectWholeOwnerObservationBundle}=await import("@/products/discovery-r12-owner-observation-server");
    const bundles=await listOwnerResearchObservations(await requireOwnerUiContext(),businessId,grantId);
    return {ok:true as const,items:bundles.map(bundle=>({bundle,selection:selectWholeOwnerObservationBundle(bundle)}))};
  } catch {return {ok:false as const,message:"Saved owner observations could not be verified. Reload before selecting evidence."};}
}

export async function readOwnerObservationDisclosureAction(businessId:string,grantId:string,selection:import("@/products/discovery-r12-owner-observation").OwnerObservationSelection) {
  try {
    const context=await requireOwnerUiContext();
    const {readOwnerResearchObservationSelection,readOwnerResearchObservation}=await import("@/products/discovery-r12-owner-observation-server");
    const checked=await readOwnerResearchObservationSelection(context,businessId,grantId,selection);
    if(!checked)throw new Error("missing selection");
    const records=[];
    for(const pin of checked.manifest) {
      const bundle=await readOwnerResearchObservation(context,businessId,grantId,pin.bundleId);
      if(bundle.bundleHash!==pin.bundleHash)throw new Error("changed selection");
      const b=bundle.baseline;
      records.push({bundleId:bundle.id,bundleHash:bundle.bundleHash,observations:bundle.observations.filter(o=>pin.selectedObservationIds.includes(o.id)),
        baseline:b && [...b.candidateObservationIds,b.referenceObservationId].every(id=>pin.selectedObservationIds.includes(id))?b:null});
    }
    return {ok:true as const,manifestHash:checked.manifestHash,records};
  } catch {return {ok:false as const,message:"The exact selected capture disclosure could not be verified. Confirmation is unavailable until it can be read and reviewed."};}
}
