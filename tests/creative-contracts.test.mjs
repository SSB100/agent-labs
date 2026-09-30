import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { validateCreativeApproval, validatePrintSpecification, validateDesignBrief, validateDesignReview, creativeNextStep, productionReady, creativeHash } = require("../.core-tests/creative/contracts.js");
const { inspectCreativePng } = require("../.core-tests/creative/inspection.js");
const { SCREEN_CATEGORIES, REVIEW_CRITERIA, SAFE_REPAIR_INSTRUCTIONS } = require("../.core-tests/creative/types.js");
const id = "11111111-1111-4111-8111-111111111111";
const h = "a".repeat(64);
function spec() { return { provider: "printful", product: "Synthetic test garment", garment: "Cotton T-shirt", placement: "large_front", sourceUrl: "https://www.printful.com/creating-dtg-file", sourceExcerpt: "Fixture-only specification for deterministic validation. This is not a verified production garment.", verifiedAt: new Date().toISOString(), maximumWidthInches: 15, maximumHeightInches: 18, designWidthInches: 1, designHeightInches: 1, minimumDpi: 150, colorSpace: "srgb", background: "transparent", maximumBytes: 7_000_000 }; }
function approval() { return { approvalId: id, businessId: id, candidateId: id, decisionId: null, purpose: "simulation", designInstructions: "An original arrangement of three pine trees and a sun, without text or protected elements.", concept: "Original synthetic pine illustration", audience: "Adult simulation audience", candidateAssessment: null, originalDesign: true, rightsStatement: "Synthetic fixture declaration, not an actual rights clearance.", rightsConfirmed: true, policyScreen: SCREEN_CATEGORIES.map(category => ({ category, status: "clear", rationale: "Synthetic contract fixture only; no actual policy screening.", sourceUrls: ["https://www.etsy.com/legal/creativity/"] })), printSpecification: spec(), approvedBy: "owner", approvedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), maximumMicrousd: 0, maximumGenerations: 2, publicationAllowed: false }; }
function brief(a = approval()) { return { version: "1.0", approvalId: a.approvalId, audience: a.audience, concept: a.concept, style: "Simple original graphic illustration", hierarchy: "Three pines below a circular sun", typography: "No text or typography in this illustration", placement: a.printSpecification.placement, garmentCompatibility: a.printSpecification.garment, colors: ["#123456"], forbiddenElements: ["brand names", "protected characters", "logos"], originalityRequirements: "Original arrangement, no reference artwork or imitation.", imagePrompt: "An original simplified grouping of three pine trees below a circular sun, no text, no brands, on a fully transparent background." }; }
function review(outcome = "PASS") { return { version: "1.0", assetHash: h, briefHash: h, checks: REVIEW_CRITERIA.map((criterion, i) => ({ criterion, outcome: i === 0 ? outcome : "PASS", rationale: "Criterion checked against the exact supplied synthetic fixture." })), outcome, repairInstruction: outcome === "FAIL" ? SAFE_REPAIR_INSTRUCTIONS[0] : null }; }
const inspection = { sha256: h, failedCriteria: [] };

test("creative production cannot reuse simulation, unknown candidate, or a research TEST as implicit approval", () => {
  const a = approval(); validateCreativeApproval(a);
  assert.equal(productionReady(a, review(), inspection), false);
  assert.throws(() => validateCreativeApproval({ ...a, purpose: "candidate_production" }), /evidence-backed TEST/);
  assert.throws(() => validateCreativeApproval({ ...a, maximumMicrousd: 1 }), /Simulation/);
  assert.throws(() => validateCreativeApproval({ ...a, rightsConfirmed: false }), /approval/);
  assert.throws(() => validateCreativeApproval({ ...a, publicationAllowed: true }), /approval/);
  assert.throws(() => validateCreativeApproval({ ...a, policyScreen: a.policyScreen.map((v, i) => i ? v : { ...v, status: "unknown" }) }), /eight/);
  assert.throws(() => validateCreativeApproval({ ...a, expiresAt: new Date(Date.now() - 1).toISOString() }), /approval/);
});
test("print readiness uses actual physical placement and fresh source provenance", () => {
  validatePrintSpecification(spec());
  assert.throws(() => validatePrintSpecification({ ...spec(), sourceUrl: "https://127.0.0.1/spec" }), /source-backed/);
  assert.throws(() => validatePrintSpecification({ ...spec(), designWidthInches: 16 }), /constraints/);
  assert.throws(() => validatePrintSpecification({ ...spec(), minimumDpi: 72 }), /constraints/);
  assert.throws(() => validatePrintSpecification({ ...spec(), verifiedAt: "2020-01-01T00:00:00Z" }), /source-backed/);
});
test("Creative Director cannot replace the approved strategy or expand its contract", () => {
  const a = approval(); validateDesignBrief(brief(a), a);
  assert.throws(() => validateDesignBrief({ ...brief(a), concept: "Different product" }, a), /brief contract/);
  assert.throws(() => validateDesignBrief({ ...brief(a), audience: "Different audience" }, a), /brief contract/);
  assert.throws(() => validateDesignBrief({ ...brief(a), extra: "publish" }, a), /brief contract/);
  assert.equal(creativeHash({ a: 1, b: 2 }), creativeHash({ b: 2, a: 1 }));
});
test("independent review binds exact pixels and one bounded repair", () => {
  validateDesignReview(review(), h, h);
  assert.throws(() => validateDesignReview({ ...review(), assetHash: "b".repeat(64) }, h, h), /exact asset/);
  assert.throws(() => validateDesignReview({ ...review("FAIL"), outcome: "PASS" }, h, h), /PASS requires/);
  assert.throws(() => validateDesignReview({ ...review("FAIL"), repairInstruction: null }, h, h), /repair/);
  assert.equal(creativeNextStep(review(), inspection, 1), "complete");
  assert.equal(creativeNextStep(review("FAIL"), inspection, 1), "repair");
  assert.equal(creativeNextStep(review("FAIL"), inspection, 2), "needs_owner");
  assert.equal(creativeNextStep(review(), { ...inspection, failedCriteria: ["dpi"] }, 1), "needs_owner");
  assert.throws(() => creativeNextStep(review(), inspection, 3), /limit/);
});
test("binary inspection checks actual alpha pixels, dimensions, hash and DPI without upscaling", async () => {
  const background = sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
  const block = await sharp({ create: { width: 100, height: 100, channels: 4, background: "green" } }).png().toBuffer();
  const bytes = await background.composite([{ input: block }]).png().toBuffer();
  const checked = await inspectCreativePng(bytes, spec());
  assert.deepEqual(checked.failedCriteria, []);
  assert.equal(checked.effectiveDpi, 200);
  assert.equal(checked.sha256, createHash("sha256").update(bytes).digest("hex"));
  const low = await inspectCreativePng(bytes, { ...spec(), designWidthInches: 2, designHeightInches: 2 });
  assert.ok(low.failedCriteria.includes("effective_dpi_below_print_specification"));
  const opaque = await sharp({ create: { width: 200, height: 200, channels: 4, background: "green" } }).png().toBuffer();
  assert.ok((await inspectCreativePng(opaque, spec())).failedCriteria.includes("transparent_background_missing"));
  await assert.rejects(() => inspectCreativePng(Buffer.from("not png"), spec()), /PNG/);
});
