import Link from "next/link";
import { loadAccountWorkspace } from "@/accounts/server";
import { AppShell, PageHeader, StatusPill } from "@/components/stage7/app-shell";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { PRINTFUL_DOCS } from "@/printful/contracts";
import { loadPrintfulProductWorkspace } from "@/printful/server";
import { ProductActionFeedback, ProductConfigurationWorkspace } from "./product-workspace";
import { buildSyntheticPrintfulPreview } from "./preview";
import { CatalogConfigurationPreview, PricingCalculator } from "./workspace";
import "./printful.css";

export const dynamic = "force-dynamic";
const interventionUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export default async function PrintfulPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const context = await requireOwnerUiContext();
  const fixture = buildSyntheticPrintfulPreview();
  const query = await searchParams ?? {};
  const business = context.businesses.find(b => b.id === query.business) ?? context.businesses[0];
  const accounts = business ? await loadAccountWorkspace(context, business.id) : null;
  const interventionId = typeof query.intervention === "string" && interventionUuid.test(query.intervention) ? query.intervention : undefined;
  const productWorkspace = business ? await loadPrintfulProductWorkspace(context, business.id, interventionId) : null;
  const connection = accounts?.accounts.find(a => a.provider === "printful");
  const connected = connection?.status === "connected";
  const accountHref = `/dashboard/accounts${business ? `?business=${business.id}` : ""}#business-accounts`;

  return <AppShell active="accounts" context={context} navigationBusinessId={business?.id}>
    <PageHeader eyebrow="Stage 15 · Printful foundation" title="Printful workspace"
      description="Inspect the production contract and model unit economics with explicitly synthetic examples. Live qualification remains open."
      actions={<Link className="coreButton" href={`/dashboard/accounts${business ? `?business=${business.id}` : ""}`}>Back to Accounts</Link>} />
    <div className="printfulWorkspace">
      <section className="printfulIntro" aria-labelledby="printful-foundation-title">
        <div><p className="coreEyebrow">Experimental · Fixture-only foundation</p><h2 id="printful-foundation-title">Plan with clear boundaries</h2><p>The foundation validates catalog identities, print constraints and deterministic pricing. Account setup is now available separately below. These examples do not configure a real product or prove a product result.</p></div>
        <StatusPill status="experimental" />
      </section>
      <div className="printfulStatusGrid" aria-label="Printful foundation status">
        <div><span>Account connection</span><strong>{accounts?.unavailable ? "Unable to check" : connected ? "Verified connection" : "Not connected"}</strong><small>{connected ? "Catalog read access only" : "Secure owner-authorized setup"}</small></div>
        <div><span>Catalog & configuration</span><strong>Synthetic preview</strong><small>No live product or asset selected</small></div>
        <div><span>Stage 15 qualification</span><strong>Still open</strong><small>Real configuration and receipts unverified</small></div>
      </div>
      <section className="printfulPanel" aria-labelledby="printful-connection-title">
        <div className="printfulSectionHeader"><div><p className="coreEyebrow">Secure account connection</p><h2 id="printful-connection-title">Connect only with explicit authority</h2></div><StatusPill status={accounts?.unavailable ? "unavailable" : connected ? "connected" : "not_connected"} /></div>
        <p className="printfulNote">Review and approve the intended Business connection in Accounts, then enter the store-specific token yourself in the secure owner form. The server independently checks the token scopes and exact store before saving its encrypted credential.</p>
        <p className="printfulNote">Choose the intended store first: one Printful store identity is saved per Business, and this app cannot switch it even after a local disconnect. For Etsy selling, use the ecommerce-linked store already linked to the intended Etsy shop. Manual/API stores serve custom integrations or isolated qualification, not an automatic Etsy fulfilment connection.</p>
        <div className="printfulConnectionFooter"><Link className="coreButton" href={accountHref}>Manage secure Printful connection</Link><p className="printfulNote" id="printful-connection-help">A connection alone would not authorize product changes or spending.</p></div>
        <div className="printfulGatePanel"><h3>Required before a real product can be configured</h3>
          <ol className="printfulGates">
            <li><strong>Current reviewed TEST</strong><span>Revalidate the latest evidence-backed, independently reviewed discovery decision for the same Business. A TEST recommendation is not execution permission.</span><Link href={`/dashboard/products${business ? `?business=${business.id}` : ""}`}>Review Products →</Link></li>
            <li><strong>Production-asset approval</strong><span>Revalidate the persisted Stage 14 production approval against the exact asset version, hash and current variant-specific print requirements.</span><Link href={`/dashboard/artifacts${business ? `?business=${business.id}` : ""}`}>Review Artifacts →</Link></li>
            <li><strong>Separate owner configuration authority</strong><span>Approve the exact store, product or mapping operation, current stock and cost quote. Artwork approval does not supply that authority.</span><small>Unavailable in this preview</small></li>
          </ol>
          <p className="printfulNote">These are required gates, not a report of your current Business approval state. This page does not load or grant production approvals.</p>
        </div>
      </section>
      <ProductActionFeedback message={query.productMessage} />
      {productWorkspace && <ProductConfigurationWorkspace data={productWorkspace} />}
      <CatalogConfigurationPreview fixture={fixture} />
      <PricingCalculator />
      <section className="printfulPanel" aria-labelledby="printful-proof-title">
        <div className="printfulSectionHeader"><div><p className="coreEyebrow">Evidence before completion</p><h2 id="printful-proof-title">What live qualification still needs</h2></div><StatusPill status="open" /></div>
        <ul className="printfulList"><li>Verify the intended account/store connection and retrieve current catalog, variant, print-rule and scoped cost data</li><li>Qualify the intended selling-store product and exact Etsy variant mapping; the current bounded native path does not implement this ecommerce-linked route</li><li>Persist same-Business external resource mappings and actual action receipts. A successful mock creates neither</li><li>Reconcile an uncertain write against its saved external identity before considering any retry</li></ul>
        <p className="printfulNote">No provider mutation, paid order, fulfilment submission, marketplace listing or publishing action is available here.</p>
        <div className="printfulReferenceLinks"><a href={PRINTFUL_DOCS.catalog} target="_blank" rel="noreferrer">Printful catalog v2-beta documentation ↗</a><a href={PRINTFUL_DOCS.products} target="_blank" rel="noreferrer">Native product operations ↗</a><a href={PRINTFUL_DOCS.ecommerceSync} target="_blank" rel="noreferrer">Ecommerce mapping operations ↗</a></div>
      </section>
    </div>
  </AppShell>;
}
