import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { AppShell, PageHeader } from "@/components/stage7/app-shell";
import { ConsoleRetainedWorkspace } from "@/components/console/console-retained-workspace";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { verifyOwnerBusiness } from "@/lib/core-ui/owner-business";
import { readResearchQualification } from "@/research/qualification-server";
import { activateResearchProof, reconcileResearchProofAction, runResearchProofAction, stopResearchProofAction } from "./actions";
import { PrepareResearchForm } from "./prepare-form";
import { VerifySavedRouteForm } from "./verify-route-form";
import { ResearchSubmitButton } from "./submit-button";
import { formatResearchUsd, researchProofState, canRunResearchProof, researchWindowCurrent, canVerifySavedInferenceRoute, researchGrantDisclosure, researchOutcomeDisclosure, safeResearchSourceUrl } from "./presentation";
import "./research-qualification.css";

export const dynamic = "force-dynamic";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const notices: Record<string, string> = {
  "consent-required": "Review both consent statements before activating this exact grant. No activation was requested.",
  "check-saved-state": "The requested change could not be confirmed. Check the saved status below; no automatic retry was made.",
  "review-activation": "Activation was requested. Check the saved policy below before starting the proof; activation alone does not claim a research result.",
  "review-proof": "Check the saved result, phase records and held exposure below. A dispatch marker is not a validated result. No automatic retry was made.",
  "diagnostic-unavailable": "The failure diagnostic could not be saved. Inspect this exact proof’s phase and accounting records below. No automatic retry was made; unresolved charges remain held.",
  "review-stop": "Stop was requested. Only saved revocation confirms that further dispatch is stopped. Existing calls and held charges are not undone.",
  "review-reconciliation": "Review the saved Stop and reconciliation records below. A request alone does not confirm reconciliation or authorize a new attempt.",
};

export default async function ResearchQualificationPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireOwnerUiContext(), query = await searchParams;
  const businessId = typeof query.business === "string" ? query.business : null;
  if (!businessId || !UUID.test(businessId)) notFound();
  const verified = await verifyOwnerBusiness(context, businessId);
  if (!verified && !context.businessesUnavailable) notFound();
  const businessName = verified ? context.businesses.find(b => b.id === businessId)!.name : "Business unavailable";
  // GET is saved-state only: no quote acquisition, authority creation or provider call.
  const view = verified ? await readResearchQualification(context, businessId) : null;
  const unavailable = !view || view.unavailable;
  const notice = typeof query.notice === "string" && Object.hasOwn(notices, query.notice) ? notices[query.notice] : null;

  return <AppShell active="dashboard" toolDestination="research" context={context} navigationBusinessId={businessId}>
    <ConsoleRetainedWorkspace ownerId={context.userId}
      header={<PageHeader eyebrow={`${businessName} · Public evidence`} title="Public research proof"
        description="Review one bounded public-research authorization, run its proof, and inspect the saved attributed evidence."
        actions={<Link className="coreButton" href={`/dashboard?view=research&business=${businessId}`}>Back to Research</Link>} />}
      notice={<p className="coreNotice">Opening or refreshing this page only reads saved records. This proof does not select products, generate artwork, change a store, or start R12 work.</p>}
      panels={[{ id: "proof", label: "Public research", content: <div className="r11Research" data-r11-research-root>
        {unavailable ? <section><h2>Research records unavailable</h2><p role="alert">Business ownership or saved qualification records could not be verified. No other Business was selected and no research can start here.</p><Link className="coreButton" href={`/dashboard/research-qualification?business=${businessId}`}>Reload this exact Business</Link></section> : <>
          {notice ? <p role="status">{notice}</p> : null}
          {!view.configured ? <p role="status">Research execution is held because the dedicated admission or provider configuration is incomplete. An authorized operator must verify the R05 admission key securely. Existing Accounts keys cannot substitute for it. Saved evidence and Stop remain available.</p> : null}
          <section aria-labelledby="research-exposure-title">
            <h2 id="research-exposure-title">Accounted exposure</h2>
            <p>{view.exposure ? formatResearchUsd(view.exposure.heldMicrounits) : "Exposure unavailable"}{view.exposure?.hasUnknown ? " · Unknown charge remains held" : ""}</p>
            <p>Known charges plus any unresolved reservations. Unknown outcomes remain accounted for and do not authorize another attempt.</p>
          </section>
          {view.continuation ? <PrepareResearchForm key={`${businessId}:${view.continuation.predecessorPolicyId}`} businessId={businessId} policyId={randomUUID()} workflowRunId={randomUUID()} configured={view.configured} continuation={view.continuation} /> : view.policyTotal === 0 ?
            <PrepareResearchForm key={businessId} businessId={businessId} policyId={randomUUID()} workflowRunId={randomUUID()} configured={view.configured} /> :
            <section><h2>Continuation preparation unavailable</h2><p>The exact previous proof, Goal, Stop and remaining lifetime allowance must be verified before preparing another attempt. No replacement Goal or fresh lifetime allowance is created here.</p></section>}
          <section aria-labelledby="research-grants-title">
            <h2 id="research-grants-title">Reviewed grants awaiting owner activation</h2>
            <p>Showing {view.grants.length} of {view.grantTotal ?? "unknown total"} grants (latest 25). Installation requires an independently reviewed exact grant; preparing metadata does not install one.</p>
            {view.grants.length ? view.grants.map(entry => {
              const policy = entry.grant.researchPolicy;
              const continuation = entry.kind === "continuation";
              const disclosure = researchGrantDisclosure(entry.grant, entry.kind);
              const available = !!disclosure && view.configured && !view.exposure.hasUnknown && !entry.used && !entry.expired && !entry.revoked && researchWindowCurrent(policy);
              return <section key={entry.grantId} data-r11-grant={entry.grantId}>
                <h3>{entry.revoked ? "Revoked grant" : entry.used ? "Activated grant" : entry.expired ? "Expired grant" : "Pending owner activation"}</h3>
                <p><strong>Exact public question:</strong> {policy.query}</p>
                <p>Allowed sources: {policy.allowedDomains.join(", ")}. Excluded sources: {policy.excludedDomains.join(", ")}.</p>
                <p>Model: {policy.modelId}. Router: OpenRouter. Search: Exa. Exact inference route: {policy.providerEndpoint} (Azure US).</p>
                <p>Maximum {formatResearchUsd(policy.maximumMicrousd)} for one search and one evidence-selection call, at most two paid calls. No fallback, extra research or automatic retry.</p>
                <p>Authorization starts {policy.validFrom} and ends {policy.validUntil}. Approved quote window ends {policy.quoteValidUntil}.</p>
                <p>Only the reviewed generic public question and bounded public evidence are sent. Exa may retain queries and use them for improvement or training. Exact Azure US inference ZDR/no-training does not cover Exa. Attributed evidence is retained in this application.</p>
                {disclosure ? <div data-r11-activation-summary>
                  <h4>What activation confirms</h4>
                  <p>{continuation ? "Activation appends the reviewed Business and Goal revisions to the same Business and Goal and confirms a new financial policy inside the unchanged lifetime cap. Original attempts and charges remain saved." : "Activation saves the exact Business operating rules and Goal below, and confirms the reviewed financial limits."} It does not itself start a paid call.</p>
                  <p>Existing accounted exposure: {formatResearchUsd(view.exposure.heldMicrounits)}. Reviewed exposure snapshot: {formatResearchUsd(disclosure.expectedExposureMicrounits)}.</p>
                  <p>New one-time research cap: {formatResearchUsd(disclosure.policyLimitMicrounits)}. {continuation ? "Unchanged" : "Resulting"} Business lifetime cap: {formatResearchUsd(disclosure.businessLifetimeLimitMicrounits)}.</p>
                  {disclosure.continuation ? <p>Same Goal {String(disclosure.continuation.goalId)}. Previous policy {String(disclosure.continuation.predecessorPolicyId)}. This is one separately approved fresh attempt; it does not replay the stopped attempt.</p> : null}
                  <p>This new one-time allowance does not transfer or debit the historical $2 research allowance.</p>
                  <details><summary>Exact Business, Goal and financial confirmation</summary>
                    <p>Full fixed scope, deadline, stop constraints and financial policy that this activation saves and confirms:</p>
                    <pre>{JSON.stringify({ businessContent: disclosure.businessContent, goalContent: disclosure.goalContent, operatingPolicy: disclosure.operatingPolicy, ...(disclosure.continuation ? { continuation: disclosure.continuation } : {}) }, null, 2)}</pre>
                  </details>
                </div> : <p role="alert">The exact Business, Goal or financial confirmation is unavailable. Activation is held until the full reviewed scope and limits can be shown.</p>}
                <form action={activateResearchProof}>
                  <input type="hidden" name="businessId" value={businessId} />
                  <input type="hidden" name="grantId" value={entry.grantId} />
                  <input type="hidden" name="grantHash" value={entry.grantHash} />
                  <label><input type="checkbox" name="readConsent" required disabled={!available} />Confirm the exact Business, Goal and financial limits above, and authorize {continuation ? "this one fresh continuation attempt" : "this public evidence proof"}, up to {formatResearchUsd(policy.maximumMicrousd)} and two paid calls, with no fallback or automatic retry</label>
                  <label><input type="checkbox" name="retentionConsent" required disabled={!available} />Approve sending the reviewed public question and evidence to OpenRouter, Exa and the exact Azure US inference route, including Exa’s possible query retention and training use</label>
                  <ResearchSubmitButton disabled={!available} pendingLabel="Activating exact grant…">Activate reviewed proof</ResearchSubmitButton>
                </form>
                <details><summary>Grant identity</summary><p>Grant {entry.grantId}</p><p>Fingerprint {entry.grantHash}</p></details>
              </section>;
            }) : <p>No reviewed grant is installed for this Business. Existing connections or Accounts credentials do not authorize research.</p>}
          </section>
          <section aria-labelledby="research-policies-title">
            <h2 id="research-policies-title">Saved proofs</h2>
            <p>Showing {view.policies.length} of {view.policyTotal ?? "unknown total"} proofs (latest 25). Results remain readable after authorization expires or server configuration is removed.</p>
            {view.policies.length ? view.policies.map(entry => {
              const status = researchProofState(entry), result = entry.result;
              return <section key={entry.policyId} data-r11-policy={entry.policyId}>
                <h3>{status}</h3>
                <p>{entry.policy.query}</p>
                <p>Allowed sources: {entry.policy.allowedDomains.join(", ")}. Model: {entry.policy.modelId} through {entry.policy.providerEndpoint}.</p>
                <p>Maximum {formatResearchUsd(entry.policy.maximumMicrousd)} · Authorization expires {entry.policy.validUntil}</p>
                <p>Goal {entry.goalId} · Financial policy {entry.operatingPolicyId}</p>
                {entry.revoked ? <p>Revoked: further dispatch is stopped. Saved evidence and previously incurred exposure remain.</p> : entry.expired ? <p>Expired: no new dispatch is authorized. Saved results and Stop remain available.</p> : null}
                <div className="r11ResearchActions">
                  <form action={runResearchProofAction}>
                    <input type="hidden" name="businessId" value={businessId} />
                    <input type="hidden" name="policyId" value={entry.policyId} />
                    <ResearchSubmitButton disabled={!canRunResearchProof(entry, view.configured, view.exposure?.hasUnknown ?? true)} pendingLabel="Running bounded proof…">Run public evidence proof</ResearchSubmitButton>
                  </form>
                  <form action={stopResearchProofAction}>
                    <input type="hidden" name="businessId" value={businessId} />
                    <input type="hidden" name="policyId" value={entry.policyId} />
                    <ResearchSubmitButton disabled={entry.revoked} pendingLabel="Requesting Stop…">Stop this proof</ResearchSubmitButton>
                  </form>
                  {entry.terminalReconciliationRequired ? <form action={reconcileResearchProofAction}>
                    <input type="hidden" name="businessId" value={businessId} />
                    <input type="hidden" name="policyId" value={entry.policyId} />
                    <ResearchSubmitButton disabled={false} pendingLabel="Reconciling saved Stop…">Reconcile saved Stop</ResearchSubmitButton>
                  </form> : null}
                </div>
                {entry.terminalReconciliationRequired ? <p role="status">This historical attempt needs saved Stop reconciliation before continuation can be reviewed. Reconciliation preserves its charges and does not recover an unknown failure reason or start research.</p> : null}
                <h4>Saved proof outcomes</h4>
                {(entry.outcomeEvents ?? []).map(outcome => {
                  const disclosure = researchOutcomeDisclosure(outcome, entry.policy.allowedDomains);
                  return disclosure ? <div key={outcome.outcomeId} data-r11-outcome={outcome.kind}>
                    <h4>{disclosure.title}</h4><p>{disclosure.reason}</p>
                    <p>{disclosure.phase}{disclosure.createdAt ? ` · Saved ${disclosure.createdAt}` : " · Save time unavailable"}</p>
                    {disclosure.observations.length ? <details><summary>Safe observed response details</summary>{disclosure.observations.map((observation, index) => <p key={index}>{observation}</p>)}</details> : null}
                  </div> : <p key={outcome.outcomeId}>A saved outcome could not be displayed safely. No new attempt is authorized.</p>;
                })}
                {!result && entry.phases.some(phase => phase.marked) && !entry.outcomeEvents?.some(outcome => outcome.kind === "failure") ?
                  <p>No typed validation outcome is saved for this attempt. Dispatch markers and charges do not establish its result or failure cause.</p> :
                  !entry.outcomeEvents?.length ? <p>No saved failure or owner Stop outcome is recorded.</p> : null}
                <h4>Saved phase records</h4>
                <p>Dispatch markers and settlement records do not prove that returned evidence passed validation.</p>
                {(["search", "select"] as const).map(name => {
                  const phase = entry.phases.find(saved => saved.phase === name);
                  return <div key={name} data-r11-phase={name}>
                    <p>{name === "search" ? "Search" : "Evidence selection"}: {!phase ? "no dispatch recorded" : !phase.marked ? "Pending, not dispatched" : !phase.settled || phase.actualMicrounits === null ? "Dispatched; charge or settlement unknown, held" : `Dispatched; reported ${formatResearchUsd(phase.actualMicrounits)}`}</p>
                    {phase && canVerifySavedInferenceRoute(phase) ? <VerifySavedRouteForm key={`${businessId}:${entry.policyId}:${phase.requestId}`} businessId={businessId} policyId={entry.policyId} requestId={phase.requestId} /> : null}
                  </div>;
                })}
                {result ? <div data-r11-result={result.resultId}>
                  <h4>Saved validated evidence</h4>
                  <p>Saved {result.createdAt}. This is attributed public evidence, not a sales, profitability or product-selection claim.</p>
                  {result.evidencePack.evidence.map(evidence => {
                    const source = result.evidencePack.sources.find(source => source.id === evidence.sourceId);
                    const url = source ? safeResearchSourceUrl(source.url, entry.policy.allowedDomains) : null;
                    return <figure key={evidence.id}><blockquote>{evidence.quote}</blockquote><figcaption>
                      {source && url ? <a href={url} target="_blank" rel="noopener noreferrer">{source.title}</a> : "Source reference unavailable"}
                      {source ? ` · Retrieved ${source.retrievedAt}${source.publishedAt ? ` · Published ${source.publishedAt}` : " · Publication date unavailable"}` : ""}
                    </figcaption></figure>;
                  })}
                  <p>Limitations: {result.evidencePack.limitations.join(", ")}</p>
                  <details><summary>Evidence identity</summary><p>Result {result.resultId}</p><p>Evidence fingerprint {result.evidencePackHash}</p><p>Collection {result.collectionId}</p><p>Provider receipt {result.providerRequestId}</p></details>
                </div> : <p>No saved validated evidence result is available. Pending or held records must not be treated as success.</p>}
                <details><summary>Proof identity and accounting</summary><p>Policy {entry.policyId}</p><p>Workflow {entry.workflowRunId}</p><p>Policy fingerprint {entry.policyHash}</p>{entry.phases.map(phase => <p key={phase.phase}>{phase.phase}: request {phase.requestId ?? "not assigned"}; provider receipt {phase.providerRequestId ?? "not reported"}</p>)}</details>
              </section>;
            }) : <p>No owner-activated public research proof is saved for this Business.</p>}
          </section>
        </>}
      </div> }]} />
  </AppShell>;
}
