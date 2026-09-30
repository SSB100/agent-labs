import Link from "next/link";
import type { ReactNode } from "react";

import type { OwnerUiContext } from "@/lib/core-ui/data";

import { CoreIcon, type CoreIconName } from "./icons";
import { LiveRefresh } from "./live-refresh";

export type CoreSection =
  | "accounts"
  | "dashboard"
  | "history"
  | "needs-you"
  | "packs"
  | "products"
  | "settings"
  | "workflows";

type AppShellProps = {
  active: CoreSection;
  children: ReactNode;
  context: OwnerUiContext;
  workflowRunId?: string;
};

type NavItem = {
  href: string;
  icon: CoreIconName;
  key: CoreSection;
  label: string;
};

const primaryNavigation: NavItem[] = [
  { href: "/dashboard", icon: "dashboard", key: "dashboard", label: "Dashboard" },
  { href: "/dashboard/workflows", icon: "workflow", key: "workflows", label: "Workflows" },
  { href: "/dashboard/products", icon: "products", key: "products", label: "Products" },
  { href: "/dashboard/needs-you", icon: "needs-you", key: "needs-you", label: "Needs You" },
  { href: "/dashboard/history", icon: "history", key: "history", label: "History" },
];

const systemNavigation: NavItem[] = [
  { href: "/dashboard/packs", icon: "products", key: "packs", label: "Packs" },
  { href: "/dashboard/accounts", icon: "accounts", key: "accounts", label: "Accounts" },
  { href: "/dashboard/settings", icon: "settings", key: "settings", label: "Settings" },
];

const allNavigation = [...primaryNavigation, ...systemNavigation];

const labNavigation = [
  { href: "/dashboard/worker-proof", label: "Worker proof" },
  { href: "/dashboard/model-router", label: "Model router" },
  { href: "/dashboard/worker-evaluations", label: "Worker evaluations" },
];

function NavigationLink({
  active,
  count,
  item,
}: {
  active: boolean;
  count?: number;
  item: NavItem;
}) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={active ? "coreNavLink coreNavLink-active" : "coreNavLink"}
      href={item.href}
    >
      <CoreIcon className="coreNavIcon" name={item.icon} />
      <span>{item.label}</span>
      {typeof count === "number" && count > 0 ? (
        <strong className="coreNavCount">{count}</strong>
      ) : null}
    </Link>
  );
}

export function AppShell({
  active,
  children,
  context,
  workflowRunId,
}: AppShellProps) {
  const ownerInitial = context.displayName.trim().charAt(0).toUpperCase() || "O";

  return (
    <div className="coreShell">
      <aside className="coreSidebar">
        <Link className="coreBrand" href="/dashboard" aria-label="Agent Labs dashboard">
          <span className="coreBrandMark" aria-hidden="true">AL</span>
          <span>
            <strong>Agent Labs</strong>
            <small>Private control centre</small>
          </span>
        </Link>

        <nav className="coreNavigation" aria-label="Agent Labs">
          <p className="coreNavLabel">Operate</p>
          {primaryNavigation.map((item) => (
            <NavigationLink
              active={active === item.key}
              count={item.key === "needs-you" ? context.needsYouCount : undefined}
              item={item}
              key={item.key}
            />
          ))}

          <p className="coreNavLabel coreNavLabel-spaced">System</p>
          {systemNavigation.map((item) => (
            <NavigationLink active={active === item.key} item={item} key={item.key} />
          ))}
        </nav>

        <div className="coreLabLinks">
          <p className="coreNavLabel">Qualification tools</p>
          {labNavigation.map((item) => (
            <Link href={item.href} key={item.href}>{item.label}</Link>
          ))}
        </div>

        <div className="coreSidebarFooter">
          <LiveRefresh workflowRunId={workflowRunId} />
          <div className="ownerIdentity">
            <span className="ownerAvatar" aria-hidden="true">{ownerInitial}</span>
            <span>
              <strong>{context.displayName}</strong>
              <small>{context.email}</small>
            </span>
          </div>
          <form action="/auth/signout" method="post">
            <button className="sidebarSignOut" type="submit">Sign out</button>
          </form>
        </div>
      </aside>

      <div className="coreMobileHeader">
        <Link className="coreBrand" href="/dashboard">
          <span className="coreBrandMark" aria-hidden="true">AL</span>
          <span><strong>Agent Labs</strong><small>Control centre</small></span>
        </Link>
        <LiveRefresh workflowRunId={workflowRunId} />
      </div>

      <nav className="coreMobileNav" aria-label="Agent Labs mobile navigation">
        {allNavigation.map((item) => (
          <Link
            aria-current={active === item.key ? "page" : undefined}
            className={active === item.key ? "coreMobileNavLink coreMobileNavLink-active" : "coreMobileNavLink"}
            href={item.href}
            key={item.key}
          >
            <CoreIcon name={item.icon} />
            <span>{item.label}</span>
            {item.key === "needs-you" && context.needsYouCount > 0 ? (
              <strong>{context.needsYouCount}</strong>
            ) : null}
          </Link>
        ))}
      </nav>

      <main className="coreMain">{children}</main>
    </div>
  );
}

export function PageHeader({
  actions,
  description,
  eyebrow,
  title,
}: {
  actions?: ReactNode;
  description?: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <header className="corePageHeader">
      <div>
        <p className="coreEyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description ? <p className="corePageDescription">{description}</p> : null}
      </div>
      {actions ? <div className="corePageActions">{actions}</div> : null}
    </header>
  );
}

export function StatusPill({ status }: { status: string }) {
  const tone =
    status === "completed" || status === "qualified" || status === "connected"
      ? "success"
      : status === "needs_owner" || status === "review"
        ? "attention"
        : status === "failed" || status === "cancelled" || status === "not_configured"
          ? "danger"
          : status === "running" || status === "waiting" || status === "queued"
            ? "live"
            : "neutral";
  const label = status
    .split(/[._-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  return <span className={`coreStatus coreStatus-${tone}`}>{label}</span>;
}

export function EmptyPanel({
  icon,
  title,
  children,
}: {
  icon: CoreIconName;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="coreEmptyPanel">
      <span className="coreEmptyIcon"><CoreIcon name={icon} /></span>
      <h3>{title}</h3>
      <div>{children}</div>
    </div>
  );
}
