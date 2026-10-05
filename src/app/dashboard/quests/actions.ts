"use server";

import { createClient } from "@/lib/supabase/server";
import { R04_RPC, type R04Operation, type R04Payloads, type R04ResearchPreview, type R04Result } from "@/core/quest-contract";
import { containsCredentialLikeValue } from "@/core/quest-intake";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPERATIONS: R04Operation[] = ["business.save", "quest.save", "quest.preference", "quest.select", "envelope.propose", "envelope.confirm", "envelope.revoke", "research.link"];

/** Only intent persistence. This module deliberately has no dispatcher or model imports. */
export async function saveQuestIntent<O extends R04Operation>(businessId: string, operation: O, payload: R04Payloads[O], submissionId: string): Promise<{ ok: true; result: R04Result } | { ok: false; message: string }> {
  if (!UUID.test(businessId) || !UUID.test(submissionId) || !OPERATIONS.includes(operation)) return { ok: false, message: "Invalid request. Reload this Business and try again." };
  if (containsCredentialLikeValue(payload)) return { ok: false, message: "Credential-like content was rejected. Enter credentials through Connections." };
  let encoded: string;
  try { encoded = JSON.stringify(payload); } catch { return { ok: false, message: "Invalid request." }; }
  if (!encoded || encoded.length > 24000) return { ok: false, message: "The request is too large." };
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims?.sub) return { ok: false, message: "Your session has expired. Sign in and reload before saving." };
  // The RPC checks ownership, exact revisions, reference validity and idempotency transactionally.
  const { data, error } = await supabase.rpc(R04_RPC.transition, { p_business_id: businessId, p_operation: operation, p_payload: payload, p_submission_id: submissionId });
  if (error) return { ok: false, message: "The save could not be verified. The record may have changed, a reference may be unavailable, or setup may be incomplete. Reload and review before retrying." };
  return { ok: true, result: data as R04Result };
}

export async function previewResearchLink(businessId: string, experimentId: string): Promise<R04ResearchPreview> {
  if (!UUID.test(businessId) || !UUID.test(experimentId)) return { status: "unavailable" };
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims?.sub) return { status: "unavailable" };
  const { data, error } = await supabase.rpc(R04_RPC.research, { p_business_id: businessId, p_experiment_id: experimentId });
  return error || !data ? { status: "unavailable" } : data as R04ResearchPreview;
}
