import { createHash } from "node:crypto";
import { getOpenRouterConfig, type OpenRouterConfig } from "../models/openrouter";
import { MAX_CREATIVE_PNG_BYTES } from "./types";

/** A single, priced image.generate operation. Commercial-rights clearance is a separate caller gate. */
export const IMAGE_GENERATION_POLICY = {
  version: "recraft-image-1.0",
  provider: "openrouter",
  upstreamProvider: "recraft",
  modelId: "recraft/recraft-v4.1-pro",
  aspectRatio: "1:1",
  imageCount: 1,
  estimatedMicrousd: 210_000,
  maximumPromptBytes: 6_000,
  maximumResponseBytes: 12 * 1024 * 1024,
  maximumPngBytes: MAX_CREATIVE_PNG_BYTES,
  maximumCatalogBytes: 256 * 1024,
  maximumTimeoutMs: 120_000,
  maximumQuoteAgeMs: 300_000,
  pricingSource: "https://openrouter.ai/api/v1/images/models/recraft/recraft-v4.1-pro/endpoints",
} as const;

export type ImageGenerationRequest = { prompt: string };
export type ImageGenerationQuote = {
  version: string;
  provider: "openrouter";
  upstreamProvider: "recraft";
  modelId: string;
  promptHash: string;
  requestHash: string;
  pricingFingerprint: string;
  estimatedMicrousd: number;
  verifiedAt: string;
  source: string;
  quoteId: string;
  estimateOnly: true;
  providerInvoiceGuarantee: false;
};
export type ImageGenerationAuthorization = {
  /** The caller must durably reserve this exact request before calling generate. */
  reservationId: string;
  reservedMicrousd: number;
  preauthorized: true;
  quote: ImageGenerationQuote;
};
export type ImageResponseDiagnostics = {
  reason: string; dataCount: number | null; declaredMediaType: "image/png" | "image/webp" | "image/jpeg" | "image/svg+xml" | "absent" | "other";
  encodedBytes: number | null; decodedBytes: number | null; detectedMediaType: "image/png" | "image/webp" | "unknown";
  originalSha256: string | null; created: number | null;
};
export type ImageGenerationReceipt = {
  capability: "image.generate";
  provider: "openrouter";
  upstreamProvider: "recraft";
  modelId: string;
  providerRequestId: string | null;
  reservationId: string;
  quoteId: string;
  promptHash: string;
  requestHash: string;
  elapsedMs: number;
  estimatedMicrousd: number;
  reportedCostUsd: number | null;
  reportedMicrousd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  imageResponse?: ImageResponseDiagnostics;
};
export type ImageGenerationResult = {
  bytes: Uint8Array;
  /** Provider source bytes: full decoding/normalization and print validation occur after immutable source storage. */
  mediaType: "image/png" | "image/webp";
  declaredMediaType: ImageResponseDiagnostics["declaredMediaType"];
  receipt: ImageGenerationReceipt;
};
export interface ImageProviderAdapter {
  preflight(request: ImageGenerationRequest): Promise<ImageGenerationQuote>;
  generate(request: ImageGenerationRequest, authorization: ImageGenerationAuthorization): Promise<ImageGenerationResult>;
}
export type ImageProviderErrorCategory =
  | "invalid_request" | "configuration_required" | "preflight_rejected"
  | "authorization_required" | "provider_timeout" | "provider_unavailable"
  | "provider_rejected" | "authentication_required" | "rate_limited"
  | "malformed_image_output" | "response_too_large";

export class ImageProviderError extends Error {
  readonly retryable = false;
  requestDispatched = false;
  providerRequestId: string | null = null;
  /** A charge can be present even when the returned image is invalid. */
  receipt: ImageGenerationReceipt | null = null;
  constructor(readonly category: ImageProviderErrorCategory, message: string) {
    super(message);
    this.name = "ImageProviderError";
  }
}

export type OpenRouterImageAdapterOptions = {
  config?: OpenRouterConfig;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
};

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
};

function requestBody(request: ImageGenerationRequest) {
  if (!record(request) || Object.keys(request).some(key => key !== "prompt") ||
      typeof request.prompt !== "string" || !request.prompt.trim() ||
      Buffer.byteLength(request.prompt, "utf8") > IMAGE_GENERATION_POLICY.maximumPromptBytes) {
    throw new ImageProviderError("invalid_request", "Image generation requires only a nonempty prompt of at most 6000 UTF-8 bytes.");
  }
  return {
    model: IMAGE_GENERATION_POLICY.modelId, prompt: request.prompt,
    aspect_ratio: IMAGE_GENERATION_POLICY.aspectRatio,
    n: IMAGE_GENERATION_POLICY.imageCount, provider: { only: [IMAGE_GENERATION_POLICY.upstreamProvider], allow_fallbacks: false },
  };
}

function supportsEnum(parameters: Record<string, unknown>, key: string, value: string) {
  const descriptor = parameters[key];
  return record(descriptor) && descriptor.type === "enum" && Array.isArray(descriptor.values) && descriptor.values.includes(value);
}

/** Fail closed if the public endpoint introduces an unpriced fee or changes its price. */
export function parseImageGenerationQuote(
  catalog: unknown, request: ImageGenerationRequest, verifiedAt = new Date().toISOString(),
): ImageGenerationQuote {
  const body = requestBody(request);
  const reject = () => new ImageProviderError("preflight_rejected", "The image provider's exact capabilities and US$0.21 price could not be verified; review is required.");
  if (!record(catalog) || catalog.id !== IMAGE_GENERATION_POLICY.modelId || !Array.isArray(catalog.endpoints) || !Number.isFinite(Date.parse(verifiedAt))) throw reject();
  const endpoints = catalog.endpoints.filter(endpoint => record(endpoint) && endpoint.provider_tag === IMAGE_GENERATION_POLICY.upstreamProvider);
  if (endpoints.length !== 1 || !record(endpoints[0])) throw reject();
  const endpoint = endpoints[0];
  if (endpoint.provider_slug !== IMAGE_GENERATION_POLICY.upstreamProvider || !record(endpoint.supported_parameters)) throw reject();
  const parameters = endpoint.supported_parameters;
  if (!supportsEnum(parameters, "aspect_ratio", "1:1") || !record(parameters.n) || parameters.n.type !== "range" || parameters.n.min !== 1 || parameters.n.max !== 6) throw reject();
  if (!Array.isArray(endpoint.pricing) || endpoint.pricing.length !== 1) throw reject();
  const price = endpoint.pricing[0];
  if (!record(price) || Object.keys(price).sort().join(",") !== "billable,cost_usd,unit" ||
      price.billable !== "output_image" || price.unit !== "image" || price.cost_usd !== 0.21) throw reject();
  const fields = {
    version: IMAGE_GENERATION_POLICY.version, provider: IMAGE_GENERATION_POLICY.provider,
    upstreamProvider: IMAGE_GENERATION_POLICY.upstreamProvider, modelId: IMAGE_GENERATION_POLICY.modelId,
    promptHash: hash(request.prompt), requestHash: hash(canonical(body)),
    pricingFingerprint: hash(canonical({ supported_parameters: parameters, pricing: [...endpoint.pricing].sort((a, b) => canonical(a).localeCompare(canonical(b))) })),
    estimatedMicrousd: IMAGE_GENERATION_POLICY.estimatedMicrousd, verifiedAt,
    source: IMAGE_GENERATION_POLICY.pricingSource, estimateOnly: true as const, providerInvoiceGuarantee: false as const,
  };
  return { ...fields, quoteId: hash(canonical(fields)) };
}

function safeProviderId(value: unknown): string | null {
  return typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,300}$/.test(value) ? value : null;
}

function optionalNonnegative(value: unknown): number | null {
  const parsed = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
function optionalTokens(value: unknown): number | null {
  const number = optionalNonnegative(value);
  return number !== null && Number.isSafeInteger(number) ? number : null;
}

function imageBytes(body: Record<string, unknown>, receipt: ImageGenerationReceipt): { bytes: Uint8Array; mediaType: "image/png" | "image/webp"; declaredMediaType: ImageResponseDiagnostics["declaredMediaType"] } {
  const output = Array.isArray(body.data) && body.data.length === 1 && record(body.data[0]) ? body.data[0] : null;
  const mime = output?.media_type;
  const diagnostics: ImageResponseDiagnostics = {
    reason: "envelope", dataCount: Array.isArray(body.data) ? body.data.length : null,
    declaredMediaType: mime === undefined ? "absent" : ["image/png", "image/webp", "image/jpeg", "image/svg+xml"].includes(mime as string) ? mime as ImageResponseDiagnostics["declaredMediaType"] : "other",
    encodedBytes: typeof output?.b64_json === "string" ? output.b64_json.length : null,
    decodedBytes: null, detectedMediaType: "unknown", originalSha256: null,
    created: typeof body.created === "number" && Number.isSafeInteger(body.created) && body.created >= 0 ? body.created : null,
  };
  receipt.imageResponse = diagnostics;
  const fail = (reason: string): never => {
    diagnostics.reason = reason;
    throw new ImageProviderError("malformed_image_output", `The provider image failed bounded source validation (${reason}).`);
  };
  if (!output) return fail("image_count_or_envelope");
  if (typeof output.b64_json !== "string") fail("missing_base64");
  if (output.url !== undefined || output.image_url !== undefined) fail("remote_image_url_rejected");
  const encoded = output.b64_json as string;
  // Buffer.from alone tolerates truncated/non-base64 input, so verify canonical base64 too.
  if (!encoded.length || encoded.length > Math.ceil(IMAGE_GENERATION_POLICY.maximumPngBytes / 3) * 4) fail("encoded_size");
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) fail("invalid_base64");
  const bytes = Buffer.from(encoded, "base64");
  diagnostics.decodedBytes = bytes.length;
  if (bytes.length > IMAGE_GENERATION_POLICY.maximumPngBytes || bytes.length < 12) fail("decoded_size");
  if (bytes.toString("base64") !== encoded) fail("noncanonical_base64");
  const mediaType = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png" :
    bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" ? "image/webp" : null;
  if (!mediaType) return fail("unsupported_image_magic");
  diagnostics.detectedMediaType = mediaType;
  diagnostics.originalSha256 = createHash("sha256").update(bytes).digest("hex");
  if (mediaType === "image/png" && bytes.length < 33) fail("decoded_size");
  diagnostics.reason = mime !== undefined && mime !== mediaType ? "bounded_source_media_type_conflict" : "bounded_source_only";
  // This is not a validation PASS. Store the source privately, then fully decode,
  // normalize only static lossless WebP, and inspect the resulting original-size PNG.
  return { bytes, mediaType, declaredMediaType: diagnostics.declaredMediaType };
}

async function readBoundedJson(response: Response, limit: number): Promise<Record<string, unknown>> {
  const fail = () => new ImageProviderError("malformed_image_output", "The provider returned an invalid JSON envelope.");
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && /^\d+$/.test(declaredLength) && Number(declaredLength) > limit) {
    await response.body?.cancel();
    throw new ImageProviderError("response_too_large", "The provider response exceeds the permitted size.");
  }
  if (!response.body) throw fail();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new ImageProviderError("response_too_large", "The provider response exceeds the permitted size.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw fail(); }
  if (!record(parsed)) throw fail();
  return parsed;
}

export class OpenRouterImageAdapter implements ImageProviderAdapter {
  private readonly config: OpenRouterConfig;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly consumedReservations = new Set<string>();

  constructor(options: OpenRouterImageAdapterOptions = {}) {
    this.config = options.config ?? getOpenRouterConfig();
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? IMAGE_GENERATION_POLICY.maximumTimeoutMs;
    this.now = options.now ?? Date.now;
    // This deliberately narrow adapter cannot redirect credentials to an alternate origin.
    if (this.config.baseUrl.replace(/\/$/, "") !== "https://openrouter.ai/api/v1" || !this.config.apiKey.trim() ||
        !Number.isInteger(this.timeoutMs) || this.timeoutMs <= 0 || this.timeoutMs > IMAGE_GENERATION_POLICY.maximumTimeoutMs) {
      throw new ImageProviderError("configuration_required", "Image generation requires the official OpenRouter endpoint and a timeout of at most 120 seconds.");
    }
  }

  private async request(url: string, init: RequestInit, limit: number, timeoutMs = this.timeoutMs) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let requestId: string | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ImageProviderError("provider_timeout", "The image provider request timed out; no automatic retry is permitted."));
      }, timeoutMs);
    });
    try {
      return await Promise.race([timeout, (async () => {
        const response = await this.fetcher(url, { ...init, cache: "no-store", redirect: "error", signal: controller.signal });
        requestId = safeProviderId(response.headers.get("x-generation-id")) || safeProviderId(response.headers.get("x-request-id")) || safeProviderId(response.headers.get("x-openrouter-request-id"));
        if (!response.ok) {
          await response.body?.cancel();
          const category = response.status === 401 || response.status === 403 ? "authentication_required" :
            response.status === 429 ? "rate_limited" : response.status === 408 || response.status === 504 ? "provider_timeout" :
              response.status >= 500 ? "provider_unavailable" : "provider_rejected";
          throw new ImageProviderError(category, `OpenRouter image request failed with HTTP ${response.status}; no automatic retry is permitted.`);
        }
        const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
        if (contentType !== "application/json") {
          await response.body?.cancel();
          throw new ImageProviderError("malformed_image_output", "The provider response must be JSON.");
        }
        return { body: await readBoundedJson(response, limit), requestId };
      })()]);
    } catch (error) {
      const safeError = error instanceof ImageProviderError ? error :
        new ImageProviderError("provider_unavailable", "The image provider request failed; no automatic retry is permitted.");
      safeError.providerRequestId = requestId;
      throw safeError;
    } finally {
      clearTimeout(timer);
    }
  }

  async preflight(request: ImageGenerationRequest): Promise<ImageGenerationQuote> {
    requestBody(request);
    // This endpoint is public. Do not transmit credentials or the prompt for pricing discovery.
    const { body } = await this.request(IMAGE_GENERATION_POLICY.pricingSource, { method: "GET" }, IMAGE_GENERATION_POLICY.maximumCatalogBytes, Math.min(this.timeoutMs, 10_000));
    return parseImageGenerationQuote(body, request, new Date(this.now()).toISOString());
  }

  async generate(request: ImageGenerationRequest, authorization: ImageGenerationAuthorization): Promise<ImageGenerationResult> {
    const body = requestBody(request);
    if (!record(authorization) || authorization.preauthorized !== true ||
        typeof authorization.reservationId !== "string" || !authorization.reservationId.trim() || authorization.reservationId.length > 200 ||
        !Number.isSafeInteger(authorization.reservedMicrousd) || authorization.reservedMicrousd < IMAGE_GENERATION_POLICY.estimatedMicrousd ||
        !record(authorization.quote)) throw new ImageProviderError("authorization_required", "A persisted, explicitly preauthorized image cost reservation and quote are required.");
    // Snapshot caller-owned objects before awaiting so a changed prompt/quote cannot evade the binding.
    const reservationId = authorization.reservationId;
    const quote = { ...authorization.quote };
    const age = this.now() - Date.parse(quote.verifiedAt);
    const { quoteId, ...quoteFields } = quote;
    if (!Number.isFinite(age) || age < 0 || age > IMAGE_GENERATION_POLICY.maximumQuoteAgeMs ||
        quoteId !== hash(canonical(quoteFields)) || quote.requestHash !== hash(canonical(body)) || quote.promptHash !== hash(body.prompt)) {
      throw new ImageProviderError("authorization_required", "A fresh unmodified quote bound to this exact image request is required.");
    }
    if (this.consumedReservations.has(reservationId)) throw new ImageProviderError("authorization_required", "This image reservation has already been attempted; replay is blocked.");
    // The durable caller must also deduplicate across processes/restarts. This guards concurrent local calls.
    this.consumedReservations.add(reservationId);
    const fresh = await this.preflight({ prompt: body.prompt });
    const { quoteId: freshQuoteId, verifiedAt: freshAt, ...freshBinding } = fresh;
    const { quoteId: previousQuoteId, verifiedAt: previousAt, ...previousBinding } = quote;
    void freshQuoteId; void freshAt; void previousQuoteId; void previousAt;
    if (canonical(freshBinding) !== canonical(previousBinding)) throw new ImageProviderError("preflight_rejected", "The image pricing or capabilities changed after reservation; review is required.");
    const startedAt = this.now();
    let receipt: ImageGenerationReceipt | null = null;
    try {
      const response = await this.request("https://openrouter.ai/api/v1/images", {
        method: "POST", headers: { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json", "HTTP-Referer": this.config.appUrl, "X-Title": this.config.appName },
        body: JSON.stringify(body),
      }, IMAGE_GENERATION_POLICY.maximumResponseBytes);
      const usage = record(response.body.usage) ? response.body.usage : {};
      const reportedCostUsd = optionalNonnegative(usage.cost);
      const reportedMicrousd = reportedCostUsd === null ? null : Math.ceil(reportedCostUsd * 1_000_000);
      receipt = {
        capability: "image.generate", provider: "openrouter", upstreamProvider: "recraft", modelId: IMAGE_GENERATION_POLICY.modelId,
        providerRequestId: response.requestId ?? safeProviderId(response.body.id),
        reservationId, quoteId: quote.quoteId, promptHash: quote.promptHash, requestHash: quote.requestHash,
        elapsedMs: Math.max(0, this.now() - startedAt), estimatedMicrousd: IMAGE_GENERATION_POLICY.estimatedMicrousd,
        reportedCostUsd, reportedMicrousd: reportedMicrousd !== null && Number.isSafeInteger(reportedMicrousd) ? reportedMicrousd : null,
        inputTokens: optionalTokens(usage.prompt_tokens), outputTokens: optionalTokens(usage.completion_tokens), totalTokens: optionalTokens(usage.total_tokens),
      };
      if (response.body.error !== undefined || (response.body.model !== undefined && response.body.model !== IMAGE_GENERATION_POLICY.modelId) ||
          (response.body.provider !== undefined && response.body.provider !== "recraft" && response.body.provider !== "Recraft")) {
        throw new ImageProviderError("malformed_image_output", "The image response contains an error or unexpected provider/model identity.");
      }
      return { ...imageBytes(response.body, receipt), receipt };
    } catch (error) {
      const failure = error instanceof ImageProviderError ? error : new ImageProviderError("malformed_image_output", "The image response could not be validated.");
      failure.requestDispatched = true;
      failure.receipt = receipt;
      failure.providerRequestId = receipt?.providerRequestId ?? failure.providerRequestId;
      throw failure;
    }
  }
}
