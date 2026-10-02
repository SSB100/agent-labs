import Link from "next/link";
import { notFound } from "next/navigation";
import { ConsoleShell } from "@/components/console/console-shell";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { loadAccountWorkspace } from "@/accounts/server";
import { ACCOUNT_UUID } from "@/accounts/contracts";
import { accountReturnHref, connectionState } from "@/accounts/connection-feedback";
import { PRINTFUL_ACCOUNT_LINKS } from "@/accounts/printful";
import { PrintfulSecureForm } from "./secure-form";
import "@/components/console/console-panes.css";
import "../accounts.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
export default async function SecureAccountPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await requireOwnerUiContext(), query = await searchParams;
  const businessId = first(query.business) ?? "", runId = first(query.run) ?? "";
  if (!ACCOUNT_UUID.test(businessId) || !ACCOUNT_UUID.test(runId) || !context.businesses.some(b => b.id === businessId)) notFound();
  const workspace = await loadAccountWorkspace(context, businessId), run = workspace.runs.find(r => r.id === runId);
  const eligible = !workspace.unavailable && workspace.vaultConfigured && run?.provider === "printful" &&
    run.status === "owner_handoff" && !!run.approvalExpiresAt && Date.parse(run.approvalExpiresAt) > Date.parse(workspace.observedAt);
  const returnTo = accountReturnHref(businessId, { returnTo: first(query.returnTo), runId, provider: "printful" });
  const state = connectionState(workspace, "printful");
  return <ConsoleShell active="connections" context={context} navigationBusinessId={businessId} commandBar={<div className="consoleDefaultCommands"><span className="consoleCommandHint">Owner-only credential entry · no automated session</span><Link className="consoleCommandLink" href={returnTo}>Back to Connections</Link></div>}>
    <section className="consolePane consoleSecurePane" data-agent-labs-secure="true" data-private="true" aria-labelledby="secure-owner-title">
      <header className="consolePaneHeader"><div><h1 id="secure-owner-title">Verify Printful</h1><p>Current saved registry: {state.label} · Request {runId.slice(0, 8)}</p></div><Link href={returnTo}>Back to Connections</Link></header>
      {!eligible ? <div className="connectionNotice" role="alert" tabIndex={-1}><strong>{state.label === "Expired" ? "This request has expired." : "A current approved request and activated vault are required."}</strong><p>Return to Connections to review the saved request. No credential can be submitted here yet.</p><Link className="coreButton" href={returnTo}>Review current request</Link></div> : <div className="secureConnectionLayout">
        <aside className="secureConnectionInstructions" aria-label="Printful access and store requirements" tabIndex={0}>
          <h2>A credential for one store</h2>
          <p>Enter this credential yourself in your own browser, outside any automated or recorded session. Credentials stay out of models and workflow artifacts.</p>
          <p className="accountWarning">Agent Labs saves one Printful store identity per Business and cannot switch it, even after a local disconnect. Do not bind a temporary Manual/API test store to a Business intended for Etsy selling.</p>
          <p>Use a store-specific token from <a href={PRINTFUL_ACCOUNT_LINKS.tokenManagement} target="_blank" rel="noreferrer">Printful token management</a>. Allow only stores_list/read if a scope is required. Broad, write-enabled or multi-store tokens will be rejected.</p>
          <p>Agent Labs will send the token only to api.printful.com for scope and store verification, encrypt it in the private account vault, and allow catalog reads for this Business. Product changes, orders and spending require separate approval.</p>
          <details><summary>Store type and revocation details</summary><p id="printful-store-kind-help">For Etsy selling, use the ecommerce-linked Printful store already linked to the intended Etsy shop. Manual/API stores are for custom integrations or isolated qualification. Selecting a type here does not create an Etsy link. Agent Labs has no automatic order sync or fulfilment path yet; that remains later Stage 22 work.</p><p>Local disconnect removes Agent Labs’ saved token. Revoke it in Printful token management to stop the provider credential itself.</p></details>
        </aside>
        <PrintfulSecureForm businessId={businessId} runId={runId} observedAt={workspace.observedAt} returnTo={returnTo}/>
      </div>}
    </section>
  </ConsoleShell>;
}
