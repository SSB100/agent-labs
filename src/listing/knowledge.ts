import type { JsonObject } from "../core/contracts";
import { hash, requireEtsy } from "../etsy/contracts";
import type { PackManifest } from "../packs/types";

export const LISTING_KNOWLEDGE_KEY = "etsy.listing-review";
const VERSION = "1.0.0";
const VERIFIED_AT = "2026-10-01T09:54:00Z";
const FRESHNESS_DAYS = 30;
const urls = {
  create: "https://help.etsy.com/hc/en-us/articles/115015628707-How-to-Create-a-Listing",
  titles: "https://www.etsy.com/seller-handbook/article/1399426136697",
  keywords: "https://www.etsy.com/seller-handbook/article/382774281517",
  tags: "https://help.etsy.com/hc/en-us/articles/360000336307-How-to-Use-Tags-to-Get-Found-in-Search",
  attributes: "https://help.etsy.com/hc/en-us/articles/115014502508-How-to-Use-Attributes-When-Listing-an-Item",
  anatomy: "https://www.etsy.com/seller-handbook/article/1347574487014",
  images: "https://www.etsy.com/legal/policy/listing-image-requirements/253962679005",
  creativity: "https://www.etsy.com/legal/creativity/",
  partners: "https://help.etsy.com/hc/en-us/articles/360000336547-Working-with-Production-Partners-on-Etsy",
} as const;

type Kind = "platform_rule" | "guidance" | "implementation_inference";
function guideline(id: string, kind: Kind, source: keyof typeof urls, statement: string): JsonObject {
  return { id, kind, sourceUrl: urls[source], statement };
}
function source(key: keyof typeof urls, title: string, displayedDate?: string): JsonObject {
  return { title, url: urls[key], publisher: "Etsy", verifiedAt: VERIFIED_AT,
    ...(displayedDate ? { publishedUpdatedAt: displayedDate } : { dateStatus: "No publication/update date observed." }) };
}

/** A new pinned release; historical Etsy knowledge packs are not rewritten.
 * A fresh object tree prevents a caller's edits from changing the canonical pin. */
export function listingKnowledgePackManifest(): PackManifest {
  return {
    frameworkVersion: "1.0", packKey: "knowledge.etsy-listing-review", version: VERSION,
    name: "Etsy listing review", kind: "knowledge",
    description: "Dated Etsy listing rules, SEO guidance, and fact-bound application safeguards.", dependencies: [],
    ui: { category: "Etsy / print on demand", summary: "Review accurate copy, disclosures, attributes, and finished-product imagery.", supportedBusinessTypes: ["etsy", "print-on-demand"] },
    evals: ["manifest", "provenance", "freshness", "scope"], capabilities: [], workers: [], workflows: [],
    knowledge: [{ key: LISTING_KNOWLEDGE_KEY, version: VERSION, name: "Etsy listing review",
      source: urls.create, verifiedAt: VERIFIED_AT, freshnessDays: FRESHNESS_DAYS,
      content: {
        guidance: "Improve clarity using verified product facts; preserve applicable disclosures and image eligibility. Missing evidence stays unresolved.",
        attribution: "platform_rule paraphrases a stated Etsy requirement; guidance is advisory; implementation_inference is this application's safeguard, not an Etsy rule.",
        guidelines: [
          guideline("title-limit", "platform_rule", "create", "Titles can contain at most 140 characters."),
          guideline("tag-limits", "platform_rule", "tags", "At most 13 tags, each at most 20 characters."),
          guideline("clear-titles", "guidance", "titles", "Name the product clearly with important factual traits first; avoid repetition, subjective praise, and price/shipping language. Fewer than 15 words is a suggestion, not a hard limit. Include occasions/recipients only when essential to the product."),
          guideline("natural-description", "guidance", "keywords", "Use relevant terms naturally in opening sentences, not a copied title or keyword list. Include useful product details and accurate descriptors; misleading material or other factual claims are unacceptable."),
          guideline("relevant-tags-attributes", "guidance", "keywords", "Prefer diverse multiword tags and a specific accurate category. Categories and attributes also help query matching, so avoid redundant exact-match tags. Do not invent claims just to fill 13 slots."),
          guideline("supported-attributes", "platform_rule", "attributes", "Available attributes depend on category. Material/material-feature claims must be accurate, not misleading, and supported by sufficient information; retain records and relevant certification support."),
          guideline("image-eligibility", "platform_rule", "images", "Use accurate finished-product photos with necessary image rights. A partner printing original artwork/patterns onto a base item permits a stock-photo mockup showing that end product. A uniquely designed physical item manufactured by a partner needs a real finished-product photo."),
          guideline("personalized-lead-image", "platform_rule", "images", "A personalized listing's first image must show a real finished customized example similar to the offered item, not a blank or placeholder-text mockup. Additional mockups may illustrate customization options."),
          guideline("image-order", "guidance", "anatomy", "Use a clear first thumbnail; avoid overlays/collages there. Additional angles, detail, scale, and product-in-use images can inform buyers. Etsy does not prescribe this application's exact image sequence."),
          guideline("partner-disclosure", "platform_rule", "partners", "Disclose applicable production assistance on the listing and accurately represent shipping origin. Do not substitute invented partner details or location for missing evidence."),
          guideline("ai-disclosure", "platform_rule", "creativity", "Disclose in the listing description when the item was created using AI. Seller-prompted AI creations may qualify; eligibility still depends on applicable standards and rights."),
          guideline("fact-bound-copy", "implementation_inference", "attributes", "Every factual copy/attribute claim must trace to supplied verified evidence. Do not infer material, dimensions, care, variants, certification, origin, availability, delivery promises, or rights from artwork. Keep unresolved facts as needs-evidence; do not change immutable product terms."),
          guideline("finished-product-evidence", "implementation_inference", "images", "Never relabel a raw design PNG as a product mockup. Require reviewed image evidence bound to the actual asset and product facts and showing the finished product. An image plan, filename, or file format does not establish eligibility."),
          guideline("adapter-image-bound", "implementation_inference", "create", "This application's Stage16 adapter accepts at most 10 reviewed images. This is an application bound, not Etsy's platform maximum: the Help page retrieved for this snapshot says up to 20 photos."),
          guideline("disclosure-preservation", "implementation_inference", "creativity", "Preserve all applicable verified production-partner and AI disclosures. A draft paragraph is not proof the partner was configured or the item meets marketplace rules. AI-assisted copy alone is not evidence that the item was AI-created."),
          guideline("bounded-review", "implementation_inference", "keywords", "Schema validity is not semantic approval. Check factual support, image order and disclosures independently. No ranking, conversion, sales, profit, legal clearance, or readiness-to-publish promises; this snapshot grants no execution authority."),
        ],
        sources: [source("create", "How to Create a Listing"), source("titles", "New Guidance for Listing Titles", "2026-04-27"),
          source("keywords", "Keywords 101", "2025-08-26"), source("tags", "How to Use Tags to Get Found in Search"),
          source("attributes", "How to Use Attributes When Listing an Item"), source("anatomy", "The Anatomy of a Well-Crafted Etsy Listing", "2025-08-26"),
          source("images", "Listing Image Requirements", "2024-07-09"), source("creativity", "Etsy's Creativity Standards", "2025-06-10"),
          source("partners", "Working with Production Partners on Etsy")],
        verification: { method: "Public Etsy primary-source pages retrieved and reviewed; no accounts, providers, products, or market metrics inspected.", verifiedAt: VERIFIED_AT,
          interpretation: "Displayed article/update dates are not independently established effective dates. Keywords 101 also labels its advice as of August 2025. Undated Help pages are retrieval snapshots, not historical policy proof." },
        sourceDateAnomaly: { observedAt: VERIFIED_AT, displayedLastUpdated: "2026-10-05",
          excludedSourceUrls: ["https://www.etsy.com/legal/sellers/", "https://www.etsy.com/legal/fees/"],
          note: "Both pages displayed future last-updated dates on this review. Exclude their current text as evidence of rules effective today; the mismatch remains unresolved. Reverify applicable versions before consequential use." },
        limitations: ["Thirty days is the maximum review interval, not a guarantee policies will remain unchanged. Reject stale or future-verified knowledge.",
          "No specific listing, intellectual-property rights, physical sample, jurisdiction, cost, demand, or provider readback was verified. Advisory optimization is not promised performance."],
        executionBoundary: "Bounded drafting and independent review only; no tool/provider calls, account changes, uploads, publishing, purchases, or spending are authorized by this knowledge.",
      } }],
  };
}

export function assertListingKnowledgeFresh(now = Date.now()): void {
  const verified = Date.parse(VERIFIED_AT);
  requireEtsy(Number.isFinite(now) && Number.isFinite(verified), "stale_listing_knowledge");
  requireEtsy(verified <= now, "listing_knowledge_not_yet_verified");
  requireEtsy(now < verified + FRESHNESS_DAYS * 86_400_000, "stale_listing_knowledge");
}

/** Hash metadata, provenance, content, and freshness together, not just prose. */
export function listingKnowledgeHash(): string {
  return hash(listingKnowledgePackManifest().knowledge[0]);
}
