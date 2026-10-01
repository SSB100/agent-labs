import { createHash } from "node:crypto";

export const ACCOUNT_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const PROFILE_FIELDS = ["email", "givenName", "familyName", "countryCode", "locale"] as const;
export type ProfileField = typeof PROFILE_FIELDS[number];
export type AccountProfile = Record<ProfileField, string> & { revision: string };
export type AccountProvider = "etsy" | "printful";
export type AccountSetupMode = "create" | "connect";
export const ACCOUNT_PROVIDERS = {
  etsy: { name: "Etsy", destination: "https://www.etsy.com", registrationUrl: "https://www.etsy.com/join", termsUrl: "https://www.etsy.com/legal/terms-of-use", privacyUrl: "https://www.etsy.com/legal/privacy", scopes: ["shops_r", "listings_r", "listings_w"] },
  printful: { name: "Printful", destination: "https://www.printful.com", registrationUrl: "https://www.printful.com/auth/register", termsUrl: "https://www.printful.com/policies/terms-of-service", privacyUrl: "https://www.printful.com/policies/privacy", scopes: ["catalog.read"] },
} as const;
export const SECURE_OWNER_STEPS = ["password", "email_verification", "mfa", "billing", "identity_verification", "access_grant"] as const;
export class AccountError extends Error {
  constructor(readonly code: string) { super(code); this.name = "AccountError"; }
}
export function accountAssert(ok: unknown, code: string): asserts ok { if (!ok) throw new AccountError(code); }
export function accountRecord(value: unknown): Record<string, unknown> {
  accountAssert(value !== null && typeof value === "object" && !Array.isArray(value), "account_invalid_record");
  return value as Record<string, unknown>;
}
export function accountProvider(value: unknown): AccountProvider {
  accountAssert(value === "etsy" || value === "printful", "account_provider_unsupported"); return value;
}
export function accountMode(value: unknown): AccountSetupMode {
  accountAssert(value === "create" || value === "connect", "account_mode_unsupported"); return value;
}
export function parseAccountProfile(value: unknown): Omit<AccountProfile, "revision"> {
  const p = accountRecord(value);
  accountAssert(Object.keys(p).every(key => (PROFILE_FIELDS as readonly string[]).includes(key)), "account_profile_field_not_allowed");
  const out = Object.fromEntries(PROFILE_FIELDS.map(key => {
    accountAssert(typeof p[key] === "string" && !/[\u0000-\u001f\u007f]/.test(p[key]), "account_profile_invalid");
    return [key, p[key].trim()];
  })) as Omit<AccountProfile, "revision">;
  accountAssert(out.email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email), "account_profile_email_invalid");
  accountAssert(out.givenName.length >= 1 && out.givenName.length <= 100 && out.familyName.length <= 100, "account_profile_name_invalid");
  accountAssert(/^[A-Z]{2}$/.test(out.countryCode) && /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/.test(out.locale), "account_profile_locale_invalid");
  return out;
}
export type AccountDisclosure = {
  provider: AccountProvider; mode: AccountSetupMode; profileRevision: string;
  profileFields: ProfileField[]; disclosedData: Partial<Record<ProfileField, string>>;
  destination: string; termsUrl: string; privacyUrl: string; purpose: string; scopes: readonly string[];
  cost: { amountMinor: 0; currency: null; subscription: false };
  termsAcknowledgementRequired: boolean; secureOwnerSteps: readonly string[];
  browserProcessing: null | { provider: "browserbase"; purpose: "registration_preparation_and_owner_handoff"; recordSession: false; logSession: false; maxSessionSeconds: 900; requiresSeparateActivation: true };
};
/** A fresh exact snapshot is reviewed before approval. No arbitrary destination,
 * profile blob, password or sensitive identity data enters the setup contract. */
export function buildAccountDisclosure(profile: AccountProfile, provider: AccountProvider, mode: AccountSetupMode): AccountDisclosure {
  const spec = ACCOUNT_PROVIDERS[accountProvider(provider)]; accountMode(mode);
  accountAssert(ACCOUNT_UUID.test(profile.revision), "account_profile_revision_required");
  const { revision: _revision, ...ordinary } = profile; void _revision;
  const values = parseAccountProfile(ordinary);
  // An API connection does not share this reusable profile. Registration only
  // shares fields that the documented initial form needs, after exact consent.
  const profileFields: ProfileField[] = mode === "create" ? provider === "printful" ? ["email", "givenName", "familyName"] : ["email", "givenName"] : [];
  return { provider, mode, profileRevision: profile.revision, profileFields,
    disclosedData: Object.fromEntries(profileFields.map(key => [key, values[key]])),
    destination: spec.destination, termsUrl: spec.termsUrl, privacyUrl: spec.privacyUrl,
    purpose: mode === "create" ? "Prepare the approved registration fields, then securely connect the verified account." : "Connect and independently verify the selected account for this Business.",
    scopes: [...spec.scopes], cost: { amountMinor: 0, currency: null, subscription: false },
    termsAcknowledgementRequired: mode === "create", secureOwnerSteps: [...SECURE_OWNER_STEPS],
    browserProcessing: mode === "create" ? { provider: "browserbase", purpose: "registration_preparation_and_owner_handoff", recordSession: false, logSession: false, maxSessionSeconds: 900, requiresSeparateActivation: true } : null };
}
export function accountDigest(value: unknown): string {
  function canonical(v: unknown): unknown {
    return Array.isArray(v) ? v.map(canonical) : v && typeof v === "object"
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)])) : v;
  }
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
export type AccountSetupRun = {
  id: string; connectionId: string; provider: AccountProvider; mode: AccountSetupMode;
  status: string; revision: number; disclosure: AccountDisclosure; disclosureHash: string;
  approvalExpiresAt: string | null; createdAt: string; receipt: Record<string, unknown> | null;
  preparationId?: string | null; preparationReceipt?: Record<string, unknown> | null;
};
export type ConnectedAccount = {
  id: string; provider: AccountProvider; status: string; revision: string;
  label: string; externalAccountId: string; scopes: string[]; verifiedAt: string | null;
  expiresAt: string | null; storeKind?: "manual_api" | "ecommerce_linked";
  passwordStored?: boolean; passwordRevision?: string | null;
};
export type AccountWorkspace = {
  businessId: string; configured: boolean; vaultConfigured: boolean; unavailable: boolean;
  observedAt: string;
  registrationAvailable: boolean; registrationReason: string;
  profile: AccountProfile | null; accounts: ConnectedAccount[]; runs: AccountSetupRun[];
  healthEvents: { id: string; provider: string; eventType: string; occurredAt: string }[];
};
