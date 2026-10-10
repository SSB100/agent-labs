import { exactPublicKeys as exact, publicHash as hash, publicInteger as integer, publicMoney as money, publicResearchFail as fail, publicResearchHash, publicTime as time, publicUuid as uuid, publicBoundedJson, verifyPublicSelfHash } from "./discovery-r12-public-utils";
export type PublicResearchBrowserAccountingPins = {
  businessId: string; goalId: string; authorityRootId: string; envelopeHash: string; providerProjectId: string;
  operationKind: "owner_setup" | "research_source"; operationId: string; operationReceiptHash: string; requestHash: string;
  reservationId: string; reservationHash: string; quoteHash: string; routeHash: string; tariffHash: string;
  qualificationHash: string; releaseProofHash: string; usageIdentityHash: string; maximumMicrounits: string; currency: "USD";
};
type AccountingBase = PublicResearchBrowserAccountingPins & { version: "r12.public-browser-accounting.1"; revision: number; previousRecordHash: string | null; recordedAt: string; recordHash: string };
export type PublicResearchBrowserAccounting = AccountingBase & ({ status: "qualified_bounded_pending"; actualMicrounits: null; providerBillingRecordHash: null } | { status: "final_actual"; actualMicrounits: string; providerBillingRecordHash: string });
export type PublicResearchBrowserAccountingAnomaly = {
  version: "r12.public-browser-accounting-anomaly.1"; businessId: string; goalId: string; authorityRootId: string;
  envelopeHash: string; providerProjectId: string; operationId: string; reservationId: string; reservationHash: string;
  usageIdentityHash: string; maximumMicrounits: string; reason: "actual_above_reserved_bound" | "unbounded_usage" | "unqualified_billing";
  observedActualMicrounits: string | null; providerEvidenceHash: string; recordedAt: string; anomalyHash: string;
};
export type PublicResearchAccountingLineage = Pick<PublicResearchBrowserAccountingPins, "businessId" | "goalId" | "authorityRootId" | "envelopeHash">;
const pinKeys = "businessId,goalId,authorityRootId,envelopeHash,providerProjectId,operationKind,operationId,operationReceiptHash,requestHash,reservationId,reservationHash,quoteHash,routeHash,tariffHash,qualificationHash,releaseProofHash,usageIdentityHash,maximumMicrounits,currency";
function matchExpected(v: Record<string, unknown>, expected: Record<string, unknown>): void { for (const [k,x] of Object.entries(expected)) if (v[k] !== x) fail("r12_public_accounting_binding_mismatch"); }
function pinsOf(v: PublicResearchBrowserAccounting): PublicResearchBrowserAccountingPins { return Object.fromEntries(pinKeys.split(",").map(k => [k, v[k as keyof typeof v]])) as PublicResearchBrowserAccountingPins; }
export function validatePublicResearchBrowserAccounting(raw: unknown, expected: Partial<PublicResearchBrowserAccountingPins> = {}, now?: number): PublicResearchBrowserAccounting {
  if (!exact(raw, `${pinKeys},version,revision,previousRecordHash,recordedAt,recordHash,status,actualMicrounits,providerBillingRecordHash`)) return fail();
  const v = raw as unknown as PublicResearchBrowserAccounting;
  if (v.version !== "r12.public-browser-accounting.1" || ![v.businessId,v.goalId,v.authorityRootId,v.providerProjectId,v.operationId,v.reservationId].every(uuid) || ![v.envelopeHash,v.operationReceiptHash,v.requestHash,v.reservationHash,v.quoteHash,v.routeHash,v.tariffHash,v.qualificationHash,v.releaseProofHash,v.usageIdentityHash].every(hash) || !["owner_setup","research_source"].includes(v.operationKind) || v.currency !== "USD" || !integer(v.revision, 1, 4096) || (v.revision === 1 ? v.previousRecordHash !== null : !hash(v.previousRecordHash))) return fail();
  const maximum = money(v.maximumMicrounits); time(v.recordedAt);
  if (now !== undefined && (!Number.isFinite(now) || time(v.recordedAt) > now)) return fail();
  if (v.status === "qualified_bounded_pending") { if (maximum <= 0n || v.actualMicrounits !== null || v.providerBillingRecordHash !== null) return fail(); }
  else if (v.status === "final_actual") { if (!hash(v.providerBillingRecordHash) || money(v.actualMicrounits) > maximum) return fail("r12_public_actual_above_reserved_bound"); }
  else return fail();
  matchExpected(raw, expected); verifyPublicSelfHash(raw, "recordHash"); return structuredClone(v);
}
export function validatePublicResearchBrowserAccountingAnomaly(raw: unknown, expected: Partial<PublicResearchAccountingLineage> = {}): PublicResearchBrowserAccountingAnomaly {
  if (!exact(raw, "version,businessId,goalId,authorityRootId,envelopeHash,providerProjectId,operationId,reservationId,reservationHash,usageIdentityHash,maximumMicrounits,reason,observedActualMicrounits,providerEvidenceHash,recordedAt,anomalyHash")) return fail();
  const v = raw as unknown as PublicResearchBrowserAccountingAnomaly;
  if (v.version !== "r12.public-browser-accounting-anomaly.1" || ![v.businessId,v.goalId,v.authorityRootId,v.providerProjectId,v.operationId,v.reservationId].every(uuid) || ![v.envelopeHash,v.reservationHash,v.usageIdentityHash,v.providerEvidenceHash].every(hash) || !["actual_above_reserved_bound","unbounded_usage","unqualified_billing"].includes(v.reason)) return fail();
  const maximum = money(v.maximumMicrounits); time(v.recordedAt);
  if (v.observedActualMicrounits !== null) money(v.observedActualMicrounits);
  if (v.reason === "actual_above_reserved_bound" && (v.observedActualMicrounits === null || money(v.observedActualMicrounits) <= maximum)) return fail();
  matchExpected(raw, expected); verifyPublicSelfHash(raw, "anomalyHash"); return structuredClone(v);
}
export type PublicResearchBrowserExposure = PublicResearchAccountingLineage & {
  version: "r12.public-browser-exposure.1"; hasUnknownOrUnbounded: boolean; anomalyHashes: string[];
  operations: Array<{ operationId: string; latestRecordHash: string; status: "qualified_bounded_pending" | "final_actual" | "unknown_or_unbounded"; knownActualMicrounits: string; heldMaximumMicrounits: string; conservativeExposureMicrounits: string }>;
  knownActualMicrounits: string; heldMaximumMicrounits: string; conservativeExposureMicrounits: string; exposureHash: string;
};
/** Inputs must be the COMPLETE private authenticated ledger, including anomalies.
 * Hash verification alone does not authenticate provider billing or completeness. */
export function publicResearchBrowserExposure(records: readonly unknown[], expected: PublicResearchAccountingLineage, anomalies: readonly unknown[]): PublicResearchBrowserExposure {
  if (!Array.isArray(records) || !Array.isArray(anomalies) || records.length > 4096 || anomalies.length > 4096 || ![expected.businessId,expected.goalId,expected.authorityRootId].every(uuid) || !hash(expected.envelopeHash)) return fail();
  publicBoundedJson({ records, anomalies });
  const rows = [...new Map(records.map(r => { const v = validatePublicResearchBrowserAccounting(r, expected); return [v.recordHash, v] as const; })).values()];
  const problems = [...new Map(anomalies.map(r => { const v = validatePublicResearchBrowserAccountingAnomaly(r, expected); return [v.anomalyHash,v] as const; })).values()];
  const operations: PublicResearchBrowserExposure["operations"] = [];
  const identities = new Map<string,string>(), bills = new Map<string,string>();
  function unique(identity: string, operationId: string) { const prior = identities.get(identity); if (prior && prior !== operationId) fail("r12_public_accounting_identity_reused"); identities.set(identity, operationId); }
  for (const operationId of [...new Set([...rows,...problems].map(r => r.operationId))].sort()) {
    const chain = rows.filter(r => r.operationId === operationId).sort((a,b) => a.revision - b.revision), issues = problems.filter(r => r.operationId === operationId);
    let actual = 0n, held = 0n; const first = chain[0] ?? issues[0];
    if (!first) return fail();
    unique(`reservation:${first.reservationId}`,operationId); unique(`usage:${first.usageIdentityHash}`,operationId);
    for (const x of [...chain,...issues]) {
      for (const key of ["providerProjectId","reservationId","reservationHash","usageIdentityHash","maximumMicrounits"] as const) if (x[key] !== first[key]) return fail("r12_public_accounting_immutable_pin_changed");
    }
    for (let i = 0; i < chain.length; i++) {
      const r = chain[i], previous = chain[i-1];
      if (r.revision !== i+1 || r.previousRecordHash !== (previous?.recordHash ?? null) || (previous && (time(r.recordedAt) < time(previous.recordedAt) || publicResearchHash(pinsOf(r)) !== publicResearchHash(pinsOf(previous)) || previous.status === "final_actual" && r.status !== "final_actual"))) return fail("r12_public_accounting_revision_gap_or_rewrite");
      unique(`request:${r.requestHash}`,operationId);
      if (r.status === "final_actual") {
        const identity = `${operationId}:${r.actualMicrounits}`, prior = bills.get(r.providerBillingRecordHash);
        if (prior && prior !== identity) return fail("r12_public_billing_receipt_reused"); bills.set(r.providerBillingRecordHash,identity);
        if (money(r.actualMicrounits) > actual) actual = money(r.actualMicrounits);
      }
    }
    const latest = chain.at(-1);
    if (!latest || latest.status === "qualified_bounded_pending") held = money(first.maximumMicrounits);
    if (issues.length) {
      let floor = money(first.maximumMicrounits);
      for (const x of issues) if (x.observedActualMicrounits !== null && money(x.observedActualMicrounits) > floor) floor = money(x.observedActualMicrounits);
      if (floor - actual > held) held = floor - actual;
    }
    operations.push({ operationId, latestRecordHash: latest?.recordHash ?? issues.map(x => x.anomalyHash).sort().at(-1)!, status: issues.length ? "unknown_or_unbounded" : latest!.status, knownActualMicrounits: actual.toString(), heldMaximumMicrounits: held.toString(), conservativeExposureMicrounits: (actual+held).toString() });
  }
  const known = operations.reduce((s,x) => s+money(x.knownActualMicrounits),0n), held = operations.reduce((s,x) => s+money(x.heldMaximumMicrounits),0n);
  const body = { version: "r12.public-browser-exposure.1" as const, ...expected, hasUnknownOrUnbounded: problems.length > 0, anomalyHashes: problems.map(x => x.anomalyHash).sort(), operations, knownActualMicrounits: known.toString(), heldMaximumMicrounits: held.toString(), conservativeExposureMicrounits: (known+held).toString() };
  return { ...body, exposureHash: publicResearchHash(body) };
}
export function publicResearchCombinedExposure(input: {
  browser: PublicResearchBrowserExposure; otherKnownActualMicrounits: string; otherHeldMaximumMicrounits: string;
  hasUnknownOrUnbounded: boolean; nextMaximumMicrounits: string; runMaximumMicrounits: string; windowMaximumMicrounits: string;
  rootHeadroomMicrounits: string; businessHeadroomMicrounits: string;
}) {
  const b = input.browser; verifyPublicSelfHash(b as unknown as Record<string,unknown>,"exposureHash");
  let known = 0n, held = 0n; const seen = new Set<string>();
  for (const op of b.operations) { if (seen.has(op.operationId) || money(op.conservativeExposureMicrounits) !== money(op.knownActualMicrounits)+money(op.heldMaximumMicrounits)) return fail(); seen.add(op.operationId); known += money(op.knownActualMicrounits); held += money(op.heldMaximumMicrounits); }
  if (known !== money(b.knownActualMicrounits) || held !== money(b.heldMaximumMicrounits) || known+held !== money(b.conservativeExposureMicrounits) || b.hasUnknownOrUnbounded !== (b.anomalyHashes.length > 0) || b.operations.some(x => x.status === "unknown_or_unbounded") && !b.hasUnknownOrUnbounded) return fail();
  known += money(input.otherKnownActualMicrounits); held += money(input.otherHeldMaximumMicrounits);
  const next = money(input.nextMaximumMicrounits), run = money(input.runMaximumMicrounits), window = money(input.windowMaximumMicrounits);
  if (run <= 0n || run > 10000000n || window <= 0n || window > run || typeof input.hasUnknownOrUnbounded !== "boolean") return fail();
  const unknown = b.hasUnknownOrUnbounded || input.hasUnknownOrUnbounded;
  const reason = unknown ? "unknown_or_unbounded_liability" : known+held+next > run || known+held+next > window ? "combined_test_cap_exceeded" : next > money(input.rootHeadroomMicrounits) || next > money(input.businessHeadroomMicrounits) ? "lifetime_headroom_exceeded" : null;
  return { admitted: reason === null, reason, knownActualMicrounits: known.toString(), heldMaximumMicrounits: held.toString(), conservativeExposureMicrounits: (known+held).toString(), nextMaximumMicrounits: next.toString() };
}
