import Link from "next/link";
import type { ReactNode } from "react";

import type { CoreSection } from "@/components/stage7/app-shell";
import { CoreIcon, type CoreIconName } from "@/components/stage7/icons";
import { LiveRefresh } from "@/components/stage7/live-refresh";
import type { OwnerUiContext } from "@/lib/core-ui/data";

import "./console-shell.css";

export type ConsoleView = "overview" | "work" | "library" | "decisions" | "connections" | "activity" | "advanced";

export type ConsoleShellProps = {
  active: CoreSection | ConsoleView;
  children: ReactNode;
  commandBar?: ReactNode;
  context: OwnerUiContext;
  workflowRunId?: string;
};

type ConsoleDestination = {
  view: ConsoleView;
  href: string;
  icon: CoreIconName;
  label: string;
};

export const consoleNavigation: readonly ConsoleDestination[] = [
  { view: "overview", href: "/dashboard?view=overview", icon: "dashboard", label: "Overview" },
  { view: "work", href: "/dashboard?view=work", icon: "workflow", label: "Work" },
  { view: "library", href: "/dashboard?view=library", icon: "artifacts", label: "Library" },
  { view: "decisions", href: "/dashboard?view=decisions", icon: "needs-you", label: "Decisions" },
  { view: "connections", href: "/dashboard?view=connections", icon: "accounts", label: "Connections" },
  { view: "activity", href: "/dashboard?view=activity", icon: "activity", label: "Activity" },
  { view: "advanced", href: "/dashboard?view=advanced", icon: "settings", label: "Advanced" },
];

const sectionViews: Record<CoreSection, ConsoleView> = {
  accounts: "connections", artifacts: "library", dashboard: "overview", history: "activity",
  "needs-you": "decisions", packs: "advanced", products: "work", settings: "advanced", workflows: "work",
};

export function resolveConsoleView(active: CoreSection | ConsoleView): ConsoleView {
  return active in sectionViews ? sectionViews[active as CoreSection] : active as ConsoleView;
}

export const consoleAdvancedNavigation = [
  { href: "/dashboard/workflows", label: "Workflow workspace", key: "workflows" },
  { href: "/dashboard/products", label: "Product research", key: "products" },
  { href: "/dashboard/artifacts", label: "Artifact explorer", key: "artifacts" },
  { href: "/dashboard/needs-you", label: "Decision queue", key: "needs-you" },
  { href: "/dashboard/accounts", label: "Account settings", key: "accounts" },
  { href: "/dashboard/history", label: "Event history", key: "history" },
  { href: "/dashboard/packs", label: "Packs", key: "packs" },
  { href: "/dashboard/worker-proof", label: "Worker proof" },
  { href: "/dashboard/model-router", label: "Model router" },
  { href: "/dashboard/worker-evaluations", label: "Worker evaluations" },
  { href: "/dashboard/settings", label: "Settings & profile", key: "settings" },
] as const;

function DecisionCount({ context }: { context: OwnerUiContext }) {
  if (context.needsYouUnavailable) {
    return (
      <span className="consoleDecisionCount consoleDecisionCount-unknown" title="Decision count unavailable">
        <span aria-hidden="true">?</span>
        <span className="consoleVisuallyHidden">Decision count unavailable</span>
      </span>
    );
  }
  return (
    <span className={context.needsYouCount > 0 ? "consoleDecisionCount" : "consoleDecisionCount consoleDecisionCount-empty"}>
      <span aria-hidden="true">{context.needsYouCount > 99 ? "99+" : context.needsYouCount}</span>
      <span className="consoleVisuallyHidden">{context.needsYouCount} open {context.needsYouCount === 1 ? "decision" : "decisions"}</span>
    </span>
  );
}

function WorkspaceContext({ context }: { context: OwnerUiContext }) {
  const name = context.businessesUnavailable
    ? "Business records unavailable"
    : context.businesses.length === 1
      ? context.businesses[0].name
      : context.businesses.length > 1
        ? `All ${context.businesses.length} businesses`
        : "No business yet";
  return (
    <div className="consoleWorkspaceContext" role={context.businessesUnavailable ? "status" : undefined}>
      <CoreIcon name="building" />
      <span className="consoleWorkspaceName">{name}</span>
    </div>
  );
}

function OwnerMenu({ context }: { context: OwnerUiContext }) {
  return (
    <details className="consoleOwnerMenu">
      <summary className="consoleOwnerSummary" aria-label={`Account for ${context.displayName}`}>
        <span className="consoleOwnerAvatar" aria-hidden="true">{context.displayName.trim().charAt(0).toUpperCase() || "O"}</span>
        <span className="consoleOwnerName">{context.displayName}</span>
        <span className="consoleChevron" aria-hidden="true" />
      </summary>
      <div className="consoleOwnerContents">
        <span className="consoleOwnerEmail">{context.email}</span>
        <form action="/auth/signout" method="post">
          <button className="consoleSignOut" type="submit">Sign out</button>
        </form>
      </div>
    </details>
  );
}

/** Shared frame for both root views and direct detail URLs; URL navigation stays native. */
export function ConsoleShell({ active, children, commandBar, context, workflowRunId }: ConsoleShellProps) {
  const currentView = resolveConsoleView(active);
  const currentLabel = consoleNavigation.find(item => item.view === currentView)?.label ?? "Overview";

  return (
    <div className="consoleShell" data-console-view={currentView}>
      <a className="consoleSkipLink" href="#main-content">Skip to content</a>

      <aside className="consoleSidebar consoleFrame" aria-label="Control centre navigation">
        <Link className="consoleBrand" href="/dashboard?view=overview" aria-label="Agent Labs control centre">
          <span className="consoleBrandMark" aria-hidden="true"><span /></span>
          <span><strong>AGENT LABS</strong><small>Control centre</small></span>
        </Link>

        <nav className="consoleNavigation" aria-label="Workspace views">
          {consoleNavigation.map(item => (
            <Link key={item.view} className="consoleNavLink" href={item.href} aria-label={item.view === "connections" ? "Connections" : undefined} aria-current={item.view === currentView ? "page" : undefined}>
              <CoreIcon name={item.icon} />
              <span className="consoleNavLabel">{item.view === "connections" ? <><span className="consoleNavFull">Connections</span><span className="consoleNavShort">Connect</span></> : item.label}</span>
              {item.view === "decisions" ? <DecisionCount context={context} /> : null}
            </Link>
          ))}
        </nav>

        <div className="consoleRailNote"><CoreIcon name="building" /><span>Private owner workspace</span></div>
        <OwnerMenu context={context} />
      </aside>

      <header className="consoleTopBar consoleFrame">
        <div className="consoleViewHeading"><span>Command centre</span><strong>{currentLabel}</strong></div>
        <WorkspaceContext context={context} />
        {/* Exactly one subscription, for data updates rather than worker execution. */}
        <div className="consoleLiveStatus" role="status" aria-label="Page update connection">
          <LiveRefresh workflowRunId={workflowRunId} />
        </div>
      </header>

      <main className="consoleMain" id="main-content" tabIndex={-1}>{children}</main>

      <footer className="consoleCommandBar consoleFrame" aria-label="Workspace commands">
        {commandBar ?? (
          <div className="consoleDefaultCommands">
            <span className="consoleCommandLabel"><CoreIcon name="workflow" />Next action</span>
            <span className="consoleCommandHint">Choose work or review a decision</span>
            <Link className="consoleCommandLink" href="/dashboard?view=work">Open work</Link>
            <Link className="consoleCommandLink" href="/dashboard?view=decisions">Review decisions</Link>
          </div>
        )}
      </footer>
    </div>
  );
}
