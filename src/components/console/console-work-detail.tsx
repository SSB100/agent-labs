import type { ReactNode } from "react";
import Link from "next/link";
import type { ConsoleWorkCompleteness, ConsoleWorkDetailData } from "@/lib/core-ui/console-work-detail-data";
import { consoleCollectionHref } from "@/lib/core-ui/console-collections-query";
import { ACTIVE_WORKFLOW_STATUSES, workflowExecutionEnded } from "@/lib/core-ui/workflows";
import { summarizeOutcomeSpending } from "@/lib/core-ui/run-outcome";
import { ConsoleArtifactPosition } from "./console-artifact-position";
import { ConsoleCollectionBadge, ConsoleWorkState, type ConsoleCollectionSearch } from "./console-collection-panes";

function paramsOf(search: ConsoleCollectionSearch): URLSearchParams {
  if (search instanceof URLSearchParams) return search;
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(search)) {
    if (typeof value === "string") params.append(name, value);
    else for (const entry of value ?? []) params.append(name, entry);
  }
  return params;
}
function windowLabel(state: ConsoleWorkCompleteness): string {
  return `${state.loaded} loaded${state.total === null ? " · Total unavailable" : ` of ${state.total}`}${state.complete ? "" : " · Incomplete history"}`;
}
function WindowSection({ title, runId, state, children }: { title: string; runId: string; state: ConsoleWorkCompleteness; children: ReactNode }) {
  return <details className="consoleWorkSection" data-console-disclosure={`work:${runId}:${title}`}><summary>{title} · {windowLabel(state)}</summary>
    {!state.complete ? <p className="consoleWorkIncomplete" role="status">This bounded read cannot establish the latest record or the absence of other saved records. {state.hasMore ? `Only ${state.limit} records are loaded.` : "Completeness is unavailable."}</p> : null}
    {state.loaded ? children : <p>{state.complete ? "No saved records were found for this exact run." : "Records could not be established; this is not a confirmed empty result."}</p>}
  </details>;
}

/** Read-only selected Work. No workflow controls, provider calls, action forms or sample-based outcome claims. */
export function ConsoleWorkDetail({ detail, searchParams }: { detail: ConsoleWorkDetailData; searchParams: ConsoleCollectionSearch }) {
  const run = detail.run, params = paramsOf(searchParams), requested = params.get("selected") ?? params.get("run"), business = params.get("business");
  if (!run || detail.selection.status !== "found" || detail.selection.item.id !== run.id || detail.selection.item.business_id !== run.business_id || requested !== run.id || business && business !== run.business_id) {
    return <p role="alert">This exact workflow detail could not be verified in the selected Business. No replacement record has been opened.</p>;
  }
  const stopped = ACTIVE_WORKFLOW_STATUSES.has(run.status) && workflowExecutionEnded(run);
  const spending = summarizeOutcomeSpending(run, detail.costs ?? undefined);
  const exact = detail.artifactSelection.status === "found" && detail.artifactSelection.item.id === params.get("artifact") && detail.artifactSelection.item.business_id === run.business_id && detail.artifactSelection.item.workflow_run_id === run.id ? detail.artifactSelection.item : null;
  const sameRun = (row: { business_id: string; workflow_run_id: string | null }) => row.business_id === run.business_id && row.workflow_run_id === run.id;
  const notices = detail.interventions.filter(sameRun), artifacts = detail.artifacts.filter(sameRun), tasks = detail.tasks.filter(sameRun), workers = detail.workerRuns.filter(sameRun);
  const technicalHref = `/dashboard/workflows/${encodeURIComponent(run.id)}?business=${encodeURIComponent(run.business_id)}`;
  const auditHref = `/dashboard?view=activity&business=${encodeURIComponent(run.business_id)}&runFilter=${encodeURIComponent(run.id)}`;
  const research = detail.research.status === "found" && detail.research.experiment && sameRun(detail.research.experiment) ? detail.research.experiment : null;
  const artifactHref = (id: string) => `${consoleCollectionHref(searchParams, { view: "work", selected: run.id, run: null, artifact: id })}#artifact-${encodeURIComponent(id)}`;
  return <article className="consoleWorkDetail" data-console-evidence-run={run.id} data-work-detail={run.id} data-console-detail-available={detail.complete && detail.errors.length === 0}>
    {exact ? <ConsoleArtifactPosition artifactId={exact.id} workflowRunId={run.id}/> : null}
    <h3>{detail.definition?.name ?? "Workflow name unavailable"}</h3>
    <ConsoleWorkState run={run}/>
    <section className="consoleWorkCost" aria-label="Recorded provider charges"><h4>{spending.label}</h4><strong>{spending.value}</strong><p>{spending.detail}</p>{spending.reservation ? <p>{spending.reservation}</p> : null}
      {spending.exactAmounts.length ? <details className="consoleWorkSection" data-console-disclosure={`work:${run.id}:costs`}><summary>Exact recorded amounts</summary><dl className="consoleWorkFacts">{spending.exactAmounts.map((amount, index) => <div key={`${amount.label}:${index}`}><dt>{amount.label}</dt><dd>{amount.value}</dd></div>)}</dl></details> : null}
    </section>
    {stopped ? <p>This execution ended. An open or reviewed notice does not resume it, establish success, or settle charges.</p> : run.status === "failed" ? <p>This run failed. Saved outputs and charges remain available for inspection.</p> : run.status === "cancelled" ? <p>This run was cancelled. This does not establish whether every external effect or charge is settled.</p> : null}
    {!detail.complete ? <p className="consoleCollectionNotice" role="status">Some exact-run context is incomplete. Unloaded records do not prove that no work, outputs or charges exist.</p> : null}
    <details className="consoleWorkSection" data-console-disclosure={`work:${run.id}:identity`}><summary>Workflow and exact saved identities</summary><dl className="consoleWorkFacts">
      <div><dt>Workflow name</dt><dd>{detail.definition?.name ?? "Workflow name unavailable"}</dd></div>
      <div><dt>Business</dt><dd>{detail.business?.id === run.business_id ? detail.business.name : "Business name unavailable"}</dd></div><div><dt>Business ID</dt><dd>{run.business_id}</dd></div><div><dt>Run ID</dt><dd>{run.id}</dd></div><div><dt>Saved state</dt><dd>{run.status || "Unavailable"}</dd></div><div><dt>Saved stage</dt><dd>{run.current_stage_key ?? "Unavailable"}</dd></div>
      <div><dt>Definition</dt><dd>{run.workflow_definition_id}{detail.definition ? ` · v${detail.definition.version}` : " · Unavailable"}</dd></div><div><dt>Updated</dt><dd>{run.updated_at}</dd></div><div><dt>Execution ended</dt><dd>{run.completed_at ?? "No end time recorded"}</dd></div>
    </dl></details>
    <WindowSection runId={run.id} title="Saved decisions" state={detail.completeness.interventions}><ul>{notices.map(notice => <li key={notice.id}><Link href={`/dashboard?view=decisions&business=${encodeURIComponent(run.business_id)}&decision=${encodeURIComponent(notice.id)}`}>{notice.title}</Link> <ConsoleCollectionBadge status={notice.status}/><p>Notice {notice.id} · {notice.requested_at}</p></li>)}</ul></WindowSection>
    <WindowSection runId={run.id} title="Saved output metadata" state={detail.completeness.artifacts}><ul>{artifacts.map(artifact => <li key={artifact.id} data-console-motion-target="output" data-console-motion-id={artifact.id}><Link href={artifactHref(artifact.id)}>{artifact.name}</Link><p>{artifact.artifact_type} · {artifact.created_at}</p><p>Artifact {artifact.id}</p></li>)}</ul></WindowSection>
    {params.has("artifact") ? exact ? <details className="consoleWorkSection" id={`artifact-${exact.id}`} data-console-motion-target="output" data-console-motion-id={exact.id} open><summary>{exact.name}</summary><p>Exact selected artifact · {exact.id}</p><p>{exact.artifact_type} · {exact.created_at}</p><pre tabIndex={0} aria-label="Exact selected artifact content">{JSON.stringify(exact.content ?? exact.metadata, null, 2)}</pre></details> : <p className="consoleCollectionNotice" role="alert">This exact artifact could not be verified for the selected run and Business. No other output has been substituted.</p> : null}
    <WindowSection runId={run.id} title="Saved stages, newest first" state={detail.completeness.stages}><ul>{detail.stages.filter(stage => stage.workflow_run_id === run.id).map(stage => <li key={stage.id} data-console-motion-target="stage" data-console-motion-id={stage.id}>{stage.stage_key} · Attempt {stage.attempt} <ConsoleCollectionBadge status={stage.status}/><p>Stage {stage.id} · {stage.created_at}</p></li>)}</ul></WindowSection>
    <WindowSection runId={run.id} title="Saved tasks, newest first" state={detail.completeness.tasks}><ul>{tasks.map(task => <li key={task.id}>{task.objective} <ConsoleCollectionBadge status={task.status}/><p>Task {task.id} · {task.created_at}</p></li>)}</ul></WindowSection>
    <WindowSection runId={run.id} title="Saved worker runs, newest first" state={detail.completeness.workers}><ul>{workers.map(worker => <li key={worker.id}>{detail.workerDefinitions.find(row => row.id === worker.worker_definition_id)?.name ?? "Worker name unavailable"} <ConsoleCollectionBadge status={worker.status}/><p>Worker run {worker.id} · {worker.created_at}</p></li>)}</ul>{!detail.completeness.workerDefinitions.complete ? <p className="consoleWorkIncomplete">Some worker names could not be verified.</p> : null}</WindowSection>
    {research ? <details className="consoleWorkSection" data-console-disclosure={`work:${run.id}:research`}><summary>Legacy research context</summary><p>This saved experiment is legacy research identity, not a canonical Quest.</p><dl className="consoleWorkFacts"><div><dt>Experiment</dt><dd>{research.id}</dd></div><div><dt>Discovery version</dt><dd>{research.discovery_version ?? "Unavailable"}</dd></div><div><dt>Saved state</dt><dd>{research.status}</dd></div></dl></details> : detail.research.status === "unavailable" || detail.research.status === "missing" ? <p className="consoleWorkIncomplete">Exact legacy research context could not be verified.</p> : detail.definition?.workflow_key.startsWith("product.discovery-v2.") ? <p className="consoleWorkIncomplete">Legacy research context was not loaded. This does not establish that no linked experiment exists.</p> : null}
    <nav className="consoleWorkLinks" aria-label="Exact workflow destinations"><Link href={auditHref}>Underlying audit activity</Link><Link href={technicalHref}>Technical workflow tools</Link></nav>
    <p>Opening saved records makes no change and authorizes no further execution.</p>
  </article>;
}
