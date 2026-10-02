/** Per-tab viewport state only. Never persists content, approval state, credentials, or another owner's position. */
type Layout = "split" | "single" | "document";
export type ConsoleCollectionScrollState = { version: 1; layout?: Layout; disclosures?: string[]; body: number; detail: number; document: number; mobile: boolean; savedAt: number };
const PREFIX = "agentlabs:console-viewport:v1:";
const MAX_ENTRIES = 64;
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
// Retained DOM is reusable across records. These markers contain only scoped
// identity/layout, disappear with their elements, and never replace URL snapshots.
const retainedLists = new WeakMap<HTMLElement, { key: string; layout: Layout }>();
const retainedDetails = new WeakMap<HTMLElement, { key: string; layout: Layout }>();
export function consoleCollectionScrollKey(ownerId: string, href: string, listOnly = false): string {
  const url = new URL(href, "https://console.invalid");
  if (url.searchParams.get("view") === "library") {
    for (const name of ["business", "selected", "artifact", "creativeRun"]) {
      const value = url.searchParams.get(name);
      if (url.searchParams.getAll(name).length === 1 && value && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) url.searchParams.set(name, value.toLowerCase());
    }
  }
  if (url.searchParams.get("view") === "work" && url.searchParams.getAll("run").length === 1 && url.searchParams.getAll("selected").length <= 1 && (!url.searchParams.get("selected") || url.searchParams.get("selected") === url.searchParams.get("run"))) { url.searchParams.set("selected", url.searchParams.get("run")!); url.searchParams.delete("run"); }
  if (url.searchParams.get("view") === "library" && url.searchParams.get("type") === "records" && url.searchParams.getAll("artifact").length === 1 && url.searchParams.getAll("selected").length <= 1 && (!url.searchParams.get("selected") || url.searchParams.get("selected") === url.searchParams.get("artifact"))) { url.searchParams.set("selected", url.searchParams.get("artifact")!); url.searchParams.delete("artifact"); }
  // Native GET includes default fields that the server canonicalizes away.
  // Keep equivalent URLs in one scope without collapsing ambiguous duplicates.
  if (["work", "activity", "library"].includes(url.searchParams.get("view") ?? "")) {
    const defaults: Record<string, string> = { business: "", q: "", status: "all", sort: "newest", selected: "", run: "", artifact: "", runFilter: "", page: "1", pageSize: "25" };
    if (url.searchParams.get("view") === "library") Object.assign(defaults, { type: "designs", mediaType: "all", artifactType: "all", creativeRun: "" });
    for (const [name, fallback] of Object.entries(defaults)) {
      if (url.searchParams.getAll(name).length !== 1) continue;
      const raw = url.searchParams.get(name)!;
      const value = name === "q" ? raw.trim() : ["page", "pageSize"].includes(name) && /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) ? String(Number(raw)) : raw;
      if (value === fallback) url.searchParams.delete(name); else if (value !== raw) url.searchParams.set(name, value);
    }
    if (url.searchParams.getAll("sheet").length === 1 && url.searchParams.get("sheet") === "research") url.searchParams.delete("sheet");
  }
  if (listOnly) { url.searchParams.delete("selected"); url.searchParams.delete("run"); url.searchParams.delete("artifact"); if (url.searchParams.get("view") === "library") url.searchParams.delete("creativeRun"); }
  url.searchParams.sort();
  return `${PREFIX}${encodeURIComponent(ownerId)}:${listOnly ? "list" : "exact"}:${url.pathname}?${url.searchParams}`;
}
function consoleCollectionDetailKey(ownerId: string, href: string): string {
  const url = new URL(href, "https://console.invalid");
  for (const name of ["page", "pageSize", "q", "sort", "status", "mediaType", "artifactType", "sheet"]) url.searchParams.delete(name);
  // Work artifacts are a reveal within the same run. Library's artifact alias
  // identifies the selected Record and is normalized by the shared key helper.
  if (url.searchParams.get("view") === "work") url.searchParams.delete("artifact");
  return consoleCollectionScrollKey(ownerId, `${url.pathname}${url.search}`);
}
export function parseConsoleCollectionScroll(value: string | null, now = Date.now()): ConsoleCollectionScrollState | null {
  if (!value || value.length > 16384) return null;
  try {
    const data = JSON.parse(value) as Partial<ConsoleCollectionScrollState>;
    return data.version === 1 && (data.disclosures === undefined || Array.isArray(data.disclosures) && data.disclosures.length <= 64 && data.disclosures.every(key => typeof key === "string" && key.length <= 160)) && (data.layout === undefined || ["split", "single", "document"].includes(data.layout)) && typeof data.mobile === "boolean" && [data.body, data.detail, data.document, data.savedAt].every(item => typeof item === "number" && Number.isFinite(item) && item >= 0) &&
      data.body! <= 10_000_000 && data.detail! <= 10_000_000 && data.document! <= 10_000_000 && now - data.savedAt! <= MAX_AGE && data.savedAt! <= now + 60_000 ? data as ConsoleCollectionScrollState : null;
  } catch { return null; }
}
/** Mount after the bounded server-rendered page exists. URL and history remain owned by the browser/Next. */
export function mountConsoleCollectionScroll(root: HTMLElement, ownerId: string, href: string, view: Window = window) {
  const collectionBody = root.querySelector<HTMLElement>(".consoleCollectionBody"), detail = root.querySelector<HTMLElement>(".consoleCollectionDetail");
  const results = root.querySelector<HTMLElement>(".consoleCollectionResults");
  if (!collectionBody || !ownerId) return () => {};
  const split = () => view.innerWidth >= 1200 && collectionBody.dataset.hasSelection === "true" && !!results;
  const layout = (): Layout => view.innerWidth <= 900 ? "document" : split() ? "split" : "single";
  let activeLayout = layout();
  const body = () => activeLayout === "split" ? results! : collectionBody;
  const scrollers = [...new Set([collectionBody, results].filter((element): element is HTMLElement => !!element))];
  const exactKey = consoleCollectionScrollKey(ownerId, href), listKey = consoleCollectionScrollKey(ownerId, href, true);
  const detailKey = consoleCollectionDetailKey(ownerId, href);
  let listReady = false, detailReady = !detail;
  const positions = () => ({ body: body().scrollTop, detail: detail?.scrollTop ?? 0, document: view.scrollY });
  let blockedPosition: ReturnType<typeof positions> | null = null;
  const markRetainedScope = () => {
    retainedLists.set(body(), { key: listKey, layout: activeLayout });
    if (detail) retainedDetails.set(detail, { key: detailKey, layout: activeLayout });
    listReady = true; detailReady = true;
    blockedPosition = null;
  };
  const ownerPrefix = `${PREFIX}${encodeURIComponent(ownerId)}:`;
  const marker = root.querySelector<HTMLElement>("[data-console-collection-viewport]");
  const sameScope = () => root.querySelector(".consoleCollectionBody") === collectionBody && (!marker || root.querySelector("[data-console-collection-viewport]") === marker && marker.dataset.consoleCollectionScope === exactKey);
  let disposed = false, restored = false, timer = 0, firstFrame = 0, secondFrame = 0, filterTimer = 0, filterFrame = 0;
  const mobile = () => view.innerWidth <= 900;
  const hasBlockingInteraction = () => {
    // The query guard covers the commit before the sheet calls showModal().
    if (new URL(href, "https://console.invalid").searchParams.has("sheet") || new URLSearchParams(view.location?.search ?? "").has("sheet")) return true;
    const document = root.ownerDocument ?? view.document;
    if (document?.querySelector('dialog[open], [aria-modal="true"]')) return true;
    return document?.activeElement?.matches('input, textarea, select, [contenteditable="true"], [contenteditable=""]') ?? false;
  };
  const toolbar = root.querySelector<HTMLFormElement>("form.consoleCollectionToolbar");
  let filterTicket = 0, filtersEdited = toolbar?.dataset.consoleFiltersEdited === exactKey;
  const currentHref = () => view.location?.href ?? `${view.location?.pathname ?? ""}${view.location?.search ?? ""}${view.location?.hash ?? ""}`;
  const cancelFilterReconciliation = () => {
    filterTicket++;
    view.clearTimeout(filterTimer); view.cancelAnimationFrame(filterFrame);
    filterTimer = 0; filterFrame = 0;
  };
  const navigationMatchesScope = () => !view.location?.pathname || consoleCollectionScrollKey(ownerId, `${view.location.pathname}${view.location.search}`) === exactKey;
  const reconcileFilters = (historyNavigation: boolean) => {
    if (!toolbar || disposed || toolbar.isConnected === false || !sameScope() || !navigationMatchesScope() || root.querySelector("form.consoleCollectionToolbar") !== toolbar) return;
    if (!historyNavigation && toolbar.dataset.consoleFiltersInitialized === exactKey) return;
    // Native Back can reapply the previous DOM form values after pageshow and
    // popstate. Reconcile in the following task/frame, without emitting events,
    // focusing a field, scrolling, or resetting an unchanged refresh's edits.
    const params = new URL(href, "https://console.invalid").searchParams;
    if (historyNavigation || !hasBlockingInteraction()) {
      const defaults: Record<string, string> = { q: "", business: "", status: "all", sort: "newest", runFilter: "" };
      if (params.get("view") === "library") Object.assign(defaults, { mediaType: "all", artifactType: "all" });
      for (const field of toolbar.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input[name], select[name]")) {
        if (Object.hasOwn(defaults, field.name)) field.value = params.get(field.name) ?? defaults[field.name];
      }
    }
    toolbar.dataset.consoleFiltersInitialized = exactKey;
    filtersEdited = false;
    delete toolbar.dataset.consoleFiltersEdited;
  };
  const scheduleFilterReconciliation = (historyNavigation = false) => {
    if (!toolbar || disposed || !sameScope()) return;
    cancelFilterReconciliation();
    const expectedTicket = filterTicket, expectedHref = currentHref();
    const current = () => !disposed && filterTicket === expectedTicket && currentHref() === expectedHref;
    filterTimer = view.setTimeout(() => {
      filterTimer = 0;
      if (!current()) return;
      filterFrame = view.requestAnimationFrame(() => {
        filterFrame = 0;
        if (current()) reconcileFilters(historyNavigation);
      });
    }, 0);
  };
  const onFilterEdit = () => {
    filtersEdited = true;
    if (toolbar) {
      // Retain this decision across a same-form server refresh, including an edit
      // made before the initial queued restoration had a chance to run.
      toolbar.dataset.consoleFiltersEdited = exactKey;
      toolbar.dataset.consoleFiltersInitialized = exactKey;
    }
    cancelFilterReconciliation();
  };
  const read = (key: string) => { try { return parseConsoleCollectionScroll(view.sessionStorage.getItem(key)); } catch { return null; } };
  let captured: ConsoleCollectionScrollState | null = null;
  const disclosures = () => Array.from(root.querySelectorAll<HTMLDetailsElement>("details[data-console-disclosure]"));
  const restoreDisclosures = (state: ConsoleCollectionScrollState, region: "all" | "list" | "detail" = "all") => {
    if (!state.disclosures) return;
    const open = new Set(state.disclosures);
    for (const node of disclosures()) {
      const list = node.dataset.consoleDisclosure?.startsWith("row:");
      if (region === "all" || (region === "list" ? list : !list)) node.open = open.has(node.dataset.consoleDisclosure!);
    }
  };
  const capture = () => {
    if (disposed || !restored || !listReady || !detailReady || !sameScope() || !navigationMatchesScope() || activeLayout !== layout()) return;
    captured = { version: 1, layout: activeLayout, disclosures: disclosures().filter(node => node.open).map(node => node.dataset.consoleDisclosure!).filter(key => key.length <= 160).slice(0, 64), body: body().scrollTop, detail: detail?.scrollTop ?? 0, document: view.scrollY, mobile: mobile(), savedAt: Date.now() };
  };
  // Disposal may run after React has replaced/clamped the retained list DOM.
  // Persist the last observed/pre-navigation snapshot; never read DOM in cleanup.
  const flush = () => {
    if (disposed || !captured) return;
    const state = captured;
    const listState = { ...state, detail: 0, disclosures: state.disclosures?.filter(key => key.startsWith("row:")) };
    try {
      const storage = view.sessionStorage;
      storage.setItem(exactKey, JSON.stringify(state));
      storage.setItem(listKey, JSON.stringify(listState));
      storage.setItem(`${exactKey}:${activeLayout}`, JSON.stringify(state));
      storage.setItem(`${listKey}:${activeLayout}`, JSON.stringify(listState));
      const entries: { key: string; savedAt: number }[] = [];
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (key?.startsWith(ownerPrefix)) entries.push({ key, savedAt: parseConsoleCollectionScroll(storage.getItem(key))?.savedAt ?? 0 });
      }
      entries.sort((a, b) => b.savedAt - a.savedAt);
      for (const entry of entries.slice(MAX_ENTRIES)) storage.removeItem(entry.key);
    } catch { /* Disabled/full tab storage must never block native navigation. */ }
  };
  const save = () => { capture(); flush(); };
  const hasExactArtifactFragment = () => {
    const url = new URL(href, "https://console.invalid");
    const artifactId = url.searchParams.get("artifact"), runId = url.searchParams.get("selected") ?? url.searchParams.get("run");
    // Only an exact server-rendered output inside this selected run may take
    // precedence over stored positions. Never let a different fragment retarget it.
    if (!artifactId || !runId || !/^[a-f0-9-]{36}$/i.test(artifactId) || view.location?.hash !== `#artifact-${artifactId}`) return false;
    const target = root.querySelector<HTMLDetailsElement>(`details[id="artifact-${artifactId}"]`);
    return target?.closest<HTMLElement>("[data-console-evidence-run]")?.dataset.consoleEvidenceRun === runId;
  };
  const updateToolbarOffset = () => {
    if (disposed || !sameScope()) return;
    const toolbar = root.querySelector<HTMLElement>(".consoleCollectionToolbar");
    if (toolbar) root.style.setProperty("--console-collection-toolbar-height", `${Math.ceil(toolbar.getBoundingClientRect().height)}px`);
  };
  const restore = (preserve?: "list" | "detail" | "combined") => {
    if (disposed || !sameScope() || !navigationMatchesScope()) return;
    updateToolbarOffset();
    activeLayout = layout();
    const compatible = (state: ConsoleCollectionScrollState | null) => state?.mobile === mobile() && (!state.layout || state.layout === activeLayout) ? state : null;
    const exact = compatible(read(`${exactKey}:${activeLayout}`)) ?? compatible(read(exactKey));
    const listCompatible = (state: ConsoleCollectionScrollState | null) => state?.mobile === mobile() ? state : null;
    const fallback = exact ? null : listCompatible(read(`${listKey}:${activeLayout}`)) ?? listCompatible(read(listKey)), state = exact ?? fallback;
    const previousList = retainedLists.get(body()), previousDetail = detail ? retainedDetails.get(detail) : undefined;
    const sameList = previousList?.key === listKey && previousList.layout === activeLayout;
    const sameDetail = previousDetail?.key === detailKey && previousDetail.layout === activeLayout;
    const artifactFragment = hasExactArtifactFragment();
    // Never reposition the inert background or steal the reading position from
    // an editor, nor save an inherited old-record position under the new URL.
    if (hasBlockingInteraction()) {
      listReady = sameList; detailReady = !detail || sameDetail;
      blockedPosition = positions();
      restored = true; capture(); return;
    }
    // After a blocked restore, a deliberate scroll owns that region's current
    // reading position. Initialize only its still-unread companion; never use
    // inherited old-record DOM as a new snapshot or close the disclosure being read.
    const keepList = !!preserve && (preserve !== "detail" || listReady);
    const keepDetail = !!preserve && (preserve !== "list" || detailReady);
    if (state && state.mobile === mobile()) {
      // A list fallback owns row disclosures only. Applying it to a retained
      // same-record detail would close its JSON and clamp its reading position.
      if (!keepList && !keepDetail && exact) restoreDisclosures(state);
      else {
        if (!keepList) restoreDisclosures(state, "list");
        if (!keepDetail && exact) restoreDisclosures(state, "detail");
      }
      if (!keepList && (!artifactFragment || split())) body().scrollTop = state.body;
      if (exact && !artifactFragment) {
        if (detail && !keepDetail) detail.scrollTop = exact.detail;
        if (!preserve) view.scrollTo({ top: exact.document, behavior: "instant" });
      }
      // A newly selected mobile detail keeps its native anchor rather than old document scroll.
    } else if (!keepList && !sameList && (!artifactFragment || split())) {
      body().scrollTop = 0;
      if (activeLayout === "document" && !detail) view.scrollTo({ top: 0, behavior: "instant" });
    }
    // Reused detail elements do not reset themselves when Record JSON is
    // replaced by another record/run. Exact snapshots and exact artifact reveal
    // win; otherwise only an actually unchanged scoped detail inherits scroll.
    if (!keepDetail && !exact && detail && !sameDetail && !artifactFragment) detail.scrollTop = 0;
    // A direct selected/run URL has no native fragment. Reveal its independently
    // verified detail on the one-column layouts, only on its first visit. Exact
    // Back/reload snapshots and an authorized artifact fragment retain priority.
    const selectedState = detail?.dataset.consoleSelection;
    const freshSelection = selectedState === "found" || new URL(href, "https://console.invalid").searchParams.get("view") === "library" && ["missing", "unavailable"].includes(selectedState ?? "");
    const detailAnchor = view.location?.hash === "#console-collection-detail";
    if (!preserve && !exact && detail && activeLayout !== "split" && (!sameDetail || !sameList) && !artifactFragment && (freshSelection || detailAnchor)) {
      detail.scrollIntoView({ block: "start", inline: "nearest", behavior: "instant" });
    }
    markRetainedScope();
    restored = true;
    capture();
  };
  const scheduleRestore = () => {
    if (disposed || !sameScope()) return;
    restored = false; // Ignore early bfcache/native scroll events until the saved layout is reapplied.
    view.cancelAnimationFrame(firstFrame); view.cancelAnimationFrame(secondFrame);
    firstFrame = view.requestAnimationFrame(() => { secondFrame = view.requestAnimationFrame(() => restore()); });
  };
  const onScroll = (event: Event) => {
    // Breakpoint CSS can clamp the old scroller before resize fires. Keep the
    // last observed snapshot until the new layout has been restored.
    if (disposed || !restored || !sameScope() || !navigationMatchesScope() || activeLayout !== layout()) return;
    // Document scrolling bubbles to the Window listener with Document as its
    // target. Accept only this pane's owning document, never another surface.
    const document = root.ownerDocument ?? view.document;
    if (event.target !== view && event.target !== document && event.target !== body() && !(activeLayout === "split" && event.target === detail)) return;
    if (hasBlockingInteraction()) {
      // A modal/editor may cause a native scroll of its own. That is not later
      // reading intent merely because its queued event arrives after blur.
      if (!listReady || !detailReady) blockedPosition = positions();
      return;
    }
    if (!listReady || !detailReady) {
      if (!blockedPosition) return;
      if (activeLayout === "split" && event.target === detail && detail!.scrollTop !== blockedPosition.detail) restore("detail");
      else if (activeLayout === "split" && event.target === body() && body().scrollTop !== blockedPosition.body) restore("list");
      else if (activeLayout === "single" && event.target === body() && body().scrollTop !== blockedPosition.body || activeLayout === "document" && (event.target === view || event.target === document) && view.scrollY !== blockedPosition.document) restore("combined");
      else return;
    }
    capture(); view.clearTimeout(timer); timer = view.setTimeout(flush, 120);
  };
  const onPageHide = () => save();
  const onPageShow = (event: PageTransitionEvent) => {
    scheduleRestore();
    // A returned bfcache entry needs URL reconciliation. A late first-load
    // pageshow must not replace an owner's newer edits with server defaults.
    if (event.persisted) scheduleFilterReconciliation(true);
    else if (!filtersEdited) scheduleFilterReconciliation();
  };
  const onPopState = () => scheduleFilterReconciliation(true);
  const onResize = () => {
    if (disposed || !restored || !sameScope() || !navigationMatchesScope() || hasBlockingInteraction()) return;
    updateToolbarOffset();
    const nextLayout = layout();
    if (nextLayout === activeLayout) { save(); return; }
    if (!listReady || !detailReady) { restore(); flush(); return; }
    const previous = captured;
    flush(); // Never read the old, potentially clamped DOM after a breakpoint.
    activeLayout = nextLayout;
    const stored = read(`${exactKey}:${activeLayout}`);
    if (stored) {
      restoreDisclosures(stored);
      body().scrollTop = stored.body;
      if (detail) detail.scrollTop = stored.detail;
      view.scrollTo({ top: stored.document, behavior: "instant" });
    } else if (previous && nextLayout !== "document") {
      body().scrollTop = previous.body;
      if (detail && nextLayout === "split") detail.scrollTop = previous.detail;
    }
    markRetainedScope();
    capture(); flush();
  };
  for (const scroller of scrollers) scroller.addEventListener("scroll", onScroll, { passive: true });
  detail?.addEventListener("scroll", onScroll, { passive: true });
  view.addEventListener("scroll", onScroll, { passive: true });
  root.addEventListener("click", save, true);
  root.addEventListener("submit", save, true);
  root.addEventListener("toggle", save, true);
  view.addEventListener("resize", onResize, { passive: true });
  view.addEventListener("pagehide", onPageHide);
  view.addEventListener("pageshow", onPageShow);
  view.addEventListener("popstate", onPopState);
  toolbar?.addEventListener("input", onFilterEdit);
  toolbar?.addEventListener("change", onFilterEdit);
  scheduleRestore();
  scheduleFilterReconciliation();
  return () => {
    flush(); disposed = true; cancelFilterReconciliation();
    view.clearTimeout(timer); view.cancelAnimationFrame(firstFrame); view.cancelAnimationFrame(secondFrame);
    for (const scroller of scrollers) scroller.removeEventListener("scroll", onScroll);
    detail?.removeEventListener("scroll", onScroll);
    view.removeEventListener("scroll", onScroll); root.removeEventListener("click", save, true); root.removeEventListener("submit", save, true); root.removeEventListener("toggle", save, true);
    view.removeEventListener("resize", onResize);
    view.removeEventListener("pagehide", onPageHide); view.removeEventListener("pageshow", onPageShow); view.removeEventListener("popstate", onPopState);
    toolbar?.removeEventListener("input", onFilterEdit);
    toolbar?.removeEventListener("change", onFilterEdit);
  };
}
