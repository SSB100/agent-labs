import type { PackSnapshot } from "./types";

export const ETSY_SIMULATION_PACK_KEYS = [
  "knowledge.etsy-current-policy", "knowledge.etsy-selling", "knowledge.print-on-demand",
  "knowledge.product-research", "knowledge.social-marketing", "worker.etsy-market-researcher",
  "worker.etsy-product-strategist", "worker.etsy-reviewer", "workflow.etsy-product-discovery",
] as const;

/** This exception permits only the fixed experimental Stage 12 simulation closure. */
export function assertEtsySimulationSnapshot(snapshot: PackSnapshot) {
  const tagged = snapshot as PackSnapshot & { platformQualification?: string; mode?: string };
  const root = snapshot.releases.find(release => release.id === snapshot.rootPackId);
  if (tagged.platformQualification !== "stage12" || tagged.mode !== "simulation" ||
    root?.manifest.packKey !== "workflow.etsy-product-discovery" ||
    snapshot.workflow.key !== "etsy.product-discovery-simulation" || snapshot.workflow.version !== "1.0.0" ||
    snapshot.releases.length !== ETSY_SIMULATION_PACK_KEYS.length ||
    snapshot.releases.some(release => release.status !== "experimental" || release.manifest.version !== "1.0.0") ||
    JSON.stringify(snapshot.releases.map(release => release.manifest.packKey).sort()) !== JSON.stringify(ETSY_SIMULATION_PACK_KEYS) ||
    snapshot.workflow.stages.map(stage => stage.key).join(",") !== "research,strategy,review" ||
    snapshot.workflow.stages.some(stage => stage.permittedCapabilities.length > 0) ||
    snapshot.releases.some(release => release.manifest.capabilities.length > 0 || release.manifest.workers.some(worker =>
      worker.execution.kind !== "model_router" || worker.manifest.capabilityPolicy.allowed.length > 0 ||
      worker.manifest.modelRequirements.qualificationScope !== "simulation_only"))) {
    throw new Error("Only the pinned experimental Etsy simulation is permitted.");
  }
}
