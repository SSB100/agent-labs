import type { OwnerUiContext } from "../lib/core-ui/data";
import { readHistory, historyRows } from "../lib/core-ui/history-read";
import type { ProductCandidate, ProductDecisionRecord, ProductExperimentRecord, ProductWorkspaceData } from "./types";
type CandidateRead = { id?: string; candidate: ProductCandidate; decisions: ProductDecisionRecord[]; experiments: ProductExperimentRecord[] };
const unique = <T extends {id:string}>(rows:T[]) => [...new Map(rows.map(row=>[row.id,row])).values()];
export async function loadProductWorkspace(context: OwnerUiContext, workflowRunId?: string, productionOnly=false): Promise<ProductWorkspaceData> {
  const empty:ProductWorkspaceData={candidates:[],experiments:[],decisions:[],errors:[]};
  if(context.businessesUnavailable)return {...empty,errors:["Business records unavailable"]};
  const businessId=context.scopeBusinessId ?? (context.ownerDirectoryPaged ? null : context.businesses.length===1 ? context.businesses[0].id : null);
  const selected=new URLSearchParams(context.readSearch).get("candidate");
  try {
    const [candidates,experiments,decisions]=await Promise.all([
      readHistory<CandidateRead>(context,businessId,productionOnly?"production_candidates":"product_candidates",productionOnly?"productionCandidate":"candidate",{selectedId:selected,workflowRunId}),
      productionOnly?null:readHistory<ProductExperimentRecord>(context,businessId,"product_experiments","experiment",{workflowRunId}),
      selected&&!productionOnly?readHistory<ProductDecisionRecord>(context,businessId,"product_decisions","decision",{candidateId:selected,workflowRunId}):null,
    ]);
    const candidateRows=candidates.selected && !candidates.items.some(r=>r.candidate.id===candidates.selected!.candidate.id)?[candidates.selected,...candidates.items]:candidates.items;
    return {candidates:candidateRows.map(r=>r.candidate),experiments:unique([...(experiments?historyRows(experiments):[]),...candidateRows.flatMap(r=>r.experiments)]),
      decisions:unique([...candidateRows.flatMap(r=>r.decisions),...(decisions?historyRows(decisions):[])]),errors:[],candidatePage:candidates.page,experimentPage:experiments?.page,decisionPage:decisions?.page};
  } catch {return {...empty,errors:["Historical products or related evidence could not be loaded; current state is unavailable."]};}
}
