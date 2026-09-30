import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import discovery from "../.core-tests/packs/etsy-discovery.js";
import registry from "../.core-tests/packs/registry.js";
import dependencies from "../.core-tests/packs/dependencies.js";
import schema from "../.core-tests/workers/schema-validator.js";
import modelRegistry from "../.core-tests/models/registry.js";

const now = "2026-09-30T08:00:00Z";
const input = () => structuredClone(discovery.ETSY_DISCOVERY_SAMPLE_INPUT);
const manifests = () => discovery.etsyDiscoveryPackManifests();
const releases = () => discovery.etsyDiscoveryPackReleases();
const fixtures = () => discovery.etsyDiscoveryFixtures(input());
const run = (options = {}) => discovery.simulateEtsyProductDiscovery({ now, ...options });

test("Stage 12 registers five substantive knowledge packs, three scoped workers and one pinned workflow", () => {
  const catalog = manifests();
  assert.equal(catalog.length, 9);
  for (const manifest of catalog) registry.validatePackManifest(manifest);
  assert.equal(catalog.filter(pack => pack.kind === "knowledge").length, 5);
  assert.equal(catalog.filter(pack => pack.kind === "worker").length, 3);
  const resolved = dependencies.resolvePackDependencies(releases(), discovery.ETSY_DISCOVERY_ROOT, true);
  assert.equal(resolved.length, 9);
  for (const knowledge of catalog.flatMap(pack => pack.knowledge)) {
    assert.equal(knowledge.version, "1.0.0");
    assert.match(knowledge.source, /^https:\/\//);
    assert.ok(Date.parse(knowledge.verifiedAt) <= Date.parse(now));
    assert.ok(knowledge.freshnessDays > 0 && knowledge.freshnessDays <= 90);
    assert.ok(knowledge.content.guidelines.length >= 5);
    assert.equal(new Set(knowledge.content.guidelines.map(rule => rule.id)).size, knowledge.content.guidelines.length);
    for (const rule of knowledge.content.guidelines) {
      assert.match(rule.sourceUrl, /^https:\/\//);
      assert.ok(rule.statement.length > 20);
      assert.ok(["platform_rule", "guidance", "implementation_inference"].includes(rule.kind));
    }
  }
});

test("discovery produces three contract-bound artifacts with exact scoped knowledge and no live qualification", () => {
  const result = run();
  assert.deepEqual(result.stages.map(stage => stage.stageKey), ["research", "strategy", "review"]);
  assert.equal(result.output.outcome, "needs_evidence");
  assert.equal(result.output.publicationAllowed, false);
  assert.equal(result.output.liveQualification, false);
  assert.equal(result.providerExecuted, false);
  assert.equal(result.qualificationEvaluated, false);
  for (const stage of result.stages) {
    const scope = stage.context.taskContract.requiredKnowledge;
    const artifacts = stage.context.inputArtifacts.filter(artifact => artifact.artifactType === "pack.knowledge");
    assert.deepEqual(artifacts.map(artifact => artifact.metadata.knowledgeKey), scope);
    assert.deepEqual(stage.context.taskContract.permittedCapabilities, []);
    assert.equal(stage.receipt.executionMode, "simulation.fixture");
    assert.equal(stage.receipt.outputValidated, true);
    for (const citation of stage.outputArtifact.content.knowledgeCitations) {
      const artifact = artifacts.find(entry => entry.metadata.knowledgeKey === citation.knowledgeKey);
      const rule = artifact.content.guidelines.find(entry => entry.id === citation.guidelineId);
      assert.equal(citation.statement, rule.statement);
      assert.equal(citation.sourceUrl, rule.sourceUrl);
      assert.equal(citation.kind, rule.kind);
    }
  }
  assert.equal(result.stages[2].receipt.configuredExecutor.routeKey, "reviewer.independent");
  assert.equal(result.stages[0].receipt.configuredExecutor.routeKey, "standard.default");
});

test("Reviewer uses the qualified independent route and arbitrary or inconsistent routes fail closed", () => {
  const reviewer = manifests().find(pack => pack.packKey === "worker.etsy-reviewer");
  assert.equal(reviewer.workers[0].execution.routeKey, "reviewer.independent");
  assert.equal(modelRegistry.resolveModelRoute("reviewer.independent").route.primaryModelKey, "claude.haiku.review");
  const bad = structuredClone(reviewer);
  bad.workers[0].execution.routeKey = "untrusted.model";
  assert.throws(() => registry.validatePackManifest(bad), /Untrusted model route/);
  bad.workers[0].execution.routeKey = "standard.default";
  assert.throws(() => registry.validatePackManifest(bad), /route declaration mismatch/);
  assert.match(readFileSync("src/workflows/installed-pack-runtime-steps.ts", "utf8"), /routeKey:worker.execution.routeKey/);
});

test("experimental releases remain unavailable for normal activation and worker fixtures satisfy schemas", () => {
  assert.throws(() => dependencies.resolvePackDependencies(releases(), discovery.ETSY_DISCOVERY_ROOT), /not qualified/);
  for (const pack of manifests()) for (const worker of pack.workers) {
    for (const example of worker.manifest.examples) schema.assertJsonSchemaValue(worker.manifest.outputSchema, example.expectedOutput, "Example");
    assert.deepEqual(worker.manifest.capabilityPolicy.allowed, []);
    assert.ok(worker.manifest.capabilityPolicy.forbidden.includes("marketplace.publish"));
  }
});

test("unsupported claims, source links, classifications and omitted knowledge cannot masquerade as evidence", () => {
  for (const key of ["statement", "sourceUrl", "kind"]) {
    const value = fixtures();
    value.review.knowledgeCitations[0][key] = key === "kind" ? "implementation_inference" : "invented";
    assert.throws(() => run({ fixtures: value }), /Unsupported knowledge claim/);
  }
  const missing = fixtures();
  missing.review.knowledgeCitations = missing.review.knowledgeCitations.filter(citation => citation.knowledgeKey !== "product.research");
  assert.throws(() => run({ fixtures: missing }), /required scoped knowledge/);
  const foreign = fixtures();
  foreign.review.knowledgeCitations[0].knowledgeKey = "social.marketing";
  assert.throws(() => run({ fixtures: foreign }), /schema/);
  const invented = fixtures();
  invented.review.knowledgeCitations[0].guidelineId = "sales-guaranteed";
  assert.throws(() => run({ fixtures: invented }), /Missing scoped guideline|Unsupported knowledge claim/);
});

test("policy, rights and disclosure gates stop simulated concepts without inventing research", () => {
  for (const [key, value] of [["originalDesign", false], ["rightsStatus", "unclear"], ["productionPartnerDisclosed", false]]) {
    const concept = input(); concept.concept[key] = value;
    assert.equal(run({ input: concept }).output.outcome, "blocked");
    const bypass = discovery.etsyDiscoveryFixtures(concept); bypass.review.outcome = "needs_evidence";
    assert.throws(() => run({ input: concept, fixtures: bypass }), /bypasses policy/);
  }
  const ai = input(); ai.concept.usesAi = true;
  assert.ok(run({ input: ai }).output.reasons.includes("ai_disclosure_required"));
  const live = input(); live.mode = "live";
  assert.throws(() => run({ input: live }), /schema/);
  const publish = fixtures(); publish.review.publicationAllowed = true;
  assert.throws(() => run({ fixtures: publish }), /schema/);
});

test("upstream artifacts, knowledge dates and production capability scope are enforced", () => {
  const changed = fixtures(); changed.strategy.research = structuredClone(changed.research);
  changed.strategy.research.concept.name = "Mutated concept";
  assert.throws(() => run({ fixtures: changed }), /changed its upstream artifact/);
  const invented = fixtures();
  invented.research.observations = [{ id: "fake-demand", sourceUrl: "fixture://invented", statement: "A winning product", classification: "fixture" }];
  assert.throws(() => run({ fixtures: invented }), /market observations|no observed market evidence/);
  assert.throws(() => run({ now: "2026-10-30T08:00:00Z" }), /expired/);
  assert.throws(() => run({ now: "2026-09-29T00:00:00Z" }), /future/);
  const bad = releases(); bad.find(pack => pack.manifest.kind === "worker").manifest.workers[0].manifest.capabilityPolicy.allowed.push("money.spend");
  assert.throws(() => run({ releases: bad }), /both allowed and forbidden|missing|external/);
});

test("committed catalog is generated from exactly the reviewed Stage 12 definitions", () => {
  assert.deepEqual(JSON.parse(readFileSync("packs/etsy-catalog.json", "utf8")), manifests());
});

test("unattributed factual findings and bypassed prerequisites fail even with correct citations", () => {
  const misleading = fixtures(); misleading.strategy.hypothesis = "This product had 5000 real sales and guarantees a 90% profit margin";
  assert.throws(() => run({ fixtures: misleading }), /schema/);
  const unchecked = fixtures(); unchecked.strategy.requiredChecks = ["verify_product_print_specs"];
  assert.throws(() => run({ fixtures: unchecked }), /omitted policy|omitted evidence/);
  const falseReview = fixtures(); falseReview.review.reasons = ["ai_disclosure_required"];
  assert.throws(() => run({ fixtures: falseReview }), /bypasses policy|omitted evidence/);
  const altered = fixtures(); altered.strategy.hypothesis.audience = "Another audience";
  assert.throws(() => run({ fixtures: altered }), /Unsupported findings/);
  const maximum = input(); maximum.concept.name = "a".repeat(2000); maximum.concept.audience = "b".repeat(2000);
  assert.equal(run({ input: maximum }).output.outcome, "needs_evidence");
});

test("semantically identical JSON may reorder keys without changing the upstream artifact", () => {
  const reordered = fixtures();
  reordered.research.concept = Object.fromEntries(Object.entries(reordered.research.concept).reverse());
  reordered.strategy.hypothesis = Object.fromEntries(Object.entries(reordered.strategy.hypothesis).reverse());
  assert.equal(run({ fixtures: reordered }).output.outcome, "needs_evidence");
});
