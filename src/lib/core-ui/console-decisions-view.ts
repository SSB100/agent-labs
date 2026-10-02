import { interventionAction, stageLabel, workflowExecutionEnded, type OwnerInterventionRecord, type WorkflowDefinitionRecord, type WorkflowRunRecord } from "./workflows";
import { summarizeOutcomeSpending } from "./run-outcome";
import type { ConsoleDecisionDetail } from "./console-decisions-data";

/** Only display bounded human-readable fields. Provider payloads and token-like strings stay out. */
export function safeDecisionText(value: unknown, fallback: string, maximum = 500): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const text = value.trim();
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) || /https?:\/\/|\b(?:bearer|authorization|api[_ -]?key|access[_ -]?token|secret|password)\b|[A-Za-z0-9+/_=-]{80}/i.test(text)) return fallback;
  return text.length > maximum ? `${text.slice(0, maximum - 1)}…` : text;
}
export function decisionRunState(request: OwnerInterventionRecord, run?: WorkflowRunRecord | null): string {
  if (!run) return "Run unavailable";
  if (workflowExecutionEnded(run)) return run.status === "completed" ? "Run completed" : "Stopped";
  if (request.status === "open" && ["needs_owner", "review"].includes(run.status)) return "Awaiting decision";
  return "Run not ended";
}
export function decisionFailureReason(request: OwnerInterventionRecord, detail: ConsoleDecisionDetail): string {
  const stage = detail.stages.status === "ready" ? [...detail.stages.records].reverse().find(row => row.status === "failed") : undefined;
  // Use only the deliberately bounded reason field, never a raw failure object or provider metadata.
  const raw = typeof stage?.failure?.reason === "string" ? stage.failure.reason : request.description;
  if (/unsupported (?:animation, )?encoding|unsupported animation, encoding, or metadata|unsupported_image_features/i.test(raw)) return "The generated image was rejected because its encoding or metadata is unsupported.";
  if (/exactly (?:one|1).*PNG|single.*PNG|not.*exactly.*PNG/i.test(raw)) return "The provider response did not contain exactly one accepted PNG image.";
  if (detail.run?.current_stage_key === "brief:1" && /fail|no.*output|empty|invalid|schema|parse/i.test(raw)) return "The brief stage failed before a usable brief was saved.";
  return safeDecisionText(raw, "The saved failure reason is unavailable here. Inspect the retained records before deciding what to do next.");
}
export function decisionDetailModel(request: OwnerInterventionRecord, detail: ConsoleDecisionDetail) {
  const run = detail.run, definition = detail.definition;
  const approval = detail.approval.status === "ready" && detail.approval.records.length === 1 ? detail.approval.records[0] : null;
  const stage = detail.stages.status === "ready" ? [...detail.stages.records].reverse().find(row => row.status === "failed") : undefined;
  const ended = Boolean(run && workflowExecutionEnded(run));
  const stoppedCreative = Boolean(run && definition && request.intervention_type === "creative_review" && request.workflow_run_id === run.id && request.business_id === run.business_id &&
    run.workflow_definition_id === definition.id && definition.workflow_key === "etsy.creative-pipeline" && definition.version === "1.0.0" && ended && run.status !== "completed");
  let action = interventionAction(request, run, definition);
  if (action.kind === "browser_control" || action.kind === "simulation_review") {
    const expectedWorkflow = action.kind === "simulation_review" ? definition?.workflow_key === "etsy.product-discovery-simulation"
      : ["synthetic.browser-provider.qualification", "synthetic.browser-planner.qualification"].includes(definition?.workflow_key ?? "");
    const matchedReadableRun = Boolean(run && definition && request.business_id === run.business_id && request.workflow_run_id === run.id && run.workflow_definition_id === definition.id &&
      definition.version === "1.0.0" && expectedWorkflow && run.status === "needs_owner" && !workflowExecutionEnded(run));
    if (!matchedReadableRun) action = interventionAction({ ...request, status: "resolved" }, run, definition);
  }
  return {
    concept: safeDecisionText(approval?.snapshot.concept, "Concept not available in the checked records", Number.MAX_SAFE_INTEGER),
    workflowName: safeDecisionText(definition?.name, "Workflow name unavailable", Number.MAX_SAFE_INTEGER),
    stage: stageLabel(stage?.stage_key ?? run?.current_stage_key, "Stage unavailable"),
    reason: decisionFailureReason(request, detail), ended, stoppedCreative,
    acknowledgementEligible: stoppedCreative && detail.acknowledgement.eligible,
    reviewed: stoppedCreative && detail.acknowledgement.reviewed,
    state: decisionRunState(request, run),
    action,
    spending: run ? summarizeOutcomeSpending(run, detail.costData?.costs) : null,
  };
}
export function decisionWorkflowName(run: WorkflowRunRecord | undefined, definitions: WorkflowDefinitionRecord[]): string {
  return safeDecisionText(definitions.find(row => row.id === run?.workflow_definition_id)?.name, "Workflow context unavailable", 180);
}
