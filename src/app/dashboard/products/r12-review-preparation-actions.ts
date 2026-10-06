"use server";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { confirmR12ReviewPreparation } from "@/products/discovery-r12-review-preparation-server";
import type { R12ReviewPreparationState } from "@/products/discovery-r12-review-preparation-contract";
export async function confirmR12ReviewOwnerAction(_previous: R12ReviewPreparationState, form: FormData): Promise<R12ReviewPreparationState> {
  try {
    if (form.get("reviewed") !== "on") throw Error("review_required");
    const values = ["businessId", "scopeId", "proposalHash"].map(key => { const values = form.getAll(key); if (values.length !== 1 || typeof values[0] !== "string") throw Error("invalid_field"); return values[0]; });
    const receipt = await confirmR12ReviewPreparation(await requireOwnerUiContext(), values[0], values[1], values[2]);
    return { message: "The same Business and Goal now record the remaining review, and its one-call financial permission is confirmed. Temporary activation is still required; no provider call was made.", receipt };
  } catch {
    return { message: "Confirmation could not be verified. Reload this same proposal to recover a saved confirmation or inspect changed scope, costs or expiry. No substitute permission is created.", receipt: null };
  }
}
