"use client";

import { useEffect, useRef } from "react";
import { consoleLibraryOptionsFromSearch, consoleLibraryQuery } from "@/lib/core-ui/console-library-query";
import { consoleCollectionScrollKey } from "./console-collection-scroll";

/** Validate first; equivalent native GET defaults share the accepted collection scope. */
export function consoleLibraryRunLookupScope(ownerId: string, href: string): { key: string; creativeRunId: string } | null {
  if (!ownerId) return null;
  try {
    const url = new URL(href, "https://console.invalid");
    if (url.pathname !== "/dashboard") return null;
    const params: Record<string, string | string[]> = {};
    for (const key of new Set(url.searchParams.keys())) {
      const values = url.searchParams.getAll(key);
      params[key] = values.length === 1 ? values[0] : values;
    }
    const query = consoleLibraryQuery("designs", consoleLibraryOptionsFromSearch(params, "designs"));
    return { key: consoleCollectionScrollKey(ownerId, `${url.pathname}${url.search}`), creativeRunId: query.creativeRunId ?? "" };
  } catch { return null; }
}

/** Restores this one GET field after native history without submitting, focusing or scrolling. */
export function mountConsoleLibraryRunLookup(form: HTMLFormElement, ownerId: string, scopeHref: string, view: Window = window) {
  const scope = consoleLibraryRunLookupScope(ownerId, scopeHref);
  const field = form.querySelector<HTMLInputElement>('input[name="creativeRun"]');
  const marker = form.querySelector<HTMLElement>("[data-console-run-lookup-scope]");
  if (!scope || !field || !marker || marker.dataset.consoleRunLookupScope !== scope.key) return () => {};
  let disposed = false, ticket = 0, timer = 0, frame = 0;
  // A fresh non-bfcache history document may restore input focus/value without
  // delivering a later popstate. Navigation Timing distinguishes that return
  // from a late ordinary first-load pageshow; edits after binding still cancel it.
  let backForwardDocument = false;
  try { backForwardDocument = view.performance?.getEntriesByType("navigation").some(entry => "type" in entry && entry.type === "back_forward") ?? false; } catch { /* Older/disabled Performance APIs use the event-based path. */ }
  const newDocumentBinding = form.dataset.consoleRunLookupNavigationChecked !== "true";
  form.dataset.consoleRunLookupNavigationChecked = "true";
  const rawHref = () => view.location.href ?? `${view.location.pathname}${view.location.search}${view.location.hash}`;
  const currentScope = () => consoleLibraryRunLookupScope(ownerId, rawHref());
  const sameForm = () => !disposed && form.isConnected !== false && form.querySelector('input[name="creativeRun"]') === field && form.querySelector("[data-console-run-lookup-scope]") === marker && marker.dataset.consoleRunLookupScope === scope.key;
  const cancel = () => {
    ticket++;
    view.clearTimeout(timer); view.cancelAnimationFrame(frame);
    timer = 0; frame = 0;
  };
  const pendingHistory = () => form.dataset.consoleRunLookupHistoryScope === scope.key && form.dataset.consoleRunLookupHistoryHref === rawHref();
  const editedHere = () => form.dataset.consoleRunLookupEdited === scope.key && form.dataset.consoleRunLookupEditedHref === rawHref();
  const reconcile = (history: boolean) => {
    if (!sameForm() || currentScope()?.key !== scope.key) return;
    if (!history && (form.dataset.consoleRunLookupInitialized === scope.key || editedHere())) return;
    const priorScope = form.dataset.consoleRunLookupInitialized;
    // Hydration must not replace typing that happened before listeners mounted.
    // A genuinely different URL still owns its field unless a newer edit cancelled it.
    const initialEditor = !history && (!priorScope || priorScope === scope.key) && (form.ownerDocument ?? view.document)?.activeElement === field;
    if (!initialEditor) field.value = scope.creativeRunId;
    form.dataset.consoleRunLookupInitialized = scope.key;
    if (!initialEditor) {
      delete form.dataset.consoleRunLookupEdited;
      delete form.dataset.consoleRunLookupEditedHref;
    }
    delete form.dataset.consoleRunLookupHistoryScope;
    delete form.dataset.consoleRunLookupHistoryHref;
  };
  const schedule = (history: boolean) => {
    if (!sameForm()) return;
    cancel();
    const expectedTicket = ticket, expectedHref = rawHref();
    const current = () => !disposed && ticket === expectedTicket && rawHref() === expectedHref;
    // Browsers restore persisted form state after popstate/pageshow. Wait through
    // their task plus frame, but invalidate both callbacks on any newer input/navigation.
    timer = view.setTimeout(() => {
      timer = 0;
      if (!current()) return;
      frame = view.requestAnimationFrame(() => {
        frame = 0;
        if (current()) reconcile(history);
      });
    }, 0);
  };
  const onEdit = () => {
    cancel();
    const current = currentScope();
    if (!current) return;
    // Record the browser's current scope even while the old server tree is retained.
    // The next bind then preserves an edit made after Back but before its server commit.
    form.dataset.consoleRunLookupInitialized = current.key;
    form.dataset.consoleRunLookupEdited = current.key;
    form.dataset.consoleRunLookupEditedHref = rawHref();
    delete form.dataset.consoleRunLookupHistoryScope;
    delete form.dataset.consoleRunLookupHistoryHref;
  };
  const onHistory = () => {
    cancel();
    const current = currentScope();
    if (!current) return;
    form.dataset.consoleRunLookupHistoryScope = current.key;
    form.dataset.consoleRunLookupHistoryHref = rawHref();
    schedule(true);
  };
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) onHistory();
    else if (form.dataset.consoleRunLookupInitialPageShowSeen !== "true" && backForwardDocument) {
      form.dataset.consoleRunLookupInitialPageShowSeen = "true";
      if (!editedHere()) onHistory();
    } else if (!pendingHistory() && !editedHere() && form.dataset.consoleRunLookupInitialized !== scope.key) schedule(false);
  };
  form.addEventListener("input", onEdit);
  form.addEventListener("change", onEdit);
  view.addEventListener("popstate", onHistory);
  view.addEventListener("pageshow", onPageShow);
  if (newDocumentBinding && backForwardDocument && !editedHere()) onHistory();
  else schedule(pendingHistory());
  return () => {
    disposed = true; cancel();
    form.removeEventListener("input", onEdit); form.removeEventListener("change", onEdit);
    view.removeEventListener("popstate", onHistory); view.removeEventListener("pageshow", onPageShow);
  };
}

/** Inert marker preserves server-rendered, no-hydration-required native GET submission. */
export function ConsoleLibraryRunLookupSync({ ownerId, scopeHref }: { ownerId: string; scopeHref: string }) {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = marker.current?.closest<HTMLFormElement>("form[data-console-library-run-lookup]");
    if (form) return mountConsoleLibraryRunLookup(form, ownerId, scopeHref);
  }); // Rebind after retained server commits; unchanged DOM drafts retain their scoped guard.
  const scope = consoleLibraryRunLookupScope(ownerId, scopeHref);
  return <span hidden ref={marker} data-console-run-lookup-scope={scope?.key}/>;
}
