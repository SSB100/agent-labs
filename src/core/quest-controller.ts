import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { AdmissionDispatchInput } from "./admission-contract";
import { compileQuestPlan, type QuestPlan, type QuestStep } from "./quest-plan";
import { readQuestKnowledge, type QuestKnowledgeSnapshot } from "./reviewed-knowledge";

export type QuestDependency = { stepKey: string; attemptId: string; resultHash: string };
export type QuestAttempt = {
  id: string; stepKey: string; attempt: number;
  status: "scheduled" | "reserved" | "dispatched" | "uncertain" | "responded" | "completed" | "rejected" | "failed" | "cancelled";
  reason: string; inputHash: string; dependencyPins: QuestDependency[]; repairEvidenceHash: string;
  resultEvidenceHash?: string | null;
  wireHash: string | null; requestId: string | null; responseHash: string | null;
};
export type QuestSnapshot = {
  businessId: string; goalId: string; planId: string; version: number; planHash: string; plan: QuestPlan;
  head: { planId: string; revision: number; state: string; reason: string; epoch: number; leaseExpiresAt: string; repairsUsed: number; pivotsUsed: number; childrenCreated: number; dispatches: number };
  attempts: QuestAttempt[];
  reused: Array<{ stepKey: string; attemptId: string; resultHash: string }>;
  /** Required by the deployed R09 reader; absent only in pre-R09 inert stores. */
  knowledge?: QuestKnowledgeSnapshot;
};
export type QuestSettlement = { actualMicrounits: string | null; providerRequestId: string; receiptHash: string };
export type QuestEffectResponse = {
  outcome: "accepted" | "rejected" | "failed";
  result: Record<string, unknown>;
  /** Independently checked immutable dependencies, mandatory for check stages. */
  checkedArtifacts: QuestDependency[];
  settlement: QuestSettlement;
};
export type QuestPreparedCall = {
  descriptor: Omit<AdmissionDispatchInput, "runtimeCapability">;
  /** Exact bytes to be sent. Only trusted, explicitly registered adapters see these. */
  wire: Readonly<{ url: string; method: "POST"; body: string }>;
};
export type QuestAdapterContext = Readonly<{ planId: string; planHash: string; plan: QuestPlan; step: QuestStep; attempt: QuestAttempt; knowledge: QuestKnowledgeSnapshot }>;
export type QuestAdapter = {
  qualificationHash: string;
  workflowDefinitionId: string;
  workerDefinitionId: string;
  /** No production adapter is shipped by R07. */
  mode: "simulation" | "production" | "qualification";
  prepare(context: QuestAdapterContext): Promise<QuestPreparedCall>;
  dispatch(call: QuestPreparedCall, context: QuestAdapterContext): Promise<QuestEffectResponse>;
  reconcile(context: QuestAdapterContext): Promise<{ status: "unknown" } | { status: "found"; response: QuestEffectResponse }>;
};
export type QuestStore = {
  read(): Promise<QuestSnapshot | null>;
  command(operation: string, payload: Record<string, unknown>, epoch?: number): Promise<Record<string, unknown>>;
  /** Trusted runtime opt-in only for an explicitly authorized recovery scope.
   * A matching pilot may renew its existing lease once after preparation. */
  recoveryDispatchLeaseScopeId?: string;
};
export type QuestTickResult = {
  status: "progress" | "waiting" | "blocked" | "stopped" | "completed";
  reason: string;
  wakeAt?: string;
};
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const none: Readonly<Record<string, QuestAdapter>> = Object.freeze({});
/** Default-deny. Adding a source entry alone would still fail SQL qualification. */
export const PRODUCTION_QUEST_ADAPTERS = none;

function adapterFor(registry: Readonly<Record<string, QuestAdapter>>, step: QuestStep): QuestAdapter | null {
  const adapter = Object.hasOwn(registry, step.adapter) ? registry[step.adapter] : undefined;
  return adapter && adapter.qualificationHash === step.qualificationHash && adapter.workflowDefinitionId === step.workflowDefinitionId && adapter.workerDefinitionId === step.workerDefinitionId ? adapter : null;
}
function immutable<T>(value: T): T {
  const copied = structuredClone(value);
  const freeze = (v: unknown): void => {
    if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); }
  };
  freeze(copied);
  return copied;
}
function preparedCall(input: QuestPreparedCall, context: QuestAdapterContext): QuestPreparedCall {
  const call = immutable(input), d = call.descriptor;
  if (call.wire.url !== "https://openrouter.ai/api/v1/chat/completions" || call.wire.method !== "POST" ||
    d.workflowRunId !== context.attempt.id || d.idempotencyKey !== `r07:${context.attempt.id}` || d.operationKey !== context.step.operationKey ||
    d.wireRequestHash !== digest(call.wire.body) || d.wireRequestBytes !== Buffer.byteLength(call.wire.body, "utf8") || d.accounting.kind !== "r05") {
    throw new Error("r07_final_wire_mismatch");
  }
  const body: unknown = JSON.parse(call.wire.body);
  if (!body || typeof body !== "object" || Array.isArray(body) || !("model" in body) || body.model !== d.providerModelId || !("max_tokens" in body) || body.max_tokens !== d.maximumOutputTokens || !("stream" in body) || body.stream !== false) throw new Error("r07_final_wire_mismatch");
  if (context.attempt.wireHash !== null && context.attempt.wireHash !== d.wireRequestHash) throw new Error("r07_reserved_wire_changed");
  return call;
}
function dispatchSnapshotPins(snapshot: QuestSnapshot) {
  const { leaseExpiresAt: _expiresAt, ...head } = snapshot.head;
  void _expiresAt;
  return { ...snapshot, head };
}

/** One finite durable transition. A scheduler wakes on persisted deadlines or new
 * evidence; it must not call a model to reconsider an unchanged snapshot. */
export async function driveQuestOnce(store: QuestStore, options: {
  adapters?: Readonly<Record<string, QuestAdapter>>;
  reconcile?: boolean;
  repair?: { stepKey: string; evidenceHash: string; reason: string };
} = {}): Promise<QuestTickResult> {
  const initial = await store.read();
  if (!initial) return { status: "blocked", reason: "plan_required" };
  const plan = compileQuestPlan(initial.plan);
  const claim = await store.command("claim", { seconds: 60 });
  const epoch = Number(claim.epoch);
  if (!Number.isSafeInteger(epoch) || epoch < 1) throw new Error("r07_invalid_lease_response");
  const snapshot = await store.read();
  if (!snapshot || snapshot.planId !== initial.planId || snapshot.planHash !== initial.planHash) return { status: "waiting", reason: "plan_changed_reload" };
  const knowledge = readQuestKnowledge(snapshot.knowledge ?? { format: "r09.1", businessId: snapshot.businessId, planId: snapshot.planId, pins: [] }, snapshot.businessId, snapshot.planId);
  const registry = options.adapters ?? PRODUCTION_QUEST_ADAPTERS;
  const apply = (operation: string, payload: Record<string, unknown>) => store.command(operation, payload, epoch);
  // Project received evidence before considering any new dispatch, including after pause.
  const responded = snapshot.attempts.find(a => a.status === "responded");
  if (responded) {
    let result = await apply("finish", { attemptId: responded.id });
    if (result.reason === "unresolved_liability" && options.reconcile) {
      const step = plan.steps.find(s => s.key === responded.stepKey);
      const adapter = step && adapterFor(registry, step);
      if (!step || !adapter) return { status: "blocked", reason: "adapter_implementation_unavailable" };
      const context = immutable({ planId: snapshot.planId, planHash: snapshot.planHash, plan, step, attempt: responded, knowledge });
      const readback = await adapter.reconcile(context);
      if (readback.status === "unknown") return { status: "blocked", reason: "liability_still_uncertain" };
      // Financial readback appends evidence even if a conflicting result is rejected.
      // Re-ingesting an identical output checks its binding without rewriting it.
      await apply("settle", { attemptId: responded.id, settlement: immutable(readback.response.settlement) });
      await apply("response", { attemptId: responded.id, planHash: snapshot.planHash, inputHash: responded.inputHash, ...immutable(readback.response) });
      result = await apply("finish", { attemptId: responded.id });
    }
    return result.reason === "unresolved_liability" ? { status: "blocked", reason: "unresolved_liability" } : { status: "progress", reason: "response_projected" };
  }
  const pending = snapshot.attempts.find(a => ["scheduled", "reserved", "dispatched", "uncertain"].includes(a.status));
  if (pending) {
    const step = plan.steps.find(s => s.key === pending.stepKey);
    if (!step) throw new Error("r07_saved_step_unavailable");
    const adapter = adapterFor(registry, step);
    if (!adapter) return { status: "blocked", reason: "adapter_implementation_unavailable" };
    const context = immutable({ planId: snapshot.planId, planHash: snapshot.planHash, plan, step, attempt: pending, knowledge });
    if (pending.status === "dispatched" || pending.status === "uncertain") {
      if (!options.reconcile) {
        if (pending.status === "dispatched") await apply("uncertain", { attemptId: pending.id, evidenceHash: digest(`restart:${pending.id}`) });
        return { status: "blocked", reason: "trusted_readback_required" };
      }
      const readback = await adapter.reconcile(context);
      if (readback.status === "unknown") return { status: "blocked", reason: "effect_still_uncertain" };
      await apply("settle", { attemptId: pending.id, settlement: immutable(readback.response.settlement) });
      await apply("response", { attemptId: pending.id, planHash: snapshot.planHash, inputHash: pending.inputHash, ...immutable(readback.response) });
      return { status: "progress", reason: "readback_persisted" };
    }
    // Preparation can be repeated after a process crash; it cannot dispatch or spend.
    const renewPreparedLease = pending.status === "reserved" && store.recoveryDispatchLeaseScopeId !== undefined;
    if (renewPreparedLease && (plan.format !== "r12.discovery-pilot.1" || plan.discoveryScopeId !== store.recoveryDispatchLeaseScopeId)) {
      throw new Error("r07_recovery_lease_scope_mismatch");
    }
    // Capture before awaiting prepare: no later mutation may rewrite the pins
    // against which the prepared request and its dependencies were validated.
    const dispatchPins = renewPreparedLease ? immutable(dispatchSnapshotPins(snapshot)) : null;
    const call = preparedCall(await adapter.prepare(context), context);
    if (pending.status === "scheduled") {
      const reserved = await apply("reserve", { attemptId: pending.id, descriptor: call.descriptor });
      return reserved.status === "reserved" ? { status: "progress", reason: "reserved" } : { status: "blocked", reason: String(reserved.reason ?? "reservation_denied") };
    }
    if (dispatchPins) {
      // The store retains the same token. An expired or replaced lease advances
      // its epoch; that is a new lease and cannot authorize this prepared call.
      const renewed = await store.command("claim", { seconds: 60 });
      if (renewed.replayed === true) throw new Error("r07_recovery_lease_unverified");
      if (Number(renewed.epoch) !== epoch) throw new Error("r07_recovery_lease_epoch_changed");
      const refreshed = await store.read();
      // Canonical claim advances revision exactly once. No other change to
      // plan, attempt, dependencies, knowledge or controller state is allowed.
      const expectedRevision = dispatchPins.head.revision + 1;
      if (!refreshed || refreshed.head.epoch !== epoch || !Number.isSafeInteger(expectedRevision) || refreshed.head.revision !== expectedRevision ||
        typeof renewed.expiresAt !== "string" || !Number.isFinite(Date.parse(renewed.expiresAt)) || refreshed.head.leaseExpiresAt !== renewed.expiresAt ||
        !isDeepStrictEqual(dispatchSnapshotPins({ ...refreshed, head: { ...refreshed.head, revision: dispatchPins.head.revision } }), dispatchPins)) {
        throw new Error("r07_recovery_dispatch_pins_changed");
      }
      const attempt = refreshed.attempts.find(a => a.id === pending.id);
      if (!attempt || attempt.status !== "reserved") throw new Error("r07_recovery_dispatch_pins_changed");
      preparedCall(call, immutable({ ...context, attempt }));
    }
    const marked = await apply("dispatch", { attemptId: pending.id, wireHash: call.descriptor.wireRequestHash });
    if (marked.shouldDispatch !== true) return { status: "blocked", reason: String(marked.reason ?? "dispatch_denied") };
    // Do not catch/retry this cut. A network error, process death or lost response
    // leaves the committed marker for a fresh process to reconcile, never resend.
    const response = immutable(await adapter.dispatch(call, context));
    await apply("settle", { attemptId: pending.id, settlement: response.settlement });
    await apply("response", { attemptId: pending.id, planHash: snapshot.planHash, inputHash: pending.inputHash, ...response });
    return { status: "progress", reason: "response_persisted" };
  }
  if (snapshot.head.state === "completed") return { status: "completed", reason: snapshot.head.reason };
  const succeeded = new Set([...snapshot.reused.map(s => s.stepKey), ...snapshot.attempts.filter(a => a.status === "completed").map(a => a.stepKey)]);
  const repair = options.repair;
  const next = plan.steps.find(step => !succeeded.has(step.key) && step.dependsOn.every(key => succeeded.has(key)) &&
    (!snapshot.attempts.some(a => a.stepKey === step.key) || (repair?.stepKey === step.key && snapshot.attempts.filter(a => a.stepKey === step.key).every(a => ["rejected", "failed"].includes(a.status)))));
  if (next) {
    if (!adapterFor(registry, next)) return { status: "blocked", reason: "adapter_implementation_unavailable" };
    const scheduled = await apply("schedule", { stepKey: next.key, attemptId: randomUUID(), reason: repair?.stepKey === next.key ? repair.reason : next.reason, evidenceHash: repair?.stepKey === next.key ? repair.evidenceHash : snapshot.planHash });
    if (scheduled.status === "scheduled") return { status: "progress", reason: "scheduled" };
    return scheduled.reason === "measurement_wait" ? { status: "waiting", reason: "measurement_wait", wakeAt: next.measurement?.closesAt ?? next.notBefore } : { status: "blocked", reason: String(scheduled.reason ?? "schedule_denied") };
  }
  const evaluated = await apply("evaluate", {});
  return { status: evaluated.state === "completed" ? "completed" : evaluated.state === "stopped" ? "stopped" : evaluated.state === "waiting" ? "waiting" : "blocked", reason: String(evaluated.reason ?? "no_permitted_work") };
}
