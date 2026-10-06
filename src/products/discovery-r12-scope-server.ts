import "server-only";
import type { OwnerUiContext } from "../lib/core-ui/data";
import { verifyOwnerBusiness } from "../lib/core-ui/owner-business";
import { prepareAmendedDiscoveryScope, type DiscoveryOriginalScope, type DiscoverySourceScopeAmendment } from "./discovery-r12-scope";

/** Resolves only a trusted same-Business amendment. No provider call, grant,
 * authority renewal or mutation is performed when preparing this scope. */
export async function loadAmendedDiscoveryScope(context: OwnerUiContext, businessId: string, scopeId: string, now = Date.now()) {
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
  if (!uuid.test(businessId) || !uuid.test(scopeId) || !(await verifyOwnerBusiness(context, businessId))) throw new Error("r12_discovery_scope_unavailable");
  const { data, error } = await context.supabase.rpc("r12_discovery_scope_read", { p_business_id: businessId, p_scope_id: scopeId });
  if (error || !data || typeof data !== "object" || data.executionAuthorized !== false || data.amendment?.id !== scopeId || data.amendment?.businessId !== businessId || data.original?.businessId !== businessId) throw new Error("r12_discovery_scope_unavailable");
  const prepared = prepareAmendedDiscoveryScope(data.original as DiscoveryOriginalScope, data.amendment as DiscoverySourceScopeAmendment, now);
  if (prepared.amendmentHash !== data.amendmentHash) throw new Error("r12_discovery_scope_unavailable");
  return prepared;
}
