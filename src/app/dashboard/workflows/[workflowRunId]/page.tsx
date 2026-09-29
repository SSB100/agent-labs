import Link from "next/link";
import { notFound } from "next/navigation";

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
import { loadBrowserWorkflowData } from "@/lib/core-ui/browser";
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
} from "@/lib/core-ui/workflows";

export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type WorkflowPageProps = {
  params: Promise<{ workflowRunId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const messages: Record<string, string> = {
  "browser-control-returned": "Browser control returned. Automation is reconnecting.",
  "browser-control-taken": "Human control enabled in the Live Browser workspace.",
  "browser-duplicate-prevented": "The existing browser workflow remains authoritative.",
  "browser-workflow-started": "Remote browser workflow started. The live viewer will appear automatically.",
  "review-approved": "Decision recorded. The durable workflow is resuming.",
  "review-failed": "Failure decision recorded. The workflow is closing safely.",
  "workflow-duplicate-prevented": "The existing workflow remains authoritative.",
  "workflow-started": "Durable workflow started. Live activity will appear below.",
};

const errors: Record<string, string> = {
  "browser-control-resume-failed": "The browser workflow could not resume.",
  "browser-intervention-not-open": "That browser control request is no longer open.",
  "browser-provider-invalid": "The selected browser provider is not registered.",
  "browser-session-not-found": "The browser session is unavailable.",
  "browser-workflow-launch-failed": "The remote browser workflow could not start.",
  "invalid-browser-control-decision": "The browser control decision was invalid.",
  "invalid-review-decision": "The review decision was invalid.",
  "review-not-open": "That review is no longer open.",
  "review-resume-failed": "The workflow could not be resumed.",
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function WorkflowPage({ params, searchParams }: WorkflowPageProps) {
  const { workflowRunId } = await params;
  if (!UUID_PATTERN.test(workflowRunId)) notFound();

  const context = await requireOwnerUiContext();
  const [detail, browser] = await Promise.all([
    loadWorkflowDetail(context, workflowRunId),
    loadBrowserWorkflowData(context.supabase, workflowRunId),
  ]);
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
  const event = latestEvent(detail.events);
  const workflowName = detail.definition?.name ?? "Workflow";
  const businessName = detail.business?.name ?? "Business";

  return (
    <AppShell
      active="workflows"
      context={context}
      workflowRunId={detail.run.id}
    >
      <div className="workflowBreadcrumbs">
        <Link href="/dashboard/workflows">Workflows</Link>
        <span>/</span>
        <span>{workflowName}</span>
      </div>

      <PageHeader
        actions={
          <div className="workflowHeaderActions">
            <StatusPill status={detail.run.status} />
            <Link className="coreButton coreButton-secondary" href="/dashboard/workflows">
              Back to workflows
            </Link>
          </div>
        }
        description={`${businessName} · Version ${detail.definition?.version ?? "1.0.0"}`}
        eyebrow="Workflow"
        title={workflowName}
      />

      {message ? <p className="coreNotice coreNotice-success" role="status">{message}</p> : null}
      {error ? <p className="coreNotice coreNotice-danger" role="alert">{error}</p> : null}
      {browser.errors.length ? (
        <p className="coreNotice coreNotice-danger" role="alert">
          Some browser session details could not be loaded.
        </p>
      ) : null}

      <section className="workflowProgressPanel">
        <div className="workflowProgressTop">
          <div>
            <p className="coreEyebrow">Current state</p>
            <h2>{humanize(detail.run.current_stage_key, statusLabel(detail.run.status))}</h2>
            <p>{detail.definition?.description ?? "Durable Agent Labs workflow execution."}</p>
          </div>
          <div className="workflowRunIdentity">
            <span>Run</span>
            <code>{detail.run.id}</code>
          </div>
        </div>
        <WorkflowTimeline
          definition={detail.definition ?? undefined}
          run={detail.run}
          stages={detail.stages}
        />
      </section>

      <ExecutionSnapshot
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
          <NeedsYouCard
            businessName={businessName}
            browserSessionId={browser.session?.id ?? null}
            intervention={intervention}
            returnTo={`/dashboard/workflows/${detail.run.id}`}
            workflowName={workflowName}
          />
        </section>
      ) : null}

      <div className="workflowWorkspaceGrid">
        <WorkflowWorkspace
          artifacts={detail.artifacts}
          browser={
            browser.session
              ? {
                  session: browser.session,
                  providerName: browser.provider?.name ?? humanize(browser.provider?.provider_key),
                  liveViewUrl: browser.liveViewUrl,
                  replayUrl: browser.replayUrl,
                  intervention,
                  workflowRunId: detail.run.id,
                }
              : null
          }
        />
        <ActivityFeed events={detail.events} />
      </div>

      <section className="workflowDetailGrid">
        <article className="workflowDetailPanel">
          <div className="workspacePanelHeader">
            <div><p className="coreEyebrow">Execution context</p><h2>Task and worker</h2></div>
            <CoreIcon name="workflow" />
          </div>
          <dl className="detailList">
            <div><dt>Worker</dt><dd>{workerDefinition?.name ?? (browser.session ? "Browser runtime" : "Workflow runtime")}</dd></div>
            <div><dt>Worker status</dt><dd>{workerRun ? statusLabel(workerRun.status) : browser.session ? humanize(browser.session.status) : "No Worker Run"}</dd></div>
            <div><dt>Task</dt><dd>{task?.objective ?? (browser.session ? "Qualify remote browser session lifecycle" : "No Task Contract for this stage")}</dd></div>
            <div>
              <dt>Capabilities</dt>
              <dd>{task?.permitted_capabilities.length ? task.permitted_capabilities.join(", ") : browser.session ? "browser.observe, browser.interact, browser.upload, browser.takeover" : "None exposed"}</dd>
            </div>
            <div>
              <dt>Knowledge</dt>
              <dd>{task?.required_knowledge.length ? task.required_knowledge.join(", ") : "No knowledge requested"}</dd>
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
            {browser.session ? <div><dt>Browser provider</dt><dd>{browser.provider?.name ?? "Provider"}</dd></div> : null}
            {browser.session ? <div><dt>Persistent identity</dt><dd>{browser.identity?.label ?? "Business browser identity"}</dd></div> : null}
            <div><dt>Started</dt><dd>{formatDateTime(detail.run.started_at ?? detail.run.created_at)}</dd></div>
            <div><dt>Updated</dt><dd>{formatDateTime(detail.run.updated_at)}</dd></div>
            <div><dt>Completed</dt><dd>{formatDateTime(detail.run.completed_at)}</dd></div>
          </dl>
        </article>
      </section>
    </AppShell>
  );
}
