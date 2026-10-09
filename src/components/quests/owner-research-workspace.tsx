"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { OwnerResearchCatalog, OwnerResearchPreparationInput, OwnerResearchSetupReceipt } from "@/products/discovery-r12-goal-preparation-contract";
import { prepareOwnerResearchAction, confirmOwnerResearchAction, stopOwnerResearchAction } from "@/app/dashboard/quests/research/actions";
import { ownerResearchCanConfirm, ownerResearchRequestId, ownerResearchSetupHref, ownerResearchUsd, ownerResearchUsdMicrounits, ownerResearchUsdValue, ownerResearchWorkspaceHref } from "@/lib/core-ui/owner-research-form";
import { OwnerResearchPacket } from "./owner-research-packet";

type Props = { ownerId: string; catalog: OwnerResearchCatalog; selectedReceipt: OwnerResearchSetupReceipt | null; observedAt: number };

export function OwnerResearchWorkspace({ ownerId, catalog, selectedReceipt, observedAt }: Props) {
  const router = useRouter(), { business, goal, funding } = catalog;
  const fieldId = useId();
  const [profileKey, setProfileKey] = useState(selectedReceipt ? `${selectedReceipt.preview.profileId}:${selectedReceipt.grantId}` : "");
  const [marketSetKey, setMarketSetKey] = useState(selectedReceipt?.preview.selection.marketSetKey ?? "");
  const [topicKey, setTopicKey] = useState(selectedReceipt?.preview.selection.topicKey ?? "");
  const [businessUsd, setBusinessUsd] = useState(ownerResearchUsdValue(selectedReceipt?.preview.finance.proposedBusinessLimitMicrounits ?? business.maximumMicrounits));
  const [researchUsd, setResearchUsd] = useState(ownerResearchUsdValue(selectedReceipt?.preview.finance.proposedResearchLimitMicrounits ?? funding?.maximumMicrounits ?? business.maximumMicrounits));
  const [receipt, setReceipt] = useState(selectedReceipt);
  const [consentHash, setConsentHash] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"prepare" | "confirm" | "stop" | null>(null);
  const [now, setNow] = useState(observedAt);
  const pending = useRef(false), generation = useRef(0), mounted = useRef(true), identities = useRef(new Map<string, string>());
  const messageRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { const requests = generation; mounted.current = true; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => { mounted.current = false; requests.current++; window.clearInterval(timer); }; }, []);
  useEffect(() => {
    const clearHistoryConsent = () => setConsentHash(null);
    window.addEventListener("pageshow", clearHistoryConsent);
    window.addEventListener("popstate", clearHistoryConsent);
    return () => { window.removeEventListener("pageshow", clearHistoryConsent); window.removeEventListener("popstate", clearHistoryConsent); };
  }, []);
  useEffect(() => { if (message) messageRef.current?.focus(); }, [message]);
  const selected = catalog.profiles.find(item => `${item.profile.id}:${item.grantId}` === profileKey);
  const legacy = funding?.binding.kind === "legacy_research_root";
  const expired = !!receipt && Date.parse(receipt.preview.quote.validUntil) <= now;
  const goalReady = !!goal && goal.preference === "ready" && goal.content.ambiguities.length === 0;
  const ready = goalReady && !goal?.initialRunExists && !!funding && !!catalog.profiles.length && !business.paused && !business.hasUnknown && !funding.hasUnknown && funding.pendingMicrounits === "0";
  const locked = !!busy || !!receipt && (receipt.confirmed || receipt.activated || receipt.stopped);
  const base = goal ? ownerResearchSetupHref(business.id, goal.id) : `/dashboard/quests/research?business=${business.id}`;

  function edit(change: () => void) {
    generation.current++; setConsentHash(null); setReceipt(null); setMessage(""); change();
  }

  async function requestId(operation: string, input: unknown, supersededId?: string) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(input)));
    const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    const key = `r12-owner-request:v1:${ownerId}:${business.id}:${goal?.id}:${operation}:${fingerprint}`;
    let storage: Storage | null = null;
    try { storage = window.sessionStorage; } catch { /* Retry identity remains in memory. */ }
    return ownerResearchRequestId(key, identities.current, storage, () => crypto.randomUUID(), supersededId);
  }

  async function prepare(event?: FormEvent, fresh = false) {
    event?.preventDefault();
    if (pending.current || !ready || !goal || !selected || locked) return;
    const businessLimit = ownerResearchUsdMicrounits(businessUsd), researchLimit = legacy ? ownerResearchUsdMicrounits(researchUsd) : businessLimit;
    if (!businessLimit || !researchLimit || !selected.profile.marketSets.some(market => market.key === marketSetKey) || !selected.profile.topics.some(topic => topic.key === topicKey)) { setMessage("Choose a reviewed profile, market set and topic, and enter positive USD limits with at most six decimal places."); return; }
    pending.current = true; setBusy("prepare"); setConsentHash(null); setMessage("");
    const request = ++generation.current;
    const input: Omit<OwnerResearchPreparationInput, "submissionId"> = { businessId: business.id, goalId: goal.id, goalRevision: goal.revision, profileId: selected.profile.id, profileHash: selected.profileHash, grantId: selected.grantId, marketSetKey, topicKey, businessLifetimeLimitMicrounits: businessLimit, researchLifetimeLimitMicrounits: researchLimit };
    try {
      // Replace only the known expired request. A retry after an interrupted fresh preparation reuses its new identity.
      const submissionId = await requestId("prepare", input, fresh && expired ? receipt?.submissionId : undefined);
      const result = await prepareOwnerResearchAction({ ...input, submissionId });
      if (!mounted.current || request !== generation.current) return;
      if (!result.ok) { setMessage(result.message); return; }
      const saved = result.receipt;
      if (saved.businessId !== business.id || saved.goalId !== goal.id || saved.grantId !== selected.grantId || saved.submissionId !== submissionId || saved.preview.goalRevision !== goal.revision || saved.preview.profileHash !== selected.profileHash || saved.preview.selection.marketSetKey !== marketSetKey || saved.preview.selection.topicKey !== topicKey) { setMessage("The returned packet does not match this selection. Reload and inspect the exact saved setup before proceeding."); return; }
      setReceipt(saved); setMessage("Packet saved. Review its current quote, cumulative limits and data sharing, then confirm this exact policy. No paid work has started.");
      router.replace(ownerResearchSetupHref(business.id, goal.id, saved.setupId));
    } catch { if (mounted.current && request === generation.current) setMessage("The response was interrupted. Retry the unchanged request to recover its receipt, or reload and select the exact saved setup below. If session storage is disabled, keep this page open while retrying."); }
    finally { if (mounted.current && request === generation.current) { pending.current = false; setBusy(null); } }
  }

  async function transition(operation: "confirm" | "stop") {
    if (pending.current || !receipt || !goal || (operation === "confirm" && !ownerResearchCanConfirm(receipt, consentHash, now))) return;
    pending.current = true; setBusy(operation); setMessage("");
    const request = ++generation.current, exact = receipt;
    try {
      const input = { businessId: business.id, setupId: exact.setupId, setupHash: exact.setupHash };
      const submissionId = await requestId(operation, input);
      const result = await (operation === "confirm" ? confirmOwnerResearchAction : stopOwnerResearchAction)({ ...input, submissionId });
      if (!mounted.current || request !== generation.current) return;
      if (!result.ok) { setMessage(result.message); return; }
      const saved = result.receipt;
      if (saved.businessId !== business.id || saved.goalId !== goal.id || saved.setupId !== exact.setupId || saved.setupHash !== exact.setupHash || saved.scopeId !== exact.scopeId) { setMessage("The response does not match this exact packet. Reload its saved state before taking another action."); return; }
      if (operation === "stop" && !saved.stopped || operation === "confirm" && !saved.confirmed && !saved.stopped) { setMessage("The requested state has not been verified. Reload this exact packet before retrying; no success has been assumed."); return; }
      setReceipt(saved); setConsentHash(null);
      setMessage(saved.stopped ? "This setup is stopped. Saved evidence and any dispatched costs remain preserved." : "Permission confirmation is saved. Open the research workspace to check current eligibility and Continue bounded paid research.");
      router.refresh();
    } catch { if (mounted.current && request === generation.current) setMessage("The response was interrupted. Reload this exact setup to check its saved status, or retry the unchanged action with the same request identity. No success has been assumed."); }
    finally { if (mounted.current && request === generation.current) { pending.current = false; setBusy(null); } }
  }

  if (!goal) return <p role="alert">Select an exact saved Quest before preparing research.</p>;
  return <div className="ownerResearchWorkspace" aria-busy={!!busy}>
    <h2>{goal.content.title}</h2><p>{goal.content.objective}</p><p>Quest version {goal.revision} · {goal.preference}. Your target remains an unverified objective.</p>
    {message ? <p role="status" tabIndex={-1} ref={messageRef} className="ownerResearchNotice">{message}</p> : null}
    {busy ? <p role="status">{busy === "prepare" ? "Preparing the exact packet and current quote…" : busy === "confirm" ? "Checking and saving this exact policy confirmation…" : "Closing this setup’s remaining authority…"} Keep this page open. Repeated clicks are blocked.</p> : null}
    <p>Reload reads saved server state. An unchecked confirmation is never restored from this tab.</p>
    <div className="ownerResearchActions"><button type="button" onClick={() => { setConsentHash(null); router.refresh(); }} disabled={!!busy}>Reload saved state</button><Link href={`/dashboard/quests?business=${business.id}&quest=${goal.id}`}>Review or edit the original Quest</Link></div>
    {!goalReady ? <p className="ownerResearchNotice">Resolve the Quest’s missing facts and record its ready preference in the original Quest workspace first. Saving readiness does not grant execution authority.</p> : null}
    {goal.initialRunExists ? <p className="ownerResearchNotice">This Quest already has its initial research episode. Select its saved setup below to open the existing workspace. Another setup cannot restart it.</p> : null}
    {!catalog.profiles.length || !funding ? <p role="alert">Research preparation is technically unavailable: no current reviewed profile, Business grant or verified funding binding is available for this exact Quest. No legacy workflow will be substituted.</p> : null}
    {business.paused ? <p role="alert">This Business is paused. Review its operating controls before preparing research.</p> : null}
    {business.hasUnknown || funding?.hasUnknown || funding && funding.pendingMicrounits !== "0" ? <p role="alert">Pending or unknown liabilities block fresh research. Existing costs remain cumulative.</p> : null}
    {catalog.profilesTruncated ? <p role="note">Only a bounded set of current reviewed profiles is shown. Unsupported or omitted profiles cannot be selected here.</p> : null}
    {ready ? <form className="ownerResearchForm" onSubmit={event => void prepare(event)}>
      <fieldset disabled={locked}><legend>Choose reviewed public research scope</legend>
        <div className="ownerResearchField"><label htmlFor={`${fieldId}-profile`}>Reviewed research profile</label><select id={`${fieldId}-profile`} required value={profileKey} onChange={event => edit(() => { setProfileKey(event.target.value); setMarketSetKey(""); setTopicKey(""); })}><option value="" disabled>Choose a profile</option>{catalog.profiles.map(item => <option key={`${item.profile.id}:${item.grantId}`} value={`${item.profile.id}:${item.grantId}`}>{item.profile.title}</option>)}</select></div>
        {selected ? <p>{selected.profile.purpose}</p> : null}
        <div className="ownerResearchField"><label htmlFor={`${fieldId}-market`}>Public market set</label><select id={`${fieldId}-market`} required disabled={!selected || locked} value={marketSetKey} onChange={event => edit(() => setMarketSetKey(event.target.value))}><option value="" disabled>Choose supported markets</option>{selected?.profile.marketSets.map(market => <option key={market.key} value={market.key}>{market.label}</option>)}</select></div>
        <div className="ownerResearchField"><label htmlFor={`${fieldId}-topic`}>Public topic and adult audience</label><select id={`${fieldId}-topic`} required disabled={!selected || locked} value={topicKey} onChange={event => edit(() => setTopicKey(event.target.value))}><option value="" disabled>Choose a supported topic</option>{selected?.profile.topics.map(topic => <option key={topic.key} value={topic.key}>{topic.label} · {topic.audience}</option>)}</select></div>
        <p>Only reviewed public choices are supported. Your original Quest is preserved. Price is unavailable until you prepare a fresh server-quoted packet.</p>
        <label>Proposed Business lifetime limit (USD)<input required inputMode="decimal" pattern="(0|[1-9][0-9]*)(\.[0-9]{1,6})?" value={businessUsd} onChange={event => edit(() => setBusinessUsd(event.target.value))}/></label>
        <p>Current Business lifetime limit: {ownerResearchUsd(business.maximumMicrounits)}. Existing committed exposure: {ownerResearchUsd(business.committedMicrounits)}. The complete run must fit alongside existing costs.</p>
        {legacy && funding ? <><label>Proposed original cumulative research limit (USD)<input required inputMode="decimal" pattern="(0|[1-9][0-9]*)(\.[0-9]{1,6})?" value={researchUsd} onChange={event => edit(() => setResearchUsd(event.target.value))}/></label><p>Current original research total: {ownerResearchUsd(funding.maximumMicrounits)}; committed: {ownerResearchUsd(funding.committedMicrounits)}; pending: {ownerResearchUsd(funding.pendingMicrounits)}. Prior costs are retained. Raising this total is an explicit extension for the new lane and never resets the original research allowance.</p></> : <p>Native Business funding uses this single Business lifetime cap. The research limit equals it; there is no separate research allowance to increase.</p>}
        <button type="submit" disabled={locked || !selected || !marketSetKey || !topicKey}>Prepare exact research packet</button>
      </fieldset>
    </form> : null}
    {receipt ? <>
      <OwnerResearchPacket receipt={receipt}/>
      <p role="status">Saved setup status: {receipt.stopped ? "stopped" : receipt.activated ? "authority was activated at confirmation; check the research workspace for current eligibility" : receipt.confirmed ? "policy confirmed; awaiting Continue" : "prepared; awaiting exact policy confirmation"}.</p>
      {expired && !receipt.confirmed && !receipt.stopped ? <p className="ownerResearchNotice">This quote has expired. Prepare a fresh packet with a new request identity, then review and confirm that new packet.</p> : null}
      {!receipt.confirmed && !receipt.stopped ? <label className="ownerResearchConsent"><input type="checkbox" checked={consentHash === receipt.setupHash} disabled={!!busy || expired} onChange={event => setConsentHash(event.target.checked ? receipt.setupHash : null)}/><span>I reviewed this exact packet, including its cumulative limits, sources, data recipients and finite windows, and approve its exact R05 operating policy. This confirmation is bound to setup hash {receipt.setupHash}.</span></label> : null}
      <div className="ownerResearchActions">
        {!receipt.confirmed && !receipt.stopped ? <button type="button" disabled={!!busy || !ownerResearchCanConfirm(receipt, consentHash, now)} onClick={() => void transition("confirm")}>Confirm this exact research policy</button> : null}
        {expired && !receipt.confirmed && !receipt.stopped && ready ? <button type="button" disabled={!!busy} onClick={() => void prepare(undefined, true)}>Prepare fresh quote</button> : null}
        {(receipt.confirmed || receipt.activated) ? <Link href={ownerResearchWorkspaceHref(receipt)}>Open research workspace for Continue / Stop</Link> : null}
        {!receipt.stopped ? <button type="button" disabled={!!busy} onClick={() => void transition("stop")}>Stop this research setup</button> : null}
        <Link href={ownerResearchSetupHref(business.id, goal.id, receipt.setupId)}>Stable saved setup link</Link>
      </div>
    </> : null}
    {catalog.setups.length ? <section aria-label="Saved research setups"><h2>Saved setups for this exact Quest</h2><p>Select the exact packet to review or recover its saved status. No setup is selected automatically.</p><ul className="ownerResearchList">{catalog.setups.map(saved => <li key={saved.setupId}><Link href={ownerResearchSetupHref(business.id, goal.id, saved.setupId)}>Setup {saved.setupId}</Link><span>{saved.stopped ? "Stopped" : saved.activated ? "Authority activation recorded" : saved.confirmed ? "Policy confirmed" : "Prepared"} · quote through {saved.preview.quote.validUntil}</span></li>)}</ul></section> : null}
    {catalog.setupsTruncated ? <section><p role="note">Only recent saved setups are listed. Use an older packet’s stable URL or its exact setup ID to recover that packet.</p><form action="/dashboard/quests/research" method="get" className="ownerResearchForm"><input type="hidden" name="business" value={business.id}/><input type="hidden" name="quest" value={goal.id}/><label>Exact saved setup ID<input name="setup" required pattern="[a-fA-F0-9-]{36}"/></label><button type="submit">Open exact saved setup</button></form></section> : null}
    {!receipt ? <p><Link href={base}>Return to this exact Quest’s preparation</Link></p> : null}
  </div>;
}
