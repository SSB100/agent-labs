import Link from "next/link";

import { resumeSyntheticReview } from "@/app/dashboard/actions";
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
  deriveCurrentAction,
  deriveNextStep,
  eventDetail,
  eventLabel,
  formatDateTime,
  formatRelativeTime,
  humanize,
  latestEvent,
  latestStageByKey,
  stageBlueprints,
  statusLabel,
  statusTone,
} from "@/lib/core-ui/workflows";

import { CoreIcon } from "./icons";
import { StatusPill } from "./app-shell";

type WorkflowTimelineProps = {
  definition?: WorkflowDefinitionRecord;
  run: WorkflowRunRecord;
  stages: WorkflowStageRecord[];
};

export function WorkflowTimeline({ definition, run, stages }: WorkflowTimelineProps) {
  const blueprints = stageBlueprints(definition);
  const latestStages = latestStageByKey(stages);
  const currentIndex = blueprints.findIndex((stage) => stage.key === run.current_stage_key);

  return (
    <ol className="visualTimeline" aria-label="Workflow stage timeline">
      {blueprints.length ? (
        blueprints.map((blueprint, index) => {
          const stage = latestStages.get(blueprint.key);
          const inferredStatus =
            stage?.status ??
            (index < currentIndex
              ? "completed"
              : index === currentIndex
                ? run.status === "needs_owner"
                  ? "review"
                  : run.status
                : "pending");
          const isCurrent = blueprint.key === run.current_stage_key;

          return (
            <li
              className={`visualStage visualStage-${statusTone(inferredStatus)} ${isCurrent ? "visualStage-current" : ""}`}
              key={blueprint.key}
            >
              <span className="visualStageNode" aria-hidden="true">
                {inferredStatus === "completed" ? "✓" : index + 1}
              </span>
              <div>
                <strong>{humanize(blueprint.key)}</strong>
                <small>
                  {stage
                    ? `${statusLabel(stage.status)}${stage.attempt > 1 ? ` · attempt ${stage.attempt}` : ""}`
                    : isCurrent
                      ? statusLabel(run.status)
                      : index < currentIndex
                        ? "Completed"
                        : "Upcoming"}
                </small>
              </div>
            </li>
          );
        })
      ) : (
        <li className="visualStage visualStage-live visualStage-current">
          <span className="visualStageNode" aria-hidden="true">1</span>
          <div><strong>{humanize(run.current_stage_key, "Launch")}</strong><small>{statusLabel(run.status)}</small></div>
        </li>
      )}
    </ol>
  );
}

type NeedsYouCardProps = {
  businessName?: string;
  intervention: OwnerInterventionRecord;
  returnTo: string;
  workflowName?: string;
};

export function NeedsYouCard({
  businessName,
  intervention,
  returnTo,
  workflowName,
}: NeedsYouCardProps) {
  return (
    <article className="needsYouCard">
      <span className="needsYouIcon"><CoreIcon name="needs-you" /></span>
      <div className="needsYouCopy">
        <p className="coreEyebrow">Needs your decision</p>
        <h3>{intervention.title}</h3>
        <p>{intervention.description}</p>
        <small>
          {[businessName, workflowName, formatRelativeTime(intervention.requested_at)]
            .filter(Boolean)
            .join(" · ")}
        </small>
      </div>
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
    </article>
  );
}

export function ActivityFeed({ events }: { events: WorkflowEventRecord[] }) {
  return (
    <section className="activityPanel" aria-labelledby="activity-feed-heading">
      <div className="workspacePanelHeader">
        <div>
          <p className="coreEyebrow">Live activity</p>
          <h2 id="activity-feed-heading">Activity Feed</h2>
        </div>
        <span>{events.length}</span>
      </div>

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
      ) : (
        <div className="activityEmpty">
          <CoreIcon name="activity" />
          <p>Durable events will appear here as the workflow moves.</p>
        </div>
      )}
    </section>
  );
}

type ExecutionSnapshotProps = {
  definition?: WorkflowDefinitionRecord;
  event: WorkflowEventRecord | null;
  intervention: OwnerInterventionRecord | null;
  run: WorkflowRunRecord;
  task: TaskContractRecord | null;
  workerDefinition: WorkerDefinitionRecord | null;
  workerRun: WorkerRunRecord | null;
};

export function ExecutionSnapshot({
  definition,
  event,
  intervention,
  run,
  task,
  workerDefinition,
  workerRun,
}: ExecutionSnapshotProps) {
  const cells = [
    {
      label: "Current worker",
      value:
        workerDefinition?.name ??
        (run.current_stage_key === "worker-task" ? "Synthetic worker fixture" : "Workflow runtime"),
      detail: workerRun ? statusLabel(workerRun.status) : humanize(run.current_stage_key, "Preparing"),
    },
    {
      label: "Current task",
      value: task?.objective ?? definition?.description ?? "Advance the durable workflow",
      detail: task ? `Task ${task.id.slice(0, 8)}` : "Defined by the current stage",
    },
    {
      label: "Current action",
      value: deriveCurrentAction(run, event, intervention),
      detail: event ? formatRelativeTime(event.occurred_at) : "Waiting for activity",
    },
    {
      label: "Next step",
      value: deriveNextStep(run, definition, intervention),
      detail: intervention ? "Owner action required" : "Workflow controlled",
    },
  ];

  return (
    <section className="executionSnapshot" aria-label="Current workflow execution">
      {cells.map((cell) => (
        <article key={cell.label}>
          <span>{cell.label}</span>
          <strong>{cell.value}</strong>
          <small>{cell.detail}</small>
        </article>
      ))}
    </section>
  );
}

type WorkflowListCardProps = {
  artifactCount: number;
  business?: BusinessRecord;
  definition?: WorkflowDefinitionRecord;
  events: WorkflowEventRecord[];
  intervention: OwnerInterventionRecord | null;
  run: WorkflowRunRecord;
  stages: WorkflowStageRecord[];
  task: TaskContractRecord | null;
  workerDefinition?: WorkerDefinitionRecord | null;
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
}: WorkflowListCardProps) {
  const event = latestEvent(events);

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

      <WorkflowTimeline definition={definition} run={run} stages={stages} />

      <div className="workflowListMeta">
        <span><CoreIcon name="activity" /> {deriveCurrentAction(run, event, intervention)}</span>
        <span><CoreIcon name="workflow" /> {workerDefinition?.name ?? humanize(run.current_stage_key)}</span>
        <span><CoreIcon name="artifacts" /> {artifactCount} artifact{artifactCount === 1 ? "" : "s"}</span>
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
