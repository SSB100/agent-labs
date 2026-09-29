import {
  GENERIC_RESEARCHER_EVALUATION_SUITE,
} from "./generic-researcher-suite";
import type { WorkerEvaluationSuite } from "./types";

function registryKey(workerKey: string, workerVersion: string) {
  return `${workerKey}@${workerVersion}`;
}

export const WORKER_EVALUATION_SUITE_REGISTRY: Readonly<
  Record<string, WorkerEvaluationSuite>
> = {
  [registryKey(
    GENERIC_RESEARCHER_EVALUATION_SUITE.workerKey,
    GENERIC_RESEARCHER_EVALUATION_SUITE.workerVersion,
  )]: GENERIC_RESEARCHER_EVALUATION_SUITE,
};

export function getRegisteredWorkerEvaluationSuite(
  workerKey: string,
  workerVersion: string,
) {
  const suite =
    WORKER_EVALUATION_SUITE_REGISTRY[registryKey(workerKey, workerVersion)];
  if (!suite) {
    throw new Error(
      `Worker evaluation suite ${workerKey}@${workerVersion} is not registered.`,
    );
  }
  return suite;
}
