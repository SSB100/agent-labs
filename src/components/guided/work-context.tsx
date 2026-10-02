import Link from "next/link";

import type { ProductExperimentRecord } from "@/products/types";
import type { ArtifactRecord, WorkflowDefinitionRecord, WorkflowRunRecord } from "@/lib/core-ui/workflows";
import { statusLabel } from "@/lib/core-ui/workflows";

import "./work-context.css";

export function workDisplayTitle(definition?: WorkflowDefinitionRecord | null) {
  const key = definition?.workflow_key ?? "";
  if (key.startsWith("product.discovery-v2.")) return "Market research";
  if (key === "etsy.creative-pipeline") return "Creative design";
  if (key === "synthetic.core.runtime-proof") return "Workflow demo";
  return definition?.name ?? "Saved work";
}

export function researchGoalFromRecords(run: WorkflowRunRecord, experiments: readonly ProductExperimentRecord[], artifacts: readonly ArtifactRecord[]) {
  if (typeof run.input.intentId !== "string" || !run.input.intentId) return null;
  const root = experiments.find(item => item.workflow_run_id === run.id && item.business_id === run.business_id && item.id === run.input.intentId && item.discovery_version === "pod-discovery-2.0");
  const artifact = artifacts.find(item => item.workflow_run_id === run.id && item.business_id === run.business_id && item.artifact_type === "product.discovery-intent.v2" && item.metadata.intentId === run.input.intentId);
  const intent = root?.variables.intent ?? artifact?.content?.intent;
  if (!intent || typeof intent !== "object" || Array.isArray(intent) || !("version" in intent) || intent.version !== "pod-discovery-2.0" || !("objective" in intent) || typeof intent.objective !== "string") return null;
  return intent.objective.length >= 20 && intent.objective.length <= 1200 ? intent.objective : null;
}

export function WorkContext({ run, definition, goal }: { run: WorkflowRunRecord; definition?: WorkflowDefinitionRecord | null; goal?: string | null }) {
  const key = definition?.workflow_key ?? "";
  const research = key.startsWith("product.discovery-v2.");
  const creative = key === "etsy.creative-pipeline";
  const business = encodeURIComponent(run.business_id);
  if (!research && !creative) return key.startsWith("synthetic.") ? <p className="coreNotice">Demo workflow · this tests the runtime. It does not research, design or sell a real product.</p> : null;
  const stages = [
    { name: "Research", state: research ? statusLabel(run.status) : "Evidence required", href: `/dashboard/products?view=results&business=${business}#discovery-goal-results`, current: research },
    { name: "Design", state: creative ? statusLabel(run.status) : "Separate approval required", href: `/dashboard/artifacts?business=${business}`, current: creative },
    { name: "Product", state: "Implementation incomplete", href: `/dashboard/printful?business=${business}`, current: false },
    { name: "Listing", state: "Qualified product required", href: `/dashboard/etsy?business=${business}`, current: false },
    { name: "Publish", state: "Fee evidence required", href: `/dashboard/etsy?business=${business}#publication-title`, current: false },
  ];
  return <section className="guidedWorkContext" aria-labelledby="guided-work-context-heading">
    <div className="guidedWorkGoal"><p className="coreEyebrow">{research ? "Research quest" : "Design workflow"}</p><h2 id="guided-work-context-heading">{goal ?? (creative ? "Review this exact creative output" : "Review the saved research goal")}</h2><p>Each step keeps its own evidence and approval. This run cannot automatically advance into design, publishing or fulfilment.</p></div>
    <ol className="guidedJourney" aria-label="Product journey and prerequisites">{stages.map(stage => <li key={stage.name} data-current={stage.current}><Link href={stage.href} aria-current={stage.current ? "step" : undefined}><strong>{stage.name}</strong><span>{stage.state}</span><small>{stage.current ? "Current stage" : "View requirements"}</small></Link></li>)}</ol>
    <p className="guidedJourneyBoundary">Product placement, the Etsy-to-Printful variant link and supplier confirmation checks are not yet implemented. Unknown fees still block publication. Automatic order sync and fulfilment remain unavailable.</p>
  </section>;
}
