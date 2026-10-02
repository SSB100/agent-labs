import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToString, renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { business, components, fixtureDocument, fixtureTime, loadSource, ownerContext, renderDashboard, run, workflowCollection } from "./guided-ui.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const id = number => `10000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
export const connectionFixture = {
  origin: "https://agentlabs-connections.test", businessId: id(1), otherBusinessId: id(2), runId: id(3), connectionId: id(4), revision: id(5),
  token: "SYNTHETIC_ONLY_TOKEN_DO_NOT_PERSIST_1",
};
export const connectionContract = loadSource("src/accounts/connection-feedback.ts");
const contracts = loadSource("src/accounts/contracts.ts");
const businesses = [{ ...business, id: id(1), name: "Synthetic North Star Studio" }, { ...business, id: id(2), name: "Second Authorized Studio" }];
const profile = { email: "owner@example.invalid", givenName: "Synthetic", familyName: "Owner", countryCode: "NZ", locale: "en-NZ", revision: id(5) };
export const connectionsStart = `/dashboard?view=connections&business=${id(1)}&connectionRun=${id(3)}&provider=printful`;
export const connectionsReturn = connectionContract.accountReturnHref(id(1), { returnTo: connectionsStart, provider: "printful", runId: id(3) });
export const connectionsSecure = `/dashboard/accounts/secure?business=${id(1)}&run=${id(3)}&returnTo=${encodeURIComponent(connectionsReturn)}`;
export const connectionActionNames = ["saveBusinessAccountProfile", "requestAccountSetup", "approveReviewedAccountSetup", "cancelAccountSetup", "resumeVerifiedAccountSetup", "disconnectBusinessAccount", "startApprovedAccountRegistration", "finishOwnerRegistrationSession", "removeOwnerWebsitePassword", "submitOwnerPrintfulCredential"];

export function connectionsWorkspace(overrides = {}) {
  const disclosure = contracts.buildAccountDisclosure(profile, "printful", "connect");
  const request = { id: id(3), connectionId: id(4), provider: "printful", mode: "connect", status: "owner_handoff", revision: 2,
    disclosure, disclosureHash: contracts.accountDigest(disclosure), approvalExpiresAt: "2026-10-03T03:00:00.000Z", createdAt: fixtureTime, receipt: null };
  return { businessId: id(1), configured: true, vaultConfigured: true, registrationAvailable: false, registrationReason: "Synthetic safe fixture", unavailable: false,
    observedAt: fixtureTime, profile, accounts: [{ id: id(8), provider: "etsy", status: "connected", revision: id(5), label: "Synthetic Etsy Shop", externalAccountId: "fixture-shop", scopes: ["shops_r", "listings_r", "listings_w"], verifiedAt: fixtureTime, expiresAt: "2026-11-01T03:00:00.000Z" }],
    runs: [request, ...Array.from({ length: 12 }, (_, i) => ({ ...request, id: id(20 + i), status: i % 2 ? "cancelled" : "verified", createdAt: `2026-09-${String(20 - i).padStart(2, "0")}T03:00:00.000Z`, receipt: { outcome: i % 2 ? "cancelled" : "connected" } }))],
    healthEvents: Array.from({ length: 18 }, (_, i) => ({ id: id(50 + i), provider: i % 2 ? "etsy" : "printful", eventType: i % 2 ? "connection_verified" : "connection_revoked", occurredAt: `2026-09-${String(28 - i).padStart(2, "0")}T03:00:00.000Z` })), ...overrides };
}

// Hydrate actual client boundaries inside actual server page output. Server
// children are evaluated into their real DOM tree, never replaced by mock forms.
function islandHarness() {
  const islands = [], actions = {}, actionNames = new Map();
  for (const name of connectionActionNames) {
    actions[name] = async () => { throw new Error("Synthetic SSR actions must not execute"); };
    actionNames.set(actions[name], name);
  }
  function encode(value) {
    if (React.isValidElement(value)) {
      if (value.type === React.Fragment) return encode(value.props.children);
      if (typeof value.type === "function") return encode(value.type(value.props));
      assert.equal(typeof value.type, "string", "Only production DOM children cross the hydration island");
      return { __fixtureNode: value.type, key: value.key, props: encode(value.props) };
    }
    if (Array.isArray(value)) return value.map(encode);
    if (typeof value === "function") { assert.ok(actionNames.has(value), "Only explicitly mocked account actions may hydrate"); return { __fixtureAction: actionNames.get(value) }; }
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, encode(child)]));
    return value;
  }
  function decode(value) {
    if (Array.isArray(value)) return value.map(decode);
    if (value?.__fixtureNode) return React.createElement(value.__fixtureNode, { ...decode(value.props), key: value.key });
    if (value?.__fixtureAction) return actions[value.__fixtureAction];
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, decode(child)]));
    return value;
  }
  const navigation = { unstable_rethrow() {}, useRouter: () => ({ push() { throw new Error("SSR navigation forbidden"); } }) };
  const feedback = loadSource("src/app/dashboard/accounts/connection-feedback.tsx", { "next/navigation": navigation, "@/accounts/connection-feedback": connectionContract });
  const secure = loadSource("src/app/dashboard/accounts/secure/secure-form.tsx", { "../actions": actions, "../connection-feedback": feedback, "@/accounts/connection-feedback": connectionContract });
  function wrap(name, Component) {
    return function FixtureClientBoundary(props) {
      const index = islands.length, encoded = encode(props), html = renderToString(React.createElement(Component, decode(encoded)));
      islands.push({ name, props: encoded });
      return React.createElement("div", { "data-connection-island": index, style: { display: "contents" }, dangerouslySetInnerHTML: { __html: html } });
    };
  }
  return { islands, actions, feedback: Object.fromEntries(Object.entries(feedback).map(([name, Component]) => [name, wrap(name, Component)])), secure: { PrintfulSecureForm: wrap("PrintfulSecureForm", secure.PrintfulSecureForm) } };
}

export async function connectionsPage(route, { workspace = connectionsWorkspace() } = {}) {
  const query = Object.fromEntries(new URL(route, connectionFixture.origin).searchParams), harness = islandHarness(), reads = [];
  let markup, tree;
  if (route.startsWith("/dashboard/accounts/secure")) {
    const { shell, consoleShell } = components();
    const { default: Page } = loadSource("src/app/dashboard/accounts/secure/page.tsx", {
      "next/navigation": { notFound() { throw new Error("Fixture record was not found"); } },
      "@/components/stage7/app-shell": shell, "@/components/console/console-shell": consoleShell,
      "@/lib/core-ui/data": { requireOwnerUiContext: async () => ownerContext({ businesses }) },
      "@/accounts/server": { loadAccountWorkspace: async (_context, businessId) => { reads.push(businessId); assert.equal(businessId, workspace.businessId); return workspace; } },
      "@/accounts/contracts": contracts, "@/accounts/connection-feedback": connectionContract,
      "@/accounts/printful": { PRINTFUL_ACCOUNT_LINKS: { tokenManagement: "https://developers.printful.com/tokens" } },
      "../actions": harness.actions, "../connection-feedback": harness.feedback,
      "../account-workspace": { accountMessages: loadSource("src/app/dashboard/accounts/account-workspace.tsx", { "@/accounts/contracts": contracts, "@/accounts/connection-feedback": connectionContract,
        "@/components/stage7/app-shell": shell, "./actions": harness.actions, "./connection-feedback": harness.feedback }).accountMessages },
      "./secure-form": harness.secure, "../accounts.css": {}, "@/components/console/console-panes.css": {},
    });
    markup = renderToStaticMarkup(await Page({ searchParams: Promise.resolve(query) }));
  } else {
    markup = await renderDashboard({ view: "connections", queryOverrides: query, contextOverrides: { businesses },
      records: workflowCollection({ runs: [{ ...run, business_id: workspace.businessId }] }), accountRecords: workspace,
      accountActions: harness.actions, accountComponents: harness.feedback, reads, inspect: value => { tree = value; } });
  }
  function workspaceKey(node) {
    if (Array.isArray(node)) { for (const child of node) { const key = workspaceKey(child); if (key != null) return key; } return null; }
    if (!React.isValidElement(node)) return null;
    if (node.type?.name === "CompactConnectionsWorkspace") return node.type(node.props).key;
    return workspaceKey(node.props.children);
  }
  return { markup, islands: harness.islands, reads, workspaceKey: workspaceKey(tree) };
}

let bundle;
async function hydrationBundle() {
  if (!bundle) bundle = build({ absWorkingDir: root, bundle: true, write: false, format: "iife", platform: "browser", target: "es2022", jsx: "automatic", logLevel: "silent", metafile: true,
    define: { "process.env.NODE_ENV": '"production"' }, loader: { ".css": "empty" },
    stdin: { sourcefile: "console-connections-hydration.tsx", resolveDir: root, loader: "tsx", contents: `
      import React, {useEffect} from "react";
      import {hydrateRoot} from "react-dom/client";
      import {AccountForm, AccountNotice} from "./src/app/dashboard/accounts/connection-feedback";
      import {PrintfulSecureForm} from "./src/app/dashboard/accounts/secure/secure-form";
      import {accountReturnHref} from "./src/accounts/connection-feedback";
      const components = {AccountForm, AccountNotice, PrintfulSecureForm};
      window.__connectionsErrors = [];
      window.__connectionsCalls = [];
      window.__connectionAction = name => async form => {
        const safe = {name, businessId: form.get("businessId"), runId: form.get("runId"), returnTo: form.get("returnTo"), fields: [...form.keys()], submittedChecks: window.__checkSyntheticSubmission?.(form)};
        window.__connectionsCalls.push(safe);
        await new Promise((resolve, reject) => { window.__settleConnectionAction = (outcome, holdNavigation = false) => {
          if (outcome === "network") { reject(new Error("Synthetic lost response")); return; }
          const href = accountReturnHref(safe.businessId, {returnTo: safe.returnTo, runId: safe.runId, provider: "printful", message: outcome, resultId: crypto.randomUUID()});
          sessionStorage.setItem("connections-last-action", JSON.stringify(safe));
          window.__commitConnectionNavigation = () => location.assign(href);
          if (!holdNavigation) window.__commitConnectionNavigation();
          resolve(); setTimeout(() => { window.__connectionsActionResolved = true; }, 0);
        }; });
      };
      function decode(value) {
        if (Array.isArray(value)) return value.map(decode);
        if (value?.__fixtureNode) return React.createElement(value.__fixtureNode, {...decode(value.props), key: value.key});
        if (value?.__fixtureAction) return window.__connectionAction(value.__fixtureAction);
        if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, decode(child)]));
        return value;
      }
      let ready = 0;
      function Ready({children}) { useEffect(() => { if (++ready === window.__connectionsState.length) window.__connectionsHydrated = true; }, []); return children; }
      for (const [index, island] of window.__connectionsState.entries()) {
        const Component = components[island.name];
        hydrateRoot(document.querySelector('[data-connection-island="' + index + '"]'), <Ready><Component {...decode(island.props)}/></Ready>, {
          onRecoverableError: error => window.__connectionsErrors.push(error.message),
        });
      }
      if (!window.__connectionsState.length) window.__connectionsHydrated = true;
    ` }, plugins: [{ name: "connections-deny-server-provider-inputs", setup(builder) {
      builder.onResolve({ filter: /(?:^|\/)actions$/ }, () => ({ path: "actions", namespace: "connections-safe" }));
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "connections-safe" }));
      builder.onLoad({ filter: /.*/, namespace: "connections-safe" }, args => ({ loader: "js", contents: args.path === "navigation"
        ? 'export function unstable_rethrow() {}'
        : connectionActionNames.map(name => `export const ${name} = form => window.__connectionAction(${JSON.stringify(name)})(form);`).join("\n") }));
      builder.onResolve({ filter: /^@\// }, args => {
        assert.equal(args.path, "@/accounts/connection-feedback", `Unexpected account client import: ${args.path}`);
        return { path: path.join(root, "src/accounts/connection-feedback.ts") };
      });
    } }] }).then(result => {
      const allowed = new Set(["src/accounts/connection-feedback.ts", "src/app/dashboard/accounts/connection-feedback.tsx", "src/app/dashboard/accounts/secure/secure-form.tsx"]);
      for (const file of Object.keys(result.metafile.inputs).filter(file => file.startsWith("src/"))) assert.ok(allowed.has(file), `Unexpected server/provider hydration input: ${file}`);
      return result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
    });
  return bundle;
}

const documents = new Map();
export async function connectionsDocument(route, { saved = false, observation = 0 } = {}) {
  const key = JSON.stringify([route, saved, observation]);
  if (!documents.has(key)) documents.set(key, (async () => {
    const workspace = connectionsWorkspace({ observedAt: new Date(Date.parse(fixtureTime) + observation * 60_000).toISOString() });
    if (saved) {
      workspace.accounts.push({ id: connectionFixture.connectionId, provider: "printful", status: "connected", revision: connectionFixture.revision,
        label: "Synthetic Verified Printful Store", externalAccountId: "987", scopes: ["catalog.read"], verifiedAt: fixtureTime, expiresAt: "2026-10-20T12:00:00.000Z", storeKind: "ecommerce_linked" });
      workspace.runs = workspace.runs.map(item => item.id === connectionFixture.runId ? { ...item, status: "verified", receipt: { outcome: "connected" } } : item);
    }
    const fixture = await connectionsPage(route, { workspace }), state = JSON.stringify(fixture.islands).replace(/</g, "\\u003c");
    return fixtureDocument(fixture.markup).replace("</head>", '<link rel="icon" href="data:,"></head>').replace("</body>", `<script>window.__connectionsState=${state};</script><script>${await hydrationBundle()}</script></body>`);
  })());
  return documents.get(key);
}

// The actual legacy Accounts page redirects before its diagnostic/provider reads.
export async function legacyConnectionsRedirect(query, { workspace = connectionsWorkspace() } = {}) {
  const context = ownerContext({ businesses }), reads = [];
  const forbidden = () => { throw new Error("Legacy redirect must not run diagnostics or provider code"); };
  const { shell, icons } = components();
  const { default: Page } = loadSource("src/app/dashboard/accounts/page.tsx", {
    "next/navigation": { notFound() { throw new Error("Fixture record was not found"); }, redirect(href) { const error = new Error("Synthetic redirect"); error.href = href; throw error; } },
    "@/accounts/connection-feedback": connectionContract, "@/accounts/contracts": contracts,
    "@/accounts/server": { loadAccountWorkspace: async (_context, selected) => { assert.equal(selected, workspace.businessId); reads.push(selected); return workspace; } },
    "./account-workspace": { BusinessAccountWorkspace: forbidden, accountMessages: {} }, "./accounts.css": {},
    "@/app/dashboard/browser-actions": { startBrowserPlannerQualification: forbidden, startBrowserQualification: forbidden },
    "@/browser/registry": { BROWSER_PROVIDER_COMPARISON: [], isDefaultBrowserProviderConfigured: forbidden },
    "@/components/stage7/app-shell": shell, "@/components/stage7/icons": icons,
    "@/lib/core-ui/data": { requireOwnerUiContext: async () => context }, "@/lib/core-ui/workflows": { formatDateTime: forbidden },
    "@/models/openrouter": { isOpenRouterConfigured: forbidden },
    "@/lib/supabase/env": { isSupabaseConfigured: forbidden, isWorkflowRuntimeConfigured: forbidden },
  });
  try { await Page({ searchParams: Promise.resolve(query) }); assert.fail("Expected a legacy redirect"); }
  catch (error) { if (!error.href) throw error; return { href: error.href, reads }; }
}
