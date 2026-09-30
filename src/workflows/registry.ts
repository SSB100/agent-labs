import {
  BROWSER_PLANNER_RUNTIME_WORKFLOW_DEFINITION_ID,
  BROWSER_PLANNER_RUNTIME_WORKFLOW_KEY,
  browserPlannerRuntimeWorkflow,
} from "./browser-planner-runtime";
import {
  BROWSER_PROVIDER_RUNTIME_WORKFLOW_DEFINITION_ID,
  BROWSER_PROVIDER_RUNTIME_WORKFLOW_KEY,
  browserProviderRuntimeWorkflow,
} from "./browser-provider-runtime";
import {
  MODEL_ROUTER_RUNTIME_WORKFLOW_DEFINITION_ID,
  MODEL_ROUTER_RUNTIME_WORKFLOW_KEY,
  modelRouterRuntimeWorkflow,
} from "./model-router-runtime";
import {
  SYNTHETIC_RUNTIME_WORKFLOW_DEFINITION_ID,
  SYNTHETIC_RUNTIME_WORKFLOW_KEY,
  syntheticCoreRuntimeWorkflow,
} from "./synthetic-runtime";
import {
  WORKER_PACK_RUNTIME_WORKFLOW_DEFINITION_ID,
  WORKER_PACK_RUNTIME_WORKFLOW_KEY,
  workerPackRuntimeWorkflow,
} from "./worker-pack-runtime";

export const WORKFLOW_REGISTRY = {
  [SYNTHETIC_RUNTIME_WORKFLOW_KEY]: {
    definitionId: SYNTHETIC_RUNTIME_WORKFLOW_DEFINITION_ID,
    workflow: syntheticCoreRuntimeWorkflow,
  },
  [WORKER_PACK_RUNTIME_WORKFLOW_KEY]: {
    definitionId: WORKER_PACK_RUNTIME_WORKFLOW_DEFINITION_ID,
    workflow: workerPackRuntimeWorkflow,
  },
  [MODEL_ROUTER_RUNTIME_WORKFLOW_KEY]: {
    definitionId: MODEL_ROUTER_RUNTIME_WORKFLOW_DEFINITION_ID,
    workflow: modelRouterRuntimeWorkflow,
  },
  [BROWSER_PROVIDER_RUNTIME_WORKFLOW_KEY]: {
    definitionId: BROWSER_PROVIDER_RUNTIME_WORKFLOW_DEFINITION_ID,
    workflow: browserProviderRuntimeWorkflow,
  },
  [BROWSER_PLANNER_RUNTIME_WORKFLOW_KEY]: {
    definitionId: BROWSER_PLANNER_RUNTIME_WORKFLOW_DEFINITION_ID,
    workflow: browserPlannerRuntimeWorkflow,
  },
} as const;

export type RegisteredWorkflowKey = keyof typeof WORKFLOW_REGISTRY;

export function getRegisteredWorkflow<K extends RegisteredWorkflowKey>(
  key: K,
): (typeof WORKFLOW_REGISTRY)[K] {
  return WORKFLOW_REGISTRY[key];
}
