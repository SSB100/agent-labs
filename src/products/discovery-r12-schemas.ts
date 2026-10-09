import type { JsonObject } from "../core/contracts";
import { DIMENSIONS } from "./types";
import { DISCOVERY_V2_PROPOSAL_CEILING_MICROUSD, REVIEW_CHECKS_V2 } from "./discovery-v2";

const text = (minLength: number, maxLength: number): JsonObject => ({ type: "string", minLength, maxLength });
const obj = (properties: Record<string, JsonObject>): JsonObject => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const arr = (items: JsonObject, minItems: number, maxItems: number, uniqueItems = false): JsonObject => ({ type: "array", items, minItems, maxItems, ...(uniqueItems ? { uniqueItems: true } : {}) });
const en = (values: readonly string[]): JsonObject => ({ type: "string", enum: [...values] });
const nullable = (schema: JsonObject): JsonObject => ({ anyOf: [schema, { type: "null" }] });
const code: JsonObject = { type: "string", pattern: "^[A-Z]{2}$", minLength: 2, maxLength: 2 };
const candidate = en(["C1", "C2", "C3"]), evidenceKey: JsonObject = { type: "string", pattern: "^E([1-9]|[1-3][0-9]|4[0-8])$", minLength: 2, maxLength: 3 };
const evidence = arr(evidenceKey, 0, 8, true), outcome = en(["TEST", "REJECT", "NEEDS_MORE_EVIDENCE"]);
const uncertainty = obj({ question: text(15, 180), blockingForTest: { type: "boolean" }, reason: text(30, 200) });
const dimension = obj({ dimension: en(DIMENSIONS), finding: en(["supported", "uncertain", "unfavorable"]), evidenceStrength: en(["direct", "adjacent", "guidance", "none"]),
  facts: arr(obj({ evidence: evidenceKey, relevance: text(20, 160) }), 0, 3), rationale: text(30, 240), uncertainties: arr(uncertainty, 0, 2), hardFailure: { type: "boolean" } });

/** Provider grammar may be cached. These fixed schemas contain no Business,
 * seller, selected-market, candidate, source or evidence-specific values.
 * Existing dynamic schemas/domain validators remain mandatory locally. */
const STATIC_SCHEMAS: Record<"plan" | "select1" | "strategy" | "review", JsonObject> = {
  plan: obj({ comparisonRationale: text(40, 700), queryFocus: arr(text(30, 80), 1, 1),
    proposals: arr(obj({ concept: text(3, 160), audience: text(3, 160), hypothesis: text(20, 500), differentiationHypothesis: text(20, 400) }), 1, 3) }),
  select1: obj({ selections: arr(obj({ sourceKey: en(["S1", "S2", "S3", "S4"]), quote: text(20, 320) }), 1, 4),
    limitations: arr(en(["limited_sources", "publication_dates_unknown", "no_sales_metrics", "no_current_prices"]), 0, 4, true) }),
  strategy: obj({
    marketComparisons: arr(obj({ countryCode: code, currency: { type: "string", pattern: "^[A-Z]{3}$", minLength: 3, maxLength: 3 }, assessment: text(40, 260), evidence,
      assumptions: arr(text(15, 160), 0, 4, true), limitations: arr(text(15, 160), 1, 4, true), sellerBankCountry: nullable(code),
      feeScenarios: arr(obj({ sellerBankCountry: code, hypothetical: { const: true }, explanation: text(30, 200), evidence }), 0, 4) }), 2, 4),
    candidates: arr(obj({ candidateKey: candidate, dimensions: arr(dimension, 9, 9) }), 1, 3),
    recommendation: obj({ proposedOutcome: outcome, marketCountryCode: nullable(code), candidateKey: nullable(candidate), rationale: text(40, 400),
      alternatives: arr(obj({ candidateKey: candidate, rationale: text(30, 240), evidence }), 0, 3) }),
    testPlan: nullable(obj({ scope: { const: "private_original_design_test" }, name: text(10, 120), hypothesis: text(40, 320), deliverable: text(30, 240),
      successCriteria: arr(text(20, 160), 1, 5, true), failureCriteria: arr(text(20, 160), 1, 5, true), stopRule: text(40, 320),
      maximumMicrousd: { type: "integer", minimum: 1, maximum: DISCOVERY_V2_PROPOSAL_CEILING_MICROUSD }, maximumGenerations: { type: "integer", minimum: 1, maximum: 2 }, evidence })),
  }),
  review: obj({ marketCountryCode: nullable(code), candidateKey: nullable(candidate), outcome, sufficiencyRationale: text(60, 700),
    dimensions: arr(obj({ dimension: en(DIMENSIONS), verdict: en(["sufficient_for_test", "nonblocking_unknown", "blocking", "known_failure"]), rationale: text(30, 240), evidence }), 0, 9),
    checks: arr(obj({ check: en(REVIEW_CHECKS_V2), outcome: en(["PASS", "FAIL"]), rationale: text(30, 240) }), REVIEW_CHECKS_V2.length, REVIEW_CHECKS_V2.length),
    additionalUncertainties: arr(obj({ dimension: en(DIMENSIONS), ...uncertainty.properties as Record<string, JsonObject> }), 0, 18) }),
};
export function discoveryR12StaticSchema(phase: "plan" | "select1" | "strategy" | "review"): JsonObject { return structuredClone(STATIC_SCHEMAS[phase]); }

/** Separate owner-initial provider grammar. Historical and focused schemas keep
 * their exact bytes/hashes; selected countries and all private values stay local. */
const OWNER_INITIAL_STRATEGY_SCHEMA = structuredClone(STATIC_SCHEMAS.strategy);
((OWNER_INITIAL_STRATEGY_SCHEMA.properties as JsonObject).marketComparisons as JsonObject).minItems = 1;
export function discoveryR12OwnerInitialStaticSchema(phase: "plan" | "select1" | "strategy" | "review"): JsonObject {
  return phase === "strategy" ? structuredClone(OWNER_INITIAL_STRATEGY_SCHEMA) : discoveryR12StaticSchema(phase);
}
