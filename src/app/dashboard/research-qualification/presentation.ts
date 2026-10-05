/** UI labels never turn admission markers into validated success. */
type ProofState = {
  policy: { validFrom: string; validUntil: string; quoteValidUntil: string };
  status: string; revoked: boolean; expired: boolean; result: unknown | null;
  phases: Array<{ phase: string; marked: boolean }>;
};
export function researchProofState(entry: ProofState): string {
  if (entry.result) return "Complete · saved validated evidence";
  if (entry.revoked) return "Revoked";
  if (entry.expired) return "Expired";
  if (entry.status === "ready") return "Ready · pending proof";
  if (entry.status === "collection_ready") return "Pending evidence selection";
  if (entry.status === "search_recording_pending" || entry.status === "selection_recording_pending") return "Held · dispatched outcome unverified";
  return "Held · saved result unavailable";
}
export function researchWindowCurrent(policy: ProofState["policy"], now = Date.now()): boolean {
  const start = Date.parse(policy.validFrom), end = Date.parse(policy.validUntil), quoteEnd = Date.parse(policy.quoteValidUntil);
  return Number.isFinite(start) && Number.isFinite(end) && Number.isFinite(quoteEnd) && start <= now && end > now && quoteEnd > now;
}
export function canRunResearchProof(entry: ProofState, configured: boolean, hasUnknown: boolean, now = Date.now()): boolean {
  return researchWindowCurrent(entry.policy, now) && configured && !hasUnknown && !entry.revoked && !entry.expired && !entry.result &&
    (entry.status === "ready" || entry.status === "collection_ready") &&
    !entry.phases.some(phase => phase.marked && (phase.phase === "select" || entry.status === "ready"));
}
export function formatResearchUsd(value: string | number): string {
  const digits = String(value);
  if (!/^\d+$/.test(digits)) return "Amount unavailable";
  const padded = digits.replace(/^0+(?=\d)/, "").padStart(7, "0");
  const whole = padded.slice(0, -6), fractional = padded.slice(-6).replace(/0+$/, "").padEnd(2, "0");
  return `$${whole}.${fractional} USD`;
}
export function safeResearchSourceUrl(value: string, allowedDomains: string[]): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && allowedDomains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`)) ? url.href : null;
  } catch { return null; }
}

/** Exact saved confirmation content; absent monetary/scope disclosure stays inert. */
export function researchGrantDisclosure(value: unknown): {
  businessContent: Record<string, unknown>; goalContent: Record<string, unknown>; operatingPolicy: Record<string, unknown>;
  expectedExposureMicrounits: string; policyLimitMicrounits: string; businessLifetimeLimitMicrounits: string;
} | null {
  const record = (item: unknown): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item);
  if (!record(value) || !record(value.businessContent) || !record(value.goalContent) || !record(value.operatingPolicy)) return null;
  const operating = value.operatingPolicy;
  if (operating.currency !== "USD" || ![operating.expectedExposureMicrounits, operating.policyLimitMicrounits, operating.businessLifetimeLimitMicrounits].every(amount => typeof amount === "string" && /^(0|[1-9][0-9]*)$/.test(amount))) return null;
  return { businessContent: value.businessContent, goalContent: value.goalContent, operatingPolicy: operating,
    expectedExposureMicrounits: operating.expectedExposureMicrounits as string, policyLimitMicrounits: operating.policyLimitMicrounits as string, businessLifetimeLimitMicrounits: operating.businessLifetimeLimitMicrounits as string };
}
