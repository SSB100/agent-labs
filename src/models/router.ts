import type { JsonObject } from "../core/contracts";
import { resolveModelRoute } from "./registry";
import type {
  ModelProviderError,
  ModelRouteAttempt,
  ModelRouteRunResult,
  RunModelRouteOptions,
} from "./types";
import {
  ModelProviderError as ProviderError,
  ModelRouterError,
} from "./types";

function asProviderError(error: unknown): ModelProviderError {
  if (error instanceof ProviderError) {
    return error;
  }

  return new ProviderError(
    "provider_unavailable",
    error instanceof Error ? error.message : "The model provider failed.",
    true,
  );
}

function attemptDetails(attempts: readonly ModelRouteAttempt[]): JsonObject {
  return {
    attempts: attempts.map((attempt) => ({
      attempt: attempt.attempt,
      modelKey: attempt.modelKey,
      providerModelId: attempt.providerModelId,
      providerFamily: attempt.providerFamily,
      outcome: attempt.outcome,
      failureCategory: attempt.failureCategory,
      failureMessage: attempt.failureMessage,
      latencyMs: attempt.latencyMs,
      provider: attempt.provider,
      providerRequestId: attempt.providerRequestId,
      reportedCostUsd: attempt.usage?.reportedCostUsd ?? null,
      estimatedCostUsd: attempt.usage?.estimatedCostUsd ?? null,
    })),
  };
}

export async function runModelRoute(
  options: RunModelRouteOptions,
): Promise<ModelRouteRunResult> {
  const resolved = resolveModelRoute(options.routeKey);
  const attempts: ModelRouteAttempt[] = [];
  const requestMetadata = options.requestMetadata ?? {};

  for (let index = 0; index < resolved.candidates.length; index += 1) {
    const attemptNumber = index + 1;
    const model = resolved.candidates[index];

    await options.telemetry?.onAttemptStarted?.({
      attempt: attemptNumber,
      routeKey: options.routeKey,
      model,
    });

    try {
      if (index === 0 && options.forcePrimaryFailure === true) {
        throw new ProviderError(
          "provider_unavailable",
          "The primary route was deliberately unavailable for the bounded fallback proof.",
          true,
          { qualificationFixture: "forced_primary_failure" },
        );
      }

      const response = await options.adapter.invokeStructured({
        model,
        schemaName: options.schemaName,
        outputSchema: options.outputSchema,
        messages: options.messages,
        requestMetadata: {
          ...requestMetadata,
          routeKey: options.routeKey,
          attempt: attemptNumber,
          modelKey: model.modelKey,
        },
      });

      const completedAttempt: ModelRouteAttempt = {
        attempt: attemptNumber,
        modelKey: model.modelKey,
        providerModelId: model.providerModelId,
        providerFamily: model.providerFamily,
        outcome: "completed",
        failureCategory: null,
        failureMessage: null,
        latencyMs: response.latencyMs,
        usage: response.usage,
        provider: response.provider,
        providerRequestId: response.providerRequestId,
        metadata: response.metadata,
      };
      attempts.push(completedAttempt);
      await options.telemetry?.onAttemptFinished?.({
        attempt: completedAttempt,
        routeKey: options.routeKey,
        model,
      });

      const reportedCosts = attempts
        .map((attempt) => attempt.usage?.reportedCostUsd)
        .filter((cost): cost is number => typeof cost === "number");

      return {
        routeKey: options.routeKey,
        selectedModel: model,
        output: response.output,
        providerResponse: response,
        attempts,
        totalReportedCostUsd:
          reportedCosts.length > 0
            ? reportedCosts.reduce((total, cost) => total + cost, 0)
            : null,
        totalEstimatedCostUsd: attempts.reduce(
          (total, attempt) => total + (attempt.usage?.estimatedCostUsd ?? 0),
          0,
        ),
      };
    } catch (error) {
      const providerError = asProviderError(error);
      const failedAttempt: ModelRouteAttempt = {
        attempt: attemptNumber,
        modelKey: model.modelKey,
        providerModelId: model.providerModelId,
        providerFamily: model.providerFamily,
        outcome: "failed",
        failureCategory: providerError.category,
        failureMessage: providerError.message,
        latencyMs: null,
        usage: null,
        provider: model.provider,
        providerRequestId: null,
        metadata: providerError.details,
      };
      attempts.push(failedAttempt);
      await options.telemetry?.onAttemptFinished?.({
        attempt: failedAttempt,
        routeKey: options.routeKey,
        model,
      });

      const hasFallback = attemptNumber < resolved.route.maximumAttempts;
      if (providerError.retryable && hasFallback) {
        continue;
      }

      throw new ModelRouterError(
        providerError.category,
        providerError.message,
        attempts,
        {
          ...attemptDetails(attempts),
          routeKey: options.routeKey,
          retryable: providerError.retryable,
        },
      );
    }
  }

  throw new ModelRouterError(
    "all_routes_failed",
    `Every qualified candidate for route ${options.routeKey} failed.`,
    attempts,
    {
      ...attemptDetails(attempts),
      routeKey: options.routeKey,
    },
  );
}
