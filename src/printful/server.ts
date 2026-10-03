import "server-only";
import { existingEffectReadAdmission } from "../core/existing-effect-read";
import { requireExistingEffectReadEligibility } from "../lib/existing-effect-read-runtime";
import type { TransportAdmission } from "../core/transport-admission";
import { randomBytes, randomUUID } from "node:crypto";
import type { OwnerInterventionRecord } from "../lib/core-ui/workflows";
import type { OwnerUiContext } from "../lib/core-ui/data";
import { decimalMinor, supportedCurrency } from "./contracts";
import { MAX_CREATIVE_PNG_BYTES } from "../creative/types";
import { PrintfulProductAdapter, type ProductWriteConnection } from "./product-adapter";
import { executePrintfulProduct, type ProductConfigurationContext, type ProductConfigurationRepository, type ProductConfigurationState } from "./product-engine";
import { PrintfulProductError, PRODUCT_HASH, PRODUCT_PRODUCER_READINESS, PRODUCT_UUID, productAssert, productHash, productRecord, productRequestHash,
  validateProductSource, type ProductConfigurationApproval, type ProductConfigurationSource, type ProductScope } from "./production";

export type ProductSourceChoice = { id: string; name: string; sourceHash: string; storeId: number; catalogProductId: number; catalogVariantId: number;
  placement: string; designWidthIn: number; designHeightIn: number; retailPrice: string; currency: string; assetSha256: string; expiresAt: string };
export type ProductRunView = { id: string; name: string; status: string; reason: string | null; stopRequested: boolean;
  dispatchSent: boolean; receiptRecorded: boolean; syncProductId: number | null; syncVariantId: number | null };
export type PrintfulProductWorkspace = { businessId: string; configured: boolean; unavailable: boolean; executionAvailable: false;
  reasons: string[]; sources: ProductSourceChoice[]; runs: ProductRunView[] };
function productOwner(context: OwnerUiContext, businessId: string) {
  productAssert(PRODUCT_UUID.test(businessId) && context.businesses.some(business => business.id === businessId), "product_owner_required");
}
export function printfulProductConfigured() { return (process.env.PRINTFUL_PRODUCT_SERVER_KEY?.length ?? 0) >= 32; }
export async function productRpc(context: OwnerUiContext, businessId: string, operation: string, payload: Record<string, unknown> = {}) {
  productOwner(context, businessId);
  const keyless = operation === "workspace" || operation === "cancel";
  productAssert(keyless || printfulProductConfigured(), "product_server_unavailable");
  const { data, error } = await context.supabase.rpc("printful_product_owner_transition", { p_business_id: businessId, p_operation: operation,
    p_payload: payload, p_server_key: keyless ? "" : process.env.PRINTFUL_PRODUCT_SERVER_KEY! });
  if (error) throw new PrintfulProductError("product_state_unavailable");
  return productRecord(data);
}
/** Consumer of private, trusted producer rows. There is deliberately no form,
 * artifact metadata or owner-submitted JSON path for source registration. */
export function authenticateProductSource(raw: unknown, businessId: string, historicalAt?: number) {
  const data = productRecord(raw), source = data.source as ProductConfigurationSource;
  validateProductSource(source, historicalAt ?? Date.now(), false);
  productAssert(source.businessId === businessId && source.evidenceMode === "live" && data.sourceHash === productHash(source), "product_source_mismatch");
  return { source, sourceHash: data.sourceHash as string };
}
export async function loadPrintfulProductWorkspace(context: OwnerUiContext, businessId: string, interventionId?: string | null): Promise<PrintfulProductWorkspace> {
  productOwner(context, businessId);
  const empty: PrintfulProductWorkspace = { businessId, configured: printfulProductConfigured(), unavailable: false, executionAvailable: false,
    reasons: [...PRODUCT_PRODUCER_READINESS.reasons], sources: [], runs: [] };
  try {
    productAssert(!interventionId || PRODUCT_UUID.test(interventionId), "product_intervention_invalid");
    const raw = await productRpc(context, businessId, "workspace", interventionId ? { interventionId } : {});
    productAssert(Array.isArray(raw.sources) && Array.isArray(raw.runs) && raw.sources.length <= 100 && raw.runs.length <= 100, "product_workspace_invalid");
    return { ...empty, sources: raw.sources.map(value => {
      const row = productRecord(value);
      productAssert(typeof row.id === "string" && PRODUCT_UUID.test(row.id) && typeof row.sourceHash === "string" && PRODUCT_HASH.test(row.sourceHash) && typeof row.name === "string" && row.name.length > 0 && row.name.length <= 200 &&
        [row.storeId, row.catalogProductId, row.catalogVariantId].every(value => Number.isSafeInteger(value) && Number(value) > 0) &&
        (row.placement === "front" || row.placement === "back") && [row.designWidthIn, row.designHeightIn].every(value => typeof value === "number" && Number.isFinite(value) && value > 0) &&
        typeof row.retailPrice === "string" && decimalMinor(row.retailPrice) > 0 && typeof row.currency === "string" && supportedCurrency(row.currency) &&
        typeof row.assetSha256 === "string" && PRODUCT_HASH.test(row.assetSha256) && typeof row.expiresAt === "string" && Number.isFinite(Date.parse(row.expiresAt)), "product_workspace_invalid");
      return { id: row.id, name: row.name, sourceHash: row.sourceHash, storeId: Number(row.storeId), catalogProductId: Number(row.catalogProductId),
        catalogVariantId: Number(row.catalogVariantId), placement: String(row.placement), designWidthIn: Number(row.designWidthIn), designHeightIn: Number(row.designHeightIn),
        retailPrice: String(row.retailPrice), currency: String(row.currency), assetSha256: String(row.assetSha256), expiresAt: String(row.expiresAt) };
    }), runs: raw.runs.map(value => {
      const row = productRecord(value);
      productAssert(typeof row.id === "string" && PRODUCT_UUID.test(row.id), "product_workspace_invalid");
      return { id: row.id, name: typeof row.name === "string" ? row.name : "Single-product configuration", status: String(row.status),
        reason: typeof row.reason === "string" ? row.reason : null, stopRequested: row.stopRequested === true,
        dispatchSent: row.dispatchSent === true || row.dispatch != null, receiptRecorded: row.receiptRecorded === true,
        syncProductId: typeof row.syncProductId === "number" ? row.syncProductId : null, syncVariantId: typeof row.syncVariantId === "number" ? row.syncVariantId : null };
    }) };
  } catch { return { ...empty, unavailable: true }; }
}
/** Reconciliation can outlive a workflow. Read only the exact intervention
 * type for owned Businesses; a truncated/incomplete queue is unavailable. */
export async function loadPrintfulProductInterventions(context: OwnerUiContext): Promise<{ records: OwnerInterventionRecord[]; unavailable: boolean }> {
  const businesses = context.businesses.map(business => business.id);
  if (!businesses.length) return { records: [], unavailable: false };
  try {
    const { data, error, count } = await context.supabase.from("owner_interventions")
      .select("id,business_id,workflow_run_id,action_intent_id,intervention_type,status,title,description,options,resolution,requested_at,resolved_at,created_at,updated_at", { count: "exact" })
      .in("business_id", businesses).eq("intervention_type", "printful.product.reconcile").eq("status", "open").order("requested_at", { ascending: true }).limit(100);
    if (error || !Array.isArray(data) || data.some(row => !businesses.includes(row.business_id) || row.intervention_type !== "printful.product.reconcile" || row.status !== "open")) return { records: [], unavailable: true };
    return { records: data as OwnerInterventionRecord[], unavailable: !Number.isSafeInteger(count) || count !== data.length };
  } catch { return { records: [], unavailable: true }; }
}
/** No activation implementation is installed. Existing catalog credentials are
 * never opened here, nor widened by an environment flag. A future owner-approved
 * credential/scope producer must implement the separate private write binding. */
export async function resolvePrintfulProductWriteAuthority(context: OwnerUiContext, expected: ProductScope): Promise<ProductWriteConnection> {
  productOwner(context, expected.businessId);
  throw new PrintfulProductError("product_write_authority_unavailable");
}
export async function beginPrintfulProduct(context: OwnerUiContext, businessId: string, sourceId: string, sourceHash: string, configurationConsent: boolean) {
  productOwner(context, businessId);
  productAssert(PRODUCT_UUID.test(sourceId) && PRODUCT_HASH.test(sourceHash) && configurationConsent === true, "product_review_required");
  const { source, sourceHash: currentHash } = authenticateProductSource(await productRpc(context, businessId, "source", { sourceId }), businessId);
  productAssert(source.id === sourceId && currentHash === sourceHash, "product_source_mismatch");
  validateProductSource(source);
  // This hard gate is independent of controls/UI, server keys and fixture data.
  productAssert(PRODUCT_PRODUCER_READINESS.available, "product_placement_producer_required");
  await resolvePrintfulProductWriteAuthority(context, source);
  const approvedAt = new Date().toISOString(), requestHash = productRequestHash(source, sourceHash);
  const approval: ProductConfigurationApproval = { id: randomUUID(), sourceHash, requestHash, operation: "create_native_product", configuration: true,
    approvedAt, expiresAt: new Date(Math.min(Date.parse(source.expiresAt), Date.now() + 300_000)).toISOString() };
  const result = await productRpc(context, businessId, "prepare", { sourceId, sourceHash, requestHash, approval, approvalHash: productHash(approval) });
  productAssert(typeof result.runId === "string" && PRODUCT_UUID.test(result.runId), "product_run_invalid");
  return { runId: result.runId };
}
export function printfulProductRepository(context: OwnerUiContext, businessId: string, runId: string): ProductConfigurationRepository {
  productOwner(context, businessId); productAssert(PRODUCT_UUID.test(runId), "product_run_invalid");
  const lease = randomBytes(32).toString("hex"); let revision = 0;
  const rpc = (operation: string, payload: Record<string, unknown> = {}) => productRpc(context, businessId, operation, { ...payload, runId, lease });
  function accept(state: ProductConfigurationState, result: Record<string, unknown>) {
    const next = result.state as ProductConfigurationState;
    productAssert(next && next.id === runId && next.businessId === businessId && Number.isSafeInteger(result.revision) && Number(result.revision) >= revision, "product_scope_mismatch");
    revision = Number(result.revision); Object.assign(state, next);
  }
  return {
    async acquire() {
      const result = await rpc("acquire");
      try { const state = result.state as ProductConfigurationState; accept(state, result); return state; }
      catch (error) { try { await rpc("release"); } catch { /* No blind retry. */ } throw error; }
    },
    async save(state) { accept(state, await rpc("save", { state, revision })); },
    async guard(mode) {
      const raw = await rpc("guard", { mode }), approval = raw.approval as ProductConfigurationApproval;
      const { source, sourceHash } = authenticateProductSource(raw, businessId, mode === "reconcile" ? Date.parse(approval.approvedAt) : undefined);
      productAssert(typeof raw.approvalHash === "string" && productHash(approval) === raw.approvalHash, "product_approval_invalid");
      // SQL reloads exact separate write authority and connection for both modes.
      return { source, sourceHash, approval, approvalHash: raw.approvalHash, stopRequested: raw.stopRequested === true } satisfies ProductConfigurationContext;
    },
    async assetBytes(source) {
      productAssert(source.businessId === businessId && source.id && source.assetStoragePath.startsWith(`${businessId}/${source.creativeRunId}/`), "product_asset_path_invalid");
      const result = await context.supabase.storage.from("creative-assets").download(source.assetStoragePath);
      productAssert(!result.error && result.data && result.data.size >= 33 && result.data.size <= MAX_CREATIVE_PNG_BYTES, "product_asset_bytes_changed");
      return new Uint8Array(await result.data.arrayBuffer());
    },
    async finish(state, receipt, resource) { accept(state, await rpc("finish", { state, receipt, resource, revision })); },
    async release() { await rpc("release"); },
  };
}
export async function runPrintfulProduct(context: OwnerUiContext, businessId: string, runId: string, reconcileOnly = false) {
  const repository = printfulProductRepository(context, businessId, runId), state = await repository.acquire(); let entered = false;
  try {
    if (state.receiptRecorded || (state.stopRequested && !state.dispatch)) return state;
    if (reconcileOnly) productAssert(state.dispatch, "product_not_dispatched");
    // Remains intentionally unavailable until the separate activation workflow
    // exists. Neither arbitrary form input nor catalog.read can reach POST.
    await resolvePrintfulProductWriteAuthority(context, state);
    const saved = structuredClone(state);
    const admitReconciliation: TransportAdmission | undefined = saved.dispatch ? async request => {
      const original = await repository.guard("reconcile");
      productAssert(original.sourceHash === saved.sourceHash && original.approvalHash === saved.approvalHash &&
        original.source.connectionRevision === saved.connectionRevision, "product_binding_changed");
      const root = "https://api.printful.com";
      // The engine saves a numeric ID only after a GET verifies the immutable
      // external identity. It then rechecks that identity before reading it.
      const endpoints = [`${root}/stores/${saved.storeId}`,`${root}/files/${original.source.printfulFileId}`,`${root}/store/products/@${saved.identity}`];
      if (state.syncProductId !== null) endpoints.push(`${root}/store/products/${state.syncProductId}`);
      await existingEffectReadAdmission({businessId:saved.businessId,runId:saved.id,requestHash:saved.requestHash,
        sentAt:saved.dispatch!.sentAt,connectionId:saved.connectionId,connectionRevision:saved.connectionRevision,provider:"printful",endpoints},
        requireExistingEffectReadEligibility)(request);
    } : undefined;
    const provider = new PrintfulProductAdapter({ scope: state, mode: "provider_response", authorize: expected => resolvePrintfulProductWriteAuthority(context, expected), admitReconciliation });
    entered = true;
    return await executePrintfulProduct({ ...repository, acquire: async () => state }, provider);
  } finally { if (!entered) await repository.release(); }
}
