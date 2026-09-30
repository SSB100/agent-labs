import type { JsonObject } from "../core/contracts";

/** Compact prompt copy of bounds removed by the provider-safe schema projection. */
export function creativeOutputLimits(schema: JsonObject): string {
  const limits: string[] = [];
  const record = (value: unknown): value is JsonObject => !!value && typeof value === "object" && !Array.isArray(value);
  function visit(node: JsonObject, path: string) {
    for (const [minimum, maximum, unit] of [["minLength", "maxLength", "characters"], ["minItems", "maxItems", "items"]]) {
      const low = node[minimum], high = node[maximum];
      if (typeof low === "number" && typeof high === "number") limits.push(`${path}: ${low}–${high} ${unit}`);
      else if (typeof low === "number") limits.push(`${path}: at least ${low} ${unit}`);
      else if (typeof high === "number") limits.push(`${path}: at most ${high} ${unit}`);
    }
    if (record(node.properties)) for (const [key, value] of Object.entries(node.properties)) if (record(value)) visit(value, path ? `${path}.${key}` : key);
    if (record(node.items)) visit(node.items, `${path}[]`);
  }
  visit(schema, "");
  return limits.join("; ");
}
