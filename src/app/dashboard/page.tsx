import Link from "next/link";
import { redirect } from "next/navigation";

import { isSupabaseAdminConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

import {
  createBusiness,
  resumeSyntheticReview,
  startSyntheticWorkflow,
} from "./actions";

export const dynamic = "force-dynamic";

type DashboardPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type Business = {
  created_at: string;
  id: string;
  name: string;
  updated_at: string;
};

type WorkflowRun = {
  business_id: string;
  completed_at: string | null;
  created_at: string;
  current_stage_key: string | null;
  id: string;
  runtime_run_id: string | null;
  started_at: string | null;
  status: string;
  updated_at: string;
};

type StageRun = {
  attempt: number;
  completed_at: string | null;
  id: string;
  sequence: number;
  stage_key: string;
  started_at: string | null;
  status: string;
  workflow_run_id: string;
};

type WorkflowEvent = {
  event_type: string;
  id: string;
  occurred_at: string;
  payload: Record<string, unknown>;
  workflow_run_id: string | null;
};

type OwnerIntervention = {
  business_id: string;
  description: string;
  id: string;
  requested_at: string;
  status: string;
  title: string;
  workflow_run_id: string | null;
};

const activeStatuses = new Set(["needs_owner", "queued", "review", "running", "waiting"]);

const navigation = [
  { active: true, href: "/dashboard", label: "Control centre" },
  { href: "#workflows", label: "Workflows" },
  { href: "#needs-you", label: "Needs you" },
  { label: "Accounts" },
  { label: "Settings" },
];

const messages: Record<string, string> = {
  "business-created": "Business created.",
  "review-approved": "Review approved. The durable workflow is resuming.",
  "review-failed": "Failure decision delivered. The workflow is closing its failure path.",
  "workflow-duplicate-prevented":
    "A duplicate launch was prevented. The existing workflow remains authoritative.",
  "workflow-started": "Synthetic durable workflow started.",
};

const errors: Record<string, string> = {
  "business-create-failed": "The Business could not be created. Try again.",
  "business-not-found": "The selected Business is unavailable.",
  "invalid-business-name": "Use a Business name between 1 and 120 characters.",
  "invalid-review-decision": "The review decision was invalid.",
  "invalid-workflow-launch": "The workflow launch request was invalid.",
  "review-not-open": "That review is no longer open.",
  "review-resume-failed": "The workflow could not be resumed.",
  "workflow-launch-failed": "The durable workflow could not be launched.",
  "workflow-reservation-failed": "The workflow launch could not be reserved.",
  "workflow-runtime-not-configured":
    "The trusted Supabase runtime key is not configured for workflow execution.",
};

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(value: string | null) {
  if (!value) {
    return "Not yet";
  }

  return new Intl.DateTimeFormat("en-NZ", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function humanize(value: string | null) {
  if (!value) {
    return "Queued";
  }

  return value
    .split(/[._-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  const userId = claims?.sub;

  if (claimsError || !userId) {
    redirect("/login?error=session-required");
  }

  const [{ data: businessData, error: businessError }, { data: profileData }] =
    await Promise.all([
      supabase
        .from("businesses")
        .select("id, name, created_at, updated_at")
        .eq("owner_user_id", userId)
        .order("created_at", { ascending: false }),
      supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
    ]);

  const businesses = (businessData ?? []) as Business[];
  const businessIds = businesses.map((business) => business.id);
  let workflowRuns: WorkflowRun[] = [];
  let stageRuns: StageRun[] = [];
  let workflowEvents: WorkflowEvent[] = [];
  let interventions: OwnerIntervention[] = [];
  let workflowHistoryError = false;

  if (businessIds.length > 0) {
    const { data: runData, error: runError } = await supabase
      .from("workflow_runs")
      .select(
        "id, business_id, status, current_stage_key, runtime_run_id, started_at, completed_at, created_at, updated_at",
      )
      .in("business_id", businessIds)
      .order("created_at", { ascending: false })
      .limit(30);

    workflowRuns = (runData ?? []) as WorkflowRun[];
    workflowHistoryError = Boolean(runError);

    const workflowRunIds = workflowRuns.map((run) => run.id);
    if (workflowRunIds.length > 0) {
      const [stageResult, eventResult, interventionResult] = await Promise.all([
        supabase
          .from("workflow_stage_runs")
          .select(
            "id, workflow_run_id, stage_key, sequence, attempt, status, started_at, completed_at",
          )
          .in("workflow_run_id", workflowRunIds)
          .order("sequence", { ascending: true })
          .order("attempt", { ascending: true }),
        supabase
          .from("events")
          .select("id, workflow_run_id, event_type, payload, occurred_at")
          .in("workflow_run_id", workflowRunIds)
          .order("occurred_at", { ascending: false })
          .limit(100),
        supabase
          .from("owner_interventions")
          .select(
            "id, business_id, workflow_run_id, status, title, description, requested_at",
          )
          .in("workflow_run_id", workflowRunIds)
          .order("requested_at", { ascending: false }),
      ]);

      stageRuns = (stageResult.data ?? []) as StageRun[];
      workflowEvents = (eventResult.data ?? []) as WorkflowEvent[];
      interventions = (interventionResult.data ?? []) as OwnerIntervention[];
      workflowHistoryError ||= Boolean(
        stageResult.error || eventResult.error || interventionResult.error,
      );
    }
  }

  const stagesByRun = new Map<string, StageRun[]>();
  for (const stage of stageRuns) {
    const entries = stagesByRun.get(stage.workflow_run_id) ?? [];
    entries.push(stage);
    stagesByRun.set(stage.workflow_run_id, entries);
  }

  const eventsByRun = new Map<string, WorkflowEvent[]>();
  for (const event of workflowEvents) {
    if (!event.workflow_run_id) {
      continue;
    }
    const entries = eventsByRun.get(event.workflow_run_id) ?? [];
    entries.push(event);
    eventsByRun.set(event.workflow_run_id, entries);
  }

  const openInterventionByRun = new Map<string, OwnerIntervention>();
  for (const intervention of interventions) {
    if (intervention.status === "open" && intervention.workflow_run_id) {
      openInterventionByRun.set(intervention.workflow_run_id, intervention);
    }
  }

  const businessById = new Map(businesses.map((business) => [business.id, business]));
  const email = typeof claims.email === "string" ? claims.email : "Owner";
  const displayName =
    typeof profileData?.display_name === "string" && profileData.display_name.trim()
      ? profileData.display_name
      : email;
  const query = await searchParams;
  const message = messages[firstValue(query.message) ?? ""];
  const error = errors[firstValue(query.error) ?? ""];
  const activeWorkflowCount = workflowRuns.filter((run) => activeStatuses.has(run.status)).length;
  const needsOwnerCount = workflowRuns.filter((run) => run.status === "needs_owner").length;
  const workflowRuntimeConfigured = isSupabaseAdminConfigured();
  const summary = [
    { label: "Businesses", value: businesses.length.toString() },
    { label: "Active workflows", value: activeWorkflowCount.toString() },
    { label: "Needs you", value: needsOwnerCount.toString() },
    { label: "Connected accounts", value: "0" },
  ];

  return (
    <div className="appFrame">
      <aside className="appSidebar">
        <Link className="appBrand" href="/dashboard" aria-label="Agent Labs control centre">
          <span className="brandMark" aria-hidden="true">
            AL
          </span>
          <span>
            <strong>Agent Labs</strong>
            <small>Control centre</small>
          </span>
        </Link>

        <nav className="appNav" aria-label="Agent Labs sections">
          {navigation.map((item) =>
            item.href ? (
              <Link
                className={item.active ? "navItem active" : "navItem"}
                href={item.href}
                key={item.label}
              >
                {item.label}
              </Link>
            ) : (
              <span aria-disabled="true" className="navItem disabled" key={item.label}>
                <span>{item.label}</span>
                <small>Soon</small>
              </span>
            ),
          )}
        </nav>

        <div className="sidebarFoot">
          <span>Signed in</span>
          <p>{email}</p>
        </div>
      </aside>

      <main className="appMain">
        <header className="workspaceHeader">
          <div className="workspaceTitle">
            <p>Agent Labs</p>
            <h1>Control centre</h1>
          </div>
          <div className="workspaceAccount">
            <span>{displayName}</span>
            <form action="/auth/signout" method="post">
              <button className="ghostButton" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </header>

        {message ? (
          <p className="notice success" role="status">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="notice error" role="alert">
            {error}
          </p>
        ) : null}
        {businessError ? (
          <p className="notice error" role="alert">
            Business records could not be loaded.
          </p>
        ) : null}
        {workflowHistoryError ? (
          <p className="notice error" role="alert">
            Some workflow history could not be loaded.
          </p>
        ) : null}

        <section className="summaryGrid" aria-label="Control centre summary">
          {summary.map((item) => (
            <article className="summaryCard" key={item.label}>
              <span className="summaryLabel">{item.label}</span>
              <strong className="summaryValue">{item.value}</strong>
            </article>
          ))}
        </section>

        <section className="dashboardGrid">
          <article className="businessPanel" aria-labelledby="businesses-heading">
            <div className="panelHeading">
              <div>
                <p className="panelLabel">Workspaces</p>
                <h2 id="businesses-heading">Businesses</h2>
              </div>
              <span className="countBadge">{businesses.length}</span>
            </div>

            {businesses.length ? (
              <div className="businessList">
                {businesses.map((business) => (
                  <article className="businessCard stage3BusinessCard" key={business.id}>
                    <div>
                      <h3>{business.name}</h3>
                      <p>Created {formatDate(business.created_at)}</p>
                    </div>
                    <div className="businessActions">
                      <span>Owner</span>
                      <form action={startSyntheticWorkflow}>
                        <input name="businessId" type="hidden" value={business.id} />
                        <input
                          name="idempotencyKey"
                          type="hidden"
                          value={`stage3:${crypto.randomUUID()}`}
                        />
                        <input
                          name="launchNonce"
                          type="hidden"
                          value={crypto.randomUUID()}
                        />
                        <button
                          className="compactButton"
                          disabled={!workflowRuntimeConfigured}
                          type="submit"
                        >
                          Run durable proof
                        </button>
                      </form>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="emptyState">
                <h3>No Businesses yet</h3>
                <p>Create the first Business to begin setting up Agent Labs.</p>
              </div>
            )}
          </article>

          <aside className="createPanel" aria-labelledby="create-business-heading">
            <p className="panelLabel">New workspace</p>
            <h2 id="create-business-heading">Create a Business</h2>
            <form action={createBusiness} className="formStack compact">
              <label className="formField" htmlFor="business-name">
                <span>Business name</span>
                <input
                  id="business-name"
                  maxLength={120}
                  name="name"
                  placeholder="Business name"
                  required
                  type="text"
                />
              </label>
              <button className="primaryButton" type="submit">
                Create Business
              </button>
            </form>
            <div className="runtimeReadiness">
              <span className={workflowRuntimeConfigured ? "runtimeDot ready" : "runtimeDot"} />
              <p>
                Durable runtime {workflowRuntimeConfigured ? "ready" : "configuration needed"}
              </p>
            </div>
          </aside>
        </section>

        <section className="operationsPanel" id="workflows" aria-labelledby="workflows-heading">
          <div className="panelHeading workflowHeading">
            <div>
              <p className="panelLabel">Durable execution</p>
              <h2 id="workflows-heading">Workflow history</h2>
            </div>
            <span className="countBadge">{workflowRuns.length}</span>
          </div>

          {workflowRuns.length ? (
            <div className="workflowList">
              {workflowRuns.map((run) => {
                const business = businessById.get(run.business_id);
                const stages = stagesByRun.get(run.id) ?? [];
                const events = (eventsByRun.get(run.id) ?? []).slice(0, 6);
                const intervention = openInterventionByRun.get(run.id);

                return (
                  <article className="workflowCard" key={run.id}>
                    <div className="workflowCardHeader">
                      <div>
                        <p className="workflowBusiness">{business?.name ?? "Business"}</p>
                        <h3>Synthetic durable runtime proof</h3>
                        <p>
                          Started {formatDate(run.started_at ?? run.created_at)} · Current stage{" "}
                          {humanize(run.current_stage_key)}
                        </p>
                      </div>
                      <span className={`workflowStatus status-${run.status}`}>
                        {humanize(run.status)}
                      </span>
                    </div>

                    <ol className="stageTimeline" aria-label="Workflow stages">
                      {stages.length ? (
                        stages.map((stage) => (
                          <li className={`stageState stage-${stage.status}`} key={stage.id}>
                            <span className="stageMarker" aria-hidden="true" />
                            <div>
                              <strong>{humanize(stage.stage_key)}</strong>
                              <small>
                                {humanize(stage.status)}
                                {stage.attempt > 1 ? ` · attempt ${stage.attempt}` : ""}
                              </small>
                            </div>
                          </li>
                        ))
                      ) : (
                        <li className="stageState stage-pending">
                          <span className="stageMarker" aria-hidden="true" />
                          <div>
                            <strong>Launch reserved</strong>
                            <small>Waiting for the durable runtime</small>
                          </div>
                        </li>
                      )}
                    </ol>

                    {intervention ? (
                      <section className="interventionCard" id="needs-you">
                        <div>
                          <p className="panelLabel">Needs you</p>
                          <h4>{intervention.title}</h4>
                          <p>{intervention.description}</p>
                        </div>
                        <form action={resumeSyntheticReview} className="interventionActions">
                          <input name="interventionId" type="hidden" value={intervention.id} />
                          <button
                            className="primaryButton"
                            name="decision"
                            type="submit"
                            value="approve"
                          >
                            Approve and complete
                          </button>
                          <button
                            className="dangerButton"
                            name="decision"
                            type="submit"
                            value="fail"
                          >
                            Fail workflow
                          </button>
                        </form>
                      </section>
                    ) : null}

                    <div className="eventHistory">
                      <div className="eventHistoryHeader">
                        <strong>History</strong>
                        <small>
                          {run.runtime_run_id
                            ? `Runtime ${run.runtime_run_id.slice(0, 18)}…`
                            : "Runtime pending"}
                        </small>
                      </div>
                      {events.length ? (
                        <ul>
                          {events.map((event) => (
                            <li key={event.id}>
                              <time>{formatDate(event.occurred_at)}</time>
                              <span>{humanize(event.event_type)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>No durable events recorded yet.</p>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="operationEmpty">
              <strong>No workflows have run yet.</strong>
              <span>
                Start the Stage 3 durable proof from a Business above. It will retry once,
                wait without consuming compute, and pause for your review.
              </span>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
