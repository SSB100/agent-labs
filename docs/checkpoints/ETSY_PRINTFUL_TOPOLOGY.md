# Etsy and Printful selling topology

Reviewed 2026-10-02 against deployed `32af4ef32d5582375a3844d2df8d46171f448b11`. This correction clarifies the original Stage 15–18 product/listing path and Stage 22 order path. It does not enable a provider action or claim live qualification.

## Intended selling connection

Use the **Etsy-linked Printful store** for the Etsy selling Business. An Etsy shop, its linked store inside Printful, and an Agent Labs account connection are separate identities and grants. The Etsy-linked Printful store ID is not the Etsy shop ID.

The existing native **Manual/API store** producer and saved-designer checker are bounded custom-integration/qualification work. They do not connect that product to an Etsy listing or import Etsy orders. Do not bind a temporary Manual/API store to the selling Business merely to pass account setup.

Accounts currently accepts either store type for `catalog.read` only. The verifier requires exactly one accessible store and accepts only an empty provider scope list or `stores_list/read`; every other scope is rejected. Public documentation does not settle whether that scope is exposed or implicit in the current single-store token form. Stop if the portal requires broader access; do not substitute an all-stores token. Product-write authority remains separate and disabled.

The account database permits one Printful store per Business and rejects reassignment to a different store ID, including after local disconnect. Supporting another binding or a replacement would require a separately reviewed change. The secure form therefore requires deliberate store-type selection and warns before token submission. Selecting the Etsy-linked type does not enable the native product executor or qualify a product.

## What the current implementation does not connect

- `src/printful/production.ts` and `product-adapter.ts`: durable product execution is restricted to `manual_api`, with live dispatch disabled and partial observation receipts only
- `src/printful/operations.ts`: ecommerce variant mapping is a pure, non-authorizing proposal, not an executable transport
- `src/etsy/contracts.ts` and `engine.ts`: draft creation copies reviewed listing content and images. Its internal Printful resource/receipt references establish upstream provenance; they do not establish an Etsy purchasable-variant → Printful sync-variant association
- `src/listing/`: independent listing review does not create that association
- `src/etsy-publication/`: publication checks listing content, review and fees. Its existing guards do not establish supplier variant linkage or supplier order-confirmation settings. The independent fee gate remains closed
- `src/printful/mapping.ts`: fulfilment preflight is an identity helper, with `productionReady:false` and `orderSubmissionAuthorized:false`. No paid-order ingestion, supplier-order transport or tracking reconciliation is implemented

Production-partner disclosure, a matching name/SKU, catalog access, native sync IDs and a successful listing read are not substitutes for the cross-provider association. Printful documents that Etsy synchronization uses product/variant IDs rather than SKUs.

## Next bounded, coherent route to qualify

The preferred route to investigate is **one Etsy-linked Printful product → one existing Etsy draft → independent review and guarded draft adoption**. Printful documents creating the product in the linked store and sending it to Etsy in draft state. This avoids creating a second unrelated draft in Agent Labs.

The current Stage 16 creation path requires a verified Printful product first, while the ecommerce mapping helper requires an already-imported Etsy variant. Switching the connection type cannot resolve that sequencing issue. A future adoption/update path must explicitly resolve it without weakening upstream product evidence or inventing a completed draft receipt.

The smallest end-to-end qualification must independently establish:

1. Exact Business, both connection revisions, Etsy shop and linked Printful store
2. Exact Etsy listing and purchasable product/variant identities associated with the correct Printful sync product/variant and catalog variant
3. Approved uploaded bytes, saved design placement and truthful finished-product mockup provenance
4. The same existing Etsy draft after reviewed updates, without a duplicate create or accidental activation
5. Current supplier manual-confirmation settings, independently observed and tied to this store; a checkbox or owner JSON cannot assert provider state

The route is not yet qualified or implemented. Actual account linking, uploads, product/draft saves, browser costs and expanded access require their applicable approvals. Present the exact durable/schema/security scope before implementation or deployment of those boundaries.

## Supplier orders and Stage 22

During initial product/listing qualification, supplier order confirmation must remain manual. Printful's automatic confirmation can send eligible imported orders directly to fulfilment when billing is configured, outside Agent Labs' current checks. The app does not inspect or change that setting today and must display it as unverified, never as enabled/disabled or safe by inference. This is distinct from Etsy listing-renewal or shipping-profile settings.

Before any future publication activation, add an authoritative guard for the verified variant association and supplier confirmation state alongside the existing product, review, fee and owner-consent gates. This clarity patch adds explanations only; it does not install that future guard or claim that fee evidence alone would make selling ready.

Stage 22 remains responsible for paid-order ingestion/validation, supplier cost and financial-policy enforcement, idempotent fulfilment, shipping/tracking, external receipts and realised profit. Provider-native order import alone does not satisfy that stage. Supplier automatic confirmation and payment activation must not be enabled as a shortcut around it.

## Official references

- [Connect an Etsy shop to Printful](https://help.printful.com/hc/en-us/articles/50262420051985-How-do-I-connect-Etsy-with-Printful)
- [Create linked products as Etsy drafts, or sync existing Etsy listings](https://help.printful.com/hc/en-us/articles/50262382828433-How-do-I-add-products-to-my-Etsy-store)
- [Order confirmation, imports and Etsy product/variant identity](https://help.printful.com/hc/en-us/articles/50262167491217-How-do-the-import-order-settings-for-my-integration-work)
- [Manual/API store behavior](https://help.printful.com/hc/en-us/articles/50262225690257-How-do-I-create-and-use-a-manual-order-API-store)
