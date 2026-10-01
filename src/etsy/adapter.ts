import { EtsyError, requireEtsy, record, positiveId, draftBody, sameScope, validatePackage, type EtsyConnection, type EtsyProductPackage, type EtsyProperty } from "./contracts";

const API = "https://api.etsy.com/v3/application";
/** Only bounded first-party HTTPS, no redirects, error bodies, automatic retries,
 * activation, orders, deletion or arbitrary request descriptors. */
export async function etsyJson(fetcher: typeof fetch, url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetcher(url, { ...init, redirect: "error", cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new EtsyError(response.status === 401 || response.status === 403 ? "account_access_denied" : response.status === 429 ? "rate_limited" : "provider_response_failed");
    requireEtsy(response.body && response.headers.get("content-type")?.includes("application/json"), "invalid_response");
    const reader = response.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 2_000_000) { await reader.cancel(); throw new EtsyError("response_too_large"); }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof EtsyError) throw error;
    throw new EtsyError(controller.signal.aborted ? "provider_timeout" : "provider_response_failed");
  } finally { clearTimeout(timeout); }
}
export function formBody(input: Record<string, unknown>) {
  const result = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) for (const item of value) result.append(`${key}[]`, String(item));
    else result.set(key, String(value));
  }
  return result;
}
export class EtsyDraftAdapter {
  private readonly authorize: () => Promise<EtsyConnection>;
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;
  private scope: EtsyConnection | null = null;
  constructor(options: { authorize: () => Promise<EtsyConnection>; apiKey: string; fetcher?: typeof fetch }) {
    this.authorize = options.authorize; this.apiKey = options.apiKey; this.fetcher = options.fetcher ?? fetch;
    requireEtsy(typeof this.apiKey === "string" && /^[^\s:]+:[^\s:]+$/.test(this.apiKey), "etsy_app_not_configured");
  }
  private async request(path: string, method = "GET", body?: URLSearchParams | FormData) {
    const connection = await this.authorize();
    if (this.scope) {
      sameScope(this.scope, connection);
      requireEtsy(this.scope.revision === connection.revision, "account_access_revoked");
    } else this.scope = { ...connection };
    const shopPath = path.match(/^\/shops\/(\d+)/);
    requireEtsy(!shopPath || Number(shopPath[1]) === connection.shopId, "account_scope_mismatch");
    requireEtsy(connection.status === "connected" && Date.parse(connection.expiresAt) > Date.now() && typeof connection.accessToken === "string" && !/[\r\n]/.test(connection.accessToken), "account_access_denied");
    positiveId(connection.shopId);
    return etsyJson(this.fetcher, `${API}${path}`, { method, headers: { "x-api-key": this.apiKey, Authorization: `Bearer ${connection.accessToken}`, Accept: "application/json" }, body });
  }
  async shop() {
    const connection = await this.authorize();
    const shop = record(await this.request(`/shops/${positiveId(connection.shopId)}`));
    requireEtsy(shop.shop_id === connection.shopId && shop.user_id === connection.userId && shop.currency_code === connection.currency, "shop_identity_changed");
    return shop;
  }
  async listing(id: number) {
    const listing = record(await this.request(`/listings/${positiveId(id)}?legacy=false`));
    // Drafts can omit the listing-level processing profile. Read its actual
    // offering relationship, never substitute the requested package value.
    if (listing.readiness_state_id == null) {
      const inventory = record(await this.request(`/listings/${positiveId(id)}/inventory?legacy=false`));
      requireEtsy(Array.isArray(inventory.products) && inventory.products.length > 0, "processing_readback_unavailable");
      const profiles: number[] = [];
      for (const value of inventory.products) {
        const product = record(value); if (product.is_deleted === true) continue;
        requireEtsy(Array.isArray(product.offerings), "processing_readback_unavailable");
        for (const item of product.offerings) {
          const offering = record(item); if (offering.is_deleted === true) continue;
          profiles.push(positiveId(offering.readiness_state_id));
        }
      }
      requireEtsy(profiles.length > 0 && new Set(profiles).size === 1, "processing_readback_unavailable");
      return { ...listing, readiness_state_id: profiles[0], processing_readback: inventory };
    }
    return listing;
  }
  async listings(offset = 0) {
    requireEtsy(Number.isSafeInteger(offset) && offset >= 0 && offset <= 1900, "listing_scan_limit");
    const connection = await this.authorize();
    const page = record(await this.request(`/shops/${connection.shopId}/listings?state=draft&limit=100&offset=${offset}&legacy=false`));
    requireEtsy(Array.isArray(page.results) && page.results.length <= 100 && Number.isSafeInteger(page.count), "invalid_response");
    return { count: Number(page.count), results: page.results.map(record) };
  }
  async findDraft(identity: string) {
    const matches: Record<string, unknown>[] = [];
    for (let offset = 0; offset < 2000; offset += 100) {
      const page = await this.listings(offset);
      matches.push(...page.results.filter(row => typeof row.description === "string" && row.description.endsWith(`\n\nReference: ${identity}`)));
      if (offset + page.results.length >= page.count) {
        requireEtsy(matches.length <= 1, "ambiguous_external_identity"); return matches[0] ?? null;
      }
      requireEtsy(page.results.length > 0, "incomplete_listing_scan");
    }
    throw new EtsyError("listing_scan_limit");
  }
  async create(p: EtsyProductPackage, identity: string) {
    const connection = await this.authorize();
    validatePackage(p, connection.businessId);
    requireEtsy(connection.businessId === p.businessId && connection.currency === p.currency, "package_account_mismatch");
    return this.request(`/shops/${connection.shopId}/listings?legacy=false`, "POST", formBody(draftBody(p, identity)));
  }
  async images(listingId: number) {
    const value = record(await this.request(`/listings/${positiveId(listingId)}/images`));
    requireEtsy(Array.isArray(value.results) && value.results.length <= 20, "invalid_response"); return value.results.map(record);
  }
  async upload(listingId: number, bytes: Uint8Array, rank: number, altText: string) {
    const connection = await this.authorize();
    requireEtsy(Number.isSafeInteger(rank) && rank >= 1 && rank <= 10 && bytes.length > 8 && bytes.length <= 7_000_000 && bytes.subarray(0, 8).every((v, i) => v === [137, 80, 78, 71, 13, 10, 26, 10][i]), "invalid_image_upload");
    const body = new FormData(); body.set("image", new Blob([new Uint8Array(bytes)], { type: "image/png" }), `image-${rank}.png`);
    body.set("rank", String(rank)); body.set("alt_text", altText); body.set("overwrite", "false");
    return this.request(`/shops/${connection.shopId}/listings/${positiveId(listingId)}/images`, "POST", body);
  }
  async properties(listingId: number) {
    const connection = await this.authorize();
    const value = record(await this.request(`/shops/${connection.shopId}/listings/${positiveId(listingId)}/properties`));
    requireEtsy(Array.isArray(value.results), "invalid_response"); return value.results.map(record);
  }
  async setProperty(listingId: number, property: EtsyProperty) {
    const connection = await this.authorize();
    return this.request(`/shops/${connection.shopId}/listings/${positiveId(listingId)}/properties/${positiveId(property.propertyId)}`, "PUT", formBody({ value_ids: property.valueIds, values: property.values, ...(property.scaleId ? { scale_id: property.scaleId } : {}) }));
  }
}
