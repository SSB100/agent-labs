import { containsCredentialLikeContent } from "../../core/quest-intake";

/** Browser-only presentation state. None of this grants research authority. */
export const QUEST_DRAFT_VERSION = 1;
export const QUEST_DEFAULT_GOAL = "Research the best-supported starting geographic market for original nature T-shirts, recommend up to three concepts, and prepare the strongest for review.";
export const QUEST_MARKET_SCOPE = "Compare the United States, United Kingdom, Australia and New Zealand as a bounded English-language starting set. Check dated marketplace observations, delivered prices and fulfilment constraints separately; this is not a claim about every possible market.";

// Structural match to DiscoveryQuotePreview without importing its server component.
export type QuestQuotePreview = { one: number; two: number; analysis?: number; verifiedAt: string } | null;
export type QuestStep = 0 | 1 | 2;
export type QuestDraft = {
  businessId: string;
  goal: string;
  audienceHint: string;
  maximumCollections: "1" | "2";
  maximumUsd: string;
};
export type QuestIssue = { field: keyof QuestDraft | "confirmResearch" | "availability"; message: string };
export type RestoredQuestDraft = { draft: QuestDraft; step: QuestStep; reviewedEstimate: number | null };
export type QuestState = RestoredQuestDraft & {
  consentKey: string | null;
  issues: QuestIssue[];
  hydrated: boolean;
  storage: "loading" | "local" | "unavailable";
  restored: boolean;
};
export type QuestEvent =
  | { type: "restore"; saved: RestoredQuestDraft | null; storageAvailable: boolean }
  | { type: "edit"; field: keyof QuestDraft; value: string }
  | { type: "step"; step: QuestStep; reviewedEstimate?: number | null }
  | { type: "issues"; issues: QuestIssue[] }
  | { type: "consent"; key: string | null }
  | { type: "storage-unavailable" };

export function newQuestState(businessId: string): QuestState {
  return {
    draft: { businessId, goal: QUEST_DEFAULT_GOAL, audienceHint: "", maximumCollections: "1", maximumUsd: "0.50" },
    step: 0, reviewedEstimate: null, consentKey: null, issues: [], hydrated: false, storage: "loading", restored: false,
  };
}

export function questReducer(state: QuestState, event: QuestEvent): QuestState {
  switch (event.type) {
    case "restore": return { ...state, ...event.saved, consentKey: null, issues: [], hydrated: true, storage: event.storageAvailable ? "local" : "unavailable", restored: event.saved !== null };
    case "edit": {
      if (event.field === "maximumCollections" && event.value !== "1" && event.value !== "2") return state;
      return { ...state, draft: { ...state.draft, [event.field]: event.value }, consentKey: null, issues: [] };
    }
    case "step": return { ...state, step: event.step, consentKey: null, issues: [], reviewedEstimate: event.reviewedEstimate === undefined ? state.reviewedEstimate : event.reviewedEstimate };
    case "issues": return { ...state, issues: event.issues, consentKey: null };
    case "consent": return { ...state, consentKey: event.key, issues: [] };
    case "storage-unavailable": return { ...state, storage: "unavailable" };
  }
}

export function questDraftStorageKey(ownerId: string): string {
  return `agentlabs:research-draft:v${QUEST_DRAFT_VERSION}:${encodeURIComponent(ownerId)}`;
}

/** Explicit allowlist: approval, credentials and workflow authority are never persisted. */
export function serializeQuestDraft(ownerId: string, state: RestoredQuestDraft): string {
  const { businessId, goal, audienceHint, maximumCollections, maximumUsd } = state.draft;
  // An empty value replaces any older local draft without retaining a credential.
  if ([ownerId, businessId, goal, audienceHint, maximumCollections, maximumUsd].some(containsCredentialLikeContent)) return "";
  return JSON.stringify({ version: QUEST_DRAFT_VERSION, ownerId, draft: { businessId, goal, audienceHint, maximumCollections, maximumUsd }, step: state.step, reviewedEstimate: state.reviewedEstimate });
}

export function restoreQuestDraft(raw: string | null, ownerId: string, businessIds: readonly string[]): RestoredQuestDraft | null {
  if (!raw || raw.length > 12_000) return null;
  try {
    const saved = JSON.parse(raw);
    if (!saved || saved.version !== QUEST_DRAFT_VERSION || saved.ownerId !== ownerId || !saved.draft) return null;
    const draft = saved.draft;
    if (typeof draft.businessId !== "string" || draft.businessId.length > 200 || typeof draft.goal !== "string" || draft.goal.length > 1200 || typeof draft.audienceHint !== "string" || draft.audienceHint.length > 160 || typeof draft.maximumUsd !== "string" || draft.maximumUsd.length > 32 || !["1", "2"].includes(draft.maximumCollections)) return null;
    if ([draft.businessId, draft.goal, draft.audienceHint, draft.maximumUsd].some(containsCredentialLikeContent)) return null;
    return {
      draft: { businessId: businessIds.includes(draft.businessId) ? draft.businessId : "", goal: draft.goal, audienceHint: draft.audienceHint, maximumCollections: draft.maximumCollections, maximumUsd: draft.maximumUsd },
      step: [0, 1, 2].includes(saved.step) && businessIds.includes(draft.businessId) ? saved.step : 0,
      reviewedEstimate: Number.isSafeInteger(saved.reviewedEstimate) && saved.reviewedEstimate > 0 ? saved.reviewedEstimate : null,
    };
  } catch { return null; }
}

export function questAllowanceMicrousd(value: string): number | null {
  const cleaned = value.trim();
  if (!/^[0-2](?:\.\d{1,6})?$/.test(cleaned)) return null;
  const amount = Math.round(Number(cleaned) * 1e6);
  return amount >= 1 && amount <= 1_000_000 ? amount : null;
}

export function validQuestQuote(quote: QuestQuotePreview): quote is NonNullable<QuestQuotePreview> {
  return quote !== null && Number.isSafeInteger(quote.one) && quote.one > 0 && Number.isSafeInteger(quote.two) && quote.two > 0 && Number.isFinite(Date.parse(quote.verifiedAt));
}

export function questEstimate(draft: QuestDraft, quote: QuestQuotePreview): number | null {
  return validQuestQuote(quote) ? (draft.maximumCollections === "1" ? quote.one : quote.two) : null;
}

/** Conservative UX check only. The fixed scope is explicit at review; the server is the final gate.
 * Natural questions do not need a particular research verb to use that declared scope.
 */
export function isSupportedQuestGoal(goal: string): boolean {
  const productNames = "(?:mugs?|hoodies?|sneakers?|shoes?|posters?|stickers?|phone cases?|ebooks?)";
  // Explicitly excluding another product is compatible with T-shirt-only research.
  const exclusions = new RegExp(`\\b(?:not|excluding|except|rather than|instead of|without|do not include|don't include)\\s+(?:(?:any|the)\\s+)?${productNames}(?:(?:\\s*,?\\s*(?:or|and)|\\s*,)\\s*${productNames})*\\b`, "gi");
  const text = goal.trim().replace(exclusions, " ");
  const unrelatedAction = /(?:\bbook\b.{0,40}\b(?:flight|hotel|restaurant)\b|\bsend\b.{0,30}\b(?:email|message)\b|\b(?:build|develop)\b.{0,30}\b(?:app|website|software)\b|\b(?:write|compose)\b.{0,30}\b(?:poem|song|email|code|story)\b|\b(?:buy|trade|invest|research|compare)\b.{0,40}\b(?:stocks?|shares?|crypto|bitcoin|flights?|hotels?)\b|\b(?:generate|draw)\b.{0,30}\b(?:images?|artwork|designs?|logos?)\b|\b(?:publish|launch)\b.{0,30}\b(?:listings?|advertisements?)\b)/i;
  const otherProduct = new RegExp(`\\b${productNames}\\b`, "i");
  return !unrelatedAction.test(text) && !otherProduct.test(text);
}

export function validateQuestDraft(draft: QuestDraft, businessIds: readonly string[], through: "goal" | "scope" = "scope"): QuestIssue[] {
  const issues: QuestIssue[] = [];
  if (!businessIds.includes(draft.businessId)) issues.push({ field: "businessId", message: "Choose an available Business for this research." });
  if (containsCredentialLikeContent(draft.goal)) issues.push({ field: "goal", message: "Enter credentials through secure Connections, not in a research goal." });
  else if (draft.goal.trim().length < 20 || draft.goal.trim().length > 1200) issues.push({ field: "goal", message: "Describe your research goal in 20–1,200 characters." });
  else if (!isSupportedQuestGoal(draft.goal)) issues.push({ field: "goal", message: "This flow supports geographic market research for original POD T-shirts only. Other goals need their own supported workflow." });
  const audience = draft.audienceHint.trim();
  if (containsCredentialLikeContent(audience)) issues.push({ field: "audienceHint", message: "Enter credentials through secure Connections, not in an audience constraint." });
  else if (audience && (audience.length < 3 || audience.length > 160)) issues.push({ field: "audienceHint", message: "Use 3–160 characters for an audience constraint, or leave it blank." });
  if (through === "scope") {
    if (!["1", "2"].includes(draft.maximumCollections)) issues.push({ field: "maximumCollections", message: "Choose one or two fixed source collections." });
    if (questAllowanceMicrousd(draft.maximumUsd) === null) issues.push({ field: "maximumUsd", message: "Enter a positive research allowance up to US$1, with no more than six decimal places." });
  }
  return issues;
}

/** Any field, price, quote check or availability change requires fresh review consent. */
export function questReviewKey(ownerId: string, draft: QuestDraft, quote: QuestQuotePreview, available: boolean): string {
  return JSON.stringify([ownerId, draft.businessId, draft.goal, draft.audienceHint, draft.maximumCollections, draft.maximumUsd, quote?.one, quote?.two, quote?.verifiedAt, available]);
}

export function questMoney(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(value / 1e6);
}
