import type { JsonObject, JsonValue } from "../core/contracts";

export type SchemaValidationIssue = {
  path: string;
  message: string;
};

export class JsonSchemaValidationError extends Error {
  readonly issues: readonly SchemaValidationIssue[];

  constructor(message: string, issues: SchemaValidationIssue[]) {
    super(message);
    this.name = "JsonSchemaValidationError";
    this.issues = issues;
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isJsonValue(value: unknown, seen = new WeakSet<object>()): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }

  if (typeof value !== "object" || seen.has(value)) {
    return false;
  }

  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, seen))
    : isRecord(value) &&
      Object.values(value).every(
        (item) => item !== undefined && isJsonValue(item, seen),
      );
  seen.delete(value);
  return valid;
}

function jsonEquals(left: unknown, right: unknown): boolean {
  if (!isJsonValue(left) || !isJsonValue(right)) {
    return false;
  }

  return JSON.stringify(left) === JSON.stringify(right);
}

function childPath(path: string, key: string | number) {
  return typeof key === "number" ? `${path}[${key}]` : `${path}.${key}`;
}

function integerKeyword(schema: Record<string, unknown>, key: string): number | null {
  const value = schema[key];
  return Number.isInteger(value) ? Number(value) : null;
}

function numberKeyword(schema: Record<string, unknown>, key: string): number | null {
  const value = schema[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function validateNode(
  schemaValue: unknown,
  value: unknown,
  path: string,
  issues: SchemaValidationIssue[],
) {
  if (!isRecord(schemaValue)) {
    issues.push({ path, message: "schema node must be an object" });
    return;
  }

  if ("const" in schemaValue && !jsonEquals(value, schemaValue.const)) {
    issues.push({ path, message: "must equal the declared constant" });
    return;
  }

  if (Array.isArray(schemaValue.enum)) {
    const matches = schemaValue.enum.some((candidate) => jsonEquals(value, candidate));
    if (!matches) {
      issues.push({ path, message: "must match one of the declared enum values" });
      return;
    }
  }

  if ("anyOf" in schemaValue) {
    if (!Array.isArray(schemaValue.anyOf) || schemaValue.anyOf.length < 1 || schemaValue.anyOf.length > 10 || schemaValue.anyOf.some(branch => !isRecord(branch))) {
      issues.push({ path, message: "anyOf must contain 1 to 10 object schemas" });
      return;
    }
    const matches = schemaValue.anyOf.some(branch => {
      const branchIssues: SchemaValidationIssue[] = [];
      validateNode(branch, value, path, branchIssues);
      return branchIssues.length === 0;
    });
    if (!matches) { issues.push({ path, message: "must match an anyOf schema" }); return; }
    if (schemaValue.type === undefined) return;
  }

  const declaredType = schemaValue.type;
  if (Array.isArray(declaredType)) {
    if (declaredType.length === 0 || declaredType.some((type) =>
      typeof type !== "string" ||
      !["object", "array", "string", "integer", "number", "boolean", "null"].includes(type)
    )) {
      issues.push({ path, message: "schema contains unsupported type alternatives" });
      return;
    }
    for (const type of declaredType) {
      const alternativeIssues: SchemaValidationIssue[] = [];
      validateNode({ ...schemaValue, type }, value, path, alternativeIssues);
      if (alternativeIssues.length === 0) return;
    }
    issues.push({ path, message: "must match one of the declared types" });
    return;
  }
  if (declaredType === undefined && ("const" in schemaValue || Array.isArray(schemaValue.enum))) {
    return;
  }
  if (typeof declaredType !== "string") {
    issues.push({ path, message: "schema must declare one supported type" });
    return;
  }

  switch (declaredType) {
    case "object": {
      if (!isRecord(value)) {
        issues.push({ path, message: "must be an object" });
        return;
      }

      const properties = isRecord(schemaValue.properties) ? schemaValue.properties : {};
      const required = Array.isArray(schemaValue.required)
        ? schemaValue.required.filter((entry): entry is string => typeof entry === "string")
        : [];

      for (const requiredKey of required) {
        if (!(requiredKey in value)) {
          issues.push({
            path: childPath(path, requiredKey),
            message: "is required",
          });
        }
      }

      if (schemaValue.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!(key in properties)) {
            issues.push({
              path: childPath(path, key),
              message: "is not an allowed property",
            });
          }
        }
      }

      for (const [key, childSchema] of Object.entries(properties)) {
        if (key in value) {
          validateNode(childSchema, value[key], childPath(path, key), issues);
        }
      }
      return;
    }

    case "array": {
      if (!Array.isArray(value)) {
        issues.push({ path, message: "must be an array" });
        return;
      }

      const minItems = integerKeyword(schemaValue, "minItems");
      const maxItems = integerKeyword(schemaValue, "maxItems");
      if (minItems !== null && value.length < minItems) {
        issues.push({ path, message: `must contain at least ${minItems} items` });
      }
      if (maxItems !== null && value.length > maxItems) {
        issues.push({ path, message: `must contain no more than ${maxItems} items` });
      }
      if (schemaValue.uniqueItems === true) {
        const encoded = value.map((item) => JSON.stringify(item));
        if (new Set(encoded).size !== encoded.length) {
          issues.push({ path, message: "must contain unique items" });
        }
      }
      if (schemaValue.items !== undefined) {
        value.forEach((item, index) =>
          validateNode(schemaValue.items, item, childPath(path, index), issues),
        );
      }
      return;
    }

    case "string": {
      if (typeof value !== "string") {
        issues.push({ path, message: "must be a string" });
        return;
      }

      const minLength = integerKeyword(schemaValue, "minLength");
      const maxLength = integerKeyword(schemaValue, "maxLength");
      if (minLength !== null && value.length < minLength) {
        issues.push({ path, message: `must contain at least ${minLength} characters` });
      }
      if (maxLength !== null && value.length > maxLength) {
        issues.push({ path, message: `must contain no more than ${maxLength} characters` });
      }
      if (typeof schemaValue.pattern === "string") {
        try {
          if (!new RegExp(schemaValue.pattern).test(value)) {
            issues.push({ path, message: "does not match the required pattern" });
          }
        } catch {
          issues.push({ path, message: "schema contains an invalid pattern" });
        }
      }
      if (schemaValue.format === "uuid" && !UUID_PATTERN.test(value)) {
        issues.push({ path, message: "must be a UUID" });
      }
      return;
    }

    case "integer":
    case "number": {
      const isNumber = typeof value === "number" && Number.isFinite(value);
      if (!isNumber || (declaredType === "integer" && !Number.isInteger(value))) {
        issues.push({
          path,
          message: declaredType === "integer" ? "must be an integer" : "must be a number",
        });
        return;
      }

      const minimum = numberKeyword(schemaValue, "minimum");
      const maximum = numberKeyword(schemaValue, "maximum");
      if (minimum !== null && value < minimum) {
        issues.push({ path, message: `must be greater than or equal to ${minimum}` });
      }
      if (maximum !== null && value > maximum) {
        issues.push({ path, message: `must be less than or equal to ${maximum}` });
      }
      return;
    }

    case "boolean":
      if (typeof value !== "boolean") {
        issues.push({ path, message: "must be a boolean" });
      }
      return;

    case "null":
      if (value !== null) {
        issues.push({ path, message: "must be null" });
      }
      return;

    default:
      issues.push({ path, message: `uses unsupported schema type ${declaredType}` });
  }
}

export function validateJsonSchemaValue(
  schema: JsonObject,
  value: unknown,
): SchemaValidationIssue[] {
  const issues: SchemaValidationIssue[] = [];
  validateNode(schema, value, "$", issues);
  return issues;
}

export function assertJsonSchemaValue(
  schema: JsonObject,
  value: unknown,
  label: string,
): asserts value is JsonValue {
  const issues = validateJsonSchemaValue(schema, value);
  if (issues.length > 0) {
    throw new JsonSchemaValidationError(`${label} did not match its JSON schema.`, issues);
  }
}
