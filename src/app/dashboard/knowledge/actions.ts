"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { containsCredentialLikeValue } from "@/core/quest-intake";
import { KNOWLEDGE_ID, knowledgeObject, validKnowledgeMutation, type KnowledgeOwnerOperation } from "@/lib/core-ui/console-knowledge-query";
export type KnowledgeActionResult = { ok: true; id: string; message: string } | { ok: false; message: string };
/** Owners can propose private lessons and deliberately select reviewed guidance, never review or promote it. */
export async function saveKnowledge(businessId: string, operation: KnowledgeOwnerOperation, payload: unknown, submissionId: string): Promise<KnowledgeActionResult> {
  if (!KNOWLEDGE_ID.test(businessId) || !KNOWLEDGE_ID.test(submissionId) || !validKnowledgeMutation(operation, payload)) return { ok: false, message: "Invalid Knowledge request. Check the exact Business, evidence references, revision and reason." };
  let encoded: string;
  try { encoded = JSON.stringify(payload); } catch { return { ok: false, message: "Invalid Knowledge request." }; }
  if (!encoded || Buffer.byteLength(encoded, "utf8") > 20000 || containsCredentialLikeValue(payload)) return { ok: false, message: "The request is too large or contains credential-like content. Use Connections for credentials." };
  const failure = { ok: false as const, message: "The save could not be verified. A reference, review status or current application may have changed. Reload and inspect the exact record before retrying." };
  let data: unknown;
  try {
    const client = await createClient();
    const { data: claims, error: authError } = await client.auth.getClaims();
    if (authError || !claims?.claims?.sub) return { ok: false, message: "Your session expired. Sign in and reload before saving Knowledge." };
    const response = await client.rpc("r09_knowledge_owner", { p_business_id: businessId, p_operation: operation, p_payload: payload, p_submission_id: submissionId });
    if (response.error) return failure;
    data = response.data;
  } catch { return failure; }
  const request = payload as Record<string, unknown>;
  if (!knowledgeObject(data) || data.businessId !== businessId || typeof data.id !== "string" || !KNOWLEDGE_ID.test(data.id)) return failure;
  if (operation === "propose") {
    if (typeof data.proposalId !== "string" || !KNOWLEDGE_ID.test(data.proposalId) || request.proposalId !== null && data.proposalId !== request.proposalId || data.version !== Number(request.expectedVersion) + 1 || data.status !== "proposed") return failure;
  } else if (data.operation !== operation || data.previousApplicationId !== request.expectedApplicationId || (operation === "apply" && data.releaseId !== request.releaseId) || (operation === "remove" && (data.releaseId !== null || data.packKey !== request.packKey)) || (operation === "rollback" && (typeof data.releaseId !== "string" || !KNOWLEDGE_ID.test(data.releaseId)))) return failure;
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/quests");
  return { ok: true, id: data.id, message: operation === "propose" ? "Private proposal saved. Platform review and safe redaction are required before reuse." : operation === "remove" ? "Guidance removed from future selection for this Business. Historical pins remain unchanged." : "Exact reviewed version selected for future work in this Business. Historical and in-flight pins remain unchanged." };
}
