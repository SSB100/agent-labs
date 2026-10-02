import { notFound, redirect } from "next/navigation";
import { consoleDecisionHref, consoleDecisionOptionsFromSearch, consoleDecisionQuery, consoleDecisionNotice } from "@/lib/core-ui/console-decisions-query";

export const dynamic = "force-dynamic";
/** Legacy navigation only: the root performs all owner/Business reads and action checks. */
export default async function NeedsYouPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  let href: string;
  try { href = consoleDecisionHref(consoleDecisionQuery(consoleDecisionOptionsFromSearch(params))); }
  catch { notFound(); }
  const url = new URL(href, "https://console.invalid");
  for (const kind of ["message", "error"] as const) {
    const code = params[kind];
    if (typeof code === "string" && consoleDecisionNotice(kind, code)) url.searchParams.set(kind, code);
  }
  redirect(`${url.pathname}${url.search}`);
}
