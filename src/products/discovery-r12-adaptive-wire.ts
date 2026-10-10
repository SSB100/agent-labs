import { createHash } from "node:crypto";
import { OpenRouterAdapter } from "../models/openrouter";
import type { StructuredModelRequest, WebSearchModelRequest } from "../models/types";
import { R11_RESTRICTED_SOURCE_DOMAINS } from "../research/qualification";
import { discoveryV2Hash } from "./discovery-v2";
import { discoveryR12OwnerInitialStaticSchema, discoveryR12EtsyOwnerStaticSchema } from "./discovery-r12-schemas";
import { adaptiveReviewerResponseSchema } from "./discovery-r12-adaptive-review-contract";
import { adaptiveStrategistSchema } from "./discovery-r12-adaptive-strategy";
import { adaptiveResearchPhaseLimits, validateAdaptiveResearchQuote, type AdaptiveResearchQuote } from "./discovery-r12-adaptive-quote";
import type { AdaptivePhase } from "./discovery-r12-adaptive-policy";
import type { DiscoveryR12Wire } from "./discovery-r12-wire";

const fail = (): never => { throw new Error("r12_adaptive_wire_unverified"); };
export function routeAdaptiveResearchRequest(request: StructuredModelRequest | WebSearchModelRequest, phase: AdaptivePhase, quote: AdaptiveResearchQuote, now = Date.now()) {
  validateAdaptiveResearchQuote(quote, now);
  if (!["plan", "search", "select", "strategy", "review"].includes(phase)) return fail();
  const limits = adaptiveResearchPhaseLimits(quote, phase);
  const ownerCapture = quote.version === "r12.adaptive-quote.2";
  const selected = phase === "review" ? quote.reviewer : quote.luna;
  const owned = structuredClone(request);
  if (owned.model.provider !== "openrouter" || owned.model.providerModelId !== selected.modelId ||
      (phase === "review" ? selected.modelId !== "anthropic/claude-haiku-4.5" || selected.endpoint !== "amazon-bedrock/us" :
        selected.modelId !== "openai/gpt-5.6-luna" || selected.endpoint !== "azure/us")) return fail();
  if (phase === "search") {
    if (!("query" in owned) || !owned.excludedDomains || !R11_RESTRICTED_SOURCE_DOMAINS.every(d => owned.excludedDomains!.includes(d))) return fail();
  } else {
    if (!("messages" in owned) || ownerCapture && "query" in owned || owned.messages.some(m => m.images?.length) || owned.maxOutputTokens !== limits.outputTokens) return fail();
    const expected = phase === "review" ? adaptiveReviewerResponseSchema() : phase === "strategy" ? adaptiveStrategistSchema() :
      ownerCapture ? discoveryR12EtsyOwnerStaticSchema("plan") : discoveryR12OwnerInitialStaticSchema(phase === "select" ? "select1" : "plan");
    // Dynamic evidence enums belong in local validation, never cached schemas.
    // Only plan/select have existing equivalent bounded static grammar.
    if ((["strategy", "review"].includes(phase) || ownerCapture) && discoveryV2Hash(owned.outputSchema) !== discoveryV2Hash(expected)) return fail();
    owned.outputSchema = expected;
    if (phase === "select") owned.reasoning = { effort: "none" };
    else if (owned.reasoning !== undefined) return fail();
  }
  return { ...owned, providerOnly: [selected.endpoint], providerDataCollection: "deny" as const, providerZdr: true as const,
    // JSONB may reorder nested quote keys. Keep admitted bytes stable when
    // reconstructing the same request from its immutable database readback.
    providerPriceLimit: { prompt: selected.priceLimit.prompt, completion: selected.priceLimit.completion, request: selected.priceLimit.request }, requireReturnedModel: true };
}

/** Real adapter serialization stopped at denied admission. No credentials or
 * transport are used; the returned bytes must be the bytes later admitted. */
export async function inspectAdaptiveResearchWire(request: StructuredModelRequest | WebSearchModelRequest, phase: AdaptivePhase, quote: AdaptiveResearchQuote, now = Date.now()): Promise<DiscoveryR12Wire> {
  const owned = routeAdaptiveResearchRequest(request, phase, quote, now);
  const limits = adaptiveResearchPhaseLimits(quote, phase);
  const maximum = limits.requestBytes, tokens = limits.outputTokens;
  if (Buffer.byteLength(JSON.stringify(owned)) > maximum) return fail();
  let captured: DiscoveryR12Wire | null = null;
  const adapter = new OpenRouterAdapter({ config: { apiKey: "inert-adaptive-wire-only", baseUrl: "https://openrouter.ai/api/v1", appUrl: "https://agent-labs-two.vercel.app", appName: "Agent Labs" },
    admitDispatch: async wire => {
      const body = JSON.parse(wire.body), bytes = Buffer.byteLength(wire.body);
      if (wire.url !== "https://openrouter.ai/api/v1/chat/completions" || wire.method !== "POST" || body.model !== owned.model.providerModelId ||
          body.max_tokens !== tokens || body.stream !== false || bytes > maximum ||
          JSON.stringify(body.provider.only) !== JSON.stringify(owned.providerOnly) || body.provider.allow_fallbacks !== false ||
          body.provider.data_collection !== "deny" || body.provider.zdr !== true ||
          quote.version === "r12.adaptive-quote.2" && (Object.hasOwn(body, "tools") || Object.hasOwn(body, "plugins"))) return fail();
      captured = { requestHash: discoveryV2Hash(owned), wireHash: createHash("sha256").update(wire.body).digest("hex"), wireBytes: bytes,
        maximumOutputTokens: tokens, wire: { ...wire, url: "https://openrouter.ai/api/v1/chat/completions" } };
      throw new Error("inert_adaptive_admission_denied");
    }, fetcher: async () => { throw new Error("adaptive_inspection_must_not_dispatch"); } });
  try { if (phase === "search") await adapter.invokeWebSearch(owned as WebSearchModelRequest); else await adapter.invokeStructured(owned as StructuredModelRequest); }
  catch { /* Capture can only succeed before deliberate admission denial. */ }
  if (!captured) return fail();
  return captured;
}
