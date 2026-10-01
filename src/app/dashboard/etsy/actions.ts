"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { etsyConfig, etsyRpc, ownerBusiness, prepareEtsyDraft, runEtsyDraft } from "@/etsy/server";
import { beginOAuth } from "@/etsy/oauth";
import { seal, secretHash } from "@/etsy/vault";

const field = (form: FormData, key: string) => String(form.get(key) ?? "");
function done(message: string): never {
  revalidatePath("/dashboard/etsy"); revalidatePath("/dashboard/needs-you");
  redirect(`/dashboard/etsy?message=${encodeURIComponent(message)}`);
}
export async function connectEtsy(form: FormData) {
  const context = await requireOwnerUiContext(), businessId = field(form, "businessId");
  ownerBusiness(context, businessId);
  if (field(form, "accountConsent") !== "on") done("connection-consent-required");
  let url: string;
  try {
    const config = etsyConfig(), flow = beginOAuth(config);
    const binding = { businessId, ownerId: context.userId, browserNonceHash: secretHash(flow.browserNonce), verifier: flow.verifier };
    await etsyRpc(context, businessId, "oauth_begin", { stateHash: secretHash(flow.state), envelope: seal(binding, `oauth:${businessId}:${secretHash(flow.state)}`, config.vaultKey) });
    (await cookies()).set("etsy-oauth", seal({ businessId, ownerId: context.userId, state: flow.state, browserNonce: flow.browserNonce }, "oauth-cookie", config.vaultKey),
      { httpOnly: true, secure: true, sameSite: "lax", path: "/api/etsy/callback", maxAge: 600 });
    url = flow.url;
  } catch { done("connection-unavailable"); }
  redirect(url);
}
export async function disconnectEtsy(form: FormData) {
  const context = await requireOwnerUiContext();
  try { await etsyRpc(context, field(form, "businessId"), "disconnect"); }
  catch { done("action-unavailable"); }
  done("disconnected");
}
export async function createEtsyDraft(form: FormData) {
  const context = await requireOwnerUiContext(), businessId = field(form, "businessId");
  if (field(form, "draftConsent") !== "on" || field(form, "assetConsent") !== "on") done("draft-consent-required");
  let status = "needs_owner";
  try {
    const prepared = await prepareEtsyDraft(context, businessId, field(form, "packageId"));
    const result = await runEtsyDraft(context, businessId, String(prepared.runId)); status = result.status;
  } catch { done("draft-blocked"); }
  done(status === "verified" ? "draft-verified" : "draft-needs-review");
}
export async function reconcileEtsyDraft(form: FormData) {
  const context = await requireOwnerUiContext(); let status = "needs_owner";
  try { status = (await runEtsyDraft(context, field(form, "businessId"), field(form, "runId"))).status; }
  catch { done("draft-blocked"); }
  done(status === "verified" ? "draft-verified" : "draft-needs-review");
}
export async function stopEtsyDraft(form: FormData) {
  const context = await requireOwnerUiContext();
  try { await etsyRpc(context, field(form, "businessId"), "cancel", { runId: field(form, "runId") }); }
  catch { done("action-unavailable"); }
  done("draft-stopped");
}
