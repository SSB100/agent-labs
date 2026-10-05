import { createHash } from "node:crypto";
import { containsCredentialLikeValue } from "./quest-intake";

/** A plan is immutable intent. Only a qualified adapter and R05 can admit effects. */
export type QuestStep = {
  key: string;
  kind: "research" | "challenge" | "work" | "review" | "measure";
  objective: string;
  reason: string;
  adapter: string;
  qualificationHash: string;
  installationId: string;
  packSnapshotHash: string;
  workflowDefinitionId: string;
  workerDefinitionId: string;
  role: string;
  operationKey: string;
  purpose: string;
  dependsOn: string[];
  expectedArtifactType: string;
  maximumMicrounits: string;
  expiresAt: string;
  notBefore: string;
  measurement: { minimumObservations: number; closesAt: string } | null;
  maximumRepairs: number;
};
export type QuestPlan = {
  format: "r07.1";
  businessId: string;
  goalId: string;
  goalRevision: number;
  goalHash: string;
  businessRevision: number;
  businessHash: string;
  policyId: string;
  policyHash: string;
  authorityRootId: string;
  plannerWorkerDefinitionId: string;
  currency: "USD";
  maximumMicrounits: string;
  deadline: string;
  expiresAt: string;
  maximumRepairs: number;
  maximumPivots: number;
  maximumChildren: number;
  maximumDispatches: number;
  requiredChecks: string[];
  finishCondition: "all_required_outputs_verified";
  stopConditions: ["no_permitted_work", "deadline", "repair_exhausted", "owner_stopped"];
  steps: QuestStep[];
};

const fail = (reason: string): never => { throw new Error(`r07_${reason}`); };
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const text = (value: unknown, max = 240) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const integer = (value: unknown, min: number, max: number) => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
const date = (value: unknown): number => typeof value === "string" && /^\d{4}-\d\d-\d\dT.+(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)) ? Date.parse(value) : fail("invalid_time");
export const questMoney = (value: unknown): bigint => typeof value === "string" && /^(0|[1-9][0-9]{0,15})$/.test(value) && BigInt(value) <= BigInt("9007199254740991") ? BigInt(value) : fail("invalid_money");
const keys = (value: Record<string, unknown>, expected: string[]) => {
  if (Object.keys(value).some(key => !expected.includes(key)) || expected.some(key => !(key in value))) fail("invalid_keys");
};

/** Canonical JSON is for local fingerprints only. SQL owns the persisted jsonb hash. */
export function questFingerprint(value: unknown): string {
  const stable = (v: unknown): string => {
    if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
    if (object(v)) return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
    return JSON.stringify(v) ?? fail("invalid_json");
  };
  return createHash("sha256").update(stable(value)).digest("hex");
}

/** Deterministic compilation. No model call, provider lookup, or authority creation. */
export function compileQuestPlan(input: unknown): QuestPlan {
  if (containsCredentialLikeValue(input)) fail("credential_content_rejected");
  if (!object(input) || Buffer.byteLength(JSON.stringify(input)) > 65536) fail("invalid_plan");
  const p = input as Record<string, unknown>;
  keys(p, ["format", "businessId", "goalId", "goalRevision", "goalHash", "businessRevision", "businessHash", "policyId", "policyHash", "authorityRootId", "plannerWorkerDefinitionId", "currency", "maximumMicrounits", "deadline", "expiresAt", "maximumRepairs", "maximumPivots", "maximumChildren", "maximumDispatches", "requiredChecks", "finishCondition", "stopConditions", "steps"]);
  for (const key of ["businessId", "goalId", "policyId", "authorityRootId", "plannerWorkerDefinitionId"]) if (!uuid(p[key])) fail("invalid_identity");
  for (const key of ["goalHash", "businessHash", "policyHash"]) if (!hash(p[key])) fail("invalid_pin");
  if (p.format !== "r07.1" || p.currency !== "USD" || p.authorityRootId !== p.businessId || !integer(p.goalRevision, 1, 999999999) || !integer(p.businessRevision, 1, 999999999)) fail("invalid_lineage");
  if (!integer(p.maximumRepairs, 0, 8) || !integer(p.maximumPivots, 0, 3) || !integer(p.maximumChildren, 2, 32) || !integer(p.maximumDispatches, 2, 64)) fail("invalid_bounds");
  const budget = questMoney(p.maximumMicrounits), expiry = date(p.expiresAt);
  if (budget <= BigInt(0) || expiry > date(p.deadline)) fail("invalid_bounds");
  if (p.finishCondition !== "all_required_outputs_verified" || JSON.stringify(p.stopConditions) !== JSON.stringify(["no_permitted_work", "deadline", "repair_exhausted", "owner_stopped"])) fail("invalid_stop_conditions");
  if (!Array.isArray(p.steps) || p.steps.length < 2 || p.steps.length > 16 || p.steps.length > Number(p.maximumChildren) || p.steps.length > Number(p.maximumDispatches)) fail("invalid_steps");
  const steps = p.steps as Record<string, unknown>[];
  const seen = new Map<string, QuestStep>();
  let total = BigInt(0);
  for (const raw of steps) {
    if (!object(raw)) fail("invalid_step");
    const s = raw as Record<string, unknown>;
    keys(s, ["key", "kind", "objective", "reason", "adapter", "qualificationHash", "installationId", "packSnapshotHash", "workflowDefinitionId", "workerDefinitionId", "role", "operationKey", "purpose", "dependsOn", "expectedArtifactType", "maximumMicrounits", "expiresAt", "notBefore", "measurement", "maximumRepairs"]);
    if (typeof s.key !== "string" || !/^[a-z][a-z0-9_-]{0,39}$/.test(s.key) || seen.has(s.key)) fail("duplicate_or_invalid_step");
    for (const key of ["objective", "reason", "adapter", "role", "operationKey", "purpose", "expectedArtifactType"]) if (!text(s[key])) fail("invalid_step_text");
    for (const key of ["installationId", "workflowDefinitionId", "workerDefinitionId"]) if (!uuid(s[key])) fail("invalid_identity");
    if (!hash(s.qualificationHash) || !hash(s.packSnapshotHash) || !integer(s.maximumRepairs, 0, 3) || Number(s.maximumRepairs) > Number(p.maximumRepairs)) fail("invalid_step_bounds");
    if (!Array.isArray(s.dependsOn) || s.dependsOn.length > 16 || new Set(s.dependsOn).size !== s.dependsOn.length || s.dependsOn.some(d => typeof d !== "string" || !seen.has(d))) fail("invalid_dependencies");
    const dependsOn = s.dependsOn as string[];
    if (!["research", "challenge", "work", "review", "measure"].includes(String(s.kind))) fail("invalid_kind");
    if (seen.size === 0 && (s.kind !== "research" || dependsOn.length !== 0)) fail("research_first");
    if (seen.size === 1 && (s.kind !== "challenge" || !dependsOn.includes(steps[0].key as string))) fail("challenge_second");
    if (seen.size > 1 && !dependsOn.includes(steps[1].key as string)) fail("challenge_required");
    if ((s.kind === "challenge" || s.kind === "review") && (s.workerDefinitionId === p.plannerWorkerDefinitionId || dependsOn.some(d => seen.get(d)?.workerDefinitionId === s.workerDefinitionId))) fail("independent_check_required");
    const amount = questMoney(s.maximumMicrounits), end = date(s.expiresAt), start = date(s.notBefore);
    if (amount <= BigInt(0) || end > expiry || start >= end) fail("child_scope_widened");
    total += amount;
    if (s.measurement !== null) {
      if (!object(s.measurement)) fail("invalid_measurement");
      keys(s.measurement as Record<string, unknown>, ["minimumObservations", "closesAt"]);
      const m = s.measurement as Record<string, unknown>;
      if (s.kind !== "measure" || !integer(m.minimumObservations, 1, 999999999) || date(m.closesAt) <= start || date(m.closesAt) > end) fail("invalid_measurement");
    } else if (s.kind === "measure") fail("measurement_required");
    seen.set(s.key as string, raw as unknown as QuestStep);
  }
  if (total > budget) fail("plan_budget_exceeded");
  if (!Array.isArray(p.requiredChecks) || p.requiredChecks.length === 0 || new Set(p.requiredChecks).size !== p.requiredChecks.length || !p.requiredChecks.includes(steps[1].key) || p.requiredChecks.some(k => typeof k !== "string" || !["challenge", "review"].includes(seen.get(k)?.kind ?? ""))) fail("required_checks_invalid");
  return structuredClone(input) as QuestPlan;
}
