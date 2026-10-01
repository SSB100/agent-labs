import type { JsonObject } from "../core/contracts";
import { hash, requireEtsy, validatePackage, UUID, SHA256, type EtsyProductPackage } from "../etsy/contracts";
import { assertJsonSchemaValue } from "../workers/schema-validator";

export const LISTING_VERSION = "1.0.0";
export const LISTING_DIMENSIONS = ["title", "description", "tags", "attributes", "imageOrder", "disclosures", "factualClaims"] as const;
export type ListingDimension = typeof LISTING_DIMENSIONS[number];
export type ListingSource = { id: string; businessId: string; recordId: string; recordType: "printful_receipt" | "creative_approval" | "business_approval";
  snapshot: JsonObject; snapshotHash: string; verifiedAt: string };
export type ListingFact = { id: string; statement: string; kind: "product" | "production" | "shipping" | "rights";
  evidence: { sourceId: string; pointer: string }[] };
export type ListingImageEvidence = { assetId: string; sha256: string; productFactsHash: string; kind: "finished_product_mockup" | "finished_product_photo" | "raw_artwork";
  finishedProductShown: boolean; reviewArtifactId: string; reviewedAt: string; altText: string; reviewResultHash: string;
  reviewResult: { businessId: string; outcome: "PASS" | "FAIL" | "NEEDS_EVIDENCE"; observedProduct: string;
    productMatches: boolean; finishedProductShown: boolean; imageRightsVerified: boolean } };

export type ListingInput = {
  version: "1.0.0"; evidenceMode: "synthetic" | "live"; product: EtsyProductPackage;
  facts: ListingFact[]; sources: ListingSource[]; factsVerifiedAt: string;
  productType: "original_design_on_base_product" | "custom_manufactured" | "personalized"; aiAssisted: boolean;
  disclosures: { key: "production_partner" | "ai"; text: string; factIds: string[] }[];
  imagery: ListingImageEvidence[];
};
export type ListingCopy = { text: string; factIds: string[] };
export type ListingProposal = {
  version: "1.0.0"; title: ListingCopy; description: ListingCopy[]; tags: ListingCopy[];
  attributes: Pick<EtsyProductPackage, "taxonomyId" | "materials" | "properties">;
  imageOrder: string[]; disclosureKeys: ("production_partner" | "ai")[];
};
export type ListingReview = {
  version: "1.0.0"; verdict: "APPROVE" | "REJECT" | "NEEDS_EVIDENCE";
  checks: Record<ListingDimension, { status: "passed" | "failed" | "needs_evidence"; rationale: string }>;
};
export const objectSchema = (properties: Record<string, JsonObject>): JsonObject => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const text = (min: number, max: number): JsonObject => ({ type: "string", minLength: min, maxLength: max });
const array = (items: JsonObject, min: number, max: number): JsonObject => ({ type: "array", minItems: min, maxItems: max, items });
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key,item]) => [key,canonical(item)]));
  return value;
}
const readableText = (value: unknown, min: number, max: number) => typeof value === "string" && value.trim() === value && value.length >= min && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const factIdSchema = { type: "string", pattern: "^[a-z][a-z0-9-]{0,39}$" };
const copySchema = (max: number, ids?: string[]) => objectSchema({ text: { ...text(1, max), description: "Nonblank, trimmed plain text without control characters; every claim must follow from the cited facts." }, factIds: { ...array(ids ? { type: "string", enum: ids } : factIdSchema, 1, 8), uniqueItems: true } });
/** One finite schema is used both for provider projection and local validation.
 * Dynamic enums/consts expose the same immutable fact/attribute/image constraints. */
export function listingProposalSchema(input?: ListingInput): JsonObject {
  const ids = input?.facts.map(f => f.id);
  return objectSchema({ version: { const: LISTING_VERSION }, title: copySchema(140, ids), description: array(copySchema(900, ids), 1, 8),
    tags: array(copySchema(20, ids), 1, 13), attributes: input ? { const: canonical(listingAttributes(input.product)) as JsonObject } : objectSchema({ taxonomyId: { type: "integer", minimum: 1 }, materials: array(text(1,45),0,13), properties: { type: "array", maxItems: 30, items: { type: "object" } } }),
    imageOrder: { ...array(input ? { type: "string", enum: input.product.images.map(i => i.assetId) } : { type: "string", format: "uuid" }, input?.product.images.length ?? 1, input?.product.images.length ?? 10), uniqueItems: true },
    disclosureKeys: input ? { const: input.disclosures.map(d => d.key) } : { ...array({ enum: ["production_partner", "ai"] },1,2), uniqueItems: true } });
}
export const LISTING_PROPOSAL_SCHEMA = listingProposalSchema();
export const LISTING_REVIEW_SCHEMA = objectSchema({ version: { const: LISTING_VERSION }, verdict: { enum: ["APPROVE", "REJECT", "NEEDS_EVIDENCE"] },
  checks: objectSchema(Object.fromEntries(LISTING_DIMENSIONS.map(d => [d, objectSchema({ status: { enum: ["passed", "failed", "needs_evidence"] }, rationale: { ...text(30,400), description: "30–400 nonblank, trimmed characters without control characters: name the concrete checked evidence or exact mismatch/missing fact. Schema validity is not semantic approval." } })]))) });
export function listingAttributes(p: EtsyProductPackage) { return { taxonomyId: p.taxonomyId, materials: p.materials, properties: p.properties }; }
/** Future verified product executors must hash this exact snapshot from actual
 * provider readback and approved business/creative records, never owner JSON. */
export function listingFactsHash(input: ListingInput) {
  const p = input.product;
  return hash({ productIdentity: p.productIdentity, facts: input.facts, sources: input.sources, attributes: listingAttributes(p), quantity: p.quantity, priceMinor: p.priceMinor,
    currency: p.currency, shippingProfileId: p.shippingProfileId, readinessStateId: p.readinessStateId, productionPartnerIds: p.productionPartnerIds,
    productType: input.productType, aiAssisted: input.aiAssisted, disclosures: input.disclosures });
}
export function listingImageReviewHash(proof: ListingImageEvidence) {
  const { reviewResultHash: _ignored, ...bound } = proof;
  void _ignored;
  return hash(bound);
}
/** A bounded JSON pointer resolves against the included source snapshot. The
 * trusted producer must authenticate that snapshot against its durable record. */
export function listingEvidenceValue(source: ListingSource, pointer: string) {
  requireEtsy(typeof pointer === "string" && /^\/(?:[^~]|~[01])+$/.test(pointer) && pointer.length <= 160, "invalid_listing_source_pointer");
  let value: unknown = source.snapshot;
  for (const segment of pointer.slice(1).split("/")) {
    const key = segment.replace(/~1/g,"/").replace(/~0/g,"~");
    requireEtsy(!["__proto__","constructor","prototype"].includes(key) && value !== null && typeof value === "object" && Object.hasOwn(value,key), "unresolved_listing_source_pointer");
    value = (value as Record<string,unknown>)[key];
  }
  requireEtsy(value !== null && value !== undefined && JSON.stringify(value).length <= 2000, "invalid_listing_source_value");
  return value;
}
function fresh(timestamp: string, now: number) { const at = Date.parse(timestamp); return Number.isFinite(at) && at <= now && now-at < 86_400_000; }
export function validateListingInput(input: ListingInput, now = Date.now()) {
  requireEtsy(input?.version === LISTING_VERSION && ["synthetic", "live"].includes(input.evidenceMode), "invalid_listing_input");
  validatePackage(input.product, input.product.businessId, now);
  requireEtsy(Number.isFinite(now) && fresh(input.factsVerifiedAt, now), "stale_listing_facts");
  requireEtsy(["original_design_on_base_product", "custom_manufactured", "personalized"].includes(input.productType) && typeof input.aiAssisted === "boolean", "invalid_listing_product_type");
  requireEtsy(Array.isArray(input.facts) && input.facts.length >= 1 && input.facts.length <= 40 && new Set(input.facts.map(f => f.id)).size === input.facts.length, "invalid_listing_facts");
  for (const fact of input.facts) requireEtsy(/^[a-z][a-z0-9-]{0,39}$/.test(fact.id) && readableText(fact.statement,1,600) && ["product", "production", "shipping", "rights"].includes(fact.kind), "invalid_listing_fact");
  requireEtsy(Array.isArray(input.sources) && input.sources.length >= 1 && input.sources.length <= 12 && new Set(input.sources.map(s => s.id)).size === input.sources.length, "listing_source_evidence_required");
  for (const source of input.sources) {
    requireEtsy(UUID.test(source.id) && UUID.test(source.recordId) && source.businessId === input.product.businessId &&
      ["printful_receipt","creative_approval","business_approval"].includes(source.recordType) && fresh(source.verifiedAt,now) &&
      source.snapshot && typeof source.snapshot === "object" && !Array.isArray(source.snapshot) && Buffer.byteLength(JSON.stringify(source.snapshot),"utf8") <= 6000 &&
      source.snapshotHash === hash(source.snapshot), "invalid_listing_source_evidence");
    if (source.recordType === "printful_receipt") requireEtsy(source.recordId === input.product.printfulReceiptId, "listing_source_receipt_mismatch");
    if (source.recordType === "creative_approval") requireEtsy(source.recordId === input.product.creativeApprovalId, "listing_source_approval_mismatch");
  }
  requireEtsy(input.sources.some(s => s.recordType === "printful_receipt"), "listing_product_readback_required");
  for (const fact of input.facts) {
    requireEtsy(Array.isArray(fact.evidence) && fact.evidence.length >= 1 && fact.evidence.length <= 4 && new Set(fact.evidence.map(e => `${e.sourceId}:${e.pointer}`)).size === fact.evidence.length, "listing_fact_source_required");
    for (const evidence of fact.evidence) {
      const source=input.sources.find(s => s.id === evidence.sourceId);
      requireEtsy(source,"listing_fact_source_required"); listingEvidenceValue(source,evidence.pointer);
    }
  }
  const ids = input.facts.map(f => f.id);
  requireEtsy(Array.isArray(input.disclosures) && input.disclosures.length === (input.aiAssisted ? 2 : 1) && input.disclosures[0]?.key === "production_partner" && (!input.aiAssisted || input.disclosures[1]?.key === "ai"), "required_listing_disclosure");
  for (const d of input.disclosures) requireEtsy(readableText(d.text,10,500) && Array.isArray(d.factIds) && d.factIds.length > 0 && d.factIds.length <= 8 && d.factIds.every(id => ids.includes(id)) && new Set(d.factIds).size === d.factIds.length, "unsupported_listing_disclosure");
  requireEtsy(SHA256.test(input.product.productFactsHash) && input.product.productFactsHash === listingFactsHash(input), "listing_facts_hash_mismatch");
  requireEtsy(Array.isArray(input.imagery) && input.imagery.length === input.product.images.length && new Set(input.imagery.map(i => i.assetId)).size === input.imagery.length, "listing_image_evidence_required");
  for (const image of input.product.images) {
    const proof = input.imagery.find(i => i.assetId === image.assetId);
    requireEtsy(proof && proof.sha256 === image.sha256 && proof.productFactsHash === input.product.productFactsHash && UUID.test(proof.reviewArtifactId) && fresh(proof.reviewedAt,now) && proof.altText === image.altText, "listing_image_evidence_mismatch");
    requireEtsy(proof.finishedProductShown === true && ["finished_product_mockup", "finished_product_photo"].includes(proof.kind), "finished_product_image_required");
    requireEtsy(input.productType !== "custom_manufactured" || proof.kind === "finished_product_photo", "finished_product_photo_required");
    requireEtsy(proof.reviewResult && proof.reviewResultHash === listingImageReviewHash(proof) && proof.reviewResult.businessId === input.product.businessId &&
      proof.reviewResult.outcome === "PASS" && proof.reviewResult.productMatches === true && proof.reviewResult.finishedProductShown === true && proof.reviewResult.imageRightsVerified === true &&
      readableText(proof.reviewResult.observedProduct,40,1000), "resolved_listing_image_review_required");
  }
}
export function validateListingProposal(input: ListingInput, value: unknown, now = Date.now()): asserts value is ListingProposal {
  validateListingInput(input,now); assertJsonSchemaValue(listingProposalSchema(input),canonical(value),"Listing proposal");
  const output = value as ListingProposal;
  const copies = [output.title,...output.description,...output.tags];
  requireEtsy(copies.every(c => readableText(c.text,1,900)), "invalid_listing_copy");
  requireEtsy(new Set(output.tags.map(t => t.text.toLocaleLowerCase("en-US"))).size === output.tags.length, "duplicate_listing_tags");
  requireEtsy(output.imageOrder.length === input.imagery.length && input.imagery.every(i => output.imageOrder.includes(i.assetId)), "listing_image_order_mismatch");
  if (input.productType === "personalized") requireEtsy(input.imagery.find(i => i.assetId === output.imageOrder[0])?.kind === "finished_product_photo", "personalized_first_photo_required");
}
export function validateListingReview(value: unknown): asserts value is ListingReview {
  assertJsonSchemaValue(LISTING_REVIEW_SCHEMA,value,"Listing review"); const review = value as ListingReview, statuses = Object.values(review.checks).map(c => c.status);
  requireEtsy(Object.values(review.checks).every(c => readableText(c.rationale,30,400)), "invalid_listing_review_rationale");
  requireEtsy(review.verdict === (statuses.includes("failed") ? "REJECT" : statuses.includes("needs_evidence") ? "NEEDS_EVIDENCE" : "APPROVE"), "listing_review_verdict_mismatch");
}
/** Pure transformation only. This has no authority, persistence or API side effect. */
export function assembleListingProduct(input: ListingInput, output: ListingProposal, now = Date.now(), outputArtifactId = input.product.id): EtsyProductPackage {
  validateListingProposal(input,output,now);
  requireEtsy(UUID.test(outputArtifactId), "invalid_listing_output_identity");
  const product = { ...structuredClone(input.product), id: outputArtifactId, title: output.title.text,
    description: [...output.description.map(p => p.text),...input.disclosures.map(d => d.text)].join("\n\n"), tags: output.tags.map(t => t.text),
    images: output.imageOrder.map(id => structuredClone(input.product.images.find(i => i.assetId === id)!)) };
  validatePackage(product,product.businessId,now); return product;
}
