import Link from "next/link";
import type { AdaptiveOwnerReceipt } from "@/products/discovery-r12-adaptive-owner-contract";
import { ownerResearchScopeHref, ownerResearchUsd } from "@/lib/core-ui/owner-research-form";

const phaseLabels = { plan: "Planner", search: "Public-source collection", select: "Evidence selection",
  strategy: "Test strategy", review: "Independent review" } as const;

/** Saved server packet, displayed without deriving a new permission or score. */
export function OwnerAdaptiveResearchPacket({ receipt }: { receipt: AdaptiveOwnerReceipt }) {
  const { preview, quote } = receipt;
  const etsy=quote.version==="r12.adaptive-quote.2";
  return <section className="ownerResearchPacket" aria-labelledby="owner-adaptive-packet-title">
    <h2 id="owner-adaptive-packet-title">Review this exact adaptive research packet</h2>
    <p>The original Quest remains the objective. <Link href={ownerResearchScopeHref(preview.businessId, preview.goalId, preview.predecessor.predecessorScopeId)}>View previous research and its recorded result</Link> (plan version {preview.predecessor.predecessorPlanVersion}). The prior result, including negative or inconclusive findings, is not treated as proof of demand.</p>
    <dl className="ownerResearchFacts">
      <div><dt>Reviewed profile and public choices</dt><dd>{preview.profileId} · market set {receipt.selection.marketSetKey} · topic {receipt.selection.topicKey}</dd></div>
      <div><dt>Selected markets and adult audience</dt><dd>{receipt.selection.markets.map(market => `${market.countryCode} (${market.currency})`).join(", ")} · {receipt.selection.audience}</dd></div>
      <div><dt>Reviewed public prompt</dt><dd>{receipt.selection.approvedQuery}</dd></div>
      <div><dt>{etsy?"Owner-capture source attribution (no network permission)":"Permitted factual-snippet sources"}</dt><dd>{receipt.selection.allowedDomains.join(", ")}</dd></div>
      <div><dt>Excluded sources</dt><dd>{receipt.selection.excludedDomains.join(", ") || "None listed"}</dd></div>
      <div><dt>Evidence imported from the closed predecessor</dt><dd>{preview.imports.length} exact phase receipts. Their hashes and attempt IDs are in the saved packet below.</dd></div>
      <div><dt>Known Quest cost before this run</dt><dd>{ownerResearchUsd(preview.predecessor.baseKnownMicrounits)}</dd></div>
      <div><dt>New run ceiling</dt><dd>{ownerResearchUsd(preview.maximumRunMicrounits)} total, across the initial work and any admitted extras</dd></div>
      <div><dt>Maximum extra decisions</dt><dd>{preview.maximumActions} combined follow-ups, repairs, pivots or reasoning reviews. Each may require several separately paid calls.</dd></div>
      <div><dt>Paid call capacity</dt><dd>At most {preview.maximumPaidCalls} additional dispatches within the original Quest’s {64 - preview.predecessor.baseDispatches} remaining dispatch slots, and {preview.maximumNewChildren} new child slots.</dd></div>
      <div><dt>Run authority expiry</dt><dd><time dateTime={preview.expiresAt}>{preview.expiresAt}</time></dd></div>
    </dl>
    <p>These are ceilings, not a promise that all ten extra decisions fit after actual costs or earlier calls. A negative finding can change the next question. A new URL, timestamp or model paraphrase alone does not count as progress. TEST, REJECT and NEEDS_MORE_EVIDENCE remain possible; no experiment, artwork, commerce or publication is authorized by this packet.</p>
    <h3>Current verified quote</h3>
    <ol>{Object.entries(quote.ceilings).map(([phase, ceiling]) => <li key={phase}>{phaseLabels[phase as keyof typeof phaseLabels]}: at most {ownerResearchUsd(ceiling)} per call</li>)}</ol>
    <p>The quote covers separately pinned phase attempts. It is a proposal only, verified <time dateTime={quote.verifiedAt}>{quote.verifiedAt}</time> and valid until <time dateTime={quote.validUntil}>{quote.validUntil}</time>. Actual calls and provider costs consume the same {ownerResearchUsd(preview.maximumRunMicrounits)} run ceiling.</p>
    <h3>Cumulative financial limits</h3>
    <dl className="ownerResearchFacts">
      <div><dt>Business committed exposure</dt><dd>{ownerResearchUsd(preview.business.committedMicrounits)}</dd></div>
      <div><dt>Business current → proposed lifetime cap</dt><dd>{ownerResearchUsd(preview.business.currentLimitMicrounits)} → {ownerResearchUsd(preview.business.proposedLimitMicrounits)}</dd></div>
      <div><dt>Original research committed exposure</dt><dd>{ownerResearchUsd(preview.funding.committedMicrounits)}</dd></div>
      <div><dt>Original research current → proposed cumulative cap</dt><dd>{ownerResearchUsd(preview.funding.currentLimitMicrounits)} → {ownerResearchUsd(preview.funding.proposedLimitMicrounits)}</dd></div>
    </dl>
    <p>Both ledgers retain earlier commitments and stopped allocations. They overlap; these figures are not two amounts to add together. Pending or unknown liability blocks fresh work.</p>
    <h3>Selected owner observations</h3>
    {receipt.ownerObservationRef ? <><p>Owner-reported textual captures, not independently verified by Etsy. The exact selected records and any fully selected comparison declaration are disclosed to the inference providers below. Unselected evidence remains unavailable; missing or zero exposure is inconclusive. Account locale is not buyer geography.</p><p>Selected manifest hash: {receipt.ownerObservationRef.manifestHash}</p><ul>{receipt.ownerObservationRef.manifest.map(pin=><li key={pin.bundleId}>Bundle {pin.bundleId} · immutable content hash {pin.bundleHash}<br/>Selected records: {pin.selectedObservationIds.join(", ")}</li>)}</ul></> : <p>No owner observation is selected. Public retail statistics alone do not establish Etsy demand.</p>}
    <h3>Sources and data recipients</h3>
    {etsy?<p>This packet authorizes only three actual inference roles: planner, strategist and independent reviewer. Owner-capture validation is deterministic and is not billed or recorded as a collection/select receipt. No Exa or Etsy API request, browser scraping or paid third-party research service is part of this mode. Missing channel observations require a new owner capture and exact revised approval; existing evidence does not become new data through repeated model reasoning.</p>:<p>The collection prompt uses the reviewed public profile question and any admitted public follow-up question. The model chooses the downstream Exa query within the saved domain filters; raw bounded public excerpts reach inference before evidence selection. Private Business and Quest context reaches inference, and a reviewed follow-up question may draw on that context. Credential-like filtering does not guarantee that a public query contains no private information. Exa query retention, improvement and training may apply; inference zero-data-retention routing does not cover Exa.</p>}

    <p>Inference uses OpenRouter to {quote.luna.providerName} ({quote.luna.modelId}, {quote.luna.endpoint}) and independent review through {quote.reviewer.providerName} ({quote.reviewer.modelId}, {quote.reviewer.endpoint}). Only static nonprivate schemas are shared as schemas. A stronger reasoning route needs its own qualified and quoted approval.</p>
    <p>Confirmation binds this exact saved packet and policy. It does not make a provider call. Stop closes remaining authority; dispatched work and recorded costs are preserved.</p>
    <details><summary>Exact saved packet and evidence references</summary>
      <p>Setup {receipt.setupId}<br/>Setup hash {receipt.setupHash}<br/>Scope {receipt.scopeId}<br/>Policy {receipt.policyId}<br/>Policy hash {receipt.policyHash}<br/>Approval hash {receipt.approvalHash}<br/>Predecessor hash {preview.predecessorHash}<br/>Quote hash {preview.quoteHash}</p>
      <pre>{JSON.stringify({ preview, quote, selection: receipt.selection, ownerObservationRef: receipt.ownerObservationRef }, null, 2)}</pre>
    </details>
  </section>;
}
