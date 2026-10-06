import { HistoryPager } from "@/components/console/history-pager";
import Link from "next/link";
import { accountReturnHref, connectionState, connectionWorkspaceKey, accountMessageConfirmation, ACCOUNT_POSITIVE_MESSAGES } from "@/accounts/connection-feedback";
import { AccountForm, AccountNotice } from "./connection-feedback";
import { randomUUID } from "node:crypto";
import { ACCOUNT_PROVIDERS, type AccountWorkspace, type AccountSetupRun, type AccountProvider } from "@/accounts/contracts";
import { StatusPill } from "@/components/stage7/app-shell";
import { saveBusinessAccountProfile, requestAccountSetup, approveReviewedAccountSetup, cancelAccountSetup,
  resumeVerifiedAccountSetup, disconnectBusinessAccount, startApprovedAccountRegistration, finishOwnerRegistrationSession, removeOwnerWebsitePassword } from "./actions";

export const accountMessages: Record<string, string> = {
  "password-removed": "The current saved registry shows no stored website-password copy for this account. Check the provider separately if its password also needs changing.",
  "password-stored": "An owner-saved encrypted website-password copy is recorded for this account, separately from provider tokens. It has not been verified with the provider.",
  "password-storage-unavailable": "The password could not be stored. Check that both entries match, meet the length requirements and that the connection is current. No credential details were logged.",
  "profile-saved-browser-pending": "A saved account profile is present. Remote browser closure is unconfirmed; close any owner browser tab.",
  "verified-browser-pending": "Provider connection verified and saved. Remote signup browser closure is unconfirmed; close any owner browser tab and retry its close action.",
  "disconnected-browser-pending": "Agent Labs account access was disconnected. Remote signup browser closure is unconfirmed; close any owner browser tab and retry its close action.",
  "profile-saved": "A saved account profile is present. New requests use its current revision.",
  "profile-unavailable": "The profile could not be saved. Refresh to check the latest revision; no existing data was overwritten.",
  "review-ready": "Review the exact service, data and access below before approving.",
  "consent-required": "Confirm each required consent before continuing.",
  "setup-unavailable": "Account setup could not proceed. Refresh to inspect its current state.",
  "approval-unavailable": "Approval was not accepted. The profile or request may have changed or expired. Review a fresh request.",
  "registration-prepared": "Inspect the request below. A prepared form is not a created account; secure owner completion and independent verification are still required.",
  "owner-step-finished": "The owner browser was closed. Connect and independently verify the account before setup can complete.",
  "browser-release-unconfirmed": "Remote browser closure could not be confirmed from these records. Close any owner browser tab; if a close action is available, retry it.",
  approved: "Your exact request is approved. Follow the secure owner step below; verification is still required.",
  cancelled: "Setup stopped. An already completed provider action cannot be reversed here.",
  verified: "The provider connection was verified and saved for this Business.",
  "verification-unavailable": "Verification could not complete. A save may have succeeded; check the current saved registry below before trying again. Credentials and provider response details are not shown.",
  "verification-input-invalid": "Check the token, intended store ID, store type and local cutoff in the secure form. No valid verification request was accepted.",
  "verification-access-denied": "Printful did not accept this token. Check its access in Printful token management, then use the secure owner form.",
  "verification-scope-rejected": "Printful reported unsupported token scopes. Use a store-specific token with only stores_list/read if a scope is required.",
  "verification-store-scope-rejected": "Could not confirm access to only the intended store. Check the token’s selected store and entered ID.",
  "verification-store-mismatch": "The provider store did not match the intended store ID or type. Check both before continuing; this Business’s stored identity cannot be switched.",
  "verification-rate-limited": "Printful rate-limited verification. Check the saved registry before trying again later; nothing was automatically retried.",
  "verification-expired": "This owner request has expired. Review a fresh exact request before entering a credential.",
  "verification-review-required": "The saved request is no longer ready for verification. Review its current state before continuing.",
  "secure-entry-required": "Use the secure owner entry step for this Printful request.",
  disconnected: "Agent Labs access was disconnected locally. Revoke the provider grant or token at the provider too.",
  "disconnect-unavailable": "The connection could not be disconnected. Refresh before retrying; its revision may have changed.",
};
export function accountNoticeMessage(data: AccountWorkspace | null, provider: AccountProvider, runId: string | undefined, message: string | undefined) {
  if (!message || !Object.hasOwn(accountMessages, message)) return undefined;
  const confirmation = data ? accountMessageConfirmation(data, provider, runId, message)
    : (ACCOUNT_POSITIVE_MESSAGES as readonly string[]).includes(message) ? false : undefined;
  if (confirmation === false) return "The requested outcome could not be confirmed from the current saved records. Check the saved state before continuing.";
  if (message === "approved" && provider === "etsy") return "The saved request is approved. Etsy activation remains on hold.";
  return accountMessages[message];
}
function RunFields({ run, businessId }: { run: AccountSetupRun; businessId: string }) {
  return <><input type="hidden" name="businessId" value={businessId} /><input type="hidden" name="runId" value={run.id} /><input type="hidden" name="revision" value={run.revision} /></>;
}
function SetupRequest({ run, workspace, returnTo, compact = false }: { run: AccountSetupRun; workspace: AccountWorkspace; returnTo?: string; compact?: boolean }) {
  const spec = ACCOUNT_PROVIDERS[run.provider], waiting = ["approved", "owner_handoff", "preparation_started"].includes(run.status);
  const activationHeld = compact && run.provider === "etsy";
  const expired = run.status === "expired" || (!!run.approvalExpiresAt && (!Number.isFinite(Date.parse(run.approvalExpiresAt)) || Date.parse(run.approvalExpiresAt) <= Date.parse(workspace.observedAt)));
  const readyForVerification = run.provider === "printful" && workspace.configured && workspace.vaultConfigured && !workspace.unavailable && run.status === "owner_handoff" && !!run.approvalExpiresAt && Date.parse(run.approvalExpiresAt) > Date.parse(workspace.observedAt);
  const friendlyState = run.status === "failed" ? "Failed request"
    : run.status === "expired" || (expired && (waiting || run.status === "pending_approval")) ? "Expired request"
    : activationHeld ? "Activation on hold"
    : run.status === "owner_handoff" ? readyForVerification ? "Ready for secure verification" : "Secure entry unavailable"
    : run.status === "pending_approval" ? "Review required"
    : run.status === "approved" ? "Approved request"
    : run.status === "verified" ? "Verified request"
    : run.status === "cancelled" ? "Stopped request"
    : run.status === "invalidated" ? "Review no longer current"
    : run.status === "preparation_started" ? "Setup preparation recorded" : "Saved request state unavailable";
  const disclosure = <>
    <p>{run.disclosure.purpose}</p>
    <dl className="accountFacts"><div><dt>Destination</dt><dd>{run.disclosure.destination}</dd></div>
      <div><dt>Profile data shared</dt><dd>{Object.entries(run.disclosure.disclosedData).length ? Object.entries(run.disclosure.disclosedData).map(([key, value]) => <span className="accountDataValue" key={key}>{key}: {value}</span>) : "None for an API connection"}</dd></div>
      <div><dt>Requested access</dt><dd>{compact ? run.disclosure.scopes.map(scope => scope === "catalog.read" ? "View catalog" : scope).join(", ") : run.disclosure.scopes.join(", ")}</dd></div>
      <div><dt>Spending authority</dt><dd>None. Stop for any charge, subscription or new financial commitment.</dd></div>
      <div><dt>Approval expires</dt><dd>{run.approvalExpiresAt ? new Date(run.approvalExpiresAt).toLocaleString("en", { timeZone: "UTC" }) + " UTC" : "Before execution"}</dd></div>
    </dl>
    <p><a href={spec.termsUrl} target="_blank" rel="noreferrer">{spec.name} terms</a>{" · "}<a href={run.provider === "etsy" ? "https://www.etsy.com/legal/privacy" : "https://www.printful.com/policies/privacy"} target="_blank" rel="noreferrer">Privacy policy</a></p>
    {run.provider === "etsy" ? <p className="accountHelp">Etsy access includes draft listing writes. Connection approval does not authorize a listing change, publication, shop-opening fee or purchase; those actions retain their separate gates.</p> : <><p className="accountHelp">Printful access is restricted to catalog reads in Agent Labs. Provider scopes and the exact store are independently checked. Product changes, orders and spending remain separate.</p><p className="accountWarning">Review the intended store before approving. This app saves one Printful store identity per Business and cannot switch it, even after a local disconnect. For Etsy selling, use the ecommerce-linked store already linked to the intended Etsy shop; do not bind a temporary Manual/API qualification store.</p></>}
    {run.mode === "create" ? <p className="accountWarning">{activationHeld ? "Etsy activation is on hold. Review the saved request; only stopping setup or closing an existing owner session is available." : workspace.registrationAvailable ? "The approved Browserbase flow prepares only the listed ordinary fields, then disconnects automation for secure owner completion. It does not submit passwords or infer account creation." : "Automatic registration is waiting for approved secure Browserbase activation, budget and session entitlement. No signup fields are sent through the current recorded browser. You can complete signup directly with the provider, then connect the account."} Saved approval alone does not mean an account was created.</p> : null}
  </>;
  return <article className="accountRequest">
    <div className="sectionTitleRow"><h3>{run.mode === "create" ? "Set up" : "Connect"} {spec.name}</h3>{compact ? <span className="connectionRequestState">{friendlyState}</span> : <StatusPill status={expired && !["verified", "cancelled"].includes(run.status) ? "expired" : run.status} />}</div>
    {compact ? <div className="connectionRequestSummary"><p>{activationHeld ? "Only stopping setup or closing an existing owner session is available." : readyForVerification ? "Next: use Verify Printful in the action panel." : run.status === "pending_approval" && !expired ? "Next: review the exact access and required consents below." : "Review the current saved state before continuing."}</p><dl className="accountFacts"><div><dt>Access</dt><dd>{run.disclosure.scopes.map(scope => scope === "catalog.read" ? "View catalog" : scope).join(", ")}</dd></div><div><dt>Approval expires</dt><dd>{run.approvalExpiresAt ? new Date(run.approvalExpiresAt).toLocaleString("en", { timeZone: "UTC" }) + " UTC" : "Before execution"}</dd></div></dl></div> : null}
    {compact && run.status !== "pending_approval" ? <details className="connectionDetails"><summary>Saved request access and terms</summary>{disclosure}</details> : disclosure}
    {run.status === "pending_approval" && !expired && !activationHeld ? <AccountForm action={approveReviewedAccountSetup} returnTo={returnTo} className="accountConsentForm" pendingLabel="Approving exact request…">
      <RunFields run={run} businessId={workspace.businessId} /><input type="hidden" name="disclosureHash" value={run.disclosureHash} />
      <label><input type="checkbox" name="dataConsent" data-field-label="Exact destination and profile data consent" required /> I approve the exact destination and profile data shown above</label>
      <label><input type="checkbox" name="accessConsent" data-field-label="Business connection access consent" required /> I approve this Business connection and the listed access, with no spending authority</label>
      {run.disclosure.termsAcknowledgementRequired ? <label><input type="checkbox" name="termsConsent" data-field-label="Terms and privacy consent" required /> I have reviewed the linked terms and privacy policy and approve their acceptance for this specific signup when the supported flow is available</label> : null}
      {run.disclosure.browserProcessing ? <label><input type="checkbox" name="browserConsent" data-field-label="Browserbase processing consent" required /> I approve Browserbase processing this signup session and the displayed profile data for the intended service. Session recording and logs will be disabled; this does not mean the provider has zero operational data retention. Activation and browser costs need separate approval.</label> : null}
      <button className="coreButton coreButton-primary" disabled={!workspace.configured} type="submit">Approve exact request</button>
    </AccountForm> : null}
    {waiting && !expired && (run.mode === "connect" || run.status === "owner_handoff") ? <div className="accountNextStep">
      {run.provider === "printful" && compact ? <p className="accountHelp">Use Verify Printful to complete this approved request in the isolated secure owner form.</p> : run.provider === "printful" ? <><h4>Secure owner step</h4><p>Create or select a token for only the intended Printful store, with only stores_list/read if a scope is required. Enter it directly in the secure owner form. Never send it to an AI chat.</p><Link className="coreButton coreButton-primary" href={`/dashboard/accounts/secure?business=${workspace.businessId}&run=${run.id}${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ""}`}>Open secure Printful connection</Link></>
        : compact ? <p className="accountHelp">Etsy activation is on hold. This saved request does not activate OAuth or grant execution permission.</p> : <><h4>Authorize Etsy, then verify</h4><p>Use the existing secure OAuth flow for the intended shop. Return here to verify the exact connection.</p><Link className="coreButton" href={`/dashboard/etsy?business=${workspace.businessId}`}>Open Etsy connection</Link><form action={resumeVerifiedAccountSetup}><RunFields run={run} businessId={workspace.businessId} /><button className="coreButton coreButton-primary" type="submit">Verify Etsy connection</button></form></>}
    </div> : null}
    {!activationHeld && run.mode === "create" && run.status === "approved" && !expired ? <form action={startApprovedAccountRegistration}><RunFields run={run} businessId={workspace.businessId} /><button className="coreButton coreButton-primary" disabled={!workspace.registrationAvailable} type="submit">Prepare approved signup</button></form> : null}
    {run.mode === "create" && run.status === "owner_handoff" && run.preparationReceipt?.reasonCode === "secure_owner_steps" && !expired ? <div className="accountNextStep">{!activationHeld ? <Link className="coreButton coreButton-primary" href={`/dashboard/accounts/registration?business=${workspace.businessId}&run=${run.id}`}>Open secure owner signup</Link> : null}{!compact ? <form action={finishOwnerRegistrationSession}><RunFields run={run} businessId={workspace.businessId} /><button className="coreButton" type="submit">Close owner browser</button></form> : null}</div> : null}
    {!activationHeld && run.mode === "create" && waiting ? <a href={spec.registrationUrl} target="_blank" rel="noreferrer">Open {spec.name} signup securely in your own browser</a> : null}
    {!compact && !["verified", "cancelled", "completed"].includes(run.status) ? <AccountForm action={cancelAccountSetup} returnTo={returnTo} pendingLabel="Stopping setup…"><RunFields run={run} businessId={workspace.businessId} /><button className="coreButton" type="submit">Stop setup</button></AccountForm> : null}
    {compact ? <details className="connectionDetails"><summary>Technical request details</summary><dl className="accountFacts"><div><dt>Exact request ID</dt><dd>{run.id}</dd></div><div><dt>Saved request status</dt><dd>{run.status}</dd></div><div><dt>Machine scopes</dt><dd>{run.disclosure.scopes.join(", ")}</dd></div><div><dt>Connection ID</dt><dd>{run.connectionId}</dd></div><div><dt>Revision</dt><dd>{run.revision}</dd></div></dl></details> : null}
    {run.receipt ? <p className="accountHelp">Verification receipt saved. Account access does not qualify product execution or publication.</p> : null}
  </article>;
}
export function BusinessAccountWorkspace({ data }: { data: AccountWorkspace }) {
  return <section key={connectionWorkspaceKey(data)} className="dashboardSection accountWorkspace" id="business-accounts" aria-labelledby="business-account-title">
    <div className="sectionTitleRow"><div><p className="coreEyebrow">Business-scoped account setup</p><h2 id="business-account-title">Business accounts</h2></div><span className="coreCount">{data.accounts.filter(a => a.status === "connected").length}</span></div>
    <p>Save a dedicated email and ordinary profile once. Review the exact service, information, access and terms for each setup request. Credentials stay behind the server boundary.</p>
    {data.unavailable ? <p className="coreNotice coreNotice-danger" role="alert">Account records could not be checked. Existing profiles, requests or connections may still exist. Setup is unavailable until the database rollout is verified.</p> : null}
    {!data.configured ? <p className="coreNotice">Account setup server authority has not been activated. No credentials or access grants are installed by this interface.</p> : null}
    {!data.unavailable ? <>
      <form action={saveBusinessAccountProfile} className="accountProfileForm">
        <input type="hidden" name="businessId" value={data.businessId} /><input type="hidden" name="profileRevision" value={data.profile?.revision ?? ""} />
        <h3>Reusable account profile</h3><p className="accountHelp">Use an email you control. This form does not create a mailbox. Use a unique password per service in a password manager; never put passwords, identity documents, bank details or recovery codes in this profile.</p>
        <div className="accountFormGrid"><label>Dedicated email<input name="email" type="email" autoComplete="email" required maxLength={254} defaultValue={data.profile?.email ?? ""} /></label>
          <label>Given name<input name="givenName" autoComplete="given-name" required maxLength={100} defaultValue={data.profile?.givenName ?? ""} /></label>
          <label>Family name<input name="familyName" autoComplete="family-name" maxLength={100} defaultValue={data.profile?.familyName ?? ""} /></label>
          <label>Country code<input name="countryCode" autoComplete="country" required pattern="[A-Z]{2}" placeholder="NZ" maxLength={2} defaultValue={data.profile?.countryCode ?? ""} /></label>
          <label>Language / locale<input name="locale" required pattern="[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}" placeholder="en-NZ" maxLength={22} defaultValue={data.profile?.locale ?? ""} /></label></div>
        <button className="coreButton coreButton-primary" type="submit" disabled={!data.configured}>Save profile</button>
      </form>
      <div className="accountProviderGrid">{(["etsy", "printful"] as const).map(provider => <article className="accountProvider" key={provider}><h3>{ACCOUNT_PROVIDERS[provider].name}</h3><p>{provider === "etsy" ? "Reuse the existing encrypted OAuth shop connection." : "Verify one intended store and encrypt its minimum-access token."}</p>
        {provider === "printful" ? <><p className="accountWarning">Choose the store before preparing a review. This app saves one Printful store identity per Business and cannot switch it, even after a local disconnect. Do not bind a temporary Manual/API test store to your selling Business.</p><p className="accountHelp">For Etsy selling, use the ecommerce-linked Printful store already linked to the intended Etsy shop. Manual/API is for custom integrations or isolated qualification. A connection does not link Etsy variants. Automatic order sync and fulfilment in Agent Labs remain later Stage 22 work.</p></> : null}
        <form action={requestAccountSetup}><input type="hidden" name="businessId" value={data.businessId} /><input type="hidden" name="provider" value={provider} /><input type="hidden" name="idempotencyKey" value={randomUUID()} />
          <label>Account state<select name="mode" defaultValue="connect"><option value="connect">Connect an existing account</option><option value="create">I need a new account</option></select></label>
          <button className="coreButton" type="submit" disabled={!data.configured || !data.profile}>Prepare exact review</button></form></article>)}</div>
      {data.accounts.length ? <div className="accountConnections"><h3>Connected account registry</h3>{data.accounts.map(account => <article className="accountRequest" key={account.id}><div className="sectionTitleRow"><h4>{ACCOUNT_PROVIDERS[account.provider].name} · {account.label || account.externalAccountId}</h4><StatusPill status={account.status} /></div><p>Access: {account.scopes.join(", ")}</p><p className="accountHelp">Website password: {account.passwordStored ? "Owner-saved encrypted credential; not provider-verified" : "Not stored"}</p>{account.status === "connected" ? <Link className="coreButton" href={`/dashboard/accounts/password?business=${data.businessId}&account=${account.id}`}>{account.passwordStored ? "Replace saved website password" : "Save unique website password"}</Link> : null}{account.status === "connected" ? <form action={disconnectBusinessAccount} className="accountConsentForm"><input type="hidden" name="businessId" value={data.businessId} /><input type="hidden" name="provider" value={account.provider} /><input type="hidden" name="connectionRevision" value={account.revision} /><label><input type="checkbox" name="disconnectConsent" required /> Stop Agent Labs API access and remove its saved provider token. Any separately saved website password is retained until I remove it below. The provider token/grant may also need revocation at the provider.</label><button className="coreButton" type="submit">Disconnect locally</button></form> : null}{account.passwordStored ? <form action={removeOwnerWebsitePassword} className="accountConsentForm"><input type="hidden" name="businessId" value={data.businessId} /><input type="hidden" name="provider" value={account.provider} /><input type="hidden" name="connectionId" value={account.id} /><input type="hidden" name="passwordRevision" value={account.passwordRevision ?? ""} /><label><input type="checkbox" name="passwordRemovalConsent" required /> Permanently remove this saved Agent Labs password copy. I have my own copy; the provider password will not change.</label><button className="coreButton" type="submit">Remove saved website password</button></form> : null}</article>)}</div> : <p className="accountHelp">No Business account has been verified in this registry yet.</p>}
      <div className="accountRequests"><h3>Setup requests</h3><HistoryPager page={data.runsPage} name="account" label="Account requests"/>{data.runs.length ? data.runs.map(run => <SetupRequest key={run.id} run={run} workspace={data} />) : <p>No setup requests are shown on this server page. Check the request count and other pages.</p>}</div>
      {data.healthPage || data.healthEvents.length ? <div className="accountHealth"><h3>Connection history</h3><HistoryPager page={data.healthPage} name="accountHealth" label="Connection health events"/><ul>{data.healthEvents.map(event => <li key={event.id}>{event.provider}: {event.eventType.replaceAll("_", " ")} · {event.occurredAt}</li>)}</ul></div> : null}
    </> : null}
  </section>;
}

/** Frequent actions first; exact disclosures and history stay in a contained pane. */
export function CompactConnectionsWorkspace({ data, returnTo, provider = "printful", runId, message, resultId }: {
  data: AccountWorkspace; returnTo: string; provider?: "etsy" | "printful"; runId?: string; message?: string; resultId?: string;
}) {
  const states = (["etsy", "printful"] as const).map(key => ({ provider: key, ...connectionState(data, key) }));
  const selectedRun = data.runs.find(run => run.id === runId);
  const selectedProvider = selectedRun?.provider ?? provider;
  const selected = states.find(item => item.provider === selectedProvider)!;
  const selectedMissing = !!runId && !selectedRun;
  const historyIncomplete = data.currentRuns ? false : data.runs.length >= 50;
  const run = runId ? selectedRun : selected.run;
  const href = (key: string) => accountReturnHref(data.businessId, { returnTo, provider: key });
  const newerActiveRun = selected.run && selected.run.id !== run?.id && ["pending_approval", "approved", "preparation_started", "owner_handoff"].includes(selected.run.status) && (!selected.run.approvalExpiresAt || Date.parse(selected.run.approvalExpiresAt) > Date.parse(data.observedAt)) ? selected.run : undefined;
  const runExpired = !!run?.approvalExpiresAt && (!Number.isFinite(Date.parse(run.approvalExpiresAt)) || Date.parse(run.approvalExpiresAt) <= Date.parse(data.observedAt));
  const needsReview = runExpired || !run || !["pending_approval", "approved", "preparation_started", "owner_handoff"].includes(run.status) || selected.label === "Expired";
  const secureHref = run ? `/dashboard/accounts/secure?business=${data.businessId}&run=${run.id}&returnTo=${encodeURIComponent(href("printful"))}` : undefined;
  const notice = accountNoticeMessage(data, selectedProvider, runId, message);
  return <section key={connectionWorkspaceKey(data, message, resultId)} className="compactConnections" aria-label="Business connections">
    <HistoryPager page={data.runsPage} name="account" label="Account requests"/><AccountNotice message={notice}><p>Legacy setup registry: {states.map(item => `${ACCOUNT_PROVIDERS[item.provider].name} · ${item.label}`).join("; ")}</p></AccountNotice>
    {data.unavailable ? <p className="accountWarning" role="alert">Account records could not be checked. Existing connections and requests may still exist. Refresh the saved registry before trying again.</p> : <div className="connectionLayout">
      <div className="connectionQuickPanel">
        <div className="connectionRows">{states.map(item => <Link href={href(item.provider)} key={item.provider} className="connectionRow" aria-current={selectedProvider === item.provider ? "true" : undefined}>
          <span className="connectionProviderMark" aria-hidden="true">{item.provider === "etsy" ? "E" : "P"}</span><span><strong>{ACCOUNT_PROVIDERS[item.provider].name}</strong><small>{item.account?.label || (item.provider === "etsy" ? "Shop access · activation on hold" : "One verified store per Business")}</small></span><span className="connectionState" data-state={item.label.toLowerCase().replaceAll(" ", "-")}>{item.label}</span>
        </Link>)}</div>
        <div className="connectionNextAction">
          <h2>{ACCOUNT_PROVIDERS[selectedProvider].name} · Next action</h2>
          {selectedMissing ? <p>The selected request is unavailable in the loaded history. No other request has been selected. Refresh the saved records before continuing.</p>
            : newerActiveRun ? <><p>A newer setup request is in progress. Review it before preparing another request.</p><Link className="coreButton" href={accountReturnHref(data.businessId, { returnTo, provider: selectedProvider, runId: newerActiveRun.id })}>Review current request</Link></>
            : !run && historyIncomplete ? <p>Setup history is incomplete. An older request may exist outside the latest 50 records. No new setup can be prepared from this snapshot.</p>
            : !data.configured ? <p>Account setup authority has not been activated. Saved records remain visible.</p>
            : selectedProvider === "etsy" ? <p>Etsy activation is on hold. Existing saved access does not authorize new OAuth activation, listing changes or spending.</p>
            : selected.label === "Connected" ? <p>Store {selected.account?.externalAccountId} is verified in the saved registry. Review access details when needed.</p>
            : !data.profile ? <><p>Save the ordinary account profile before preparing an exact review.</p><a className="coreButton" href="#connection-profile">Set up account profile</a></>
            : !needsReview && run?.status === "owner_handoff" && data.vaultConfigured && !!run.approvalExpiresAt && Date.parse(run.approvalExpiresAt) > Date.parse(data.observedAt) ? <><p>Complete the secure owner step for the approved store request.</p><Link className="coreButton coreButton-primary" href={secureHref!}>Verify Printful</Link></>
            : !needsReview ? <p>{run?.status === "pending_approval" ? "Review the exact request and required consents in the details pane." : "Review the saved request status before continuing. A current owner handoff and active vault are required."}</p>
            : <AccountForm action={requestAccountSetup} returnTo={href(selectedProvider)} pendingLabel="Preparing exact review…">
              <input type="hidden" name="businessId" value={data.businessId}/><input type="hidden" name="provider" value={selectedProvider}/><input type="hidden" name="mode" value="connect"/><input type="hidden" name="idempotencyKey" value={randomUUID()}/>
              <p>{selected.label === "Expired" ? "The saved request or credential has expired. Prepare a fresh exact review." : "Prepare the exact access request before securely entering a token."}</p>
              <button className="coreButton coreButton-primary" type="submit">Prepare Printful review</button>
            </AccountForm>}
          {run ? <div className="connectionCleanup">
            {!["verified", "cancelled", "completed"].includes(run.status) ? <AccountForm action={cancelAccountSetup} returnTo={href(selectedProvider)} pendingLabel="Stopping setup…"><RunFields run={run} businessId={data.businessId}/><button className="coreButton" type="submit">Stop setup</button></AccountForm> : null}
            {run.mode === "create" && run.status === "owner_handoff" && run.preparationReceipt?.reasonCode === "secure_owner_steps" && !runExpired ? <AccountForm action={finishOwnerRegistrationSession} returnTo={href(selectedProvider)} pendingLabel="Closing owner browser…"><RunFields run={run} businessId={data.businessId}/><button className="coreButton" type="submit">Close owner browser</button></AccountForm> : null}
          </div> : null}
        </div>
        <p className="accountHelp">Connected means saved, verified access. Product execution, publication, orders and spending keep separate approvals.</p>
      </div>
      <section className="connectionDetailPane" aria-label={`${ACCOUNT_PROVIDERS[selectedProvider].name} connection details`} tabIndex={0}>
        <header className="connectionDetailHeader"><h2>{ACCOUNT_PROVIDERS[selectedProvider].name} details</h2><span title={run?.id} aria-label={run ? `Selected request ${run.id}` : undefined}>{run ? `Request ${run.id.slice(0, 8)}` : "No saved request"}</span></header>
        <div className="connectionDetailScroll">
          {selected.account ? <details className="connectionDetails"><summary>Saved access · {selected.account.externalAccountId}</summary><dl className="accountFacts"><div><dt>Registry status</dt><dd>{selected.account.status}</dd></div><div><dt>Permitted access</dt><dd>{selected.account.scopes.map(scope => scope === "catalog.read" ? "View catalog" : scope).join(", ")}</dd></div><div><dt>Machine scopes</dt><dd>{selected.account.scopes.join(", ")}</dd></div><div><dt>Verified</dt><dd>{selected.account.verifiedAt ?? "Not recorded"}</dd></div><div><dt>Local cutoff</dt><dd>{selected.account.expiresAt ?? "Not recorded"}</dd></div></dl>
            {selected.account.status === "connected" ? <AccountForm action={disconnectBusinessAccount} returnTo={href(selectedProvider)} className="accountConsentForm" pendingLabel="Disconnecting local access…"><input type="hidden" name="businessId" value={data.businessId}/><input type="hidden" name="provider" value={selectedProvider}/><input type="hidden" name="connectionRevision" value={selected.account.revision}/><label><input type="checkbox" name="disconnectConsent" data-field-label="Disconnect consent" required/> Stop Agent Labs API access and remove its saved provider token. Any separately saved website password is retained. Revoke the token/grant at the provider too.</label><button className="coreButton" type="submit">Disconnect locally</button></AccountForm> : null}
          </details> : null}
          {run ? <SetupRequest run={run} workspace={data} returnTo={href(selectedProvider)} compact/> : <p>{selectedMissing ? "The selected request is unavailable in the loaded history. Its current state could not be established." : historyIncomplete ? "Only the latest 50 requests across providers were loaded. Earlier requests may exist." : `No setup request is saved for ${ACCOUNT_PROVIDERS[selectedProvider].name}.`}</p>}
          <details className="connectionDetails" id="connection-profile" open={!data.profile}><summary>{data.profile ? "Edit reusable account profile" : "Set up account profile"}</summary>
            <AccountForm action={saveBusinessAccountProfile} returnTo={href(selectedProvider)} className="accountProfileForm" pendingLabel="Saving account profile…">
              <input type="hidden" name="businessId" value={data.businessId}/><input type="hidden" name="profileRevision" value={data.profile?.revision ?? ""}/>
              <p className="accountHelp">Ordinary profile data only. Use an email you control; no passwords, identity documents, bank details or recovery codes.</p>
              <div className="accountFormGrid"><label>Dedicated email<input name="email" data-field-label="Dedicated email" type="email" autoComplete="email" required maxLength={254} defaultValue={data.profile?.email ?? ""}/></label>
                <label>Given name<input name="givenName" data-field-label="Given name" autoComplete="given-name" required maxLength={100} defaultValue={data.profile?.givenName ?? ""}/></label>
                <label>Family name<input name="familyName" data-field-label="Family name" autoComplete="family-name" maxLength={100} defaultValue={data.profile?.familyName ?? ""}/></label>
                <label>Country code<input name="countryCode" data-field-label="Country code" required pattern="[A-Z]{2}" placeholder="NZ" maxLength={2} defaultValue={data.profile?.countryCode ?? ""}/></label>
                <label>Language / locale<input name="locale" data-field-label="Language / locale" required pattern="[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}" maxLength={22} defaultValue={data.profile?.locale ?? ""}/></label></div>
              <button className="coreButton" type="submit" disabled={!data.configured}>Save profile</button>
            </AccountForm>
          </details>
          <details className="connectionDetails"><summary>Request history · {data.runs.filter(item => item.provider === selectedProvider).length} loaded</summary><ul className="connectionHistory">{data.runs.filter(item => item.provider === selectedProvider).map(item => <li key={item.id}><Link title={item.id} aria-label={`Inspect ${ACCOUNT_PROVIDERS[selectedProvider].name} request ${item.id}, ${item.status.replaceAll("_", " ")}`} href={accountReturnHref(data.businessId, { returnTo, provider: selectedProvider, runId: item.id })}>{item.id.slice(0, 8)} · {item.status.replaceAll("_", " ")}</Link><small>{item.createdAt}</small></li>)}</ul>{data.runs.length >= 50 ? <p>Only the latest loaded requests are shown; older requests may exist.</p> : null}</details>
          <details className="connectionDetails"><summary>Connection history · {data.healthEvents.filter(item => item.provider === selectedProvider).length} loaded</summary><HistoryPager page={data.healthPage} name="accountHealth" label="Connection health events"/><ul className="connectionHistory">{data.healthEvents.filter(item => item.provider === selectedProvider).map(event => <li key={event.id}>{event.eventType.replaceAll("_", " ")}<small>{event.occurredAt}</small></li>)}</ul></details>
        </div>
      </section>
    </div>}
  </section>;
}
