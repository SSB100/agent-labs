import { HistoryPager } from "./history-pager";
import Link from "next/link";
import { stageLabel, type BusinessRecord, type OwnerInterventionRecord } from "@/lib/core-ui/workflows";
import type { ConsoleDecisionPage, ConsoleDecisionDetail } from "@/lib/core-ui/console-decisions-data";
import { consoleDecisionHref } from "@/lib/core-ui/console-decisions-query";
import { decisionDetailModel, decisionRunState, decisionWorkflowName, safeDecisionText } from "@/lib/core-ui/console-decisions-view";
import { ConsoleDecisionSubmit, ConsoleDecisionHeading } from "./console-decision-submit";
import { ConsoleDecisionFilters } from "./console-decision-filters";
import "./console-compact-decisions.css";

export type ConsoleDecisionActions = {
  acknowledgeStoppedCreative?: (formData: FormData) => void | Promise<void>;
  syntheticReview?: (formData: FormData) => void | Promise<void>;
  browserControl?: (formData: FormData) => void | Promise<void>;
  simulationReview?: (formData: FormData) => void | Promise<void>;
};
export type ConsoleCompactDecisionsProps = {
  data: ConsoleDecisionPage; businesses: BusinessRecord[]; businessId?: string; actions?: ConsoleDecisionActions;
  /** Pass only server-mapped outcome codes, never untrusted query copy or optimistic success. */
  outcome?: { interventionId: string; tone: "error" | "status"; text: string } | null;
  notice?: { tone: "error" | "status"; text: string } | null;
  connectionRequests?: { page?:import("@/lib/core-ui/history-query").HistoryPage; count: number | null; unavailable: boolean; records?: { businessId: string; runId: string; provider: string }[] };
};
function RequestedTime({ value }: { value: string }) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return <span>Requested time unavailable</span>;
  const label = new Intl.DateTimeFormat("en-GB", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(parsed);
  return <time dateTime={value} title={value}>Requested {label} UTC</time>;
}
function RequestIdentity({ request }: { request: OwnerInterventionRecord }) {
  return <div className="compactDecisionIdentity"><span>Notice {request.id.slice(0, 8)}…{request.id.slice(-6)}</span><span>Run {request.workflow_run_id ? `${request.workflow_run_id.slice(0, 8)}…${request.workflow_run_id.slice(-6)}` : "not recorded"}</span></div>;
}
function ActionFields({ request, returnTo }: { request: OwnerInterventionRecord; returnTo: string }) {
  return <><input type="hidden" name="interventionId" value={request.id}/><input type="hidden" name="businessId" value={request.business_id}/><input type="hidden" name="workflowRunId" value={request.workflow_run_id ?? ""}/><input type="hidden" name="expectedUpdatedAt" value={request.updated_at}/><input type="hidden" name="returnTo" value={returnTo}/></>;
}
function DecisionActions({ request, detail, actions, returnTo }: { request: OwnerInterventionRecord; detail: ConsoleDecisionDetail; actions?: ConsoleDecisionActions; returnTo: string }) {
  const model = decisionDetailModel(request, detail), action = model.action;
  if (model.stoppedCreative) return <div className="compactDecisionActionArea" data-decision-action="stopped-creative-review">
    <p>Mark reviewed acknowledges this stopped-run notice only. It does not retry the work, complete the workflow, approve an output, or reconcile charges.</p>
    {model.acknowledgementEligible && actions?.acknowledgeStoppedCreative ? <form key={`${request.id}:${request.updated_at}:acknowledge`} action={actions.acknowledgeStoppedCreative}><ActionFields request={request} returnTo={returnTo}/><ConsoleDecisionSubmit value="acknowledge" pendingLabel="Recording review…">Mark reviewed</ConsoleDecisionSubmit></form>
      : <p className="compactDecisionMuted">{request.status !== "open" ? model.reviewed ? "Review recorded. The stopped execution and any unknown charges are unchanged." : "This notice is closed. Its saved outcome remains available." : "Mark reviewed is unavailable until this exact stopped run can be safely acknowledged."}</p>}
  </div>;
  if (action.kind === "synthetic_review" && actions?.syntheticReview) return <div className="compactDecisionActionArea"><p>This typed decision resumes the saved synthetic review.</p><form key={`${request.id}:${request.updated_at}:synthetic`} action={actions.syntheticReview}><ActionFields request={request} returnTo={returnTo}/><ConsoleDecisionSubmit value="approve">Approve and complete demo</ConsoleDecisionSubmit><ConsoleDecisionSubmit value="fail" danger>Fail demo workflow</ConsoleDecisionSubmit></form></div>;
  if (action.kind === "browser_control" && actions?.browserControl) return <div className="compactDecisionActionArea"><form key={`${request.id}:${request.updated_at}:browser`} action={actions.browserControl}><ActionFields request={request} returnTo={returnTo}/><ConsoleDecisionSubmit value={action.decision}>{action.decision === "take_control" ? "Take control" : "Return control"}</ConsoleDecisionSubmit></form></div>;
  if (action.kind === "simulation_review" && actions?.simulationReview) return <div className="compactDecisionActionArea"><form key={`${request.id}:${request.updated_at}:simulation`} action={actions.simulationReview}><ActionFields request={request} returnTo={returnTo}/><ConsoleDecisionSubmit value="acknowledge">Acknowledge simulated result</ConsoleDecisionSubmit><ConsoleDecisionSubmit value="stop" danger>Stop simulation</ConsoleDecisionSubmit></form></div>;
  return <div className="compactDecisionActionArea"><p>{action.kind === "link" && action.section !== "details" ? "The existing external result needs its typed verification flow. Inspect the saved record before taking any further action." : action.kind !== "link" ? "This compact view is inspect-only for this typed request. Its decision flow is not connected here; viewing does not change it." : "Viewing this notice does not clear it or authorize another attempt."}</p></div>;
}
function Detail({ request, data, businesses, actions, outcome }: { request: OwnerInterventionRecord; data: ConsoleDecisionPage; businesses: BusinessRecord[]; actions?: ConsoleDecisionActions; outcome?: ConsoleCompactDecisionsProps["outcome"] }) {
  const detail = data.detail;
  if (!detail || detail.interventionId !== request.id) return <p role="alert">The selected notice details could not be checked.</p>;
  const model = decisionDetailModel(request, detail), business = businesses.find(row => row.id === request.business_id);
  const returnTo = consoleDecisionHref(data.query, { selectedId: request.id });
  const workHref = detail.run ? `/dashboard?view=work&business=${encodeURIComponent(request.business_id)}&run=${encodeURIComponent(detail.run.id)}` : null;
  const relevantOutcome = outcome?.interventionId === request.id && (outcome.tone === "error" || model.reviewed) ? outcome : null;
  return <article className="compactDecisionDetail" aria-label="Selected decision" data-decision-id={request.id}>
    <header className="compactDecisionDetailHeader"><div><span className="compactDecisionState">{model.reviewed ? "Stopped · reviewed" : `${model.state} · ${request.status === "open" ? "Notice open" : "Notice closed"}`}</span><ConsoleDecisionHeading noticeId={request.id} revision={request.updated_at}>{safeDecisionText(request.title, "Saved decision", 250)}</ConsoleDecisionHeading></div><Link className="compactDecisionLink" href={consoleDecisionHref(data.query, { selectedId: null })} aria-label="Close decision details">Close</Link></header>
    {relevantOutcome ? <p className={relevantOutcome.tone === "error" ? "compactDecisionWarning" : "compactDecisionNotice"} role={relevantOutcome.tone === "error" ? "alert" : "status"} data-decision-outcome={relevantOutcome.tone}>{relevantOutcome.text}</p> : null}
    <div className="compactDecisionDetailScroll" tabIndex={0} role="region" aria-label="Decision evidence and receipts">
      <section className="compactDecisionReason"><h3>{model.stoppedCreative ? "Why it stopped" : "Saved request"}</h3><dl className="compactDecisionStage"><div><dt>{model.ended ? "Ended at stage" : "Saved stage"}</dt><dd>{model.stage}</dd></div></dl><p>{model.reason}</p>{model.stoppedCreative ? <p className="compactDecisionMuted">This execution has ended. It is not actively waiting for an agent, and no usable design or review PASS is implied.</p> : null}</section>
      <section className="compactDecisionCosts"><h3>{model.spending?.label ?? "Provider charges"}</h3><strong data-decision-cost>{model.spending?.value ?? "Unavailable"}</strong><p>{model.spending?.detail ?? "Cost history could not be checked. Missing data does not prove zero spend."}</p>
        {model.spending?.exactAmounts.length ? <details><summary>Recorded charge details</summary><dl>{model.spending.exactAmounts.map((amount, index) => <div key={`${amount.label}:${index}`}><dt>{amount.label}</dt><dd>{amount.value}</dd></div>)}</dl></details> : null}
      </section>
      <details className="compactDecisionContext"><summary>Concept, workflow and exact saved identities</summary>
        <dl className="compactDecisionFacts"><div><dt>Concept</dt><dd>{model.concept}</dd></div><div><dt>Workflow</dt><dd>{model.workflowName}</dd></div><div><dt>Business</dt><dd>{safeDecisionText(business?.name, "Business unavailable", Number.MAX_SAFE_INTEGER)}</dd></div></dl>
        <div className="compactDecisionIdentifiers"><dl><div><dt>Notice</dt><dd>{request.id}</dd></div><div><dt>Workflow run</dt><dd>{request.workflow_run_id ?? "Not recorded"}</dd></div><div><dt>Source version</dt><dd>{request.updated_at}</dd></div><div><dt>Requested</dt><dd>{request.requested_at}</dd></div>{detail.run?.completed_at ? <div><dt>Execution ended</dt><dd>{detail.run.completed_at}</dd></div> : null}</dl></div>
      </details>
      <section className="compactDecisionEvidence"><h3>Retained evidence</h3>{detail.evidence.status === "ready" ? detail.evidence.records.length ? <ul>{detail.evidence.records.map(item => <li key={item.id}><span>{safeDecisionText(item.name, "Saved output", 200)}</span><small>{safeDecisionText(item.artifact_type, "Output", 100)}</small>{workHref ? <Link href={`${workHref}&artifact=${encodeURIComponent(item.id)}#artifact-${encodeURIComponent(item.id)}`} className="compactDecisionLink" aria-label={`Inspect saved output ${safeDecisionText(item.name, "output", 100)}`}>Inspect</Link> : null}</li>)}</ul> : <p>No saved output artifacts were found for this exact run.</p> : <p role="status">Saved outputs could not be checked. They may still exist.</p>}
        {detail.retainedSources.status === "ready" && detail.retainedSources.records.length ? <p>{detail.retainedSources.records.length} unvalidated provider source{detail.retainedSources.records.length === 1 ? "" : "s"} retained after failure. A retained source is not an accepted design.</p> : model.stoppedCreative && detail.retainedSources.status !== "ready" ? <p>Retained provider sources could not be checked.</p> : null}
      </section>
      {workHref ? <Link className="compactDecisionLink" href={workHref}>View saved workflow in Work</Link> : null}
    </div>
    <DecisionActions request={request} detail={detail} actions={actions} returnTo={returnTo}/>
  </article>;
}
export function ConsoleCompactDecisions({ data, businesses, businessId, actions, outcome, notice, connectionRequests }: ConsoleCompactDecisionsProps) {
  const { page, query, selection } = data;
  const chosenBusiness = businessId ?? query.businessId ?? undefined;
  const duplicateBusinessNames = new Set(businesses.filter((row, index) => businesses.some((other, otherIndex) => index !== otherIndex && other.name.trim().toLowerCase() === row.name.trim().toLowerCase())).map(row => row.name.trim().toLowerCase()));
  const start = page.items.length ? query.offset + 1 : 0, end = query.offset + page.items.length;
  return <section className="compactDecisions" aria-label="Decisions workspace">
    <header className="compactDecisionsHeader"><div><h1>Decisions</h1><p>Saved requests, stopped runs and receipts</p></div><span role="status" data-decision-count>{page.total === null ? "Count unavailable" : `${page.total} ${query.status === "open" ? "open " : ""}notice${page.total === 1 ? "" : "s"}`}</span></header>
    <ConsoleDecisionFilters key={`${query.businessId ?? "all"}:${query.status}`} query={query}><input type="hidden" name="view" value="decisions"/>{businesses.length > 1 ? <label>Business<select name="business" defaultValue={chosenBusiness ?? ""}><option value="">All owned Businesses</option>{businesses.map(row => <option key={row.id} value={row.id}>{duplicateBusinessNames.has(row.name.trim().toLowerCase()) ? `[${row.id.slice(-6)}] ${row.name}` : row.name}</option>)}</select></label> : chosenBusiness ? <input type="hidden" name="business" value={chosenBusiness}/> : null}<label>Status<select name="status" defaultValue={query.status}><option value="open">Open notices</option><option value="all">All saved notices</option><option value="resolved">Resolved notices</option><option value="declined">Declined notices</option><option value="cancelled">Cancelled notices</option></select></label><button type="submit" className="compactDecisionButton">Apply</button>{connectionRequests ? <Link className="compactDecisionLink" href={`/dashboard?view=connections${chosenBusiness ? `&business=${encodeURIComponent(chosenBusiness)}` : ""}`}>Connection requests {connectionRequests.unavailable || connectionRequests.count === null ? "· unavailable" : `· ${connectionRequests.count}`}</Link> : null}</ConsoleDecisionFilters>
    {notice ? <p className={notice.tone === "error" ? "compactDecisionWarning" : "compactDecisionNotice"} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</p> : null}
    {connectionRequests?.unavailable ? <p className="compactDecisionWarning" role="alert">Connection requests could not be checked. Existing approvals or secure owner steps may still need attention.</p> : null}
    {connectionRequests?.page || connectionRequests?.records?.length ? <details className="compactConnectionRequests"><summary>Saved connection requests · {connectionRequests.count ?? "Unknown"}</summary><HistoryPager page={connectionRequests.page} name="accountOpen" label="Open account requests"/><div>{(connectionRequests.records??[]).map(request => <Link className="compactDecisionLink" key={request.runId} href={`/dashboard?view=connections&business=${encodeURIComponent(request.businessId)}&connectionRun=${encodeURIComponent(request.runId)}&provider=${encodeURIComponent(request.provider)}`}>{request.provider} · {request.runId.slice(-6)} · Review saved setup request</Link>)}</div></details> : null}
    {data.errors.length ? <p className="compactDecisionWarning" role="alert">{data.errors.join(" ")}</p> : null}
    <div className="compactDecisionSplit" data-has-selection={selection.status === "found" ? "true" : "false"}>
      <div className="compactDecisionQueue"><div key={`${query.businessId ?? "all"}:${query.status}:${query.page}`} className="compactDecisionRows" role="region" aria-label="Saved decision queue" tabIndex={0}>
        {page.items.map(request => { const run = data.runs.find(row => row.id === request.workflow_run_id && row.business_id === request.business_id); return <article className="compactDecisionRow" key={request.id} data-selected={selection.status === "found" && selection.item.id === request.id ? "true" : "false"} data-console-motion-target="decision" data-console-motion-id={request.id}>
          <div><strong title={safeDecisionText(request.title, "Saved decision", 250)}>{safeDecisionText(request.title, "Saved decision", 250)}</strong><span title={decisionWorkflowName(run, data.definitions)}>{decisionWorkflowName(run, data.definitions)}</span><div className="compactDecisionRowContext"><span>{run ? stageLabel(run.current_stage_key, "Stage not recorded") : "Stage unavailable"}</span><RequestedTime value={request.requested_at}/></div><RequestIdentity request={request}/></div><div className="compactDecisionRowAction"><small>{decisionRunState(request, run)}</small><Link className="compactDecisionLink" aria-current={selection.status === "found" && selection.item.id === request.id ? "true" : undefined} href={consoleDecisionHref(query, { selectedId: request.id })} aria-label={`View details for ${safeDecisionText(request.title, "notice", 100)}, notice ${request.id.slice(-6)}`}>View details</Link></div>
        </article>; })}
        {!page.items.length ? <p className="compactDecisionEmpty">{page.complete ? page.total === 0 ? "No matching notices are recorded." : "No notices on this page. Choose Previous to return to the queue." : "The saved queue could not be checked. No empty-queue claim can be made."}</p> : null}
      </div><nav className="compactDecisionPagination" aria-label="Decision pages">{page.hasPrevious ? <Link className="compactDecisionLink" href={consoleDecisionHref(query, { page: query.page - 1 })}>Previous</Link> : <span>Previous</span>}<span>Page {query.page} · {start}–{end}{page.total !== null ? ` of ${page.total}` : " · total unknown"}</span>{page.hasNext === true ? <Link className="compactDecisionLink" href={consoleDecisionHref(query, { page: query.page + 1 })}>Next</Link> : <span>{page.hasNext === null ? "Next unverified" : "Next"}</span>}</nav></div>
      <div className="compactDecisionSelection">{selection.status === "found" ? <Detail key={selection.item.id} request={selection.item} data={data} businesses={businesses} actions={actions} outcome={outcome}/> : <div className="compactDecisionEmpty"><h2>{selection.status === "missing" ? "Notice not found in this Business" : selection.status === "unavailable" ? "Notice unavailable" : "Choose a notice"}</h2><p>{selection.status === "none" ? "View details to inspect the exact workflow, why it stopped, its retained evidence and known charges. Viewing does not clear a notice." : "The selected record could not be verified in this scope. Its absence does not authorize any action."}</p></div>}</div>
    </div>
  </section>;
}
