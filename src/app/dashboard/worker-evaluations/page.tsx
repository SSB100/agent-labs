import { AppShell } from "@/components/stage7/app-shell";
import { ConsoleRetainedWorkspace, ConsoleRecentRows } from "@/components/console/console-retained-workspace";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  GENERIC_RESEARCHER_EVALUATION_SUITE_KEY,
  GENERIC_RESEARCHER_EVALUATION_SUITE_VERSION,
} from "../../../evaluations/generic-researcher-suite";
import { isOpenRouterConfigured } from "../../../models/openrouter";
import { MODEL_RESEARCHER_WORKER_DEFINITION_ID } from "../../../workers/generic-researcher-model";

import { startWorkerEvaluation } from "./actions";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type WorkerDefinition = {
  id: string;
  worker_key: string;
  version: string;
  name: string;
  role: string;
  status: string;
  pack_id: string;
};

type EvaluationSuite = {
  id: string;
  suite_key: string;
  version: string;
  name: string;
  status: string;
  minimum_score: number | string;
  require_all_required: boolean;
};

type EvaluationCase = {
  id: string;
  case_key: string;
  name: string;
  category: string;
  execution_mode: string;
  model_target: string;
  required: boolean;
  weight: number | string;
};

type EvaluationRun = {
  id: string;
  status: string;
  score: number | string | null;
  passed_case_count: number;
  failed_case_count: number;
  required_case_count: number;
  required_failure_count: number;
  source: string;
  subject_fingerprint: string;
  started_at: string;
  completed_at: string | null;
  created_at: string;
};

type EvaluationResult = {
  id: string;
  evaluation_id: string;
  case_id: string;
  status: string;
  score_awarded: number | string;
  model_definition_id: string | null;
  provider: string | null;
  provider_model_id: string | null;
  input_tokens: number;
  output_tokens: number;
  reported_cost_usd: number | string | null;
  estimated_cost_usd: number | string;
  latency_ms: number | null;
  failure: Record<string, unknown>;
};

type ModelDefinition = {
  id: string;
  model_key: string;
  display_name: string;
};

type Promotion = {
  id: string;
  worker_definition_id: string;
  evaluation_id: string | null;
  from_status: string;
  to_status: string;
  reason: string;
  promoted_at: string;
};

const messages: Record<string, string> = {
  "evaluation-duplicate-prevented":
    "A duplicate evaluation launch was prevented. The existing run remains authoritative.",
  "worker-qualified":
    "The Generic Researcher passed every required evaluation and is now Qualified.",
};

const errors: Record<string, string> = {
  "evaluation-became-stale":
    "The Worker Pack or model route changed during evaluation. Run the current suite again.",
  "evaluation-reservation-failed": "The Worker evaluation could not be reserved.",
  "evaluation-run-failed":
    "The evaluation stopped unexpectedly. Any completed case evidence was preserved.",
  "invalid-evaluation-launch": "The evaluation launch request was invalid.",
  "model-router-not-configured":
    "OPENROUTER_API_KEY is not configured in the server runtime.",
  "worker-evaluation-failed":
    "One or more required evaluations failed. Review the case evidence before rerunning.",
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function humanize(value: string | null) {
  return (value ?? "unknown")
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

export default async function WorkerEvaluationsPage({ searchParams }: Props) {
  const context = await requireOwnerUiContext();
  const supabase = context.supabase;
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (claimsError || !userId) redirect("/login?error=session-required");

  const [workerResult, suiteResult, modelResult, promotionResult] = await Promise.all([
    supabase
      .from("worker_definitions")
      .select("id, worker_key, version, name, role, status, pack_id")
      .eq("id", MODEL_RESEARCHER_WORKER_DEFINITION_ID)
      .maybeSingle(),
    supabase
      .from("worker_evaluation_suites")
      .select(
        "id, suite_key, version, name, status, minimum_score, require_all_required",
      )
      .eq("suite_key", GENERIC_RESEARCHER_EVALUATION_SUITE_KEY)
      .eq("version", GENERIC_RESEARCHER_EVALUATION_SUITE_VERSION)
      .maybeSingle(),
    supabase
      .from("model_definitions")
      .select("id, model_key, display_name")
      .order("model_key"),
    supabase
      .from("worker_promotions")
      .select(
        "id, worker_definition_id, evaluation_id, from_status, to_status, reason, promoted_at",
      )
      .eq("worker_definition_id", MODEL_RESEARCHER_WORKER_DEFINITION_ID)
      .order("promoted_at", { ascending: false })
      .limit(10),
  ]);

  const worker = workerResult.data as WorkerDefinition | null;
  const suite = suiteResult.data as EvaluationSuite | null;
  const models = (modelResult.data ?? []) as ModelDefinition[];
  const promotions = (promotionResult.data ?? []) as Promotion[];
  let cases: EvaluationCase[] = [];
  let runs: EvaluationRun[] = [];
  let results: EvaluationResult[] = [];
  let loadError = Boolean(
    workerResult.error || suiteResult.error || modelResult.error || promotionResult.error,
  );

  if (suite) {
    const [caseResult, runResult] = await Promise.all([
      supabase
        .from("worker_evaluation_cases")
        .select(
          "id, case_key, name, category, execution_mode, model_target, required, weight",
        )
        .eq("suite_id", suite.id)
        .order("case_key"),
      supabase
        .from("worker_evaluations")
        .select(
          "id, status, score, passed_case_count, failed_case_count, required_case_count, required_failure_count, source, subject_fingerprint, started_at, completed_at, created_at",
        )
        .eq("suite_id", suite.id)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    cases = (caseResult.data ?? []) as EvaluationCase[];
    runs = (runResult.data ?? []) as EvaluationRun[];
    loadError ||= Boolean(caseResult.error || runResult.error);

    if (runs.length) {
      const resultData = await supabase
        .from("worker_evaluation_case_results")
        .select(
          "id, evaluation_id, case_id, status, score_awarded, model_definition_id, provider, provider_model_id, input_tokens, output_tokens, reported_cost_usd, estimated_cost_usd, latency_ms, failure",
        )
        .in(
          "evaluation_id",
          runs.map((run) => run.id),
        )
        .order("created_at");
      results = (resultData.data ?? []) as EvaluationResult[];
      loadError ||= Boolean(resultData.error);
    }
  }

  const modelById = new Map(models.map((model) => [model.id, model]));
  const caseById = new Map(cases.map((evaluationCase) => [evaluationCase.id, evaluationCase]));
  const resultsByRun = new Map<string, EvaluationResult[]>();
  for (const result of results) {
    const entries = resultsByRun.get(result.evaluation_id) ?? [];
    entries.push(result);
    resultsByRun.set(result.evaluation_id, entries);
  }

  const latest = runs[0] ?? null;
  const running = runs.some((run) => run.status === "running");
  const totalCost = results.reduce(
    (sum, result) =>
      sum + numberValue(result.reported_cost_usd),
    0,
  );
  const totalTokens = results.reduce(
    (sum, result) => sum + result.input_tokens + result.output_tokens,
    0,
  );
  const configured = isOpenRouterConfigured();
  const query = await searchParams;
  const message = messages[first(query.message) ?? ""];
  const error = errors[first(query.error) ?? ""];
  const promotionStates = ["experimental", "qualified", "assisted", "autonomous"];

  return (<AppShell active="settings" toolDestination="worker-evaluations" context={context}><ConsoleRetainedWorkspace ownerId={context.userId} notice={<p className="coreNotice">Recent loaded records only. Earlier history and complete totals remain pending R06.</p>} header={<><header className="workspaceHeader">
          <div className="workspaceTitle"><p>Stage 6</p><h1>Worker evaluations</h1></div>
          <Link className="ghostButton" href="/dashboard">Back</Link>
        </header>
{message ? <p className="notice success" role="status">{message}</p> : null}
{error ? <p className="notice error" role="alert">{error}</p> : null}
{loadError ? (
          <p className="notice error" role="alert">
            Some Worker evaluation records could not be loaded.
          </p>
        ) : null}
{!configured ? (
          <p className="notice error" role="alert">
            OpenRouter must be configured before live Worker evaluations can run.
          </p>
        ) : null}</>} panels={[{ id: "evaluations", label: "Evaluations", content: <><section className="summaryGrid" aria-label="Worker qualification summary">
          <article className="summaryCard">
            <span className="summaryLabel">Worker status</span>
            <strong style={{ fontSize: "1.3rem" }}>{humanize(worker?.status ?? null)}</strong>
          </article>
          <article className="summaryCard">
            <span className="summaryLabel">Latest score</span>
            <strong className="summaryValue">
              {latest?.score === null || latest?.score === undefined
                ? "—"
                : `${numberValue(latest.score).toFixed(1)}%`}
            </strong>
          </article>
          <article className="summaryCard">
            <span className="summaryLabel">Required cases</span>
            <strong className="summaryValue">{cases.filter((entry) => entry.required).length}</strong>
          </article>
          <article className="summaryCard">
            <span className="summaryLabel">Loaded recorded tokens</span>
            <strong className="summaryValue">{totalTokens.toLocaleString("en-NZ")}</strong>
          </article>
          <article className="summaryCard">
            <span className="summaryLabel">Loaded reported charges</span>
            <strong style={{ fontSize: "1.3rem" }}>{loadError ? "Unavailable" : formatUsd(totalCost)}</strong><p>{results.filter(result=>result.reported_cost_usd==null).length} unknown charge(s). Estimates are separate from reported charges.</p>
          </article>
        </section>
<section className="operationsPanel">
          <div className="panelHeading workflowHeading">
            <div><p className="panelLabel">Durable evidence</p><h2>Evaluation history</h2></div>
            <span className="countBadge">{runs.length}</span>
          </div>
          {runs.length ? (
            <div className="workflowList">
              <ConsoleRecentRows label="Loaded evaluation runs" rows={runs.map((run) => {
                const caseResults = resultsByRun.get(run.id) ?? [];
                const runCost = caseResults.reduce(
                  (sum, result) =>
                    sum + numberValue(result.reported_cost_usd),
                  0,
                );
                return (
                  <article className="workflowCard" key={run.id}>
                    <div className="workflowCardHeader">
                      <div>
                        <p className="workflowBusiness">{humanize(run.source)}</p>
                        <h3>{suite?.name ?? "Worker evaluation"}</h3>
                        <p>
                          Started {formatDate(run.started_at)} · fingerprint {run.subject_fingerprint.slice(0, 12)}…
                        </p>
                      </div>
                      <span className={`workflowStatus status-${run.status}`}>
                        {humanize(run.status)}
                      </span>
                    </div>
                    <ol className="stageTimeline" aria-label="Evaluation cases">
                      {caseResults.map((result) => {
                        const evaluationCase = caseById.get(result.case_id);
                        const model = result.model_definition_id
                          ? modelById.get(result.model_definition_id)
                          : null;
                        return (
                          <li className={`stageState stage-${result.status}`} key={result.id}>
                            <span className="stageMarker" aria-hidden="true" />
                            <div>
                              <strong>{evaluationCase?.name ?? "Evaluation case"}</strong>
                              <small>
                                {humanize(result.status)}
                                {model ? ` · ${model.display_name}` : ""}
                                {result.input_tokens + result.output_tokens > 0
                                  ? ` · ${(result.input_tokens + result.output_tokens).toLocaleString("en-NZ")} tokens`
                                  : ""}
                                {result.provider_model_id ? ` · ${result.provider_model_id}` : ""}
                              </small>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                    <div className="workflowMeta">
                      <span>Score {run.score === null ? "pending" : `${numberValue(run.score).toFixed(1)}%`}</span>
                      <span>{run.passed_case_count} passed</span>
                      <span>{run.failed_case_count} failed</span>
                      <span>{formatUsd(runCost)}</span>
                    </div>
                  </article>
                );
              })} />
            </div>
          ) : (
            <div className="emptyState">
              <h3>No evaluations yet</h3>
              <p>Run the qualification suite to create the first durable competence record.</p>
            </div>
          )}
        </section></> },
{ id: "suite", label: "Suite & qualification", content: <><section className="dashboardGrid">
          <article className="businessPanel">
            <div className="panelHeading">
              <div><p className="panelLabel">Qualification suite</p><h2>{suite?.name ?? "Unavailable"}</h2></div>
              <span className="countBadge">{cases.length}</span>
            </div>
            <p>
              The Worker must pass every required schema, role-boundary, mocked-capability,
              positive-example and negative-example case against the current primary and fallback models.
            </p>
            <div className="businessList">
              {cases.map((evaluationCase) => (
                <article className="businessCard" key={evaluationCase.id}>
                  <div>
                    <h3>{evaluationCase.name}</h3>
                    <p>{evaluationCase.case_key}</p>
                    <p>
                      {humanize(evaluationCase.category)} · {humanize(evaluationCase.execution_mode)}
                      {evaluationCase.model_target !== "none"
                        ? ` · ${humanize(evaluationCase.model_target)}`
                        : ""}
                    </p>
                  </div>
                  <div className="businessActions">
                    <span>{evaluationCase.required ? "Required" : "Optional"}</span>
                    <small>Weight {numberValue(evaluationCase.weight)}</small>
                  </div>
                </article>
              ))}
            </div>
          </article>

          <aside className="createPanel">
            <p className="panelLabel">Current Worker Pack</p>
            <h2>{worker?.name ?? "Generic Researcher"}</h2>
            <p>
              Qualification is bound to the Worker Pack, route, primary model, fallback model and
              live model qualification evidence. Any relevant change makes the result stale.
            </p>
            <form action={startWorkerEvaluation} className="formStack compact">
              <input
                name="workerDefinitionId"
                type="hidden"
                value={MODEL_RESEARCHER_WORKER_DEFINITION_ID}
              />
              <input
                name="idempotencyKey"
                type="hidden"
                value={`stage6:${crypto.randomUUID()}`}
              />
              <button className="primaryButton" disabled={!configured || running || !suite} type="submit">
                {running ? "Evaluation running" : "Run qualification suite"}
              </button>
            </form>
            <div className="runtimeReadiness">
              <span className={configured ? "runtimeDot ready" : "runtimeDot"} />
              <p>Live model evaluation {configured ? "ready" : "needs configuration"}</p>
            </div>
          </aside>
        </section></> },
{ id: "promotions", label: "Promotions", content: <><section className="operationsPanel">
          <div className="panelHeading workflowHeading">
            <div><p className="panelLabel">Promotion policy</p><h2>Worker maturity</h2></div>
            <span className="countBadge">{humanize(worker?.status ?? null)}</span>
          </div>
          <ol className="stageTimeline" aria-label="Worker promotion states">
            {promotionStates.map((state) => {
              const active = worker?.status === state;
              return (
                <li className={`stageState ${active ? "stage-completed" : "stage-pending"}`} key={state}>
                  <span className="stageMarker" aria-hidden="true" />
                  <div>
                    <strong>{humanize(state)}</strong>
                    <small>
                      {state === "experimental" && "Synthetic development only"}
                      {state === "qualified" && "Required evaluations and simulations passed"}
                      {state === "assisted" && "Future real-account proof with selected owner review"}
                      {state === "autonomous" && "Future proven real-world reliability within policy"}
                    </small>
                  </div>
                </li>
              );
            })}
          </ol>
          {promotions.length ? (
            <div className="eventHistory">
              <div className="eventHistoryHeader"><strong>Promotion receipts</strong></div>
              <ul>
                {promotions.map((promotion) => (
                  <li key={promotion.id}>
                    <time>{formatDate(promotion.promoted_at)}</time>
                    <span>
                      {humanize(promotion.from_status)} → {humanize(promotion.to_status)} · {promotion.reason}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section></> }]} /></AppShell>
  );
}
