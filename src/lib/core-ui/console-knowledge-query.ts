/** Bounded exact Knowledge navigation. Query state is provenance, never authority. */
export const KNOWLEDGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const knowledgeSections = ["installed", "proposals", "releases", "applications", "usage"] as const;
export type KnowledgeSection = typeof knowledgeSections[number];
export type KnowledgeQuery = { section: KnowledgeSection; page: number; offset: number; limit: 25; search: string; selectedId: string | null };
export const knowledgeObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function knowledgeQuery(search: Record<string, string | string[] | undefined>): KnowledgeQuery {
  const one = (key: string) => { const value = search[key]; if (Array.isArray(value)) { if (value.length !== 1) throw new Error("Ambiguous Knowledge query"); return value[0]; } return value; };
  const section = one("type") ?? "installed", page = one("page") ?? "1", text = one("q") ?? "", selectedId = one("selected") ?? null;
  if (!(knowledgeSections as readonly string[]).includes(section) || !/^[1-9]\d{0,2}$/.test(page) || Number(page) > 401 || section === "installed" && text.length > 0 || text.length > 120 || /[\u0000-\u001f\u007f]/.test(text) || selectedId !== null && !KNOWLEDGE_ID.test(selectedId)) throw new Error("Invalid Knowledge query");
  return { section: section as KnowledgeSection, page: Number(page), offset: (Number(page) - 1) * 25, limit: 25, search: text, selectedId };
}
export type KnowledgePage = { items: Record<string, unknown>[]; total: number | null; detail: Record<string, unknown> | null; selection: "none" | "selected" | "missing" | "unavailable"; available: boolean };
export const unavailableKnowledgePage = (): KnowledgePage => ({ items: [], total: null, detail: null, selection: "unavailable", available: false });
const stringList = (value: unknown, minimum = 0) => Array.isArray(value) && value.length >= minimum && value.length <= 12 && value.every(item => typeof item === "string");
const exactId = (value: unknown) => typeof value === "string" && KNOWLEDGE_ID.test(value);
const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const content = (value: unknown) => knowledgeObject(value) && typeof value.guidance === "string" && typeof value.scope === "string" && typeof value.generalizability === "string" && stringList(value.limitations, 1) && stringList(value.conflicts);
const applicationHead = (value: unknown) => value === null || knowledgeObject(value) && exactId(value.id) && (value.releaseId === null || exactId(value.releaseId));
/** Full selected records are distinct from metadata-only lists; omitted evidence never means empty. */
export function validKnowledgeDetail(item: Record<string, unknown>, section: KnowledgeSection): boolean {
  if (section === "proposals") return exactId(item.proposalId) && Number.isSafeInteger(item.version) && Number(item.version) > 0 && typeof item.title === "string" && typeof item.lesson === "string" && typeof item.scope === "string" && stringList(item.limitations, 1) && Array.isArray(item.artifactIds) && item.artifactIds.length > 0 && item.artifactIds.length <= 12 && item.artifactIds.every(exactId) && hash(item.evidenceHash) && ["proposed", "approved", "rejected", "needs_evidence", "promoted"].includes(String(item.status)) && (item.reviewId === null || exactId(item.reviewId)) && (item.reviewReason === null || typeof item.reviewReason === "string") && date(item.createdAt);
  if (section === "releases") return typeof item.packKey === "string" && typeof item.version === "string" && typeof item.title === "string" && ["current", "expired", "withdrawn"].includes(String(item.status)) && content(item.content) && Array.isArray(item.sources) && item.sources.length > 0 && item.sources.length <= 12 && item.sources.every(source => knowledgeObject(source) && typeof source.url === "string" && typeof source.title === "string" && date(source.verifiedAt) && date(source.expiresAt) && hash(source.contentHash) && ["supports", "contradicts"].includes(String(source.stance))) && typeof item.reviewerIdentity === "string" && hash(item.reviewerFingerprint) && hash(item.manifestHash) && hash(item.contentHash) && date(item.reviewedAt) && date(item.expiresAt) && applicationHead(item.application);
  if (section === "applications") return typeof item.packKey === "string" && (item.releaseId === null || exactId(item.releaseId)) && (item.version === null || typeof item.version === "string") && ["apply", "rollback", "remove"].includes(String(item.operation)) && typeof item.reason === "string" && typeof item.isCurrent === "boolean" && ["applied", "removed", "superseded", "expired", "withdrawn"].includes(String(item.status)) && (item.previousApplicationId === null || exactId(item.previousApplicationId)) && date(item.createdAt) && applicationHead(item.application);
  if (section === "usage") return exactId(item.goalId) && item.planId === item.id && Number.isSafeInteger(item.planVersion) && Number(item.planVersion) > 0 && date(item.createdAt) && Array.isArray(item.knowledge) && item.knowledge.length <= 32 && item.knowledge.every(pin => knowledgeObject(pin) && exactId(pin.applicationId) && exactId(pin.releaseId) && typeof pin.packKey === "string" && typeof pin.packVersion === "string" && typeof pin.applicationReason === "string" && hash(pin.manifestHash) && hash(pin.contentHash) && content(pin.content) && date(pin.expiresAt) && ["current", "expired", "withdrawn"].includes(String(pin.currentStatus))) && Array.isArray(item.runs) && item.runs.length <= 64 && item.runs.every(run => knowledgeObject(run) && exactId(run.workflowRunId) && (run.taskContractId === null || exactId(run.taskContractId)));
  return true;
}
/** Reject partial pages, ignored scope, substituted selections and private foreign records. */
export function decodeKnowledgePage(value: unknown, businessId: string, query: KnowledgeQuery): KnowledgePage {
  try { if (JSON.stringify(value).length > 2000000) return unavailableKnowledgePage(); } catch { return unavailableKnowledgePage(); }
  if (!knowledgeObject(value) || value.businessId !== businessId || value.dataset !== query.section || value.readOnly !== true || value.limit !== query.limit || value.offset !== query.offset || !Number.isSafeInteger(value.total) || Number(value.total) < 0 || !Array.isArray(value.items) || value.items.length !== Math.min(query.limit, Math.max(0, Number(value.total) - query.offset)) || !knowledgeObject(value.selection)) return unavailableKnowledgePage();
  const valid = (row: unknown): row is Record<string, unknown> => knowledgeObject(row) && typeof row.id === "string" && KNOWLEDGE_ID.test(row.id) && (query.section === "releases" ? row.businessId === undefined || row.businessId === businessId : row.businessId === businessId);
  const selection = value.selection;
  if (!value.items.every(valid) || new Set(value.items.map(row => row.id)).size !== value.items.length || !["none", "selected", "missing"].includes(String(selection.status)) || (query.selectedId ? selection.status === "none" : selection.status !== "none") || (selection.status === "selected" ? !valid(selection.item) || selection.item.id !== query.selectedId || !validKnowledgeDetail(selection.item, query.section) : selection.item != null)) return unavailableKnowledgePage();
  return { items: value.items, total: Number(value.total), detail: selection.status === "selected" ? selection.item as Record<string, unknown> : null, selection: selection.status as KnowledgePage["selection"], available: true };
}
export type KnowledgeOwnerOperation = "propose" | "apply" | "rollback" | "remove";
const bounded = (value: unknown, min: number, max: number) => typeof value === "string" && value.trim().length >= min && value.length <= max && !/[\u0000\u007f]/.test(value);
const id = (value: unknown) => typeof value === "string" && KNOWLEDGE_ID.test(value);
/** Explicit allowlist prevents owner callers from reaching trusted review/promotion operations. */
export function validKnowledgeMutation(operation: unknown, payload: unknown): operation is KnowledgeOwnerOperation {
  if (!knowledgeObject(payload)) return false;
  const keys = (allowed: string[]) => Object.keys(payload).every(key => allowed.includes(key));
  if (operation === "propose") return keys(["proposalId", "expectedVersion", "title", "lesson", "scope", "limitations", "artifactIds"]) && (payload.proposalId === null || id(payload.proposalId)) && Number.isSafeInteger(payload.expectedVersion) && Number(payload.expectedVersion) >= 0 && Number(payload.expectedVersion) <= 99 && (payload.proposalId === null ? payload.expectedVersion === 0 : Number(payload.expectedVersion) > 0) && bounded(payload.title, 3, 160) && bounded(payload.lesson, 20, 8000) && bounded(payload.scope, 3, 2000) && Array.isArray(payload.limitations) && payload.limitations.length >= 1 && payload.limitations.length <= 12 && payload.limitations.every(item => bounded(item, 3, 1000)) && Array.isArray(payload.artifactIds) && payload.artifactIds.length >= 1 && payload.artifactIds.length <= 12 && payload.artifactIds.every(id) && new Set(payload.artifactIds).size === payload.artifactIds.length;
  if (!["apply", "rollback", "remove"].includes(String(operation)) || !bounded(payload.reason, 10, 2000) || !(payload.expectedApplicationId === null || id(payload.expectedApplicationId))) return false;
  if (operation === "apply") return keys(["releaseId", "expectedApplicationId", "reason"]) && id(payload.releaseId);
  if (operation === "rollback") return keys(["applicationId", "expectedApplicationId", "reason"]) && id(payload.applicationId) && id(payload.expectedApplicationId);
  return keys(["packKey", "expectedApplicationId", "reason"]) && bounded(payload.packKey, 3, 100) && id(payload.expectedApplicationId);
}
