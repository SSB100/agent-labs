import { copyWorkspace } from "@/lib/core-ui/workspace-navigation";
import { notFound } from "next/navigation";
import type { OwnerUiContext } from "@/lib/core-ui/data";
import { loadAccountSetupInterventions } from "@/accounts/server";
import { loadDiscoveryGoalData } from "@/products/discovery-v2-data";
import { loadConsoleObservationTime, loadConsoleResearchQuote } from "@/lib/core-ui/console-data";
import { consoleLibraryHref, consoleLibraryOptionsFromSearch, consoleLibraryQuery, type ConsoleLibraryQuery } from "@/lib/core-ui/console-library-query";
import { loadConsoleLibraryPage, loadConsoleLibraryRecordsPage, type ConsoleLibraryPage, type ConsoleLibraryRecordsPage } from "@/lib/core-ui/console-library-data";
import { ConsoleShell } from "./console-shell";
import { ConsoleCommandBar, ConsoleResearchSheet } from "./console-command";
import { ConsoleLibraryPane } from "./console-library-pane";
import { QuestKickoff } from "@/components/guided/quest-kickoff";

type Search = Record<string, string | string[] | undefined>;
function canonicalLibrarySearch(q: ConsoleLibraryQuery): URLSearchParams {
  const params = new URLSearchParams({ view: "library", type: q.kind });
  if (q.businessId) params.set("business", q.businessId);
  if (q.selectedId) params.set("selected", q.selectedId);
  if (q.creativeRunId) params.set("creativeRun", q.creativeRunId);
  if (q.page > 1) params.set("page", String(q.page));
  if (q.query) params.set("q", q.query);
  if (q.sort !== "newest") params.set("sort", q.sort);
  if (q.mediaType !== "all") params.set("mediaType", q.mediaType);
  if (q.artifactType !== "all") params.set("artifactType", q.artifactType);
  return params;
}

/** Public owner-scoped saved records only. No provider, workflow or approval action on entry. */
export async function ConsoleLibraryDashboard({ context, query }: { context: OwnerUiContext; query: Search }) {
  let q: ConsoleLibraryQuery;
  try {
    if (Array.isArray(query.type) || Array.isArray(query.sheet) || query.sheet !== undefined && query.sheet !== "research") notFound();
    const kind = query.type === "records" ? "records" : "designs";
    q = consoleLibraryQuery(kind, consoleLibraryOptionsFromSearch(query, kind));
  } catch { notFound(); }
  if (q.businessId && !context.businessesUnavailable && !context.businesses.some(business => business.id === q.businessId)) notFound();
  const params = canonicalLibrarySearch(q); copyWorkspace(params, query); const returnTo = consoleLibraryHref(params, {});
  const options = consoleLibraryOptionsFromSearch(Object.fromEntries(params), q.kind);
  let data: ConsoleLibraryPage | ConsoleLibraryRecordsPage;
  if (context.businessesUnavailable) {
    const errors = ["Business records are unavailable; saved Library records could not be checked."];
    const shared = { query: q, page: { items: [], page: q.page, pageSize: q.pageSize, total: null, hasPrevious: q.page > 1, hasNext: null, complete: false, errors }, selection: { status: q.selectedId ? "unavailable" as const : "none" as const, item: null }, errors };
    data = q.kind === "designs" ? { ...shared, runDetail: null } : shared;
  } else data = q.kind === "designs" ? await loadConsoleLibraryPage(context, options) : await loadConsoleLibraryRecordsPage(context, options);
  const selectedBusinessId = data.selection.status === "found" ? data.selection.item.business_id
    : "runDetail" in data && data.runDetail?.selection.status === "found" ? data.runDetail.selection.item.business_id : undefined;
  const navigationBusinessId = q.businessId ?? selectedBusinessId;
  const commandBusinessId = selectedBusinessId ?? q.businessId ?? undefined;
  const commandBusinesses = commandBusinessId ? context.businesses.filter(business => business.id === commandBusinessId) : context.businesses;
  const commandContext = { ...context, businesses: commandBusinesses };
  const researchSheet = query.sheet === "research";
  const [accountRequests, catalog, observedAt] = await Promise.all([
    context.businessesUnavailable ? { records: [], unavailable: true, page: undefined, globalCount:undefined } : loadAccountSetupInterventions(context),
    researchSheet && !context.businessesUnavailable ? loadDiscoveryGoalData(commandContext, []) : null,
    loadConsoleObservationTime(),
  ]);
  const quote = researchSheet && !context.businessesUnavailable ? await loadConsoleResearchQuote(commandContext, catalog?.available === true) : null;
  const displayContext = { ...context, needsYouCount: context.needsYouCount + (accountRequests.globalCount ?? accountRequests.page?.total ?? accountRequests.records.length), needsYouUnavailable: context.needsYouUnavailable || context.businessesUnavailable || accountRequests.unavailable };
  return <ConsoleShell active="library" context={displayContext} globalDecisionCount aggregateContext={!q.businessId} navigationBusinessId={navigationBusinessId}
    commandBar={<ConsoleCommandBar ownerId={context.userId} businessId={commandBusinessId} businessSelectionAvailable={context.businesses.length > 0} returnTo={returnTo} unavailable={context.businessesUnavailable}/> }>
    <ConsoleLibraryPane ownerId={context.userId} businesses={context.businesses} searchParams={params} data={data} now={observedAt}/>
    {researchSheet ? <ConsoleResearchSheet returnTo={returnTo}><QuestKickoff ownerId={context.userId} businesses={commandBusinesses} businessesUnavailable={context.businessesUnavailable} available={catalog?.available === true} quote={quote}/></ConsoleResearchSheet> : null}
  </ConsoleShell>;
}
