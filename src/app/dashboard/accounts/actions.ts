"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { saveAccountProfile, prepareAccountSetup, approveAccountSetup, resumeAccountSetup,
  handoffAccountConnection, connectPrintfulAccount, verifyEtsyAccount, revokeAccount, saveOwnerAccountPassword, deleteOwnerAccountPassword,
  prepareApprovedAccountRegistration, stopAccountSetup, releaseAccountRegistration } from "@/accounts/server";
import { AccountError, PROFILE_FIELDS } from "@/accounts/contracts";

import { PrintfulConnectionError } from "@/accounts/printful";
import { accountReturnHref, printfulFailureMessage } from "@/accounts/connection-feedback";

const field = (form: FormData, key: string) => typeof form.get(key) === "string" ? String(form.get(key)) : "";
function done(businessId: string, message: string, form: FormData, completedRunId?: string): never {
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/accounts"); revalidatePath("/dashboard/printful"); revalidatePath("/dashboard/needs-you");
  redirect(accountReturnHref(businessId, { message, returnTo: field(form, "returnTo"), runId: completedRunId ?? field(form, "runId"), provider: field(form, "provider"), resultId: randomUUID() }));
}
export async function saveBusinessAccountProfile(form: FormData) {
  const context = await requireOwnerUiContext(), businessId = field(form, "businessId");
  let released = true;
  try { released = (await saveAccountProfile(context, businessId, Object.fromEntries(PROFILE_FIELDS.map(key => [key, field(form, key)])), field(form, "profileRevision") || null)).browserReleaseVerified !== false; }
  catch { done(businessId, "profile-unavailable", form); }
  done(businessId, released ? "profile-saved" : "profile-saved-browser-pending", form);
}
export async function requestAccountSetup(form: FormData) {
  const context = await requireOwnerUiContext(), businessId = field(form, "businessId");
  let preparedRunId: string;
  try { preparedRunId = (await prepareAccountSetup(context, businessId, field(form, "provider"), field(form, "mode"), field(form, "idempotencyKey"))).id; }
  catch { done(businessId, "setup-unavailable", form); }
  done(businessId, "review-ready", form, preparedRunId);
}
export async function approveReviewedAccountSetup(form: FormData) {
  const context = await requireOwnerUiContext(), businessId = field(form, "businessId");
  if (field(form, "dataConsent") !== "on" || field(form, "accessConsent") !== "on") done(businessId, "consent-required", form);
  try {
    const run = await approveAccountSetup(context, businessId, { runId: field(form, "runId"), revision: Number(field(form, "revision")),
      disclosureHash: field(form, "disclosureHash"), acceptTerms: field(form, "termsConsent") === "on", browserConsent: field(form, "browserConsent") === "on" });
    if (run.mode === "connect") await handoffAccountConnection(context, businessId, run.id);
    else await prepareApprovedAccountRegistration(context, businessId, run.id);
  } catch { done(businessId, "approval-unavailable", form); }
  done(businessId, "approved", form);
}
export async function cancelAccountSetup(form: FormData) {
  const context = await requireOwnerUiContext(), businessId = field(form, "businessId");
  let released = true;
  try { released = (await stopAccountSetup(context, businessId, field(form, "runId"), Number(field(form, "revision")))).remoteReleaseVerified; }
  catch { done(businessId, "setup-unavailable", form); }
  done(businessId, released ? "cancelled" : "browser-release-unconfirmed", form);
}
export async function startApprovedAccountRegistration(form: FormData) {
  const context = await requireOwnerUiContext(), businessId = field(form, "businessId");
  try { await prepareApprovedAccountRegistration(context, businessId, field(form, "runId")); }
  catch { done(businessId, "setup-unavailable", form); }
  done(businessId, "registration-prepared", form);
}
export async function finishOwnerRegistrationSession(form: FormData) {
  const context = await requireOwnerUiContext(), businessId = field(form, "businessId");
  let released = false;
  try { released = (await releaseAccountRegistration(context, businessId, field(form, "runId"))).remoteReleaseVerified; }
  catch { done(businessId, "browser-release-unconfirmed", form); }
  done(businessId, released ? "owner-step-finished" : "browser-release-unconfirmed", form);
}
export async function resumeVerifiedAccountSetup(form: FormData) {
  const context = await requireOwnerUiContext(), businessId = field(form, "businessId");
  let released = true;
  try {
    const run = await resumeAccountSetup(context, businessId, field(form, "runId"));
    if (run.provider === "etsy") released = (await verifyEtsyAccount(context, businessId, run.id)).browserReleaseVerified !== false;
    else throw new Error("secure_entry_required");
  } catch { done(businessId, "verification-unavailable", form); }
  done(businessId, released ? "verified" : "verified-browser-pending", form);
}
export async function submitOwnerPrintfulCredential(form: FormData) {
  const context = await requireOwnerUiContext(), businessId = field(form, "businessId");
  let released = true;
  if (field(form, "secureAccessConsent") !== "on") done(businessId, "consent-required", form);
  try {
    const kind = field(form, "storeKind");
    if (kind !== "manual_api" && kind !== "ecommerce_linked") throw new PrintfulConnectionError("invalid_connection_request");
    released = (await connectPrintfulAccount(context, businessId, { runId: field(form, "runId"), credential: field(form, "credential"),
      storeId: Number(field(form, "storeId")), storeKind: kind, expiresAt: `${field(form, "expiresAt")}Z` })).browserReleaseVerified !== false;
  } catch (error) {
    const message = error instanceof PrintfulConnectionError ? printfulFailureMessage(error.code)
      : error instanceof AccountError && error.code === "account_handoff_expired" ? "verification-expired"
      : error instanceof AccountError && error.code === "account_approval_required" ? "verification-review-required"
      : "verification-unavailable";
    done(businessId, message, form);
  }
  done(businessId, released ? "verified" : "verified-browser-pending", form);
}
export async function disconnectBusinessAccount(form: FormData) {
  const context = await requireOwnerUiContext(), businessId = field(form, "businessId");
  if (field(form, "disconnectConsent") !== "on") done(businessId, "consent-required", form);
  let released = true;
  try { released = (await revokeAccount(context, businessId, field(form, "provider"), field(form, "connectionRevision"))).browserReleaseVerified !== false; }
  catch { done(businessId, "disconnect-unavailable", form); }
  done(businessId, released ? "disconnected" : "disconnected-browser-pending", form);
}
export async function storeOwnerWebsitePassword(form: FormData) {
  const context = await requireOwnerUiContext(), businessId = field(form, "businessId");
  if (field(form, "passwordStorageConsent") !== "on") done(businessId, "consent-required", form);
  try { await saveOwnerAccountPassword(context, businessId, { provider: field(form, "provider"), connectionId: field(form, "connectionId"),
    expectedConnectionRevision: field(form, "connectionRevision"), expectedPasswordRevision: field(form, "passwordRevision") || null,
    username: field(form, "username"), password: field(form, "password"), confirmPassword: field(form, "confirmPassword") }); }
  catch { done(businessId, "password-storage-unavailable", form); }
  done(businessId, "password-stored", form);
}
export async function removeOwnerWebsitePassword(form: FormData) {
  const context = await requireOwnerUiContext(), businessId = field(form, "businessId");
  if (field(form, "passwordRemovalConsent") !== "on") done(businessId, "consent-required", form);
  try { await deleteOwnerAccountPassword(context, businessId, { provider: field(form, "provider"), connectionId: field(form, "connectionId"), expectedPasswordRevision: field(form, "passwordRevision") }); }
  catch { done(businessId, "password-storage-unavailable", form); }
  done(businessId, "password-removed", form);
}
