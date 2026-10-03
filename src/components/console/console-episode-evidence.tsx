import Link from "next/link";
import type { OwnerUiContext } from "@/lib/core-ui/data";
import { consoleValidId } from "@/lib/core-ui/console-collections";
import { carryWorkspace } from "@/lib/core-ui/workspace-navigation";
/** Exact independent Step and Agent reads; paged sibling windows never choose a substitute. */
export async function ConsoleEpisodeEvidence({ context, businessId, runId, stepId, agentId }: { context: OwnerUiContext; businessId: string; runId: string; stepId?: string; agentId?: string }) {
  if (!stepId && !agentId) return null;
  if ([stepId, agentId].some(id => id !== undefined && !consoleValidId(id))) return <p role="alert">Invalid Step or Agent identity</p>;
  const [stage, worker] = await Promise.all([
    stepId ? context.supabase.from("workflow_stage_runs").select("id,workflow_run_id,stage_key,sequence,attempt,status,output,failure").eq("id", stepId).eq("workflow_run_id", runId).maybeSingle() : null,
    agentId ? context.supabase.from("worker_runs").select("id,business_id,workflow_run_id,task_contract_id,worker_definition_id,status,output,failure,execution_metadata").eq("id", agentId).eq("business_id", businessId).eq("workflow_run_id", runId).maybeSingle() : null,
  ]);
  const task = worker?.data ? await context.supabase.from("task_contracts").select("id,business_id,workflow_run_id,workflow_stage_run_id,worker_definition_id,objective").eq("id", worker.data.task_contract_id).eq("business_id", businessId).eq("workflow_run_id", runId).eq("worker_definition_id", worker.data.worker_definition_id).maybeSingle() : null;
  const definition = task?.data ? await context.supabase.from("worker_definitions").select("id,name,version,role").eq("id", task.data.worker_definition_id).maybeSingle() : null;
  if (stepId && (stage?.error || !stage?.data) || agentId && (worker?.error || !worker?.data || task?.error || !task?.data || definition?.error || !definition?.data || stepId && task.data.workflow_stage_run_id !== stepId)) return <p role="alert">This exact Step/Agent/task chain is unavailable for the selected episode. No substitute was selected.</p>;
  return <section className="consoleWorkSection" aria-label="Exact Step and Agent evidence">
    {stage?.data ? <details open><summary>Step {stage.data.sequence}: {stage.data.stage_key} · attempt {stage.data.attempt} · {stage.data.status}</summary><p>Exact Step {stageId(stage.data.id)}</p><pre tabIndex={0} aria-label="Exact Step outputs and failure">{JSON.stringify({ output: stage.data.output, failure: stage.data.failure }, null, 2)}</pre></details> : null}
    {worker?.data ? <details open><summary>Agent {definition?.data?.name} · {worker.data.status}</summary><p>{definition?.data?.role} · version {definition?.data?.version}</p><p>Actual Worker Run {worker.data.id} · Task {task?.data?.id}</p><p>{task?.data?.objective}</p><pre tabIndex={0} aria-label="Exact Agent output and execution receipts">{JSON.stringify({ output: worker.data.output, failure: worker.data.failure, execution: worker.data.execution_metadata }, null, 2)}</pre><Link href={carryWorkspace(`/dashboard/workflows/${runId}?business=${businessId}&section=workers`, context.readSearch)}>Saved worker tools and receipts</Link></details> : null}
  </section>;
}
const stageId = (id: string) => id;
