"use server";

import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { prepareOwnerResearch, prepareOwnerResearchEpisode, confirmOwnerResearch, stopOwnerResearch } from "@/products/discovery-r12-goal-preparation-server";
import { OwnerResearchBudgetError, type OwnerResearchPreparationInput, type OwnerResearchEpisodePreparationInput, type OwnerResearchSetupAction, type OwnerResearchSetupReceipt } from "@/products/discovery-r12-goal-preparation-contract";

import { ownerResearchUsd } from "@/lib/core-ui/owner-research-form";

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
