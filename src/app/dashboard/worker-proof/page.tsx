import { AppShell } from "@/components/stage7/app-shell";
import { ConsoleRetainedWorkspace, ConsoleRecentRows } from "@/components/console/console-retained-workspace";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { WORKER_PACK_RUNTIME_WORKFLOW_DEFINITION_ID } from "../../../workflows/worker-pack-runtime";

import { startGenericResearcherProof } from "./actions";

export const dynamic = "force-dynamic";

type WorkerProofPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type Business = {
  id: string;
  name: string;
};

type WorkflowRun = {
  business_id: string;
  completed_at: string | null;
  created_at: string;
  current_stage_key: string | null;
  id: string;
  runtime_run_id: string | null;
  started_at: string | null;
  status: string;
};

type StageRun = {
  attempt: number;
  id: string;
  sequence: number;
  stage_key: string;
  status: string;
  workflow_run_id: string;
};

type TaskContract = {
  id: string;
  input_artifact_ids: string[];
  non_goals: string[];
  objective: string;
  permitted_capabilities: string[];
  required_knowledge: string[];
  status: string;
  workflow_run_id: string;
};

type WorkerRun = {
  completed_at: string | null;
  execution_metadata: Record<string, unknown>;
  failure: Record<string, unknown>;
  id: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  started_at: string | null;
  status: string;
  task_contract_id: string;
  workflow_run_id: string;
};

type WorkflowEvent = {
  event_type: string;
  id: string;
  occurred_at: string;
  workflow_run_id: string | null;
};

const messages: Record<string, string> = {
  "worker-proof-duplicate-prevented":
    "A duplicate worker launch was prevented. The existing run remains authoritative.",
  "worker-proof-started": "Generic Researcher Worker Pack proof started.",
};

const errors: Record<string, string> = {
  "business-not-found": "The selected Business is unavailable.",
  "invalid-worker-proof-launch": "The worker proof launch request was invalid.",
  "worker-proof-launch-failed": "The Worker Pack proof could not be launched.",
  "worker-proof-reservation-failed": "The Worker Pack proof could not be reserved.",
};

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function humanize(value: string | null) {
  if (!value) {
    return "Queued";
  }

  return value
    .split(/[._-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value: string | null) {
  if (!value) {
    return "Not yet";
  }

  return new Intl.DateTimeFormat("en-NZ", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function nestedRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export default async function WorkerProofPage({ searchParams }: WorkerProofPageProps) {
  const context = await requireOwnerUiContext();
  const supabase = context.supabase;
  const query = await searchParams;
  const selectedBusinessId = firstValue(query.business);
  if (query.business && (Array.isArray(query.business) || !context.businesses.some(b=>b.id===selectedBusinessId))) notFound();
  const exactRunId = firstValue(query.run);
  if (query.run && (Array.isArray(query.run) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(exactRunId ?? ""))) notFound();

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (claimsError || !userId) {
    redirect("/login?error=session-required");
  }

  const { data: businessData, error: businessError } = await supabase
    .from("businesses")
    .select("id, name")
    .eq("owner_user_id", userId)
    .order("created_at", { ascending: false });

  const businesses = ((businessData ?? []) as Business[]).filter(b=>!selectedBusinessId || b.id===selectedBusinessId);
  const businessIds = businesses.map((business) => business.id);
  let workflowRuns: WorkflowRun[] = [];
  let stages: StageRun[] = [];
  let taskContracts: TaskContract[] = [];
  let workerRuns: WorkerRun[] = [];
  let events: WorkflowEvent[] = [];
  let historyError = false;

  if (businessIds.length > 0) {
    let runRead = supabase
      .from("workflow_runs")
      .select(
        "id, business_id, status, current_stage_key, runtime_run_id, started_at, completed_at, created_at",
      )
      .eq("workflow_definition_id", WORKER_PACK_RUNTIME_WORKFLOW_DEFINITION_ID)
      .in("business_id", businessIds)
      .order("created_at", { ascending: false })
      .limit(exactRunId ? 2 : 30);
    if (exactRunId) runRead = runRead.eq("id",exactRunId);
    const {data:runData,error:runError} = await runRead;
    if (exactRunId && !runError && !runData?.length) notFound();

    workflowRuns = (runData ?? []) as WorkflowRun[];
    historyError = Boolean(runError);

    const runIds = workflowRuns.map((run) => run.id);
    if (runIds.length > 0) {
      const [stageResult, taskResult, workerResult, eventResult] = await Promise.all([
        supabase
          .from("workflow_stage_runs")
          .select("id, workflow_run_id, stage_key, sequence, attempt, status")
          .in("workflow_run_id", runIds)
          .order("sequence", { ascending: true }),
        supabase
          .from("task_contracts")
          .select(
            "id, workflow_run_id, status, objective, input_artifact_ids, permitted_capabilities, required_knowledge, non_goals",
          )
          .in("workflow_run_id", runIds),
        supabase
          .from("worker_runs")
          .select(
            "id, workflow_run_id, task_contract_id, status, input, output, failure, execution_metadata, started_at, completed_at",
          )
          .in("workflow_run_id", runIds),
        supabase
          .from("events")
          .select("id, workflow_run_id, event_type, occurred_at")
          .in("workflow_run_id", runIds)
          .order("occurred_at", { ascending: false })
          .limit(120),
      ]);

      stages = (stageResult.data ?? []) as StageRun[];
      taskContracts = (taskResult.data ?? []) as TaskContract[];
      workerRuns = (workerResult.data ?? []) as WorkerRun[];
      events = (eventResult.data ?? []) as WorkflowEvent[];
      historyError ||= Boolean(
        stageResult.error || taskResult.error || workerResult.error || eventResult.error,
      );
    }
  }

  const businessById = new Map(businesses.map((business) => [business.id, business]));
  const stagesByRun = new Map<string, StageRun[]>();
  for (const stage of stages) {
    const current = stagesByRun.get(stage.workflow_run_id) ?? [];
    current.push(stage);
    stagesByRun.set(stage.workflow_run_id, current);
  }
  const taskByRun = new Map(taskContracts.map((task) => [task.workflow_run_id, task]));
  const workerByRun = new Map(workerRuns.map((worker) => [worker.workflow_run_id, worker]));
  const eventsByRun = new Map<string, WorkflowEvent[]>();
  for (const event of events) {
    if (!event.workflow_run_id) {
      continue;
    }
    const current = eventsByRun.get(event.workflow_run_id) ?? [];
    current.push(event);
    eventsByRun.set(event.workflow_run_id, current);
  }

  const message = messages[firstValue(query.message) ?? ""];
  const error = errors[firstValue(query.error) ?? ""];
  const completedCount = workflowRuns.filter((run) => run.status === "completed").length;
  const failedCount = workflowRuns.filter((run) => run.status === "failed").length;

  return (<AppShell active="settings" toolDestination="worker-proof" context={context} navigationBusinessId={selectedBusinessId}><ConsoleRetainedWorkspace ownerId={context.userId} notice={<p className="coreNotice">Recent loaded records only. Earlier history and complete totals remain pending R06.</p>} header={<><header className="workspaceHeader">
          <div className="workspaceTitle">
            <p>Stage 4</p>
            <h1>Worker Pack runtime</h1>
          </div>
          <Link className="ghostButton" href={`/dashboard?view=overview${selectedBusinessId ? `&business=${selectedBusinessId}` : ""}`}>
            Back to control centre
          </Link>
        </header>
{message ? (
          <p className="notice success" role="status">
            {message}
          </p>
        ) : null}
{error ? (
          <p className="notice error" role="alert">
            {error}
          </p>
        ) : null}
{businessError || historyError ? (
          <p className="notice error" role="alert">
            Some Worker Pack state could not be loaded.
          </p>
        ) : null}</>} panels={[{ id: "history", label: "Saved proofs", content: <><section className="summaryGrid" aria-label="Worker runtime summary">
          {[
            { label: "Businesses", value: businesses.length },
            { label: "Worker proofs", value: workflowRuns.length },
            { label: "Completed", value: completedCount },
            { label: "Classified failures", value: failedCount },
          ].map((item) => (
            <article className="summaryCard" key={item.label}>
              <span className="summaryLabel">{item.label}</span>
              <strong className="summaryValue">{item.value}</strong>
            </article>
          ))}
        </section>
<section className="operationsPanel" aria-labelledby="worker-history-heading">
          <div className="panelHeading workflowHeading">
            <div>
              <p className="panelLabel">Durable specialist execution</p>
              <h2 id="worker-history-heading">Worker proof history</h2>
            </div>
            <span className="countBadge">{workflowRuns.length}</span>
          </div>

          {workflowRuns.length ? (
            <div className="workflowList">
              <ConsoleRecentRows label="Recent loaded worker-proof records" rows={workflowRuns.map((run) => {
                const task = taskByRun.get(run.id);
                const worker = workerByRun.get(run.id);
                const runStages = stagesByRun.get(run.id) ?? [];
                const runEvents = (eventsByRun.get(run.id) ?? []).slice(0, 8);
                const receipt = nestedRecord(worker?.execution_metadata.receipt);
                const failureCategory =
                  typeof worker?.failure.category === "string"
                    ? worker.failure.category
                    : null;
                const outputSummary =
                  typeof worker?.output.summary === "string" ? worker.output.summary : null;
                const evidenceCount =
                  typeof worker?.output.evidenceCount === "number"
                    ? worker.output.evidenceCount
                    : null;
                const inputArtifacts = task?.input_artifact_ids.length ?? 0;
                const contextKeys = worker ? Object.keys(worker.input).sort().join(", ") : "Pending";

                return (
                  <article className="workflowCard" key={run.id}>
                    <div className="workflowCardHeader">
                      <div>
                        <p className="workflowBusiness">
                          {businessById.get(run.business_id)?.name ?? "Business"}
                        </p>
                        <h3>Generic Researcher fixture</h3>
                        <p>
                          Started {formatDate(run.started_at ?? run.created_at)} · Current stage{" "}
                          {humanize(run.current_stage_key)}
                        </p>
                      </div>
                      <span className={`workflowStatus status-${run.status}`}>
                        {humanize(run.status)}
                      </span>
                    </div>

                    <ol className="stageTimeline" aria-label="Worker proof stages">
                      {runStages.map((stage) => (
                        <li className={`stageState stage-${stage.status}`} key={stage.id}>
                          <span className="stageMarker" aria-hidden="true" />
                          <div>
                            <strong>{humanize(stage.stage_key)}</strong>
                            <small>{humanize(stage.status)}</small>
                          </div>
                        </li>
                      ))}
                    </ol>

                    {task ? (
                      <section className="interventionCard">
                        <div>
                          <p className="panelLabel">Task Contract</p>
                          <h4>{task.objective}</h4>
                          <p>
                            Context keys: {contextKeys}. Referenced artifacts: {inputArtifacts}.
                            Capabilities: {task.permitted_capabilities.length || "none"}. Required
                            knowledge: {task.required_knowledge.join(", ")}.
                          </p>
                          <p>Non-goals: {task.non_goals.join("; ")}.</p>
                        </div>
                      </section>
                    ) : null}

                    {outputSummary ? (
                      <section className="interventionCard">
                        <div>
                          <p className="panelLabel">Validated worker output</p>
                          <h4>{outputSummary}</h4>
                          <p>
                            Evidence findings: {evidenceCount}. Stop reason:{" "}
                            {String(worker?.output.stopReason ?? "unknown")}.
                          </p>
                          <p>
                            Receipt: {String(receipt.workerKey ?? "pending")}@
                            {String(receipt.workerVersion ?? "pending")}, output validated{" "}
                            {String(receipt.outputValidated ?? false)}.
                          </p>
                        </div>
                      </section>
                    ) : null}

                    {failureCategory ? (
                      <p className="notice error" role="status">
                        Classified worker failure: {humanize(failureCategory)}
                      </p>
                    ) : null}

                    <div className="eventHistory">
                      <div className="eventHistoryHeader">
                        <strong>History</strong>
                        <small>
                          {run.runtime_run_id
                            ? `Runtime ${run.runtime_run_id.slice(0, 18)}…`
                            : "Runtime pending"}
                        </small>
                      </div>
                      {runEvents.length ? (
                        <ul>
                          {runEvents.map((event) => (
                            <li key={event.id}>
                              <time>{formatDate(event.occurred_at)}</time>
                              <span>{humanize(event.event_type)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>No events in this loaded window; earlier events may exist.</p>
                      )}
                    </div>
                  </article>
                );
              })} />
            </div>
          ) : (
            <div className="operationEmpty">
              <strong>No Worker Pack proof has run yet.</strong>
              <span>Start one above to create a Task Contract, Worker Run and receipt.</span>
            </div>
          )}
        </section></> },
{ id: "launch", label: "Launch proof", content: <><section className="operationsPanel" aria-labelledby="launch-worker-heading">
          <div className="panelHeading">
            <div>
              <p className="panelLabel">Generic Researcher fixture</p>
              <h2 id="launch-worker-heading">Run a bounded worker</h2>
            </div>
          </div>

          {businesses.length ? (
            <div className="businessList">
              {businesses.map((business) => (
                <article className="businessCard stage3BusinessCard" key={business.id}>
                  <div>
                    <h3>{business.name}</h3>
                    <p>Task Contract context only, no model call and no conversation history.</p>
                  </div>
                  <form action={startGenericResearcherProof}>
                    <input name="businessId" type="hidden" value={business.id} />
                    <input
                      name="idempotencyKey"
                      type="hidden"
                      value={`stage4:${crypto.randomUUID()}`}
                    />
                    <input name="launchNonce" type="hidden" value={crypto.randomUUID()} />
                    <button className="compactButton" type="submit">
                      Run worker proof
                    </button>
                  </form>
                </article>
              ))}
            </div>
          ) : (
            <div className="operationEmpty">
              <strong>Create a Business first.</strong>
              <span>The worker proof always runs inside an owner-scoped Business.</span>
            </div>
          )}
        </section></> }]} /></AppShell>
  );
}
