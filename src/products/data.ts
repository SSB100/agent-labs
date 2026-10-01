import type { OwnerUiContext } from "../lib/core-ui/data";
import { linkedProductCandidateIds } from "./history";
import type { ProductCandidate, ProductDecisionRecord, ProductExperimentRecord, ProductWorkspaceData } from "./types";

export async function loadProductWorkspace(context: OwnerUiContext, workflowRunId?: string): Promise<ProductWorkspaceData> {
  const empty: ProductWorkspaceData = { candidates: [], experiments: [], decisions: [], errors: [] };
  const businesses = context.businesses.map(business => business.id);
  if (!businesses.length) return empty;
  const query = context.supabase.from("product_experiments").select("*").in("business_id", businesses)
    .order("created_at", { ascending: false }).limit(100);
  const experimentsResult = await (workflowRunId ? query.eq("workflow_run_id", workflowRunId) : query);
  const experiments = (experimentsResult.data ?? []) as ProductExperimentRecord[];
  const candidateQuery = context.supabase.from("product_candidates").select("*").in("business_id", businesses)
    .order("created_at", { ascending: false }).limit(100);
  if (workflowRunId && !experiments.length) return { ...empty, errors: experimentsResult.error ? ["Product experiments could not be loaded."] : [] };
  const candidateIds = linkedProductCandidateIds(experiments);
  const candidatesResult = workflowRunId && !candidateIds.length ? { data: [], error: null }
    : await (workflowRunId ? candidateQuery.in("id", candidateIds) : candidateQuery);
  const candidates = (candidatesResult.data ?? []) as ProductCandidate[];
  const decisionQuery = context.supabase.from("product_decisions").select("*")
    .in("business_id", businesses).in("candidate_id", candidates.map(candidate => candidate.id))
    .order("created_at", { ascending: false }).limit(300);
  const decisionsResult = candidates.length ? await (workflowRunId
    ? decisionQuery.in("experiment_id", experiments.map(experiment => experiment.id))
    : decisionQuery) : { data: [], error: null };
  return { candidates, experiments, decisions: (decisionsResult.data ?? []) as ProductDecisionRecord[],
    errors: [experimentsResult.error && "Product experiments could not be loaded.", candidatesResult.error && "Product candidates could not be loaded.", decisionsResult.error && "Product decisions could not be loaded."].filter((message): message is string => typeof message === "string") };
}
