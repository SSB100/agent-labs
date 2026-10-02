import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { collectionFixture, collectionMarkup, collectionBusinesses, id, panes, scroll, workDetailFixture, workDetailMarkup } from "./helpers/console-collection-fixtures.mjs";

for (const kind of ["work", "activity"]) {
  test(`${kind}: 127 records stay server-bounded to25 with honest totals, identities and native GET controls`, () => {
    const markup = collectionMarkup(kind);
    assert.equal((markup.match(/data-record-id=/g) ?? []).length, 25);
    assert.match(markup, /1–25 of 127/); assert.match(markup, /25 loaded/);
    assert.match(markup, /method="get"/); assert.match(markup, /action="\/dashboard"/);
    assert.match(markup, /name="pageSize" value="25"/);
    assert.match(markup, /North Star Design Studio/); assert.match(markup, /000001/); assert.match(markup, /000002/);
    assert.match(markup, /name="business"/); assert.match(markup, /name="sort"/);
    assert.doesNotMatch(markup, /type="submit"[^>]*>Approve/);
  });
  test(`${kind}: last-page loaded count does not masquerade as total`, () => {
    const markup = collectionMarkup(kind, { searchParams: { page: "6" } });
    assert.equal((markup.match(/data-record-id=/g) ?? []).length, 2);
    assert.match(markup, /126–127 of 127/); assert.match(markup, /2 loaded/);
    assert.match(markup, /aria-disabled="true">Next/);
  });
}
test("native filter submission preserves selected/Business-independent state and removes the old page", () => {
  const markup = collectionMarkup("work", { searchParams: { business: id(1), selected: id(1000), page: "3", q: "Duplicate", artifact: id(42), custom: "kept", sort: "oldest" } });
  const form = markup.match(/<form[\s\S]*?<\/form>/)[0];
  assert.match(form, /name="selected" value="00000000-0000-4000-8000-000000001000"/);
  assert.match(form, /name="artifact" value="00000000-0000-4000-8000-000000000042"/);
  assert.match(form, /name="custom" value="kept"/);
  assert.doesNotMatch(form, /name="page"/);
  assert.match(form, /value="00000000-0000-4000-8000-000000000001" selected=""/);
  for (const href of [...markup.matchAll(/href="([^"]*selected=[^"]*)"/g)].map(match => new URL(match[1].replaceAll("&amp;", "&"), "https://fixture.test"))) {
    assert.equal(href.searchParams.get("business"), id(1)); if (href.searchParams.has("page")) assert.equal(href.searchParams.get("q"), "Duplicate"); assert.equal(href.searchParams.get("custom"), "kept");
  }
});
test("selected old/off-page detail remains independent; wrong Business is missing, never replaced", () => {
  const old = collectionMarkup("work", { searchParams: { selected: id(1000), business: id(1) } });
  assert.match(old, /data-fixture-detail="00000000-0000-4000-8000-000000001000"/);
  assert.doesNotMatch(old, /data-record-id="00000000-0000-4000-8000-000000001000"/);
  const wrong = collectionMarkup("work", { searchParams: { selected: id(1000), business: id(2) } });
  assert.match(wrong, /Your Business filter has been kept/); assert.doesNotMatch(wrong, /data-fixture-detail=/);
});
test("unknown total, empty, unavailable, missing selection and loading stay distinct", () => {
  const unknown = collectionMarkup("work", { page: { total: null, hasNext: null, complete: false, errors: ["Count unavailable"] } });
  assert.match(unknown, /25 runs loaded on page 1 · Total unavailable/); assert.match(unknown, /Next unverified/); assert.match(unknown, /Page completeness unverified/);
  assert.doesNotMatch(unknown, /No matching records/);
  assert.match(collectionMarkup("work", { page: { items: [], total: 0, hasNext: false } }), /No matching records/);
  const failed = collectionMarkup("work", { page: { items: [], total: null, complete: false, errors: ["Failed read"] }, data: { errors: ["Failed read"] } });
  assert.match(failed, /Records unavailable/); assert.doesNotMatch(failed, /No matching records/);
  const loading = renderToStaticMarkup(React.createElement(panes.ConsoleCollectionLoading, { kind: "work" }));
  assert.match(loading, /aria-busy="true"/); assert.match(loading, /Loading this saved page/); assert.doesNotMatch(loading, /0 runs/);
});



test("Activity labels its actual search field and exact optional run filter", () => {
  const markup = collectionMarkup("activity", { searchParams: { runFilter: id(1000) } });
  assert.match(markup, /Search event type/); assert.match(markup, /Workflow run ID \(optional\)/); assert.match(markup, /name="runFilter"/); assert.match(markup, /1–1 of 1 events/);
});
test("unavailable Business stays explicitly selected rather than falling back to another Business", () => {
  const markup = collectionMarkup("work", { searchParams: { business: id(999) } });
  assert.match(markup, /value="00000000-0000-4000-8000-000000000999" selected="">Unavailable Business/);
});
test("presentation has no fetch-all client pagination, mutations, generic approvals or provider imports", () => {
  const source = readFileSync("src/components/console/console-collection-panes.tsx", "utf8");
  assert.doesNotMatch(source, /["']use client["']|useState|useEffect|fetch\(|\.rpc\(|\.insert\(|\.update\(|approve.*from|formAction=/);
  assert.match(source, /import type[\s\S]+console-collections/);
  const css = readFileSync("src/components/console/console-collection-panes.css", "utf8");
  assert.match(css, /:focus-visible/); assert.match(css, /max-width:900px/); assert.match(css, /min-height:44px/); assert.match(css, /overflow-wrap:anywhere/);
});
test("viewport keys preserve every filter and owner; selection fallback never crosses Business/page", () => {
  const url = `/dashboard?view=work&business=${id(1)}&q=Duplicate&page=2&selected=${id(1000)}`;
  assert.notEqual(scroll.consoleCollectionScrollKey("owner-one", url), scroll.consoleCollectionScrollKey("owner-two", url));
  assert.notEqual(scroll.consoleCollectionScrollKey("owner-one", url, true), scroll.consoleCollectionScrollKey("owner-one", url.replace("page=2", "page=3"), true));
  assert.notEqual(scroll.consoleCollectionScrollKey("owner-one", url, true), scroll.consoleCollectionScrollKey("owner-one", url.replace(id(1), id(2)), true));
  assert.equal(scroll.consoleCollectionScrollKey("owner-one", url, true), scroll.consoleCollectionScrollKey("owner-one", url.replace(id(1000), id(1001)), true));
});
test("viewport storage accepts only bounded positions and degrades safely when storage is invalid", () => {
  const now = Date.now(), valid = { version: 1, body: 320, detail: 120, document: 0, mobile: false, savedAt: now };
  assert.equal(scroll.parseConsoleCollectionScroll(JSON.stringify(valid), now).body, 320);
  for (const input of [null, "malformed", JSON.stringify({ ...valid, body: -1 }), JSON.stringify({ ...valid, document: 1e12 }), JSON.stringify({ ...valid, savedAt: 1 }), JSON.stringify({ ...valid, mobile: "false" })]) assert.equal(scroll.parseConsoleCollectionScroll(input, now), null);
});
test("all synthetic data is scoped across exactly two Businesses", () => { assert.equal(collectionBusinesses.length, 2); });

function scrollHarness({ width = 1440, selected = false, store = new Map() } = {}) {
  class Node extends EventTarget { scrollTop = 0; dataset = {}; scrollIntoView() {} }
  const body = new Node(), results = new Node(), detail = new Node(), root = new Node();
  root.querySelectorAll = () => [];
  body.dataset.hasSelection = String(selected);
  detail.dataset.consoleSelection = selected ? "found" : "none";
  root.querySelector = selector => ({ ".consoleCollectionBody": body, ".consoleCollectionResults": results, ".consoleCollectionDetail": selected ? detail : null })[selector];
  const frames = new Map(), timers = new Map(); let sequence = 0;
  const view = new EventTarget(); Object.assign(view, {
    innerWidth: width, scrollY: 0,
    sessionStorage: { get length() { return store.size; }, key: index => [...store.keys()][index], getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) },
    requestAnimationFrame: callback => { const key = ++sequence; frames.set(key, callback); return key; }, cancelAnimationFrame: key => frames.delete(key),
    setTimeout: callback => { const key = ++sequence; timers.set(key, callback); return key; }, clearTimeout: key => timers.delete(key),
    scrollTo: ({ top }) => { view.scrollY = top; },
  });
  const flush = () => { for (let pass = 0; pass < 2; pass++) { const pending = [...frames]; frames.clear(); for (const [, callback] of pending) callback(); } };
  const flushTimers = () => { const pending = [...timers]; timers.clear(); for (const [, callback] of pending) callback(); };
  return { view, root, body, results, detail, store, flush, flushTimers };
}
test("mounted desktop viewport saves and restores inner list/detail scroll without changing navigation", () => {
  const href = `/dashboard?view=work&business=${id(1)}&selected=${id(1000)}`, first = scrollHarness({ selected: true });
  const dispose = scroll.mountConsoleCollectionScroll(first.root, "owner", href, first.view); first.flush();
  first.results.scrollTop = 712; first.detail.scrollTop = 345; first.root.dispatchEvent(new Event("click")); dispose();
  const second = scrollHarness({ selected: true, store: first.store });
  const cleanup = scroll.mountConsoleCollectionScroll(second.root, "owner", href, second.view); second.flush();
  assert.equal(second.results.scrollTop, 712); assert.equal(second.detail.scrollTop, 345); assert.equal(second.body.scrollTop, 0); cleanup();
});
test("list selection inherits desktop list position; mobile preserves new native anchor then exact reload position", () => {
  const href = `/dashboard?view=work&business=${id(1)}`, first = scrollHarness();
  const dispose = scroll.mountConsoleCollectionScroll(first.root, "owner", href, first.view); first.flush(); first.body.scrollTop = 550; first.body.dispatchEvent(new Event("scroll")); dispose();
  const selected = scrollHarness({ selected: true, store: first.store });
  const selectedDispose = scroll.mountConsoleCollectionScroll(selected.root, "owner", `${href}&selected=${id(1000)}`, selected.view); selected.flush();
  assert.equal(selected.results.scrollTop, 550); assert.equal(selected.detail.scrollTop, 0); selectedDispose();
  const mobile = scrollHarness({ width: 390 });
  const mobileDispose = scroll.mountConsoleCollectionScroll(mobile.root, "owner", href, mobile.view); mobile.flush(); mobile.view.scrollY = 700; mobile.view.dispatchEvent(new Event("scroll")); mobileDispose();
  const mobileSelected = scrollHarness({ width: 390, selected: true, store: mobile.store }); mobileSelected.view.scrollY = 2000;
  const saveSelected = scroll.mountConsoleCollectionScroll(mobileSelected.root, "owner", `${href}&selected=${id(1000)}`, mobileSelected.view); mobileSelected.flush();
  assert.equal(mobileSelected.view.scrollY, 2000, "new selection must keep native anchor"); mobileSelected.view.scrollY = 2350; mobileSelected.view.dispatchEvent(new Event("scroll")); saveSelected();
  const reloaded = scrollHarness({ width: 390, selected: true, store: mobile.store });
  const cleanup = scroll.mountConsoleCollectionScroll(reloaded.root, "owner", `${href}&selected=${id(1000)}`, reloaded.view); reloaded.flush(); assert.equal(reloaded.view.scrollY, 2350); cleanup();
});
test("blocked session storage and early disposal do not interrupt navigation or erase saved positions", () => {
  const blocked = scrollHarness(); Object.defineProperty(blocked.view, "sessionStorage", { get() { throw new Error("Storage denied"); } });
  const dispose = scroll.mountConsoleCollectionScroll(blocked.root, "owner", "/dashboard?view=work", blocked.view); blocked.flush(); assert.doesNotThrow(() => blocked.root.dispatchEvent(new Event("click"))); assert.doesNotThrow(dispose);
  const early = scrollHarness(); const before = new Map(early.store); const cleanup = scroll.mountConsoleCollectionScroll(early.root, "owner", "/dashboard?view=work", early.view); cleanup(); early.flush(); assert.deepEqual(early.store, before);
});



test("a verified exact artifact fragment wins over viewport restoration without losing the independent list position", () => {
  const artifactId = id(42), runId = id(1000), href = `/dashboard?view=work&selected=${runId}&artifact=${artifactId}`;
  for (const width of [1440, 1000, 390]) {
    const fixture = scrollHarness({ selected: true, width });
    fixture.store.set(scroll.consoleCollectionScrollKey("owner", href), JSON.stringify({ version: 1, body: 450, detail: 80, document: 20, mobile: width <= 900, savedAt: Date.parse("2026-10-02T03:00:00.000Z") }));
    fixture.view.location = { hash: `#artifact-${artifactId}` };
    const original = fixture.root.querySelector;
    fixture.root.querySelector = selector => selector === `details[id="artifact-${artifactId}"]` ? { closest: () => ({ dataset: { consoleEvidenceRun: runId } }) } : original(selector);
    // The exact artifact-position effect has already positioned/focused its record.
    fixture.body.scrollTop = 700; fixture.detail.scrollTop = 710; fixture.view.scrollY = 1500;
    const dispose = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.flush();
    assert.equal(fixture.detail.scrollTop, 710); assert.equal(fixture.view.scrollY, 1500);
    if (width >= 1200) assert.equal(fixture.results.scrollTop, 450); else assert.equal(fixture.body.scrollTop, 700);
    dispose();
  }
});

test("unmatched artifact fragments do not bypass saved viewport restoration", () => {
  const artifactId = id(42), href = `/dashboard?view=work&selected=${id(1000)}&artifact=${artifactId}`;
  const fixture = scrollHarness({ selected: true });
  fixture.store.set(scroll.consoleCollectionScrollKey("owner", href), JSON.stringify({ version: 1, body: 450, detail: 80, document: 20, mobile: false, savedAt: Date.parse("2026-10-02T03:00:00.000Z") }));
  fixture.view.location = { hash: `#artifact-${artifactId}` };
  const original = fixture.root.querySelector;
  fixture.root.querySelector = selector => selector === `details[id="artifact-${artifactId}"]` ? { closest: () => ({ dataset: { consoleEvidenceRun: id(1001) } }) } : original(selector);
  fixture.detail.scrollTop = 710; fixture.view.scrollY = 1500;
  const dispose = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.flush();
  assert.equal(fixture.results.scrollTop, 450); assert.equal(fixture.detail.scrollTop, 80); assert.equal(fixture.view.scrollY, 20); dispose();
});


test("retained client DOM mutation cannot overwrite the old owner/URL scroll snapshot during cleanup", () => {
  const href = `/dashboard?view=work&page=1`, next = `/dashboard?view=work&page=2`;
  const fixture = scrollHarness(), marker = { dataset: { consoleCollectionScope: scroll.consoleCollectionScrollKey("owner", href) } };
  const original = fixture.root.querySelector;
  fixture.root.querySelector = selector => selector === "[data-console-collection-viewport]" ? marker : original(selector);
  const dispose = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.flush();
  fixture.body.scrollTop = 712; fixture.body.dispatchEvent(new Event("scroll"));
  fixture.root.dispatchEvent(new Event("click"));
  marker.dataset.consoleCollectionScope = scroll.consoleCollectionScrollKey("next-owner", next);
  fixture.body.scrollTop = 0; fixture.body.dispatchEvent(new Event("scroll"));
  fixture.root.dispatchEvent(new Event("submit"));
  dispose();
  const saved = JSON.parse(fixture.store.get(scroll.consoleCollectionScrollKey("owner", href)));
  assert.equal(saved.body, 712);
  assert.equal(fixture.store.has(scroll.consoleCollectionScrollKey("next-owner", next)), false);
  const back = scrollHarness({ store: fixture.store });
  const cleanup = scroll.mountConsoleCollectionScroll(back.root, "owner", href, back.view); back.flush();
  assert.equal(back.body.scrollTop, 712); cleanup();
});

test("debounced scroll cleanup flushes its immediate snapshot without reading the mutated DOM", () => {
  const href = "/dashboard?view=work", fixture = scrollHarness();
  const dispose = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.flush();
  fixture.body.scrollTop = 712; fixture.body.dispatchEvent(new Event("scroll"));
  fixture.body.scrollTop = 0; dispose();
  assert.equal(JSON.parse(fixture.store.get(scroll.consoleCollectionScrollKey("owner", href))).body, 712);
});


test("retained selected pane transfers its last snapshot before a breakpoint can clamp the old scroller", () => {
  const href = `/dashboard?view=work&selected=${id(1000)}`, fixture = scrollHarness({ selected: true });
  const dispose = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.flush();
  fixture.results.scrollTop = 712; fixture.results.dispatchEvent(new Event("scroll"));
  fixture.view.innerWidth = 1000; fixture.body.scrollTop = 330; fixture.view.dispatchEvent(new Event("resize"));
  assert.equal(JSON.parse(fixture.store.get(scroll.consoleCollectionScrollKey("owner", href))).body, 712);
  fixture.body.scrollTop = 440; fixture.body.dispatchEvent(new Event("scroll")); dispose();
  const back = scrollHarness({ selected: true, width: 1000, store: fixture.store });
  const cleanup = scroll.mountConsoleCollectionScroll(back.root, "owner", href, back.view); back.flush();
  assert.equal(back.body.scrollTop, 440);
  back.view.innerWidth = 1440; back.results.scrollTop = 610; back.view.dispatchEvent(new Event("resize"));
  assert.equal(JSON.parse(back.store.get(scroll.consoleCollectionScrollKey("owner", href))).body, 712); cleanup();
});


test("new mobile selected-heading anchors are positioned without discarding subsequent reading position", () => {
  const href = `/dashboard?view=work&selected=${id(1000)}`, fixture = scrollHarness({ selected: true, width: 390 }), properties = new Map(), positioned = [];
  fixture.root.style = { setProperty: (key, value) => properties.set(key, value) };
  const original = fixture.root.querySelector;
  fixture.root.querySelector = selector => selector === ".consoleCollectionToolbar" ? { getBoundingClientRect: () => ({ height: 240 }) } : original(selector);
  fixture.detail.scrollIntoView = options => { positioned.push(options); fixture.view.scrollY = 900; };
  fixture.view.location = { hash: "#console-collection-detail" };
  const dispose = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.flush();
  assert.equal(properties.get("--console-collection-toolbar-height"), "240px"); assert.equal(positioned.length, 1); assert.equal(positioned[0].block, "start");
  fixture.view.scrollY = 1400; fixture.view.dispatchEvent(new Event("scroll")); dispose();
  positioned.length = 0;
  const again = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.flush();
  assert.equal(positioned.length, 0, "reload preserves the exact saved reading position"); assert.equal(fixture.view.scrollY, 1400); again();
});


test("a desktop-only stored position cannot suppress a newly opened mobile heading anchor", () => {
  const href = `/dashboard?view=work&selected=${id(1000)}`, fixture = scrollHarness({ selected: true, width: 390 }), positioned = [];
  fixture.store.set(scroll.consoleCollectionScrollKey("owner", href), JSON.stringify({ version: 1, body: 450, detail: 80, document: 20, mobile: false, savedAt: Date.parse("2026-10-02T03:00:00.000Z") }));
  fixture.detail.scrollIntoView = options => positioned.push(options);
  fixture.view.location = { hash: "#console-collection-detail" };
  const dispose = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.flush();
  assert.equal(positioned.length, 1); assert.equal(fixture.detail.scrollTop, 0); dispose();
});

test("0/1/49/50/51/127 collections use complete native server pages with stable equal-time IDs", () => {
  for (const kind of ["work", "activity"]) for (const count of [0, 1, 49, 50, 51, 127]) {
    const first = collectionFixture(kind, { recordCount: count });
    assert.equal(first.data.page.items.length, Math.min(count, 25));
    assert.equal(first.data.page.total, count);
    assert.equal(first.data.page.hasNext, count > 25);
    const last = collectionFixture(kind, { recordCount: count, searchParams: { page: String(Math.max(1, Math.ceil(count / 25))) } });
    assert.equal(last.data.page.items.length, count ? (count - 1) % 25 + 1 : 0);
    assert.equal(last.data.page.hasNext, false);
  }
});
test("oversized supplied page is rejected visibly rather than silently sliced or rendered", () => {
  const fixture = collectionFixture("work");
  const markup = collectionMarkup("work", { page: { items: [...fixture.data.page.items, fixture.data.page.items[0]], pageSize: 26 } });
  assert.match(markup, /exceeds the 25-record page limit/);
  assert.doesNotMatch(markup, /data-record-id=/);
});
test("legacy Work run links canonicalize selection and closing cannot reopen the legacy alias", () => {
  const markup = collectionMarkup("work", { searchParams: { run: id(1000), business: id(1), artifact: id(42) } });
  const close = markup.match(/href="([^"]+)">Close detail/)[1].replaceAll("&amp;", "&");
  const url = new URL(close, "https://fixture.invalid");
  assert.equal(url.searchParams.has("run"), false); assert.equal(url.searchParams.has("selected"), false); assert.equal(url.searchParams.has("artifact"), false);
  assert.equal(url.searchParams.get("business"), id(1));
  assert.match(markup, new RegExp(`name="selected" value="${id(1000)}"`));
  assert.doesNotMatch(markup, /name="run"/);
});
test("unknown run state and ended active status remain truthful in the compact list", () => {
  const markup = collectionMarkup("work", { searchParams: { sort: "oldest" } });
  assert.match(markup, />Stopped<\/span>/); assert.match(markup, />Unknown<\/span>/); assert.match(markup, /Saved: future_unsupported_state/);
});
test("Activity detail is exact raw evidence and only links an independently verified same-Business run", () => {
  const markup = collectionMarkup("activity", { searchParams: { selected: id(10000), page: "3", q: "failed" } });
  assert.match(markup, /immutable underlying audit record/); assert.match(markup, /&quot;exact&quot;: 0/);
  assert.match(markup, new RegExp(`view=work&amp;business=${id(1)}&amp;selected=${id(1000)}`));
  const foreign = collectionMarkup("activity", { searchParams: { selected: id(10000) }, data: { runs: [{ id: id(1000), business_id: id(2) }] } });
  assert.doesNotMatch(foreign, /Inspect exact work/); assert.match(foreign, /Linked workflow context could not be verified/);
  assert.match(collectionMarkup("activity", { searchParams: { q: "payload-only-term" } }), /No matching records/);
});
test("inactive clamped scrollers cannot overwrite active split-list position", () => {
  const href = `/dashboard?view=work&selected=${id(1000)}`, fixture = scrollHarness({ selected: true });
  const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.flush();
  fixture.results.scrollTop = 420; fixture.results.dispatchEvent(new Event("scroll"));
  fixture.body.scrollTop = 0; fixture.body.dispatchEvent(new Event("scroll")); cleanup();
  assert.equal(JSON.parse(fixture.store.get(scroll.consoleCollectionScrollKey("owner", href))).body, 420);
});
test("responsive document and split modes retain their independent reading positions", () => {
  const href = `/dashboard?view=work&selected=${id(1000)}`, fixture = scrollHarness({ selected: true });
  const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.flush();
  fixture.results.scrollTop = 420; fixture.detail.scrollTop = 81; fixture.results.dispatchEvent(new Event("scroll"));
  fixture.view.innerWidth = 390; fixture.results.scrollTop = 0; fixture.results.dispatchEvent(new Event("scroll")); fixture.view.dispatchEvent(new Event("resize"));
  fixture.view.scrollY = 1400; fixture.view.dispatchEvent(new Event("scroll"));
  fixture.view.innerWidth = 1440; fixture.view.dispatchEvent(new Event("resize"));
  assert.equal(fixture.results.scrollTop, 420); assert.equal(fixture.detail.scrollTop, 81);
  fixture.view.innerWidth = 390; fixture.view.dispatchEvent(new Event("resize")); assert.equal(fixture.view.scrollY, 1400); cleanup();
});
test("layout regions are keyboard focusable with readable reflow instead of clipped content", () => {
  const markup = collectionMarkup("work", { searchParams: { selected: id(1000) } });
  assert.match(markup, /class="consoleCollectionResults" tabindex="0" role="region"/);
  assert.match(markup, /class="consoleCollectionDetail" data-console-selection="found" tabindex="0"/);
  const css = readFileSync("src/components/console/console-collection-panes.css", "utf8");
  assert.match(css, /scroll-padding:12px/); assert.match(css, /height:auto/); assert.match(css, /white-space:pre-wrap/);
  const source = readFileSync("src/components/console/console-collection-panes.tsx", "utf8");
  assert.match(source, /<form key=\{current.toString\(\)\}/);
});

test("read-only Work detail shows stopped truth, pending cost and exact off-window artifact without mutations", () => {
  const markup = workDetailMarkup();
  assert.match(markup, />Stopped<\/span>/); assert.match(markup, /This execution ended/); assert.match(markup, /1 of 2 recorded calls have an unknown charge/);
  assert.match(markup, /US\$0.123456/); assert.match(markup, /100 loaded of 127 · Incomplete history/);
  assert.match(markup, /exactSelectedOnly/); assert.match(markup, new RegExp(`id="artifact-${id(42)}"[^>]*open`));
  assert.match(markup, new RegExp(`data-console-evidence-run="${id(1000)}"`));
  assert.doesNotMatch(markup, /<form|type="submit"|Approve|Start another/);
});
test("detail links preserve collection context and use the accepted Decisions identity", () => {
  const markup = workDetailMarkup();
  const urls = [...markup.matchAll(/href="([^"]+)"/g)].map(match => new URL(match[1].replaceAll("&amp;", "&"), "https://fixture.invalid"));
  const notice = urls.find(url => url.searchParams.get("view") === "decisions");
  assert.equal(notice.searchParams.get("business"), id(1)); assert.equal(notice.searchParams.get("decision"), id(3000)); assert.equal(notice.searchParams.has("selected"), false);
  const artifact = urls.find(url => url.searchParams.has("artifact"));
  assert.equal(artifact.searchParams.get("q"), "Duplicate"); assert.equal(artifact.searchParams.get("page"), "3"); assert.equal(artifact.searchParams.get("selected"), id(1000)); assert.equal(artifact.hash, `#artifact-${id(5000)}`);
  assert.ok(urls.some(url => url.pathname === `/dashboard/workflows/${id(1000)}`));
});
test("exact artifact is never substituted by a sampled, missing or foreign output", () => {
  const data = workDetailFixture();
  for (const artifactSelection of [{ status: "missing", item: null }, { status: "unavailable", item: null }, { status: "found", item: { ...data.artifactSelection.item, business_id: id(2) } }, { status: "found", item: { ...data.artifactSelection.item, workflow_run_id: id(1001) } }]) {
    const markup = workDetailMarkup({ artifactSelection }); assert.match(markup, /No other output has been substituted/); assert.doesNotMatch(markup, /exactSelectedOnly/);
  }
  assert.doesNotMatch(workDetailMarkup({}, { artifact: undefined }), /exactSelectedOnly/);
});
test("selected run identity and Business cannot be replaced by another detail", () => {
  for (const search of [{ selected: id(1001) }, { business: id(2) }]) {
    const markup = workDetailMarkup({}, search); assert.match(markup, /No replacement record has been opened/); assert.doesNotMatch(markup, /data-work-detail/);
  }
});
test("unknown and failed Work detail states do not fabricate success or zero charges", () => {
  for (const status of ["failed", "future_unknown"]) {
    const data = workDetailFixture(); const run = { ...data.run, status, completed_at: null };
    const markup = workDetailMarkup({ run, selection: { status: "found", item: run }, costs: { businessId: run.business_id, workflowRunId: run.id, source: "model", calls: { status: "unavailable" } } });
    assert.match(markup, status === "failed" ? />Failed<\/span>/ : />Unknown<\/span>/); assert.match(markup, /Missing records do not prove zero spend/); assert.doesNotMatch(markup, /US\$0\.00/);
  }
});
test("all new Work presentation imports are provider and action free", () => {
  const source = readFileSync("src/components/console/console-work-detail.tsx", "utf8");
  assert.doesNotMatch(source, /loadWorkflowDetail|RunOutcome[\s\S]*from|workflow-visuals|from [^\n]*actions|formAction=|<form|fetch\(|\.rpc\(/);
});

test("restoration reopens exact stable disclosures before assigning scroll and list fallback excludes detail", () => {
  const href = `/dashboard?view=work&selected=${id(1000)}`, first = scrollHarness({ selected: true });
  const row = { dataset: { consoleDisclosure: `row:${id(1000)}` }, open: true }, detail = { dataset: { consoleDisclosure: `work:${id(1000)}:identity` }, open: true };
  first.root.querySelectorAll = () => [row, detail];
  const cleanup = scroll.mountConsoleCollectionScroll(first.root, "owner", href, first.view); first.flush();
  first.results.scrollTop = 550; first.detail.scrollTop = 390; first.root.dispatchEvent(new Event("toggle")); cleanup();
  const saved = JSON.parse(first.store.get(scroll.consoleCollectionScrollKey("owner", href)));
  assert.deepEqual(saved.disclosures, [row.dataset.consoleDisclosure, detail.dataset.consoleDisclosure]);
  const listSaved = JSON.parse(first.store.get(scroll.consoleCollectionScrollKey("owner", href, true)));
  assert.deepEqual(listSaved.disclosures, [row.dataset.consoleDisclosure]);
  row.open = false; detail.open = false;
  const reloaded = scrollHarness({ selected: true, store: first.store }); reloaded.root.querySelectorAll = () => [row, detail];
  const done = scroll.mountConsoleCollectionScroll(reloaded.root, "owner", href, reloaded.view); reloaded.flush();
  assert.equal(row.open, true); assert.equal(detail.open, true); assert.equal(reloaded.detail.scrollTop, 390); done();
});

test("Stopped has an explicit execution-state filter and current Running excludes ended records", () => {
  const stopped = collectionMarkup("work", { searchParams: { status: "stopped" } });
  assert.match(stopped, /value="stopped" selected="">Stopped/); assert.match(stopped, /1–1 of 1 runs/); assert.match(stopped, />Stopped<\/span>/);
  const running = collectionMarkup("work", { searchParams: { status: "running" } });
  assert.doesNotMatch(running, />Stopped<\/span>/); assert.doesNotMatch(running, new RegExp(`data-record-id="${id(1000)}"`));
});

test("unloaded discovery identity is explicit rather than implying no legacy experiment", () => {
  const detail = workDetailFixture();
  const markup = workDetailMarkup({ definition: { ...detail.definition, workflow_key: "product.discovery-v2.fixture" }, research: { status: "not-loaded", experiment: null } });
  assert.match(markup, /Legacy research context was not loaded/); assert.match(markup, /does not establish that no linked experiment exists/);
});

test("pageshow restoration ignores native clamping before its animation-frame restore", () => {
  const href = "/dashboard?view=work", fixture = scrollHarness();
  const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.flush();
  fixture.body.scrollTop = 540; fixture.root.dispatchEvent(new Event("click"));
  fixture.view.dispatchEvent(new Event("pageshow")); fixture.body.scrollTop = 0;
  fixture.body.dispatchEvent(new Event("scroll")); fixture.root.dispatchEvent(new Event("click"));
  fixture.flush(); assert.equal(fixture.body.scrollTop, 540); cleanup();
});

test("fresh exact selected and legacy run links reveal valid detail without a fragment on narrow layouts", () => {
  for (const width of [390, 640, 1000]) for (const selectedName of ["selected", "run"]) {
    const href = `/dashboard?view=work&business=${id(1)}&${selectedName}=${id(1000)}`, fixture = scrollHarness({ selected: true, width });
    let reveals = 0; fixture.detail.scrollIntoView = () => { reveals++; };
    const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.flush();
    assert.equal(reveals, 1, `${width} ${selectedName}`); cleanup();
  }
});
test("compatible saved reading positions win over fresh no-fragment selection reveal", () => {
  for (const width of [390, 640, 1000]) {
    const href = `/dashboard?view=work&selected=${id(1000)}`, fixture = scrollHarness({ selected: true, width });
    let reveals = 0; fixture.detail.scrollIntoView = () => { reveals++; };
    fixture.store.set(scroll.consoleCollectionScrollKey("owner", href), JSON.stringify({ version: 1, body: 640, detail: 80, document: 1400, mobile: width <= 900, savedAt: Date.parse("2026-10-02T03:00:00.000Z") }));
    const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.flush();
    assert.equal(reveals, 0); assert.equal(fixture.body.scrollTop, 640); assert.equal(fixture.view.scrollY, 1400); cleanup();
  }
});
test("fresh selected detail does not reveal unavailable records or move the background behind a modal/editor", () => {
  for (const condition of ["missing", "unavailable", "sheet", "dialog", "editor"]) {
    const href = `/dashboard?view=work&selected=${id(1000)}${condition === "sheet" ? "&sheet=research" : ""}`, fixture = scrollHarness({ selected: true, width: 390 });
    let reveals = 0; fixture.detail.scrollIntoView = () => { reveals++; };
    if (["missing", "unavailable"].includes(condition)) fixture.detail.dataset.consoleSelection = condition;
    fixture.view.document = { querySelector: () => condition === "dialog" ? {} : null, activeElement: { matches: () => condition === "editor" } };
    const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.flush();
    assert.equal(reveals, 0, condition); assert.equal(fixture.view.scrollY, 0); cleanup();
  }
});
test("saved-position restoration also respects an open modal and focused input during unchanged refresh", () => {
  for (const condition of ["dialog", "editor"]) {
    const href = `/dashboard?view=work&selected=${id(1000)}`, fixture = scrollHarness({ selected: true, width: 390 });
    fixture.store.set(scroll.consoleCollectionScrollKey("owner", href), JSON.stringify({ version: 1, body: 640, detail: 80, document: 1400, mobile: true, savedAt: Date.parse("2026-10-02T03:00:00.000Z") }));
    fixture.view.document = { querySelector: () => condition === "dialog" ? {} : null, activeElement: { matches: () => condition === "editor" } };
    const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.flush();
    assert.equal(fixture.body.scrollTop, 0); assert.equal(fixture.detail.scrollTop, 0); assert.equal(fixture.view.scrollY, 0); cleanup();
  }
});

test("collection presentation accepts actual metadata-only page contracts without fabricated payload fields", () => {
  const work = collectionFixture("work", { searchParams: { selected: id(1000) } });
  assert.equal(Object.hasOwn(work.data.page.items[0], "input"), false); assert.equal(Object.hasOwn(work.data.selection.item, "state"), false);
  assert.equal(Object.hasOwn(work.data.definitions[0], "stage_definition"), false);
  const activity = collectionFixture("activity", { searchParams: { selected: id(10000) } });
  assert.equal(Object.hasOwn(activity.data.page.items[0], "payload"), false); assert.equal(Object.hasOwn(activity.data.selection.item, "payload"), true);
  assert.doesNotThrow(() => collectionMarkup("work")); assert.doesNotThrow(() => collectionMarkup("activity"));
});

function toolbarHarness(href = "/dashboard?view=work", options = {}) {
  const fixture = scrollHarness(options), fields = ["q", "business", "status", "sort", "runFilter"].map(name => ({ name, value: "browser-restored-wrong-value" }));
  const toolbar = new EventTarget(); Object.assign(toolbar, { dataset: {}, isConnected: true, querySelectorAll: () => fields });
  const original = fixture.root.querySelector;
  fixture.root.querySelector = selector => selector === "form.consoleCollectionToolbar" ? toolbar : original(selector);
  const url = new URL(href, "https://fixture.invalid"); fixture.view.location = { pathname: url.pathname, search: url.search, hash: url.hash };
  return { ...fixture, fields, toolbar, values: () => Object.fromEntries(fields.map(field => [field.name, field.value])), settle: () => { fixture.flushTimers(); fixture.flush(); } };
}
test("Library native GET defaults and record aliases share only their exact canonical history scope", () => {
  const key = href => scroll.consoleCollectionScrollKey("owner", href);
  assert.equal(key("/dashboard?view=library"), key("/dashboard?view=library&type=designs&q=&business=&sort=newest&page=01&pageSize=025&mediaType=all&artifactType=all"));
  assert.equal(key(`/dashboard?view=library&type=records&artifact=${id(42)}`), key(`/dashboard?view=library&type=records&selected=${id(42)}`));
  assert.notEqual(key(`/dashboard?view=library&type=records&artifact=${id(42)}&selected=${id(43)}`), key(`/dashboard?view=library&type=records&selected=${id(43)}`));
  assert.notEqual(key("/dashboard?view=library&type=records"), key("/dashboard?view=library"));
  const lower = "abcdefab-cdef-4abc-8def-abcdefabcdef", upper = lower.toUpperCase();
  assert.equal(key(`/dashboard?view=library&type=records&selected=${lower}`), key(`/dashboard?view=library&type=records&selected=${upper}&artifact=${lower}`));
  assert.equal(key(`/dashboard?view=library&creativeRun=${lower}&business=${lower}`), key(`/dashboard?view=library&creativeRun=${upper}&business=${upper}`));
});
test("Library exact creative-run selection retains page/filter scope and clears only selection for list fallback", () => {
  const list = `/dashboard?view=library&business=${id(1)}&page=3&q=trees`;
  assert.equal(scroll.consoleCollectionScrollKey("owner", list, true), scroll.consoleCollectionScrollKey("owner", `${list}&creativeRun=${id(1000)}`, true));
  assert.notEqual(scroll.consoleCollectionScrollKey("owner", list), scroll.consoleCollectionScrollKey("owner", `${list}&creativeRun=${id(1000)}`));
  assert.notEqual(scroll.consoleCollectionScrollKey("owner", list, true), scroll.consoleCollectionScrollKey("owner", list.replace("page=3", "page=2"), true));
});
test("Library MIME/type history restores URL values and a new filter edit cancels queued restoration", () => {
  const href = "/dashboard?view=library&type=records&mediaType=application%2Fjson&artifactType=creative.image", fixture = toolbarHarness(href);
  fixture.fields.push({ name: "mediaType", value: "wrong" }, { name: "artifactType", value: "wrong" });
  const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle();
  assert.equal(fixture.values().mediaType, "application/json"); assert.equal(fixture.values().artifactType, "creative.image");
  fixture.view.dispatchEvent(new Event("popstate"));
  fixture.fields.find(field => field.name === "mediaType").value = "text/plain"; fixture.toolbar.dispatchEvent(new Event("change")); fixture.settle();
  assert.equal(fixture.values().mediaType, "text/plain"); cleanup();
});
test("fresh narrow exact Library failures reveal their own status instead of hiding below the results", () => {
  for (const status of ["missing", "unavailable"]) for (const width of [390, 640, 1000]) {
    const href = `/dashboard?view=library&selected=${id(1000)}`, fixture = toolbarHarness(href, { selected: true, width });
    fixture.detail.dataset.consoleSelection = status; let reveals = 0; fixture.detail.scrollIntoView = () => { reveals++; };
    const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle();
    assert.equal(reveals, 1, `${status} at ${width}`); cleanup();
  }
});
test("toolbar reconciles native Back after browser form restoration without changing focus or scroll", () => {
  const href = "/dashboard?view=work", fixture = toolbarHarness(href);
  const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle();
  assert.deepEqual(fixture.values(), { q: "", business: "", status: "all", sort: "newest", runFilter: "" });
  fixture.fields.find(field => field.name === "q").value = "Duplicate";
  fixture.fields.find(field => field.name === "status").value = "completed";
  fixture.fields.find(field => field.name === "sort").value = "oldest";
  fixture.view.dispatchEvent(new Event("pageshow"));
  fixture.view.dispatchEvent(new Event("popstate"));
  // Simulate the browser's persisted-user-state phase following those events.
  fixture.fields.find(field => field.name === "status").value = "failed";
  fixture.settle();
  assert.deepEqual(fixture.values(), { q: "", business: "", status: "all", sort: "newest", runFilter: "" });
  assert.equal(fixture.view.scrollY, 0); cleanup();
});
test("toolbar restores scoped query values and unchanged retained refresh preserves unfinished filter edits", () => {
  const href = `/dashboard?view=activity&business=${id(1)}&q=workflow.failed&sort=oldest&runFilter=${id(1000)}`, fixture = toolbarHarness(href);
  let cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle();
  assert.deepEqual(fixture.values(), { q: "workflow.failed", business: id(1), status: "all", sort: "oldest", runFilter: id(1000) });
  fixture.fields.find(field => field.name === "q").value = "Unsubmitted edit"; cleanup();
  cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle();
  assert.equal(fixture.values().q, "Unsubmitted edit"); cleanup();
});
test("delayed toolbar restoration cannot apply old scope to a newer navigation", () => {
  const href = `/dashboard?view=work&business=${id(1)}`, fixture = toolbarHarness(href);
  const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view);
  fixture.view.location.search = `?view=work&business=${id(2)}`;
  fixture.view.dispatchEvent(new Event("popstate")); fixture.settle();
  assert.equal(fixture.values().business, "browser-restored-wrong-value"); cleanup();
});
test("initial toolbar hydration preserves an active editor and legacy run URLs match canonical selection", () => {
  const href = `/dashboard?view=work&run=${id(1000)}`, fixture = toolbarHarness(href);
  fixture.view.document = { querySelector: () => null, activeElement: { matches: () => true } };
  fixture.fields.find(field => field.name === "q").value = "Typing before hydration";
  const canonical = `/dashboard?view=work&selected=${id(1000)}`;
  assert.equal(scroll.consoleCollectionScrollKey("owner", href), scroll.consoleCollectionScrollKey("owner", canonical));
  const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", canonical, fixture.view); fixture.settle();
  assert.equal(fixture.values().q, "Typing before hydration"); cleanup();
});

test("native GET default fields share the server-normalized history scope", () => {
  const canonical = `/dashboard?view=work&business=${id(1)}&selected=${id(1000)}`;
  const actual = `/dashboard?view=work&business=${id(1)}&run=${id(1000)}&q=&status=all&sort=newest&page=01&pageSize=025`;
  assert.equal(scroll.consoleCollectionScrollKey("owner", actual), scroll.consoleCollectionScrollKey("owner", canonical));
  const fixture = toolbarHarness(actual);
  const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", canonical, fixture.view); fixture.settle();
  assert.equal(fixture.values().business, id(1)); assert.equal(fixture.values().status, "all"); cleanup();
  assert.notEqual(scroll.consoleCollectionScrollKey("owner", `${canonical}&status=all&status=failed`), scroll.consoleCollectionScrollKey("owner", canonical));
});
test("real Work rows, stages and artifacts expose exact motion identities while incomplete detail is labelled", () => {
  const list = collectionMarkup("work");
  assert.match(list, /data-console-motion-target="run" data-console-motion-id=/);
  const detail = workDetailMarkup();
  assert.match(detail, new RegExp(`data-console-motion-target="stage" data-console-motion-id="${id(2000)}"`));
  assert.match(detail, new RegExp(`data-console-motion-target="output" data-console-motion-id="${id(5000)}"`));
  assert.match(detail, /data-console-detail-available="false"/);
  assert.doesNotMatch(detail, /data-console-motion-target="worker"/);
});

test("a newer URL cancels delayed selected-detail reveal before retained DOM changes", () => {
  const href = `/dashboard?view=work&selected=${id(1000)}`, fixture = toolbarHarness(href, { selected: true, width: 390 });
  let reveals = 0; fixture.detail.scrollIntoView = () => { reveals++; };
  const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view);
  fixture.view.location.search = `?view=work&selected=${id(1001)}`;
  fixture.settle(); assert.equal(reveals, 0); cleanup();
});

function pageShow(persisted) {
  const event = new Event("pageshow"); Object.defineProperty(event, "persisted", { value: persisted }); return event;
}
test("a new toolbar input or change cancels history reconciliation at either deferred stage", () => {
  for (const eventName of ["input", "change"]) for (const phase of ["task", "frame"]) {
    const href = "/dashboard?view=work", fixture = toolbarHarness(href);
    const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle();
    fixture.view.dispatchEvent(new Event("popstate"));
    if (phase === "frame") fixture.flushTimers();
    fixture.fields.find(field => field.name === "q").value = "New owner edit";
    fixture.toolbar.dispatchEvent(new Event(eventName));
    fixture.settle(); assert.equal(fixture.values().q, "New owner edit", `${eventName} during ${phase}`); cleanup();
  }
});
test("late initial pageshow preserves new typing and unchanged rerender even before initial restoration", () => {
  const href = "/dashboard?view=work", fixture = toolbarHarness(href);
  let cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view);
  fixture.fields.find(field => field.name === "q").value = "Edit before initial task";
  fixture.toolbar.dispatchEvent(new Event("input"));
  fixture.view.dispatchEvent(pageShow(false)); fixture.settle();
  assert.equal(fixture.values().q, "Edit before initial task"); cleanup();
  cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view);
  fixture.view.dispatchEvent(pageShow(false)); fixture.settle();
  assert.equal(fixture.values().q, "Edit before initial task"); cleanup();
});
test("true persisted Back reconciles older edits but an edit after that event still wins", () => {
  const href = "/dashboard?view=work", fixture = toolbarHarness(href);
  const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle();
  fixture.fields.find(field => field.name === "q").value = "Edited before leaving";
  fixture.toolbar.dispatchEvent(new Event("input")); fixture.view.dispatchEvent(pageShow(true)); fixture.settle();
  assert.equal(fixture.values().q, "");
  fixture.view.dispatchEvent(pageShow(true)); fixture.flushTimers();
  fixture.fields.find(field => field.name === "q").value = "New edit after returning";
  fixture.toolbar.dispatchEvent(new Event("input")); fixture.settle();
  assert.equal(fixture.values().q, "New edit after returning"); cleanup();
});
test("captured raw URL cancels a restoration task or frame even when the new URL has equivalent scope", () => {
  for (const phase of ["task", "frame"]) {
    const href = "/dashboard?view=work", fixture = toolbarHarness(href);
    const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle();
    fixture.fields.find(field => field.name === "q").value = "Keep edited value";
    fixture.view.dispatchEvent(new Event("popstate"));
    if (phase === "frame") fixture.flushTimers();
    // Both URLs normalize to the same scope. The captured navigation itself is
    // nevertheless stale, so neither stage may change the current controls.
    fixture.view.location.search = "?view=work&status=all";
    fixture.settle(); assert.equal(fixture.values().q, "Keep edited value", phase); cleanup();
  }
});
test("cancelled toolbar callbacks stay inert even if invoked after cancellation or disposal", () => {
  const href = "/dashboard?view=work", fixture = toolbarHarness(href), scheduled = [];
  const requestFrame = fixture.view.requestAnimationFrame;
  fixture.view.requestAnimationFrame = callback => { scheduled.push(callback); return requestFrame(callback); };
  const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle();
  fixture.view.dispatchEvent(new Event("popstate")); fixture.flushTimers();
  const stale = scheduled.at(-1);
  fixture.fields.find(field => field.name === "q").value = "Must survive cancelled frame";
  fixture.toolbar.dispatchEvent(new Event("input")); stale();
  assert.equal(fixture.values().q, "Must survive cancelled frame");
  cleanup(); stale(); assert.equal(fixture.values().q, "Must survive cancelled frame");
});

test("unfinished filter edits survive blur and same-form server rebind but remain owner/scope isolated", () => {
  const href = "/dashboard?view=work", fixture = toolbarHarness(href);
  fixture.view.document = { querySelector: () => null, activeElement: { matches: () => true } };
  let cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle();
  fixture.fields.find(field => field.name === "q").value = "Blurred owner draft";
  fixture.toolbar.dispatchEvent(new Event("input"));
  fixture.view.document.activeElement = { matches: () => false };
  cleanup();
  cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view);
  fixture.view.dispatchEvent(pageShow(false)); fixture.settle();
  assert.equal(fixture.values().q, "Blurred owner draft"); cleanup();
  cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "different-owner", href, fixture.view); fixture.settle();
  assert.equal(fixture.values().q, "", "a new owner must not inherit the old owner's draft protection");
  fixture.fields.find(field => field.name === "q").value = "Another unfinished draft";
  fixture.toolbar.dispatchEvent(new Event("change")); cleanup();
  const nextHref = "/dashboard?view=work&q=Saved+filter";
  fixture.view.location.search = "?view=work&q=Saved+filter";
  cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "different-owner", nextHref, fixture.view); fixture.settle();
  assert.equal(fixture.values().q, "Saved filter", "new URL scope must use its own server filters"); cleanup();
});
test("raw hash or research-sheet navigation invalidates an equal-canonical queued filter write", () => {
  for (const changed of ["hash", "sheet"]) for (const phase of ["task", "frame"]) {
    const href = "/dashboard?view=work", fixture = toolbarHarness(href);
    const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle();
    fixture.fields.find(field => field.name === "q").value = "Do not reset during newer navigation";
    fixture.view.dispatchEvent(new Event("popstate"));
    if (phase === "frame") fixture.flushTimers();
    if (changed === "hash") fixture.view.location.hash = "#console-collection-detail";
    else fixture.view.location.search = "?view=work&sheet=research";
    fixture.settle(); assert.equal(fixture.values().q, "Do not reset during newer navigation", `${changed} during ${phase}`); cleanup();
  }
});

test("a split-only saved position cannot suppress fresh single-column selection reveal", () => {
  const href = `/dashboard?view=work&selected=${id(1000)}`, fixture = scrollHarness({ selected: true, width: 1000 });
  let reveals = 0; fixture.detail.scrollIntoView = () => { reveals++; };
  fixture.store.set(scroll.consoleCollectionScrollKey("owner", href), JSON.stringify({ version: 1, layout: "split", body: 640, detail: 80, document: 0, mobile: false, savedAt: Date.parse("2026-10-02T03:00:00.000Z") }));
  const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.flush();
  assert.equal(reveals, 1); cleanup();
});

function documentScroll(fixture) {
  // A document scroll observed by a Window listener retains Document as its
  // target. EventTarget alone has no DOM propagation, so model that target
  // explicitly rather than pretending browsers target Window for this event.
  const document = fixture.root.ownerDocument ?? fixture.view.document ?? { querySelector: () => null, activeElement: null };
  fixture.root.ownerDocument = document; fixture.view.document = document;
  const event = new Event("scroll"); Object.defineProperty(event, "target", { value: document });
  fixture.view.dispatchEvent(event);
}
test("real Document-target scroll events update the mobile reading snapshot observed by Window", () => {
  const href = `/dashboard?view=work&selected=${id(1000)}`, fixture = scrollHarness({ selected: true, width: 390 });
  const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.flush();
  fixture.view.scrollY = 2100; documentScroll(fixture); fixture.flushTimers();
  assert.equal(JSON.parse(fixture.store.get(scroll.consoleCollectionScrollKey("owner", href))).document, 2100);
  cleanup();
});
test("expanded narrow Work retains Document-target reading position through page navigation, Back and reload", () => {
  for (const width of [390, 640]) {
    const href = `/dashboard?view=work&selected=${id(1000)}`, nextHref = `${href}&page=2`;
    const first = toolbarHarness(href, { selected: true, width });
    const evidence = { dataset: { consoleDisclosure: `work:${id(1000)}:Saved output metadata` }, open: false };
    first.root.querySelectorAll = () => [evidence];
    first.detail.scrollIntoView = () => { first.view.scrollY = 1200; };
    const cleanup = scroll.mountConsoleCollectionScroll(first.root, "owner", href, first.view); first.settle();
    assert.equal(first.view.scrollY, 1200, "initial no-hash selection remains visible");
    evidence.open = true; first.root.dispatchEvent(new Event("toggle"));
    first.view.scrollY = 2100; documentScroll(first); first.flushTimers();
    cleanup();
    const next = toolbarHarness(nextHref, { selected: true, width, store: first.store });
    const nextCleanup = scroll.mountConsoleCollectionScroll(next.root, "owner", nextHref, next.view); next.settle(); nextCleanup();
    for (const transition of ["Back", "reload"]) {
      const returned = toolbarHarness(href, { selected: true, width, store: first.store });
      const returnedEvidence = { dataset: evidence.dataset, open: false }; returned.root.querySelectorAll = () => [returnedEvidence];
      let reveals = 0; returned.detail.scrollIntoView = () => { reveals++; };
      const dispose = scroll.mountConsoleCollectionScroll(returned.root, "owner", href, returned.view); returned.settle();
      assert.equal(returnedEvidence.open, true, `${width}px ${transition} disclosure`);
      assert.equal(returned.view.scrollY, 2100, `${width}px ${transition} reading position`);
      assert.equal(reveals, 0, "saved exact position outranks initial selected reveal"); dispose();
    }
  }
});
test("new-URL document restoration cannot overwrite an old retained route snapshot before React commits", () => {
  const href = `/dashboard?view=work&selected=${id(1000)}`, fixture = toolbarHarness(href, { selected: true, width: 390 });
  const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle();
  fixture.view.scrollY = 2100; documentScroll(fixture); fixture.flushTimers();
  fixture.view.location.search += "&page=2";
  fixture.view.scrollY = 0; documentScroll(fixture); fixture.flushTimers();
  cleanup();
  assert.equal(JSON.parse(fixture.store.get(scroll.consoleCollectionScrollKey("owner", href))).document, 2100);
});

test("foreign Document scroll events cannot change the owning collection snapshot", () => {
  const href = `/dashboard?view=work&selected=${id(1000)}`, fixture = toolbarHarness(href, { selected: true, width: 390 });
  const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle();
  fixture.view.scrollY = 2100; documentScroll(fixture); fixture.flushTimers();
  const otherDocument = { querySelector: () => null, activeElement: null };
  const foreignEvent = new Event("scroll"); Object.defineProperty(foreignEvent, "target", { value: otherDocument });
  fixture.view.scrollY = 0; fixture.view.dispatchEvent(foreignEvent); fixture.flushTimers(); cleanup();
  assert.equal(JSON.parse(fixture.store.get(scroll.consoleCollectionScrollKey("owner", href))).document, 2100);
});

test("a retained Library detail resets inherited Record scroll when a fresh creative run is selected", () => {
  const recordHref = `/dashboard?view=library&type=records&business=${id(1)}&selected=${id(42)}`;
  const runHref = `/dashboard?view=library&business=${id(1)}&creativeRun=${id(2000)}`;
  const fixture = toolbarHarness(recordHref, { selected: true, width: 1280 });
  let cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", recordHref, fixture.view); fixture.settle();
  fixture.detail.scrollTop = 420; fixture.detail.dispatchEvent(new Event("scroll")); fixture.flushTimers(); cleanup();
  fixture.view.location.search = new URL(runHref, "https://fixture.invalid").search;
  fixture.store.set(scroll.consoleCollectionScrollKey("owner", runHref, true), JSON.stringify({ version: 1, layout: "split", body: 73, detail: 0, document: 0, mobile: false, savedAt: Date.parse("2026-10-02T03:00:00.000Z") }));
  // React retained the very same detail element after replacing its Record JSON.
  assert.equal(fixture.detail.scrollTop, 420);
  cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", runHref, fixture.view); fixture.settle();
  assert.equal(fixture.results.scrollTop, 73, "list fallback remains independent");
  assert.equal(fixture.detail.scrollTop, 0, "fresh selected run must expose its heading and Close control"); cleanup();
});
test("same retained Library record preserves reading and disclosures across list-only page/filter changes", () => {
  const href = `/dashboard?view=library&type=records&business=${id(1)}&selected=${id(42)}`;
  const nextHref = `${href}&page=2&q=report&sort=oldest&mediaType=application%2Fjson`;
  const fixture = toolbarHarness(href, { selected: true, width: 1280 });
  const content = { dataset: { consoleDisclosure: `content:${id(42)}` }, open: true };
  fixture.root.querySelectorAll = () => [content];
  let cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle();
  fixture.detail.scrollTop = 420; fixture.detail.dispatchEvent(new Event("scroll")); fixture.flushTimers(); cleanup();
  fixture.view.location.search = new URL(nextHref, "https://fixture.invalid").search;
  fixture.store.set(scroll.consoleCollectionScrollKey("owner", nextHref, true), JSON.stringify({ version: 1, layout: "split", body: 73, detail: 0, document: 0, disclosures: [], mobile: false, savedAt: Date.parse("2026-10-02T03:00:00.000Z") }));
  cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", nextHref, fixture.view); fixture.settle();
  assert.equal(fixture.detail.scrollTop, 420);
  assert.equal(content.open, true, "list-only fallback must not close this unchanged detail's JSON");
  assert.equal(fixture.results.scrollTop, 73); cleanup();
});

test("new split-list page starts at top while same-record detail survives, and exact history restores both", () => {
  const firstHref = `/dashboard?view=library&type=records&business=${id(1)}&selected=${id(42)}`;
  const secondHref = `${firstHref}&page=2`;
  const fixture = toolbarHarness(firstHref, { selected: true, width: 1280 });
  const content = { dataset: { consoleDisclosure: `content:${id(42)}` }, open: true }; fixture.root.querySelectorAll = () => [content];
  let cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", firstHref, fixture.view); fixture.settle();
  fixture.results.scrollTop = 510; fixture.detail.scrollTop = 430; fixture.detail.dispatchEvent(new Event("scroll")); fixture.flushTimers(); cleanup();
  fixture.view.location.search = new URL(secondHref, "https://fixture.invalid").search;
  cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", secondHref, fixture.view); fixture.settle();
  assert.equal(fixture.results.scrollTop, 0); assert.equal(fixture.detail.scrollTop, 430); assert.equal(content.open, true);
  fixture.results.scrollTop = 80; fixture.detail.scrollTop = 270; fixture.detail.dispatchEvent(new Event("scroll")); fixture.flushTimers(); cleanup();
  for (const [href, expectedList, expectedDetail] of [[firstHref, 510, 430], [secondHref, 80, 270]]) {
    fixture.view.location.search = new URL(href, "https://fixture.invalid").search;
    cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle();
    assert.equal(fixture.results.scrollTop, expectedList); assert.equal(fixture.detail.scrollTop, expectedDetail); assert.equal(content.open, true); cleanup();
  }
  const reload = toolbarHarness(secondHref, { selected: true, width: 1280, store: fixture.store });
  const dispose = scroll.mountConsoleCollectionScroll(reload.root, "owner", secondHref, reload.view); reload.settle();
  assert.equal(reload.results.scrollTop, 80); assert.equal(reload.detail.scrollTop, 270); dispose();
});
test("same retained list keeps position when another selected record resets detail, even without storage", () => {
  const firstHref = `/dashboard?view=library&type=records&business=${id(1)}&selected=${id(42)}`;
  const nextHref = firstHref.replace(id(42), id(43)), fixture = toolbarHarness(firstHref, { selected: true, width: 1280 });
  Object.defineProperty(fixture.view, "sessionStorage", { get() { throw new Error("Disabled tab storage"); } });
  let cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", firstHref, fixture.view); fixture.settle();
  fixture.results.scrollTop = 510; fixture.detail.scrollTop = 430; fixture.detail.dispatchEvent(new Event("scroll")); cleanup();
  fixture.view.location.search = new URL(nextHref, "https://fixture.invalid").search;
  cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", nextHref, fixture.view); fixture.settle();
  assert.equal(fixture.results.scrollTop, 510); assert.equal(fixture.detail.scrollTop, 0); cleanup();
});
test("exact snapshots and verified artifact positioning outrank fresh retained-detail reset", () => {
  const href = `/dashboard?view=work&business=${id(1)}&selected=${id(1000)}`, nextHref = href.replace(id(1000), id(1001));
  const fixture = toolbarHarness(href, { selected: true, width: 1280 });
  let cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle();
  fixture.detail.scrollTop = 420; fixture.detail.dispatchEvent(new Event("scroll")); cleanup();
  fixture.view.location.search = new URL(nextHref, "https://fixture.invalid").search;
  fixture.store.set(scroll.consoleCollectionScrollKey("owner", nextHref), JSON.stringify({ version: 1, layout: "split", body: 90, detail: 85, document: 0, mobile: false, savedAt: Date.parse("2026-10-02T03:00:00.000Z") }));
  cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", nextHref, fixture.view); fixture.settle();
  assert.equal(fixture.detail.scrollTop, 85); cleanup();
  const artifactHref = `${href.replace(id(1000), id(1002))}&artifact=${id(44)}`;
  fixture.view.location.search = new URL(artifactHref, "https://fixture.invalid").search; fixture.view.location.hash = `#artifact-${id(44)}`;
  const original = fixture.root.querySelector;
  fixture.root.querySelector = selector => selector === `details[id="artifact-${id(44)}"]` ? { closest: () => ({ dataset: { consoleEvidenceRun: id(1002) } }) } : original(selector);
  fixture.detail.scrollTop = 310; // Exact artifact helper already revealed its authorized output.
  cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", artifactHref, fixture.view); fixture.settle();
  assert.equal(fixture.detail.scrollTop, 310); cleanup();
});
test("retained detail identity keeps namespace, owner and Business boundaries distinct", () => {
  const href = `/dashboard?view=library&business=${id(1)}&selected=${id(42)}`;
  for (const [owner, nextHref] of [["other-owner", href], ["owner", href.replace(id(1), id(2))], ["owner", href.replace("selected=", "creativeRun=")], ["owner", href + "&type=records"]]) {
    const fixture = toolbarHarness(href, { selected: true, width: 1280 });
    let cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle();
    fixture.detail.scrollTop = 420; fixture.detail.dispatchEvent(new Event("scroll")); cleanup();
    fixture.view.location.search = new URL(nextHref, "https://fixture.invalid").search;
    cleanup = scroll.mountConsoleCollectionScroll(fixture.root, owner, nextHref, fixture.view); fixture.settle();
    assert.equal(fixture.detail.scrollTop, 0, `${owner} ${nextHref}`); cleanup();
  }
});
test("modal/editor barriers defer fresh detail reset without saving the previous record position", () => {
  const href = `/dashboard?view=library&type=records&selected=${id(42)}`, nextHref = `/dashboard?view=library&creativeRun=${id(2000)}`;
  for (const barrier of ["modal", "editor"]) {
    const fixture = toolbarHarness(href, { selected: true, width: 1280 });
    let cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle();
    fixture.detail.scrollTop = 420; fixture.detail.dispatchEvent(new Event("scroll")); cleanup();
    fixture.view.location.search = new URL(nextHref, "https://fixture.invalid").search;
    fixture.view.document = { querySelector: () => barrier === "modal" ? {} : null, activeElement: { matches: () => barrier === "editor" } };
    cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", nextHref, fixture.view); fixture.settle();
    assert.equal(fixture.detail.scrollTop, 420, "blocked background must not move"); cleanup();
    assert.equal(fixture.store.has(scroll.consoleCollectionScrollKey("owner", nextHref)), false, "inherited old position is not an exact new-record snapshot");
    fixture.view.document = { querySelector: () => null, activeElement: null };
    cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", nextHref, fixture.view); fixture.settle();
    assert.equal(fixture.detail.scrollTop, 0); cleanup();
  }
});

test("editor-blocked first mount resumes saving after deliberate detail reading without a rebind", () => {
  const href = `/dashboard?view=library&type=records&selected=${id(42)}`, fixture = toolbarHarness(href, { selected: true, width: 1280 });
  fixture.view.document = { querySelector: () => null, activeElement: { matches: () => true } };
  const content = { dataset: { consoleDisclosure: `content:${id(42)}` }, open: true }; fixture.root.querySelectorAll = () => [content];
  let reveals = 0; fixture.detail.scrollIntoView = () => { reveals++; };
  const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle();
  fixture.view.document.activeElement = null; fixture.settle();
  assert.equal(fixture.store.size, 0, "blur alone does not certify a reading position");
  fixture.detail.scrollTop = 730; fixture.detail.dispatchEvent(new Event("scroll")); fixture.flushTimers(); cleanup();
  const saved = JSON.parse(fixture.store.get(scroll.consoleCollectionScrollKey("owner", href)));
  assert.equal(saved.detail, 730); assert.equal(saved.body, 0); assert.equal(content.open, true); assert.equal(reveals, 0);
  const reload = toolbarHarness(href, { selected: true, width: 1280, store: fixture.store });
  const dispose = scroll.mountConsoleCollectionScroll(reload.root, "owner", href, reload.view); reload.settle();
  assert.equal(reload.detail.scrollTop, 730); dispose();
});
test("blocked recovery restores only the unread companion from an exact or list snapshot", () => {
  const href = `/dashboard?view=library&type=records&selected=${id(42)}`;
  for (const observed of ["list", "detail"]) for (const snapshot of ["exact", "list"]) {
    const fixture = toolbarHarness(href, { selected: true, width: 1280 });
    fixture.view.document = { querySelector: () => null, activeElement: { matches: () => true } };
    const row = { dataset: { consoleDisclosure: "row:record" }, open: true }, content = { dataset: { consoleDisclosure: `content:${id(42)}` }, open: true };
    fixture.root.querySelectorAll = () => [row, content];
    fixture.store.set(scroll.consoleCollectionScrollKey("owner", href, snapshot === "list"), JSON.stringify({ version: 1, layout: "split", body: 350, detail: 410, document: 0, disclosures: [], mobile: false, savedAt: Date.parse("2026-10-02T03:00:00.000Z") }));
    const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle();
    fixture.view.document.activeElement = null;
    const target = observed === "list" ? fixture.results : fixture.detail;
    target.scrollTop = 730; target.dispatchEvent(new Event("scroll")); fixture.flushTimers(); cleanup();
    const saved = JSON.parse(fixture.store.get(scroll.consoleCollectionScrollKey("owner", href)));
    assert.equal(saved.body, observed === "list" ? 730 : 350);
    assert.equal(saved.detail, observed === "detail" ? 730 : snapshot === "exact" ? 410 : 0);
    assert.equal(observed === "list" ? row.open : content.open, true, "the actively read disclosure cannot be closed by restoration");
  }
});
test("retained blocked identity swaps recover only after a changed region and never save inherited companions", () => {
  const href = `/dashboard?view=library&type=records&selected=${id(42)}`, nextHref = `/dashboard?view=library&creativeRun=${id(2000)}`;
  for (const observed of ["list", "detail"]) {
    const fixture = toolbarHarness(href, { selected: true, width: 1280 });
    let cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle();
    fixture.results.scrollTop = 320; fixture.detail.scrollTop = 420; fixture.detail.dispatchEvent(new Event("scroll")); cleanup();
    fixture.view.location.search = new URL(nextHref, "https://fixture.invalid").search;
    fixture.view.document = { querySelector: () => null, activeElement: { matches: () => true } };
    cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", nextHref, fixture.view); fixture.settle();
    fixture.view.document.activeElement = null;
    fixture.detail.dispatchEvent(new Event("scroll")); fixture.flushTimers();
    assert.equal(fixture.store.has(scroll.consoleCollectionScrollKey("owner", nextHref)), false, "unchanged inherited scroll cannot establish readiness");
    const target = observed === "list" ? fixture.results : fixture.detail;
    target.scrollTop = 730; target.dispatchEvent(new Event("scroll")); fixture.flushTimers(); cleanup();
    const saved = JSON.parse(fixture.store.get(scroll.consoleCollectionScrollKey("owner", nextHref)));
    assert.equal(saved.body, observed === "list" ? 730 : 0);
    assert.equal(saved.detail, observed === "detail" ? 730 : 0);
  }
});
test("blocked recovery preserves an already-established same-list companion", () => {
  const href = `/dashboard?view=library&type=records&selected=${id(42)}`, nextHref = href.replace(id(42), id(43));
  const fixture = toolbarHarness(href, { selected: true, width: 1280 });
  let cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle();
  fixture.results.scrollTop = 320; fixture.detail.scrollTop = 420; fixture.detail.dispatchEvent(new Event("scroll")); cleanup();
  fixture.view.location.search = new URL(nextHref, "https://fixture.invalid").search;
  fixture.view.document = { querySelector: () => null, activeElement: { matches: () => true } };
  cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", nextHref, fixture.view); fixture.settle();
  fixture.view.document.activeElement = null;
  fixture.detail.scrollTop = 730; fixture.detail.dispatchEvent(new Event("scroll")); fixture.flushTimers(); cleanup();
  const saved = JSON.parse(fixture.store.get(scroll.consoleCollectionScrollKey("owner", nextHref)));
  assert.equal(saved.body, 320); assert.equal(saved.detail, 730);
});
test("modal, stale URL, foreign Document and inactive-scroller events cannot recover a blocked mount", () => {
  const href = `/dashboard?view=library&type=records&selected=${id(42)}`;
  for (const invalid of ["modal", "url", "foreign", "inactive", "no-change"]) {
    const fixture = toolbarHarness(href, { selected: true, width: 1280 });
    let modal = true; fixture.view.document = { querySelector: () => modal ? {} : null, activeElement: null };
    const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle();
    modal = invalid === "modal";
    if (invalid === "url") fixture.view.location.search += "&page=2";
    if (invalid === "foreign") {
      fixture.view.scrollY = 730; const event = new Event("scroll"); Object.defineProperty(event, "target", { value: {} }); fixture.view.dispatchEvent(event);
    } else if (invalid === "inactive") {
      fixture.body.scrollTop = 730; fixture.body.dispatchEvent(new Event("scroll"));
    } else {
      if (invalid !== "no-change") fixture.detail.scrollTop = 730;
      fixture.detail.dispatchEvent(new Event("scroll"));
    }
    fixture.flushTimers();
    if (invalid === "modal") { modal = false; fixture.detail.dispatchEvent(new Event("scroll")); fixture.flushTimers(); }
    cleanup(); assert.equal(fixture.store.size, 0, invalid);
  }
});
test("document and single-scroller reading recover without repositioning the shared region", () => {
  for (const width of [390, 640, 1000]) {
    const href = `/dashboard?view=library&type=records&selected=${id(42)}`, fixture = toolbarHarness(href, { selected: true, width });
    fixture.view.document = { querySelector: () => null, activeElement: { matches: () => true } };
    let reveals = 0; fixture.detail.scrollIntoView = () => { reveals++; };
    const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle();
    fixture.view.document.activeElement = null;
    if (width <= 900) { fixture.view.scrollY = 1730; documentScroll(fixture); }
    else { fixture.body.scrollTop = 730; fixture.body.dispatchEvent(new Event("scroll")); }
    fixture.flushTimers(); cleanup();
    const saved = JSON.parse(fixture.store.get(scroll.consoleCollectionScrollKey("owner", href)));
    assert.equal(width <= 900 ? saved.document : saved.body, width <= 900 ? 1730 : 730); assert.equal(reveals, 0);
  }
});

// Research extends only the existing v1 per-tab history contract.
// This is an inert scroll-anchoring model, not a local/browser qualification.
function researchAnchorOptOutSelectors() {
  const css = readFileSync("src/components/console/console-research-pane.css", "utf8");
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, , declarations]) => /overflow-anchor\s*:\s*none\b/.test(declarations))
    .flatMap(([, selectors]) => selectors.replace(/\/\*[\s\S]*?\*\//g, "").split(",").map(selector => selector.trim().replace(/\s+/g, " ")));
}
function researchScrollHarness({ href = `/dashboard?view=research&selected=${id(1000)}`, width = 1280, store = new Map(), loading = false, pendingMaximum = 50, nativeReadyShift = 0 } = {}) {
  const fixture = toolbarHarness(href, { selected: true, width, store });
  fixture.fields.push({ name: "searchField", value: "browser-restored-wrong-value" });
  Object.assign(fixture.detail.dataset, { consoleResearchRecord: id(1000), consoleResearchBusiness: id(1) });
  let pending = loading, maximum = loading ? pendingMaximum : 5000, top = 0, ready = null;
  Object.defineProperty(fixture.detail, "scrollTop", { get: () => top, set: value => { top = Math.min(maximum, value); } });
  const pendingMarker = { dataset: { researchEvidenceLoading: id(1000) } };
  const disclosure = { dataset: { consoleDisclosure: `research:goal:${id(1000)}` }, open: false };
  const attempt = { dataset: { consoleResearchAttemptRoot: id(1000), consoleResearchBusiness: id(1) }, scrollIntoView() { fixture.detail.scrollTop = 1200; } };
  const original = fixture.root.querySelector;
  fixture.root.querySelector = selector => selector === "[data-research-evidence-loading]" ? pending ? pendingMarker : null : selector === "[data-console-research-evidence-ready]" ? ready : selector === `details[id="console-research-attempts-${id(1000)}"]` ? attempt : original(selector);
  fixture.root.querySelectorAll = () => pending ? [] : [disclosure];
  const fireReady = (changes = {}) => {
    const replacingLoadingLeaf = pending; pending = false; maximum = 5000;
    // Model the pre-effect UA anchor adjustment seen in the hosted gate. The
    // actual production CSS must opt this particular Research surface out.
    if (replacingLoadingLeaf && nativeReadyShift) {
      const selector = width >= 1200 ? ".consoleResearchPane .consoleResearchDetail" : width > 900 ? ".consoleResearchPane > .consoleResearchBody" : ".consoleResearchPane";
      if (!researchAnchorOptOutSelectors().includes(selector)) {
        if (width >= 1200) top += nativeReadyShift; else if (width > 900) fixture.body.scrollTop += nativeReadyShift; else fixture.view.scrollY += nativeReadyShift;
      }
    }
    ready = { dataset: { consoleResearchReadyScope: scroll.consoleCollectionScrollKey("owner", href), consoleResearchRecord: id(1000), consoleResearchBusiness: id(1), ...changes } };
    const event = new Event("console-research-evidence-ready"); Object.defineProperty(event, "target", { value: ready }); fixture.root.dispatchEvent(event);
  };
  return { ...fixture, disclosure, attempt, fireReady };
}
const researchStored = (layout = "split") => ({ version: 1, layout, body: 450, detail: 730, document: layout === "document" ? 1400 : 0, mobile: layout === "document", disclosures: [`research:goal:${id(1000)}`], savedAt: Date.parse("2026-10-02T03:00:00.000Z") });

test("Research default GET spellings and experiment aliases canonicalize exact history, while list scope excludes independent attempts", () => {
  const key = (href, list = false) => scroll.consoleCollectionScrollKey("owner", href, list), base = `/dashboard?view=research&selected=${id(1000)}`;
  assert.equal(key(base), key(`/dashboard?view=research&type=roots&experiment=${id(1000)}&business=&q=&searchField=objective&sort=newest&page=01&pageSize=025&root=&attemptPage=01&attemptSort=newest&sheet=research`));
  assert.equal(key(base, true), key(`${base}&root=${id(1001)}&attemptPage=3&attemptSort=oldest`, true));
  for (const suffix of ["type=records", "searchField=hypothesis", "q=saved", "sort=oldest", "page=2", `business=${id(2)}`]) assert.notEqual(key(base, true), key(`${base}&${suffix}`, true), suffix);
  assert.notEqual(key(`${base}&q=saved`), key(`${base}&q=saved&searchField=objective`), "nonempty search requires its explicit field");
  assert.notEqual(key(base), key(`${base}&root=${id(1001)}`)); assert.notEqual(key(base), key(`${base}&attemptPage=2`));
  assert.notEqual(key(base), key(`${base}&selected=${id(1000)}`), "ambiguous duplicate remains distinct");
});
test("Research native GET history reconciles searchField with the URL and edit cancellation retains new unsubmitted values", () => {
  const href = `/dashboard?view=research&selected=${id(1000)}&q=saved&searchField=hypothesis&sort=oldest`, fixture = researchScrollHarness({ href });
  const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle();
  assert.equal(fixture.values().searchField, "hypothesis"); assert.equal(fixture.values().q, "saved");
  fixture.fields.find(field => field.name === "searchField").value = "objective"; fixture.toolbar.dispatchEvent(new Event("change")); fixture.view.dispatchEvent(new Event("pageshow")); fixture.settle();
  assert.equal(fixture.values().searchField, "objective");
  fixture.view.dispatchEvent(new Event("popstate")); fixture.settle(); assert.equal(fixture.values().searchField, "hypothesis"); cleanup();
});
test("Research independent attempt navigation retains the main list, reveals only an exact server-bound root anchor, and exact Back snapshot wins", () => {
  const href = `/dashboard?view=research&selected=${id(1000)}&root=${id(1000)}&page=3&q=saved&searchField=hypothesis`, first = researchScrollHarness({ href });
  let cleanup = scroll.mountConsoleCollectionScroll(first.root, "owner", href, first.view); first.settle(); first.results.scrollTop = 490; first.detail.scrollTop = 410; first.detail.dispatchEvent(new Event("scroll")); cleanup();
  const next = href + "&attemptPage=2", fixture = researchScrollHarness({ href: next, store: first.store }); fixture.view.location.hash = `#console-research-attempts-${id(1000)}`;
  cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", next, fixture.view); fixture.settle(); assert.equal(fixture.results.scrollTop, 490); assert.equal(fixture.detail.scrollTop, 1200); cleanup();
  const returned = researchScrollHarness({ href, store: fixture.store }); returned.view.location.hash = `#console-research-attempts-${id(1000)}`;
  cleanup = scroll.mountConsoleCollectionScroll(returned.root, "owner", href, returned.view); returned.settle(); assert.equal(returned.results.scrollTop, 490); assert.equal(returned.detail.scrollTop, 410); cleanup();
  const wrong = researchScrollHarness({ href: next }); wrong.attempt.dataset.consoleResearchBusiness = id(2); wrong.view.location.hash = `#console-research-attempts-${id(1000)}`;
  cleanup = scroll.mountConsoleCollectionScroll(wrong.root, "owner", next, wrong.view); wrong.settle(); assert.equal(wrong.detail.scrollTop, 0); cleanup();
});
test("found Research reveal needs exact record and Business markers; error hashes cannot bypass canonical scope", () => {
  for (const wrong of ["record", "business", "missing"]) {
    const href = `/dashboard?view=research&business=${id(1)}&selected=${id(1000)}`, fixture = researchScrollHarness({ href, width: 390 }); let reveals = 0;
    fixture.detail.scrollIntoView = () => { reveals++; }; fixture.view.location.hash = "#console-collection-detail";
    if (wrong === "record") fixture.detail.dataset.consoleResearchRecord = id(2000);
    if (wrong === "business") fixture.detail.dataset.consoleResearchBusiness = id(2);
    if (wrong === "missing") fixture.detail.dataset.consoleSelection = "missing";
    const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle(); assert.equal(reveals, 0); cleanup();
  }
});
for (const width of [1280, 1000, 390]) test(`Research delayed evidence restores only its exact ${width}px Back/reload snapshot and disclosures without reconciling filters`, () => {
  const href = `/dashboard?view=research&selected=${id(1000)}`, fixture = researchScrollHarness({ href, width, loading: true }), state = researchStored(width <= 900 ? "document" : width >= 1200 ? "split" : "single"), key = scroll.consoleCollectionScrollKey("owner", href);
  fixture.store.set(key, JSON.stringify(state)); const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle();
  assert.equal(fixture.detail.scrollTop, 50); assert.equal(JSON.parse(fixture.store.get(key)).detail, 730, "loading clamp cannot overwrite old exact evidence position");
  fixture.fireReady(); assert.equal(fixture.detail.scrollTop, 730); assert.equal(fixture.disclosure.open, true); assert.equal(fixture.results.scrollTop, width >= 1200 ? 450 : 0); assert.equal(fixture.values().searchField, "objective");
  fixture.detail.scrollTop = 970; fixture.fireReady(); assert.equal(fixture.detail.scrollTop, 970, "repeated ready cannot jump the reader"); cleanup();
});
test("Research stale/wrong-scope/foreign ready and navigation-away cannot reveal or overwrite an exact snapshot", () => {
  for (const wrong of ["record", "business", "scope", "navigation"]) {
    const href = `/dashboard?view=research&selected=${id(1000)}`, fixture = researchScrollHarness({ href, loading: true }), key = scroll.consoleCollectionScrollKey("owner", href); fixture.store.set(key, JSON.stringify(researchStored()));
    const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle(); if (wrong === "navigation") fixture.view.location.search = "?view=library";
    fixture.fireReady(wrong === "record" ? { consoleResearchRecord: id(1001) } : wrong === "business" ? { consoleResearchBusiness: id(2) } : wrong === "scope" ? { consoleResearchReadyScope: scroll.consoleCollectionScrollKey("owner", href + "&page=2") } : {});
    assert.equal(fixture.detail.scrollTop, 50); assert.equal(JSON.parse(fixture.store.get(key)).detail, 730); cleanup();
  }
});
test("Research evidence resolution respects newer scroll intent, unsubmitted filters, active editor and modal", () => {
  for (const action of ["scroll", "filter", "editor", "modal"]) {
    const href = `/dashboard?view=research&selected=${id(1000)}`, fixture = researchScrollHarness({ href, loading: true }), key = scroll.consoleCollectionScrollKey("owner", href); fixture.store.set(key, JSON.stringify(researchStored()));
    const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle();
    if (action === "scroll") { fixture.root.dispatchEvent(new Event("wheel")); fixture.detail.scrollTop = 20; fixture.detail.dispatchEvent(new Event("scroll")); }
    if (action === "filter") { fixture.fields.find(field => field.name === "q").value = "new unsubmitted draft"; fixture.toolbar.dispatchEvent(new Event("input")); }
    if (["editor", "modal"].includes(action)) fixture.view.document = { querySelector: () => action === "modal" ? {} : null, activeElement: { matches: () => action === "editor" } };
    fixture.fireReady(); assert.equal(fixture.detail.scrollTop, action === "scroll" ? 20 : 50); if (action === "filter") assert.equal(fixture.values().q, "new unsubmitted draft");
    if (["editor", "modal"].includes(action)) assert.equal(JSON.parse(fixture.store.get(key)).detail, 730); cleanup();
  }
});

test("Research changed document and inner-scroll reading without a pane input survives evidence ready, while queued clamps do not manufacture intent", () => {
  for (const region of ["document", "body", "detail"]) {
    const width = region === "document" ? 390 : region === "body" ? 1000 : 1280, href = `/dashboard?view=research&selected=${id(1000)}`, fixture = researchScrollHarness({ href, width, loading: true }), key = scroll.consoleCollectionScrollKey("owner", href);
    fixture.store.set(key, JSON.stringify(researchStored(region === "document" ? "document" : region === "body" ? "single" : "split")));
    const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle();
    if (region === "document") { fixture.view.scrollY = 1800; fixture.view.dispatchEvent(new Event("scroll")); }
    else { const node = fixture[region]; node.scrollTop = region === "body" ? 600 : 20; node.dispatchEvent(new Event("scroll")); }
    fixture.fireReady(); assert.equal(region === "document" ? fixture.view.scrollY : fixture[region].scrollTop, region === "document" ? 1800 : region === "body" ? 600 : 20); cleanup();
  }
  const href = `/dashboard?view=research&selected=${id(1000)}`, fixture = researchScrollHarness({ href, loading: true }), key = scroll.consoleCollectionScrollKey("owner", href); fixture.store.set(key, JSON.stringify(researchStored()));
  const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle(); fixture.detail.dispatchEvent(new Event("scroll"));
  fixture.detail.scrollHeight = 30; fixture.detail.clientHeight = 30; fixture.detail.scrollTop = 0; fixture.detail.dispatchEvent(new Event("scroll")); fixture.fireReady(); assert.equal(fixture.detail.scrollTop, 730); cleanup();
});

function researchErrorHarness({ status = "missing", href = `/dashboard?view=research&selected=${id(1000)}`, width = 390, store = new Map() } = {}) {
  const fixture = researchScrollHarness({ href, width, store });
  fixture.root.dataset.collection = "research"; fixture.detail.id = "console-collection-detail";
  fixture.detail.dataset.consoleSelection = status; delete fixture.detail.dataset.consoleResearchRecord; delete fixture.detail.dataset.consoleResearchBusiness;
  const marker = { dataset: { consoleCollectionScope: scroll.consoleCollectionScrollKey("owner", href) } }, original = fixture.root.querySelector;
  fixture.root.querySelector = selector => selector === "[data-console-collection-viewport]" ? marker : original(selector);
  let reveals = 0; fixture.detail.scrollIntoView = () => { reveals++; if (width <= 900) fixture.view.scrollY = 1200; else fixture.body.scrollTop = 900; };
  return { ...fixture, marker, reveals: () => reveals };
}
for (const status of ["missing", "unavailable"]) for (const width of [390, 640, 1000]) test(`fresh ${status} Research selection reveals only its owner-scoped error region at${width}px without found-record markers`, () => {
  const href = `/dashboard?view=research&type=records&business=${id(1)}&selected=${id(1000)}&page=3&q=saved&searchField=hypothesis`, fixture = researchErrorHarness({ href, status, width });
  const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle();
  assert.equal(fixture.reveals(), 1); assert.equal(fixture.detail.dataset.consoleResearchRecord, undefined); assert.equal(fixture.detail.dataset.consoleResearchBusiness, undefined);
  assert.equal(fixture.values().searchField, "hypothesis"); assert.equal(fixture.values().q, "saved"); cleanup();
});
test("root-only Research error reveals the validated requested root; an arbitrary fragment never supplies selection identity", () => {
  const href = `/dashboard?view=research&root=${id(1000)}`, fixture = researchErrorHarness({ href, status: "unavailable" }); fixture.view.location.hash = "#unrelated-target";
  let cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle(); assert.equal(fixture.reveals(), 1); cleanup();
  const absent = researchErrorHarness({ href: "/dashboard?view=research" }); absent.view.location.hash = "#console-collection-detail";
  cleanup = scroll.mountConsoleCollectionScroll(absent.root, "owner", "/dashboard?view=research", absent.view); absent.settle(); assert.equal(absent.reveals(), 0); cleanup();
});
test("Research error reveal rejects malformed/duplicate identities, stale owner scope, mismatched surface and arbitrary region targets", () => {
  const valid = `/dashboard?view=research&selected=${id(1000)}`;
  for (const condition of ["invalid", "duplicate", "wrong-root", "wrong-business", "alias", "type", "owner", "location", "surface", "region", "stale-found"]) {
    const href = condition === "invalid" ? "/dashboard?view=research&selected=malformed" : condition === "duplicate" ? `${valid}&selected=${id(1000)}` : condition === "wrong-root" ? `${valid}&root=invalid` : condition === "wrong-business" ? `${valid}&business=invalid` : condition === "alias" ? `/dashboard?view=research&experiment=${id(1000)}` : condition === "type" ? `${valid}&type=unexpected` : valid;
    const fixture = researchErrorHarness({ href }); fixture.view.location.hash = "#console-collection-detail";
    if (condition === "owner") fixture.marker.dataset.consoleCollectionScope = scroll.consoleCollectionScrollKey("another-owner", href);
    if (condition === "location") fixture.view.location.search = "?view=library";
    if (condition === "surface") fixture.root.dataset.collection = "library";
    if (condition === "region") fixture.detail.id = "arbitrary-region";
    if (condition === "stale-found") fixture.detail.dataset.consoleResearchRecord = id(1000);
    const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle(); assert.equal(fixture.reveals(), 0, condition); cleanup();
  }
});
for (const status of ["missing", "unavailable"]) test(`${status} Research error retains exact Back/reload reading and respects editor/modal and later user scrolling`, () => {
  const href = `/dashboard?view=research&selected=${id(1000)}`, fixture = researchErrorHarness({ href, status });
  let cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle(); assert.equal(fixture.reveals(), 1);
  fixture.view.scrollY = 1800; fixture.view.dispatchEvent(new Event("scroll")); fixture.flushTimers(); cleanup();
  for (const transition of ["Back", "reload"]) {
    const returned = researchErrorHarness({ href, status, store: fixture.store }); returned.view.location.hash = "#console-collection-detail";
    cleanup = scroll.mountConsoleCollectionScroll(returned.root, "owner", href, returned.view); returned.settle(); assert.equal(returned.reveals(), 0, transition); assert.equal(returned.view.scrollY, 1800, transition); cleanup();
  }
  for (const interaction of ["editor", "modal"]) {
    const blocked = researchErrorHarness({ href, status }); blocked.view.document = { querySelector: () => interaction === "modal" ? {} : null, activeElement: { matches: () => interaction === "editor" } };
    cleanup = scroll.mountConsoleCollectionScroll(blocked.root, "owner", href, blocked.view); blocked.settle(); assert.equal(blocked.reveals(), 0, interaction);
    blocked.view.document = { querySelector: () => null, activeElement: { matches: () => false } }; blocked.view.scrollY = 1700; blocked.view.dispatchEvent(new Event("scroll")); blocked.flushTimers();
    assert.equal(blocked.reveals(), 0, `${interaction} newer reading`); assert.equal(blocked.view.scrollY, 1700); cleanup();
  }
});


test("Research anchoring rule is available before hydration and cannot alter Work/Library/modal/document styles", () => {
  const selectors = researchAnchorOptOutSelectors();
  assert.deepEqual(selectors, [".consoleResearchPane", ".consoleResearchPane > .consoleResearchBody", ".consoleResearchPane .consoleResearchResults", ".consoleResearchPane .consoleResearchDetail"]);
  assert.ok(selectors.every(selector => selector.startsWith(".consoleResearchPane")));
  assert.ok(!selectors.some(selector => /consoleResearchSheet|consoleLibraryPane|consoleWorkPane|^html$|^body$|:root/.test(selector)));
  const helper = readFileSync("src/components/console/console-collection-scroll.ts", "utf8");
  assert.doesNotMatch(helper, /overflowAnchor|setProperty\(\s*["']overflow-anchor|documentElement.*style|scrollingElement.*style/);
});
for (const width of [1280, 1000, 390]) test(`inert anchor model: resolved-leaf growth cannot override accepted native reading at${width}px`, () => {
  const href = `/dashboard?view=research&selected=${id(1000)}`, fixture = researchScrollHarness({ href, width, loading: true, pendingMaximum: 900, nativeReadyShift: 574 });
  const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle();
  if (width >= 1200) { fixture.detail.scrollTop = 120; fixture.detail.dispatchEvent(new Event("scroll")); }
  else if (width > 900) { fixture.body.scrollTop = 120; fixture.body.dispatchEvent(new Event("scroll")); }
  else { fixture.view.scrollY = 160; fixture.view.dispatchEvent(new Event("scroll")); }
  fixture.fireReady(); assert.equal(width >= 1200 ? fixture.detail.scrollTop : width > 900 ? fixture.body.scrollTop : fixture.view.scrollY, width <= 900 ? 160 : 120); cleanup();
});
for (const interaction of ["editor", "modal", "blurred-filter"]) test(`inert anchor model: pre-ready DOM growth cannot move ${interaction} reading authority`, () => {
  const href = `/dashboard?view=research&selected=${id(1000)}`, fixture = researchScrollHarness({ href, loading: true, pendingMaximum: 900, nativeReadyShift: interaction === "editor" ? 556 : 574 });
  const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle();
  const chosen = interaction === "blurred-filter" ? 259 : 700; fixture.detail.scrollTop = chosen; fixture.detail.dispatchEvent(new Event("scroll"));
  if (interaction === "blurred-filter") { fixture.fields.find(field => field.name === "q").value = "retain this unsubmitted filter"; fixture.toolbar.dispatchEvent(new Event("input")); }
  else fixture.view.document = { querySelector: () => interaction === "modal" ? {} : null, activeElement: { matches: () => interaction === "editor" } };
  fixture.fireReady(); assert.equal(fixture.detail.scrollTop, chosen); if (interaction === "blurred-filter") assert.equal(fixture.values().q, "retain this unsubmitted filter"); cleanup();
});
test("inert anchor model: exact Back/reload restoration remains enabled after Research-only opt-out", () => {
  const href = `/dashboard?view=research&selected=${id(1000)}`, fixture = researchScrollHarness({ href, loading: true, pendingMaximum: 50, nativeReadyShift: 574 }), key = scroll.consoleCollectionScrollKey("owner", href);
  fixture.store.set(key, JSON.stringify(researchStored())); const cleanup = scroll.mountConsoleCollectionScroll(fixture.root, "owner", href, fixture.view); fixture.settle();
  assert.equal(fixture.detail.scrollTop, 50); assert.equal(JSON.parse(fixture.store.get(key)).detail, 730); fixture.fireReady(); assert.equal(fixture.detail.scrollTop, 730); cleanup();
});
