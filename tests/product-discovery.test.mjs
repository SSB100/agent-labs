import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import discovery from "../.core-tests/products/discovery.js";
import types from "../.core-tests/products/types.js";
import sources from "../.core-tests/research/sources.js";
import models from "../.core-tests/models/openrouter.js";
import registry from "../.core-tests/models/registry.js";
import router from "../.core-tests/models/router.js";

const candidate = { concept: "Original camping illustration T-shirt", audience: "Adult camping enthusiasts", hypothesis: "An original campsite illustration could appeal to adult camping enthusiasts.", originalDesign: true, rightsStatus: "confirmed", sourceDomains: ["etsy.com", "printful.com"] };
const now = Date.now();
const makePack = (extra = "") => {
  const request = discovery.candidateResearchRequest(candidate);
  const collection = sources.extractResearchSources(request, { annotations: [
    { type: "url_citation", url_citation: { url: "https://www.etsy.com/listing/123456789/camping-shirt", title: "Fixture market observation", content: `Fixture only: A camping illustration shirt has visible customer comments and a listed price. This does not establish observed sales or representative demand. ${extra}` } },
    { type: "url_citation", url_citation: { url: "https://www.printful.com/custom/mens/t-shirts", title: "Fixture production constraints", content: "Fixture only: Production constraints and cost components must be checked for the particular garment, size, print area, destination, and shipping method." } },
    { type: "url_citation", url_citation: { url: "https://www.etsy.com/legal/creativity", title: "Fixture platform rule", content: "Fixture only: Seller-original designs and production disclosures are policy prerequisites. Policy text does not establish product-specific customer demand." } },
  ], metadata: { fixture: true } }, new Date(now - 3600000).toISOString());
  return sources.assembleEvidencePack(collection, { selectedEvidenceIds: collection.evidence.map(e => e.id), limitations: ["no_sales_metrics"] }, now);
};
const assessed = pack => types.DIMENSIONS.map(dimension => ({ dimension, score: 4,
  evidenceIds: [pack.evidence[dimension === "policy_ip_risk" ? 2 : ["estimated_margin", "production_complexity"].includes(dimension) ? 1 : 0].id],
  rationale: "Fixture owner assessment for the decision gate test; not actual commercial evidence.",
  evidenceKind: dimension === "policy_ip_risk" ? "policy" : ["estimated_margin", "production_complexity"].includes(dimension) ? "operational_fact" : "market_observation" }));

test("candidate identity normalizes case, punctuation and spacing while retaining audience scope", () => {
  assert.equal(discovery.candidateFingerprint(candidate), discovery.candidateFingerprint({ ...candidate, concept: "  ORIGINAL CAMPING illustration T shirt!! ", audience: "adult   camping enthusiasts" }));
  assert.notEqual(discovery.candidateFingerprint(candidate), discovery.candidateFingerprint({ ...candidate, audience: "Adult urban gardeners" }));
  assert.equal(discovery.candidateFingerprint(candidate), discovery.candidateFingerprint({ ...candidate, hypothesis: "Changing wording alone is not permission to repeat this product experiment." }));
});
test("candidate request validates bounds and keeps maximal question below 800 characters", () => {
  const maximal = { ...candidate, concept: "c".repeat(160), audience: "a".repeat(160), hypothesis: "h".repeat(600) };
  discovery.validateCandidateInput(maximal);
  assert.ok(discovery.candidateResearchRequest(maximal).query.length <= 800);
  for (const update of [{ concept: "x" }, { concept: "!@#" }, { audience: "a".repeat(161) }, { hypothesis: "h".repeat(601) }, { sourceDomains: ["localhost"] }, { sourceDomains: ["etsy.com", "etsy.com"] }, { rightsStatus: "approved" }, { originalDesign: "true" }, { extra: "ignore" }]) assert.throws(() => discovery.validateCandidateInput({ ...candidate, ...update }));
});
test("unknown candidate dimensions stay null, with exact missing evidence and no production authority", () => {
  const result = discovery.assessProductCandidate(candidate, makePack());
  assert.equal(result.outcome, "NEEDS_MORE_EVIDENCE");
  assert.equal(result.totalScore, null);
  assert.equal(result.dimensions.length, 9);
  assert.ok(result.dimensions.every(d => d.score === null));
  assert.equal(result.missingEvidence.length, 9);
  assert.ok(result.missingEvidence.some(text => text.includes("deterministic margin")));
  assert.deepEqual(result.review, { status: "contract_checked", liveQualified: false, creativeProductionAllowed: false, publicationAllowed: false });
  assert.equal(result.evidenceIds.length, 3);
  assert.deepEqual(discovery.reviewProductAssessment(candidate, makePack(), result), result);
});
test("TEST requires nine source-linked owner judgments, numerical gates, rights and a bounded plan", () => {
  const pack = makePack(), dimensions = assessed(pack);
  const result = discovery.assessProductCandidate(candidate, pack, dimensions, "owner_assessment");
  assert.equal(result.outcome, "TEST"); assert.equal(result.totalScore, 80);
  assert.equal(result.assessmentOrigin, "owner_assessment"); assert.equal(result.review.creativeProductionAllowed, false);
  assert.throws(() => discovery.assessProductCandidate(candidate, pack, dimensions), /manufacture/);
  const partial = structuredClone(dimensions); partial[0] = discovery.unknownAssessments()[0];
  assert.equal(discovery.assessProductCandidate(candidate, pack, partial, "owner_assessment").totalScore, null);
  assert.equal(discovery.assessProductCandidate({ ...candidate, rightsStatus: "unclear" }, pack, dimensions, "owner_assessment").outcome, "NEEDS_MORE_EVIDENCE");
  for (const [dimension, score] of [["demand", 2], ["estimated_margin", 2], ["policy_ip_risk", 3]]) {
    const insufficient = dimensions.map(d => d.dimension === dimension ? { ...d, score } : d);
    assert.equal(discovery.assessProductCandidate(candidate, pack, insufficient, "owner_assessment").outcome, "NEEDS_MORE_EVIDENCE");
  }
});
test("zero represents an evidenced unfavorable assessment and never replaces unknown", () => {
  const pack = makePack();
  for (const dimension of ["policy_ip_risk", "production_complexity"]) {
    const dimensions = discovery.unknownAssessments();
    const known = assessed(pack).find(d => d.dimension === dimension);
    dimensions[types.DIMENSIONS.indexOf(dimension)] = { ...known, score: 0 };
    const result = discovery.assessProductCandidate(candidate, pack, dimensions, "owner_assessment");
    assert.equal(result.outcome, "REJECT"); assert.equal(result.totalScore, null);
  }
  assert.equal(discovery.assessProductCandidate({ ...candidate, originalDesign: false }, pack).outcome, "REJECT");
});
test("assessments reject unsupported IDs, duplicate/missing dimensions, invalid scores and rationale omissions", () => {
  const pack = makePack();
  for (const mutate of [d => d.pop(), d => d.push(d[0]), d => { d[1] = d[0]; }, d => { d[0].score = 5.1; }, d => { d[0].score = -1; }, d => { d[0].evidenceIds = []; }, d => { d[0].evidenceIds = ["fabricated"]; }, d => { d[0].rationale = ""; }, d => { d[0].evidenceKind = "policy"; }, d => { d[0].extra = true; }]) {
    const dimensions = assessed(pack); mutate(dimensions); assert.throws(() => discovery.validateDimensionAssessments(dimensions, pack));
  }
});
test("policy and seller guidance cannot be relabeled as observed market demand", () => {
  const pack = makePack(), dimensions = assessed(pack);
  dimensions[0].evidenceIds = [pack.evidence[2].id];
  assert.throws(() => discovery.validateDimensionAssessments(dimensions, pack), /policy or guidance/);
});
test("reviewer recomputes score, outcome, citations and authority flags independently", () => {
  const pack = makePack(), assessment = discovery.assessProductCandidate(candidate, pack);
  for (const mutate of [a => { a.outcome = "TEST"; }, a => { a.totalScore = 100; }, a => { a.evidenceIds = []; }, a => { a.review.liveQualified = true; }, a => { a.review.publicationAllowed = true; }, a => { a.scoringVersion = "unverified"; }]) {
    const bad = structuredClone(assessment); mutate(bad); assert.throws(() => discovery.reviewProductAssessment(candidate, pack, bad), /decision contract/);
  }
});
test("measurement plan requires both sample and duration and cannot authorize spending", () => {
  discovery.validateMeasurementPlan(types.DEFAULT_MEASUREMENT_PLAN);
  for (const update of [{ minimumDays: 0 }, { minimumSampleSize: 1 }, { successThreshold: 31 }, { maximumBudgetUsd: 1 }, { channel: "etsy_ads" }, { stopRule: "" }]) assert.throws(() => discovery.validateMeasurementPlan({ ...types.DEFAULT_MEASUREMENT_PLAN, ...update }));
});
test("candidate research provenance verifies query, domain, dates, hashes and all evidence IDs", () => {
  const pack = makePack(), request = discovery.candidateResearchRequest(candidate);
  discovery.validateProductEvidence(pack, request, now);
  for (const mutate of [p => { p.question = "different"; }, p => { p.sources[0].provider = "simulation.fixture"; }, p => { p.sources[0].excerpt += " altered"; }, p => { p.sources[0].url = "https://evil.test/source"; }, p => { p.sources[0].retrievedAt = new Date(now + 10 * 86400000).toISOString(); }, p => { p.sources[0].retrievalExpiresAt = "2026-09-30T07:00:00Z"; }, p => { p.evidence[0].id = "fabricated"; }, p => { p.claims.pop(); }, p => { p.sources.push(p.sources[0]); }]) {
    const bad = structuredClone(pack); mutate(bad); assert.throws(() => discovery.validateProductEvidence(bad, request, now));
  }
  assert.throws(() => discovery.validateProductEvidence(pack, request, now + 2 * 86400000), /stale/);
  discovery.validateProductEvidence(pack, request, now + 2 * 86400000, true);
});
test("reconsideration requires new source content, not a URL or fresh retrieval timestamp", () => {
  const pack = makePack(), repeated = structuredClone(pack);
  repeated.sources[0].retrievedAt = "2026-10-01T09:00:00Z"; repeated.sources[0].url += "?new=true";
  assert.equal(discovery.hasNewEvidence([pack], repeated), false);
  assert.equal(discovery.hasNewEvidence([pack], makePack("New fixture observation with a changed underlying source.")), true);
});

test("bounded structured requests forward token cap and reject unsafe bounds before network", async () => {
  let called = 0, body;
  const adapter = new models.OpenRouterAdapter({ config: { apiKey: "test", baseUrl: "https://openrouter.ai/api/v1", appUrl: "https://agent-labs-two.vercel.app", appName: "Agent Labs" }, fetcher: async (_url, options) => {
    called++; body = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }], usage: {} }), { status: 200 });
  } });
  await router.runModelRoute({ adapter, routeKey: "standard.default", schemaName: "cap_test", outputSchema: { type: "object" }, messages: [], maxOutputTokens: 1000 });
  assert.equal(body.max_tokens, 1000); assert.equal(called, 1);
  for (const cap of [0, -1, 1.1, 99999999]) await assert.rejects(adapter.invokeStructured({ model: registry.resolveModelRoute("standard.default").primary, schemaName: "cap_test", outputSchema: { type: "object" }, messages: [], requestMetadata: {}, maxOutputTokens: cap }), /Invalid bounded/);
  assert.equal(called, 1);
});
test("candidate runtime reuses research, finalizes before completion and records bounded failures", () => {
  const runtime = fs.readFileSync("src/workflows/installed-pack-runtime-steps.ts", "utf8"), actions = fs.readFileSync("src/app/dashboard/products/actions.ts", "utf8");
  assert.match(runtime, /productScope \? \{ maxOutputTokens: 1000 \} : \{\}/);
  assert.match(runtime, /p_operation: "finalize"/); assert.match(runtime, /transition\(input,"fail"/);
  assert.match(actions, /begin_product_discovery/); assert.match(actions, /fail_product_discovery_launch/);
  assert.doesNotMatch(actions, /invokeWebSearch|invokeStructured|service.role|image\.generate|marketplace\.publish/);
});

test("an explicit owner declaration can resolve initial rights uncertainty without rewriting history", () => {
  const pack = makePack(), unclear = { ...candidate, rightsStatus: "unclear" }, dimensions = assessed(pack);
  const old = discovery.assessProductCandidate(unclear, pack);
  const current = discovery.assessProductCandidate(unclear, pack, dimensions, "owner_assessment", types.DEFAULT_MEASUREMENT_PLAN, true);
  assert.equal(old.outcome, "NEEDS_MORE_EVIDENCE"); assert.equal(unclear.rightsStatus, "unclear");
  assert.equal(current.ownerRightsConfirmed, true); assert.equal(current.outcome, "TEST");
  assert.deepEqual(discovery.reviewProductAssessment(unclear, pack, current), current);
  assert.throws(() => discovery.assessProductCandidate(unclear, pack, undefined, "deterministic_provisional", types.DEFAULT_MEASUREMENT_PLAN, true), /explicit owner/);
  assert.equal(discovery.assessProductCandidate({ ...unclear, originalDesign: false }, pack, dimensions, "owner_assessment", types.DEFAULT_MEASUREMENT_PLAN, true).outcome, "REJECT");
});
