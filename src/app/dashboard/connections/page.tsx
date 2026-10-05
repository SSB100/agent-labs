import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell,PageHeader } from "@/components/stage7/app-shell";
import { ConsoleRetainedWorkspace } from "@/components/console/console-retained-workspace";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { readConnectionQualification } from "@/connections/server";
import { verifyOwnerBusiness } from "@/lib/core-ui/owner-business";
import { UUID } from "@/connections/contracts";
import "./connections.css";
import { qualifyConnection,disconnectConnection } from "./actions";
export const dynamic="force-dynamic";
export default async function ConnectionQualificationPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const context=await requireOwnerUiContext(),query=await searchParams,businessId=typeof query.business==="string"?query.business:null;
 if(!businessId||!UUID.test(businessId))notFound();
 const verified=await verifyOwnerBusiness(context,businessId);
 if(!verified&&!context.businessesUnavailable)notFound();
 const business=verified?context.businesses.find(b=>b.id===businessId)!:{name:"Business unavailable"};
 const view=verified?await readConnectionQualification(context,businessId):{businessId,unavailable:true,configured:false,grants:[],connections:[],attempts:[]};
 return <AppShell toolDestination="accounts" active="accounts" context={context} navigationBusinessId={businessId}><ConsoleRetainedWorkspace ownerId={context.userId}
 header={<PageHeader eyebrow={`${business.name} · External access`} title="Read-only store connections" description="Verify the exact store and retain scoped credentials for later authorized work." actions={<Link className="coreButton" href={`/dashboard?view=connections&business=${businessId}`}>Back to Connections</Link>}/>}
 notice={<p className="coreNotice">This page reads saved status only. A connection does not authorize research, AI processing, listing writes, publication or fulfilment.</p>}
 panels={[{id:"access",label:"Store access",content:<div className="r11Connections">
 {view.unavailable?<p role="alert">Qualification records are unavailable. No connection or new grant can be assumed.</p>:<>
 <details><summary>Configured credential fingerprints</summary><p>Nonsecret SHA-256 identifiers for the server configuration used in approval.</p><p>Etsy: {view.configurationFingerprints?.etsy??"Not configured"}</p><p>Printful primary: {view.configurationFingerprints?.printfulPrimary??"Not configured"}</p></details><h2>Saved bindings</h2>{view.connections.length?view.connections.map(c=><section key={c.id}><h3>{c.provider} · {c.label}</h3><p>{c.status} · {c.permittedOperations.join(", ")} · {c.custody==="environment"?"Server environment token":"Encrypted OAuth custody"}</p><p>Provider credential scopes: {c.providerScopes?.join(", ")||"none reported"}. These can be broader than Agent Labs’ permitted operations.</p><p>Account {c.externalAccountId} · revision {c.revision}</p><p>Last verified {c.verifiedAt}. Local access cutoff {c.expiresAt}. This is not a provider expiry guarantee.</p><form action={disconnectConnection}><input type="hidden" name="businessId" value={businessId}/><input type="hidden" name="connectionId" value={c.id}/><input type="hidden" name="revision" value={c.revision}/><button className="coreButton" disabled={c.status==="revoked"}>Disconnect locally</button></form></section>):<p>No verified store binding is saved for this Business.</p>}
 <h2>Approved verification</h2><p>Showing {view.grants.length} of {view.grantTotal??"unknown total"} grants, with unused current grants first.</p><p>Etsy uses only shop and listing read scopes. Printful keeps catalog.read and the exact selected store. No order/customer data or model calls are included.</p>
 {view.grants.length?view.grants.map(g=><section key={g.id}><h3>{g.provider} · {g.expectedAccount}</h3><p>{g.state} · expires {g.expiresAt}</p>{!g.configured?<p>Production credential configuration is incomplete. Verification cannot start yet.</p>:null}{g.credentialAlias?<p>Server credential alias: {g.credentialAlias}. Provider credential scopes: {g.providerScopeMode==="inspect_and_record"?"Unverified; inspect and record this existing token’s actual privileges during verification":g.providerScopes?.join(", ")||"none reported"}. Agent Labs is limited to this store and catalog.read; the credential itself may carry broader provider privileges.</p>:null}
 <form action={qualifyConnection}><input type="hidden" name="businessId" value={businessId}/><input type="hidden" name="grantId" value={g.id}/><input type="hidden" name="provider" value={g.provider}/>
 <label><input type="checkbox" name="readConsent" required disabled={g.state!=="available"||!g.configured}/>Verify this exact store using the approved bounded API reads.</label><br/>
 <label><input type="checkbox" name="custodyConsent" required disabled={g.state!=="available"||!g.configured}/>{g.provider==="etsy"?"Save the resulting read-only OAuth tokens encrypted on the server for future separately authorized use.":"Bind the configured environment token to this store and credential revision without copying it into the database."}</label><br/>
 <button className="coreButton" disabled={g.state!=="available"||!g.configured}>{g.provider==="etsy"?"Continue to Etsy read-only consent":"Verify Printful store"}</button></form></section>):<p>No current verification grant is installed. Existing access is not renewed automatically.</p>}
 <h2>Recent verification attempts</h2><p>Showing {view.attempts.length} of {view.attemptTotal??"unknown total"} saved attempts (latest 25). Expired or failed attempts are retained and never retried automatically.</p>{view.attempts.map(a=><p key={a.id}>{a.provider} · {a.status} · {a.createdAt}{a.reason?` · ${a.reason}`:""}</p>)}
 <p>Disconnecting locally does not revoke access at the provider. Etsy OAuth consent and Printful token management remain under your control.</p>
 </>}
 </div>}]} /></AppShell>;
}
