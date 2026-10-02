import {
  currentWorkerSummary, latestStageByKey, workflowExecutionEnded,
  type ArtifactRecord, type OwnerInterventionRecord, type TaskContractRecord,
  type WorkerRunRecord, type WorkflowRunRecord, type WorkflowStageRecord,
} from "./workflows";

/** Motion is presentation of persisted receipts, never evidence of execution. */
export type ConsoleMotionTarget = "core" | "run" | "stage" | "worker" | "output" | "decision";
export type ConsoleMotionState = "idle" | "running" | "completed" | "attention" | "failed" | "stopped" | "saved" | "unavailable";
export type ConsoleMotionCue = "activation" | "completion" | "saved" | "decision";
export const CONSOLE_MOTION_PERIOD_MS = 3200;
export const CONSOLE_MOTION_DURATION_MS: Record<ConsoleMotionCue, number> = {
  activation: 640, completion: 480, saved: 1400, decision: 1200,
};
export type ConsoleMotionEntity = {
  target: Exclude<ConsoleMotionTarget, "core">;
  id: string;
  runId: string | null;
  state: ConsoleMotionState;
  revision: number | null;
  startedAt: number | null;
  /** Timestamp of immutable start/completion/save/request evidence. */
  cue: { kind: ConsoleMotionCue; at: number } | null;
};
export type ConsoleMotionSnapshot = {
  available: boolean;
  observedAt: number;
  entities: ConsoleMotionEntity[];
};
type MotionCollection = {
  runs: WorkflowRunRecord[];
  stages: WorkflowStageRecord[];
  tasks: TaskContractRecord[];
  workerRuns: WorkerRunRecord[];
  artifacts: ArtifactRecord[];
  interventions: OwnerInterventionRecord[];
  errors: string[];
};
export type ConsoleMotionPulse = { kind: ConsoleMotionCue; key: string; startedAt: number; expiresAt: number };
export type ConsoleMotionLedger = {
  snapshot: ConsoleMotionSnapshot;
  seen: ReadonlySet<string>;
  pulses: ReadonlyMap<string, ConsoleMotionPulse>;
};

const timestamp = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const revision = (...values: (string | null | undefined)[]) => {
  const known = values.map(timestamp).filter((value): value is number => value !== null);
  return known.length ? Math.max(...known) : null;
};
export const consoleMotionTargetKey = (target: ConsoleMotionTarget, id: string) => JSON.stringify([target, id]);
const cueKey = (entity: ConsoleMotionEntity) => entity.cue
  ? JSON.stringify([entity.target, entity.id, entity.cue.kind, entity.cue.at]) : null;
function recordState(status: string, ended: boolean): ConsoleMotionState {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (ended || ["cancelled", "stopped"].includes(status)) return "stopped";
  if (["needs_owner", "review"].includes(status)) return "attention";
  return "idle";
}
function completedCue(status: string, completedAt: string | null) {
  const at = timestamp(completedAt);
  return status === "completed" && at !== null ? { kind: "completion" as const, at } : null;
}

/** Pass only owner-scoped loader results and the exact authorized Business IDs.
 * observedAt is the server observation time, not a generated progress counter.
 * Account connection / Realtime subscription state is intentionally not an input.
 */
export function deriveConsoleMotionSnapshot(collection: MotionCollection, options: {
  businessIds: readonly string[]; observedAt: number; unavailable?: boolean;
}): ConsoleMotionSnapshot {
  const available = !options.unavailable && collection.errors.length === 0 && Number.isFinite(options.observedAt);
  const businesses = new Set(options.businessIds);
  const runs = collection.runs.filter(run => run.id && businesses.has(run.business_id));
  const runById = new Map(runs.map(run => [run.id, run]));
  const belongs = (record: { business_id: string; workflow_run_id: string | null }) => businesses.has(record.business_id) &&
    (!record.workflow_run_id || runById.get(record.workflow_run_id)?.business_id === record.business_id);
  const entities: ConsoleMotionEntity[] = [];
  for (const run of runs) {
    const startedAt = timestamp(run.started_at);
    const running = run.status === "running" && !workflowExecutionEnded(run) && startedAt !== null;
    entities.push({ target: "run", id: run.id, runId: run.id, state: running ? "running" : recordState(run.status, workflowExecutionEnded(run)),
      revision: timestamp(run.updated_at), startedAt,
      cue: running ? { kind: "activation", at: startedAt } : completedCue(run.status, run.completed_at) });
    const latest = latestStageByKey(collection.stages.filter(stage => stage.workflow_run_id === run.id));
    for (const stage of latest.values()) {
      const stageStartedAt = timestamp(stage.started_at);
      const active = running && stage.stage_key === run.current_stage_key && stage.status === "running" && !stage.completed_at && stageStartedAt !== null;
      entities.push({ target: "stage", id: stage.id, runId: run.id, state: active ? "running" : recordState(stage.status, workflowExecutionEnded(run)),
        revision: revision(stage.updated_at, run.updated_at), startedAt: stageStartedAt, cue: completedCue(stage.status, stage.completed_at) });
    }
  }
  for (const worker of collection.workerRuns.filter(belongs)) {
    const run = runById.get(worker.workflow_run_id);
    const task = collection.tasks.find(task => task.id === worker.task_contract_id && task.business_id === worker.business_id && task.workflow_run_id === worker.workflow_run_id);
    if (!run || !task) continue;
    const startedAt = timestamp(worker.started_at);
    const active = Boolean(currentWorkerSummary(run, task, worker, null, collection.stages).active) && startedAt !== null &&
      entities.some(entity => entity.target === "stage" && entity.id === task.workflow_stage_run_id && entity.state === "running");
    entities.push({ target: "worker", id: worker.id, runId: run.id, state: active ? "running" : recordState(worker.status, workflowExecutionEnded(run)),
      revision: revision(worker.updated_at, run.updated_at, task.updated_at, collection.stages.find(stage => stage.id === task.workflow_stage_run_id)?.updated_at), startedAt, cue: completedCue(worker.status, worker.completed_at) });
  }
  for (const output of collection.artifacts.filter(belongs)) {
    if (!output.id) continue;
    const at = timestamp(output.created_at);
    entities.push({ target: "output", id: output.id, runId: output.workflow_run_id, state: "saved", revision: timestamp(output.updated_at), startedAt: null,
      cue: at === null ? null : { kind: "saved", at } });
  }
  for (const decision of collection.interventions.filter(belongs)) {
    if (!decision.id) continue;
    const at = timestamp(decision.requested_at);
    const open = decision.status === "open" && !decision.resolved_at;
    entities.push({ target: "decision", id: decision.id, runId: decision.workflow_run_id, state: open ? "attention" : "idle", revision: timestamp(decision.updated_at), startedAt: null,
      cue: open && at !== null ? { kind: "decision", at } : null });
  }
  return { available, observedAt: Number.isFinite(options.observedAt) ? options.observedAt : 0,
    entities: entities.sort((a, b) => consoleMotionTargetKey(a.target, a.id).localeCompare(consoleMotionTargetKey(b.target, b.id))) };
}

/** A first observation, new scope or recovery establishes a quiet
 * baseline. The DOM adapter can retain this ledger across in-tab remounts. Only a later accepted record transition earns a one-shot cue.
 * IDs + immutable evidence timestamps prevent polls and repeated rows replaying it.
 */
export function advanceConsoleMotion(previous: ConsoleMotionLedger | null, incoming: ConsoleMotionSnapshot, now: number): ConsoleMotionLedger {
  // Never turn newer completion/failure evidence back into working animation.
  if (previous && incoming.observedAt < previous.snapshot.observedAt && incoming.available) {
    return { ...previous, pulses: new Map([...previous.pulses].filter(([, pulse]) => pulse.expiresAt > now)) };
  }
  const baseline = !previous || !previous.snapshot.available || !incoming.available;
  const seen = new Set(previous?.seen ?? []);
  const oldEntities = new Map(previous?.snapshot.entities.map(entity => [consoleMotionTargetKey(entity.target, entity.id), entity]) ?? []);
  const snapshot = { ...incoming, entities: incoming.entities.map(entity => {
    const old = oldEntities.get(consoleMotionTargetKey(entity.target, entity.id));
    return old?.revision !== null && old?.revision !== undefined && (entity.revision === null || (entity.revision < old.revision || (entity.revision === old.revision && entity.state === "running" && old.state !== "running"))) ? old : entity;
  }) };
  const runStates = new Map(snapshot.entities.filter(entity => entity.target === "run").map(entity => [entity.id, entity]));
  // Child records can arrive from a later poll while their parent run is stale.
  // Reconcile against the newest parent evidence before exposing any pulse.
  snapshot.entities = snapshot.entities.map(entity => {
    if (!["stage", "worker"].includes(entity.target) || entity.state !== "running") return entity;
    const parent = entity.runId ? runStates.get(entity.runId) : undefined;
    return parent?.state === "running" ? entity : { ...entity, state: "stopped" as const,
      revision: Math.max(entity.revision ?? 0, parent?.revision ?? 0) };
  });
  const pulses = new Map<string, ConsoleMotionPulse>();
  for (const entity of snapshot.entities) {
    const targetKey = consoleMotionTargetKey(entity.target, entity.id);
    const old = oldEntities.get(targetKey);
    const key = cueKey(entity);
    const priorPulse = previous?.pulses.get(targetKey);
    if (!baseline && priorPulse && priorPulse.expiresAt > now && priorPulse.key === key) pulses.set(targetKey, priorPulse);
    if (!key || !entity.cue) continue;
    // A newly visible historic row is not a new saved output or accepted start.
    const fresh = old ? old.state !== entity.state : entity.cue.at >= (previous?.snapshot.observedAt ?? Infinity);
    const actualStart = entity.cue.kind !== "activation" || !old || old.startedAt === null;
    const forwardRevision = !old || old.revision === null || (entity.revision !== null && entity.revision > old.revision);
    if (!baseline && fresh && actualStart && forwardRevision && !seen.has(key)) {
      pulses.set(targetKey, { kind: entity.cue.kind, key, startedAt: now, expiresAt: now + CONSOLE_MOTION_DURATION_MS[entity.cue.kind] });
    }
    seen.add(key);
  }
  return { snapshot, seen, pulses };
}

/** Core activity requires a currently matched worker receipt. A running workflow
 * by itself can animate its own recorded step but cannot claim a worker is active.
 */
export function consoleMotionPresentation(ledger: ConsoleMotionLedger, target: ConsoleMotionTarget, id: string, now: number) {
  if (!ledger.snapshot.available) return { state: "unavailable" as const, startedAt: null, pulse: null };
  if (target === "core") {
    const workers = ledger.snapshot.entities.filter(entity => entity.target === "worker" && entity.state === "running");
    const activation = [...ledger.pulses.values()].find(pulse => pulse.kind === "activation" && pulse.expiresAt > now) ?? null;
    return { state: workers.length ? "running" as const : "idle" as const,
      startedAt: workers.length ? Math.min(...workers.map(worker => worker.startedAt!)) : null, pulse: activation };
  }
  const entity = ledger.snapshot.entities.find(entity => entity.target === target && entity.id === id);
  const pulse = ledger.pulses.get(consoleMotionTargetKey(target, id));
  return { state: entity?.state ?? "idle" as const, startedAt: entity?.startedAt ?? null, pulse: pulse && pulse.expiresAt > now ? pulse : null };
}

export function consoleMotionPhaseDelay(startedAt: number, now: number) {
  return -Math.max(0, now - startedAt) % CONSOLE_MOTION_PERIOD_MS;
}
