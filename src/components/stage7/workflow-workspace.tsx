"use client";

import { useState } from "react";

import { resumeBrowserControl } from "@/app/dashboard/browser/actions";
import type { BrowserSessionRecord } from "@/lib/core-ui/browser";
import type {
  ArtifactRecord,
  OwnerInterventionRecord,
} from "@/lib/core-ui/workflows";
import {
  formatDateTime,
  humanize,
} from "@/lib/core-ui/workflows";

import { CoreIcon, type CoreIconName } from "./icons";
import { StatusPill } from "./app-shell";

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

type BrowserWorkspaceState = {
  session: BrowserSessionRecord;
  providerName: string;
  liveViewUrl: string | null;
  replayUrl: string | null;
  intervention: OwnerInterventionRecord | null;
  workflowRunId: string;
};

type WorkflowWorkspaceProps = {
  artifacts: ArtifactRecord[];
  browser?: BrowserWorkspaceState | null;
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

function BrowserControl({ browser }: { browser: BrowserWorkspaceState }) {
  const { session, intervention } = browser;
  const isTakeover = intervention?.intervention_type === "browser_takeover";
  const isReturn = intervention?.intervention_type === "browser_return_control";

  if (!intervention || (!isTakeover && !isReturn)) return null;

  return (
    <form action={resumeBrowserControl} className="browserControlBar">
      <input name="browserSessionId" type="hidden" value={session.id} />
      <input name="interventionId" type="hidden" value={intervention.id} />
      <input
        name="returnTo"
        type="hidden"
        value={`/dashboard/workflows/${browser.workflowRunId}`}
      />
      <input
        name="decision"
        type="hidden"
        value={isTakeover ? "take_control" : "return_control"}
      />
      <div>
        <strong>{intervention.title}</strong>
        <span>{intervention.description}</span>
      </div>
      <button className="coreButton coreButton-primary" type="submit">
        {isTakeover ? "Take Control" : "Return Control"}
      </button>
    </form>
  );
}

function BrowserPanel({ browser }: { browser: BrowserWorkspaceState | null }) {
  if (!browser) {
    return (
      <Placeholder icon="browser" title="No browser session attached">
        A remote browser appears here when a workflow creates an isolated provider session.
      </Placeholder>
    );
  }

  const { session, providerName, liveViewUrl, replayUrl } = browser;
  const released = session.status === "released";
  const displayUrl = released ? replayUrl : liveViewUrl;

  return (
    <div className="browserWorkspacePanel">
      <div className="browserWorkspaceHeader">
        <div>
          <p className="coreEyebrow">{released ? "Session replay" : "Remote Chromium"}</p>
          <h3>{session.page_title ?? humanize(session.status)}</h3>
          <p>
            {providerName} · {humanize(session.control_mode)} control
            {session.current_url ? ` · ${session.current_url}` : ""}
          </p>
        </div>
        <StatusPill status={session.status} />
      </div>

      <BrowserControl browser={browser} />

      {displayUrl ? (
        <div className={session.control_mode === "human" ? "browserViewport browserViewport-interactive" : "browserViewport"}>
          <iframe
            allow="clipboard-read; clipboard-write"
            referrerPolicy="no-referrer"
            src={displayUrl}
            title={released ? "Browser session replay" : "Live remote browser"}
          />
          {!released ? (
            <div className="browserViewportLabel">
              {session.control_mode === "human"
                ? "Human input enabled"
                : "Read-only while Agent Labs owns control"}
            </div>
          ) : null}
        </div>
      ) : session.status === "failed" ? (
        <Placeholder icon="browser" title="Browser session failed">
          The provider failure is preserved in the Workflow activity and session record.
        </Placeholder>
      ) : released ? (
        <Placeholder icon="history" title="Replay is not available yet">
          The released session is durable, but the provider recording is still processing or unavailable.
        </Placeholder>
      ) : (
        <Placeholder icon="browser" title="Browser is starting">
          Agent Labs is waiting for the provider to return the live viewer and Playwright connection.
        </Placeholder>
      )}

      <footer className="browserWorkspaceFooter">
        <span>Session {session.id.slice(0, 8)}</span>
        <span>Started {formatDateTime(session.started_at ?? session.created_at)}</span>
        <span>Replay {humanize(session.replay_status)}</span>
      </footer>
    </div>
  );
}

export function WorkflowWorkspace({ artifacts, browser = null }: WorkflowWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(
    browser ? "browser" : artifacts.length ? "artifacts" : "browser",
  );

  return (
    <section className="workflowWorkspace" aria-labelledby="workspace-heading">
      <div className="workspacePanelHeader">
        <div>
          <p className="coreEyebrow">Workspace</p>
          <h2 id="workspace-heading">Current output</h2>
        </div>
        <span>
          {browser ? "1 browser" : `${artifacts.length} artifact${artifacts.length === 1 ? "" : "s"}`}
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
            {tab.key === "browser" && browser ? <strong>1</strong> : null}
            {tab.key === "artifacts" && artifacts.length ? <strong>{artifacts.length}</strong> : null}
          </button>
        ))}
      </div>

      <div className="workspaceContent" role="tabpanel">
        {activeTab === "browser" ? <BrowserPanel browser={browser} /> : null}

        {activeTab === "products" ? (
          <Placeholder icon="products" title="No product workspace yet">
            Products will appear here when a product workflow creates candidates, decisions, listings, or fulfilment records.
          </Placeholder>
        ) : null}

        {activeTab === "metrics" ? (
          <Placeholder icon="metrics" title="No workflow metrics yet">
            Measurements, outcome signals, model usage, browser session cost, and financial performance will share this reusable workspace as packs add them.
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
