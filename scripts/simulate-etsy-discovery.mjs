import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ETSY_DISCOVERY_ROOT, ETSY_DISCOVERY_SAMPLE_INPUT, ETSY_DISCOVERY_WORKFLOW_KEY,
  etsyDiscoveryPackReleases, validateEtsyDiscoveryStageOutput } from "../.core-tests/packs/etsy-discovery.js";
import { FileSimulationRepository, runDurablePackSimulation } from "../.core-tests/packs/durable-simulation.js";
import { EtsyDiscoverySimulationAdapter } from "../.core-tests/packs/etsy-simulation-worker.js";

// Calls the real router with a mock provider; never calls live providers or writes to Supabase.
const outputPath = process.argv[2];
const runKey = process.argv[3] ?? `stage12:${randomUUID()}`;
const repository = new FileSimulationRepository(join(tmpdir(), "agent-labs-simulations"));
const adapter = new EtsyDiscoverySimulationAdapter();
const result = await runDurablePackSimulation({ mode: "simulation", releases: etsyDiscoveryPackReleases(),
  root: ETSY_DISCOVERY_ROOT, workflowKey: ETSY_DISCOVERY_WORKFLOW_KEY, input: ETSY_DISCOVERY_SAMPLE_INPUT,
  runKey, repository, adapter, providerType: "mock", now: new Date(), validateStageOutput: validateEtsyDiscoveryStageOutput });
if (outputPath) writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ mode: result.mode, runKey, status: result.status, stages: result.stages.map(stage => stage.stageKey),
  outcome: result.output?.outcome, publicationAllowed: result.output?.publicationAllowed,
  providerType: result.providerType, mockCallsThisInvocation: adapter.requests.length,
  qualificationEvaluated: result.qualificationEvaluated, eventCount: result.events.length, receiptCount: result.receipts.length,
  report: outputPath ?? null }, null, 2));
if (result.status !== "completed") process.exitCode = 1;
