"use client";

/** Reveal only an already-focused, readonly Library JSON viewport. No mount/refresh work. */
export function revealConsoleLibraryJson(node: HTMLPreElement): boolean {
  const document = node.ownerDocument, view = document.defaultView;
  if (!view || node.isConnected === false || document.activeElement !== node || !node.matches('pre[data-console-library-json="true"]') || node.closest('[inert], dialog, [aria-modal="true"]') || document.querySelector('dialog[open], [aria-modal="true"]')) return false;
  const pane = node.closest<HTMLElement>(".consoleLibraryPane"), detail = node.closest<HTMLElement>(".consoleCollectionDetail");
  const body = pane?.querySelector<HTMLElement>(".consoleCollectionBody");
  if (!pane || !detail || !body || !pane.contains(detail)) return false;
  const mobile = view.innerWidth <= 900;
  const scroller = mobile ? null : view.innerWidth >= 1200 && body.dataset.hasSelection === "true" ? detail : body;
  const visualTop = view.visualViewport?.offsetTop ?? 0;
  let top = visualTop + 8, bottom = visualTop + (view.visualViewport?.height ?? view.innerHeight) - 8;
  if (scroller) {
    const bounds = scroller.getBoundingClientRect();
    top = Math.max(top, bounds.top + 8);
    bottom = Math.min(bottom, bounds.bottom - 8);
  }
  // The command bar is sticky on document layouts; the collection footer can be
  // sticky inside desktop layouts. Only visible overlapping bars constrain focus.
  const shell = pane.closest<HTMLElement>(".consoleShell");
  const bars = [pane.querySelector<HTMLElement>(".consoleCollectionPagination"), shell?.querySelector<HTMLElement>(".consoleCommandBar")];
  const target = node.getBoundingClientRect();
  for (const bar of bars) {
    if (!bar) continue;
    const position = view.getComputedStyle(bar).position;
    if (position !== "sticky" && position !== "fixed") continue;
    const bounds = bar.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0 || bounds.right <= target.left || bounds.left >= target.right || bounds.top >= bottom || bounds.bottom <= top) continue;
    if (bounds.top > top) bottom = Math.min(bottom, bounds.top - 8);
    else top = Math.max(top, bounds.bottom + 8);
  }
  const available = Math.floor(bottom - top);
  if (available < 48) return false;
  // Constrain the outer reading viewport, never its text or inner scrollTop.
  // The full exact JSON stays available through its own readonly scroll region.
  node.style.setProperty("--console-library-json-focus-height", `${available}px`);
  const rect = node.getBoundingClientRect();
  const delta = rect.top < top ? rect.top - top : rect.bottom > bottom ? rect.bottom - bottom : 0;
  if (Math.abs(delta) < 1) return false;
  if (scroller) scroller.scrollTop += delta;
  else view.scrollBy({ top: delta, behavior: "instant" });
  return true;
}

/** Server-rendered exact text remains readonly; an explicit focus is the only reveal trigger. */
export function ConsoleLibraryJsonText({ label, content }: { label: string; content: string }) {
  return <pre tabIndex={0} aria-label={label} data-console-library-json="true" onFocus={event => revealConsoleLibraryJson(event.currentTarget)}>{content}</pre>;
}
