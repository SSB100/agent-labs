import { createHash } from "node:crypto";
import { OpenRouterAdapter } from "../models/openrouter";
import type { StructuredModelRequest, WebSearchModelRequest } from "../models/types";
import { R11_RESTRICTED_SOURCE_DOMAINS } from "../research/qualification";
import { DISCOVERY_V2_BUDGET, discoveryV2Model, type DiscoveryV2Call } from "./discovery-v2-budget";
import { discoveryR12StaticSchema } from "./discovery-r12-schemas";
import { discoveryV2Hash } from "./discovery-v2";

export type DiscoveryR12Phase = "plan" | "search1" | "select1" | "strategy" | "review";
export const DISCOVERY_R12_PHASES = ["plan", "search1", "select1", "strategy", "review"] as const;
export const discoveryR12Call = (phase: DiscoveryR12Phase): DiscoveryV2Call => phase === "search1" ? "search:1" : phase === "select1" ? "select:1" : `${phase}:1`;
export type DiscoveryR12Route = { modelId: string; endpoint: string; priceLimit: { prompt: number; completion: number; request: 0 } };
export type DiscoveryR12Wire = { requestHash: string; wireHash: string; wireBytes: number; maximumOutputTokens: number;
  wire: { url: "https://openrouter.ai/api/v1/chat/completions"; method: "POST"; body: string } };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const fail = (): never => { throw new Error("r12_discovery_wire_unavailable"); };

/** Applies only explicitly supplied endpoint/price controls. It makes no catalog
 * lookup and cannot turn this proposal into a qualified provider or source. */
export function routeDiscoveryR12Request(request: StructuredModelRequest | WebSearchModelRequest, phase: DiscoveryR12Phase, route: DiscoveryR12Route): StructuredModelRequest | WebSearchModelRequest {
  const owned = structuredClone(request), selected = structuredClone(route);
  if (!DISCOVERY_R12_PHASES.includes(phase) || owned.model.provider !== "openrouter" || owned.model.providerModelId !== discoveryV2Model(discoveryR12Call(phase)) ||
      selected.modelId !== owned.model.providerModelId || typeof selected.endpoint !== "string" || !/^[a-z0-9][a-z0-9-]{1,59}(?:\/[a-z0-9][a-z0-9-]{0,59})?$/.test(selected.endpoint) ||
      (phase !== "review" && selected.endpoint !== "azure/us") || (phase === "review" && selected.endpoint !== "amazon-bedrock/us") ||
      selected.priceLimit.request !== 0 || [selected.priceLimit.prompt, selected.priceLimit.completion].some(value => !Number.isFinite(value) || value <= 0 || value > 1_000_000)) return fail();
  if (phase === "search1") {
    if (!("query" in owned) || !Array.isArray(owned.excludedDomains) || !R11_RESTRICTED_SOURCE_DOMAINS.every(domain => owned.excludedDomains!.includes(domain))) return fail();
  } else if (!("messages" in owned) || owned.messages.some(message => message.images?.length)) return fail();
  if (phase !== "search1") {
    if (!("outputSchema" in owned)) return fail();
    owned.outputSchema = discoveryR12StaticSchema(phase);
    owned.schemaName = { plan: "geographic_discovery_plan_v2", select1: "discovery_evidence_selection_v2", strategy: "product_discovery_v2_strategy", review: "product_discovery_v2_review" }[phase];
    if (phase === "select1") owned.reasoning = { effort: "none" };
    else if (owned.reasoning !== undefined) return fail();
  }
  return { ...owned, providerOnly: [selected.endpoint], providerDataCollection: "deny", providerZdr: true,
    providerPriceLimit: selected.priceLimit, requireReturnedModel: true };
}

/** Runs the real adapter serializer up to a deliberately denied admission.
 * No credential lookup, network transport or authority mutation can occur. */
export async function inspectDiscoveryR12Wire(request: StructuredModelRequest | WebSearchModelRequest, phase: DiscoveryR12Phase): Promise<DiscoveryR12Wire> {
  const owned = structuredClone(request);
  if (!DISCOVERY_R12_PHASES.includes(phase) || !owned.providerOnly || owned.providerOnly.length !== 1 || owned.providerDataCollection !== "deny" || owned.providerZdr !== true || owned.requireReturnedModel !== true || !owned.providerPriceLimit) return fail();
  if (discoveryV2Hash(routeDiscoveryR12Request(owned, phase, { modelId: owned.model.providerModelId, endpoint: owned.providerOnly[0], priceLimit: owned.providerPriceLimit })) !== discoveryV2Hash(owned)) return fail();
  const kind = phase === "select1" ? "select" : phase;
  const maximumRequestBytes = kind === "search1" ? DISCOVERY_V2_BUDGET.maximumSearchRequestBytes : DISCOVERY_V2_BUDGET.phases[kind].maximumRequestBytes;
  const tokens = kind === "search1" ? 4000 : DISCOVERY_V2_BUDGET.phases[kind].outputTokens;
  if (Buffer.byteLength(JSON.stringify(owned), "utf8") > maximumRequestBytes) return fail();
  let captured: DiscoveryR12Wire | null = null;
  const adapter = new OpenRouterAdapter({ config: { apiKey: "inert-discovery-wire-only", baseUrl: "https://openrouter.ai/api/v1", appUrl: "https://agent-labs-two.vercel.app", appName: "Agent Labs" },
    admitDispatch: async wire => {
      const body = JSON.parse(wire.body), bytes = Buffer.byteLength(wire.body, "utf8");
      if (wire.url !== "https://openrouter.ai/api/v1/chat/completions" || wire.method !== "POST" || body.model !== owned.model.providerModelId || body.max_tokens !== tokens || body.stream !== false || bytes > maximumRequestBytes) return fail();
      if (JSON.stringify(body.provider.only) !== JSON.stringify(owned.providerOnly) || body.provider.allow_fallbacks !== false || body.provider.data_collection !== "deny" || body.provider.zdr !== true) return fail();
      captured = { requestHash: discoveryV2Hash(owned), wireHash: hash(wire.body), wireBytes: bytes, maximumOutputTokens: tokens, wire: { ...wire, url: "https://openrouter.ai/api/v1/chat/completions" } };
      throw new Error("inert_discovery_wire_inspection");
    }, fetcher: async () => { throw new Error("discovery_wire_inspection_must_not_dispatch"); } });
  try { if (phase === "search1") await adapter.invokeWebSearch(owned as WebSearchModelRequest); else await adapter.invokeStructured(owned as StructuredModelRequest); }
  catch { /* Only capture followed by deliberate admission refusal can succeed. */ }
  if (!captured) return fail();
  return captured;
}
