import type { PackManifest } from "../packs/types";

/** Registration is discoverability, not a route to provider execution. No workers
 * or workflows are granted this capability by the foundation release. */
export function printfulPackManifest(): PackManifest {
  return {frameworkVersion: "1.0", packKey: "capability.printful", version: "1.0.0", name: "Printful POD Foundation", kind: "capability",
    description: "Experimental read-only catalogue and deterministic configuration/pricing proposals. Live account activation, product execution and qualification remain gated.",
    dependencies: [], ui: {category: "POD · Fulfilment", summary: "Synthetic previews, scoped provider reads, print constraints, cost scenarios and identity verification. No product or order execution.", supportedBusinessTypes: ["etsy-pod"]},
    evals: ["catalog-contracts", "store-isolation", "print-dimensions", "deterministic-pricing", "v1-file-types", "identity-mapping", "no-blind-retry", "live-qualification"],
    capabilities: [{key: "fulfilment.print", adapter: "printful.foundation", description: "Trusted catalog-read interface and pure configuration, cost and identity-verification helpers. No generic worker executor, mutation transport, credential grant, paid order or publication."}],
    knowledge: [], workers: [], workflows: []};
}
