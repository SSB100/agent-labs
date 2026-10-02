import {
  advanceConsoleMotion, consoleMotionPhaseDelay, consoleMotionPresentation,
  type ConsoleMotionLedger, type ConsoleMotionSnapshot, type ConsoleMotionTarget,
} from "./console-motion";

// Browser-memory only, keyed by owner + stable data scope. No credentials or payloads.
// Recreated pages retain the last observation; a reload starts quietly.
const histories = new Map<string, ConsoleMotionLedger>();
const targets = new Set<ConsoleMotionTarget>(["core", "run", "stage", "worker", "output", "decision"]);

/** DOM adapter deliberately changes only its own data attributes/CSS variables.
 * Keeping the same cue key keeps the same CSS animation across refreshes.
 */
export function mountConsoleMotion(root: HTMLElement, options: { identity?: string; now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  const document = root.ownerDocument;
  const window = document.defaultView;
  const previous = options.identity ? histories.get(options.identity) : undefined;
  let ledger: ConsoleMotionLedger | null = previous ? { ...previous, pulses: new Map() } : null;
  let timer: number | undefined;
  let disposed = false;
  function paint() {
    if (!ledger || disposed) return;
    const time = now();
    for (const element of root.querySelectorAll<HTMLElement | SVGElement>("[data-console-motion-target]")) {
      // A nested boundary owns its own records and never inherits this one's cue.
      if (element.closest("[data-console-motion-boundary]") !== root) continue;
      const target = element.dataset.consoleMotionTarget as ConsoleMotionTarget;
      if (!targets.has(target)) continue;
      const presentation = consoleMotionPresentation(ledger, target, element.dataset.consoleMotionId ?? "", time);
      element.dataset.consoleMotionState = presentation.state;
      const epoch = presentation.state === "running" && presentation.startedAt !== null ? String(presentation.startedAt) : "";
      if (element.dataset.consoleMotionEpoch !== epoch) {
        element.dataset.consoleMotionEpoch = epoch;
        element.style.setProperty("--console-motion-phase", `${epoch ? consoleMotionPhaseDelay(Number(epoch), time) : 0}ms`);
      }
      const pulse = document.visibilityState === "hidden" ? null : presentation.pulse;
      if (element.dataset.consoleMotionEvent !== (pulse?.key ?? "")) {
        element.dataset.consoleMotionEvent = pulse?.key ?? "";
        element.style.setProperty("--console-motion-cue-delay", `${pulse ? -Math.max(0, time - pulse.startedAt) : 0}ms`);
      }
      if (pulse) element.dataset.consoleMotionCue = pulse.kind;
      else delete element.dataset.consoleMotionCue;
    }
    if (timer !== undefined) window?.clearTimeout(timer);
    const expires = [...ledger.pulses.values()].map(pulse => pulse.expiresAt).filter(value => value > time);
    timer = expires.length ? window?.setTimeout(paint, Math.max(1, Math.min(...expires) - time)) : undefined;
  }
  const visibility = () => {
    // A cue missed while away is never replayed on focus.
    if (ledger && document.visibilityState === "hidden") ledger = { ...ledger, pulses: new Map() };
    paint();
  };
  document.addEventListener("visibilitychange", visibility);
  return {
    observe(snapshot: ConsoleMotionSnapshot) {
      if (disposed) return;
      ledger = advanceConsoleMotion(ledger, snapshot, now());
      if (document.visibilityState === "hidden") ledger = { ...ledger, pulses: new Map() };
      if (options.identity) {
        histories.delete(options.identity);
        histories.set(options.identity, ledger);
        if (histories.size > 8) histories.delete(histories.keys().next().value!);
      }
      paint();
    },
    dispose() {
      disposed = true;
      if (timer !== undefined) window?.clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
      for (const element of root.querySelectorAll<HTMLElement | SVGElement>("[data-console-motion-target]")) {
        if (element.closest("[data-console-motion-boundary]") !== root) continue;
        for (const attribute of ["state", "epoch", "event", "cue"]) element.removeAttribute(`data-console-motion-${attribute}`);
        element.style.removeProperty("--console-motion-phase");
        element.style.removeProperty("--console-motion-cue-delay");
      }
    },
  };
}
