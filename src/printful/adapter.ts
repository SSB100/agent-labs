import { parseCatalogProduct, parseCatalogVariant, parseVariantPrices, printfulReadRequest, assertPrintful,
  type CatalogProductId, type CatalogVariantId, type PrintfulCatalogVariant, type SupportedCurrency, type PrintfulProvenance } from "./contracts";

/** Implemented by the trusted Core account service, not by worker/model input.
 * No default credential, environment lookup, connection or grant is created here. */
export type PrintfulServerConnection = {
  businessId: string; externalResourceId: string; storeId: number; provider: "printful";
  status: "connected"; permittedOperations: readonly ["catalog.read"];
  /** Server-only; excluded from every returned artifact, receipt and error. */
  credential: string;
};
export type PrintfulReadAuthorization = (businessId: string) => Promise<PrintfulServerConnection>;
export type PrintfulReadReceipt = {
  provider: "printful"; businessId: string; connectionResourceId: string; storeId: number;
  executionMode: "fixture" | "provider_read"; method: "GET"; endpoint: string;
  observedAt: string; httpStatus: 200; responseHash: string; externalMutation: false; liveQualified: false;
};
export class PrintfulReadError extends Error {
  constructor(readonly category: "connection_required" | "unauthorized" | "rate_limited" | "not_found" | "provider_failure" | "invalid_response" | "timeout", message: string) { super(message); this.name = "PrintfulReadError"; }
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const RESPONSE_LIMIT_BYTES = 2_000_000;
async function boundedJson(response: Response) {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > RESPONSE_LIMIT_BYTES)) throw new PrintfulReadError("invalid_response", "Printful response exceeds the bounded catalog envelope.");
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json") || !response.body) throw new PrintfulReadError("invalid_response", "Printful did not return a JSON catalog response.");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength;
      if (bytes > RESPONSE_LIMIT_BYTES) { await reader.cancel(); throw new PrintfulReadError("invalid_response", "Printful response exceeds the bounded catalog envelope."); } chunks.push(part.value); }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { throw new PrintfulReadError("invalid_response", "Printful returned malformed JSON; its body is not logged."); }
}
/** Only documented GET descriptors. Writes, orders, file upload and redirects are absent. */
type CatalogAdapterOptions = {authorize: PrintfulReadAuthorization; fetcher?: typeof fetch; mode: "fixture" | "provider_response"; freshnessMs: number};
export class PrintfulCatalogAdapter {
  private readonly options: CatalogAdapterOptions;
  constructor(options: CatalogAdapterOptions) {
    this.options = {...options};
    assertPrintful(options.mode !== "fixture" || typeof options.fetcher === "function", "Fixture mode requires an injected mock transport.");
    assertPrintful(["fixture", "provider_response"].includes(options.mode) && Number.isSafeInteger(options.freshnessMs) && options.freshnessMs > 0 && options.freshnessMs <= 86_400_000, "A bounded explicit catalog freshness policy is required.");
  }
  private async read(businessId: string, request: ReturnType<typeof printfulReadRequest>) {
    if (!UUID.test(businessId)) throw new PrintfulReadError("connection_required", "A valid Business is required.");
    let connection: PrintfulServerConnection;
    try { connection = structuredClone(await this.options.authorize(businessId)); }
    catch { throw new PrintfulReadError("connection_required", "The scoped Printful connection could not be verified."); }
    if (!connection || connection.businessId !== businessId || connection.provider !== "printful" || connection.status !== "connected" ||
      !UUID.test(connection.externalResourceId) || !Number.isSafeInteger(connection.storeId) || connection.storeId <= 0 ||
      !Array.isArray(connection.permittedOperations) || connection.permittedOperations.length !== 1 || connection.permittedOperations[0] !== "catalog.read" ||
      typeof connection.credential !== "string" || connection.credential.length < 8 || connection.credential.length > 8192 || /[\r\n]/.test(connection.credential)) {
      throw new PrintfulReadError("connection_required", "A verified same-Business read-only Printful connection is required.");
    }
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await (this.options.fetcher ?? fetch)(request.url, {method: "GET", redirect: "error", signal: controller.signal,
        headers: {Authorization: `Bearer ${connection.credential}`, "X-PF-Store-Id": String(connection.storeId), Accept: "application/json"}});
      if (response.status !== 200) {
        const category = response.status === 401 || response.status === 403 ? "unauthorized" : response.status === 429 ? "rate_limited" : response.status === 404 ? "not_found" : "provider_failure";
        throw new PrintfulReadError(category, `Printful catalog request stopped with HTTP ${response.status}; no automatic retry.`);
      }
      const body = await boundedJson(response), observedAt = new Date().toISOString();
      const context = {mode: this.options.mode, observedAt, expiresAt: new Date(Date.parse(observedAt) + this.options.freshnessMs).toISOString()};
      const scope = {businessId, connectionResourceId: connection.externalResourceId, storeId: connection.storeId};
      return {body, context, receipt: (provenance: PrintfulProvenance): PrintfulReadReceipt => ({provider: "printful", ...scope,
        executionMode: this.options.mode === "fixture" ? "fixture" : "provider_read", method: "GET", endpoint: request.url,
        observedAt, httpStatus: 200, responseHash: provenance.responseHash, externalMutation: false, liveQualified: false})};
    } catch (error) {
      if (error instanceof PrintfulReadError) throw error;
      // Fetch failures can echo credentials or provider content. Do not propagate them.
      throw new PrintfulReadError(controller.signal.aborted ? "timeout" : "provider_failure", controller.signal.aborted ? "Printful read timed out; no automatic retry." : "Printful read failed; no provider body or credential is retained.");
    } finally { clearTimeout(timeout); }
  }
  private parse<T>(parser: () => T): T {
    try { return parser(); }
    catch { throw new PrintfulReadError("invalid_response", "Printful returned an invalid catalog schema or mismatched identity."); }
  }
  async product(businessId: string, id: CatalogProductId) {
    const expected = structuredClone(id);
    const read = await this.read(businessId, printfulReadRequest("product", expected)), value = this.parse(() => parseCatalogProduct(read.body, expected, read.context));
    return {value, receipt: read.receipt(value.provenance)};
  }
  async variant(businessId: string, id: CatalogVariantId, productId: CatalogProductId) {
    const expected = structuredClone(id), parent = structuredClone(productId);
    const read = await this.read(businessId, printfulReadRequest("variant", expected)), value = this.parse(() => parseCatalogVariant(read.body, expected, parent, read.context));
    return {value, receipt: read.receipt(value.provenance)};
  }
  async prices(businessId: string, variant: PrintfulCatalogVariant, currency: SupportedCurrency, sellingRegion: string) {
    const expected = structuredClone(variant);
    const read = await this.read(businessId, printfulReadRequest("prices", expected.id, {currency, sellingRegion}));
    const value = this.parse(() => parseVariantPrices(read.body, expected, {...read.context, currency, sellingRegion, productionCurrency: null}));
    return {value, receipt: read.receipt(value.provenance)};
  }
}
