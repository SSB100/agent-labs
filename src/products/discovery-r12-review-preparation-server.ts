import "server-only";
import type { OwnerUiContext } from "../lib/core-ui/data";
import { verifyOwnerBusiness } from "../lib/core-ui/owner-business";
import { prepareDiscoveryR12Authority } from "./discovery-r12-server";
import { parseR12ReviewOwnerWorkspace, r12ReviewUuid, type R12ReviewSetupReceipt } from "./discovery-r12-review-preparation-contract";
const fail = (): never => { throw Error("r12_review_preparation_unavailable"); };
async function owned(context: OwnerUiContext, businessId: string, scopeId: string) {
  if (!r12ReviewUuid(businessId) || !r12ReviewUuid(scopeId) || !await verifyOwnerBusiness(context, businessId)) return fail();
  const claims = await context.supabase.auth.getClaims();
  if (claims.error || claims.data?.claims?.sub !== context.userId) return fail();
}
/** Authenticated staging read only; no catalog lookup or grant creation. */
export async function readR12ReviewPreparation(context: OwnerUiContext, businessId: string, scopeId: string) {
  await owned(context, businessId, scopeId);
  const { data, error } = await context.supabase.rpc("r12_review_owner_read", { p_business_id: businessId, p_scope_id: scopeId });
  if (error) return fail();
  return data === null ? null : parseR12ReviewOwnerWorkspace(data, businessId, scopeId, context.userId);
}
/** Exact staged Business/Goal revisions and one-call policy are confirmed by
 * genuine owner RPCs atomically. Scoped key enrollment stays a separate gate. */
export async function confirmR12ReviewPreparation(context: OwnerUiContext, businessId: string, scopeId: string, proposalHash: string): Promise<R12ReviewSetupReceipt> {
  const before = await readR12ReviewPreparation(context, businessId, scopeId);
  if (!before || before.scopeId !== scopeId || before.proposalHash !== proposalHash || (!before.eligible && !before.confirmation)) return fail();
  const keys = await prepareDiscoveryR12Authority(context, businessId, scopeId);
  const { data, error } = await context.supabase.rpc("r12_review_owner_confirm", { p_business_id: businessId, p_scope_id: scopeId, p_proposal_hash: proposalHash });
  if (error || !data || data.executionAuthorized !== false || data.scopeId !== scopeId) return fail();
  const after = await readR12ReviewPreparation(context, businessId, scopeId), confirmation = after?.confirmation;
  if (!after || after.proposalHash !== proposalHash || !confirmation || ["policyId", "policyHash", "businessRevision", "goalRevision"].some(key => data[key] !== confirmation[key as keyof typeof confirmation])) return fail();
  return { ...confirmation, businessId, scopeId, goalId: after.scope.goalId, proposalHash, controllerKeyHash: keys.controllerKeyHash, admissionKeyHash: keys.admissionKeyHash, executionAuthorized: false };
}
