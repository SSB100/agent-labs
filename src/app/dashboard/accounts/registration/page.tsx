import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageHeader } from "@/components/stage7/app-shell";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { loadOwnerRegistrationHandoff } from "@/accounts/server";
import { ACCOUNT_UUID, ACCOUNT_PROVIDERS } from "@/accounts/contracts";
import { finishOwnerRegistrationSession } from "../actions";
import "../accounts.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export default async function AccountRegistrationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await requireOwnerUiContext(), query = await searchParams;
  const businessId = typeof query.business === "string" ? query.business : "", runId = typeof query.run === "string" ? query.run : "";
  if (!ACCOUNT_UUID.test(businessId) || !ACCOUNT_UUID.test(runId) || !context.businesses.some(b => b.id === businessId)) notFound();
  let handoff: Awaited<ReturnType<typeof loadOwnerRegistrationHandoff>> | null = null;
  try { handoff = await loadOwnerRegistrationHandoff(context, businessId, runId); } catch { /* Safe owner-facing failure only. */ }
  return <AppShell active="accounts" context={context}><PageHeader eyebrow="Exclusive owner control" title="Complete the secure signup step"
    description="Automation is disconnected. Enter credentials yourself only for the approved provider. Do not share this live session URL."
    actions={<Link className="coreButton" href={`/dashboard/accounts?business=${businessId}#business-accounts`}>Back to account setup</Link>} />
    <section className="accountSecurePanel accountRegistrationPanel" data-agent-labs-secure="true" data-private="true">
      {!handoff ? <p className="accountWarning" role="alert">This owner session is unavailable, stopped or expired. Return to Accounts to inspect the saved request. A new account has not been inferred or automatically retried.</p> : <>
        <h2>{ACCOUNT_PROVIDERS[handoff.provider].name} owner signup</h2>
        <p>The displayed profile fields were prepared under your exact approval. You control password entry, human verification, and the final signup submission. Stop for any unexpected terms, access, payment, bank or identity request.</p>
        <p className="accountHelp">Browserbase hosts this session with session recording and logs disabled. Its operational metadata may still be retained. The agent has no connected automation channel and never reads your password. This short-lived browser does not save a reusable authentication profile.</p>
        <iframe title={`${ACCOUNT_PROVIDERS[handoff.provider].name} secure owner browser`} src={handoff.viewerUrl} referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-forms" className="accountRegistrationFrame" />
        <p className="accountHelp">Session access expires at {new Date(handoff.expiresAt).toLocaleString("en", { timeZone: "UTC" })} UTC. Completion here still requires independent provider connection verification.</p>
      </>}
      <form action={finishOwnerRegistrationSession}><input type="hidden" name="businessId" value={businessId} /><input type="hidden" name="runId" value={runId} /><button className="coreButton coreButton-primary" type="submit">Close owner browser and return to connection</button></form>
    </section></AppShell>;
}
