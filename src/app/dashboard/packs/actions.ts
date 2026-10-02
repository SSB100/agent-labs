"use server";
import { randomUUID } from "node:crypto";
import { safeConsoleDecisionReturnPath, consoleDecisionActionReturnPath } from "@/lib/core-ui/console-decisions-query";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { resumeHook, start } from "workflow/api";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { resolvePackDependencies, validateResolvedDefinitions } from "@/packs/dependencies";
import { validatePackManifest } from "@/packs/registry";
import type { PackRelease, PackSnapshot } from "@/packs/types";
import { assertJsonSchemaValue } from "@/workers/schema-validator";
import { installedPackRuntimeWorkflow } from "@/workflows/installed-pack-runtime";
import { etsyDiscoverySimulationRuntimeWorkflow, etsySimulationReviewHookToken, type EtsySimulationReviewDecision } from "@/workflows/etsy-discovery-simulation-runtime";

function text(form: FormData,key: string) { const v=form.get(key); return typeof v === "string" ? v.trim() : ""; }
function fail(message: string): never { redirect(`/dashboard/packs?error=${encodeURIComponent(message.slice(0,250))}`); }

export async function activatePack(form: FormData) {
  const context = await requireOwnerUiContext();
  const businessId = text(form,"businessId"), packId=text(form,"packId");
  if (!context.businesses.some(b=>b.id===businessId)) fail("Business not found.");
  const {data,error} = await context.supabase.from("packs").select("id,status,manifest");
  if (error) fail("Pack catalog could not be loaded.");
  try {
    const releases = (data??[]) as PackRelease[];
    const root = releases.find(r=>r.id===packId);
    if (!root) throw new Error("Pack release not found.");
    validatePackManifest(root.manifest);
    const resolved = resolvePackDependencies(releases,{packKey:root.manifest.packKey,version:root.manifest.version});
    validateResolvedDefinitions(resolved);
  } catch(error) { fail(error instanceof Error ? error.message : "Pack cannot be activated."); }
  const activated = await context.supabase.rpc("activate_business_pack",{p_business_id:businessId,p_pack_id:packId});
  if (activated.error) fail(activated.error.message);
  revalidatePath("/dashboard/packs");
  redirect("/dashboard/packs?message=Pack%20activated.");
}

export async function qualifyWebResearch(form:FormData) {
  const context=await requireOwnerUiContext(),businessId=text(form,"businessId");
  if (!context.businesses.some(b=>b.id===businessId)) fail("Business not found.");
  const runtimeCapability=`${randomUUID()}${randomUUID()}`,nonce=randomUUID();
  const reserved=await context.supabase.rpc("begin_web_research_qualification",{p_business_id:businessId,p_idempotency_key:text(form,"idempotencyKey"),p_launch_nonce:nonce,p_runtime_capability:runtimeCapability});
  if (reserved.error) fail(reserved.error.message);
  const launch=reserved.data as {workflowRunId:string;shouldStart:boolean};
  if (launch.shouldStart) {
    try { await start(installedPackRuntimeWorkflow,[{businessId,coreWorkflowRunId:launch.workflowRunId,runtimeCapability,qualification:"stage11"}]); }
    catch(error) {
      console.error("Unable to launch Web Research qualification",error);
      await context.supabase.from("workflow_runs").update({status:"failed",runtime_launch_status:"launch_failed",completed_at:new Date().toISOString()}).eq("id",launch.workflowRunId).eq("business_id",businessId).eq("runtime_launch_nonce",nonce);
      fail("Web Research qualification could not start.");
    }
  }
  redirect(`/dashboard/workflows/${launch.workflowRunId}`);
}

export async function launchInstalledPack(form: FormData) {
  const context = await requireOwnerUiContext();
  const businessId=text(form,"businessId"), installationId=text(form,"installationId"), workflowKey=text(form,"workflowKey");
  if (!context.businesses.some(b=>b.id===businessId)) fail("Business not found.");
  const installed = await context.supabase.from("installed_packs").select("snapshot").eq("id",installationId).eq("business_id",businessId).eq("status","active").single();
  if (installed.error) fail("Active installation not found.");
  let input: Record<string,unknown>;
  try {
    const raw=text(form,"input");
    if (raw.length>50000) throw new Error("Workflow input is too large.");
    input=JSON.parse(raw);
    const snapshot=installed.data.snapshot as PackSnapshot;
    const root=snapshot.releases.find(r=>r.id===snapshot.rootPackId);
    const workflow=root?.manifest.workflows.find(w=>w.key===workflowKey);
    if (!workflow) throw new Error("Installed workflow not found.");
    assertJsonSchemaValue(workflow.inputSchema,input,"Workflow input");
  } catch(error) { fail(error instanceof Error ? error.message : "Invalid workflow input."); }
  const runtimeCapability=`${randomUUID()}${randomUUID()}`, nonce=randomUUID();
  const idempotencyKey=text(form,"idempotencyKey");
  const reserved=await context.supabase.rpc("begin_installed_pack_run",{p_business_id:businessId,p_installation_id:installationId,p_workflow_key:workflowKey,p_input:input!,p_idempotency_key:idempotencyKey,p_launch_nonce:nonce,p_runtime_capability:runtimeCapability});
  if (reserved.error) fail(reserved.error.message);
  const launch=reserved.data as {workflowRunId:string;shouldStart:boolean};
  if (launch.shouldStart) {
    try { await start(installedPackRuntimeWorkflow,[{businessId,coreWorkflowRunId:launch.workflowRunId,runtimeCapability}]); }
    catch(error) {
      console.error("Unable to launch installed pack",error);
      await context.supabase.from("workflow_runs").update({status:"failed",runtime_launch_status:"launch_failed",completed_at:new Date().toISOString()}).eq("id",launch.workflowRunId).eq("business_id",businessId).eq("runtime_launch_nonce",nonce);
      fail("Workflow could not start. Try a new launch.");
    }
  }
  revalidatePath("/dashboard/workflows");
  redirect(`/dashboard/workflows/${launch.workflowRunId}`);
}

export async function runEtsyDiscoverySimulation(form: FormData) {
  const context = await requireOwnerUiContext(), businessId = text(form, "businessId");
  if (!context.businesses.some(business => business.id === businessId)) fail("Business not found.");
  const runtimeCapability = `${randomUUID()}${randomUUID()}`, nonce = randomUUID();
  const reserved = await context.supabase.rpc("begin_etsy_discovery_simulation", {
    p_business_id: businessId, p_idempotency_key: text(form, "idempotencyKey"),
    p_launch_nonce: nonce, p_runtime_capability: runtimeCapability,
  });
  if (reserved.error) fail(reserved.error.message);
  const launch = reserved.data as { workflowRunId: string; shouldStart: boolean };
  if (launch.shouldStart) {
    try {
      await start(etsyDiscoverySimulationRuntimeWorkflow, [{ businessId, coreWorkflowRunId: launch.workflowRunId,
        runtimeCapability, qualification: "stage12", mode: "simulation" }]);
    } catch (error) {
      console.error("Unable to launch Etsy discovery simulation", error);
      await context.supabase.from("workflow_runs").update({ status: "failed", runtime_launch_status: "launch_failed", completed_at: new Date().toISOString() })
        .eq("id", launch.workflowRunId).eq("business_id", businessId).eq("runtime_launch_nonce", nonce);
      fail("Etsy discovery simulation could not start. No external provider was called.");
    }
  }
  revalidatePath("/dashboard/workflows");
  redirect(`/dashboard/workflows/${launch.workflowRunId}`);
}

export async function acknowledgeEtsySimulation(form: FormData) {
  const context = await requireOwnerUiContext();
  const decision = text(form, "decision");
  const interventionId = text(form, "interventionId");
  let returnTo = consoleDecisionActionReturnPath(safeConsoleDecisionReturnPath(form.get("returnTo")), { interventionId });
  const failReview = (message: string, code: string): never => {
    if (returnTo) redirect(`${returnTo}&error=${code}`);
    fail(message);
  };
  if (!["acknowledge", "stop"].includes(decision)) failReview("Invalid simulation decision.", "invalid-simulation-decision");
  const recorded = await context.supabase.rpc("record_etsy_simulation_decision", {
    p_intervention_id: text(form, "interventionId"), p_decision: decision,
  });
  if (recorded.error) failReview(recorded.error.message, "simulation-decision-failed");
  if (returnTo) {
    const saved = await context.supabase.from("owner_interventions").select("id,business_id,workflow_run_id").eq("id", interventionId).maybeSingle().then(result => result, () => ({ data: null, error: true }));
    const savedNotice = saved.data;
    if (!saved.error && savedNotice?.id === interventionId && savedNotice.workflow_run_id === recorded.data?.workflowRunId && context.businesses.some(business => business.id === savedNotice.business_id)) {
      returnTo = consoleDecisionActionReturnPath(returnTo, { interventionId, businessId: savedNotice.business_id }) ?? `/dashboard?view=decisions&decision=${encodeURIComponent(interventionId)}`;
    }
  }
  const review = recorded.data as { workflowRunId: string; shouldResume: boolean; decision: EtsySimulationReviewDecision };
  if (review.shouldResume) {
    try { await resumeHook(etsySimulationReviewHookToken(review.workflowRunId), review.decision); }
    catch (error) {
      // A repeated click may arrive after the hook was consumed. Only report success
      // when durable state confirms closure; otherwise keep the retryable decision open.
      const run = await context.supabase.from("workflow_runs").select("status").eq("id", review.workflowRunId).maybeSingle();
      if (!["completed", "cancelled"].includes(run.data?.status ?? "")) {
        console.error("Unable to deliver recorded simulation decision", error);
        failReview("Your simulation decision is saved. Return to Needs You and retry the same choice to finish delivery.", "simulation-delivery-pending");
      }
    }
  }
  for (const path of ["/dashboard", "/dashboard/needs-you", "/dashboard/workflows", "/dashboard/history", `/dashboard/workflows/${review.workflowRunId}`]) revalidatePath(path);
  if (returnTo) redirect(`${returnTo}&message=simulation-decision-recorded`);
  redirect(`/dashboard/workflows/${review.workflowRunId}`);
}
