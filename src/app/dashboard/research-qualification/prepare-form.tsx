"use client";

import { useActionState, useState } from "react";
import { prepareResearchSetup } from "./actions";
import type { ResearchSetupState } from "./form-state";
import type { ResearchContinuation } from "@/research/qualification-owner-contract";
import { formatResearchUsd, researchContinuationReason } from "./presentation";

const initialState: ResearchSetupState = { status: "idle", message: "", preparation: null };

/** Preparing a quote is explicit and non-authorizing. IDs survive action renders. */
export function PrepareResearchForm({ businessId, policyId, workflowRunId, configured, continuation = null }: {
  businessId: string; policyId: string; workflowRunId: string; configured: boolean; continuation?: ResearchContinuation | null;
}) {
  const [ids] = useState({ policyId, workflowRunId });
  const [state, action, pending] = useActionState(prepareResearchSetup, initialState);
  const disabled = !configured || pending || !!continuation && !continuation.eligible;
  return <section aria-labelledby="research-setup-title" data-r11-prepare-mode={continuation ? "continuation" : "initial"}>
    <h2 id="research-setup-title">{continuation ? "Prepare reviewed continuation" : "Prepare reviewed setup"}</h2>
    <p>Fetch the current public price and exact-route ZDR catalogs and prepare nonsecret setup identifiers. This does not install a grant, create spending authority, or call a paid provider.</p>
    {continuation ? <>
      <p>Continue the same Business and Goal {continuation.goalId}. Reviewed activation appends new Business and Goal revisions and a new financial policy; original attempts and charges remain unchanged.</p>
      <p>Existing accounted exposure: {formatResearchUsd(continuation.exposureMicrounits)}. Unchanged Business lifetime cap: {formatResearchUsd(continuation.lifetimeCapMicrounits)}. Remaining allowance: {formatResearchUsd(continuation.remainingMicrounits)}.</p>
      <p>Preparation is not approval for a retry. One fresh attempt needs a separately reviewed grant and explicit owner activation, within the remaining allowance.</p>
      {!continuation.eligible ? <p role="status">{researchContinuationReason(continuation.reason)}</p> : null}
      <details><summary>Continuation identity</summary><p>Previous policy {continuation.predecessorPolicyId}</p><p>Previous workflow {continuation.predecessorWorkflowRunId}</p><p>Goal revision {continuation.goalRevision}; Business revision {continuation.businessRevision}; lifetime-cap revision {continuation.capRevision}</p></details>
    </> : null}
    <form action={action}>
      <input type="hidden" name="mode" value={continuation ? "continuation" : "initial"} />
      {continuation ? <input type="hidden" name="predecessorPolicyId" value={continuation.predecessorPolicyId} /> : null}
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="policyId" value={ids.policyId} />
      <input type="hidden" name="workflowRunId" value={ids.workflowRunId} />
      <button type="submit" className="coreButton" disabled={disabled} aria-disabled={disabled}>{pending ? "Preparing public quote…" : continuation ? "Prepare continuation quote and setup" : "Prepare public quote and setup"}</button>
    </form>
    {state.message ? <p role={state.status === "unavailable" ? "alert" : "status"}>{state.message}</p> : null}
    {state.preparation ? <details id="research-setup-metadata" open>
      <summary>Prepared technical details</summary>
      <p>Nonsecret identifiers and fingerprints for the exact reviewed installation. A fresh quote is required at execution; these details are not permission to spend.</p>
      <pre>{JSON.stringify(state.preparation, null, 2)}</pre>
    </details> : null}
  </section>;
}
