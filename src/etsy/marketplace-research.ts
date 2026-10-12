import { etsyJson } from "./adapter";
import { hash, positiveId, record, requireEtsy, UUID } from "./contracts";
import { requireTransportAdmission, type TransportAdmission, type TransportAdmissionRequest } from "../core/transport-admission";
import { validatePodExecutingRelease, type PodExecutingRelease } from "../products/discovery-r12-pod-release";

/** Inert integration seam. No registry, route, credential lookup or default fetch.
 * The future owner/runtime integration must supply separately reviewed marketplace
 * purpose admission. An own-shop OAuth grant does not authorize this operation. */
export const ETSY_MARKETPLACE_RESEARCH_VERSION = "etsy.active-listing-research.1";
export const ETSY_MARKETPLACE_OPERATION = "marketplace.active-listings.read";
export const ETSY_MARKETPLACE_ENDPOINT = "https://api.etsy.com/v3/application/listings/active";
export const ETSY_MARKETPLACE_MAX_RESULTS = 100;

export type EtsyMarketplaceQuery = Readonly<{ keywords: string; limit: number }>;
export type EtsyMarketplaceContext = Readonly<{
  businessId: string; goalId: string; operationId: string; executingRelease: PodExecutingRelease;
}>;
export type EtsyMarketplaceAdmission = TransportAdmissionRequest & EtsyMarketplaceContext & Readonly<{
  contractVersion: typeof ETSY_MARKETPLACE_RESEARCH_VERSION;
  requestHash: string;
}>;
export type EtsyListingProjection = Readonly<{
  listingId: number;
  title: string;
  tags: readonly string[] | null;
  taxonomyId: number | null;
  advertisedPrice: Readonly<{ amount: number; divisor: number; currencyCode: string }> | null;
}>;

function text(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && [...value].length <= maximum &&
    Buffer.from(value, "utf8").toString("utf8") === value &&
    ![...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

/** One page only. The model chooses keywords, never a URL, header, OAuth scope,
 * arbitrary query parameter, pagination instruction or publication operation. */
export function etsyMarketplaceRequest(raw: unknown) {
  const input = record(raw);
  requireEtsy(Object.keys(input).sort().join(",") === "keywords,limit" && text(input.keywords, 4_000) &&
    input.keywords === input.keywords.trim() && Number.isSafeInteger(input.limit) && Number(input.limit) >= 1 &&
    Number(input.limit) <= ETSY_MARKETPLACE_MAX_RESULTS, "invalid_marketplace_query");
  const query: EtsyMarketplaceQuery = Object.freeze({ keywords: input.keywords, limit: Number(input.limit) });
  const url = new URL(ETSY_MARKETPLACE_ENDPOINT);
  url.search = new URLSearchParams({ keywords: query.keywords, limit: String(query.limit), offset: "0", sort_on: "score" }).toString();
  // Unicode keywords expand during URL encoding. This is a local transport
  // safety bound, independent of the unchanged 100-result provider limit.
  requireEtsy(Buffer.byteLength(url.href, "utf8") <= 8_192, "marketplace_query_too_long");
  const request = Object.freeze({ method: "GET" as const, endpoint: url.href, query });
  return Object.freeze({ ...request, requestHash: hash({ version: ETSY_MARKETPLACE_RESEARCH_VERSION, ...request }) });
}

function projectListing(value: unknown): EtsyListingProjection {
  const row = record(value);
  requireEtsy(row.state === "active" && (row.is_private == null || row.is_private === false) && text(row.title, 512), "invalid_marketplace_listing");
  const listingId = positiveId(row.listing_id);
  // Null/missing optional metadata remains unknown, never inferred from another
  // listing. Bounds reject a response; they never silently cut source content.
  let tags: readonly string[] | null = null;
  if (row.tags != null) {
    requireEtsy(Array.isArray(row.tags) && row.tags.length <= 13 && row.tags.every(tag => text(tag, 80)), "invalid_marketplace_listing");
    tags = Object.freeze([...row.tags] as string[]);
  }
  const taxonomyId = row.taxonomy_id == null ? null : positiveId(row.taxonomy_id);
  let advertisedPrice: EtsyListingProjection["advertisedPrice"] = null;
  if (row.price != null) {
    const price = record(row.price);
    requireEtsy(Number.isSafeInteger(price.amount) && Number(price.amount) >= 0 && Number.isSafeInteger(price.divisor) &&
      Number(price.divisor) > 0 && typeof price.currency_code === "string" && /^[A-Z]{3}$/.test(price.currency_code), "invalid_marketplace_price");
    advertisedPrice = Object.freeze({ amount: Number(price.amount), divisor: Number(price.divisor), currencyCode: price.currency_code });
  }
  // Deliberately omit descriptions, images/designs, user/shop identities,
  // shipping/contact data, stock, favorites and views. They are not sales proof.
  return Object.freeze({ listingId, title: row.title, tags, taxonomyId, advertisedPrice });
}

/** Projection only, not permission or a demand assessment. All product text is
 * untrusted evidence. Never insert it in system instructions or execute its URLs. */
export function projectEtsyMarketplaceResponse(raw: unknown, requestedLimit: number) {
  requireEtsy(Number.isSafeInteger(requestedLimit) && requestedLimit >= 1 && requestedLimit <= ETSY_MARKETPLACE_MAX_RESULTS, "invalid_marketplace_query");
  const response = record(raw);
  requireEtsy(Number.isSafeInteger(response.count) && Number(response.count) >= 0 && Array.isArray(response.results) &&
    response.results.length <= requestedLimit && Number(response.count) >= response.results.length, "invalid_marketplace_response");
  const listings = Object.freeze(response.results.map(projectListing));
  requireEtsy(new Set(listings.map(listing => listing.listingId)).size === listings.length, "duplicate_marketplace_listing");
  return Object.freeze({
    // This is Etsy's reported matching-listing count, not search volume, buyer
    // demand, unique sellers, a representative sample or a verified POD count.
    reportedMatchingListingCount: Number(response.count),
    returnedListingCount: listings.length,
    listings,
    evidenceKind: "active-listing-supply-sample" as const,
    establishesSalesOrDemand: false as const,
  });
}

export async function readEtsyMarketplaceSample(input: { query: EtsyMarketplaceQuery; context: EtsyMarketplaceContext }, dependencies: {
  apiKey: string;
  fetcher: typeof fetch;
  admitDispatch?: TransportAdmission<EtsyMarketplaceAdmission>;
  now?: () => number;
}) {
  const request = etsyMarketplaceRequest(input.query);
  const context = Object.freeze({ businessId: input.context.businessId, goalId: input.context.goalId,
    operationId: input.context.operationId, executingRelease: Object.freeze(validatePodExecutingRelease(input.context.executingRelease)) });
  requireEtsy([context.businessId, context.goalId, context.operationId].every(value => UUID.test(value)), "invalid_marketplace_context");
  // Validate before Headers construction: its native error can echo an invalid
  // header value. Only printable ASCII components, separated by one colon.
  requireEtsy(typeof dependencies.apiKey === "string" && /^[\x21-\x39\x3b-\x7e]+:[\x21-\x39\x3b-\x7e]+$/.test(dependencies.apiKey), "etsy_app_not_configured");
  requireEtsy(typeof dependencies.fetcher === "function", "marketplace_transport_required");
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  requireEtsy(Number.isSafeInteger(startedAt) && startedAt >= 0 && startedAt <= 8_640_000_000_000_000, "invalid_marketplace_clock");
  const value = await etsyJson(dependencies.fetcher, request.endpoint, {
    method: request.method,
    headers: { "x-api-key": dependencies.apiKey, Accept: "application/json" },
  }, { operation: ETSY_MARKETPLACE_OPERATION, admitDispatch: async descriptor => {
    requireEtsy(descriptor.provider === "etsy" && descriptor.operation === ETSY_MARKETPLACE_OPERATION &&
      descriptor.method === request.method && descriptor.endpoint === request.endpoint, "marketplace_request_changed");
    // The trusted callback must atomically claim this exact operation and check
    // tenant, reviewed purpose, query/data policy, rate/call budget, Stop/expiry
    // and release qualification. This module cannot create that authority.
    await requireTransportAdmission(dependencies.admitDispatch, { ...descriptor, ...context,
      requestedScopes: [], contractVersion: ETSY_MARKETPLACE_RESEARCH_VERSION, requestHash: request.requestHash });
  } });
  const retrievedAt = now();
  requireEtsy(Number.isSafeInteger(retrievedAt) && retrievedAt >= startedAt && retrievedAt <= 8_640_000_000_000_000, "invalid_marketplace_clock");
  const projection = projectEtsyMarketplaceResponse(value, request.query.limit);
  return Object.freeze({
    version: ETSY_MARKETPLACE_RESEARCH_VERSION,
    ...context,
    request,
    retrievedAt: new Date(retrievedAt).toISOString(),
    projection,
    // Canonical projection hash, not a claim to retain/hash the raw wire body.
    projectionHash: hash(projection),
  });
}
