import Link from "next/link";

import { AppShell, EmptyPanel, PageHeader } from "@/components/stage7/app-shell";
import { WorkflowListCard } from "@/components/stage7/workflow-visuals";
import {
  loadWorkflowCollection,
  requireOwnerUiContext,
} from "@/lib/core-ui/data";
import {
  ACTIVE_WORKFLOW_STATUSES,
  currentTask,
  currentWorkerRun,
  openIntervention,
} from "@/lib/core-ui/workflows";

export const dynamic = "force-dynamic";

type WorkflowsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function WorkflowsPage({ searchParams }: WorkflowsPageProps) {
  const context = await requireOwnerUiContext();
  const collection = await loadWorkflowCollection(context, { limit: 100 });
  const query = await searchParams;
  const view = first(query.view) === "active" ? "active" : "all";
  const runs =
    view === "active"
      ? collection.runs.filter((run) => ACTIVE_WORKFLOW_STATUSES.has(run.status))
      : collection.runs;

  const businessById = new Map(context.businesses.map((business) => [business.id, business]));
  const definitionById = new Map(
    collection.definitions.map((definition) => [definition.id, definition]),
  );
  const workerDefinitionById = new Map(
    collection.workerDefinitions.map((worker) => [worker.id, worker]),
  );
  const stagesByRun = new Map<string, typeof collection.stages>();
  const eventsByRun = new Map<string, typeof collection.events>();
  const interventionsByRun = new Map<string, typeof collection.interventions>();
  const tasksByRun = new Map<string, typeof collection.tasks>();
  const workersByRun = new Map<string, typeof collection.workerRuns>();
  const artifactCounts = new Map<string, number>();

  for (const stage of collection.stages) {
    const entries = stagesByRun.get(stage.workflow_run_id) ?? [];
    entries.push(stage);
    stagesByRun.set(stage.workflow_run_id, entries);
  }
  for (const event of collection.events) {
    if (!event.workflow_run_id) continue;
    const entries = eventsByRun.get(event.workflow_run_id) ?? [];
    entries.push(event);
    eventsByRun.set(event.workflow_run_id, entries);
  }
  for (const intervention of collection.interventions) {
    if (!intervention.workflow_run_id) continue;
    const entries = interventionsByRun.get(intervention.workflow_run_id) ?? [];
    entries.push(intervention);
    interventionsByRun.set(intervention.workflow_run_id, entries);
  }
  for (const task of collection.tasks) {
    const entries = tasksByRun.get(task.workflow_run_id) ?? [];
    entries.push(task);
    tasksByRun.set(task.workflow_run_id, entries);
  }
  for (const workerRun of collection.workerRuns) {
    const entries = workersByRun.get(workerRun.workflow_run_id) ?? [];
    entries.push(workerRun);
    workersByRun.set(workerRun.workflow_run_id, entries);
  }
  for (const artifact of collection.artifacts) {
    if (!artifact.workflow_run_id) continue;
    artifactCounts.set(
      artifact.workflow_run_id,
      (artifactCounts.get(artifact.workflow_run_id) ?? 0) + 1,
    );
  }

  return (
    <AppShell active="workflows" context={context}>
      <PageHeader
        actions={
          <div className="segmentedControl" aria-label="Workflow view">
            <Link className={view === "all" ? "active" : ""} href="/dashboard/workflows">All</Link>
            <Link className={view === "active" ? "active" : ""} href="/dashboard/workflows?view=active">Active</Link>
          </div>
        }
        description="Every durable run, its current state, worker, task, artifacts, and next transition."
        eyebrow="Durable execution"
        title="Workflows"
      />

      {collection.errors.length ? (
        <p className="coreNotice coreNotice-danger" role="alert">
          Some workflow records could not be loaded.
        </p>
      ) : null}

      <section className="workflowIndexSummary">
        <div><span>Showing</span><strong>{runs.length}</strong><small>{view === "active" ? "active runs" : "durable runs"}</small></div>
        <div><span>Running</span><strong>{collection.runs.filter((run) => ACTIVE_WORKFLOW_STATUSES.has(run.status)).length}</strong><small>live or waiting</small></div>
        <div><span>Needs You</span><strong>{context.needsYouCount}</strong><small>open decisions</small></div>
      </section>

      <section className="workflowIndex">
        {runs.length ? (
          <div className="workflowCardStack">
            {runs.map((run) => {
              const workerRun = currentWorkerRun(workersByRun.get(run.id) ?? []);
              return (
                <WorkflowListCard
                  artifactCount={artifactCounts.get(run.id) ?? 0}
                  business={businessById.get(run.business_id)}
                  definition={definitionById.get(run.workflow_definition_id)}
                  events={eventsByRun.get(run.id) ?? []}
                  intervention={openIntervention(interventionsByRun.get(run.id) ?? [])}
                  key={run.id}
                  run={run}
                  stages={stagesByRun.get(run.id) ?? []}
                  task={currentTask(tasksByRun.get(run.id) ?? [])}
                  workerDefinition={
                    workerRun ? workerDefinitionById.get(workerRun.worker_definition_id) : null
                  }
                />
              );
            })}
          </div>
        ) : (
          <EmptyPanel icon="workflow" title={view === "active" ? "No active workflows" : "No workflows yet"}>
            <p>
              {view === "active"
                ? "All current workflows have reached a terminal state."
                : "Start the durable proof from the Dashboard to create the first run."}
            </p>
          </EmptyPanel>
        )}
      </section>
    </AppShell>
  );
}
