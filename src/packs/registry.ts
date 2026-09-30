import { validateWorkerPackManifest } from "../workers/runtime";
import type { PackManifest, PackRelease } from "./types";

const KEY = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const unsafeKeys = new Set(["__proto__", "prototype", "constructor"]);
function check(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
function object(v: unknown): v is Record<string, unknown> { return !!v && typeof v === "object" && !Array.isArray(v); }
function exact(v: Record<string, unknown>, keys: string[]) {
  check(Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v,k)), "Missing or unknown manifest fields.");
}
function text(v: unknown): v is string { return typeof v === "string" && v.trim().length > 0 && v.length <= 4000; }
function strings(v: unknown): v is string[] { return Array.isArray(v) && v.every(text) && new Set(v).size === v.length; }
function key(v: unknown): v is string { return text(v) && v.length <= 160 && KEY.test(v) && !unsafeKeys.has(v); }
function property(v: unknown): v is string { return text(v) && v.length <= 160 && /^[A-Za-z][A-Za-z0-9_]*$/.test(v) && !unsafeKeys.has(v); }
function schema(v: unknown) { check(object(v) && v.type === "object", "Object JSON Schema required."); }
function safeJson(v: unknown, depth = 0): void {
  check(depth < 40, "Manifest is too deeply nested.");
  if (Array.isArray(v)) { for (const e of v) safeJson(e, depth+1); }
  else if (object(v)) { for (const [k,e] of Object.entries(v)) { check(!unsafeKeys.has(k), "Unsafe object key."); safeJson(e, depth+1); } }
  else check(v === null || typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)), "Manifest must contain only JSON.");
}

export function validatePackManifest(value: unknown): asserts value is PackManifest {
  check(object(value), "Pack manifest must be an object.");
  safeJson(value);
  check(JSON.stringify(value).length <= 200_000, "Pack manifest exceeds the size limit.");
  exact(value, ["frameworkVersion","packKey","version","name","kind","description","dependencies","ui","evals","capabilities","knowledge","workers","workflows"]);
  check(value.frameworkVersion === "1.0" && key(value.packKey) && text(value.version) && VERSION.test(value.version) && text(value.name) && text(value.description), "Invalid pack identity.");
  check(["capability","knowledge","worker","workflow"].includes(String(value.kind)), "Invalid pack kind.");
  check(Array.isArray(value.dependencies) && value.dependencies.length <= 30, "Invalid dependencies.");
  const pins = new Set<string>();
  for (const d of value.dependencies) {
    check(object(d), "Invalid dependency."); exact(d,["packKey","version"]);
    check(key(d.packKey) && text(d.version) && VERSION.test(d.version) && !pins.has(d.packKey), "Dependencies need unique exact version pins."); pins.add(d.packKey);
  }
  check(object(value.ui), "Missing UI metadata."); exact(value.ui,["category","summary","supportedBusinessTypes"]);
  check(text(value.ui.category) && text(value.ui.summary) && strings(value.ui.supportedBusinessTypes), "Invalid UI metadata.");
  check(strings(value.evals) && value.evals.length > 0, "Required qualification checks must be declared.");
  for (const collection of ["capabilities","knowledge","workers","workflows"]) {
    check(Array.isArray(value[collection]) && value[collection].length <= 20, "Definition collection invalid.");
    const expected = collection === "capabilities" ? "capability" : collection === "workers" ? "worker" : collection === "workflows" ? "workflow" : "knowledge";
    check((value[collection] as unknown[]).length === 0 || value.kind === expected, "Definitions must match the pack kind.");
  }
  const manifest = value as unknown as PackManifest;
  check(manifest[manifest.kind === "capability" ? "capabilities" : manifest.kind === "worker" ? "workers" : manifest.kind === "workflow" ? "workflows" : "knowledge"].length > 0, "A pack must add definitions.");
  for (const c of manifest.capabilities) { check(object(c),"Invalid capability."); exact(c,["key","adapter","description"]); check(key(c.key) && ["structured.mapping","web.research","image.generate"].includes(c.adapter) && text(c.description), "Untrusted capability adapter."); }
  for (const k of manifest.knowledge) {
    check(object(k),"Invalid knowledge."); exact(k,["key","version","name","source","verifiedAt","freshnessDays","content"]);
    check(key(k.key) && VERSION.test(k.version) && text(k.name) && text(k.source) && Number.isFinite(Date.parse(k.verifiedAt)) && Number.isInteger(k.freshnessDays) && k.freshnessDays > 0 && object(k.content), "Knowledge needs provenance and freshness.");
    check(/^https:\/\//.test(k.source) || /^fixture:\/\//.test(k.source), "Knowledge source must be HTTPS or an explicit fixture.");
  }
  for (const w of manifest.workers) {
    check(object(w),"Invalid worker."); exact(w,["manifest","execution"]); validateWorkerPackManifest(w.manifest);
    check(w.manifest.packKey === manifest.packKey && w.manifest.version === manifest.version && w.manifest.worker.version === manifest.version, "Worker versions must match their pack release.");
    check(object(w.execution), "Missing trusted executor.");
    if (w.execution.kind === "structured.mapping") {
      exact(w.execution,["kind","fields"]); check(object(w.execution.fields) && Object.keys(w.execution.fields).length > 0, "Missing mapping.");
      for (const [field,m] of Object.entries(w.execution.fields)) {
        check(property(field) && object(m), "Invalid field mapping.");
        if (m.source === "input") { exact(m,["source","key"]); check(property(m.key), "Invalid input key."); }
        else if (m.source === "knowledge") { exact(m,["source","knowledgeKey","key"]); check(key(m.knowledgeKey) && property(m.key) && w.manifest.knowledgeRequirements.includes(m.knowledgeKey), "Knowledge mapping exceeds scope."); }
        else { exact(m,["source","value"]); check(m.source === "literal", "Untrusted mapping source."); }
      }
      check(w.manifest.modelRequirements.executionMode === "structured.mapping", "Execution mode mismatch.");
    } else {
      exact(w.execution,["kind","routeKey"]);
      const trustedRoute = w.execution.kind === "model_router"
        ? ["standard.default","reviewer.independent"].includes(w.execution.routeKey)
        : w.execution.kind === "web.research" && w.execution.routeKey === "standard.default";
      check(trustedRoute && w.manifest.modelRequirements.executionMode === w.execution.kind, "Untrusted model route.");
      check(w.manifest.modelRequirements.routeKey === undefined || w.manifest.modelRequirements.routeKey === w.execution.routeKey, "Worker model route declaration mismatch.");
      if (w.execution.kind === "web.research") check(w.manifest.capabilityPolicy.allowed.includes("web.research"),"Research Worker must declare web.research.");
    }
  }
  for (const w of manifest.workflows) {
    check(object(w),"Invalid workflow."); exact(w,["key","version","name","description","inputSchema","outputSchema","stages","sampleInput"]);
    check(key(w.key) && VERSION.test(w.version) && w.version === manifest.version && text(w.name) && text(w.description) && object(w.sampleInput), "Invalid workflow identity."); schema(w.inputSchema); schema(w.outputSchema);
    check(Array.isArray(w.stages) && w.stages.length > 0 && w.stages.length <= 12, "Workflow needs 1 to 12 bounded stages.");
    const prior = new Set<string>();
    for (const s of w.stages) {
      check(object(s),"Invalid stage."); exact(s,["key","workerKey","workerVersion","objective","inputFrom","knowledgeKeys","permittedCapabilities","nonGoals","completionCriteria"]);
      check(key(s.key) && !prior.has(s.key) && key(s.workerKey) && VERSION.test(s.workerVersion) && text(s.objective) && strings(s.knowledgeKeys) && strings(s.permittedCapabilities) && strings(s.nonGoals) && s.nonGoals.length > 0 && object(s.completionCriteria), "Invalid stage contract.");
      check(s.inputFrom === "workflow" || prior.has(s.inputFrom), "Stage input must reference workflow input or an earlier stage."); prior.add(s.key);
    }
  }
  for (const keys of [manifest.capabilities.map(c=>c.key),manifest.knowledge.map(k=>k.key),manifest.workers.map(w=>w.manifest.worker.workerKey),manifest.workflows.map(w=>w.key)]) check(new Set(keys).size === keys.length, "Duplicate definition key.");
}

export function registeredRelease(releases: readonly PackRelease[], packKey: string, version: string) {
  const matches = releases.filter(r=>r.manifest.packKey === packKey && r.manifest.version === version);
  check(matches.length === 1, `Pack ${packKey}@${version} is unavailable or duplicated.`);
  validatePackManifest(matches[0].manifest); return matches[0];
}
