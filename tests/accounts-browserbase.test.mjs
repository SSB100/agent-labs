import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountBrowserbaseTransport, getAccountBrowserbaseStatus, releaseAccountBrowserbaseSession } from '../.core-tests/accounts/browserbase.js';
const businessId = '10000000-0000-4000-8000-000000000001';
const projectId = '10000000-0000-4000-8000-000000000002';
const sessionId = '10000000-0000-4000-8000-000000000003';
const now = () => Date.parse('2026-10-01T12:00:00Z');
const expiresAt = '2026-10-01T12:15:00.000Z';
const config = { enabled: true, apiKey: 'fake-test-provider-key', projectId, budgetApproved: true, keepAliveEntitled: true };
function fixture(changes = {}) {
  const calls = []; let routeHandler; let connected = true; let saved; let releaseRequested = false;
  const responseData = { id: sessionId, projectId, expiresAt, status: 'RUNNING', keepAlive: true,
    connectUrl: 'wss://connect.us-west-2.browserbase.com/?signingKey=fake-endpoint-secret', ...changes.response };
  const page = { url: () => 'about:blank' };
  const context = { pages: () => [page],
    async newCDPSession() { return { async send(method, params) { calls.push(['cdp',method,params]); }, async detach() { calls.push(['detach']); } }; },
    async route(pattern, handler) { calls.push(['route', pattern]); routeHandler = handler; },
    async unrouteAll(options) { calls.push(['unroute', options]); },
  };
  const browser = { contexts: () => [context], isConnected: () => connected,
    async close() { calls.push(['disconnect']); if (!changes.disconnectFails) connected = false; },
  };
  const dependencies = { config: { ...config, ...changes.config }, now,
    async connect(endpoint) { calls.push(['connect', endpoint]); return browser; },
    async fetcher(url, init) {
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push(['request', String(url), body, init]);
      if (body?.status === 'REQUEST_RELEASE') { releaseRequested = true; return new Response('{}', { status: changes.releaseFailure ? 500 : 200 }); }
      if (String(url).includes('/debug?')) return Response.json({ debuggerFullscreenUrl: changes.viewer ?? 'https://www.browserbase.com/devtools-internal-compiled/index.html?token=fake-viewer-secret' });
      if (init.method === 'GET') return Response.json({ id: sessionId, projectId, status: releaseRequested ? (changes.releaseStillRunning ? 'RUNNING' : 'COMPLETED') : changes.postDisconnectStatus ?? 'RUNNING', keepAlive: true });
      if (changes.createResponse) return changes.createResponse();
      return Response.json(responseData);
    },
  };
  const transport = createAccountBrowserbaseTransport({ businessId, provider: 'etsy', approvalExpiresAt: changes.approvalExpiresAt ?? expiresAt,
    async saveHandoff(value) { calls.push(['save']); assert.equal(connected, false, 'all agent CDP must be disconnected before publishing owner handoff'); if (changes.saveFails) throw new Error('private encryption error'); saved = value; },
  }, dependencies);
  return { transport, calls, dependencies, saved: () => saved, route: () => routeHandler };
}

test('each activation, configuration, budget and entitlement gate prevents external creation', () => {
  for (const patch of [{enabled:false}, {apiKey:''}, {projectId:'bad'}, {budgetApproved:false}, {keepAliveEntitled:false}]) {
    const fake = fixture({config:patch}); assert.equal(fake.transport, null); assert.equal(fake.calls.length,0);
    assert.equal(getAccountBrowserbaseStatus({...config,...patch}).available,false);
  }
});

test('safe Browserbase creation uses fixed non-recording/non-logging settings and no persistent context', async () => {
  const fake = fixture(); const session = await fake.transport.open('etsy');
  const create = fake.calls.find(call => call[0] === 'request');
  assert.equal(create[1], 'https://api.browserbase.com/v1/sessions');
  assert.deepEqual(create[2], { projectId, timeout:900, keepAlive:true, proxies:false,
    browserSettings: {recordSession:false,logSession:false,solveCaptchas:false,ignoreCertificateErrors:false,allowedDomains:['www.etsy.com']} });
  assert.equal(create[3].redirect,'error'); assert.equal(create[3].cache,'no-store');
  assert.equal('context' in create[2].browserSettings, false);
  assert.equal('userMetadata' in create[2], false);
  assert.deepEqual(fake.calls.find(call => call[0] === 'cdp'), ['cdp','Network.setBypassServiceWorker',{bypass:true}]);
  await session.close();
});

test('owner handoff is encrypted by callback only after disconnect and running-session readback', async () => {
  const fake = fixture(); const session = await fake.transport.open('etsy'); const handoff = await session.handoff();
  assert.equal(handoff.expiresAt, expiresAt); assert.equal(handoff.id, fake.saved().handoffId);
  assert.equal(fake.saved().sessionId,sessionId); assert.match(fake.saved().viewerUrl,/fake-viewer-secret/);
  assert.doesNotMatch(JSON.stringify(handoff), /browserbase|fake-viewer-secret|fake-endpoint-secret|sessionId|connectUrl/);
  assert.equal(Object.keys(fake.saved()).sort().join(','), 'expiresAt,handoffId,sessionId,viewerUrl');
  const events = fake.calls.map(call => call[0]);
  assert.ok(events.indexOf('unroute') < events.indexOf('disconnect'));
  assert.ok(events.indexOf('disconnect') < events.indexOf('save'));
  assert.equal(fake.calls.filter(call => call[0] === 'connect').length,1);
  assert.equal(fake.calls.some(call => /replays|recording|logs|screenshot/.test(String(call[1]))),false);
  await assert.rejects(() => session.handoff(), /account_secure_handoff_unconfirmed/);
  await session.close();
});

test('exact provider-origin route denies lookalike redirects and all cross-origin requests after data lock', async () => {
  const fake = fixture(); const session = await fake.transport.open('etsy');
  const check = async (url, navigation) => {
    let decision;
    await fake.route()({request:()=>({url:()=>url,isNavigationRequest:()=>navigation}),abort:async()=>{decision='abort';},continue:async()=>{decision='continue';}});
    return decision;
  };
  assert.equal(await check('https://static.example.net/asset.js',false),'continue');
  assert.equal(await check('https://www.etsy.com.evil.invalid/join',true),'abort');
  await session.restrictToOrigin('https://www.etsy.com');
  assert.equal(await check('https://tracker.example.net/?email=private',false),'abort');
  assert.equal(await check('https://www.etsy.com/api',false),'continue');
  assert.equal(await check('http://www.etsy.com/api',false),'abort');
  await session.close();
});

test('cross-provider or repeated dispatch is rejected before a second paid request', async () => {
  const fake = fixture(); await assert.rejects(() => fake.transport.open('printful'));
  assert.equal(fake.calls.length,0);
  const session = await fake.transport.open('etsy'); await assert.rejects(() => fake.transport.open('etsy'));
  assert.equal(fake.calls.filter(call => call[0] === 'request' && call[2]?.browserSettings).length,1); await session.close();
});

for (const [name, response] of [
  ['project mismatch',{projectId:businessId}], ['keepalive missing',{keepAlive:false}],
  ['existing identity context',{contextId:businessId}], ['untrusted endpoint',{connectUrl:'wss://evil.invalid/?apiKey=secret'}],
  ['lookalike endpoint',{connectUrl:'wss://connect.browserbase.com.evil.invalid/?key=secret'}],
  ['oversized provider duration',{expiresAt:'2026-10-01T13:00:00Z'}],
]) test(`${name} releases new session without visiting signup or exposing provider response`, async () => {
  const fake = fixture({response});
  await assert.rejects(() => fake.transport.open('etsy'), /^Error: account_browserbase_preparation_unconfirmed$/);
  assert.equal(fake.calls.some(call => call[2]?.status === 'REQUEST_RELEASE'),true);
});

test('expired short approval does not create an unbounded minimum-duration paid session', async () => {
  const fake = fixture({approvalExpiresAt:'2026-10-01T12:00:30Z'});
  await assert.rejects(() => fake.transport.open('etsy'), /account_approval_expired/); assert.equal(fake.calls.length,0);
});

test('handoff refuses untrusted viewer, unconfirmed disconnect, stopped session, and failed encrypted persistence', async () => {
  for (const changes of [{viewer:'https://evil.invalid/?token=secret'}, {disconnectFails:true}, {postDisconnectStatus:'COMPLETED'}, {saveFails:true}]) {
    const fake = fixture(changes); const session = await fake.transport.open('etsy');
    await assert.rejects(() => session.handoff());
    assert.equal(fake.saved(),undefined); await session.close();
  }
});

test('release works after activation is off and propagates only a sanitized failure code', async () => {
  const fake = fixture({config:{enabled:false,budgetApproved:false,keepAliveEntitled:false}});
  await releaseAccountBrowserbaseSession(sessionId,fake.dependencies);
  assert.deepEqual(fake.calls[0][2], {status:'REQUEST_RELEASE',projectId});
  const failed = fixture({releaseFailure:true});
  await assert.rejects(() => releaseAccountBrowserbaseSession(sessionId,failed.dependencies), /^Error: account_browserbase_release_unconfirmed$/);
});


test('oversized or redirected provider bodies are rejected without exposing content', async () => {
  for (const createResponse of [
    () => new Response('x'.repeat(70_000), { headers: { 'content-length':'70000' } }),
    () => new Response('x'.repeat(70_000)),
    () => { const response = Response.json({private:'sensitive'}); Object.defineProperty(response,'redirected',{value:true}); return response; },
  ]) {
    const fake = fixture({createResponse});
    await assert.rejects(() => fake.transport.open('etsy'), /^Error: account_browserbase_preparation_unconfirmed$/);
    assert.equal(fake.calls.some(call => call[0] === 'connect'),false);
    assert.equal(fake.calls.filter(call => call[2]?.browserSettings).length,1, 'never blindly retry uncertain creation');
  }
});

test('approval expiration bounds the paid session and handoff, even with a longer configured maximum', async () => {
  const expiration = '2026-10-01T12:05:00.000Z';
  const fake = fixture({approvalExpiresAt:expiration,response:{expiresAt:expiration}});
  const session = await fake.transport.open('etsy');
  assert.equal(fake.calls.find(call => call[2]?.browserSettings)[2].timeout,300);
  const handoff = await session.handoff(); assert.equal(handoff.expiresAt,expiration); await session.close();
});


test('an accepted release with running readback remains unconfirmed', async () => {
 const fake = fixture({releaseStillRunning:true});
 await assert.rejects(() => releaseAccountBrowserbaseSession(sessionId,fake.dependencies), /account_browserbase_release_unconfirmed/);
 assert.equal(fake.calls.filter(c=>c[0]==='request').length,2);
});
