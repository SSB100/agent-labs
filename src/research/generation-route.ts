import { createHash } from "node:crypto";
import { getOpenRouterConfig, type OpenRouterConfig } from "../models/openrouter";

const GENERATION_URL = "https://openrouter.ai/api/v1/generation";
const MAX_RESPONSE_BYTES = 65_536;
const MAX_TIMEOUT_MS = 10_000;
const MODEL_IDS = ["openai/gpt-5.6-luna", "openai/gpt-5.6-luna-20260709"] as const;
const GENERATION_ID = /^gen-[A-Za-z0-9_-]{1,296}$/;

export type GenerationRouteExpectation = {
  generationId: string;
  providerName: "Azure";
  acceptedResponseModelIds: readonly string[];
  /** Provenance from the exact admitted request, not an observed region. */
  requestedEndpoint: "azure/us";
};
export type GenerationRouteProviderResponse = Readonly<{
  providerName: "Azure";
  modelId: typeof MODEL_IDS[number];
  status: 200;
}>;
export type GenerationRouteProof = Readonly<{
  generationId: string;
  providerName: "Azure";
  modelId: typeof MODEL_IDS[number];
  requestedEndpoint: "azure/us";
  /** Supplied attempts only; an empty list does not enumerate inner calls. */
  providerResponses: readonly GenerationRouteProviderResponse[];
  proofHash: string;
}>;
export type GenerationRouteFailureCode = "invalid_request" | "configuration_unavailable" | "transport_failure" |
  "timeout" | "redirect_rejected" | "api_failure" | "response_too_large" | "response_invalid" |
  "generation_mismatch" | "provider_mismatch" | "model_mismatch" | "provider_responses_invalid";

/** No response text, credential, opaque upstream ID or transport error escapes. */
export class GenerationRouteProofError extends Error {
  constructor(readonly code: GenerationRouteFailureCode) {
    super("public_research_generation_route_unverified");
    this.name = "GenerationRouteProofError";
  }
}
const fail = (code: GenerationRouteFailureCode): never => { throw new GenerationRouteProofError(code); };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const acceptedModel = (value: unknown): value is typeof MODEL_IDS[number] => value === MODEL_IDS[0] || value === MODEL_IDS[1];

function ownExpectation(expected: GenerationRouteExpectation): GenerationRouteExpectation {
  if (!record(expected) || typeof expected.generationId !== "string" || GENERATION_ID.exec(expected.generationId)?.[0] !== expected.generationId ||
      expected.providerName !== "Azure" || expected.requestedEndpoint !== "azure/us" ||
      !Array.isArray(expected.acceptedResponseModelIds) || expected.acceptedResponseModelIds.length !== 2 ||
      expected.acceptedResponseModelIds[0] !== MODEL_IDS[0] || expected.acceptedResponseModelIds[1] !== MODEL_IDS[1]) return fail("invalid_request");
  // Retain no caller-owned array across the asynchronous transport boundary.
  return { generationId: expected.generationId, providerName: "Azure", requestedEndpoint: "azure/us", acceptedResponseModelIds: [...MODEL_IDS] };
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return fail("response_invalid");
}

/** Documented wire contract (snake_case, not the SDK's mapped camelCase):
 * https://raw.githubusercontent.com/OpenRouterTeam/typescript-sdk/main/src/models/generationresponse.ts
 * https://raw.githubusercontent.com/OpenRouterTeam/typescript-sdk/main/src/models/providerresponse.ts
 * data.provider_name is the served provider. The optional/nullable response list
 * can be empty, including on a billed parent. generation_type is not part of
 * this contract. endpoint_id is opaque and cannot establish azure/us.
 */
export function qualifyGenerationRouteProof(raw: unknown, expectation: GenerationRouteExpectation): GenerationRouteProof {
  const expected = ownExpectation(expectation);
  if (!record(raw) || Object.hasOwn(raw, "error") || !record(raw.data)) return fail("response_invalid");
  const data = raw.data;
  if (data.id !== expected.generationId) return fail("generation_mismatch");
  if (data.provider_name !== expected.providerName) return fail("provider_mismatch");
  if (!acceptedModel(data.model)) return fail("model_mismatch");
  let providerResponses: readonly GenerationRouteProviderResponse[] = Object.freeze([]);
  if (data.provider_responses !== undefined && data.provider_responses !== null) {
    if (!Array.isArray(data.provider_responses) || data.provider_responses.length > 64) return fail("provider_responses_invalid");
    providerResponses = Object.freeze(Array.from(data.provider_responses, entry => {
      // The public schema permits missing identities/null status. Qualification
      // is deliberately stricter for any supplied attempt: it must establish
      // the exact provider, reviewed model and successful HTTP status itself.
      if (!record(entry) || entry.status !== 200 || entry.provider_name !== expected.providerName ||
          !acceptedModel(entry.model_permaslug)) return fail("provider_responses_invalid");
      return Object.freeze({ providerName: "Azure" as const, modelId: entry.model_permaslug, status: 200 as const });
    }));
  }
  const proof = { generationId: expected.generationId, providerName: "Azure" as const, modelId: data.model,
    requestedEndpoint: expected.requestedEndpoint, providerResponses };
  return Object.freeze({ ...proof, proofHash: createHash("sha256").update(canonical(proof)).digest("hex") });
}

/** Strict consumer boundary for a saved/injected proof, not just its producer.
 * Rebuild the allowlisted projection and verify its canonical hash and exact
 * keys before evidence can depend on it. Hashes bind data; they are not an
 * alternative to obtaining the proof from the trusted server-side reader.
 */
export function validateGenerationRouteProof(raw: unknown, expectation: GenerationRouteExpectation): GenerationRouteProof {
  const expected = ownExpectation(expectation);
  const exactKeys = (value: object, keys: string) => Object.keys(value).sort().join(",") === keys.split(",").sort().join(",");
  if (!record(raw) || !exactKeys(raw, "generationId,providerName,modelId,requestedEndpoint,providerResponses,proofHash") ||
      raw.requestedEndpoint !== expected.requestedEndpoint || typeof raw.proofHash !== "string" || !/^[a-f0-9]{64}$/.test(raw.proofHash) ||
      !Array.isArray(raw.providerResponses) || raw.providerResponses.length > 64) return fail("response_invalid");
  const providerResponses = Array.from(raw.providerResponses, entry => {
    if (!record(entry) || !exactKeys(entry, "providerName,modelId,status")) return fail("provider_responses_invalid");
    return { provider_name: entry.providerName, model_permaslug: entry.modelId, status: entry.status };
  });
  const qualified = qualifyGenerationRouteProof({ data: { id: raw.generationId, provider_name: raw.providerName,
    model: raw.modelId, provider_responses: providerResponses } }, expected);
  if (qualified.proofHash !== raw.proofHash) return fail("response_invalid");
  return qualified;
}

type FetchGenerationRouteProofArgs = GenerationRouteExpectation & {
  fetcher?: typeof fetch;
  /** Test injection or trusted server config; only the key is used, never baseUrl. */
  config?: Pick<OpenRouterConfig, "apiKey">;
  /** Tests may shorten, but never extend, the fixed ten-second deadline. */
  timeoutMs?: number;
};

/** One bounded, non-generating GET. No polling, retry, redirect, catalog lookup,
 * paid inference, configurable destination, or raw-response persistence. */
export async function fetchGenerationRouteProof(args: FetchGenerationRouteProofArgs): Promise<GenerationRouteProof> {
  const expected = ownExpectation(args), timeoutMs = args.timeoutMs === undefined ? MAX_TIMEOUT_MS : args.timeoutMs;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS ||
      (args.fetcher !== undefined && typeof args.fetcher !== "function")) return fail("invalid_request");
  let apiKey: string;
  try {
    apiKey = (args.config === undefined ? getOpenRouterConfig() : args.config).apiKey;
    if (typeof apiKey !== "string" || !apiKey.trim() || apiKey.length > 4096 || /[\r\n]/.test(apiKey)) return fail("configuration_unavailable");
  } catch { return fail("configuration_unavailable"); }
  const fetcher = args.fetcher ?? fetch, controller = new AbortController();
  const url = `${GENERATION_URL}?id=${encodeURIComponent(expected.generationId)}`;
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new GenerationRouteProofError("timeout"));
      controller.abort();
      void reader?.cancel().catch(() => {});
    }, timeoutMs);
  });
  const read = async (): Promise<GenerationRouteProof> => {
    response = await fetcher(url, { method: "GET", headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      redirect: "error", cache: "no-store", credentials: "omit", signal: controller.signal });
    if (controller.signal.aborted) return fail("timeout");
    if (response.redirected || response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400) ||
        (response.url && response.url !== url)) return fail("redirect_rejected");
    if (!response.ok) return fail("api_failure");
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null && (!/^(?:0|[1-9][0-9]*)$/.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES)) return fail("response_too_large");
    if (!response.body) return fail("response_invalid");
    reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) return fail("response_too_large");
      chunks.push(value);
    }
    let raw: unknown;
    try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes))); }
    catch { return fail("response_invalid"); }
    return qualifyGenerationRouteProof(raw, expected);
  };
  try { return await Promise.race([deadline, read()]); }
  catch (error) {
    if (error instanceof GenerationRouteProofError) throw error;
    return fail("transport_failure");
  } finally {
    clearTimeout(timer);
    controller.abort();
    // Cancellation is best effort and cannot extend the deadline.
    if (reader) void reader.cancel().catch(() => {});
    else void response?.body?.cancel().catch(() => {});
  }
}
