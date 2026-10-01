import type { ActionReceipt, ExternalResource } from "../core/contracts";
import { EtsyError, requireEtsy, record, positiveId, validatePackage, sameScope, hash, bytesHash, draftIdentity, verifyListing,
  type EtsyScope, type EtsyConnection, type EtsyProductPackage, type EtsyImage, type EtsyProperty } from "./contracts";

export type DraftOperation = { key: string; status: "sent" | "verified"; externalId: number | null; beforeImageIds?: number[] };
export type DraftState = EtsyScope & {
  id: string; actionIntentId: string; resourceId: string; receiptId: string; packageHash: string;
  connectionRevision: string; identity: string; listingId: number | null; operations: DraftOperation[];
  status: "ready" | "running" | "needs_owner" | "verified" | "cancelled"; reason: string | null;
};
export interface DraftProvider {
  shop(): Promise<unknown>;
  listing(id: number): Promise<unknown>;
  findDraft(identity: string): Promise<unknown | null>;
  create(p: EtsyProductPackage, identity: string): Promise<unknown>;
  images(id: number): Promise<Record<string, unknown>[]>;
  upload(id: number, bytes: Uint8Array, rank: number, alt: string): Promise<unknown>;
  properties(id: number): Promise<Record<string, unknown>[]>;
  setProperty(id: number, property: EtsyProperty): Promise<unknown>;
}
/** The repository must enforce an exclusive durable lease and compare-and-set
 * writes. Production uses the SQL repository; tests inject a deterministic one. */
export interface DraftRepository {
  acquire(): Promise<DraftState>;
  save(state: DraftState): Promise<void>;
  guard(): Promise<{ connection: EtsyConnection; package: EtsyProductPackage }>;
  image(image: EtsyImage): Promise<Uint8Array>;
  finish(state: DraftState, receipt: ActionReceipt, resource: ExternalResource): Promise<void>;
  release(): Promise<void>;
}
function propertyMatches(row: Record<string, unknown> | undefined, prop: EtsyProperty) {
  return !!row && row.property_id === prop.propertyId && (row.scale_id ?? null) === prop.scaleId &&
    Array.isArray(row.value_ids) && hash([...row.value_ids].sort()) === hash([...prop.valueIds].sort()) &&
    Array.isArray(row.values) && hash([...row.values].sort()) === hash([...prop.values].sort());
}
function imageMatches(row: Record<string, unknown>, listingId: number, rank: number, image: EtsyImage) {
  return row.listing_id === listingId && row.rank === rank && row.alt_text === image.altText && Number.isSafeInteger(row.listing_image_id) && Number(row.listing_image_id) > 0;
}
export async function executeEtsyDraft(repository: DraftRepository, provider: DraftProvider, now = () => Date.now()) {
  const state = await repository.acquire();
  try {
    if (["verified", "cancelled"].includes(state.status)) return state;
    const guard = async () => {
      const context = await repository.guard(); sameScope(state, context.connection);
      requireEtsy(context.connection.status === "connected" && context.connection.revision === state.connectionRevision && Date.parse(context.connection.expiresAt) > now(), "account_access_revoked");
      validatePackage(context.package, state.businessId, now());
      requireEtsy(hash(context.package) === state.packageHash && draftIdentity(state, context.package) === state.identity && context.connection.currency === context.package.currency, "stale_package_or_approval");
      return context.package;
    };
    const p = await guard(); await provider.shop();
    state.status = "running"; state.reason = null; await repository.save(state);
    let creation = state.operations.find(op => op.key === "create");
    if (!creation) {
      // Includes an already-created draft from an earlier request identity. A
      // marker collision never permits adoption without exact field readback.
      const prior = await provider.findDraft(state.identity);
      if (prior) {
        state.listingId = verifyListing(prior, state, p, state.identity);
        creation = { key: "create", status: "verified", externalId: state.listingId };
        state.operations.push(creation); await repository.save(state);
      } else {
        await guard();
        creation = { key: "create", status: "sent", externalId: null };
        state.operations.push(creation); await repository.save(state);
        // This checkpoint is before dispatch. Crash, timeout, malformed output
        // or storage failure makes the operation uncertain, never retryable.
        await guard();
        const created = record(await provider.create(p, state.identity));
        creation.externalId = positiveId(created.listing_id); state.listingId = creation.externalId;
        await repository.save(state);
      }
    }
    if (!state.listingId) {
      const found = await provider.findDraft(state.identity);
      requireEtsy(found, "uncertain_creation_not_found");
      state.listingId = verifyListing(found, state, p, state.identity); creation.externalId = state.listingId;
      await repository.save(state);
    }
    const listingId = state.listingId;
    verifyListing(await provider.listing(listingId), state, p, state.identity, listingId);
    creation.status = "verified"; await repository.save(state);
    for (let index = 0; index < p.images.length; index++) {
      const image = p.images[index], rank = index + 1, key = `image:${image.assetId}:${image.sha256}`;
      await guard(); verifyListing(await provider.listing(listingId), state, p, state.identity, listingId);
      let op = state.operations.find(value => value.key === key);
      let images = await provider.images(listingId);
      if (!op) {
        requireEtsy(!images.some(row => row.rank === rank), "image_rank_already_occupied");
        const bytes = await repository.image(image);
        requireEtsy(bytesHash(bytes) === image.sha256, "asset_bytes_changed");
        op = { key, status: "sent", externalId: null, beforeImageIds: images.map(row => positiveId(row.listing_image_id)) };
        state.operations.push(op); await repository.save(state); await guard();
        const result = record(await provider.upload(listingId, bytes, rank, image.altText));
        op.externalId = positiveId(result.listing_image_id); await repository.save(state);
        images = await provider.images(listingId);
      }
      // A lost upload response cannot prove binary identity from alt text/rank.
      // Reconcile the saved provider ID only; without it, retain uncertainty and
      // never upload again. No perceptual/hash equivalence is fabricated.
      requireEtsy(op.externalId !== null, "uncertain_image_identity");
      const matches = images.filter(row => row.listing_image_id === op.externalId && imageMatches(row, listingId, rank, image));
      requireEtsy(matches.length === 1 && images.filter(row => row.rank === rank).length === 1, "image_readback_mismatch");
      op.status = "verified"; await repository.save(state);
    }
    for (const prop of p.properties) {
      await guard(); verifyListing(await provider.listing(listingId), state, p, state.identity, listingId);
      const key = `property:${prop.propertyId}`;
      let op = state.operations.find(value => value.key === key);
      let properties = await provider.properties(listingId);
      if (!op) {
        op = { key, status: "sent", externalId: prop.propertyId }; state.operations.push(op);
        await repository.save(state); await guard();
        await provider.setProperty(listingId, prop); properties = await provider.properties(listingId);
      }
      // PUT is not repeated either: an exact subsequent GET must settle it.
      requireEtsy(propertyMatches(properties.find(row => row.property_id === prop.propertyId), prop), "property_readback_mismatch");
      op.status = "verified"; await repository.save(state);
    }
    await guard();
    const listing = await provider.listing(listingId), images = await provider.images(listingId), properties = await provider.properties(listingId);
    verifyListing(listing, state, p, state.identity, listingId);
    requireEtsy(images.length === p.images.length && p.images.every((image, index) => images.some(row => row.listing_image_id === state.operations.find(op => op.key === `image:${image.assetId}:${image.sha256}`)?.externalId && imageMatches(row, listingId, index + 1, image))), "final_image_readback_mismatch");
    requireEtsy(p.properties.every(prop => propertyMatches(properties.find(row => row.property_id === prop.propertyId), prop)), "final_property_readback_mismatch");
    await guard();
    const occurredAt = new Date(now()).toISOString();
    const resource: ExternalResource = { id: state.resourceId, businessId: state.businessId, provider: "etsy", resourceType: "draft_listing",
      externalId: `shop:${state.shopId}:listing:${listingId}`, status: "active", canonicalUrl: `https://www.etsy.com/your/shops/me/listing-editor/edit/${listingId}`,
      createdAt: occurredAt, updatedAt: occurredAt, metadata: { connectionId: state.connectionId, shopId: state.shopId, listingId, packageHash: state.packageHash, identity: state.identity, state: "draft", publicationAllowed: false } };
    const receipt: ActionReceipt = { id: state.receiptId, businessId: state.businessId, actionIntentId: state.actionIntentId, externalResourceId: state.resourceId,
      attempt: 1, outcome: "succeeded", provider: "etsy", requestFingerprint: state.packageHash, occurredAt, createdAt: occurredAt,
      responseSummary: { listingId, shopId: state.shopId, state: "draft", publicationAllowed: false, verifiedBy: "independent_get", responseHash: hash({ listing, images, properties }), packageHash: state.packageHash,
        imageMappings: p.images.map(image => ({ assetId: image.assetId, sha256: image.sha256, listingImageId: state.operations.find(op => op.key === `image:${image.assetId}:${image.sha256}`)!.externalId })) } };
    state.status = "verified"; state.reason = null; await repository.finish(state, receipt, resource);
    return state;
  } catch (error) {
    state.status = "needs_owner"; state.reason = error instanceof EtsyError ? error.code : "execution_interrupted";
    // Repository preserves an existing cancellation and all prior write markers.
    await repository.save(state); return state;
  } finally { await repository.release(); }
}
