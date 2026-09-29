import type { JsonObject, JsonValue } from "../core/contracts";
import type { WorkerInvocationContext, WorkerPackManifest } from "./types";

export const GENERIC_RESEARCHER_PACK_ID = "00000000-0000-4000-8000-000000000401";
export const GENERIC_RESEARCHER_WORKER_DEFINITION_ID =
  "00000000-0000-4000-8000-000000000402";
export const GENERIC_RESEARCHER_PACK_KEY = "worker.generic-researcher-fixture";
export const GENERIC_RESEARCHER_WORKER_KEY = "generic.researcher.fixture";
export const GENERIC_RESEARCHER_VERSION = "1.0.0";

export const GENERIC_RESEARCHER_INPUT_SCHEMA: JsonObject = {
  type: "object",
  additionalProperties: false,
  required: ["taskContract", "inputArtifacts"],
  properties: {
    taskContract: {
      type: "object",
      additionalProperties: false,
      required: [
        "id",
        "objective",
        "inputArtifactIds",
        "permittedCapabilities",
        "requiredKnowledge",
        "requiredOutputSchema",
        "completionCriteria",
        "failureCriteria",
        "nonGoals",
        "escalationRules",
      ],
      properties: {
        id: { type: "string", format: "uuid" },
        objective: { type: "string", minLength: 1, maxLength: 4000 },
        inputArtifactIds: {
          type: "array",
          minItems: 1,
          uniqueItems: true,
          items: { type: "string", format: "uuid" },
        },
        permittedCapabilities: {
          type: "array",
          maxItems: 0,
          items: { type: "string" },
        },
        requiredKnowledge: {
          type: "array",
          minItems: 1,
          uniqueItems: true,
          items: { type: "string" },
        },
        requiredOutputSchema: { type: "object" },
        completionCriteria: { type: "object" },
        failureCriteria: { type: "object" },
        nonGoals: {
          type: "array",
          minItems: 1,
          uniqueItems: true,
          items: { type: "string" },
        },
        escalationRules: { type: "object" },
      },
    },
    inputArtifacts: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "artifactType", "name", "mediaType", "content", "metadata"],
        properties: {
          id: { type: "string", format: "uuid" },
          artifactType: { type: "string", minLength: 1 },
          name: { type: "string", minLength: 1 },
          mediaType: { type: "string", minLength: 1 },
          content: { type: "object" },
          metadata: { type: "object" },
        },
      },
    },
  },
};

export const GENERIC_RESEARCHER_OUTPUT_SCHEMA: JsonObject = {
  type: "object",
  additionalProperties: false,
  required: [
    "decision",
    "summary",
    "findings",
    "evidenceCount",
    "usedArtifactIds",
    "stopReason",
    "scopeBoundary",
  ],
  properties: {
    decision: { type: "string", const: "complete" },
    summary: { type: "string", minLength: 1, maxLength: 1000 },
    findings: {
      type: "array",
      minItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["signalId", "evidence", "inference", "evidenceArtifactId"],
        properties: {
          signalId: { type: "string", minLength: 1, maxLength: 120 },
          evidence: { type: "string", minLength: 1, maxLength: 500 },
          inference: { type: "string", minLength: 1, maxLength: 500 },
          evidenceArtifactId: { type: "string", format: "uuid" },
        },
      },
    },
    evidenceCount: { type: "integer", minimum: 3 },
    usedArtifactIds: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { type: "string", format: "uuid" },
    },
    stopReason: {
      type: "string",
      const: "completion_criteria_satisfied",
    },
    scopeBoundary: { type: "string", const: "task_contract_only" },
  },
};

export const GENERIC_RESEARCHER_MANIFEST: WorkerPackManifest = {
  manifestVersion: "1.0",
  packKey: GENERIC_RESEARCHER_PACK_KEY,
  version: GENERIC_RESEARCHER_VERSION,
  name: "Generic Researcher Fixture",
  worker: {
    workerKey: GENERIC_RESEARCHER_WORKER_KEY,
    version: GENERIC_RESEARCHER_VERSION,
    role: "Generic Researcher",
    charter:
      "Collect only the evidence requested by the Task Contract, clearly separate evidence from inference, use only referenced artifacts, and stop immediately when the completion criteria are satisfied.",
  },
  inputSchema: GENERIC_RESEARCHER_INPUT_SCHEMA,
  outputSchema: GENERIC_RESEARCHER_OUTPUT_SCHEMA,
  capabilityPolicy: {
    allowed: [],
    forbidden: [
      "browser.interact",
      "money.spend",
      "marketplace.publish",
      "shell.execute",
    ],
  },
  knowledgeRequirements: ["fixture.synthetic-market-signals"],
  modelRequirements: {
    executionMode: "deterministic_fixture",
    modelRouterRequired: false,
    structuredOutput: true,
  },
  instructions: [
    "Read only the Task Contract and artifacts explicitly supplied with it.",
    "Represent each source observation as evidence and keep inference in a separate field.",
    "Do not choose a business strategy, create a product, publish, browse or request hidden context.",
    "Stop after every referenced signal has been represented and the completion criteria are satisfied.",
  ],
  examples: [
    {
      name: "bounded evidence completion",
      input: {
        objective: "Summarise three supplied signals without recommending a strategy.",
        signalCount: 3,
      },
      expectedOutput: {
        decision: "complete",
        evidenceCount: 3,
        stopReason: "completion_criteria_satisfied",
      },
    },
  ],
  negativeExamples: [
    {
      name: "unbounded research",
      forbiddenBehaviour: "Continue searching after all supplied evidence satisfies the contract.",
      reason: "The worker must stop on completion and has no research capability in this fixture.",
    },
    {
      name: "strategy selection",
      forbiddenBehaviour: "Recommend a final business or product strategy.",
      reason: "Strategy selection belongs to a different specialist worker.",
    },
  ],
  escalationPolicy: {
    validationFailure: "fail_task",
    unavailableKnowledge: "fail_task",
    unexpectedFailure: "classify_and_stop",
  },
};

type FixtureSignal = {
  id: string;
  observation: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readSignals(content: JsonObject): FixtureSignal[] {
  if (!Array.isArray(content.signals)) {
    throw new Error("The fixture artifact does not contain a signals array.");
  }

  return content.signals.map((signal, index) => {
    if (
      !isRecord(signal) ||
      typeof signal.id !== "string" ||
      !signal.id.trim() ||
      typeof signal.observation !== "string" ||
      !signal.observation.trim()
    ) {
      throw new Error(`Fixture signal ${index + 1} is invalid.`);
    }

    return {
      id: signal.id,
      observation: signal.observation,
    };
  });
}

export function executeGenericResearcherFixture(
  context: WorkerInvocationContext,
): JsonValue {
  const fixtureMode = context.inputArtifacts[0]?.content.fixtureMode;
  if (fixtureMode === "invalid-output") {
    return {
      decision: "complete",
      findings: "invalid-on-purpose",
    };
  }

  const findings = context.inputArtifacts.flatMap((artifact) =>
    readSignals(artifact.content).map((signal) => ({
      signalId: signal.id,
      evidence: signal.observation,
      inference: `The supplied observation is relevant to the bounded question: ${context.taskContract.objective}`,
      evidenceArtifactId: artifact.id,
    })),
  );

  return {
    decision: "complete",
    summary: `Reviewed ${findings.length} supplied synthetic market signals without expanding beyond the Task Contract.`,
    findings,
    evidenceCount: findings.length,
    usedArtifactIds: context.inputArtifacts.map((artifact) => artifact.id),
    stopReason: "completion_criteria_satisfied",
    scopeBoundary: "task_contract_only",
  };
}
