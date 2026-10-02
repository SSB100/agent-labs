"use client";
import { useFormStatus } from "react-dom";
import { useEffect, useRef } from "react";
export function ConsoleDecisionSubmit({ children, value, pendingLabel = "Saving…", danger = false }: { children: string; value: string; pendingLabel?: string; danger?: boolean }) {
  const { pending } = useFormStatus();
  return <button type="submit" name="decision" value={value} className={danger ? "compactDecisionButton compactDecisionButtonDanger" : "compactDecisionButton"} disabled={pending} aria-disabled={pending} data-decision-pending={pending ? "true" : "false"}>{pending ? pendingLabel : children}</button>;
}

/** A new exact selection starts at its heading, without moving the desktop document. */
export function ConsoleDecisionHeading({ noticeId, revision, children }: { noticeId: string; revision: string; children: string }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const element = heading.current;
    element?.focus({ preventScroll: true });
    const pane = element?.closest(".compactDecisionDetail")?.querySelector(".compactDecisionDetailScroll");
    if (pane) pane.scrollTop = 0;
  }, [noticeId, revision]);
  return <h2 ref={heading} tabIndex={-1}>{children}</h2>;
}
