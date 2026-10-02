"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { consoleDecisionHref, consoleDecisionOptionsFromSearch, consoleDecisionQuery, type ConsoleDecisionQuery } from "@/lib/core-ui/console-decisions-query";

/** Only the current, validated Decisions route may reconcile its rendered filters. */
export function decisionFilterRouteMatches(href: string, renderedRoute: string): boolean {
  try {
    const url = new URL(href);
    if (url.pathname !== "/dashboard" || url.searchParams.getAll("view").length !== 1 || url.searchParams.get("view") !== "decisions") return false;
    for (const key of ["business", "status", "page", "decision"]) if (url.searchParams.getAll(key).length > 1) return false;
    const query = consoleDecisionQuery(consoleDecisionOptionsFromSearch(Object.fromEntries(url.searchParams)));
    return consoleDecisionHref(query) === renderedRoute;
  } catch { return false; }
}

/** Browser history can restore edited select values after React hydrates their defaults. */
export function bindDecisionFilterRestoration(form: HTMLFormElement, query: ConsoleDecisionQuery) {
  const view = form.ownerDocument.defaultView;
  if (!view) return () => {};
  const renderedRoute = consoleDecisionHref(query);
  let frame: number | null = null, ticket = 0, edited = false, disposed = false;
  const cancel = () => {
    ticket++;
    if (frame !== null) view.cancelAnimationFrame(frame);
    frame = null;
  };
  const schedule = () => {
    cancel();
    const expectedTicket = ticket, expectedHref = view.location.href;
    frame = view.requestAnimationFrame(() => {
      frame = null;
      if (disposed || !form.isConnected || ticket !== expectedTicket || view.location.href !== expectedHref || !decisionFilterRouteMatches(expectedHref, renderedRoute)) return;
      for (const [name, value] of [["business", query.businessId ?? ""], ["status", query.status]]) {
        const control = form.querySelector<HTMLSelectElement>(`select[name="${name}"]`);
        if (control && Array.from(control.options).some(option => option.value === value)) control.value = value;
      }
      edited = false;
    });
  };
  const onEdit = () => { edited = true; cancel(); };
  // A late first-load pageshow must not undo a draft entered after hydration.
  // A persisted pageshow represents a returned history entry and must reconcile.
  const onPageShow = (event: PageTransitionEvent) => { if (event.persisted || !edited) schedule(); };
  view.addEventListener("pageshow", onPageShow);
  view.addEventListener("popstate", schedule);
  form.addEventListener("input", onEdit);
  form.addEventListener("change", onEdit);
  schedule();
  return () => {
    disposed = true; cancel();
    view.removeEventListener("pageshow", onPageShow);
    view.removeEventListener("popstate", schedule);
    form.removeEventListener("input", onEdit);
    form.removeEventListener("change", onEdit);
  };
}

export function ConsoleDecisionFilters({ query, children }: { query: ConsoleDecisionQuery; children: ReactNode }) {
  const form = useRef<HTMLFormElement>(null);
  const { businessId, selectedId, page, status } = query;
  useEffect(() => {
    if (form.current) return bindDecisionFilterRestoration(form.current, consoleDecisionQuery({ businessId: businessId ?? undefined, selectedId: selectedId ?? undefined, page, status }));
  }, [businessId, selectedId, page, status]);
  return <form ref={form} method="get" className="compactDecisionFilters">{children}</form>;
}
