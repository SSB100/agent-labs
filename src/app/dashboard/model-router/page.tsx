import { AppShell } from "@/components/stage7/app-shell";
import { ConsoleRetainedWorkspace, ConsoleRecentRows } from "@/components/console/console-retained-workspace";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { isOpenRouterConfigured } from "../../../models/openrouter";
import { MODEL_ROUTER_RUNTIME_WORKFLOW_DEFINITION_ID } from "../../../workflows/model-router-runtime";

import { startModelRouterProof } from "./actions";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type Business = { id: string; name: string };
type Model = {
  id: string;
  model_key: string;
  display_name: string;
  provider_family: string;
  provider_model_id: string;
  tier: string;
  status: string;
  context_window_tokens: number;
  input_price_per_million_usd: number | string;
  output_price_per_million_usd: number | string;
};
type Route = {
  id: string;
  route_key: string;
  name: string;
  status: string;
  primary_model_definition_id: string;
  fallback_model_definition_id: string;
  maximum_attempts: number;
};
type Run = {
  id: string;
  business_id: string;
  status: string;
  current_stage_key: string | null;
  input: Record<string, unknown>;
  state: Record<string, unknown>;
  runtime_run_id: string | null;
  created_at: string;
  completed_at: string | null;
};
type Invocation = {
  id: string;
  workflow_run_id: string;
  model_definition_id: string;
  attempt: number;
  status: string;
  provider_model_id: string;
  failure_category: string | null;
  input_tokens: number;
  output_tokens: number;
  provider_request_id: string | null;
  reported_cost_usd: number | string | null;
  estimated_cost_usd: number | string;
  latency_ms: number | null;
};

const ACTIVE = new Set(["queued", "running", "waiting", "review", "needs_owner"]);
const messages: Record<string, string> = {
  "model-router-live-started": "Live OpenRouter proof started.",
  "model-router-fallback-started":
    "Fallback proof started. The primary route will fail once by design, then the independent fallback will run.",
  "model-router-duplicate-prevented":
    "A duplicate launch was prevented. The existing Workflow Run remains authoritative.",
};
const errors: Record<string, string> = {
  "business-not-found": "The selected Business is unavailable.",
  "invalid-model-router-launch": "The Model Router launch request was invalid.",
  "model-router-launch-failed": "The Model Router workflow could not be started.",
  "model-router-not-configured":
    "OPENROUTER_API_KEY is not configured in the server runtime.",
  "model-router-reservation-failed": "The Model Router workflow could not be reserved.",
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function humanize(value: string | null) {
  return (value ?? "queued")
    .split(/[._-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatUsd(value: number) {
  return value > 0 && value < 0.000001 ? "< US$0.000001" : `US$${value.toFixed(6)}`;
}

function formatDate(value: string | null) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat("en-NZ", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function ModelRouterPage({ searchParams }: Props) {
  const context = await requireOwnerUiContext();
  const supabase = context.supabase;
  const query = await searchParams;
  const selectedBusinessId = first(query.business);
  if (query.business && (Array.isArray(query.business) || !context.businesses.some(b=>b.id===selectedBusinessId))) notFound();
  const exactRunId = first(query.run);
  if (query.run && (Array.isArray(query.run) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(exactRunId ?? ""))) notFound();

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (claimsError || !userId) redirect("/login?error=session-required");

  const [businessResult, modelResult, routeResult] = await Promise.all([
    supabase
      .from("businesses")
      .select("id, name")
      .eq("owner_user_id", userId)
      .order("created_at", { ascending: false }),
    supabase
      .from("model_definitions")
      .select(
        "id, model_key, display_name, provider_family, provider_model_id, tier, status, context_window_tokens, input_price_per_million_usd, output_price_per_million_usd",
      )
      .order("model_key").limit(100),
    supabase
      .from("model_routes")
      .select(
        "id, route_key, name, status, primary_model_definition_id, fallback_model_definition_id, maximum_attempts",
      )
      .order("route_key").limit(100),
  ]);

  const businesses = ((businessResult.data ?? []) as Business[]).filter(b=>!selectedBusinessId || b.id===selectedBusinessId);
  const models = (modelResult.data ?? []) as Model[];
  const routes = (routeResult.data ?? []) as Route[];
  const businessIds = businesses.map((business) => business.id);
  let runs: Run[] = [];
  let invocations: Invocation[] = [];
  let loadError = Boolean(businessResult.error || modelResult.error || routeResult.error);

  if (businessIds.length) {
    let runRead = supabase
      .from("workflow_runs")
      .select(
        "id, business_id, status, current_stage_key, input, state, runtime_run_id, created_at, completed_at",
      )
      .eq("workflow_definition_id", MODEL_ROUTER_RUNTIME_WORKFLOW_DEFINITION_ID)
      .in("business_id", businessIds)
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .limit(exactRunId ? 2 : 30);
    if (exactRunId) runRead = runRead.eq("id",exactRunId);
    const runResult = await runRead;
    if (exactRunId && !runResult.error && !runResult.data?.length) notFound();
    runs = (runResult.data ?? []) as Run[];
    loadError ||= Boolean(runResult.error);

    if (runs.length) {
      const invocationResult = await supabase
        .from("model_invocations")
        .select(
          "id, workflow_run_id, model_definition_id, attempt, status, provider_model_id, failure_category, input_tokens, output_tokens, provider_request_id, reported_cost_usd, estimated_cost_usd, latency_ms",
        )
        .in(
          "workflow_run_id",
          runs.map((run) => run.id),
        )
        .order("attempt");
      invocations = (invocationResult.data ?? []) as Invocation[];
      loadError ||= Boolean(invocationResult.error);
    }
  }

  const businessById = new Map(businesses.map((business) => [business.id, business]));
  const modelById = new Map(models.map((model) => [model.id, model]));
  const invocationsByRun = new Map<string, Invocation[]>();
  for (const invocation of invocations) {
    const entries = invocationsByRun.get(invocation.workflow_run_id) ?? [];
    entries.push(invocation);
    invocationsByRun.set(invocation.workflow_run_id, entries);
  }

  const totalCost = invocations.reduce(
    (sum, invocation) =>
      sum + (invocation.provider_request_id ? numberValue(invocation.reported_cost_usd) : 0),
    0,
  );
  const activeCount = runs.filter((run) => ACTIVE.has(run.status)).length;
  const fallbackCount = runs.filter(
    (run) => numberValue(run.state.routeAttemptCount) > 1,
  ).length;
  const configured = isOpenRouterConfigured();
  const message = messages[first(query.message) ?? ""];
  const error = errors[first(query.error) ?? ""];

  return (<AppShell active="settings" toolDestination="model-router" context={context} navigationBusinessId={selectedBusinessId}><ConsoleRetainedWorkspace ownerId={context.userId} notice={<p className="coreNotice">Loaded window: up to 100 models, 100 routes and 30 runs. Earlier history and complete totals remain pending R06.</p>} header={<><header className="workspaceHeader">
          <div className="workspaceTitle"><p>Model routing</p><h1>Model Router</h1></div>
          <Link className="ghostButton" href={`/dashboard?view=overview${selectedBusinessId ? `&business=${selectedBusinessId}` : ""}`}>Back</Link>
        </header>
{message ? <p className="notice success" role="status">{message}</p> : null}
{error ? <p className="notice error" role="alert">{error}</p> : null}
{!configured ? (
          <p className="notice error" role="alert">
            Live proof launch is unavailable. Provider activation requires a separate authorized configuration gate.
          </p>
        ) : null}
{loadError ? <p className="notice error">Some Model Router records could not be loaded.</p> : null}</>} panels={[{ id: "history", label: "Proof receipts", content: <><section className="summaryGrid" aria-label="Model Router summary">
          {[
            ["Qualified routes", routes.filter((route) => route.status === "qualified").length],
            ["Loaded models", models.length],
            ["Active in loaded proofs", activeCount],
            ["Fallback in loaded proofs", fallbackCount],
          ].map(([label, value]) => (
            <article className="summaryCard" key={String(label)}>
              <span className="summaryLabel">{label}</span>
              <strong className="summaryValue">{value}</strong>
            </article>
          ))}
          <article className="summaryCard">
            <span className="summaryLabel">Loaded reported charges</span><p>{invocations.filter(i=>i.reported_cost_usd==null || !i.provider_request_id).length} unknown charge(s); estimates do not settle them.</p>
            <strong style={{ fontSize: "1.3rem" }}>{loadError ? "Unavailable" : formatUsd(totalCost)}</strong>
          </article>
        </section>
<section className="operationsPanel" aria-labelledby="runs-heading">
          <div className="panelHeading workflowHeading">
            <div><p className="panelLabel">Durable telemetry</p><h2 id="runs-heading">Model proof history</h2></div>
            <span className="countBadge">{runs.length}</span>
          </div>
          {runs.length ? (
            <div className="workflowList">
              <ConsoleRecentRows label="Recent loaded model-router records" rows={runs.map((run) => {
                const attempts = invocationsByRun.get(run.id) ?? [];
                const runCost = attempts.reduce(
                  (sum, attempt) => sum + (attempt.provider_request_id ? numberValue(attempt.reported_cost_usd) : 0),
                  0,
                );
                return (
                  <details className="workflowCard" key={run.id} open={exactRunId===run.id}><summary><strong>{humanize(String(run.input.proofMode ?? "saved"))} proof · {run.id}</strong><span>{humanize(run.status)} · {loadError ? "Receipts unavailable" : attempts.length ? <>Loaded reported {formatUsd(runCost)} · {attempts.filter(a=>a.reported_cost_usd==null || !a.provider_request_id).length} unknown charge(s)</> : "No receipts returned in this loaded window"}</span></summary><div>
                    <div className="workflowCardHeader">
                      <div>
                        <p className="workflowBusiness">{businessById.get(run.business_id)?.name ?? "Business"}</p>
                        <h3>{humanize(String(run.input.proofMode ?? "live"))} model proof</h3>
                        <p>Started {formatDate(run.created_at)} · Stage {humanize(run.current_stage_key)}</p>
                      </div>
                      <span className={`workflowStatus status-${run.status}`}>{humanize(run.status)}</span>
                    </div>
                    <ol className="stageTimeline" aria-label="Model attempts">
                      {attempts.map((attempt) => (
                        <li className={`stageState stage-${attempt.status}`} key={attempt.id}>
                          <span className="stageMarker" aria-hidden="true" />
                          <div>
                            <strong>Attempt {attempt.attempt}: {modelById.get(attempt.model_definition_id)?.display_name ?? attempt.provider_model_id}</strong>
                            <small>
                              {humanize(attempt.status)} · {attempt.input_tokens + attempt.output_tokens} tokens · {(attempt.reported_cost_usd == null || !attempt.provider_request_id) ? "Charge unknown" : formatUsd((attempt.provider_request_id ? numberValue(attempt.reported_cost_usd) : 0))} · estimate {formatUsd(numberValue(attempt.estimated_cost_usd))}{!attempt.provider_request_id && attempt.reported_cost_usd!=null ? ` · unverified saved amount ${formatUsd(numberValue(attempt.reported_cost_usd))}, excluded from reported charges` : ""}
                              {attempt.failure_category ? ` · ${humanize(attempt.failure_category)}` : ""}
                            </small>
                          </div>
                        </li>
                      ))}
                    </ol>
                    <div className="eventHistoryHeader">
                      <strong>Loaded reported {formatUsd(runCost)}</strong>
                      <small>{run.runtime_run_id ? `Runtime ${run.runtime_run_id.slice(0, 18)}…` : "Runtime pending"}</small>
                    </div><Link className="coreButton" href={`/dashboard/model-router?business=${run.business_id}&run=${run.id}&panel=history`}>Open exact proof receipts</Link>
                  </div></details>
                );
              })} />
            </div>
          ) : (
            <div className="operationEmpty">
              <strong>No model proofs in this loaded window.</strong>
              <span>Configure OpenRouter, then run a live proof or bounded fallback proof.</span>
            </div>
          )}
        </section></> },
{ id: "routes", label: "Routes", content: <><section className="operationsPanel">
          <div className="panelHeading workflowHeading">
            <div><p className="panelLabel">Logical policy</p><h2>Qualified routes</h2></div>
            <span className="countBadge">{routes.length}</span>
          </div>
          <div className="businessList">
            <ConsoleRecentRows label="Recent loaded model-router records" rows={routes.map((route) => {
              const primary = modelById.get(route.primary_model_definition_id);
              const fallback = modelById.get(route.fallback_model_definition_id);
              return (
                <article className="businessCard" key={route.id}>
                  <div>
                    <h3>{route.name}</h3>
                    <p>{route.route_key}</p>
                    <p>{primary?.display_name ?? "Unavailable"} → {fallback?.display_name ?? "Unavailable"}</p>
                  </div>
                  <div className="businessActions">
                    <span>{humanize(route.status)}</span>
                    <small>Maximum {route.maximum_attempts} attempts</small>
                  </div>
                </article>
              );
            })} />
          </div>
        </section></> },
{ id: "models", label: "Models", content: <><section className="operationsPanel">
          <div className="panelHeading workflowHeading">
            <div><p className="panelLabel">Capabilities and price metadata</p><h2>Model registry</h2></div>
            <span className="countBadge">{models.length}</span>
          </div>
          <div className="businessList">
            <ConsoleRecentRows label="Recent loaded model-router records" rows={models.map((model) => (
              <article className="businessCard" key={model.id}>
                <div>
                  <h3>{model.display_name}</h3>
                  <p>{model.provider_model_id}</p>
                  <p>{humanize(model.tier)} · {model.context_window_tokens.toLocaleString("en-NZ")} context tokens</p>
                </div>
                <div className="businessActions">
                  <span>{humanize(model.status)}</span>
                  <small>Input US${numberValue(model.input_price_per_million_usd).toFixed(2)}/M</small>
                  <small>Output US${numberValue(model.output_price_per_million_usd).toFixed(2)}/M</small>
                </div>
              </article>
            ))} />
          </div>
        </section></> },
{ id: "launch", label: "Launch proof", content: <><section className="dashboardGrid">
          <article className="businessPanel">
            <div className="panelHeading">
              <div><p className="panelLabel">Live execution</p><h2>Run a proof</h2></div>
              <span className="countBadge">{businesses.length}</span>
            </div>
            <div className="businessList">
              {businesses.map((business) => (
                <article className="businessCard" key={business.id}>
                  <div><h3>{business.name}</h3><p>Uses logical route standard.default.</p></div>
                  <div className="businessActions">
                    {(["live", "fallback-proof"] as const).map((proofMode) => (
                      <form action={startModelRouterProof} key={proofMode}>
                        <input name="businessId" type="hidden" value={business.id} />
                        <input name="proofMode" type="hidden" value={proofMode} />
                        <input name="idempotencyKey" type="hidden" value={`stage5:${proofMode}:${crypto.randomUUID()}`} />
                        <input name="launchNonce" type="hidden" value={crypto.randomUUID()} />
                        <button className="compactButton" disabled={!configured} type="submit">
                          {proofMode === "live" ? "Run live proof" : "Run fallback proof"}
                        </button>
                      </form>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </article>

          <aside className="createPanel">
            <p className="panelLabel">Policy</p>
            <h2>Bounded routing</h2>
            <p>Each route has one qualified primary and one independent fallback.</p>
            <div className="runtimeReadiness">
              <span className={configured ? "runtimeDot ready" : "runtimeDot"} />
              <p>OpenRouter {configured ? "configured" : "needs configuration"}</p>
            </div>
          </aside>
        </section></> }]} /></AppShell>
  );
}
