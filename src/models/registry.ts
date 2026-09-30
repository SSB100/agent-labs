import type {
  ModelCapability,
  ModelCatalogSnapshot,
  ModelDefinition,
  ModelRouteDefinition,
  ModelRouteKey,
  ResolvedModelRoute,
} from "./types";
import { ModelRouterError } from "./types";

export const LUNA_STANDARD_MODEL_KEY = "luna.standard";
export const GEMINI_FLASH_MODEL_KEY = "gemini.flash.large";
export const CLAUDE_HAIKU_REVIEW_MODEL_KEY = "claude.haiku.review";
export const SOL_HIGH_POWER_MODEL_KEY = "sol.high-power";
export const CLAUDE_SONNET_HIGH_POWER_MODEL_KEY = "claude.sonnet.high-power";

const CATALOG_CHECKED_AT = "2026-09-29T10:20:00.000Z";
const CATALOG_SOURCE = "openrouter_catalog_2026-09-29";

export const MODEL_REGISTRY = {
  [LUNA_STANDARD_MODEL_KEY]: {
    modelKey: LUNA_STANDARD_MODEL_KEY,
    displayName: "GPT-5.6 Luna",
    provider: "openrouter",
    providerFamily: "openai",
    providerModelId: "openai/gpt-5.6-luna",
    tier: "standard",
    status: "qualified",
    contextWindowTokens: 1_050_000,
    maxOutputTokens: 128_000,
    capabilities: [
      "structured_output",
      "tool_use",
      "large_context",
      "reasoning",
      "vision",
      "files",
    ],
    pricing: {
      inputPerMillionUsd: 0.2,
      outputPerMillionUsd: 1.2,
      cacheReadPerMillionUsd: 0.02,
      inputCacheWritePerMillionUsd: 0.25,
      verifiedAt: "2026-09-30T09:12:00.000Z",
      source: "https://openrouter.ai/api/v1/models",
      longContext: { minimumInputTokens: 272_000, inputPerMillionUsd: 0.4, outputPerMillionUsd: 1.8, cacheReadPerMillionUsd: 0.04, inputCacheWritePerMillionUsd: 0.5 },
    },
    qualifications: {
      structuredOutput: "qualified",
      toolUse: "qualified",
      source: CATALOG_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
    },
  },
  [GEMINI_FLASH_MODEL_KEY]: {
    modelKey: GEMINI_FLASH_MODEL_KEY,
    displayName: "Gemini 3.6 Flash",
    provider: "openrouter",
    providerFamily: "google",
    providerModelId: "google/gemini-3.6-flash",
    tier: "large_context",
    status: "qualified",
    contextWindowTokens: 1_048_576,
    maxOutputTokens: 65_536,
    capabilities: [
      "structured_output",
      "tool_use",
      "large_context",
      "reasoning",
      "vision",
      "files",
    ],
    pricing: {
      inputPerMillionUsd: 0.75,
      outputPerMillionUsd: 3.75,
      cacheReadPerMillionUsd: 0.075,
      inputCacheWritePerMillionUsd: 0.0416666666666667,
      verifiedAt: "2026-09-30T09:12:00.000Z",
      source: "https://openrouter.ai/api/v1/models",
    },
    qualifications: {
      structuredOutput: "qualified",
      toolUse: "qualified",
      source: CATALOG_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
    },
  },
  [CLAUDE_HAIKU_REVIEW_MODEL_KEY]: {
    modelKey: CLAUDE_HAIKU_REVIEW_MODEL_KEY,
    displayName: "Claude Haiku 4.5",
    provider: "openrouter",
    providerFamily: "anthropic",
    providerModelId: "anthropic/claude-haiku-4.5",
    tier: "review",
    status: "qualified",
    contextWindowTokens: 200_000,
    maxOutputTokens: 64_000,
    capabilities: [
      "structured_output",
      "tool_use",
      "reasoning",
      "vision",
      "files",
    ],
    pricing: {
      inputPerMillionUsd: 1,
      outputPerMillionUsd: 5,
      cacheReadPerMillionUsd: 0.1,
    },
    qualifications: {
      structuredOutput: "qualified",
      toolUse: "qualified",
      source: CATALOG_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
    },
  },
  [SOL_HIGH_POWER_MODEL_KEY]: {
    modelKey: SOL_HIGH_POWER_MODEL_KEY,
    displayName: "GPT-5.6 Sol",
    provider: "openrouter",
    providerFamily: "openai",
    providerModelId: "openai/gpt-5.6-sol",
    tier: "high_power",
    status: "qualified",
    contextWindowTokens: 1_050_000,
    maxOutputTokens: 128_000,
    capabilities: [
      "structured_output",
      "tool_use",
      "large_context",
      "reasoning",
      "vision",
      "files",
    ],
    pricing: {
      inputPerMillionUsd: 2.5,
      outputPerMillionUsd: 15,
      cacheReadPerMillionUsd: 0.25,
    },
    qualifications: {
      structuredOutput: "qualified",
      toolUse: "qualified",
      source: CATALOG_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
    },
  },
  [CLAUDE_SONNET_HIGH_POWER_MODEL_KEY]: {
    modelKey: CLAUDE_SONNET_HIGH_POWER_MODEL_KEY,
    displayName: "Claude Sonnet 4.6",
    provider: "openrouter",
    providerFamily: "anthropic",
    providerModelId: "anthropic/claude-sonnet-4.6",
    tier: "high_power",
    status: "qualified",
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 128_000,
    capabilities: [
      "structured_output",
      "tool_use",
      "large_context",
      "reasoning",
      "vision",
      "files",
    ],
    pricing: {
      inputPerMillionUsd: 3,
      outputPerMillionUsd: 15,
      cacheReadPerMillionUsd: 0.3,
    },
    qualifications: {
      structuredOutput: "qualified",
      toolUse: "qualified",
      source: CATALOG_SOURCE,
      checkedAt: CATALOG_CHECKED_AT,
    },
  },
} as const satisfies Record<string, ModelDefinition>;

export const MODEL_ROUTE_REGISTRY = {
  "standard.default": {
    routeKey: "standard.default",
    name: "Standard workhorse",
    description:
      "Economical default for routine structured work, with a different provider family as fallback.",
    status: "qualified",
    primaryModelKey: LUNA_STANDARD_MODEL_KEY,
    fallbackModelKey: GEMINI_FLASH_MODEL_KEY,
    maximumAttempts: 2,
    requirements: {
      structuredOutput: true,
      toolUse: false,
      minimumContextTokens: 200_000,
      preferredProviderFamily: "openai",
      independentFallback: true,
    },
  },
  "reviewer.independent": {
    routeKey: "reviewer.independent",
    name: "Independent reviewer",
    description:
      "Anthropic-family review route with an OpenAI-family fallback for independence from standard generation.",
    status: "qualified",
    primaryModelKey: CLAUDE_HAIKU_REVIEW_MODEL_KEY,
    fallbackModelKey: LUNA_STANDARD_MODEL_KEY,
    maximumAttempts: 2,
    requirements: {
      structuredOutput: true,
      toolUse: false,
      minimumContextTokens: 200_000,
      preferredProviderFamily: "anthropic",
      independentFallback: true,
    },
  },
  "escalation.high-power": {
    routeKey: "escalation.high-power",
    name: "High-power escalation",
    description:
      "Bounded escalation for difficult work, with an independent Claude-family fallback.",
    status: "qualified",
    primaryModelKey: SOL_HIGH_POWER_MODEL_KEY,
    fallbackModelKey: CLAUDE_SONNET_HIGH_POWER_MODEL_KEY,
    maximumAttempts: 2,
    requirements: {
      structuredOutput: true,
      toolUse: true,
      minimumContextTokens: 1_000_000,
      preferredProviderFamily: "openai",
      independentFallback: true,
    },
  },
  "large-context": {
    routeKey: "large-context",
    name: "Large-context specialist",
    description:
      "Gemini-class route for tasks that materially require a very large context window.",
    status: "qualified",
    primaryModelKey: GEMINI_FLASH_MODEL_KEY,
    fallbackModelKey: LUNA_STANDARD_MODEL_KEY,
    maximumAttempts: 2,
    requirements: {
      structuredOutput: true,
      toolUse: true,
      minimumContextTokens: 1_000_000,
      preferredProviderFamily: "google",
      independentFallback: true,
    },
  },
} as const satisfies Record<ModelRouteKey, ModelRouteDefinition>;

function hasCapability(model: ModelDefinition, capability: ModelCapability) {
  return model.capabilities.includes(capability);
}

function assertModelSupportsRoute(
  model: ModelDefinition,
  route: ModelRouteDefinition,
  position: "primary" | "fallback",
) {
  const requirements = route.requirements;
  const missing: string[] = [];

  if (model.status !== "qualified") {
    missing.push("qualified status");
  }
  if (
    requirements.structuredOutput &&
    (!hasCapability(model, "structured_output") ||
      model.qualifications.structuredOutput !== "qualified")
  ) {
    missing.push("structured output qualification");
  }
  if (
    requirements.toolUse &&
    (!hasCapability(model, "tool_use") || model.qualifications.toolUse !== "qualified")
  ) {
    missing.push("tool-use qualification");
  }
  if (model.contextWindowTokens < requirements.minimumContextTokens) {
    missing.push(`context window >= ${requirements.minimumContextTokens}`);
  }

  if (missing.length > 0) {
    throw new ModelRouterError(
      "route_unavailable",
      `${position} model ${model.modelKey} does not satisfy route ${route.routeKey}.`,
      [],
      { modelKey: model.modelKey, routeKey: route.routeKey, missing },
    );
  }
}

export function getModelDefinition(modelKey: string): ModelDefinition {
  const model = MODEL_REGISTRY[modelKey as keyof typeof MODEL_REGISTRY];
  if (!model) {
    throw new ModelRouterError("route_unavailable", `Model ${modelKey} is not registered.`);
  }
  return model;
}

export function resolveModelRoute(routeKey: ModelRouteKey): ResolvedModelRoute {
  const route = MODEL_ROUTE_REGISTRY[routeKey];
  if (!route || route.status !== "qualified") {
    throw new ModelRouterError(
      "route_unavailable",
      `Model route ${routeKey} is not qualified.`,
    );
  }

  const primary = getModelDefinition(route.primaryModelKey);
  const fallback = getModelDefinition(route.fallbackModelKey);
  assertModelSupportsRoute(primary, route, "primary");
  assertModelSupportsRoute(fallback, route, "fallback");

  if (
    route.requirements.independentFallback &&
    primary.providerFamily === fallback.providerFamily
  ) {
    throw new ModelRouterError(
      "route_unavailable",
      `Model route ${routeKey} does not provide an independent fallback.`,
      [],
      {
        primaryProviderFamily: primary.providerFamily,
        fallbackProviderFamily: fallback.providerFamily,
      },
    );
  }

  return {
    route,
    primary,
    fallback,
    candidates: [primary, fallback],
  };
}

export function getModelCatalogSnapshot(): ModelCatalogSnapshot {
  return {
    models: Object.values(MODEL_REGISTRY).map((model) => ({
      modelKey: model.modelKey,
      displayName: model.displayName,
      provider: model.provider,
      providerFamily: model.providerFamily,
      providerModelId: model.providerModelId,
      tier: model.tier,
      status: model.status,
      contextWindowTokens: model.contextWindowTokens,
      maxOutputTokens: model.maxOutputTokens,
      capabilities: [...model.capabilities],
      pricing: { ...model.pricing },
      qualifications: { ...model.qualifications },
    })),
    routes: Object.values(MODEL_ROUTE_REGISTRY).map((route) => ({
      routeKey: route.routeKey,
      name: route.name,
      description: route.description,
      status: route.status,
      primaryModelKey: route.primaryModelKey,
      fallbackModelKey: route.fallbackModelKey,
      maximumAttempts: route.maximumAttempts,
      requirements: { ...route.requirements },
    })),
  };
}
