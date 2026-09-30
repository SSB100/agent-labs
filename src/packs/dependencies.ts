import { registeredRelease } from "./registry";
import type { PackRelease, PackWorkflow } from "./types";

export function resolvePackDependencies(releases: readonly PackRelease[], root: { packKey: string; version: string }, allowExperimental = false): PackRelease[] {
  const visited = new Set<string>(), visiting = new Set<string>(), versions = new Map<string,string>();
  const ordered: PackRelease[] = [];
  function visit(packKey: string, version: string) {
    const pin = `${packKey}@${version}`;
    if (visiting.has(pin)) throw new Error(`Circular dependency: ${pin}.`);
    if (versions.has(packKey) && versions.get(packKey) !== version) throw new Error(`Conflicting version pins for ${packKey}.`);
    if (visited.has(pin)) return;
    if (visiting.size >= 30 || ordered.length >= 50) throw new Error("Dependency graph exceeds its bound.");
    const release = registeredRelease(releases,packKey,version);
    if (release.status === "retired" || (!allowExperimental && !["qualified","assisted","autonomous"].includes(release.status))) throw new Error(`Pack ${pin} is not qualified.`);
    versions.set(packKey,version); visiting.add(pin);
    for (const d of release.manifest.dependencies) visit(d.packKey,d.version);
    visiting.delete(pin); visited.add(pin); ordered.push(structuredClone(release));
  }
  visit(root.packKey,root.version);
  validateResolvedDefinitions(ordered);
  return ordered;
}

export function validateResolvedDefinitions(releases: readonly PackRelease[]) {
  const workers = releases.flatMap(r=>r.manifest.workers);
  const knowledge = releases.flatMap(r=>r.manifest.knowledge);
  const capabilities = releases.flatMap(r=>r.manifest.capabilities);
  for (const entries of [workers.map(w=>w.manifest.worker.workerKey), knowledge.map(k=>k.key), capabilities.map(c=>c.key)]) {
    if (new Set(entries).size !== entries.length) throw new Error("Ambiguous definitions in dependency closure.");
  }
  for (const w of workers) {
    if (w.manifest.knowledgeRequirements.some(k=>!knowledge.some(d=>d.key === k)) || w.manifest.capabilityPolicy.allowed.some(k=>!capabilities.some(d=>d.key === k))) throw new Error("Worker requirements missing from dependency closure.");
  }
  for (const workflow of releases.flatMap(r=>r.manifest.workflows)) validateWorkflowBindings(workflow,releases);
}

export function validateWorkflowBindings(workflow: PackWorkflow, releases: readonly PackRelease[]) {
  for (const stage of workflow.stages) {
    const worker = releases.flatMap(r=>r.manifest.workers).find(w=>w.manifest.worker.workerKey === stage.workerKey && w.manifest.worker.version === stage.workerVersion);
    if (!worker) throw new Error("Stage worker exact version is unavailable.");
    if (stage.knowledgeKeys.some(k=>!worker.manifest.knowledgeRequirements.includes(k)) || stage.permittedCapabilities.some(k=>!worker.manifest.capabilityPolicy.allowed.includes(k))) throw new Error("Stage exceeds worker scope.");
    if (worker.manifest.knowledgeRequirements.some(k=>!stage.knowledgeKeys.includes(k))) throw new Error("Stage omitted required worker knowledge.");
  }
}
