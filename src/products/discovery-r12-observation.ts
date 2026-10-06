import { createHash } from "node:crypto";
import type { JsonObject } from "../core/contracts";
import { containsCredentialLikeValue } from "../core/quest-intake";
import { ModelProviderError } from "../models/types";
import { JsonSchemaValidationError } from "../workers/schema-validator";

export const R12_REVIEW_OBSERVATION_CONTENT_BYTES = 16_384;
export const R12_REVIEW_DIAGNOSTIC_CODES = ["transport", "provider_envelope", "json_parse", "response_identity", "finish_reason", "response_time", "response_cost", "response_schema", "response_size", "observation_storage", "candidate_binding", "candidate_storage", "domain_validation"] as const;
export type R12ReviewDiagnosticCode = typeof R12_REVIEW_DIAGNOSTIC_CODES[number];
type Identity = { scopeId: string; attemptId: string; requestId: string };
export type R12ReviewObservation = Identity & {
  version: "r12.review-observation.1"; receivedAt: string; providerRequestId: string | null; providerModelId: string | null;
  finishReason: string | null; nativeFinishReason: string | null; contentState: "complete" | "oversized" | "redacted" | "missing" | "unsupported";
  content: string | null; contentBytes: number; contentHash: string | null;
};
export type R12ReviewDiagnostic = Identity & {
  version: "r12.review-diagnostic.1"; recordedAt: string; code: R12ReviewDiagnosticCode; httpStatus: number | null;
  observationSaved: boolean; issues: Array<{ path: string; constraint: string; limit: number | null }>;
};
export type R12ReviewObservationMetadata = Omit<R12ReviewObservation, keyof Identity | "version" | "content" | "providerRequestId" | "providerModelId">;
export type R12ReviewDiagnosticMetadata = Omit<R12ReviewDiagnostic, keyof Identity | "version">;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const safe = (v: unknown, pattern: RegExp): string | null => typeof v === "string" && pattern.test(v) ? v : null;
const digest = (v: string) => createHash("sha256").update(v).digest("hex");

/** Unqualified private evidence only. No headers, request context, provider
 * errors or arbitrary envelope fields survive this projection. A large or
 * credential-like completion is represented by its size/hash, never a prefix. */
export function observeR12ReviewResponse(raw: unknown, identity: Identity, receivedAt: string): R12ReviewObservation {
  const body = object(raw) ? raw : {}, first = Array.isArray(body.choices) && object(body.choices[0]) ? body.choices[0] : {};
  const message = object(first.message) ? first.message : {}, source = message.content;
  const content = typeof source === "string" ? source : Array.isArray(source) && source.every(part => typeof part === "string" || object(part) && typeof part.text === "string") ? source.map(part => typeof part === "string" ? part : (part as { text: string }).text).join("") : null;
  const bytes = content === null ? 0 : Buffer.byteLength(content, "utf8");
  const contentState = content === null ? source === null || source === undefined ? "missing" : "unsupported" : bytes > R12_REVIEW_OBSERVATION_CONTENT_BYTES ? "oversized" : containsCredentialLikeValue(content) || content.includes("\0") || Buffer.from(content, "utf8").toString("utf8") !== content ? "redacted" : "complete";
  return { ...identity, version: "r12.review-observation.1", receivedAt,
    providerRequestId: safe(body.id, /^gen-[A-Za-z0-9_-]{1,296}$/), providerModelId: safe(body.model, /^[A-Za-z0-9][A-Za-z0-9_./:-]{0,159}$/),
    finishReason: safe(first.finish_reason, /^(stop|length|content_filter|tool_calls|error)$/), nativeFinishReason: safe(first.native_finish_reason, /^[a-z][a-z0-9_]{0,47}$/),
    contentState, content: contentState === "complete" ? content : null, contentBytes: bytes, contentHash: content === null ? null : digest(content) };
}

export class R12ReviewResponseError extends Error {
  constructor(readonly code: R12ReviewDiagnosticCode) { super("r12_discovery_response_unverified"); }
}

function schemaIssue(issue: { path: string; message: string }, schema: JsonObject): R12ReviewDiagnostic["issues"][number] {
  // Retain paths only through declared schema properties. Model-supplied extra
  // property names and validator prose never enter diagnostics or owner UI.
  const known = new Set<string>();
  const walk = (node: unknown, path: string) => { if (!object(node)) return; known.add(path); if (object(node.properties)) for (const [key, child] of Object.entries(node.properties)) walk(child, `${path}.${key}`); if (node.items) walk(node.items, `${path}[]`); if (Array.isArray(node.anyOf)) node.anyOf.forEach(child => walk(child, path)); };
  walk(schema, "$");
  const normalized = issue.path.replace(/\[\d+\]/g, "[]");
  const path = issue.path.length <= 180 && known.has(normalized) ? issue.path : "$";
  const match = issue.message.match(/^must contain (at least|no more than) (\d+) (characters|items)$/);
  if (match) return { path, constraint: `${match[1] === "at least" ? "min" : "max"}_${match[3] === "characters" ? "length" : "items"}`, limit: Number(match[2]) };
  const constraint = issue.message === "must match one of the declared enum values" ? "enum" : issue.message === "must equal the declared constant" ? "const" : issue.message === "must contain unique items" ? "unique_items" : issue.message === "does not match the required pattern" ? "pattern" : /^must be /.test(issue.message) ? "type" : "shape";
  return { path, constraint, limit: null };
}

export function r12ReviewDiagnostic(error: unknown, fallback: R12ReviewDiagnosticCode, identity: Identity, schema: JsonObject, observationSaved: boolean, recordedAt: string): R12ReviewDiagnostic {
  let code = fallback, httpStatus: number | null = null;
  if (error instanceof R12ReviewResponseError) code = error.code;
  if (error instanceof JsonSchemaValidationError) code = "response_schema";
  if (error instanceof ModelProviderError) {
    code = error.details.validationGate === "response_model" ? "response_identity" : error.details.validationGate === "provider_envelope" ? "provider_envelope" : error.details.validationGate === "structured_output" ? "json_parse" : "transport";
    const status = error.details.httpStatus ?? error.details.status;
    if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) httpStatus = status;
  }
  return { ...identity, version: "r12.review-diagnostic.1", recordedAt, code, httpStatus, observationSaved,
    issues: error instanceof JsonSchemaValidationError ? error.issues.slice(0, 12).map(issue => schemaIssue(issue, schema)) : [] };
}

export function r12ReviewDiagnosticSummary(code: R12ReviewDiagnosticCode): string {
  return ({ transport: "The provider request failed.", provider_envelope: "The provider returned an invalid response envelope.", json_parse: "The response could not be read as the required JSON object.", response_identity: "The response identity did not match the approved review.", finish_reason: "The provider did not report a complete response.", response_time: "The response fell outside the approved time window.", response_cost: "The returned cost was invalid or exceeded the approved limit.", response_schema: "The response did not meet the required output constraints.", response_size: "The response exceeded the private output limit.", observation_storage: "The unqualified response could not be saved.", candidate_binding: "The response could not be bound to its saved dispatch.", candidate_storage: "The validated response could not be saved.", domain_validation: "The saved response did not pass the research evidence checks." })[code];
}

/** Owner projection contains metadata only; never accept a raw completion or
 * arbitrary provider error through this display contract. Older rows may omit
 * both fields until the observation migration is applied. */
export function validateR12ReviewOwnerEvidence(observation: unknown, diagnostic: unknown, phase: string): void {
  const fail = (): never => { throw Error("r12_review_owner_evidence_invalid"); };
  const date = (v: unknown) => typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v));
  const keys = (v: Record<string, unknown>, names: string) => Object.keys(v).sort().join(",") === names.split(",").sort().join(",");
  const present = observation !== null && observation !== undefined, rejected = diagnostic !== null && diagnostic !== undefined;
  if ((present || rejected) && phase !== "review") return fail();
  if (present) {
    if (!object(observation) || !keys(observation, "receivedAt,finishReason,nativeFinishReason,contentState,contentBytes,contentHash") || !date(observation.receivedAt) ||
      !(observation.finishReason === null || safe(observation.finishReason, /^(stop|length|content_filter|tool_calls|error)$/)) || !(observation.nativeFinishReason === null || safe(observation.nativeFinishReason, /^[a-z][a-z0-9_]{0,47}$/)) ||
      !["complete", "oversized", "redacted", "missing", "unsupported"].includes(String(observation.contentState)) || !Number.isSafeInteger(observation.contentBytes) || Number(observation.contentBytes) < 0) return fail();
    const bytes = Number(observation.contentBytes), hasText = ["complete", "oversized", "redacted"].includes(String(observation.contentState));
    if (hasText ? !safe(observation.contentHash, /^[a-f0-9]{64}$/) : observation.contentHash !== null || bytes !== 0) return fail();
    if (observation.contentState === "oversized" ? bytes <= R12_REVIEW_OBSERVATION_CONTENT_BYTES : bytes > R12_REVIEW_OBSERVATION_CONTENT_BYTES || observation.contentState === "redacted" && bytes === 0) return fail();
  }
  if (rejected) {
    if (!object(diagnostic) || !keys(diagnostic, "recordedAt,code,httpStatus,observationSaved,issues") || !date(diagnostic.recordedAt) || !R12_REVIEW_DIAGNOSTIC_CODES.includes(diagnostic.code as R12ReviewDiagnosticCode) || diagnostic.observationSaved !== present ||
      !(diagnostic.httpStatus === null || Number.isInteger(diagnostic.httpStatus) && Number(diagnostic.httpStatus) >= 100 && Number(diagnostic.httpStatus) <= 599) || !Array.isArray(diagnostic.issues) || diagnostic.issues.length > 12 || diagnostic.code !== "response_schema" && diagnostic.issues.length !== 0) return fail();
    for (const issue of diagnostic.issues) {
      if (!object(issue) || !keys(issue, "path,constraint,limit") || typeof issue.path !== "string" || issue.path.length > 180 || !/^\$(?:\.[A-Za-z][A-Za-z0-9_]*|\[[0-9]+\])*$/.test(issue.path) ||
        !["min_length", "max_length", "min_items", "max_items", "enum", "const", "unique_items", "pattern", "type", "shape"].includes(String(issue.constraint))) return fail();
      if (["min_length", "max_length", "min_items", "max_items"].includes(String(issue.constraint)) ? !Number.isInteger(issue.limit) || Number(issue.limit) < 0 || Number(issue.limit) > 1_000_000 : issue.limit !== null) return fail();
    }
  }
}
