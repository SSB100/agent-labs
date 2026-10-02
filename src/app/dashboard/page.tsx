import Link from "next/link";
import { notFound } from "next/navigation";
import { ConsoleShell, consoleAdvancedNavigation, type ConsoleView } from "@/components/console/console-shell";
import { ConsoleOverview } from "@/components/console/console-overview";
import { ConsoleCommandBar, ConsoleResearchSheet } from "@/components/console/console-command";
import { ConsoleWorkPane } from "@/components/console/console-work-pane";
import { QuestKickoff } from "@/components/guided/quest-kickoff";
import { CreativeLibrary } from "@/components/guided/creative-library";
import { ActivityFeed, NeedsYouCard } from "@/components/stage7/workflow-visuals";
import { loadWorkflowCollection, loadWorkflowDetail, requireOwnerUiContext } from "@/lib/core-ui/data";
import { loadRunCostData } from "@/lib/core-ui/run-outcome-data";
import { consoleConnectionSummary, consoleCostSummary, loadConsoleObservationTime, loadConsoleResearchQuote } from "@/lib/core-ui/console-data";
import { loadAccountSetupInterventions, loadAccountWorkspace } from "@/accounts/server";
import { loadPublicationInterventions } from "@/etsy-publication/server";
import { loadPrintfulProductInterventions } from "@/printful/server";
import { loadCreativeWorkspace } from "@/creative/data";
import { loadProductWorkspace } from "@/products/data";
import { loadDiscoveryGoalData } from "@/products/discovery-v2-data";
import { DiscoveryGoalResults } from "@/components/stage13/discovery-goal-workspace";
import { BusinessAccountWorkspace } from "./accounts/account-workspace";
import { createBusiness } from "./actions";
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
  const observedAt = await loadConsoleObservationTime();
  const proposedView = first(query.view) as ConsoleView | undefined;
  const view = proposedView && views.has(proposedView) ? proposedView : "overview";
  const runId = first(query.run), businessId = first(query.business), researchSheet = first(query.sheet) === "research";
  if (runId && !uuid.test(runId)) notFound();
  if (businessId && !context.businessesUnavailable && !context.businesses.some(business => business.id === businessId)) notFound();
  const [collection, detail] = await Promise.all([loadWorkflowCollection(context, { limit: 80 }), view === "work" && runId ? loadWorkflowDetail(context, runId) : null]);
  const selectedBusiness = context.businesses.find(business => business.id === (businessId ?? detail?.run.business_id)) ?? context.businesses[0];
  const scopedContext = selectedBusiness ? { ...context, businesses: [selectedBusiness] } : context;
  const current = new URLSearchParams({ view });
  if (businessId) current.set("business", businessId);
  if (view === "work" && runId) current.set("run", runId);
  if (view === "library" && first(query.type) === "research") current.set("type", "research");
  const returnTo = `/dashboard?${current.toString()}`;
  const focusRun = detail?.run ?? collection.runs.find(run => collection.interventions.some(request => request.workflow_run_id === run.id && request.status === "open")) ?? collection.runs[0];
  const focusDefinition = detail?.definition ?? collection.definitions.find(definition => definition.id === focusRun?.workflow_definition_id);
  const [accounts, costs, products, creative, catalog, accountRequests, publicationRequests, printfulRequests] = await Promise.all([
    (view === "overview" || view === "connections") && selectedBusiness ? loadAccountWorkspace(context, selectedBusiness.id) : null,
    (view === "overview" || (view === "work" && detail)) && focusRun ? loadRunCostData(context, focusRun, focusDefinition) : null,
    (view === "work" && detail) || (view === "library" && first(query.type) === "research") ? loadProductWorkspace(scopedContext, view === "work" ? runId : undefined) : null,
    view === "library" && first(query.type) !== "research" ? loadCreativeWorkspace(scopedContext) : null,
    researchSheet ? loadDiscoveryGoalData(scopedContext, []) : null,
    view === "decisions" ? loadAccountSetupInterventions(context) : null,
    view === "decisions" ? loadPublicationInterventions(context) : null,
    view === "decisions" ? loadPrintfulProductInterventions(context) : null,
  ]);
  const discovery = view === "library" && products ? await loadDiscoveryGoalData(scopedContext, products.experiments) : null;
  const quote = researchSheet || discovery ? await loadConsoleResearchQuote(scopedContext, catalog?.available === true || discovery?.available === true) : null;
  const interventions = [...new Map([...collection.interventions, ...(publicationRequests?.records ?? []), ...(printfulRequests?.records ?? [])].map(item => [item.id, item])).values()].filter(item => item.status === "open");
  const decisionUnavailable = collection.errors.length > 0 || publicationRequests?.unavailable || printfulRequests?.unavailable || accountRequests?.unavailable;
  const group = (type: string) => type === "creative_review" ? "Needs a fix" : type.includes("reconcile") ? "Verify an existing result" : "Review request";
  return <ConsoleShell active={view} context={context} workflowRunId={detail?.run.id} commandBar={<ConsoleCommandBar ownerId={context.userId} businessId={selectedBusiness?.id} returnTo={returnTo} unavailable={context.businessesUnavailable}/> }>
    {view === "overview" ? <ConsoleOverview context={context} collection={collection} costs={consoleCostSummary(costs, "Selected recent run · reported receipts", focusRun?.id)} connections={consoleConnectionSummary(accounts, selectedBusiness?.name ?? "Business", observedAt)}/> : null}
    {view === "work" ? <ConsoleWorkPane context={context} collection={collection} detail={detail} products={products ?? undefined} costs={costs}/> : null}
    {view === "decisions" ? <section className="consolePane"><header className="consolePaneHeader"><div><h1>Decisions</h1><p>Exact requests, validation issues and uncertain results</p></div><span>{decisionUnavailable ? "Some records unavailable" : `${interventions.length + (accountRequests?.records.length ?? 0)} open`}</span></header><div className="consolePaneScroll">
      {decisionUnavailable ? <p className="coreNotice" role="alert">Request completeness could not be checked. Known requests remain below.</p> : null}
      {accountRequests?.records.length ? <section className="consoleDecisionGroup"><h2>Connections and access</h2>{accountRequests.records.map(request => <Link className="consoleWorkRow" key={request.runId} href={`/dashboard?view=connections&business=${request.businessId}`}><strong>{request.provider} · Review saved setup request</strong><span>{request.status}</span></Link>)}</section> : null}
      {["Needs a fix", "Verify an existing result", "Review request"].map(title => { const records = interventions.filter(item => group(item.intervention_type) === title); return records.length ? <section className="consoleDecisionGroup" key={title}><h2>{title}</h2><div className="needsYouStack">{records.map(intervention => { const run = collection.runs.find(item => item.id === intervention.workflow_run_id); const definition = collection.definitions.find(item => item.id === run?.workflow_definition_id); return <NeedsYouCard key={intervention.id} intervention={intervention} run={run} definition={definition} businessName={context.businesses.find(business => business.id === intervention.business_id)?.name} workflowName={definition?.name} returnTo="/dashboard/needs-you"/>; })}</div></section> : null; })}
      {!decisionUnavailable && !interventions.length && !accountRequests?.records.length ? <p>No open request is recorded.</p> : null}
    </div></section> : null}
    {view === "library" ? <section className="consolePane"><header className="consolePaneHeader"><div><h1>Library</h1><p>{selectedBusiness?.name ?? "Business context unavailable"} · saved outputs and evidence</p></div><div><Link className="consoleMiniAction" href={`/dashboard?view=library${selectedBusiness ? `&business=${selectedBusiness.id}` : ""}`}>Designs</Link>{" "}<Link className="consoleMiniAction" href={`/dashboard?view=library&type=research${selectedBusiness ? `&business=${selectedBusiness.id}` : ""}`}>Research</Link></div></header><div className="consolePaneScroll">{creative ? <CreativeLibrary data={creative} businesses={scopedContext.businesses} now={observedAt}/> : discovery ? <DiscoveryGoalResults data={discovery} quote={quote}/> : <p>Saved output records could not be checked.</p>}<p><Link className="consoleMiniAction" href={`/dashboard/artifacts${selectedBusiness ? `?business=${selectedBusiness.id}` : ""}`}>Exact creative approvals and receipts</Link></p></div></section> : null}
    {view === "connections" ? <section className="consolePane"><header className="consolePaneHeader"><div><h1>Connections</h1><p>Saved account access is separate from permission to execute</p></div><Link href="/dashboard/accounts">Platform diagnostics</Link></header><div className="consolePaneScroll">{context.businesses.length > 1 ? <form method="get"><input type="hidden" name="view" value="connections"/><label>Business <select name="business" defaultValue={selectedBusiness?.id}>{context.businesses.map(business => <option value={business.id} key={business.id}>{business.name}</option>)}</select></label><button className="coreButton" type="submit">Choose</button></form> : null}{accounts ? <BusinessAccountWorkspace data={accounts}/> : <p>{context.businessesUnavailable ? "Business records are unavailable." : "Create a Business in Advanced before adding connections."}</p>}</div></section> : null}
    {view === "activity" ? <section className="consolePane"><header className="consolePaneHeader"><div><h1>Recorded activity</h1><p>Recent persisted events · no invented live activity</p></div></header><div className="consolePaneScroll"><ActivityFeed events={collection.events} unavailable={collection.errors.length > 0}/></div></section> : null}
    {view === "advanced" ? <section className="consolePane"><header className="consolePaneHeader"><div><h1>Advanced</h1><p>Qualification tools, detailed records and owner settings</p></div></header><div className="consolePaneScroll"><div className="consoleActionGrid">{consoleAdvancedNavigation.map(item => <Link key={item.href} href={item.href}>{item.label}<small>Open the existing protected workspace</small></Link>)}</div><details className="consoleDetails" id="workspace-setup" open={!context.businesses.length && !context.businessesUnavailable}><summary>Create a Business workspace</summary><form action={createBusiness} className="coreForm"><label htmlFor="console-business-name">Business name</label><input id="console-business-name" name="name" minLength={1} maxLength={120} required/><button className="coreButton coreButton-primary" disabled={context.businessesUnavailable} type="submit">Create workspace</button></form></details></div></section> : null}
    {researchSheet ? <ConsoleResearchSheet returnTo={returnTo}><QuestKickoff ownerId={context.userId} businesses={scopedContext.businesses} businessesUnavailable={context.businessesUnavailable} available={catalog?.available === true} quote={quote}/></ConsoleResearchSheet> : null}
  </ConsoleShell>;
}
