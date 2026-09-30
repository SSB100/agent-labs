import type { StoredImageProvenance } from "./stored-image";
import type { OwnerUiContext } from "../lib/core-ui/data";
import type { AssetInspection, CreativeApprovalSnapshot, DesignReview } from "./types";
import { loadProductWorkspace } from "../products/data";
import { currentProductionCandidate, type ProductionCandidateChoice } from "./production-approval";
import { mergeCreativeCosts, type CreativeCostRecord, type CreativeCostReservationRecord, type CreativeCostSettlementRecord } from "./cost-display";

export async function loadProductionCandidates(context: OwnerUiContext): Promise<{ candidates: ProductionCandidateChoice[]; errors: string[] }> {
  const products = await loadProductWorkspace(context);
  return { candidates: products.errors.length ? [] : products.candidates.flatMap(candidate => {
    const choice = currentProductionCandidate(candidate, products.decisions, products.experiments);
    return choice ? [choice] : [];
  }), errors: products.errors };
}
export type CreativeApprovalRecord = { id: string; business_id: string; candidate_id: string; purpose: string; snapshot: CreativeApprovalSnapshot; maximum_microusd: number; approved_at: string; expires_at: string };
export type CreativeRunRecord = { id: string; business_id: string; approval_id: string; workflow_run_id: string; created_at: string; capability_expires_at: string; capabilityExpired: boolean; status: string; phase: string | null; productionReady: boolean };
export type CreativeAssetRecord = { id: string; creative_run_id: string; business_id: string; candidate_id: string; version: number; brief_hash: string; asset_hash: string; storage_path: string; inspection: AssetInspection; prompt: string; provider: string; model: string; generated_at: string; signedUrl: string | null; provenance?: StoredImageProvenance | null; sourceSignedUrl?: string | null };
export type CreativeReviewRecord = { id: string; creative_run_id: string; asset_id: string; review: DesignReview; reviewer_model: string; created_at: string };
export type RetainedCreativeSource = { creativeRunId: string; callKey: string; storagePath: string; mediaType: "image/png" | "image/webp"; bytes: number; sha256: string; downloadVerified: boolean; signedUrl: string | null };
export type CreativeWorkspaceData = { approvals: CreativeApprovalRecord[]; runs: CreativeRunRecord[]; assets: CreativeAssetRecord[]; reviews: CreativeReviewRecord[]; costs: CreativeCostRecord[]; costsAvailable: boolean; retainedSources: RetainedCreativeSource[]; errors: string[] };
const retainedSourcePath = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/version-[12](\.png|\.original\.webp)$/;
export async function loadCreativeWorkspace(context: OwnerUiContext): Promise<CreativeWorkspaceData> {
  const empty: CreativeWorkspaceData = { approvals: [], runs: [], assets: [], reviews: [], costs: [], costsAvailable: true, retainedSources: [], errors: [] };
  const businessIds = context.businesses.map(b => b.id); if (!businessIds.length) return empty;
  const [approvals, runs, assets] = await Promise.all([
    context.supabase.from("creative_approvals").select("id,business_id,candidate_id,purpose,snapshot,maximum_microusd,approved_at,expires_at").in("business_id", businessIds).order("approved_at", { ascending: false }).limit(50),
    context.supabase.from("creative_runs").select("id,business_id,approval_id,workflow_run_id,created_at,capability_expires_at").in("business_id", businessIds).order("created_at", { ascending: false }).limit(50),
    context.supabase.from("creative_assets").select("id,creative_run_id,business_id,candidate_id,version,brief_hash,asset_hash,storage_path,inspection,prompt,provider,model,generated_at").in("business_id", businessIds).order("generated_at", { ascending: false }).limit(100),
  ]);
  const errors = [approvals.error, runs.error, assets.error].filter(Boolean).map(e => e!.message);
  const runRows = (runs.data ?? []) as Omit<CreativeRunRecord, "status" | "phase" | "productionReady" | "capabilityExpired">[];
  if (!runRows.length) return { ...empty, approvals: (approvals.data ?? []) as CreativeApprovalRecord[], costsAvailable: !runs.error, errors };
  const runIds = runRows.map(r => r.id);
  const [workflows, reviews, reservations, costs, urls, outputs] = await Promise.all([
    context.supabase.from("workflow_runs").select("id,status,current_stage_key,state").in("id", runRows.map(r => r.workflow_run_id)),
    context.supabase.from("creative_reviews").select("id,creative_run_id,asset_id,review,reviewer_model,created_at").in("creative_run_id", runIds).order("created_at", { ascending: false }),
    context.supabase.from("creative_cost_reservations").select("creative_run_id,call_key,reserved_microusd,created_at").in("creative_run_id", runIds).order("created_at", { ascending: true }),
    context.supabase.from("creative_cost_settlements").select("creative_run_id,call_key,reported_microusd,provider_request_id,created_at,receipt").in("creative_run_id", runIds).order("created_at", { ascending: true }),
    assets.data?.length ? context.supabase.storage.from("creative-assets").createSignedUrls(assets.data.map(a => a.storage_path as string), 1200) : Promise.resolve({ data: [], error: null }),
    context.supabase.from("creative_phase_outputs").select("creative_run_id,call_key,output").in("creative_run_id", runIds).in("call_key", ["generate:1", "generate:2"]),
  ]);
  for (const e of [workflows.error, reviews.error, reservations.error, costs.error, urls.error, outputs.error]) if (e) errors.push(e.message);
  const workflowMap = new Map((workflows.data ?? []).map(w => [w.id, w]));
  const signed = new Map((urls.data ?? []).map(url => [url.path, url.signedUrl]));
  const provenance = new Map((outputs.data ?? []).map(output => [`${output.creative_run_id}:${output.call_key}`, output.output?.provenance as StoredImageProvenance | undefined]));
  const sourcePaths = [...provenance.values()].filter((p): p is StoredImageProvenance => !!p && p.detectedMediaType === "image/webp").map(p => p.originalStoragePath);
  const sourceUrls = sourcePaths.length ? await context.supabase.storage.from("creative-assets").createSignedUrls(sourcePaths, 1200) : { data: [], error: null };
  if (sourceUrls.error) errors.push(sourceUrls.error.message);
  const signedSources = new Map((sourceUrls.data ?? []).map(url => [url.path, url.signedUrl]));
  const retainedSources: RetainedCreativeSource[] = (costs.data ?? []).flatMap(cost => {
    const run = runRows.find(r => r.id === cost.creative_run_id), source = cost.receipt?.sourcePreservation;
    if (cost.receipt?.outputValidated !== false || !run || !businessIds.includes(run.business_id) || !/^generate:[12]$/.test(cost.call_key) || !source || source.uploadConfirmed !== true ||
        !["image/png", "image/webp"].includes(source.mediaType) || !Number.isSafeInteger(source.bytes) || source.bytes < 12 || source.bytes > 7_000_000 ||
        typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sha256) ||
        typeof source.storagePath !== "string" || !retainedSourcePath.test(source.storagePath) ||
        source.storagePath !== `${run.business_id}/${run.id}/version-${cost.call_key.split(":")[1]}${source.mediaType === "image/webp" ? ".original.webp" : ".png"}`) return [];
    return [{ creativeRunId: run.id, callKey: cost.call_key, storagePath: source.storagePath, mediaType: source.mediaType,
      bytes: source.bytes, sha256: source.sha256, downloadVerified: source.downloadVerified === true, signedUrl: null }];
  });
  const retainedUrls = retainedSources.length ? await context.supabase.storage.from("creative-assets").createSignedUrls(retainedSources.map(source => source.storagePath), 1200) : { data: [], error: null };
  if (retainedUrls.error) errors.push(retainedUrls.error.message);
  const signedRetained = new Map((retainedUrls.data ?? []).map(url => [url.path, url.signedUrl]));
  return { approvals: (approvals.data ?? []) as CreativeApprovalRecord[],
    runs: runRows.map(r => ({ ...r, capabilityExpired: Date.parse(r.capability_expires_at) <= Date.now(), status: workflowMap.get(r.workflow_run_id)?.status ?? "unknown", phase: workflowMap.get(r.workflow_run_id)?.current_stage_key ?? null, productionReady: workflowMap.get(r.workflow_run_id)?.state?.productionReady === true })),
    assets: (assets.data ?? []).map(a => {
      const source = provenance.get(`${a.creative_run_id}:generate:${a.version}`) ?? null;
      return { ...a, signedUrl: signed.get(a.storage_path) ?? null, provenance: source,
        sourceSignedUrl: source ? (source.detectedMediaType === "image/png" ? signed.get(a.storage_path) : signedSources.get(source.originalStoragePath)) ?? null : null };
    }) as CreativeAssetRecord[],
    reviews: (reviews.data ?? []) as CreativeReviewRecord[],
    costs: mergeCreativeCosts((reservations.data ?? []) as CreativeCostReservationRecord[], (costs.data ?? []) as CreativeCostSettlementRecord[]),
    costsAvailable: !runs.error && !reservations.error && !costs.error,
    retainedSources: retainedSources.map(source => ({ ...source, signedUrl: signedRetained.get(source.storagePath) ?? null })), errors };
}
