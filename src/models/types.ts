import type { JsonObject, JsonValue } from "../core/contracts";

export const MODEL_CAPABILITIES = [
  "structured_output",
  "tool_use",
  "large_context",
  "reasoning",
  "vision",
  "files",
] as const;

export type ModelCapability = (typeof MODEL_CAPABILITIES)[number];

export const MODEL_QUALIFICATION_STATUSES = [
  "candidate",
  "qualified",
  "failed",
  "stale",
  "retired",
] as const;

export type ModelQualificationStatus =
  (typeof MODEL_QUALIFICATION_STATUSES)[number];

export const MODEL_ROUTE_KEYS = [
  "standard.default",
  "reviewer.independent",
  "escalation.high-power",
  "large-context",
] as const;

export type ModelRouteKey = (typeof MODEL_ROUTE_KEYS)[number];

export type ModelPriceMetadata = {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  cacheReadPerMillionUsd: number | null;
  inputCacheWritePerMillionUsd?: number;
  verifiedAt?: string;
  source?: string;
  longContext?: { minimumInputTokens: number; inputPerMillionUsd: number; outputPerMillionUsd: number; cacheReadPerMillionUsd: number; inputCacheWritePerMillionUsd: number };
};

export type ModelDefinition = {
  modelKey: string;
  displayName: string;
  provider: "openrouter";
  providerFamily: "openai" | "anthropic" | "google";
  providerModelId: string;
  tier: "standard" | "review" | "high_power" | "large_context";
  status: ModelQualificationStatus;
  contextWindowTokens: number;
  maxOutputTokens: number;
  capabilities: readonly ModelCapability[];
  pricing: ModelPriceMetadata;
  qualifications: {
    structuredOutput: ModelQualificationStatus;
    toolUse: ModelQualificationStatus;
    source: string;
    checkedAt: string;
  };
};

export type ModelRouteRequirements = {
  structuredOutput: boolean;
  toolUse: boolean;
  minimumContextTokens: number;
  preferredProviderFamily: ModelDefinition["providerFamily"] | null;
  independentFallback: boolean;
};

export type ModelRouteDefinition = {
  routeKey: ModelRouteKey;
  name: string;
  description: string;
  status: ModelQualificationStatus;
  primaryModelKey: string;
  fallbackModelKey: string;
  maximumAttempts: 2;
  requirements: ModelRouteRequirements;
};

export type ResolvedModelRoute = {
  route: ModelRouteDefinition;
  primary: ModelDefinition;
  fallback: ModelDefinition;
  candidates: readonly ModelDefinition[];
};

export type ModelMessage = {
  role: "system" | "user";
  content: string;
  /** Scoped original asset bytes; arbitrary remote image URLs are not accepted. */
  images?: readonly { mediaType: "image/png"; base64: string }[];
};

export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  reportedCostUsd: number | null;
  estimatedCostUsd: number;
};

export type ModelProviderResponse = {
  output: JsonObject;
  provider: string;
  providerModelId: string;
  providerRequestId: string | null;
  latencyMs: number;
  usage: ModelUsage;
  metadata: JsonObject;
};

export type ProviderPriceLimit = { prompt: number; completion: number; request: 0 };
export type WebSearchModelRequest = { model: ModelDefinition; query: string; allowedDomains: string[]; providerPriceLimit?: ProviderPriceLimit; providerOnly?: readonly string[]; requireReturnedModel?: boolean };

export type StructuredModelRequest = {
  requireReturnedModel?: boolean;
  providerPriceLimit?: ProviderPriceLimit;
  providerOnly?: readonly string[];
  maxOutputTokens?: number;
  model: ModelDefinition;
  schemaName: string;
  outputSchema: JsonObject;
  messages: readonly ModelMessage[];
  requestMetadata: JsonObject;
};

export type ToolQualificationRequest = {
  model: ModelDefinition;
  token: string;
  requestMetadata: JsonObject;
};

export type ToolQualificationResult = {
  provider: string;
  providerModelId: string;
  providerRequestId: string | null;
  latencyMs: number;
  usage: ModelUsage;
  toolName: string;
  arguments: JsonObject;
};

export interface ModelProviderAdapter {
  invokeStructured(request: StructuredModelRequest): Promise<ModelProviderResponse>;
  qualifyToolUse(request: ToolQualificationRequest): Promise<ToolQualificationResult>;
}

export const MODEL_PROVIDER_FAILURE_CATEGORIES = [
  "configuration_required",
  "authentication_required",
  "rate_limited",
  "provider_timeout",
  "provider_unavailable",
  "provider_rejected",
  "malformed_model_output",
  "tool_qualification_failed",
] as const;

export type ModelProviderFailureCategory =
  (typeof MODEL_PROVIDER_FAILURE_CATEGORIES)[number];

export class ModelProviderError extends Error {
  readonly category: ModelProviderFailureCategory;
  readonly retryable: boolean;
  readonly details: JsonObject;

  constructor(
    category: ModelProviderFailureCategory,
    message: string,
    retryable: boolean,
    details: JsonObject = {},
  ) {
    super(message);
    this.name = "ModelProviderError";
    this.category = category;
    this.retryable = retryable;
    this.details = details;
  }
}

export const MODEL_ROUTER_FAILURE_CATEGORIES = [
  "route_unavailable",
  "all_routes_failed",
  ...MODEL_PROVIDER_FAILURE_CATEGORIES,
] as const;

export type ModelRouterFailureCategory =
  (typeof MODEL_ROUTER_FAILURE_CATEGORIES)[number];

export class ModelRouterError extends Error {
  readonly category: ModelRouterFailureCategory;
  readonly attempts: readonly ModelRouteAttempt[];
  readonly details: JsonObject;

  constructor(
    category: ModelRouterFailureCategory,
    message: string,
    attempts: readonly ModelRouteAttempt[] = [],
    details: JsonObject = {},
  ) {
    super(message);
    this.name = "ModelRouterError";
    this.category = category;
    this.attempts = attempts;
    this.details = details;
  }
}

export type ModelRouteAttempt = {
  attempt: number;
  modelKey: string;
  providerModelId: string;
  providerFamily: ModelDefinition["providerFamily"];
  outcome: "completed" | "failed";
  failureCategory: ModelProviderFailureCategory | null;
  failureMessage: string | null;
  latencyMs: number | null;
  usage: ModelUsage | null;
  provider: string | null;
  providerRequestId: string | null;
  metadata: JsonObject;
};

export type ModelRouteRunResult = {
  routeKey: ModelRouteKey;
  selectedModel: ModelDefinition;
  output: JsonObject;
  providerResponse: ModelProviderResponse;
  attempts: readonly ModelRouteAttempt[];
  totalReportedCostUsd: number | null;
  totalEstimatedCostUsd: number;
};

export type ModelRouteAttemptStarted = {
  attempt: number;
  routeKey: ModelRouteKey;
  model: ModelDefinition;
};

export type ModelRouteAttemptFinished = {
  attempt: ModelRouteAttempt;
  routeKey: ModelRouteKey;
  model: ModelDefinition;
};

export type ModelRouteTelemetry = {
  onAttemptStarted?: (event: ModelRouteAttemptStarted) => void | Promise<void>;
  onAttemptFinished?: (event: ModelRouteAttemptFinished) => void | Promise<void>;
};

export type RunModelRouteOptions = {
  maxOutputTokens?: number;
  adapter: ModelProviderAdapter;
  routeKey: ModelRouteKey;
  outputSchema: JsonObject;
  schemaName: string;
  messages: readonly ModelMessage[];
  requestMetadata?: JsonObject;
  forcePrimaryFailure?: boolean;
  telemetry?: ModelRouteTelemetry;
};

export type ModelCatalogSnapshot = JsonObject & {
  models: JsonValue[];
  routes: JsonValue[];
};
