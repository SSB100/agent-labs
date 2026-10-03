import { ConsoleRetainedWorkspace } from "@/components/console/console-retained-workspace";
import Link from "next/link";
import { accountReturnHref } from "@/accounts/connection-feedback";
import { notFound, redirect } from "next/navigation";
import { loadAccountWorkspace } from "@/accounts/server";
import { BusinessAccountWorkspace, accountNoticeMessage } from "./account-workspace";
import "./accounts.css";

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
import { formatDateTime } from "@/lib/core-ui/workflows";
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
  if (process.env.AGENTLABS_GUIDED_UI !== "legacy" && first(query.diagnostics) !== "platform") {
    const businessId = first(query.business) ?? context.businesses[0]?.id;
    if (businessId && !context.businessesUnavailable && !context.businesses.some(business => business.id === businessId)) notFound();
    const notice = first(query.message), failure = first(query.error);
    if ((notice && Object.hasOwn(messages, notice)) || (failure && Object.hasOwn(errors, failure))) {
      const diagnostics = new URLSearchParams({ diagnostics: "platform" });
      if (businessId) diagnostics.set("business", businessId);
      if (notice && Object.hasOwn(messages, notice)) diagnostics.set("message", notice);
      if (failure && Object.hasOwn(errors, failure)) diagnostics.set("error", failure);
      redirect(`/dashboard/accounts?${diagnostics.toString()}`);
    }
    if (businessId) redirect(accountReturnHref(businessId, { returnTo: first(query.returnTo), runId: first(query.connectionRun) ?? first(query.run), message: first(query.accountMessage), provider: first(query.provider) }));
    redirect("/dashboard?view=connections");
  }
  const message = messages[first(query.message) ?? ""];
  const error = errors[first(query.error) ?? ""];
  const browserConfigured = isDefaultBrowserProviderConfigured();
  const requestedBusiness = first(query.business);
  if (requestedBusiness && !context.businessesUnavailable && !context.businesses.some(business => business.id === requestedBusiness)) notFound();
  const selectedBusiness = context.businesses.find(b => b.id === requestedBusiness) ?? context.businesses[0];
  const accountWorkspace = selectedBusiness ? await loadAccountWorkspace(context, selectedBusiness.id) : null;
  const selectedRequestId = first(query.connectionRun) ?? first(query.run);
  const selectedRequest = accountWorkspace?.runs.find(run => run.id === selectedRequestId);
  const messageProvider = selectedRequest?.provider ?? (first(query.provider) === "etsy" ? "etsy" : "printful");
  const accountMessage = accountNoticeMessage(accountWorkspace, messageProvider, selectedRequestId, first(query.accountMessage));

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
      status: isSupabaseConfigured() ? "configured" : "not_configured",
    },
    {
      name: "Vercel Workflow",
      description: "Durable workflow execution, waiting, retries, and resumable owner review.",
      status: isWorkflowRuntimeConfigured() ? "configured" : "not_configured",
    },
    {
      name: "OpenRouter",
      description: "Qualified model routing, structured output, fallback, tokens, and cost telemetry.",
      status: isOpenRouterConfigured() ? "configured" : "not_configured",
    },
    {
      name: "Steel Browser",
      description: "Remote Chromium, persistent profiles, live control, Playwright, upload, and replay.",
      status: browserConfigured ? "configured" : "not_configured",
    },
  ];

  return (
    <AppShell toolDestination="diagnostics" active="accounts" context={context} navigationBusinessId={selectedBusiness?.id}><ConsoleRetainedWorkspace ownerId={context.userId}  header={<><PageHeader
        description="Inspect saved provider configuration and bounded operational evidence."
        eyebrow="System tools"
        title="Platform diagnostics"
      />
{message ? <p className="coreNotice coreNotice-success" role="status">{message}</p> : null}
{error ? <p className="coreNotice coreNotice-danger" role="alert">{error}</p> : null}
{accountMessage ? <p className="coreNotice" role="status">{accountMessage}</p> : null}
{context.businesses.length > 1 ? <form method="get" className="accountProvider"><input type="hidden" name="diagnostics" value="platform" /><label>Business <select name="business" defaultValue={selectedBusiness?.id}>{context.businesses.map(b => <option value={b.id} key={b.id}>{b.name}</option>)}</select></label><button className="coreButton" type="submit">Switch Business</button></form> : null}</>} panels={[{ id: "diagnostics", label: "Platform diagnostics", content: <><details className="guidedDisclosure" open><summary>Advanced platform diagnostics<span>Configuration, browser providers and qualification tools</span></summary>
      <section className="dashboardSection">
        <div className="sectionTitleRow">
          <div><p className="coreEyebrow">System services</p><h2>Configured services</h2></div>
          <span className="coreCount">{coreServices.filter((service) => service.status === "configured").length}/4</span>
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

      </details></> },
{ id: "requests", label: "Account requests", content: <>{accountWorkspace ? <BusinessAccountWorkspace data={accountWorkspace} /> : <p>{context.businessesUnavailable ? "Business records could not be checked. Reload before starting account setup." : "Create a Business before setting up external accounts."}</p>}</> },
{ id: "etsy", label: "Etsy operations", content: <><section className="dashboardSection" aria-labelledby="etsy-account-title">
        <div className="sectionTitleRow"><div><p className="coreEyebrow">Draft-only capability</p><h2 id="etsy-account-title">Etsy drafts</h2></div><StatusPill status="experimental" /></div>
        <div className="browserQualificationPanel"><div><h3>Prepare listings from approved products</h3><p>Connect your shop securely, approve a qualified product, and track verified draft preparation. Upstream product and artwork checks remain required.</p><small>Public activation, orders and paid actions are unavailable.</small></div><Link className="coreButton coreButton-primary" href={`/dashboard/etsy${selectedBusiness ? `?business=${selectedBusiness.id}` : ""}`}>Open Etsy drafts</Link></div>
      </section></> },
{ id: "printful", label: "Printful operations", content: <><section className="dashboardSection" aria-labelledby="printful-account-title">
        <div className="sectionTitleRow">
          <div><p className="coreEyebrow">Stage 15 foundation</p><h2 id="printful-account-title">Print fulfilment · Printful</h2></div>
          <StatusPill status="experimental" />
        </div>
        <div className="browserQualificationPanel">
          <div>
            <p className="coreEyebrow">Secure account setup · Live product qualification open</p>
            <h3>Catalog, configuration and pricing preview</h3>
            <p>Connect and verify your intended store above, then explore synthetic product and pricing scenarios. A verified account does not qualify product execution.</p>
            <small>Real configuration requires a current reviewed TEST, production-asset approval and separate owner configuration authority. No products or orders are created by this preview.</small>
          </div>
          <div className="browserQualificationActions">
            <Link className="coreButton coreButton-primary" href={`/dashboard/printful${selectedBusiness ? `?business=${selectedBusiness.id}` : ""}`}>Open Printful workspace</Link>
            <small>Product execution remains separately gated</small>
          </div>
        </div>
      </section></> }]} /></AppShell>
  );
}
