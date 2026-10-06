"use client";
import Link from "next/link";
import { useActionState } from "react";
import { confirmR12ReviewOwnerAction } from "@/app/dashboard/products/r12-review-preparation-actions";
import type { R12ReviewOwnerWorkspace } from "@/products/discovery-r12-review-preparation-contract";
import { ResearchSubmitButton } from "@/app/dashboard/research-qualification/submit-button";
export function ConsoleR12ReviewPreparationForm({ workspace }: { workspace: Pick<R12ReviewOwnerWorkspace, "businessId" | "scopeId" | "proposalHash" | "eligible"> & { goalId: string; confirmed: boolean } }) {
  const [state, action] = useActionState(confirmR12ReviewOwnerAction, { message: "", receipt: null });
  return <><form action={action}><input type="hidden" name="businessId" value={workspace.businessId}/><input type="hidden" name="scopeId" value={workspace.scopeId}/><input type="hidden" name="proposalHash" value={workspace.proposalHash}/>
    <label><input type="checkbox" name="reviewed" required/>I reviewed the Business and Goal changes and the one-call financial permission below.</label>
    <ResearchSubmitButton pendingLabel="Confirming remaining review…" disabled={!workspace.eligible && !workspace.confirmed}>{workspace.confirmed ? "Recover confirmed setup receipt" : "Confirm remaining review"}</ResearchSubmitButton>
  </form>{state.message ? <p role="status">{state.message}</p> : null}{state.receipt ? <section aria-label="Verified remaining-review setup"><h2>Remaining review prepared</h2><p>The saved research remains unchanged. The operator must verify this exact permission and separately activate its finite dispatch and receipt window.</p><details><summary>Nonsecret operator setup receipt</summary><label>Setup receipt<textarea readOnly rows={12} value={JSON.stringify(state.receipt, null, 2)}/></label></details><Link href={`/dashboard?view=research&type=r12&business=${workspace.businessId}&selected=${workspace.scopeId}&quest=${workspace.goalId}`}>Open remaining review after activation</Link></section> : null}</>;
}
