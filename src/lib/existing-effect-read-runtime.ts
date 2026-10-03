import type { ExistingEffectReadBinding } from "../core/existing-effect-read";
import { createRuntimeClient } from "./supabase/runtime";

/** The server key alone is insufficient: SQL also requires an exact saved
 * effect, current account and separately provisioned readback-purpose proof.
 * No proof is installed by the migration and no credentials enter this RPC. */
export async function requireExistingEffectReadEligibility(binding: Readonly<ExistingEffectReadBinding>, endpoint: string): Promise<void> {
  const key = process.env.R05_ADMISSION_SERVER_KEY?.trim();
  if (!key) throw new Error("existing_effect_read_eligibility_unavailable");
  const result = await createRuntimeClient().rpc("r05_admission_server", {
    p_business_id: binding.businessId, p_operation: "existing_effect_read", p_server_key: key,
    p_payload: {provider:binding.provider,runId:binding.runId,requestHash:binding.requestHash,sentAt:binding.sentAt,
      connectionId:binding.connectionId,connectionRevision:binding.connectionRevision,endpoint},
  });
  const value: unknown = result.data;
  if (result.error || !value || typeof value !== "object" || Array.isArray(value) ||
      !("decision" in value) || value.decision !== "allowed" || !("shouldRead" in value) || value.shouldRead !== true) {
    throw new Error("existing_effect_read_eligibility_unavailable");
  }
}
