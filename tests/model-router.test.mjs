import assert from "node:assert/strict";
import test from "node:test";

import openRouterModule from "../.core-tests/models/openrouter.js";
import registryModule from "../.core-tests/models/registry.js";
import routerModule from "../.core-tests/models/router.js";
import typesModule from "../.core-tests/models/types.js";
import workerModule from "../.core-tests/workers/generic-researcher-model.js";

const { OpenRouterAdapter } = openRouterModule;
const { MODEL_ROUTE_REGISTRY, resolveModelRoute } = registryModule;
const { runModelRoute } = routerModule;
const { ModelProviderError, ModelRouterError } = typesModule;
const { MODEL_RESEARCHER_MANIFEST, MODEL_RESEARCHER_ROUTE_KEY } = workerModule;

const output = {
  decision: "complete",
  summary: "Three bounded signals were reviewed.",
  findings: [
    {
      signalId: "signal-1",
      evidence: "Evidence one",
      inference: "Inference one",
      evidenceArtifactId: "00000000-0000-4000-8000-000000005001",
    },
    {
      signalId: "signal-2",
      evidence: "Evidence two",
      inference: "Inference two",
      evidenceArtifactId: "00000000-0000-4000-8000-000000005001",
    },
    {
      signalId: "signal-3",
      evidence: "Evidence three",
      inference: "Inference three",
      evidenceArtifactId: "00000000-0000-4000-8000-000000005001",
    },
  ],
  evidenceCount: 3,
  usedArtifactIds: ["00000000-0000-4000-8000-000000005001"],
  stopReason: "completion_criteria_satisfied",
  scopeBoundary: "task_contract_only",
};

function providerResponse(model) {
  return {
    output,
    provider: "openrouter",
    providerModelId: model.providerModelId,
    providerRequestId: `request-${model.modelKey}`,
    latencyMs: 20,
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      reportedCostUsd: 0.0001,
      estimatedCostUsd: 0.0001,
    },
    metadata: {},
  };
}

test("every Stage 5 route resolves to two qualified, independent candidates", () => {
  for (const routeKey of Object.keys(MODEL_ROUTE_REGISTRY)) {
    const resolved = resolveModelRoute(routeKey);
    assert.equal(resolved.candidates.length, 2);
    assert.equal(resolved.primary.status, "qualified");
    assert.equal(resolved.fallback.status, "qualified");
    assert.notEqual(resolved.primary.modelKey, resolved.fallback.modelKey);
    assert.notEqual(resolved.primary.providerFamily, resolved.fallback.providerFamily);
    assert.equal(resolved.route.maximumAttempts, 2);
  }
});

test("Generic Researcher requests the logical standard route rather than a model ID", () => {
  assert.equal(MODEL_RESEARCHER_ROUTE_KEY, "standard.default");
  assert.equal(MODEL_RESEARCHER_MANIFEST.modelRequirements.routeKey, "standard.default");
  assert.equal(MODEL_RESEARCHER_MANIFEST.modelRequirements.modelRouterRequired, true);
  assert.equal(MODEL_RESEARCHER_MANIFEST.modelRequirements.structuredOutput, true);
  assert.equal(MODEL_RESEARCHER_MANIFEST.modelRequirements.fallbackRequired, true);
  assert.doesNotMatch(JSON.stringify(MODEL_RESEARCHER_MANIFEST), /openai\//);
  assert.doesNotMatch(JSON.stringify(MODEL_RESEARCHER_MANIFEST), /anthropic\//);
  assert.doesNotMatch(JSON.stringify(MODEL_RESEARCHER_MANIFEST), /google\//);
});

test("a retryable primary failure uses one genuinely different fallback", async () => {
  const calls = [];
  const adapter = {
    async invokeStructured(request) {
      calls.push(request.model.modelKey);
      if (calls.length === 1) {
        throw new ModelProviderError(
          "provider_unavailable",
          "Primary unavailable",
          true,
        );
      }
      return providerResponse(request.model);
    },
    async qualifyToolUse() {
      throw new Error("not used");
    },
  };

  const result = await runModelRoute({
    adapter,
    routeKey: "standard.default",
    outputSchema: { type: "object" },
    schemaName: "test_output",
    messages: [{ role: "user", content: "Return a bounded object." }],
  });

  assert.deepEqual(calls, ["luna.standard", "gemini.flash.large"]);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].outcome, "failed");
  assert.equal(result.attempts[1].outcome, "completed");
  assert.equal(result.selectedModel.modelKey, "gemini.flash.large");
});

test("a non-retryable provider failure stops without a workflow loop", async () => {
  let calls = 0;
  const adapter = {
    async invokeStructured() {
      calls += 1;
      throw new ModelProviderError(
        "authentication_required",
        "Invalid credentials",
        false,
      );
    },
    async qualifyToolUse() {
      throw new Error("not used");
    },
  };

  await assert.rejects(
    () =>
      runModelRoute({
        adapter,
        routeKey: "standard.default",
        outputSchema: { type: "object" },
        schemaName: "test_output",
        messages: [{ role: "user", content: "Return a bounded object." }],
      }),
    (error) =>
      error instanceof ModelRouterError &&
      error.category === "authentication_required" &&
      error.attempts.length === 1,
  );
  assert.equal(calls, 1);
});

test("the router never exceeds the route's bounded two attempts", async () => {
  let calls = 0;
  const adapter = {
    async invokeStructured() {
      calls += 1;
      throw new ModelProviderError("provider_unavailable", "Unavailable", true);
    },
    async qualifyToolUse() {
      throw new Error("not used");
    },
  };

  await assert.rejects(
    () =>
      runModelRoute({
        adapter,
        routeKey: "standard.default",
        outputSchema: { type: "object" },
        schemaName: "test_output",
        messages: [{ role: "user", content: "Return a bounded object." }],
      }),
    (error) => error instanceof ModelRouterError && error.attempts.length === 2,
  );
  assert.equal(calls, 2);
});

test("OpenRouter structured requests require the JSON schema and expose usage cost", async () => {
  let requestBody;
  const fetcher = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        id: "or-request-1",
        model: "openai/gpt-6-luna",
        provider: "OpenAI",
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify(output) },
          },
        ],
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 200,
          total_tokens: 1200,
          cost: 0.0002,
          prompt_tokens_details: { cached_tokens: 0 },
          completion_tokens_details: { reasoning_tokens: 10 },
        },
      }),
      { status: 200, headers: { "x-request-id": "header-request-1" } },
    );
  };

  const model = resolveModelRoute("standard.default").primary;
  const adapter = new OpenRouterAdapter({
    config: {
      apiKey: "test-key",
      baseUrl: "https://openrouter.invalid/api/v1",
      appUrl: "https://agent-labs.example",
      appName: "Agent Labs Test",
    },
    fetcher,
  });
  const response = await adapter.invokeStructured({
    model,
    schemaName: "test_output",
    outputSchema: { type: "object", additionalProperties: true },
    messages: [{ role: "user", content: "Return JSON." }],
    requestMetadata: {},
  });

  assert.equal(requestBody.response_format.type, "json_schema");
  assert.equal(requestBody.response_format.json_schema.strict, true);
  assert.equal(requestBody.provider.require_parameters, true);
  assert.equal(response.usage.reportedCostUsd, 0.0002);
  assert.equal(response.usage.totalTokens, 1200);
  assert.equal(response.output.decision, "complete");
});

test("OpenRouter tool qualification verifies a forced structured tool call", async () => {
  let requestBody;
  const fetcher = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        id: "or-tool-1",
        model: "openai/gpt-6-luna",
        provider: "OpenAI",
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              tool_calls: [
                {
                  id: "tool-1",
                  type: "function",
                  function: {
                    name: "stage5_tool_probe",
                    arguments: JSON.stringify({ token: "proof-token" }),
                  },
                },
              ],
            },
          },
        ],
        usage: {
          prompt_tokens: 50,
          completion_tokens: 10,
          total_tokens: 60,
          cost: 0.00001,
        },
      }),
      { status: 200 },
    );
  };

  const model = resolveModelRoute("standard.default").primary;
  const adapter = new OpenRouterAdapter({
    config: {
      apiKey: "test-key",
      baseUrl: "https://openrouter.invalid/api/v1",
      appUrl: "https://agent-labs.example",
      appName: "Agent Labs Test",
    },
    fetcher,
  });
  const result = await adapter.qualifyToolUse({
    model,
    token: "proof-token",
    requestMetadata: {},
  });

  assert.equal(requestBody.tool_choice.function.name, "stage5_tool_probe");
  assert.equal(requestBody.parallel_tool_calls, false);
  assert.equal(result.toolName, "stage5_tool_probe");
  assert.equal(result.arguments.token, "proof-token");
});
