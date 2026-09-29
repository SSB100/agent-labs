import {
  GENERIC_RESEARCHER_INPUT_SCHEMA,
  GENERIC_RESEARCHER_OUTPUT_SCHEMA,
} from "./generic-researcher";
import type { WorkerPackManifest } from "./types";

export const MODEL_RESEARCHER_PACK_ID = "00000000-0000-4000-8000-000000000501";
export const MODEL_RESEARCHER_WORKER_DEFINITION_ID =
  "00000000-0000-4000-8000-000000000502";
export const MODEL_RESEARCHER_PACK_KEY = "worker.generic-researcher";
export const MODEL_RESEARCHER_WORKER_KEY = "generic.researcher";
export const MODEL_RESEARCHER_VERSION = "1.0.0";
export const MODEL_RESEARCHER_ROUTE_KEY = "standard.default";

export const MODEL_RESEARCHER_MANIFEST: WorkerPackManifest = {
  manifestVersion: "1.0",
  packKey: MODEL_RESEARCHER_PACK_KEY,
  version: MODEL_RESEARCHER_VERSION,
  name: "Generic Researcher",
  worker: {
    workerKey: MODEL_RESEARCHER_WORKER_KEY,
    version: MODEL_RESEARCHER_VERSION,
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
    executionMode: "model_router",
    modelRouterRequired: true,
    routeKey: MODEL_RESEARCHER_ROUTE_KEY,
    structuredOutput: true,
    toolUse: false,
    minimumContextTokens: 200000,
    fallbackRequired: true,
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
      reason: "The worker must stop when the Task Contract is complete.",
    },
    {
      name: "strategy selection",
      forbiddenBehaviour: "Recommend a final business or product strategy.",
      reason: "Strategy selection belongs to a different specialist worker.",
    },
    {
      name: "hidden context",
      forbiddenBehaviour: "Request conversation history, credentials or unreferenced artifacts.",
      reason: "The model receives only the bounded Task Contract context.",
    },
  ],
  escalationPolicy: {
    providerFailure: "use_one_qualified_fallback_then_stop",
    validationFailure: "fail_task",
    unavailableKnowledge: "fail_task",
    unexpectedFailure: "classify_and_stop",
  },
};
