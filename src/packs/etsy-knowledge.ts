import type { JsonObject } from "../core/contracts";
import type { PackManifest } from "./types";

// A research snapshot, not a claim that these sources are continuously monitored.
const VERSION = "1.0.0";
const VERIFIED_AT = "2026-09-30T08:00:00Z";
const urls = {
  creativity: "https://www.etsy.com/legal/creativity/",
  partners: "https://help.etsy.com/hc/en-us/articles/360000336547-Working-with-Production-Partners-on-Etsy",
  resale: "https://help.etsy.com/hc/en-us/articles/23948763872151-Does-Etsy-Allow-Drop-Shipping-or-Reselling",
  images: "https://www.etsy.com/legal/policy/listing-image-requirements/253962679005",
  ip: "https://www.etsy.com/legal/ip/",
  fees: "https://help.etsy.com/hc/en-gb/articles/360035902374-Etsy-Fee-Basics",
  search: "https://www.etsy.com/uk/seller-handbook/article/how-etsy-search-works/375461474487",
  printFiles: "https://help.printful.com/hc/en-us/articles/50264019148177-How-should-I-prepare-my-print-file-for-the-best-results",
  delivery: "https://help.printful.com/hc/en-us/articles/50265132916241-What-s-the-estimated-delivery-time-and-how-is-it-calculated",
  returns: "https://help.printful.com/hc/en-us/articles/50263870468753-What-is-Printful-s-return-and-refund-policy",
  printContent: "https://help.printful.com/hc/en-us/articles/50263862632977-What-is-Printful-s-print-file-content-policy",
  insights: "https://help.etsy.com/hc/en-us/articles/35122361353239-How-Do-I-Use-Etsy-s-Marketplace-Insights-Tool",
  stats: "https://help.etsy.com/hc/en-us/articles/115015774268-How-to-Use-Etsy-Stats-for-Your-Shop",
  calendar: "https://www.etsy.com/seller-handbook/article/92185542466",
  promotion: "https://help.etsy.com/hc/en-us/articles/360035903014-How-to-Promote-Your-Etsy-Shop",
} as const;

type Guideline = {
  id: string;
  statement: string;
  sourceUrl: string;
  kind: "platform_rule" | "guidance" | "implementation_inference";
};

function guideline(id: string, kind: Guideline["kind"], sourceUrl: string, statement: string): Guideline {
  return { id, statement, sourceUrl, kind };
}

function source(title: string, url: string, publishedUpdatedAt?: string): JsonObject {
  return { title, url, publisher: url.includes("printful.com") ? "Printful" : "Etsy",
    verifiedAt: VERIFIED_AT, ...(publishedUpdatedAt ? { publishedUpdatedAt } : {}) };
}

function sourceDateAnomaly(): JsonObject {
  return {
    observedAt: VERIFIED_AT,
    displayedLastUpdated: "2026-10-05",
    excludedSourceUrls: ["https://www.etsy.com/legal/sellers/", "https://www.etsy.com/legal/fees/"],
    note: "Both retrieved pages displayed a last-updated date after this snapshot. Their current text is excluded as evidence of the rules in force on 2026-09-30. The date mismatch is unresolved; this pack does not infer an effective date from it.",
    action: "Reverify the applicable policy version before live selling or a binding policy decision; use the dated Creativity Standards and attributed Help Center guidance within their stated scope.",
  };
}

function knowledgePack(
  packKey: string, knowledgeKey: string, name: string, summary: string,
  primarySource: string, freshnessDays: number, content: JsonObject,
): PackManifest {
  return {
    frameworkVersion: "1.0", packKey, version: VERSION, name, kind: "knowledge",
    description: summary, dependencies: [],
    ui: { category: "Etsy / print on demand", summary, supportedBusinessTypes: ["etsy", "print-on-demand"] },
    evals: ["manifest", "provenance", "freshness", "scope"],
    capabilities: [], workers: [], workflows: [],
    knowledge: [{ key: knowledgeKey, version: VERSION, name, source: primarySource,
      verifiedAt: VERIFIED_AT, freshnessDays,
      content: {
        ...content,
        verification: {
          method: "Primary-source pages retrieved and reviewed for this research snapshot.",
          verifiedAt: VERIFIED_AT,
          interpretation: "Verification records retrieval and review, not legal clearance, market validation, or provider qualification. Recheck when stale and before consequential use.",
        },
        attribution: "Each guideline names its source. platform_rule paraphrases a stated platform or provider requirement; guidance paraphrases advisory material; implementation_inference is this application's recommendation, not a rule or claim made by the cited publisher.",
        executionBoundary: "Knowledge informs bounded research and simulation only. It grants no permission to publish listings, upload artwork, contact buyers, buy samples, change accounts, or spend money.",
      } }],
  };
}

export function etsyKnowledgePackManifests(): PackManifest[] {
  return [
    knowledgePack("knowledge.etsy-selling", "etsy.selling", "Etsy selling foundations",
      "Source-attributed listing, production-partner, search, and fee guidance for an Etsy seller.", urls.partners, 30, {
        guidance: "Build an accurate seller-designed product listing, disclose production assistance, and collect current country-specific costs before estimating viability. Search optimization is not a promise of sales.",
        guidelines: [
          guideline("production-partner-disclosure", "platform_rule", urls.partners,
            "Disclose qualifying production partners on relevant listings and provide accurate shipping-origin information; outsourcing fulfilment does not remove the seller's responsibility for an eligible product."),
          guideline("search-relevance", "guidance", urls.search,
            "Etsy search considers how well listing information matches a query and uses personalized ranking. Use accurate, relevant listing language; results vary between shoppers."),
          guideline("country-specific-fees", "guidance", urls.fees,
            "Etsy fees can include listing, transaction, payment-processing, advertising, and location-dependent charges. Applicable rates and taxes depend on the shop and transaction; inspect current official fee information."),
          guideline("margin-inputs", "implementation_inference", urls.fees,
            "Before estimating margin, record currency, seller country, product and shipping costs, applicable fees and taxes, discounts, advertising assumptions, and a returns allowance. Mark missing inputs unknown instead of assuming zero."),
          guideline("listing-review", "implementation_inference", urls.partners,
            "Prepare a review checklist covering the seller's design contribution, production partner, dispatch origin, product variants, materials, personalization, and realistic fulfilment expectations before any proposed listing is approved."),
        ],
        sources: [source("Working with Production Partners on Etsy", urls.partners),
          source("How Etsy Search Works", urls.search), source("Etsy Fee Basics", urls.fees)],
        sourceDateAnomaly: sourceDateAnomaly(),
        limitations: [
          "No shop account, current fee quote, product cost, or listing performance was inspected. This pack contains no hardcoded pricing calculator or profit forecast.",
          "The country-specific Help Center page is a starting point, not a complete fee schedule for every seller. Policies and fee applicability require rechecking for the actual transaction.",
          "Search guidance describes platform behavior, not a guaranteed ranking tactic. Product eligibility and imagery need the separate current-policy pack.",
        ],
      }),
    knowledgePack("knowledge.etsy-current-policy", "etsy.current-policy", "Etsy policy snapshot",
      "Bounded Etsy creativity, resale, image, AI-disclosure, and intellectual-property rules with source-date caveats.", urls.creativity, 30, {
        guidance: "Check the actual product's creativity category, rights, disclosures, and image requirements. POD is a production method, not blanket permission to resell ready-made products or use someone else's intellectual property.",
        guidelines: [
          guideline("original-design-eligibility", "platform_rule", urls.creativity,
            "A seller's original design may be produced by a disclosed production partner with accurate dispatch information. Etsy also recognizes buyer-personalized partner-produced items in its sourced-by-a-seller category."),
          guideline("ai-disclosure", "platform_rule", urls.creativity,
            "Seller-prompted AI creations can qualify under Etsy's Creativity Standards; sellers must disclose AI use in the listing description."),
          guideline("prompt-bundles-ineligible", "platform_rule", urls.creativity,
            "AI prompt bundles and collections of someone else's work do not qualify as designed-by-a-seller products under Etsy's Creativity Standards."),
          guideline("generic-resale-boundary", "platform_rule", urls.resale,
            "Generic ready-made resale does not become eligible seller-designed POD merely because a supplier ships it. Etsy's permitted resale and sourcing categories have specific requirements and exceptions."),
          guideline("imagery-on-base-products", "platform_rule", urls.images,
            "For original artwork or a pattern printed by a production partner onto a base product, Etsy permits a stock-photo mockup illustrating the finished product, subject to image rights and accurate representation."),
          guideline("imagery-custom-manufacture", "platform_rule", urls.images,
            "When a production partner manufactures the seller's uniquely designed physical item, Etsy requires a real photograph of the finished product."),
          guideline("imagery-personalized", "platform_rule", urls.images,
            "A personalized or customized listing's first image must show a real, finished customized item similar to what buyers receive, not a blank item or placeholder text. Additional mockups may illustrate options."),
          guideline("ip-rights-required", "platform_rule", urls.ip,
            "Sellers are responsible for obtaining necessary rights to their content and respecting intellectual property. Etsy does not determine or clear those rights for a seller."),
        ],
        sources: [source("Etsy's Creativity Standards", urls.creativity, "2025-06-10"),
          source("Does Etsy Allow Drop Shipping or Reselling?", urls.resale),
          source("Listing Image Requirements", urls.images, "2024-07-09"),
          source("Intellectual Property Policy", urls.ip)],
        sourceDateAnomaly: sourceDateAnomaly(),
        limitations: [
          "This is a narrow dated policy snapshot, not an exhaustive policy audit, legal advice, intellectual-property clearance, or approval of a specific listing.",
          "No particular design, trademark, font, photograph, licence, prohibited-item category, seller jurisdiction, or buyer jurisdiction has been cleared. Escalate unresolved rights or eligibility questions.",
          "A mockup permission depends on the product category; do not apply the printed-base-product exception to all manufactured or personalized products.",
          "A 30-day freshness window is a maximum review interval, not a promise that policies cannot change sooner. Resolve the source-date anomaly before relying on the excluded pages.",
        ],
      }),
    knowledgePack("knowledge.print-on-demand", "pod.production", "Print-on-demand production",
      "Printful-attributed production preparation, delivery, returns, and rights constraints for bounded POD planning.", urls.printFiles, 30, {
        guidance: "Select a specific provider, SKU, print method, and destination before checking artwork or estimating fulfilment. Validate a sample and distinguish provider coverage from the seller's obligations to customers.",
        guidelines: [
          guideline("per-product-print-files", "guidance", urls.printFiles,
            "Printful recommends sRGB artwork and typically 150–300 DPI, but dimensions, print area, file format, and resolution depend on the product and technique. Follow the selected product's file guidelines rather than a universal template."),
          guideline("delivery-estimates", "guidance", urls.delivery,
            "Printful estimates delivery by combining fulfilment time and shipping time. These are estimates affected by production, destination, carriers, and delays, not guaranteed arrival dates."),
          guideline("provider-returns", "platform_rule", urls.returns,
            "Printful generally excludes buyer-remorse and wrong-size or wrong-color returns, while qualifying damaged, defective, misprinted, or lost orders may receive a refund or reshipment. Check claim deadlines, evidence requirements, and jurisdictional exceptions."),
          guideline("provider-content-rights", "platform_rule", urls.printContent,
            "Content submitted to Printful must meet its content rules, and the uploader must have the rights needed to use, reproduce, and sell the design. Provider acceptance is not intellectual-property clearance."),
          guideline("sample-quality-gate", "implementation_inference", urls.printFiles,
            "Before recommending launch, propose a sample check of print legibility, placement, color, garment or object quality, and packaging for the selected SKU. A mockup or valid file alone does not establish physical quality."),
          guideline("cost-inputs", "implementation_inference", urls.delivery,
            "Capture dated SKU and destination-specific production and shipping quotes, currency, taxes, and contingency assumptions. If these inputs are absent, return an uncosted concept instead of inventing a selling price or margin."),
        ],
        sources: [source("How should I prepare my print file for the best results?", urls.printFiles),
          source("What's the estimated delivery time, and how is it calculated?", urls.delivery),
          source("What is Printful's return and refund policy?", urls.returns),
          source("What is Printful's print file content policy?", urls.printContent)],
        limitations: [
          "These provider-specific findings are about Printful and must not be represented as the policies of every POD supplier.",
          "No SKU, stock availability, price, live shipping quote, production facility, artwork file, or physical sample was evaluated.",
          "A supplier's return coverage does not establish the seller's consumer-law or marketplace obligations. Check the seller and buyer jurisdictions separately before setting customer terms.",
          "This pack does not authorize sample purchases, artwork uploads, provider account connections, or customer delivery promises.",
        ],
      }),
    knowledgePack("knowledge.product-research", "product.research", "Evidence-led product research",
      "Methods for separating observed Etsy signals, user inputs, estimates, and testable product hypotheses.", urls.insights, 30, {
        guidance: "Collect dated evidence before claiming demand. Keep observations, user inputs, estimates, and hypotheses separate; a plausible product concept remains unvalidated until relevant demand and cost evidence exists.",
        guidelines: [
          guideline("insights-window", "guidance", urls.insights,
            "Etsy Marketplace Insights provides keyword search and listing counts and trend information for the past 30 days. Preserve the metric name and period when reporting a result."),
          guideline("prohibited-query-results", "platform_rule", urls.insights,
            "Marketplace Insights may show searches for items that are not allowed on Etsy. A visible keyword does not grant permission to sell the item or use that term in a listing."),
          guideline("stats-measures", "guidance", urls.stats,
            "Etsy Stats distinguishes visits, listing views, orders, conversion rate, and revenue. Use the displayed definitions and reporting period; these metrics describe different things and must not be interchanged."),
          guideline("evidence-record", "implementation_inference", urls.insights,
            "For each demand observation retain the source URL, observation date, exact query, metric, reported value, time window, scope, and limitations. Missing or inaccessible evidence is unknown, not zero demand."),
          guideline("hypotheses-not-sales", "implementation_inference", urls.insights,
            "Search or listing counts can inform a product hypothesis but do not prove purchases, conversion, profit, intellectual-property rights, or future demand. Label estimates and synthetic examples explicitly; do not invent observations."),
          guideline("ranking-not-demand", "implementation_inference", urls.search,
            "Because search results are personalized and ranked, a listing's observed position is not a representative sales or demand measure. Treat a result-page sample as a limited observation with recorded context."),
        ],
        sources: [source("How Do I Use Etsy's Marketplace Insights Tool?", urls.insights),
          source("How to Use Etsy Stats for Your Shop", urls.stats), source("How Etsy Search Works", urls.search)],
        evidenceCategories: ["observation", "user_input", "estimate", "hypothesis"],
        demandObservations: [],
        observationStatus: "No marketplace keyword results, shop statistics, sales data, or competitor-demand observations were collected for this pack.",
        limitations: [
          "The cited documents explain research tools; they are not evidence that any particular niche or product has demand.",
          "A proposed test needs a defined audience, measurement window, success criterion, and budget if spending is contemplated. These are implementation choices, not Etsy requirements.",
          "Do not fabricate competitor sales, search volumes, conversion rates, profitability, or causal explanations. Revenue is not a profit measure.",
        ],
      }),
    knowledgePack("knowledge.social-marketing", "social.marketing", "Sustainable social marketing",
      "Durable, attributed content-planning principles and measurement guardrails for an Etsy shop.", urls.calendar, 90, {
        guidance: "Plan useful content at a sustainable pace, make the product and buying details clear, and test channel-specific ideas with explicit metrics. Social attention alone does not establish product demand or sales.",
        guidelines: [
          guideline("sustainable-calendar", "guidance", urls.calendar,
            "Use an editorial calendar to plan content types, channels, and dates. Choose a consistent pace that the seller can sustain and leave time for responding to the audience."),
          guideline("process-content", "guidance", urls.calendar,
            "Balance product promotion with useful or behind-the-scenes content, and adapt captions to the audience and channel instead of mechanically repeating the same message everywhere."),
          guideline("promotion-channels", "guidance", urls.promotion,
            "Before promoting a listing, describe the item accurately, use clear photos, and communicate shipping and purchasing details. Social updates may highlight new products, shop milestones, or relevant promotions."),
          guideline("bounded-content-test", "implementation_inference", urls.calendar,
            "Draft a small content test with a stated audience, message, channel, cadence, observation window, and success measure. Use a sustainable schedule as an assumption to test, not a universal optimal posting frequency."),
          guideline("engagement-not-sales", "implementation_inference", urls.stats,
            "Keep reach, likes, saves, and clicks distinct from shop visits, orders, and revenue. Without suitable attribution, do not claim a post caused purchases or that engagement predicts profitable demand."),
        ],
        sources: [source("How to Create an Editorial Calendar for Your Blog and Social Media", urls.calendar),
          source("How to Promote Your Etsy Shop", urls.promotion), source("How to Use Etsy Stats for Your Shop", urls.stats)],
        limitations: [
          "Retains durable planning principles only. Dated article examples do not establish current social-platform algorithms, optimal posting times, interface steps, or integration availability.",
          "No audience, social account, channel analytics, advertising price, or campaign result was inspected; no growth or sales outcome is guaranteed.",
          "Prepare drafts for review only. Publishing, paid campaigns, promotions, buyer-data reuse, and customer-image reuse need separate authorization and applicable rights checks.",
        ],
      }),
  ];
}
