import type { OwnerUiContext } from "./data";
import { CONSOLE_COLLECTION_UUID } from "./console-collections-query";

const sources: Record<"stage"|"task"|"worker",{table:string;columns:string;ownedColumn:boolean}> = {
  stage: { table: "workflow_stage_runs", columns: "id,workflow_run_id,stage_key,sequence,attempt,status,input,output,failure,started_at,completed_at,created_at,updated_at", ownedColumn: false },
  task: { table: "task_contracts", columns: "id,business_id,workflow_run_id,workflow_stage_run_id,worker_definition_id,status,objective,input_artifact_ids,permitted_capabilities,required_knowledge,completion_criteria,failure_criteria,non_goals,escalation_rules,created_at,updated_at", ownedColumn: true },
  worker: { table: "worker_runs", columns: "id,business_id,workflow_run_id,task_contract_id,worker_definition_id,status,input,output,failure,execution_metadata,started_at,completed_at,created_at,updated_at", ownedColumn: true },
};
/** Exact payload read after the parent run has been verified. Never a latest-row fallback. */
export async function loadRetainedChild(context: OwnerUiContext, run: { id: string; business_id: string }, kind: keyof typeof sources, id: string) {
  if (!CONSOLE_COLLECTION_UUID.test(id) || !context.businesses.some(b => b.id === run.business_id)) return { status: "missing" as const, item: null };
  const source = sources[kind];
  try {
    let query = context.supabase.from(source.table).select(source.columns).eq("id",id).eq("workflow_run_id",run.id).limit(2);
    if(source.ownedColumn) query=query.eq("business_id",run.business_id);
    const result=await query;
    if(result.error || !Array.isArray(result.data) || result.data.length>1) return {status:"unavailable" as const,item:null};
    const candidate:unknown = result.data[0];
    if(!candidate || typeof candidate!=="object" || Array.isArray(candidate))return {status:"missing" as const,item:null};
    const item=candidate as Record<string,unknown>;
    if(!item || item.id!==id || item.workflow_run_id!==run.id || (source.ownedColumn && item.business_id!==run.business_id))return {status:"missing" as const,item:null};
    return {status:"found" as const,item};
  } catch {return {status:"unavailable" as const,item:null};}
}
