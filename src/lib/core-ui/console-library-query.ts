import { CONSOLE_COLLECTION_PAGE_SIZE, CONSOLE_COLLECTION_UUID, consoleSearchPattern } from "./console-collections-query";

/** Persisted fields only. These filter allowlists do not assert renderer/download support. */
export const CONSOLE_LIBRARY_MEDIA_TYPES = ["all", "application/json", "application/pdf", "text/plain", "text/markdown", "image/png", "image/webp"] as const;
export const CONSOLE_LIBRARY_ARTIFACT_TYPES = ["all", "creative.approval", "creative.brief", "creative.brief-screen", "creative.image", "creative.review", "worker.research-evidence-pack", "pack.knowledge", "research.sources", "product.discovery-intent.v2", "product.discovery-dossier.v2", "product.package.v1", "listing.specialist.v1", "listing.reviewer.v1"] as const;
export type ConsoleLibraryKind = "designs" | "records";
export type ConsoleLibraryOptions = { businessId?: string; selectedId?: string; creativeRunId?: string; page?: number; pageSize?: number; query?: string; sort?: string; mediaType?: string; artifactType?: string };
export type ConsoleLibraryQuery = { kind: ConsoleLibraryKind; businessId: string | null; selectedId: string | null; creativeRunId: string | null; page: number; pageSize: 25; offset: number; query: string; sort: "newest" | "oldest"; mediaType: string; artifactType: string };
export { consoleSearchPattern as consoleLibrarySearchPattern };
export function consoleLibraryQuery(kind: ConsoleLibraryKind, options: ConsoleLibraryOptions = {}): ConsoleLibraryQuery {
  if (kind !== "designs" && kind !== "records") throw new Error("Unsupported Library collection.");
  const page = options.page ?? 1, pageSize = options.pageSize ?? CONSOLE_COLLECTION_PAGE_SIZE;
  if (!Number.isSafeInteger(page) || page < 1 || pageSize !== CONSOLE_COLLECTION_PAGE_SIZE || !Number.isSafeInteger(page * pageSize)) throw new Error("Invalid Library page.");
  for (const id of [options.businessId, options.selectedId, options.creativeRunId]) if (id !== undefined && (typeof id !== "string" || !CONSOLE_COLLECTION_UUID.test(id))) throw new Error("Invalid Library identity.");
  if (options.creativeRunId !== undefined && (kind !== "designs" || options.selectedId !== undefined)) throw new Error("Conflicting Library identity.");
  if (options.query !== undefined && typeof options.query !== "string") throw new Error("Invalid Library search.");
  const query = (options.query ?? "").trim(), sort = options.sort ?? "newest", mediaType = options.mediaType ?? "all", artifactType = options.artifactType ?? "all";
  if (query.length > 120 || query.includes("*") || /[\u0000-\u001f\u007f]/.test(options.query ?? "")) throw new Error("Invalid Library search.");
  if (!["newest", "oldest"].includes(sort) || !(CONSOLE_LIBRARY_MEDIA_TYPES as readonly string[]).includes(mediaType) || !(CONSOLE_LIBRARY_ARTIFACT_TYPES as readonly string[]).includes(artifactType) || kind === "designs" && (mediaType !== "all" || artifactType !== "all")) throw new Error("Unsupported Library filter.");
  return { kind, businessId: options.businessId?.toLowerCase() ?? null, selectedId: options.selectedId?.toLowerCase() ?? null, creativeRunId: options.creativeRunId?.toLowerCase() ?? null, page, pageSize, offset: (page - 1) * pageSize, query, sort: sort as ConsoleLibraryQuery["sort"], mediaType, artifactType };
}
export function consoleLibraryOptionsFromSearch(params: Record<string, string | string[] | undefined>, kind?: ConsoleLibraryKind): ConsoleLibraryOptions {
  const one = (key: string) => { const value = params[key]; if (Array.isArray(value)) { if (value.length !== 1) throw new Error("Ambiguous Library query."); return value[0]; } return value; };
  const type = one("type"), route = kind ?? (type === "records" ? "records" : "designs");
  if (one("view") !== undefined && one("view") !== "library" || type !== undefined && type !== route || ["decision", "connectionRun", "run", "runFilter", "status"].some(key => one(key) !== undefined)) throw new Error("Conflicting Library identity or filter.");
  const optional = (key: string) => one(key) === "" ? undefined : one(key);
  const selected = optional("selected"), artifact = optional("artifact"), creativeRunId = optional("creativeRun");
  if (artifact && (route !== "records" || selected && selected.toLowerCase() !== artifact.toLowerCase())) throw new Error("Conflicting Library identity.");
  const number = (key: string) => one(key) === undefined ? undefined : /^\d+$/.test(one(key)!) ? Number(one(key)) : Number.NaN;
  const options = { businessId: optional("business"), selectedId: selected ?? artifact, creativeRunId, page: number("page"), pageSize: number("pageSize"), query: one("q"), sort: one("sort"), mediaType: one("mediaType"), artifactType: one("artifactType") };
  const normalized = consoleLibraryQuery(route, options);
  return { ...options, businessId: normalized.businessId ?? undefined, selectedId: normalized.selectedId ?? undefined, creativeRunId: normalized.creativeRunId ?? undefined };
}
/** Selection and close preserve aggregate Business scope, filters and page. */
export function consoleLibraryHref(current: URLSearchParams | Record<string, string | string[] | undefined>, changes: Record<string, string | number | null | undefined>): string {
  const params = current instanceof URLSearchParams ? new URLSearchParams(current) : new URLSearchParams();
  if (!(current instanceof URLSearchParams)) for (const [key, value] of Object.entries(current)) { if (typeof value === "string") params.set(key, value); else if (Array.isArray(value)) value.forEach(item => params.append(key, item)); }
  if (Object.hasOwn(changes, "selected")) { params.delete("artifact"); params.delete("creativeRun"); }
  if (Object.hasOwn(changes, "creativeRun") && changes.creativeRun !== null && changes.creativeRun !== undefined && changes.creativeRun !== "") { params.delete("selected"); params.delete("artifact"); }
  for (const [key, value] of Object.entries(changes)) { if (value === null || value === undefined || value === "") params.delete(key); else params.set(key, String(value)); }
  params.set("view", "library");
  if (!Object.hasOwn(changes, "page") && ["business", "q", "sort", "mediaType", "artifactType", "type"].some(key => Object.hasOwn(changes, key))) params.delete("page");
  return `/dashboard?${params.toString()}`;
}
