import type { OwnerResearchSetupReceipt } from "../../products/discovery-r12-goal-preparation-contract";

/** Decimal USD is parsed as text. Never round a financial permission. */
export function ownerResearchUsdMicrounits(value: string): string | null {
  const match = /^(0|[1-9][0-9]{0,9})(?:\.([0-9]{1,6}))?$/.exec(value.trim());
  if (!match) return null;
  const amount = BigInt(match[1]) * BigInt(1_000_000) + BigInt((match[2] ?? "").padEnd(6, "0"));
  return amount > BigInt(0) && amount <= BigInt(Number.MAX_SAFE_INTEGER) ? amount.toString() : null;
}

export function ownerResearchUsdValue(value: string | number): string {
  const amount = BigInt(value);
  return `${amount / BigInt(1_000_000)}.${(amount % BigInt(1_000_000)).toString().padStart(6, "0")}`;
}

export const ownerResearchUsd = (value: string | number) => `USD ${ownerResearchUsdValue(value)}`;
export const ownerResearchSetupHref = (businessId: string, goalId: string, setupId?: string) => `/dashboard/quests/research?business=${encodeURIComponent(businessId)}&quest=${encodeURIComponent(goalId)}${setupId ? `&setup=${encodeURIComponent(setupId)}` : ""}`;
export const ownerResearchWorkspaceHref = (receipt: OwnerResearchSetupReceipt) => `/dashboard?view=research&type=r12&business=${receipt.businessId}&selected=${receipt.scopeId}&quest=${receipt.goalId}`;

export function ownerResearchCanConfirm(receipt: OwnerResearchSetupReceipt | null, consentHash: string | null, now: number): boolean {
  return !!receipt && !receipt.confirmed && !receipt.activated && !receipt.stopped && receipt.setupHash === consentHash && Date.parse(receipt.preview.quote.validUntil) > now;
}

type RequestStorage = Pick<Storage, "getItem" | "setItem">;
/** Only opaque request identities are saved. Consent, Goal text and packet contents are never stored. */
export function ownerResearchRequestId(key: string, memory: Map<string, string>, storage: RequestStorage | null, randomUUID: () => string, supersededId?: string): string {
  let id = memory.get(key);
  try { id ??= storage?.getItem(key) ?? undefined; } catch { /* In-memory retries still work. */ }
  if (!id || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id) || id === supersededId) id = randomUUID();
  memory.set(key, id);
  try { storage?.setItem(key, id); } catch { /* Do not persist the request body as a fallback. */ }
  return id;
}
