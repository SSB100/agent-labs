import { createHash } from "node:crypto";

/** Existing canonical snapshot algorithm; extracted without changing bytes. */
export function discoveryV2Hash(value: unknown): string {
  const canonical = (v: unknown): string => {
    if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
    if (!!v && typeof v === "object" && !Array.isArray(v)) return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
    if (v === undefined || (typeof v === "number" && !Number.isFinite(v))) throw new Error("Non-JSON discovery snapshot.");
    return JSON.stringify(v);
  };
  return createHash("sha256").update(canonical(value)).digest("hex");
}
export function discoveryEvidenceIdentity(evidence: { quote: string }): string {
  return discoveryV2Hash({ version: "r12.evidence-text.1", quote: evidence.quote.normalize("NFC").replace(/[\t\n\v\f\r ]+/g, " ").trim() });
}
