/** Work and raw Activity navigation only. Existing Decisions/action returns stay separate. */
export const CONSOLE_COLLECTION_PAGE_SIZE = 25;
export const CONSOLE_COLLECTION_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export type ConsoleCollectionKind = "work" | "activity";
export type ConsoleCollectionOptions = {
  businessId?: string; page?: number; pageSize?: number; query?: string;
  sort?: string; status?: string; selectedId?: string; workflowRunId?: string; artifactId?: string;
};
export type ConsoleCollectionQuery = {
  businessId: string | null; page: number; pageSize: 25; offset: number;
  query: string; sort: "newest" | "oldest" | "updated"; status: string;
  selectedId: string | null; workflowRunId: string | null; artifactId: string | null;
};
export type ConsoleCollectionPage<T> = {
  items: T[]; page: number; pageSize: number; total: number | null;
  hasPrevious: boolean; hasNext: boolean | null;
  /** Only this page is complete; this never claims all history was loaded. */
  complete: boolean; errors: string[];
};
export type ConsoleCollectionSelection<T> =
  | { status: "none" | "missing" | "unavailable"; item: null }
  | { status: "found"; item: T };
const workStatuses = ["all", "active", "stopped", "running", "queued", "waiting", "review", "needs_owner", "completed", "failed", "cancelled"];
export function consoleCollectionQuery(kind: ConsoleCollectionKind, options: ConsoleCollectionOptions = {}): ConsoleCollectionQuery {
  const page = options.page ?? 1, pageSize = options.pageSize ?? CONSOLE_COLLECTION_PAGE_SIZE;
  if (!Number.isSafeInteger(page) || page < 1 || pageSize !== CONSOLE_COLLECTION_PAGE_SIZE || !Number.isSafeInteger(page * pageSize)) throw new Error("Invalid collection page.");
  for (const id of [options.businessId, options.selectedId, options.workflowRunId, options.artifactId]) {
    if (id !== undefined && (typeof id !== "string" || !CONSOLE_COLLECTION_UUID.test(id))) throw new Error("Invalid collection identity.");
  }
  if (kind !== "activity" && options.workflowRunId !== undefined || kind !== "work" && options.artifactId !== undefined || options.artifactId && !options.selectedId) throw new Error("Conflicting collection identity.");
  const query = (options.query ?? "").trim(), sort = options.sort ?? "newest", status = options.status ?? "all";
  // PostgREST treats * as an alternate wildcard; reject it instead of broadening the search.
  if (query.length > 120 || query.includes("*") || /[\u0000-\u001f\u007f]/.test(options.query ?? "")) throw new Error("Invalid collection search.");
  if (!["newest", "oldest", ...(kind === "work" ? ["updated"] : [])].includes(sort) || !(kind === "work" ? workStatuses : ["all"]).includes(status)) throw new Error("Unsupported collection filter.");
  return { businessId: options.businessId ?? null, page, pageSize, offset: (page - 1) * pageSize, query, sort: sort as ConsoleCollectionQuery["sort"], status,
    selectedId: options.selectedId ?? null, workflowRunId: options.workflowRunId ?? null, artifactId: options.artifactId ?? null };
}
/** Literal substring search, passed only to field-specific ilike, never raw or expressions. */
export function consoleSearchPattern(value: string): string { return `%${value.replace(/[\\%_]/g, "\\$&")}%`; }
export function consoleCollectionOptionsFromSearch(params: Record<string, string | string[] | undefined>, kind?: ConsoleCollectionKind): ConsoleCollectionOptions {
  const one = (key: string) => {
    const value = params[key];
    if (Array.isArray(value)) { if (value.length !== 1) throw new Error("Ambiguous collection query."); return value[0]; }
    return value;
  };
  const view = one("view"), route = kind ?? (view === "activity" ? "activity" : "work");
  if (view !== undefined && view !== route) throw new Error("Conflicting collection view.");
  const optional = (key: string) => one(key) === "" ? undefined : one(key);
  const selected = optional("selected"), run = optional("run"), artifact = optional("artifact"), runFilter = optional("runFilter");
  // These collections must not reinterpret accepted Decisions or Connections identities.
  if (one("decision") !== undefined || one("connectionRun") !== undefined || route === "activity" && (run !== undefined || artifact !== undefined) || route === "work" && runFilter !== undefined || selected && run && selected !== run) throw new Error("Conflicting collection identity.");
  const page = one("page"), pageSize = one("pageSize");
  const options: ConsoleCollectionOptions = { businessId: optional("business"), selectedId: selected ?? run, artifactId: artifact, workflowRunId: runFilter,
    page: page === undefined ? undefined : /^\d+$/.test(page) ? Number(page) : Number.NaN,
    pageSize: pageSize === undefined ? undefined : /^\d+$/.test(pageSize) ? Number(pageSize) : Number.NaN,
    query: one("q"), sort: one("sort"), status: one("status") };
  consoleCollectionQuery(route, options);
  return options;
}
/** Closing only clears selection; paging never changes Business or filter context. */
export function consoleCollectionHref(current: URLSearchParams | Record<string, string | string[] | undefined>, changes: Record<string, string | number | null | undefined>): string {
  const params = current instanceof URLSearchParams ? new URLSearchParams(current) : new URLSearchParams();
  if (!(current instanceof URLSearchParams)) for (const [key, value] of Object.entries(current)) {
    if (typeof value === "string") params.set(key, value); else if (Array.isArray(value)) for (const item of value) params.append(key, item);
  }
  if (Object.hasOwn(changes, "selected")) { params.delete("run"); if (!Object.hasOwn(changes, "artifact")) params.delete("artifact"); }
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === undefined || value === "") params.delete(key); else params.set(key, String(value));
  }
  if (!Object.hasOwn(changes, "page") && ["business", "runFilter", "q", "status", "sort"].some(key => Object.hasOwn(changes, key))) params.delete("page");
  return `/dashboard${params.size ? `?${params.toString()}` : ""}`;
}
