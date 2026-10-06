import { copyWorkspace } from "@/lib/core-ui/workspace-navigation";
import { verifyOwnerBusiness } from "@/lib/core-ui/owner-business";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { OwnerUiContext } from "@/lib/core-ui/data";
import { loadAccountSetupInterventions } from "@/accounts/server";
import { loadDiscoveryGoalData } from "@/products/discovery-v2-data";
import { loadConsoleObservationTime, loadConsoleResearchQuote } from "@/lib/core-ui/console-data";
import { consoleResearchHref, consoleResearchOptionsFromSearch, consoleResearchQuery, consoleResearchSearch, type ConsoleResearchQuery } from "@/lib/core-ui/console-research-query";
import { CONSOLE_RESEARCH_LIMITS, loadConsoleResearchPage, loadConsoleResearchRecordsPage, type ConsoleResearchPage, type ConsoleResearchHistorical } from "@/lib/core-ui/console-research-data";
import { loadConsoleResearchEvidence } from "@/lib/core-ui/console-research-evidence";
import { ConsoleShell } from "./console-shell";
import { ConsoleCommandBar, ConsoleResearchSheet } from "./console-command";
import { ConsoleResearchPane, ConsoleResearchEvidenceContent } from "./console-research-pane";
import { ConsoleCollectionViewport } from "./console-collection-viewport";
import { ConsoleResearchEvidenceReady } from "./console-research-evidence-ready";
import { QuestKickoff } from "@/components/guided/quest-kickoff";

type Search = Record<string, string | string[] | undefined>;
/** Separately streamed exact content. Loading never attests a ready historical result. */
export async function ConsoleResearchExactEvidence({ context, record, observedAt, scopeHref }: { context: OwnerUiContext; record: ConsoleResearchHistorical; observedAt: string; scopeHref: string }) {
  const evidence = await loadConsoleResearchEvidence(context, { experimentId: record.id, businessId: record.business_id, observedAt });
  return <><ConsoleResearchEvidenceContent record={record} evidence={evidence} scopeHref={scopeHref}/><ConsoleResearchEvidenceReady ownerId={context.userId} scopeHref={scopeHref} recordId={record.id} businessId={record.business_id}/></>;
}
function unavailablePage(q: ConsoleResearchQuery): ConsoleResearchPage {
  const errors = ["Business records are unavailable; saved Research records could not be checked."];
  return { query: q, countLabel: q.kind === "roots" ? "Raw persisted root records" : "Raw persisted research records",
    page: { items: [], page: q.page, pageSize: q.pageSize, total: null, hasPrevious: q.page > 1, hasNext: null, complete: false, errors },
    selection: { status: q.selectedId ? "unavailable" : "none", item: null }, root: { status: q.rootId ? "unavailable" : "none", item: null }, attempts: null, limits: CONSOLE_RESEARCH_LIMITS, errors };
}

/** Saved metadata entry point. Ordinary browsing makes no quote, catalogue or action call. */
export async function ConsoleResearchDashboard({ context, query }: { context: OwnerUiContext; query: Search }) {
  if(query.type==="r12"){const {ConsoleR12Discovery}=await import("./console-r12-discovery");return <ConsoleR12Discovery context={context} query={query}/>;}
  let q: ConsoleResearchQuery;
  try { const kind = query.type === "records" ? "records" : "roots"; q = consoleResearchQuery(kind, consoleResearchOptionsFromSearch(query, kind)); }
  catch { notFound(); }
  if (q.businessId && !context.businessesUnavailable && !context.businesses.some(business => business.id === q.businessId)) notFound();
  const params = consoleResearchSearch(q); copyWorkspace(params, query);
  for(const key of ["businessPage","businessQuery","accountOpenPage"]){const value=query[key];if(typeof value==="string")params.set(key,value);}
  const returnTo = consoleResearchHref(params, {});
  const [data, accountRequests, observedAt] = await Promise.all([
    context.businessesUnavailable ? unavailablePage(q) : (q.kind === "roots" ? loadConsoleResearchPage : loadConsoleResearchRecordsPage)(context, consoleResearchOptionsFromSearch(Object.fromEntries(params), q.kind)),
    context.businessesUnavailable ? { records: [], unavailable: true, page: undefined, globalCount:undefined } : loadAccountSetupInterventions(context),
    loadConsoleObservationTime(),
  ]);
  const primary = q.selectedId ? data.selection : q.rootId ? data.root : data.selection;
  const expectedId = q.selectedId ?? q.rootId;
  const exact = !context.businessesUnavailable && primary.status === "found" && primary.item.id === expectedId && (await verifyOwnerBusiness(context,primary.item.business_id)) && (!q.businessId || q.businessId === primary.item.business_id) ? primary.item : null;
  const commandBusinessId = q.businessId ?? exact?.business_id;
  const commandBusinesses = commandBusinessId ? context.businesses.filter(business => business.id === commandBusinessId) : context.businesses;
  const commandContext = { ...context, businesses: commandBusinesses };
  const researchSheet = query.sheet === "research";
  const catalog = researchSheet && !context.businessesUnavailable ? await loadDiscoveryGoalData(commandContext, []) : null;
  const quote = researchSheet && !context.businessesUnavailable ? await loadConsoleResearchQuote(commandContext, catalog?.available === true) : null;
  const displayContext = { ...context, needsYouCount: context.needsYouCount + (context.workspaceQuest ? accountRequests.page?.total ?? 0 : accountRequests.globalCount ?? accountRequests.page?.total ?? accountRequests.records.length), needsYouUnavailable: context.needsYouUnavailable || context.businessesUnavailable || accountRequests.unavailable };
  const evidenceContent = exact ? <Suspense key={`${returnTo}:${observedAt}:${JSON.stringify([exact.business_id, exact.id, exact.workflow_run_id, exact.discovery_version, exact.candidate_id, exact.parent_discovery_id, exact.status, exact.completed_at, exact.source_artifact_id, exact.basis_artifact_id, exact.policy_hash, exact.authority_root_id, exact.prior_root_id])}`}
    fallback={<section className="consoleResearchNotice" role="status" aria-busy="true" data-research-evidence-loading={exact.id}><strong>Loading exact saved evidence</strong><p>Record {exact.id} · Business {exact.business_id}. Historical evidence is not ready; no recommendation or completion has been established.</p></section>}>
    <ConsoleResearchExactEvidence context={context} record={exact} observedAt={new Date(observedAt).toISOString()} scopeHref={returnTo}/>
  </Suspense> : undefined;
  return <ConsoleShell active="research" context={displayContext} globalDecisionCount={!context.workspaceQuest} aggregateContext={!q.businessId} navigationBusinessId={commandBusinessId}
    commandBar={<ConsoleCommandBar ownerId={context.userId} businessId={commandBusinessId} businessSelectionAvailable={context.businesses.length > 0} returnTo={returnTo} unavailable={context.businessesUnavailable}/> }>
    <ConsoleResearchPane data={data} evidence={null} evidenceContent={evidenceContent} ownerId={context.userId} businesses={context.businesses} searchParams={params}
      researchHref={consoleResearchHref(params, { sheet: "research" })} scopeHref={returnTo} viewport={<ConsoleCollectionViewport ownerId={context.userId} scopeHref={returnTo}/>}/>
    {researchSheet ? <ConsoleResearchSheet returnTo={returnTo}><QuestKickoff ownerId={context.userId} businesses={commandBusinesses} businessesUnavailable={context.businessesUnavailable} available={catalog?.available === true} quote={quote}/></ConsoleResearchSheet> : null}
  </ConsoleShell>;
}
