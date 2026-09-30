import { createHash, randomUUID } from "node:crypto";
import type { JsonObject, JsonValue } from "../core/contracts";
import { buildWorkerModelMessages } from "../models/prompt";
import { resolveModelRoute } from "../models/registry";
import { runModelRoute } from "../models/router";
import { ModelProviderError, ModelRouterError } from "../models/types";
import type { ModelProviderAdapter, ModelRouteAttempt, ModelRouteRunResult } from "../models/types";
import { executeWorkerPack, validateWorkerInvocationContext } from "../workers/runtime";
import { assertJsonSchemaValue } from "../workers/schema-validator";
import type { WorkerExecutionReceipt, WorkerInputArtifact, WorkerInvocationContext } from "../workers/types";
import { resolvePackDependencies } from "./dependencies";
import { SimulationRunBusyError } from "./simulation-repository";
import type { SimulationRepository } from "./simulation-repository";
import type { PackDependency, PackKnowledge, PackRelease, PackSnapshot, PackStage, PackWorker } from "./types";

export { FileSimulationRepository, MemorySimulationRepository, SimulationRunBusyError } from "./simulation-repository";
export type { SimulationRepository } from "./simulation-repository";

export type SimulationProviderType = "mock" | "real";
export type DurableSimulationStatus = "queued" | "running" | "paused" | "needs_you" | "completed" | "cancelled";
export type SimulationFailure = { category: string; reason: string };
export type DurableSimulationReceipt = {
  mode: "simulation";
  providerType: SimulationProviderType;
  qualificationEvaluated: false;
  stageKey: string;
  invocation: number;
  routeKey: string;
  configuredExecutionMode: "model_router";
  configuredExecutor: JsonObject;
  selectedModelKey: string | null;
  selectedProviderModelId: string | null;
  attempts: ModelRouteAttempt[];
  outcome: "completed" | "failed" | "interrupted";
  outputValidated: boolean;
  domainValidationApplied: boolean;
  workerReceipt: WorkerExecutionReceipt | null;
  failure: SimulationFailure | null;
  executedCapabilities: string[];
};
export type DurableSimulationInvocation = {
  number: number;
  status: "running" | "completed" | "failed" | "interrupted";
  startedAt: string;
  finishedAt: string | null;
  context: WorkerInvocationContext;
  attempts: ModelRouteAttempt[];
  receipt: DurableSimulationReceipt | null;
};
export type DurableSimulationStage = {
  stageKey: string;
  status: "pending" | "running" | "completed" | "needs_you" | "cancelled";
  context: WorkerInvocationContext | null;
  invocations: DurableSimulationInvocation[];
  outputArtifact: WorkerInputArtifact | null;
  receipt: DurableSimulationReceipt | null;
  failure: SimulationFailure | null;
};
export type DurableSimulationEvent = {
  sequence: number;
  type: string;
  at: string;
  mode: "simulation";
  providerType: SimulationProviderType;
  qualificationEvaluated: false;
  stageKey: string | null;
  details: JsonObject;
};
export type DurableSimulationRun = {
  schemaVersion: 1;
  mode: "simulation";
  runKey: string;
  providerType: SimulationProviderType;
  qualificationEvaluated: false;
  identityHash: string;
  root: PackDependency;
  snapshot: PackSnapshot;
  input: JsonObject;
  status: DurableSimulationStatus;
  maximumStageInvocations: 2;
  maximumModelAttemptsPerInvocation: 2;
  createdAt: string;
  updatedAt: string;
  stages: DurableSimulationStage[];
  artifacts: WorkerInputArtifact[];
  receipts: DurableSimulationReceipt[];
  events: DurableSimulationEvent[];
  consumedControls: string[];
  failure: SimulationFailure | null;
  output: JsonObject | null;
  outputArtifact: WorkerInputArtifact | null;
};
export type DurablePackSimulationOptions = {
  mode: "simulation";
  releases: readonly PackRelease[];
  root: PackDependency;
  workflowKey: string;
  input: JsonObject;
  runKey: string;
  repository: SimulationRepository;
  adapter: ModelProviderAdapter;
  /** Required: injected mock responses must never masquerade as real-provider qualification. */
  providerType: SimulationProviderType;
  now: string | Date;
  /** Trusted application hook only. Manifests remain JSON and cannot supply executable code. */
  validateStageOutput?: (stageKey: string, output: JsonObject, context: WorkerInvocationContext) => void;
};

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function assertJson(value: unknown, seen = new Set<object>(), depth = 0): asserts value is JsonValue {
  check(depth < 50, "Simulation JSON is too deeply nested.");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") { check(Number.isFinite(value), "Simulation JSON numbers must be finite."); return; }
  check(Array.isArray(value) || record(value), "Simulation inputs and manifests must be plain JSON, never executable code.");
  check(!seen.has(value), "Simulation JSON must not contain cycles.");
  check(Object.getOwnPropertySymbols(value).length === 0, "Simulation JSON must not contain symbols.");
  seen.add(value);
  if (Array.isArray(value)) check(Object.keys(value).length === value.length, "Simulation JSON arrays must be dense.");
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (Array.isArray(value) && key === "length") continue;
    check(!["__proto__", "prototype", "constructor"].includes(key) && descriptor.enumerable && Object.hasOwn(descriptor, "value"), "Simulation JSON contains an unsafe key or accessor.");
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
function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function timestamp(value: string | Date, label: string): number {
  if (value instanceof Date) { check(Number.isFinite(value.getTime()), `${label} is an invalid date.`); return value.getTime(); }
  check(typeof value === "string", `${label} must be an ISO date or timestamp.`);
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2}))?$/.exec(value);
  check(match, `${label} must be an ISO date or timestamp.`);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  check(month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1], `${label} is an invalid date.`);
  if (hourText !== undefined) {
    check(Number(hourText) < 24 && Number(minuteText) < 60 && Number(secondText) < 60, `${label} is an invalid time.`);
    if (zone !== "Z") check(Number(zone.slice(1, 3)) < 24 && Number(zone.slice(4, 6)) < 60, `${label} has an invalid timezone.`);
  }
  const result = Date.parse(value);
  check(Number.isFinite(result), `${label} is an invalid date.`);
  return result;
}
export function durableSimulationArtifactId(runKey: string, stageKey: string, kind: string): string {
  const digest = hash(JSON.stringify(["durable-pack-simulation", runKey, stageKey, kind]));
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}
function knowledgeArtifact(entry: PackKnowledge, runKey: string, stageKey: string, now: number): WorkerInputArtifact {
  const verified = timestamp(entry.verifiedAt, `Knowledge ${entry.key} verification`);
  const expires = verified + entry.freshnessDays * 86_400_000;
  check(Number.isFinite(expires) && Math.abs(expires) <= 8.64e15, `Knowledge ${entry.key} freshness is invalid.`);
  check(verified <= now, `Knowledge ${entry.key} verification is in the future.`);
  check(now < expires, `Knowledge ${entry.key} is expired.`);
  return { id: durableSimulationArtifactId(runKey, stageKey, `knowledge:${entry.key}`), artifactType: "pack.knowledge", name: entry.name,
    mediaType: "application/json", content: structuredClone(entry.content), metadata: {
      mode: "simulation", knowledgeKey: entry.key, version: entry.version, source: entry.source,
      verifiedAt: entry.verifiedAt, freshnessDays: entry.freshnessDays, freshness: "fresh",
      freshnessCheckedAt: new Date(now).toISOString(), expiresAt: new Date(expires).toISOString(),
    } };
}
function event(run: DurableSimulationRun, type: string, at: string, stageKey: string | null = null, details: JsonObject = {}) {
  run.updatedAt = at;
  run.events.push({ sequence: run.events.length + 1, type, at, stageKey, details, mode: "simulation", providerType: run.providerType, qualificationEvaluated: false });
}
function failure(error: unknown): SimulationFailure {
  return { category: error instanceof Error && "category" in error ? String(error.category) : "validation_failed",
    reason: error instanceof Error ? error.message : "Simulation stage failed." };
}
function consumeControls(run: DurableSimulationRun, repository: SimulationRepository, at: string) {
  for (const control of repository.controls(run.runKey)) {
    if (run.consumedControls.includes(control.id)) continue;
    run.consumedControls.push(control.id);
    if (run.status === "completed" || run.status === "cancelled") {
      event(run, "control.ignored", at, null, { action: control.action, reason: "Run is terminal.", controlId: control.id });
    } else if (control.action === "cancel") {
      run.status = "cancelled";
      for (const stage of run.stages) if (stage.status !== "completed") stage.status = "cancelled";
      event(run, "run.cancelled", at, null, { reason: control.reason, controlId: control.id });
    } else {
      if (run.status !== "needs_you") run.status = "paused";
      event(run, "run.paused", at, null, { reason: control.reason, controlId: control.id });
    }
  }
}
function interrupted(run: DurableSimulationRun, at: string) {
  for (const stage of run.stages.filter(entry => entry.status === "running")) {
    const invocation = stage.invocations.at(-1)!;
    invocation.status = "interrupted";
    invocation.finishedAt = at;
    stage.status = "needs_you";
    stage.failure = { category: "execution_interrupted", reason: "The previous invocation stopped before its validated output checkpoint. Provider outcome may be unknown; explicit retry is required and consumes the remaining stage budget." };
    run.status = "needs_you";
    run.failure = stage.failure;
    if (!invocation.receipt) {
      const definition = run.snapshot.workflow.stages.find(entry => entry.key === stage.stageKey)!;
      const worker = run.snapshot.releases.flatMap(release => release.manifest.workers).find(entry => entry.manifest.worker.workerKey === definition.workerKey)!;
      check(worker.execution.kind === "model_router", "Interrupted simulation has an invalid executor.");
      const receipt: DurableSimulationReceipt = { mode: "simulation", providerType: run.providerType, qualificationEvaluated: false,
        stageKey: stage.stageKey, invocation: invocation.number, routeKey: worker.execution.routeKey,
        configuredExecutionMode: "model_router", configuredExecutor: structuredClone(worker.execution),
        selectedModelKey: null, selectedProviderModelId: null, attempts: structuredClone(invocation.attempts),
        outcome: "interrupted", outputValidated: false, domainValidationApplied: false, workerReceipt: null,
        failure: stage.failure, executedCapabilities: [] };
      invocation.receipt = receipt; stage.receipt = receipt; run.receipts.push(receipt);
    }
    event(run, "stage.interrupted", at, stage.stageKey, { ...stage.failure });
  }
}
function contextFor(run: DurableSimulationRun, stage: PackStage, worker: PackWorker, now: number): WorkerInvocationContext {
  const source = stage.inputFrom === "workflow" ? null : run.stages.find(candidate => candidate.stageKey === stage.inputFrom)?.outputArtifact;
  check(stage.inputFrom === "workflow" || source, `Stage ${stage.key} input has not been produced.`);
  const knowledge = new Map(run.snapshot.releases.flatMap(release => release.manifest.knowledge).map(entry => [entry.key, entry]));
  const artifacts: WorkerInputArtifact[] = [{
    id: durableSimulationArtifactId(run.runKey, stage.key, "stage-input"), artifactType: "pack.stage-input", name: `${stage.key} input`,
    mediaType: "application/json", content: structuredClone(source ? source.content : run.input),
    metadata: { mode: "simulation", inputFrom: stage.inputFrom, ...(source ? { sourceArtifactId: source.id } : {}) },
  }, ...stage.knowledgeKeys.map(key => {
    const entry = knowledge.get(key);
    check(entry, `Knowledge ${key} is unavailable.`);
    return knowledgeArtifact(entry, run.runKey, stage.key, now);
  })];
  return freeze({ taskContract: { id: durableSimulationArtifactId(run.runKey, stage.key, "task-contract"), objective: stage.objective,
    inputArtifactIds: artifacts.map(artifact => artifact.id), permittedCapabilities: [...stage.permittedCapabilities],
    requiredKnowledge: [...stage.knowledgeKeys], requiredOutputSchema: structuredClone(worker.manifest.outputSchema),
    completionCriteria: structuredClone(stage.completionCriteria), failureCriteria: {}, nonGoals: [...stage.nonGoals],
    escalationRules: structuredClone(worker.manifest.escalationPolicy) }, inputArtifacts: artifacts });
}

/**
 * Level 2 local simulation: real routing and worker validation, injected provider, durable local
 * checkpoints. No real-world capability executes and no release gains qualification. Pause/cancel
 * take effect at stage boundaries; an in-flight route (at most two candidates) may finish first.
 */
export async function runDurablePackSimulation(options: DurablePackSimulationOptions): Promise<DurableSimulationRun> {
  check(options.mode === "simulation", "An explicit simulation mode is required.");
  check(options.providerType === "mock" || options.providerType === "real", "An explicit mock or real providerType is required.");
  check(typeof options.adapter?.invokeStructured === "function", "An explicit ModelProviderAdapter is required.");
  const now = timestamp(options.now, "Simulation time"), at = new Date(now).toISOString();
  assertJson(options.input); check(record(options.input), "Simulation input must be a JSON object.");
  assertJson(options.releases); assertJson(options.root);
  const releases = resolvePackDependencies(options.releases, options.root, true);
  check(releases.every(release => ["experimental", "qualified", "assisted", "autonomous"].includes(release.status)), "Simulation dependency release has an invalid status.");
  const rootRelease = releases.find(release => release.manifest.packKey === options.root.packKey && release.manifest.version === options.root.version);
  check(rootRelease, "Simulation root release is unavailable.");
  const workflow = rootRelease.manifest.workflows.find(entry => entry.key === options.workflowKey);
  check(workflow, "Simulation workflow must be defined by the pinned root release.");
  const snapshot: PackSnapshot = { rootPackId: rootRelease.id, releases, workflow };
  assertJsonSchemaValue(workflow.inputSchema, options.input, "Simulation workflow input");
  const identity = { root: options.root, snapshot, input: options.input, providerType: options.providerType, domainValidation: Boolean(options.validateStageOutput) };
  assertJson(identity);
  const identityHash = hash(canonical(identity));

  return options.repository.withRunLock(options.runKey, async () => {
    let run = options.repository.read(options.runKey);
    if (run) {
      check(run.identityHash === identityHash, "Existing simulation runKey cannot be reused with changed input, pins, definitions, provider type or validation policy.");
      interrupted(run, at);
      consumeControls(run, options.repository, at);
      options.repository.save(run);
      if (["completed", "cancelled", "paused", "needs_you"].includes(run.status)) return freeze(run);
    } else {
      run = { schemaVersion: 1, mode: "simulation", runKey: options.runKey, providerType: options.providerType, qualificationEvaluated: false,
        identityHash, root: structuredClone(options.root), snapshot: structuredClone(snapshot), input: structuredClone(options.input),
        status: "queued", maximumStageInvocations: 2, maximumModelAttemptsPerInvocation: 2,
        createdAt: at, updatedAt: at, stages: workflow.stages.map(stage => ({ stageKey: stage.key, status: "pending", context: null,
          invocations: [], outputArtifact: null, receipt: null, failure: null })), artifacts: [], receipts: [], events: [], consumedControls: [],
        failure: null, output: null, outputArtifact: null };
      event(run, "run.created", at);
      options.repository.save(run);
    }
    const activeRun = run;
    const workers = activeRun.snapshot.releases.flatMap(release => release.manifest.workers);
    const capabilities = new Map(activeRun.snapshot.releases.flatMap(release => release.manifest.capabilities).map(entry => [entry.key, entry]));
    // Fail closed across the whole unexecuted workflow before starting a provider request.
    try {
      for (const stage of activeRun.snapshot.workflow.stages) {
        const worker = workers.find(entry => entry.manifest.worker.workerKey === stage.workerKey && entry.manifest.worker.version === stage.workerVersion)!;
        check(worker.execution.kind === "model_router", `Stage ${stage.key} requires model_router; external or mapping executors are unsupported by durable simulation.`);
        for (const key of worker.manifest.capabilityPolicy.allowed) check(capabilities.get(key)?.adapter === "structured.mapping", `Stage ${stage.key} requests an external capability: ${key}.`);
        resolveModelRoute(worker.execution.routeKey);
        if (activeRun.stages.find(entry => entry.stageKey === stage.key)?.status === "completed") continue;
        for (const key of stage.knowledgeKeys) {
          const entry = activeRun.snapshot.releases.flatMap(release => release.manifest.knowledge).find(value => value.key === key)!;
          knowledgeArtifact(entry, activeRun.runKey, stage.key, now);
        }
      }
    } catch (error) {
      activeRun.status = "needs_you"; activeRun.failure = failure(error);
      event(activeRun, "run.needs_you", at, null, { ...activeRun.failure });
      options.repository.save(activeRun); return freeze(activeRun);
    }
    activeRun.status = "running";
    event(activeRun, "run.started", at);
    options.repository.save(activeRun);
    for (const stage of activeRun.snapshot.workflow.stages) {
      consumeControls(activeRun, options.repository, at);
      options.repository.save(activeRun);
      if (activeRun.status !== "running") return freeze(activeRun);
      const state = activeRun.stages.find(entry => entry.stageKey === stage.key)!;
      if (state.status === "completed") continue;
      check(state.invocations.length < activeRun.maximumStageInvocations, "Stage invocation budget is exhausted.");
      const worker = workers.find(entry => entry.manifest.worker.workerKey === stage.workerKey && entry.manifest.worker.version === stage.workerVersion)!;
      check(worker.execution.kind === "model_router", "Durable simulation requires a model_router worker.");
      const execution = worker.execution;
      let routed: ModelRouteRunResult | null = null;
      let invocation: DurableSimulationInvocation | null = null;
      let checkpointError: unknown = null;
      let domainValidationApplied = false;
      const saveCheckpoint = () => {
        try { options.repository.save(activeRun); }
        catch (error) { checkpointError = error; throw error; }
      };
      try {
        const context = contextFor(activeRun, stage, worker, now);
        state.context = context;
        validateWorkerInvocationContext(worker.manifest, context);
        invocation = { number: state.invocations.length + 1, status: "running", startedAt: at, finishedAt: null,
          context, attempts: [], receipt: null };
        state.invocations.push(invocation); state.status = "running";
        event(activeRun, "stage.started", at, stage.key, { invocation: invocation.number, routeKey: execution.routeKey });
        saveCheckpoint();
        const currentInvocation = invocation;
        routed = await runModelRoute({
          routeKey: execution.routeKey, outputSchema: structuredClone(worker.manifest.outputSchema), schemaName: `${stage.key.replace(/[^a-zA-Z0-9_]/g, "_")}_output`,
          messages: buildWorkerModelMessages(worker.manifest, context),
          requestMetadata: { mode: "simulation", providerType: options.providerType, qualificationEvaluated: false, runKey: activeRun.runKey,
            stageKey: stage.key, workerKey: stage.workerKey, workerVersion: stage.workerVersion, invocation: invocation.number },
          adapter: {
            invokeStructured: async request => {
              if (checkpointError) throw new ModelProviderError("configuration_required", "A persistence checkpoint failed; no further model call is permitted.", false);
              const response = await options.adapter.invokeStructured(request);
              try {
                assertJson(response);
                check(record(response) && record(response.output) && record(response.usage) && record(response.metadata)
                  && typeof response.provider === "string" && response.provider.length > 0
                  && (response.providerRequestId === null || typeof response.providerRequestId === "string")
                  && typeof response.latencyMs === "number" && response.latencyMs >= 0,
                "Provider response envelope is invalid.");
                check(response.providerModelId === request.model.providerModelId, "Provider response does not match the model selected by the configured route.");
                check(response.metadata.providerType === undefined || response.metadata.providerType === options.providerType,
                  "Provider response classification contradicts the declared mock or real providerType.");
              } catch (error) {
                throw new ModelProviderError("malformed_model_output", error instanceof Error ? error.message : "Invalid provider response.", false);
              }
              return response;
            },
            qualifyToolUse: request => options.adapter.qualifyToolUse(request),
          },
          telemetry: {
            onAttemptStarted: info => {
              event(activeRun, "model.attempt_started", at, stage.key, { invocation: currentInvocation.number,
                attempt: info.attempt, routeKey: info.routeKey, modelKey: info.model.modelKey, providerModelId: info.model.providerModelId });
              // Router calls this before its try block: failed persistence cannot trigger provider fallback.
              saveCheckpoint();
            },
            onAttemptFinished: info => {
              currentInvocation.attempts.push(structuredClone(info.attempt));
              event(activeRun, "model.attempt_finished", at, stage.key, { invocation: currentInvocation.number, attempt: info.attempt.attempt,
                routeKey: info.routeKey, modelKey: info.model.modelKey, outcome: info.attempt.outcome, failureCategory: info.attempt.failureCategory });
              // Do not let a disk error be interpreted as a retryable provider error by the router.
              try { options.repository.save(activeRun); } catch (error) { checkpointError = error; }
            },
          },
        });
        if (checkpointError) throw checkpointError;
        assertJson(routed.output);
        check(!Object.hasOwn(routed.output, "usedArtifactIds") || Array.isArray(routed.output.usedArtifactIds), "usedArtifactIds must be an array of scoped artifact IDs.");
        const result = executeWorkerPack(worker.manifest, () => structuredClone(routed!.output), context);
        const validatedOutput = freeze(structuredClone(result.output));
        check(options.validateStageOutput?.constructor.name !== "AsyncFunction", "The trusted stage validator must be synchronous and return void.");
        domainValidationApplied = Boolean(options.validateStageOutput);
        const validationResult: unknown = options.validateStageOutput?.(stage.key, validatedOutput, context);
        if (validationResult instanceof Promise) void validationResult.catch(() => {});
        check(validationResult === undefined, "The trusted stage validator must be synchronous and return void.");
        if (stage.key === activeRun.snapshot.workflow.stages.at(-1)!.key) assertJsonSchemaValue(activeRun.snapshot.workflow.outputSchema, validatedOutput, "Simulation workflow output");
        const artifact: WorkerInputArtifact = { id: durableSimulationArtifactId(activeRun.runKey, stage.key, "stage-output"),
          artifactType: "pack.simulation-output", name: `${stage.key} simulated output`, mediaType: "application/json", content: structuredClone(validatedOutput),
          metadata: { mode: "simulation", providerType: options.providerType, qualificationEvaluated: false, stageKey: stage.key,
            workflowKey: workflow.key, workflowVersion: workflow.version, workerKey: stage.workerKey, workerVersion: stage.workerVersion,
            routeKey: routed.routeKey, selectedModelKey: routed.selectedModel.modelKey } };
        const receipt: DurableSimulationReceipt = { mode: "simulation", providerType: options.providerType, qualificationEvaluated: false,
          stageKey: stage.key, invocation: invocation.number, routeKey: routed.routeKey, configuredExecutionMode: "model_router", configuredExecutor: structuredClone(execution),
          selectedModelKey: routed.selectedModel.modelKey, selectedProviderModelId: routed.selectedModel.providerModelId,
          attempts: structuredClone([...routed.attempts]), outcome: "completed", outputValidated: true,
          domainValidationApplied, workerReceipt: result.receipt, failure: null, executedCapabilities: [] };
        invocation.status = "completed"; invocation.finishedAt = at; invocation.receipt = receipt;
        state.status = "completed"; state.outputArtifact = artifact; state.receipt = receipt; state.failure = null;
        activeRun.artifacts.push(artifact); activeRun.receipts.push(receipt);
        event(activeRun, "stage.completed", at, stage.key, { artifactId: artifact.id, invocation: invocation.number });
        saveCheckpoint();
      } catch (error) {
        // A failed checkpoint leaves the previous durable checkpoint authoritative; never continue routing.
        if (checkpointError) throw checkpointError;
        state.status = "needs_you"; state.failure = failure(error);
        activeRun.status = "needs_you"; activeRun.failure = state.failure;
        if (invocation) {
          invocation.status = "failed"; invocation.finishedAt = at;
          const receipt: DurableSimulationReceipt = { mode: "simulation", providerType: options.providerType, qualificationEvaluated: false,
            stageKey: stage.key, invocation: invocation.number, routeKey: execution.routeKey, configuredExecutionMode: "model_router", configuredExecutor: structuredClone(execution),
            selectedModelKey: routed?.selectedModel.modelKey ?? null, selectedProviderModelId: routed?.selectedModel.providerModelId ?? null,
            attempts: structuredClone(error instanceof ModelRouterError ? [...error.attempts] : invocation.attempts), outcome: "failed", outputValidated: false,
            domainValidationApplied, workerReceipt: null, failure: state.failure, executedCapabilities: [] };
          invocation.receipt = receipt; state.receipt = receipt; activeRun.receipts.push(receipt);
        }
        event(activeRun, "stage.needs_you", at, stage.key, { ...state.failure, invocationsUsed: state.invocations.length, maximumInvocations: activeRun.maximumStageInvocations });
        consumeControls(activeRun, options.repository, at);
        options.repository.save(activeRun);
        return freeze(activeRun);
      }
    }
    consumeControls(activeRun, options.repository, at);
    if (activeRun.status === "running") {
      activeRun.outputArtifact = activeRun.stages.at(-1)!.outputArtifact;
      activeRun.output = structuredClone(activeRun.outputArtifact!.content);
      activeRun.status = "completed"; activeRun.failure = null;
      event(activeRun, "run.completed", at);
    }
    options.repository.save(activeRun);
    return freeze(activeRun);
  });
}

export type InterveneInSimulationOptions = {
  repository: SimulationRepository;
  runKey: string;
  action: "pause" | "resume" | "retry" | "cancel";
  now: string | Date;
  reason?: string;
};

/** Resume only acknowledges a pause; retry explicitly spends a remaining invocation after Needs You. */
export async function interveneInDurableSimulation(options: InterveneInSimulationOptions): Promise<DurableSimulationRun> {
  const at = new Date(timestamp(options.now, "Intervention time")).toISOString();
  check(["pause", "resume", "retry", "cancel"].includes(options.action), "Unknown simulation intervention.");
  const existing = options.repository.read(options.runKey);
  check(existing, "Simulation run does not exist.");
  if (options.action === "pause" || options.action === "cancel") {
    options.repository.requestControl(options.runKey, { id: randomUUID(), action: options.action, reason: options.reason ?? "Requested by local simulation operator.", requestedAt: at });
  }
  try {
    return await options.repository.withRunLock(options.runKey, async () => {
      const run = options.repository.read(options.runKey)!;
      interrupted(run, at);
      consumeControls(run, options.repository, at);
      if (options.action === "resume") {
        check(run.status === "paused", "Only a paused run can resume; Needs You requires explicit retry.");
        run.status = "queued";
        event(run, "run.resumed", at);
      } else if (options.action === "retry") {
        check(run.status === "needs_you", "Only a Needs You run can be retried.");
        const stage = run.stages.find(entry => entry.status === "needs_you");
        if (stage) {
          check(stage.invocations.length < run.maximumStageInvocations, "Stage invocation budget is exhausted; retry is forbidden.");
          stage.status = "pending"; stage.failure = null;
        }
        run.status = "queued"; run.failure = null;
        event(run, "run.retry_requested", at, stage?.stageKey ?? null);
      }
      options.repository.save(run);
      return freeze(run);
    });
  } catch (error) {
    // Pause/cancel are durably enqueued even while a provider request is in flight.
    if (error instanceof SimulationRunBusyError && (options.action === "pause" || options.action === "cancel")) return freeze(options.repository.read(options.runKey)!);
    throw error;
  }
}
