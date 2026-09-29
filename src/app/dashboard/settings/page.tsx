import Link from "next/link";

import { AppShell, PageHeader } from "@/components/stage7/app-shell";
import { CoreIcon } from "@/components/stage7/icons";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { formatDateTime } from "@/lib/core-ui/workflows";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const context = await requireOwnerUiContext();

  return (
    <AppShell active="settings" context={context}>
      <PageHeader
        description="Owner identity, private application boundaries, and current workspace configuration."
        eyebrow="Private application"
        title="Settings"
      />

      <div className="settingsGrid">
        <section className="dashboardSection settingsPanel">
          <div className="settingsPanelHeading">
            <span><CoreIcon name="settings" /></span>
            <div><p className="coreEyebrow">Owner</p><h2>Account</h2></div>
          </div>
          <dl className="detailList">
            <div><dt>Display name</dt><dd>{context.displayName}</dd></div>
            <div><dt>Email</dt><dd>{context.email}</dd></div>
            <div><dt>Access model</dt><dd>Administratively provisioned owner account</dd></div>
            <div><dt>Public registration</dt><dd>Disabled</dd></div>
          </dl>
          <form action="/auth/signout" method="post">
            <button className="coreButton coreButton-secondary" type="submit">Sign out</button>
          </form>
        </section>

        <section className="dashboardSection settingsPanel">
          <div className="settingsPanelHeading">
            <span><CoreIcon name="building" /></span>
            <div><p className="coreEyebrow">Workspaces</p><h2>Businesses</h2></div>
          </div>
          <div className="settingsBusinessList">
            {context.businesses.map((business) => (
              <article key={business.id}>
                <div><strong>{business.name}</strong><small>Created {formatDateTime(business.created_at)}</small></div>
                <code>{business.id.slice(0, 8)}</code>
              </article>
            ))}
          </div>
          <Link className="coreButton coreButton-secondary" href="/dashboard">Manage from Dashboard</Link>
        </section>

        <section className="dashboardSection settingsPanel settingsPanel-wide">
          <div className="settingsPanelHeading">
            <span><CoreIcon name="activity" /></span>
            <div><p className="coreEyebrow">Operational boundary</p><h2>Private by design</h2></div>
          </div>
          <div className="securityPrinciples">
            <article><strong>Login first</strong><p>Signed-out visitors see only the private Agent Labs login screen.</p></article>
            <article><strong>No public onboarding</strong><p>There is no self-service registration, public homepage, or marketing surface.</p></article>
            <article><strong>Owner-scoped data</strong><p>Business workflow data remains protected by Supabase Row Level Security.</p></article>
            <article><strong>Server-only credentials</strong><p>Provider credentials are never inserted into browser JavaScript or normal Worker context.</p></article>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
