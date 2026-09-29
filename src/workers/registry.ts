import {
  GENERIC_RESEARCHER_MANIFEST,
  GENERIC_RESEARCHER_VERSION,
  GENERIC_RESEARCHER_WORKER_KEY,
  executeGenericResearcherFixture,
} from "./generic-researcher";
import type { WorkerExecutor, WorkerPackManifest } from "./types";

export type RegisteredWorkerPack = {
  manifest: WorkerPackManifest;
  execute: WorkerExecutor;
};

function registryKey(workerKey: string, version: string) {
  return `${workerKey}@${version}`;
}

export const WORKER_PACK_REGISTRY: Readonly<Record<string, RegisteredWorkerPack>> = {
  [registryKey(GENERIC_RESEARCHER_WORKER_KEY, GENERIC_RESEARCHER_VERSION)]: {
    manifest: GENERIC_RESEARCHER_MANIFEST,
    execute: executeGenericResearcherFixture,
  },
};

export function getRegisteredWorkerPack(workerKey: string, version: string) {
  const worker = WORKER_PACK_REGISTRY[registryKey(workerKey, version)];
  if (!worker) {
    throw new Error(`Worker Pack ${workerKey}@${version} is not registered.`);
  }
  return worker;
}
