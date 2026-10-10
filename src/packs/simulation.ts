import { createHash } from "node:crypto";
import type { JsonObject, JsonValue } from "../core/contracts";
import { executeWorkerPack } from "../workers/runtime";
import { assertJsonSchemaValue } from "../workers/schema-validator";
import type {
  WorkerExecutionReceipt,
  WorkerInputArtifact,
  WorkerInvocationContext,
} from "../workers/types";
import { resolvePackDependencies } from "./dependencies";
import type { PackDependency, PackKnowledge, PackRelease, PackSnapshot, PackWorker } from "./types";

export type PackSimulationOptions = {
  mode: "simulation";
  releases: readonly PackRelease[];
  root: PackDependency;
  workflowKey: string;
  input: JsonObject;
  /** Exactly one plain JSON output per stage. Functions and provider adapters are not accepted. */
  fixtures: Record<string, JsonObject>;
  now: string | Date;
};

export type PackSimulationReceipt = WorkerExecutionReceipt & {
  executionMode: "simulation.fixture";
  configuredExecutionMode: PackWorker["execution"]["kind"];
  configuredExecutor: JsonObject;
  mode: "simulation";
  stageKey: string;
  providerExecuted: false;
  qualificationEvaluated: false;
  executedCapabilities: string[];
};

export type PackSimulationStageResult = {
  stageKey: string;
  context: WorkerInvocationContext;
  outputArtifact: WorkerInputArtifact;
  receipt: PackSimulationReceipt;
};

export type PackSimulationResult = {
  mode: "simulation";
  simulatedAt: string;
  providerExecuted: false;
  qualificationEvaluated: false;
  snapshot: PackSnapshot;
  stages: PackSimulationStageResult[];
  output: JsonObject;
  outputArtifact: WorkerInputArtifact;
};

const DAY_MS = 86_400_000;
const unsafeKeys = new Set(["__proto__", "prototype", "constructor"]);

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;
}

/** Do not let permissive schemas admit callbacks, accessors, cycles or non-JSON fixture values. */
function assertJson(value: unknown, seen = new Set<object>(), depth = 0): asserts value is JsonValue {
  check(depth < 50, "Simulation JSON is too deeply nested.");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    check(Number.isFinite(value), "Simulation values must be finite JSON.");
    return;
  }
  check(Array.isArray(value) || isRecord(value), "Simulation inputs and fixtures must be plain JSON, never executors.");
  check(!seen.has(value), "Simulation JSON must not contain cycles.");
  check(Object.getOwnPropertySymbols(value).length === 0, "Simulation JSON must not contain symbol keys.");
  seen.add(value);
  if (Array.isArray(value)) {
    check(Object.keys(value).length === value.length, "Simulation JSON arrays must be dense and contain only indexed entries.");
  }
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (Array.isArray(value) && key === "length") continue;
    check(!unsafeKeys.has(key) && descriptor.enumerable && Object.hasOwn(descriptor, "value"), "Simulation JSON contains an unsafe key or accessor.");
    assertJson(descriptor.value, seen, depth + 1);
  }
  seen.delete(value);
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Date.parse normalizes impossible dates such as February 30; reject them first. */
function timestamp(value: string | Date, label: string): number {
  if (value instanceof Date) {
    check(Number.isFinite(value.getTime()), `${label} is an invalid date.`);
    return value.getTime();
  }
  check(typeof value === "string", `${label} must be an ISO date or timestamp.`);
  const parts = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2}))?$/.exec(value);
  check(parts, `${label} must be an ISO date or timestamp.`);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = parts;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  check(month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1], `${label} is an invalid date.`);
  if (hourText !== undefined) {
    check(Number(hourText) < 24 && Number(minuteText) < 60 && Number(secondText) < 60, `${label} is an invalid time.`);
    if (zone !== "Z") check(Number(zone.slice(1, 3)) < 24 && Number(zone.slice(4, 6)) < 60, `${label} has an invalid timezone.`);
  }
  const result = Date.parse(value);
  check(Number.isFinite(result), `${label} is an invalid date.`);
  return result;
}

/** Stable, local-only IDs let explicit fixtures cite their own scoped artifacts. */
export function packSimulationArtifactId(
  root: PackDependency,
  workflowKey: string,
  kind: "stage-input" | "stage-output" | "knowledge" | "task-contract",
  key: string,
): string {
  const hash = createHash("sha256").update(JSON.stringify(["pack-simulation", root.packKey, root.version, workflowKey, kind, key])).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function knowledgeArtifact(knowledge: PackKnowledge, id: string, now: number): WorkerInputArtifact {
  const verified = timestamp(knowledge.verifiedAt, `Knowledge ${knowledge.key} verification`);
  const expires = verified + knowledge.freshnessDays * DAY_MS;
  check(Number.isFinite(expires) && Math.abs(expires) <= 8.64e15, `Knowledge ${knowledge.key} freshness is invalid.`);
  check(verified <= now, `Knowledge ${knowledge.key} verification is in the future.`);
  check(now < expires, `Knowledge ${knowledge.key} is expired.`);
  return {
    id,
    artifactType: "pack.knowledge",
    name: knowledge.name,
    mediaType: "application/json",
    content: structuredClone(knowledge.content),
    metadata: {
      mode: "simulation", knowledgeKey: knowledge.key, version: knowledge.version,
      source: knowledge.source, verifiedAt: knowledge.verifiedAt, freshnessDays: knowledge.freshnessDays,
      freshness: "fresh", freshnessCheckedAt: new Date(now).toISOString(), expiresAt: new Date(expires).toISOString(),
    },
  };
}

/**
 * Local contract simulation only. This never selects a provider, executes a capability,
 * promotes a release, persists a run, or qualifies the configured worker/model.
 * executeWorkerPack invokes the real validateWorkerInvocationContext exactly once
 * and applies the pinned output schema, evidence scope and completion criteria.
 */
export function simulatePackWorkflow(options: PackSimulationOptions): PackSimulationResult {
  check(options.mode === "simulation", "An explicit simulation mode is required.");
  const now = timestamp(options.now, "Simulation time");
  assertJson(options.input);
  check(isRecord(options.input), "Workflow input must be a JSON object.");
  assertJson(options.fixtures);
  check(isRecord(options.fixtures), "Simulation fixtures must be a stage-keyed JSON object.");
  const input = structuredClone(options.input);
  const fixtures = structuredClone(options.fixtures);
  // The experimental exception is confined to this explicitly labelled simulation.
  const releases = resolvePackDependencies(options.releases, options.root, true);
  check(releases.every(release => ["experimental", "qualified", "assisted", "autonomous"].includes(release.status)), "Simulation dependency release has an invalid status.");
  const rootRelease = releases.find(release => release.manifest.packKey === options.root.packKey && release.manifest.version === options.root.version);
  check(rootRelease, "Simulation root release is unavailable.");
  const workflow = rootRelease.manifest.workflows.find(candidate => candidate.key === options.workflowKey);
  check(workflow, "Simulation workflow must be defined by the pinned root release.");
  const snapshot = freeze<PackSnapshot>({ rootPackId: rootRelease.id, releases, workflow });
  assertJsonSchemaValue(workflow.inputSchema, input, "Simulation workflow input");
  const keys = workflow.stages.map(stage => stage.key);
  check(Object.keys(fixtures).length === keys.length && keys.every(key => Object.hasOwn(fixtures, key)), "Simulation requires exactly one fixture per stage; missing or extra fixtures are forbidden.");
  for (const key of keys) check(isRecord(fixtures[key]), `Fixture ${key} output must be a JSON object.`);

  const id = (kind: Parameters<typeof packSimulationArtifactId>[2], key: string) => packSimulationArtifactId(options.root, workflow.key, kind, key);
  const knowledge = new Map(releases.flatMap(release => release.manifest.knowledge).map(entry => [entry.key, entry]));
  const workers = releases.flatMap(release => release.manifest.workers);
  const capabilities = new Map(releases.flatMap(release => release.manifest.capabilities).map(entry => [entry.key, entry]));
  // Preflight the entire workflow before executing any fixtures.
  const prepared = workflow.stages.map(stage => {
    const worker = workers.find(candidate => candidate.manifest.worker.workerKey === stage.workerKey && candidate.manifest.worker.version === stage.workerVersion);
    check(worker, `Worker for stage ${stage.key} is unavailable.`);
    check(worker.execution.kind !== "web.research" && worker.execution.kind !== "browser.etsy.insights.read_only" && worker.execution.kind !== "r12.direct-model", `Stage ${stage.key} requests an external executor; local simulation cannot execute it.`);
    for (const capability of worker.manifest.capabilityPolicy.allowed) {
      check(capabilities.get(capability)?.adapter === "structured.mapping", `Stage ${stage.key} requests an external capability; local simulation cannot execute ${capability}.`);
    }
    const scopedKnowledge = stage.knowledgeKeys.map(key => {
      const entry = knowledge.get(key);
      check(entry, `Knowledge ${key} is unavailable.`);
      return knowledgeArtifact(entry, id("knowledge", key), now);
    });
    return { stage, worker, scopedKnowledge };
  });

  const stages: PackSimulationStageResult[] = [];
  const outputs = new Map<string, WorkerInputArtifact>();
  for (const { stage, worker, scopedKnowledge } of prepared) {
    const source = stage.inputFrom === "workflow" ? undefined : outputs.get(stage.inputFrom);
    check(stage.inputFrom === "workflow" || source, `Stage ${stage.key} input has not been produced.`);
    const stageInput: WorkerInputArtifact = {
      id: id("stage-input", stage.key), artifactType: "pack.stage-input", name: `${stage.key} input`, mediaType: "application/json",
      content: structuredClone(source ? source.content : input),
      metadata: { mode: "simulation", inputFrom: stage.inputFrom, ...(source ? { sourceArtifactId: source.id } : {}) },
    };
    const inputArtifacts = [stageInput, ...scopedKnowledge];
    const context = freeze<WorkerInvocationContext>({
      taskContract: {
        id: id("task-contract", stage.key), objective: stage.objective,
        inputArtifactIds: inputArtifacts.map(artifact => artifact.id),
        permittedCapabilities: [...stage.permittedCapabilities], requiredKnowledge: [...stage.knowledgeKeys],
        requiredOutputSchema: structuredClone(worker.manifest.outputSchema), completionCriteria: structuredClone(stage.completionCriteria),
        failureCriteria: {}, nonGoals: [...stage.nonGoals], escalationRules: structuredClone(worker.manifest.escalationPolicy),
      },
      inputArtifacts,
    });
    const fixture = fixtures[stage.key];
    check(!Object.hasOwn(fixture, "usedArtifactIds") || Array.isArray(fixture.usedArtifactIds), `Fixture ${stage.key} usedArtifactIds must be an array of scoped artifact IDs.`);
    const result = executeWorkerPack(worker.manifest, () => structuredClone(fixture), context);
    const outputArtifact = freeze<WorkerInputArtifact>({
      id: id("stage-output", stage.key), artifactType: "pack.simulation-output", name: `${stage.key} simulated output`,
      mediaType: "application/json", content: structuredClone(result.output),
      metadata: { mode: "simulation", stageKey: stage.key, workflowKey: workflow.key, workflowVersion: workflow.version,
        workerKey: stage.workerKey, workerVersion: stage.workerVersion, providerExecuted: false, qualificationEvaluated: false },
    });
    const receipt: PackSimulationReceipt = {
      ...result.receipt, executionMode: "simulation.fixture", configuredExecutionMode: worker.execution.kind,
      configuredExecutor: structuredClone(worker.execution),
      mode: "simulation", stageKey: stage.key, providerExecuted: false, qualificationEvaluated: false, executedCapabilities: [],
    };
    stages.push({ stageKey: stage.key, context, outputArtifact, receipt });
    outputs.set(stage.key, outputArtifact);
  }
  const outputArtifact = stages[stages.length - 1].outputArtifact;
  assertJsonSchemaValue(workflow.outputSchema, outputArtifact.content, "Simulation workflow output");
  return freeze({ mode: "simulation", simulatedAt: new Date(now).toISOString(), providerExecuted: false, qualificationEvaluated: false,
    snapshot, stages, output: structuredClone(outputArtifact.content), outputArtifact });
}
