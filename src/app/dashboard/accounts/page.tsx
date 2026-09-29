import { AppShell, EmptyPanel, PageHeader, StatusPill } from "@/components/stage7/app-shell";
import { CoreIcon } from "@/components/stage7/icons";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { isOpenRouterConfigured } from "@/models/openrouter";
import { isSupabaseConfigured, isWorkflowRuntimeConfigured } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const context = await requireOwnerUiContext();

  const coreServices = [
    {
      name: "Supabase",
      description: "Authentication, durable state, Realtime, RLS, and workflow history.",
      status: isSupabaseConfigured() ? "connected" : "not_configured",
    },
    {
      name: "Vercel Workflow",
      description: "Durable workflow execution, waiting, retries, and resumable owner review.",
      status: isWorkflowRuntimeConfigured() ? "connected" : "not_configured",
    },
    {
      name: "OpenRouter",
      description: "Qualified model routing, structured output, fallback, tokens, and cost telemetry.",
      status: isOpenRouterConfigured() ? "connected" : "not_configured",
    },
  ];

  const futureAccounts = [
    ["Browser provider", "Live browser sessions, takeover, return control, and replay."],
    ["Etsy", "Listings, orders, shop health, and marketplace operations."],
    ["Print fulfilment", "Product configuration, order routing, production, and shipping."],
    ["Social accounts", "Publishing, performance measurement, and connected campaign activity."],
  ];

  return (
    <AppShell active="accounts" context={context}>
      <PageHeader
        description="Core infrastructure is connected. External business accounts will be added through qualified capability packs."
        eyebrow="Connections"
        title="Accounts"
      />

      <section className="dashboardSection">
        <div className="sectionTitleRow">
          <div><p className="coreEyebrow">System services</p><h2>Core connections</h2></div>
          <span className="coreCount">{coreServices.filter((service) => service.status === "connected").length}/3</span>
        </div>
        <div className="connectionGrid">
          {coreServices.map((service) => (
            <article className="connectionCard" key={service.name}>
              <div className="connectionCardTop">
                <span><CoreIcon name="accounts" /></span>
                <StatusPill status={service.status} />
              </div>
              <h3>{service.name}</h3>
              <p>{service.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="dashboardSection">
        <div className="sectionTitleRow">
          <div><p className="coreEyebrow">External providers</p><h2>Business accounts</h2></div>
          <span className="coreCount">0</span>
        </div>
        <EmptyPanel icon="accounts" title="No external accounts connected">
          <p>
            Browser, marketplace, fulfilment, and social connections will appear here after their capability providers are qualified. Secrets will remain outside normal model context.
          </p>
        </EmptyPanel>
        <div className="futureConnectionList">
          {futureAccounts.map(([name, description]) => (
            <article key={name}>
              <span className="futureConnectionDot" aria-hidden="true" />
              <div><strong>{name}</strong><p>{description}</p></div>
              <small>Not installed</small>
            </article>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
