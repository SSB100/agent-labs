import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/stage7/app-shell";
import { ConsoleRetainedWorkspace, ConsoleRecentRows } from "@/components/console/console-retained-workspace";
import { ConsoleWorkDetail } from "@/components/console/console-work-detail";
import { ConsoleCollectionBadge } from "@/components/console/console-collection-panes";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { loadConsoleWorkDetail } from "@/lib/core-ui/console-work-detail-data";
import { CONSOLE_COLLECTION_UUID } from "@/lib/core-ui/console-collections-query";
import { loadProductWorkspace } from "@/products/data";
import { ProductsWorkspace } from "@/components/stage13/products-workspace";
import { loadRetainedChild } from "@/lib/core-ui/console-retained-detail";
export const dynamic = "force-dynamic";
export default async function WorkflowPage({ params, searchParams }: {
  params: Promise<{ workflowRunId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workflowRunId } = await params, query = await searchParams;
  if (!CONSOLE_COLLECTION_UUID.test(workflowRunId)) notFound();
  const context = await requireOwnerUiContext();
  const businessId = typeof query.business === "string" ? query.business : undefined;
  if (query.business && (!businessId || !context.businesses.some(b => b.id === businessId))) notFound();
  if (query.artifact && (typeof query.artifact !== "string" || !CONSOLE_COLLECTION_UUID.test(query.artifact))) notFound();
  const detail = await loadConsoleWorkDetail(context, workflowRunId, { businessId, artifactId: typeof query.artifact === "string" ? query.artifact : undefined });
  if (detail.selection.status === "missing") notFound();
  if (!detail.run) throw new Error("Exact saved work is unavailable");
  const run = detail.run, business = run.business_id;
  const products = await loadProductWorkspace({ ...context, businesses: context.businesses.filter(b => b.id === business) }, run.id);
  const selectedChildren = await Promise.all((["stage", "task", "worker"] as const).map(async kind=>{
    const id=query[kind]; if(!id)return null;
    if(typeof id!=="string" || !CONSOLE_COLLECTION_UUID.test(id))notFound();
    return {kind,id,...await loadRetainedChild(context,run,kind,id)};
  }));
  const childView = (kind:"stage"|"task"|"worker") => { const child=selectedChildren.find(c=>c?.kind===kind);return child ? child.status==="found" ? <article><h3>Exact saved {kind} · {child.id}</h3><pre tabIndex={0} aria-label={`Exact ${kind} content`}>{JSON.stringify(child.item,null,2)}</pre></article> : <p role="alert">This exact {kind} is {child.status}. No replacement record was selected.</p> : null; };
  const childHref = (kind:string,id:string,panel:string) => `/dashboard/workflows/${run.id}?business=${business}&panel=${panel}&${kind}=${id}`;
  const workHref = `/dashboard?view=work&business=${business}&selected=${run.id}`;
  const legacyPanel = { artifacts: "outputs", products: "products", browser: "browser", metrics: "summary" }[String(query.workspace)];
  const windowNotice = <p className="coreNotice">Each child window is limited to 100 saved rows. Complete historical navigation remains pending R06. Missing rows do not establish absence.</p>;
  return <>
    <ConsoleRetainedWorkspace ownerId={context.userId} initialPanel={query.artifact ? "outputs" : legacyPanel ?? "summary"} header={<PageHeader eyebrow="Exact saved workflow" title={detail.definition?.name ?? "Workflow definition unavailable"} description={`${detail.business?.name ?? "Business unavailable"} · Run ${run.id}`} actions={<Link className="coreButton" href={workHref}>Back to work</Link>} />} notice={windowNotice} panels={[
      { id: "summary", label: "Outcome & decisions", content: <ConsoleWorkDetail detail={detail} searchParams={{ view: "work", business, selected: run.id }} /> },
      { id: "stages", label: "Stages", content: <><h2>Saved stages</h2>{childView("stage")}<ConsoleRecentRows label="Stage window" rows={detail.stages.map(stage => <article className="businessCard" key={stage.id}><h3>{stage.stage_key} · attempt {stage.attempt}</h3><ConsoleCollectionBadge status={stage.status} /><p>Stage {stage.id} · sequence {stage.sequence}</p><Link href={childHref("stage",stage.id,"stages")}>Read exact stage context</Link></article>)} /></> },
      { id: "tasks", label: "Tasks", content: <><h2>Saved tasks</h2>{childView("task")}<ConsoleRecentRows label="Task window" rows={detail.tasks.map(task => <article className="businessCard" key={task.id}><h3>{task.objective}</h3><ConsoleCollectionBadge status={task.status} /><p>Task {task.id}</p><Link href={childHref("task",task.id,"tasks")}>Read exact task contract</Link></article>)} /></> },
      { id: "workers", label: "Workers", content: <><h2>Saved worker runs</h2>{childView("worker")}<ConsoleRecentRows label="Worker window" rows={detail.workerRuns.map(worker => <article className="businessCard" key={worker.id}><h3>{detail.workerDefinitions.find(w => w.id === worker.worker_definition_id)?.name ?? "Worker definition unavailable"}</h3><ConsoleCollectionBadge status={worker.status} /><p>Worker run {worker.id} · task {worker.task_contract_id}</p><Link href={childHref("worker",worker.id,"workers")}>Read exact worker context and output</Link></article>)} /></> },
      { id: "outputs", label: "Artifacts & receipts", content: <><h2>Exact saved outputs</h2>{detail.artifactSelection.status === "found" ? <article id={`artifact-${detail.artifactSelection.item.id}`}><h3>{detail.artifactSelection.item.name}</h3><p>Artifact {detail.artifactSelection.item.id}</p><pre tabIndex={0} aria-label="Exact artifact content">{JSON.stringify(detail.artifactSelection.item.content ?? detail.artifactSelection.item.metadata, null, 2)}</pre></article> : query.artifact ? <p role="alert">The exact artifact is unavailable. No different output was selected.</p> : null}<ConsoleRecentRows label="Output window" rows={detail.artifacts.map(artifact => <article className="businessCard" key={artifact.id}><h3>{artifact.name}</h3><p>{artifact.artifact_type} · {artifact.id}</p><Link className="coreButton" href={`/dashboard/workflows/${run.id}?business=${business}&panel=outputs&artifact=${artifact.id}#artifact-${artifact.id}`}>Read this exact output</Link></article>)} /><Link className="coreButton" href={`/dashboard?view=library&business=${business}`}>Designs and provider receipts</Link></> },
      { id: "products", label: "Candidates", content: <ProductsWorkspace data={products} compact businessId={business} /> },
      { id: "browser", label: "Browser metadata", content: <><h2>Saved browser metadata</h2><p>Live streaming remains unavailable and unqualified. Opening saved metadata does not launch a browser or grant control.</p><Link className="coreButton" href={`/dashboard?view=overview&business=${business}&centre=browser&browserRun=${run.id}`}>Inspect this exact run’s saved browser record</Link></> },
      { id: "activity", label: "Audit activity", content: <><h2>Underlying audit events</h2><p>Activity is separate from ended workflow outcomes.</p><Link className="coreButton" href={`/dashboard?view=activity&business=${business}&runFilter=${run.id}`}>Read this exact run’s audit activity</Link></> },
    ]} />
  </>;
}
