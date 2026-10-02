import { ConsoleRetainedWorkspace } from "@/components/console/console-retained-workspace";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageHeader } from "@/components/stage7/app-shell";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { loadAccountWorkspace } from "@/accounts/server";
import { ACCOUNT_UUID, ACCOUNT_PROVIDERS } from "@/accounts/contracts";
import { storeOwnerWebsitePassword } from "../actions";
import "../accounts.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export default async function AccountPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await requireOwnerUiContext(), query = await searchParams;
  const businessId = typeof query.business === "string" ? query.business : "", connectionId = typeof query.account === "string" ? query.account : "";
  if (!ACCOUNT_UUID.test(businessId) || !ACCOUNT_UUID.test(connectionId) || !context.businesses.some(b => b.id === businessId)) notFound();
  const data = await loadAccountWorkspace(context, businessId), account = data.accounts.find(a => a.id === connectionId);
  const eligible = !data.unavailable && data.vaultConfigured && account?.status === "connected";
  return <AppShell active="accounts" context={context} navigationBusinessId={businessId}><ConsoleRetainedWorkspace ownerId={context.userId} secure header={<PageHeader eyebrow="Owner-only secure vault" title="Save a service password"
    description="Optional encrypted storage for a unique website password, separate from API tokens. Enter it yourself; never send it in chat."
    actions={<Link className="coreButton" href={`/dashboard/accounts?business=${businessId}#business-accounts`}>Back to Accounts</Link>} />} panels={[{ id: "secure", label: "Secure owner entry", content: <>
    <section className="accountSecurePanel" data-agent-labs-secure="true" data-private="true">
      {!eligible || !account ? <p className="accountWarning" role="alert">A verified connection and activated account vault are required. No password can be submitted yet.</p> : <>
        <h2>{ACCOUNT_PROVIDERS[account.provider].name} website password</h2>
        <p>This saves only the credential you enter. It does not change or verify the password at the provider, sign in, or grant workers access to it. Existing saved passwords are never rendered back into this page.</p>
        <form action={storeOwnerWebsitePassword} className="accountSecureForm" autoComplete="off" data-agent-labs-secure="true">
          <input type="hidden" name="businessId" value={businessId} /><input type="hidden" name="connectionId" value={account.id} />
          <input type="hidden" name="provider" value={account.provider} /><input type="hidden" name="connectionRevision" value={account.revision} /><input type="hidden" name="passwordRevision" value={account.passwordRevision ?? ""} />
          <label>Website login / email<input name="username" type="text" required autoComplete="off" maxLength={254} data-private="true" spellCheck={false} /></label>
          <label>Unique service password<input name="password" type="password" required autoComplete="new-password" minLength={12} maxLength={1024} data-private="true" /></label>
          <label>Confirm service password<input name="confirmPassword" type="password" required autoComplete="new-password" minLength={12} maxLength={1024} data-private="true" /></label>
          <div className="accountConsentForm"><label><input type="checkbox" name="passwordStorageConsent" required /> I entered this unique service password myself and approve saving it encrypted in this Business’s private Agent Labs vault{account.passwordStored ? ", replacing its current saved password" : ""}. This does not authorize sharing it with any provider or model.</label></div>
          <button className="coreButton coreButton-primary" type="submit">Save encrypted password</button>
        </form><p className="accountHelp">Keep your own password-manager copy. This first release supports owner-only encrypted storage; plaintext retrieval and automatic password entry are unavailable.</p>
      </>}
    </section></> }]} /></AppShell>;
}
