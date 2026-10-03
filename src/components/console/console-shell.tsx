import Link from "next/link";
import { HistoryPager } from "./history-pager";
import type { ReactNode } from "react";

import type { CoreSection } from "@/components/stage7/app-shell";
import { CoreIcon, type CoreIconName } from "@/components/stage7/icons";
import { LiveRefresh } from "@/components/stage7/live-refresh";
import type { OwnerUiContext } from "@/lib/core-ui/data";

import "./console-shell.css";

export type ConsoleView = "overview" | "work" | "library" | "research" | "decisions" | "connections" | "activity" | "advanced";

export type ConsoleShellProps = {
  active: CoreSection | ConsoleView;
  children: ReactNode;
  commandBar?: ReactNode;
  context: OwnerUiContext;
  workflowRunId?: string;
  navigationBusinessId?: string;
  globalDecisionCount?: boolean;
  /** An aggregate collection may still scope onward links to its selected record. */
  aggregateContext?: boolean;
  toolDestination?: string;
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
  { view: "research", href: "/dashboard?view=research", icon: "products", label: "Research" },
  { view: "decisions", href: "/dashboard?view=decisions", icon: "needs-you", label: "Decisions" },
  { view: "connections", href: "/dashboard?view=connections", icon: "accounts", label: "Connections" },
  { view: "activity", href: "/dashboard?view=activity", icon: "activity", label: "Activity" },
  { view: "advanced", href: "/dashboard?view=advanced", icon: "settings", label: "Advanced" },
];

const sectionViews: Record<CoreSection, ConsoleView> = {
  accounts: "connections", artifacts: "library", dashboard: "overview", history: "work",
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
  { href: "/dashboard/history", label: "Ended work history", key: "history" },
  { href: "/dashboard/packs", label: "Packs", key: "packs" },
  { href: "/dashboard/worker-proof", label: "Worker proof" },
  { href: "/dashboard/model-router", label: "Model router" },
  { href: "/dashboard/worker-evaluations", label: "Worker evaluations" },
  { href: "/dashboard/settings", label: "Settings & profile", key: "settings" },
  { href: "/dashboard/printful", label: "Printful operations" },
  { href: "/dashboard/etsy", label: "Etsy listings" },
  { href: "/dashboard/accounts?diagnostics=platform", label: "Platform diagnostics" },
] as const;

export const consoleToolNavigation = [
  { key: "products", href: "/dashboard/products", label: "Candidate tools" },
  { key: "artifacts", href: "/dashboard/artifacts", label: "Design approvals" },
  { key: "printful", href: "/dashboard/printful", label: "Printful" },
  { key: "etsy", href: "/dashboard/etsy", label: "Etsy listings" },
  { key: "packs", href: "/dashboard/packs", label: "Packs" },
  { key: "model-router", href: "/dashboard/model-router", label: "Model router" },
  { key: "worker-proof", href: "/dashboard/worker-proof", label: "Worker proof" },
  { key: "worker-evaluations", href: "/dashboard/worker-evaluations", label: "Evaluations" },
  { key: "settings", href: "/dashboard/settings", label: "Profile & Business" },
  { key: "diagnostics", href: "/dashboard/accounts?diagnostics=platform", label: "Diagnostics" },
] as const;

function DecisionCount({ context, global = false }: { context: OwnerUiContext; global?: boolean }) {
  if (context.needsYouUnavailable) {
    return (
      <span className="consoleDecisionCount consoleDecisionCount-unknown" title={global ? "Decision count unavailable across all authorized Businesses" : "Decision count unavailable"}>
        <span aria-hidden="true">?</span>
        <span className="consoleVisuallyHidden">Decision count unavailable{global ? " across all authorized Businesses" : ""}</span>
      </span>
    );
  }
  return (
    <span title={global ? `${context.needsYouCount} open decisions across all authorized Businesses` : undefined} className={context.needsYouCount > 0 ? "consoleDecisionCount" : "consoleDecisionCount consoleDecisionCount-empty"}>
      <span aria-hidden="true">{context.needsYouCount > 99 ? "99+" : context.needsYouCount}</span>
      <span className="consoleVisuallyHidden">{context.needsYouCount} open {context.needsYouCount === 1 ? "decision" : "decisions"}{global ? " across all authorized Businesses" : ""}</span>
    </span>
  );
}

function WorkspaceContext({ context, selectedBusinessId, aggregate = false }: { context: OwnerUiContext; selectedBusinessId?: string; aggregate?: boolean }) {
  const selected = context.businesses.find(business => business.id === selectedBusinessId);
  const name = context.businessesUnavailable
    ? "Business records unavailable"
    : aggregate ? "All owned Businesses"
    : selected ? selected.name
    : context.ownerDirectoryPaged ? context.businessDirectory?.total == null ? "Business count unavailable" : context.businessDirectory.total > 0 ? `All ${context.businessDirectory.total} businesses` : "No business yet"
    : context.businesses.length === 1
      ? context.businesses[0].name
      : context.businesses.length > 1
        ? `All ${context.businessDirectory?.total ?? context.businesses.length} businesses`
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
export function ConsoleShell({ active, children, commandBar, context, workflowRunId, navigationBusinessId, globalDecisionCount = false, aggregateContext = false, toolDestination }: ConsoleShellProps) {
  const currentView = resolveConsoleView(active);
  const selectedBusinessId = context.businesses.some(business => business.id === navigationBusinessId) ? navigationBusinessId : undefined;
  const destination = (href: string) => selectedBusinessId ? `${href}${href.includes("?") ? "&" : "?"}business=${encodeURIComponent(selectedBusinessId)}` : href;
  const currentLabel = toolDestination ? consoleToolNavigation.find(item => item.key === toolDestination)?.label ?? "Tools" : consoleNavigation.find(item => item.view === currentView)?.label ?? "Overview";

  return (
    <div className="consoleShell" data-console-view={currentView}>
      <a className="consoleSkipLink" href="#main-content">Skip to content</a>

      <aside className="consoleSidebar consoleFrame" aria-label="Control centre navigation">
        <Link className="consoleBrand" href={destination("/dashboard?view=overview")} aria-label="Agent Labs control centre">
          <span className="consoleBrandMark" aria-hidden="true"><span /></span>
          <span><strong>AGENT LABS</strong><small>Control centre</small></span>
        </Link>

        <nav className="consoleNavigation" aria-label="Workspace views">
          {consoleNavigation.map(item => (
            <Link key={item.view} className="consoleNavLink" href={item.view === "decisions" && globalDecisionCount ? item.href : destination(item.href)} aria-label={item.view === "connections" ? "Connections" : undefined} aria-current={item.view === currentView ? "page" : undefined}>
              <CoreIcon name={item.icon} />
              <span className="consoleNavLabel">{item.view === "connections" ? <><span className="consoleNavFull">Connections</span><span className="consoleNavShort">Connect</span></> : item.label}</span>
              {item.view === "decisions" ? <DecisionCount context={context} global={globalDecisionCount} /> : null}
            </Link>
          ))}
        </nav>

        {toolDestination ? <nav className="consoleTechnicalLinks consoleFocusedTools" aria-label="Focused tools">{consoleToolNavigation.map(item => <Link className="consoleTechnicalLink" key={item.key} href={destination(item.href)} aria-current={item.key === toolDestination ? "page" : undefined}>{item.label}</Link>)}</nav> : null}

        <div className="consoleRailNote"><CoreIcon name="building" /><span>Private owner workspace</span></div>
        <HistoryPager page={context.businessDirectory} name="business" label="Directory" /><OwnerMenu context={context} />
      </aside>

      <header className="consoleTopBar consoleFrame">
        <div className="consoleViewHeading"><span>Command centre</span><strong>{currentLabel}</strong></div>
        <WorkspaceContext context={context} aggregate={aggregateContext} selectedBusinessId={selectedBusinessId} />
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
            <Link className="consoleCommandLink" href={destination("/dashboard?view=work")}>Open work</Link>
            <Link className="consoleCommandLink" href={globalDecisionCount ? "/dashboard?view=decisions" : destination("/dashboard?view=decisions")}>Review decisions</Link>
          </div>
        )}
      </footer>
    </div>
  );
}
