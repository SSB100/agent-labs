import type { JsonObject } from "../core/contracts";

/** Only the separately scoped one-image pilot uses this concise brief. Legacy
 * manifests remain unchanged; the original returned artifact is never trimmed. */
export function focusedCreativeBriefSchema(base: JsonObject): JsonObject {
  const schema = structuredClone(base), properties = schema.properties as Record<string, JsonObject>;
  for (const [field, maximum] of Object.entries({ style: 100, hierarchy: 100, typography: 80, originalityRequirements: 160, imagePrompt: 600 })) properties[field].maxLength = maximum;
  properties.forbiddenElements.maxItems = 6;
  (properties.forbiddenElements.items as JsonObject).maxLength = 60;
  return schema;
}
export function validateFocusedCreativeBriefBytes(output: JsonObject): void {
  if (Buffer.byteLength(JSON.stringify(output), "utf8") > 2048) throw Error("Focused brief exceeds its complete 2048-byte artifact bound; no text was truncated.");
}
