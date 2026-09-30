import type { OwnerUiContext } from "../lib/core-ui/data";
import type { AssetInspection, CreativeApprovalSnapshot, DesignReview } from "./types";
import { loadProductWorkspace } from "../products/data";
import { currentProductionCandidate, type ProductionCandidateChoice } from "./production-approval";

export async function loadProductionCandidates(context: OwnerUiContext): Promise<{ candidates: ProductionCandidateChoice[]; errors: string[] }> {
  const products = await loadProductWorkspace(context);
  return { candidates: products.errors.length ? [] : products.candidates.flatMap(candidate => {
    const choice = currentProductionCandidate(candidate, products.decisions, products.experiments);
    return choice ? [choice] : [];
  }), errors: products.errors };
}
export type CreativeApprovalRecord = { id: string; business_id: string; candidate_id: string; purpose: string; snapshot: CreativeApprovalSnapshot; maximum_microusd: number; approved_at: string; expires_at: string };
export type CreativeRunRecord = { id: string; business_id: string; approval_id: string; workflow_run_id: string; created_at: string; capability_expires_at: string; capabilityExpired: boolean; status: string; phase: string | null; productionReady: boolean };
export type CreativeAssetRecord = { id: string; creative_run_id: string; business_id: string; candidate_id: string; version: number; brief_hash: string; asset_hash: string; storage_path: string; inspection: AssetInspection; prompt: string; provider: string; model: string; generated_at: string; signedUrl: string | null };
export type CreativeReviewRecord = { id: string; creative_run_id: string; asset_id: string; review: DesignReview; reviewer_model: string; created_at: string };
export type CreativeCostRecord = { creative_run_id: string; call_key: string; reported_microusd: number | null; provider_request_id: string | null; created_at: string };
export type CreativeWorkspaceData = { approvals: CreativeApprovalRecord[]; runs: CreativeRunRecord[]; assets: CreativeAssetRecord[]; reviews: CreativeReviewRecord[]; costs: CreativeCostRecord[]; errors: string[] };
export async function loadCreativeWorkspace(context: OwnerUiContext): Promise<CreativeWorkspaceData> {
  const empty: CreativeWorkspaceData = { approvals: [], runs: [], assets: [], reviews: [], costs: [], errors: [] };
  const businessIds = context.businesses.map(b => b.id); if (!businessIds.length) return empty;
  const [approvals, runs, assets] = await Promise.all([
    context.supabase.from("creative_approvals").select("id,business_id,candidate_id,purpose,snapshot,maximum_microusd,approved_at,expires_at").in("business_id", businessIds).order("approved_at", { ascending: false }).limit(50),
    context.supabase.from("creative_runs").select("id,business_id,approval_id,workflow_run_id,created_at,capability_expires_at").in("business_id", businessIds).order("created_at", { ascending: false }).limit(50),
    context.supabase.from("creative_assets").select("id,creative_run_id,business_id,candidate_id,version,brief_hash,asset_hash,storage_path,inspection,prompt,provider,model,generated_at").in("business_id", businessIds).order("generated_at", { ascending: false }).limit(100),
  ]);
  const errors = [approvals.error, runs.error, assets.error].filter(Boolean).map(e => e!.message);
  const runRows = (runs.data ?? []) as Omit<CreativeRunRecord, "status" | "phase" | "productionReady" | "capabilityExpired">[];
  if (!runRows.length) return { ...empty, approvals: (approvals.data ?? []) as CreativeApprovalRecord[], errors };
  const runIds = runRows.map(r => r.id);
  const [workflows, reviews, costs, urls] = await Promise.all([
    context.supabase.from("workflow_runs").select("id,status,current_stage_key,state").in("id", runRows.map(r => r.workflow_run_id)),
    context.supabase.from("creative_reviews").select("id,creative_run_id,asset_id,review,reviewer_model,created_at").in("creative_run_id", runIds).order("created_at", { ascending: false }),
    context.supabase.from("creative_cost_settlements").select("creative_run_id,call_key,reported_microusd,provider_request_id,created_at").in("creative_run_id", runIds).order("created_at", { ascending: true }),
    assets.data?.length ? context.supabase.storage.from("creative-assets").createSignedUrls(assets.data.map(a => a.storage_path as string), 1200) : Promise.resolve({ data: [], error: null }),
  ]);
  for (const e of [workflows.error, reviews.error, costs.error, urls.error]) if (e) errors.push(e.message);
  const workflowMap = new Map((workflows.data ?? []).map(w => [w.id, w]));
  const signed = new Map((urls.data ?? []).map(url => [url.path, url.signedUrl]));
  return { approvals: (approvals.data ?? []) as CreativeApprovalRecord[],
    runs: runRows.map(r => ({ ...r, capabilityExpired: Date.parse(r.capability_expires_at) <= Date.now(), status: workflowMap.get(r.workflow_run_id)?.status ?? "unknown", phase: workflowMap.get(r.workflow_run_id)?.current_stage_key ?? null, productionReady: workflowMap.get(r.workflow_run_id)?.state?.productionReady === true })),
    assets: (assets.data ?? []).map(a => ({ ...a, signedUrl: signed.get(a.storage_path) ?? null })) as CreativeAssetRecord[],
    reviews: (reviews.data ?? []) as CreativeReviewRecord[], costs: (costs.data ?? []) as CreativeCostRecord[], errors };
}
