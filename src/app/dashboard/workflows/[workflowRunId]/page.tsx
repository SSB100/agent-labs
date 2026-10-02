import Link from "next/link";
import { WorkContext, workDisplayTitle, researchGoalFromRecords } from "@/components/guided/work-context";
import { notFound } from "next/navigation";

import type {
  BrowserSessionEventRecord,
  BrowserSessionRecord,
} from "@/browser/ui";
import { BrowserInterventionCard } from "@/components/stage8/browser-intervention";
import {
  AppShell,
  PageHeader,
  StatusPill,
} from "@/components/stage7/app-shell";
import {
  ActivityFeed,
  ExecutionSnapshot,
  NeedsYouCard,
  WorkflowTimeline,
} from "@/components/stage7/workflow-visuals";
import { WorkflowWorkspace } from "@/components/stage7/workflow-workspace";
import { CoreIcon } from "@/components/stage7/icons";
import { loadProductWorkspace } from "@/products/data";
import {
  loadWorkflowDetail,
  requireOwnerUiContext,
} from "@/lib/core-ui/data";
import {
  currentTask,
  currentWorkerRun,
  formatDateTime,
  humanize,
  latestEvent,
  openIntervention,
  statusLabel,
  stageLabel,
} from "@/lib/core-ui/workflows";

export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BROWSER_SESSION_SELECT =
  "id, business_id, workflow_run_id, provider_definition_id, browser_identity_id, provider_session_id, status, control_mode, live_view_status, replay_status, current_url, page_title, region, browser_mode, metadata, failure, started_at, released_at, created_at, updated_at";
const BROWSER_EVENT_SELECT =
  "id, business_id, workflow_run_id, browser_session_id, event_type, control_mode, payload, occurred_at, created_at";

type WorkflowPageProps = {
  params: Promise<{ workflowRunId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const messages: Record<string, string> = {
  "browser-control-returned": "Control returned. Agent Labs is reconnecting automation.",
  "browser-control-taken": "Takeover approved. The live browser is now interactive.",
  "browser-duplicate-prevented": "The existing browser qualification remains authoritative.",
  "browser-workflow-started": "Remote browser qualification started.",
  "browser-planner-workflow-started": "Browser Planner qualification started.",
  "browser-planner-duplicate-prevented": "The existing Browser Planner qualification remains authoritative.",
  "review-approved": "Decision recorded. The durable workflow is resuming.",
  "review-failed": "Failure decision recorded. The workflow is closing safely.",
  "workflow-duplicate-prevented": "The existing workflow remains authoritative.",
  "workflow-started": "Durable workflow started. Live activity will appear below.",
};

const errors: Record<string, string> = {
  "browser-control-not-open": "That browser-control request is no longer open.",
  "browser-control-resume-failed": "The browser workflow could not resume.",
  "browser-launch-failed": "The remote browser workflow could not launch.",
  "browser-planner-launch-failed": "The Browser Planner workflow could not launch.",
  "invalid-browser-control": "The browser-control request was invalid.",
  "invalid-review-decision": "The review decision was invalid.",
  "review-not-open": "That review is no longer open.",
  "review-resume-failed": "The workflow could not be resumed.",
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function record<T>(value: unknown): T | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as T)
    : null;
}

function records<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export default async function WorkflowPage({ params, searchParams }: WorkflowPageProps) {
  const { workflowRunId } = await params;
  if (!UUID_PATTERN.test(workflowRunId)) notFound();

  const context = await requireOwnerUiContext();
  const [detail, browserResult, browserEventResult, productData] = await Promise.all([
    loadWorkflowDetail(context, workflowRunId),
    context.supabase
      .from("browser_sessions")
      .select(BROWSER_SESSION_SELECT)
      .eq("workflow_run_id", workflowRunId)
      .maybeSingle(),
    context.supabase
      .from("browser_session_events")
      .select(BROWSER_EVENT_SELECT)
      .eq("workflow_run_id", workflowRunId)
      .order("occurred_at", { ascending: false })
      .limit(80),
    loadProductWorkspace(context, workflowRunId),
  ]);
  const browserSession = record<BrowserSessionRecord>(browserResult.data);
  const browserEvents = records<BrowserSessionEventRecord>(browserEventResult.data);
  const query = await searchParams;
  const message = messages[first(query.message) ?? ""];
  const error = errors[first(query.error) ?? ""];

  const task = currentTask(detail.tasks);
  const workerRun = currentWorkerRun(detail.workerRuns);
  const workerDefinition = workerRun
    ? detail.workerDefinitions.find((worker) => worker.id === workerRun.worker_definition_id) ?? null
    : task
      ? detail.workerDefinitions.find((worker) => worker.id === task.worker_definition_id) ?? null
      : null;
  const intervention = openIntervention(detail.interventions);
  const browserIntervention =
    intervention && ["browser_takeover", "browser_return_control"].includes(intervention.intervention_type)
      ? intervention
      : null;
  const detailUnavailable = detail.errors.length > 0;
  const browserUnavailable = Boolean(browserResult.error || browserEventResult.error);
  const event = latestEvent(detail.events);
  const workflowName = workDisplayTitle(detail.definition);
  const businessName = detail.business?.name ?? "Business";
  const returnTo = `/dashboard/workflows/${detail.run.id}`;

  return (
    <AppShell
      active="workflows"
      context={context}
      workflowRunId={detail.run.id}
      navigationBusinessId={detail.run.business_id}
    >
      <div className="workflowBreadcrumbs">
        <Link href={`/dashboard?view=work&business=${detail.run.business_id}`}>Work</Link>
        <span>/</span>
        <span>{workflowName}</span>
      </div>

      <PageHeader
        actions={
          <div className="workflowHeaderActions">
            <StatusPill status={detail.run.status} />
            <Link className="coreButton coreButton-secondary" href={`/dashboard?view=work&business=${detail.run.business_id}`}>
              Back to work
            </Link>
          </div>
        }
        description={`${businessName} · Version ${detail.definition?.version ?? "1.0.0"}`}
        eyebrow="Saved work"
        title={workflowName}
      />

      {message ? <p className="coreNotice coreNotice-success" role="status">{message}</p> : null}
      {error ? <p className="coreNotice coreNotice-danger" role="alert">{error}</p> : null}

      {detailUnavailable ? <p className="coreNotice coreNotice-danger" role="alert">Some related workflow records could not be loaded. Stage, worker, decision and output completeness cannot be confirmed. Existing records may still need attention; no new action is implied.</p> : null}
      {browserUnavailable ? <p className="coreNotice coreNotice-danger" role="alert">Browser-session records could not be checked. This does not confirm that no browser session exists.</p> : null}

      <WorkContext run={detail.run} definition={detail.definition} goal={researchGoalFromRecords(detail.run, productData.experiments, detail.artifacts)} />
      <section className="workflowProgressPanel">
        <div className="workflowProgressTop">
          <div>
            <p className="coreEyebrow">Current state</p>
            <h2>{detail.run.current_stage_key ? stageLabel(detail.run.current_stage_key) : statusLabel(detail.run.status)}</h2>
            <p>{detail.definition?.description ?? "Durable Agent Labs workflow execution."}</p>
          </div>
          <div className="workflowRunIdentity">
            <span>Run</span>
            <code>{detail.run.id}</code>
          </div>
        </div>
        <WorkflowTimeline
          unavailable={detailUnavailable}
          definition={detail.definition ?? undefined}
          run={detail.run}
          stages={detail.stages}
        />
      </section>

      <ExecutionSnapshot
        unavailable={detailUnavailable}
        stages={detail.stages}
        definition={detail.definition ?? undefined}
        event={event}
        intervention={intervention}
        run={detail.run}
        task={task}
        workerDefinition={workerDefinition}
        workerRun={workerRun}
      />

      {intervention ? (
        <section className="workflowNeedsYou">
          {browserIntervention ? (
            <BrowserInterventionCard
              businessName={businessName}
              intervention={browserIntervention}
              returnTo={returnTo}
              workflowName={workflowName}
            />
          ) : (
            <NeedsYouCard
              businessName={businessName}
              intervention={intervention}
              definition={detail.definition ?? undefined}
              run={detail.run}
              returnTo={returnTo}
              workflowName={workflowName}
            />
          )}
        </section>
      ) : null}

      <div className="workflowWorkspaceGrid">
        <WorkflowWorkspace
          artifacts={detail.artifacts}
          browserEvents={browserEvents}
          browserIntervention={browserIntervention}
          browserSession={browserSession}
          productData={productData}
          initialWorkspace={first(query.workspace)}
          returnTo={returnTo}
        />
        <ActivityFeed events={detail.events} unavailable={detailUnavailable} />
      </div>

      <section className="workflowDetailGrid">
        <article className="workflowDetailPanel">
          <div className="workspacePanelHeader">
            <div><p className="coreEyebrow">Execution context</p><h2>Task and worker</h2></div>
            <CoreIcon name="workflow" />
          </div>
          <dl className="detailList">
            <div><dt>Worker</dt><dd>{workerDefinition?.name ?? (detailUnavailable ? "Unavailable" : browserSession ? "Browser runtime" : "Workflow runtime")}</dd></div>
            <div><dt>Worker status</dt><dd>{workerRun ? statusLabel(workerRun.status) : browserSession ? humanize(browserSession.status) : detailUnavailable ? "Unavailable" : "No Worker Run"}</dd></div>
            <div><dt>Task</dt><dd>{task?.objective ?? (browserSession ? "Qualify the remote browser provider boundary" : detailUnavailable ? "Unavailable" : "No Task Contract for this stage")}</dd></div>
            <div>
              <dt>Capabilities</dt>
              <dd>{task?.permitted_capabilities.length ? task.permitted_capabilities.join(", ") : browserSession ? "browser.observe, browser.interact, browser.upload, browser.takeover" : detailUnavailable ? "Unavailable" : "None exposed"}</dd>
            </div>
            <div>
              <dt>Browser identity</dt>
              <dd>{browserSession ? browserSession.browser_identity_id : browserUnavailable ? "Unavailable" : "Not attached"}</dd>
            </div>
          </dl>
        </article>

        <article className="workflowDetailPanel">
          <div className="workspacePanelHeader">
            <div><p className="coreEyebrow">Durable identity</p><h2>Run details</h2></div>
            <CoreIcon name="activity" />
          </div>
          <dl className="detailList">
            <div><dt>Business</dt><dd>{businessName}</dd></div>
            <div><dt>Runtime</dt><dd>{detail.run.runtime_provider ?? "Pending"}</dd></div>
            <div><dt>Runtime run</dt><dd><code>{detail.run.runtime_run_id ?? "Not assigned"}</code></dd></div>
            <div><dt>Browser session</dt><dd><code>{browserSession?.provider_session_id ?? (browserUnavailable ? "Unavailable" : "Not attached")}</code></dd></div>
            <div><dt>Started</dt><dd>{formatDateTime(detail.run.started_at ?? detail.run.created_at)}</dd></div>
            <div><dt>Completed</dt><dd>{formatDateTime(detail.run.completed_at)}</dd></div>
          </dl>
        </article>
      </section>
    </AppShell>
  );
}
