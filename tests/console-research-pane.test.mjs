import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { researchMarkup, researchFixture, researchEvidence, researchHistorical, researchHistoryInput, researchBusinesses, researchRecords, associatedAttempts, researchQuery, researchLongName, researchPane, id, rebind, rebindEvidence, textHash } from "./helpers/console-research-pane-fixtures.mjs";
const links = markup => [...markup.matchAll(/href="([^"]+)"/g)].map(match => new URL(match[1].replaceAll("&amp;", "&"), "https://fixture.test"));
const selectedSearch = { selected: id(10), page: "3", q: "Duplicate", searchField: "objective" };

test("127 saved raw records use one fixed25 server page with honest totals and explicit GET filters", () => {
  const markup = researchMarkup();
  assert.equal((markup.match(/data-research-record=/g) ?? []).length, 25);
  assert.match(markup, /1–25 of 127 saved raw records · 25 loaded/); assert.match(markup, /Page 1 of 6/);
  assert.match(markup, /Starting rounds/); assert.match(markup, /All records/);
  const form = markup.match(/<form[\s\S]*?<\/form>/)[0];
  assert.match(form, /method="get"/); assert.match(form, /action="\/dashboard"/); assert.match(form, /name="pageSize" value="25"/);
  for (const field of ["searchField", "q", "business", "sort"]) assert.match(form, new RegExp(`name="${field}"`));
  assert.match(form, /Saved objective/); assert.match(form, /Saved hypothesis/); assert.match(form, /maxLength="120"/);
  assert.match(markup, /All authorized Businesses/); assert.match(markup, /\[000001\]/); assert.match(markup, /\[000002\]/);
});
test("last page has two rows and missing counts do not become zero", () => {
  const last = researchMarkup("records", { searchParams: { page: "6" } });
  assert.equal((last.match(/data-research-record=/g) ?? []).length, 2); assert.match(last, /126–127 of 127 saved raw records · 2 loaded/);
  const unknown = researchMarkup("records", { page: { total: null, hasNext: null, complete: false, errors: ["Count unavailable"] } });
  assert.match(unknown, /25 saved raw records loaded on page 1 · Total unavailable/); assert.match(unknown, /Next unverified/); assert.doesNotMatch(unknown, /of 0|No matching saved records/);
});
test("list selection and Close preserve list page and filters; native Apply resets cursors", () => {
  const markup = researchMarkup("records", { searchParams: { ...selectedSearch, business: id(1), sort: "oldest", attemptPage: "3", attemptSort: "oldest" } });
  const form = markup.match(/<form[\s\S]*?<\/form>/)[0];
  assert.match(form, new RegExp(`name="selected" value="${id(10)}"`)); assert.doesNotMatch(form, /name="page"|name="attemptPage"/);
  const close = links(markup).find(url => !url.searchParams.has("selected") && url.searchParams.get("page") === "3");
  assert.ok(close); for (const [key, value] of Object.entries({ q: "Duplicate", searchField: "objective", business: id(1), sort: "oldest" })) assert.equal(close.searchParams.get(key), value);
  const row = links(markup).find(url => url.hash === "#console-collection-detail" && url.searchParams.get("selected") !== id(10) && url.searchParams.get("view") === "research");
  assert.ok(row); assert.equal(row.searchParams.get("page"), "3"); assert.equal(row.searchParams.get("q"), "Duplicate"); assert.equal(row.searchParams.get("business"), id(1));
});
test("off-page and off-search exact selection remains inspectable without moving the queue", () => {
  const markup = researchMarkup("records", { searchParams: { selected: id(10), page: "3", q: "LongUnbrokenOriginal", searchField: "objective" } });
  assert.match(markup, new RegExp(`data-selected-research="${id(10)}"`)); assert.doesNotMatch(markup, new RegExp(`data-research-record="${id(10)}"`)); assert.match(markup, /51–75 of 102 saved raw records/);
  const offFilter = researchMarkup("records", { searchParams: { selected: id(10), q: "no-row-matches", searchField: "hypothesis" } });
  assert.match(offFilter, /No matching saved records/); assert.match(offFilter, /Recorded research recommendation: NEEDS_MORE_EVIDENCE/);
  const wrong = researchMarkup("records", { searchParams: { selected: id(10), business: id(2) } });
  assert.match(wrong, /Your Business filter has been kept/); assert.doesNotMatch(wrong, /data-selected-research=/);
});
test("selected Business scopes exact onward links without narrowing an aggregate list", () => {
  const markup = researchMarkup("records", { searchParams: { selected: id(10) }, props: { researchHref: `/dashboard?view=research&business=${id(1)}&sheet=research` } });
  assert.match(markup, /1–25 of 127 saved raw records/); assert.match(markup, /Plan research/);
  const work = links(markup).filter(url => url.searchParams.get("view") === "work");
  assert.ok(work.length >= 2); for (const url of work) { assert.equal(url.searchParams.get("business"), id(1)); assert.equal(url.searchParams.get("selected"), id(11)); }
  const artifact = work.find(url => url.searchParams.has("artifact")); assert.equal(artifact.hash, `#artifact-${id(13)}`); assert.match(markup, /Metadata-only links/);
  const listLinks = links(markup).filter(url => url.hash === "#console-collection-detail" && url.searchParams.get("view") === "research");
  assert.ok(listLinks.every(url => !url.searchParams.has("business")));
  assert.doesNotMatch(researchMarkup(), /Plan research/);
});
test("130associated attempts are independently server-paged and carry explicit root identity", () => {
  const markup = researchMarkup("records", { searchParams: { ...selectedSearch, attemptPage: "6", attemptSort: "oldest" } });
  assert.equal((markup.match(/data-associated-attempt="true"/g) ?? []).length, 5); assert.match(markup, /126–130 of 130 associated raw records · 5 loaded/); assert.match(markup, /Page 6 of 6/);
  assert.match(markup, /including the original/); assert.match(markup, /Association does not certify a group/);
  const attemptLinks = links(markup).filter(url => url.searchParams.has("attemptPage") && url.searchParams.get("root") === id(10));
  assert.ok(attemptLinks.length >= 4); for (const url of attemptLinks) { assert.equal(url.searchParams.get("page"), "3"); assert.equal(url.searchParams.get("q"), "Duplicate"); }
  const attemptSelection = attemptLinks.find(url => url.searchParams.get("selected") === associatedAttempts[129].id); assert.ok(attemptSelection); assert.equal(attemptSelection.searchParams.get("attemptPage"), "6");
});
test("missing/unavailable/invalid newest context does not substitute an older record", () => {
  for (const status of ["missing", "unavailable"]) {
    const fixture = researchFixture("records", { searchParams: { selected: id(10) } });
    const markup = researchMarkup("records", { searchParams: { selected: id(10) }, data: { attempts: { ...fixture.data.attempts, newestContext: { status, item: null } } } });
    assert.match(markup, /Newest associated saved record/); assert.match(markup, /No older record was substituted/); assert.doesNotMatch(markup, /Exact newest job context:/);
  }
  const fixture = researchFixture("records", { searchParams: { selected: id(10) } });
  const invalid = researchMarkup("records", { searchParams: { selected: id(10) }, data: { attempts: { ...fixture.data.attempts, newestContext: { status: "found", item: researchHistorical(0) } } } });
  assert.match(invalid, /Newest record context could not be checked/); assert.doesNotMatch(invalid, /Exact newest job context:/);
});

test("list and attempt statuses stay explicitly saved; ended nonterminal and receipt-free reserved rows cannot look active", () => {
  const variants = [
    { ...researchRecords[0], id: id(70001), status: "researching", completed_at: "2024-01-02T00:00:00.000Z" },
    { ...researchRecords[0], id: id(70002), status: "reserved", completed_at: null },
    { ...researchRecords[0], id: id(70003), status: "future_nonempty_state", completed_at: null },
  ];
  const list = researchMarkup("records", { page: { items: variants, total: 3, hasNext: false } });
  const fixture = researchFixture("records", { searchParams: { selected: id(10) } });
  const attempts = { ...fixture.data.attempts, page: { ...fixture.data.attempts.page, items: variants, total: 3, hasNext: false }, newest: { status: "found", item: variants[0] }, newestContext: { status: "unavailable", item: null } };
  const detail = researchMarkup("records", { searchParams: { selected: id(10) }, data: { attempts } });
  for (const markup of [list, detail]) {
    const row = recordId => markup.match(new RegExp(`<li[^>]*data-research-record="${recordId}"[\\s\\S]*?</li>`))[0];
    for (const variant of variants) { assert.match(row(variant.id), /Saved record state/); assert.doesNotMatch(row(variant.id), /data-tone="active"/); }
    const ended = row(id(70001)); assert.match(ended, /Ended inconsistent/); assert.match(ended, /End recorded; saved state: researching · inconsistent/); assert.doesNotMatch(ended, />Researching<|>Saved researching</);
    const reserved = row(id(70002)); assert.match(reserved, /Saved reserved/); assert.match(reserved, /Execution not established here/);
    assert.match(row(id(70003)), /Saved state: future_nonempty_state/);
  }
});

test("stale verified outputs stay readable with exact dates and distinct saved review state", () => {
  const markup = researchMarkup("records", { searchParams: { selected: id(10) } });
  assert.match(markup, /Recorded research recommendation: NEEDS_MORE_EVIDENCE/); assert.match(markup, /Stale saved evidence/); assert.match(markup, /Completed historical review/);
  assert.match(markup, /2024-01-02 00:00:00.000 UTC/); assert.match(markup, /Validated saved dossier/); assert.match(markup, /Validated saved strategy/); assert.match(markup, /Validated saved independent review/); assert.match(markup, /Validated source spans/);
  assert.match(markup, /does not qualify a product, authorize launch or establish available money/); assert.match(markup, /Saved timing does not validate live providers/);
  const within = researchHistoryInput(); within.observedAt = "2024-01-01T02:00:00Z";
  assert.match(researchMarkup("records", { searchParams: { selected: id(10) }, evidence: researchEvidence(0, { historyInput: within }) }), /Within the saved timing window/);
});

test("saved TEST remains a recorded research recommendation with no product or launch authority", () => {
  const input = researchHistoryInput(); input.strategy.artifact.content.recommendation.proposedOutcome = "TEST"; input.review.artifact.content.outcome = "TEST"; rebind(input);
  const evidence = researchEvidence(0, { historyInput: input }); assert.equal(evidence.history.integrity, "verified");
  const markup = researchMarkup("records", { searchParams: { selected: id(10) }, evidence });
  assert.match(markup, /Recorded research recommendation: TEST/); assert.match(markup, /does not qualify a product, authorize launch or establish available money/);
  assert.doesNotMatch(markup, /ProductTEST PASS|Product qualified|Available funds|Launch approved/);
});

test("partial, malformed, missing and unavailable evidence remain distinct without empty-success or zero cost", () => {
  const partial = researchHistoryInput(); partial.experiment.status = "failed"; partial.workflow.status = "failed"; partial.evidenceRecords[0].workflow.status = "failed";
  const partialEvidence = researchEvidence(0, { historyInput: partial });
  const markup = researchMarkup("records", { searchParams: { selected: id(10) }, evidence: partialEvidence });
  assert.match(markup, /Content integrity: partial/); assert.match(markup, /Saved review output; whole-result completion not established/); assert.match(markup, /Validated saved dossier/);
  for (const integrity of ["missing", "malformed", "mismatched", "unavailable", "partial"]) {
    const output = researchMarkup("records", { searchParams: { selected: id(10) }, evidence: researchEvidence(0, { history: null, integrity }) });
    assert.match(output, /Research recommendation not established/); assert.doesNotMatch(output, /Completed historical review|\$0|zero.cost|successful research/);
    assert.match(output, new RegExp(integrity === "unavailable" ? "could not be read" : integrity === "mismatched" ? "conflicts" : integrity));
  }
  assert.match(researchMarkup("records", { searchParams: { selected: id(10) }, evidence: null }), /Saved evidence was not loaded/);
});

test("retained review objects never elevate malformed/mismatched/partial/unavailable outer results to completed recommendations", () => {
  for (const integrity of ["partial", "malformed", "mismatched", "unavailable"]) {
    const evidence = researchEvidence(0, { integrity });
    const markup = researchMarkup("records", { searchParams: { selected: id(10) }, evidence });
    assert.match(markup, /Retained research review output: NEEDS_MORE_EVIDENCE/);
    assert.match(markup, new RegExp(`Evidence read integrity: ${integrity}`));
    assert.doesNotMatch(markup, /Recorded research recommendation:|Completed historical review/);
    assert.match(markup, /whole-result completion not established/);
  }
  for (const integrity of ["malformed", "mismatched", "partial"]) {
    const evidence = researchEvidence(0); evidence.history.integrity = integrity;
    const markup = researchMarkup("records", { searchParams: { selected: id(10) }, evidence });
    assert.match(markup, /Retained research review output:/); assert.doesNotMatch(markup, /Completed historical review|Recorded research recommendation:/);
  }
});

test("foreign selected metadata, foreign evidence and foreign artifact links are suppressed", () => {
  const foreign = researchHistorical(0, { business_id: id(999) });
  assert.doesNotMatch(researchMarkup("records", { searchParams: { selected: id(10) }, data: { selection: { status: "found", item: foreign } } }), /data-selected-research=/);
  const foreignEvidence = researchEvidence(0); foreignEvidence.selection.item.business_id = id(2);
  const markup = researchMarkup("records", { searchParams: { selected: id(10) }, evidence: foreignEvidence });
  assert.match(markup, /Saved evidence identity mismatch/); assert.doesNotMatch(markup, /Validated saved dossier|Validated source spans|Inspect saved dossier artifact/);
  const badArtifact = researchEvidence(0); badArtifact.artifacts.push({ role: "source", businessId: id(2), workflowRunId: id(900), artifactId: id(901), verification: "metadata_only" });
  assert.doesNotMatch(researchMarkup("records", { searchParams: { selected: id(10) }, evidence: badArtifact }), /artifact-95000000-0000-4000-8000-000000000901/);
  const foreignHistory = researchEvidence(0); foreignHistory.history.intent.businessId = id(2);
  assert.match(researchMarkup("records", { searchParams: { selected: id(10) }, evidence: foreignHistory }), /Saved evidence identity mismatch/);
});
test("legacy/candidate/follow-up/orphan raw records remain inspectable with known versus unknown saved states", () => {
  assert.equal(researchBusinesses.length, 2);
  const all = researchMarkup("records", { searchParams: { sort: "oldest" } });
  for (const label of ["Starting round", "Follow-up record", "Candidate record", "Legacy record", "Unverified record"]) assert.match(all, new RegExp(label));
  assert.match(all, /Future unknown state|future_unknown_state/); assert.match(all, /Saved state:/);
  const legacy = researchMarkup("records", { searchParams: { selected: researchRecords[3].id } });
  assert.match(legacy, /Legacy saved record/); assert.match(legacy, /legacy record remains inspectable as metadata/); assert.doesNotMatch(legacy, /Validated saved dossier/);
  assert.match(all, new RegExp(researchLongName.slice(0, 35))); assert.match(legacy, /Full saved objective &amp; identity/);
});
test("literal markup in validated text is escaped and source URLs come only from supplied validated history", () => {
  const input = researchHistoryInput(), literal = "<script>alert('never run')</script> [unsafe](javascript:bad) **plain text**";
  input.experiment.intent.objective += ` ${literal}`; input.review.artifact.content.sufficiencyRationale += ` ${literal}`;
  const pack = input.evidenceRecords[0].artifact.content.evidencePack, source = pack.sources[0], quote = `Saved literal source observation ${literal}`;
  source.title = literal; source.excerpt = quote; source.contentHash = textHash(quote); source.id = `src-${textHash(`${source.url}:${source.contentHash}`).slice(0, 24)}`;
  const savedEvidence = pack.evidence[0]; savedEvidence.sourceId = source.id; savedEvidence.quote = quote; savedEvidence.id = `evi-${textHash(`${source.id}:${quote}`).slice(0, 24)}`;
  pack.claims[0] = { text: quote, sourceId: source.id, evidenceId: savedEvidence.id }; input.evidenceRecords[0].source.content.sources[0] = structuredClone(source);
  const reference = input.strategy.artifact.content.candidates[0].dimensions[0].facts[0].reference;
  Object.assign(reference, { sourceId: source.id, evidenceId: savedEvidence.id, sourceContentHash: source.contentHash, start: 0, end: Array.from(quote).length });
  rebindEvidence(input); rebind(input);
  const evidence = researchEvidence(0, { historyInput: input }); assert.equal(evidence.history.integrity, "verified");
  const markup = researchMarkup("records", { searchParams: { selected: id(10) }, evidence });
  assert.match(markup, /&lt;script&gt;/); assert.match(markup, /\*\*plain text\*\*/); assert.doesNotMatch(markup, /<script>|href="javascript:|<strong>plain text/);
  const sourceLinks = links(markup).filter(url => url.protocol === "https:" && url.hostname !== "fixture.test"); assert.ok(sourceLinks.length); assert.ok(sourceLinks.every(url => url.hostname === "www.etsy.com"));
});
test("oversized, missing and failed pages never client-slice or fabricate emptiness", () => {
  const oversize = researchMarkup("records", { page: { items: researchRecords.slice(0, 26) } }); assert.match(oversize, /exceeds the fixed 25-record/); assert.doesNotMatch(oversize, /data-research-record=/);
  const wrongSize = researchMarkup("records", { page: { pageSize: 10 } }); assert.match(wrongSize, /fixed 25-record/);
  const failed = researchMarkup("records", { page: { items: [], total: null, complete: false, errors: ["Failed read"] } }); assert.match(failed, /Saved records unavailable/); assert.doesNotMatch(failed, /No matching saved records/);
  const empty = researchMarkup("records", { page: { items: [], total: 0, hasNext: false } }); assert.match(empty, /No matching saved records/);
});
test("Research hrefs preserve exact raw scope and reject unsupported navigation", () => {
  const current = new URLSearchParams({ view: "research", type: "records", page: "3", q: "Duplicate", searchField: "hypothesis" });
  const selected = new URL(researchQuery.consoleResearchHref(current, { selected: id(10) }), "https://fixture.test"); assert.equal(selected.searchParams.get("page"), "3"); assert.equal(selected.searchParams.get("q"), "Duplicate");
  assert.throws(() => researchQuery.consoleResearchHref(current, { status: "completed" }));
});

test("progressive evidence slot explicitly replaces direct evidence without replacing metadata, attempts or filters", () => {
  const searchParams = { ...selectedSearch, attemptPage: "2" }, fixture = researchFixture("records", { searchParams });
  const loading = React.createElement("section", { "data-test-evidence-loading": fixture.data.selection.item.id, "aria-busy": true }, "Exact saved evidence is not ready");
  const waiting = researchMarkup("records", { searchParams, evidence: null, props: { evidenceContent: loading } });
  assert.equal((waiting.match(/Exact saved evidence is not ready/g) ?? []).length, 1);
  assert.doesNotMatch(waiting, /Saved evidence was not loaded|Research recommendation not established|Evidence read integrity: not loaded/);
  assert.match(waiting, /Full saved objective &amp; identity/); assert.match(waiting, /Associated saved attempts/); assert.match(waiting, /Read-only scope &amp; known limits/); assert.match(waiting, /26–50 of 130 associated raw records/);
  assert.equal((waiting.match(/data-research-record=/g) ?? []).length, 50);
  const ready = React.createElement(researchPane.ConsoleResearchEvidenceContent, { record: fixture.data.selection.item, evidence: fixture.props.evidence });
  const resolved = researchMarkup("records", { searchParams, evidence: null, props: { evidenceContent: ready } });
  assert.equal((resolved.match(/Recorded research recommendation:/g) ?? []).length, 1); assert.doesNotMatch(resolved, /Exact saved evidence is not ready|Saved evidence was not loaded/);
  const metadataSuffix = markup => markup.slice(markup.indexOf('<div class="consoleResearchSelectedContext"'));
  assert.equal(metadataSuffix(waiting), metadataSuffix(resolved), "metadata/identity/attempts/Close/pagers remain identical outside evidence");
  assert.equal(resolved, researchMarkup("records", { searchParams }), "resolved export preserves the default direct-evidence result");
  const explicitlyEmpty = researchMarkup("records", { searchParams, evidence: null, props: { evidenceContent: null } });
  assert.doesNotMatch(explicitlyEmpty, /Evidence read integrity|Saved evidence was not loaded/); assert.match(explicitlyEmpty, /Full saved objective/);
});
test("standalone progressive evidence export retains exact guards and contains no list/attempt metadata", () => {
  const record = researchHistorical(0), evidence = researchEvidence(0);
  const rendered = renderToStaticMarkup(React.createElement(researchPane.ConsoleResearchEvidenceContent, { record, evidence }));
  assert.match(rendered, /Recorded research recommendation:/); assert.match(rendered, /Validated saved dossier/); assert.match(rendered, /Inspect saved dossier artifact/);
  assert.doesNotMatch(rendered, /Full saved objective &amp; identity|Associated saved attempts|Research filters|data-research-record=/);
  evidence.selection.item.business_id = id(2);
  const foreign = renderToStaticMarkup(React.createElement(researchPane.ConsoleResearchEvidenceContent, { record, evidence }));
  assert.match(foreign, /Saved evidence identity mismatch/); assert.doesNotMatch(foreign, /Validated saved dossier|Inspect saved dossier artifact/);
});
test("detail and attempt reveal markers are exact guarded identities; attempt controls target only validated root anchors", () => {
  const markup = researchMarkup("records", { searchParams: { selected: id(10), attemptPage: "2" } });
  assert.match(markup, new RegExp(`data-console-research-record="${id(10)}" data-console-research-business="${id(1)}"`));
  assert.match(markup, new RegExp(`id="console-research-attempts-${id(10)}" data-console-research-business="${id(1)}" data-console-research-attempt-root="${id(10)}"`));
  for (const key of ["identity", "limits", "goal", "dossier", "strategy", "review", "spans"]) assert.match(markup, new RegExp(`data-console-disclosure="research:${key}:${id(10)}"`));
  const attemptNavigation = links(markup).filter(url => url.hash.startsWith("#console-research-attempts-"));
  assert.ok(attemptNavigation.length >= 4); assert.ok(attemptNavigation.every(url => url.hash === `#console-research-attempts-${id(10)}` && url.searchParams.get("root") === id(10)));
  const missing = researchMarkup("records", { searchParams: { selected: id(10), business: id(2) } }); assert.doesNotMatch(missing, /data-console-research-record=|data-console-research-attempt-root=/);
  const fixture = researchFixture("records", { searchParams: { selected: id(10) } });
  const invalid = researchMarkup("records", { searchParams: { selected: id(10) }, data: { attempts: { ...fixture.data.attempts, businessId: id(2) } } });
  assert.match(invalid, /Associated attempt identity mismatch/); assert.doesNotMatch(invalid, /data-console-research-attempt-root=|#console-research-attempts-/);
});


test("pane body selectors cannot target the shared research setup sheet body", () => {
  const css = readFileSync("src/components/console/console-research-pane.css", "utf8");
  const bodySelectors = [...css.matchAll(/([^{}]+)\{/g)].flatMap(match => match[1].split(",")).filter(selector => selector.includes(".consoleResearchBody"));
  assert.ok(bodySelectors.length >= 5);
  for (const selector of bodySelectors) assert.match(selector.trim(), /^\.consoleResearchPane\s*>\s*\.consoleResearchBody(?:\[|\s|$)/);
  assert.match(css, /\.consoleResearchPane > \.consoleResearchBody\{max-height:none;padding:2px;gap:7px\}/);
  assert.doesNotMatch(css, /consoleResearchSheet|(^|[{},])\s*\.consoleResearchBody(?:\{|\[|\s)/);
});

test("presentation stays read-only, source-rendered, compact and reflowable with44px controls", () => {
  const source = readFileSync("src/components/console/console-research-pane.tsx", "utf8"), css = readFileSync("src/components/console/console-research-pane.css", "utf8");
  assert.doesNotMatch(source, /["']use client["']|useState|useEffect|fetch\(|(?:items|records)\.slice\(|formAction|dangerouslySetInnerHTML|\.rpc\(|\.insert\(|\.update\(|supabase[^;]*\.delete\(|quote.*from|provider.*from|discovery-actions/);
  assert.match(source, /import type[\s\S]*console-research-evidence/); assert.match(source, /ConsoleCollectionBadge/); assert.match(source, /consoleCollectionCount/);
  const markup = researchMarkup("records", { searchParams: { selected: id(10) } }); assert.equal((markup.match(/<form/g) ?? []).length, 1); assert.doesNotMatch(markup, /method="post"|>Approve|>Retry|>Fund|>Quote/);
  assert.match(css, /min-height:44px/); assert.match(css, /min-width:1200px/); assert.match(css, /max-width:900px/); assert.match(css, /max-width:600px/); assert.match(css, /grid-template-rows:minmax\(0,1fr\)/); assert.match(css, /overflow:auto/); assert.match(css, /overflow-wrap:anywhere/); assert.match(css, /position:sticky/);
});


test("failed experiment metadata does not assert an executed workflow failed", () => {
  const record = { ...researchHistorical(0), status: "failed", workflow: { status: "unavailable", item: null }, workIdentity: null };
  const markup = renderToStaticMarkup(React.createElement(researchPane.ConsoleResearchEvidenceContent, { record, evidence: null }));
  assert.match(markup, /Saved research record failed/);
  assert.doesNotMatch(markup, /research job failed|workflow failed/);
});


test("selected objective, Business discriminator and saved state precede progressive evidence", () => {
  const fixture = researchFixture("records", { searchParams: selectedSearch });
  const record = fixture.data.selection.item;
  const loading = React.createElement("section", { "data-test-evidence-loading": record.id }, "Loading selected evidence");
  const markup = researchMarkup("records", { searchParams: selectedSearch, evidence: null, props: { evidenceContent: loading } });
  const detail = markup.slice(markup.indexOf(`<article data-selected-research="${record.id}"`));
  const beforeEvidence = detail.slice(0, detail.indexOf('data-test-evidence-loading'));
  assert.match(beforeEvidence, /consoleResearchSelectedObjective/);
  assert.match(beforeEvidence, /consoleResearchBusinessIdentity/);
  assert.match(beforeEvidence, /Record /);
  assert.match(beforeEvidence, /Saved record state/);
  assert.match(beforeEvidence, /Last saved job:|Last job context unavailable/);
  assert.ok(beforeEvidence.indexOf('consoleResearchBusinessIdentity') < beforeEvidence.indexOf('consoleResearchBusinessName'));
  const css = readFileSync(new URL('../src/components/console/console-research-pane.css', import.meta.url), 'utf8');
  assert.match(css, /\.consoleResearchBusinessIdentity\{[^}]*flex:0 0 auto/);
  assert.match(css, /\.consoleResearchSelectedObjective\{[^}]*-webkit-line-clamp:2/);
});

test("same-Business evidence read cannot reintroduce a rejected primary Research Work binding", () => {
  const record = researchHistorical(0, { historicalBinding: "unverified", workIdentity: null, workflow: { status: "unavailable", item: null } });
  const evidence = researchEvidence(0);
  assert.ok(evidence.workIdentity);
  const markup = researchMarkup("records", { searchParams: { selected: id(10) }, data: { selection: { status: "found", item: record } }, evidence });
  assert.match(markup, /Last job context unavailable/);
  assert.match(markup, /Exact Work linkage unavailable/);
  assert.doesNotMatch(markup, /Inspect exact Work run/);
  assert.match(markup, /Metadata-only links establish the saved target/);
});
