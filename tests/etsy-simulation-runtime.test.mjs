import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import contracts from "../.core-tests/packs/etsy-simulation-runtime-contract.js";
import discovery from "../.core-tests/packs/etsy-discovery.js";

function snapshot() {
  const releases = discovery.etsyDiscoveryPackReleases();
  const root = releases.find(release => release.manifest.packKey === "workflow.etsy-product-discovery");
  return { rootPackId: root.id, releases, workflow: root.manifest.workflows[0], platformQualification: "stage12", mode: "simulation" };
}

test("hosted simulation accepts only the exact experimental nine-pack Stage 12 snapshot", () => {
  assert.doesNotThrow(() => contracts.assertEtsySimulationSnapshot(snapshot()));
  for (const mutate of [
    value => { delete value.mode; },
    value => { value.platformQualification = "stage11"; },
    value => { value.releases.pop(); },
    value => { value.releases[0].status = "qualified"; },
    value => { value.releases[0].manifest.version = "2.0.0"; },
    value => { value.rootPackId = value.releases[0].id; },
    value => { value.workflow.stages[0].permittedCapabilities.push("marketplace.publish"); },
    value => { value.workflow.stages.reverse(); },
    value => { value.releases.find(release => release.manifest.workers.length).manifest.workers[0].manifest.modelRequirements.qualificationScope = "live"; },
  ]) {
    const value = snapshot(); mutate(value);
    assert.throws(() => contracts.assertEtsySimulationSnapshot(value), /pinned experimental Etsy simulation/);
  }
});

test("hosted workflow wires mock stages, durable persistence, and owner review without research calls", () => {
  const runtime = readFileSync("src/workflows/etsy-discovery-simulation-runtime.ts", "utf8");
  const steps = readFileSync("src/workflows/etsy-discovery-simulation-runtime-steps.ts", "utf8");
  const actions = readFileSync("src/app/dashboard/packs/actions.ts", "utf8");
  assert.match(runtime, /loadInstalledPack/);
  assert.match(runtime, /executeEtsySimulationStage/);
  assert.match(runtime, /persistInstalledPackStage/);
  assert.ok(runtime.indexOf("const review = createHook") < runtime.indexOf("await enterEtsySimulationReview"));
  assert.match(runtime, /await review/);
  assert.match(runtime, /failInstalledPack/);
  assert.match(steps, /executeEtsyDiscoverySimulationWorker/);
  assert.doesNotMatch(steps, /OpenRouterAdapter|collectResearch|executeMarketResearcher/);
  assert.ok(actions.indexOf('rpc("record_etsy_simulation_decision"') < actions.indexOf("resumeHook(etsySimulationReviewHookToken"));
});

test("simulation owner controls never present live approval or activation", () => {
  const ui = readFileSync("src/components/stage7/workflow-visuals.tsx", "utf8");
  const packs = readFileSync("src/app/dashboard/packs/page.tsx", "utf8");
  assert.match(ui, /intervention_type === "etsy_simulation_review"/);
  assert.match(ui, /action=\{acknowledgeEtsySimulation\}/);
  assert.match(ui, /Acknowledge simulated result/);
  assert.match(ui, /Stop simulation/);
  assert.match(packs, /Run Etsy discovery simulation/);
  assert.match(packs, /All nine releases stay experimental/);
});
