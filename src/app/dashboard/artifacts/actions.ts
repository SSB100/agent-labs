"use server";
import { verifyOwnerBusiness } from "@/lib/core-ui/owner-business";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { retainedFeedbackHref } from "@/lib/core-ui/console-retained-feedback";
import { start } from "workflow/api";
import {FOCUSED_PHYSICAL_PROPOSAL} from "@/creative/focused-physical-proposal";
import {fetchFocusedCreativeQuote} from "@/creative/focused-quote";
import {creativeHash} from "@/creative/contracts";
import { validateCreativeApproval } from "@/creative/contracts";
import { currentCreativeQuote, TECHNICAL_HYPOTHESIS, technicalCreativeApproval } from "@/creative/proposal";
import { currentProductionCandidate, productionCreativeApproval } from "@/creative/production-approval";
import { FLUX_KLEIN_PNG_POLICY } from "@/creative/image-provider";
import { SCREEN_CATEGORIES, type CreativeGenerationLimit } from "@/creative/types";
import type { ProductCandidate, ProductDecisionRecord, ProductExperimentRecord } from "@/products/types";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { creativeRuntimeWorkflow } from "@/workflows/creative-runtime";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const value = (form: FormData, key: string) => typeof form.get(key) === "string" ? String(form.get(key)).trim() : "";
function generationLimit(form: FormData,error:(message:string)=>never): CreativeGenerationLimit {
  const limit = value(form, "maximumGenerations");
  // New provider-bound forms require an explicit limit; saved legacy approvals are unchanged.
  if (!limit) return error("Explicitly choose the image and repair limit before saving a new approval.");
  if (limit !== "1" && limit !== "2") return error("Choose one image with no repair, or up to two images with one repair.");
  return limit === "1" ? 1 : 2;
}
function selectedProvider(form: FormData,error:(message:string)=>never) {
  // A new provider must never inherit the authority of a saved Recraft approval.
  if (value(form, "generatorModel") !== FLUX_KLEIN_PNG_POLICY.modelId) return error("Explicitly select the supported BFL native-PNG provider before saving a new approval.");
  if (value(form, "confirmDataUse") !== "on") return error("Acknowledge the BFL/OpenRouter data-use disclosure, including its retention and training-license uncertainty.");
  return FLUX_KLEIN_PNG_POLICY.modelId;
}

function feedback(context:Awaited<ReturnType<typeof requireOwnerUiContext>>,panel:string) {
  const scope:{business?:string;panel:string}={panel};
  const owned=(id:string)=>{if(context.businesses.some(b=>b.id===id))scope.business=id;};
  const error=(message:string):never=>redirect(retainedFeedbackHref("artifacts","error",message,scope));
  const success=(message:string):never=>{revalidatePath("/dashboard/artifacts");revalidatePath("/dashboard/products");revalidatePath("/dashboard");redirect(retainedFeedbackHref("artifacts","message",message,scope));};
  return {error,success,owned};
}

export async function approveCreativeCandidate(form: FormData) {
  const context = await requireOwnerUiContext(), businessId = value(form, "businessId"), approvalId = value(form, "approvalId");
  const {error,success,owned}=feedback(context,"technical");
  if (!uuidPattern.test(approvalId) || !(await verifyOwnerBusiness(context,businessId))) return error("Business or approval reference not found.");
  owned(businessId);
  if (!["confirmOriginalIntent", "confirmTechnicalOnly", "confirmPrintSpec", "confirmTerms", "confirmBudget"].every(key => value(form, key) === "on")) return error("Confirm the specific original design, technical scope, print specification, provider terms and total allowance.");
  const generatorModel = selectedProvider(form,error);
  const design = { concept: value(form, "concept"), audience: value(form, "audience"), designInstructions: value(form, "designInstructions") };
  if (design.concept.length < 3 || design.concept.length > 160 || design.audience.length < 3 || design.audience.length > 160 || design.designInstructions.length < 50 || design.designInstructions.length > 1500) return error("Provide the specific original concept, audience and 50–1500 character design instructions.");
  const maximumGenerations = generationLimit(form,error), maximumMicrousd = Math.round(Number(value(form, "budgetUsd")) * 1_000_000);
  if (!Number.isInteger(maximumMicrousd) || maximumMicrousd < 1 || maximumMicrousd > 1_000_000) return error("This technical test allows at most US$1 total across all phases.");
  let quote: Awaited<ReturnType<typeof currentCreativeQuote>>;
  try { quote = await currentCreativeQuote(maximumGenerations, generatorModel, true); } catch (cause) { return error(cause instanceof Error ? cause.message : "Provider quote unavailable."); }
  if (quote.maximumEstimateMicrousd > maximumMicrousd) return error("Current conservative estimate exceeds the allowance; no provider call was made.");
  const candidate = await context.supabase.rpc("create_product_candidate", { p_business_id: businessId, p_candidate: {
    concept: design.concept, audience: design.audience, hypothesis: TECHNICAL_HYPOTHESIS,
    originalDesign: true, rightsStatus: "confirmed", sourceDomains: ["etsy.com", "printful.com"] } });
  if (candidate.error || !candidate.data?.candidateId) return error(candidate.error?.message ?? "Unable to preserve the original concept.");
  const approval = technicalCreativeApproval(businessId, candidate.data.candidateId, maximumMicrousd, design, approvalId, maximumGenerations, generatorModel);
  try { validateCreativeApproval(approval); } catch (cause) { return error(cause instanceof Error ? cause.message : "Invalid approval."); }
  const saved = await context.supabase.rpc("approve_creative_candidate", { p_candidate_id: candidate.data.candidateId, p_approval: approval, p_quote: quote });
  if (saved.error) return error(saved.error.message);
  return success("Specific technical creative approval saved. It authorizes one bounded run; market validation and publication remain separate.");
}
export async function startCreativeRun(form: FormData) {
  const context = await requireOwnerUiContext(), approvalId = value(form, "approvalId");
  const {error,success,owned}=feedback(context,"receipts");
  if (!uuidPattern.test(approvalId)) return error("Invalid creative approval reference.");
  const existing = await context.supabase.from("creative_approvals").select("business_id,snapshot").eq("id", approvalId).maybeSingle();
  if (existing.error || !existing.data || !(await verifyOwnerBusiness(context,existing.data?.business_id))) return error("Creative approval not found.");
  owned(existing.data.business_id);
  if(existing.data.snapshot?.focusedPilotBinding)return error("Use the focused prepare and start controls so the exact financial scope is active before launch.");
  const runtimeCapability = `${randomUUID()}${randomUUID()}`, nonce = randomUUID();
  const launch = await context.supabase.rpc("begin_creative_run", { p_approval_id: approvalId, p_launch_nonce: nonce, p_runtime_capability: runtimeCapability });
  if (launch.error) return error(launch.error.message);
  if (!launch.data?.shouldStart) return success("Duplicate launch prevented. The original creative run and cost reservations remain authoritative.");
  try {
    await start(creativeRuntimeWorkflow, [{ businessId: existing.data.business_id, creativeRunId: launch.data.creativeRunId,
      coreWorkflowRunId: launch.data.workflowRunId, runtimeCapability }]);
  } catch {
    await context.supabase.rpc("fail_creative_launch", { p_creative_run_id: launch.data.creativeRunId, p_launch_nonce: nonce });
    return error("Creative launch could not be confirmed. Its reservation is preserved; check the existing run before another attempt.");
  }
  revalidatePath("/dashboard/artifacts"); redirect(`/dashboard/workflows/${launch.data.workflowRunId}`);
}
export async function approveProductionCreativeCandidate(form: FormData) {
  const context = await requireOwnerUiContext(), candidateId = value(form, "candidateId"), decisionId = value(form, "decisionId"), approvalId = value(form, "approvalId");
  const {error,success,owned}=feedback(context,"production");
  if (![candidateId, decisionId, approvalId].every(id => uuidPattern.test(id))) return error("Invalid candidate or approval reference.");
  if (!["confirmOriginalIntent", "confirmProductionScope", "confirmPrintSpec", "confirmTerms", "confirmBudget", "confirmPolicyScreen"].every(key => value(form, key) === "on")) return error("Confirm the exact candidate, original instructions, policy screen, print specification, terms and allowance.");
  const generatorModel = selectedProvider(form,error);
  const candidateResult = await context.supabase.from("product_candidates").select("*").eq("id", candidateId).maybeSingle();
  const candidate = candidateResult.data as ProductCandidate | null;
  if (candidateResult.error || !candidate || !(await verifyOwnerBusiness(context,candidate.business_id))) return error("Owned candidate not found.");
  owned(candidate.business_id);
  const decisionsResult = await context.supabase.from("product_decisions").select("*").eq("candidate_id", candidate.id).eq("business_id", candidate.business_id).order("created_at", { ascending: false }).limit(2);
  const decisions = (decisionsResult.data ?? []) as ProductDecisionRecord[], selected = decisions.find(d => d.id === decisionId);
  if (decisionsResult.error || !selected || selected.id !== decisions[0]?.id) return error("The candidate decision changed. Review the current evidence before approving.");
  const experimentResult = await context.supabase.from("product_experiments").select("*",{count:"exact"}).eq("candidate_id", candidate.id).eq("business_id", candidate.business_id).order("created_at",{ascending:false}).limit(1001);
  const experiments=(experimentResult.data??[]) as ProductExperimentRecord[];
  if(experimentResult.error||experiments.length>1000||experimentResult.count!==experiments.length)return error("The complete candidate evaluation history could not be checked.");
  const selectedExperiment=experiments.find(e=>e.id===selected.experiment_id);
  if(selectedExperiment?.parent_discovery_id){
    const root=await context.supabase.from("product_experiments").select("*").eq("id",selectedExperiment.parent_discovery_id).eq("business_id",candidate.business_id).maybeSingle();
    if(root.error||!root.data)return error("The reviewed discovery root could not be checked.");
    experiments.push(root.data as ProductExperimentRecord);
  }
  const choice = currentProductionCandidate(candidate, decisions, experiments);
  if (!choice) return error("A current evidence-backed reviewed TEST is required. Unresolved blockers cannot be waived by creative approval.");
  const maximumGenerations = generationLimit(form,error), maximumMicrousd = Math.round(Number(value(form, "budgetUsd")) * 1_000_000);
  if (!Number.isInteger(maximumMicrousd) || maximumMicrousd < 1 || maximumMicrousd > 1_000_000) return error("This bounded creative run allows at most US$1 across all phases.");
  let focusedInputs: {printSpecification:typeof FOCUSED_PHYSICAL_PROPOSAL;rightsConfirmed:true;creativeInstallationId:string;creativeInstallationSnapshotHash:string}|undefined;
  if(choice.focusedAdoption){
    if(value(form,"focusedPrintSpecificationHash")!==creativeHash(FOCUSED_PHYSICAL_PROPOSAL)||maximumGenerations!==1)return error("The explicit focused print specification and one-image limit must match the displayed proposal.");
    const installationId=value(form,"creativeInstallationId");if(!uuidPattern.test(installationId))return error("Select the active creative installation for this Business.");
    const installed=await context.supabase.from("installed_packs").select("id,business_id,root_pack_key,status,snapshot").eq("id",installationId).eq("business_id",candidate.business_id).maybeSingle();
    if(installed.error||!installed.data||installed.data.status!=="active"||installed.data.root_pack_key!=="workflow.etsy-creative-pipeline")return error("The selected creative installation is unavailable.");
    focusedInputs={printSpecification:structuredClone(FOCUSED_PHYSICAL_PROPOSAL),rightsConfirmed:true,creativeInstallationId:installationId,creativeInstallationSnapshotHash:creativeHash(installed.data.snapshot)};
  }
  let approval: ReturnType<typeof productionCreativeApproval>, quote: Awaited<ReturnType<typeof currentCreativeQuote>>;
  try {
    approval = productionCreativeApproval(choice, { ...focusedInputs, approvalId, designInstructions: value(form, "designInstructions"), rightsStatement: value(form, "rightsStatement"), maximumMicrousd, maximumGenerations, generatorModel,
      policyScreen: SCREEN_CATEGORIES.map(category => ({ category, status: "clear", rationale: value(form, `rationale_${category}`), sourceUrls: value(form, `sources_${category}`).split(/\r?\n/).map(url => url.trim()).filter(Boolean) })) });
    quote = choice.focusedAdoption?(await fetchFocusedCreativeQuote(true)).approvalQuote:await currentCreativeQuote(maximumGenerations, generatorModel, true);
  } catch (cause) { return error(cause instanceof Error ? cause.message : "Unable to validate the exact production approval."); }
  if (quote.maximumEstimateMicrousd > maximumMicrousd) return error("Current conservative estimate exceeds the allowance; no provider call was made.");
  const saved = await context.supabase.rpc("approve_creative_candidate", { p_candidate_id: candidate.id, p_approval: approval, p_quote: quote });
  if (saved.error) return error(saved.error.message);
  return success("Separate candidate creative approval saved. Review and start its single bounded run when ready; publication is not authorized.");
}
export async function closeExpiredCreativeRun(form: FormData) {
  const context = await requireOwnerUiContext(), runId = value(form, "creativeRunId");
  const {error,success,owned}=feedback(context,"receipts");
  if (!uuidPattern.test(runId)) return error("Invalid creative run reference.");
  const existing=await context.supabase.from("creative_runs").select("business_id").eq("id",runId).maybeSingle();
  if(existing.error||!existing.data||!(await verifyOwnerBusiness(context,existing.data?.business_id)))return error("Invalid creative run reference.");
  owned(existing.data.business_id);
  const result = await context.supabase.rpc("close_expired_creative_run", { p_creative_run_id: runId });
  if (result.error) return error(result.error.message);
  return success("Expired run closed for owner review. Existing artifacts, receipts and uncertain reservations are preserved; no provider call was made.");
}
