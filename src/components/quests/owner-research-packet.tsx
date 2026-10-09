import type { OwnerResearchSetupReceipt } from "@/products/discovery-r12-goal-preparation-contract";
import { ownerResearchUsd } from "@/lib/core-ui/owner-research-form";

const phases = { plan: "Planner", search1: "One public-source collection", select1: "Exact-span evidence selector", strategy: "Strategist", review: "Independent reviewer" } as const;

/** A projection of the stored receipt, never a locally invented quote or permission. */
export function OwnerResearchPacket({ receipt }: { receipt: OwnerResearchSetupReceipt }) {
  const { preview } = receipt;
  const legacy = preview.funding.binding.kind === "legacy_research_root";
  return <section className="ownerResearchPacket" aria-labelledby="research-packet-title">
    <h2 id="research-packet-title">Review this exact research packet</h2>
    <p><strong>{preview.title}</strong> · Quest version {preview.goalRevision}</p>
    <p>{preview.objective}</p>
    <dl className="ownerResearchFacts">
      <div><dt>Reviewed profile</dt><dd>{preview.profileId} · market choice {preview.selection.marketSetKey} · topic choice {preview.selection.topicKey}</dd></div>
      <div><dt>Selected markets</dt><dd>{preview.markets.map(market => `${market.countryCode} (${market.currency})`).join(", ")}</dd></div>
      <div><dt>Audience</dt><dd>{preview.audience}</dd></div>
      <div><dt>Exact public search query</dt><dd>{preview.approvedQuery}</dd></div>
      <div><dt>Permitted factual-snippet sources</dt><dd>{preview.sourceDomains.join(", ")}</dd></div>
      <div><dt>Excluded sources</dt><dd>{preview.excludedDomains.join(", ") || "None listed in this reviewed profile"}</dd></div>
    </dl>
    <p>The public query is rendered from the reviewed market and topic choices. Private Business context and raw Quest text are not added to that search query. Unsupported questions require another reviewed profile.</p>
    <h3>Five-phase quote</h3>
    <ol>{Object.entries(phases).map(([phase, name]) => <li key={phase}>{name}: at most {ownerResearchUsd(preview.quote.ceilings[phase as keyof typeof phases])}</li>)}</ol>
    <p><strong>Whole-run maximum: {ownerResearchUsd(preview.quote.maximumMicrousd)}.</strong> Up to {preview.maximumCalls} calls, {preview.maximumCollections} collection and {preview.maximumRepairs} repairs. These are ceilings; the outcome and actual cost are not promised. Usage is charged once against existing OpenRouter credit, within this bounded run; no recurring commitment is created.</p>
    <p>Quote verified <time dateTime={preview.quote.verifiedAt}>{preview.quote.verifiedAt}</time>; valid until <time dateTime={preview.quote.validUntil}>{preview.quote.validUntil}</time>.</p>
    <h3>Cumulative financial permission</h3>
    <p>These amounts are the immutable snapshot reviewed at preparation. The running workspace shows current costs after confirmation.</p>
    <dl className="ownerResearchFacts">
      <div><dt>Current Business lifetime limit</dt><dd>{ownerResearchUsd(preview.finance.currentBusinessLimitMicrounits)}</dd></div>
      <div><dt>Proposed Business lifetime limit</dt><dd>{ownerResearchUsd(preview.finance.proposedBusinessLimitMicrounits)} · {preview.finance.changesBusinessLimit ? "changes the current limit" : "unchanged"}</dd></div>
      <div><dt>Existing Business committed exposure</dt><dd>{ownerResearchUsd(preview.finance.businessCommittedMicrounits)}</dd></div>
      <div><dt>Minimum Business limit including this run</dt><dd>{ownerResearchUsd(preview.finance.minimumBusinessLimitMicrounits)}</dd></div>
    </dl>
    {legacy ? <>
      <h4>Original cumulative research funding</h4>
      <dl className="ownerResearchFacts">
        <div><dt>Original research limit, current total</dt><dd>{ownerResearchUsd(preview.funding.maximumMicrounits)}</dd></div>
        <div><dt>Proposed cumulative research limit</dt><dd>{ownerResearchUsd(preview.finance.proposedResearchLimitMicrounits)} · {preview.finance.changesResearchLimit ? "explicit increase for this owner-initial lane" : "unchanged"}</dd></div>
        <div><dt>Prior research committed / pending exposure</dt><dd>{ownerResearchUsd(preview.funding.committedMicrounits)} / {ownerResearchUsd(preview.funding.pendingMicrounits)}</dd></div>
        <div><dt>Minimum research total including this run</dt><dd>{ownerResearchUsd(preview.finance.minimumResearchLimitMicrounits)}</dd></div>
      </dl>
      <p>Every prior cost remains in the original research root. An increase appends to that cumulative total; a new Quest or profile does not reset it. Historical scopes and stopped work are not reopened or enlarged. Business and research exposure are overlapping views and are not added twice.</p>
    </> : <p>This research uses the genuine R05 Business funding root. Its research lifetime limit is the same {ownerResearchUsd(preview.finance.proposedBusinessLimitMicrounits)} Business ceiling, with one cumulative cap. It is not a second allowance.</p>}
    <p>Funding version {preview.funding.revision}; Business cap version {preview.finance.expectedCapRevision}. {preview.funding.hasUnknown ? "Unknown research charges block new dispatch." : "No unknown research charge is reported in this packet."} Pending or unknown liabilities must be resolved before fresh dispatch.</p>
    <h3>Data recipients and retention</h3>
    <p>Research inference is routed through OpenRouter to {preview.quote.luna.providerName} ({preview.quote.luna.modelId}, {preview.quote.luna.endpoint}) and the independent reviewer {preview.quote.reviewer.providerName} ({preview.quote.reviewer.modelId}, {preview.quote.reviewer.endpoint}). The bounded research objective, approved scope and phase evidence are processed for this research.</p>
    <p>The public query is sent to Exa through OpenRouter. Search query retention, improvement and training may apply. The quoted inference endpoints require no-training zero-data-retention routing; only static, nonprivate structured-output schemas are shared as schemas.</p>
    <h3>Finite authority and stopping</h3>
    <p>The dispatch clock starts at confirmation: {preview.dispatchMinutes} minutes for dispatch, then {preview.receiptMinutes} additional minutes for existing receipts; at most {preview.maximumReceiptChecks} receipt checks. Stop closes remaining authority. Already dispatched work, possible charges and saved evidence remain recorded.</p>
    <p>Confirmation records this exact R05 operating policy and activates its finite authority window without making a provider call. Opening or preparing this packet does not start paid work. Use the existing research workspace’s Continue control to start bounded paid research. TEST, REJECT and NEEDS_MORE_EVIDENCE remain possible; creative generation, commerce and publication require separate permission.</p>
    <details><summary>Exact saved packet and confirmation references</summary>
      <p>Setup: {receipt.setupId}<br/>Setup hash: {receipt.setupHash}<br/>Policy: {receipt.policyId}<br/>Policy hash: {receipt.policyHash}<br/>Research scope: {receipt.scopeId}</p>
      <pre>{JSON.stringify(preview, null, 2)}</pre>
    </details>
  </section>;
}
