/** Replaces only qualification-server-dependencies.ts in the disposable Next copy.
 * Actual owner checks, action parsing, policy/quote validation, request construction,
 * admission callbacks, accounting, lineage and terminal-result code stay intact. */
import { OpenRouterAdapter } from "@/models/openrouter";
import { fetchPublicResearchQuote, PUBLIC_RESEARCH_QUOTE_LIMITS } from "@/research/qualification-quote";
import { publicResearchRuntime } from "@/research/qualification-runtime";
import type { PublicResearchRuntime } from "@/research/qualification-runtime";

type ResearchRuntimeScope = Parameters<typeof publicResearchRuntime>[0];
const EXCERPT = "Adult gardeners often value practical tools and containers suited to the available growing space. This is a bounded public observation from an inert qualification fixture.";
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
 return {
  fetchQuote: () => fetchPublicResearchQuote({ fetch: async (url, init) => {
   if (init?.method !== "GET" || init?.body || ![PUBLIC_RESEARCH_QUOTE_LIMITS.modelCatalogUrl, PUBLIC_RESEARCH_QUOTE_LIMITS.zdrCatalogUrl].includes(String(url) as typeof PUBLIC_RESEARCH_QUOTE_LIMITS.modelCatalogUrl)) throw new Error("inert_exact_catalog_required");
   const catalog = await post("/r11/catalog", { url: String(url) });
   return new Response(JSON.stringify(catalog), { headers: { "content-type": "application/json" } });
  } }),
  makeRuntime(scope: ResearchRuntimeScope, verifyQuote: PublicResearchRuntime["verifyQuote"]): PublicResearchRuntime {
   const runtime = publicResearchRuntime(scope, verifyQuote);
   return { ...runtime, provider: admit => new OpenRouterAdapter({
    config: { apiKey: "inert-r11-provider-placeholder", baseUrl: "https://openrouter.ai/api/v1", appUrl: "https://example.invalid", appName: "R11 inert Next fixture" },
    admitDispatch: admit,
    fetcher: async (url, init) => {
     if (url !== "https://openrouter.ai/api/v1/chat/completions" || init?.method !== "POST" || typeof init?.body !== "string") throw new Error("inert_exact_model_wire_required");
     const body = JSON.parse(init.body), phase = body.tools ? "search" : "select";
     const dispatch = await post("/r11/provider", { scope: { businessId: scope.businessId, workflowRunId: scope.coreWorkflowRunId }, phase, body });
     if (dispatch.fail) throw new Error("inert_provider_response_unavailable");
     const message = phase === "search" ? { content: "Inert public search result", annotations: [{ type: "url_citation", url_citation: { url: "https://gardening.example/report", title: "Synthetic public gardening report", content: EXCERPT } }] }
      : { content: JSON.stringify({ selections: [{ sourceKey: "S1", quote: dispatch.invalidSelection ? "This invalid evidence quotation was never supplied by the source." : EXCERPT.slice(0, 98).trim() }], limitations: ["limited_sources"] }) };
     return new Response(JSON.stringify({ id: dispatch.receiptId, provider: "Azure", model: body.model, choices: [{ finish_reason: "stop", message }],
      usage: { prompt_tokens: 10, completion_tokens: 10, ...(dispatch.unknownCost ? {} : { cost: 0.001 }), ...(phase === "search" ? { server_tool_use: { web_search_requests: 1 } } : {}) } }), { headers: { "content-type": "application/json" } });
    },
   }) };
  },
 };
}
