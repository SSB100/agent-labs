import { decimalMinor, supportedCurrency } from "./contracts";
import { requireTransportAdmission, type TransportAdmission } from "../core/transport-admission";
import { proposePrintfulProductOperation } from "./operations";
import { PrintfulProductError as ProductError, productHash, productIdentity, validateProductSource, type ProductConfigurationSource, type ProductScope } from "./production";

/** Official v1 schemas reviewed 2026-10-01. File.hash is MD5, not SHA-256.
 * SyncVariantFile has no documented physical position; SyncVariant has no
 * technique field. Order/mockup positions cannot prove a saved sync product. */
export const PRINTFUL_PRODUCT_DOCS = {
  products: "https://developers.printful.com/docs/#tag/Products-API",
  files: "https://developers.printful.com/docs/#tag/File-Library-API",
  stores: "https://developers.printful.com/docs/#tag/Store-Information-API",
  writeScope: "https://developers.printful.com/docs/edm/#create-sync-product",
} as const;
export const PRINTFUL_CONFIGURATION_READBACK_BLOCKERS = [
  "physical_placement_not_observable", "technique_not_observable",
] as const;
/** This authority is deliberately separate from catalog.read. The callback must
 * reload authoritative owner/connection/grant rows for every call. No default
 * callback, environment credential, account upgrade or persisted grant exists. */
export type ProductWriteConnection = ProductScope & {
  provider: "printful"; status: "connected"; permittedOperations: readonly ["product.configure"];
  providerScopes: readonly string[]; expiresAt: string; credential: string;
};
export type ProductWriteAuthorization = (expected: ProductScope) => Promise<ProductWriteConnection>;
export type ProductAdapterErrorCode = "product_source_invalid" | "product_write_authority_unavailable" | "product_write_access_revoked" |
  "product_provider_rejected" | "product_provider_rate_limited" | "product_provider_failure" | "product_provider_response_invalid" | "product_provider_timeout" | "product_creation_uncertain" |
  "product_readback_mismatch" | "product_file_readback_mismatch";
export class PrintfulProductError extends ProductError {
  constructor(readonly code: ProductAdapterErrorCode, readonly mutationMayHaveOccurred = false) {
    super(code); this.name = "PrintfulProductError";
  }
}
const ORIGIN = "https://api.printful.com", RESPONSE_LIMIT = 262_144;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MD5 = /^[a-f0-9]{32}$/, EXTERNAL = /^al-pf-[a-f0-9]{32}$/;
const ALLOWED_SCOPES = new Set(["stores_list/read", "stores_list", "sync_products/read", "sync_products/write", "sync_products", "file_library/read"]);
function need(value: unknown, code: ProductAdapterErrorCode = "product_provider_response_invalid"): asserts value {
  if (!value) throw new PrintfulProductError(code);
}
function record(value: unknown): Record<string, unknown> {
  need(value !== null && typeof value === "object" && !Array.isArray(value)); return value as Record<string, unknown>;
}
function positive(value: unknown): number { need(Number.isSafeInteger(value) && Number(value) > 0); return Number(value); }
function integer(value: unknown, max: number): number {
  need(Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max); return Number(value);
}
function text(value: unknown, max = 255): string {
  need(typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value)); return value;
}
function bool(value: unknown): boolean { need(typeof value === "boolean"); return value; }
function result(value: unknown) { const envelope = record(value); need(envelope.code === 200); return record(envelope.result); }
function scopeOf(value: ProductScope): ProductScope {
  need(value && UUID.test(value.businessId) && UUID.test(value.connectionId) && UUID.test(value.connectionRevision) &&
    Number.isSafeInteger(value.storeId) && value.storeId > 0 && value.storeKind === "manual_api", "product_source_invalid");
  return {businessId: value.businessId, connectionId: value.connectionId, connectionRevision: value.connectionRevision,
    storeId: value.storeId, storeKind: "manual_api"};
}
function sameScope(a: ProductScope, b: ProductScope): boolean {
  return a.businessId === b.businessId && a.connectionId === b.connectionId && a.connectionRevision === b.connectionRevision &&
    a.storeId === b.storeId && a.storeKind === b.storeKind;
}
function externalIdentity(value: unknown): string { need(typeof value === "string" && EXTERNAL.test(value), "product_source_invalid"); return value; }
function price(value: unknown): string {
  try { decimalMinor(value); } catch { throw new PrintfulProductError("product_provider_response_invalid"); }
  return value as string;
}
function currency(value: unknown) {
  try { return supportedCurrency(value); } catch { throw new PrintfulProductError("product_provider_response_invalid"); }
}
function normalizeFile(value: unknown) {
  const f = record(value);
  need(typeof f.hash === "string" && MD5.test(f.hash));
  need(["image/png", "image/jpeg"].includes(String(f.mime_type)));
  need(["ok", "waiting", "failed"].includes(String(f.status)));
  const width = positive(f.width), height = positive(f.height);
  need(width <= 100_000 && height <= 100_000);
  need(f.dpi === null || (Number.isSafeInteger(f.dpi) && Number(f.dpi) > 0 && Number(f.dpi) <= 100_000));
  need(f.type === undefined || ["default", "front", "back", "preview"].includes(String(f.type)));
  // URLs, filenames, arbitrary options and provider messages do not cross this boundary.
  return {id: positive(f.id), ...(f.type === undefined ? {} : {type: f.type as string}), hash: f.hash, mime_type: f.mime_type as string,
    width, height, dpi: f.dpi as number | null, status: f.status as "ok" | "waiting" | "failed",
    ...(f.is_temporary === undefined ? {} : {is_temporary: bool(f.is_temporary)})};
}
function normalizeSummary(value: unknown) {
  const p = record(value);
  return {id: positive(p.id), external_id: text(p.external_id, 128), name: text(p.name),
    variants: integer(p.variants, 100), synced: integer(p.synced, 100), is_ignored: bool(p.is_ignored)};
}
function normalizeProduct(value: unknown) {
  const r = result(value), product = normalizeSummary(r.sync_product);
  need(Array.isArray(r.sync_variants) && r.sync_variants.length <= 100);
  const variants = r.sync_variants.map(value => {
    const v = record(value), catalog = record(v.product);
    need(Array.isArray(v.files) && v.files.length <= 20);
    const availability = v.availability_status;
    need(availability === undefined || ["active", "discontinued", "out_of_stock", "temporary_out_of_stock"].includes(String(availability)));
    return {id: positive(v.id), external_id: text(v.external_id, 128), sync_product_id: positive(v.sync_product_id),
      synced: bool(v.synced), variant_id: positive(v.variant_id), retail_price: price(v.retail_price), currency: currency(v.currency),
      ...(v.is_ignored === undefined ? {} : {is_ignored: bool(v.is_ignored)}),
      product: {product_id: positive(catalog.product_id), variant_id: positive(catalog.variant_id)},
      files: v.files.map(normalizeFile), ...(availability === undefined ? {} : {availability_status: availability as string})};
  });
  need(product.variants === variants.length && product.synced === variants.filter(v => v.synced).length);
  need(new Set(variants.map(v => v.id)).size === variants.length && new Set(variants.map(v => v.external_id)).size === variants.length);
  need(variants.every(v => v.sync_product_id === product.id));
  return {code: 200 as const, result: {sync_product: product, sync_variants: variants}};
}
function assertSource(source: ProductConfigurationSource, scope: ProductScope, now: number) {
  try {
    need(sameScope(scopeOf(source), scope), "product_source_invalid");
    validateProductSource(source, now, false);
    const p = source.plan;
    need(["front", "back"].includes(p.placement) &&
      Number.isSafeInteger(p.productId) && p.productId > 0 && Number.isSafeInteger(p.variantId) && p.variantId > 0,
    "product_source_invalid");
    text(source.name); price(source.retailPrice); currency(source.currency);
    proposePrintfulProductOperation({plan: source.plan, storeId: scope.storeId, name: source.name,
      externalIdentity: productIdentity(source), existingSyncVariantId: null, printfulFileId: source.printfulFileId,
      fileAssetSha256: source.assetSha256, fileTypeEvidence: source.fileTypeEvidence,
      retailPrice: source.retailPrice, currency: source.currency}, now);
  } catch { throw new PrintfulProductError("product_source_invalid"); }
}

export type ProductTransportEvidence = ProductScope & {
  source: "fixture" | "provider_read" | "mutation_response"; method: "GET" | "POST";
  endpoint: string; observedAt: string; responseHash: string; liveQualified: false;
};
export type ProductAdapterOptions = {
  admitDispatch?: TransportAdmission;
  admitReconciliation?: TransportAdmission;
  scope: ProductScope; authorize?: ProductWriteAuthorization; mode: "fixture" | "provider_response";
  fetcher?: typeof fetch; timeoutMs?: number; now?: () => number;
};
async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const length = response.headers.get("content-length");
  need(length === null || (/^\d+$/.test(length) && Number(length) <= RESPONSE_LIMIT));
  need(/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "") && response.body);
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, {once: true});
  try {
    while (true) {
      need(!signal.aborted, "product_provider_timeout");
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > RESPONSE_LIMIT) { cancel(); throw new PrintfulProductError("product_provider_response_invalid"); }
      chunks.push(part.value);
    }
    need(!signal.aborted, "product_provider_timeout");
    try { return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(Buffer.concat(chunks))) as unknown; }
    catch { throw new PrintfulProductError("product_provider_response_invalid"); }
  } finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
}

/** Fixed host/methods, no redirects, retries, upload, URL artwork, updates,
 * storefront publication or orders. The one-POST latch is defense-in-depth;
 * durable dispatch/reconciliation fencing is the producer engine's job. */
export class PrintfulProductAdapter {
  private readonly options: ProductAdapterOptions;
  private readonly scope: ProductScope;
  private createAttempted = false;
  private executionGuard: ((operation: "read" | "create") => Promise<void>) | null = null;
  bindExecutionGuard(guard: (operation: "read" | "create") => Promise<void>) {
    need(this.executionGuard === null && typeof guard === "function", "product_source_invalid");
    this.executionGuard = guard;
  }
  constructor(options: ProductAdapterOptions) {
    this.scope = scopeOf(options.scope); this.options = {...options, scope: this.scope};
    need(["fixture", "provider_response"].includes(options.mode) &&
      (options.mode !== "fixture" || typeof options.fetcher === "function") &&
      Number.isSafeInteger(options.timeoutMs ?? 10_000) && (options.timeoutMs ?? 10_000) >= 1 && (options.timeoutMs ?? 10_000) <= 10_000,
    "product_source_invalid");
  }
  private now() { const value = (this.options.now ?? Date.now)(); need(Number.isFinite(value), "product_source_invalid"); return value; }
  private async authorize() {
    let connection: ProductWriteConnection;
    try {
      need(typeof this.options.authorize === "function", "product_write_authority_unavailable");
      connection = structuredClone(await this.options.authorize({...this.scope}));
      const scopes = connection.providerScopes;
      need(sameScope(scopeOf(connection), this.scope) && connection.provider === "printful" && connection.status === "connected" &&
        Array.isArray(connection.permittedOperations) && connection.permittedOperations.length === 1 && connection.permittedOperations[0] === "product.configure" &&
        Array.isArray(scopes) && scopes.length <= ALLOWED_SCOPES.size && scopes.every(s => ALLOWED_SCOPES.has(s)) && new Set(scopes).size === scopes.length &&
        (scopes.includes("sync_products") || (scopes.includes("sync_products/read") && scopes.includes("sync_products/write"))) &&
        scopes.includes("file_library/read") && (scopes.includes("stores_list/read") || scopes.includes("stores_list")) &&
        Date.parse(connection.expiresAt) > this.now() && typeof connection.credential === "string" &&
        connection.credential.length >= 8 && connection.credential.length <= 8192 && /^[\x21-\x7e]+$/.test(connection.credential), "product_write_authority_unavailable");
    } catch { throw new PrintfulProductError("product_write_authority_unavailable"); }
    return connection;
  }
  private async request<T extends object>(path: string, method: "GET" | "POST", normalize: (body: unknown) => T,
    body?: object, absentAllowed = false, beforeDispatch?: () => void): Promise<(T & {_evidence: ProductTransportEvidence}) | null> {
    // Internal path allowlist remains independent of URL-building call sites.
    need(method === "POST" ? path === "/store/products" && body !== undefined && !absentAllowed :
      (path === `/stores/${this.scope.storeId}` || /^\/files\/[1-9]\d*$/.test(path) ||
        /^\/store\/products\/(?:[1-9]\d*|@al-pf-[a-f0-9]{32})$/.test(path)) && body === undefined, "product_source_invalid");
    const controller = new AbortController(), url = `${ORIGIN}${path}`;
    let timer: ReturnType<typeof setTimeout> | undefined, dispatched = false;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => {
      controller.abort(); reject(new PrintfulProductError("product_provider_timeout", method === "POST" && dispatched));
    }, this.options.timeoutMs ?? 10_000); });
    try {
      return await Promise.race([deadline, (async () => {
        const connection = await this.authorize();
        need(!controller.signal.aborted, "product_provider_timeout");
        need(this.options.mode === "fixture" || this.executionGuard, "product_write_authority_unavailable");
        await this.executionGuard?.(method === "POST" ? "create" : "read");
        need(!controller.signal.aborted, "product_provider_timeout");
        beforeDispatch?.();
        need(Date.parse(connection.expiresAt) > this.now(), "product_write_authority_unavailable");
        const init: RequestInit = {method, redirect: "error", cache: "no-store", signal: controller.signal,
          headers: {Authorization: `Bearer ${connection.credential}`, "X-PF-Store-Id": String(this.scope.storeId), Accept: "application/json",
            ...(method === "POST" ? {"Content-Type": "application/json"} : {})}, ...(body ? {body: JSON.stringify(body)} : {})};
        await requireTransportAdmission(method === "GET" && this.options.admitReconciliation ? this.options.admitReconciliation : this.options.admitDispatch, { provider: "printful", operation: method === "POST" ? "product.configure" : "product.read", method, endpoint: url });
        if (method === "GET" && this.options.admitReconciliation) {
          const current = await this.authorize();
          need(current.credential === connection.credential, "product_write_access_revoked");
        }
        need(!controller.signal.aborted, "product_provider_timeout");
        dispatched = true;
        const response = await (this.options.fetcher ?? fetch)(url, init);
        need(!controller.signal.aborted, "product_provider_timeout");
        need(!response.redirected && (!response.url || response.url === url));
        if (response.status !== 200) {
          void response.body?.cancel().catch(() => {});
          if (response.status === 404 && method === "GET" && absentAllowed) return null;
          throw new PrintfulProductError(response.status === 401 || response.status === 403 ? "product_write_access_revoked" :
            response.status === 404 ? "product_provider_rejected" : response.status === 429 ? "product_provider_rate_limited" : "product_provider_failure");
        }
        const normalized = normalize(await boundedJson(response, controller.signal));
        // Reject even a credential echoed in an otherwise allowlisted string.
        need(!JSON.stringify(normalized).includes(connection.credential));
        const evidence: ProductTransportEvidence = {...this.scope, source: this.options.mode === "fixture" ? "fixture" :
          method === "GET" ? "provider_read" : "mutation_response", method, endpoint: url, observedAt: new Date(this.now()).toISOString(),
        responseHash: productHash(normalized), liveQualified: false};
        return {...normalized, _evidence: evidence};
      })()]);
    } catch (error) {
      // Never propagate causes, credentials, provider bodies or error messages.
      throw new PrintfulProductError(error instanceof ProductError && ["product_cancelled", "product_source_stale", "product_approval_invalid", "product_binding_changed", "product_lease_lost"].includes(error.code) ? "product_write_access_revoked" : error instanceof PrintfulProductError ? error.code : controller.signal.aborted ? "product_provider_timeout" : "product_provider_failure",
        method === "POST" && dispatched);
    } finally { clearTimeout(timer); controller.abort(); }
  }
  async store() {
    return this.request(`/stores/${this.scope.storeId}`, "GET", body => {
      const r = result(body); need(r.id === this.scope.storeId && r.type === "native", "product_readback_mismatch");
      return {code: 200 as const, result: {id: this.scope.storeId, type: "native" as const}};
    });
  }
  async file(id: number) {
    need(Number.isSafeInteger(id) && id > 0, "product_source_invalid");
    return this.request(`/files/${id}`, "GET", body => {
      const f = normalizeFile(result(body)); need(f.id === id, "product_file_readback_mismatch"); return {code: 200 as const, result: f};
    });
  }
  async findProduct(identity: string) {
    const expected = externalIdentity(identity);
    return this.request(`/store/products/@${expected}`, "GET", body => {
      const normalized = normalizeProduct(body); need(normalized.result.sync_product.external_id === expected, "product_readback_mismatch"); return normalized;
    }, undefined, true);
  }
  async product(id: number) {
    need(Number.isSafeInteger(id) && id > 0, "product_source_invalid");
    return this.request(`/store/products/${id}`, "GET", body => {
      const normalized = normalizeProduct(body); need(normalized.result.sync_product.id === id, "product_readback_mismatch"); return normalized;
    });
  }
  async create(source: ProductConfigurationSource, identity: string) {
    const expected = externalIdentity(identity), snapshot = structuredClone(source);
    assertSource(snapshot, this.scope, this.now());
    need(expected === productIdentity(snapshot) &&
      (this.options.mode === "fixture" ? snapshot.evidenceMode === "fixture" : snapshot.evidenceMode === "live"), "product_source_invalid");
    need(!this.createAttempted, "product_creation_uncertain"); this.createAttempted = true;
    // Only documented native-product fields. Currency is read-only; physical
    // position and technique are deliberately absent, never silently fabricated.
    const proposal = proposePrintfulProductOperation({plan: snapshot.plan, storeId: snapshot.storeId, name: snapshot.name,
      externalIdentity: expected, existingSyncVariantId: null, printfulFileId: snapshot.printfulFileId,
      fileAssetSha256: snapshot.assetSha256, fileTypeEvidence: snapshot.fileTypeEvidence,
      retailPrice: snapshot.retailPrice, currency: snapshot.currency}, this.now());
    const body = proposal.body;
    return this.request("/store/products", "POST", response => {
      const p = normalizeSummary(result(response));
      need(p.external_id === expected && p.name === snapshot.name && p.variants === 1 && p.synced === 1 && !p.is_ignored, "product_readback_mismatch");
      return {code: 200 as const, result: p};
    }, body, false, () => assertSource(snapshot, this.scope, this.now()));
  }
}

function verifyReadEvidence(source: ProductConfigurationSource, envelope: unknown, paths: string[], normalized: object, now: number) {
  const evidence = record(envelope)._evidence;
  // Injected engine fixtures may use minimal v1 bodies. Live observations must
  // carry the adapter's exact independently-read provenance for each endpoint.
  if (evidence === undefined && source.evidenceMode === "fixture") return;
  const e = record(evidence);
  need(sameScope(source, e as ProductTransportEvidence) && e.method === "GET" &&
    (source.evidenceMode === "fixture" ? e.source === "fixture" : e.source === "provider_read") &&
    e.liveQualified === false && typeof e.endpoint === "string" && paths.includes(e.endpoint) &&
    typeof e.observedAt === "string" && Date.parse(e.observedAt) <= now && now - Date.parse(e.observedAt) <= 60_000 &&
    e.responseHash === productHash(normalized), "product_provider_response_invalid");
}

/** Verify one independent /files/{id} read against the trusted upload record.
 * The caller must load the record from authenticated server storage. */
export function verifyPrintfulFileBinding(source: ProductConfigurationSource, fileResponse: unknown, now = Date.now()) {
  const snapshot = structuredClone(source);
  assertSource(snapshot, scopeOf(snapshot), Date.parse(snapshot.observedAt));
  need(Date.parse(snapshot.observedAt) <= now, "product_source_invalid");
  const file = normalizeFile(result(fileResponse)), binding = snapshot.fileBinding, plan = snapshot.plan;
  need(file.id === snapshot.printfulFileId && file.hash === binding.providerMd5 && file.mime_type === "image/png" &&
    file.status === "ok" && file.is_temporary === false && file.width === plan.sourceWidthPx && file.height === plan.sourceHeightPx &&
    file.width === binding.widthPx && file.height === binding.heightPx, "product_file_readback_mismatch");
  const normalized = {code: 200, result: file};
  verifyReadEvidence(snapshot, fileResponse, [`${ORIGIN}/files/${file.id}`], normalized, now);
  return {fileReadHash: productHash(normalized)};
}

/** This is association evidence, not full configuration or production approval.
 * The trusted authenticated-upload binding supplies SHA-256→provider-file
 * lineage; v1's MD5 and metadata alone cannot establish SHA-256 equality. */
export function verifyPrintfulProductReadback(input: {source: ProductConfigurationSource; identity: string;
  response: unknown; fileResponse: unknown; storeResponse: unknown}, now = Date.now()) {
  const snapshot = structuredClone(input.source), expected = externalIdentity(input.identity);
  assertSource(snapshot, scopeOf(snapshot), Date.parse(snapshot.observedAt));
  need(Date.parse(snapshot.observedAt) <= now, "product_source_invalid");
  need(expected === productIdentity(snapshot), "product_readback_mismatch");
  const store = result(input.storeResponse);
  need(store.id === snapshot.storeId && store.type === "native", "product_readback_mismatch");
  const {fileReadHash} = verifyPrintfulFileBinding(snapshot, input.fileResponse, now);
  const product = normalizeProduct(input.response), file = normalizeFile(result(input.fileResponse));
  verifyReadEvidence(snapshot, input.storeResponse, [`${ORIGIN}/stores/${snapshot.storeId}`],
    {code: 200, result: {id: snapshot.storeId, type: "native"}}, now);
  verifyReadEvidence(snapshot, input.response, [`${ORIGIN}/store/products/@${expected}`, `${ORIGIN}/store/products/${product.result.sync_product.id}`], product, now);
  const p = product.result.sync_product, variants = product.result.sync_variants, plan = snapshot.plan, binding = snapshot.fileBinding;
  need(p.external_id === expected && p.name === snapshot.name && p.variants === 1 && p.synced === 1 && !p.is_ignored && variants.length === 1,
    "product_readback_mismatch");
  const v = variants[0];
  need(v.external_id === `${expected}-v` && v.synced && v.is_ignored === false && v.availability_status === "active" && v.sync_product_id === p.id &&
    v.variant_id === plan.variantId && v.product.product_id === plan.productId && v.product.variant_id === plan.variantId &&
    decimalMinor(v.retail_price) === decimalMinor(snapshot.retailPrice) && v.currency === snapshot.currency, "product_readback_mismatch");
  const prints = v.files.filter(f => f.type !== "preview");
  need(prints.length === 1 && prints[0].type === snapshot.fileTypeEvidence.fileType, "product_file_readback_mismatch");
  const associated = prints[0];
  need(associated.id === snapshot.printfulFileId && associated.hash === binding.providerMd5 && associated.mime_type === "image/png" &&
    associated.status === "ok" && associated.is_temporary === false && associated.width === file.width && associated.height === file.height,
  "product_file_readback_mismatch");
  const facts = {storeId: snapshot.storeId, syncProductId: p.id, syncVariantId: v.id, externalId: p.external_id,
    variantExternalId: v.external_id, catalogProductId: plan.productId, catalogVariantId: plan.variantId,
    placement: plan.placement, fileType: snapshot.fileTypeEvidence.fileType, printfulFileId: file.id, providerMd5: file.hash, widthPx: file.width, heightPx: file.height,
    retailPriceMinor: decimalMinor(v.retail_price), currency: v.currency};
  return {syncProductId: p.id, syncVariantId: v.id, providerFactsHash: productHash(facts),
    productReadHash: productHash(product), fileReadHash, associationVerified: true as const, assetBindingVerified: true as const,
    physicalPlacementVerified: false as const, techniqueVerified: false as const, configurationVerified: false as const,
    blockers: [...PRINTFUL_CONFIGURATION_READBACK_BLOCKERS]};
}
