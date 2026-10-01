import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { creativePackManifests } = require("../.core-tests/creative/packs.js");
const { etsyKnowledgePackManifests } = require("../.core-tests/packs/etsy-knowledge.js");
const { resolvePackDependencies, validateResolvedDefinitions } = require("../.core-tests/packs/dependencies.js");
const { executeCreativeWorker } = require("../.core-tests/creative/workers.js");
const { technicalCreativeApproval } = require("../.core-tests/creative/proposal.js");
const { creativeHash } = require("../.core-tests/creative/contracts.js");
const { parseCreativeModelQuote } = require("../.core-tests/creative/budget.js");
const { SCREEN_CATEGORIES, REVIEW_CRITERIA } = require("../.core-tests/creative/types.js");
const { assertJsonSchemaValue } = require("../.core-tests/workers/schema-validator.js");
const { projectProviderJsonSchema } = require("../.core-tests/models/openrouter.js");
const { creativeOutputLimits } = require("../.core-tests/creative/output-limits.js");
const { DESIGN_BRIEF_SCHEMA, BRIEF_SCREEN_SCHEMA, DESIGN_REVIEW_SCHEMA } = require("../.core-tests/creative/packs.js");
const id = n => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const catalog = { data: [{ id: "openai/gpt-5.6-luna", pricing: { prompt: "0.0000002", completion: "0.0000012" } }, { id: "anthropic/claude-haiku-4.5", pricing: { prompt: "0.000001", completion: "0.000005", input_cache_write_1h: "0.000002" } }] };
const prices = async model => parseCreativeModelQuote(catalog, model);
function approval() { const a = technicalCreativeApproval(id(1), id(2), 1000000, { concept: "Synthetic geometric tree fixture", audience: "Adult synthetic test audience", designInstructions: "Synthetic test-only original tree arrangement on an intentional opaque square; no protected elements or reference images." }, id(3)); a.printSpecification.verifiedAt = new Date().toISOString(); return a; }
function brief(a) { return { version: "1.0", approvalId: a.approvalId, audience: a.audience, concept: a.concept, style: "Simple original flat graphic illustration", hierarchy: "Three pine trees below one circular sun", typography: "No text, letters or words in the artwork", placement: a.printSpecification.placement, garmentCompatibility: a.printSpecification.garment, colors: ["#245432", "#FFF5DB"], forbiddenElements: ["brands", "logos", "protected characters"], originalityRequirements: "Original composition without third-party references or imitation", imagePrompt: "Original simple three-pine-tree and sun illustration on an intentional opaque cream square, no text or named brands, no protected characters, no reference artwork." }; }
function setup(key, a, b = null) {
  const worker = creativePackManifests().find(p => p.packKey === (key === "brief:1" ? "worker.etsy-creative-director" : "worker.etsy-creative-reviewer")).workers[0];
  const artifacts = [{ id: id(4), artifactType: "creative.approval", name: "Synthetic test approval", mediaType: "application/json", content: a, metadata: {} }];
  if (b) artifacts.push({ id: id(5), artifactType: "creative.brief", name: "Synthetic brief", mediaType: "application/json", content: b, metadata: {} });
  for (const [index, k] of etsyKnowledgePackManifests().flatMap(p => p.knowledge).filter(k => ["etsy.current-policy", "pod.production"].includes(k.key)).entries()) artifacts.push({ id: id(10 + index), artifactType: "pack.knowledge", name: k.name, mediaType: "application/json", content: k.content, metadata: { knowledgeKey: k.key, verifiedAt: k.verifiedAt } });
  return { worker, context: { taskContract: { id: id(20), objective: "Produce exactly the scoped creative worker output", inputArtifactIds: artifacts.map(a => a.id), permittedCapabilities: [], requiredKnowledge: ["etsy.current-policy", "pod.production"], requiredOutputSchema: worker.manifest.outputSchema, completionCriteria: { exactScope: true }, failureCriteria: { stopOnMissingData: true }, nonGoals: ["No publication or strategy change"], escalationRules: { maximumAttempts: 1 } }, inputArtifacts: artifacts } };
}
function harness(output, fail = false) {
  const requests = [], reservations = [], settlements = [];
  return { requests, reservations, settlements, ledger: { reserve: async r => { reservations.push(r); return { shouldExecute: true, committedMicrousd: r.reservedMicrousd }; }, record: async (...args) => settlements.push(args) },
    adapter: { invokeStructured: async request => { requests.push(request); if (fail) throw new Error("Synthetic provider failure"); return { output, provider: "openrouter", providerModelId: request.model.providerModelId, providerRequestId: "synthetic-test-only", latencyMs: 1, metadata: {}, usage: { inputTokens: 100, outputTokens: 100, totalTokens: 200, cachedInputTokens: 0, reasoningTokens: 0, reportedCostUsd: 0, estimatedCostUsd: 0 } }; } } };
}
test("creative manifests resolve exact global knowledge dependencies and no worker has image or commerce authority", () => {
  const manifests = [...creativePackManifests(), ...etsyKnowledgePackManifests()];
  const closure = resolvePackDependencies(manifests.map((manifest, i) => ({ id: id(i + 30), status: "experimental", manifest })), { packKey: "workflow.etsy-creative-pipeline", version: "1.0.0" }, true);
  validateResolvedDefinitions(closure);
  for (const worker of creativePackManifests().flatMap(p => p.workers)) assert.deepEqual(worker.manifest.capabilityPolicy.allowed, []);
});
test("Director's complete scoped knowledge context fits its declared budget and fixed Luna route", async () => {
  const a = approval(), b = brief(a), h = harness(b), scoped = setup("brief:1", a);
  const result = await executeCreativeWorker({ callKey: "brief:1", approval: a, brief: null, ...scoped, ...h, prices });
  assert.deepEqual(result.output, b); assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].model.providerModelId, "openai/gpt-5.6-luna"); assert.equal(h.requests[0].maxOutputTokens, 2500);
  assert.deepEqual(h.requests[0].providerOnly, ["openai"]); assert.ok(h.reservations[0].estimate.textRequestBytes < 24576);
  assert.equal(JSON.parse(h.requests[0].messages[1].content).outputLimits, creativeOutputLimits(DESIGN_BRIEF_SCHEMA));
  assert.match(h.requests[0].messages[0].content, /10–600 characters/);
  assert.match(h.requests[0].messages[0].content, /#RRGGBB/);
  assert.equal(h.settlements[0][3].outputValidated, true);
});
test("final brief screen uses Claude and exact immutable approval/brief hashes", async () => {
  const a = approval(), b = brief(a), screen = { version: "1.0", briefHash: creativeHash(b), approvalHash: creativeHash(a), checks: SCREEN_CATEGORIES.map(category => ({ category, status: "clear", rationale: "Synthetic test-only screen of the requested generic original illustration." })), outcome: "PASS" };
  const h = harness(screen); await executeCreativeWorker({ callKey: "screen:1", approval: a, brief: b, ...setup("screen:1", a, b), ...h, prices });
  assert.equal(h.requests[0].model.providerModelId, "anthropic/claude-haiku-4.5"); assert.equal(h.requests[0].maxOutputTokens, 1800);
  assert.ok(h.reservations[0].estimate.textRequestBytes < 24576);
  assert.equal(JSON.parse(h.requests[0].messages[1].content).outputLimits, creativeOutputLimits(BRIEF_SCREEN_SCHEMA));
  const wrong = harness({ ...screen, approvalHash: "a".repeat(64) });
  await assert.rejects(() => executeCreativeWorker({ callKey: "screen:1", approval: a, brief: b, ...setup("screen:1", a, b), ...wrong, prices }), /hash-bound/);
});
test("visual Reviewer gets actual pixels; one failure never falls back to creator family", async () => {
  const a = approval(), b = brief(a), inspection = { sha256: "a".repeat(64), bytes: 3, failedCriteria: [] };
  const review = { version: "1.0", assetHash: inspection.sha256, briefHash: creativeHash(b), checks: REVIEW_CRITERIA.map(criterion => ({ criterion, outcome: "PASS", rationale: "Synthetic test-only criterion result for contract testing." })), outcome: "PASS", repairInstruction: null };
  const h = harness(review); await executeCreativeWorker({ callKey: "review:1", approval: a, brief: b, inspection, imageBytes: new Uint8Array([1, 2, 3]), ...setup("review:1", a, b), ...h, prices });
  assert.equal(h.requests[0].messages[1].images[0].base64, "AQID"); assert.deepEqual(h.requests[0].providerOnly, ["anthropic"]);
  assert.equal(JSON.parse(h.requests[0].messages[1].content).outputLimits, creativeOutputLimits(DESIGN_REVIEW_SCHEMA));
  const failed = harness(null, true);
  await assert.rejects(() => executeCreativeWorker({ callKey: "review:1", approval: a, brief: b, inspection, imageBytes: new Uint8Array([1, 2, 3]), ...setup("review:1", a, b), ...failed, prices }), /Synthetic provider failure/);
  assert.equal(failed.requests.length, 1); assert.equal(failed.settlements[0][1], null);
});
test("provider-stripped phase bounds are explicit in compact prompts while local checks remain strict", () => {
  const b = brief(approval()); b.style = 'x'.repeat(601);
  assert.doesNotThrow(() => assertJsonSchemaValue(projectProviderJsonSchema(DESIGN_BRIEF_SCHEMA), b, 'Provider'));
  assert.throws(() => assertJsonSchemaValue(DESIGN_BRIEF_SCHEMA, b, 'Local'), /JSON schema/);
  const briefLimits = creativeOutputLimits(DESIGN_BRIEF_SCHEMA);
  for (const field of ['style', 'hierarchy', 'typography', 'originalityRequirements']) assert.ok(briefLimits.includes(`${field}: 1–600 characters`));
  assert.match(briefLimits, /imagePrompt: 1–3500 characters/);
  assert.match(briefLimits, /colors: 1–6 items/);
  assert.match(briefLimits, /forbiddenElements\[\]: 1–120 characters/);
  assert.match(creativeOutputLimits(BRIEF_SCREEN_SCHEMA), /checks: 8–8 items/);
  assert.match(creativeOutputLimits(DESIGN_REVIEW_SCHEMA), /checks: 5–5 items/);
  assert.match(creativeOutputLimits(DESIGN_REVIEW_SCHEMA), /checks\[\]\.rationale: 1–700 characters/);
});
test("schema anyOf enforces at least one real alternative including nullable repair", () => {
  assertJsonSchemaValue({ anyOf: [{ type: "null" }, { type: "string", minLength: 3 }] }, null, "Nullable");
  assert.throws(() => assertJsonSchemaValue({ anyOf: [{ type: "null" }, { type: "string", minLength: 3 }] }, "x", "Nullable"), /JSON schema/);
  assert.throws(() => assertJsonSchemaValue({ type: "object", anyOf: [] }, {}, "Invalid"), /JSON schema/);
});
