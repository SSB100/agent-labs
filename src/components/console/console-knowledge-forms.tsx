"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { saveKnowledge } from "@/app/dashboard/knowledge/actions";
import { containsCredentialLikeValue } from "@/core/quest-intake";
import { validKnowledgeMutation, type KnowledgeOwnerOperation } from "@/lib/core-ui/console-knowledge-query";

type ProposalDraft = { proposalId: string | null; expectedVersion: number; title?: string; lesson?: string; scope?: string; limitations?: string[]; artifactIds?: string[] };
type Props = { businessId: string; ownerId: string; businessName: string; returnTo: string; proposal?: ProposalDraft; mutation?: { operation: Exclude<KnowledgeOwnerOperation, "propose">; label: string; payload: Record<string, unknown>; versionLabel: string }; disabled?: boolean };
/** Only opaque retry identifiers are persisted; private lesson text stays in the current form. */
export function KnowledgeForm({ businessId, ownerId, businessName, returnTo, proposal, mutation, disabled }: Props) {
  const router = useRouter(), pending = useRef(new Map<string, string>()), mounted = useRef(true), generation = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [savedHref, setSavedHref] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || disabled) return;
    const form = new FormData(event.currentTarget), value = (name: string) => String(form.get(name) ?? "").trim();
    const operation = proposal ? "propose" : mutation!.operation;
    const payload = proposal ? { proposalId: proposal.proposalId, expectedVersion: proposal.expectedVersion, title: value("title"), lesson: value("lesson"), scope: value("scope"), limitations: value("limitations").split(/\n/).map(item => item.trim()).filter(Boolean), artifactIds: value("artifactIds").split(/[\s,]+/).filter(Boolean) } : { ...mutation!.payload, reason: value("reason") };
    if (containsCredentialLikeValue(payload)) { setMessage("Credential-like content was rejected. Use Connections for credentials."); return; }
    if (!validKnowledgeMutation(operation, payload)) { setMessage("Check the required fields, exact evidence UUIDs, limits and reason before saving."); return; }
    const request = ++generation.current, routeAtSubmit = `${window.location.pathname}${window.location.search}`;
    const current = () => mounted.current && generation.current === request && `${window.location.pathname}${window.location.search}` === routeAtSubmit;
    setBusy(true); setMessage(""); setSavedHref(null);
    try {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({ operation, payload })));
      const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      const key = `r09-retry:${ownerId}:${businessId}:${fingerprint}`;
      let submission = pending.current.get(key);
      try { submission ??= sessionStorage.getItem(key) ?? undefined; } catch { /* In-memory retries remain safe within this form. */ }
      if (!submission || !/^[0-9a-f-]{36}$/i.test(submission)) submission = crypto.randomUUID();
      pending.current.set(key, submission);
      try { sessionStorage.setItem(key, submission); } catch { /* Never persist lesson or reason text. */ }
      const result = await saveKnowledge(businessId, operation, payload, submission);
      if (!current()) return;
      setMessage(result.message);
      if (result.ok) {
        const destination = new URL(returnTo, "https://owner.invalid");
        destination.searchParams.set("type", proposal ? "proposals" : "applications"); destination.searchParams.set("selected", result.id); destination.searchParams.delete("page"); destination.searchParams.delete("q"); destination.searchParams.set("outcome", operation);
        setSavedHref(`${destination.pathname}${destination.search}`);
        router.push(`${destination.pathname}${destination.search}`);
      }
    } catch { if (current()) setMessage("The response was interrupted. Keep this form open and retry the unchanged request to recover its original result."); }
    finally { if (mounted.current && generation.current === request) setBusy(false); }
  }
  return <form onSubmit={submit} className="r09Form" aria-label={proposal ? proposal.proposalId ? "Revise private lesson" : "Submit private lesson" : mutation!.label}>
    {proposal ? <>
      <p>Private to {businessName}. Reference immutable evidence from this exact Business. Do not enter customer details, account content or secrets in the lesson.</p>
      <label>Lesson title<input name="title" required minLength={3} maxLength={160} defaultValue={proposal.title}/></label>
      <label>Provisional lesson<textarea name="lesson" required minLength={20} maxLength={8000} rows={3} defaultValue={proposal.lesson}/></label>
      <label>Applicable scope<textarea name="scope" required minLength={3} maxLength={2000} rows={2} defaultValue={proposal.scope}/></label>
      <label>Limitations, one per line<textarea name="limitations" required maxLength={12000} rows={2} defaultValue={proposal.limitations?.join("\n")}/></label>
      <label>Owned evidence artifact UUIDs<input name="artifactIds" required maxLength={455} defaultValue={proposal.artifactIds?.join(", ")}/></label>
      <p>1–12 artifacts from this Business; the server verifies ownership and immutable evidence. Local success alone does not qualify reusable guidance.</p>
    </> : <>
      <p>{mutation!.operation === "remove" ? "Remove future selection" : "Select"}: {mutation!.versionLabel} · only {businessName}</p>
      <label>Reason for this Business<textarea name="reason" minLength={10} maxLength={2000} rows={2} required/></label>
      <p>Information only. Existing plans keep their exact pins. No account access, rules, budget, authorization or qualification is transferred.</p>
    </>}
    <button type="submit" disabled={disabled || busy}>{busy ? "Saving…" : proposal ? proposal.proposalId ? "Save new private version" : "Submit private lesson" : mutation!.label}</button>
    {message ? <p role="status" aria-live="polite">{message} {savedHref ? <Link href={savedHref}>Inspect exact saved record</Link> : null}</p> : null}
  </form>;
}
