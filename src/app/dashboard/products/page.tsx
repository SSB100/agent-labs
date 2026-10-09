import { HistoryPager } from "@/components/console/history-pager";
import { retainedFeedbackMessage } from "@/lib/core-ui/console-retained-feedback";
import { ConsoleRetainedWorkspace } from "@/components/console/console-retained-workspace";
import { OwnerResearchEntry } from "@/components/quests/owner-research-entry";
import "@/components/guided/work-context.css";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppShell, PageHeader } from "@/components/stage7/app-shell";
import { CoreIcon } from "@/components/stage7/icons";
import { ProductsWorkspace, ProductSubmitButton } from "@/components/stage13/products-workspace";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { loadProductWorkspace } from "@/products/data";
import { productHistorySummary } from "@/products/history";
import { DiscoveryGoalForm, DiscoveryGoalResults, type DiscoveryQuotePreview } from "@/components/stage13/discovery-goal-workspace";
import { loadDiscoveryGoalData } from "@/products/discovery-v2-data";
import { buildDiscoveryIntentFromGoal, buildDiscoveryAnalysisIntent, discoveryGoalBudgetScope, DISCOVERY_GOAL_DEFAULT } from "@/products/discovery-v2-goal";
import { quoteDiscoveryV2, fetchDiscoveryV2ModelQuote, discoveryV2Model } from "@/products/discovery-v2-budget";
import { createProductCandidate } from "./actions";
import "./products.css";

export const dynamic = "force-dynamic";

type ProductsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ProductsPage({ searchParams }: ProductsPageProps) {
  const context = await requireOwnerUiContext();
  const query = await searchParams;
  if (process.env.AGENTLABS_GUIDED_UI !== "legacy" && query.view === "results") {
    const { consoleResearchAlias } = await import("@/lib/core-ui/console-research-alias");
    const { consoleResearchHref } = await import("@/lib/core-ui/console-research-query");
    let researchQuery;
    try { researchQuery = consoleResearchAlias("products", query); } catch { notFound(); }
    if (researchQuery) {
      const businessId = researchQuery.business;
      if (typeof businessId === "string" && !context.businessesUnavailable && !context.businesses.some(business => business.id === businessId)) notFound();
      // Former aggregate #discovery-goal-results is not an exact record fragment.
      redirect(consoleResearchHref(researchQuery, {}));
    }
  }
  const requestedBusiness = first(query.business);
  const selectedBusiness = context.businesses.find(business => business.id === requestedBusiness);
  if (requestedBusiness && !selectedBusiness && !context.businessesUnavailable) notFound();
  const businesses = selectedBusiness ? [selectedBusiness] : context.businesses;
  const scopedContext = { ...context, businesses, scopeBusinessId:selectedBusiness?.id };
  const data = await loadProductWorkspace(scopedContext);
  const discovery = await loadDiscoveryGoalData(scopedContext,data.experiments);
  let quotePreview:DiscoveryQuotePreview=null;
  if(discovery.available&&businesses.length){
    try{
      const [director,reviewer]=await Promise.all([fetchDiscoveryV2ModelQuote(discoveryV2Model("plan:1")),fetchDiscoveryV2ModelQuote(discoveryV2Model("review:1"))]);
      const estimate=(maximumCollections:1|2)=>quoteDiscoveryV2(discoveryGoalBudgetScope(buildDiscoveryIntentFromGoal({id:randomUUID(),businessId:businesses[0].id,goal:DISCOVERY_GOAL_DEFAULT,maximumMicrousd:1000000,maximumCollections})),{director,reviewer});
      const one=estimate(1),two=estimate(2);
      const prior=buildDiscoveryIntentFromGoal({id:randomUUID(),businessId:businesses[0].id,goal:DISCOVERY_GOAL_DEFAULT,maximumMicrousd:1000000,maximumCollections:1});
      const analysis=quoteDiscoveryV2(discoveryGoalBudgetScope(buildDiscoveryAnalysisIntent({prior,id:randomUUID(),maximumMicrousd:1000000})),{director,reviewer});
      quotePreview={one:one.maximumEstimateMicrousd,two:two.maximumEstimateMicrousd,analysis:analysis.maximumEstimateMicrousd,verifiedAt:one.verifiedAt};
    }catch{/* Unavailable or unsupported prices keep the start control disabled. */}
  }
  const notices:Record<string,string>={"candidate-saved":"Candidate saved. Research remains unvalidated until source evidence is collected.","candidate-reused":"This candidate already exists. Its original hypothesis and evidence history were preserved.","candidate-invalid":"Check the original concept, audience, hypothesis, source domains and required design declaration. No candidate was saved.","candidate-business-unavailable":"The selected Business could not be verified. No candidate was saved.","candidate-outcome-unconfirmed":"The candidate save outcome could not be confirmed. Your draft remains in this tab; inspect saved records before submitting again."};
  const message = query.message ? notices[first(query.message) ?? ""] ?? retainedFeedbackMessage("products","message",first(query.message)) : undefined;
  const error = query.error ? notices[first(query.error) ?? ""] ?? retainedFeedbackMessage("products","error",first(query.error)) : undefined;
  const { needsEvidence, unsupportedAssessments, unrecognizedOutcomes } = productHistorySummary(data.decisions);
  const recordsUnavailable = context.businessesUnavailable || data.errors.length > 0 || discovery.errors.length > 0;
  const activeResearch = data.experiments.filter((experiment) => ["reserved", "researching"].includes(experiment.status)).length;

  return <AppShell toolDestination="products" active="products" context={context} navigationBusinessId={selectedBusiness?.id}><ConsoleRetainedWorkspace ownerId={context.userId}  notice={<p className="coreNotice">Candidate, experiment and decision histories are server-paged. Latest decisions and superseding evidence are independently resolved for each displayed candidate.</p>} header={<><PageHeader eyebrow="Work · Supported research" title="Candidate tools" description="Define a bounded goal and review the scope before any paid work." actions={<Link className="coreButton coreButton-secondary" href={`/dashboard?view=work${selectedBusiness ? `&business=${selectedBusiness.id}` : ""}`}>Back to work</Link>} />
{selectedBusiness ? <p className="coreNotice">Business: {selectedBusiness.name} · <Link href="/dashboard/products">View all businesses</Link></p> : null}
{message ? <p className="coreNotice coreNotice-success" role="status">{message}</p> : null}
{error ? <p className="coreNotice coreNotice-danger" role="alert">{error}</p> : null}</>} panels={[{ id: "research", label: "Research", content: <>{process.env.AGENTLABS_GUIDED_UI === "legacy" ? <DiscoveryGoalForm businesses={businesses} available={discovery.available} quote={quotePreview}/> : context.businessesUnavailable ? <p className="coreNotice coreNotice-danger" role="alert">Business records could not be loaded. Your draft remains in this tab; reload before choosing a workspace or starting research.</p> : <OwnerResearchEntry businesses={businesses} selectedBusinessId={selectedBusiness?.id}/>}</> },
{ id: "recovery", label: "Recovery", content: <><details className="guidedDisclosure" open><summary>Saved research and recovery<span>{recordsUnavailable ? "Some records unavailable" : `${discovery.records.length} loaded research rounds`} · evidence and receipts remain unchanged</span></summary>{context.businessesUnavailable ? <p role="alert">Research records could not be checked without the Business context.</p> : <DiscoveryGoalResults data={discovery} quote={quotePreview}/>}</details></> },
{ id: "candidates", label: "Candidates", content: <><details className="guidedDisclosure" open><summary>Saved product candidates<span>Inspect existing concepts, decisions and experiments</span></summary><section className="productWorkspaceSection" aria-labelledby="product-workspace-title"><div className="sectionTitleRow"><div><p className="coreEyebrow">Learning, preserved</p><h2 id="product-workspace-title">Discovery workspace</h2></div><span className="productTag">Research only</span></div><HistoryPager page={data.candidatePage} name="candidate" label="Candidates"/><HistoryPager page={data.experimentPage} name="experiment" label="Experiments"/><HistoryPager page={data.decisionPage} name="decision" label="Candidate decisions"/><ProductsWorkspace data={data} /><p className="productSubtle">Candidate and experiment history use independent server pages. Latest candidate decisions and their exact related evidence are loaded independently of those pages.</p></section></details></> },
{ id: "new", label: "New candidate", content: <><details className="productCreate" id="new-candidate" open>
      <summary><span><span aria-hidden="true">+</span><strong>Legacy manual candidate entry</strong></span><span>Optional advanced record keeping</span></summary>
      {businesses.length ? <form action={createProductCandidate} className="productForm productCreateForm">
        <div className="productFormGrid">
          <label htmlFor="product-business">Business<select id="product-business" name="businessId" required defaultValue={businesses[0]?.id}>{businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}</select></label>
          <label htmlFor="product-concept">Original T-shirt concept<input id="product-concept" name="concept" required minLength={3} maxLength={160} placeholder="An original trail journal graphic for weekend hikers" /></label>
        </div>
        <label htmlFor="product-audience">Specific audience<input id="product-audience" name="audience" required minLength={3} maxLength={160} placeholder="Weekend hikers who enjoy documenting local trails" /></label>
        <label htmlFor="product-hypothesis">Testable hypothesis<textarea id="product-hypothesis" name="hypothesis" required minLength={10} maxLength={600} rows={3} placeholder="We expect this audience to show qualified interest in an original trail journal T-shirt because…" /></label>
        <div className="productFormGrid"><label htmlFor="product-domains">Research source domains<input id="product-domains" name="sourceDomains" required maxLength={1000} placeholder="etsy.com, printful.com" aria-describedby="product-domains-help" /><small id="product-domains-help">Comma-separated public domains; keep the research scope bounded</small></label>
          <label htmlFor="product-rights">Design rights status<select id="product-rights" name="rightsStatus" defaultValue="unclear" required><option value="unclear">Unclear / needs screening</option><option value="confirmed">I confirm the design rights</option></select><small>Confirmation is an owner declaration, not legal or IP clearance</small></label></div>
        <label className="productCheckbox" htmlFor="product-original"><input id="product-original" name="originalDesign" type="checkbox" value="on" /><span>This is an original design concept for a print-on-demand T-shirt</span></label>
        <div className="productCreateFooter"><ProductSubmitButton pendingText="Saving candidate…">Save candidate</ProductSubmitButton><p>Saving makes no provider call. Research is a separate, bounded action. Similar candidates reuse the existing record.</p></div>
      </form> : <div className="productInlineEmpty"><p>Create a Business before adding a product candidate.</p><Link className="productTextLink" href="/dashboard">Go to dashboard</Link></div>}
    </details></> },
{ id: "capabilities", label: "Capabilities", content: <><details className="guidedDisclosure" open><summary>Research context and capabilities<span>Current boundaries, counts and qualified capabilities</span></summary>    <section className="productIntro" aria-labelledby="product-scope-title">
      <div className="productIntroMark" aria-hidden="true"><CoreIcon name="products" /></div>
      <div><p className="coreEyebrow">Evidence before commitment</p><h2 id="product-scope-title">Original print-on-demand T-shirts</h2><p>Discovery keeps candidates, source-backed decisions, and experiment history together. A TEST decision proposes a future observation plan; it does not qualify a product or authorize assets, listings, advertising, or spending.</p></div>
      <Link href="/dashboard/packs" className="productTextLink">Research capabilities <span aria-hidden="true">↗</span></Link>
    </section>

    <dl className="productSummary" aria-label="Product discovery summary">
      <div><dt>Candidate opportunities</dt><dd>{recordsUnavailable ? "Unknown" : data.candidates.length}</dd><small>Loaded original concepts</small></div>
      <div><dt>Research in progress</dt><dd>{recordsUnavailable ? "Unknown" : activeResearch}</dd><small>In the loaded window</small></div>
      <div><dt>Needs more evidence</dt><dd>{recordsUnavailable ? "Unknown" : needsEvidence}</dd><small>Latest loaded decision per candidate</small></div>
      <div><dt>Preserved experiments</dt><dd>{recordsUnavailable ? "Unknown" : data.experiments.length}</dd><small>Loaded experiment window</small></div>
    </dl>
    {unsupportedAssessments ? <p className="productSubtle">{unsupportedAssessments} latest decision(s) use a newer or unrecognized assessment format. Their preserved contents remain visible in the workspace; they are not converted into legacy scores.{unrecognizedOutcomes ? ` ${unrecognizedOutcomes} outcome(s) cannot be interpreted and are not included in the needs-evidence count.` : ""}</p> : null}

</details></> }]} /></AppShell>;
}
