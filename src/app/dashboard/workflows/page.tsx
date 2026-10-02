import { notFound, redirect } from "next/navigation";
import { consoleCollectionHref, consoleCollectionOptionsFromSearch } from "@/lib/core-ui/console-collections-query";
export const dynamic = "force-dynamic";
/** Existing index aliases the bounded Work reader. The root enforces ownership. */
export default async function WorkflowsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const query = { ...params, view: "work", status: params.view === "active" ? "active" : params.status };
  try { consoleCollectionOptionsFromSearch(query, "work"); } catch { notFound(); }
  redirect(consoleCollectionHref(query, {}));
}
