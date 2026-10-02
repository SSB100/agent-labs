import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageHeader } from "@/components/stage7/app-shell";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { loadAccountWorkspace } from "@/accounts/server";
import { ACCOUNT_UUID } from "@/accounts/contracts";
import { PRINTFUL_ACCOUNT_LINKS } from "@/accounts/printful";
import { submitOwnerPrintfulCredential } from "../actions";
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
  return <AppShell active="accounts" context={context} navigationBusinessId={businessId}>
    <PageHeader eyebrow="Owner-only secure step" title="Connect your Printful store" description="Enter this credential yourself in your own browser, outside any automated or recorded session. The application keeps it out of models and workflow artifacts."
      actions={<Link className="coreButton" href={`/dashboard/accounts?business=${businessId}#business-accounts`}>Back to account setup</Link>} />
    <section className="accountSecurePanel" data-agent-labs-secure="true" data-private="true" aria-labelledby="secure-owner-title">
      <h2 id="secure-owner-title">A credential for one store</h2>
      <p className="accountWarning">Choose the store before connecting. Agent Labs saves one Printful store identity per Business and cannot switch it, even after a local disconnect. Do not bind a temporary Manual/API test store to a Business intended for Etsy selling.</p>
      {!eligible ? <p className="accountWarning" role="alert">A current approved request and activated vault are required. Return to Accounts to review the request. No credential can be submitted here yet.</p> : <>
        <p>Use a store-specific token from <a href={PRINTFUL_ACCOUNT_LINKS.tokenManagement} target="_blank" rel="noreferrer">Printful token management</a>. Allow only stores_list/read if a scope is required. Broad, write-enabled or multi-store tokens will be rejected.</p>
        <p>Agent Labs will send the token only to api.printful.com for scope and store verification, encrypt it in the private account vault, and allow catalog reads for this Business. Product changes, orders and spending require separate approval.</p>
        <form action={submitOwnerPrintfulCredential} className="accountSecureForm" autoComplete="off" data-agent-labs-secure="true">
          <input type="hidden" name="businessId" value={businessId} /><input type="hidden" name="runId" value={runId} />
          <label>Printful private token<input name="credential" type="password" required minLength={8} maxLength={8192} autoComplete="off" data-private="true" spellCheck={false} /></label>
          <label>Intended Printful store ID<input name="storeId" type="number" inputMode="numeric" min={1} step={1} required /><small>Use the store identifier shown in Printful. Verification must return exactly this store.</small></label>
          <label>Store type<select name="storeKind" aria-label="Store type" aria-describedby="printful-store-kind-help" required defaultValue=""><option value="" disabled>Choose the intended store type</option><option value="ecommerce_linked">Ecommerce-linked store · Etsy selling</option><option value="manual_api">Manual / API store · Custom integration or qualification</option></select></label>
          <p className="accountHelp" id="printful-store-kind-help">For Etsy selling, use the ecommerce-linked Printful store already linked to the intended Etsy shop. Manual/API stores are for custom integrations or isolated qualification. Selecting a type here does not create an Etsy link. Agent Labs has no automatic order sync or fulfilment path yet; that remains later Stage 22 work.</p>
          <label>Stop using this credential after<input name="expiresAt" type="datetime-local" required defaultValue={new Date(Date.parse(workspace.observedAt) + 30 * 86_400_000).toISOString().slice(0, 16)} /><small>UTC, at most 31 days. This is Agent Labs’ local cutoff, not the provider token expiry.</small></label>
          <div className="accountConsentForm"><label><input type="checkbox" name="secureAccessConsent" required /> I approve encrypted storage and the listed access to this exact Printful store for this Business. I entered this token myself.</label></div>
          <button className="coreButton coreButton-primary" type="submit">Verify and store securely</button>
        </form>
        <p className="accountHelp">No password is reused across services. Local disconnect removes Agent Labs’ saved token; revoke it in Printful token management to stop the provider credential itself.</p>
      </>}
    </section>
  </AppShell>;
}
