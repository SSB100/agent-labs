import type { JsonObject } from "../core/contracts";

/** Exact compact copy of constraints omitted by provider schema projection. Never truncates. */
export function workerOutputLimits(schema: JsonObject): string {
  const limits: string[] = [], active = new Set<object>();
  const record = (value: unknown): value is JsonObject => !!value && typeof value === "object" && !Array.isArray(value);
  function visit(node: JsonObject, path: string, depth: number) {
    if (depth > 40 || active.has(node)) throw new Error("Output-limit schema is cyclic or too deeply nested.");
    active.add(node);
    const name = path || "$";
    for (const [minimum, maximum, unit] of [["minLength", "maxLength", "characters"], ["minItems", "maxItems", "items"]]) {
      const low = node[minimum], high = node[maximum];
      if (typeof low === "number" && typeof high === "number") limits.push(`${name}: ${low}–${high} ${unit}`);
      else if (typeof low === "number") limits.push(`${name}: at least ${low} ${unit}`);
      else if (typeof high === "number") limits.push(`${name}: at most ${high} ${unit}`);
    }
    for (const [key, operator] of [["minimum", ">="], ["maximum", "<="], ["exclusiveMinimum", ">"], ["exclusiveMaximum", "<"]]) {
      if (typeof node[key] === "number") limits.push(`${name}: value ${operator} ${node[key]}`);
    }
    if (typeof node.multipleOf === "number") limits.push(`${name}: multiple of ${node.multipleOf}`);
    if (node.uniqueItems === true) limits.push(`${name}: unique items`);
    if (typeof node.pattern === "string") limits.push(`${name}: pattern ${node.pattern}`);
    if (typeof node.format === "string") limits.push(`${name}: format ${node.format}`);
    if (Array.isArray(node.type) && node.type.includes("null")) limits.push(`${name}: null allowed; bounds apply when non-null`);
    if (record(node.properties)) for (const [key, value] of Object.entries(node.properties)) if (record(value)) visit(value, path ? `${path}.${key}` : key, depth + 1);
    if (record(node.items)) visit(node.items, `${path}[]`, depth + 1);
    for (const keyword of ["anyOf", "oneOf"] as const) {
      const branches = node[keyword];
      if (Array.isArray(branches)) {
        if (branches.some(branch => record(branch) && branch.type === "null")) limits.push(`${name}: null allowed; bounds apply when non-null`);
        const nonNull = branches.filter(branch => record(branch) && branch.type !== "null");
        nonNull.forEach((branch, index) => {
          if (record(branch)) visit(branch, nonNull.length > 1 ? `${name} (${keyword} alternative ${index + 1})` : path, depth + 1);
        });
      }
    }
    active.delete(node);
  }
  visit(schema, "", 0);
  return [...new Set(limits)].join("; ");
}
