"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { saveAccountProfile, prepareAccountSetup, approveAccountSetup, resumeAccountSetup,
  handoffAccountConnection, connectPrintfulAccount, verifyEtsyAccount, revokeAccount, saveOwnerAccountPassword, deleteOwnerAccountPassword,
  prepareApprovedAccountRegistration, stopAccountSetup, releaseAccountRegistration } from "@/accounts/server";
import { PROFILE_FIELDS } from "@/accounts/contracts";

const field = (form: FormData, key: string) => typeof form.get(key) === "string" ? String(form.get(key)) : "";
function done(businessId: string, message: string): never {
  revalidatePath("/dashboard/accounts"); revalidatePath("/dashboard/printful"); revalidatePath("/dashboard/needs-you");
  redirect(`/dashboard/accounts?business=${encodeURIComponent(businessId)}&accountMessage=${encodeURIComponent(message)}#business-accounts`);
}
export async function saveBusinessAccountProfile(form: FormData) {
  const context = await requireOwnerUiContext(), businessId = field(form, "businessId");
  let released = true;
  try { released = (await saveAccountProfile(context, businessId, Object.fromEntries(PROFILE_FIELDS.map(key => [key, field(form, key)])), field(form, "profileRevision") || null)).browserReleaseVerified !== false; }
  catch { done(businessId, "profile-unavailable"); }
  done(businessId, released ? "profile-saved" : "profile-saved-browser-pending");
}
export async function requestAccountSetup(form: FormData) {
  const context = await requireOwnerUiContext(), businessId = field(form, "businessId");
  try { await prepareAccountSetup(context, businessId, field(form, "provider"), field(form, "mode"), field(form, "idempotencyKey")); }
  catch { done(businessId, "setup-unavailable"); }
  done(businessId, "review-ready");
}
export async function approveReviewedAccountSetup(form: FormData) {
  const context = await requireOwnerUiContext(), businessId = field(form, "businessId");
  if (field(form, "dataConsent") !== "on" || field(form, "accessConsent") !== "on") done(businessId, "consent-required");
  try {
    const run = await approveAccountSetup(context, businessId, { runId: field(form, "runId"), revision: Number(field(form, "revision")),
      disclosureHash: field(form, "disclosureHash"), acceptTerms: field(form, "termsConsent") === "on", browserConsent: field(form, "browserConsent") === "on" });
    if (run.mode === "connect") await handoffAccountConnection(context, businessId, run.id);
    else await prepareApprovedAccountRegistration(context, businessId, run.id);
  } catch { done(businessId, "approval-unavailable"); }
  done(businessId, "approved");
}
export async function cancelAccountSetup(form: FormData) {
  const context = await requireOwnerUiContext(), businessId = field(form, "businessId");
  let released = true;
  try { released = (await stopAccountSetup(context, businessId, field(form, "runId"), Number(field(form, "revision")))).remoteReleaseVerified; }
  catch { done(businessId, "setup-unavailable"); }
  done(businessId, released ? "cancelled" : "browser-release-unconfirmed");
}
export async function startApprovedAccountRegistration(form: FormData) {
  const context = await requireOwnerUiContext(), businessId = field(form, "businessId");
  try { await prepareApprovedAccountRegistration(context, businessId, field(form, "runId")); }
  catch { done(businessId, "setup-unavailable"); }
  done(businessId, "registration-prepared");
}
export async function finishOwnerRegistrationSession(form: FormData) {
  const context = await requireOwnerUiContext(), businessId = field(form, "businessId");
  let released = false;
  try { released = (await releaseAccountRegistration(context, businessId, field(form, "runId"))).remoteReleaseVerified; }
  catch { done(businessId, "browser-release-unconfirmed"); }
  done(businessId, released ? "owner-step-finished" : "browser-release-unconfirmed");
}
export async function resumeVerifiedAccountSetup(form: FormData) {
  const context = await requireOwnerUiContext(), businessId = field(form, "businessId");
  let released = true;
  try {
    const run = await resumeAccountSetup(context, businessId, field(form, "runId"));
    if (run.provider === "etsy") released = (await verifyEtsyAccount(context, businessId, run.id)).browserReleaseVerified !== false;
    else throw new Error("secure_entry_required");
  } catch { done(businessId, "verification-unavailable"); }
  done(businessId, released ? "verified" : "verified-browser-pending");
}
export async function submitOwnerPrintfulCredential(form: FormData) {
  const context = await requireOwnerUiContext(), businessId = field(form, "businessId");
  let released = true;
  if (field(form, "secureAccessConsent") !== "on") done(businessId, "consent-required");
  try {
    const kind = field(form, "storeKind");
    if (kind !== "manual_api" && kind !== "ecommerce_linked") throw new Error("invalid_store_kind");
    released = (await connectPrintfulAccount(context, businessId, { runId: field(form, "runId"), credential: field(form, "credential"),
      storeId: Number(field(form, "storeId")), storeKind: kind, expiresAt: `${field(form, "expiresAt")}Z` })).browserReleaseVerified !== false;
  } catch { done(businessId, "verification-unavailable"); }
  done(businessId, released ? "verified" : "verified-browser-pending");
}
export async function disconnectBusinessAccount(form: FormData) {
  const context = await requireOwnerUiContext(), businessId = field(form, "businessId");
  if (field(form, "disconnectConsent") !== "on") done(businessId, "consent-required");
  let released = true;
  try { released = (await revokeAccount(context, businessId, field(form, "provider"), field(form, "connectionRevision"))).browserReleaseVerified !== false; }
  catch { done(businessId, "disconnect-unavailable"); }
  done(businessId, released ? "disconnected" : "disconnected-browser-pending");
}
export async function storeOwnerWebsitePassword(form: FormData) {
  const context = await requireOwnerUiContext(), businessId = field(form, "businessId");
  if (field(form, "passwordStorageConsent") !== "on") done(businessId, "consent-required");
  try { await saveOwnerAccountPassword(context, businessId, { provider: field(form, "provider"), connectionId: field(form, "connectionId"),
    expectedConnectionRevision: field(form, "connectionRevision"), expectedPasswordRevision: field(form, "passwordRevision") || null,
    username: field(form, "username"), password: field(form, "password"), confirmPassword: field(form, "confirmPassword") }); }
  catch { done(businessId, "password-storage-unavailable"); }
  done(businessId, "password-stored");
}
export async function removeOwnerWebsitePassword(form: FormData) {
  const context = await requireOwnerUiContext(), businessId = field(form, "businessId");
  if (field(form, "passwordRemovalConsent") !== "on") done(businessId, "consent-required");
  try { await deleteOwnerAccountPassword(context, businessId, { provider: field(form, "provider"), connectionId: field(form, "connectionId"), expectedPasswordRevision: field(form, "passwordRevision") }); }
  catch { done(businessId, "password-storage-unavailable"); }
  done(businessId, "password-removed");
}
