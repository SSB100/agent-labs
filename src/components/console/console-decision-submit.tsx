"use client";
import { useFormStatus } from "react-dom";
import { useEffect, useRef } from "react";
export function ConsoleDecisionSubmit({ children, value, pendingLabel = "Saving…", danger = false }: { children: string; value: string; pendingLabel?: string; danger?: boolean }) {
  const { pending } = useFormStatus();
  return <button type="submit" name="decision" value={value} className={danger ? "compactDecisionButton compactDecisionButtonDanger" : "compactDecisionButton"} disabled={pending} aria-disabled={pending} data-decision-pending={pending ? "true" : "false"}>{pending ? pendingLabel : children}</button>;
}

/** Narrow layouts use document scrolling; reveal the selected context above sticky chrome. */
export function revealNarrowDecisionHeading(element: HTMLHeadingElement) {
  const view = element.ownerDocument.defaultView;
  if (!view?.matchMedia("(max-width: 900px)").matches) return;
  const header = element.closest<HTMLElement>(".compactDecisionDetailHeader") ?? element;
  header.scrollIntoView({ block: "start", inline: "nearest", behavior: "instant" });
  const viewportTop = view.visualViewport?.offsetTop ?? 0;
  const viewportBottom = viewportTop + (view.visualViewport?.height ?? view.innerHeight);
  let visibleTop = viewportTop + 8, visibleBottom = viewportBottom - 8;
  const shell = element.closest(".consoleShell");
  for (const [selector, edge] of [[".consoleTopBar", "top"], [".consoleCommandBar", "bottom"]] as const) {
    const chrome = shell?.querySelector(selector);
    if (!chrome || !["sticky", "fixed"].includes(view.getComputedStyle(chrome).position)) continue;
    const rect = chrome.getBoundingClientRect();
    if (rect.bottom <= viewportTop || rect.top >= viewportBottom) continue;
    if (edge === "top") visibleTop = Math.max(visibleTop, rect.bottom + 8);
    else visibleBottom = Math.min(visibleBottom, rect.top - 8);
  }
  const headerRect = header.getBoundingClientRect();
  const target = headerRect.height <= visibleBottom - visibleTop ? headerRect : element.getBoundingClientRect();
  if (target.top < visibleTop || target.bottom > visibleBottom) {
    view.scrollBy({ top: target.top - visibleTop, behavior: "instant" });
  }
}

export function canFocusDecisionHeading(element: HTMLHeadingElement, selectionChanged: boolean) {
  const document = element.ownerDocument;
  if (document.querySelector("dialog[open]")) return false;
  const active = document.activeElement as HTMLElement | null;
  const interacting = active && (active.matches("input, textarea, select, button, a[href], summary") || active.isContentEditable || active.tabIndex >= 0);
  return selectionChanged || !interacting;
}

/** Exact selection/revision changes focus once; preserve dialogs and active background controls. */
export function ConsoleDecisionHeading({ noticeId, revision, children }: { noticeId: string; revision: string; children: string }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const previousNotice = useRef<string | null>(null);
  useEffect(() => {
    const element = heading.current;
    const selectionChanged = previousNotice.current !== noticeId;
    previousNotice.current = noticeId;
    if (!element || !canFocusDecisionHeading(element, selectionChanged)) return;
    element?.focus({ preventScroll: true });
    const pane = element?.closest(".compactDecisionDetail")?.querySelector(".compactDecisionDetailScroll");
    if (pane) pane.scrollTop = 0;
    if (element) revealNarrowDecisionHeading(element);
  }, [noticeId, revision]);
  return <h2 ref={heading} tabIndex={-1}>{children}</h2>;
}
