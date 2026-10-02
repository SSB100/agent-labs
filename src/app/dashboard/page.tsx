import Link from "next/link";

import {
  AppShell,
  EmptyPanel,
  PageHeader,
} from "@/components/stage7/app-shell";
import {
  ActivityFeed,
  HistoryRow,
  NeedsYouCard,
  WorkflowListCard,
} from "@/components/stage7/workflow-visuals";
import { CoreIcon } from "@/components/stage7/icons";
import {
  loadWorkflowCollection,
  requireOwnerUiContext,
} from "@/lib/core-ui/data";
import {
  ACTIVE_WORKFLOW_STATUSES,
  currentTask,
  currentWorkerRun,
  formatRelativeTime,
  openIntervention,
  interventionAction,
  interventionDetailsHref,
} from "@/lib/core-ui/workflows";
import { isSupabaseAdminConfigured } from "@/lib/supabase/env";

import { createBusiness, startSyntheticWorkflow } from "./actions";

export const dynamic = "force-dynamic";

type DashboardPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const messages: Record<string, string> = {
  "business-created": "Business created.",
  "review-approved": "Decision recorded. The workflow is resuming.",
  "review-failed": "Failure decision recorded. The workflow is closing safely.",
  "workflow-duplicate-prevented":
    "A duplicate launch was prevented. The existing workflow remains authoritative.",
  "workflow-started": "Durable workflow started.",
};

const errors: Record<string, string> = {
  "business-create-failed": "The Business could not be created.",
  "business-not-found": "The selected Business is unavailable.",
  "invalid-business-name": "Use a Business name between 1 and 120 characters.",
  "invalid-review-decision": "The review decision was invalid.",
  "invalid-workflow-launch": "The workflow launch request was invalid.",
  "review-not-open": "That review is no longer open.",
  "review-resume-failed": "The workflow could not be resumed.",
  "workflow-launch-failed": "The durable workflow could not be launched.",
  "workflow-reservation-failed": "The workflow launch could not be reserved.",
  "workflow-runtime-not-configured": "The durable workflow runtime is not configured.",
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const context = await requireOwnerUiContext();
  const collection = await loadWorkflowCollection(context, { limit: 50 });
  const query = await searchParams;
  const message = messages[first(query.message) ?? ""];
  const error = errors[first(query.error) ?? ""];
  const runtimeReady = isSupabaseAdminConfigured();

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
  const workerRunsByRun = new Map<string, typeof collection.workerRuns>();
  const artifactsByRun = new Map<string, typeof collection.artifacts>();

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
    const entries = workerRunsByRun.get(workerRun.workflow_run_id) ?? [];
    entries.push(workerRun);
    workerRunsByRun.set(workerRun.workflow_run_id, entries);
  }
  for (const artifact of collection.artifacts) {
    if (!artifact.workflow_run_id) continue;
    const entries = artifactsByRun.get(artifact.workflow_run_id) ?? [];
    entries.push(artifact);
    artifactsByRun.set(artifact.workflow_run_id, entries);
  }

  const activeRuns = collection.runs.filter((run) => ACTIVE_WORKFLOW_STATUSES.has(run.status));
  const workUnavailable = collection.errors.length > 0 || context.businessesUnavailable === true;
  const workingRuns = collection.runs.filter((run) => run.status === "running");
  const completedRuns = collection.runs.filter((run) => run.status === "completed");
  const openInterventions = collection.interventions.filter(
    (intervention) => intervention.status === "open" && intervention.workflow_run_id,
  );
  const latestRuns = activeRuns.length ? activeRuns.slice(0, 3) : collection.runs.slice(0, 3);
  const latestEvents = collection.events.slice(0, 8);
  const firstDecision = openInterventions[0];
  const decisionRun = firstDecision ? collection.runs.find((run) => run.id === firstDecision.workflow_run_id) : undefined;
  const decisionAction = firstDecision ? interventionAction(firstDecision, decisionRun, decisionRun ? definitionById.get(decisionRun.workflow_definition_id) : undefined) : null;
  const nextHref = workUnavailable ? "/dashboard/workflows" : firstDecision
    ? decisionAction?.kind === "link" ? decisionAction.href : interventionDetailsHref(firstDecision)
    : context.needsYouCount || context.needsYouUnavailable ? "/dashboard/needs-you" : activeRuns[0] ? `/dashboard/workflows/${activeRuns[0].id}` : context.businesses.length ? "/dashboard/products#discovery-goal" : "#create-business";
  const nextLabel = workUnavailable ? "Check work status" : firstDecision ? decisionAction?.kind === "link" ? decisionAction.label : "Review next decision" : context.needsYouCount || context.needsYouUnavailable ? "Review decisions" : activeRuns.length ? "Open current work" : context.businesses.length ? "Start a research goal" : "Create your workspace";

  return (
    <AppShell active="dashboard" context={context}>
      <PageHeader
        actions={
          <Link className="coreButton coreButton-secondary" href="/dashboard/workflows">
            View all workflows
          </Link>
        }
        description="See what Agent Labs is doing, what changed, and whether anything needs your decision."
        eyebrow="Overview"
        title="Control centre"
      />

      {message ? <p className="coreNotice coreNotice-success" role="status">{message}</p> : null}
      {error ? <p className="coreNotice coreNotice-danger" role="alert">{error}</p> : null}
      {collection.errors.length ? (
        <p className="coreNotice coreNotice-danger" role="alert">
          Some durable workflow records could not be loaded.
        </p>
      ) : null}

      <section className="overviewHero">
        <div>
          <p className="coreEyebrow">Private owner workspace</p>
          <h2>
            {workUnavailable
              ? "Work status could not be confirmed."
              : context.needsYouUnavailable
              ? "Your decisions need a fresh check."
              : context.needsYouCount
              ? `${context.needsYouCount} decision${context.needsYouCount === 1 ? " needs" : "s need"} your attention.`
              : workingRuns.length
                ? `${workingRuns.length} workflow${workingRuns.length === 1 ? " is" : "s are"} working.`
                : activeRuns.length
                  ? "Your work is waiting for its next step."
                : "Agent Labs is ready for the next workflow."}
          </h2>
          <p>
            {workUnavailable
              ? "Some saved records are unavailable. Check the existing work before starting another run."
              : activeRuns.length
              ? `The latest durable activity was ${formatRelativeTime(collection.events[0]?.occurred_at)}.`
              : "Start with a bounded research goal. Review the supported scope and allowance before any work begins."}
          </p>
          <Link className="coreButton coreButton-primary" href={nextHref}>{nextLabel}</Link>
        </div>
        <div className="overviewHeroStatus">
          <span className={runtimeReady ? "systemPulse systemPulse-ready" : "systemPulse"} />
          <div>
            <strong>{runtimeReady ? "Core connection configured" : "Core connection not configured"}</strong>
            <small>Configuration only · execution shown per run</small>
          </div>
        </div>
      </section>

      <section className="coreMetricGrid" aria-label="Agent Labs summary">
        {[
          ["Working", workUnavailable ? "Unknown" : workingRuns.length, "workflow"],
          ["Needs You", context.needsYouUnavailable ? "Unknown" : context.needsYouCount, "needs-you"],
          ["Completed", workUnavailable ? "Unknown" : completedRuns.length, "history"],
          ["Artifacts", workUnavailable ? "Unknown" : collection.artifacts.length, "artifacts"],
        ].map(([label, value, icon]) => (
          <article className="coreMetricCard" key={String(label)}>
            <span><CoreIcon name={icon as "workflow" | "needs-you" | "history" | "artifacts"} /></span>
            <div><small>{label}</small><strong>{value}</strong></div>
          </article>
        ))}
      </section>

      {openInterventions.length ? (
        <section className="dashboardSection dashboardSection-attention">
          <div className="sectionTitleRow">
            <div><p className="coreEyebrow">Needs You</p><h2>Waiting for your decision</h2></div>
            <Link href="/dashboard/needs-you">Open queue →</Link>
          </div>
          <div className="needsYouStack">
            {openInterventions.slice(0, 2).map((intervention) => {
              const run = collection.runs.find((entry) => entry.id === intervention.workflow_run_id);
              const definition = run ? definitionById.get(run.workflow_definition_id) : undefined;
              return (
                <NeedsYouCard
                  businessName={businessById.get(intervention.business_id)?.name}
                  intervention={intervention}
                  definition={definition}
                  run={run}
                  key={intervention.id}
                  returnTo="/dashboard"
                  workflowName={definition?.name}
                />
              );
            })}
          </div>
        </section>
      ) : null}

      <div className="dashboardColumns">
        <section className="dashboardSection">
          <div className="sectionTitleRow">
            <div>
              <p className="coreEyebrow">Current work</p>
              <h2>{activeRuns.length ? "Active workflows" : "Latest workflows"}</h2>
            </div>
            <Link href="/dashboard/workflows">All workflows →</Link>
          </div>

          {latestRuns.length ? (
            <div className="workflowCardStack">
              {latestRuns.map((run) => {
                const workerRun = currentWorkerRun(workerRunsByRun.get(run.id) ?? []);
                return (
                  <WorkflowListCard
                    unavailable={workUnavailable}
                    artifactCount={(artifactsByRun.get(run.id) ?? []).length}
                    business={businessById.get(run.business_id)}
                    definition={definitionById.get(run.workflow_definition_id)}
                    events={eventsByRun.get(run.id) ?? []}
                    intervention={openIntervention(interventionsByRun.get(run.id) ?? [])}
                    key={run.id}
                    run={run}
                    stages={stagesByRun.get(run.id) ?? []}
                    task={currentTask(tasksByRun.get(run.id) ?? [])}
                    workerRun={workerRun}
                    workerDefinition={
                      workerRun ? workerDefinitionById.get(workerRun.worker_definition_id) : null
                    }
                  />
                );
              })}
            </div>
          ) : (
            <EmptyPanel icon="workflow" title={workUnavailable ? "Work records unavailable" : "No workflow activity yet"}>
              <p>{workUnavailable ? "Existing runs and outputs may still exist. Check again before starting more work." : "Start a supported research goal to see its state update here."}</p>
            </EmptyPanel>
          )}
        </section>

        <ActivityFeed events={latestEvents} unavailable={workUnavailable} />
      </div>

      <div className="dashboardColumns dashboardColumns-lower">
        <section className="dashboardSection">
          <div className="sectionTitleRow">
            <div><p className="coreEyebrow">Businesses</p><h2>Workspaces</h2></div>
            <span className="coreCount">{context.businessesUnavailable ? "Unknown" : context.businesses.length}</span>
          </div>
          {context.businesses.length ? (
            <div className="businessWorkspaceList">
              {context.businesses.map((business) => {
                const businessRuns = collection.runs.filter((run) => run.business_id === business.id);
                const activeCount = businessRuns.filter((run) => ACTIVE_WORKFLOW_STATUSES.has(run.status)).length;
                return (
                  <article key={business.id}>
                    <span className="businessGlyph"><CoreIcon name="building" /></span>
                    <div>
                      <h3>{business.name}</h3>
                      <p>{activeCount} active · {businessRuns.length} total workflows</p>
                    </div>
                    <form action={startSyntheticWorkflow}>
                      <input name="businessId" type="hidden" value={business.id} />
                      <input name="idempotencyKey" type="hidden" value={`stage7:${crypto.randomUUID()}`} />
                      <input name="launchNonce" type="hidden" value={crypto.randomUUID()} />
                      <button className="coreButton coreButton-secondary coreButton-small" disabled={!runtimeReady} type="submit">
                        Run workflow proof
                      </button>
                    </form>
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyPanel icon="building" title={context.businessesUnavailable ? "Business records unavailable" : "No Business yet"}>
              <p>{context.businessesUnavailable ? "Your existing workspaces could not be checked. Please reload before creating another." : "Create your first private workspace."}</p>
            </EmptyPanel>
          )}
        </section>

        <section className="dashboardSection createBusinessPanel" id="create-business">
          <div><p className="coreEyebrow">New workspace</p><h2>Create a Business</h2></div>
          <p>Businesses keep workflows, artifacts, accounts, and future packs separated.</p>
          <form action={createBusiness} className="coreForm">
            <label htmlFor="business-name">Business name</label>
            <input id="business-name" maxLength={120} name="name" placeholder="Business name" required type="text" />
            <button className="coreButton coreButton-primary" disabled={context.businessesUnavailable} type="submit">Create Business</button>
          </form>
        </section>
      </div>

      {completedRuns.length ? (
        <section className="dashboardSection dashboardHistoryPreview">
          <div className="sectionTitleRow">
            <div><p className="coreEyebrow">Recent outcomes</p><h2>History</h2></div>
            <Link href="/dashboard/history">Full history →</Link>
          </div>
          <div className="historyList">
            {completedRuns.slice(0, 4).map((run) => (
              <HistoryRow
                business={businessById.get(run.business_id)}
                definition={definitionById.get(run.workflow_definition_id)}
                key={run.id}
                run={run}
              />
            ))}
          </div>
        </section>
      ) : null}
    </AppShell>
  );
}
