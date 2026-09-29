import Link from "next/link";

import { AppShell, EmptyPanel, PageHeader } from "@/components/stage7/app-shell";
import { HistoryRow } from "@/components/stage7/workflow-visuals";
import {
  loadWorkflowCollection,
  requireOwnerUiContext,
} from "@/lib/core-ui/data";
import { TERMINAL_WORKFLOW_STATUSES } from "@/lib/core-ui/workflows";

export const dynamic = "force-dynamic";

type HistoryPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const context = await requireOwnerUiContext();
  const collection = await loadWorkflowCollection(context, { limit: 150 });
  const query = await searchParams;
  const requestedStatus = first(query.status);
  const status =
    requestedStatus && ["completed", "failed", "cancelled"].includes(requestedStatus)
      ? requestedStatus
      : "all";

  const terminalRuns = collection.runs.filter((run) => TERMINAL_WORKFLOW_STATUSES.has(run.status));
  const runs = status === "all" ? terminalRuns : terminalRuns.filter((run) => run.status === status);
  const businessById = new Map(context.businesses.map((business) => [business.id, business]));
  const definitionById = new Map(
    collection.definitions.map((definition) => [definition.id, definition]),
  );
  const completed = terminalRuns.filter((run) => run.status === "completed").length;
  const failed = terminalRuns.filter((run) => run.status === "failed").length;
  const cancelled = terminalRuns.filter((run) => run.status === "cancelled").length;

  return (
    <AppShell active="history" context={context}>
      <PageHeader
        actions={
          <div className="segmentedControl" aria-label="History filter">
            {[
              ["all", "All"],
              ["completed", "Completed"],
              ["failed", "Failed"],
            ].map(([key, label]) => (
              <Link
                className={status === key ? "active" : ""}
                href={key === "all" ? "/dashboard/history" : `/dashboard/history?status=${key}`}
                key={key}
              >
                {label}
              </Link>
            ))}
          </div>
        }
        description="Completed and classified terminal workflow outcomes remain durable and inspectable."
        eyebrow="Audit trail"
        title="History"
      />

      <section className="historySummaryGrid">
        <article><span>Completed</span><strong>{completed}</strong><small>successful outcomes</small></article>
        <article><span>Failed</span><strong>{failed}</strong><small>classified failures</small></article>
        <article><span>Cancelled</span><strong>{cancelled}</strong><small>stopped workflows</small></article>
        <article><span>Total</span><strong>{terminalRuns.length}</strong><small>terminal runs</small></article>
      </section>

      <section className="dashboardSection historyPagePanel">
        <div className="sectionTitleRow">
          <div><p className="coreEyebrow">Durable runs</p><h2>{status === "all" ? "All outcomes" : `${status.charAt(0).toUpperCase()}${status.slice(1)}`}</h2></div>
          <span className="coreCount">{runs.length}</span>
        </div>

        {runs.length ? (
          <div className="historyList historyList-large">
            {runs.map((run) => (
              <HistoryRow
                business={businessById.get(run.business_id)}
                definition={definitionById.get(run.workflow_definition_id)}
                key={run.id}
                run={run}
              />
            ))}
          </div>
        ) : (
          <EmptyPanel icon="history" title="No matching workflow history">
            <p>Terminal workflows will appear here as durable outcomes are recorded.</p>
          </EmptyPanel>
        )}
      </section>
    </AppShell>
  );
}
