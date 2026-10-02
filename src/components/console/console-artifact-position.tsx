"use client";

import { useEffect } from "react";

/** Position an explicitly selected, server-authorized output inside its own pane.
 * Native fragment restoration is inconsistent for nested scrolling disclosures. */
export function ConsoleArtifactPosition({ artifactId, workflowRunId }: { artifactId: string; workflowRunId: string }) {
  useEffect(() => {
    let frame = 0;
    function position() {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (window.location.hash !== `#artifact-${artifactId}`) return;
        // A background evidence update must not move focus or scroll behind a
        // research modal, or interrupt a goal/filter the owner is editing.
        const active = document.activeElement;
        if (document.querySelector?.("dialog[open], [aria-modal='true']") ||
          active instanceof HTMLElement && (active.matches("input,textarea,select") || active.isContentEditable)) return;
        const target = document.getElementById(`artifact-${artifactId}`);
        const pane = target?.closest<HTMLElement>("[data-console-evidence-run]");
        if (!(target instanceof HTMLDetailsElement) || pane?.dataset.consoleEvidenceRun !== workflowRunId) return;
        let ancestor: HTMLElement | null = target;
        while (ancestor && ancestor !== pane) {
          if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
          ancestor = ancestor.parentElement;
        }
        target.scrollIntoView({ block: "start", inline: "nearest", behavior: "instant" });
        target.querySelector<HTMLElement>(":scope > summary")?.focus({ preventScroll: true });
      });
    }
    position();
    window.addEventListener("pageshow", position);
    window.addEventListener("hashchange", position);
    window.addEventListener("popstate", position);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pageshow", position);
      window.removeEventListener("hashchange", position);
      window.removeEventListener("popstate", position);
    };
  }, [artifactId, workflowRunId]);
  return null;
}
