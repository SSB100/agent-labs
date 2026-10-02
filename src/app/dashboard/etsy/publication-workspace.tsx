import { publishReviewedEtsyDraft, reconcileEtsyPublication, stopEtsyPublication } from "./publication-actions";
import type { PublicationWorkspaceData } from "@/etsy-publication/server";
import { publicationPolicy } from "@/etsy-publication/policy";

function money(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(amountMinor / 100);
}
export function PublicationWorkspace({ data }: { data: PublicationWorkspaceData }) {
  return <section className="etsyPanel" aria-labelledby="publication-title">
    <p className="coreEyebrow">Assisted publication · Initial qualification</p>
    <h2 id="publication-title">Publish a reviewed Etsy draft</h2>
    <p>Publication makes the exact existing listing public in your shop and can create Etsy charges. It needs a current independent listing review, verified draft details and a separate approval of the applicable fees.</p>
    {data.unavailable && <p role="alert">Publication records could not be checked. Existing attempts may still exist. New publication is paused until their history can be verified.</p>}
    {!data.configured && <p className="etsyMuted">Secure Etsy account setup is required before publication readiness can be checked.</p>}
    <div className="etsyEmpty"><h3>Supplier readiness is not established</h3>
      <p><strong>Supplier variant link · Unverified.</strong> Creating or publishing an Etsy listing does not establish its variant-to-Printful product link. Agent Labs does not verify that supplier link.</p>
      <p><strong>Supplier manual confirmation · Unverified.</strong> Agent Labs does not verify whether Printful requires manual order confirmation. Do not assume incoming orders will wait for approval.</p>
      <p>These are missing application checks, not a read of your provider settings. No automatic order sync or fulfilment path is implemented in Agent Labs; that remains later Stage 22 work. A public listing alone is not proof of fulfilment readiness.</p>
    </div>
    <div className="etsyEmpty"><h3>Commercial evidence incomplete</h3><p>{data.feeReadiness.message}</p><p>The documented base listing charge is US$0.20. That is not a verified total for this shop: tax and conversion can change the debit, and listing currency does not establish payment-account currency.</p><p>This initial qualification path requires a single-unit draft with manual expiration renewal, manual shipping and a verified return policy. It never changes stock, shipping or renewal settings to pass a check.</p><a href={publicationPolicy.sourceUrls.fees} target="_blank" rel="noreferrer">Read Etsy’s fee explanation</a></div>
    <details><summary>Publication and fee safeguards</summary><p>{publicationPolicy.renewal}</p><p>{publicationPolicy.legalVersionStatus}</p><p>{publicationPolicy.nativeReviewStatus}</p><p>After a publication attempt is sent, later checks only inspect that same listing. A lost response never causes another activation request. Stop cannot undo a request already sent to Etsy or a fee already incurred.</p></details>
    {!data.drafts.length && !data.unavailable ? <p className="etsyMuted">No verified Etsy draft is available for publication. A synthetic package or reviewed artwork alone cannot satisfy the real product, independent listing review and draft-readback prerequisites.</p> : data.drafts.map(draft => <article className="etsyProduct" key={draft.id}>
      <h3>{draft.title}</h3><p>{money(draft.priceMinor,draft.currency)} · {draft.quantity} unit{draft.quantity === 1 ? "" : "s"} · Existing draft verified</p>
      {draft.quantity !== 1 && <p className="etsyMuted">This draft is outside the single-unit initial qualification limit. Its quantity has not been changed.</p>}
      <p>Exact current source and Etsy readback checks run again before any publication. Verification does not authorize a new listing or substitute product.</p>
      <form action={publishReviewedEtsyDraft}>
        <input type="hidden" name="businessId" value={data.businessId} /><input type="hidden" name="draftRunId" value={draft.id} /><input type="hidden" name="packageHash" value={draft.packageHash} />
        <label className="etsyConsent"><input type="checkbox" name="publicationConsent" required disabled={!data.feeReadiness.available || data.unavailable || !data.configured || draft.quantity !== 1} />Publish this exact reviewed draft in this Etsy shop.</label>
        <label className="etsyConsent"><input type="checkbox" name="publicDataConsent" required disabled={!data.feeReadiness.available || data.unavailable || !data.configured || draft.quantity !== 1} />Make this listing’s reviewed product details and images public on Etsy.</label>
        <label className="etsyConsent"><input type="checkbox" name="feeConsent" required disabled={!data.feeReadiness.available || data.unavailable || !data.configured || draft.quantity !== 1} />Approve the separately verified total fee and payment-account charge shown for this publication.</label>
        <label className="etsyConsent"><input type="checkbox" name="renewalConsent" required disabled={!data.feeReadiness.available || data.unavailable || !data.configured || draft.quantity !== 1} />Keep the existing single-unit quantity and manual expiration renewal. No new recurring fee authority is granted.</label>
        <button className="coreButton coreButtonPrimary" disabled={!data.feeReadiness.available || data.unavailable || !data.configured || draft.quantity !== 1}>Publish reviewed draft</button>
      </form>
    </article>)}
    <h3 id="publication-history">Publication history</h3>
    {!data.runs.length && !data.unavailable ? <p className="etsyMuted">No publication attempts are recorded for this Business.</p> : data.runs.map(run => <article className="etsyProduct" key={run.id}>
      <h4>{run.title}</h4><p>{run.status === "verified" ? "Active listing independently verified" : run.providerState === "active" ? "Etsy listing observed active; full verification still needed" : run.stopRequested ? "Further publication work stopped; provider outcome remains recorded" : run.activationSent ? "Publication outcome needs verification" : "Publication prerequisites need review"}</p>
      <p>{run.activationSent ? "The activation request may have incurred a charge. No second activation will be sent, and the actual fee is not inferred from the listing response." : "No activation request is recorded for this attempt."}</p>
      {run.listingId && <a href={`https://www.etsy.com/your/shops/me/listing-editor/edit/${run.listingId}`} target="_blank" rel="noreferrer">Inspect this listing on Etsy</a>}
      {run.status !== "verified" && <div className="etsyActions">
        {run.activationSent && <form action={reconcileEtsyPublication}><input type="hidden" name="businessId" value={data.businessId} /><input type="hidden" name="runId" value={run.id} /><button className="coreButton" disabled={data.unavailable || !data.configured}>Check existing listing</button><small>Read-only verification; never sends another Publish request.</small></form>}
        {!run.stopRequested && <form action={stopEtsyPublication}><input type="hidden" name="businessId" value={data.businessId} /><input type="hidden" name="runId" value={run.id} /><button className="coreButton" disabled={data.unavailable}>Stop further work</button></form>}
      </div>}
    </article>)}
  </section>;
}
