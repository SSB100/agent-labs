"use client";
import { ConsoleRecentRows } from "@/components/console/console-retained-workspace";

import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useId, type KeyboardEvent } from "react";
import { useFormStatus } from "react-dom";

import {
  reconcileProductDiscovery,
  recordProductAssessment,
  reconsiderProductCandidate,
  startProductResearch,
} from "@/app/dashboard/products/actions";
import { CoreIcon } from "@/components/stage7/icons";
import {
  DIMENSIONS,
  type CandidateOutcome,
  type Dimension,
  type ProductCandidate,
  type ProductDecisionRecord as ProductDecision,
  type ProductExperimentRecord as ProductExperiment,
  type ProductWorkspaceData,
} from "@/products/types";
import { hasOnlyLegacyProductHistory, isLegacyProductAssessment, isLegacyProductExperiment, productAssessmentVersion, productExperimentLabel, recordedProductOutcome } from "@/products/history";
import "@/app/dashboard/products/products.css";

const DIMENSION_LABELS: Record<Dimension, string> = {
  demand: "Demand",
  competition: "Competition",
  differentiation: "Differentiation",
  estimated_margin: "Estimated margin",
  creative_opportunity: "Creative opportunity",
  seasonality: "Seasonality",
  production_complexity: "Production complexity",
  policy_ip_risk: "Policy / IP risk",
  marketing_potential: "Marketing potential",
};
const VIEWS = ["Candidates", "Evidence", "Decisions", "Registry"] as const;
type ProductView = (typeof VIEWS)[number];

/** Locale-independent UTC output keeps server and client hydration identical. */
export function formatProductUtc(value: string | null | undefined) {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : `${date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "")} UTC`;
}

function ProductTime({ value }: { value: string | null | undefined }) {
  const label = formatProductUtc(value);
  return label === "Unknown" ? <span>Unknown</span> : <time dateTime={new Date(value!).toISOString()}>{label}</time>;
}

function publicSourceUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

export function ProductSubmitButton({
  children,
  pendingText = "Saving…",
  secondary = false,
  disabled = false,
}: {
  children: string;
  pendingText?: string;
  secondary?: boolean;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return <button className={`coreButton coreButton-${secondary ? "secondary" : "primary"}`} disabled={pending || disabled} type="submit" aria-disabled={pending || disabled}>
    {pending ? pendingText : children}
  </button>;
}

function OutcomePill({ outcome }: { outcome: CandidateOutcome | null }) {
  if (!outcome) return <span className="productTag">Recorded outcome unavailable</span>;
  return <span className={`productOutcome productOutcome-${outcome.toLowerCase()}`}>{outcome}</span>;
}

function ExperimentStatus({ status }: { status: ProductExperiment["status"] }) {
  return <span className={`productExperimentStatus productExperimentStatus-${status}`}><span aria-hidden="true" />{status === "researching" ? "Researching" : status === "reserved" ? "Reserved" : status === "completed" ? "Research complete" : "Research failed"}</span>;
}

function EmptyState({ title, children }: { title: string; children: string }) {
  return <div className="productEmpty"><CoreIcon name="products" /><h3>{title}</h3><p>{children}</p></div>;
}

function EvidenceReferences({ ids, experiment }: { ids: string[]; experiment?: ProductExperiment }) {
  if (!ids.length) return <span className="productMuted">No cited evidence</span>;
  return <div className="productEvidenceReferences">{ids.map((id) => {
    const evidence = experiment?.evidence_pack?.evidence.find((item) => item.id === id);
    const source = experiment?.evidence_pack?.sources.find((item) => item.id === evidence?.sourceId);
    const url = source ? publicSourceUrl(source.url) : null;
    return url ? <a key={id} href={url} target="_blank" rel="noopener noreferrer" title={`${id}: ${source?.title}`}><code>{id}</code><span aria-hidden="true"> ↗</span></a> : <code key={id}>{id}</code>;
  })}</div>;
}

function DecisionView({ decision, experiment }: { decision: ProductDecision; experiment?: ProductExperiment }) {
  const assessment = decision.assessment;
  if (!isLegacyProductAssessment(assessment)) return <div className="productDecision">
    <div className="productRow productRow-start"><div><span className="productEyebrow">Versioned assessment · {productAssessmentVersion(assessment)}</span><p className="productSubtle">Recorded <ProductTime value={decision.created_at} /></p></div><OutcomePill outcome={recordedProductOutcome(assessment)} /></div>
    <p className="productDecisionMeaning">This reader does not interpret this assessment format. Its complete saved content is preserved below, including any rationale, uncertainty, and evidence references. No legacy scores are inferred.</p>
    <p className="productSubtle">A recorded TEST does not authorize creative production, publication, or spending. Use the linked workflow to review its version-specific evidence and approval requirements.</p>
    {experiment?.workflow_run_id ? <Link className="productTextLink" href={`/dashboard/workflows/${experiment.workflow_run_id}`}>Open decision workflow ↗</Link> : null}
    <details className="productDetails"><summary>Preserved assessment content</summary><pre className="productVariables">{JSON.stringify(assessment, null, 2) ?? "No assessment content recorded"}</pre></details>
  </div>;
  return <div className="productDecision">
    <div className="productRow productRow-start">
      <div><span className="productEyebrow">{assessment.assessmentOrigin === "owner_assessment" ? "Owner assessment" : "Deterministic provisional assessment"}</span><p className="productSubtle">Recorded <ProductTime value={decision.created_at} /></p></div>
      <OutcomePill outcome={assessment.outcome} />
    </div>
    {assessment.ownerRightsConfirmed ? <p className="productSubtle">The owner explicitly confirmed design rights for this assessment. This declaration is not independent legal or IP clearance.</p> : null}
    <p className="productDecisionMeaning">{assessment.outcome === "TEST" ? "A proposed future test only. This is not qualified product approval." : assessment.outcome === "REJECT" ? "Do not advance this candidate on the current evidence." : "Keep this candidate unvalidated until the missing evidence is supplied."}</p>
    <div className="productScoringHeading"><strong>Nine-dimension scorecard</strong><span>{assessment.totalScore === null ? "Total: Unknown" : `Weighted total: ${assessment.totalScore} / 100`}</span></div>
    <p className="productSubtle">0–5 per dimension; higher is more favorable, including lower competition, simpler production, and lower policy / IP risk. Unknown is not zero.</p>
    <div className="productScoreGrid">{DIMENSIONS.map((dimension) => {
      const entry = assessment.dimensions.find((item) => item.dimension === dimension);
      const score = entry?.score ?? null;
      return <div className={`productScore ${score === null ? "productScore-unknown" : ""}`} key={dimension}>
        <span>{DIMENSION_LABELS[dimension]}</span><strong>{score === null ? "Unknown" : `${score} / 5`}</strong>
        <div className="productScoreTrack" aria-hidden="true"><span style={{ width: `${score === null ? 0 : (score / 5) * 100}%` }} /></div>
      </div>;
    })}</div>
    {assessment.reasons.length ? <div className="productDecisionSection"><h4>Decision reasons</h4><ul>{assessment.reasons.map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}</ul></div> : null}
    <div className="productDecisionSection productMissingEvidence"><h4>Exact missing evidence</h4>{assessment.missingEvidence.length ? <ul>{assessment.missingEvidence.map((missing, index) => <li key={`${index}-${missing}`}>{missing}</li>)}</ul> : <p>No additional evidence gaps recorded by this assessment. This does not grant production or publication authority.</p>}</div>
    <details className="productDetails"><summary>Dimension rationale and citations</summary><div className="productRationaleList">{DIMENSIONS.map((dimension) => {
      const entry = assessment.dimensions.find((item) => item.dimension === dimension);
      return <section key={dimension}><div className="productRow"><h4>{DIMENSION_LABELS[dimension]}</h4><span className="productTag">{(entry?.evidenceKind ?? "unassessed").replaceAll("_", " ")}</span></div><p>{entry?.rationale || "Unknown. No evidence-backed rationale recorded."}</p><EvidenceReferences ids={entry?.evidenceIds ?? []} experiment={experiment} /></section>;
    })}</div></details>
    <div className="productDecisionFooter"><span>Scoring: {assessment.scoringVersion}</span><span>Contract checked · Not live qualified</span><span>No creative production · No publication</span></div>
  </div>;
}

function EvidenceView({ experiment }: { experiment: ProductExperiment }) {
  const pack = experiment.evidence_pack;
  if (!pack) return <p className="productInlineEmpty">No Evidence Pack persisted for this experiment yet. Missing evidence is not a negative finding.</p>;
  return <div className="productEvidenceView">
    <p className="productEvidenceQuestion">{pack.question}</p>
    <p className="productSubtle">Sources establish only what they state. Policy evidence cannot establish market demand. Retrieval and expiry timestamps describe freshness, not new evidence.</p>
    {!pack.sources.length ? <p className="productInlineEmpty">No source citations are available in this Evidence Pack.</p> : <div className="productSources">{pack.sources.map((source) => {
      const url = publicSourceUrl(source.url);
      const title = source.title.trim() || (url ? new URL(url).hostname : "Public source");
      const evidence = pack.evidence.filter((entry) => entry.sourceId === source.id);
      return <article className="productSource" key={source.id}>
        <div className="productRow productRow-start"><h4>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{title}<span aria-hidden="true"> ↗</span></a> : title}</h4><code>{source.id}</code></div>
        <p className="productSourceUrl">{url ?? "Source URL unavailable or not a secure public URL"}</p>
        <dl className="productSourceDates"><div><dt>Retrieved</dt><dd><ProductTime value={source.retrievedAt} /></dd></div><div><dt>Expires</dt><dd><ProductTime value={source.retrievalExpiresAt} /></dd></div><div><dt>Published</dt><dd><ProductTime value={source.publishedAt} /></dd></div></dl>
        {evidence.length ? evidence.map((entry) => <figure className="productQuote" key={entry.id}><blockquote>{entry.quote}</blockquote><figcaption>Evidence <code>{entry.id}</code></figcaption></figure>) : <figure className="productQuote"><blockquote>{source.excerpt}</blockquote><figcaption>Source excerpt · No selected evidence quote</figcaption></figure>}
        <details className="productDetails productDetails-small"><summary>Source provenance</summary><dl className="productMetadata"><div><dt>Provider</dt><dd>{source.provider}</dd></div><div><dt>Content fingerprint</dt><dd><code>{source.contentHash}</code></dd></div></dl></details>
      </article>;
    })}</div>}
    {pack.claims.length ? <details className="productDetails"><summary>Research claims and supporting citations ({pack.claims.length})</summary><ol className="productClaims">{pack.claims.map((claim, index) => <li key={`${claim.evidenceId}-${index}`}><p>{claim.text}</p><EvidenceReferences ids={[claim.evidenceId]} experiment={experiment} /></li>)}</ol></details> : null}
    {pack.limitations.length ? <div className="productLimitations"><h4>Research limitations</h4><ul>{pack.limitations.map((limitation, index) => <li key={`${index}-${limitation}`}>{limitation}</li>)}</ul></div> : null}
    <p className="productSubtle">Evidence artifact: <code>{experiment.source_artifact_id ?? "Not persisted"}</code></p>
  </div>;
}

function MeasurementPlanView({ experiment }: { experiment: ProductExperiment }) {
  if (!isLegacyProductExperiment(experiment)) return <div className="productMeasurement">
    <div className="productRow"><h4>Versioned plan</h4><span className="productTag">{experiment.discovery_version ?? "Unrecognized format"}</span></div>
    <p className="productSubtle">This plan is preserved in its original format. Legacy observation counts, duration, and zero-dollar budgets do not describe it. Any proposed future test still requires its own execution approvals.</p>
    <details className="productDetails"><summary>Preserved plan content</summary><pre className="productVariables">{JSON.stringify(experiment.measurement_plan, null, 2) ?? "No plan content recorded"}</pre></details>
  </div>;
  const plan = experiment.measurement_plan;
  return <div className="productMeasurement"><div className="productRow"><h4>Future measurement plan</h4><span className="productTag">Unstarted · Research only</span></div>
    <p className="productSubtle">This records a proposed observation plan, not measured results. No test, listing, creative, advertising, or spending is launched.</p>
    <dl className="productMeasurementGrid"><div><dt>Metric</dt><dd>{plan.metric.replaceAll("_", " ")}</dd></div><div><dt>Minimum sample</dt><dd>{plan.minimumSampleSize} observations</dd></div><div><dt>Minimum duration</dt><dd>{plan.minimumDays} days</dd></div><div><dt>Success threshold</dt><dd>{plan.successThreshold} qualified interests</dd></div><div><dt>Maximum budget</dt><dd>${plan.maximumBudgetUsd} USD</dd></div><div><dt>Creative / price</dt><dd>Not set</dd></div></dl>
    <p className="productSubtle"><strong>Stop rule:</strong> {plan.stopRule}</p>
  </div>;
}

function OwnerAssessment({ experiment }: { experiment: ProductExperiment }) {
  const prefix = useId();
  if (!isLegacyProductExperiment(experiment) || experiment.status !== "completed" || !experiment.evidence_pack) return null;
  return <details className="productDetails"><summary>Record an owner assessment</summary>
    <p className="productSubtle">Use only evidence from this completed experiment. Leave the score blank and kind No assessment in loaded history for Unknown. Every dimension needs a rationale (10–600 characters). Higher scores are favorable. Policy sources cannot support demand or other market scores. Saving recalculates the decision; it does not approve a product.</p>
    <p className="productSubtle">Available evidence IDs: {experiment.evidence_pack.evidence.length ? experiment.evidence_pack.evidence.map((entry) => entry.id).join(", ") : "None"}</p>
    <form action={recordProductAssessment} className="productForm">
      <input type="hidden" name="experimentId" value={experiment.id} />
      <div className="productAssessmentFields">{DIMENSIONS.map((dimension) => <fieldset key={dimension}>
        <legend>{DIMENSION_LABELS[dimension]}</legend>
        <div className="productFormGrid"><label htmlFor={`${prefix}-${dimension}-score`}>Score (0–5, blank = Unknown)<input id={`${prefix}-${dimension}-score`} name={`score.${dimension}`} type="number" min="0" max="5" step="1" placeholder="Unknown" /></label>
          <label htmlFor={`${prefix}-${dimension}-kind`}>Evidence kind<select id={`${prefix}-${dimension}-kind`} name={`kind.${dimension}`} defaultValue="unassessed"><option value="unassessed">No assessment in loaded history</option><option value="market_observation">Market observation</option><option value="operational_fact">Operational fact</option><option value="policy">Policy</option></select></label></div>
        <label htmlFor={`${prefix}-${dimension}-evidence`}>Evidence IDs (comma-separated)<input id={`${prefix}-${dimension}-evidence`} name={`evidence.${dimension}`} type="text" maxLength={4000} placeholder="Evidence IDs from this experiment" /></label>
        <label htmlFor={`${prefix}-${dimension}-rationale`}>Rationale<textarea id={`${prefix}-${dimension}-rationale`} name={`rationale.${dimension}`} required minLength={10} maxLength={600} rows={2} defaultValue="Unknown. No evidence-backed assessment recorded." placeholder="Explain what the cited evidence supports, including uncertainty" /></label>
      </fieldset>)}</div>
      <label className="productCheckbox"><input type="checkbox" name="confirmRights" value="on" /><span>I confirm the original design rights for this assessment. This records my declaration and preserves earlier rights uncertainty in history; it is not independent IP clearance.</span></label>
      <ProductSubmitButton pendingText="Recording assessment…">Record assessment</ProductSubmitButton>
    </form>
  </details>;
}

function ReconsiderCandidate({ candidate }: { candidate: ProductCandidate }) {
  const id = useId();
  return <details className="productDetails"><summary>Reconsider with new evidence</summary><p className="productSubtle">Requires a new completed research artifact from this Business whose source content has not been used for this candidate. New retrieval timestamps alone are not new evidence. This reuses persisted evidence and makes no paid provider call.</p>
    <form action={reconsiderProductCandidate} className="productForm"><input type="hidden" name="candidateId" value={candidate.id} /><label htmlFor={`${id}-basis`}>Completed research artifact ID<input id={`${id}-basis`} name="basisArtifactId" type="text" required maxLength={36} pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" /></label><ProductSubmitButton secondary pendingText="Checking new evidence…">Reconsider from artifact</ProductSubmitButton></form>
  </details>;
}

function ExperimentDetails({ experiment, legacyActionsAllowed }: { experiment: ProductExperiment; legacyActionsAllowed: boolean }) {
  return <div className="productExperimentBody">
    {!isLegacyProductExperiment(experiment) ? <p className="productSubtle">{productExperimentLabel(experiment)}. Preserved read-only in this workspace; legacy assessment, reconciliation, and reconsideration controls do not apply.{experiment.parent_discovery_id ? <> Parent discovery: <code>{experiment.parent_discovery_id}</code>.</> : null}</p> : null}
    <dl className="productMetadata"><div><dt>Experiment</dt><dd><code>{experiment.id}</code></dd></div><div><dt>Created</dt><dd><ProductTime value={experiment.created_at} /></dd></div><div><dt>Research started</dt><dd>{experiment.started_at ? <ProductTime value={experiment.started_at} /> : "Not started"}</dd></div><div><dt>Research completed</dt><dd>{experiment.completed_at ? <ProductTime value={experiment.completed_at} /> : "Not completed"}</dd></div><div><dt>Source artifact</dt><dd><code>{experiment.source_artifact_id ?? "None yet"}</code></dd></div><div><dt>Reconsideration basis</dt><dd><code>{experiment.basis_artifact_id ?? "Initial research"}</code></dd></div><div><dt>Duplicate fingerprint</dt><dd><code>{experiment.fingerprint}</code></dd></div></dl>
    {experiment.failure ? <p className="productFailure" role="status">{experiment.failure}</p> : null}
    {experiment.status === "failed" ? <p className="productSubtle">No automatic retry. This experiment remains in the registry so another click cannot repeat provider work.</p> : null}
    {experiment.workflow_run_id ? <Link className="productTextLink" href={`/dashboard/workflows/${experiment.workflow_run_id}`}>Open research workflow <span aria-hidden="true">↗</span></Link> : <p className="productSubtle">No research workflow is attached.</p>}
    {legacyActionsAllowed && isLegacyProductExperiment(experiment) && experiment.workflow_run_id && experiment.status !== "completed" ? <details className="productDetails"><summary>Reconcile completed research</summary><p className="productSubtle">If the research workflow completed but source persistence failed, try to recover its saved output. Reconciliation makes no new provider call and will not retry a failed research run.</p><form action={reconcileProductDiscovery}><input name="experimentId" type="hidden" value={experiment.id} /><ProductSubmitButton secondary pendingText="Reconciling persisted output…">Reconcile persisted research</ProductSubmitButton></form></details> : null}
    <MeasurementPlanView experiment={experiment} />
    <details className="productDetails"><summary>Hypothesis and experiment variables</summary><p>{experiment.hypothesis}</p><p className="productSubtle">Audience: {experiment.audience}</p><pre className="productVariables">{JSON.stringify(experiment.variables, null, 2)}</pre></details>
  </div>;
}

function CandidateCard({ candidate, experiments, decisions, onView, selected }: { selected?:boolean; candidate: ProductCandidate; experiments: ProductExperiment[]; decisions: ProductDecision[]; onView: (view: ProductView, candidateId: string) => void }) {
  const latestExperiment = experiments[0];
  const latestDecision = decisions[0];
  const assessedExperiment = experiments.find((item) => item.id === latestDecision?.experiment_id);
  const legacyControls = hasOnlyLegacyProductHistory(candidate.id, experiments, decisions);
  return <details className="productCandidate" id={`candidate-${candidate.id}`} open={selected}><summary><strong>{candidate.concept}</strong><span>{latestDecision ? `Latest loaded: ${recordedProductOutcome(latestDecision.assessment)}` : "Assessment unknown outside loaded history"}</span></summary><div>
    <div className="productRow productRow-start"><span className="productEyebrow">Original POD T-shirt</span>{latestDecision ? <OutcomePill outcome={recordedProductOutcome(latestDecision.assessment)} /> : <span className="productTag">No assessment in loaded history</span>}</div>
    <h3>{candidate.concept}</h3><p className="productCandidateAudience">For {candidate.audience}</p><p className="productHypothesis">{candidate.hypothesis}</p>
    <div className="productCandidateFacts"><span>Original design: {candidate.original_design ? "Declared" : "Not confirmed"}</span><span>Rights: {candidate.rights_status === "confirmed" ? "Owner confirmed" : "Unclear"}</span><span>{experiments.length} experiment{experiments.length === 1 ? "" : "s"}</span></div>
    <p className="productSubtle">Sources scoped to {candidate.source_domains.length ? candidate.source_domains.join(", ") : "no domains recorded"}</p>
    <div className="productCandidateActions">{!latestExperiment && legacyControls ? <form action={startProductResearch}><input type="hidden" name="candidateId" value={candidate.id} /><ProductSubmitButton pendingText="Reserving research…">Research candidate</ProductSubmitButton></form> : latestExperiment ? <><ExperimentStatus status={latestExperiment.status} />{latestExperiment.workflow_run_id ? <Link className="coreButton coreButton-secondary" href={`/dashboard/workflows/${latestExperiment.workflow_run_id}`}>View workflow</Link> : null}</> : null}
      <button className="productTextButton" type="button" onClick={() => onView("Registry", candidate.id)}>Experiment history</button>
    </div>
    {!legacyControls ? <p className="productProviderNote">This candidate has versioned history. All records remain available; legacy research and assessment actions are unavailable for this history.</p> : !latestExperiment ? <p className="productProviderNote">Uses the qualified Web Researcher: at most 2 searches and 2 selection calls, with fallback only for recoverable failures. Each call reserves a conservative estimate against a US$1 per-experiment allowance. Estimates are not guaranteed invoice caps. No automatic rerun.</p> : <p className="productProviderNote">The registered experiment is retained. Repeated requests reuse it, including failures; there is no automatic provider retry.</p>}
    {latestDecision ? <details className="productDetails"><summary>Latest loaded decision and assessment</summary><DecisionView decision={latestDecision} experiment={assessedExperiment} /></details> : <p className="productInlineEmpty">No decision in this loaded window. Earlier assessment may exist.</p>}
    {latestExperiment?.evidence_pack ? <div className="productCandidateActions"><button type="button" className="productTextButton" onClick={() => onView("Evidence", candidate.id)}>Read evidence and citations</button><button type="button" className="productTextButton" onClick={() => onView("Decisions", candidate.id)}>Review decision history</button></div> : null}
    {latestExperiment && legacyControls ? <><OwnerAssessment experiment={latestExperiment} /><ReconsiderCandidate candidate={candidate} /></> : null}
    <footer className="productCandidateFooter"><span>Added <ProductTime value={candidate.created_at} /></span><code title={candidate.id}>{candidate.id.slice(0, 8)}</code></footer>
  </div></details>;
}

export function ProductsWorkspace({ data, compact = false, businessId }: { data: ProductWorkspaceData; compact?: boolean; businessId?: string }) {
  const query = useSearchParams(), pathname = usePathname(), router = useRouter();
  const view = VIEWS.find(item=>item===query.get("candidateView")) ?? "Candidates";
  const candidateId = query.get("candidate") ?? "all";
  const navigate = (nextView: ProductView, nextCandidateId = candidateId) => {
    const params = new URLSearchParams(query); params.set("candidateView",nextView);
    if(nextCandidateId==="all")params.delete("candidate");else params.set("candidate",nextCandidateId);
    router.push(`${pathname}?${params}`,{scroll:false});
  };
  const setView = (nextView: ProductView) => navigate(nextView);
  const setCandidateId = (nextCandidateId: string) => navigate(view,nextCandidateId);
  const id = useId();
  const experiments = [...data.experiments].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const decisions = [...data.decisions].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const candidates = data.candidates.filter((candidate) => candidateId === "all" || candidate.id === candidateId);
  const visibleExperiments = experiments.filter((experiment) => candidateId === "all" || experiment.candidate_id === candidateId);
  const visibleDecisions = decisions.filter((decision) => candidateId === "all" || decision.candidate_id === candidateId);
  const discoveryRoots = visibleExperiments.filter(experiment => experiment.candidate_id === null);
  const versionedExperiments = visibleExperiments.filter(experiment => !isLegacyProductExperiment(experiment));
  const candidateById = new Map(data.candidates.map((candidate) => [candidate.id, candidate]));
  const experimentById = new Map(experiments.map((experiment) => [experiment.id, experiment]));
  const counts = { Candidates: candidates.length, Evidence: visibleExperiments.filter((experiment) => experiment.evidence_pack).length, Decisions: visibleDecisions.length, Registry: visibleExperiments.length };
  const viewCandidate = (nextView: ProductView, nextCandidateId: string) => {
    navigate(nextView,nextCandidateId);
    document.getElementById(`${id}-tab-${nextView}`)?.focus();
  };
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === "ArrowRight" ? (index + 1) % VIEWS.length : event.key === "ArrowLeft" ? (index - 1 + VIEWS.length) % VIEWS.length : event.key === "Home" ? 0 : event.key === "End" ? VIEWS.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    setView(VIEWS[next]);
    document.getElementById(`${id}-tab-${VIEWS[next]}`)?.focus();
  };
  return <div className={`productsWorkspace${compact ? " productsWorkspace-compact" : ""}`}>
    {data.errors.length ? <div className="productFailure" role="alert"><strong>Some product records could not be loaded</strong><ul>{data.errors.map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}</ul><p>Refresh to check again. Missing records below do not confirm that no experiment exists.</p></div> : null}
    <div className="productWorkspaceToolbar"><div className="productViews" role="tablist" aria-label="Product discovery views">{VIEWS.map((item, index) => <button id={`${id}-tab-${item}`} aria-controls={`${id}-panel`} aria-selected={view === item} tabIndex={view === item ? 0 : -1} role="tab" className={view === item ? "productView productView-active" : "productView"} key={item} type="button" onClick={() => setView(item)} onKeyDown={(event) => onTabKeyDown(event, index)}>{item}<span>{item === "Evidence" && versionedExperiments.some(experiment => !experiment.evidence_pack) ? `${counts[item]} + linked` : counts[item]}</span></button>)}</div>
      {data.candidates.length > 1 ? <label className="productFilter" htmlFor={`${id}-filter`}><span>Candidate</span><select id={`${id}-filter`} value={candidateId} onChange={(event) => setCandidateId(event.target.value)}><option value="all">All candidates</option>{data.candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.concept}</option>)}</select></label> : null}
    </div>
    {discoveryRoots.length ? <p className="productSubtle">{discoveryRoots.length} discovery root(s) have no candidate assigned. These are preserved research records, not missing experiments. Open Registry for loaded plans, variables, and exact workflow links.</p> : null}
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${view}`} tabIndex={0} className="productViewPanel">
      {view === "Candidates" ? candidates.length ? <div className="productCandidateGrid"><ConsoleRecentRows label="Loaded candidates" rows={candidates.map((candidate) => <CandidateCard key={candidate.id} candidate={candidate} experiments={experiments.filter((experiment) => experiment.candidate_id === candidate.id)} decisions={decisions.filter((decision) => decision.candidate_id === candidate.id)} onView={viewCandidate} selected={candidateId===candidate.id} />)} /></div> : discoveryRoots.length ? <EmptyState title="Candidate selection is not recorded">Discovery records are already present. Their workflow and Registry history remain available before a candidate is selected.</EmptyState> : <EmptyState title={data.errors.length ? "Candidate data unavailable" : "Start with a question worth researching"}>{compact ? "No product candidate was returned in this linked window. Add candidates in Products to preserve hypotheses, evidence, and decisions." : "Add an original T-shirt concept, audience, and testable hypothesis above. Saving a candidate does not start provider research."}</EmptyState> : null}
      {view === "Evidence" ? counts.Evidence ? <div className="productStack"><ConsoleRecentRows label="Loaded evidence packs" rows={visibleExperiments.filter((experiment) => experiment.evidence_pack).map((experiment) => <article className="productPanel" key={experiment.id}><header className="productPanelHeader"><div><span className="productEyebrow">Evidence Pack</span><h3>{(experiment.candidate_id ? candidateById.get(experiment.candidate_id)?.concept : null) ?? productExperimentLabel(experiment)}</h3><p className="productSubtle">Experiment <code>{experiment.id}</code></p></div><ExperimentStatus status={experiment.status} /></header><EvidenceView experiment={experiment} /></article>)} /></div> : versionedExperiments.length ? <EmptyState title="Versioned evidence remains linked to its workflow">This reader displays single-pack legacy evidence only. A zero pack count here does not establish that versioned research has no evidence. Open Registry and the linked workflow for its saved artifacts.</EmptyState> : <EmptyState title="Evidence has not arrived yet">Completed research will appear with source URLs, selected quotes, provenance, and explicit UTC freshness windows.</EmptyState> : null}
      {view === "Decisions" ? visibleDecisions.length ? <div className="productStack"><ConsoleRecentRows label="Loaded decisions" rows={visibleDecisions.map((decision) => <article className="productPanel" key={decision.id}><header className="productPanelHeader"><div><span className="productEyebrow">Preserved decision</span><h3>{candidateById.get(decision.candidate_id)?.concept ?? "Product candidate"}</h3><p className="productSubtle">Experiment <code>{decision.experiment_id}</code></p></div></header><DecisionView decision={decision} experiment={experimentById.get(decision.experiment_id)} /></article>)} /></div> : <EmptyState title="No evidence-backed decision yet">Saved decisions preserve their original assessment format, exact gaps, and evidence references. Legacy unknown scores remain explicit.</EmptyState> : null}
      {view === "Registry" ? visibleExperiments.length ? <div className="productStack"><ConsoleRecentRows label="Loaded experiments" rows={visibleExperiments.map((experiment) => <article className="productPanel" key={experiment.id}><header className="productPanelHeader"><div><span className="productEyebrow">{productExperimentLabel(experiment)}</span><h3>{(experiment.candidate_id ? candidateById.get(experiment.candidate_id)?.concept : null) ?? productExperimentLabel(experiment)}</h3><p className="productSubtle">Audience: {experiment.audience}</p></div><ExperimentStatus status={experiment.status} /></header><ExperimentDetails experiment={experiment} legacyActionsAllowed={hasOnlyLegacyProductHistory(experiment.candidate_id, experiments, decisions)} />{hasOnlyLegacyProductHistory(experiment.candidate_id, experiments, decisions) ? <OwnerAssessment experiment={experiment} /> : null}</article>)} /></div> : <EmptyState title="No registered experiments">Research reserves an experiment before provider work. Duplicate requests reuse it; reconsideration needs genuinely new persisted source content.</EmptyState> : null}
    </div>
    <p className="productAuthorityNote"><CoreIcon name="products" />Original POD T-shirts only. TEST proposes an unstarted future test. No qualified product approval, creative production, publishing, or spending authority is granted.</p>
    {compact ? <Link className="productTextLink" href={`/dashboard/products${businessId ? `?business=${businessId}` : ""}`}>Open full Products workspace <span aria-hidden="true">↗</span></Link> : null}
  </div>;
}
