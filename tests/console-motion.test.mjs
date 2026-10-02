import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadSource, business, run, stages, workflowCollection } from "./helpers/guided-ui.mjs";

const motion = loadSource("src/lib/core-ui/console-motion.ts", { "./workflows": loadSource("src/lib/core-ui/workflows.ts") });
const { deriveConsoleMotionSnapshot: derive, advanceConsoleMotion: advance, consoleMotionPresentation: present, consoleMotionPhaseDelay: delay } = motion;
const base = Date.parse("2026-10-02T03:00:00Z");
const iso = offset => new Date(base + offset).toISOString();
const options = offset => ({ businessIds: [business.id], observedAt: base + offset });
const runningRun = { ...run, status: "running", started_at: iso(1000), current_stage_key: "work", updated_at: iso(1000) };
const stage = { ...stages[1], id: "motion-stage", stage_key: "work", status: "running", started_at: iso(1000), completed_at: null, updated_at: iso(1000) };
const task = { id: "motion-task", workflow_run_id: run.id, business_id: business.id, worker_definition_id: "motion-worker-definition", workflow_stage_run_id: stage.id, status: "running" };
const worker = { id: "motion-worker", workflow_run_id: run.id, business_id: business.id, task_contract_id: task.id, worker_definition_id: task.worker_definition_id, status: "running", started_at: iso(1000), completed_at: null, updated_at: iso(1000) };
const output = { id: "motion-output", business_id: business.id, workflow_run_id: run.id, created_at: iso(2000), updated_at: iso(2000) };
const decision = { id: "motion-decision", business_id: business.id, workflow_run_id: run.id, status: "open", requested_at: iso(2000), resolved_at: null, updated_at: iso(2000) };
const collection = overrides => workflowCollection({ runs: [runningRun], stages: [stage], tasks: [task], workerRuns: [worker], interventions: [], ...overrides });
const empty = offset => derive(collection({ runs: [], stages: [], tasks: [], workerRuns: [] }), options(offset));
const active = (offset = 1500, overrides = {}) => derive(collection(overrides), options(offset));
const baseline = () => advance(null, empty(0), 0);

test("first observation never celebrates historical starts, completions, outputs or decisions", () => {
  const first = advance(null, active(3000, { artifacts: [output], interventions: [decision] }), 1);
  assert.equal(first.pulses.size, 0);
  assert.equal(present(first, "core", "", 1).state, "running");
  assert.equal(present(first, "decision", decision.id, 1).state, "attention");
});

test("a newly persisted accepted start earns a single activation; idle/subscription-only does not", () => {
  const idle = baseline();
  assert.equal(present(idle, "core", "", 0).state, "idle");
  const started = advance(idle, active(), 10);
  assert.equal(present(started, "run", run.id, 10).pulse.kind, "activation");
  assert.equal(present(started, "core", "", 10).pulse.kind, "activation");
  assert.equal(present(started, "stage", stage.id, 10).state, "running");
  assert.equal(present(started, "worker", worker.id, 10).state, "running");
});

test("queue reservation or missing started_at never claims accepted execution", () => {
  for (const record of [{ ...runningRun, status: "queued", started_at: null }, { ...runningRun, started_at: null }]) {
    const ledger = advance(baseline(), active(1500, { runs: [record] }), 10);
    assert.equal(ledger.pulses.size, 0);
    assert.equal(present(ledger, "core", "", 10).state, "idle");
    assert.equal(present(ledger, "stage", stage.id, 10).state, "idle");
  }
});

test("known queued receipt transitions to accepted running exactly once", () => {
  const queued = active(0, { runs: [{ ...runningRun, status: "queued", started_at: null, updated_at: iso(0) }] });
  const started = advance(advance(null, queued, 0), active(), 20);
  assert.equal(present(started, "run", run.id, 20).pulse.kind, "activation");
  const polled = advance(started, active(1800), 30);
  assert.equal(present(polled, "run", run.id, 30).pulse.startedAt, 20);
  const expired = advance(polled, active(2000), 1000);
  assert.equal(expired.pulses.size, 0);
});

test("a pause/resume is not another launch activation", () => {
  let ledger = advance(null, active(), 0);
  ledger = advance(ledger, active(2500, { runs: [{ ...runningRun, status: "needs_owner", updated_at: iso(2000) }] }), 10);
  ledger = advance(ledger, active(3500, { runs: [{ ...runningRun, updated_at: iso(3000) }] }), 20);
  assert.equal(ledger.pulses.size, 0);
});

test("worker and stage pulses require exact current persisted relationships", () => {
  const cases = [
    { tasks: [{ ...task, business_id: "other" }] },
    { tasks: [{ ...task, workflow_stage_run_id: "other" }] },
    { tasks: [{ ...task, status: "completed" }] },
    { workerRuns: [{ ...worker, worker_definition_id: "other" }] },
    { workerRuns: [{ ...worker, completed_at: iso(1200) }] },
    { workerRuns: [{ ...worker, started_at: "invalid" }] },
    { stages: [{ ...stage, completed_at: iso(1200) }] },
    { stages: [{ ...stage, stage_key: "old-stage" }] },
    { stages: [stage, { ...stage, id: "retry-stage", attempt: stage.attempt + 1, status: "pending" }] },
  ];
  for (const overrides of cases) {
    const ledger = advance(null, active(1500, overrides), 0);
    assert.notEqual(present(ledger, "worker", worker.id, 0).state, "running", JSON.stringify(overrides));
    assert.equal(present(ledger, "core", "", 0).state, "idle", JSON.stringify(overrides));
  }
});

test("completed, failed, stopped, cancelled and owner-waiting runs stop stale worker/stage motion", () => {
  for (const status of ["completed", "failed", "cancelled", "stopped", "needs_owner", "waiting", "queued"]) {
    for (const completed_at of [null, iso(2000)]) {
      const ledger = advance(null, active(2500, { runs: [{ ...runningRun, status, completed_at }] }), 0);
      assert.notEqual(present(ledger, "stage", stage.id, 0).state, "running", status);
      assert.notEqual(present(ledger, "worker", worker.id, 0).state, "running", status);
      assert.equal(present(ledger, "core", "", 0).state, "idle", status);
    }
  }
});

test("cross-Business records and orphan outputs/decisions never earn motion", () => {
  const snapshot = active(2500, { artifacts: [output, { ...output, id: "other-output", business_id: "other" }], interventions: [{ ...decision, workflow_run_id: "other" }], workerRuns: [{ ...worker, business_id: "other" }] });
  assert.equal(snapshot.entities.filter(entity => entity.target === "output").length, 1);
  assert.equal(snapshot.entities.filter(entity => entity.target === "decision" || entity.target === "worker").length, 0);
});

test("fresh saved output and owner decision cue once, with amber attention retained", () => {
  let ledger = advance(null, active(), 0);
  ledger = advance(ledger, active(2500, { artifacts: [output], interventions: [decision] }), 20);
  assert.equal(present(ledger, "output", output.id, 20).pulse.kind, "saved");
  assert.equal(present(ledger, "decision", decision.id, 20).pulse.kind, "decision");
  ledger = advance(ledger, active(3500, { artifacts: [{ ...output, updated_at: iso(3000) }], interventions: [decision] }), 2000);
  assert.equal(ledger.pulses.size, 0);
  assert.equal(present(ledger, "decision", decision.id, 2000).state, "attention");
  assert.equal(present(ledger, "output", output.id, 2000).state, "saved");
});

test("newly visible historical records never look newly saved or newly started", () => {
  const ledger = advance(advance(null, empty(5000), 0), active(6000, { artifacts: [output], interventions: [decision] }), 10);
  assert.equal(ledger.pulses.size, 0);
});

test("completion settles only with persisted completed status and timestamp", () => {
  const completed = { ...stage, status: "completed", completed_at: iso(2000), updated_at: iso(2000) };
  const ledger = advance(advance(null, active(), 0), active(2500, { stages: [completed] }), 10);
  assert.equal(present(ledger, "stage", stage.id, 10).state, "completed");
  assert.equal(present(ledger, "stage", stage.id, 10).pulse.kind, "completion");
  for (const completed_at of [null, "invalid"]) {
    const unknown = advance(advance(null, active(), 0), active(2500, { stages: [{ ...completed, completed_at }] }), 10);
    assert.equal(present(unknown, "stage", stage.id, 10).pulse, null);
  }
});

test("polling, disappearance/reappearance and unchanged updates cannot replay saved-output motion", () => {
  let ledger = advance(advance(null, active(), 0), active(2500, { artifacts: [output] }), 20);
  const key = present(ledger, "output", output.id, 20).pulse.key;
  ledger = advance(ledger, active(2600, { artifacts: [output] }), 30);
  assert.equal(present(ledger, "output", output.id, 30).pulse.key, key);
  assert.equal(present(ledger, "output", output.id, 30).pulse.startedAt, 20);
  ledger = advance(ledger, active(2700), 40);
  ledger = advance(ledger, active(2800, { artifacts: [output] }), 50);
  assert.equal(present(ledger, "output", output.id, 50).pulse, null);
});

test("unavailable observations cancel all motion; recovery establishes a quiet baseline", () => {
  let ledger = advance(baseline(), active(), 10);
  ledger = advance(ledger, active(2500, { errors: ["read failed"], artifacts: [output] }), 20);
  assert.equal(ledger.pulses.size, 0);
  assert.equal(present(ledger, "core", "", 20).state, "unavailable");
  ledger = advance(ledger, active(3000, { artifacts: [output] }), 30);
  assert.equal(ledger.pulses.size, 0);
  assert.equal(present(ledger, "core", "", 30).state, "running");
});

test("late snapshots and stale record versions never resurrect completed work", () => {
  let ledger = advance(null, active(), 0);
  const done = active(3000, { runs: [{ ...runningRun, status: "completed", completed_at: iso(2000), updated_at: iso(2000) }] });
  ledger = advance(ledger, done, 10);
  for (const stale of [active(2500), active(3500), active(4000, { runs: [{ ...runningRun, updated_at: iso(2000) }] })]) {
    ledger = advance(ledger, stale, 20);
    assert.equal(present(ledger, "run", run.id, 20).state, "completed");
    assert.equal(present(ledger, "core", "", 20).state, "idle");
  }
});

test("reduced-motion CSS preserves color state and removes animation entirely", () => {
  const css = readFileSync(new URL("../src/components/console/console-motion.css", import.meta.url), "utf8");
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /animation: none !important/);
  assert.match(css, /data-console-motion-state="attention"/);
  assert.doesNotMatch(css, /height:|width:|margin:|padding:|left:|top:/);
  assert.equal(delay(1000, 5000), -800);
  assert.equal(delay(5000, 1000), -0);
});


test("a newer worker receipt cannot override newer terminal parent-run evidence", () => {
  let ledger = advance(null, active(), 0);
  ledger = advance(ledger, active(3000, { runs: [{ ...runningRun, status: "failed", completed_at: iso(2000), updated_at: iso(2000) }] }), 10);
  ledger = advance(ledger, active(5000, { workerRuns: [{ ...worker, updated_at: iso(4000) }], stages: [{ ...stage, updated_at: iso(4000) }] }), 20);
  assert.equal(present(ledger, "run", run.id, 20).state, "failed");
  assert.equal(present(ledger, "core", "", 20).state, "idle");
  assert.notEqual(present(ledger, "stage", stage.id, 20).state, "running");
});

const dom = loadSource("src/lib/core-ui/console-motion-dom.ts", { "./console-motion": motion });
function fakeDom() {
  let time = 0;
  let timerId = 0;
  const timers = new Map();
  const listeners = new Map();
  const document = { visibilityState: "visible", defaultView: {
    setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
  }, addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) };
  const root = { ownerDocument: document, querySelectorAll: () => elements };
  const elements = ["core", "run", "stage", "worker", "output", "decision"].map(target => ({
    dataset: { consoleMotionTarget: target, consoleMotionId: ({ run: run.id, stage: stage.id, worker: worker.id, output: output.id, decision: decision.id })[target] ?? "" },
    properties: new Map(),
    style: { setProperty(key, value) { this.owner.properties.set(key, value); }, removeProperty(key) { this.owner.properties.delete(key); } },
    closest: () => root,
    removeAttribute(name) { delete this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())]; },
  }));
  for (const element of elements) element.style.owner = element;
  return { root, elements, document, timers, listeners, now: () => time, tick: next => { time = next; for (const callback of [...timers.values()]) callback(); } };
}

test("DOM adapter preserves animation phase and event identity across identical polls", () => {
  const fixture = fakeDom();
  const mounted = dom.mountConsoleMotion(fixture.root, { now: fixture.now });
  mounted.observe(empty(0));
  fixture.tick(10);
  mounted.observe(active());
  const mark = fixture.elements.find(element => element.dataset.consoleMotionTarget === "run");
  const phase = mark.properties.get("--console-motion-phase");
  const event = mark.dataset.consoleMotionEvent;
  fixture.tick(30);
  mounted.observe(active(1600));
  assert.equal(mark.properties.get("--console-motion-phase"), phase);
  assert.equal(mark.dataset.consoleMotionEvent, event);
  assert.equal(mark.properties.get("--console-motion-cue-delay"), "0ms");
  fixture.tick(1000);
  assert.equal(mark.dataset.consoleMotionCue, undefined);
  mounted.dispose();
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.listeners.size, 0);
  assert.equal(mark.dataset.consoleMotionState, undefined);
});

test("in-tab remount keeps saved evidence without replaying its cue", () => {
  const fixture = fakeDom();
  let mounted = dom.mountConsoleMotion(fixture.root, { now: fixture.now, identity: "test-owner:remount" });
  mounted.observe(empty(0));
  mounted.observe(active());
  assert.equal(fixture.elements[1].dataset.consoleMotionCue, "activation");
  mounted.dispose();
  mounted = dom.mountConsoleMotion(fixture.root, { now: fixture.now, identity: "test-owner:remount" });
  mounted.observe(active());
  assert.equal(fixture.elements[1].dataset.consoleMotionCue, undefined);
  assert.equal(fixture.elements[1].dataset.consoleMotionState, "running");
  mounted.dispose();
});

test("a genuinely accepted start since the last page observation can activate after navigation", () => {
  const fixture = fakeDom();
  let mounted = dom.mountConsoleMotion(fixture.root, { now: fixture.now, identity: "test-owner:navigate" });
  mounted.observe(empty(0));
  mounted.dispose();
  mounted = dom.mountConsoleMotion(fixture.root, { now: fixture.now, identity: "test-owner:navigate" });
  mounted.observe(active());
  assert.equal(fixture.elements[1].dataset.consoleMotionCue, "activation");
  mounted.dispose();
  mounted = dom.mountConsoleMotion(fixture.root, { now: fixture.now, identity: "other-owner:navigate" });
  mounted.observe(active());
  assert.equal(fixture.elements[1].dataset.consoleMotionCue, undefined);
  mounted.dispose();
});

test("hidden-page cues are discarded and nested boundaries are left alone", () => {
  const fixture = fakeDom();
  const nested = fixture.elements[2];
  nested.closest = () => ({});
  const mounted = dom.mountConsoleMotion(fixture.root, { now: fixture.now });
  mounted.observe(empty(0));
  mounted.observe(active());
  assert.equal(nested.dataset.consoleMotionState, undefined);
  fixture.document.visibilityState = "hidden";
  fixture.listeners.get("visibilitychange")();
  assert.equal(fixture.elements[1].dataset.consoleMotionCue, undefined);
  fixture.document.visibilityState = "visible";
  fixture.listeners.get("visibilitychange")();
  assert.equal(fixture.elements[1].dataset.consoleMotionCue, undefined);
  mounted.observe(active(1800));
  assert.equal(fixture.elements[1].dataset.consoleMotionCue, undefined);
  mounted.dispose();
});
