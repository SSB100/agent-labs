import { randomUUID } from "node:crypto";
import Link from "next/link";

import { AppShell, PageHeader } from "@/components/stage7/app-shell";
import { CoreIcon } from "@/components/stage7/icons";
import { ProductsWorkspace, ProductSubmitButton } from "@/components/stage13/products-workspace";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { loadProductWorkspace } from "@/products/data";
import { productHistorySummary } from "@/products/history";
import { DiscoveryGoalForm, DiscoveryGoalResults, type DiscoveryQuotePreview } from "@/components/stage13/discovery-goal-workspace";
import { loadDiscoveryGoalData } from "@/products/discovery-v2-data";
import { buildDiscoveryIntentFromGoal, discoveryGoalBudgetScope, DISCOVERY_GOAL_DEFAULT } from "@/products/discovery-v2-goal";
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
  const [data, query] = await Promise.all([loadProductWorkspace(context), searchParams]);
  const discovery = await loadDiscoveryGoalData(context,data.experiments);
  let quotePreview:DiscoveryQuotePreview=null;
  if(discovery.available&&context.businesses.length){
    try{
      const [director,reviewer]=await Promise.all([fetchDiscoveryV2ModelQuote(discoveryV2Model("plan:1")),fetchDiscoveryV2ModelQuote(discoveryV2Model("review:1"))]);
      const estimate=(maximumCollections:1|2)=>quoteDiscoveryV2(discoveryGoalBudgetScope(buildDiscoveryIntentFromGoal({id:randomUUID(),businessId:context.businesses[0].id,goal:DISCOVERY_GOAL_DEFAULT,maximumMicrousd:1000000,maximumCollections})),{director,reviewer});
      const one=estimate(1),two=estimate(2);quotePreview={one:one.maximumEstimateMicrousd,two:two.maximumEstimateMicrousd,verifiedAt:one.verifiedAt};
    }catch{/* Unavailable or unsupported prices keep the start control disabled. */}
  }
  const message = first(query.message);
  const error = first(query.error);
  const { needsEvidence, unsupportedAssessments, unrecognizedOutcomes } = productHistorySummary(data.decisions);
  const activeResearch = data.experiments.filter((experiment) => ["reserved", "researching"].includes(experiment.status)).length;

  return <AppShell active="products" context={context}>
    <PageHeader eyebrow="Commerce · Discovery" title="Products" description="Give a goal. Get a researched market recommendation, alternatives and clear next steps." actions={<a className="coreButton coreButton-primary" href="#discovery-goal"><span aria-hidden="true">+</span>Research a goal</a>} />
    {message ? <p className="coreNotice coreNotice-success" role="status">{message}</p> : null}
    {error ? <p className="coreNotice coreNotice-danger" role="alert">{error}</p> : null}

    <section className="productIntro" aria-labelledby="product-scope-title">
      <div className="productIntroMark" aria-hidden="true"><CoreIcon name="products" /></div>
      <div><p className="coreEyebrow">Evidence before commitment</p><h2 id="product-scope-title">Original print-on-demand T-shirts</h2><p>Discovery keeps candidates, source-backed decisions, and experiment history together. A TEST decision proposes a future observation plan; it does not qualify a product or authorize assets, listings, advertising, or spending.</p></div>
      <Link href="/dashboard/packs" className="productTextLink">Research capabilities <span aria-hidden="true">↗</span></Link>
    </section>

    <dl className="productSummary" aria-label="Product discovery summary">
      <div><dt>Candidate opportunities</dt><dd>{data.candidates.length}</dd><small>Original concepts to assess</small></div>
      <div><dt>Research in progress</dt><dd>{activeResearch}</dd><small>Reserved or researching</small></div>
      <div><dt>Needs more evidence</dt><dd>{needsEvidence}</dd><small>Latest decision per candidate</small></div>
      <div><dt>Preserved experiments</dt><dd>{data.experiments.length}</dd><small>History prevents repeated loops</small></div>
    </dl>
    {unsupportedAssessments ? <p className="productSubtle">{unsupportedAssessments} latest decision(s) use a newer or unrecognized assessment format. Their preserved contents remain visible in the workspace; they are not converted into legacy scores.{unrecognizedOutcomes ? ` ${unrecognizedOutcomes} outcome(s) cannot be interpreted and are not included in the needs-evidence count.` : ""}</p> : null}

    <DiscoveryGoalForm businesses={context.businesses} available={discovery.available} quote={quotePreview}/>
    <DiscoveryGoalResults data={discovery}/>
    <details className="productCreate" id="new-candidate">
      <summary><span><span aria-hidden="true">+</span><strong>Legacy manual candidate entry</strong></span><span>Optional advanced record keeping</span></summary>
      {context.businesses.length ? <form action={createProductCandidate} className="productForm productCreateForm">
        <div className="productFormGrid">
          <label htmlFor="product-business">Business<select id="product-business" name="businessId" required defaultValue={context.businesses[0]?.id}>{context.businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}</select></label>
          <label htmlFor="product-concept">Original T-shirt concept<input id="product-concept" name="concept" required minLength={3} maxLength={160} placeholder="An original trail journal graphic for weekend hikers" /></label>
        </div>
        <label htmlFor="product-audience">Specific audience<input id="product-audience" name="audience" required minLength={3} maxLength={160} placeholder="Weekend hikers who enjoy documenting local trails" /></label>
        <label htmlFor="product-hypothesis">Testable hypothesis<textarea id="product-hypothesis" name="hypothesis" required minLength={10} maxLength={600} rows={3} placeholder="We expect this audience to show qualified interest in an original trail journal T-shirt because…" /></label>
        <div className="productFormGrid"><label htmlFor="product-domains">Research source domains<input id="product-domains" name="sourceDomains" required maxLength={1000} placeholder="etsy.com, printful.com" aria-describedby="product-domains-help" /><small id="product-domains-help">Comma-separated public domains; keep the research scope bounded</small></label>
          <label htmlFor="product-rights">Design rights status<select id="product-rights" name="rightsStatus" defaultValue="unclear" required><option value="unclear">Unclear / needs screening</option><option value="confirmed">I confirm the design rights</option></select><small>Confirmation is an owner declaration, not legal or IP clearance</small></label></div>
        <label className="productCheckbox" htmlFor="product-original"><input id="product-original" name="originalDesign" type="checkbox" value="on" /><span>This is an original design concept for a print-on-demand T-shirt</span></label>
        <div className="productCreateFooter"><ProductSubmitButton pendingText="Saving candidate…">Save candidate</ProductSubmitButton><p>Saving makes no provider call. Research is a separate, bounded action. Similar candidates reuse the existing record.</p></div>
      </form> : <div className="productInlineEmpty"><p>Create a Business before adding a product candidate.</p><Link className="productTextLink" href="/dashboard">Go to dashboard</Link></div>}
    </details>

    <section className="productWorkspaceSection" aria-labelledby="product-workspace-title"><div className="sectionTitleRow"><div><p className="coreEyebrow">Learning, preserved</p><h2 id="product-workspace-title">Discovery workspace</h2></div><span className="productTag">Research only</span></div><ProductsWorkspace data={data} /><p className="productSubtle">Showing the most recent 100 candidates, 100 experiments, and 300 decisions. Earlier records remain in the registry; a workflow page shows its own linked experiment.</p></section>
  </AppShell>;
}
