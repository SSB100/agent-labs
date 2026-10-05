/** Replaces only qualification-server-dependencies.ts in the disposable Next copy.
 * Actual owner checks, action parsing, policy/quote validation, request construction,
 * admission callbacks, accounting, lineage and terminal-result code stay intact. */
import { OpenRouterAdapter } from "@/models/openrouter";
import { fetchPublicResearchQuote, PUBLIC_RESEARCH_QUOTE_LIMITS } from "@/research/qualification-quote";
import { fetchGenerationRouteProof, fetchGenerationRouteProofOnce, type GenerationRouteExpectation } from "@/research/generation-route";
import { publicResearchRuntime } from "@/research/qualification-runtime";
import type { PublicResearchRuntime } from "@/research/qualification-runtime";

type ResearchRuntimeScope = Parameters<typeof publicResearchRuntime>[0];
const EXCERPT = "Adult gardeners often value practical tools and containers suited to the available growing space. This is a bounded public observation from an inert qualification fixture.";
const CANONICAL_MODEL = "openai/gpt-5.6-luna-20260709";
const PRIVATE_SENTINEL = "RAW_R11_PROVIDER_TEXT_MUST_NOT_PERSIST";
const GENERATION_KEY = "inert-r11-generation-placeholder";

/** Keep the production bounded generation reader and wire parser. Only its
 * credential and exact GET response are synthetic; no provider is contacted. */
function fetchFixtureGenerationRoute(expectation: GenerationRouteExpectation, once = false, now?: () => number) {
 const generationId = expectation.generationId;
 return (once ? fetchGenerationRouteProofOnce : fetchGenerationRouteProof)({
  generationId, providerName: expectation.providerName, acceptedResponseModelIds: expectation.acceptedResponseModelIds,
  requestedEndpoint: expectation.requestedEndpoint, ...(now ? { now } : {}), config: { apiKey: GENERATION_KEY },
  fetcher: async (url, init) => {
   const headers = new Headers(init?.headers);
   if (String(url) !== `https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(generationId)}` ||
       init?.method !== "GET" || init.body !== undefined || init.redirect !== "error" || init.cache !== "no-store" ||
       init.credentials !== "omit" || !init.signal || headers.get("Authorization") !== `Bearer ${GENERATION_KEY}` ||
       headers.get("Accept") !== "application/json" || [...headers].length !== 2) throw new Error("inert_exact_generation_wire_required");
   const generation = await post("/r11/generation", { url: String(url) });
   return new Response(generation.body, { status: generation.status, headers: { "content-type": "application/json", ...(generation.retryAfter ? { "retry-after": generation.retryAfter } : {}) } });
  },
 });
}
function boundary() {
 const origin = process.env.R03_BOUNDARY!;
 const parsed = new URL(origin);
 if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1") throw new Error("fixture_boundary_required");
 return origin;
}
async function post(path: string, payload: unknown) {
 const response = await fetch(`${boundary()}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(5_000) });
 if (!response.ok) throw new Error("inert_research_transport_failed");
 return response.json();
}
export function researchQualificationDependencies() {
 let clock = Date.now();
 const now = async () => { const value = await post("/r11/clock", {}); if (!Number.isSafeInteger(value.now)) throw new Error("inert_clock_required"); clock = value.now; return clock; };
 return {
  now,
  fetchGenerationRoute: fetchFixtureGenerationRoute,
  fetchQuote: async (options: { maximumMicrousd?: number } = {}) => { await now(); return fetchPublicResearchQuote({ ...options, now: () => clock, fetch: async (url, init) => {
   const allowed: readonly string[] = [PUBLIC_RESEARCH_QUOTE_LIMITS.modelIdentityCatalogUrl, PUBLIC_RESEARCH_QUOTE_LIMITS.modelCatalogUrl,
    `${PUBLIC_RESEARCH_QUOTE_LIMITS.modelIdentityCatalogUrl}/${CANONICAL_MODEL}/endpoints`, PUBLIC_RESEARCH_QUOTE_LIMITS.zdrCatalogUrl];
   if (init?.method !== "GET" || init?.body || !allowed.includes(String(url))) throw new Error("inert_exact_catalog_required");
   const catalog = await post("/r11/catalog", { url: String(url) });
   return new Response(JSON.stringify(catalog), { headers: { "content-type": "application/json" } });
  } }); },
  makeRuntime(scope: ResearchRuntimeScope, verifyQuote: PublicResearchRuntime["verifyQuote"]): PublicResearchRuntime {
   const runtime = publicResearchRuntime(scope, verifyQuote);
   return { ...runtime, now: () => clock, verifyGenerationRoute: fetchFixtureGenerationRoute, verifyGenerationRouteOnce: expectation => fetchFixtureGenerationRoute(expectation, true, () => clock), provider: (admit, observeResponse) => new OpenRouterAdapter({
    config: { apiKey: "inert-r11-provider-placeholder", baseUrl: "https://openrouter.ai/api/v1", appUrl: "https://example.invalid", appName: "R11 inert Next fixture" },
    admitDispatch: admit, observeResponse,
    fetcher: async (url, init) => {
     if (url !== "https://openrouter.ai/api/v1/chat/completions" || init?.method !== "POST" || typeof init?.body !== "string") throw new Error("inert_exact_model_wire_required");
     const body = JSON.parse(init.body), phase = body.tools ? "search" : "select";
     // Deliberately do not serialize scope: it contains runtime/admission secrets.
     const dispatch = await post("/r11/provider", { scope: { businessId: scope.businessId, workflowRunId: scope.coreWorkflowRunId }, phase, body });
     if (dispatch.fail) throw new Error("inert_provider_response_unavailable");
     const annotations = dispatch.invalidSources ? [
      { type: "url_citation", url_citation: { url: `https://unapproved.example/${PRIVATE_SENTINEL}`, title: PRIVATE_SENTINEL, content: PRIVATE_SENTINEL } },
      { type: "url_citation", url_citation: { url: PRIVATE_SENTINEL, title: PRIVATE_SENTINEL, content: "short" } },
     ] : [{ type: "url_citation", url_citation: { url: "https://gardening.example/report", title: "Synthetic public gardening report", content: EXCERPT } }];
     const message = phase === "search" ? { content: PRIVATE_SENTINEL, annotations }
      : { content: JSON.stringify({ selections: [{ sourceKey: "S1", quote: dispatch.invalidSelection ? PRIVATE_SENTINEL : EXCERPT.slice(0, 98).trim() }], limitations: ["limited_sources"] }) };
     return new Response(JSON.stringify({ id: dispatch.receiptId, provider: dispatch.invalidProvider ? PRIVATE_SENTINEL : "Azure",
      model: dispatch.invalidModel ? PRIVATE_SENTINEL : dispatch.aliasModel ? body.model : CANONICAL_MODEL, choices: [{ finish_reason: "stop", message }],
      usage: { prompt_tokens: 10, completion_tokens: 10, ...(dispatch.unknownCost ? {} : { cost: phase === "search" ? 0.010068 : 0.001 }), ...(phase === "search" ? { server_tool_use: { web_search_requests: 1 } } : {}) } }), { headers: { "content-type": "application/json" } });
    },
   }) };
  },
 };
}
