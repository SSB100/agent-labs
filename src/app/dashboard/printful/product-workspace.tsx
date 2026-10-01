import type { loadPrintfulProductWorkspace } from "@/printful/server";
import { configureReviewedPrintfulProduct, reconcilePrintfulProduct, stopPrintfulProduct } from "./product-actions";

type ProductWorkspaceData = Awaited<ReturnType<typeof loadPrintfulProductWorkspace>>;
type ProductRun = ProductWorkspaceData["runs"][number];
const feedbackMessages: Record<string, string> = {
  "product-consent-required": "Review the exact product configuration and give separate configuration consent before starting.",
  "product-blocked": "Product configuration is blocked. Review the current prerequisites and existing history before trying again.",
  "product-needs-review": "The product attempt needs owner review. Any recorded receipt proves only observed product and file associations; it does not establish physical placement or a listing-ready product.",
  "product-stop-requested": "The stop request was recorded. Stop cannot undo a POST already sent to Printful; its outcome may still need read-only reconciliation.",
};
const reasonMessages: Record<string, string> = {
  product_write_authority_unavailable: "Current secure product-write authority is unavailable. The catalog.read connection cannot authorize product writes.",
  product_uploaded_asset_producer_required: "An authenticated uploaded-file binding producer is unavailable. An owner-entered file ID or JSON cannot supply this evidence.",
  product_file_binding_required: "An authenticated uploaded-file binding producer is unavailable. An owner-entered file ID or JSON cannot supply this evidence.",
  product_placement_producer_required: "An authenticated physical-placement evidence producer is unavailable. Product GET responses cannot establish the printed dimensions or placement.",
  product_placement_not_observable: "Native product and file associations were observed, but physical placement and technique are not independently observable. Owner review is still required.",
  product_creation_uncertain: "The create outcome is uncertain. Check only the original external identity; another create request must not be sent.",
  product_cancelled: "Further configuration work has been stopped. Any already-dispatched request still needs its own outcome check.",
  product_connection_changed: "The account connection changed. Review the current same-Business connection before continuing.",
  product_source_stale: "The source snapshot expired. Current independently verified evidence is required.",
  product_readback_mismatch: "The observed product did not match the exact approved source. Owner review is required.",
  product_file_readback_mismatch: "The observed file did not match the authenticated file binding. Owner review is required.",
};
function reasonText(reason: string | null | undefined) {
  return reason && Object.hasOwn(reasonMessages, reason) ? reasonMessages[reason] : "A current prerequisite or exact provider outcome still needs owner review.";
}
function runLabel(run: ProductRun) {
  if (run.receiptRecorded) return "Needs owner review · partial association receipt";
  if (run.dispatchSent) return "Needs owner review · create outcome requires reconciliation";
  if (run.stopRequested || run.status === "cancelled") return "Stopped before dispatch";
  if (run.status === "running") return "Configuration attempt in progress";
  return "Configuration prerequisites need review";
}
export function ProductActionFeedback({ message }: { message?: string | string[] }) {
  if (typeof message !== "string" || !Object.hasOwn(feedbackMessages, message)) return null;
  return <p className="printfulProductFeedback" role="status">{feedbackMessages[message]}</p>;
}

export function ProductConfigurationWorkspace({ data }: { data: ProductWorkspaceData }) {
  const blocked = !data.executionAvailable || !data.configured || data.unavailable;
  return <section className="printfulPanel printfulProductWorkspace" id="printful-product-configuration" aria-labelledby="printful-product-title">
    <div className="printfulSectionHeader"><div><p className="coreEyebrow">Durable owner controls · Execution blocked</p><h2 id="printful-product-title">Review an exact Printful product configuration</h2></div><span className="printfulBadge">Live qualification open</span></div>
    <p className="printfulNote">This bounded path is for one catalog variant, one front or back DTG placement, and one native product in the exact Manual/API store. It requires a current reviewed TEST, exact production-asset approval, authenticated evidence and separate owner configuration consent.</p>
    {data.unavailable && <p className="printfulProductFeedback" role="alert">Product records could not be checked. Existing attempts may still exist. New configuration stays blocked until their history can be verified.</p>}
    {!data.configured && <p className="printfulNote">Server execution is not configured. Owner history and Stop remain available independently of execution configuration.</p>}
    <div className="printfulGatePanel">
      <h3>Required producers and authority are unavailable</h3>
      <ul className="printfulList">
        <li>Current secure product-write authority is absent. Catalog read access, including catalog.read, cannot confer product-write permission.</li>
        <li>The authenticated uploaded-file binding producer and physical-placement evidence producer are absent. A file ID, owner JSON or synthetic fixture cannot replace them.</li>
        <li>Native GET readback supplies product/file association evidence only. It does not prove physical placement, DTG technique, complete product qualification or a listing-ready mockup.</li>
      </ul>
      <p className="printfulNote">Execution remains unavailable. No order, fulfilment submission, marketplace listing or publication is authorized by these controls.</p>
      {data.reasons.length > 0 && <details className="printfulDetails"><summary>Current readiness checks</summary><ul className="printfulList">{Array.from(new Set(data.reasons.map(reasonText))).map(reason => <li key={reason}>{reason}</li>)}</ul></details>}
    </div>
    <div className="printfulProductSources" aria-labelledby="printful-product-sources-title">
      <h3 id="printful-product-sources-title">Exact owner review</h3>
      {!data.sources.length && !data.unavailable && <p className="printfulNote">No authenticated, current product source is available for this Business. The synthetic catalog and pricing examples below cannot be selected for execution.</p>}
      {data.sources.map(source => <article className="printfulProductCard" key={source.id}>
        <h4>{source.name}</h4>
        <dl className="printfulFacts">
          <div><dt>Manual/API store ID</dt><dd>{source.storeId}</dd></div>
          <div><dt>Catalog product / exact variant</dt><dd>{source.catalogProductId} / {source.catalogVariantId}</dd></div>
          <div><dt>Single placement / technique</dt><dd>{source.placement} / DTG</dd></div>
          <div><dt>Reviewed physical design size</dt><dd>{source.designWidthIn} × {source.designHeightIn} in</dd></div>
          <div><dt>Retail price</dt><dd>{source.retailPrice} {source.currency}</dd></div>
          <div><dt>Source expires</dt><dd>{source.expiresAt}</dd></div>
          <div><dt>Exact asset SHA-256</dt><dd className="printfulHash">{source.assetSha256}</dd></div>
          <div><dt>Reviewed source SHA-256</dt><dd className="printfulHash">{source.sourceHash}</dd></div>
        </dl>
        <p className="printfulNote">The server rechecks the same Business, store, connection, source hash, reviewed TEST, production approval, current stock/cost evidence and stop state before dispatch.</p>
        <form action={configureReviewedPrintfulProduct} className="printfulProductForm">
          <input type="hidden" name="businessId" value={data.businessId} /><input type="hidden" name="sourceId" value={source.id} /><input type="hidden" name="sourceHash" value={source.sourceHash} />
          <label className="printfulConsent"><input type="checkbox" name="configurationConsent" required disabled={blocked} />I approve only this exact one-variant DTG native product configuration in the Manual/API store shown, using the reviewed source and asset hashes. This does not authorize spending, orders or publishing.</label>
          <button className="coreButton coreButtonPrimary" disabled={blocked} aria-describedby="printful-product-start-help">Approve exact configuration and start</button>
        </form>
      </article>)}
      <p className="printfulNote" id="printful-product-start-help">Start is disabled while secure write authority and the authenticated evidence producers are unavailable. A connection or artwork approval alone cannot enable execution.</p>
    </div>
    <div className="printfulProductHistory" id="product-configuration-history" aria-labelledby="printful-product-history-title">
      <h3 id="printful-product-history-title">Product configuration history</h3>
      <p className="printfulNote">A durable pre-dispatch marker means a POST may have been sent. Later checks only reconcile the same saved external identity and never send a second create request. Stop cannot undo a POST already sent to Printful.</p>
      {!data.runs.length && !data.unavailable && <p className="printfulNote">No product configuration attempts are recorded for this Business.</p>}
      {data.runs.map(run => <article className="printfulProductCard" key={run.id}>
        <h4>{run.name}</h4><p className="printfulProductState">{runLabel(run)}</p>
        <p className="printfulNote">{run.reason ? reasonText(run.reason) : "Review the recorded attempt and its exact source before taking any next step."}</p>
        <dl className="printfulFacts">
          <div><dt>Dispatch marker</dt><dd>{run.dispatchSent ? "Present · reconciliation only" : "No POST recorded"}</dd></div>
          <div><dt>Receipt</dt><dd>{run.receiptRecorded ? "Partial observation · needs_owner" : "No association receipt recorded"}</dd></div>
          <div><dt>Stop request</dt><dd>{run.stopRequested ? "Recorded" : "Not requested"}</dd></div>
          {run.syncProductId !== null && <div><dt>Observed sync product ID</dt><dd>{run.syncProductId}</dd></div>}
          {run.syncVariantId !== null && <div><dt>Observed sync variant ID</dt><dd>{run.syncVariantId}</dd></div>}
        </dl>
        {run.receiptRecorded && <p className="printfulNote">This partial receipt is not configuration success, physical-placement qualification or a listing-ready mockup. The run remains needs_owner.</p>}
        <div className="printfulActions">
          {run.dispatchSent && <form action={reconcilePrintfulProduct} className="printfulProductForm"><input type="hidden" name="businessId" value={data.businessId} /><input type="hidden" name="runId" value={run.id} /><button className="coreButton" disabled={data.unavailable || !data.configured}>Check existing product</button><small>Read-only reconciliation of the saved identity. Never creates again.</small></form>}
          {!run.stopRequested && run.status !== "cancelled" && <form action={stopPrintfulProduct}><input type="hidden" name="businessId" value={data.businessId} /><input type="hidden" name="runId" value={run.id} /><button className="coreButton" disabled={data.unavailable}>Stop further work</button></form>}
        </div>
      </article>)}
    </div>
  </section>;
}
