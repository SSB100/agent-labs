"use client";

import { useActionState, useState } from "react";
import { prepareResearchSetup } from "./actions";
import type { ResearchSetupState } from "./form-state";

const initialState: ResearchSetupState = { status: "idle", message: "", preparation: null };

/** Preparing a quote is explicit and non-authorizing. IDs survive action renders. */
export function PrepareResearchForm({ businessId, policyId, workflowRunId, configured }: {
  businessId: string; policyId: string; workflowRunId: string; configured: boolean;
}) {
  const [ids] = useState({ policyId, workflowRunId });
  const [state, action, pending] = useActionState(prepareResearchSetup, initialState);
  return <section aria-labelledby="research-setup-title">
    <h2 id="research-setup-title">Prepare reviewed setup</h2>
    <p>Fetch the current public price and exact-route ZDR catalogs and prepare nonsecret setup identifiers. This does not install a grant, create spending authority, or call a paid provider.</p>
    <form action={action}>
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="policyId" value={ids.policyId} />
      <input type="hidden" name="workflowRunId" value={ids.workflowRunId} />
      <button type="submit" className="coreButton" disabled={!configured || pending} aria-disabled={!configured || pending}>{pending ? "Preparing public quote…" : "Prepare public quote and setup"}</button>
    </form>
    {state.message ? <p role={state.status === "unavailable" ? "alert" : "status"}>{state.message}</p> : null}
    {state.preparation ? <details id="research-setup-metadata" open>
      <summary>Prepared technical details</summary>
      <p>Nonsecret identifiers and fingerprints for the exact reviewed installation. A fresh quote is required at execution; these details are not permission to spend.</p>
      <pre>{JSON.stringify(state.preparation, null, 2)}</pre>
    </details> : null}
  </section>;
}
