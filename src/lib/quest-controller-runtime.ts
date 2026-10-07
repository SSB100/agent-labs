import "server-only";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { QuestSnapshot, QuestStore } from "../core/quest-controller";
import { readQuestKnowledge } from "../core/reviewed-knowledge";
import { createRuntimeClient } from "./supabase/runtime";

/** Trusted runtime only. No route, cron, provider or production adapter is enabled
 * by R07. Callers must first qualify the finite adapter and its capability gates. */
export function createQuestControllerStore(businessId: string, goalId: string, authority?: { controllerKey: string; admissionKey: string; recoveryScopeId?: string }): QuestStore {
  const key = authority?.controllerKey ?? process.env.R07_CONTROLLER_SERVER_KEY?.trim();
  const admissionKey = authority?.admissionKey ?? process.env.R05_ADMISSION_SERVER_KEY?.trim();
  if (!key || !admissionKey) throw new Error("quest_controller_authority_unconfigured");
  const lease = randomBytes(32).toString("hex");
  const client = createRuntimeClient();
  const capability = (attemptId: string) => createHmac("sha256", key).update(`r07:${businessId}:${goalId}:${attemptId}`).digest("hex");
  const rpc = async (operation: string, payload: Record<string, unknown>, epoch?: number) => {
    const owned = structuredClone(payload);
    if (["schedule", "reserve"].includes(operation)) {
      if (typeof owned.attemptId !== "string") throw new Error("quest_controller_attempt_required");
      owned.runtimeCapability = capability(owned.attemptId);
    }
    const recoveryDispatch = operation === "dispatch" && authority?.recoveryScopeId !== undefined;
    const result = await client.rpc(recoveryDispatch ? "r12_recovery_dispatch" : "r07_controller", { p_business_id: businessId, p_goal_id: goalId,
      ...(recoveryDispatch ? { p_scope_id: authority.recoveryScopeId } : { p_operation: operation }),
      p_payload: owned, p_submission_id: randomUUID(), p_server_key: key, p_lease_token: lease, p_epoch: epoch ?? null, p_admission_key: admissionKey });
    // Never reflect database detail: RPC parameters include authority credentials.
    if (result.error) throw new Error("quest_controller_transition_unverified");
    return result.data as Record<string, unknown> | null;
  };
  return {
    read: async () => {
      const result = await rpc("read", {}) as QuestSnapshot | null;
      if (result) {
        if (result.businessId !== businessId || result.goalId !== goalId) throw new Error("quest_controller_scope_mismatch");
        // A missing R09 projection is unavailable, never silently zero knowledge.
        result.knowledge = readQuestKnowledge(result.knowledge, businessId, result.planId);
      }
      return result;
    },
    command: async (operation, payload, epoch) => {
      const result = await rpc(operation, payload, epoch);
      if (!result) throw new Error("quest_controller_transition_unverified");
      return result;
    },
  };
}
