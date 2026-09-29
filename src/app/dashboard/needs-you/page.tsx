import Link from "next/link";

import { AppShell, EmptyPanel, PageHeader } from "@/components/stage7/app-shell";
import { NeedsYouCard } from "@/components/stage7/workflow-visuals";
import {
  loadWorkflowCollection,
  requireOwnerUiContext,
} from "@/lib/core-ui/data";
import { formatDateTime, humanize } from "@/lib/core-ui/workflows";

export const dynamic = "force-dynamic";

type NeedsYouPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const messages: Record<string, string> = {
  "review-approved": "Decision recorded. The workflow is resuming.",
  "review-failed": "Failure decision recorded. The workflow is closing safely.",
};

const errors: Record<string, string> = {
  "invalid-review-decision": "The review decision was invalid.",
  "review-not-open": "That decision is no longer open.",
  "review-resume-failed": "The workflow could not be resumed.",
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function NeedsYouPage({ searchParams }: NeedsYouPageProps) {
  const context = await requireOwnerUiContext();
  const collection = await loadWorkflowCollection(context, { limit: 100 });
  const query = await searchParams;
  const message = messages[first(query.message) ?? ""];
  const error = errors[first(query.error) ?? ""];

  const businessById = new Map(context.businesses.map((business) => [business.id, business]));
  const runById = new Map(collection.runs.map((run) => [run.id, run]));
  const definitionById = new Map(
    collection.definitions.map((definition) => [definition.id, definition]),
  );
  const open = collection.interventions.filter((entry) => entry.status === "open");
  const resolved = collection.interventions
    .filter((entry) => entry.status !== "open")
    .slice(0, 12);

  return (
    <AppShell active="needs-you" context={context}>
      <PageHeader
        actions={
          <Link className="coreButton coreButton-secondary" href="/dashboard/workflows">
            View workflows
          </Link>
        }
        description="Only meaningful owner decisions and exceptional workflow states appear here."
        eyebrow="Owner intervention"
        title="Needs You"
      />

      {message ? <p className="coreNotice coreNotice-success" role="status">{message}</p> : null}
      {error ? <p className="coreNotice coreNotice-danger" role="alert">{error}</p> : null}

      <section className={open.length ? "needsYouQueue needsYouQueue-active" : "needsYouQueue"}>
        <div className="sectionTitleRow">
          <div>
            <p className="coreEyebrow">Open queue</p>
            <h2>{open.length ? `${open.length} decision${open.length === 1 ? "" : "s"} waiting` : "Nothing needs your attention"}</h2>
          </div>
          <span className="coreCount">{open.length}</span>
        </div>

        {open.length ? (
          <div className="needsYouStack">
            {open.map((intervention) => {
              const run = intervention.workflow_run_id
                ? runById.get(intervention.workflow_run_id)
                : undefined;
              const definition = run
                ? definitionById.get(run.workflow_definition_id)
                : undefined;
              return (
                <NeedsYouCard
                  businessName={businessById.get(intervention.business_id)?.name}
                  intervention={intervention}
                  key={intervention.id}
                  returnTo="/dashboard/needs-you"
                  workflowName={definition?.name}
                />
              );
            })}
          </div>
        ) : (
          <EmptyPanel icon="needs-you" title="No intervention required">
            <p>Agent Labs will surface decisions here instead of interrupting normal workflow activity.</p>
          </EmptyPanel>
        )}
      </section>

      <section className="dashboardSection">
        <div className="sectionTitleRow">
          <div><p className="coreEyebrow">Decision history</p><h2>Recently resolved</h2></div>
          <span className="coreCount">{resolved.length}</span>
        </div>
        {resolved.length ? (
          <div className="resolvedDecisionList">
            {resolved.map((intervention) => {
              const run = intervention.workflow_run_id
                ? runById.get(intervention.workflow_run_id)
                : undefined;
              const definition = run
                ? definitionById.get(run.workflow_definition_id)
                : undefined;
              return (
                <article key={intervention.id}>
                  <span className="resolvedDecisionMarker" aria-hidden="true">✓</span>
                  <div>
                    <strong>{intervention.title}</strong>
                    <p>{businessById.get(intervention.business_id)?.name ?? "Business"} · {definition?.name ?? "Workflow"}</p>
                  </div>
                  <div>
                    <span>{humanize(intervention.status)}</span>
                    <small>{formatDateTime(intervention.resolved_at ?? intervention.updated_at)}</small>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="sectionEmptyText">Resolved owner decisions will remain inspectable here.</p>
        )}
      </section>
    </AppShell>
  );
}
