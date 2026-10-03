import { carryWorkspace } from "@/lib/core-ui/workspace-navigation";
import Link from "next/link";
import { useId, type ReactNode } from "react";
import { CONSOLE_BROWSER_UNAVAILABLE, consoleBrowserHref, consoleBrowserStatus, consoleBrowserUpdatedAt, consoleBrowserWorkflowHref, type ConsoleBrowserWorkspace, type ConsoleCentreMode } from "@/browser/console-view";
import "./console-browser-centre.css";

/** Render in the existing core top line, replacing its Owner control label. */
export function ConsoleCentreTabs({ mode, data }: { mode: ConsoleCentreMode; data: ConsoleBrowserWorkspace }) {
  return <nav className="consoleCentreTabs" aria-label="Centre view">
    <Link href={carryWorkspace(consoleBrowserHref("overview", data.selectedBusinessId, data.selectedRunId), data.workspaceSearch)} aria-current={mode === "overview" ? "page" : undefined}>Overview</Link>
    <Link href={carryWorkspace(consoleBrowserHref("browser", data.selectedBusinessId, data.selectedRunId), data.workspaceSearch)} aria-current={mode === "browser" ? "page" : undefined}>Browser</Link>
  </nav>;
}

function BrowserContext({ data }: { data: ConsoleBrowserWorkspace }) {
  const id = useId(), selected = data.selectedSession;
  const business = data.businesses.find(item => item.id === data.selectedBusinessId);
  return <details className="consoleBrowserContext">
    <summary>Context</summary>
    <div className="consoleBrowserContextMenu">
      <strong>{business?.name ?? "Choose a Business"}{selected ? ` · ${selected.workflowRunId.slice(0, 8)}` : ""}</strong>
      {data.businesses.length > 1 || !business ? <form action="/dashboard" method="get">
        <input type="hidden" name="view" value="overview"/><input type="hidden" name="centre" value="browser"/>
        <label htmlFor={`${id}-business`}>Business</label>
        <select id={`${id}-business`} name="business" defaultValue={data.selectedBusinessId ?? ""} required disabled={!data.businesses.length}>
          <option value="" disabled>Choose a Business</option>{data.businesses.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select><button type="submit" disabled={!data.businesses.length}>Choose Business</button>
      </form> : null}
      {data.status === "ready" && business ? <form action="/dashboard" method="get">
        <input type="hidden" name="view" value="overview"/><input type="hidden" name="centre" value="browser"/><input type="hidden" name="business" value={business.id}/>{new URLSearchParams(data.workspaceSearch).get("quest") ? <input type="hidden" name="quest" value={new URLSearchParams(data.workspaceSearch).get("quest")!}/> : null}
        <label htmlFor={`${id}-run`}>Browser run</label>
        <select id={`${id}-run`} name="browserRun" defaultValue={data.selectedRunId ?? ""} required disabled={!data.sessions.length}>
          <option value="" disabled>Choose a browser run</option>
          {data.selectedRunId && !selected ? <option value={data.selectedRunId}>Selected run · {data.selectedRunId.slice(0, 8)}</option> : null}
          {data.sessions.map(session => <option key={session.id} value={session.workflowRunId}>{session.label} · {session.workflowRunId.slice(0, 8)} · {consoleBrowserStatus(session.savedStatus).replaceAll("_", " ")}</option>)}
        </select><button type="submit" disabled={!data.sessions.length}>Choose run</button>
      </form> : null}
      {data.truncated ? <p>Latest 40 sessions, plus the exact selected run.</p> : null}
      <p>Only saved session metadata is shown. Page content, screenshots and provider links are not included.</p>
    </div>
  </details>;
}

function BrowserContent({ data }: { data: ConsoleBrowserWorkspace }) {
  const selected = data.status === "ready" ? data.selectedSession : null;
  const record = selected ? consoleBrowserWorkflowHref(selected) : null;
  const recordHref = record ? carryWorkspace(record, data.workspaceSearch) : null;
  const updatedAt = consoleBrowserUpdatedAt(selected?.updatedAt);
  let title = "Saved browser session", description = "";
  if (data.status !== "ready") {
    title = data.status === "invalid_selection" ? "Browser selection unavailable" : "Browser-session records unavailable";
    description = "Missing sessions have not been inferred. Open Context to choose an owned Business and run.";
  } else if (!data.selectedBusinessId) {
    title = data.businesses.length ? "Choose a Business" : "No Business workspace";
    description = "Open Context to choose whose saved browser activity to inspect.";
  } else if (!data.selectedRunId) {
    title = data.sessions.length ? "Choose a browser run" : "No browser sessions recorded";
    description = data.sessions.length ? "Open Context to choose an exact run." : "No browser session is recorded for this Business. This view does not start one.";
  } else if (!selected) {
    title = "No browser session for this run";
    description = "Other work can run without a browser. This view does not start one.";
  }
  return <div className="consoleBrowserContent" data-console-centre="browser">
    <div className="consoleBrowserToolbar">
      <strong>{selected ? `Recorded session state: ${consoleBrowserStatus(selected.savedStatus).replaceAll("_", " ")}` : "Saved browser activity"}</strong>
      <div className="consoleBrowserTools"><BrowserContext key={`${data.selectedBusinessId}:${data.selectedRunId}`} data={data}/>{recordHref ? <Link href={recordHref} prefetch={false} aria-label="Inspect saved workflow record">Record</Link> : null}</div>
    </div>
    <div className="consoleBrowserEmpty" role="status">
      {selected ? <>
        <p>{selected.label} · Run {selected.workflowRunId.slice(0, 8)}</p>
        <p>{updatedAt ? <time dateTime={updatedAt}>Record updated {updatedAt.replace("T", " ").replace(".000Z", " UTC")}</time> : "Record update time unavailable"}</p>
      </> : <><strong>{title}</strong><p>{description}</p></>}
      <strong className="consoleBrowserUnavailable">{CONSOLE_BROWSER_UNAVAILABLE}</strong>
      <p>Saved status does not confirm current connectivity. No provider heartbeat or expiry is available.</p>
    </div>
  </div>;
}

/** Render directly after the existing top line. Overview returns children with
 * no wrapper, preserving its original orb/next-action flex geometry. Browser
 * replaces both with compact saved metadata only. It cannot mount a viewer. */
export function ConsoleBrowserCentre({ mode, data, children }: { mode: ConsoleCentreMode; data: ConsoleBrowserWorkspace; children: ReactNode }) {
  return mode === "browser" ? <BrowserContent key={`${data.selectedBusinessId}:${data.selectedRunId}`} data={data}/> : <>{children}</>;
}
