import { randomUUID } from "node:crypto";
import { CREATIVE_BUDGET, fetchCreativeModelQuote } from "./budget";
import { OpenRouterImageAdapter } from "./image-provider";
import { MAX_CREATIVE_PNG_BYTES, SCREEN_CATEGORIES, type CreativeApprovalSnapshot, type CreativeGenerationLimit, type PrintSpecification } from "./types";

export const CREATIVE_PROVIDER_TERMS = "https://www.recraft.ai/legal/developer-terms";
export type CreativeDesignInput = { concept: string; audience: string; designInstructions: string };
export const TECHNICAL_HYPOTHESIS = "Technical creative qualification only. The purpose is to test generation, storage and independent visual review; buyer demand, margin and commercial viability remain unvalidated.";
export const TECHNICAL_PRINT_SPECIFICATION: PrintSpecification = {
  provider: "printful", product: "Unisex Staple T-Shirt | Bella + Canvas 3001, size L", garment: "Cotton T-shirt, Bella + Canvas 3001 size L",
  placement: "large_front", sourceUrl: "https://help.printful.com/hc/en-us/articles/50263171283217-What-should-I-know-about-the-standard-15-18-print-placement-for-DTG-products",
  sourceExcerpt: "Unisex Staple T-Shirt | Bella + Canvas 3001 (sizes L, XL, 2XL, 3XL, 4XL, 5XL)",
  verifiedAt: "2026-09-30T10:36:00.000Z", maximumWidthInches: 15, maximumHeightInches: 18, designWidthInches: 6.5, designHeightInches: 6.5,
  minimumDpi: 150, colorSpace: "srgb", background: "opaque", maximumBytes: MAX_CREATIVE_PNG_BYTES,
};
export function technicalCreativeApproval(businessId: string, candidateId: string, maximumMicrousd: number, design: CreativeDesignInput, approvalId: string = randomUUID(), maximumGenerations: CreativeGenerationLimit = 2): CreativeApprovalSnapshot {
  if (![1, 2].includes(maximumGenerations)) throw new Error("Creative generation limit must be one or two.");
  const now = Date.now();
  return { approvalId, businessId, candidateId, decisionId: null, purpose: "technical_qualification", concept: design.concept,
    audience: design.audience, designInstructions: design.designInstructions, candidateAssessment: null, originalDesign: true,
    rightsStatement: "The owner approves this original creative intent without supplied reference artwork. This records the owner's instruction, not a guarantee of universal non-infringement. Any unclear protected content must stop for review.",
    rightsConfirmed: true, policyScreen: SCREEN_CATEGORIES.map(category => ({ category, status: "clear",
      rationale: category === "marketplace_policy" ? "Technical image creation only; original seller-directed AI design with disclosure retained. No listing or merchandise publication is authorized."
        : "The owner confirms their original creative intent excludes named brands, likenesses, protected characters, logos and copied reference artwork. The exact final brief still requires independent screening before generation.",
      sourceUrls: ["https://www.etsy.com/legal/creativity/", CREATIVE_PROVIDER_TERMS] })),
    printSpecification: structuredClone(TECHNICAL_PRINT_SPECIFICATION), approvedBy: "owner", approvedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 7 * 86400000).toISOString(), maximumMicrousd, maximumGenerations, publicationAllowed: false };
}
export async function currentCreativeQuote(maximumGenerations: CreativeGenerationLimit = 2) {
  if (![1, 2].includes(maximumGenerations)) throw new Error("Creative generation limit must be one or two.");
  const [image, director, reviewer] = await Promise.all([new OpenRouterImageAdapter().preflight({ prompt: "Pricing check for one owner-approved original design; no image generation is requested by this preflight." }),
    fetchCreativeModelQuote("openai/gpt-5.6-luna"), fetchCreativeModelQuote("anthropic/claude-haiku-4.5")]);
  const maxText = CREATIVE_BUDGET.maximumTextRequestBytes + CREATIVE_BUDGET.formattingTokenAllowance;
  const maximaMicrousd = {
    brief: Math.ceil(maxText * (director.inputPerMillion + director.cacheWritePerMillion) + CREATIVE_BUDGET.briefOutputTokens * director.outputPerMillion),
    screen: Math.ceil(maxText * (reviewer.inputPerMillion + reviewer.cacheWritePerMillion) + CREATIVE_BUDGET.reviewOutputTokens * reviewer.outputPerMillion),
    generation: image.estimatedMicrousd,
    review: Math.ceil((maxText + CREATIVE_BUDGET.imageTokenAllowance) * (reviewer.inputPerMillion + reviewer.cacheWritePerMillion) + CREATIVE_BUDGET.reviewOutputTokens * reviewer.outputPerMillion),
  };
  return { version: CREATIVE_BUDGET.version, verifiedAt: new Date().toISOString(), sourceUrls: [CREATIVE_BUDGET.pricingSource, image.source, CREATIVE_PROVIDER_TERMS],
    generatorModel: image.modelId, directorModel: director.modelId, reviewerModel: reviewer.modelId, maximaMicrousd,
    maximumEstimateMicrousd: maximaMicrousd.brief + maximaMicrousd.screen + maximumGenerations * (maximaMicrousd.generation + maximaMicrousd.review),
    maximumCalls: 2 + 2 * maximumGenerations, estimateOnly: true, providerInvoiceGuarantee: false };
}
