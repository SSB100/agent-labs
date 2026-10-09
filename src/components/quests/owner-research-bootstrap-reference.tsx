"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;

type Reference = { businessId: string; ownerId: string; grantId: string; bootstrapKeyHash: string; authorityCreated: false };

function validReference(value: unknown, businessId: string, ownerId: string, grantId: string): value is Reference {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).sort().join(",") === "authorityCreated,bootstrapKeyHash,businessId,grantId,ownerId" &&
    record.businessId === businessId && record.ownerId === ownerId && record.grantId === grantId &&
    UUID.test(ownerId) && typeof record.bootstrapKeyHash === "string" && HASH.test(record.bootstrapKeyHash) && record.authorityCreated === false;
}

/** Owner-only reference for a separately reviewed operator grant; it enrolls nothing. */
export function OwnerResearchBootstrapReference({ businessId, ownerId }: { businessId: string; ownerId: string }) {
  const [grantId, setGrantId] = useState("");
  const [reference, setReference] = useState<Reference | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const generation = useRef(0), active = useRef<AbortController | null>(null);
  useEffect(() => () => { generation.current++; active.current?.abort(); }, []);

  function change(value: string) {
    generation.current++; active.current?.abort(); active.current = null;
    setGrantId(value); setReference(null); setError(""); setPending(false);
  }

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current) return;
    const exactGrantId = grantId.trim();
    setReference(null); setError("");
    if (!UUID.test(exactGrantId)) { setError("Enter the exact operator-supplied grant UUID."); return; }
    const request = ++generation.current, controller = new AbortController();
    active.current = controller; setPending(true);
    try {
      const response = await fetch("/api/research/r12/owner-bootstrap", {
        method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, grantId: exactGrantId }), signal: controller.signal,
      });
      if (!response.ok) throw Error("reference_unavailable");
      const result: unknown = await response.json();
      if (!validReference(result, businessId, ownerId, exactGrantId)) throw Error("reference_mismatch");
      if (request === generation.current) setReference(result);
    } catch {
      if (request === generation.current) setError("The exact setup reference could not be verified. Check the grant UUID and Business, then retry.");
    } finally {
      if (request === generation.current) { active.current = null; setPending(false); }
    }
  }

  return <section className="ownerResearchBootstrap" aria-labelledby="owner-bootstrap-title" aria-busy={pending}>
    <h2 id="owner-bootstrap-title">Prepare research setup reference</h2>
    <p>Enter an exact grant UUID supplied by the operator for this Business. This prepares a nonsecret verifier reference only. It does not enroll permission, create research authority, obtain a quote, make an AI call or start a run.</p>
    <form onSubmit={event => void prepare(event)}>
      <label>Operator-supplied grant UUID<input type="text" required maxLength={36} autoComplete="off" autoCapitalize="off" spellCheck={false} value={grantId} onChange={event => change(event.target.value)} aria-describedby="owner-bootstrap-help" /></label>
      <p id="owner-bootstrap-help">Use the grant UUID from the separately reviewed finite Business grant. No UUID is created here.</p>
      <button type="submit" disabled={pending || !UUID.test(grantId.trim())}>{pending ? "Preparing reference…" : "Prepare setup reference"}</button>
    </form>
    {pending ? <p role="status">Checking this exact Business and grant…</p> : null}
    {error ? <p role="alert" className="ownerResearchNotice">{error}</p> : null}
    {reference ? <div className="ownerResearchBootstrapResult"><p role="status">Nonsecret setup reference prepared. Authority created: false.</p><label>Nonsecret setup reference<textarea readOnly rows={8} value={JSON.stringify(reference, null, 2)} onFocus={event => event.currentTarget.select()} /></label></div> : null}
  </section>;
}
