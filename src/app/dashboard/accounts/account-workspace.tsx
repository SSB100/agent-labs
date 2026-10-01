import Link from "next/link";
import { randomUUID } from "node:crypto";
import { ACCOUNT_PROVIDERS, type AccountWorkspace, type AccountSetupRun } from "@/accounts/contracts";
import { StatusPill } from "@/components/stage7/app-shell";
import { saveBusinessAccountProfile, requestAccountSetup, approveReviewedAccountSetup, cancelAccountSetup,
  resumeVerifiedAccountSetup, disconnectBusinessAccount, startApprovedAccountRegistration, finishOwnerRegistrationSession, removeOwnerWebsitePassword } from "./actions";

export const accountMessages: Record<string, string> = {
  "password-removed": "The saved Agent Labs website-password copy was removed. The password at the provider is unchanged.",
  "password-stored": "Your unique website password was saved encrypted, separately from provider tokens. It has not been verified with the provider.",
  "password-storage-unavailable": "The password could not be stored. Check that both entries match, meet the length requirements and that the connection is current. No credential details were logged.",
  "profile-saved-browser-pending": "Profile saved and old approvals invalidated, but remote browser closure is unconfirmed. Close any owner browser tab; its session expires within 15 minutes.",
  "verified-browser-pending": "Provider connection verified and saved. Remote signup browser closure is unconfirmed; close any owner browser tab and retry its close action.",
  "disconnected-browser-pending": "Agent Labs account access was disconnected. Remote signup browser closure is unconfirmed; close any owner browser tab and retry its close action.",
  "profile-saved": "Account profile saved. New requests will use this revision.",
  "profile-unavailable": "The profile could not be saved. Refresh to check the latest revision; no existing data was overwritten.",
  "review-ready": "Review the exact service, data and access below before approving.",
  "consent-required": "Confirm each required consent before continuing.",
  "setup-unavailable": "Account setup could not proceed. Refresh to inspect its current state.",
  "approval-unavailable": "Approval was not accepted. The profile or request may have changed or expired. Review a fresh request.",
  "registration-prepared": "Inspect the request below. A prepared form is not a created account; secure owner completion and independent verification are still required.",
  "owner-step-finished": "The owner browser was closed. Connect and independently verify the account before setup can complete.",
  "browser-release-unconfirmed": "The app has disabled its owner-session link, but remote browser closure is unconfirmed. Close your live browser tab. The session expires within 15 minutes; you can retry the close action.",
  approved: "Your exact request is approved. Follow the secure owner step below; verification is still required.",
  cancelled: "Setup stopped. An already completed provider action cannot be reversed here.",
  verified: "The provider connection was verified and saved for this Business.",
  "verification-unavailable": "The account could not be verified. Check the intended store, minimum access and approval expiry, then try a fresh request. Provider details and credentials were not logged.",
  "secure-entry-required": "Use the secure owner entry step for this Printful request.",
  disconnected: "Agent Labs access was disconnected locally. Revoke the provider grant or token at the provider too.",
  "disconnect-unavailable": "The connection could not be disconnected. Refresh before retrying; its revision may have changed.",
};
function RunFields({ run, businessId }: { run: AccountSetupRun; businessId: string }) {
  return <><input type="hidden" name="businessId" value={businessId} /><input type="hidden" name="runId" value={run.id} /><input type="hidden" name="revision" value={run.revision} /></>;
}
function SetupRequest({ run, workspace }: { run: AccountSetupRun; workspace: AccountWorkspace }) {
  const spec = ACCOUNT_PROVIDERS[run.provider], waiting = ["approved", "owner_handoff", "preparation_started"].includes(run.status);
  const expired = !!run.approvalExpiresAt && Date.parse(run.approvalExpiresAt) <= Date.parse(workspace.observedAt);
  return <article className="accountRequest">
    <div className="sectionTitleRow"><h3>{run.mode === "create" ? "Set up" : "Connect"} {spec.name}</h3><StatusPill status={expired && !["verified", "cancelled"].includes(run.status) ? "expired" : run.status} /></div>
    <p>{run.disclosure.purpose}</p>
    <dl className="accountFacts"><div><dt>Destination</dt><dd>{run.disclosure.destination}</dd></div>
      <div><dt>Profile data shared</dt><dd>{Object.entries(run.disclosure.disclosedData).length ? Object.entries(run.disclosure.disclosedData).map(([key, value]) => <span className="accountDataValue" key={key}>{key}: {value}</span>) : "None for an API connection"}</dd></div>
      <div><dt>Requested access</dt><dd>{run.disclosure.scopes.join(", ")}</dd></div>
      <div><dt>Spending authority</dt><dd>None. Stop for any charge, subscription or new financial commitment.</dd></div>
      <div><dt>Approval expires</dt><dd>{run.approvalExpiresAt ? new Date(run.approvalExpiresAt).toLocaleString("en", { timeZone: "UTC" }) + " UTC" : "Before execution"}</dd></div>
    </dl>
    <p><a href={spec.termsUrl} target="_blank" rel="noreferrer">{spec.name} terms</a>{" · "}<a href={run.provider === "etsy" ? "https://www.etsy.com/legal/privacy" : "https://www.printful.com/policies/privacy"} target="_blank" rel="noreferrer">Privacy policy</a></p>
    {run.provider === "etsy" ? <p className="accountHelp">Etsy access includes draft listing writes. Connection approval does not authorize a listing change, publication, shop-opening fee or purchase; those actions retain their separate gates.</p> : <p className="accountHelp">Printful access is restricted to catalog reads in Agent Labs. Provider scopes and the exact store are independently checked. Product changes, orders and spending remain separate.</p>}
    {run.mode === "create" ? <p className="accountWarning">{workspace.registrationAvailable ? "The approved Browserbase flow prepares only the listed ordinary fields, then disconnects automation for secure owner completion. It does not submit passwords or infer account creation." : "Automatic registration is waiting for approved secure Browserbase activation, budget and session entitlement. No signup fields are sent through the current recorded browser. You can complete signup directly with the provider, then connect the account."} Saved approval alone does not mean an account was created.</p> : null}
    {run.status === "pending_approval" && !expired ? <form action={approveReviewedAccountSetup} className="accountConsentForm">
      <RunFields run={run} businessId={workspace.businessId} /><input type="hidden" name="disclosureHash" value={run.disclosureHash} />
      <label><input type="checkbox" name="dataConsent" required /> I approve the exact destination and profile data shown above</label>
      <label><input type="checkbox" name="accessConsent" required /> I approve this Business connection and the listed access, with no spending authority</label>
      {run.disclosure.termsAcknowledgementRequired ? <label><input type="checkbox" name="termsConsent" required /> I have reviewed the linked terms and privacy policy and approve their acceptance for this specific signup when the supported flow is available</label> : null}
      {run.disclosure.browserProcessing ? <label><input type="checkbox" name="browserConsent" required /> I approve Browserbase processing this signup session and the displayed profile data for the intended service. Session recording and logs will be disabled; this does not mean the provider has zero operational data retention. Activation and browser costs need separate approval.</label> : null}
      <button className="coreButton coreButton-primary" disabled={!workspace.configured} type="submit">Approve exact request</button>
    </form> : null}
    {waiting && !expired && (run.mode === "connect" || run.status === "owner_handoff") ? <div className="accountNextStep">
      {run.provider === "printful" ? <><h4>Secure owner step</h4><p>Create or select a token for only the intended Printful store, with only stores_list/read if a scope is required. Enter it directly in the secure owner form. Never send it to an AI chat.</p><Link className="coreButton coreButton-primary" href={`/dashboard/accounts/secure?business=${workspace.businessId}&run=${run.id}`}>Open secure Printful connection</Link></>
        : <><h4>Authorize Etsy, then verify</h4><p>Use the existing secure OAuth flow for the intended shop. Return here to verify the exact connection.</p><Link className="coreButton" href={`/dashboard/etsy?business=${workspace.businessId}`}>Open Etsy connection</Link><form action={resumeVerifiedAccountSetup}><RunFields run={run} businessId={workspace.businessId} /><button className="coreButton coreButton-primary" type="submit">Verify Etsy connection</button></form></>}
    </div> : null}
    {run.mode === "create" && run.status === "approved" && !expired ? <form action={startApprovedAccountRegistration}><RunFields run={run} businessId={workspace.businessId} /><button className="coreButton coreButton-primary" disabled={!workspace.registrationAvailable} type="submit">Prepare approved signup</button></form> : null}
    {run.mode === "create" && run.status === "owner_handoff" && run.preparationReceipt?.reasonCode === "secure_owner_steps" && !expired ? <div className="accountNextStep"><Link className="coreButton coreButton-primary" href={`/dashboard/accounts/registration?business=${workspace.businessId}&run=${run.id}`}>Open secure owner signup</Link><form action={finishOwnerRegistrationSession}><RunFields run={run} businessId={workspace.businessId} /><button className="coreButton" type="submit">Close owner browser</button></form></div> : null}
    {run.mode === "create" && waiting ? <a href={spec.registrationUrl} target="_blank" rel="noreferrer">Open {spec.name} signup securely in your own browser</a> : null}
    {!["verified", "cancelled", "completed"].includes(run.status) ? <form action={cancelAccountSetup}><RunFields run={run} businessId={workspace.businessId} /><button className="coreButton" type="submit">Stop setup</button></form> : null}
    {run.receipt ? <p className="accountHelp">Verification receipt saved. Account access does not qualify product execution or publication.</p> : null}
  </article>;
}
export function BusinessAccountWorkspace({ data }: { data: AccountWorkspace }) {
  return <section className="dashboardSection accountWorkspace" id="business-accounts" aria-labelledby="business-account-title">
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
        <form action={requestAccountSetup}><input type="hidden" name="businessId" value={data.businessId} /><input type="hidden" name="provider" value={provider} /><input type="hidden" name="idempotencyKey" value={randomUUID()} />
          <label>Account state<select name="mode" defaultValue="connect"><option value="connect">Connect an existing account</option><option value="create">I need a new account</option></select></label>
          <button className="coreButton" type="submit" disabled={!data.configured || !data.profile}>Prepare exact review</button></form></article>)}</div>
      {data.accounts.length ? <div className="accountConnections"><h3>Connected account registry</h3>{data.accounts.map(account => <article className="accountRequest" key={account.id}><div className="sectionTitleRow"><h4>{ACCOUNT_PROVIDERS[account.provider].name} · {account.label || account.externalAccountId}</h4><StatusPill status={account.status} /></div><p>Access: {account.scopes.join(", ")}</p><p className="accountHelp">Website password: {account.passwordStored ? "Owner-saved encrypted credential; not provider-verified" : "Not stored"}</p>{account.status === "connected" ? <Link className="coreButton" href={`/dashboard/accounts/password?business=${data.businessId}&account=${account.id}`}>{account.passwordStored ? "Replace saved website password" : "Save unique website password"}</Link> : null}{account.status === "connected" ? <form action={disconnectBusinessAccount} className="accountConsentForm"><input type="hidden" name="businessId" value={data.businessId} /><input type="hidden" name="provider" value={account.provider} /><input type="hidden" name="connectionRevision" value={account.revision} /><label><input type="checkbox" name="disconnectConsent" required /> Stop Agent Labs API access and remove its saved provider token. Any separately saved website password is retained until I remove it below. The provider token/grant may also need revocation at the provider.</label><button className="coreButton" type="submit">Disconnect locally</button></form> : null}{account.passwordStored ? <form action={removeOwnerWebsitePassword} className="accountConsentForm"><input type="hidden" name="businessId" value={data.businessId} /><input type="hidden" name="provider" value={account.provider} /><input type="hidden" name="connectionId" value={account.id} /><input type="hidden" name="passwordRevision" value={account.passwordRevision ?? ""} /><label><input type="checkbox" name="passwordRemovalConsent" required /> Permanently remove this saved Agent Labs password copy. I have my own copy; the provider password will not change.</label><button className="coreButton" type="submit">Remove saved website password</button></form> : null}</article>)}</div> : <p className="accountHelp">No Business account has been verified in this registry yet.</p>}
      <div className="accountRequests"><h3>Setup requests</h3>{data.runs.length ? data.runs.map(run => <SetupRequest key={run.id} run={run} workspace={data} />) : <p>No setup requests yet.</p>}</div>
      {data.healthEvents.length ? <div className="accountHealth"><h3>Connection history</h3><ul>{data.healthEvents.map(event => <li key={event.id}>{event.provider}: {event.eventType.replaceAll("_", " ")} · {event.occurredAt}</li>)}</ul></div> : null}
    </> : null}
  </section>;
}
