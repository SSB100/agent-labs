import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { filters, query, businessId, secondBusinessId, id, rendered, fixtureTables } from './helpers/console-decisions.mjs';

const state = query.consoleDecisionQuery({ businessId, selectedId: id(15), page: 3 });
const route = query.consoleDecisionHref(state), origin = 'https://decisions-fixture.invalid';
function fixture({ href = origin + route, business = secondBusinessId, status = 'all' } = {}) {
  const listeners = new Map(), formListeners = new Map(), frames = new Map(), callbacks = [];
  let nextFrame = 0;
  const add = (map, event, callback) => { if (!map.has(event)) map.set(event, new Set()); map.get(event).add(callback); };
  const remove = (map, event, callback) => map.get(event)?.delete(callback);
  const dispatch = (map, event, payload = {}) => { for (const callback of map.get(event) ?? []) callback(payload); };
  const controls = { business: { value: business, options: ['', businessId, secondBusinessId].map(value => ({ value })) }, status: { value: status, options: ['open', 'all', 'resolved', 'declined', 'cancelled'].map(value => ({ value })) } };
  const active = { value: 'Keep my live draft', focus() { throw Error('Focus is forbidden'); } };
  const view = {
    location: { href }, scrollY: 494,
    requestAnimationFrame(callback) { const handle = ++nextFrame; frames.set(handle, callback); callbacks.push(callback); return handle; },
    cancelAnimationFrame(handle) { frames.delete(handle); },
    addEventListener(event, callback) { add(listeners, event, callback); }, removeEventListener(event, callback) { remove(listeners, event, callback); },
    scrollTo() { throw Error('Scroll is forbidden'); }, scrollBy() { throw Error('Scroll is forbidden'); },
  };
  const form = { isConnected: true, ownerDocument: { defaultView: view, activeElement: active, querySelector: () => ({ open: true }) },
    addEventListener(event, callback) { add(formListeners, event, callback); }, removeEventListener(event, callback) { remove(formListeners, event, callback); },
    querySelector(selector) { return controls[/name="(\w+)"/.exec(selector)?.[1]] ?? null; },
    reset() { throw Error('Whole-form reset is forbidden'); }, focus() { throw Error('Focus is forbidden'); }, scrollIntoView() { throw Error('Scroll is forbidden'); },
  };
  return { view, form, controls, active, callbacks, listeners, formListeners,
    flush() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); },
    history(event, payload) { dispatch(listeners, event, payload); },
    edit(name, value) { controls[name].value = value; dispatch(formListeners, 'input'); dispatch(formListeners, 'change'); },
  };
}

test('filter restoration accepts only the exact validated rendered Decisions route', () => {
  assert.equal(filters.decisionFilterRouteMatches(origin + route, route), true);
  assert.equal(filters.decisionFilterRouteMatches(origin + route + '&status=open&sheet=research&message=unknown', route), true);
  for (const suffix of ['&status=bogus', '&status=all', '&business=' + secondBusinessId, '&business=', '&page=0', '&page=4', '&decision=' + id(16), '&view=decisions']) {
    assert.equal(filters.decisionFilterRouteMatches(origin + route + suffix, route), false, suffix);
  }
  for (const href of ['bad', origin + '/dashboard?view=work', origin + '/dashboard/needs-you?view=decisions', origin + '/dashboard?view=decisions&decision=malformed', origin + '/dashboard?view=decisions&page=9007199254740991']) assert.equal(filters.decisionFilterRouteMatches(href, route), false);
});

test('mount and native history reconcile both selects after a frame, without whole-form reset, focus or scrolling', () => {
  const f = fixture(), dispose = filters.bindDecisionFilterRestoration(f.form, state);
  assert.equal(f.controls.status.value, 'all'); f.flush();
  assert.equal(f.controls.business.value, businessId); assert.equal(f.controls.status.value, 'open');
  f.edit('business', secondBusinessId); f.edit('status', 'all');
  f.history('pageshow', { persisted: true }); f.flush();
  assert.equal(f.controls.business.value, businessId); assert.equal(f.controls.status.value, 'open');
  f.edit('status', 'resolved'); f.history('popstate'); f.flush(); assert.equal(f.controls.status.value, 'open');
  assert.equal(f.form.ownerDocument.activeElement, f.active); assert.equal(f.active.value, 'Keep my live draft'); assert.equal(f.view.scrollY, 494);
  dispose(); assert.ok([...f.listeners.values(), ...f.formListeners.values()].every(set => set.size === 0));
});

test('post-hydration filter edits survive a scheduled reset, late first pageshow and unchanged refresh', () => {
  const f = fixture(), dispose = filters.bindDecisionFilterRestoration(f.form, state);
  f.edit('status', 'declined'); f.flush(); assert.equal(f.controls.status.value, 'declined');
  f.history('pageshow', { persisted: false }); f.flush(); assert.equal(f.controls.status.value, 'declined');
  f.history('popstate'); f.edit('business', secondBusinessId); f.edit('status', 'all'); f.flush();
  assert.equal(f.controls.business.value, secondBusinessId); assert.equal(f.controls.status.value, 'all');
  f.flush(); assert.equal(f.controls.status.value, 'all'); dispose();
});

test('a queued old history event cannot reset a new route, even when its filters match', () => {
  const f = fixture(), dispose = filters.bindDecisionFilterRestoration(f.form, state);
  const stale = f.callbacks[0];
  f.view.location.href = origin + query.consoleDecisionHref(state, { selectedId: id(16) });
  stale(); assert.equal(f.controls.status.value, 'all'); assert.equal(f.controls.business.value, secondBusinessId);
  f.history('popstate'); f.flush(); assert.equal(f.controls.status.value, 'all');
  dispose();
  const nextState = query.consoleDecisionQuery({ businessId, selectedId: id(16), page: 3 });
  const nextDispose = filters.bindDecisionFilterRestoration(f.form, nextState); f.flush(); assert.equal(f.controls.status.value, 'open');
  f.controls.status.value = 'cancelled'; stale(); assert.equal(f.controls.status.value, 'cancelled'); nextDispose();
});

test('stale props, detached forms and removed options fail closed', () => {
  const stale = fixture({ href: origin + query.consoleDecisionHref(state, { businessId: secondBusinessId }) });
  filters.bindDecisionFilterRestoration(stale.form, state); stale.flush(); assert.equal(stale.controls.status.value, 'all');
  const detached = fixture(); filters.bindDecisionFilterRestoration(detached.form, state); detached.form.isConnected = false; detached.flush(); assert.equal(detached.controls.status.value, 'all');
  const missing = fixture(); missing.controls.business.options = [{ value: secondBusinessId }]; filters.bindDecisionFilterRestoration(missing.form, state); missing.flush(); assert.equal(missing.controls.business.value, secondBusinessId);
});

test('the native GET form keeps existing fields and primitive-only route reconciliation', async () => {
  const tables = fixtureTables({ count: 1 }), result = await rendered(`/dashboard?view=decisions&business=${businessId}&decision=${tables.owner_interventions[0].id}`, { tables });
  const formTag = result.html.match(/<form[^>]*class="compactDecisionFilters"[^>]*>/)?.[0];
  assert.ok(formTag); assert.match(formTag, /method="get"/);
  assert.match(result.html, /name="view" value="decisions"/); assert.match(result.html, /select name="business"/); assert.match(result.html, /select name="status"/);
  const source = readFileSync('src/components/console/console-decision-filters.tsx', 'utf8');
  assert.match(source, /\[businessId, selectedId, page, status\]/);
  assert.doesNotMatch(source, /\.focus\(|scrollIntoView|scrollBy|scrollTo|setInterval|setTimeout|\.reset\(/);
});
