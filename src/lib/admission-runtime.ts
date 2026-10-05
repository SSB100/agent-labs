import { externalSourceProvenance, type ModelInputProvenance } from "../core/external-eligibility";
import { requireRuntimeExternalSourceEligibility } from "./external-eligibility-runtime";
import { createHash } from "node:crypto";
import type { AdmissionDispatchInput, LegacyAccountingSource } from "../core/admission-contract";
import type { ModelDispatchAdmission } from "../models/types";
import type { JsonObject } from "../core/contracts";
import { createRuntimeClient } from "./supabase/runtime";

type RuntimeScope = { businessId: string; coreWorkflowRunId: string; runtimeCapability: string };
type ModelAdmissionBinding = {
  operationKey: string; requestHash: string; callKey: string; reservedMicrousd: number;
  providerModelId: string; accounting: LegacyAccountingSource; dataClasses: string[]; sourceProvenance?: ModelInputProvenance;
};
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Only the trusted runtime that received the provider result can attest it.
 * Database settlement and original ledger write occur in one transaction. */
export async function settleLegacyAdmission(scope: RuntimeScope, settlement: {
  kind: "research" | "creative" | "listing" | "listing_qualification"; runId: string | null;
  callKey: string; reportedMicrousd: number | null; providerRequestId: string | null; receipt: JsonObject;
}): Promise<void> {
  const ownedScope = structuredClone(scope), owned = structuredClone(settlement);
  const key = process.env.R05_ADMISSION_SERVER_KEY?.trim();
  if (!key) throw new Error("operating_policy_settlement_unavailable");
  const result = await createRuntimeClient().rpc("r05_admission_server", {
    p_business_id: ownedScope.businessId, p_operation: "legacy_settle", p_server_key: key,
    p_payload: { ...owned, workflowRunId: ownedScope.coreWorkflowRunId, runtimeCapability: ownedScope.runtimeCapability },
  });
  if (result.error) throw new Error("operating_policy_settlement_unverified");
}

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
    const provenance = externalSourceProvenance(owned.dataClasses, sourceDomains, owned.sourceProvenance, owned.requestHash, owned.operationKey);
    if (provenance) requireRuntimeExternalSourceEligibility(provenance);
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
    if (!result.error && record(result.data) && ["blocked", "needs_owner"].includes(String(result.data.decision)) && result.data.shouldDispatch === false &&
        typeof result.data.requestId === "string" && /^[0-9a-f-]{36}$/i.test(result.data.requestId)) {
      // A definite denial permits only server-proven no-marker release. A lost
      // response, ambiguous replay or possible dispatch never enters this path.
      try {
        await createRuntimeClient().rpc("r05_admission_server", {
          p_business_id: ownedScope.businessId, p_operation: "release_unsent", p_server_key: serverKey,
          p_payload: { requestId: result.data.requestId, evidenceHash: digest(JSON.stringify({ payload, denial: result.data })) },
        });
      } catch { /* Preserve held liability when the release cannot be verified. */ }
    }
    if (result.error || !record(result.data) || result.data.decision !== "allowed" || result.data.shouldDispatch !== true ||
        typeof result.data.requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(result.data.requestId)) {
      throw new Error("operating_policy_dispatch_denied");
    }
  };
}
