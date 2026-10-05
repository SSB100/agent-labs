"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { verifyOwnerBusiness } from "@/lib/core-ui/owner-business";
import {
  activateResearchGrant,
  prepareResearchBootstrap,
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
  if (![businessId, policyId, workflowRunId].every(value => UUID.test(value))) {
    return { status: "unavailable", message: "The exact setup request is unavailable. Reload this Business.", preparation: null };
  }
  const context = await requireOwnerUiContext();
  if (!await verifyOwnerBusiness(context, businessId)) {
    return { status: "unavailable", message: "Business ownership could not be verified. No setup was prepared.", preparation: null };
  }
  try {
    const preparation = await prepareResearchBootstrap(context, businessId, policyId, workflowRunId);
    return { status: "prepared", message: "Setup metadata prepared. No grant was installed and no paid research was started.", preparation };
  } catch {
    return { status: "unavailable", message: "Setup could not be verified. Check server configuration and try preparing a fresh public quote.", preparation: null };
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
  try {
    if (UUID.test(policyId) && await verifyOwnerBusiness(context, businessId)) await runResearchProof(context, businessId, policyId);
  } catch { /* Unknown outcomes remain held. Never retry or invent a result. */ }
  revalidatePath(route);
  redirect(`${route}?business=${businessId}&notice=review-proof`);
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
