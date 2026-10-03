import { createHash } from "node:crypto";
import type { AdmissionDispatchInput, LegacyAccountingSource } from "../core/admission-contract";
import type { ModelDispatchAdmission } from "../models/types";
import { createRuntimeClient } from "./supabase/runtime";

type RuntimeScope = { businessId: string; coreWorkflowRunId: string; runtimeCapability: string };
type ModelAdmissionBinding = {
  operationKey: string; requestHash: string; callKey: string; reservedMicrousd: number;
  providerModelId: string; accounting: LegacyAccountingSource; dataClasses: string[];
};
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Server runtime only. The authority key stays in environment and never enters
 * durable worker input, prompts, browser forms, receipts or returned errors. */
export function modelDispatchAdmission(scope: RuntimeScope, binding: ModelAdmissionBinding): ModelDispatchAdmission {
  const ownedScope = structuredClone(scope), owned = structuredClone(binding);
  return async wire => {
    const serverKey = process.env.R05_ADMISSION_SERVER_KEY?.trim();
    if (!serverKey || wire.url !== "https://openrouter.ai/api/v1/chat/completions" || wire.method !== "POST" ||
        !Number.isSafeInteger(owned.reservedMicrousd) || owned.reservedMicrousd < 0 || !/^[a-f0-9]{64}$/.test(owned.requestHash)) {
      throw new Error("operating_policy_admission_unavailable");
    }
    const body: unknown = JSON.parse(wire.body);
    if (!record(body) || body.model !== owned.providerModelId || !Number.isSafeInteger(body.max_tokens) || Number(body.max_tokens) <= 0 || body.stream !== false) {
      throw new Error("operating_policy_wire_binding_invalid");
    }
    let sourceDomains: string[] = [];
    if (owned.operationKey === "research.search") {
      const tools = body.tools;
      if (!Array.isArray(tools) || tools.length !== 1 || !record(tools[0]) || tools[0].type !== "openrouter:web_search" ||
          !record(tools[0].parameters) || tools[0].parameters.engine !== "exa" || tools[0].parameters.max_uses !== 1 ||
          !Array.isArray(tools[0].parameters.allowed_domains) || tools[0].parameters.allowed_domains.some(domain => typeof domain !== "string")) {
        throw new Error("operating_policy_source_binding_invalid");
      }
      sourceDomains = [...tools[0].parameters.allowed_domains] as string[];
    } else if (body.tools !== undefined) throw new Error("operating_policy_tools_not_authorized");
    const payload: AdmissionDispatchInput = {
      workflowRunId: ownedScope.coreWorkflowRunId, runtimeCapability: ownedScope.runtimeCapability,
      operationKey: owned.operationKey, requestHash: owned.requestHash, wireRequestHash: digest(wire.body),
      providerModelId: owned.providerModelId, maximumOutputTokens: Number(body.max_tokens), wireRequestBytes: Buffer.byteLength(wire.body, "utf8"),
      idempotencyKey: `${ownedScope.coreWorkflowRunId}:${owned.accounting.kind}:${owned.callKey}`, accounting: owned.accounting,
      sourceDomains, dataClasses: owned.dataClasses, accountId: null, accountRevision: null,
      currency: "USD", liabilityMicrounits: String(owned.reservedMicrousd),
    };
    const result = await createRuntimeClient().rpc("r05_admission_server", {
      p_business_id: ownedScope.businessId, p_operation: "guard", p_payload: payload, p_server_key: serverKey,
    });
    if (result.error || !record(result.data) || result.data.decision !== "allowed" || result.data.shouldDispatch !== true ||
        typeof result.data.requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(result.data.requestId)) {
      throw new Error("operating_policy_dispatch_denied");
    }
  };
}
