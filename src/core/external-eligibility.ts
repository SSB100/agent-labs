/** R11 evidence is independent of credentials, owner consent and financial
 * authority. This pure checker is an inert contract, not a grant-writing API. */
export type ExternalDataUse = "own_shop_operations" | "public_source_collection" | "retained_source_analysis";
export type ExternalUse = {
  version: "r11.1"; businessId: string; ownerId: string; applicationId: string;
  provider: string; operation: string; purpose: string; dataUse: ExternalDataUse;
  sourceDomains: string[]; dataClasses: string[]; recipient: string;
  accountId: string | null; accountRevision: string | null; externalAccountId: string | null;
  lineageHash: string; evidenceId: string;
};
export type ExternalEligibilityEvidence = {
  id: string; version: "r11.1"; use: ExternalUse;
  approvalDocumentHash: string; termsReviewHash: string; independentReviewHash: string;
  validFrom: string; validUntil: string; retentionPolicyHash: string;
};
export type ExternalEligibilitySnapshot = { evidence: ExternalEligibilityEvidence; revoked: boolean };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const LABEL = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;
function deny(): never { throw new Error("external_use_eligibility_unavailable"); }
export function canonicalSourceDomains(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32 || value.some(domain =>
    typeof domain !== "string" || domain.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) || new Set(value).size !== value.length) deny();
  return [...value].sort();
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 32 && value.every(v => typeof v === "string" && LABEL.test(v)) && new Set(value).size === value.length;
}
function validUse(use: ExternalUse): boolean {
  if (!use || use.version !== "r11.1" || !UUID.test(use.businessId) || !UUID.test(use.ownerId) || !UUID.test(use.evidenceId) ||
      !HASH.test(use.lineageHash) || ![use.applicationId,use.provider,use.operation,use.purpose,use.recipient].every(v => typeof v === "string" && LABEL.test(v)) ||
      !["own_shop_operations","public_source_collection","retained_source_analysis"].includes(use.dataUse) || !strings(use.dataClasses)) return false;
  try { canonicalSourceDomains(use.sourceDomains); } catch { return false; }
  const accountless = use.accountId === null && use.accountRevision === null && use.externalAccountId === null;
  const bound = UUID.test(use.accountId ?? "") && UUID.test(use.accountRevision ?? "") && typeof use.externalAccountId === "string" && LABEL.test(use.externalAccountId);
  return use.dataUse === "own_shop_operations" ? bound : accountless || bound;
}
function equalUse(a: ExternalUse, b: ExternalUse): boolean {
  const scalars = ["version","businessId","ownerId","applicationId","provider","operation","purpose","dataUse","recipient","accountId","accountRevision","externalAccountId","lineageHash","evidenceId"] as const;
  return scalars.every(key => a[key] === b[key]) && JSON.stringify([...a.dataClasses].sort()) === JSON.stringify([...b.dataClasses].sort()) &&
    JSON.stringify(canonicalSourceDomains(a.sourceDomains)) === JSON.stringify(canonicalSourceDomains(b.sourceDomains));
}
/** Trusted storage must atomically check current owner/account/revocation at the
 * actual dispatch decision. An earlier successful pure check is not a lease. */
export function verifyExternalEligibility(use: ExternalUse, snapshot: ExternalEligibilitySnapshot | null, now: number): void {
  if (!validUse(use) || !snapshot || snapshot.revoked !== false || !Number.isFinite(now)) deny();
  const e = snapshot.evidence;
  if (!e || e.version !== "r11.1" || e.id !== use.evidenceId || !validUse(e.use) || !equalUse(use,e.use) ||
      ![e.approvalDocumentHash,e.termsReviewHash,e.independentReviewHash,e.retentionPolicyHash].every(v => typeof v === "string" && HASH.test(v)) ||
      !Number.isFinite(Date.parse(e.validFrom)) || !Number.isFinite(Date.parse(e.validUntil)) || Date.parse(e.validFrom) > now || Date.parse(e.validUntil) <= now || Date.parse(e.validFrom) >= Date.parse(e.validUntil)) deny();
}
export type SourceProvenance = { version: "r11.1"; kind: "external_sources"; requestHash: string; sourceDomains: string[]; lineageHash: string };
export type ModelInputProvenance = SourceProvenance | { version: "r11.1"; kind: "source_free"; requestHash: string };
/** Never recover source permission by scanning prompt text. A trusted producer
 * must carry immutable lineage through analysis/derivatives. This slice has no
 * qualified production producer of either source-free or external assertions. */
export function externalSourceProvenance(dataClasses: readonly string[], collectionDomains: readonly string[], value: ModelInputProvenance | undefined, requestHash: string, operationKey: string): SourceProvenance | null {
  if (operationKey === "research.search") canonicalSourceDomains([...collectionDomains]);
  if (!value || value.version !== "r11.1" || !HASH.test(requestHash) || value.requestHash !== requestHash) throw new Error("external_source_provenance_required");
  if (value.kind === "source_free") {
    if (operationKey === "research.search" || collectionDomains.length !== 0 || dataClasses.some(c => c === "public_evidence" || c === "product_evidence") || Object.keys(value).sort().join(",") !== "kind,requestHash,version") throw new Error("external_source_provenance_mismatch");
    return null;
  }
  if (value.kind !== "external_sources" || !HASH.test(value.lineageHash) || Object.keys(value).sort().join(",") !== "kind,lineageHash,requestHash,sourceDomains,version") throw new Error("external_source_provenance_required");
  const sourceDomains = canonicalSourceDomains(value.sourceDomains);
  if (collectionDomains.length && JSON.stringify(canonicalSourceDomains([...collectionDomains])) !== JSON.stringify(sourceDomains)) throw new Error("external_source_provenance_mismatch");
  return { version: "r11.1", kind: "external_sources", requestHash, sourceDomains, lineageHash: value.lineageHash };
}
