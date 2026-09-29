import Link from "next/link";

import {
  browserProviderStatus,
  getDefaultBrowserProviderKey,
} from "@/browser";
import {
  AppShell,
  EmptyPanel,
  PageHeader,
  StatusPill,
} from "@/components/stage7/app-shell";
import { CoreIcon } from "@/components/stage7/icons";
import { loadBrowserControlCentre } from "@/lib/core-ui/browser";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { formatDateTime, humanize } from "@/lib/core-ui/workflows";

import { startBrowserQualification } from "./actions";

export const dynamic = "force-dynamic";

type BrowserPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const messages: Record<string, string> = {
  "browser-control-returned": "Browser control returned. Automation is reconnecting.",
  "browser-control-taken": "Human control enabled for the live browser session.",
};

const errors: Record<string, string> = {
  "browser-control-resume-failed": "The browser workflow could not resume.",
  "browser-intervention-not-open": "That browser control request is no longer open.",
  "browser-provider-not-configured": "The selected browser provider is not configured in Vercel.",
  "browser-reservation-failed": "The browser qualification workflow could not be reserved.",
  "browser-session-not-found": "The browser session is unavailable.",
  "browser-workflow-launch-failed": "The browser workflow could not start.",
  "business-not-found": "The selected Business is unavailable.",
  "invalid-browser-control-decision": "The browser control decision was invalid.",
  "invalid-browser-launch": "The browser launch request was invalid.",
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function capabilityCount(capabilities: Record<string, unknown>) {
  return Object.values(capabilities).filter(Boolean).length;
}

export default async function BrowserPage({ searchParams }: BrowserPageProps) {
  const context = await requireOwnerUiContext();
  const data = await loadBrowserControlCentre(context);
  const configuration = browserProviderStatus();
  const selectedProvider = getDefaultBrowserProviderKey();
  const query = await searchParams;
  const message = messages[first(query.message) ?? ""];
  const error = errors[first(query.error) ?? ""];

  const providerById = new Map(data.providers.map((provider) => [provider.id, provider]));
  const businessById = new Map(context.businesses.map((business) => [business.id, business]));
  const liveSessions = data.sessions.filter((session) =>
    ["launching", "live", "human_control", "returning"].includes(session.status),
  );

  return (
    <AppShell active="browser" context={context}>
      <PageHeader
        description="Provider-neutral remote Chromium sessions with Playwright, persistent identities, live viewing, human takeover, return control, and replay."
        eyebrow="Stage 8"
        title="Browser"
      />

      {message ? <p className="coreNotice coreNotice-success" role="status">{message}</p> : null}
      {error ? <p className="coreNotice coreNotice-danger" role="alert">{error}</p> : null}
      {data.errors.length ? (
        <p className="coreNotice coreNotice-danger" role="alert">
          Some browser provider records could not be loaded.
        </p>
      ) : null}
      {!configuration.selectedConfigured ? (
        <p className="coreNotice coreNotice-danger" role="alert">
          {selectedProvider === "steel"
            ? "Add STEEL_API_KEY to Vercel Preview and Production before launching the live qualification."
            : "Add the Browserbase API key and project ID before launching the live qualification."}
        </p>
      ) : null}

      <section className="browserProviderHero">
        <div>
          <p className="coreEyebrow">Selected default</p>
          <h2>{selectedProvider === "steel" ? "Steel" : "Browserbase"}</h2>
          <p>
            Steel is selected by default for complete Stage 8 capability coverage, low entry cost,
            and a self-hosting path. Browserbase remains replaceable behind the same Core contract.
          </p>
        </div>
        <div className="browserProviderReadiness">
          <span className={configuration.selectedConfigured ? "systemPulse systemPulse-ready" : "systemPulse"} />
          <div>
            <strong>{configuration.selectedConfigured ? "Provider configured" : "Provider key required"}</strong>
            <small>{liveSessions.length} live session{liveSessions.length === 1 ? "" : "s"}</small>
          </div>
        </div>
      </section>

      <section className="connectionGrid browserProviderGrid">
        {data.providers.map((provider) => {
          const capabilities = provider.capabilities ?? {};
          const pricing = provider.pricing ?? {};
          return (
            <article className={provider.is_default ? "connectionCard browserProviderCard browserProviderCard-selected" : "connectionCard browserProviderCard"} key={provider.id}>
              <div className="connectionCardTop">
                <span><CoreIcon name="browser" /></span>
                <StatusPill status={provider.is_default ? "selected" : provider.status} />
              </div>
              <h3>{provider.name}</h3>
              <p>
                {capabilityCount(capabilities)} declared browser capabilities · {humanize(provider.status)}
              </p>
              <dl className="browserProviderFacts">
                <div><dt>Monthly</dt><dd>US${numberValue(pricing.launchMonthlyUsd ?? pricing.developerMonthlyUsd).toFixed(0)}</dd></div>
                <div><dt>Browser hour</dt><dd>US${numberValue(pricing.launchBrowserHourUsd ?? pricing.developerOverageBrowserHourUsd).toFixed(2)}</dd></div>
                <div><dt>Persistent identity</dt><dd>{capabilities.persistentProfiles ? "Yes" : "No"}</dd></div>
                <div><dt>Self-hostable</dt><dd>{capabilities.selfHostable ? "Yes" : "No"}</dd></div>
              </dl>
            </article>
          );
        })}
      </section>

      <div className="dashboardColumns browserLaunchColumns">
        <section className="dashboardSection">
          <div className="sectionTitleRow">
            <div><p className="coreEyebrow">Qualification workflow</p><h2>Launch an isolated session</h2></div>
            <span className="coreCount">{context.businesses.length}</span>
          </div>
          <p className="browserSectionCopy">
            The workflow opens one isolated remote browser, uploads a fixture, pauses for your takeover,
            verifies returned control, releases the provider session, and preserves replay evidence.
          </p>

          {context.businesses.length ? (
            <div className="businessWorkspaceList browserBusinessList">
              {context.businesses.map((business) => (
                <article key={business.id}>
                  <span className="businessGlyph"><CoreIcon name="building" /></span>
                  <div>
                    <h3>{business.name}</h3>
                    <p>Persistent identity remains scoped to this Business.</p>
                  </div>
                  <form action={startBrowserQualification}>
                    <input name="businessId" type="hidden" value={business.id} />
                    <input name="idempotencyKey" type="hidden" value={`stage8:${crypto.randomUUID()}`} />
                    <input name="launchNonce" type="hidden" value={crypto.randomUUID()} />
                    <button className="coreButton coreButton-primary coreButton-small" disabled={!configuration.selectedConfigured || liveSessions.length > 0} type="submit">
                      {liveSessions.length ? "Session already active" : "Run browser qualification"}
                    </button>
                  </form>
                </article>
              ))}
            </div>
          ) : (
            <EmptyPanel icon="building" title="Create a Business first">
              <p>The persistent browser identity must belong to an owner-scoped Business.</p>
            </EmptyPanel>
          )}
        </section>

        <section className="dashboardSection">
          <div className="sectionTitleRow">
            <div><p className="coreEyebrow">Security boundary</p><h2>What stays hidden</h2></div>
            <CoreIcon name="settings" />
          </div>
          <div className="securityPrinciples browserSecurityPrinciples">
            <article><strong>Provider keys</strong><p>Server-only environment variables, never normal application rows.</p></article>
            <article><strong>CDP endpoint</strong><p>Stored in the private schema and available only to one capability-gated workflow.</p></article>
            <article><strong>Live viewer</strong><p>Returned only after owner authorization. Interactive mode requires human control state.</p></article>
            <article><strong>Identity</strong><p>Only an opaque Business-scoped profile ID is persisted.</p></article>
          </div>
        </section>
      </div>

      <section className="dashboardSection">
        <div className="sectionTitleRow">
          <div><p className="coreEyebrow">Durable sessions</p><h2>Browser history</h2></div>
          <span className="coreCount">{data.sessions.length}</span>
        </div>

        {data.sessions.length ? (
          <div className="browserSessionList">
            {data.sessions.map((session) => {
              const provider = providerById.get(session.provider_definition_id);
              return (
                <Link href={`/dashboard/workflows/${session.workflow_run_id}`} key={session.id}>
                  <span className={`browserSessionDot browserSessionDot-${session.status}`} aria-hidden="true" />
                  <span>
                    <strong>{provider?.name ?? "Browser provider"}</strong>
                    <small>{businessById.get(session.business_id)?.name ?? "Business"} · {session.page_title ?? session.current_url ?? "Session reserved"}</small>
                  </span>
                  <span>
                    <StatusPill status={session.status} />
                    <small>{formatDateTime(session.released_at ?? session.updated_at)}</small>
                  </span>
                </Link>
              );
            })}
          </div>
        ) : (
          <EmptyPanel icon="browser" title="No remote browser sessions yet">
            <p>Run the controlled Stage 8 qualification to create the first durable session.</p>
          </EmptyPanel>
        )}
      </section>
    </AppShell>
  );
}
