import { notFound, redirect } from "next/navigation";
import { consoleCollectionHref, consoleCollectionOptionsFromSearch } from "@/lib/core-ui/console-collections-query";
export const dynamic = "force-dynamic";
/** History is ended workflow outcomes. Raw audit events stay in Activity. */
export default async function HistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  if (params.status && !["all", "ended", "completed", "failed", "cancelled", "stopped"].includes(String(params.status))) notFound();
  const query = { ...params, view: "work", status: !params.status || params.status === "all" ? "ended" : params.status };
  try { consoleCollectionOptionsFromSearch(query, "work"); } catch { notFound(); }
  redirect(consoleCollectionHref(query, {}));
}
