import Link from "next/link";

import type { CreativeApprovalRecord, CreativeAssetRecord, CreativeReviewRecord, CreativeRunRecord, CreativeWorkspaceData } from "@/creative/data";
import { CREATIVE_COST_COMMITMENT_EXPLANATION, creativeCostStatus, qualifyCreativeCost, summarizeCreativeCosts } from "@/creative/cost-display";

import "./creative-library.css";

type BusinessIdentity = { id: string; name: string };
type CreativeLibraryProps = { data: CreativeWorkspaceData; businesses: readonly BusinessIdentity[]; now: number; historyInPage?: boolean };

/** Use this id on the existing run-history article, which owns the start/close forms. */
export function creativeRunHistoryId(runId: string) {
  return `creative-run-${runId}`;
}

function utc(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().replace("T", " ").replace(/(?:\.000)?Z$/, " UTC") : "Date unavailable";
}

function RecordedDate({ value }: { value: string }) {
  return Number.isFinite(Date.parse(value)) ? <time dateTime={value}>{utc(value)}</time> : <span>Date unavailable</span>;
}

const usd = (micro: number) => `US$${(micro / 1e6).toFixed(6)}`;
const validPurpose = (approval?: CreativeApprovalRecord) => approval?.purpose === "technical_qualification" || approval?.purpose === "candidate_production" || approval?.purpose === "simulation";

function approvalState(approval: CreativeApprovalRecord | undefined, now: number) {
  if (!approval || !validPurpose(approval)) return "Purpose unavailable";
  if (approval.purpose === "technical_qualification") return "Technical-only approval";
  if (approval.purpose === "simulation") return "Simulation only";
  const expires = Date.parse(approval.expires_at);
  if (!Number.isFinite(expires)) return "Approval expiry unavailable";
  return expires <= now ? "Candidate approval expired" : "Saved candidate approval";
}

function savedReview(data: CreativeWorkspaceData, asset: CreativeAssetRecord) {
  return data.reviews.find(review => review.asset_id === asset.id && review.creative_run_id === asset.creative_run_id);
}

function reviewMatches(review: CreativeReviewRecord, asset: CreativeAssetRecord) {
  return review.review.assetHash === asset.asset_hash && review.review.briefHash === asset.brief_hash;
}

function reviewLabel(review: CreativeReviewRecord | undefined, asset: CreativeAssetRecord, approval: CreativeApprovalRecord | undefined, hasReadErrors: boolean) {
  if (!review) return hasReadErrors ? "Review unavailable" : "No visual review recorded";
  if (!reviewMatches(review, asset)) return "Review does not match this version";
  if (review.review.outcome !== "PASS" && review.review.outcome !== "FAIL") return "Review outcome unavailable";
  return `${approval?.purpose === "technical_qualification" ? "Technical" : "Visual review"} ${review.review.outcome}`;
}

function printFileState(asset: CreativeAssetRecord) {
  if (asset.inspection.failedCriteria.length) return "Saved file checks failed";
  if (asset.inspection.sha256 !== asset.asset_hash || !Number.isFinite(asset.inspection.effectiveDpi) || asset.inspection.effectiveDpi <= 0 || !Number.isFinite(asset.inspection.width) || asset.inspection.width <= 0 || !Number.isFinite(asset.inspection.height) || asset.inspection.height <= 0) return "File validation unavailable";
  return "Saved file checks passed";
}

/** Preview-first, read-only Library. Approval and execution actions remain in protected workspaces. */
export function CreativeLibrary({ data, businesses, now, historyInPage = false }: CreativeLibraryProps) {
  const historyHref = (anchor: string, businessId?: string) => historyInPage ? `#${anchor}` : `/dashboard/artifacts${businessId ? `?business=${encodeURIComponent(businessId)}` : ""}#${anchor}`;
  return <section className="guidedCreativeLibrary" aria-labelledby="creative-gallery">
    <header className="guidedLibraryHeading">
      <div><h2 id="creative-gallery">Design gallery</h2><p>{data.assets.length} saved {data.assets.length === 1 ? "version" : "versions"} · Private original artwork</p></div>
      <a className="guidedLibraryTextLink" href={historyHref("creative-approvals", businesses.length === 1 ? businesses[0].id : undefined)}>Review approvals &amp; run history</a>
    </header>
    {data.errors.length ? <div className="guidedLibraryNotice" role="alert"><strong>Some Library records could not be loaded</strong><p>Showing available records. Missing previews, reviews or receipts do not mean they do not exist. Refresh before relying on an approval or spend total.</p><details><summary>Data read details</summary><ul>{data.errors.map((error, index) => <li key={index}>{error}</li>)}</ul></details></div> : null}
    {data.assets.length ? <div className="guidedLibraryGrid">{data.assets.map(asset => {
      // Bind context to this exact Business and run. A similarly named design is not evidence.
      const run = data.runs.find(item => item.id === asset.creative_run_id && item.business_id === asset.business_id);
      const approval = data.approvals.find(item => item.id === run?.approval_id && item.business_id === asset.business_id && item.candidate_id === asset.candidate_id);
      const business = businesses.find(item => item.id === asset.business_id);
      const review = savedReview(data, asset);
      const label = reviewLabel(review, asset, approval, data.errors.length > 0);
      const matchedReview = review && reviewMatches(review, asset);
      const passed = matchedReview && review.review.outcome === "PASS";
      const fileState = printFileState(asset);
      const expired = !!approval && Number.isFinite(Date.parse(approval.expires_at)) && Date.parse(approval.expires_at) <= now;
      const title = approval?.snapshot.concept ?? "Saved design";
      return <article className="guidedLibraryAsset" key={asset.id} id={`creative-asset-${encodeURIComponent(asset.id)}`} aria-labelledby={`creative-title-${asset.id}`}>
        <figure className="guidedLibraryFigure">
          <div className="guidedLibraryPreview">{asset.signedUrl ? <>
            {/* Private signed URLs must not enter a shared image-optimization cache. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={asset.signedUrl} alt={`Original artwork, version ${asset.version}: ${title}`} loading="lazy" />
          </> : <div className="guidedLibraryMissingPreview"><span aria-hidden="true">◇</span><strong>Private preview unavailable</strong><p>The saved record is still here. Reload to refresh private image access.</p></div>}</div>
          <figcaption><span>Original artwork · not a product mockup</span>{asset.signedUrl ? <a href={asset.signedUrl} target="_blank" rel="noopener noreferrer">Open full image ↗</a> : null}</figcaption>
        </figure>
        <div className="guidedLibraryAssetBody">
          <div className="guidedLibraryTags"><span>Version {asset.version}</span><span data-tone={passed ? "review" : "attention"}>{label}</span></div>
          <h3 id={`creative-title-${asset.id}`}>{title}</h3>
          <p className="guidedLibraryBusiness"><Link href={`/dashboard/artifacts?business=${encodeURIComponent(asset.business_id)}`}>Business: {business?.name ?? asset.business_id}</Link></p>
          <p className="guidedLibrarySource">{asset.model || "Model unavailable"} via {asset.provider || "Provider unavailable"}<br /><RecordedDate value={asset.generated_at} /></p>
          <dl className="guidedLibraryGates" aria-label="Independent approval and validation states">
            <div><dt>Design production</dt><dd>{approvalState(approval, now)}</dd></div>
            <div><dt>Print file</dt><dd>{fileState}</dd></div>
            <div><dt>Product validation</dt><dd>Not established by this artwork</dd></div>
            <div><dt>Listing approval</dt><dd>Separate authority required</dd></div>
          </dl>
          <nav className="guidedLibraryLinks" aria-label={`${title} version ${asset.version} context`}>{run ? <><Link href={`/dashboard/workflows/${encodeURIComponent(run.workflow_run_id)}`}>Open exact workflow</Link><a href={historyHref(creativeRunHistoryId(run.id), asset.business_id)}>Run history &amp; receipts</a></> : <span>Run record unavailable</span>}</nav>
        </div>
        <details className="guidedLibraryInspector"><summary>Review, approval &amp; provenance</summary><div className="guidedLibraryInspectorBody">
          <p className="guidedLibraryBoundary">{approval?.purpose === "technical_qualification"
            ? passed
              ? "Technical PASS is a reviewable design artifact. It does not clear market evidence or authorize selling a product."
              : "This is technical-only work. It does not clear market evidence or authorize selling a product."
            : approval?.purpose === "candidate_production"
              ? run?.productionReady
                ? "Passed the saved production approval at completion. Recheck current eligibility before use; publication requires separate authority."
                : "A saved candidate approval is not a completed production check. Current eligibility must be rechecked before use."
              : approval?.purpose === "simulation"
                ? "Simulation output does not establish production readiness or permission to sell."
                : "The saved production purpose could not be established. Do not infer production or publication authority from a visual PASS."}</p>
          {expired ? <p className="guidedLibraryWarning">This saved approval has expired. The artwork and its historical review remain visible; they do not renew the approval.</p> : null}
          <details className="guidedLibraryDisclosure"><summary>Independent visual review</summary>
            {review ? <>
              {!matchedReview ? <p className="guidedLibraryWarning">This review’s hashes do not match the saved asset and brief. Its verdict cannot validate this version.</p> : null}
              <p><strong>{label}</strong> · {review.reviewer_model || "Reviewer unavailable"}<br /><RecordedDate value={review.created_at} /></p>
              <ul className="guidedLibraryReviewChecks">{review.review.checks.map(check => <li key={check.criterion}><strong>{check.outcome} · {check.criterion.replaceAll("_", " ")}</strong><p>{check.rationale}</p></li>)}</ul>
              {review.review.repairInstruction ? <p><strong>{approval?.snapshot.maximumGenerations === 1 ? "Reviewer repair suggestion (not authorized by this one-image approval):" : "Saved reviewer repair suggestion:"}</strong> {review.review.repairInstruction} No new attempt is authorized here.</p> : null}
            </> : <p>{data.errors.length ? "The visual review could not be confirmed from the available records." : "No independent visual review is recorded for this exact asset and run."} File inspection alone is not a visual PASS.</p>}
          </details>
          <details className="guidedLibraryDisclosure"><summary>Print checks &amp; saved approval</summary>
            <p><strong>{fileState}</strong>. These are saved file checks against the named print specification, not validation of a supplier product, garment mockup or live listing.</p>
            <dl className="guidedLibraryFacts"><div><dt>Actual pixels</dt><dd>{asset.inspection.width} × {asset.inspection.height}px</dd></div><div><dt>Effective DPI</dt><dd>{Number.isFinite(asset.inspection.effectiveDpi) ? Math.floor(asset.inspection.effectiveDpi) : "Unavailable"}</dd></div><div><dt>Color space</dt><dd>{asset.inspection.colorSpace || "Unavailable"}</dd></div><div><dt>File</dt><dd>{asset.inspection.mediaType} · {asset.inspection.bytes.toLocaleString("en-US")} bytes</dd></div></dl>
            {asset.inspection.failedCriteria.length ? <p className="guidedLibraryWarning">Binary gate: {asset.inspection.failedCriteria.join(", ")}</p> : null}
            {approval ? <>
              <p>{approval.snapshot.printSpecification.garment} · {approval.snapshot.printSpecification.placement} · {approval.snapshot.printSpecification.designWidthInches} × {approval.snapshot.printSpecification.designHeightInches} in · {approval.snapshot.printSpecification.background} background</p>
              <p>Purpose: {approval.purpose.replaceAll("_", " ")}<br />Approved <RecordedDate value={approval.approved_at} /><br />Expires <RecordedDate value={approval.expires_at} /></p>
              <p>Image limit: {approval.snapshot.maximumGenerations} · {approval.snapshot.maximumGenerations === 1 ? "No repair; a failed review stops for owner review" : "At most one repair"} · No automatic retries</p>
              <p className="guidedLibraryHash">Approval ID: {approval.id}<br />Candidate ID: {asset.candidate_id}{approval.snapshot.decisionId ? <><br />Evidence decision ID: {approval.snapshot.decisionId}</> : null}</p>
              <Link href={`/dashboard/products?view=results&business=${encodeURIComponent(asset.business_id)}`}>Review this Business’s product evidence</Link>
            </> : <p>The exact saved approval is unavailable. Print-file inspection does not supply the missing approval.</p>}
          </details>
          <details className="guidedLibraryDisclosure"><summary>Prompt &amp; immutable provenance</summary>
            <p className="guidedLibraryPrompt">{asset.prompt}</p>
            <dl className="guidedLibraryProvenance"><dt>Asset SHA-256</dt><dd>{asset.asset_hash}</dd><dt>Source brief SHA-256</dt><dd>{asset.brief_hash}</dd><dt>Asset ID</dt><dd>{asset.id}</dd><dt>Creative run ID</dt><dd>{asset.creative_run_id}</dd></dl>
            {asset.provenance ? <>
              <p>{asset.provenance.conversion === "lossless_webp_to_png" ? "Provider returned lossless WebP. This PNG is a derived print/review representation with identical decoded pixels and alpha; no resizing or upscaling was performed." : "Provider PNG retained byte-for-byte."}</p>
              <dl className="guidedLibraryProvenance"><dt>Original provider media type</dt><dd>{asset.provenance.detectedMediaType}</dd><dt>Original SHA-256</dt><dd>{asset.provenance.originalSha256}</dd><dt>Normalization</dt><dd>{asset.provenance.version} · {asset.provenance.verification}</dd><dt>Decoder</dt><dd>{asset.provenance.decoder}</dd>{asset.provenance.encoder ? <><dt>PNG encoder</dt><dd>{asset.provenance.encoder}</dd></> : null}</dl>
              {asset.sourceSignedUrl ? <a href={asset.sourceSignedUrl} target="_blank" rel="noopener noreferrer">Open original provider file ↗</a> : <p>Original file access unavailable; refresh private access before use.</p>}
              <p>The original retains its embedded metadata. Pixel equality does not claim that the derived PNG retains embedded provenance or metadata.</p>
            </> : <p>Historical asset: no normalization provenance was recorded.</p>}
          </details>
        </div></details>
      </article>;
    })}</div> : <div className="guidedLibraryEmpty"><h3>{data.errors.length ? "Saved designs unavailable" : "No saved designs yet"}</h3><p>{data.errors.length ? "The current read could not confirm whether any designs exist. Refresh before treating the Library as empty." : "A run can stop before saving a design. Review its history and receipts; failed validation may still incur a charge and retain an unvalidated provider source."}</p><a href={historyHref("creative-approvals", businesses.length === 1 ? businesses[0].id : undefined)}>Review approvals &amp; run history</a></div>}
  </section>;
}

/** A compact receipt summary, with no start, close, approval or retry actions. */
export function CreativeRunCostSummary({ data, approval, run }: { data: Pick<CreativeWorkspaceData, "costs" | "costsAvailable">; approval: CreativeApprovalRecord; run?: CreativeRunRecord }) {
  const costs = run ? data.costs.filter(cost => cost.creative_run_id === run.id) : [];
  const totals = summarizeCreativeCosts(costs);
  const reportedCalls = totals.recordedCalls - totals.uncertainCalls;
  return <div className="guidedCreativeCosts">
    <dl className="guidedLibraryFacts"><div><dt>Approved allowance</dt><dd>{usd(approval.maximum_microusd)}</dd></div><div><dt>{data.costsAvailable ? "Provider-reported charges" : "Known charges in partial receipts"}</dt><dd>{reportedCalls ? usd(totals.reportedMicrousd) : data.costsAvailable ? "No charge reported" : "Unavailable"}</dd></div></dl>
    {!data.costsAvailable ? <p className="guidedLibraryWarning" role="alert">The cost ledger could not be fully loaded. Any receipts below are incomplete; do not assume zero spend or start another attempt.</p> : !costs.length ? <p className="guidedLibraryCostNote">No provider calls are recorded in the loaded ledger. The allowance is a spending limit, not a charge.</p> : null}
    {totals.uncertainCalls ? <p className="guidedLibraryWarning">{totals.uncertainCalls} charge(s) remain unknown · {totals.hasMissingReservation ? "At least " : ""}{usd(totals.uncertainReservedMicrousd)} reserved for those attempts. Missing receipts do not prove zero spend or permit another attempt.</p> : null}
    {costs.length ? <p className="guidedLibraryCostNote">{!data.costsAvailable || totals.hasMissingReservation ? "Known conservative budget commitment" : "Conservative budget committed"}: {usd(totals.committedMicrousd)}. {CREATIVE_COST_COMMITMENT_EXPLANATION}{totals.hasMissingReservation ? " Some reservation details are unavailable; refresh before relying on this total." : ""}</p> : null}
    {costs.length ? <details className="guidedLibraryDisclosure"><summary>Provider receipts &amp; reservations</summary><ul className="guidedLibraryReceipts">{costs.map(cost => { const qualified = qualifyCreativeCost(cost); return <li key={cost.call_key}><strong>{cost.call_key}</strong><p>{creativeCostStatus(cost, run?.capabilityExpired ?? false)}{qualified.reportedMicrousd === null ? "" : ` · ${usd(qualified.reportedMicrousd)}`}</p>{qualified.unverifiedMicrousd !== null ? <p>Unverified saved amount: {usd(qualified.unverifiedMicrousd)} · excluded from reported charges</p> : null}<p>Reserved: {cost.reserved_microusd === null ? "Detail unavailable" : usd(cost.reserved_microusd)}<br />Attempt <RecordedDate value={cost.created_at} />{cost.settled_at ? <><br />Receipt <RecordedDate value={cost.settled_at} /></> : null}</p></li>; })}</ul></details> : null}
  </div>;
}
