"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { verifyOwnerBusiness } from "@/lib/core-ui/owner-business";
import { PublicResearchQualificationError } from "@/research/qualification-outcome";
import {
  activateResearchGrant,
  prepareResearchBootstrap,
  reconcileResearchProof,
  runResearchProof,
  stopResearchProof,
} from "@/research/qualification-server";
import type { ResearchSetupState } from "./form-state";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const route = "/dashboard/research-qualification";
const field = (form: FormData, name: string) => {
  const values = form.getAll(name);
  return values.length === 1 && typeof values[0] === "string" ? values[0] : "";
};

export async function prepareResearchSetup(_previous: ResearchSetupState, form: FormData): Promise<ResearchSetupState> {
  const businessId = field(form, "businessId"), policyId = field(form, "policyId"), workflowRunId = field(form, "workflowRunId");
  const mode = form.getAll("mode").length === 0 ? "initial" : field(form, "mode");
  const predecessorPolicyId = field(form, "predecessorPolicyId");
  const validMode = mode === "initial" ? form.getAll("predecessorPolicyId").length === 0 :
    mode === "continuation" && UUID.test(predecessorPolicyId) && predecessorPolicyId !== policyId;
  if (![businessId, policyId, workflowRunId].every(value => UUID.test(value)) || !validMode) {
    return { status: "unavailable", message: "The exact setup request is unavailable. Reload this Business.", preparation: null };
  }
  const context = await requireOwnerUiContext();
  if (!await verifyOwnerBusiness(context, businessId)) {
    return { status: "unavailable", message: "Business ownership could not be verified. No setup was prepared.", preparation: null };
  }
  try {
    const preparation = mode === "continuation"
      ? await prepareResearchBootstrap(context, businessId, policyId, workflowRunId, predecessorPolicyId)
      : await prepareResearchBootstrap(context, businessId, policyId, workflowRunId);
    return { status: "prepared", message: "Setup metadata prepared. No grant was installed and no paid research was started.", preparation };
  } catch {
    return { status: "unavailable", message: mode === "continuation"
      ? "Continuation setup could not be verified. Reload this exact Business to review saved Stop, charges and remaining allowance before preparing a fresh public quote."
      : "Setup could not be verified. Check server configuration and try preparing a fresh public quote.", preparation: null };
  }
}

export async function activateResearchProof(form: FormData) {
  const businessId = field(form, "businessId"), grantId = field(form, "grantId"), grantHash = field(form, "grantHash");
  if (!UUID.test(businessId)) throw new Error("Exact Business unavailable");
  const destination = `${route}?business=${businessId}`;
  if (!UUID.test(grantId) || !HASH.test(grantHash) || field(form, "readConsent") !== "on" || field(form, "retentionConsent") !== "on") {
    redirect(`${destination}&notice=consent-required`);
  }
  const context = await requireOwnerUiContext();
  let notice = "check-saved-state";
  try {
    if (await verifyOwnerBusiness(context, businessId)) {
      await activateResearchGrant(context, businessId, grantId, grantHash);
      notice = "review-activation";
    }
  } catch { /* Only the freshly read durable state can show activation. */ }
  revalidatePath(route);
  redirect(`${destination}&notice=${notice}`);
}

export async function runResearchProofAction(form: FormData) {
  const businessId = field(form, "businessId"), policyId = field(form, "policyId");
  if (!UUID.test(businessId)) throw new Error("Exact Business unavailable");
  const context = await requireOwnerUiContext();
  let notice = "review-proof";
  try {
    if (UUID.test(policyId) && await verifyOwnerBusiness(context, businessId)) await runResearchProof(context, businessId, policyId);
  } catch (error) {
    // This is action feedback only; a recorded outcome must still be read back.
    if (error instanceof PublicResearchQualificationError && error.recorded === false) notice = "diagnostic-unavailable";
  }
  revalidatePath(route);
  redirect(`${route}?business=${businessId}&notice=${notice}`);
}

export async function stopResearchProofAction(form: FormData) {
  const businessId = field(form, "businessId"), policyId = field(form, "policyId");
  if (!UUID.test(businessId)) throw new Error("Exact Business unavailable");
  const context = await requireOwnerUiContext();
  try {
    if (UUID.test(policyId) && await verifyOwnerBusiness(context, businessId)) await stopResearchProof(context, businessId, policyId);
  } catch { /* Saved revocation must be read back before claiming Stop succeeded. */ }
  revalidatePath(route);
  redirect(`${route}?business=${businessId}&notice=review-stop`);
}

/** Explicit legacy audit reconciliation never authorizes or retries research. */
export async function reconcileResearchProofAction(form: FormData) {
  const businessId = field(form, "businessId"), policyId = field(form, "policyId");
  if (!UUID.test(businessId)) throw new Error("Exact Business unavailable");
  const context = await requireOwnerUiContext();
  try {
    if (UUID.test(policyId) && await verifyOwnerBusiness(context, businessId)) await reconcileResearchProof(context, businessId, policyId);
  } catch { /* Only saved reconciliation records establish an outcome. */ }
  revalidatePath(route);
  redirect(`${route}?business=${businessId}&notice=review-reconciliation`);
}
