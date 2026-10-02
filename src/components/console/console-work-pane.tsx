import Link from "next/link";
import { ConsoleArtifactPosition } from "./console-artifact-position";
import type { OwnerUiContext, WorkflowCollection, loadWorkflowDetail } from "@/lib/core-ui/data";
import type { ProductWorkspaceData } from "@/products/types";
import type { RunCostData } from "@/lib/core-ui/run-outcome-data";
import { ACTIVE_WORKFLOW_STATUSES, currentTask, currentWorkerRun, formatRelativeTime, latestEvent, openIntervention, statusLabel, workflowExecutionEnded, type WorkflowRunRecord } from "@/lib/core-ui/workflows";
import { StatusPill } from "@/components/stage7/app-shell";
import { ExecutionSnapshot, WorkflowTimeline } from "@/components/stage7/workflow-visuals";
import { RunOutcome } from "@/components/guided/run-outcome";
import { workDisplayTitle } from "@/components/guided/work-context";

type Detail = Awaited<ReturnType<typeof loadWorkflowDetail>>;

function RunStatus({ run }: { run: WorkflowRunRecord }) {
  // An ended runtime can retain needs_owner after its notice has been reviewed.
  // Project its execution state without rewriting the saved workflow status.
  if (ACTIVE_WORKFLOW_STATUSES.has(run.status) && workflowExecutionEnded(run)) {
    return <span className="coreStatus coreStatus-danger" title={`Execution ended. Last recorded status: ${statusLabel(run.status)}`}>Stopped</span>;
  }
  return <StatusPill status={run.status}/>;
}

export function ConsoleWorkPane({ context, collection, detail, products, costs, navigationBusinessId, researchHref, selectedArtifactId }: { context: OwnerUiContext; collection: WorkflowCollection; detail?: Detail | null; products?: ProductWorkspaceData; costs?: RunCostData | null; navigationBusinessId?: string; researchHref?: string; selectedArtifactId?: string }) {
  const workHref = `/dashboard?view=work${navigationBusinessId ? `&business=${encodeURIComponent(navigationBusinessId)}` : ""}`;
  if (!detail) return <section className="consolePane"><header className="consolePaneHeader"><div><h1>Work</h1><p>Recent saved runs · select one to inspect its outcome</p></div><Link href={researchHref ?? `${workHref}&sheet=research`}>New research goal</Link></header><div className="consolePaneScroll">
    {collection.errors.length ? <p className="coreNotice" role="alert">Some saved work could not be checked. This list may be incomplete.</p> : null}
    {collection.truncated ? <p className="coreNotice" role="status">Showing {collection.runs.length} recent runs{typeof collection.runCount === "number" ? ` of ${collection.runCount}` : ""}. Older work is outside this loaded window.</p> : null}
    <div className="consoleWorkList">{collection.runs.map(run => { const definition = collection.definitions.find(item => item.id === run.workflow_definition_id); return <Link className="consoleWorkRow" key={run.id} href={`/dashboard?view=work&run=${encodeURIComponent(run.id)}`}><div><strong>{workDisplayTitle(definition)}</strong><small>{context.businesses.find(business => business.id === run.business_id)?.name ?? "Business"} · {formatRelativeTime(run.updated_at)}</small></div><RunStatus run={run}/></Link>; })}</div>
    {!collection.runs.length && !collection.errors.length ? <p>No saved work yet. Start with a bounded research goal.</p> : null}
  </div></section>;
  const selectedArtifact = detail.artifacts.find(artifact => artifact.id === selectedArtifactId);
  const run = detail.run, unavailable = detail.errors.length > 0;
  const task = currentTask(detail.tasks), worker = currentWorkerRun(detail.workerRuns), intervention = openIntervention(detail.interventions);
  const linkedNotice = intervention ?? detail.interventions.find(item => item.business_id === run.business_id && item.workflow_run_id === run.id);
  const noticeHref = linkedNotice ? `/dashboard?view=decisions&business=${encodeURIComponent(run.business_id)}&decision=${encodeURIComponent(linkedNotice.id)}` : null;
  const evidenceHref = `#work-evidence-${run.id}`;
  const nextOverride = noticeHref ? { href: noticeHref, label: "Inspect exact notice", detail: "Review the saved notice, its stopped or pending state and recorded charges in Decisions. Navigation makes no change." }
    : { href: evidenceHref, label: "Inspect retained evidence", detail: "Inspect this run’s saved outputs and technical evidence. No further work is authorized by opening them." };
  const definition = worker ? detail.workerDefinitions.find(item => item.id === worker.worker_definition_id) ?? null : null;
  return <section className="consolePane"><header className="consolePaneHeader"><div><h1>{workDisplayTitle(detail.definition)}</h1><p>{detail.business?.name ?? "Business"} · updated {formatRelativeTime(run.updated_at)}</p></div><Link href={workHref}>All work</Link></header><div className="consolePaneScroll" data-console-evidence-run={run.id}>
    {selectedArtifact ? <ConsoleArtifactPosition artifactId={selectedArtifact.id} workflowRunId={run.id}/> : null}
    <div className="consoleDetailTop"><RunStatus run={run}/><Link className="consoleMiniAction" href={evidenceHref}>Technical evidence</Link></div>
    <RunOutcome nextOverride={nextOverride} run={run} definition={detail.definition} artifacts={unavailable ? { status: "unavailable" } : { status: "ready", records: detail.artifacts }} interventions={unavailable ? { status: "unavailable" } : { status: "ready", records: detail.interventions }} experiments={!products || products.errors.length ? { status: "unavailable" } : { status: "ready", records: products.experiments }} events={unavailable ? { status: "unavailable" } : { status: "ready", records: detail.events }} {...costs}/>
    {linkedNotice && noticeHref ? <Link className="consoleWorkRow" href={noticeHref}><div><strong>{linkedNotice.title}</strong><small>{linkedNotice.status === "open" ? "Open saved notice" : "Saved notice history"} · viewing does not clear a request</small></div><span>View details</span></Link> : null}
    <details className="consoleDetails"><summary>Recorded stages and worker context</summary><WorkflowTimeline run={run} definition={detail.definition ?? undefined} stages={detail.stages} unavailable={unavailable}/><ExecutionSnapshot run={run} definition={detail.definition ?? undefined} stages={detail.stages} event={latestEvent(detail.events)} intervention={intervention} task={task} workerRun={worker} workerDefinition={definition} unavailable={unavailable}/></details>
    <details className="consoleDetails" id={`work-evidence-${run.id}`} open={Boolean(selectedArtifact)}><summary>Saved outputs and technical evidence · {unavailable ? "completeness unavailable" : detail.artifacts.length}</summary>{detail.artifacts.map(artifact => <details key={artifact.id} className="consoleDetails" data-console-motion-target="output" data-console-motion-id={artifact.id} id={`artifact-${artifact.id}`} open={selectedArtifact?.id === artifact.id}><summary>{artifact.name}</summary><p>{artifact.artifact_type} · {formatRelativeTime(artifact.created_at)}</p><pre>{JSON.stringify(artifact.content ?? artifact.metadata, null, 2)}</pre></details>)}</details>
  </div></section>;
}
