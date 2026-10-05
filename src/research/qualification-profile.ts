import { publicResearchHash, R11_RESTRICTED_SOURCE_DOMAINS } from "./qualification";

/** Proposed first proof only. No field here is access or spending authority.
 * Later reviewed tasks may choose another useful question and source policy. */
const review = {
  version: "r11.public-source-review.1", reviewedOn: "2026-10-05",
  domain: "spiegel.medill.northwestern.edu",
  source: "https://spiegel.medill.northwestern.edu/mothersday2026/",
  copyrightGuidance: "https://www.northwestern.edu/web-resources/website-guidelines/nuinfo-content-guidelines/",
  apiUse: "https://exa.ai/docs/integrations/openrouter",
  searchPurpose: "https://exa.ai/docs/search/data/news",
  retentionDisclosure: "https://exa.ai/privacy-policy",
  basis: "documented_api_factual_snippets",
  finding: "Publicly readable original university analysis; no applicable site-specific AI or automated-research prohibition found in the reviewed sources. This is a narrow factual-snippet assessment, not a publisher license or an open-content assertion.",
  context: "Retain each survey's occasion, population, date and denominator. The Mother's Day figures must not be generalized to every gift purchase.",
  excludedClaim: "An unrelated experience-gifting year-over-year comparison in the executive summary appears inconsistent; do not use that comparison as proof.",
} as const;
export const PUBLIC_RESEARCH_PROOF_PROFILE = {
  version: "r11.public-proof-profile.1",
  query: "What do publicly reported 2025-2026 adult-consumer surveys say about the relative importance of gift uniqueness, creating memories, convenience, and price when choosing gifts? Keep each survey's occasion, dates, and population explicit.",
  allowedDomains: [review.domain],
  excludedDomains: [...R11_RESTRICTED_SOURCE_DOMAINS, "nrf.com", "printify.com"],
  sourceReviews: [{ domain: review.domain, basis: review.basis, reviewHash: publicResearchHash(review) }],
  termsReviewHash: publicResearchHash({ version: review.version, apiUse: review.apiUse, searchPurpose: review.searchPurpose,
    copyrightGuidance: review.copyrightGuidance, retentionDisclosure: review.retentionDisclosure, finding: review.finding, reviewedOn: review.reviewedOn }),
  review,
} as const;
