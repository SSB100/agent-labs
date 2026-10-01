import Link from "next/link";
import { loadAccountSetupInterventions } from "@/accounts/server";
import { loadPublicationInterventions } from "@/etsy-publication/server";

import { BrowserInterventionCard } from "@/components/stage8/browser-intervention";
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
  "browser-control-returned": "Control returned. Agent Labs is reconnecting automation.",
  "browser-control-taken": "The live browser is now under your control.",
  "review-approved": "Decision recorded. The workflow is resuming.",
  "review-failed": "Failure decision recorded. The workflow is closing safely.",
};

const errors: Record<string, string> = {
  "browser-control-not-open": "That browser-control request is no longer open.",
  "browser-control-resume-failed": "The browser workflow could not resume.",
  "invalid-browser-control": "The browser-control request was invalid.",
  "invalid-review-decision": "The review decision was invalid.",
  "review-not-open": "That decision is no longer open.",
  "review-resume-failed": "The workflow could not be resumed.",
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function NeedsYouPage({ searchParams }: NeedsYouPageProps) {
  const context = await requireOwnerUiContext();
  const [collection,publication,accountSetup] = await Promise.all([loadWorkflowCollection(context, { limit: 100 }),loadPublicationInterventions(context),loadAccountSetupInterventions(context)]);
  const interventions=[...new Map([...collection.interventions,...publication.records].map(entry=>[entry.id,entry])).values()];
  const query = await searchParams;
  const message = messages[first(query.message) ?? ""];
  const error = errors[first(query.error) ?? ""];

  const businessById = new Map(context.businesses.map((business) => [business.id, business]));
  const runById = new Map(collection.runs.map((run) => [run.id, run]));
  const definitionById = new Map(
    collection.definitions.map((definition) => [definition.id, definition]),
  );
  const open = interventions.filter((entry) => entry.status === "open");
  const waitingCount = open.length + accountSetup.records.length;
  const unavailable = publication.unavailable || accountSetup.unavailable;
  const resolved = interventions
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
      {publication.unavailable ? <p className="coreNotice coreNotice-danger" role="alert">Publication verification requests could not be loaded. Unresolved listing outcomes may still need your attention.</p> : null}

      {accountSetup.unavailable ? <p className="coreNotice coreNotice-danger" role="alert">Account setup requests could not be checked. Existing approvals or secure owner steps may still need attention.</p> : null}

      <section className={waitingCount ? "needsYouQueue needsYouQueue-active" : "needsYouQueue"}>
        <div className="sectionTitleRow">
          <div>
            <p className="coreEyebrow">Open queue</p>
            <h2>{waitingCount ? `${waitingCount} decision${waitingCount === 1 ? "" : "s"} waiting` : unavailable ? "Some requests could not be checked" : "Nothing needs your attention"}</h2>
          </div>
          <span className="coreCount">{waitingCount}</span>
        </div>

        {waitingCount ? (
          <div className="needsYouStack">
            {accountSetup.records.map(request => <article className="browserQualificationPanel" key={request.runId}><div><p className="coreEyebrow">Account setup</p><h3>{request.provider === "etsy" ? "Etsy" : "Printful"} · {request.status === "pending_approval" ? "Exact request awaiting review" : "Secure owner step or connection verification"}</h3><p>{businessById.get(request.businessId)?.name ?? "Business"}. Review the saved service, data, access and terms in Accounts. No account creation is inferred from approval.</p></div><Link className="coreButton" href={`/dashboard/accounts?business=${request.businessId}#business-accounts`}>Review account setup</Link></article>)}
            {open.map((intervention) => {
              const run = intervention.workflow_run_id
                ? runById.get(intervention.workflow_run_id)
                : undefined;
              const definition = run
                ? definitionById.get(run.workflow_definition_id)
                : undefined;
              const props = {
                businessName: businessById.get(intervention.business_id)?.name,
                intervention,
                returnTo: "/dashboard/needs-you",
                workflowName: definition?.name,
              };
              return ["browser_takeover", "browser_return_control"].includes(
                intervention.intervention_type,
              ) ? (
                <BrowserInterventionCard key={intervention.id} {...props} />
              ) : (
                <NeedsYouCard key={intervention.id} {...props} />
              );
            })}
          </div>
        ) : (
          <EmptyPanel icon="needs-you" title={publication.unavailable ? "Publication checks unavailable" : accountSetup.unavailable ? "Account checks unavailable" : "No intervention required"}>
            <p>{unavailable ? "Account or publication outcomes may still need verification. Check the relevant workspace once its records are available." : "Agent Labs will surface decisions here instead of interrupting normal workflow activity."}</p>
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
