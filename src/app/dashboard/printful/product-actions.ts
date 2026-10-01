"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { beginPrintfulProduct, productRpc, runPrintfulProduct } from "@/printful/server";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const hash = /^[a-f0-9]{64}$/;
function field(form: FormData, key: string) {
  const values = form.getAll(key);
  return values.length === 1 && typeof values[0] === "string" ? values[0] : "";
}
function done(businessId: string, message: "product-consent-required" | "product-blocked" | "product-needs-review" | "product-stop-requested"): never {
  revalidatePath("/dashboard/printful");
  revalidatePath("/dashboard/needs-you");
  redirect(`/dashboard/printful?business=${encodeURIComponent(businessId)}&productMessage=${message}#printful-product-configuration`);
}

/** IDs and a snapshot hash select server-owned evidence; form data cannot supply evidence or authority. */
export async function configureReviewedPrintfulProduct(form: FormData) {
  const context = await requireOwnerUiContext();
  const businessId = field(form, "businessId");
  if (!uuid.test(businessId) || !context.businesses.some(business => business.id === businessId)) done("", "product-blocked");
  if (field(form, "configurationConsent") !== "on") done(businessId, "product-consent-required");
  const sourceId = field(form, "sourceId"), sourceHash = field(form, "sourceHash");
  if (!uuid.test(sourceId) || !hash.test(sourceHash)) done(businessId, "product-blocked");
  try {
    const prepared = await beginPrintfulProduct(context, businessId, sourceId, sourceHash, true);
    if (typeof prepared.runId !== "string" || !uuid.test(prepared.runId)) throw new Error("product_run_invalid");
    await runPrintfulProduct(context, businessId, prepared.runId);
  } catch { done(businessId, "product-blocked"); }
  // Native readback is partial evidence, never a configuration-success claim.
  done(businessId, "product-needs-review");
}

export async function reconcilePrintfulProduct(form: FormData) {
  const context = await requireOwnerUiContext();
  const businessId = field(form, "businessId"), runId = field(form, "runId");
  if (!uuid.test(businessId) || !context.businesses.some(business => business.id === businessId) || !uuid.test(runId)) done("", "product-blocked");
  try { await runPrintfulProduct(context, businessId, runId, true); }
  catch { done(businessId, "product-needs-review"); }
  done(businessId, "product-needs-review");
}

export async function stopPrintfulProduct(form: FormData) {
  const context = await requireOwnerUiContext();
  const businessId = field(form, "businessId"), runId = field(form, "runId");
  if (!uuid.test(businessId) || !context.businesses.some(business => business.id === businessId) || !uuid.test(runId)) done("", "product-blocked");
  try { await productRpc(context, businessId, "cancel", { runId }); }
  catch { done(businessId, "product-needs-review"); }
  done(businessId, "product-stop-requested");
}
