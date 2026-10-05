"use server";
import { verifyOwnerBusiness } from "@/lib/core-ui/owner-business";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { etsyConfig, etsyRpc, ownerBusiness, prepareEtsyDraft, runEtsyDraft } from "@/etsy/server";
import { beginOAuth } from "@/etsy/oauth";
import { seal, secretHash } from "@/etsy/vault";

const field = (form: FormData, key: string) => String(form.get(key) ?? "");
function done(message: string, businessId: string): never {
  revalidatePath("/dashboard/etsy"); revalidatePath("/dashboard/needs-you");
  redirect(`/dashboard/etsy?business=${encodeURIComponent(businessId)}&message=${encodeURIComponent(message)}`);
}
export async function connectEtsy(form: FormData) {
  const context = await requireOwnerUiContext(), businessId = field(form, "businessId");
  if(!(await verifyOwnerBusiness(context,businessId)))throw new Error("Business unavailable");
    ownerBusiness(context, businessId);
  if (field(form, "accountConsent") !== "on") done("connection-consent-required", businessId);
  let url: string;
  try {
    const config = etsyConfig(), flow = await beginOAuth(config);
    const binding = { businessId, ownerId: context.userId, browserNonceHash: secretHash(flow.browserNonce), verifier: flow.verifier };
    await etsyRpc(context, businessId, "oauth_begin", { stateHash: secretHash(flow.state), envelope: seal(binding, `oauth:${businessId}:${secretHash(flow.state)}`, config.vaultKey) });
    (await cookies()).set("etsy-oauth", seal({ businessId, ownerId: context.userId, state: flow.state, browserNonce: flow.browserNonce }, "oauth-cookie", config.vaultKey),
      { httpOnly: true, secure: true, sameSite: "lax", path: "/api/etsy/callback", maxAge: 600 });
    url = flow.url;
  } catch { done("connection-purpose-review-required", businessId); }
  redirect(url);
}
export async function disconnectEtsy(form: FormData) {
  const context = await requireOwnerUiContext(), businessId = field(form, "businessId");
  try { await etsyRpc(context, field(form, "businessId"), "disconnect"); }
  catch { done("action-unavailable", businessId); }
  done("disconnected", businessId);
}
export async function createEtsyDraft(form: FormData) {
  const context = await requireOwnerUiContext(), businessId = field(form, "businessId");
  if (field(form, "draftConsent") !== "on" || field(form, "assetConsent") !== "on") done("draft-consent-required", businessId);
  let status = "needs_owner";
  try {
    const prepared = await prepareEtsyDraft(context, businessId, field(form, "packageId"), field(form, "packageHash"));
    const result = await runEtsyDraft(context, businessId, String(prepared.runId)); status = result.status;
  } catch { done("draft-blocked", businessId); }
  done(status === "verified" ? "draft-verified" : "draft-needs-review", businessId);
}
export async function reconcileEtsyDraft(form: FormData) {
  const context = await requireOwnerUiContext(), businessId = field(form, "businessId"); let status = "needs_owner";
  try { status = (await runEtsyDraft(context, field(form, "businessId"), field(form, "runId"))).status; }
  catch { done("draft-blocked", businessId); }
  done(status === "verified" ? "draft-verified" : "draft-needs-review", businessId);
}
export async function stopEtsyDraft(form: FormData) {
  const context = await requireOwnerUiContext(), businessId = field(form, "businessId");
  try { await etsyRpc(context, field(form, "businessId"), "cancel", { runId: field(form, "runId") }); }
  catch { done("action-unavailable", businessId); }
  done("draft-stopped", businessId);
}
