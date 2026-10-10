import { exactPublicKeys as exact, publicHash as hash, publicResearchFail as fail, publicText as text, publicTime as time, publicUuid as uuid, verifyPublicSelfHash } from "./discovery-r12-public-utils";
export type PublicResearchInsightsAccountBinding = {
  version: "r12.etsy-insights-account-binding.1"; businessId: string; goalId: string; authorityRootId: string;
  purpose: "etsy_insights_read_only"; testEnvelopeId: string; testEnvelopeHash: string; providerProjectId: string;
  profileBindingId: string; profileBindingRevision: string; approvalId: string; approvalRevision: string;
  disclosureHash: string; handoffReceiptHash: string; profileCandidateHash: string;
  accountVerificationHash: string; verifiedContextHash: string; observedShopName: string; observedShopId: string | null;
  verifiedAt: string; expiresAt: string; bindingHash: string;
};
export type PublicResearchSourceAccess = { allowedSource: "etsy_public_browser"; sourcePurpose: "public_marketplace_research" } | {
  allowedSource: "etsy_authenticated_insights"; sourcePurpose: "etsy_insights_aggregate_research";
  accountBinding: PublicResearchInsightsAccountBinding; capturePolicyHash: string;
};
export const ETSY_INSIGHTS_RESEARCH_LIMITS = Object.freeze({ source: "browser_visible_signed_in_aggregate", apiVerified: false, roundedCounts: "preserve_literal", reportingWindow: "preserve_literal", conversionBand: "statement_without_witnessed_scale", sameView: "one_observation_cluster", competitorSales: "unknown", competitorConversion: "unknown", buyerGeography: "not_inferred", zeroExposure: "no_invented_denominator", commercialDemandProven: false });
export function validatePublicResearchSourceAccess(raw: unknown, expected: { businessId: string; goalId: string; authorityRootId: string; testEnvelopeId?: string; testEnvelopeHash?: string }, now?: number): PublicResearchSourceAccess {
  if (exact(raw, "allowedSource,sourcePurpose") && raw.allowedSource === "etsy_public_browser" && raw.sourcePurpose === "public_marketplace_research") return structuredClone(raw) as PublicResearchSourceAccess;
  if (!exact(raw, "allowedSource,sourcePurpose,accountBinding,capturePolicyHash") || raw.allowedSource !== "etsy_authenticated_insights" || raw.sourcePurpose !== "etsy_insights_aggregate_research" || !hash(raw.capturePolicyHash)) return fail();
  if (!exact(raw.accountBinding, "version,businessId,goalId,authorityRootId,purpose,testEnvelopeId,testEnvelopeHash,providerProjectId,profileBindingId,profileBindingRevision,approvalId,approvalRevision,disclosureHash,handoffReceiptHash,profileCandidateHash,accountVerificationHash,verifiedContextHash,observedShopName,observedShopId,verifiedAt,expiresAt,bindingHash")) return fail();
  const b = raw.accountBinding as unknown as PublicResearchInsightsAccountBinding;
  if (b.version !== "r12.etsy-insights-account-binding.1" || b.purpose !== "etsy_insights_read_only" || ![b.businessId,b.goalId,b.authorityRootId,b.testEnvelopeId,b.providerProjectId,b.profileBindingId,b.approvalId].every(uuid) || ![b.testEnvelopeHash,b.disclosureHash,b.handoffReceiptHash,b.profileCandidateHash,b.accountVerificationHash,b.verifiedContextHash].every(hash) || ![b.profileBindingRevision,b.approvalRevision].every(uuid) || !text(b.observedShopName, 120) || (b.observedShopId !== null && !/^[1-9][0-9]{0,20}$/.test(b.observedShopId)) || time(b.expiresAt) <= time(b.verifiedAt)) return fail();
  for (const key of ["businessId","goalId","authorityRootId","testEnvelopeId","testEnvelopeHash"] as const) if (expected[key] !== undefined && b[key] !== expected[key]) return fail();
  if (now !== undefined && (!Number.isFinite(now) || time(b.verifiedAt) > now || time(b.expiresAt) <= now)) return fail();
  verifyPublicSelfHash(raw.accountBinding, "bindingHash"); return structuredClone(raw) as PublicResearchSourceAccess;
}
