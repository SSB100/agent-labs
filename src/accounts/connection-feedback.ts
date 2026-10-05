import type { AccountProvider, AccountWorkspace } from "./contracts";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
/** Only a canonical, same-Business root destination survives a round trip. */
export function accountReturnHref(businessId: string, options: { returnTo?: string; runId?: string; message?: string; provider?: string; resultId?: string } = {}) {
  const query = new URLSearchParams({ view: "connections", business: businessId });
  try {
    const prior = new URL(options.returnTo ?? "", "https://agent-labs.invalid");
    const scopeKeys = ["view", "business", "connectionRun", "provider", "quest", "episode", "step", "agent", "sourceArtifact"];
    if (prior.origin === "https://agent-labs.invalid" && prior.pathname === "/dashboard" &&
      scopeKeys.every(key => prior.searchParams.getAll(key).length <= 1) &&
      prior.searchParams.get("view") === "connections" && prior.searchParams.get("business") === businessId) {
      for (const key of ["quest", "episode", "step", "agent", "sourceArtifact"]) { const value = prior.searchParams.get(key); if (value && uuid.test(value)) query.set(key, value); }
      const run = prior.searchParams.get("connectionRun"), provider = prior.searchParams.get("provider");
      if (run && uuid.test(run) && (!options.provider || options.provider === provider)) query.set("connectionRun", run);
      if (provider === "printful" || provider === "etsy") query.set("provider", provider);
    }
  } catch { /* An invalid return URL never becomes a redirect target. */ }
  if (options.runId && uuid.test(options.runId)) query.set("connectionRun", options.runId);
  if (options.provider === "printful" || options.provider === "etsy") query.set("provider", options.provider);
  if (options.resultId && uuid.test(options.resultId)) query.set("accountResult", options.resultId);
  if (options.message && /^[a-z][a-z-]{0,63}$/.test(options.message)) query.set("accountMessage", options.message);
  return `/dashboard?${query.toString()}${options.message ? "#connection-notice" : ""}`;
}

export const printfulFailureMessages = {
  invalid_connection_request: "verification-input-invalid",
  credential_access_denied: "verification-access-denied",
  credential_scope_rejected: "verification-scope-rejected",
  credential_store_scope_rejected: "verification-store-scope-rejected",
  store_identity_mismatch: "verification-store-mismatch",
  provider_rate_limited: "verification-rate-limited",
  provider_failure: "verification-unavailable",
  provider_timeout: "verification-unavailable",
  invalid_provider_response: "verification-unavailable",
  account_connection_required: "verification-unavailable",
} as const;
export function printfulFailureMessage(code: string) {
  return Object.hasOwn(printfulFailureMessages, code) ? printfulFailureMessages[code as keyof typeof printfulFailureMessages] : "verification-unavailable";
}

export function connectionState(data: AccountWorkspace, provider: AccountProvider) {
  const account = data.accounts.find(item => item.provider === provider);
  const run = (data.currentRuns ?? data.runs).filter(item => item.provider === provider).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  if (data.unavailable) return { label: "Unavailable", account, run };
  const now = Date.parse(data.observedAt);
  const credentialExpired = account?.expiresAt != null && (!Number.isFinite(Date.parse(account.expiresAt)) || Date.parse(account.expiresAt) <= now);
  if (account?.status === "connected" && account.verifiedAt && !credentialExpired) return { label: "Connected", account, run };
  const active = run && ["pending_approval", "approved", "preparation_started", "owner_handoff"].includes(run.status);
  const expired = run?.status === "expired" || (active && run.approvalExpiresAt != null && (!Number.isFinite(Date.parse(run.approvalExpiresAt)) || Date.parse(run.approvalExpiresAt) <= now));
  if (expired) return { label: "Expired", account, run };
  if (active) return { label: "Setup in progress", account, run };
  if (credentialExpired) return { label: "Expired", account, run };
  if (account?.status === "failed" || run?.status === "failed" || run?.status === "invalidated") return { label: "Failed", account, run };
  return { label: "Not connected", account, run };
}

/** Stable through an unchanged live refresh; a committed outcome resets forms. */
export function connectionWorkspaceKey(data: AccountWorkspace, message?: string, resultId?: string) {
  return JSON.stringify([data.businessId, data.profile?.revision, message, resultId,
    data.accounts.map(account => [account.id, account.revision, account.status, account.passwordRevision]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    data.runs.map(run => [run.id, run.revision, run.status]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))]);
}

export const ACCOUNT_POSITIVE_MESSAGES = ["password-removed", "password-stored", "profile-saved", "profile-saved-browser-pending",
  "review-ready", "approved", "registration-prepared", "owner-step-finished", "cancelled", "verified", "verified-browser-pending",
  "disconnected", "disconnected-browser-pending"] as const;

/** A URL notice never proves a mutation. Positive copy needs its saved context. */
export function accountMessageConfirmation(data: AccountWorkspace, provider: AccountProvider, runId: string | undefined, message: string): boolean | undefined {
  if (!(ACCOUNT_POSITIVE_MESSAGES as readonly string[]).includes(message)) return undefined;
  if (data.unavailable) return false;
  const account = data.accounts.find(item => item.provider === provider);
  const run = runId ? data.runs.find(item => item.id === runId && item.provider === provider) : undefined;
  const freshReview = !!run && !!data.profile && run.disclosure.profileRevision === data.profile.revision &&
    !!run.approvalExpiresAt && Date.parse(run.approvalExpiresAt) > Date.parse(data.observedAt);
  switch (message) {
    case "profile-saved": case "profile-saved-browser-pending": return !!data.profile && uuid.test(data.profile.revision);
    case "password-stored": return account?.passwordStored === true && uuid.test(account.passwordRevision ?? "");
    case "password-removed": return account?.passwordStored === false;
    case "review-ready": return freshReview && run?.status === "pending_approval";
    case "approved": return freshReview && !!run && ["approved", "preparation_started", "owner_handoff"].includes(run.status);
    case "registration-prepared": return freshReview && run?.mode === "create" && run.status === "owner_handoff" && run.preparationReceipt?.outcome === "prepared";
    case "cancelled": return run?.status === "cancelled";
    case "verified": case "verified-browser-pending": return run?.status === "verified" && run.connectionId === account?.id && connectionState(data, provider).label === "Connected";
    case "disconnected": case "disconnected-browser-pending": return account?.status === "revoked";
    // The public workspace projection does not prove a remote browser release.
    case "owner-step-finished": return false;
    default: return false;
  }
}
