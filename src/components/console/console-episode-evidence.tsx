import Link from "next/link";
import type { OwnerUiContext } from "@/lib/core-ui/data";
import { consoleObject, consoleValidId } from "@/lib/core-ui/console-collections";
import { carryWorkspace } from "@/lib/core-ui/workspace-navigation";
/** Exact independent Step and Agent reads; paged sibling windows never choose a substitute. */
export async function ConsoleEpisodeEvidence({ context, businessId, runId, stepId, agentId }: { context: OwnerUiContext; businessId: string; runId: string; stepId?: string; agentId?: string }) {
  if (!stepId && !agentId) return null;
  if ([stepId, agentId].some(id => id !== undefined && !consoleValidId(id))) return <p role="alert">Invalid Step or Agent identity</p>;
  const [stage, worker] = await Promise.all([
    stepId ? context.supabase.from("workflow_stage_runs").select("id,workflow_run_id,stage_key,sequence,attempt,status,output,failure").eq("id", stepId).eq("workflow_run_id", runId).maybeSingle() : null,
    agentId ? context.supabase.from("worker_runs").select("id,business_id,workflow_run_id,task_contract_id,worker_definition_id,status,output,failure,execution_metadata").eq("id", agentId).eq("business_id", businessId).eq("workflow_run_id", runId).maybeSingle() : null,
  ]);
  const unavailable = <p role="alert">This exact Step/Agent/task chain is unavailable for the selected episode. No substitute was selected.</p>;
  // Predicates alone are not evidence: verify returned identities before following
  // the chain, including a required stage reference that may explicitly be null.
  if (stepId && (stage?.error || !consoleObject(stage?.data) || stage.data.id !== stepId || stage.data.workflow_run_id !== runId) ||
    agentId && (worker?.error || !consoleObject(worker?.data) || worker.data.id !== agentId || worker.data.business_id !== businessId || worker.data.workflow_run_id !== runId || !consoleValidId(worker.data.task_contract_id) || !consoleValidId(worker.data.worker_definition_id))) return unavailable;
  const task = worker?.data ? await context.supabase.from("task_contracts").select("id,business_id,workflow_run_id,workflow_stage_run_id,worker_definition_id,objective").eq("id", worker.data.task_contract_id).eq("business_id", businessId).eq("workflow_run_id", runId).eq("worker_definition_id", worker.data.worker_definition_id).maybeSingle() : null;
  if (agentId && (task?.error || !consoleObject(task?.data) || task.data.id !== worker?.data?.task_contract_id || task.data.business_id !== businessId || task.data.workflow_run_id !== runId || task.data.worker_definition_id !== worker?.data?.worker_definition_id ||
    !(task.data.workflow_stage_run_id === null || consoleValidId(task.data.workflow_stage_run_id)) || typeof task.data.objective !== "string" || stepId && task.data.workflow_stage_run_id !== stepId)) return unavailable;
  const definition = task?.data ? await context.supabase.from("worker_definitions").select("id,name,version,role").eq("id", task.data.worker_definition_id).maybeSingle() : null;
  if (agentId && (definition?.error || !consoleObject(definition?.data) || definition.data.id !== task?.data?.worker_definition_id)) return unavailable;
  return <section className="consoleWorkSection" aria-label="Exact Step and Agent evidence">
    {stage?.data ? <details open><summary>Step {stage.data.sequence}: {stage.data.stage_key} · attempt {stage.data.attempt} · {stage.data.status}</summary><p>Exact Step {stageId(stage.data.id)}</p><pre tabIndex={0} aria-label="Exact Step outputs and failure">{JSON.stringify({ output: stage.data.output, failure: stage.data.failure }, null, 2)}</pre></details> : null}
    {worker?.data ? <details open><summary>Agent {definition?.data?.name} · {worker.data.status}</summary><p>{definition?.data?.role} · version {definition?.data?.version}</p><p>Actual Worker Run {worker.data.id} · Task {task?.data?.id}</p><p>{task?.data?.objective}</p><p>{task?.data?.workflow_stage_run_id === null ? "Run-level task · No stage assigned" : `Stage ${task?.data?.workflow_stage_run_id}`}</p><pre tabIndex={0} aria-label="Exact Agent output and execution receipts">{JSON.stringify({ output: worker.data.output, failure: worker.data.failure, execution: worker.data.execution_metadata }, null, 2)}</pre><Link href={carryWorkspace(`/dashboard/workflows/${runId}?business=${businessId}&section=workers`, context.readSearch)}>Saved worker tools and receipts</Link></details> : null}
  </section>;
}
const stageId = (id: string) => id;
