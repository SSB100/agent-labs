import Link from "next/link";
import { notFound } from "next/navigation";
import { ConsoleShell, consoleAdvancedNavigation, type ConsoleView } from "@/components/console/console-shell";
import { ConsoleOverview, deriveConsoleOverview } from "@/components/console/console-overview";
import { ConsoleCommandBar, ConsoleResearchSheet } from "@/components/console/console-command";
import { ConsoleMotionBoundary } from "@/components/console/console-motion";
import { consoleCentreMode } from "@/browser/console-view";
import { loadConsoleBrowserWorkspace } from "@/browser/console-server";
import { deriveConsoleMotionSnapshot } from "@/lib/core-ui/console-motion";
import { ConsoleWorkPane } from "@/components/console/console-work-pane";
import { QuestKickoff } from "@/components/guided/quest-kickoff";
import { CreativeLibrary } from "@/components/guided/creative-library";
import { ActivityFeed } from "@/components/stage7/workflow-visuals";
import type { ArtifactRecord } from "@/lib/core-ui/workflows";
import { loadWorkflowCollection, loadWorkflowDetail, requireOwnerUiContext } from "@/lib/core-ui/data";
import { loadRunCostData } from "@/lib/core-ui/run-outcome-data";
import { consoleConnectionSummary, consoleCostSummary, loadConsoleObservationTime, loadConsoleResearchQuote } from "@/lib/core-ui/console-data";
import { loadAccountSetupInterventions, loadAccountWorkspace } from "@/accounts/server";
import { loadCreativeWorkspace } from "@/creative/data";
import { loadProductWorkspace } from "@/products/data";
import { loadDiscoveryGoalData } from "@/products/discovery-v2-data";
import { DiscoveryGoalResults } from "@/components/stage13/discovery-goal-workspace";
import { CompactConnectionsWorkspace } from "./accounts/account-workspace";
import { createBusiness, resumeSyntheticReview } from "./actions";
import { resumeBrowserControl } from "./browser-actions";
import { acknowledgeEtsySimulation } from "./packs/actions";
import { ConsoleCompactDecisions } from "@/components/console/console-compact-decisions";
import { loadConsoleDecisionPage } from "@/lib/core-ui/console-decisions-data";
import { consoleDecisionHref, consoleDecisionOptionsFromSearch, consoleDecisionQuery, consoleDecisionNotice, type ConsoleDecisionQuery } from "@/lib/core-ui/console-decisions-query";
import { acknowledgeTerminalCreativeReview } from "./terminal-review-actions";
import LegacyDashboard from "./legacy-dashboard";
import "@/components/console/console-panes.css";
import "./accounts/accounts.css";
import "./products/products.css";

export const dynamic = "force-dynamic";
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
const views = new Set<ConsoleView>(["overview", "work", "library", "decisions", "connections", "activity", "advanced"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.AGENTLABS_GUIDED_UI === "legacy") return <LegacyDashboard searchParams={searchParams}/>;
  const context = await requireOwnerUiContext(), query = await searchParams;
  const proposedView = first(query.view) as ConsoleView | undefined;
  const view = proposedView && views.has(proposedView) ? proposedView : "overview";
  let decisionQuery: ConsoleDecisionQuery | null = null;
  if (view === "decisions") {
    try { decisionQuery = consoleDecisionQuery(consoleDecisionOptionsFromSearch(query)); }
    catch { notFound(); }
  }
  const centreMode = consoleCentreMode(first(query.centre));
  const browserRunId = view === "overview" ? first(query.browserRun) : undefined;
  if (browserRunId && !uuid.test(browserRunId)) notFound();
  const runId = first(query.run), businessId = first(query.business), researchSheet = first(query.sheet) === "research";
  if (runId && !uuid.test(runId)) notFound();
  const workArtifactId = view === "work" ? first(query.artifact) : undefined;
  if (workArtifactId && !uuid.test(workArtifactId)) notFound();
  if (businessId && !context.businessesUnavailable && !context.businesses.some(business => business.id === businessId)) notFound();
  const [collection, detail] = await Promise.all([loadWorkflowCollection(context, { limit: 80 }), view === "work" && runId ? loadWorkflowDetail(context, runId) : null]);
  if (detail && businessId && detail.run.business_id !== businessId) notFound();
  const overviewState = deriveConsoleOverview(context, collection);
  const selectedBusiness = view === "decisions" ? context.businesses.find(business => business.id === decisionQuery?.businessId) : context.businesses.find(business => business.id === (businessId ?? detail?.run.business_id ?? overviewState.currentRun?.business_id)) ?? context.businesses[0];
  const scopedContext = selectedBusiness ? { ...context, businesses: [selectedBusiness] } : context;
  const focusRun = detail?.run ?? overviewState.currentRun ?? collection.runs[0];
  const focusDefinition = detail?.definition ?? collection.definitions.find(definition => definition.id === focusRun?.workflow_definition_id);
  const selectedBrowserRunId = browserRunId ?? (focusRun?.business_id === selectedBusiness?.id ? focusRun?.id : undefined);
  const current = new URLSearchParams({ view });
  if (selectedBusiness) current.set("business", selectedBusiness.id);
  if (view === "overview") {
    current.set("centre", centreMode);
    if (selectedBrowserRunId) current.set("browserRun", selectedBrowserRunId);
  }
  if (view === "work" && runId) current.set("run", runId);
  if (view === "connections" && first(query.connectionRun)) current.set("connectionRun", first(query.connectionRun)!);
  if (view === "connections" && ["etsy", "printful"].includes(first(query.provider) ?? "")) current.set("provider", first(query.provider)!);
  if (workArtifactId) current.set("artifact", workArtifactId);
  if (view === "library" && ["research", "records"].includes(first(query.type) ?? "")) current.set("type", first(query.type)!);
  if (view === "library" && first(query.artifact)) current.set("artifact", first(query.artifact)!);
  const returnTo = decisionQuery ? consoleDecisionHref(decisionQuery) : `/dashboard?${current.toString()}`;
  const [accounts, costs, products, creative, catalog, accountRequests, decisions, browserData] = await Promise.all([
    (view === "overview" || view === "connections") && selectedBusiness ? loadAccountWorkspace(context, selectedBusiness.id) : null,
    (view === "overview" || (view === "work" && detail)) && focusRun ? loadRunCostData(context, focusRun, focusDefinition) : null,
    !context.businessesUnavailable && ((view === "work" && detail) || (view === "library" && first(query.type) === "research")) ? loadProductWorkspace(scopedContext, view === "work" ? runId : undefined) : null,
    !context.businessesUnavailable && view === "library" && !["research", "records"].includes(first(query.type) ?? "") ? loadCreativeWorkspace(scopedContext) : null,
    researchSheet ? loadDiscoveryGoalData(scopedContext, []) : null,
    context.businessesUnavailable ? { records: [], unavailable: true } : loadAccountSetupInterventions(context),
    decisionQuery ? loadConsoleDecisionPage(context, { businessId: decisionQuery.businessId ?? undefined, selectedId: decisionQuery.selectedId ?? undefined, page: decisionQuery.page, status: decisionQuery.status }) : null,
    view === "overview" ? loadConsoleBrowserWorkspace(context, { businessId: selectedBusiness?.id, workflowRunId: selectedBrowserRunId }) : null,
  ]);
  const verifiedDecisionBusinessId = decisions?.selection.status === "found" ? decisions.selection.item.business_id : undefined;
  const commandBusinessId = verifiedDecisionBusinessId ?? selectedBusiness?.id;
  const commandBusinesses = verifiedDecisionBusinessId ? context.businesses.filter(business => business.id === verifiedDecisionBusinessId) : scopedContext.businesses;
  const connectionRunId = view === "connections" ? first(query.connectionRun) : undefined;
  if (connectionRunId && !uuid.test(connectionRunId)) notFound();
  const artifactId = view === "library" && first(query.type) === "records" ? first(query.artifact) : undefined;
  if (artifactId && !uuid.test(artifactId)) notFound();
  let selectedArtifact: ArtifactRecord | null = null;
  let artifactUnavailable = context.businessesUnavailable === true;
  if (artifactId && !artifactUnavailable) {
    const result = await context.supabase.from("artifacts").select("id,business_id,workflow_run_id,task_contract_id,artifact_type,name,media_type,storage_path,content,metadata,created_at,updated_at").eq("id", artifactId).in("business_id", scopedContext.businesses.map(business => business.id)).maybeSingle();
    artifactUnavailable = Boolean(result.error);
    selectedArtifact = result.data as ArtifactRecord | null;
    if (!artifactUnavailable && !selectedArtifact) notFound();
  }
  const discovery = view === "library" && products ? await loadDiscoveryGoalData(scopedContext, products.experiments) : null;
  const quote = researchSheet || discovery ? await loadConsoleResearchQuote(scopedContext, catalog?.available === true || discovery?.available === true) : null;
  const observedAt = await loadConsoleObservationTime();
  const decisionRecords = decisions ? [...new Map([...decisions.page.items, ...(decisions.selection.status === "found" ? [decisions.selection.item] : [])].map(item => [item.id, item])).values()] : [];
  const motionCollection = decisions ? { ...collection, runs: decisions.runs, stages: decisions.detail?.stages.status === "ready" ? [...decisions.detail.stages.records] : [], tasks: [], workerRuns: [], artifacts: [], interventions: decisionRecords, errors: decisions.errors }
    : detail ? { ...detail, runs: [detail.run] } : collection;
  const motionSnapshot = deriveConsoleMotionSnapshot(motionCollection, { businessIds: context.businesses.map(business => business.id), observedAt, unavailable: context.businessesUnavailable || (decisions ? !decisions.page.complete : !detail && collection.truncated === true) });
  const motionScope = decisions ? `decisions:${decisions.query.businessId ?? "owned"}:page:${decisions.query.page}` : detail ? `run:${detail.run.id}` : "recent-owned-work";
  const displayContext = { ...context, needsYouCount: context.needsYouCount + (accountRequests?.records.length ?? 0), needsYouUnavailable: context.needsYouUnavailable || context.businessesUnavailable || accountRequests?.unavailable === true };
  const decisionNotice = view === "decisions" ? consoleDecisionNotice("error", first(query.error)) ?? consoleDecisionNotice("message", first(query.message)) : null;
  const decisionOutcome = decisionNotice?.terminal && decisions?.selection.status === "found" ? { interventionId: decisions.selection.item.id, tone: decisionNotice.tone, text: decisionNotice.text } : null;
  const generalDecisionNotice = decisionNotice && (!decisionNotice.terminal || (decisionNotice.tone === "error" && !decisionOutcome)) ? { tone: decisionNotice.tone, text: decisionNotice.text } : null;
  return <ConsoleShell active={view} context={displayContext} globalDecisionCount navigationBusinessId={selectedBusiness?.id} workflowRunId={detail?.run.id} commandBar={<ConsoleCommandBar ownerId={context.userId} businessId={commandBusinessId} returnTo={returnTo} unavailable={context.businessesUnavailable}/> }>
    <ConsoleMotionBoundary ownerId={context.userId} scopeKey={motionScope} snapshot={motionSnapshot}>
    {view === "overview" ? <ConsoleOverview context={displayContext} centreMode={centreMode} browserData={browserData ?? undefined} navigationBusinessId={selectedBusiness?.id} researchHref={`${returnTo}&sheet=research`} collection={collection} costs={consoleCostSummary(costs, `Current timeline run · ${focusRun?.id.slice(0, 8) ?? "not selected"}`, focusRun?.id)} connections={consoleConnectionSummary(accounts, selectedBusiness?.name ?? "Business", observedAt)}/> : null}
    {view === "work" ? <ConsoleWorkPane context={context} selectedArtifactId={workArtifactId} navigationBusinessId={selectedBusiness?.id} researchHref={`${returnTo}&sheet=research`} collection={collection} detail={detail} products={products ?? undefined} costs={costs}/> : null}
    {view === "decisions" && decisions ? <ConsoleCompactDecisions data={decisions} businesses={context.businesses} businessId={decisionQuery?.businessId ?? undefined} actions={{ acknowledgeStoppedCreative: acknowledgeTerminalCreativeReview, syntheticReview: resumeSyntheticReview, browserControl: resumeBrowserControl, simulationReview: acknowledgeEtsySimulation }} outcome={decisionOutcome} notice={generalDecisionNotice} connectionRequests={{ count: accountRequests?.unavailable ? null : (accountRequests?.records ?? []).filter(request => !decisionQuery?.businessId || request.businessId === decisionQuery.businessId).length, unavailable: accountRequests?.unavailable === true, records: (accountRequests?.records ?? []).filter(request => !decisionQuery?.businessId || request.businessId === decisionQuery.businessId) }}/> : null}
    {view === "library" ? <section className="consolePane"><header className="consolePaneHeader"><div><h1>Library</h1><p>{selectedBusiness?.name ?? "Business context unavailable"} · saved outputs and evidence</p></div><div><Link className="consoleMiniAction" href={`/dashboard?view=library${selectedBusiness ? `&business=${selectedBusiness.id}` : ""}`}>Designs</Link>{" "}<Link className="consoleMiniAction" href={`/dashboard?view=library&type=research${selectedBusiness ? `&business=${selectedBusiness.id}` : ""}`}>Research</Link></div></header><div className="consolePaneScroll">{context.businessesUnavailable ? <p className="coreNotice" role="alert">Business records are unavailable. Saved outputs could not be checked.</p> : first(query.type) === "records" ? artifactUnavailable ? <p role="alert">This output could not be loaded; its absence is not confirmed.</p> : selectedArtifact ? <article className="consoleDetails"><h2>{selectedArtifact.name}</h2><p>{selectedArtifact.artifact_type} · {selectedArtifact.created_at}</p><details><summary>Exact saved record</summary><pre>{JSON.stringify(selectedArtifact.content ?? selectedArtifact.metadata, null, 2)}</pre></details></article> : <p>Select a saved output to inspect its exact record.</p> : creative ? <CreativeLibrary data={creative} businesses={scopedContext.businesses} now={observedAt}/> : discovery ? <DiscoveryGoalResults data={discovery} quote={quote}/> : <p>Saved output records could not be checked.</p>}<p><Link className="consoleMiniAction" href={`/dashboard/artifacts${selectedBusiness ? `?business=${selectedBusiness.id}` : ""}`}>Exact creative approvals and receipts</Link></p></div></section> : null}
    {view === "connections" ? <section className="consolePane consoleConnectionsPane"><header className="consolePaneHeader"><div><h1>Connections</h1><p>{selectedBusiness?.name ?? "Business context unavailable"} · Saved account access and exact setup requests</p></div>{context.businesses.length > 1 ? <form method="get" className="connectionBusinessSelect"><input type="hidden" name="view" value="connections"/><label>Business <select name="business" defaultValue={selectedBusiness?.id}>{context.businesses.map(business => <option value={business.id} key={business.id}>{business.name}</option>)}</select></label><button className="coreButton" type="submit">Choose</button></form> : null}</header>{accounts ? <CompactConnectionsWorkspace data={accounts} returnTo={returnTo} provider={first(query.provider) === "etsy" ? "etsy" : "printful"} runId={first(query.connectionRun)} message={first(query.accountMessage)} resultId={uuid.test(first(query.accountResult) ?? "") ? first(query.accountResult) : undefined}/> : <p>{context.businessesUnavailable ? "Business records are unavailable." : "Create a Business in Advanced before adding connections."}</p>}</section> : null}
    {view === "activity" ? <section className="consolePane"><header className="consolePaneHeader"><div><h1>Recorded activity</h1><p>Recent persisted events · no invented live activity</p></div></header><div className="consolePaneScroll"><ActivityFeed events={collection.events} unavailable={collection.errors.length > 0}/></div></section> : null}
    {view === "advanced" ? <section className="consolePane"><header className="consolePaneHeader"><div><h1>Advanced</h1><p>Qualification tools, detailed records and owner settings</p></div></header><div className="consolePaneScroll"><div className="consoleActionGrid">{consoleAdvancedNavigation.map(item => <Link key={item.href} href={selectedBusiness && ["/dashboard/products", "/dashboard/artifacts", "/dashboard/accounts"].includes(item.href) ? `${item.href}?business=${selectedBusiness.id}` : item.href}>{item.label}<small>Open the existing protected workspace</small></Link>)}</div><details className="consoleDetails" id="workspace-setup" open={!context.businesses.length && !context.businessesUnavailable}><summary>Create a Business workspace</summary><form action={createBusiness} className="coreForm"><label htmlFor="console-business-name">Business name</label><input id="console-business-name" name="name" minLength={1} maxLength={120} required/><button className="coreButton coreButton-primary" disabled={context.businessesUnavailable} type="submit">Create workspace</button></form></details></div></section> : null}
    {researchSheet ? <ConsoleResearchSheet returnTo={returnTo}><QuestKickoff ownerId={context.userId} businesses={commandBusinesses} businessesUnavailable={context.businessesUnavailable} available={catalog?.available === true} quote={quote}/></ConsoleResearchSheet> : null}
    </ConsoleMotionBoundary>
  </ConsoleShell>;
}
