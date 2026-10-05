import type { SourceProvenance } from "../core/external-eligibility";

/** Intentionally closed. No reviewed application-purpose/source evidence or
 * atomic revocation-aware store is installed. A key, env flag, opaque R05 hash,
 * source domain or owner form cannot lift this boundary. Enablement needs the
 * separately reviewed R11 evidence/storage/dispatch integration contract. */
export function requireRuntimeExternalSourceEligibility(provenance: SourceProvenance): never {
  // Even well-formed lineage cannot substitute for reviewed purpose evidence.
  void provenance;
  throw new Error("external_source_eligibility_unavailable");
}
