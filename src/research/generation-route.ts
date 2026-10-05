import { createHash } from "node:crypto";
import { getOpenRouterConfig, type OpenRouterConfig } from "../models/openrouter";

const GENERATION_URL = "https://openrouter.ai/api/v1/generation";
const MAX_RESPONSE_BYTES = 65_536;
const MAX_TIMEOUT_MS = 20_000;
const MAX_ATTEMPT_MS = 10_000;
const RETRY_DELAYS_MS = [2_000, 8_000] as const;
const MAX_RETRY_AFTER_AT = "9999-12-31T23:59:59.999Z";
const MAX_RETRY_AFTER_MS = Date.parse(MAX_RETRY_AFTER_AT);
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
  "timeout" | "redirect_rejected" | "api_failure" | "response_too_large" | "json_invalid" | "response_invalid" |
  "generation_mismatch" | "provider_mismatch" | "model_mismatch" | "provider_responses_invalid";

/** No response text, credential, opaque upstream ID or transport error escapes. */
export class GenerationRouteProofError extends Error {
  readonly httpStatus: number | null;
  readonly attempts: number;
  readonly retryAfterAt: string | null;
  constructor(readonly code: GenerationRouteFailureCode, httpStatus: number | null = null, attempts = 0, retryAfterAt: string | null = null) {
    super("public_research_generation_route_unverified");
    this.name = "GenerationRouteProofError";
    this.httpStatus = typeof httpStatus === "number" && Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null;
    this.attempts = Number.isInteger(attempts) && attempts >= 0 && attempts <= 3 ? attempts : 0;
    // Only canonical absolute timestamps can cross the error boundary. Never
    // retain a caller-supplied header, even if Date.parse would accept it.
    this.retryAfterAt = typeof retryAfterAt === "string" &&
      /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(retryAfterAt) &&
      Number.isFinite(Date.parse(retryAfterAt)) && new Date(retryAfterAt).toISOString() === retryAfterAt ? retryAfterAt : null;
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

export type FetchGenerationRouteProofArgs = GenerationRouteExpectation & {
  fetcher?: typeof fetch;
  /** Test injection or trusted server config; only the key is used, never baseUrl. */
  config?: Pick<OpenRouterConfig, "apiKey">;
  /** Tests may shorten, but never extend, the fixed cumulative twenty seconds. */
  timeoutMs?: number;
  /** Trusted clock for Retry-After timestamps only; never network deadlines. */
  now?: () => number;
};

const retryableStatus = (status: number | null) => status === 404 || status === 429 || (status !== null && status >= 500 && status <= 599);
export function isTransientGenerationRouteFailure(error: unknown): error is GenerationRouteProofError {
  return error instanceof GenerationRouteProofError && (error.code === "timeout" || error.code === "transport_failure" ||
    (error.code === "api_failure" && retryableStatus(error.httpStatus)));
}

function retryAfter(value: string | null, now: number): { waitMs: number; retryAfterAt: string | null } {
  const ignored = { waitMs: 0, retryAfterAt: null };
  if (value === null) return ignored;
  const header = value.trim();
  const numeric = /^[0-9]+$/.test(header);
  let waitMs: number;
  if (numeric) waitMs = Number(header) * 1_000;
  // HTTP-date permits IMF-fixdate and the two obsolete HTTP date formats.
  else {
    if (!/^(?:[A-Za-z]{3}, [0-9]{2} [A-Za-z]{3} [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT|[A-Za-z]+, [0-9]{2}-[A-Za-z]{3}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT|[A-Za-z]{3} [A-Za-z]{3} [ 0-9][0-9] [0-9]{2}:[0-9]{2}:[0-9]{2} [0-9]{4})$/.test(header)) return ignored;
    // HTTP asctime is UTC even though its syntax omits a timezone marker.
    const time = Date.parse(header.endsWith(" GMT") ? header : `${header} GMT`);
    if (!Number.isFinite(time)) return ignored;
    const date = new Date(time), utc = date.toUTCString();
    const [day, dayOfMonth, month, year, clock] = utc.split(" ");
    const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][date.getUTCDay()];
    // Date.parse normalizes impossible days and ignores an incorrect weekday.
    // Require an exact valid HTTP-date in one of the documented formats.
    if (header !== utc && header !== `${weekday}, ${dayOfMonth}-${month}-${year.slice(-2)} ${clock} GMT` &&
        header !== `${day.slice(0, 3)} ${month} ${dayOfMonth.replace(/^0/, " ")} ${clock} ${year}`) return ignored;
    waitMs = time - now;
  }
  if (waitMs <= 0) return ignored;
  const at = now + waitMs;
  // Saturate valid numeric delays rather than dropping the provider's wait:
  // durable retries must remain blocked even if the delay exceeds the receipt
  // timestamp range. Keep the original wait (including Infinity) for legacy
  // in-process retries. Neither ISO overflow nor extended years can escape.
  if (numeric && at > MAX_RETRY_AFTER_MS) return { waitMs, retryAfterAt: MAX_RETRY_AFTER_AT };
  const iso = Number.isFinite(at) && Math.abs(at) <= 8_640_000_000_000_000 ? new Date(at).toISOString() : null;
  return { waitMs, retryAfterAt: iso !== null && /^[0-9]{4}-/.test(iso) ? iso : null };
}
function transportCode(error: unknown): "redirect_rejected" | "transport_failure" {
  // Node/Undici rejects redirect:error before exposing a Response. Preserve
  // that terminal classification without surfacing its raw Error/cause.
  return record(error) && (error.message === "unexpected redirect" ||
    (record(error.cause) && error.cause.message === "unexpected redirect")) ? "redirect_rejected" : "transport_failure";
}

/** At most three same-generation, fixed-origin, non-generating GETs in twenty
 * seconds. Only transient metadata availability/transport failures retry;
 * identity, content, auth and redirect failures are terminal. No fallbacks,
 * configurable destination, paid inference or raw-response persistence. */
export async function fetchGenerationRouteProof(args: FetchGenerationRouteProofArgs): Promise<GenerationRouteProof> {
  return fetchGenerationRouteProofAttempts(args, 3);
}

/** Exactly one metadata GET, with the same deadlines and validation. Durable
 * callers own retry scheduling; this reader never waits or retries internally. */
export async function fetchGenerationRouteProofOnce(args: FetchGenerationRouteProofArgs): Promise<GenerationRouteProof> {
  return fetchGenerationRouteProofAttempts(args, 1);
}

async function fetchGenerationRouteProofAttempts(args: FetchGenerationRouteProofArgs, maxAttempts: 1 | 3): Promise<GenerationRouteProof> {
  const expected = ownExpectation(args), timeoutMs = args.timeoutMs === undefined ? MAX_TIMEOUT_MS : args.timeoutMs;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS ||
      (args.fetcher !== undefined && typeof args.fetcher !== "function") ||
      (args.now !== undefined && typeof args.now !== "function")) return fail("invalid_request");
  const clock = args.now ?? Date.now;
  const retryClock = () => {
    try {
      const value = clock();
      if (Number.isSafeInteger(value) && Math.abs(value) <= 8_640_000_000_000_000) return value;
    } catch { /* Never expose a clock implementation's exception. */ }
    return fail("invalid_request");
  };
  retryClock();
  let apiKey: string;
  try {
    apiKey = (args.config === undefined ? getOpenRouterConfig() : args.config).apiKey;
    if (typeof apiKey !== "string" || !apiKey.trim() || apiKey.length > 4096 || /[\r\n]/.test(apiKey)) return fail("configuration_unavailable");
  } catch { return fail("configuration_unavailable"); }
  const fetcher = args.fetcher ?? fetch;
  const url = `${GENERATION_URL}?id=${encodeURIComponent(expected.generationId)}`;
  const startedAt = Date.now();
  let attempts = 0, stopped = false;
  let currentStatus: number | null = null;
  let cancelAttempt = () => {};
  let waitTimer: ReturnType<typeof setTimeout> | undefined;
  let totalTimer: ReturnType<typeof setTimeout> | undefined;
  const remaining = () => Math.max(0, Math.min(timeoutMs, timeoutMs - (Date.now() - startedAt)));
  const deadline = new Promise<never>((_, reject) => {
    totalTimer = setTimeout(() => {
      stopped = true;
      reject(new GenerationRouteProofError("timeout", currentStatus, attempts));
      cancelAttempt();
    }, timeoutMs);
  });
  const run = async (): Promise<GenerationRouteProof> => {
    while (!stopped && remaining() > 0) {
      attempts++;
      currentStatus = null;
      const controller = new AbortController(), attemptStartedAt = Date.now();
      const attemptRemaining = () => Math.min(remaining(), MAX_ATTEMPT_MS - (Date.now() - attemptStartedAt));
      let response: Response | undefined;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let attemptTimer: ReturnType<typeof setTimeout> | undefined;
      let retryWait = 0, retryAfterAt: string | null = null;
      const cancel = () => {
        controller.abort();
        // Cancellation is best effort and cannot extend either deadline.
        if (reader) void reader.cancel().catch(() => {});
        else void response?.body?.cancel().catch(() => {});
      };
      cancelAttempt = cancel;
      const attemptDeadline = new Promise<never>((_, reject) => {
        attemptTimer = setTimeout(() => {
          reject(new GenerationRouteProofError("timeout"));
          cancel();
        }, attemptRemaining());
      });
      const read = async (): Promise<GenerationRouteProof> => {
        response = await fetcher(url, { method: "GET", headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
          redirect: "error", cache: "no-store", credentials: "omit", signal: controller.signal });
        if (controller.signal.aborted || stopped) { cancel(); return fail("timeout"); }
        currentStatus = response.status || null;
        if (attemptRemaining() <= 0) return fail("timeout");
        if (response.redirected || response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400) ||
            (response.url && response.url !== url)) return fail("redirect_rejected");
        const contentLength = response.headers.get("content-length");
        if (contentLength !== null && (!/^(?:0|[1-9][0-9]*)$/.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES)) return fail("response_too_large");
        if (!response.ok) {
          if (retryableStatus(currentStatus)) {
            const retry = retryAfter(response.headers.get("retry-after"), retryClock());
            retryWait = retry.waitMs;
            retryAfterAt = retry.retryAfterAt;
          }
          return fail("api_failure");
        }
        if (!response.body) return fail("response_invalid");
        reader = response.body.getReader();
        const chunks: Uint8Array[] = []; let bytes = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (controller.signal.aborted || stopped || attemptRemaining() <= 0) return fail("timeout");
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_RESPONSE_BYTES) return fail("response_too_large");
          chunks.push(value);
        }
        let raw: unknown;
        try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes))); }
        catch { return fail("json_invalid"); }
        const proof = qualifyGenerationRouteProof(raw, expected);
        if (attemptRemaining() <= 0) return fail("timeout");
        return proof;
      };
      let failure: GenerationRouteProofError;
      try { return await Promise.race([attemptDeadline, read()]); }
      catch (error) {
        const code = error instanceof GenerationRouteProofError ? error.code : transportCode(error);
        failure = new GenerationRouteProofError(code, currentStatus, attempts, retryAfterAt);
      } finally {
        clearTimeout(attemptTimer);
        cancel();
      }
      const waitMs = Math.max(RETRY_DELAYS_MS[attempts - 1] ?? Infinity, retryWait);
      if (!isTransientGenerationRouteFailure(failure) || stopped || attempts >= maxAttempts || waitMs >= remaining()) throw failure;
      await new Promise<void>(resolve => { waitTimer = setTimeout(resolve, waitMs); });
    }
    throw new GenerationRouteProofError("timeout", currentStatus, attempts);
  };
  try { return await Promise.race([deadline, run()]); }
  finally {
    stopped = true;
    clearTimeout(totalTimer);
    clearTimeout(waitTimer);
    cancelAttempt();
  }
}
