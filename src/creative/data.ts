import { safeTablePage, historyRows } from "../lib/core-ui/history-read";
import { consoleScope, consoleScopedIds } from "../lib/core-ui/console-collections";
import type { StoredImageProvenance } from "./stored-image";
import type { OwnerUiContext } from "../lib/core-ui/data";
import type { AssetInspection, CreativeApprovalSnapshot, DesignReview } from "./types";
import { loadProductWorkspace } from "../products/data";
import { currentProductionCandidate, type ProductionCandidateChoice } from "./production-approval";
import { mergeCreativeCosts, type CreativeCostRecord, type CreativeCostReservationRecord, type CreativeCostSettlementRecord } from "./cost-display";

export async function loadProductionCandidates(context: OwnerUiContext): Promise<{ page?: import("../lib/core-ui/history-query").HistoryPage; candidates: ProductionCandidateChoice[]; errors: string[] }> {
  const products = await loadProductWorkspace(context,undefined,true);
  return { page:products.candidatePage, candidates: products.errors.length ? [] : products.candidates.flatMap(candidate => {
    const choice = currentProductionCandidate(candidate, products.decisions, products.experiments);
    return choice ? [choice] : [];
  }), errors: products.errors };
}
export type CreativeApprovalRecord = { id: string; business_id: string; candidate_id: string; purpose: string; snapshot: CreativeApprovalSnapshot; quote?: { generatorModel: string; providerBinding?: Record<string, unknown> }; maximum_microusd: number; approved_at: string; expires_at: string };
export type CreativeRunRecord = { id: string; business_id: string; approval_id: string; workflow_run_id: string; created_at: string; capability_expires_at: string; capabilityExpired: boolean; status: string; phase: string | null; productionReady: boolean };
export type CreativeAssetRecord = { id: string; creative_run_id: string; business_id: string; candidate_id: string; version: number; brief_hash: string; asset_hash: string; storage_path: string; inspection: AssetInspection; prompt: string; provider: string; model: string; generated_at: string; signedUrl: string | null; provenance?: StoredImageProvenance | null; sourceSignedUrl?: string | null };
export type CreativeReviewRecord = { id: string; creative_run_id: string; asset_id: string; review: DesignReview; reviewer_model: string; created_at: string };
export type RetainedCreativeSource = { creativeRunId: string; callKey: string; storagePath: string; mediaType: "image/png" | "image/webp"; bytes: number; sha256: string; downloadVerified: boolean; signedUrl: string | null };
export type CreativeWorkspaceData = { approvalsPage?:import("../lib/core-ui/history-query").HistoryPage; assetsPage?:import("../lib/core-ui/history-query").HistoryPage; approvals: CreativeApprovalRecord[]; runs: CreativeRunRecord[]; assets: CreativeAssetRecord[]; reviews: CreativeReviewRecord[]; costs: CreativeCostRecord[]; costsAvailable: boolean; retainedSources: RetainedCreativeSource[]; errors: string[] };
const retainedSourcePath = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/version-[12](\.png|\.original\.webp)$/;
export async function loadCreativeWorkspace(context: OwnerUiContext): Promise<CreativeWorkspaceData> {
  const empty: CreativeWorkspaceData = { approvals: [], runs: [], assets: [], reviews: [], costs: [], costsAvailable: true, retainedSources: [], errors: [] };
  if (context.businessesUnavailable) return { ...empty, costsAvailable: false, errors: ["Business records unavailable"] };
  const businessIds= await consoleScopedIds(context,context.scopeBusinessId ?? null); if(businessIds?.length===0)return empty;
  const [approvalPage,assetPage]=await Promise.all([
    safeTablePage<CreativeApprovalRecord>(context,"creative_approvals","id,business_id,candidate_id,purpose,snapshot,quote,maximum_microusd,approved_at,expires_at","approval",{businessId:context.scopeBusinessId,time:"approved_at"}),
    safeTablePage<CreativeAssetRecord>(context,"creative_assets","id,creative_run_id,business_id,candidate_id,version,brief_hash,asset_hash,storage_path,inspection,prompt,provider,model,generated_at","asset",{businessId:context.scopeBusinessId,time:"generated_at"}),
  ]);
  const approvals={data:historyRows(approvalPage),error:approvalPage.page.available?null:{message:"Approval page unavailable"}}, assets={data:historyRows(assetPage),error:assetPage.page.available?null:{message:"Asset page unavailable"}};
  const approvalIds=approvals.data.map(a=>a.id),assetRunIds=[...new Set(assets.data.map(a=>a.creative_run_id))];
  const predicates=[approvalIds.length?`approval_id.in.(${approvalIds.join(",")})`:null,assetRunIds.length?`id.in.(${assetRunIds.join(",")})`:null].filter(Boolean).join(",");
  const runs=predicates?await consoleScope(context.supabase.from("creative_runs").select("id,business_id,approval_id,workflow_run_id,created_at,capability_expires_at",{count:"exact"}),businessIds).or(predicates).order("created_at",{ascending:false}).order("id",{ascending:false}).limit(53):{data:[],error:null,count:0};
  const errors=[approvals.error,runs.error,assets.error].filter(Boolean).map(e=>e!.message);
  const runsComplete=!runs.error && runs.count===runs.data?.length && (runs.data?.length??0)<=52 && assetRunIds.every(id=>runs.data?.some(r=>r.id===id));
  if(!runsComplete)errors.push("Linked creative run records unavailable or incomplete");
  const extraApprovalIds=[...new Set((runs.data??[]).map(r=>r.approval_id).filter(id=>!approvalIds.includes(id)))];
  if(extraApprovalIds.length){const related=await consoleScope(context.supabase.from("creative_approvals").select("id,business_id,candidate_id,purpose,snapshot,quote,maximum_microusd,approved_at,expires_at",{count:"exact"}),businessIds).in("id",extraApprovalIds).limit(27);if(related.error || related.count!==extraApprovalIds.length || related.data?.length!==extraApprovalIds.length)errors.push("Gallery approval context unavailable");else approvals.data.push(...related.data as CreativeApprovalRecord[]);}
  const runRows = (runs.data ?? []) as Omit<CreativeRunRecord, "status" | "phase" | "productionReady" | "capabilityExpired">[];
  if (!runRows.length) return { ...empty, approvals: (approvals.data ?? []) as CreativeApprovalRecord[], approvalsPage:approvalPage.page,assetsPage:assetPage.page,costsAvailable: runsComplete, errors };
  const runIds = runRows.map(r => r.id);
  const [workflows, reviews, reservations, costs, urls, outputs] = await Promise.all([
    context.supabase.from("workflow_runs").select("id,status,current_stage_key,state",{count:"exact"}).in("id", runRows.map(r => r.workflow_run_id)).limit(53),
    context.supabase.from("creative_reviews").select("id,creative_run_id,asset_id,review,reviewer_model,created_at",{count:"exact"}).in("creative_run_id", runIds).order("created_at", { ascending: false }).order("id",{ascending:false}).limit(105),
    context.supabase.from("creative_cost_reservations").select("creative_run_id,call_key,reserved_microusd,created_at",{count:"exact"}).in("creative_run_id", runIds).order("created_at", { ascending: true }).order("call_key").limit(313),
    context.supabase.from("creative_cost_settlements").select("creative_run_id,call_key,reported_microusd,provider_request_id,created_at,receipt",{count:"exact"}).in("creative_run_id", runIds).order("created_at", { ascending: true }).order("call_key").limit(313),
    assets.data?.length ? context.supabase.storage.from("creative-assets").createSignedUrls(assets.data.map(a => a.storage_path as string), 1200) : Promise.resolve({ data: [], error: null }),
    context.supabase.from("creative_phase_outputs").select("creative_run_id,call_key,output",{count:"exact"}).in("creative_run_id", runIds).in("call_key", ["generate:1", "generate:2"]).limit(105),
  ]);
  for (const e of [workflows.error, reviews.error, reservations.error, costs.error, urls.error, outputs.error]) if (e) errors.push(e.message);
  const relatedComplete=[workflows,reviews,reservations,costs,outputs].every(r=>!r.error && r.count===r.data?.length) && workflows.data?.length===runRows.length && (reviews.data?.length??0)<=104 && (reservations.data?.length??0)<=312 && (costs.data?.length??0)<=312 && (outputs.data?.length??0)<=104;
  if(!relatedComplete)errors.push("Related creative evidence is unavailable or partial; absent rows do not prove no charge or no review.");
  const workflowMap = new Map((workflows.data ?? []).map(w => [w.id, w]));
  const signed = new Map((urls.data ?? []).map(url => [url.path, url.signedUrl]));
  const provenance = new Map((outputs.data ?? []).map(output => [`${output.creative_run_id}:${output.call_key}`, output.output?.provenance as StoredImageProvenance | undefined]));
  const sourcePaths = [...provenance.values()].filter((p): p is StoredImageProvenance => !!p && p.detectedMediaType === "image/webp").map(p => p.originalStoragePath);
  const sourceUrls = sourcePaths.length ? await context.supabase.storage.from("creative-assets").createSignedUrls(sourcePaths, 1200) : { data: [], error: null };
  if (sourceUrls.error) errors.push(sourceUrls.error.message);
  const signedSources = new Map((sourceUrls.data ?? []).map(url => [url.path, url.signedUrl]));
  const retainedSources: RetainedCreativeSource[] = (costs.data ?? []).flatMap(cost => {
    const run = runRows.find(r => r.id === cost.creative_run_id), source = cost.receipt?.sourcePreservation;
    // The immutable focused image charge is saved before receipt proof and pixel
    // inspection. Once its actual asset exists, use that qualified asset view.
    if(assets.data.some(asset=>asset.creative_run_id===cost.creative_run_id&&cost.call_key===`generate:${asset.version}`))return [];
    if (cost.receipt?.outputValidated !== false || !run || (businessIds!==null && !businessIds.includes(run.business_id)) || !/^generate:[12]$/.test(cost.call_key) || !source || source.uploadConfirmed !== true ||
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
  return { approvalsPage:approvalPage.page,assetsPage:assetPage.page, approvals: (approvals.data ?? []) as CreativeApprovalRecord[],
    runs: runRows.map(r => ({ ...r, capabilityExpired: Date.parse(r.capability_expires_at) <= Date.now(), status: workflowMap.get(r.workflow_run_id)?.status ?? "unknown", phase: workflowMap.get(r.workflow_run_id)?.current_stage_key ?? null, productionReady: workflowMap.get(r.workflow_run_id)?.state?.productionReady === true })),
    assets: (assets.data ?? []).map(a => {
      const source = provenance.get(`${a.creative_run_id}:generate:${a.version}`) ?? null;
      return { ...a, signedUrl: signed.get(a.storage_path) ?? null, provenance: source,
        sourceSignedUrl: source ? (source.detectedMediaType === "image/png" ? signed.get(a.storage_path) : signedSources.get(source.originalStoragePath)) ?? null : null };
    }) as CreativeAssetRecord[],
    reviews: (reviews.data ?? []) as CreativeReviewRecord[],
    costs: mergeCreativeCosts((reservations.data ?? []) as CreativeCostReservationRecord[], (costs.data ?? []) as CreativeCostSettlementRecord[]),
    costsAvailable: runsComplete && relatedComplete,
    retainedSources: retainedSources.map(source => ({ ...source, signedUrl: signedRetained.get(source.storagePath) ?? null })), errors };
}
