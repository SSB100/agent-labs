import {
  SYNTHETIC_RUNTIME_WORKFLOW_DEFINITION_ID,
  SYNTHETIC_RUNTIME_WORKFLOW_KEY,
  syntheticCoreRuntimeWorkflow,
} from "./synthetic-runtime";

export const WORKFLOW_REGISTRY = {
  [SYNTHETIC_RUNTIME_WORKFLOW_KEY]: {
    definitionId: SYNTHETIC_RUNTIME_WORKFLOW_DEFINITION_ID,
    workflow: syntheticCoreRuntimeWorkflow,
  },
} as const;

export type RegisteredWorkflowKey = keyof typeof WORKFLOW_REGISTRY;

export function getRegisteredWorkflow(key: RegisteredWorkflowKey) {
  return WORKFLOW_REGISTRY[key];
}
