import { consoleResearchOptionsFromSearch, consoleResearchQuery, consoleResearchSearch } from "./console-research-query";

type Search = Record<string, string | string[] | undefined>;
const browseKeys = new Set(["view", "type", "business", "selected", "experiment", "root", "page", "pageSize", "q", "searchField", "sort", "attemptPage", "attemptSort", "sheet"]);

/** Only former read-only results URLs. Candidate/action/notice routes keep their handler.
 * Actual old fragments name the aggregate discovery-goal-results section, not an ID.
 * No artifact, workflow or arbitrary fragment is treated as a Research record identity. */
export function consoleResearchAlias(source: "library" | "products", query: Search): Search | null {
  if (source === "products") {
    if (query.view !== "results" || Object.keys(query).some(key => query[key] !== undefined && !browseKeys.has(key))) return null;
    if (query.type !== undefined) return null;
  } else if (query.view !== "library" || query.type !== "research") throw new Error("Invalid legacy Research route.");
  const next: Search = { ...query, view: "research", type: "roots" };
  const q = consoleResearchQuery("roots", consoleResearchOptionsFromSearch(next));
  return Object.fromEntries(consoleResearchSearch(q, next.sheet === "research"));
}
