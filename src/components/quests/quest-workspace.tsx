"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { previewResearchLink, saveQuestIntent } from "@/app/dashboard/quests/actions";
import { containsCredentialLikeContent, containsCredentialLikeValue, parseQuestIntake } from "@/core/quest-intake";
import type { JsonObject } from "@/core/contracts";
import type { R04Envelope, R04Operation, R04Payloads, R04Read, R04ResearchPreview } from "@/core/quest-contract";

const EMPTY_RULES = { brandContext: "", operatingRules: "", allowedActivity: "", restrictions: "" };
const RULE_LABELS = { brandContext: "Brand and Business context", operatingRules: "Operating rules", allowedActivity: "Allowed activity", restrictions: "Explicit restrictions" };

export function QuestWorkspace({ state, ownerId }: { state: R04Read; ownerId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [rules, setRules] = useState(state.business.content ?? EMPTY_RULES);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const [review, setReview] = useState(false);
  const [title, setTitle] = useState("");
  const pending = useRef(new Map<string, string>());
  const parsed = text ? parseQuestIntake(text) : null;
  const selected = state.selected;
  const base = `/dashboard/quests?business=${state.businessId}`;
  const pageBase = state.selection === "explicit" && selected ? `${base}&quest=${selected.id}` : base;

  async function save<O extends R04Operation>(operation: O, payload: R04Payloads[O]) {
    if (busy) return;
    if (containsCredentialLikeValue(payload)) { setMessage("Credential-like content was rejected. Use Connections for credentials."); return; }
    setBusy(true); setMessage("");
    try {
      const encoded = JSON.stringify({ operation, payload });
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encoded));
      const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      const key = `r04-request:v1:${ownerId}:${state.businessId}:${fingerprint}`;
      let id = pending.current.get(key);
      try { id ??= sessionStorage.getItem(key) ?? undefined; } catch { /* In-memory retry remains available. */ }
      if (!id || !/^[0-9a-f-]{36}$/i.test(id)) id = crypto.randomUUID();
      pending.current.set(key, id);
      try { sessionStorage.setItem(key, id); } catch { /* Never store owner text; only an opaque request identity. */ }
      const result = await saveQuestIntent(state.businessId, operation, payload, id);
      if (!result.ok) { setMessage(result.message); return; }
      setMessage("Saved. No work was started and no spending was authorized.");
      if (operation === "quest.save") router.push(`${base}&quest=${result.result.id}`);
      router.refresh();
    } catch { setMessage("The response was interrupted. Retry the unchanged request here to recover its result. If session storage is disabled, keep this page open while retrying."); }
    finally { setBusy(false); }
  }

  function enterText(value: string, update: (clean: string) => void) {
    if (containsCredentialLikeContent(value)) { setMessage("Credential-like content was rejected. Use Connections for credentials."); return; }
    update(value); setReview(false);
  }

  function saveDraft(event: FormEvent) {
    event.preventDefault();
    if (!review || parsed?.status !== "draft") return;
    void save("quest.save", { goalId: editing && selected ? selected.id : null, expectedRevision: editing && selected ? selected.revision : 0,
      content: { title, originalIntent: parsed.objective, objective: parsed.objective,
        parsed: { target: parsed.target, budget: parsed.budget, deadline: parsed.deadline, geography: parsed.geography, scope: parsed.scope, stopConstraints: parsed.stopConstraints } as JsonObject,
        ambiguities: parsed.issues.map(issue => `${issue.field}: ${issue.reason}`) } });
  }

  return <div className="questWorkspace">
    <p className="coreNotice">Saved intent and lifecycle preferences do not authorize or stop provider work. <Link href={`/dashboard/quests/controls?business=${state.businessId}${selected ? `&quest=${selected.id}` : ""}`}>Review financial authority and pause controls</Link>.</p>
    {message ? <p role="status" className="coreNotice">{message}</p> : null}
    <details><summary>Business rules · version {state.business.revision} · {state.business.preference.replaceAll("_", " ")}</summary>
      <form onSubmit={event => { event.preventDefault(); void save("business.save", { expectedRevision: state.business.revision, content: rules, preference: state.business.preference === "legacy_unmanaged" ? "setup" : state.business.preference }); }}>
        {Object.entries(RULE_LABELS).map(([key, label]) => <label key={key}>{label}<textarea required maxLength={4000} value={rules[key as keyof typeof rules]} onChange={event => enterText(event.target.value, value => setRules({ ...rules, [key]: value }))} /></label>)}
        <button className="coreButton" disabled={busy} type="submit">Save a new Business rules version</button>
      </form>
      <p>Business state is separate from Quest progress. Selecting another Quest never resumes a paused Business.</p>
      {(["setup", "paused", "stopped"] as const).map(preference => <button key={preference} className="coreButton" disabled={busy || !state.business.revision || preference === state.business.preference} onClick={() => void save("business.save", { expectedRevision: state.business.revision, content: state.business.content ?? EMPTY_RULES, preference })}>Record Business {preference} preference</button>)}
    </details>
    <section aria-labelledby="quest-list"><h2 id="quest-list">Saved Quests</h2>
      <p>{state.total} saved · showing {state.offset + (state.quests.length ? 1 : 0)}–{state.offset + state.quests.length}. Selection: {state.selection}.</p>
      <ul>{state.quests.map(quest => <li key={quest.id}><Link href={`${base}&quest=${quest.id}`}>{quest.title}</Link> · version {quest.revision} · {quest.preference}{quest.id === state.business.currentGoalId ? " · current" : ""}</li>)}</ul>
      {state.offset > 0 ? <Link href={`${pageBase}&offset=${Math.max(0, state.offset - state.limit)}`}>Previous Quests</Link> : null}{" "}
      {state.offset + state.limit < state.total ? <Link href={`${pageBase}&offset=${state.offset + state.limit}`}>Next Quests</Link> : null}
    </section>
    {selected ? <section aria-labelledby="selected-quest"><h2 id="selected-quest">{selected.title} · version {selected.revision}</h2>
      <p>Quest {selected.id}</p><p>{selected.content.originalIntent}</p>
      <p>Saved preference: {selected.preference}. Target achievement is unverified; an aspirational target is not a promised result.</p>
      <button className="coreButton" disabled={busy || !state.business.revision} onClick={() => void save("quest.select", { goalId: selected.id, expectedRevision: selected.revision })}>Make this the current Quest</button>
      {!state.business.revision ? <p>Save Business rules before choosing a current Quest.</p> : null}
      <button className="coreButton" disabled={busy} onClick={() => { setEditing(true); setText(selected.content.originalIntent); setTitle(selected.title); setReview(false); }}>Edit as a new Quest version</button>
      <details><summary>Record lifecycle preference</summary><p>These preferences do not dispatch or cancel work.</p>{(["draft", "ready", "paused", "stopped", "completed"] as const).map(preference => <button className="coreButton" key={preference} disabled={busy || selected.preference === preference} onClick={() => void save("quest.preference", { goalId: selected.id, expectedRevision: selected.revision, preference })}>{preference}</button>)}</details>
      {selected.content.ambiguities.length ? <p role="note">Needs clarification: {selected.content.ambiguities.join("; ")}. Edit the Quest to supply these facts before proposing an envelope.</p> : null}
      <h3>Operating envelope confirmations</h3>
      <EnvelopeDraft state={state} busy={busy} onPropose={envelope => save("envelope.propose", { goalId: selected.id, expectedRevision: selected.revision, businessRevision: state.business.revision, envelope })} />
      {!selected.proposals.length ? <p>No operating envelope has been confirmed. This Quest has no execution authority.</p> : selected.proposals.map(proposal => <article key={proposal.id}>
        <h4>Rules v{proposal.businessRevision} · Quest v{proposal.goalRevision} · {proposal.status.replaceAll("_", " ")}</h4>
        <p>Purposes: {proposal.envelope.purposes.join(", ")}. Permitted operations: {proposal.envelope.operations.join(", ")}.</p>
        <p>Limits: {proposal.envelope.limits.map(limit => `${limit.category}: ${limit.maximum} ${limit.currency}`).join("; ")}.</p>
        <p>Starts {proposal.envelope.startsAt}; authorization intent expires {proposal.envelope.expiresAt}. This is separate from the project deadline.</p>
        <p>Stop rules: {proposal.envelope.stopRules.join("; ")}. Data sharing: {proposal.envelope.dataSharing.join("; ")}.</p>
        <p>Accounts: {proposal.envelope.accounts.map(account => `${account.id} (${account.revision})`).join("; ") || "none"}. Pack versions: {proposal.envelope.packs.map(pack => `${pack.packId} (${pack.installationId})`).join("; ") || "none"}.</p>
        <p>Confirmation applies only to these exact versions and references. No execution is available.</p>
        {proposal.status === "proposed" ? <button className="coreButton" disabled={busy} onClick={() => void save("envelope.confirm", { proposalId: proposal.id, proposalHash: proposal.hash })}>Confirm this complete envelope once</button> : null}
        {!proposal.revoked ? <button className="coreButton" disabled={busy} onClick={() => void save("envelope.revoke", { proposalId: proposal.id })}>Revoke this envelope</button> : null}
      </article>)}
      {!state.proposalsComplete ? <p role="alert">The envelope list is incomplete. Additional history is not qualified here.</p> : null}
      <ResearchAssociation businessId={state.businessId} selected={selected} busy={busy} onLink={experimentId => save("research.link", { experimentId, goalId: selected.id, expectedRevision: selected.revision })} />
    </section> : null}
    <section aria-labelledby="quest-entry"><h2 id="quest-entry">{editing ? "Revise the selected Quest" : "Create a Quest"}</h2>
      <p>Describe the objective, target and currency, spending budget, deadline and timezone, geography, scope and stop rules. This preview is local and makes no model call. Keep credentials in <Link href={`/dashboard?view=connections&business=${state.businessId}`}>Connections</Link>.</p>
      <form onSubmit={saveDraft}>
        <label>Quest title<input required maxLength={200} value={title} onChange={event => enterText(event.target.value, setTitle)} /></label>
        <label>Your Quest in plain language<textarea required maxLength={4000} value={text} onChange={event => enterText(event.target.value, setText)} /></label>
        {parsed?.status === "draft" ? <><dl className="detailList">
          <div><dt>Measurable target</dt><dd>{parsed.target ? `${parsed.target.amount} ${parsed.target.metric === "units" || parsed.target.metric === "orders" ? "" : parsed.target.currency ?? "currency unresolved"} ${parsed.target.metric ?? "metric unresolved"}` : "Needs clarification"}</dd></div>
          <div><dt>Spending budget</dt><dd>{parsed.budget ? `${parsed.budget.amount} ${parsed.budget.currency ?? "currency unresolved"}` : "Needs clarification"}</dd></div>
          <div><dt>Project deadline</dt><dd>{parsed.deadline ? `${parsed.deadline.date} ${parsed.deadline.time ?? "date only"} ${parsed.deadline.timezone}` : "Needs clarification"}</dd></div>
          <div><dt>Geography</dt><dd>{parsed.geography.join(", ") || "Needs clarification"}</dd></div>
          <div><dt>Scope</dt><dd>{parsed.scope ?? "Needs clarification"}</dd></div>
          <div><dt>Stop constraints</dt><dd>{parsed.stopConstraints.join("; ") || "Needs clarification"}</dd></div>
        </dl><p>Limited extraction: review each value. Unsupported language remains unresolved.</p>
          {parsed.issues.length ? <p>Clarify in your description: {[...new Set(parsed.issues.map(issue => `${issue.field} (${issue.reason})`))].join(", ")}. You may save an incomplete draft.</p> : null}
          <label><input type="checkbox" checked={review} onChange={event => setReview(event.target.checked)} />I reviewed the extracted facts and unresolved items. Save intent only.</label>
        </> : null}
        <button className="coreButton" type="submit" disabled={busy || !review || parsed?.status !== "draft"}>Save Quest draft</button>
        {editing ? <button className="coreButton" type="button" onClick={() => { setEditing(false); setText(""); setTitle(""); setReview(false); }}>Start a separate Quest instead</button> : null}
      </form>
    </section>
  </div>;
}

function ResearchAssociation({ businessId, selected, busy, onLink }: { businessId: string; selected: NonNullable<R04Read["selected"]>; busy: boolean; onLink: (experimentId: string) => Promise<void> }) {
  const [experimentId, setExperimentId] = useState("");
  const [preview, setPreview] = useState<R04ResearchPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const generation = useRef(0);
  const sameIntent = preview?.goalId === selected.id || (!preview?.goalId && preview?.evidence?.originalObjective === selected.content.originalIntent);
  async function check(event: FormEvent) {
    event.preventDefault(); const request = ++generation.current;
    setChecking(true); setPreview(null);
    try { const result = await previewResearchLink(businessId, experimentId); if (request === generation.current) setPreview(result); }
    catch { if (request === generation.current) setPreview({ status: "unavailable" }); }
    finally { if (request === generation.current) setChecking(false); }
  }
  return <details><summary>Associate existing research</summary>
    <p>Check a known experiment’s original same-Business lineage. Ambiguous evidence remains unlinked. This never rewrites research inputs, receipts or budget roots.</p>
    <form onSubmit={check}><label>Exact experiment ID<input required value={experimentId} pattern="[0-9a-fA-F-]{36}" onChange={event => { generation.current++; setChecking(false); setExperimentId(event.target.value); setPreview(null); }} /></label><button className="coreButton" disabled={checking || busy} type="submit">Preview association without changes</button></form>
    {preview ? <><p role="status">{preview.status === "linkable" ? "Original lineage is consistent within this Business." : preview.status === "legacy_bound" ? `Already associated with original Core Goal ${preview.goalId}. Its legacy identity is preserved; it cannot be reassigned or edited through this workspace.` : preview.status === "unlinked_ambiguous" ? "Unlinked: original evidence is ambiguous. No association can be saved." : "Research is unavailable in this Business. No substitute was selected."}</p>
      {preview.status === "linkable" ? <><p>Original experiments: {preview.experimentIds?.join(", ")}. Existing Quest: {preview.goalId ?? "unlinked"}. Original authority root: {preview.authorityRootId ?? "not present"}.</p>{!sameIntent ? <p>The selected Quest does not match this lineage’s exact original intent or existing Goal. No association can be saved.</p> : null}<button className="coreButton" disabled={busy || !sameIntent} onClick={() => void onLink(experimentId)}>Associate verified lineage with this exact Quest version</button></> : null}
    </> : null}
  </details>;
}

function EnvelopeDraft({ state, busy, onPropose }: { state: R04Read; busy: boolean; onPropose: (envelope: R04Envelope) => Promise<void> }) {
  const [error, setError] = useState("");
  const blocked = !state.business.revision || !state.selected || state.selected.preference !== "ready" || Boolean(state.selected.content.ambiguities.length) || !state.references.accountsComplete || !state.references.packsComplete;
  function propose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (containsCredentialLikeValue(Array.from(data.values()))) { setError("Credential-like content was rejected. Use Connections for credentials."); return; }
    const value = (name: string) => String(data.get(name) ?? "").trim();
    const lines = (name: string) => value(name).split("\n").map(line => line.trim()).filter(Boolean);
    const start = new Date(value("startsAt")), end = new Date(value("expiresAt"));
    if (!/Z$/.test(value("startsAt")) || !/Z$/.test(value("expiresAt")) || !Number.isFinite(start.valueOf()) || !Number.isFinite(end.valueOf()) || end <= start) { setError("Enter valid UTC start and expiry timestamps ending in Z, with expiry after start."); return; }
    const envelope: R04Envelope = {
      purposes: lines("purposes"), operations: lines("operations"), dataSharing: lines("dataSharing"), stopRules: lines("stopRules"),
      startsAt: start.toISOString(), expiresAt: end.toISOString(),
      limits: [{ category: value("category"), currency: value("currency"), maximum: value("maximum") }],
      accounts: state.references.accounts.filter(account => data.getAll("account").includes(account.id)).map(({ id, revision }) => ({ id, revision })),
      packs: state.references.packs.filter(pack => data.getAll("pack").includes(pack.installationId)).map(({ installationId, packId }) => ({ installationId, packId })),
    };
    if (containsCredentialLikeValue(envelope)) { setError("Credential-like content was rejected. Use Connections for credentials."); return; }
    setError(""); void onPropose(envelope);
  }
  return <details><summary>Draft the complete operating envelope</summary>
    <p>This records your intended permission for exact Business rules v{state.business.revision} and Quest v{state.selected?.revision}. Review the complete saved proposal before confirming it once. Execution stays unavailable.</p>
    <p>Authorization expiry is separate from the Quest deadline, provider credential lease and Knowledge freshness. This form does not extend any provider lease or establish that Knowledge is current.</p>
    {blocked ? <p role="note">Save Business rules, resolve the Quest’s missing facts and record its ready preference first. All account and pack references must also be available.</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    <form onSubmit={propose}>
      <fieldset disabled={busy || blocked}><legend>Purposes, scope and limits</legend>
        <label>Permitted business purposes (one per line)<textarea name="purposes" required maxLength={2000} /></label>
        <label>Permitted operations (one per line)<textarea name="operations" required maxLength={2000} /></label>
        <label>Permitted data sharing (one per line; explicitly say none if prohibited)<textarea name="dataSharing" required maxLength={2000} /></label>
        <label>Spending category<input name="category" required maxLength={100} /></label>
        <label>Currency (explicit three-letter code)<input name="currency" required pattern="[A-Z]{3}" maxLength={3} placeholder="NZD" /></label>
        <label>Maximum spending in that currency<input name="maximum" required inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,6})?" /></label>
        <label>Authorization intent starts (UTC)<input name="startsAt" required placeholder="2026-10-04T00:00:00Z" /></label>
        <label>Authorization intent expires (UTC)<input name="expiresAt" required placeholder="2026-10-05T00:00:00Z" /></label>
        <label>Explicit stop rules (one per line)<textarea name="stopRules" required maxLength={2000} /></label>
        <fieldset><legend>Same-Business accounts</legend>{state.references.accounts.length ? state.references.accounts.map(account => <label key={account.id}><input type="checkbox" name="account" value={account.id} />{account.label} · reference {account.id} · version {account.revision}</label>) : <p>No eligible account references. No account operation will be authorized.</p>}</fieldset>
        <fieldset><legend>Installed pack versions</legend>{state.references.packs.length ? state.references.packs.map(pack => <label key={pack.installationId}><input type="checkbox" name="pack" value={pack.installationId} />{pack.label} · {pack.version}</label>) : <p>No installed pack versions available.</p>}</fieldset>
        <button className="coreButton" type="submit">Save proposal for complete review</button>
      </fieldset>
    </form>
  </details>;
}
