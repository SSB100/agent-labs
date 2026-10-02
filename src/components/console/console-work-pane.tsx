import Link from "next/link";
import type { OwnerUiContext, WorkflowCollection, loadWorkflowDetail } from "@/lib/core-ui/data";
import type { ProductWorkspaceData } from "@/products/types";
import type { RunCostData } from "@/lib/core-ui/run-outcome-data";
import { currentTask, currentWorkerRun, formatRelativeTime, latestEvent, openIntervention } from "@/lib/core-ui/workflows";
import { StatusPill } from "@/components/stage7/app-shell";
import { ExecutionSnapshot, NeedsYouCard, WorkflowTimeline } from "@/components/stage7/workflow-visuals";
import { RunOutcome } from "@/components/guided/run-outcome";
import { workDisplayTitle } from "@/components/guided/work-context";

type Detail = Awaited<ReturnType<typeof loadWorkflowDetail>>;
export function ConsoleWorkPane({ context, collection, detail, products, costs }: { context: OwnerUiContext; collection: WorkflowCollection; detail?: Detail | null; products?: ProductWorkspaceData; costs?: RunCostData | null }) {
  if (!detail) return <section className="consolePane"><header className="consolePaneHeader"><div><h1>Work</h1><p>Recent saved runs · select one to inspect its outcome</p></div><Link href="/dashboard?view=work&sheet=research">New research goal</Link></header><div className="consolePaneScroll">
    {collection.errors.length ? <p className="coreNotice" role="alert">Some saved work could not be checked. This list may be incomplete.</p> : null}
    {collection.truncated ? <p className="coreNotice" role="status">Showing {collection.runs.length} recent runs{typeof collection.runCount === "number" ? ` of ${collection.runCount}` : ""}. Older work is outside this loaded window.</p> : null}
    <div className="consoleWorkList">{collection.runs.map(run => { const definition = collection.definitions.find(item => item.id === run.workflow_definition_id); return <Link className="consoleWorkRow" key={run.id} href={`/dashboard?view=work&run=${encodeURIComponent(run.id)}`}><div><strong>{workDisplayTitle(definition)}</strong><small>{context.businesses.find(business => business.id === run.business_id)?.name ?? "Business"} · {formatRelativeTime(run.updated_at)}</small></div><StatusPill status={run.status}/></Link>; })}</div>
    {!collection.runs.length && !collection.errors.length ? <p>No saved work yet. Start with a bounded research goal.</p> : null}
  </div></section>;
  const run = detail.run, unavailable = detail.errors.length > 0;
  const task = currentTask(detail.tasks), worker = currentWorkerRun(detail.workerRuns), intervention = openIntervention(detail.interventions);
  const definition = worker ? detail.workerDefinitions.find(item => item.id === worker.worker_definition_id) ?? null : null;
  return <section className="consolePane"><header className="consolePaneHeader"><div><h1>{workDisplayTitle(detail.definition)}</h1><p>{detail.business?.name ?? "Business"} · updated {formatRelativeTime(run.updated_at)}</p></div><Link href="/dashboard?view=work">All work</Link></header><div className="consolePaneScroll">
    <div className="consoleDetailTop"><StatusPill status={run.status}/><Link className="consoleMiniAction" href={`/dashboard/workflows/${run.id}`}>Full technical record</Link></div>
    <RunOutcome run={run} definition={detail.definition} artifacts={unavailable ? { status: "unavailable" } : { status: "ready", records: detail.artifacts }} interventions={unavailable ? { status: "unavailable" } : { status: "ready", records: detail.interventions }} experiments={!products || products.errors.length ? { status: "unavailable" } : { status: "ready", records: products.experiments }} events={unavailable ? { status: "unavailable" } : { status: "ready", records: detail.events }} {...costs}/>
    {intervention ? <NeedsYouCard intervention={intervention} run={run} definition={detail.definition ?? undefined} businessName={detail.business?.name} workflowName={workDisplayTitle(detail.definition)} returnTo={`/dashboard/workflows/${run.id}`}/> : null}
    <details className="consoleDetails"><summary>Recorded stages and worker context</summary><WorkflowTimeline run={run} definition={detail.definition ?? undefined} stages={detail.stages} unavailable={unavailable}/><ExecutionSnapshot run={run} definition={detail.definition ?? undefined} stages={detail.stages} event={latestEvent(detail.events)} intervention={intervention} task={task} workerRun={worker} workerDefinition={definition} unavailable={unavailable}/></details>
    <details className="consoleDetails"><summary>Saved outputs and technical evidence · {unavailable ? "completeness unavailable" : detail.artifacts.length}</summary>{detail.artifacts.map(artifact => <details key={artifact.id} className="consoleDetails" id={`artifact-${artifact.id}`}><summary>{artifact.name}</summary><p>{artifact.artifact_type} · {formatRelativeTime(artifact.created_at)}</p><pre>{JSON.stringify(artifact.content ?? artifact.metadata, null, 2)}</pre></details>)}</details>
  </div></section>;
}
