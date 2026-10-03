import type { TransportAdmission } from "./transport-admission";

export type ExistingEffectReadBinding = {
  businessId: string; runId: string; requestHash: string; sentAt: string;
  connectionId: string; connectionRevision: string; provider: "etsy" | "printful";
  endpoints: string[];
};
/** A trusted server verifier must prove the saved marker, current account and
 * provider-purpose/data-use eligibility. Financial pause/expiry is not a new
 * effect, but neither an old approval nor this binding manufactures eligibility.
 * This helper cannot settle liability or admit writes, redirects or other IDs. */
export function existingEffectReadAdmission(binding: ExistingEffectReadBinding,
  verify?: (binding: Readonly<ExistingEffectReadBinding>, endpoint: string) => Promise<void>): TransportAdmission {
  const owned = structuredClone(binding);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const origin = owned.provider === "etsy" ? "https://api.etsy.com" : "https://api.printful.com";
  if (![owned.businessId, owned.runId, owned.connectionId, owned.connectionRevision].every(value => uuid.test(value)) ||
      !/^[a-f0-9]{64}$/.test(owned.requestHash) || !Number.isFinite(Date.parse(owned.sentAt)) ||
      !owned.endpoints.length || owned.endpoints.length > 12 || owned.endpoints.some(endpoint => {
        const url = new URL(endpoint); return url.origin !== origin || !!url.search || !!url.hash || !!url.username || !!url.password;
      })) throw new Error("existing_effect_read_binding_invalid");
  Object.freeze(owned.endpoints); Object.freeze(owned);
  return async request => {
    if (!verify || request.provider !== owned.provider || request.method !== "GET" ||
        request.operation !== (owned.provider === "etsy" ? "listing.read" : "product.read") ||
        !owned.endpoints.includes(request.endpoint)) throw new Error("existing_effect_read_not_authorized");
    await verify(owned, request.endpoint);
  };
}
