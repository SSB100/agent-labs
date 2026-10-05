"use client";

import { useActionState } from "react";
import { verifySavedInferenceRoute } from "./actions";
import type { ResearchRouteState } from "./form-state";

const initialState: ResearchRouteState = { status: "idle", message: "", verification: null };

export function VerifySavedRouteForm({ businessId, policyId, requestId }: {
  businessId: string; policyId: string; requestId: string;
}) {
  const [state, action, pending] = useActionState(verifySavedInferenceRoute, initialState);
  const proof = state.verification?.proof;
  return <div data-r11-route-check={requestId}>
    <form action={action}>
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="policyId" value={policyId} />
      <input type="hidden" name="requestId" value={requestId} />
      <button type="submit" className="coreButton" disabled={pending} aria-disabled={pending}>{pending ? "Reading saved inference route…" : "Verify saved inference route"}</button>
    </form>
    <p>Read the documented generation record for this saved receipt. This read-only check makes no paid inference call and does not change the proof or its prior failures.</p>
    {state.message ? <p role={state.status === "unavailable" ? "alert" : "status"}>{state.message}</p> : null}
    {proof ? <div data-r11-route-evidence>
      <p>Documented inference provider: {proof.providerName}. Model: {proof.modelId}.</p>
      <p>Proof fingerprint: {proof.proofHash}</p>
      <p>Requested endpoint from the saved policy: {proof.requestedEndpoint}. Generation metadata does not independently establish the regional endpoint or enumerate every inner call.</p>
      <details><summary>Normalized generation-route evidence</summary>
        <p>Generation {proof.generationId}</p>
        <p>{proof.providerResponses.length} supplied provider-attempt records</p>
        {proof.providerResponses.map((response, index) => <p key={index}>{response.providerName} · {response.modelId} · HTTP {response.status}</p>)}
      </details>
      <p>Read-only route evidence; does not qualify prior output or authorize another run. Historical failures and charges are preserved.</p>
    </div> : null}
  </div>;
}
