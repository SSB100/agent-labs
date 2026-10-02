import Link from "next/link";
import { useId, type ReactNode } from "react";

import { CoreIcon, type CoreIconName } from "@/components/stage7/icons";
import type { OwnerUiContext, WorkflowCollection } from "@/lib/core-ui/data";
import {
  ACTIVE_WORKFLOW_STATUSES, currentWorkerSummary, eventLabel, interventionAction,
  stageLabel, statusLabel, workflowExecutionEnded, workflowTimelineStages,
  type OwnerInterventionRecord,
} from "@/lib/core-ui/workflows";

import "./console-overview.css";

export type ConsoleCosts = {
  status: "ready";
  recordedMicrousd: number | null;
  allowanceMicrousd?: number | null;
  reservedMicrousd?: number | null;
  uncertainCount?: number;
  scopeLabel: string;
  workflowRunId?: string;
} | { status: "unavailable" | "not_loaded"; reason?: string };

export type ConsoleConnection = {
  id: string;
  name: string;
  state: "verified" | "configured" | "needs_attention" | "not_connected" | "unknown";
  detail?: string;
  verifiedAt?: string | null;
};
export type ConsoleConnections = {
  status: "ready";
  items: ConsoleConnection[];
} | { status: "unavailable" | "not_loaded"; reason?: string };

export type ConsoleOutputPreview = { artifactId: string; signedUrl: string; alt: string };
export type ConsoleOverviewContext = Pick<OwnerUiContext,
  "displayName" | "businesses" | "needsYouCount" | "needsYouUnavailable" | "businessesUnavailable">;
export type ConsoleOverviewProps = {
  context: ConsoleOverviewContext;
  collection: WorkflowCollection;
  costs?: ConsoleCosts;
  connections?: ConsoleConnections;
  outputPreviews?: ConsoleOutputPreview[];
  researchHref?: string;
};

const rootLink = (view: "work" | "library" | "decisions" | "connections" | "activity") => `/dashboard?view=${view}`;
const runLink = (id: string) => `${rootLink("work")}&run=${encodeURIComponent(id)}`;
const newestFirst = <T extends { updated_at: string }>(items: readonly T[]) => [...items].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
const validAmount = (value: number | null | undefined): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: value > 0 && value < 10_000 ? 4 : 2 }).format(value / 1_000_000);

function RecordedTime({ value }: { value: string | null | undefined }) {
  if (!value || !Number.isFinite(Date.parse(value))) return <span>Time unavailable</span>;
  return <time dateTime={value} title={value}>{new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(value))} UTC</time>;
}

/** Activity is established by the exact run, task, stage and worker receipts. */
export function deriveConsoleOverview(context: ConsoleOverviewContext, collection: WorkflowCollection, researchHref = "/dashboard?view=overview&sheet=research") {
  const unavailable = collection.errors.length > 0 || context.businessesUnavailable === true;
  const runs = newestFirst(collection.runs);
  const runById = new Map(runs.map(run => [run.id, run]));
  const definitions = new Map(collection.definitions.map(definition => [definition.id, definition]));
  const workerDefinitions = new Map(collection.workerDefinitions.map(definition => [definition.id, definition]));
  const receipts = newestFirst(collection.workerRuns).flatMap(worker => {
    const run = runById.get(worker.workflow_run_id);
    if (!run || run.business_id !== worker.business_id) return [];
    const task = collection.tasks.find(task => task.id === worker.task_contract_id && task.workflow_run_id === run.id && task.business_id === run.business_id && task.worker_definition_id === worker.worker_definition_id);
    if (!task) return [];
    const definition = workerDefinitions.get(worker.worker_definition_id);
    const summary = currentWorkerSummary(run, task, worker, definition, collection.stages);
    return [{ worker, run, task, summary, name: definition?.name ?? "Recorded worker" }];
  });
  const activeWorkers = receipts.filter(receipt => receipt.summary.active);
  const activeRuns = runs.filter(run => ACTIVE_WORKFLOW_STATUSES.has(run.status) && !workflowExecutionEnded(run));
  const decisions = [...collection.interventions].filter(intervention => intervention.status === "open" && (!intervention.workflow_run_id || runById.get(intervention.workflow_run_id)?.business_id === intervention.business_id))
    .sort((a, b) => a.requested_at.localeCompare(b.requested_at));
  const firstDecision = decisions[0];
  const decisionRun = firstDecision?.workflow_run_id ? runById.get(firstDecision.workflow_run_id) : undefined;
  const action = firstDecision ? interventionAction(firstDecision, decisionRun, decisionRun ? definitions.get(decisionRun.workflow_definition_id) : undefined) : null;
  const actionLabel = firstDecision?.intervention_type === "creative_review" ? "Review image issue"
    : action?.kind === "link" && action.section !== "details" ? action.label : "Review next decision";
  const next = firstDecision
    ? { href: rootLink("decisions"), label: actionLabel, detail: firstDecision.title, kind: "decision" }
    : context.needsYouUnavailable || context.needsYouCount > 0
      ? { href: rootLink("decisions"), label: "Review decisions", detail: context.needsYouUnavailable ? "Your decision queue needs a fresh check" : `${context.needsYouCount} open ${context.needsYouCount === 1 ? "decision needs" : "decisions need"} your attention`, kind: "decision" }
      : unavailable
        ? { href: rootLink("work"), label: "Check work status", detail: "Some workflow records could not be confirmed", kind: "unavailable" }
        : activeRuns[0]
          ? { href: runLink(activeRuns[0].id), label: "Open current work", detail: definitions.get(activeRuns[0].workflow_definition_id)?.name ?? "Review the current workflow", kind: "work" }
          : { href: researchHref, label: "Plan a research goal", detail: "Set a goal, scope and allowance before starting", kind: "research" };
  const currentRun = decisionRun ?? activeRuns[0] ?? runs[0];
  const decisionCount = context.needsYouUnavailable ? null : context.needsYouCount;
  return { unavailable, runs, runById, definitions, receipts, activeWorkers, activeRuns, decisions, decisionCount, currentRun, next };
}

function Panel({ name, title, children, href, action, className = "" }: {
  name: string; title: string; children: ReactNode; href?: string; action?: string; className?: string;
}) {
  return <section className={`consolePanel ${className}`} data-console-panel={name} aria-labelledby={`console-${name}-title`}>
    <header className="consolePanelHeader"><h2 id={`console-${name}-title`}>{title}</h2>{href ? <Link href={href} aria-label={`${action ?? "Open"} ${title.toLowerCase()}`}>{action ?? "View all"}<span aria-hidden="true"> ›</span></Link> : null}</header>
    {children}
  </section>;
}

function Empty({ title, detail, icon = "activity" }: { title: string; detail: string; icon?: CoreIconName }) {
  return <div className="consoleEmpty"><CoreIcon name={icon} /><strong>{title}</strong><p>{detail}</p></div>;
}

function StatusItem({ icon, label, value, tone = "neutral", href }: { icon: CoreIconName; label: string; value: string; tone?: string; href: string }) {
  return <Link className="consoleStatusItem" href={href} data-tone={tone}><span className="consoleIconBox"><CoreIcon name={icon} /></span><span><span className="consoleStatusLabel">{label}</span><strong>{value}</strong></span><span className="consoleItemArrow" aria-hidden="true">›</span></Link>;
}

function CoreOrb({ working }: { working: boolean }) {
  const id = useId().replaceAll(":", "");
  const points = Array.from({ length: 12 }, (_, index) => {
    const angle = (index / 12) * Math.PI * 2;
    return { x: 300 + Math.cos(angle) * 105, y: 157 + Math.sin(angle) * 105 };
  });
  return <svg className="consoleCoreOrb" viewBox="0 0 600 300" fill="none" aria-hidden="true" focusable="false" data-motion={working ? "working" : "idle"}>
    <defs>
      <radialGradient id={`${id}-glow`}><stop stopColor="#06c7e5" stopOpacity=".23"/><stop offset=".72" stopColor="#087fa8" stopOpacity=".04"/><stop offset="1" stopColor="#001222" stopOpacity="0"/></radialGradient>
      <radialGradient id={`${id}-sphere`} cx=".35" cy=".25"><stop stopColor="#2cdbed" stopOpacity=".10"/><stop offset="1" stopColor="#05738b" stopOpacity=".025"/></radialGradient>
      <linearGradient id={`${id}-orbit`}><stop stopColor="#14cbe7" stopOpacity="0"/><stop offset=".4" stopColor="#81edff" stopOpacity=".5"/><stop offset="1" stopColor="#14cbe7" stopOpacity=".1"/></linearGradient>
      <filter id={`${id}-light`}><feGaussianBlur stdDeviation="3"/></filter>
    </defs>
    <ellipse cx="300" cy="157" rx="268" ry="140" fill={`url(#${id}-glow)`}/>
    <g className="consoleOrbOrbits" stroke={`url(#${id}-orbit)`} strokeWidth=".6">
      <ellipse cx="300" cy="157" rx="270" ry="95" strokeDasharray="2 8"/>
      <ellipse cx="300" cy="157" rx="226" ry="50" transform="rotate(-16 300 157)"/>
      <ellipse cx="300" cy="157" rx="208" ry="55" transform="rotate(17 300 157)"/>
      <ellipse cx="300" cy="157" rx="258" ry="35"/>
    </g>
    <g stroke="#42c2db" strokeWidth=".65">
      <circle cx="300" cy="157" r="106" fill={`url(#${id}-sphere)`} strokeOpacity=".55"/>
      <circle cx="300" cy="157" r="111" strokeOpacity=".13" strokeDasharray="2 6"/>
      {[23, 49, 77, 97].map(radius => <ellipse key={radius} cx="300" cy="157" rx={radius} ry="106" strokeOpacity=".22"/>) }
      {[-76, -44, 0, 44, 76].map(offset => <ellipse key={offset} cx="300" cy={157 + offset} rx={Math.sqrt(106 ** 2 - offset ** 2)} ry={17 + (1 - Math.abs(offset) / 106) * 11} strokeOpacity=".2"/>) }
      <g strokeOpacity=".11">{points.map((point, index) => <path key={index} d={`M${point.x} ${point.y} L${points[(index + 4) % 12].x} ${points[(index + 4) % 12].y} L${points[(index + 7) % 12].x} ${points[(index + 7) % 12].y}`}/>)}</g>
    </g>
    <g stroke="#2bbed8" strokeWidth=".6" strokeOpacity=".28">{[45, 65, 85, 106, 130].map(radius => <ellipse key={radius} cx="300" cy="270" rx={radius} ry={radius / 10}/>)}</g>
    {[[73, 157], [513, 157], [209, 100], [383, 79], [270, 256]].map(([x, y], index) => <g key={index}><circle cx={x} cy={y} r="5" fill="#71e7f9" opacity=".5" filter={`url(#${id}-light)`}/><circle cx={x} cy={y} r="1.8" fill="#a2f3ff"/></g>)}
  </svg>;
}

function DecisionRow({ intervention }: { intervention: OwnerInterventionRecord }) {
  return <Link href={rootLink("decisions")} className="consoleDecision" data-intervention-id={intervention.id}><span className="consoleIconBox" data-tone="attention"><CoreIcon name="needs-you"/></span><span><strong title={intervention.title}>{intervention.title}</strong><small>{stageLabel(intervention.intervention_type)} · needs you</small></span><span aria-hidden="true">›</span></Link>;
}

function CostPanel({ costs }: { costs: ConsoleCosts }) {
  const ready = costs.status === "ready";
  const recorded = ready && validAmount(costs.recordedMicrousd) ? costs.recordedMicrousd : null;
  const allowance = ready && validAmount(costs.allowanceMicrousd) ? costs.allowanceMicrousd : null;
  const reserved = ready && validAmount(costs.reservedMicrousd) ? costs.reservedMicrousd : null;
  return <Panel name="costs" title="Costs & allowance" href={ready && costs.workflowRunId ? runLink(costs.workflowRunId) : rootLink("work")} action="Receipts">
    {ready ? <div className="consolePanelScroll consoleCostBody"><div className="consoleCostScope" title={costs.scopeLabel}>{costs.scopeLabel}</div><dl className="consoleCostNumbers"><div><dt>{costs.uncertainCount && costs.uncertainCount > 0 ? "Known reported charges" : "Recorded charges"}</dt><dd data-cost="recorded">{recorded === null ? "Not reported" : money(recorded)}</dd></div>{allowance !== null ? <div><dt>Approved allowance</dt><dd data-cost="allowance">{money(allowance)}</dd></div> : null}{reserved !== null ? <div><dt>Reserved</dt><dd data-cost="reserved">{money(reserved)}</dd></div> : null}</dl><p className="consoleFootnote">{costs.uncertainCount && costs.uncertainCount > 0 ? `${costs.uncertainCount} charge${costs.uncertainCount === 1 ? " is" : "s are"} still unconfirmed. ` : ""}Owner allowance is not a guaranteed provider invoice cap.</p></div>
      : <Empty icon="metrics" title={costs.status === "unavailable" ? "Cost records unavailable" : "No cost summary loaded"} detail={costs.reason ?? "Open a workflow for its recorded receipts and approved allowance."}/>}
  </Panel>;
}

function connectionLabel(connection: ConsoleConnection) {
  // A configured integration is never represented as a successful live check.
  if (connection.state === "verified" && connection.verifiedAt && Number.isFinite(Date.parse(connection.verifiedAt))) return "Verified on record";
  if (connection.state === "configured") return "Configured · not checked";
  if (connection.state === "needs_attention") return "Needs attention";
  if (connection.state === "not_connected") return "Not connected";
  return "Status not confirmed";
}

function ConnectionPanel({ connections }: { connections: ConsoleConnections }) {
  return <Panel name="connections" title="Connections" href={rootLink("connections")} action="Manage">
    {connections.status === "ready" ? <p className="consoleConnectionNote">Saved account records · not a live health check</p> : null}
    {connections.status === "ready" && connections.items.length ? <div className="consoleConnectionGrid consolePanelScroll">{connections.items.map(connection => <Link href={rootLink("connections")} className="consoleConnection" data-connection-id={connection.id} data-connection-state={connectionLabel(connection) === "Verified on record" ? "verified" : connection.state === "verified" ? "unknown" : connection.state} key={connection.id}><span className="consoleConnectionGlyph" aria-hidden="true">{connection.name.slice(0, 2).toUpperCase()}</span><span><strong>{connection.name}</strong><small>{connectionLabel(connection)}</small>{connection.detail ? <span className="consoleConnectionDetail" title={connection.detail}>{connection.detail}</span> : null}{connectionLabel(connection) === "Verified on record" ? <span className="consoleConnectionDetail"><RecordedTime value={connection.verifiedAt}/></span> : null}</span></Link>)}</div>
      : <Empty icon="accounts" title={connections.status === "ready" ? "No connections recorded" : connections.status === "unavailable" ? "Connection records unavailable" : "Connections not checked"} detail={connections.status === "ready" ? "Open Connections to review the available account setup." : connections.reason ?? "No verified account check is available in this view."}/>}
  </Panel>;
}

export function ConsoleOverview({ context, collection, costs = { status: "not_loaded" }, connections = { status: "not_loaded" }, outputPreviews = [], researchHref }: ConsoleOverviewProps) {
  const data = deriveConsoleOverview(context, collection, researchHref);
  const { unavailable, activeWorkers, receipts, decisions, decisionCount, currentRun, next } = data;
  const events = [...collection.events].filter(event => !event.workflow_run_id || data.runById.get(event.workflow_run_id)?.business_id === event.business_id).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const currentDefinition = currentRun ? data.definitions.get(currentRun.workflow_definition_id) : undefined;
  const stages = currentRun ? workflowTimelineStages(currentDefinition, currentRun, collection.stages) : [];
  const outputs = newestFirst(collection.artifacts);
  const previews = new Map(outputPreviews.filter(preview => /^https:\/\//i.test(preview.signedUrl)).map(preview => [preview.artifactId, preview]));
  const waiting = decisionCount === null ? "?" : String(decisionCount);
  const unconfirmedWorker = !unavailable && !activeWorkers.length && data.activeRuns.some(run => run.status === "running");
  const working = unavailable || unconfirmedWorker ? "?" : String(activeWorkers.length);
  const coreState = unavailable ? "Status unavailable" : unconfirmedWorker ? "Run active · worker unconfirmed" : activeWorkers.length ? "Work in progress" : "Idle · no worker running";
  const businessLabel = context.businessesUnavailable ? "Unavailable" : context.businesses.length === 1 ? context.businesses[0].name : context.businesses.length ? `${context.businesses.length} workspaces` : "No workspace yet";
  return <div className="consoleOverview" data-console-overview="true" data-work-state={unavailable ? "unknown" : unconfirmedWorker ? "unconfirmed" : activeWorkers.length ? "working" : "idle"}>
    <div className="consoleOverviewRow consoleOverviewTop">
      <Panel name="status" title="Core overview">
        <div className="consoleStatusStack consolePanelScroll">
          <StatusItem icon="activity" label="Worker state" value={unavailable || unconfirmedWorker ? "Unconfirmed" : activeWorkers.length ? `${activeWorkers.length} working` : "Idle"} tone={unavailable ? "attention" : activeWorkers.length ? "live" : "neutral"} href={rootLink("work")}/>
          <StatusItem icon="needs-you" label="Decisions" value={decisionCount === null ? "Unavailable" : `${decisionCount} waiting`} tone={decisionCount === null || decisionCount > 0 ? "attention" : "neutral"} href={rootLink("decisions")}/>
          <StatusItem icon="workflow" label="Loaded work" value={unavailable ? "Partial records" : `${data.runs.length} workflows`} href={rootLink("work")}/>
          <StatusItem icon="artifacts" label="Saved outputs" value={unavailable ? "Partial records" : `${outputs.length} recorded`} href={rootLink("library")}/>
          <StatusItem icon="building" label="Workspace" value={businessLabel} href={rootLink("work")}/>
        </div>
      </Panel>
      <section className="consolePanel consoleCore" data-console-panel="core" aria-label="Agent Labs workspace core">
        <div className="consoleCoreTopline"><span><span className="consoleStateDot" data-active={!unavailable && activeWorkers.length > 0}/>{coreState}</span><span>Owner control</span></div>
        <div className="consoleCoreVisual"><CoreOrb working={!unavailable && activeWorkers.length > 0}/><div className="consoleCoreIdentity"><span className="consoleCoreOverline">Private command centre</span><h1>AGENT LABS</h1><p><strong>{working}</strong> working<span aria-hidden="true"> / </span><strong>{waiting}</strong> waiting</p><span className="consoleCoreCaption">{decisionCount === null ? "Decision count unavailable" : decisionCount > 0 ? "Waiting for owner decisions" : data.activeRuns.length ? "Saved work is active or waiting" : "Ready for a bounded research goal"}</span></div></div>
        <div className="consoleNextAction" data-next-action={next.kind}><div><span>Recommended next step</span><strong title={next.detail}>{next.detail}</strong></div><Link className="consolePrimaryAction" href={next.href}>{next.label}<span aria-hidden="true"> ›</span></Link></div>
      </section>
      <Panel name="feed" title="Decisions & activity" href={rootLink("activity")} action="Activity">
        <div className="consoleFeed consolePanelScroll">
          {unavailable ? <p className="consoleInlineWarning" role="status">Some saved records could not be loaded</p> : null}
          {decisions.slice(0, 3).map(intervention => <DecisionRow key={intervention.id} intervention={intervention}/>)}
          {!decisions.length && (decisionCount === null || decisionCount > 0) ? <Link className="consoleDecisionQueue" href={rootLink("decisions")}>{decisionCount === null ? "Decision count unavailable" : `${decisionCount} decisions waiting`}<span>Open the decision queue ›</span></Link> : null}
          {events.slice(0, 5).map(event => <Link className="consoleEvent" href={event.workflow_run_id ? runLink(event.workflow_run_id) : rootLink("activity")} key={event.id} data-event-id={event.id}><span className="consoleEventDot" aria-hidden="true"/><span><strong>{eventLabel(event.event_type)}</strong><small><RecordedTime value={event.occurred_at}/></small></span><span className="consoleRecordTag">Saved</span></Link>)}
          {!decisions.length && !events.length && decisionCount === 0 ? <Empty title={unavailable ? "Activity unavailable" : "No activity recorded"} detail={unavailable ? "Reload before treating this workspace as empty." : "Workflow events and decisions will appear here when recorded."}/> : null}
        </div>
      </Panel>
    </div>
    <div className="consoleOverviewRow consoleOverviewMiddle">
      <Panel name="workers" title="Worker receipts" href={rootLink("work")} action="All work">
        {receipts.length ? <div className="consoleWorkerGrid consolePanelScroll">{receipts.slice(0, 9).map(({ worker, run, task, summary, name }) => <Link href={runLink(run.id)} className="consoleWorkerTile" data-worker-id={worker.id} data-worker-active={Boolean(summary.active) && !unavailable} key={worker.id} title={`${name}: ${summary.active && !unavailable ? "Working on the current stage" : `Last recorded: ${statusLabel(worker.status)}`}. ${task.objective}`}><span className="consoleWorkerIcon"><CoreIcon name="lab"/></span><span className="consoleWorkerText"><strong>{name}</strong><span className="consoleWorkerState">{unavailable ? "Recorded · status unconfirmed" : summary.active ? "Working now" : `Last: ${statusLabel(worker.status)}`}</span><small>{task.objective}</small><span className="consoleWorkerReceipt">Receipt · {worker.id.slice(0, 8)}</span></span><span className="consoleReceiptMark" aria-hidden="true">{!unavailable && summary.active ? "◉" : worker.status === "completed" ? "✓" : "·"}</span></Link>)}</div> : <Empty icon="lab" title={unavailable ? "Worker receipts unavailable" : "No worker executions recorded"} detail="Worker tiles appear only with matching run and task receipts."/>}
      </Panel>
      <Panel name="timeline" title="Workflow timeline" href={currentRun ? runLink(currentRun.id) : rootLink("work")} action="Open">
        {currentRun ? <div className="consoleTimelineBody consolePanelScroll"><div className="consoleCurrentRun"><strong title={currentDefinition?.name ?? "Recorded workflow"}>{currentDefinition?.name ?? "Recorded workflow"}</strong><span>{unavailable ? "Status unconfirmed" : statusLabel(currentRun.status)} · {currentRun.id.slice(0, 8)}</span></div><ol className="consoleTimeline">{stages.map(stage => <li key={stage.key} data-current={!unavailable && stage.isCurrent} data-status={stage.status}><span className="consoleTimelinePoint" aria-hidden="true"/><div><strong>{stage.label}</strong><small>{unavailable ? `Last recorded: ${stage.detail}` : stage.detail}</small></div><span className="consoleStageMark" aria-hidden="true">{stage.status === "completed" ? "✓" : stage.isCurrent && !unavailable ? "›" : ""}</span></li>)}</ol></div> : <Empty icon="workflow" title={unavailable ? "Work history unavailable" : "No workflow yet"} detail="Recorded stages appear here after a workflow starts."/>}
      </Panel>
      <Panel name="commands" title="Quick commands">
        <nav className="consoleQuickCommands consolePanelScroll" aria-label="Quick commands"><Link href={researchHref ?? "/dashboard?view=overview&sheet=research"}><CoreIcon name="lab"/><span>Plan research</span><span aria-hidden="true">+</span></Link><Link href={rootLink("work")}><CoreIcon name="workflow"/><span>Inspect current work</span><span aria-hidden="true">›</span></Link><Link href={rootLink("library")}><CoreIcon name="artifacts"/><span>Open saved outputs</span><span aria-hidden="true">›</span></Link><Link href={rootLink("decisions")}><CoreIcon name="needs-you"/><span>Review decisions</span><span aria-hidden="true">›</span></Link></nav>
      </Panel>
    </div>
    <div className="consoleOverviewRow consoleOverviewBottom">
      <CostPanel costs={costs}/><ConnectionPanel connections={connections}/>
      <Panel name="outputs" title="Saved outputs" href={rootLink("library")} action="Library">
        {outputs.length ? <div className="consoleOutputList consolePanelScroll">{outputs.slice(0, 8).map(artifact => { const preview = previews.get(artifact.id); return <Link href={rootLink("library")} className="consoleOutput" data-artifact-id={artifact.id} key={artifact.id}>{preview ? <span className="consoleOutputPreview">{/* A server-issued, explicitly provided signed URL only. */}
{/* eslint-disable-next-line @next/next/no-img-element */}
<img src={preview.signedUrl} alt={preview.alt} loading="lazy" referrerPolicy="no-referrer"/></span> : <span className="consoleOutputGlyph"><CoreIcon name="artifacts"/></span>}<span><strong title={artifact.name}>{artifact.name}</strong><small>{stageLabel(artifact.artifact_type)}</small><span className="consoleOutputTime"><RecordedTime value={artifact.created_at}/></span></span><span aria-hidden="true">›</span></Link>; })}</div> : <Empty icon="artifacts" title={unavailable ? "Saved outputs unavailable" : "No saved outputs yet"} detail={unavailable ? "Existing artifacts may still be available in the Library." : "Research, designs and other saved work will appear here."}/>}
      </Panel>
    </div>
  </div>;
}
