/** A deliberately limited, pure preview of owner text. It creates no authority. */
export type QuestIntakeMoney = { amount: string; currency: string | null };
export type QuestIntakeTarget = {
  amount: string;
  currency: string | null;
  metric: "revenue" | "realised_profit" | "units" | "orders" | null;
};
export type QuestIntakeDeadline = { date: string; time: string | null; timezone: string };
export type QuestIntakeIssue = {
  field: "target" | "currency" | "budget" | "deadline" | "timezone" | "geography" | "scope" | "stopConstraints";
  reason: "missing" | "ambiguous";
};
export type QuestIntakeResult =
  | { status: "rejected"; reason: "credential_like_content" | "invalid_input" }
  | {
      status: "draft";
      objective: string;
      target: QuestIntakeTarget | null;
      budget: QuestIntakeMoney | null;
      deadline: QuestIntakeDeadline | null;
      geography: string[];
      scope: string | null;
      stopConstraints: string[];
      issues: QuestIntakeIssue[];
      coverage: "limited_extraction";
      requiresReview: true;
      executionAuthorized: false;
    };

const AMOUNT = String.raw`(?:(?:USD|NZD|AUD|GBP|EUR|CAD|US\$|NZ\$|AU\$|£|€|\$)\s*)?\d+(?:,\d{3})*(?:\.\d+)?`;
const METRIC = String.raw`(?:realised profit|realized profit|revenue|sales|units?|orders?|profit)`;
const TARGET_PATTERNS = [
  new RegExp(String.raw`\b(?:target|goal|aim)\s*(?:is|of|:)?\s*(?<amount>${AMOUNT})\s*(?:in\s+)?(?<metric>${METRIC})\b`, "gi"),
  new RegExp(String.raw`\b(?<metric>${METRIC})\s*(?:target|goal)?\s*(?:of|is|:)?\s*(?<amount>${AMOUNT})\b`, "gi"),
  new RegExp(String.raw`\b(?:make|earn|reach|achieve)\s+(?<amount>${AMOUNT})\s+(?:in\s+)?(?<metric>${METRIC})\b`, "gi"),
];
const BUDGET_PATTERNS = [
  new RegExp(String.raw`\b(?:budget|spending cap|spend limit)\s*(?:is|of|:)?\s*(?<amount>${AMOUNT})\b`, "gi"),
  new RegExp(String.raw`\bspend\s+(?:up to|no more than|at most)\s+(?<amount>${AMOUNT})\b`, "gi"),
];

/** Reject before retaining or returning any owner text. Never include the input in an error. */
export function containsCredentialLikeContent(input: string): boolean {
  return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:api[ _-]?key|access[ _-]?token|refresh[ _-]?token|client[ _-]?secret|password|passwd|secret[ _-]?key|secret|token|bearer)\s*(?:[:=]|is\s+|\s+)\s*\S+|\bauthorization\s*:\s*basic\s+\S+|\b(?:sk_(?:live|test)_[A-Za-z0-9]{8,}|rk_live_[A-Za-z0-9]{8,}|sk-(?:proj-)?[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|ASIA[A-Z0-9]{16})\b|\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b|\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s/@:]+:[^\s/@]+@|\bhttps?:\/\/[^\s/@:]+:[^\s/@]+@/i.test(input);
}

/** Screen raw values, including newlines, before they can be JSON escaped. */
export function containsCredentialLikeValue(value: unknown): boolean {
  const seen = new WeakSet<object>();
  let count = 0;
  function visit(current: unknown, depth: number): boolean {
    if (++count > 1000 || depth > 20) return true;
    if (typeof current === "string") return containsCredentialLikeContent(current);
    if (current === null || typeof current === "number" || typeof current === "boolean" || typeof current === "bigint" || typeof current === "undefined") return false;
    if (typeof current !== "object" || seen.has(current)) return true;
    seen.add(current);
    try {
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null && !Array.isArray(current)) return true;
      for (const key of Reflect.ownKeys(current)) {
        if (typeof key !== "string" || containsCredentialLikeContent(key)) return true;
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor || !("value" in descriptor) || visit(descriptor.value, depth + 1)) return true;
      }
    } catch {
      return true;
    }
    seen.delete(current);
    return false;
  }
  return visit(value, 0);
}

function money(raw: string): QuestIntakeMoney {
  const match = /^(USD|NZD|AUD|GBP|EUR|CAD|US\$|NZ\$|AU\$|£|€|\$)?\s*([\d,]+(?:\.\d+)?)$/i.exec(raw.trim());
  // Only the amount grammar above calls this; keep the fallback inert.
  if (!match) return { amount: "", currency: null };
  const currencies: Record<string, string> = { "US$": "USD", "NZ$": "NZD", "AU$": "AUD", "£": "GBP", "€": "EUR" };
  const label = match[1]?.toUpperCase() ?? "";
  return { amount: match[2].replaceAll(",", ""), currency: currencies[label] ?? (label === "$" || !label ? null : label) };
}

function uniqueMatches(patterns: RegExp[], input: string): RegExpExecArray[] {
  const found = new Map<string, RegExpExecArray>();
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of input.matchAll(pattern)) found.set(`${match.index}:${match[0].toLowerCase()}`, match);
  }
  return [...found.values()];
}

function negatedBefore(input: string, index: number): boolean {
  const clause = input.slice(Math.max(0, index - 60), index).split(/[;\n]|\.(?:\s|$)/).at(-1) ?? "";
  return /\b(?:do\s+not|don't|never|not|no|without|except|excluding|excluded)\b(?:(?![.;\n]).){0,35}$/i.test(clause);
}

function amountValid(value: QuestIntakeMoney, allowZero = false): boolean {
  const [whole, fraction = ""] = value.amount.split(".");
  return /^(?:0|[1-9]\d{0,11})$/.test(whole) && /^\d{0,6}$/.test(fraction) && (allowZero || Number(value.amount) > 0);
}

function amountIsComplete(input: string, match: RegExpExecArray): boolean {
  // A budget pattern can otherwise accept the leading "1" of "1,00" or "1.2.3".
  return !/^[\w.,]/.test(input.slice(match.index + match[0].length));
}

function metric(raw: string): QuestIntakeTarget["metric"] {
  const value = raw.toLowerCase();
  if (value === "realised profit" || value === "realized profit") return "realised_profit";
  if (value === "revenue") return "revenue";
  if (value === "unit" || value === "units") return "units";
  if (value === "order" || value === "orders") return "orders";
  return null; // "sales" and bare "profit" need clarification.
}

function isoDateValid(date: string): boolean {
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day;
}

function timezoneValid(timezone: string): boolean {
  if (timezone === "UTC" || timezone === "Z") return true;
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }); return timezone.includes("/"); }
  catch { return false; }
}

function extractDeadline(input: string): { value: QuestIntakeDeadline | null; dateSeen: boolean; ambiguous: boolean } {
  const dateCandidates = [...input.matchAll(/\b(?:deadline\s*(?:is|:)?|by|until)\s*(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}(?::\d{2})?)(Z|[+-]\d{2}:\d{2})?)?(?:\s+(?:in\s+)?(UTC|[A-Za-z_]+\/[A-Za-z_]+|[+-]\d{2}:\d{2}))?/gi)];
  if (dateCandidates.length !== 1) return { value: null, dateSeen: dateCandidates.length > 0 || /\b(?:deadline|by|until)\b.{0,20}\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/i.test(input), ambiguous: dateCandidates.length > 1 };
  const match = dateCandidates[0];
  const date = match[1];
  const time = match[2] ?? null;
  const timezone = match[4] ?? match[3] ?? "";
  if (negatedBefore(input, match.index) || !time) return { value: null, dateSeen: true, ambiguous: true };
  if (!timezone && isoDateValid(date)) return { value: null, dateSeen: true, ambiguous: false };
  if (!isoDateValid(date) || (time !== null && !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time)) || !timezoneValid(timezone) || (match[3] && match[4] && match[3] !== match[4])) {
    return { value: null, dateSeen: true, ambiguous: true };
  }
  return { value: { date, time, timezone: timezone === "Z" ? "UTC" : timezone }, dateSeen: true, ambiguous: false };
}

function labelledClauses(input: string, label: string): string[] {
  const pattern = new RegExp(String.raw`\b(?:${label})\s*:\s*([^.;\n]+)`, "gi");
  return [...input.matchAll(pattern)].map(match => match[1].trim()).filter(Boolean);
}

export function parseQuestIntake(input: string): QuestIntakeResult {
  if (typeof input !== "string" || !input.trim() || input.length > 4000) return { status: "rejected", reason: "invalid_input" };
  if (containsCredentialLikeContent(input)) return { status: "rejected", reason: "credential_like_content" };
  const objective = input.trim();
  const issues: QuestIntakeIssue[] = [];
  const targetMatches = uniqueMatches(TARGET_PATTERNS, objective);
  let target: QuestIntakeTarget | null = null;
  if (targetMatches.length === 1 && !negatedBefore(objective, targetMatches[0].index) && amountIsComplete(objective, targetMatches[0])) {
    const extracted = money(targetMatches[0].groups?.amount ?? "");
    const parsedMetric = metric(targetMatches[0].groups?.metric ?? "");
    if (amountValid(extracted) && (!(parsedMetric === "units" || parsedMetric === "orders") || !extracted.amount.includes("."))) {
      target = { ...extracted, metric: parsedMetric };
      if (!target.metric) issues.push({ field: "target", reason: "ambiguous" });
      if (target.metric !== "units" && target.metric !== "orders" && !target.currency) issues.push({ field: "currency", reason: "missing" });
      if ((target.metric === "units" || target.metric === "orders") && target.currency) issues.push({ field: "target", reason: "ambiguous" });
    } else issues.push({ field: "target", reason: "ambiguous" });
  } else issues.push({ field: "target", reason: targetMatches.length || /\b(?:target|goal|aim|make|earn|reach|achieve)\b.{0,45}\d|\b(?:revenue|sales|realised profit|realized profit|profit|units?|orders?)\b.{0,25}\d/i.test(objective) ? "ambiguous" : "missing" });

  const budgetMatches = uniqueMatches(BUDGET_PATTERNS, objective);
  let budget: QuestIntakeMoney | null = null;
  if (budgetMatches.length === 1 && !negatedBefore(objective, budgetMatches[0].index) && amountIsComplete(objective, budgetMatches[0])) {
    const extracted = money(budgetMatches[0].groups?.amount ?? "");
    if (amountValid(extracted, true)) {
      budget = extracted;
      if (!budget.currency) issues.push({ field: "currency", reason: "missing" });
    } else issues.push({ field: "budget", reason: "ambiguous" });
  } else issues.push({ field: "budget", reason: budgetMatches.length || /\b(?:budget|spending cap|spend limit|spend)\b.{0,45}\d/i.test(objective) ? "ambiguous" : "missing" });

  const deadlineResult = extractDeadline(objective);
  const deadline = deadlineResult.value;
  if (!deadline) issues.push({ field: deadlineResult.dateSeen && !deadlineResult.ambiguous ? "timezone" : "deadline", reason: deadlineResult.ambiguous ? "ambiguous" : "missing" });

  const geographicLabels = labelledClauses(objective, "geography|markets?|countries|region");
  const countryNames: [RegExp, string][] = [
    [/\b(?:New Zealand|NZ(?!\$))\b/gi, "NZ"], [/\b(?:Australia|AU(?!\$))\b/gi, "AU"],
    [/\b(?:United Kingdom|UK|Great Britain)\b/gi, "GB"], [/\b(?:United States|USA|US)(?!\$)\b/gi, "US"],
    [/\bCanada\b/gi, "CA"],
  ];
  const geography = new Set<string>();
  let excludedGeography = false;
  const geoSources = geographicLabels.length ? geographicLabels : [objective];
  for (const source of geoSources) {
    let remainder = source;
    for (const [pattern, code] of countryNames) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        const prefix = source.slice(0, match.index);
        if (negatedBefore(source, match.index)) excludedGeography = true;
        else if (geographicLabels.length || /\bin\s*$/i.test(prefix)) geography.add(code);
      }
      if (geographicLabels.length) remainder = remainder.replace(pattern, " ");
    }
    if (geographicLabels.length && remainder.replace(/\b(?:and|only)\b|[\s,&]/gi, "").length) excludedGeography = true;
  }
  if (!geography.size || excludedGeography || geographicLabels.length > 1) issues.push({ field: "geography", reason: excludedGeography || geographicLabels.length > 1 || geographicLabels.length === 1 ? "ambiguous" : "missing" });

  const scopes = labelledClauses(objective, "scope|product|focus");
  const scope = scopes.length === 1 ? scopes[0] : null;
  if (!scope) issues.push({ field: "scope", reason: scopes.length > 1 ? "ambiguous" : "missing" });

  const stopConstraints = [...new Set([
    ...labelledClauses(objective, "stop rule|stop constraints?"),
    ...[...objective.matchAll(/\bstop\s+(?:if|when|after)\s+.*?(?=\.(?:\s|$)|;|\n|$)/gi)].map(match => match[0].trim()),
  ])];
  if (!stopConstraints.length) issues.push({ field: "stopConstraints", reason: "missing" });

  return { status: "draft", objective, target, budget, deadline, geography: [...geography], scope, stopConstraints, issues,
    coverage: "limited_extraction", requiresReview: true, executionAuthorized: false };
}
