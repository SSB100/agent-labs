import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { libraryMarkup, libraryDesign, libraryRun, libraryPane, runLookup, preview, id } from "./helpers/console-library-pane-fixtures.mjs";

for (const kind of ["designs", "records"]) {
  test(`${kind}: actual pane renders a bounded metadata page representing 127 records and two Businesses`, () => {
    const markup = libraryMarkup(kind);
    assert.equal((markup.match(/data-record-id=/g) ?? []).length, 25);
    assert.match(markup, /1–25 of 127/); assert.match(markup, /25 loaded/);
    assert.match(markup, /North Star Studio 1/); assert.match(markup, /North Star Studio 2/);
    assert.match(markup, /Full name &amp; identity/); assert.match(markup, /LongBusinessWithoutAnySpaces/);
    assert.match(markup, /method="get"/); assert.match(markup, /action="\/dashboard"/);
    assert.match(markup, /name="pageSize" value="25"/); assert.doesNotMatch(markup, /EXACT-CONTENT-/);
    assert.doesNotMatch(markup, /method="post"|>Approve<|>Generate<|>Publish</);
    const last = libraryMarkup(kind, { searchParams: { page: "6" } });
    assert.equal((last.match(/data-record-id=/g) ?? []).length, 2); assert.match(last, /126–127 of 127/); assert.match(last, /2 loaded/);
  });
  test(`${kind}: off-page selection and Close preserve aggregate scope, page and filter state`, () => {
    const selected = kind === "records" ? id(5000) : id(1000);
    const markup = libraryMarkup(kind, { searchParams: { page: "3", q: "saved", selected, custom: "kept" } });
    assert.doesNotMatch(markup, new RegExp(`data-record-id="${selected}"`));
    assert.match(markup, new RegExp(`data-library-${kind === "records" ? "artifact" : "design"}="${selected}"`));
    const close = new URL(markup.match(/href="([^"]*)">Close detail/)[1].replaceAll("&amp;", "&"), "https://fixture.test");
    assert.equal(close.searchParams.get("page"), "3"); assert.equal(close.searchParams.get("q"), "saved"); assert.equal(close.searchParams.get("custom"), "kept"); assert.equal(close.searchParams.has("business"), false); assert.equal(close.searchParams.has("selected"), false);
    const form = markup.match(/<form[\s\S]*?<\/form>/)[0];
    assert.match(form, new RegExp(`name="selected" value="${selected}"`)); assert.doesNotMatch(form, /name="page"/);
  });
  test(`${kind}: wrong Business is missing, failed reads are unknown, oversized pages are not rendered`, () => {
    const selected = kind === "records" ? id(5000) : id(1000);
    const wrong = libraryMarkup(kind, { searchParams: { business: id(2), selected } });
    assert.match(wrong, /Your Business filter has been kept/); assert.doesNotMatch(wrong, /data-library-design=|data-library-artifact=/);
    const failed = libraryMarkup(kind, { page: { items: [], total: null, complete: false, hasNext: null, errors: ["Read unavailable"] } });
    assert.match(failed, /Saved records unavailable/); assert.match(failed, /Total unavailable/); assert.match(failed, /Next unverified/); assert.doesNotMatch(failed, /No matching/);
    const oversized = libraryMarkup(kind, { page: { pageSize: 26 } });
    assert.match(oversized, /exceeds the 25-record page limit/); assert.doesNotMatch(oversized, /data-record-id=/);
  });
}
test("Records filters identify MIME and artifact fields, and only exact content/checksum appears", () => {
  const markup = libraryMarkup("records", { searchParams: { selected: id(5000) } });
  assert.match(markup, /Search record name/); assert.match(markup, /Saved MIME type/); assert.match(markup, /name="mediaType"/); assert.match(markup, /Artifact type/); assert.match(markup, /name="artifactType"/);
  assert.match(markup, /EXACT-CONTENT-0/); assert.match(markup, /EXACT-METADATA-0/); assert.doesNotMatch(markup, /EXACT-CONTENT-1/);
  assert.match(markup, /Artifact revision<\/dt><dd>Not recorded/); assert.match(markup, /A JSON schema version is not an artifact revision/); assert.match(markup, /Checksum/);
  assert.match(markup, /javascript:never-a-download/); assert.doesNotMatch(markup, /href="javascript:|<script>alert/); assert.match(markup, /&lt;script&gt;/);
  assert.doesNotMatch(markup, /href="[^\"]*view=work/);
  const missing = libraryMarkup("records", { searchParams: { selected: id(5001) } }); assert.match(missing, /Checksum<\/dt><dd>Not recorded/);
});
test("Design detail separates technical visual PASS, print checks, approval, ProductTEST and publication", () => {
  const markup = libraryMarkup("designs", { searchParams: { selected: id(1000) } });
  for (const value of ["Technical visual PASS", "Saved print-file checks passed", "Technical-only approval", "Market ProductTEST", "Not established by these creative records", "Listing / publication", "Readiness and authority not established here", "Saved approval is separate from completed production checks", "This saved approval has expired"]) assert.ok(markup.includes(value), value);
  assert.match(markup, /1 charge\(s\) remain unknown/); assert.match(markup, /US\$0\.200000/); assert.match(markup, /US\$0\.600000/); assert.match(markup, /Receipt missing after run expiry/);
  assert.match(markup, /data-library-creative-run=/); assert.match(markup, /Stopped/);
  assert.doesNotMatch(markup, /productionReady|Ready to publish|Ready to sell/);
});
test("malformed nested review and inspection records fail closed without throwing", () => {
  const malformed = [null, "not a list", {}, [null], [{ criterion: "brief_alignment", outcome: "PASS", rationale: {} }]];
  for (const checks of malformed) {
    const design = libraryDesign(), review = design.runDetail.reviews.records[0]; review.review.checks = checks;
    const markup = libraryMarkup("designs", { searchParams: { selected: design.id }, data: { selection: { status: "found", item: design } } });
    assert.match(markup, /Visual review unavailable/); assert.doesNotMatch(markup, /Technical visual PASS/);
  }
  for (const inspection of [{}, { failedCriteria: "not-array" }, { ...libraryDesign().inspection, sha256: "bad" }, { ...libraryDesign().inspection, transparentPixelFraction: Infinity }]) assert.equal(libraryPane.consoleLibraryPrintState(libraryDesign(0, { inspection })), "Print-file validation unavailable");
  const failed = libraryDesign(); failed.inspection.failedCriteria = ["dpi_below_minimum"]; assert.equal(libraryPane.consoleLibraryPrintState(failed), "Saved print-file checks failed");
  const mismatch = libraryDesign(); mismatch.runDetail.reviews.records[0].review.assetHash = "c".repeat(64); assert.equal(libraryPane.consoleLibraryVisualReview(mismatch), null);
});
test("saved candidate approval and simulation are not promoted into market or publication authority", () => {
  for (const purpose of ["candidate_production", "simulation", "unsupported_purpose"]) {
    const design = libraryDesign(); design.runDetail.approval.item.purpose = purpose; design.runDetail.approval.item.snapshot = { printSpecification: null, maximumGenerations: { bad: true }, candidateAssessment: ["unvalidated"] };
    const markup = libraryMarkup("designs", { searchParams: { selected: design.id }, data: { selection: { status: "found", item: design } } });
    assert.match(markup, purpose === "candidate_production" ? /Saved candidate approval/ : purpose === "simulation" ? /Simulation only/ : /Purpose unavailable/);
    assert.match(markup, /Readiness and authority not established here/); assert.match(markup, /Saved print specification unavailable/);
  }
});
test("stopped paid run with no asset remains an exact run selection with conservative receipt accounting", () => {
  const runDetail = libraryRun(0, { assets: { status: "ready", records: [], total: 0, limit: 2 } });
  const markup = libraryMarkup("designs", { searchParams: { creativeRun: id(2000), page: "3", q: "saved" }, data: { runDetail } });
  assert.match(markup, /Selected creative run/); assert.match(markup, /No saved asset is recorded for this exact run/); assert.match(markup, /Stopped/); assert.match(markup, /US\$0\.200000/); assert.match(markup, /charge\(s\) remain unknown/);
  assert.doesNotMatch(markup, /data-library-design=/); assert.match(markup, /Open exact Work run/);
  const close = new URL(markup.match(/href="([^"]*)">Close detail/)[1].replaceAll("&amp;", "&"), "https://fixture.test"); assert.equal(close.searchParams.has("creativeRun"), false); assert.equal(close.searchParams.get("page"), "3"); assert.equal(close.searchParams.get("q"), "saved");
  const unknown = libraryMarkup("designs", { searchParams: { creativeRun: id(2000) }, data: { runDetail: null } }); assert.match(unknown, /Selected creative run/); assert.match(unknown, /This exact record could not be verified/); assert.doesNotMatch(unknown, /No exact record selected/);
});
test("unavailable assets/costs/phase outputs never become no assets or zero spend", () => {
  const runDetail = libraryRun(0, { assets: { status: "unavailable", records: [], total: null, limit: 2 }, outputs: { status: "unavailable", records: [], total: null, limit: 6 }, costs: { status: "unavailable", records: [], reservations: [], settlements: [] }, complete: false, errors: ["Receipt read unavailable"] });
  const markup = libraryMarkup("designs", { searchParams: { creativeRun: id(2000) }, data: { runDetail } });
  assert.match(markup, /Asset history unavailable/); assert.match(markup, /Unavailable; charge unknown/); assert.match(markup, /Phase outputs unavailable/); assert.match(markup, /Do not assume zero spend/); assert.doesNotMatch(markup, /No saved asset is recorded|No provider calls recorded|US\$0\.000000/);
});
test("Work links use verified exact identity; absent artifact pointer becomes run-only and absent context stays unavailable", () => {
  assert.equal(libraryPane.consoleLibraryWorkHref(null), null); assert.equal(libraryPane.consoleLibraryWorkHref({ businessId: id(1), workflowRunId: "bad", artifactId: null }), null);
  const exact = libraryPane.consoleLibraryWorkHref({ businessId: id(1), workflowRunId: id(6000), artifactId: id(5000) }); assert.match(exact, new RegExp(`artifact=${id(5000)}#artifact-${id(5000)}`));
  const runOnly = libraryMarkup("designs", { searchParams: { selected: id(1001) } }); assert.match(runOnly, /No artifact pointer was saved/); assert.match(runOnly, /Open exact Work run/); assert.doesNotMatch(runOnly, /Open exact Work output/);
  const design = libraryDesign(0, { workIdentity: null, contextStatus: "unavailable", artifactStatus: "unavailable" }); design.runDetail.workflow = { status: "unavailable", item: null };
  const blocked = libraryMarkup("designs", { searchParams: { selected: design.id }, data: { selection: { status: "found", item: design } } }); assert.match(blocked, /Exact Work link unavailable/); assert.doesNotMatch(blocked, /href="[^\"]*view=work/);
});
test("list has truthful stopped, active and unknown execution state plus bounded artwork previews", () => {
  const markup = libraryMarkup("designs", { searchParams: { sort: "oldest" } });
  assert.match(markup, />Stopped<\/span>/); assert.match(markup, />Running<\/span>/); assert.match(markup, />Unknown<\/span>/); assert.match(markup, /Raw saved workflow state/);
  const design = libraryDesign(0, { signedUrl: "https://fixture.invalid/private-preview?token=inert", previewStatus: "ready", previewReason: null });
  const image = libraryMarkup("designs", { page: { items: [design], total: 1 }, data: { selection: { status: "found", item: design } } });
  assert.match(image, /loading="lazy"/); assert.match(image, /width="84" height="84"/); assert.match(image, /Original artwork · not a product mockup/); assert.doesNotMatch(image, /_next\/image/);
});
test("CSS uses existing bounded viewport, scoped44px targets, two-line summary and mobile document reflow", () => {
  const css = readFileSync("src/components/console/console-library-pane.css", "utf8");
  assert.doesNotMatch(css, /font-size:(?:[0-9]|1[01])px/);
  assert.match(css, /min-height:44px/); assert.match(css, /-webkit-line-clamp:2/); assert.match(css, /@media\(min-width:1200px\)/); assert.match(css, /@media\(max-width:900px\)/); assert.match(css, /height:auto/); assert.match(css, /prefers-reduced-motion/);
  assert.match(libraryMarkup(), /data-console-collection-viewport="true"/);
});
test("actual private preview leaf replaces expired image and link without retrying or leaking the URL", () => {
  const require = createRequire(import.meta.url), ts = require("typescript");
  const source = readFileSync("src/components/console/console-library-preview.tsx", "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  let failed = false; const fixtureModule = { exports: {} };
  runInNewContext(`(function(require,module,exports){${code}\n})`)(name => name === "react" ? { useState: () => [failed, value => { failed = value; }], useCallback: callback => callback } : require(name), fixtureModule, fixtureModule.exports);
  const props = { signedUrl: "https://fixture.invalid/private?token=must-not-enter-error", reason: null, version: 1, large: true };
  const leaf = fixtureModule.exports.ConsoleLibraryPreview;
  const findImage = node => !node || typeof node !== "object" ? null : node.type === "img" ? node : (Array.isArray(node) ? node : [node.props?.children]).flat(Infinity).map(findImage).find(Boolean);
  const first = leaf(props); assert.match(renderToStaticMarkup(first), /Open full image/); findImage(first).props.onError();
  const expired = renderToStaticMarkup(leaf(props)); assert.match(expired, /Private preview unavailable/); assert.match(expired, /may have expired/); assert.doesNotMatch(expired, /<img|Open full image|must-not-enter-error/);
  // A new server URL remounts this keyed leaf; it never retries the failed URL itself.
  const paneSource = readFileSync("src/components/console/console-library-pane.tsx", "utf8"); assert.match(paneSource, /key=\{`\$\{design.id\}:\$\{design.signedUrl/);
  failed = false; assert.match(renderToStaticMarkup(leaf({ ...props, signedUrl: "https://fixture.invalid/new-approved-preview" })), /new-approved-preview/);
});
test("run/design drill-through and scoped Research results links preserve the intended identities", () => {
  const design = libraryMarkup("designs", { searchParams: { selected: id(1000), page: "3", q: "saved" } });
  const history = new URL(design.match(/href="([^"]*)">Run history and receipts/)[1].replaceAll("&amp;", "&"), "https://fixture.test");
  assert.equal(history.searchParams.get("creativeRun"), id(2000)); assert.equal(history.searchParams.has("selected"), false); assert.equal(history.searchParams.has("business"), false); assert.equal(history.searchParams.get("page"), "3"); assert.equal(history.searchParams.get("q"), "saved");
  const run = libraryMarkup("designs", { searchParams: { creativeRun: id(2000), page: "3", q: "saved" } });
const version = new URL(run.match(/href="([^"]*)">Inspect version 1/)[1].replaceAll("&amp;", "&"), "https://fixture.test");
  assert.equal(version.searchParams.get("selected"), id(1000)); assert.equal(version.searchParams.has("creativeRun"), false); assert.equal(version.searchParams.get("page"), "3");
  const records = libraryMarkup("records", { searchParams: { business: id(2), page: "2", mediaType: "application/json" } });
  const research = new URL(records.match(/href="([^"]*)">Research results/)[1].replaceAll("&amp;", "&"), "https://fixture.test");
  assert.equal(research.pathname, "/dashboard"); assert.equal(research.searchParams.get("business"), id(2)); assert.equal(research.searchParams.get("view"), "library"); assert.equal(research.searchParams.get("type"), "research");
  const aggregate = libraryMarkup("records", { searchParams: { selected: id(5001), page: "3" } });
  const selectedResearch = new URL(aggregate.match(/href="([^"]*)">Research results/)[1].replaceAll("&amp;", "&"), "https://fixture.test");
  assert.equal(selectedResearch.searchParams.get("business"), id(2));
  assert.match(aggregate, /<option value="" selected="">All authorized Businesses/);
});
test("selected fold prioritizes independent design status, exact run costs and artifact content before diagnostics", () => {
  const design = libraryMarkup("designs", { searchParams: { selected: id(1000) } });
  assert.ok(design.indexOf("consoleLibraryDesignSummary") < design.indexOf("Full design identity &amp; readiness boundaries"));
  const run = libraryMarkup("designs", { searchParams: { creativeRun: id(2000) } });
  assert.ok(run.indexOf("Provider charges &amp; reservations") < run.indexOf("Exact run identity &amp; expiry"));
  const record = libraryMarkup("records", { searchParams: { selected: id(5000) } });
  assert.ok(record.indexOf("EXACT-CONTENT-0") < record.indexOf("Full record identity, checksum &amp; dates"));
});
test("contradictory or fractional inspection fields never produce saved print PASS", () => {
  for (const changes of [{ width: 1.5 }, { height: 4097 }, { bytes: 12 }, { colorSpace: "" }, { colorSpace: "cmyk" }, { hasAlpha: false }, { failedCriteria: [null] }]) {
    const design = libraryDesign(); design.inspection = { ...design.inspection, ...changes };
    assert.equal(libraryPane.consoleLibraryPrintState(design), "Print-file validation unavailable");
  }
});

function lookupHarness(href = `/dashboard?view=library&type=designs&creativeRun=${id(2000)}`) {
  let url = new URL(href, "https://fixture.test"), sequence = 0;
  const timers = new Map(), frames = new Map(), captured = [], form = new EventTarget(), view = new EventTarget();
  const field = { name: "creativeRun", value: "browser-restored-wrong-value", selectionStart: 7, selectionEnd: 7 };
  const marker = { dataset: { consoleRunLookupScope: runLookup.consoleLibraryRunLookupScope("owner", href)?.key } };
  const document = { activeElement: null };
  Object.assign(form, { isConnected: true, dataset: {}, ownerDocument: document, querySelector: selector => selector.includes("input") ? field : marker });
  Object.assign(view, { document, scrollY: 432, setTimeout: callback => { timers.set(++sequence, callback); captured.push(callback); return sequence; }, clearTimeout: key => timers.delete(key), requestAnimationFrame: callback => { frames.set(++sequence, callback); captured.push(callback); return sequence; }, cancelAnimationFrame: key => frames.delete(key), scrollTo: () => { throw new Error("Lookup may not scroll"); } });
  Object.defineProperty(view, "location", { get: () => url });
  const drain = queue => { const pending = [...queue.values()]; queue.clear(); pending.forEach(callback => callback()); };
  return { form, field, marker, view, document, captured,
    setHref: next => { url = new URL(next, "https://fixture.test"); },
    bind: (next = `${url.pathname}${url.search}`, owner = "owner") => { marker.dataset.consoleRunLookupScope = runLookup.consoleLibraryRunLookupScope(owner, next)?.key; return runLookup.mountConsoleLibraryRunLookup(form, owner, next, view); },
    flushTimers: () => drain(timers), flushFrames: () => drain(frames), settle: () => { drain(timers); drain(frames); },
  };
}
function lookupPageShow(persisted) { const event = new Event("pageshow"); Object.defineProperty(event, "persisted", { value: persisted }); return event; }
const runHref = number => `/dashboard?view=library&type=designs&business=${id(1)}&creativeRun=${id(number)}&page=3&q=saved`;

test("lookup strict scope matches native GET defaults and accepts uppercase UUIDs without broadening invalid identities", () => {
  const upper = "ABCDEFAB-CDEF-4ABC-ABCD-ABCDEFABCDEF";
  const scope = runLookup.consoleLibraryRunLookupScope("owner", `/dashboard?view=library&creativeRun=${upper}`);
  assert.equal(scope.creativeRunId, upper.toLowerCase());
  assert.equal(runLookup.consoleLibraryRunLookupScope("owner", `/dashboard?view=library&creativeRun=${upper.toLowerCase()}`).key, scope.key);
  const markup = libraryMarkup("designs", { searchParams: { creativeRun: upper } });
  const pattern = markup.match(/<input[^>]*pattern="([^"]+)"[^>]*name="creativeRun"/)[1];
  assert.ok(new RegExp(`^${pattern}$`, "v").test(upper)); assert.ok(new RegExp(`^${pattern}$`, "v").test(upper.toLowerCase()));
  assert.equal(runLookup.consoleLibraryRunLookupScope("owner", `/dashboard?view=library&creativeRun=${upper}&q=&page=01&pageSize=025&sort=newest&business=`).key, scope.key);
  for (const href of [`/dashboard?view=library&type=records&creativeRun=${id(2000)}`, `/dashboard?view=library&creativeRun=bad`, `/dashboard?view=library&creativeRun=${id(2000)}&selected=${id(1000)}`, `/dashboard?view=library&creativeRun=${id(2000)}&creativeRun=${id(2001)}`, `/dashboard?view=library&page=0`, `/dashboard/products?view=library`]) assert.equal(runLookup.consoleLibraryRunLookupScope("owner", href), null);
});
test("lookup retained A to B to Back/Forward reconciles URL identity after native form restoration", () => {
  const fixture = lookupHarness(runHref(2000)); let cleanup = fixture.bind(); fixture.settle(); assert.equal(fixture.field.value, id(2000));
  fixture.field.value = id(2001); fixture.form.dispatchEvent(new Event("input"));
  fixture.setHref(runHref(2001)); cleanup(); cleanup = fixture.bind(); fixture.settle(); assert.equal(fixture.field.value, id(2001));
  for (const target of [2000, 2001, 2000]) {
    fixture.setHref(runHref(target)); fixture.view.dispatchEvent(new Event("popstate"));
    // The server commit may follow the old tree's history event; browser state follows both.
    cleanup(); cleanup = fixture.bind(); fixture.field.value = "persisted-B-value"; fixture.settle();
    assert.equal(fixture.field.value, id(target));
  }
  assert.equal(fixture.view.scrollY, 432); cleanup();
});
test("lookup persisted native history restores identity but late initial pageshow preserves typing", () => {
  const fixture = lookupHarness(runHref(2000)); const cleanup = fixture.bind(); fixture.settle();
  fixture.field.value = id(2001); fixture.form.dispatchEvent(new Event("input"));
  fixture.view.dispatchEvent(lookupPageShow(false)); fixture.settle(); assert.equal(fixture.field.value, id(2001));
  fixture.view.dispatchEvent(lookupPageShow(true)); fixture.field.value = "browser-restored-B";
  fixture.view.dispatchEvent(lookupPageShow(false)); fixture.settle(); assert.equal(fixture.field.value, id(2000)); cleanup();
});
test("lookup post-history edits cancel either deferred stage and unchanged refresh keeps the draft, caret, focus and scroll", () => {
  for (const phase of ["task", "frame"]) for (const event of ["input", "change"]) {
    const fixture = lookupHarness(runHref(2000)); let cleanup = fixture.bind(); fixture.settle();
    fixture.view.dispatchEvent(lookupPageShow(true)); if (phase === "frame") fixture.flushTimers();
    fixture.document.activeElement = fixture.field; fixture.field.value = "Unsubmitted newer UUID draft"; fixture.form.dispatchEvent(new Event(event));
    fixture.settle(); assert.equal(fixture.field.value, "Unsubmitted newer UUID draft");
    cleanup(); cleanup = fixture.bind(); fixture.view.dispatchEvent(lookupPageShow(false)); fixture.settle();
    assert.equal(fixture.field.value, "Unsubmitted newer UUID draft"); assert.equal(fixture.field.selectionStart, 7); assert.equal(fixture.field.selectionEnd, 7); assert.equal(fixture.document.activeElement, fixture.field); assert.equal(fixture.view.scrollY, 432); cleanup();
  }
});
test("lookup newer edit between old-tree history and new server commit survives its scope rebind", () => {
  const fixture = lookupHarness(runHref(2001)); let cleanup = fixture.bind(); fixture.settle();
  fixture.setHref(runHref(2000)); fixture.view.dispatchEvent(new Event("popstate"));
  fixture.field.value = "Edited after Back before commit"; fixture.form.dispatchEvent(new Event("input"));
  cleanup(); cleanup = fixture.bind(); fixture.settle(); assert.equal(fixture.field.value, "Edited after Back before commit"); cleanup();
});
test("lookup stale raw URL, equal-canonical hash navigation, detached form and cancelled callbacks cannot overwrite current input", () => {
  for (const change of ["new-run", "hash", "default", "detached", "marker"]) for (const phase of ["task", "frame"]) {
    const fixture = lookupHarness(runHref(2000)); const cleanup = fixture.bind(); fixture.settle();
    fixture.view.dispatchEvent(new Event("popstate")); if (phase === "frame") fixture.flushTimers();
    const stale = fixture.captured.at(-1); fixture.field.value = "Keep current value";
    if (change === "new-run") fixture.setHref(runHref(2001));
    if (change === "hash") fixture.setHref(`${runHref(2000)}#newer-navigation`);
    if (change === "default") fixture.setHref(`${runHref(2000)}&sort=newest`);
    if (change === "detached") fixture.form.isConnected = false;
    if (change === "marker") fixture.marker.dataset.consoleRunLookupScope = "new-marker";
    fixture.settle(); assert.equal(fixture.field.value, "Keep current value", `${change}/${phase}`);
    cleanup(); stale(); fixture.settle(); assert.equal(fixture.field.value, "Keep current value");
  }
});
test("lookup preserves pre-hydration typing and prevents owner/scope draft inheritance", () => {
  const fixture = lookupHarness(runHref(2000)); fixture.document.activeElement = fixture.field; fixture.field.value = "Typed before hydration";
  let cleanup = fixture.bind(); fixture.view.dispatchEvent(lookupPageShow(false)); fixture.settle(); assert.equal(fixture.field.value, "Typed before hydration");
  fixture.document.activeElement = null; cleanup(); cleanup = fixture.bind(); fixture.settle(); assert.equal(fixture.field.value, "Typed before hydration");
  cleanup(); cleanup = fixture.bind(undefined, "different-owner"); fixture.settle(); assert.equal(fixture.field.value, id(2000)); cleanup();
  fixture.setHref(runHref(2001)); cleanup = fixture.bind(); fixture.settle(); assert.equal(fixture.field.value, id(2001)); cleanup();
});
test("lookup fresh back_forward document restores focused keyboard-submitted value without needing popstate", () => {
  const fixture = lookupHarness(runHref(2000));
  fixture.view.performance = { getEntriesByType: () => [{ entryType: "navigation", type: "back_forward" }] };
  fixture.document.activeElement = fixture.field; fixture.field.value = id(2001);
  let cleanup = fixture.bind(); fixture.settle(); assert.equal(fixture.field.value, id(2000));
  // A late non-bfcache pageshow may be followed by native form restoration.
  fixture.view.dispatchEvent(lookupPageShow(false)); fixture.field.value = id(2001); fixture.settle(); assert.equal(fixture.field.value, id(2000));
  fixture.field.value = "New draft after native return"; fixture.form.dispatchEvent(new Event("input"));
  cleanup(); cleanup = fixture.bind(); fixture.view.dispatchEvent(lookupPageShow(false)); fixture.settle(); assert.equal(fixture.field.value, "New draft after native return"); assert.equal(fixture.document.activeElement, fixture.field); cleanup();
});
test("lookup new typing wins over fresh native history restoration before either deferred phase and pageshow", () => {
  for (const phase of ["task", "frame"]) {
    const fixture = lookupHarness(runHref(2000)); fixture.view.performance = { getEntriesByType: () => [{ type: "back_forward" }] };
    fixture.document.activeElement = fixture.field; const cleanup = fixture.bind(); if (phase === "frame") fixture.flushTimers();
    fixture.field.value = "User typed after history mount"; fixture.form.dispatchEvent(new Event("input"));
    fixture.view.dispatchEvent(lookupPageShow(false)); fixture.settle(); assert.equal(fixture.field.value, "User typed after history mount"); cleanup();
  }
});

test("private preview commit check distinguishes a completed pre-hydration failure from unloaded lazy, pending, loaded and stale sources", () => {
  const signedUrl = "https://fixture.invalid/private-preview?token=inert";
  const image = changes => Object.freeze({ complete: true, currentSrc: signedUrl, naturalWidth: 0, src: signedUrl, getAttribute: name => name === "src" ? signedUrl : null, ...changes });
  assert.equal(preview.consoleLibraryPreviewFailed(image({}), signedUrl), true);
  for (const changes of [{ complete: false }, { currentSrc: "" }, { currentSrc: "", complete: false }, { naturalWidth: 1 }, { currentSrc: "https://fixture.invalid/older-preview" }, { getAttribute: () => "https://fixture.invalid/different-preview" }]) assert.equal(preview.consoleLibraryPreviewFailed(image(changes), signedUrl), false);
  assert.equal(preview.consoleLibraryPreviewFailed(image({}), null), false);
});
test("actual committed preview callback replaces a request already failed before hydration and keeps new URL reset keyed", () => {
  const require = createRequire(import.meta.url), ts = require("typescript"), source = readFileSync("src/components/console/console-library-preview.tsx", "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  let failed = false; const fixtureModule = { exports: {} };
  runInNewContext(`(function(require,module,exports){${code}\n})`)(name => name === "react" ? { useState: () => [failed, value => { failed = value; }], useCallback: callback => callback } : require(name), fixtureModule, fixtureModule.exports);
  const leaf = fixtureModule.exports.ConsoleLibraryPreview, signedUrl = "https://fixture.invalid/private?token=never-print-token", props = { signedUrl, reason: null, version: 1, large: true, compact: true };
  const findImage = node => !node || typeof node !== "object" ? null : node.type === "img" ? node : (Array.isArray(node) ? node : [node.props?.children]).flat(Infinity).map(findImage).find(Boolean);
  const requestAlreadyFailed = Object.freeze({ src: signedUrl, currentSrc: signedUrl, complete: true, naturalWidth: 0, getAttribute: () => signedUrl });
  const first = leaf(props); findImage(first).props.ref(requestAlreadyFailed);
  const recovered = renderToStaticMarkup(leaf(props));
  assert.match(recovered, /Private preview unavailable/); assert.match(recovered, /Reload to refresh private access/); assert.doesNotMatch(recovered, /<img|Open full image|never-print-token/);
  findImage(first).props.ref(null); assert.equal(failed, true, "unmount is inert");
  // The parent provides a new key for a newly supplied signed URL; no old URL is retried.
  failed = false; const renewed = leaf({ ...props, signedUrl: "https://fixture.invalid/new-approved-source" });
  findImage(renewed).props.ref({ ...requestAlreadyFailed, src: "https://fixture.invalid/new-approved-source", currentSrc: "", complete: false, getAttribute: () => "https://fixture.invalid/new-approved-source" });
  assert.equal(failed, false); assert.match(renderToStaticMarkup(renewed), /new-approved-source/);
});
test("desktop Library reclaims the fold without shrinking text or hiding its five independent states", () => {
  const css = readFileSync("src/components/console/console-library-pane.css", "utf8");
  assert.match(css, /@media\(min-width:901px\)/); assert.match(css, /min-height:34px/); assert.match(css, /min-height:44px/);
  assert.match(css, /grid-template-columns:140px minmax\(0,1fr\)/); assert.match(css, /grid-template-columns:minmax\(115px,\.62fr\) minmax\(0,1\.38fr\)/);
  assert.doesNotMatch(css, /font-size:(?:[0-9]|1[01])px/);
  const markup = libraryMarkup("designs", { searchParams: { selected: id(1000) } });
  const selected = markup.slice(markup.indexOf(`data-library-design="${id(1000)}"`));
  assert.ok(selected.indexOf("consoleLibraryDesignSummary") < selected.indexOf("consoleLibraryBusiness"));
  const summary = selected.slice(selected.indexOf("consoleLibraryBoundaries"), selected.indexOf("consoleLibraryBusiness"));
  for (const label of ["Visual review", "Print-file checks", "Saved approval", "Market ProductTEST", "Listing / publication"]) assert.ok(summary.includes(label), label);
});
