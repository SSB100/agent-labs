"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { start } from "workflow/api";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { validateCandidateInput, validateDimensionAssessments } from "@/products/discovery";
import { DIMENSIONS, type CandidateInput, type DimensionAssessment } from "@/products/types";
import type { EvidencePack } from "@/research/types";
import { installedPackRuntimeWorkflow } from "@/workflows/installed-pack-runtime";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function text(form: FormData, key: string) { const value = form.get(key); return typeof value === "string" ? value.trim() : ""; }
function fail(message: string): never { redirect(`/dashboard/products?error=${encodeURIComponent(message.slice(0, 350))}`); }
function finish(message: string): never {
  revalidatePath("/dashboard/products"); revalidatePath("/dashboard/workflows");
  redirect(`/dashboard/products?message=${encodeURIComponent(message)}`);
}
function uuid(form: FormData, key: string) { const value = text(form, key); if (!UUID.test(value)) fail("Invalid product reference."); return value; }

export async function createProductCandidate(form: FormData) {
  const context = await requireOwnerUiContext(), businessId = text(form, "businessId");
  const owned=UUID.test(businessId) && context.businesses.some(business=>business.id===businessId);
  const finishCandidate = (code:string,success=false,candidateId?:string):never => {
    if(success){revalidatePath("/dashboard/products");revalidatePath("/dashboard");}
    redirect(`/dashboard/products?panel=${success ? "candidates" : "new"}${owned ? `&business=${businessId}` : ""}${candidateId ? `&candidate=${candidateId}` : ""}&${success ? "message" : "error"}=${code}`);
  };
  if(!owned)finishCandidate("candidate-business-unavailable");
  const candidate: CandidateInput = { concept: text(form, "concept"), audience: text(form, "audience"), hypothesis: text(form, "hypothesis"),
    originalDesign: ["on", "true"].includes(text(form, "originalDesign")), rightsStatus: text(form, "rightsStatus") as CandidateInput["rightsStatus"],
    sourceDomains: text(form, "sourceDomains").split(",").map(domain => domain.trim().toLowerCase()).filter(Boolean) };
  try { validateCandidateInput(candidate); } catch { finishCandidate("candidate-invalid"); }
  const result = await context.supabase.rpc("create_product_candidate", { p_business_id: businessId, p_candidate: candidate }).then(value=>value,()=>({data:null,error:true}));
  if(result.error || !result.data || typeof result.data.candidateId!=="string" || !UUID.test(result.data.candidateId) || typeof result.data.cached!=="boolean")finishCandidate("candidate-outcome-unconfirmed");
  finishCandidate(result.data.cached ? "candidate-reused" : "candidate-saved",true,result.data.candidateId);
}

export async function startProductResearch(form: FormData) {
  const context = await requireOwnerUiContext(), candidateId = uuid(form, "candidateId");
  const candidate = await context.supabase.from("product_candidates").select("business_id").eq("id", candidateId).maybeSingle();
  if (candidate.error || !candidate.data) fail("Candidate not found.");
  const businessId = candidate.data.business_id as string;
  if (!context.businesses.some(b => b.id === businessId)) fail("Candidate not found.");
  const runtimeCapability = `${randomUUID()}${randomUUID()}`, nonce = randomUUID();
  const result = await context.supabase.rpc("begin_product_discovery", { p_candidate_id: candidateId, p_launch_nonce: nonce, p_runtime_capability: runtimeCapability });
  if (result.error) fail(result.error.message);
  const launch = result.data as { experimentId: string; workflowRunId: string; shouldStart: boolean };
  if (!launch.shouldStart) finish("Duplicate research prevented. The existing experiment, decision, and evidence remain authoritative; a new attempt needs genuinely new evidence.");
  try {
    await start(installedPackRuntimeWorkflow, [{ businessId, coreWorkflowRunId: launch.workflowRunId,
      runtimeCapability, productExperimentId: launch.experimentId }]);
  } catch (error) {
    console.error("Unable to start product discovery", error);
    const failure = await context.supabase.rpc("fail_product_discovery_launch", { p_experiment_id: launch.experimentId, p_launch_nonce: nonce });
    if (failure.error) console.error("Unable to record product launch failure", failure.error);
    fail("Research launch could not be confirmed. The reservation is preserved to prevent duplicate provider calls. Check its workflow before trying again.");
  }
  revalidatePath("/dashboard/products");
  redirect(`/dashboard/workflows/${launch.workflowRunId}`);
}

export async function recordProductAssessment(form: FormData) {
  const context = await requireOwnerUiContext(), experimentId = uuid(form, "experimentId");
  const experiment = await context.supabase.from("product_experiments").select("evidence_pack,status").eq("id", experimentId).maybeSingle();
  if (experiment.error || !experiment.data?.evidence_pack || experiment.data.status !== "completed") fail("A completed research experiment is required.");
  const dimensions: DimensionAssessment[] = DIMENSIONS.map(dimension => {
    const rawScore = text(form, `score.${dimension}`);
    return { dimension, score: rawScore === "" ? null : Number(rawScore), evidenceIds: text(form, `evidence.${dimension}`).split(",").map(id => id.trim()).filter(Boolean),
      rationale: text(form, `rationale.${dimension}`), evidenceKind: text(form, `kind.${dimension}`) as DimensionAssessment["evidenceKind"] };
  });
  try { validateDimensionAssessments(dimensions, experiment.data.evidence_pack as EvidencePack); }
  catch (error) { fail(error instanceof Error ? error.message : "Invalid assessment."); }
  const result = await context.supabase.rpc("record_product_assessment", { p_experiment_id: experimentId, p_dimensions: dimensions, p_confirm_rights: text(form, "confirmRights") === "on" });
  if (result.error) fail(result.error.message);
  finish("Evidence-linked owner assessment saved. This is a provisional research decision and does not authorize creative production or publication.");
}

export async function reconsiderProductCandidate(form: FormData) {
  const context = await requireOwnerUiContext();
  const result = await context.supabase.rpc("reconsider_product_candidate", { p_candidate_id: uuid(form, "candidateId"), p_basis_artifact_id: uuid(form, "basisArtifactId") });
  if (result.error) fail(result.error.message);
  finish(result.data?.cached ? "That evidence has already been considered. The existing experiment was reused." : "New research evidence recorded as a separate experiment. Earlier decisions remain in the registry.");
}

export async function reconcileProductDiscovery(form: FormData) {
  const context = await requireOwnerUiContext();
  const result = await context.supabase.rpc("finalize_product_discovery", { p_experiment_id: uuid(form, "experimentId") });
  if (result.error) fail(result.error.message);
  finish("Existing completed research reconciled without another provider call.");
}
