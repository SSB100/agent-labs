import Link from "next/link";

import {
  startBrowserPlannerQualification,
  startBrowserQualification,
} from "@/app/dashboard/browser-actions";
import {
  BROWSER_PROVIDER_COMPARISON,
  isDefaultBrowserProviderConfigured,
} from "@/browser/registry";
import type {
  BrowserProviderDefinitionRecord,
  BrowserSessionRecord,
} from "@/browser/ui";
import { AppShell, PageHeader, StatusPill } from "@/components/stage7/app-shell";
import { CoreIcon } from "@/components/stage7/icons";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { formatDateTime, humanize } from "@/lib/core-ui/workflows";
import { isOpenRouterConfigured } from "@/models/openrouter";
import {
  isSupabaseConfigured,
  isWorkflowRuntimeConfigured,
} from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

type AccountsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type BrowserPlannerDefinitionRecord = {
  id: string;
  planner_key: string;
  version: string;
  name: string;
  status: string;
  model_route_key: string;
  qualification: Record<string, unknown>;
};

type BrowserPlannerCaseRecord = {
  id: string;
  case_key: string;
  level: string;
  status: string;
  score: number | string | null;
};

const messages: Record<string, string> = {
  "browser-workflow-started": "Browser provider qualification started.",
  "browser-planner-workflow-started": "Browser Planner qualification started.",
};

const errors: Record<string, string> = {
  "browser-provider-not-configured":
    "STEEL_API_KEY is not configured for this Vercel environment.",
  "browser-reservation-failed": "The browser qualification could not be reserved.",
  "browser-planner-reservation-failed": "The Browser Planner qualification could not be reserved.",
  "browser-planner-launch-failed": "The Browser Planner workflow could not launch.",
  "invalid-browser-planner-launch": "The Browser Planner qualification request was invalid.",
  "business-not-found": "The selected Business is unavailable.",
  "invalid-browser-launch": "The browser qualification request was invalid.",
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function rows<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function record<T>(value: unknown): T | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as T)
    : null;
}

export default async function AccountsPage({ searchParams }: AccountsPageProps) {
  const context = await requireOwnerUiContext();
  const query = await searchParams;
  const message = messages[first(query.message) ?? ""];
  const error = errors[first(query.error) ?? ""];
  const browserConfigured = isDefaultBrowserProviderConfigured();

  const [providerResult, sessionResult, plannerResult, plannerCaseResult] = await Promise.all([
    context.supabase
      .from("browser_provider_definitions")
      .select(
        "id, provider_key, name, status, is_default, api_base_url, capabilities, pricing, evaluation, created_at, updated_at",
      )
      .order("is_default", { ascending: false }),
    context.businesses.length
      ? context.supabase
          .from("browser_sessions")
          .select(
            "id, business_id, workflow_run_id, provider_definition_id, browser_identity_id, provider_session_id, status, control_mode, live_view_status, replay_status, current_url, page_title, region, browser_mode, metadata, failure, started_at, released_at, created_at, updated_at",
          )
          .in(
            "business_id",
            context.businesses.map((business) => business.id),
          )
          .order("created_at", { ascending: false })
          .limit(12)
      : Promise.resolve({ data: [], error: null }),
    context.supabase
      .from("browser_planner_definitions")
      .select("id, planner_key, version, name, status, model_route_key, qualification")
      .eq("planner_key", "browser.planner")
      .eq("version", "1.0.0")
      .maybeSingle(),
    context.supabase
      .from("browser_planner_qualification_cases")
      .select("id, case_key, level, status, score")
      .order("level"),
  ]);
  const providers = rows<BrowserProviderDefinitionRecord>(providerResult.data);
  const sessions = rows<BrowserSessionRecord>(sessionResult.data);
  const planner = record<BrowserPlannerDefinitionRecord>(plannerResult.data);
  const plannerCases = rows<BrowserPlannerCaseRecord>(plannerCaseResult.data);
  const plannerPassed = plannerCases.filter((entry) => entry.status === "passed").length;
  const providerById = new Map(providers.map((provider) => [provider.id, provider]));
  const businessById = new Map(context.businesses.map((business) => [business.id, business]));

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
    {
      name: "Steel Browser",
      description: "Remote Chromium, persistent profiles, live control, Playwright, upload, and replay.",
      status: browserConfigured ? "connected" : "not_configured",
    },
  ];

  return (
    <AppShell active="accounts" context={context}>
      <PageHeader
        description="Core infrastructure and qualified external providers remain visible without exposing provider credentials to workers."
        eyebrow="Connections"
        title="Accounts"
      />

      {message ? <p className="coreNotice coreNotice-success" role="status">{message}</p> : null}
      {error ? <p className="coreNotice coreNotice-danger" role="alert">{error}</p> : null}

      <section className="dashboardSection">
        <div className="sectionTitleRow">
          <div><p className="coreEyebrow">System services</p><h2>Core connections</h2></div>
          <span className="coreCount">{coreServices.filter((service) => service.status === "connected").length}/4</span>
        </div>
        <div className="connectionGrid stage8ConnectionGrid">
          {coreServices.map((service) => (
            <article className="connectionCard" key={service.name}>
              <div className="connectionCardTop">
                <span><CoreIcon name={service.name === "Steel Browser" ? "browser" : "accounts"} /></span>
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
          <div><p className="coreEyebrow">Stage 8 selection</p><h2>Browser providers</h2></div>
          <span className="coreCount">{providers.length}</span>
        </div>
        <div className="browserProviderGrid">
          {providers.map((provider) => {
            const comparison = BROWSER_PROVIDER_COMPARISON[provider.provider_key];
            const liveQualified = provider.evaluation.liveQualified === true;
            return (
              <article className={provider.is_default ? "browserProviderCard browserProviderCard-selected" : "browserProviderCard"} key={provider.id}>
                <div className="connectionCardTop">
                  <span><CoreIcon name="browser" /></span>
                  <StatusPill status={liveQualified ? "qualified" : provider.status} />
                </div>
                <p className="coreEyebrow">{provider.is_default ? "Selected default" : "Replaceable alternative"}</p>
                <h3>{provider.name}</h3>
                <p>{String(provider.evaluation.reason ?? "Provider evaluated against the Stage 8 capability contract.")}</p>
                <dl className="providerFacts">
                  <div><dt>Live view</dt><dd>{comparison.liveView}</dd></div>
                  <div><dt>Replay</dt><dd>{comparison.replay}</dd></div>
                  <div><dt>Entry cost</dt><dd>{comparison.entryPrice}</dd></div>
                  <div><dt>Self-hostable</dt><dd>{comparison.selfHostable ? "Yes" : "No"}</dd></div>
                </dl>
              </article>
            );
          })}
        </div>

        <div className="browserQualificationPanel">
          <div>
            <p className="coreEyebrow">Live qualification</p>
            <h3>Prove launch, live view, takeover, return control, and replay</h3>
            <p>
              The proof opens a safe Example Domain page, validates Playwright and a file upload, then pauses twice for your direct control.
            </p>
          </div>
          <div className="browserQualificationActions">
            {context.businesses.map((business) => (
              <form action={startBrowserQualification} key={business.id}>
                <input name="businessId" type="hidden" value={business.id} />
                <input name="idempotencyKey" type="hidden" value={`stage8:${crypto.randomUUID()}`} />
                <input name="launchNonce" type="hidden" value={crypto.randomUUID()} />
                <button className="coreButton coreButton-primary" disabled={!browserConfigured} type="submit">
                  Run for {business.name}
                </button>
              </form>
            ))}
            {!browserConfigured ? (
              <small>Add STEEL_API_KEY to Preview and Production, then redeploy.</small>
            ) : null}
          </div>
        </div>
      </section>

      <section className="dashboardSection">
        <div className="sectionTitleRow">
          <div><p className="coreEyebrow">Stage 9 qualification</p><h2>Browser Planner</h2></div>
          <StatusPill status={planner?.status ?? "candidate"} />
        </div>
        <div className="browserQualificationPanel">
          <div>
            <p className="coreEyebrow">Bounded browser reasoning</p>
            <h3>Qualify observation, planning, recovery, and safe draft mutation</h3>
            <p>
              Runs the Browser Planner through synthetic recovery, mock commerce,
              a real read-only site, and a controlled draft mutation. Every model
              decision selects exactly one observed stable element or stops.
            </p>
            <small>
              {plannerPassed}/{plannerCases.length || 4} required cases passed · Route {planner?.model_route_key ?? "standard.default"}
            </small>
          </div>
          <div className="browserQualificationActions">
            {context.businesses.map((business) => (
              <form action={startBrowserPlannerQualification} key={business.id}>
                <input name="businessId" type="hidden" value={business.id} />
                <input name="idempotencyKey" type="hidden" value={`stage9:${crypto.randomUUID()}`} />
                <input name="launchNonce" type="hidden" value={crypto.randomUUID()} />
                <button
                  className="coreButton coreButton-primary"
                  disabled={!browserConfigured || !isOpenRouterConfigured()}
                  type="submit"
                >
{planner?.status === "qualified" ? "Requalify" : "Qualify"} for {business.name}
                </button>
              </form>
            ))}
            <small>
              Uses the qualified Steel browser and standard model route. Actions
              remain visible in the Workflow Live Browser workspace.
            </small>
          </div>
        </div>
      </section>

      <section className="dashboardSection">
        <div className="sectionTitleRow">
          <div><p className="coreEyebrow">Browser history</p><h2>Remote sessions</h2></div>
          <span className="coreCount">{sessions.length}</span>
        </div>
        {sessions.length ? (
          <div className="browserSessionList">
            {sessions.map((session) => (
              <Link href={`/dashboard/workflows/${session.workflow_run_id}`} key={session.id}>
                <span className={`browserControlDot browserControlDot-${session.control_mode}`} />
                <div>
                  <strong>{session.page_title ?? "Remote Chromium session"}</strong>
                  <small>{businessById.get(session.business_id)?.name ?? "Business"} · {providerById.get(session.provider_definition_id)?.name ?? "Provider"}</small>
                </div>
                <div>
                  <StatusPill status={session.status} />
                  <small>{formatDateTime(session.released_at ?? session.updated_at)}</small>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="sectionEmptyText">No remote browser session has been launched yet.</p>
        )}
      </section>

      <section className="dashboardSection">
        <div className="sectionTitleRow">
          <div><p className="coreEyebrow">Future account packs</p><h2>Business accounts</h2></div>
          <span className="coreCount">0</span>
        </div>
        <div className="futureConnectionList">
          {[
            ["Etsy", "Listings, orders, shop health, and marketplace operations."],
            ["Print fulfilment", "Product configuration, order routing, production, and shipping."],
            ["Social accounts", "Publishing, performance measurement, and connected campaign activity."],
          ].map(([name, description]) => (
            <article key={name}>
              <span className="futureConnectionDot" aria-hidden="true" />
              <div><strong>{name}</strong><p>{description}</p></div>
              <small>{humanize("not_installed")}</small>
            </article>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
