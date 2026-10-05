import { etsyJson, formBody } from "../etsy/adapter";
import { type TransportAdmission } from "../core/transport-admission";
import { EtsyError, positiveId, record, requireEtsy, sameScope, type EtsyConnection, type EtsyScope } from "../etsy/contracts";

const API = "https://api.etsy.com/v3/application";
/** A definitive HTTP rejection is distinct from a lost/invalid success response.
 * It never authorizes a retry and does not establish a zero invoice amount. */
export class PublicationActivationRejected extends EtsyError {
  constructor(code: "publication_rejected" | "account_access_denied") { super(code); }
}
/** An exact single-listing capability. There is no create/upload/renew/delete,
 * generic URL/body input, OAuth expansion, fallback transport or retry method. */
export class EtsyPublicationAdapter {
  private readonly authorize: () => Promise<EtsyConnection>;
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;
  private readonly scope: EtsyScope;
  private readonly revision: string;
  private readonly listingId: number;
  private activated = false;
  private readonly admitDispatch?: TransportAdmission;
  private readonly admitReconciliation?: TransportAdmission;
  constructor(options: { authorize: () => Promise<EtsyConnection>; apiKey: string; scope: EtsyScope; connectionRevision: string; listingId: number; fetcher?: typeof fetch; admitDispatch?: TransportAdmission; admitReconciliation?: TransportAdmission }) {
    this.authorize = options.authorize; this.apiKey = options.apiKey; this.fetcher = options.fetcher ?? fetch;
    this.admitDispatch = options.admitDispatch;
    this.admitReconciliation = options.admitReconciliation;
    this.scope = { ...options.scope }; this.revision = options.connectionRevision; this.listingId = positiveId(options.listingId);
    requireEtsy(typeof this.apiKey === "string" && /^[^\s:]+:[^\s:]+$/.test(this.apiKey), "etsy_app_not_configured");
  }
  private exact(id: number) { requireEtsy(positiveId(id) === this.listingId, "publication_identity_or_state_changed"); return id; }
  private async request(path: string, activate = false) {
    const connection = { ...await this.authorize() }; sameScope(this.scope, connection);
    requireEtsy(connection.status === "connected" && connection.revision === this.revision && Date.parse(connection.expiresAt) > Date.now() && typeof connection.accessToken === "string" && connection.accessToken.length > 0 && !/[\r\n]/.test(connection.accessToken), "account_access_revoked");
    if (activate) { requireEtsy(!this.activated, "publication_already_dispatched"); this.activated = true; }
    const transport: typeof fetch = async (input, init) => {
      {
        const current = await this.authorize(); sameScope(this.scope, current);
        requireEtsy(current.status === "connected" && current.revision === this.revision && Date.parse(current.expiresAt) > Date.now() && current.accessToken === connection.accessToken, "account_access_revoked");
      }
      const response = await this.fetcher(input, init);
      // Only explicit client/auth/not-found/validation rejection is classified.
      // Timeouts, rate limits, 5xx and malformed responses remain uncertain.
      if (activate && [400, 401, 403, 404, 422].includes(response.status)) throw new PublicationActivationRejected(response.status === 401 || response.status === 403 ? "account_access_denied" : "publication_rejected");
      return response;
    };
    return etsyJson(transport, `${API}${path}`, { method: activate ? "PATCH" : "GET",
      headers: { "x-api-key": this.apiKey, Authorization: `Bearer ${connection.accessToken}`, Accept: "application/json", ...(activate ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      ...(activate ? { body: formBody({ state: "active" }) } : {}) }, { operation: activate ? "listing.activate" : "listing.read", admitDispatch: !activate && this.admitReconciliation ? this.admitReconciliation : this.admitDispatch });
  }
  async shop() {
    const connection = await this.authorize(); sameScope(this.scope, connection);
    const shop = record(await this.request(`/shops/${positiveId(this.scope.shopId)}`));
    requireEtsy(shop.shop_id === this.scope.shopId && shop.user_id === connection.userId && shop.currency_code === connection.currency, "shop_identity_changed"); return shop;
  }
  async listing(id: number) {
    const listing = record(await this.request(`/listings/${this.exact(id)}`));
    requireEtsy(listing.listing_id === this.listingId && listing.shop_id === this.scope.shopId, "publication_identity_or_state_changed");
    if (listing.readiness_state_id != null) return listing;
    const inventory = record(await this.request(`/listings/${this.listingId}/inventory`));
    requireEtsy(Array.isArray(inventory.products) && inventory.products.length > 0 && inventory.products.length <= 1000, "processing_readback_unavailable");
    const profiles: number[] = [];
    for (const value of inventory.products) {
      const product = record(value); if (product.is_deleted === true) continue;
      requireEtsy(Array.isArray(product.offerings) && product.offerings.length <= 1000, "processing_readback_unavailable");
      for (const value of product.offerings) {
        const offering = record(value); if (offering.is_deleted !== true && offering.is_enabled === true) profiles.push(positiveId(offering.readiness_state_id));
      }
    }
    requireEtsy(profiles.length > 0 && new Set(profiles).size === 1, "processing_readback_unavailable");
    return { ...listing, readiness_state_id: profiles[0], processing_readback: inventory };
  }
  async images(id: number) {
    const page = record(await this.request(`/listings/${this.exact(id)}/images`));
    requireEtsy(Array.isArray(page.results) && page.results.length <= 20 && (page.count === undefined || page.count === page.results.length), "invalid_response"); return page.results.map(record);
  }
  async properties(id: number) {
    const page = record(await this.request(`/shops/${this.scope.shopId}/listings/${this.exact(id)}/properties`));
    requireEtsy(Array.isArray(page.results) && page.results.length <= 30 && (page.count === undefined || page.count === page.results.length), "invalid_response"); return page.results.map(record);
  }
  async shippingProfile(id: number) { return record(await this.request(`/shops/${this.scope.shopId}/shipping-profiles/${positiveId(id)}`)); }
  async returnPolicy(id: number) { return record(await this.request(`/shops/${this.scope.shopId}/policies/return/${positiveId(id)}`)); }
  async processingProfile(id: number) { return record(await this.request(`/shops/${this.scope.shopId}/readiness-state-definitions/${positiveId(id)}`)); }
  async activate(id: number) { return this.request(`/shops/${this.scope.shopId}/listings/${this.exact(id)}`, true); }
}
