import type { ExternalResource } from "../core/contracts";
import type { PrintfulReadAuthorization, PrintfulServerConnection } from "./adapter";
import { assertPrintful, printfulHash } from "./contracts";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export type PrintfulStoreBinding = {
  businessId: string; connectionResourceId: string; storeId: number;
  storeKind: "manual_api" | "ecommerce_linked";
  status: "connected" | "revoked"; expiresAt: string;
};
/** All three lookups belong to trusted server infrastructure. A model/form cannot
 * supply a binding, credential or owner verdict. This creates no grant or secret. */
export function printfulReadAuthorization(input: {
  requireBusinessOwner: (businessId: string) => Promise<void>;
  loadBinding: (businessId: string) => Promise<PrintfulStoreBinding | null>;
  resolveServerCredential: (connectionResourceId: string) => Promise<string | null>;
}): PrintfulReadAuthorization {
  return async businessId => {
    assertPrintful(uuid.test(businessId), "A valid Business is required.");
    await input.requireBusinessOwner(businessId);
    const binding = structuredClone(await input.loadBinding(businessId));
    assertPrintful(binding && binding.businessId === businessId && uuid.test(binding.connectionResourceId) &&
      Number.isSafeInteger(binding.storeId) && binding.storeId > 0 && binding.status === "connected" &&
      ["manual_api", "ecommerce_linked"].includes(binding.storeKind) && Date.parse(binding.expiresAt) > Date.now(),
    "An active same-Business Printful store binding is required.");
    const credential = await input.resolveServerCredential(binding.connectionResourceId);
    assertPrintful(typeof credential === "string" && credential.length >= 8 && credential.length <= 8192 && !/[\r\n]/.test(credential), "A server-held Printful credential is required.");
    return {businessId, externalResourceId: binding.connectionResourceId, storeId: binding.storeId, provider: "printful", status: "connected", permittedOperations: ["catalog.read"], credential} satisfies PrintfulServerConnection;
  };
}

/** Normalize only the explicitly selected v1 store. Store discovery/GET is not
 * authorization to connect it, obtain persistent access or configure products. */
export function inspectPrintfulStore(response: unknown, expected: {storeId: number; storeKind: PrintfulStoreBinding["storeKind"]}) {
  const envelope = response as {code?: unknown; result?: {id?: unknown; type?: unknown; name?: unknown}} | null;
  const result = envelope?.result;
  assertPrintful(envelope?.code === 200 && result && result.id === expected.storeId && Number.isSafeInteger(result.id) && expected.storeId > 0,
    "Printful returned a different or invalid store.");
  assertPrintful(typeof result.type === "string" && typeof result.name === "string" && result.name.trim().length > 0 && result.name.length <= 2000,
    "Printful store type and name are required.");
  // Unknown integration types must not be guessed into ecommerce write semantics.
  assertPrintful(["manual_api", "ecommerce_linked"].includes(expected.storeKind) &&
    (expected.storeKind === "manual_api" ? result.type === "native" : result.type !== "native" && /^[a-z][a-z0-9_-]{0,79}$/.test(result.type)),
    "Printful store integration differs from the selected store kind.");
  return {storeId: expected.storeId, storeKind: expected.storeKind, providerType: result.type, name: result.name,
    responseHash: printfulHash(response), connectionAuthorized: false as const, productExecutionAuthorized: false as const};
}
export function printfulConnectionSummary(resource: ExternalResource | null, businessId: string) {
  if (!resource || resource.businessId !== businessId || resource.provider !== "printful" || resource.resourceType !== "printful.store" ||
    resource.status !== "active" || resource.metadata.connectionVerified !== true || typeof resource.metadata.expiresAt !== "string" ||
    Date.parse(resource.metadata.expiresAt) <= Date.now() || !Number.isFinite(Date.parse(resource.metadata.expiresAt))) {
    return {status: "not_connected" as const, liveQualified: false as const, productExecutionAuthorized: false as const};
  }
  return {status: "read_only" as const, liveQualified: false as const, productExecutionAuthorized: false as const};
}
