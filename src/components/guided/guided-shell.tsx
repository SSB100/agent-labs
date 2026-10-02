import Link from "next/link";
import type { ReactNode } from "react";

import type { OwnerUiContext } from "@/lib/core-ui/data";
import type { CoreSection } from "@/components/stage7/app-shell";
import { CoreIcon, type CoreIconName } from "@/components/stage7/icons";
import { LiveRefresh } from "@/components/stage7/live-refresh";

import "./guided-shell.css";

type GuidedShellProps = {
  active: CoreSection;
  children: ReactNode;
  context: OwnerUiContext;
  workflowRunId?: string;
};

type NavigationItem = {
  href: string;
  icon: CoreIconName;
  key: CoreSection;
  label: string;
};

const primaryNavigation: NavigationItem[] = [
  { href: "/dashboard", icon: "dashboard", key: "dashboard", label: "Control centre" },
  { href: "/dashboard/workflows", icon: "workflow", key: "workflows", label: "Work" },
  { href: "/dashboard/artifacts", icon: "artifacts", key: "artifacts", label: "Library" },
  { href: "/dashboard/needs-you", icon: "needs-you", key: "needs-you", label: "Decisions" },
  { href: "/dashboard/accounts", icon: "accounts", key: "accounts", label: "Connections" },
];

const advancedNavigation: { href: string; label: string; key?: CoreSection }[] = [
  { href: "/dashboard/packs", label: "Packs", key: "packs" },
  { href: "/dashboard/worker-proof", label: "Worker proof" },
  { href: "/dashboard/model-router", label: "Model router" },
  { href: "/dashboard/worker-evaluations", label: "Worker evaluations" },
  { href: "/dashboard/settings", label: "Settings & profile", key: "settings" },
];

function Brand() {
  return (
    <Link className="guidedBrand" href="/dashboard" aria-label="Agent Labs control centre">
      <span className="guidedBrandMark" aria-hidden="true">AL</span>
      <span><strong>Agent Labs</strong><small>Private workspace</small></span>
    </Link>
  );
}

function DecisionCount({ context }: { context: OwnerUiContext }) {
  if (context.needsYouUnavailable) {
    return (
      <span className="guidedDecisionCount guidedDecisionCount-unknown" title="Decision count unavailable">
        <span aria-hidden="true">?</span>
        <span className="guidedVisuallyHidden">Decision count unavailable</span>
      </span>
    );
  }
  if (context.needsYouCount < 1) return null;
  return (
    <span className="guidedDecisionCount">
      <span aria-hidden="true">{context.needsYouCount > 99 ? "99+" : context.needsYouCount}</span>
      <span className="guidedVisuallyHidden">{context.needsYouCount} open {context.needsYouCount === 1 ? "decision" : "decisions"}</span>
    </span>
  );
}

function PrimaryNavigation({ active, context, mobile = false }: {
  active: CoreSection;
  context: OwnerUiContext;
  mobile?: boolean;
}) {
  const currentSection = active === "products" ? "workflows" : active;
  return (
    <nav className={mobile ? "guidedBottomNavigation" : "guidedPrimaryNavigation"} aria-label={mobile ? "Primary mobile navigation" : "Primary navigation"}>
      {primaryNavigation.map((item) => (
        <Link className="guidedNavLink" href={item.href} aria-label={mobile && item.key === "accounts" ? "Connections" : undefined} aria-current={currentSection === item.key ? "page" : undefined} key={item.key}>
          <CoreIcon name={item.icon} />
          <span className="guidedNavText">{mobile && item.key === "accounts" ? "Connect" : item.label}</span>
          {item.key === "needs-you" ? <DecisionCount context={context} /> : null}
        </Link>
      ))}
    </nav>
  );
}

function SecondaryNavigation({ active, mobile = false }: { active: CoreSection; mobile?: boolean }) {
  return (
    <nav className="guidedSecondaryNavigation" aria-label={mobile ? "More navigation" : "Secondary navigation"}>
      <Link className="guidedNavLink" href="/dashboard/history" aria-current={active === "history" ? "page" : undefined}>
        <CoreIcon name="history" />
        <span>Activity</span>
      </Link>
      <details className="guidedAdvanced" open={active === "packs" || active === "settings"}>
        <summary className="guidedDisclosureSummary">
          <CoreIcon name="settings" />
          <span>Advanced</span>
          <span className="guidedChevron" aria-hidden="true" />
        </summary>
        <div className="guidedAdvancedLinks">
          {advancedNavigation.map((item) => (
            <Link className="guidedAdvancedLink" href={item.href} aria-current={item.key === active ? "page" : undefined} key={item.href}>
              {item.label}
            </Link>
          ))}
        </div>
      </details>
    </nav>
  );
}

function OwnerFooter({ context }: { context: OwnerUiContext }) {
  const ownerInitial = context.displayName.trim().charAt(0).toUpperCase() || "O";
  return (
    <div className="guidedOwnerFooter">
      <div className="guidedOwnerIdentity">
        <span className="guidedOwnerAvatar" aria-hidden="true">{ownerInitial}</span>
        <span><strong>{context.displayName}</strong><small>{context.email}</small></span>
      </div>
      <form action="/auth/signout" method="post">
        <button className="guidedSignOut" type="submit">Sign out</button>
      </form>
    </div>
  );
}

function WorkspaceContext({ context }: { context: OwnerUiContext }) {
  const singleBusiness = !context.businessesUnavailable && context.businesses.length === 1;
  const label = singleBusiness ? "Business" : "Owner workspace";
  const name = context.businessesUnavailable
    ? "Business records unavailable"
    : singleBusiness
      ? context.businesses[0].name
      : context.businesses.length > 1
        ? `All ${context.businesses.length} businesses`
        : "No business yet";
  return (
    <div className="guidedWorkspaceContext" role={context.businessesUnavailable ? "status" : undefined}>
      <CoreIcon name="building" />
      <span><small>{label}</small><strong>{name}</strong></span>
    </div>
  );
}

export function GuidedShell({ active, children, context, workflowRunId }: GuidedShellProps) {
  return (
    <div className="guidedShell">
      <a className="guidedSkipLink" href="#main-content">Skip to content</a>

      <aside className="guidedSidebar" aria-label="Workspace navigation">
        <Brand />
        <PrimaryNavigation active={active} context={context} />
        <SecondaryNavigation active={active} />
        <OwnerFooter context={context} />
      </aside>

      <header className="guidedTopBar">
        <div className="guidedMobileBrand"><Brand /></div>
        <details className="guidedMore">
          <summary className="guidedMoreSummary">More<span className="guidedChevron" aria-hidden="true" /></summary>
          <div className="guidedMorePanel">
            <SecondaryNavigation active={active} mobile />
            <OwnerFooter context={context} />
          </div>
        </details>
        <WorkspaceContext context={context} />
        {/* One mounted subscription serves both layouts, even when resized. */}
        <div className="guidedLiveStatus"><LiveRefresh workflowRunId={workflowRunId} /></div>
      </header>

      <PrimaryNavigation active={active} context={context} mobile />
      <main className="guidedMain" id="main-content" tabIndex={-1}>{children}</main>
    </div>
  );
}
