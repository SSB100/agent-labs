import type { ProductExperimentRecord } from "../../products/types";
import type {
  ArtifactRecord, OwnerInterventionRecord, WorkflowDefinitionRecord,
  WorkflowEventRecord, WorkflowRunRecord,
} from "./workflows";
import { interventionAction, stageLabel, workflowExecutionEnded } from "./workflows";

/** `ready` means the complete scoped read succeeded, not merely that some rows arrived. */
export type OutcomeRecords<T> =
  | { status: "ready"; records: readonly T[] }
  | { status: "unavailable" | "not_loaded" };

type Scope = { business_id: string; workflow_run_id: string | null };
type RunIdentity = Pick<WorkflowRunRecord, "id" | "business_id">;
export type CreativeOutcomeRun = Scope & { id: string; approval_id: string };
export type CreativeOutcomeApproval = {
  id: string; business_id: string; purpose: string; maximum_microusd: number;
};
export type CreativeRetainedSource = {
  creativeRunId: string; callKey: string; storagePath: string; bytes: number;
  sha256: string; downloadVerified: boolean; mediaType: "image/png" | "image/webp";
};

/** Owner-scoped SELECT contracts. No runtime capability, service role or mutation is needed.
 * Always add business_id = run.business_id AND workflow_run_id = run.id where present.
 * Research settlements additionally require reservation_id IN the exact scoped reservation IDs.
 * Creative costs require the exact creative_runs ID joined on BOTH Business and workflow run;
 * approvals require its approval_id AND Business. Do not rely on run.input for that join.
 * Use count: exact and compare it to all returned rows (or exhaust pagination). Any read error,
 * truncation or missing join must become unavailable, never ready with an empty array.
 * Choose ONE ledger: research for discovery, creative for creative, model for other workflows.
 * Model telemetry can overlap dedicated ledgers. Never add the three totals together.
 * These are per-run costs. Shared research-chain balance/funding is a separate contract.
 */
export const RUN_OUTCOME_COST_SELECTS = {
  researchReservations: { table: "product_research_cost_reservations", select: "id,business_id,workflow_run_id,experiment_id,attempt_key,reserved_microusd" },
  researchSettlements: { table: "product_research_cost_settlements", select: "id,business_id,reservation_id,reported_microusd,provider_request_id" },
  creativeRuns: { table: "creative_runs", select: "id,business_id,workflow_run_id,approval_id" },
  creativeApprovals: { table: "creative_approvals", select: "id,business_id,purpose,maximum_microusd" },
  creativeReservations: { table: "creative_cost_reservations", select: "business_id,creative_run_id,call_key,reserved_microusd" },
  creativeSettlements: { table: "creative_cost_settlements", select: "business_id,creative_run_id,call_key,reported_microusd,provider_request_id" },
  modelInvocations: { table: "model_invocations", select: "id,business_id,workflow_run_id,reported_cost_usd,provider_request_id" },
} as const;

export type ResearchOutcomeReservation = Scope & {
  id: string; experiment_id: string; attempt_key: string; reserved_microusd: number;
};
export type ResearchOutcomeSettlement = {
  id: string; business_id: string; reservation_id: string;
  reported_microusd: number | null; provider_request_id: string | null;
};
export type CreativeOutcomeReservation = {
  business_id: string; creative_run_id: string; call_key: string; reserved_microusd: number;
};
export type CreativeOutcomeSettlement = {
  business_id: string; creative_run_id: string; call_key: string;
  reported_microusd: number | null; provider_request_id: string | null;
};
export type ModelOutcomeInvocation = Scope & {
  id: string; reported_cost_usd: number | string | null; provider_request_id: string | null;
};
export type RunOutcomeCostCall = {
  id: string; reportedUsd: number | null; reservedUsd: number | null; providerRequestId: string | null;
};
export type RunOutcomeCosts = {
  businessId: string; workflowRunId: string; source: "research" | "creative" | "model";
  calls: OutcomeRecords<RunOutcomeCostCall>;
};

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const micro = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value / 1_000_000 : null;
const matches = (row: Scope, run: RunIdentity) => row.business_id === run.business_id && row.workflow_run_id === run.id;
const records = <T,>(read: OutcomeRecords<T> | undefined): readonly T[] => read?.status === "ready" ? read.records : [];
function readFailure<T>(...reads: OutcomeRecords<T>[]): "unavailable" | "not_loaded" | null {
  return reads.some(read => read.status === "unavailable") ? "unavailable"
    : reads.some(read => read.status === "not_loaded") ? "not_loaded" : null;
}

export function researchOutcomeCosts(
  run: RunIdentity,
  reservations: OutcomeRecords<ResearchOutcomeReservation>,
  settlements: OutcomeRecords<ResearchOutcomeSettlement>,
): RunOutcomeCosts {
  const failed = readFailure<unknown>(reservations, settlements);
  const base = { businessId: run.business_id, workflowRunId: run.id, source: "research" as const };
  if (failed) return { ...base, calls: { status: failed } };
  const calls = [...new Map(records(reservations).filter(row => matches(row, run)).map(row => [row.id, row])).values()].map(row => {
    const receipts = records(settlements).filter(receipt => receipt.business_id === run.business_id && receipt.reservation_id === row.id);
    const known = receipts.filter(receipt => micro(receipt.reported_microusd) !== null && text(receipt.provider_request_id));
    // Append-only research settlement records can repeat a receipt. Match the ledger's MAX,
    // rather than summing repeated receipts. Conflicting provider identities remain uncertain.
    const providerIds = new Set(known.map(receipt => receipt.provider_request_id));
    return { id: row.id, reservedUsd: micro(row.reserved_microusd),
      reportedUsd: providerIds.size === 1 ? Math.max(...known.map(receipt => micro(receipt.reported_microusd)!)) : null,
      providerRequestId: providerIds.size === 1 ? known[0].provider_request_id : null };
  });
  return { ...base, calls: { status: "ready", records: calls } };
}

export function creativeOutcomeCosts(
  run: RunIdentity, creativeRun: CreativeOutcomeRun | null,
  reservations: OutcomeRecords<CreativeOutcomeReservation>,
  settlements: OutcomeRecords<CreativeOutcomeSettlement>,
): RunOutcomeCosts {
  const base = { businessId: run.business_id, workflowRunId: run.id, source: "creative" as const };
  const failed = readFailure<unknown>(reservations, settlements);
  if (failed) return { ...base, calls: { status: failed } };
  if (!creativeRun || !matches(creativeRun, run)) return { ...base, calls: { status: "unavailable" } };
  const scoped = (row: { business_id: string; creative_run_id: string }) => row.business_id === run.business_id && row.creative_run_id === creativeRun.id;
  const reserved = new Map(records(reservations).filter(scoped).map(row => [row.call_key, row]));
  const settled = new Map(records(settlements).filter(scoped).map(row => [row.call_key, row]));
  const keys = new Set([...reserved.keys(), ...settled.keys()]);
  return { ...base, calls: { status: "ready", records: [...keys].map(key => {
    const receipt = settled.get(key), providerRequestId = text(receipt?.provider_request_id);
    return { id: `${creativeRun.id}:${key}`, reservedUsd: micro(reserved.get(key)?.reserved_microusd),
      reportedUsd: providerRequestId ? micro(receipt?.reported_microusd) : null, providerRequestId };
  }) } };
}

export function modelOutcomeCosts(run: RunIdentity, invocations: OutcomeRecords<ModelOutcomeInvocation>): RunOutcomeCosts {
  const base = { businessId: run.business_id, workflowRunId: run.id, source: "model" as const };
  if (invocations.status !== "ready") return { ...base, calls: { status: invocations.status } };
  return { ...base, calls: { status: "ready", records: [...new Map(invocations.records.filter(row => matches(row, run)).map(row => [row.id, row])).values()].map(row => {
    const raw = row.reported_cost_usd;
    const amount = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : NaN;
    const providerRequestId = text(row.provider_request_id);
    return { id: row.id, reportedUsd: providerRequestId && Number.isFinite(amount) && amount >= 0 ? amount : null,
      reservedUsd: null, providerRequestId };
  }) } };
}

export function outcomeUsd(amount: number) {
  return amount > 0 && amount < 0.01 ? "<US$0.01" : `US$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function exactOutcomeUsd(amount: number) {
  return `US$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })}`;
}

export type RunOutcomeSpending = {
  label: string; value: string; detail: string; reservation: string | null; allowance: string | null;
  uncertain: boolean;
  exactAmounts: { label: string; value: string }[];
};
export function summarizeOutcomeSpending(run: RunIdentity, costs?: RunOutcomeCosts, allowanceUsd: number | null = null): RunOutcomeSpending {
  const allowance = allowanceUsd !== null ? `${outcomeUsd(allowanceUsd)} owner allowance for authorised work; not a guaranteed provider invoice cap` : null;
  const exactAllowance = allowanceUsd === null ? [] : [{ label: "Saved owner allowance", value: exactOutcomeUsd(allowanceUsd) }];
  if (!costs || costs.calls.status === "not_loaded") return { label: "Provider charges", value: "Not checked", detail: "Cost records have not been loaded. No zero-spend claim can be made.", reservation: null, allowance, uncertain: true, exactAmounts: exactAllowance };
  if (costs.businessId !== run.business_id || costs.workflowRunId !== run.id || costs.calls.status !== "ready") return { label: "Provider charges", value: "Unavailable", detail: "The complete cost history could not be checked. Missing records do not prove zero spend or authorize another attempt.", reservation: null, allowance, uncertain: true, exactAmounts: exactAllowance };
  const calls = [...new Map(costs.calls.records.map(call => [call.id, call])).values()];
  if (!calls.length) return { label: "Provider charges", value: "No entries in this ledger", detail: `The selected ${costs.source} ledger has no entries for this run. Qualified public research uses separate admission receipts; this is not proof of zero spend.`, reservation: null, allowance, uncertain: false, exactAmounts: exactAllowance };
  const requestCounts = new Map<string, number>();
  calls.forEach(call => { if (call.providerRequestId) requestCounts.set(call.providerRequestId, (requestCounts.get(call.providerRequestId) ?? 0) + 1); });
  const known = calls.filter(call => call.providerRequestId && requestCounts.get(call.providerRequestId) === 1 &&
    typeof call.reportedUsd === "number" && Number.isFinite(call.reportedUsd) && call.reportedUsd >= 0);
  const unknown = calls.length - known.length;
  const reserved = calls.filter(call => typeof call.reservedUsd === "number" && Number.isFinite(call.reservedUsd) && call.reservedUsd >= 0);
  const reservedTotal = reserved.reduce((sum, call) => sum + call.reservedUsd!, 0);
  return {
    label: unknown ? "Known reported charges" : "Reported provider charges",
    value: known.length ? outcomeUsd(known.reduce((sum, call) => sum + call.reportedUsd!, 0)) : "Charge unknown",
    detail: unknown ? `${unknown} of ${calls.length} recorded calls have an unknown charge. This is not a complete spending total; a missing receipt does not authorize another attempt.`
      : `Provider-reported charges for ${calls.length} recorded ${calls.length === 1 ? "call" : "calls"} in this run. Final billing has not been verified.`,
    reservation: reserved.length ? `${reserved.length < calls.length ? "At least " : ""}${outcomeUsd(reservedTotal)} reserved as preflight estimates. Reservations are not added to reported charges.` : null,
    allowance, uncertain: unknown > 0,
    exactAmounts: [
      ...known.map(call => ({ label: `Reported charge · ${call.id}`, value: exactOutcomeUsd(call.reportedUsd!) })),
      ...reserved.map(call => ({ label: `Reservation estimate · ${call.id}`, value: exactOutcomeUsd(call.reservedUsd!) })),
      ...exactAllowance,
    ],
  };
}

export type RunOutcomeInput = {
  run: WorkflowRunRecord; definition?: WorkflowDefinitionRecord | null;
  artifacts: OutcomeRecords<ArtifactRecord>;
  experiments: OutcomeRecords<ProductExperimentRecord>;
  interventions: OutcomeRecords<OwnerInterventionRecord>;
  events?: OutcomeRecords<WorkflowEventRecord>;
  creativeRuns?: OutcomeRecords<CreativeOutcomeRun>;
  creativeApprovals?: OutcomeRecords<CreativeOutcomeApproval>;
  retainedCreativeSources?: OutcomeRecords<CreativeRetainedSource>;
  costs?: RunOutcomeCosts;
};
export type RunOutcomeSummary = {
  title: string; summary: string; tone: "neutral" | "success" | "attention";
  goal: string | null; retained: string[]; blocked: string[];
  spending: RunOutcomeSpending;
  next: { href: string; label: string; detail: string };
  readWarning: string | null;
};

function matchingIntent(input: RunOutcomeInput) {
  const { run } = input, intentId = text(run.input.intentId);
  if (!intentId) return null;
  const root = records(input.experiments).find(row => matches(row, run) && row.id === intentId && row.discovery_version === "pod-discovery-2.0");
  const artifact = records(input.artifacts).find(row => matches(row, run) && row.artifact_type === "product.discovery-intent.v2" && row.metadata.intentId === intentId);
  const candidates = [root?.variables.intent, artifact?.content?.intent];
  return candidates.find(value => object(value) && value.version === "pod-discovery-2.0" && value.id === intentId && value.businessId === run.business_id) as Record<string, unknown> | undefined ?? null;
}

export function summarizeRunOutcome(input: RunOutcomeInput): RunOutcomeSummary {
  const { run } = input;
  const key = input.definition?.id === run.workflow_definition_id ? input.definition.workflow_key : "";
  const research = ["product.discovery-v2.one", "product.discovery-v2.two", "product.discovery-v2.analysis"].includes(key);
  const creative = key === "etsy.creative-pipeline";
  const ended = workflowExecutionEnded(run);
  const artifacts = records(input.artifacts).filter(row => matches(row, run));
  const interventions = records(input.interventions).filter(row => matches(row, run) && row.status === "open");
  const reconcile = interventions.find(row => ["etsy.publication.reconcile", "printful.product.reconcile"].includes(row.intervention_type));
  const intent = research ? matchingIntent(input) : null;
  const objective = text(intent?.objective);
  const goal = objective && objective.length >= 20 && objective.length <= 1200 ? objective : null;
  const creativeRun = records(input.creativeRuns).find(row => matches(row, run));
  const approval = creativeRun ? records(input.creativeApprovals).find(row => row.business_id === run.business_id && row.id === creativeRun.approval_id) : null;
  const allowance = research && object(intent?.limits) ? micro(intent.limits.maximumMicrousd) : creative && approval ? micro(approval.maximum_microusd) : null;
  const costs = input.costs && input.costs.source === (research ? "research" : creative ? "creative" : "model") ? input.costs : undefined;
  const spending = summarizeOutcomeSpending(run, costs, allowance);
  const retained: string[] = [], blocked: string[] = [];
  const business = encodeURIComponent(run.business_id);
  let title = ended ? (run.status === "completed" ? "Run completed" : "Run stopped") : run.status === "queued" ? "Queued to start"
    : ["needs_owner", "review"].includes(run.status) ? "Waiting for your decision" : run.status === "waiting" ? "Waiting for the next step" : "Work is in progress";
  let summary = ended ? "Review the saved outcome before taking another step." : `Latest saved stage: ${stageLabel(run.current_stage_key, "not recorded")}. No final outcome is recorded yet.`;
  let tone: RunOutcomeSummary["tone"] = run.status === "completed" ? "success" : ended ? "attention" : "neutral";
  let next = { href: `/dashboard/workflows/${encodeURIComponent(run.id)}?workspace=artifacts`, label: "Review saved outputs", detail: "Review the saved records for this run." };

  if (research) {
    const outputs = artifacts.filter(row => row.artifact_type === "worker.output");
    const evidence = outputs.filter(row => object(row.content?.evidencePack));
    const collection = artifacts.filter(row => row.artifact_type === "research.sources");
    const strategy = outputs.find(row => row.metadata.stageKey === "strategy" && row.content?.version === "pod-discovery-2.0" && row.content.intentId === run.input.intentId);
    const review = outputs.find(row => row.metadata.stageKey === "review" && row.content?.version === "pod-discovery-2.0" && row.content.intentId === run.input.intentId);
    const outcome = review?.content?.outcome;
    if (goal) retained.push("Your saved research goal");
    if (collection.length) retained.push(`${collection.length} saved source ${collection.length === 1 ? "collection" : "collections"}; collection alone does not establish usable evidence`);
    if (evidence.length) retained.push(`${evidence.length} saved Evidence ${evidence.length === 1 ? "Pack" : "Packs"}`);
    if (artifacts.some(row => row.artifact_type === "product.discovery-dossier.v2")) retained.push("The comparison dossier");
    if (strategy) retained.push("The strategist’s assessment");
    if (review) retained.push("The independent reviewer’s decision");
    if (ended && run.status !== "completed") {
      title = "This research round stopped";
      summary = `This round stopped during ${stageLabel(run.current_stage_key, "an unrecorded stage").toLowerCase()}. A complete research recommendation was not established by this run.`;
      blocked.push("A failed round is not a market verdict or approval to proceed");
    } else if (run.status === "completed") {
      const labels: Record<string, string> = { TEST: "A bounded test is recommended", REJECT: "The reviewed proposal was rejected", NEEDS_MORE_EVIDENCE: "More evidence is needed" };
      title = typeof outcome === "string" && labels[outcome] ? labels[outcome] : "Research run completed";
      summary = text(review?.content?.sufficiencyRationale) ?? "Review the saved research and decision. A completed run alone does not qualify a product.";
      if (outcome !== "TEST") tone = "attention";
    }
    if (!review) blocked.push(input.artifacts.status === "ready" ? "No independent research decision is recorded in the loaded outputs" : "The independent research decision could not be checked");
    if (Array.isArray(review?.content?.missingQuestions)) blocked.push(...review.content.missingQuestions.filter((value): value is string => typeof value === "string").slice(0, 3));
    blocked.push("Design generation needs its own eligible approval; publication and fulfilment are not authorized by this research run");
    next = { href: `/dashboard/products?business=${business}&view=results#discovery-goal-results`, label: ended && run.status !== "completed" ? "Review recovery options" : "Review research results", detail: "Open the saved goal and available evidence. Evidence reuse or another bounded round appears there only when its recorded prerequisites permit it." };
  } else if (creative) {
    const count = (type: string) => artifacts.filter(row => row.artifact_type === type).length;
    if (count("creative.brief")) retained.push("The saved creative brief");
    if (count("creative.brief-screen")) retained.push("The brief’s policy screen");
    if (count("creative.image")) retained.push(`${count("creative.image")} saved image ${count("creative.image") === 1 ? "version" : "versions"}`);
    if (count("creative.review")) retained.push(`${count("creative.review")} independent image ${count("creative.review") === 1 ? "review" : "reviews"}`);
    const sources = creativeRun ? records(input.retainedCreativeSources).filter(source => source.creativeRunId === creativeRun.id &&
      /^generate:[12]$/.test(source.callKey) && /^[a-f0-9]{64}$/.test(source.sha256) && Number.isSafeInteger(source.bytes) && source.bytes >= 12 && source.bytes <= 7_000_000 &&
      source.storagePath === `${run.business_id}/${creativeRun.id}/version-${source.callKey.split(":")[1]}${source.mediaType === "image/webp" ? ".original.webp" : ".png"}`) : [];
    if (sources.length) retained.push(`${sources.length} unvalidated provider ${sources.length === 1 ? "source" : "sources"} retained after failure; this is not a usable design or review PASS`);
    if (ended && run.status !== "completed") {
      title = "Design work stopped for review";
      summary = `This run stopped during ${stageLabel(run.current_stage_key, "an unrecorded stage").toLowerCase()}. Review the saved images, checks and provider receipts before deciding whether a separately approved run is appropriate.`;
    } else if (run.status === "completed") {
      const production = approval?.purpose === "candidate_production" && run.state.productionReady === true;
      title = production ? "Design passed its saved production approval" : "Technical run completed";
      summary = production ? "The saved run passed its production approval at completion. Current eligibility still needs to be checked before use."
        : "A technical PASS does not make this design production-ready. Candidate eligibility and a separate production approval are still required.";
      if (!production) tone = "attention";
    }
    blocked.push("A review PASS alone does not authorize production or publication");
    next = { href: `/dashboard/artifacts?business=${business}#${creativeRun ? `creative-run-${encodeURIComponent(creativeRun.id)}` : "creative-approvals"}`, label: "Review design in Library", detail: creativeRun
      ? "Open the exact approved scope and run history. Inspect the saved failure and costs before any new approval."
      : "Open this Business’s approved scope and run history. The exact creative-run identity could not be confirmed from the loaded records." };
  } else {
    if (artifacts.length) retained.push(`${artifacts.length} saved ${artifacts.length === 1 ? "output" : "outputs"}`);
    if (key.startsWith("synthetic.")) {
      title = run.status === "completed" ? "Demo completed" : ended ? "Demo stopped" : "Demo in progress";
      summary = "This run tests the workflow runtime. It is not evidence of a researched, designed or sale-ready product.";
    }
  }

  if (!retained.length) retained.push(input.artifacts.status === "ready" ? "No saved output artifacts are recorded in this run" : "Saved outputs could not be checked; they may still exist");
  if (interventions.length && !reconcile) blocked.unshift(interventions[0].title);
  if (reconcile) {
    title = "Check the existing external result";
    summary = "An external write has an unresolved result. Review the existing listing or product before taking any further action.";
    tone = "attention";
    blocked.unshift("Do not repeat the external write; its result must be reconciled first");
    const action = interventionAction(reconcile, run, input.definition ?? undefined);
    if (action.kind === "link") next = { href: action.href, label: action.label, detail: "The existing reconciliation route checks the saved external identity. It does not authorize a blind retry." };
  } else if (!research && !creative && interventions.length) {
    const action = interventionAction(interventions[0], run, input.definition ?? undefined);
    next = action.kind === "link" ? { href: action.href, label: action.label, detail: "Review the existing request and its recorded next step." }
      : { href: "/dashboard/needs-you", label: "Review your decision", detail: "Use the existing decision controls for this run." };
  }
  if (spending.uncertain && ended) blocked.push("Spending is not fully confirmed; missing receipts do not permit an automatic retry");
  if (!blocked.length) blocked.push(ended ? "No further action is authorized by this summary" : "The final result is still pending");
  const reads = [input.artifacts, input.interventions, ...(research ? [input.experiments] : []),
    ...(creative ? [input.creativeRuns, input.creativeApprovals, input.retainedCreativeSources].filter(read => read !== undefined) : [])];
  const readWarning = reads.some(read => read.status === "unavailable") ? "Some saved records could not be loaded. This is a read problem, not proof that evidence, decisions or outputs are missing."
    : reads.some(read => read.status === "not_loaded") ? "Some saved records have not been checked. This summary may be incomplete." : null;
  return { title, summary, tone, goal, retained, blocked, spending, next, readWarning };
}
