import { CONSOLE_COLLECTION_PAGE_SIZE, CONSOLE_COLLECTION_UUID, consoleSearchPattern } from "./console-collections-query";

export type ConsoleResearchKind = "roots" | "records";
export type ConsoleResearchOptions = {
  businessId?: string; selectedId?: string; rootId?: string; page?: number; pageSize?: number;
  query?: string; searchField?: string; sort?: string; attemptPage?: number; attemptSort?: string;
};
export type ConsoleResearchQuery = {
  kind: ConsoleResearchKind; businessId: string | null; selectedId: string | null; rootId: string | null;
  page: number; pageSize: 25; offset: number; query: string; searchField: "objective" | "hypothesis";
  sort: "newest" | "oldest"; attemptPage: number; attemptOffset: number; attemptSort: "newest" | "oldest";
};
export { consoleSearchPattern as consoleResearchSearchPattern };
const optionKeys = ["businessId", "selectedId", "rootId", "page", "pageSize", "query", "searchField", "sort", "attemptPage", "attemptSort"];
const searchKeys = ["view", "type", "business", "selected", "experiment", "root", "page", "pageSize", "q", "searchField", "sort", "attemptPage", "attemptSort", "sheet", "businessPage", "businessQuery", "accountOpenPage", "quest", "episode", "step", "agent", "sourceArtifact"];
function pageNumber(value: number): boolean { return Number.isSafeInteger(value) && value >= 1 && Number.isSafeInteger(value * CONSOLE_COLLECTION_PAGE_SIZE); }

/** Raw saved-record navigation, never latest-state or fully verified Quest filtering. */
export function consoleResearchQuery(kind: ConsoleResearchKind, options: ConsoleResearchOptions = {}): ConsoleResearchQuery {
  if (kind !== "roots" && kind !== "records") throw new Error("Unsupported Research collection.");
  if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some(key => !optionKeys.includes(key))) throw new Error("Unsupported Research option.");
  if ([options.page, options.pageSize, options.attemptPage].some(value => value !== undefined && typeof value !== "number") || [options.searchField, options.sort, options.attemptSort].some(value => value !== undefined && typeof value !== "string")) throw new Error("Invalid Research option type.");
  const page = options.page ?? 1, attemptPage = options.attemptPage ?? 1, pageSize = options.pageSize ?? CONSOLE_COLLECTION_PAGE_SIZE;
  if (!pageNumber(page) || !pageNumber(attemptPage) || pageSize !== CONSOLE_COLLECTION_PAGE_SIZE) throw new Error("Invalid Research page.");
  for (const id of [options.businessId, options.selectedId, options.rootId]) if (id !== undefined && (typeof id !== "string" || !CONSOLE_COLLECTION_UUID.test(id))) throw new Error("Invalid Research identity.");
  if (options.query !== undefined && typeof options.query !== "string") throw new Error("Invalid Research search.");
  const query = (options.query ?? "").trim(), searchField = options.searchField ?? "objective", sort = options.sort ?? "newest", attemptSort = options.attemptSort ?? "newest";
  if (query.length > 120 || query.includes("*") || /[\u0000-\u001f\u007f]/.test(options.query ?? "")) throw new Error("Invalid Research search.");
  if (!["objective", "hypothesis"].includes(searchField) || query && options.searchField === undefined) throw new Error("Choose the saved Research search field explicitly.");
  if (!["newest", "oldest"].includes(sort) || !["newest", "oldest"].includes(attemptSort)) throw new Error("Unsupported Research sort.");
  if ((options.attemptPage !== undefined || options.attemptSort !== undefined) && !options.selectedId && !options.rootId) throw new Error("Research attempts require an exact root selection.");
  return { kind, businessId: options.businessId?.toLowerCase() ?? null, selectedId: options.selectedId?.toLowerCase() ?? null, rootId: options.rootId?.toLowerCase() ?? null,
    page, pageSize, offset: (page - 1) * pageSize, query, searchField: searchField as ConsoleResearchQuery["searchField"], sort: sort as ConsoleResearchQuery["sort"],
    attemptPage, attemptOffset: (attemptPage - 1) * pageSize, attemptSort: attemptSort as ConsoleResearchQuery["attemptSort"] };
}

export function consoleResearchOptionsFromSearch(params: Record<string, string | string[] | undefined>, kind?: ConsoleResearchKind): ConsoleResearchOptions {
  if (Object.keys(params).some(key => params[key] !== undefined && !searchKeys.includes(key))) throw new Error("Unsupported Research query.");
  if (Array.isArray(params.sheet) || params.sheet !== undefined && params.sheet !== "research") throw new Error("Unsupported Research sheet.");
  const one = (key: string) => { const value = params[key]; if (Array.isArray(value)) { if (value.length !== 1) throw new Error("Ambiguous Research query."); return value[0]; } return value; };
  const type = one("type"), route = kind ?? (type === "records" ? "records" : "roots");
  if (one("view") !== undefined && one("view") !== "research" || type !== undefined && type !== route) throw new Error("Conflicting Research view.");
  const optional = (key: string) => one(key) === "" ? undefined : one(key);
  const selected = optional("selected"), experiment = optional("experiment");
  if (selected && experiment && selected.toLowerCase() !== experiment.toLowerCase()) throw new Error("Conflicting Research identity.");
  const number = (key: string) => one(key) === undefined ? undefined : /^\d+$/.test(one(key)!) ? Number(one(key)) : Number.NaN;
  const options: ConsoleResearchOptions = { businessId: optional("business"), selectedId: selected ?? experiment, rootId: optional("root"), page: number("page"), pageSize: number("pageSize"),
    query: one("q"), searchField: one("searchField"), sort: one("sort"), attemptPage: number("attemptPage"), attemptSort: one("attemptSort") };
  const normalized = consoleResearchQuery(route, options);
  return { ...options, businessId: normalized.businessId ?? undefined, selectedId: normalized.selectedId ?? undefined, rootId: normalized.rootId ?? undefined };
}

/** One canonical browse scope, including independent main and attempt cursors. */
export function consoleResearchSearch(q: ConsoleResearchQuery, sheet = false): URLSearchParams {
  const params = new URLSearchParams({ view: "research", type: q.kind });
  if (q.businessId) params.set("business", q.businessId);
  if (q.selectedId) params.set("selected", q.selectedId);
  if (q.rootId) params.set("root", q.rootId);
  if (q.page > 1) params.set("page", String(q.page));
  if (q.query) params.set("q", q.query);
  if (q.searchField !== "objective" || q.query) params.set("searchField", q.searchField);
  if (q.sort !== "newest") params.set("sort", q.sort);
  if (q.attemptPage > 1) params.set("attemptPage", String(q.attemptPage));
  if (q.attemptSort !== "newest") params.set("attemptSort", q.attemptSort);
  if (sheet) params.set("sheet", "research");
  return params;
}

/** Exact selection keeps the raw page/filter. Changing scope resets both page cursors. */
export function consoleResearchHref(current: URLSearchParams | Record<string, string | string[] | undefined>, changes: Record<string, string | number | null | undefined>): string {
  const params = current instanceof URLSearchParams ? new URLSearchParams(current) : new URLSearchParams();
  if (!(current instanceof URLSearchParams)) for (const [key, value] of Object.entries(current)) { if (typeof value === "string") params.set(key, value); else if (Array.isArray(value)) value.forEach(item => params.append(key, item)); }
  if (Object.hasOwn(changes, "selected")) params.delete("experiment");
  for (const [key, value] of Object.entries(changes)) { if (value === null || value === undefined || value === "") params.delete(key); else params.set(key, String(value)); }
  params.set("view", "research");
  if (!Object.hasOwn(changes, "page") && ["business", "q", "searchField", "sort", "type"].some(key => Object.hasOwn(changes, key))) params.delete("page");
  if (!Object.hasOwn(changes, "attemptPage") && ["business", "root", "selected", "attemptSort"].some(key => Object.hasOwn(changes, key))) params.delete("attemptPage");
  if (!params.has("selected") && !params.has("experiment") && !params.has("root")) { params.delete("attemptPage"); params.delete("attemptSort"); }
  const record: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) { const values = params.getAll(key); record[key] = values.length === 1 ? values[0] : values; }
  consoleResearchOptionsFromSearch(record);
  return `/dashboard?${params.toString()}`;
}

/** A separate exact R12 selection, never interpreted as a legacy experiment. */
export function consoleR12ResearchSelection(params:Record<string,string|string[]|undefined>){
 const allowed=new Set(["view","type","business","selected","quest"]);
 if(Object.entries(params).some(([key,value])=>value!==undefined&&(!allowed.has(key)||typeof value!=="string"))||params.view!=="research"||params.type!=="r12"||typeof params.business!=="string"||!CONSOLE_COLLECTION_UUID.test(params.business)||typeof params.selected!=="string"||!CONSOLE_COLLECTION_UUID.test(params.selected)||(params.quest!==undefined&&(typeof params.quest!=="string"||!CONSOLE_COLLECTION_UUID.test(params.quest))))throw Error("Invalid exact discovery selection");
 return{businessId:params.business.toLowerCase(),scopeId:params.selected.toLowerCase(),goalId:typeof params.quest==="string"?params.quest.toLowerCase():null};
}
