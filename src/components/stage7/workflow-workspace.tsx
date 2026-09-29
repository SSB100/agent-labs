"use client";

import { useState } from "react";

import type { ArtifactRecord } from "@/lib/core-ui/workflows";
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

export function WorkflowWorkspace({ artifacts }: WorkflowWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(
    artifacts.length ? "artifacts" : "browser",
  );

  return (
    <section className="workflowWorkspace" aria-labelledby="workspace-heading">
      <div className="workspacePanelHeader">
        <div>
          <p className="coreEyebrow">Workspace</p>
          <h2 id="workspace-heading">Current output</h2>
        </div>
        <span>{artifacts.length} artifact{artifacts.length === 1 ? "" : "s"}</span>
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
            {tab.key === "artifacts" && artifacts.length ? <strong>{artifacts.length}</strong> : null}
          </button>
        ))}
      </div>

      <div className="workspaceContent" role="tabpanel">
        {activeTab === "browser" ? (
          <Placeholder icon="browser" title="No browser session attached">
            Live Browser becomes available when the Browser capability is qualified. Workflow state and activity remain fully visible here in the meantime.
          </Placeholder>
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
