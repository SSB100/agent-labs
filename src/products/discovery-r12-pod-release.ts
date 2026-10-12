import { ownShopExecutionRelease } from "../connections/execution-release";
export type PodExecutingRelease = { version: "r12.executing-release.1"; repository: "SSB100/agent-labs"; environment: "production"; commitSha: string; deploymentId: string };
export function podExecutingRelease(env: NodeJS.ProcessEnv = process.env): Readonly<PodExecutingRelease> {
  return Object.freeze({ ...ownShopExecutionRelease(env), version: "r12.executing-release.1" });
}
/** Receipt provenance only. It neither grants authority nor replaces the
 * independently required exact-head release qualification. */
export function validatePodExecutingRelease(raw: unknown): PodExecutingRelease {
  const value = raw as PodExecutingRelease;
  if (!value || Object.keys(value).sort().join(",") !== "commitSha,deploymentId,environment,repository,version" || value.version !== "r12.executing-release.1" ||
      value.repository !== "SSB100/agent-labs" || value.environment !== "production" || !/^[a-f0-9]{40}$/.test(value.commitSha) || !/^dpl_[A-Za-z0-9_-]{1,124}$/.test(value.deploymentId)) throw new Error("r12_pod_release_unverified");
  return structuredClone(value);
}
