import Link from "next/link";

import { resumeSyntheticReview } from "@/app/dashboard/actions";
import { acknowledgeEtsySimulation } from "@/app/dashboard/packs/actions";
import { resumeBrowserControl } from "@/app/dashboard/browser-actions";
import type {
  BusinessRecord,
  OwnerInterventionRecord,
  TaskContractRecord,
  WorkerDefinitionRecord,
  WorkerRunRecord,
  WorkflowDefinitionRecord,
  WorkflowEventRecord,
  WorkflowRunRecord,
  WorkflowStageRecord,
} from "@/lib/core-ui/workflows";
import {
  currentWorkerSummary,
  deriveCurrentAction,
  deriveNextStep,
  eventDetail,
  eventLabel,
  formatDateTime,
  formatRelativeTime,
  humanize,
  latestEvent,
  interventionAction,
  workflowExecutionEnded,
  workflowNextStepLink,
  workflowTimelineStages,
  statusLabel,
  statusTone,
} from "@/lib/core-ui/workflows";

import { CoreIcon } from "./icons";
import { StatusPill } from "./app-shell";

type WorkflowTimelineProps = {
  unavailable?: boolean;
  definition?: WorkflowDefinitionRecord;
  run: WorkflowRunRecord;
  stages: WorkflowStageRecord[];
};

export function WorkflowTimeline({ definition, run, stages, unavailable = false }: WorkflowTimelineProps) {
  if (unavailable) return <p className="coreNotice" role="alert">Stage records unavailable. Refresh to check saved progress.</p>;
  const timeline = workflowTimelineStages(definition, run, stages);
  return (
    <ol className="visualTimeline" aria-label="Workflow stage timeline">
      {timeline.map((stage, index) => (
        <li
          className={`visualStage visualStage-${statusTone(stage.status)} ${stage.isCurrent ? "visualStage-current" : ""}`}
          key={stage.key}
          aria-current={stage.isCurrent ? "step" : undefined}
        >
          <span className="visualStageNode" aria-hidden="true">
            {stage.status === "completed" ? "✓" : index + 1}
          </span>
          <div><strong>{stage.label}</strong><small>{stage.detail}</small></div>
        </li>
      ))}
    </ol>
  );
}

type NeedsYouCardProps = {
  businessName?: string;
  definition?: WorkflowDefinitionRecord;
  run?: WorkflowRunRecord;
  intervention: OwnerInterventionRecord;
  returnTo: string;
  workflowName?: string;
};

export function NeedsYouCard({
  businessName,
  definition,
  run,
  intervention,
  returnTo,
  workflowName,
}: NeedsYouCardProps) {
  const action = interventionAction(intervention, run, definition);
  const simulationReview = action.kind === "simulation_review";
  const publicationReconcile = action.kind === "link" && action.section === "publication";
  const printfulProductReconcile = action.kind === "link" && action.section === "printful";
  const browserDecision = action.kind === "browser_control" ? action.decision : null;
  const detailsOnly = action.kind === "link" && action.section === "details";

  return (
    <article className={`needsYouCard ${browserDecision ? "browserInterventionCard" : ""}`}>
      <span className="needsYouIcon">
        <CoreIcon name={browserDecision ? "browser" : "needs-you"} />
      </span>
      <div className="needsYouCopy">
        <p className="coreEyebrow">{browserDecision ? "Browser control" : publicationReconcile ? "Publication verification" : printfulProductReconcile ? "Printful product verification" : detailsOnly ? "Needs your review" : "Needs your decision"}</p>
        <h3>{intervention.title}</h3>
        <p>{intervention.description}</p>
        {printfulProductReconcile ? <p>Partial product/file association receipts still need owner review. They do not establish physical placement, complete qualification or a listing-ready mockup.</p> : null}
        {simulationReview && intervention.workflow_run_id ? <Link href={`/dashboard/workflows/${intervention.workflow_run_id}`}>View simulated output and receipts</Link> : null}
        <small>
          {[businessName, workflowName, formatRelativeTime(intervention.requested_at)]
            .filter(Boolean)
            .join(" · ")}
        </small>
      </div>
      {action.kind === "link" ? (
        <Link className="coreButton coreButton-primary" href={action.href}>{action.label}</Link>
      ) : browserDecision ? (
        <form action={resumeBrowserControl} className="needsYouActions">
          <input name="interventionId" type="hidden" value={intervention.id} />
          <input name="returnTo" type="hidden" value={returnTo} />
          <button className="coreButton coreButton-primary" name="decision" type="submit" value={browserDecision}>
            {browserDecision === "take_control" ? "Take Control" : "Return Control"}
          </button>
        </form>
      ) : simulationReview ? (
        <form action={acknowledgeEtsySimulation} className="needsYouActions">
          <input name="interventionId" type="hidden" value={intervention.id} />
          <button className="coreButton coreButton-primary" name="decision" type="submit" value="acknowledge">
            Acknowledge simulated result
          </button>
          <button className="coreButton coreButton-danger" name="decision" type="submit" value="stop">
            Stop simulation
          </button>
        </form>
      ) : action.kind === "synthetic_review" ? (
        <form action={resumeSyntheticReview} className="needsYouActions">
          <input name="interventionId" type="hidden" value={intervention.id} />
          <input name="returnTo" type="hidden" value={returnTo} />
          <button className="coreButton coreButton-primary" name="decision" type="submit" value="approve">
            Approve and complete
          </button>
          <button className="coreButton coreButton-danger" name="decision" type="submit" value="fail">
            Fail workflow
          </button>
        </form>
      ) : null}
    </article>
  );
}

export function ActivityFeed({ events, unavailable = false }: { events: WorkflowEventRecord[]; unavailable?: boolean }) {
  return (
    <section className="activityPanel" aria-labelledby="activity-feed-heading" id="workflow-activity">
      <div className="workspacePanelHeader">
        <div>
          <p className="coreEyebrow">Recorded activity</p>
          <h2 id="activity-feed-heading">Activity Feed</h2>
        </div>
        <span>{events.length}</span>
      </div>

      {unavailable ? <p className="coreNotice" role="alert">Activity records unavailable. Any events shown may be incomplete; refresh to check again.</p> : null}
      {events.length ? (
        <ol className="activityFeed">
          {events.map((event) => (
            <li key={event.id}>
              <span className="activityMarker" aria-hidden="true" />
              <div>
                <strong>{eventLabel(event.event_type)}</strong>
                <p>{eventDetail(event)}</p>
                <time dateTime={event.occurred_at}>{formatRelativeTime(event.occurred_at)}</time>
              </div>
            </li>
          ))}
        </ol>
      ) : !unavailable ? (
        <div className="activityEmpty">
          <CoreIcon name="activity" />
          <p>Durable events will appear here as the workflow moves.</p>
        </div>
      ) : null}
    </section>
  );
}

type ExecutionSnapshotProps = {
  unavailable?: boolean;
  definition?: WorkflowDefinitionRecord;
  event: WorkflowEventRecord | null;
  intervention: OwnerInterventionRecord | null;
  run: WorkflowRunRecord;
  stages?: WorkflowStageRecord[];
  task: TaskContractRecord | null;
  workerDefinition: WorkerDefinitionRecord | null;
  workerRun: WorkerRunRecord | null;
};

export function ExecutionSnapshot({
  definition,
  event,
  intervention,
  run,
  stages = [],
  task,
  workerDefinition,
  workerRun,
  unavailable = false,
}: ExecutionSnapshotProps) {
  if (unavailable) return (
    <section className="executionSnapshot" aria-label="Current workflow execution">
      <article role="alert"><span>Execution details unavailable</span><strong>Saved execution details could not be checked</strong><small>Refresh before relying on worker, task or next-step details</small></article>
    </section>
  );
  const worker = currentWorkerSummary(run, task, workerRun, workerDefinition, stages);
  const nextStepLink = workflowNextStepLink(run, definition, intervention);
  const ended = workflowExecutionEnded(run);
  const cells = [
    {
      label: "Current worker",
      value: worker.value,
      detail: worker.detail,
    },
    {
      label: worker.active ? "Current task" : "Last recorded task",
      value: task?.objective ?? "No task recorded",
      detail: task ? `Task ${task.id.slice(0, 8)} · ${statusLabel(task.status)}` : "No Task Contract is available",
    },
    {
      label: "Current action",
      value: deriveCurrentAction(run, event, intervention),
      detail: event ? formatRelativeTime(event.occurred_at) : "Waiting for activity",
    },
    {
      label: "Next step",
      value: deriveNextStep(run, definition, intervention),
      detail: intervention?.status === "open" ? "Review required" : ended ? "Run has ended" : "Workflow controlled",
      link: nextStepLink,
    },
  ];

  return (
    <section className="executionSnapshot" aria-label="Current workflow execution">
      {cells.map((cell) => (
        <article key={cell.label}>
          <span>{cell.label}</span>
          <strong>{cell.value}</strong>
          <small>{cell.detail}</small>
          {cell.link ? <Link href={cell.link.href}>{cell.link.label} →</Link> : null}
        </article>
      ))}
    </section>
  );
}

type WorkflowListCardProps = {
  unavailable?: boolean;
  artifactCount: number;
  business?: BusinessRecord;
  definition?: WorkflowDefinitionRecord;
  events: WorkflowEventRecord[];
  intervention: OwnerInterventionRecord | null;
  run: WorkflowRunRecord;
  stages: WorkflowStageRecord[];
  task: TaskContractRecord | null;
  workerDefinition?: WorkerDefinitionRecord | null;
  workerRun?: WorkerRunRecord | null;
};

export function WorkflowListCard({
  artifactCount,
  business,
  definition,
  events,
  intervention,
  run,
  stages,
  task,
  workerDefinition,
  workerRun,
  unavailable = false,
}: WorkflowListCardProps) {
  const event = latestEvent(events);
  const worker = currentWorkerSummary(run, task, workerRun, workerDefinition, stages);

  return (
    <article className={`workflowListCard ${intervention ? "workflowListCard-attention" : ""}`}>
      <div className="workflowListTop">
        <div>
          <p className="coreEyebrow">{business?.name ?? "Business"}</p>
          <h3><Link href={`/dashboard/workflows/${run.id}`}>{definition?.name ?? "Workflow"}</Link></h3>
          <p>{definition?.description ?? "Durable Agent Labs workflow"}</p>
        </div>
        <StatusPill status={run.status} />
      </div>

      <WorkflowTimeline definition={definition} run={run} stages={stages} unavailable={unavailable} />

      <div className="workflowListMeta">
        <span><CoreIcon name="activity" /> {deriveCurrentAction(run, event, intervention)}</span>
        {unavailable ? <span role="status">Related records unavailable</span> : <>
          <span title={worker.detail}><CoreIcon name="workflow" /> {worker.value}</span>
          <span><CoreIcon name="artifacts" /> {artifactCount} artifact{artifactCount === 1 ? "" : "s"}</span>
        </>}
        <span>{task ? `Task ${task.id.slice(0, 8)}` : `Updated ${formatRelativeTime(run.updated_at)}`}</span>
        <Link href={`/dashboard/workflows/${run.id}`}>Open workflow →</Link>
      </div>
    </article>
  );
}

export function HistoryRow({
  business,
  definition,
  run,
}: {
  business?: BusinessRecord;
  definition?: WorkflowDefinitionRecord;
  run: WorkflowRunRecord;
}) {
  return (
    <Link className="historyRow" href={`/dashboard/workflows/${run.id}`}>
      <span className={`historyStatusDot historyStatusDot-${statusTone(run.status)}`} aria-hidden="true" />
      <span className="historyMain">
        <strong>{definition?.name ?? "Workflow"}</strong>
        <small>{business?.name ?? "Business"} · {humanize(run.current_stage_key)}</small>
      </span>
      <span className="historyTime">
        <strong>{statusLabel(run.status)}</strong>
        <small>{formatDateTime(run.completed_at ?? run.updated_at)}</small>
      </span>
    </Link>
  );
}
