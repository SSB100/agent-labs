"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { start } from "workflow/api";
import { validateCreativeApproval } from "@/creative/contracts";
import { currentCreativeQuote, TECHNICAL_HYPOTHESIS, technicalCreativeApproval } from "@/creative/proposal";
import { currentProductionCandidate, productionCreativeApproval } from "@/creative/production-approval";
import { SCREEN_CATEGORIES, type CreativeGenerationLimit } from "@/creative/types";
import type { ProductCandidate, ProductDecision, ProductExperiment } from "@/products/types";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { creativeRuntimeWorkflow } from "@/workflows/creative-runtime";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const value = (form: FormData, key: string) => typeof form.get(key) === "string" ? String(form.get(key)).trim() : "";
function error(message: string): never { redirect(`/dashboard/artifacts?error=${encodeURIComponent(message.slice(0, 350))}`); }
function generationLimit(form: FormData): CreativeGenerationLimit {
  const limit = value(form, "maximumGenerations");
  // Older forms keep the historical two-image bound; new forms explicitly select it.
  if (!limit) return 2;
  if (limit !== "1" && limit !== "2") error("Choose one image with no repair, or up to two images with one repair.");
  return limit === "1" ? 1 : 2;
}
function success(message: string): never { revalidatePath("/dashboard/artifacts"); revalidatePath("/dashboard/products"); redirect(`/dashboard/artifacts?message=${encodeURIComponent(message)}`); }

export async function approveCreativeCandidate(form: FormData) {
  const context = await requireOwnerUiContext(), businessId = value(form, "businessId"), approvalId = value(form, "approvalId");
  if (!uuidPattern.test(approvalId) || !context.businesses.some(b => b.id === businessId)) error("Business or approval reference not found.");
  if (!["confirmOriginalIntent", "confirmTechnicalOnly", "confirmPrintSpec", "confirmTerms", "confirmBudget"].every(key => value(form, key) === "on")) error("Confirm the specific original design, technical scope, print specification, provider terms and total allowance.");
  const design = { concept: value(form, "concept"), audience: value(form, "audience"), designInstructions: value(form, "designInstructions") };
  if (design.concept.length < 3 || design.concept.length > 160 || design.audience.length < 3 || design.audience.length > 160 || design.designInstructions.length < 50 || design.designInstructions.length > 1500) error("Provide the specific original concept, audience and 50–1500 character design instructions.");
  const maximumGenerations = generationLimit(form), maximumMicrousd = Math.round(Number(value(form, "budgetUsd")) * 1_000_000);
  if (!Number.isInteger(maximumMicrousd) || maximumMicrousd < 1 || maximumMicrousd > 1_000_000) error("This technical test allows at most US$1 total across all phases.");
  let quote: Awaited<ReturnType<typeof currentCreativeQuote>>;
  try { quote = await currentCreativeQuote(maximumGenerations); } catch (cause) { error(cause instanceof Error ? cause.message : "Provider quote unavailable."); }
  if (quote.maximumEstimateMicrousd > maximumMicrousd) error("Current conservative estimate exceeds the allowance; no provider call was made.");
  const candidate = await context.supabase.rpc("create_product_candidate", { p_business_id: businessId, p_candidate: {
    concept: design.concept, audience: design.audience, hypothesis: TECHNICAL_HYPOTHESIS,
    originalDesign: true, rightsStatus: "confirmed", sourceDomains: ["etsy.com", "printful.com"] } });
  if (candidate.error || !candidate.data?.candidateId) error(candidate.error?.message ?? "Unable to preserve the original concept.");
  const approval = technicalCreativeApproval(businessId, candidate.data.candidateId, maximumMicrousd, design, approvalId, maximumGenerations);
  try { validateCreativeApproval(approval); } catch (cause) { error(cause instanceof Error ? cause.message : "Invalid approval."); }
  const saved = await context.supabase.rpc("approve_creative_candidate", { p_candidate_id: candidate.data.candidateId, p_approval: approval, p_quote: quote });
  if (saved.error) error(saved.error.message);
  success("Specific technical creative approval saved. It authorizes one bounded run; market validation and publication remain separate.");
}
export async function startCreativeRun(form: FormData) {
  const context = await requireOwnerUiContext(), approvalId = value(form, "approvalId");
  if (!uuidPattern.test(approvalId)) error("Invalid creative approval reference.");
  const existing = await context.supabase.from("creative_approvals").select("business_id").eq("id", approvalId).maybeSingle();
  if (existing.error || !existing.data || !context.businesses.some(b => b.id === existing.data?.business_id)) error("Creative approval not found.");
  const runtimeCapability = `${randomUUID()}${randomUUID()}`, nonce = randomUUID();
  const launch = await context.supabase.rpc("begin_creative_run", { p_approval_id: approvalId, p_launch_nonce: nonce, p_runtime_capability: runtimeCapability });
  if (launch.error) error(launch.error.message);
  if (!launch.data?.shouldStart) success("Duplicate launch prevented. The original creative run and cost reservations remain authoritative.");
  try {
    await start(creativeRuntimeWorkflow, [{ businessId: existing.data.business_id, creativeRunId: launch.data.creativeRunId,
      coreWorkflowRunId: launch.data.workflowRunId, runtimeCapability }]);
  } catch {
    await context.supabase.rpc("fail_creative_launch", { p_creative_run_id: launch.data.creativeRunId, p_launch_nonce: nonce });
    error("Creative launch could not be confirmed. Its reservation is preserved; check the existing run before another attempt.");
  }
  revalidatePath("/dashboard/artifacts"); redirect(`/dashboard/workflows/${launch.data.workflowRunId}`);
}
export async function approveProductionCreativeCandidate(form: FormData) {
  const context = await requireOwnerUiContext(), candidateId = value(form, "candidateId"), decisionId = value(form, "decisionId"), approvalId = value(form, "approvalId");
  if (![candidateId, decisionId, approvalId].every(id => uuidPattern.test(id))) error("Invalid candidate or approval reference.");
  if (!["confirmOriginalIntent", "confirmProductionScope", "confirmPrintSpec", "confirmTerms", "confirmBudget", "confirmPolicyScreen"].every(key => value(form, key) === "on")) error("Confirm the exact candidate, original instructions, policy screen, print specification, terms and allowance.");
  const candidateResult = await context.supabase.from("product_candidates").select("*").eq("id", candidateId).maybeSingle();
  const candidate = candidateResult.data as ProductCandidate | null;
  if (candidateResult.error || !candidate || !context.businesses.some(b => b.id === candidate.business_id)) error("Owned candidate not found.");
  const decisionsResult = await context.supabase.from("product_decisions").select("*").eq("candidate_id", candidate.id).eq("business_id", candidate.business_id).order("created_at", { ascending: false }).limit(2);
  const decisions = (decisionsResult.data ?? []) as ProductDecision[], selected = decisions.find(d => d.id === decisionId);
  if (decisionsResult.error || !selected || selected.id !== decisions[0]?.id) error("The candidate decision changed. Review the current evidence before approving.");
  const experimentResult = await context.supabase.from("product_experiments").select("*").eq("id", selected.experiment_id).eq("candidate_id", candidate.id).eq("business_id", candidate.business_id).maybeSingle();
  const choice = experimentResult.error ? null : currentProductionCandidate(candidate, decisions, experimentResult.data ? [experimentResult.data as ProductExperiment] : []);
  if (!choice) error("Current evidence-backed owner TEST and fresh completed research are required. Unknown evidence cannot be waived by creative approval.");
  const maximumGenerations = generationLimit(form), maximumMicrousd = Math.round(Number(value(form, "budgetUsd")) * 1_000_000);
  if (!Number.isInteger(maximumMicrousd) || maximumMicrousd < 1 || maximumMicrousd > 1_000_000) error("This bounded creative run allows at most US$1 across all phases.");
  let approval: ReturnType<typeof productionCreativeApproval>, quote: Awaited<ReturnType<typeof currentCreativeQuote>>;
  try {
    approval = productionCreativeApproval(choice, { approvalId, designInstructions: value(form, "designInstructions"), rightsStatement: value(form, "rightsStatement"), maximumMicrousd, maximumGenerations,
      policyScreen: SCREEN_CATEGORIES.map(category => ({ category, status: "clear", rationale: value(form, `rationale_${category}`), sourceUrls: value(form, `sources_${category}`).split(/\r?\n/).map(url => url.trim()).filter(Boolean) })) });
    quote = await currentCreativeQuote(maximumGenerations);
  } catch (cause) { error(cause instanceof Error ? cause.message : "Unable to validate the exact production approval."); }
  if (quote.maximumEstimateMicrousd > maximumMicrousd) error("Current conservative estimate exceeds the allowance; no provider call was made.");
  const saved = await context.supabase.rpc("approve_creative_candidate", { p_candidate_id: candidate.id, p_approval: approval, p_quote: quote });
  if (saved.error) error(saved.error.message);
  success("Separate candidate creative approval saved. Review and start its single bounded run when ready; publication is not authorized.");
}
export async function closeExpiredCreativeRun(form: FormData) {
  const context = await requireOwnerUiContext(), runId = value(form, "creativeRunId");
  if (!uuidPattern.test(runId)) error("Invalid creative run reference.");
  const result = await context.supabase.rpc("close_expired_creative_run", { p_creative_run_id: runId });
  if (result.error) error(result.error.message);
  success("Expired run closed for owner review. Existing artifacts, receipts and uncertain reservations are preserved; no provider call was made.");
}
