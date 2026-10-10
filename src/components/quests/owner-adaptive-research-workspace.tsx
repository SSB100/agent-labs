"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { AdaptiveResearchPreparationInput } from "@/products/discovery-r12-adaptive-preparation";
import type { AdaptiveOwnerActionRecord, AdaptiveOwnerCatalog, AdaptiveOwnerReceipt } from "@/products/discovery-r12-adaptive-owner-contract";
import { prepareAdaptiveOwnerResearchAction, confirmAdaptiveOwnerResearchAction, stopAdaptiveOwnerResearchAction, continueAdaptiveOwnerResearchAction, checkAdaptiveOwnerReceiptsAction } from "@/app/dashboard/quests/research/actions";
import { ownerAdaptiveSetupHref, ownerResearchRequestId, ownerResearchScopeHref, ownerResearchUsd } from "@/lib/core-ui/owner-research-form";
import { OwnerObservationDisclosure } from "./owner-observation-disclosure";
import { OwnerObservationIntakeForm } from "./owner-observation-intake";
import type { OwnerObservationSelection } from "@/products/discovery-r12-owner-observation";
import { OwnerAdaptiveResearchPacket } from "./owner-adaptive-research-packet";

type Props = { businessId?:string; ownerId: string; catalog: AdaptiveOwnerCatalog | null; selectedReceipt: AdaptiveOwnerReceipt | null; observedAt: number };
const positive = (value: string) => /^(0|[1-9][0-9]{0,15})$/.test(value) ? BigInt(value) : BigInt(0);
const max = (a: bigint, b: bigint) => a > b ? a : b;
const min = (a: bigint, b: bigint) => a < b ? a : b;
const OWNER_SOURCE_PAUSE_MESSAGE = "The selected Etsy captures cannot answer the next evidence question. Save the missing genuine observation, then review the scope and permissions before further research. The current immutable packet cannot acquire new evidence or another source automatically.";
const waitFor = (milliseconds: number, signal: AbortSignal) => new Promise<boolean>(resolve => {
  if (signal.aborted) return resolve(false);
  const timer=window.setTimeout(()=>{signal.removeEventListener("abort",cancel);resolve(true);},milliseconds);
  const cancel=()=>{window.clearTimeout(timer);resolve(false);};signal.addEventListener("abort",cancel,{once:true});
});

function AdaptiveActionHistory({ actions }: { actions: AdaptiveOwnerActionRecord[] }) {
  return <section aria-label="Adaptive decisions and outcomes"><h3>Recorded decisions and findings</h3>
    {actions.length ? <ol>{actions.map(item=><li key={item.action.ordinal}><strong>{item.action.kind} · {item.state}</strong><p>{item.action.question}</p><p>Recorded outcome: {item.outcome??"not yet independently recorded"}. Known cost: {ownerResearchUsd(item.committedMicrounits)}.</p>{item.unresolvedQuestions.length?<p>Still unresolved: {item.unresolvedQuestions.join("; ")}</p>:null}</li>)}</ol> : <p>No adaptive action is recorded for this setup. Confirmation alone does not dispatch one.</p>}
  </section>;
}

export function OwnerAdaptiveResearchWorkspace({ businessId:requestedBusinessId, ownerId, catalog, selectedReceipt, observedAt }: Props) {
  const router = useRouter(), fieldId = useId();
  const [observationBusy,setObservationBusy]=useState(false);
  const observationPending=useRef(false);
  const [disclosureHash,setDisclosureHash]=useState<string|null>(null);
  const [ownerObservationRef,setOwnerObservationRef]=useState<OwnerObservationSelection|null>(selectedReceipt?.ownerObservationRef??null);
  const [choice, setChoice] = useState(selectedReceipt ? `${selectedReceipt.profileId}:${selectedReceipt.grantId}` : "");
  const [marketSetKey, setMarketSetKey] = useState(selectedReceipt?.selection.marketSetKey ?? "");
  const [topicKey, setTopicKey] = useState(selectedReceipt?.selection.topicKey ?? "");
  const [actionCount, setActionCount] = useState(selectedReceipt?.preview.maximumActions ?? 10);
  const [receipt, setReceipt] = useState(selectedReceipt), [consentHash, setConsentHash] = useState<string | null>(null);
  const [message, setMessage] = useState(""), [busy, setBusy] = useState<"prepare" | "confirm" | "stop" | null>(null);
  const [running, setRunning] = useState(false), [checkingReceipts,setCheckingReceipts]=useState(false);
  const [now, setNow] = useState(observedAt);
  const pending = useRef(false), generation = useRef(0), mounted = useRef(true), identities = useRef(new Map<string, string>());
  const runInFlight = useRef(false), runAbort = useRef<AbortController | null>(null);
  const messageRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { const token = generation; mounted.current = true; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => { mounted.current = false; token.current++; runAbort.current?.abort(); window.clearInterval(timer); }; }, []);
  useEffect(() => { const clear = () => setConsentHash(null); window.addEventListener("pageshow", clear); window.addEventListener("popstate", clear); return () => { window.removeEventListener("pageshow", clear); window.removeEventListener("popstate", clear); }; }, []);
  useEffect(() => { if (message && !running) messageRef.current?.focus(); }, [message,running]);
  useEffect(() => { if (selectedReceipt && !pending.current && !runInFlight.current) setReceipt(selectedReceipt); }, [selectedReceipt]);

  function edit(change: () => void) { generation.current++; setReceipt(null); setConsentHash(null); setMessage(""); change(); }
  const intakeBusinessId=catalog?.businessId??requestedBusinessId;
  const intake=intakeBusinessId?<OwnerObservationIntakeForm key={intakeBusinessId} businessId={intakeBusinessId} grantId="" disabled={!!busy} selectionLocked={!!receipt} onBusyChange={value=>{observationPending.current=value;setObservationBusy(value);}} selection={ownerObservationRef} onSelect={value=>edit(()=>setOwnerObservationRef(value))}/>:null;
  if (!catalog) return <section className="ownerResearchAdaptive" aria-label="Adaptive research"><h2>Adaptive research</h2><p>The exact adaptive catalog is unavailable. No adaptive preparation or action can be selected from this page.</p>{intake}</section>;
  const { businessId, goalId, predecessorClosure: predecessor, funding, business } = catalog;
  const predecessorHash = catalog.predecessorClosureHash;
  const choices = catalog.grants.flatMap(grant => catalog.profiles.filter(item => item.profile.id === grant.profileId && item.profile.version==="r12.owner-research-profile.3").map(item => ({ grant, ...item })));
  const selected = choices.find(item => `${item.profile.id}:${item.grant.id}` === choice);
  const grant = selected?.grant, profile = selected?.profile;
  const grantReady = !!grant && grant.allowsPaidFollowups && grant.remainingScopes > 0 &&
    Date.parse(grant.expiresAt) > now && grant.goalId === goalId && grant.businessId === businessId &&
    grant.goalRevision === predecessor?.goalRevision && grant.goalHash === predecessor.goalHash;
  const runMaximum = grant && profile ? min(BigInt(10_000_000), min(BigInt(profile.maximumRunMicrousd), min(positive(grant.maximumRunMicrounits), positive(grant.remainingAllocationMicrounits)))) : BigInt(0);
  const proposedBusiness = max(positive(business.currentLimitMicrounits), positive(business.committedMicrounits) + runMaximum);
  const proposedFunding = funding ? max(positive(funding.currentLimitMicrounits), positive(funding.committedMicrounits) + runMaximum) : BigInt(0);
  const actions = Math.min(actionCount, grant?.maximumActions ?? 10, 10);
  const canPrepare = catalog.eligible && !!predecessor && !!catalog.predecessorClosureHash && catalog.imports.length === 5 && !!funding &&
    grantReady && runMaximum > BigInt(0) && !business.hasUnknown && !funding.hasUnknown && funding.pendingMicrounits === "0" &&
    Date.parse(catalog.deadline) > now && !!profile && Date.parse(profile.validUntil) > now &&
    !!profile.marketSets.find(item => item.key === marketSetKey) && !!profile.topics.find(item => item.key === topicKey) &&
    actions >= 1 && !catalog.activation && !!ownerObservationRef && !observationBusy;
  const quoteExpired = !!receipt && Date.parse(receipt.quote.validUntil) <= now;
  const packetExpired = !!receipt && Date.parse(receipt.preview.expiresAt) <= now;
  const canConfirm = !!receipt && !receipt.confirmed && !receipt.activated && !receipt.stopped && !quoteExpired && !packetExpired && consentHash === receipt.setupHash && (!receipt.ownerObservationRef || disclosureHash===receipt.ownerObservationRef.manifestHash);
  // This notice survives a route refresh because it comes from authenticated
  // saved review readback, never from NME alone or client-side inference.
  const ownerSourcePaused = !!receipt?.activated && !receipt.stopped && receipt.preview.version === "r12.adaptive-research-preview.2" &&
    catalog.activation?.setupId === receipt.setupId && catalog.activation.scopeId === receipt.scopeId &&
    !catalog.activation.stopped && catalog.activation.pauseReason === "owner_source_operation_required";


  async function requestId(operation: string, input: unknown, superseded?: string) {
    const digest = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(input)));
    const fingerprint = Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,"0")).join("");
    const key = `r12-owner-adaptive:v1:${ownerId}:${businessId}:${goalId}:${operation}:${fingerprint}`;
    let storage: Storage | null = null; try { storage=window.sessionStorage; } catch { /* In-memory recovery remains available. */ }
    return ownerResearchRequestId(key,identities.current,storage,()=>crypto.randomUUID(),superseded);
  }
  async function prepare(event?: FormEvent, fresh=false) {
    event?.preventDefault();
    if (pending.current || observationPending.current || !canPrepare || !predecessor || !selected || !grant) return;
    pending.current=true; setBusy("prepare"); setConsentHash(null); setMessage(""); const request=++generation.current;
    const input: Omit<AdaptiveResearchPreparationInput,"submissionId"> = {
      ownerObservationRef,
      businessId,goalId,goalRevision:predecessor.goalRevision,profileId:selected.profile.id,profileHash:selected.profileHash,
      grantId:grant.id,marketSetKey,topicKey,predecessorPlanId:predecessor.predecessorPlanId,predecessorPlanHash:predecessor.predecessorPlanHash,
      predecessorScopeId:predecessor.predecessorScopeId,predecessorScopeHash:predecessor.predecessorScopeHash,
      maximumActions:actions,maximumRunMicrounits:runMaximum.toString(),businessLifetimeLimitMicrounits:proposedBusiness.toString(),
      researchLifetimeLimitMicrounits:proposedFunding.toString(),
    };
    try {
      const submissionId=await requestId("prepare",input,fresh && (quoteExpired || packetExpired) ? receipt?.submissionId : undefined);
      const result=await prepareAdaptiveOwnerResearchAction({...input,submissionId});
      if (!mounted.current || request!==generation.current) return;
      if (!result.ok) { setMessage(result.message); return; }
      const saved=result.receipt;
      if (saved.businessId!==businessId || saved.goalId!==goalId || saved.grantId!==grant.id || saved.profileId!==profile?.id || saved.submissionId!==submissionId ||
        saved.preview.predecessorHash!==predecessorHash || saved.preview.maximumRunMicrounits!==runMaximum.toString() ||
        saved.preview.maximumActions!==actions || saved.selection.marketSetKey!==marketSetKey || saved.selection.topicKey!==topicKey || saved.ownerObservationRef?.manifestHash!==ownerObservationRef?.manifestHash) {
        setMessage("The saved packet does not match this exact selection. Reload and inspect its server record before proceeding."); return;
      }
      setReceipt(saved);setMessage("Adaptive packet saved. Review the prior result, selected Etsy captures, three-role costs and data recipients before confirming. No paid call has started.");
      router.replace(ownerAdaptiveSetupHref(businessId,goalId,saved.setupId));
    } catch { if (mounted.current && request===generation.current) setMessage("The response was interrupted. Retry the unchanged request to recover its saved receipt, or reload the exact setup. No success was assumed."); }
    finally { if (mounted.current && request===generation.current) { pending.current=false;setBusy(null); } }
  }
  async function transition(operation: "confirm" | "stop") {
    if (pending.current || !receipt || operation==="confirm" && !canConfirm) return;
    if (operation==="stop") runAbort.current?.abort();
    pending.current=true;setBusy(operation);setMessage("");const request=++generation.current, exact=receipt;
    try {
      const input={businessId,setupId:exact.setupId,setupHash:exact.setupHash};
      const submissionId=await requestId(operation,input);
      const result=await (operation==="confirm"?confirmAdaptiveOwnerResearchAction:stopAdaptiveOwnerResearchAction)({...input,submissionId});
      if (!mounted.current || request!==generation.current) return;
      if (!result.ok) { setMessage(result.message); return; }
      const saved=result.receipt;
      if (saved.businessId!==businessId || saved.goalId!==goalId || saved.setupId!==exact.setupId || saved.setupHash!==exact.setupHash || saved.scopeId!==exact.scopeId ||
        operation==="confirm" && !saved.confirmed && !saved.stopped || operation==="stop" && !saved.stopped) {
        setMessage("The returned status does not match this exact setup. Reload before taking another action.");return;
      }
      setReceipt(saved);setConsentHash(null);
      setMessage(saved.stopped ? "This adaptive setup is stopped. Earlier evidence, costs and decisions remain recorded." : "Exact permission is saved. No paid action was dispatched by confirmation; review the current action status before any further work.");
      router.refresh();
    } catch { if (mounted.current && request===generation.current) setMessage("The response was interrupted. Reload this exact setup or retry the unchanged request. No success was assumed."); }
    finally { if (mounted.current && request===generation.current) { pending.current=false;setBusy(null); } }
  }

  async function run() {
    if (!receipt?.activated || receipt.stopped || pending.current || runInFlight.current || busy) return;
    const signal=new AbortController();runAbort.current=signal;runInFlight.current=true;setRunning(true);setMessage("Advancing the exact saved run within its approved limits. Stop remains available.");
    const exact=receipt;
    let lastProgressToken: string | null=null,unchangedProgress=0;
    try {
      while (!signal.signal.aborted) {
        const response=await continueAdaptiveOwnerResearchAction(businessId,exact.scopeId);
        if (!mounted.current || signal.signal.aborted) return;
        if (!response.ok) {setMessage(response.message);return;}
        const result=response.result;
        if (result.status==="completed") {setMessage("This bounded research execution finished. Review its independent result and remaining limits; the Quest is not declared complete.");return;}
        if (result.status==="stopped") {setMessage("This adaptive run is stopped. Earlier findings and costs remain recorded.");return;}
        if (result.status==="blocked") {setMessage("Further adaptive work is blocked. Review saved findings, costs and authority before deciding what to do next.");return;}
        if (result.status!=="waiting") {setMessage("Progress is saved. Reload the exact action record before resuming this run.");return;}
        if (result.status==="waiting" && !["continue_saved_progress","receipt_pending"].includes(result.reason)) {
          setMessage(result.reason==="owner_source_operation_required"?OWNER_SOURCE_PAUSE_MESSAGE:"The saved run is paused by a guard. Review the current research record before resuming.");return;
        }
        const wake=typeof result.wakeAt==="string"?Date.parse(result.wakeAt):NaN;
        if (result.reason==="receipt_pending" && !Number.isFinite(wake)) {setMessage("A provider receipt is still pending. Reload the saved record before resuming; no new call was assumed.");return;}
        if (result.reason==="continue_saved_progress") {
          if (Date.parse(exact.preview.expiresAt) <= Date.now()) {setMessage("The approved send window has expired. Progress is saved; reload this exact setup for receipt readback or review.");return;}
          if (typeof result.progressToken!=="string" || !result.progressToken) {setMessage("Progress is saved, but this browser cannot verify a new durable step. Reload this exact setup before resuming.");return;}
          unchangedProgress=result.progressToken===lastProgressToken?unchangedProgress+1:0;
          lastProgressToken=result.progressToken;
          if (unchangedProgress>=3) {setMessage("The saved run has not advanced across three checks. Review its durable record before resuming; no further call was assumed.");return;}
        }
        const delay=result.reason==="receipt_pending"?Math.max(2_000,wake-Date.now()):750;
        setMessage(result.reason==="receipt_pending"?"A provider receipt is pending. The next check will wait until its saved eligibility time; Stop remains available.":"Progress is saved. Continuing the approved run after a short pause; Stop remains available.");
        if (!await waitFor(delay,signal.signal)) return;
      }
    } catch {if (mounted.current && !signal.signal.aborted) setMessage("The run response was interrupted. Reload its saved actions and costs before resuming; no successful call was assumed.");}
    finally {if (runAbort.current===signal) runAbort.current=null;runInFlight.current=false;if(mounted.current){setRunning(false);if(!signal.signal.aborted)router.refresh();}}
  }

  async function checkReceipts() {
    const exact=receipt,activation=catalog?.activation;
    if (!exact?.stopped || !activation?.pendingReceiptReadback || activation.pendingReceiptCount<1 ||
        activation.setupId!==exact.setupId || activation.scopeId!==exact.scopeId || pending.current || runInFlight.current || busy) return;
    const signal=new AbortController();runAbort.current=signal;runInFlight.current=true;setCheckingReceipts(true);
    setMessage("Checking only existing paid receipts for this stopped setup. No new research action or provider send is authorized.");
    try {
      while (!signal.signal.aborted) {
        const response=await checkAdaptiveOwnerReceiptsAction(businessId,exact.scopeId);
        if (!mounted.current || signal.signal.aborted) return;
        if (!response.ok) {setMessage(response.message);return;}
        const result=response.result;
        if (result.status==="stopped" && result.reason==="saved_receipt_readback_recorded") {
          setMessage("Existing receipt readback was recorded for this stopped setup. Review its saved cost and outcome; no new research call was sent.");return;
        }
        if (result.status!=="waiting" || result.reason!=="receipt_pending") {
          setMessage("Receipt readback is paused. Review the saved status before checking again; no new research call was sent.");return;
        }
        const wake=typeof result.wakeAt==="string"?Date.parse(result.wakeAt):NaN;
        if (!Number.isFinite(wake)) {setMessage("A saved paid receipt is still pending, but no next eligibility time was verified. Reload before checking again.");return;}
        setMessage(`The existing receipt is pending. Its next saved eligibility time is ${new Date(wake).toISOString()}; this check will wait, and the setup remains stopped.`);
        if (!await waitFor(Math.max(2_000,wake-Date.now()),signal.signal)) return;
      }
    } catch {if(mounted.current&&!signal.signal.aborted)setMessage("Receipt readback was interrupted. Reload the stopped setup; no success or new call was assumed.");}
    finally {if(runAbort.current===signal)runAbort.current=null;runInFlight.current=false;if(mounted.current){setCheckingReceipts(false);if(!signal.signal.aborted)router.refresh();}}
  }

  return <section className="ownerResearchAdaptive" aria-labelledby="owner-adaptive-title" aria-busy={!!busy}>
    <h2 id="owner-adaptive-title">Adaptive research from saved evidence</h2>
    <p>This is an Etsy-only reviewed run on the original Quest. It carries the negative and unresolved history forward, with a US$10 total run ceiling and at most ten combined extra decisions. Each decision is separately admitted within the approved run and may need several paid calls.</p>
    {intake}
    {ownerSourcePaused ? <p role="status" aria-label="Saved research pause" className="ownerResearchNotice">{OWNER_SOURCE_PAUSE_MESSAGE}</p> : null}
    {message && !(ownerSourcePaused && message===OWNER_SOURCE_PAUSE_MESSAGE) ? <p role="status" tabIndex={-1} ref={messageRef} className="ownerResearchNotice">{message}</p> : null}
    {busy ? <p role="status">{busy==="prepare"?"Preparing a fresh quote and exact packet…":busy==="confirm"?"Checking this exact confirmation…":"Closing this setup’s remaining authority…"} Keep this page open.</p> : null}
    {running ? <p role="status">The saved adaptive run is active in this browser session. Stop remains available while work is in flight.</p> : null}
    {checkingReceipts ? <p role="status">Only existing paid receipts are being checked. This stopped setup cannot start another research action.</p> : null}
    <div className="ownerResearchActions"><button type="button" disabled={!!busy} onClick={()=>{setConsentHash(null);router.refresh();}}>Reload saved adaptive state</button>
      {predecessor ? <Link href={ownerResearchScopeHref(businessId,goalId,predecessor.predecessorScopeId)}>View previous research and result</Link> : null}</div>
    {!catalog.eligible ? <p className="ownerResearchNotice">Adaptive preparation is not currently eligible. {catalog.reason ?? "The exact predecessor and permissions have not been verified."} Saved history remains available below.</p> : null}
    {catalog.eligible && !choices.length ? <p className="ownerResearchNotice">No separately reviewed Etsy-only profile is enrolled. Saved captures stay private until that mode and its exact quote are qualified.</p> : null}
    {catalog.eligible && !catalog.grants.length ? <p className="ownerResearchNotice">No finite adaptive grant is enrolled for this Quest and closed predecessor. No preparation can start.</p> : null}
    {funding && (funding.hasUnknown || funding.pendingMicrounits!=="0" || business.hasUnknown) ? <p role="alert">Pending or unknown liabilities block new adaptive research. Earlier costs remain cumulative.</p> : null}
    {catalog.eligible && !catalog.activation && funding && catalog.profiles.length>0 && catalog.grants.length>0 ? <form className="ownerResearchForm" onSubmit={event=>void prepare(event)}>
      <fieldset disabled={!!busy || !!receipt}><legend>Choose an exact reviewed adaptive scope</legend>
        <div className="ownerResearchField"><label htmlFor={`${fieldId}-grant`}>Reviewed profile and finite grant</label><select id={`${fieldId}-grant`} required value={choice} onChange={event=>edit(()=>{setChoice(event.target.value);setMarketSetKey("");setTopicKey("");})}><option value="" disabled>Choose an exact profile and grant</option>{choices.map(item=><option key={`${item.profile.id}:${item.grant.id}`} value={`${item.profile.id}:${item.grant.id}`}>{item.profile.title} · through {item.grant.expiresAt}</option>)}</select></div>
        {profile ? <p>{profile.purpose}</p> : null}
        {grant ? <p>Grant allows up to {grant.maximumActions} extra decisions and {ownerResearchUsd(grant.maximumRunMicrounits)} per run; {grant.remainingScopes} scope slots and {ownerResearchUsd(grant.remainingAllocationMicrounits)} cumulative allocation remain through {grant.expiresAt}. Stopped allocations stay counted.</p> : null}
        <div className="ownerResearchField"><label htmlFor={`${fieldId}-market`}>Goal market comparison</label><select id={`${fieldId}-market`} required disabled={!profile} value={marketSetKey} onChange={event=>edit(()=>setMarketSetKey(event.target.value))}><option value="" disabled>Choose reviewed markets</option>{profile?.marketSets.map(item=><option key={item.key} value={item.key}>{item.label}</option>)}</select></div>
        <div className="ownerResearchField"><label htmlFor={`${fieldId}-topic`}>Reviewed topic and adult audience</label><select id={`${fieldId}-topic`} required disabled={!profile} value={topicKey} onChange={event=>edit(()=>setTopicKey(event.target.value))}><option value="" disabled>Choose a reviewed topic</option>{profile?.topics.map(item=><option key={item.key} value={item.key}>{item.label} · {item.audience}</option>)}</select></div>
        <div className="ownerResearchField"><label htmlFor={`${fieldId}-actions`}>Maximum extra decisions</label><select id={`${fieldId}-actions`} value={actions} disabled={!grant} onChange={event=>edit(()=>setActionCount(Number(event.target.value)))}>{Array.from({length:Math.min(10,grant?.maximumActions??10)},(_,index)=>index+1).map(value=><option key={value} value={value}>{value}</option>)}</select></div>
        <p>New run ceiling: {ownerResearchUsd(runMaximum)} total. Required cumulative Business limit: {ownerResearchUsd(proposedBusiness)} (current {ownerResearchUsd(business.currentLimitMicrounits)}, committed {ownerResearchUsd(business.committedMicrounits)}). Required original research limit: {ownerResearchUsd(proposedFunding)} (current {ownerResearchUsd(funding.currentLimitMicrounits)}, committed {ownerResearchUsd(funding.committedMicrounits)}). These are the exact minimum proposed limits for this run; existing costs are retained.</p>
        <p>This explicit Etsy-only mode uses the selected owner captures with three actual paid roles: planner, strategist and independent reviewer. It does not run Exa or a paid evidence-selection call. Missing source evidence pauses for a genuine owner capture and renewed review.</p>
        <button type="submit" disabled={!canPrepare}>Prepare adaptive research packet</button>
      </fieldset>
    </form> : null}
    {receipt ? <>
      <OwnerAdaptiveResearchPacket receipt={receipt}/>
      <OwnerObservationDisclosure key={`${receipt.setupHash}:${receipt.ownerObservationRef?.manifestHash??"none"}`} receipt={receipt} onVerified={setDisclosureHash}/>
      <p role="status">Saved setup: {receipt.stopped?"stopped":receipt.activated?"authority activated, no call assumed":receipt.confirmed?"policy confirmed":"prepared for review"}.</p>
      {(quoteExpired||packetExpired) && !receipt.confirmed && !receipt.stopped ? <p className="ownerResearchNotice">This saved quote or window expired. Prepare a fresh packet and confirm its new exact hash.</p> : null}
      {!receipt.confirmed && !receipt.stopped ? <label className="ownerResearchConsent"><input type="checkbox" checked={consentHash===receipt.setupHash} disabled={!!busy||quoteExpired||packetExpired||!!receipt.ownerObservationRef&&disclosureHash!==receipt.ownerObservationRef.manifestHash} onChange={event=>setConsentHash(event.target.checked?receipt.setupHash:null)}/><span>I reviewed this exact adaptive packet, its prior findings, public sources, recipients, whole-run cost and cumulative limits. I approve its exact saved policy and setup hash {receipt.setupHash}.</span></label> : null}
      <div className="ownerResearchActions">
        {receipt.activated && !receipt.stopped ? <button type="button" disabled={!!busy||running} onClick={()=>void run()}>Run or resume approved adaptive research</button> : null}
        {receipt.stopped && catalog.activation?.setupId===receipt.setupId && catalog.activation.scopeId===receipt.scopeId &&
          catalog.activation.pendingReceiptReadback && catalog.activation.pendingReceiptCount>0 ?
          <button type="button" disabled={!!busy||checkingReceipts} onClick={()=>void checkReceipts()}>Check saved receipts</button> : null}
        {!receipt.confirmed && !receipt.stopped ? <button type="button" disabled={!!busy||!canConfirm} onClick={()=>void transition("confirm")}>Confirm this exact adaptive policy</button> : null}
        {(quoteExpired||packetExpired) && !receipt.confirmed && !receipt.stopped && canPrepare ? <button type="button" disabled={!!busy} onClick={()=>void prepare(undefined,true)}>Prepare fresh quote</button> : null}
        {!receipt.stopped ? <button type="button" disabled={!!busy} onClick={()=>void transition("stop")}>Stop this adaptive setup</button> : null}
        <Link href={ownerAdaptiveSetupHref(businessId,goalId,receipt.setupId)}>Stable saved adaptive setup link</Link>
      </div>
      <AdaptiveActionHistory actions={receipt.actions}/>
    </> : null}
    {!receipt && catalog.actions.length ? <AdaptiveActionHistory actions={catalog.actions}/> : null}
    {catalog.setups.length ? <section aria-label="Saved adaptive research setups"><h3>Saved adaptive setup history</h3><p>Select the exact packet; previous results and negative findings remain recorded.</p><ul className="ownerResearchList">{catalog.setups.map(saved=><li key={saved.setupId}><Link href={ownerAdaptiveSetupHref(businessId,goalId,saved.setupId)}>Adaptive setup {saved.setupId}</Link><span>{saved.stopped?"Stopped":saved.activated?"Authority activated":saved.confirmed?"Confirmed":"Prepared"} · {saved.actions.length} recorded decisions · quote through {saved.quote.validUntil}</span></li>)}</ul></section> : null}
  </section>;
}
