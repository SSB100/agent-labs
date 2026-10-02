import type { ReactNode } from "react";
import Link from "next/link";
import { ACTIVE_WORKFLOW_STATUSES, TERMINAL_WORKFLOW_STATUSES, workflowExecutionEnded, type WorkflowRunRecord, type BusinessRecord, type WorkflowEventRecord } from "@/lib/core-ui/workflows";
import type {
  ConsoleWorkPage, ConsoleActivityPage,
} from "@/lib/core-ui/console-collections";
import {
  consoleCollectionHref,
  type ConsoleCollectionPage, type ConsoleCollectionSelection,
} from "@/lib/core-ui/console-collections-query";
import { ConsoleCollectionViewport } from "./console-collection-viewport";
import "./console-collection-panes.css";

export type ConsoleCollectionSearch = URLSearchParams | Record<string, string | string[] | undefined>;
type Kind = "work" | "activity";
export type ConsoleCollectionProps = {
  ownerId: string;
  businesses: readonly BusinessRecord[];
  searchParams: ConsoleCollectionSearch;
  /** Read-only exact selected detail, rendered by the server caller. */
  children?: ReactNode;
  headerAction?: ReactNode;
};
type Config = { title: string; noun: string; search: string; order: string; description: string; statuses: readonly string[] };
const config: Record<Kind, Config> = {
  work: { title: "Work", noun: "runs", search: "Search workflow name", order: "Created", description: "Saved workflow runs and their recorded state", statuses: ["all", "active", "running", "queued", "waiting", "review", "needs_owner", "stopped", "completed", "failed", "cancelled"] },
  activity: { title: "Recorded activity", noun: "events", search: "Search event type", order: "Occurred", description: "Underlying audit events; these rows are not work episodes", statuses: ["all"] },
};
const DISPLAY_LIMIT = 25;
function paramsOf(value: ConsoleCollectionSearch): URLSearchParams {
  if (value instanceof URLSearchParams) return new URLSearchParams(value);
  const params = new URLSearchParams();
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") params.append(key, item);
    else if (item) for (const entry of item) params.append(key, entry);
  }
  return params;
}
function collectionScope(kind: Kind, search: ConsoleCollectionSearch): URLSearchParams {
  const params = paramsOf(search);
  params.set("view", kind);
  if (kind === "work" && params.has("run") && (!params.has("selected") || params.get("selected") === params.get("run"))) { params.set("selected", params.get("run")!); params.delete("run"); }
  return params;
}
function identity(value: string): string { return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value; }
function readable(value: string): string { return value.replace(/[._-]+/g, " ").replace(/^./, letter => letter.toUpperCase()); }
function stamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? "Date unavailable" : `${parsed.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
function BusinessIdentity({ id, businesses }: { id: string; businesses: readonly BusinessRecord[] }) {
  return <span className="consoleCollectionBusiness" title={`Business ${id}`}>{businesses.find(item => item.id === id)?.name ?? "Business name unavailable"} <span>· {identity(id)}</span></span>;
}
function RecordIdentity({ label, id }: { label: string; id: string | null }) {
  return <span className="consoleCollectionIdentity" title={id ? `${label} ${id}` : undefined}>{label} {id ? identity(id) : "unavailable"}</span>;
}
export function ConsoleCollectionBadge({ status }: { status: string }) {
  const tone = ["running", "researching", "queued", "reserved"].includes(status) ? "active" : ["open", "needs_owner", "review", "waiting", "unknown"].includes(status) ? "attention" : ["failed", "stopped", "declined", "FAIL"].includes(status) ? "problem" : ["completed", "resolved", "PASS"].includes(status) ? "complete" : "neutral";
  return <span className="consoleCollectionBadge" data-tone={tone}>{readable(status)}</span>;
}

/** Native GET form: works before hydration and keeps selected detail and unrelated URL state. */
export function ConsoleCollectionToolbar({ kind, businesses, searchParams }: Pick<ConsoleCollectionProps, "businesses" | "searchParams"> & { kind: Kind }) {
  const current = collectionScope(kind, searchParams), settings = config[kind], business = current.get("business") ?? "";
  const filterNames = new Set(["business", "q", "status", "sort", "page", "pageSize", ...(kind === "activity" ? ["runFilter"] : [])]);
  const hidden = [...current].filter(([name]) => !filterNames.has(name));
  const sort = current.get("sort") ?? "newest", status = current.get("status") ?? settings.statuses[0];
  const searchLabel = settings.search;
  const orderLabel = settings.order;
  const reset = consoleCollectionHref(current, { q: null, status: settings.statuses[0], sort: "newest", page: null, ...(kind === "activity" ? { runFilter: null } : {}) });
  return <form key={current.toString()} className="consoleCollectionToolbar" method="get" action="/dashboard" aria-label={`${settings.title} filters`}>
    {hidden.map(([name, value], index) => <input type="hidden" name={name} value={value} key={`${name}-${index}`}/>)}
    <input type="hidden" name="pageSize" value={DISPLAY_LIMIT}/>
    <label className="consoleCollectionSearch"><span>{searchLabel}</span><input type="search" name="q" defaultValue={current.get("q") ?? ""} maxLength={120} placeholder={searchLabel} autoComplete="off"/></label>
    <label className="consoleCollectionBusinessFilter"><span>Business</span><select name="business" defaultValue={business}>
      <option value="">All authorized Businesses</option>
      {business && !businesses.some(item => item.id === business) ? <option value={business}>Unavailable Business · {identity(business)}</option> : null}
      {businesses.map(item => <option value={item.id} key={item.id}>[{item.id.slice(-6)}] {item.name}</option>)}
    </select></label>
    {settings.statuses.length > 1 ? <label><span>Status</span><select name="status" defaultValue={status}>{settings.statuses.map(item => <option key={item} value={item}>{item === "all" ? "All states" : item === "active" ? "All active states" : readable(item)}</option>)}</select></label> : <input type="hidden" name="status" value="all"/>}
    <label><span>Sort by</span><select name="sort" defaultValue={sort}>
      <option value="newest">{orderLabel}: newest first</option><option value="oldest">{orderLabel}: oldest first</option>
      {kind === "work" ? <option value="updated">Last updated: newest first</option> : null}
    </select></label>
    {kind === "activity" ? <label><span>Workflow run ID (optional)</span><input name="runFilter" defaultValue={current.get("runFilter") ?? ""} placeholder="Exact run UUID" pattern="[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[1-8][a-fA-F0-9]{3}-[89aAbB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}"/></label> : null}
    <div className="consoleCollectionFilterActions"><button type="submit">Apply</button><Link href={reset}>Reset filters</Link></div>
  </form>;
}

export function consoleCollectionCount(page: ConsoleCollectionPage<unknown>, noun: string): string {
  const loaded = page.items.length;
  if (page.total === null) return `${loaded} ${noun} loaded on page ${page.page} · Total unavailable`;
  if (!loaded) return `0 ${noun} loaded · ${page.total} matching`;
  const first = (page.page - 1) * page.pageSize + 1, last = first + loaded - 1;
  return `${first}–${last} of ${page.total} ${noun} · ${loaded} loaded`;
}
export function ConsoleCollectionPagination({ page, noun, searchParams }: { page: ConsoleCollectionPage<unknown>; noun: string; searchParams: ConsoleCollectionSearch }) {
  const totalPages = page.total === null ? null : Math.max(1, Math.ceil(page.total / page.pageSize));
  const first = totalPages === null ? page.page : Math.max(1, Math.min(page.page - 2, totalPages - 4));
  const numbered = totalPages === null ? [] : Array.from({ length: Math.min(5, totalPages) }, (_, index) => first + index);
  return <footer className="consoleCollectionPagination">
    <p className="consoleCollectionCount" aria-live="polite">{consoleCollectionCount(page, noun)}{!page.complete ? <span> · Page completeness unverified</span> : null}</p>
    <nav aria-label={`${noun} pages`}>
      {page.hasPrevious ? <Link href={consoleCollectionHref(searchParams, { page: page.page - 1 })} rel="prev">Previous</Link> : <span aria-disabled="true">Previous</span>}
      {numbered.map(number => <Link className="consoleCollectionPageNumber" href={consoleCollectionHref(searchParams, { page: number })} aria-current={number === page.page ? "page" : undefined} aria-label={`Page ${number}`} key={number}>{number}</Link>)}
      <span className="consoleCollectionPageLabel">Page {page.page}{totalPages === null ? "" : ` of ${totalPages}`}</span>
      {page.hasNext === true ? <Link href={consoleCollectionHref(searchParams, { page: page.page + 1 })} rel="next">Next</Link> : <span aria-disabled="true">{page.hasNext === null ? "Next unverified" : "Next"}</span>}
    </nav>
  </footer>;
}
function ReadErrors({ errors }: { errors: readonly string[] }) {
  const unique = [...new Set(errors)];
  return unique.length ? <div className="consoleCollectionNotice" role="alert"><strong>Some saved records could not be checked</strong><p>Available rows are shown below. Missing or unverified data is not a confirmed empty result.</p><details><summary>Read details ({unique.length})</summary><ul>{unique.map(error => <li key={error}>{error}</li>)}</ul></details></div> : null;
}
export function ConsoleCollectionEvidence({ title = "Saved context", disclosureKey, children }: { title?: string; disclosureKey?: string; children: ReactNode }) {
  return <details className="consoleCollectionEvidence" data-console-disclosure={disclosureKey ? `row:${disclosureKey}` : undefined}><summary>{title}</summary><div>{children}</div></details>;
}
/** Unknown, missing, and off-page selection are deliberately different states. */
export function ConsoleCollectionDetail({ selection, searchParams, children }: { selection: ConsoleCollectionSelection<unknown>; searchParams: ConsoleCollectionSearch; children?: ReactNode }) {
  if (selection.status === "none") return null;
  return <section id="console-collection-detail" className="consoleCollectionDetail" data-console-selection={selection.status} tabIndex={0} aria-label="Selected record">
    <header><h2>Selected record</h2><Link href={consoleCollectionHref(searchParams, { selected: null, ...(paramsOf(searchParams).get("view") === "work" ? { artifact: null } : {}) })}>Close detail</Link></header>
    {selection.status === "unavailable" ? <p role="alert">This exact record could not be verified. Reload to retry; no replacement record has been selected.</p> : selection.status === "missing" ? <p role="status">This record is not available in the selected Business scope. Your Business filter has been kept.</p> : children ?? <p>This exact record is selected. Detailed evidence has not been supplied for this view.</p>}
  </section>;
}
function Frame<T>({ ownerId, kind, page, selection, businesses, searchParams, children, headerAction, rows, errors }: ConsoleCollectionProps & {
  kind: Kind; page: ConsoleCollectionPage<T>; selection: ConsoleCollectionSelection<unknown>; rows: ReactNode; errors: readonly string[];
}) {
  const settings = config[kind], oversized = page.items.length > DISPLAY_LIMIT || page.pageSize > DISPLAY_LIMIT;
  const failed = !page.complete || page.errors.length > 0 || errors.length > 0;
  return <section className="consoleCollectionPane" data-collection={kind} aria-labelledby={`console-collection-${kind}-heading`}>
    <ConsoleCollectionViewport ownerId={ownerId} scopeHref={consoleCollectionHref(searchParams, {})}/>
    <header className="consoleCollectionHeader"><div><h1 id={`console-collection-${kind}-heading`}>{settings.title}</h1><p>{settings.description}</p></div>{headerAction}</header>
    <ConsoleCollectionToolbar kind={kind} businesses={businesses} searchParams={searchParams}/>
    <div className="consoleCollectionBody" tabIndex={0} role="region" aria-label={`${settings.title} collection`} data-has-selection={selection.status !== "none"}>
      <div className="consoleCollectionResults" tabIndex={0} role="region" aria-label={`${settings.title} result list`}><ReadErrors errors={[...page.errors, ...errors]}/>
        {oversized ? <p className="consoleCollectionNotice" role="alert">This result exceeds the 25-record page limit. Apply the filters to request a bounded page.</p> : page.items.length ? <ul className="consoleCollectionList" aria-label={`${settings.title} results`}>{rows}</ul> : <div className="consoleCollectionEmpty" role="status"><h2>{failed ? "Records unavailable" : page.total && page.page > 1 ? "No records on this page" : "No matching records"}</h2><p>{failed ? "The read did not establish an empty result. Reload or retry with the same Business." : page.total && page.page > 1 ? "The result set may have changed. Return to the first page without losing your filters." : "Try another search or status, or check this Business again after work has been saved."}</p>{page.page > 1 ? <Link href={consoleCollectionHref(searchParams, { page: 1 })}>First page</Link> : null}</div>}
      </div>
      <ConsoleCollectionDetail selection={selection} searchParams={searchParams}>{children}</ConsoleCollectionDetail>
    </div>
    <ConsoleCollectionPagination page={page} noun={settings.noun} searchParams={searchParams}/>
  </section>;
}
function Row({ id, selected, title, href, badges, meta, children, motionTarget }: { motionTarget?: "run"; id: string; selected: boolean; title: string; href: string; badges: ReactNode; meta: ReactNode; children?: ReactNode }) {
  return <li className="consoleCollectionRow" data-record-id={id} data-selected={selected}>
    <div className="consoleCollectionRowTop" data-console-motion-target={motionTarget} data-console-motion-id={motionTarget ? id : undefined}><div className="consoleCollectionRowCopy"><Link className="consoleCollectionRowTitle" href={`${href}#console-collection-detail`} aria-current={selected ? "true" : undefined}>{title}</Link><div className="consoleCollectionMeta">{meta}</div></div><div className="consoleCollectionBadges" data-console-motion-mark={motionTarget ? "true" : undefined}>{badges}</div></div>
    {children}
  </li>;
}
function selectedId(search: ConsoleCollectionSearch): string | null { return paramsOf(search).get("selected"); }

export function ConsoleWorkCollectionPane({ data, ...raw }: ConsoleCollectionProps & { data: ConsoleWorkPage }) {
  const props = { ...raw, searchParams: collectionScope("work", raw.searchParams) };
  const definitions = new Map(data.definitions.map(item => [item.id, item]));
  return <Frame {...props} kind="work" page={data.page} selection={data.selection} errors={data.errors} rows={data.page.items.map(run => {
    const definition = definitions.get(run.workflow_definition_id);
    return <Row key={run.id} motionTarget="run" id={run.id} selected={selectedId(props.searchParams) === run.id} title={definition?.name ?? "Workflow name unavailable"} href={consoleCollectionHref(props.searchParams, { selected: run.id, artifact: null })} badges={<ConsoleWorkState run={run}/>} meta={<><BusinessIdentity id={run.business_id} businesses={props.businesses}/><RecordIdentity label="Run" id={run.id}/><span>{definition ? `Definition v${definition.version}` : "Definition unavailable"}</span><time dateTime={run.updated_at}>Updated {stamp(run.updated_at)}</time></>}>
      <ConsoleCollectionEvidence disclosureKey={run.id}><dl><div><dt>Workflow</dt><dd>{definition?.name ?? "Workflow name unavailable"}</dd></div><div><dt>Business</dt><dd>{props.businesses.find(item => item.id === run.business_id)?.name ?? "Business name unavailable"}</dd></div><div><dt>Run ID</dt><dd>{run.id}</dd></div><div><dt>Business ID</dt><dd>{run.business_id}</dd></div><div><dt>Saved stage</dt><dd>{run.current_stage_key ?? "Unavailable"}</dd></div><div><dt>Created</dt><dd>{run.created_at}</dd></div></dl></ConsoleCollectionEvidence>
    </Row>;
  })}/>;
}
export type ConsoleActivityCollectionData = ConsoleActivityPage;
export function ConsoleActivityCollectionPane({ data, ...raw }: ConsoleCollectionProps & { data: ConsoleActivityCollectionData }) {
  const props = { ...raw, searchParams: collectionScope("activity", raw.searchParams) };
  const event = data.selection.status === "found" ? data.selection.item : null;
  return <Frame {...props} kind="activity" page={data.page} selection={data.selection} errors={data.errors} rows={data.page.items.map(event => <Row key={event.id} id={event.id} selected={selectedId(props.searchParams) === event.id} title={event.event_type} href={consoleCollectionHref(props.searchParams, { selected: event.id })} badges={<span className="consoleCollectionBadge" data-tone="neutral">Recorded</span>} meta={<><BusinessIdentity id={event.business_id} businesses={props.businesses}/><RecordIdentity label="Event" id={event.id}/><RecordIdentity label="Run" id={event.workflow_run_id}/><time dateTime={event.occurred_at}>{stamp(event.occurred_at)}</time></>}><ConsoleCollectionEvidence title="Event context" disclosureKey={event.id}><dl><div><dt>Event type</dt><dd>{event.event_type}</dd></div><div><dt>Business</dt><dd>{props.businesses.find(item => item.id === event.business_id)?.name ?? "Business name unavailable"}</dd></div><div><dt>Event ID</dt><dd>{event.id}</dd></div><div><dt>Business ID</dt><dd>{event.business_id}</dd></div><div><dt>Actor type</dt><dd>{event.actor_type}</dd></div><div><dt>Recorded</dt><dd>{event.created_at}</dd></div></dl></ConsoleCollectionEvidence></Row>)}>{props.children ?? (event ? <ConsoleActivityDetail event={event} verifiedRun={data.runs.some(run => run.id === event.workflow_run_id && run.business_id === event.business_id)}/> : null)}</Frame>;
}

export function ConsoleCollectionLoading({ kind }: { kind: Kind }) {
  return <section className="consoleCollectionPane consoleCollectionLoading" aria-busy="true" aria-label={`Loading ${config[kind].title}`}><h1>{config[kind].title}</h1><p role="status">Loading this saved page and its count…</p><div aria-hidden="true">{[1, 2, 3, 4, 5].map(index => <div className="consoleCollectionSkeleton" key={index}/>)}</div></section>;
}

/** Execution truth is separate from an outstanding owner notice. */
export function ConsoleWorkState({ run }: { run: Pick<WorkflowRunRecord, "status" | "completed_at"> }) {
  const stopped = ACTIVE_WORKFLOW_STATUSES.has(run.status) && workflowExecutionEnded(run);
  const known = ACTIVE_WORKFLOW_STATUSES.has(run.status) || TERMINAL_WORKFLOW_STATUSES.has(run.status);
  return <span title={`Last saved state: ${run.status || "unavailable"}`}><ConsoleCollectionBadge status={stopped ? "stopped" : known ? run.status : "unknown"}/>{!known ? <span className="consoleCollectionSubstate">Saved: {run.status || "unavailable"}</span> : null}</span>;
}
function ConsoleActivityDetail({ event, verifiedRun }: { event: WorkflowEventRecord; verifiedRun: boolean }) {
  const work = verifiedRun && event.workflow_run_id ? `/dashboard?view=work&business=${encodeURIComponent(event.business_id)}&selected=${encodeURIComponent(event.workflow_run_id)}` : null;
  return <article className="consoleWorkDetail" data-audit-event={event.id}><h3>{event.event_type}</h3><p>This is an immutable underlying audit record, not a work episode.</p><details className="consoleWorkSection" data-console-disclosure={`event:${event.id}:identity`}><summary>Event identity and full type</summary><dl className="consoleWorkFacts"><div><dt>Event type</dt><dd>{event.event_type}</dd></div><div><dt>Event ID</dt><dd>{event.id}</dd></div><div><dt>Business ID</dt><dd>{event.business_id}</dd></div><div><dt>Workflow run ID</dt><dd>{event.workflow_run_id ?? "Not linked"}</dd></div><div><dt>Actor type</dt><dd>{event.actor_type}</dd></div><div><dt>Occurred</dt><dd>{event.occurred_at}</dd></div><div><dt>Saved</dt><dd>{event.created_at}</dd></div></dl></details>{work ? <Link href={work}>Inspect exact work</Link> : event.workflow_run_id ? <p>Linked workflow context could not be verified.</p> : null}<details className="consoleWorkSection" data-console-disclosure={`event:${event.id}:payload`}><summary>Exact saved audit payload</summary><pre tabIndex={0} aria-label="Selected audit event payload">{JSON.stringify(event.payload, null, 2)}</pre></details></article>;
}
