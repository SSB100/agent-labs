import Link from 'next/link';
import {notFound} from 'next/navigation';
import {AppShell,PageHeader} from '@/components/stage7/app-shell';
import {ConsoleRetainedWorkspace} from '@/components/console/console-retained-workspace';
import {requireOwnerUiContext} from '@/lib/core-ui/data';
import {readEtsySteelOwnerSetup,readEtsySteelOwnerVerification,readEtsySteelOwnerRendererReview} from '@/accounts/etsy-steel-handoff-owner-server';
import {handoffUuid} from '@/accounts/etsy-steel-handoff-contracts';
import {approveEtsyResearchAccess,stopEtsyResearchAccess,startEtsyResearchSignIn} from './actions';
import '../accounts.css';
export const dynamic='force-dynamic';export const revalidate=0;export const maxDuration=300;
const usd=(v:string)=>`$${(Number(v)/1000000).toFixed(6)} USD`;
export default async function EtsyResearchAccessPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const context=await requireOwnerUiContext(),query=await searchParams,businessId=typeof query.business==='string'?query.business:'',operationId=typeof query.operation==='string'?query.operation:'';
 if(!handoffUuid(businessId)||!handoffUuid(operationId))notFound();
 let view:Awaited<ReturnType<typeof readEtsySteelOwnerSetup>>|null=null;
 try{view=await readEtsySteelOwnerSetup(context,businessId,operationId);}catch{/* Never expose RPC/provider bodies. */}
 let verification:Awaited<ReturnType<typeof readEtsySteelOwnerVerification>>=null;
 try{if(view)verification=await readEtsySteelOwnerVerification(context,businessId,operationId);}catch{/* Unknown status cannot imply verified access. */}
 let rendererReview:Awaited<ReturnType<typeof readEtsySteelOwnerRendererReview>>|null=null,rendererReviewKnown=false;
 try{if(view){rendererReview=await readEtsySteelOwnerRendererReview(context,businessId,operationId);rendererReviewKnown=true;}}catch{/* Unavailable review is not a legacy setup or permission to proceed. */}
 return <AppShell active="accounts" context={context} navigationBusinessId={businessId}><ConsoleRetainedWorkspace ownerId={context.userId} secure header={<PageHeader eyebrow="Etsy research access" title="Review your Steel browser connection" description="One owner-controlled sign-in, followed by a separate read-only shop and Insights check." actions={<Link className="coreButton" href={`/dashboard/accounts?business=${businessId}`}>Back to Accounts</Link>}/>} panels={[{id:'etsy-access',label:'Reviewed access',content:<section className="accountSecurePanel" data-agent-labs-secure="true" data-private="true">
 {typeof query.result==='string'&&['consent-required','unavailable','stop-unconfirmed','start-unconfirmed','return-unconfirmed','accounting-pending','verification-pending'].includes(query.result)&&<p role="alert">The requested connection change is not yet confirmed. Check the saved status and retained liability below.</p>}
 {!view?<p role="alert">This reviewed setup is unavailable. No browser session has been started by opening this page.</p>:<>
 {verification&&<p role="status">Account verification: {verification.status.replaceAll('_',' ')}. {verification.reason.replaceAll('_',' ')}{verification.status==='verified'?` · ${verification.observedShopName} · Read access expires ${verification.expiresAt}`:''}</p>}
 <Link className="coreButton" href={`/dashboard/products/etsy-research?${new URLSearchParams({business:businessId,goal:view.scope.goalId,envelope:view.scope.testEnvelopeId})}`}>Return to this Goal’s research test</Link>
 <h2>{view.scope.expectedShopName}</h2><p>Status: {view.status.replaceAll('_',' ')}</p>
 <p>Steel hosts the browser and records its session. Password, MFA and network-secret masking have not been independently verified. You enter your credentials yourself; Agent Labs disconnects its browser observers before owner entry.</p>
 <p>Steel stores a reusable browser authentication profile. Agent Labs may reuse it only for read-only Etsy Marketplace Insights access until {view.scope.profileAccessExpiresAt}. This application access expiry does not establish when Steel deletes the profile. Recording retention depends on the provider plan. Immediate provider-side profile deletion is not qualified; Stop blocks application reuse and requests session cleanup.</p>
 <p>The existing reviewed test envelope includes at most {usd(view.scope.maximumBrowserMicrounits)} for this login session and {usd(view.scope.verificationMaximumMicrounits)} for one separate shop-identity and Insights-landing check. These are reserved ceilings, not spending targets. Verification submits no research query.</p>
 {!rendererReviewKnown&&<p role="alert">The saved browser policy review is unavailable. Approval and starting a new sign-in remain blocked until it can be verified.</p>}
 {rendererReview&&rendererReview.status!=='legacy'&&<section aria-label="Browser policy review"><h3>Browser policy review</h3><p>Status: {rendererReview.status.replaceAll('_',' ')}. This candidate policy permits only the bounded shop and Insights landing verification, with no research query. Research access remains unqualified until successful verification and a separately bound source check.</p><dl style={{overflowWrap:'anywhere'}}><dt>Policy version</dt><dd>{rendererReview.policyVersion}</dd><dt>Review hash</dt><dd>{rendererReview.reviewHash}</dd><dt>Policy hash</dt><dd>{rendererReview.policyHash}</dd><dt>Landing controls</dt><dd>{rendererReview.landingControlsVersion} · {rendererReview.landingControlsHash}</dd><dt>Review expiry</dt><dd>{rendererReview.expiresAt}</dd></dl></section>}
 <p>Approval expires at {view.scope.approvalExpiresAt}. Do not enter payment details or accept unexpected account, subscription or permission changes.</p>
 {view.cleanupPending&&<p role="alert">Browser cleanup is still pending. Its reserved liability remains held.</p>}
 {view.status==='pending_approval'&&rendererReviewKnown&&(rendererReview?.status==='legacy'||rendererReview?.status==='awaiting_approval')&&<form action={approveEtsyResearchAccess}><input type="hidden" name="businessId" value={businessId}/><input type="hidden" name="operationId" value={operationId}/><input type="hidden" name="scopeHash" value={view.scopeHash}/><input type="hidden" name="disclosureHash" value={view.scope.disclosureHash}/><input type="hidden" name="approvalRevision" value={view.scope.approvalRevision}/>{rendererReview&&rendererReview.status!=='legacy'&&<input type="hidden" name="rendererReviewHash" value={rendererReview.reviewHash}/>}<label><input type="checkbox" name="persistentAccessConsent" required/> I approve this recorded owner sign-in, the scoped verification, and the disclosed persistent Etsy read access.</label><button type="submit" className="coreButton coreButton-primary">Approve reviewed access</button></form>}
 {view.status==='approved'&&rendererReviewKnown&&(rendererReview?.status==='legacy'||rendererReview?.status==='approved')&&!view.receipts.some(r=>r.status==='awaiting_owner'||r.status==='profile_pending_verification')&&<form action={startEtsyResearchSignIn}><input type="hidden" name="businessId" value={businessId}/><input type="hidden" name="operationId" value={operationId}/><button className="coreButton" type="submit">Start approved private sign-in</button></form>}
 {view.status==='approved'&&view.receipts.filter(r=>r.status==='awaiting_owner'&&r.handoffId).slice(-1).map(r=><Link key={r.receiptHash} className="coreButton" href={`/dashboard/accounts/etsy-research/sign-in?${new URLSearchParams({business:businessId,operation:operationId,handoff:r.handoffId!})}`} prefetch={false}>Resume private sign-in</Link>)}
 <form action={stopEtsyResearchAccess}><input type="hidden" name="businessId" value={businessId}/><input type="hidden" name="operationId" value={operationId}/><button type="submit" className="coreButton">Stop this connection setup</button></form>
 {view.receipts.map(r=><p key={r.receiptHash}>{r.status.replaceAll('_',' ')} · {r.reason.replaceAll('_',' ')} · Liability: {r.liabilityState.replaceAll('_',' ')}</p>)}
 </>}
 </section>}]} /></AppShell>;
}
