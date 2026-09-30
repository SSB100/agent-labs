"use client";

import { useState } from "react";

import { resumeBrowserControl } from "@/app/dashboard/browser-actions";
import { BrowserReplay } from "@/components/stage8/browser-replay";
import type {
  BrowserSessionEventRecord,
  BrowserSessionRecord,
} from "@/browser/ui";
import type {
  ArtifactRecord,
  OwnerInterventionRecord,
} from "@/lib/core-ui/workflows";
import { formatDateTime, humanize } from "@/lib/core-ui/workflows";

import { CoreIcon, type CoreIconName } from "./icons";

const tabs = [
  { key: "browser", label: "Live Browser", icon: "browser" },
  { key: "products", label: "Products", icon: "products" },
  { key: "metrics", label: "Metrics", icon: "metrics" },
  { key: "artifacts", label: "Artifacts", icon: "artifacts" },
] as const satisfies readonly {
  key: string;
  label: string;
  icon: CoreIconName;
}[];

type WorkspaceTab = (typeof tabs)[number]["key"];

type WorkflowWorkspaceProps = {
  artifacts: ArtifactRecord[];
  browserEvents?: BrowserSessionEventRecord[];
  browserIntervention?: OwnerInterventionRecord | null;
  browserSession?: BrowserSessionRecord | null;
  returnTo: string;
};

function Placeholder({
  icon,
  title,
  children,
}: {
  icon: CoreIconName;
  title: string;
  children: string;
}) {
  return (
    <div className="workspacePlaceholder">
      <span><CoreIcon name={icon} /></span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

function BrowserPlannerActivity({
  events,
}: {
  events: BrowserSessionEventRecord[];
}) {
  const plannerEvents = events
    .filter((event) => event.event_type.startsWith("browser.planner."))
    .slice(0, 8);

  if (!plannerEvents.length) return null;

  return (
    <div className="browserPlannerActivity">
      <div>
        <strong>Browser Planner</strong>
        <small>One bounded action per planning step</small>
      </div>
      <ol>
        {plannerEvents.map((event) => {
          const action =
            typeof event.payload.actionType === "string"
              ? event.payload.actionType
              : event.event_type.split(".").at(-1) ?? "action";
          const elementId =
            typeof event.payload.elementId === "string"
              ? event.payload.elementId
              : null;
          const reason =
            typeof event.payload.reason === "string"
              ? event.payload.reason
              : humanize(event.event_type);
          return (
            <li key={event.id}>
              <span>{humanize(action)}</span>
              <strong>{reason}</strong>
              <small>
                {elementId ? `Element ${elementId} · ` : ""}
                {formatDateTime(event.occurred_at)}
              </small>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function BrowserWorkspace({
  events,
  intervention,
  returnTo,
  session,
}: {
  events: BrowserSessionEventRecord[];
  intervention?: OwnerInterventionRecord | null;
  returnTo: string;
  session: BrowserSessionRecord | null;
}) {
  if (!session) {
    return (
      <Placeholder icon="browser" title="No browser session attached">
        A live remote browser appears here when a browser-enabled workflow launches one.
      </Placeholder>
    );
  }

  const isLive = ["launching", "live", "human_control", "returning"].includes(
    session.status,
  );
  const takeControl = intervention?.intervention_type === "browser_takeover";

  return (
    <div className="browserWorkspace">
      <div className="browserWorkspaceHeader">
        <div>
          <span className={`browserControlDot browserControlDot-${session.control_mode}`} />
          <div>
            <strong>{session.page_title ?? "Remote Chromium"}</strong>
            <small>{session.current_url ?? "Session starting"}</small>
          </div>
        </div>
        <div className="browserWorkspaceMeta">
          <span>{humanize(session.status)}</span>
          <span>{humanize(session.control_mode)} control</span>
          {session.region ? <span>{session.region}</span> : null}
        </div>
      </div>

      {isLive && session.live_view_status === "ready" ? (
        <div className="browserLiveFrame">
          <iframe
            allow="clipboard-read; clipboard-write"
            key={`${session.id}:${session.control_mode}`}
            referrerPolicy="no-referrer"
            src={`/api/browser/sessions/${session.id}/live`}
            title="Agent Labs live remote browser"
          />
        </div>
      ) : session.status === "released" && session.replay_status === "ready" ? (
        <BrowserReplay browserSessionId={session.id} />
      ) : (
        <Placeholder icon="browser" title="Browser session is changing state">
          Agent Labs is launching, reconnecting, releasing, or preparing the recorded replay.
        </Placeholder>
      )}

      <BrowserPlannerActivity events={events} />

      <div className="browserWorkspaceFooter">
        <div>
          <strong>
            {session.control_mode === "human"
              ? "You currently control the browser"
              : session.status === "released"
                ? "Recorded session"
                : "Agent Labs automation controls the browser"}
          </strong>
          <small>
            {session.control_mode === "human"
              ? "Complete the required human interaction, then return control."
              : session.status === "released"
                ? "The provider session is released and no browser time is being consumed."
                : "Planner actions are shown above. The live view stays read-only until Take Control is approved."}
          </small>
        </div>
        {intervention && ["browser_takeover", "browser_return_control"].includes(intervention.intervention_type) ? (
          <form action={resumeBrowserControl}>
            <input name="interventionId" type="hidden" value={intervention.id} />
            <input name="returnTo" type="hidden" value={returnTo} />
            <button
              className="coreButton coreButton-primary"
              name="decision"
              type="submit"
              value={takeControl ? "take_control" : "return_control"}
            >
              {takeControl ? "Take Control" : "Return Control"}
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

export function WorkflowWorkspace({
  artifacts,
  browserEvents = [],
  browserIntervention,
  browserSession = null,
  returnTo,
}: WorkflowWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(
    browserSession ? "browser" : artifacts.length ? "artifacts" : "browser",
  );

  return (
    <section className="workflowWorkspace" aria-labelledby="workspace-heading">
      <div className="workspacePanelHeader">
        <div>
          <p className="coreEyebrow">Workspace</p>
          <h2 id="workspace-heading">Current output</h2>
        </div>
        <span>
          {browserSession ? "1 browser" : `${artifacts.length} artifact${artifacts.length === 1 ? "" : "s"}`}
        </span>
      </div>

      <div className="workspaceTabs" role="tablist" aria-label="Workflow workspace">
        {tabs.map((tab) => (
          <button
            aria-selected={activeTab === tab.key}
            className={activeTab === tab.key ? "workspaceTab workspaceTab-active" : "workspaceTab"}
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            role="tab"
            type="button"
          >
            <CoreIcon name={tab.icon} />
            <span>{tab.label}</span>
            {tab.key === "browser" && browserSession ? <strong>1</strong> : null}
            {tab.key === "artifacts" && artifacts.length ? <strong>{artifacts.length}</strong> : null}
          </button>
        ))}
      </div>

      <div className="workspaceContent" role="tabpanel">
        {activeTab === "browser" ? (
          <BrowserWorkspace
            events={browserEvents}
            intervention={browserIntervention}
            returnTo={returnTo}
            session={browserSession}
          />
        ) : null}

        {activeTab === "products" ? (
          <Placeholder icon="products" title="No product workspace yet">
            Products will appear here when a product workflow creates candidates, decisions, listings, or fulfilment records.
          </Placeholder>
        ) : null}

        {activeTab === "metrics" ? (
          <Placeholder icon="metrics" title="No workflow metrics yet">
            Measurements, outcome signals, model usage, and financial performance will share this reusable workspace as packs add them.
          </Placeholder>
        ) : null}

        {activeTab === "artifacts" ? (
          artifacts.length ? (
            <div className="artifactGrid">
              {artifacts.map((artifact) => (
                <article className="artifactCard" key={artifact.id}>
                  <div className="artifactCardHeader">
                    <span><CoreIcon name="artifacts" /></span>
                    <div>
                      <h3>{artifact.name}</h3>
                      <p>{humanize(artifact.artifact_type)} · {artifact.media_type}</p>
                    </div>
                  </div>
                  <pre>{JSON.stringify(artifact.content ?? artifact.metadata, null, 2)}</pre>
                  <footer>
                    <span>Created {formatDateTime(artifact.created_at)}</span>
                    <code>{artifact.id.slice(0, 8)}</code>
                  </footer>
                </article>
              ))}
            </div>
          ) : (
            <Placeholder icon="artifacts" title="No artifacts created">
              Durable worker output, evidence packs, receipts, and future production assets will be collected here.
            </Placeholder>
          )
        ) : null}
      </div>
    </section>
  );
}
