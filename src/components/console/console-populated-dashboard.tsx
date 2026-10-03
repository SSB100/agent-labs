import Link from "next/link";
import { notFound } from "next/navigation";
import type { OwnerUiContext } from "@/lib/core-ui/data";
import type { WorkflowRunRecord, WorkflowEventRecord } from "@/lib/core-ui/workflows";
import { consoleEmptyPage, loadConsoleWorkPage, loadConsoleActivityPage, type ConsoleWorkPage, type ConsoleActivityPage } from "@/lib/core-ui/console-collections";
import { consoleCollectionOptionsFromSearch, consoleCollectionQuery, type ConsoleCollectionKind, type ConsoleCollectionQuery } from "@/lib/core-ui/console-collections-query";
import { loadConsoleWorkDetail } from "@/lib/core-ui/console-work-detail-data";
import { loadAccountSetupInterventions } from "@/accounts/server";
import { loadDiscoveryGoalData } from "@/products/discovery-v2-data";
import { deriveConsoleMotionSnapshot } from "@/lib/core-ui/console-motion";
import { ConsoleMotionBoundary } from "./console-motion";
import { loadConsoleObservationTime, loadConsoleResearchQuote } from "@/lib/core-ui/console-data";
import { ConsoleShell } from "./console-shell";
import { ConsoleCommandBar, ConsoleResearchSheet } from "./console-command";
import { ConsoleWorkCollectionPane, ConsoleActivityCollectionPane } from "./console-collection-panes";
import { ConsoleWorkDetail } from "./console-work-detail";
import { QuestKickoff } from "@/components/guided/quest-kickoff";

type Search = Record<string, string | string[] | undefined>;
/** Only collection state is retained. Action/Connections query namespaces are never reinterpreted. */
function collectionSearch(view: ConsoleCollectionKind, q: ConsoleCollectionQuery): URLSearchParams {
  const result = new URLSearchParams({ view });
  if (q.businessId) result.set("business", q.businessId);
  if (q.page > 1) result.set("page", String(q.page));
  if (q.query) result.set("q", q.query);
  if (q.status !== "all") result.set("status", q.status);
  if (q.sort !== "newest") result.set("sort", q.sort);
  if (q.selectedId) result.set("selected", q.selectedId);
  if (q.workflowRunId) result.set("runFilter", q.workflowRunId);
  if (q.artifactId) result.set("artifact", q.artifactId);
  return result;
}

/** Root-only bounded read projection. Legacy technical workspaces remain independently reachable. */
export async function ConsolePopulatedDashboard({ context, query, view }: { context: OwnerUiContext; query: Search; view: ConsoleCollectionKind }) {
  let q: ConsoleCollectionQuery;
  try {
    q = consoleCollectionQuery(view, consoleCollectionOptionsFromSearch(query, view));
    if (Array.isArray(query.sheet) || (query.sheet !== undefined && query.sheet !== "research")) notFound();
  } catch { notFound(); }
  if (q.businessId && !context.businessesUnavailable && !context.businesses.some(business => business.id === q.businessId)) notFound();
  const params = collectionSearch(view, q);
  const baseHref = `/dashboard?${params.toString()}`;
  const fragment = q.artifactId ? `#artifact-${q.artifactId}` : "";
  const returnTo = `${baseHref}${fragment}`;
  const researchHref = `${baseHref}&sheet=research${fragment}`;
  const options = consoleCollectionOptionsFromSearch(Object.fromEntries(params), view);
  const unavailable = "Business records are unavailable; saved work and activity could not be checked.";
  const [work, activity, detail, accountRequests] = await Promise.all([
    view === "work" ? context.businessesUnavailable ? {
      page: consoleEmptyPage<WorkflowRunRecord>(q, [unavailable]), selection: { status: q.selectedId ? "unavailable" : "none", item: null }, definitions: [], errors: [unavailable],
    } as ConsoleWorkPage : loadConsoleWorkPage(context, options) : null,
    view === "activity" ? context.businessesUnavailable ? {
      page: consoleEmptyPage<WorkflowEventRecord>(q, [unavailable]), selection: { status: q.selectedId ? "unavailable" : "none", item: null }, workflowFilter: null, runs: [], errors: [unavailable],
    } as ConsoleActivityPage : loadConsoleActivityPage(context, options) : null,
    view === "work" && q.selectedId && !context.businessesUnavailable ? loadConsoleWorkDetail(context, q.selectedId, { businessId: q.businessId ?? undefined, artifactId: q.artifactId ?? undefined }) : null,
    context.businessesUnavailable ? { records: [], unavailable: true, page: undefined, globalCount:undefined } : loadAccountSetupInterventions(context),
  ]);
  // Browsing an aggregate page must not silently narrow its filter to the selected record.
  const selected = work?.selection.status === "found" ? work.selection.item : activity?.selection.status === "found" ? activity.selection.item : null;
  const verifiedFilterBusinessId = activity?.workflowFilter?.business_id;
  const commandBusinessId = selected?.business_id ?? q.businessId ?? verifiedFilterBusinessId ?? undefined;
  const commandBusinesses = commandBusinessId ? context.businesses.filter(business => business.id === commandBusinessId) : context.businesses;
  const commandContext = { ...context, businesses: commandBusinesses };
  const researchSheet = query.sheet === "research";
  const catalog = researchSheet && !context.businessesUnavailable ? await loadDiscoveryGoalData(commandContext, []) : null;
  const quote = researchSheet ? await loadConsoleResearchQuote(commandContext, catalog?.available === true) : null;
  const observedAt = await loadConsoleObservationTime();
  const motionSnapshot = deriveConsoleMotionSnapshot({
    runs: [...new Map([...(work?.page.items ?? []), ...(detail?.run ? [detail.run] : [])].map(run => [run.id, run])).values()], stages: detail?.stages ?? [],
    tasks: detail?.tasks ?? [], workerRuns: detail?.workerRuns ?? [],
    artifacts: [...new Map([...(detail?.artifacts ?? []), ...(detail?.artifactSelection.status === "found" ? [detail.artifactSelection.item] : [])].map(artifact => [artifact.id, artifact])).values()],
    interventions: detail?.interventions ?? [], errors: detail ? detail.errors : work?.errors ?? activity?.errors ?? [],
  }, { businessIds: context.businesses.map(business => business.id), observedAt,
    unavailable: context.businessesUnavailable || (detail ? !detail.complete : work ? !work.page.complete : !activity?.page.complete) });
  const motionScope = detail?.run ? `run:${detail.run.id}` : `${view}:${q.businessId ?? "owned"}:page:${q.page}`;
  const displayContext = { ...context, needsYouCount: context.needsYouCount + (accountRequests.globalCount ?? accountRequests.page?.total ?? accountRequests.records.length), needsYouUnavailable: context.needsYouUnavailable || context.businessesUnavailable || accountRequests.unavailable };
  return <ConsoleShell active={view} context={displayContext} globalDecisionCount aggregateContext={!q.businessId} navigationBusinessId={q.businessId ?? selected?.business_id ?? verifiedFilterBusinessId ?? undefined} workflowRunId={detail?.run?.id}
    commandBar={<ConsoleCommandBar ownerId={context.userId} businessId={commandBusinessId} businessSelectionAvailable={context.businesses.length > 0} returnTo={returnTo} unavailable={context.businessesUnavailable}/> }>
    <ConsoleMotionBoundary ownerId={context.userId} scopeKey={motionScope} snapshot={motionSnapshot}>
    {work ? <ConsoleWorkCollectionPane ownerId={context.userId} businesses={context.businesses} searchParams={params} data={work}
      headerAction={<Link className="consoleMiniAction" href={researchHref}>New research goal</Link>}>
      {detail ? <ConsoleWorkDetail detail={detail} searchParams={params}/> : null}
    </ConsoleWorkCollectionPane> : null}
    {activity ? <ConsoleActivityCollectionPane ownerId={context.userId} businesses={context.businesses} searchParams={params} data={activity}/> : null}
    {researchSheet ? <ConsoleResearchSheet returnTo={returnTo}><QuestKickoff ownerId={context.userId} businesses={commandBusinesses} businessesUnavailable={context.businessesUnavailable} available={catalog?.available === true} quote={quote}/></ConsoleResearchSheet> : null}
    </ConsoleMotionBoundary>
  </ConsoleShell>;
}
