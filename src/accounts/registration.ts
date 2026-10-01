import type { Page } from "playwright-core";
import {
  ACCOUNT_PROVIDERS, ACCOUNT_UUID, accountAssert,
  type AccountDisclosure, type AccountProvider, type ProfileField,
} from "./contracts";

/** Inspected read-only on 2026-10-01. No provider form was submitted.
 * https://help.etsy.com/hc/en-us/articles/115015568007-How-to-Create-an-Etsy-Account
 * https://www.etsy.com/join ; https://www.printful.com/auth/register
 * Steel's documented recording policy is why this adapter never exposes takeover:
 * https://docs.steel.dev/overview/sessions-api/embed-sessions/past-sessions
 * https://docs.steel.dev/overview/sessions-api/embed-sessions/live-sessions
 * https://github.com/steel-dev/steel-node/blob/main/src/resources/sessions/sessions.ts
 */
const REGISTRATION_SPEC = {
  etsy: {
    privacyUrl: "https://www.etsy.com/legal/privacy",
    fields: [
      { selector: 'input[name="email"]', fields: ["email"], types: ["text", "email"], autocomplete: "email", label: "Email address Required" },
      { selector: 'input[name="first_name"]', fields: ["givenName"], types: ["text"], autocomplete: "given-name", label: "First name Required" },
    ],
  },
  printful: {
    privacyUrl: "https://www.printful.com/policies/privacy",
    fields: [
      { selector: 'input[name="fullName"]', fields: ["givenName", "familyName"], types: ["text"], autocomplete: null, label: "Full name:" },
      { selector: 'input[name="email"]', fields: ["email"], types: ["email"], autocomplete: "email", label: "Email:" },
    ],
  },
} as const;

export type RegistrationPreparationInput = {
  /** Obtained from the server's one-use registration_prepare reservation, never the client. */
  preparationId: string;
  businessId: string;
  disclosure: AccountDisclosure;
  disclosureHash: string;
  profileRevision: string;
  approvalExpiresAt: string;
  termsApproved: boolean;
  browserConsent: boolean;
};
export type RegistrationPreparationReceipt = {
  outcome: "prepared" | "needs_owner";
  performedFields: ProfileField[];
  reasonCode: string;
  termsState: "not_accepted" | "checkbox_checked";
  /** Neither filling a form nor ticking a checkbox proves account creation. */
  providerAccountCreated: false;
  secureResumeAvailable: boolean;
  prefillTransferred: false;
  handoff: { id: string; expiresAt: string } | null;
};
export type RegistrationSession = {
  page: Page;
  /** Block every subsequent request outside the exact approved provider origin. */
  restrictToOrigin(origin: string): Promise<void>;
  /** Stop agent observation BEFORE the owner enters credentials. The returned ID
   * must require authenticated owner+Business resolution, never be a bearer URL. */
  handoff(): Promise<{ id: string; expiresAt: string }>;
  close(): Promise<void>;
};
export type RegistrationTransport = {
  /** Trusted deployment capability, never deserialized from an HTTP payload. */
  safety: {
    recording: "disabled_verified";
    secretObservation: "disabled";
    persistentIdentityBound: { businessId: string; provider: AccountProvider };
    ownerSecureResume: true;
  };
  open(provider: AccountProvider): Promise<RegistrationSession>;
};
export const REGISTRATION_RUNTIME_SUPPORT = Object.freeze({
  available: false,
  reasonCode: "account_secure_owner_browser_required",
  explanation: "No verified non-recording, owner-bound transport was supplied. Recorded Steel sessions cannot prepare a secure continuation; the separately activated Browserbase transport is required before transmitting registration data.",
  sourceUrls: [
    "https://docs.steel.dev/overview/sessions-api/embed-sessions/past-sessions",
    "https://docs.steel.dev/overview/sessions-api/embed-sessions/live-sessions",
    "https://github.com/steel-dev/steel-node/blob/main/src/resources/sessions/sessions.ts",
  ],
});

function assertOrigin(url: string, provider: AccountProvider) {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("account_registration_origin_rejected"); }
  accountAssert(parsed.origin === ACCOUNT_PROVIDERS[provider].destination &&
    !parsed.username && !parsed.password, "account_registration_origin_rejected");
}
function assertApproval(input: RegistrationPreparationInput, now: () => number) {
  accountAssert(ACCOUNT_UUID.test(input.businessId), "account_business_binding_required");
  accountAssert(ACCOUNT_UUID.test(input.preparationId), "account_preparation_reservation_required");
  accountAssert(input.disclosure.provider === "etsy" || input.disclosure.provider === "printful", "account_provider_unsupported");
  const spec = ACCOUNT_PROVIDERS[input.disclosure.provider];
  accountAssert(input.disclosure.mode === "create", "account_registration_mode_rejected");
  accountAssert(ACCOUNT_UUID.test(input.profileRevision) && input.profileRevision === input.disclosure.profileRevision, "account_profile_revision_changed");
  // SQL owns its canonical hash format and verified it when reserving dispatch.
  accountAssert(/^[a-f0-9]{64}$/i.test(input.disclosureHash), "account_disclosure_hash_required");
  accountAssert(Number.isFinite(Date.parse(input.approvalExpiresAt)) && Date.parse(input.approvalExpiresAt) > now(), "account_approval_expired");
  accountAssert(input.termsApproved === true, "account_terms_approval_required");
  const browser = input.disclosure.browserProcessing;
  accountAssert(input.browserConsent === true && browser?.provider === "browserbase" &&
    browser.purpose === "registration_preparation_and_owner_handoff" && browser.recordSession === false &&
    browser.logSession === false && browser.maxSessionSeconds === 900 && browser.requiresSeparateActivation === true,
    "account_browser_processing_approval_required");
  accountAssert(input.disclosure.destination === spec.destination && input.disclosure.termsUrl === spec.termsUrl,
    "account_registration_destination_rejected");
  accountAssert(input.disclosure.cost.amountMinor === 0 && input.disclosure.cost.currency === null && input.disclosure.cost.subscription === false,
    "account_registration_cost_rejected");
  const fields = [...new Set(REGISTRATION_SPEC[input.disclosure.provider].fields.flatMap(field => [...field.fields]))].sort();
  accountAssert(JSON.stringify([...input.disclosure.profileFields].sort()) === JSON.stringify(fields), "account_registration_fields_rejected");
  accountAssert(JSON.stringify(Object.keys(input.disclosure.disclosedData).sort()) === JSON.stringify(fields), "account_registration_data_rejected");
  for (const field of fields) {
    const value = input.disclosure.disclosedData[field];
    accountAssert(typeof value === "string" && value.length <= (field === "email" ? 254 : 100) &&
      !/[\u0000-\u001f\u007f]/.test(value), "account_registration_data_rejected");
    if (field === "email") accountAssert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), "account_registration_data_rejected");
    if (field === "givenName") accountAssert(value.trim().length > 0, "account_registration_data_rejected");
  }
}
function receipt(reasonCode: string, performedFields: ProfileField[] = [], termsState: RegistrationPreparationReceipt["termsState"] = "not_accepted"): RegistrationPreparationReceipt {
  return { outcome: "needs_owner", performedFields, reasonCode, termsState,
    providerAccountCreated: false, secureResumeAvailable: false, prefillTransferred: false, handoff: null };
}
async function visible(page: Page, selector: string) {
  const matches = page.locator(selector);
  for (let i = 0; i < Math.min(await matches.count(), 20); i += 1) {
    if (await matches.nth(i).isVisible()) return true;
  }
  return false;
}
async function sensitiveBoundary(page: Page): Promise<string | null> {
  // Input metadata only. Never inspect input values, cookies, page text or screenshots.
  for (const [selector, code] of [
    ['input[autocomplete="one-time-code"]', "account_mfa_owner_required"],
    ['input[autocomplete^="cc-"],input[name="iban"],input[name="bank_account"]', "account_billing_owner_required"],
    ['input[type="file"],input[name="ssn"],input[name="tax_id"],input[name="passport"]', "account_identity_owner_required"],
    ['iframe[title*="challenge" i],iframe[title="reCAPTCHA"],input[name="captcha"]', "account_captcha_approval_required"],
  ]) if (await visible(page, selector)) return code;
  for (const name of ["Authorize", "Grant access", "Allow access"]) {
    const button = page.getByRole("button", { name, exact: true });
    if (await button.count() === 1 && await button.isVisible()) return "account_access_grant_owner_required";
  }
  return null;
}
async function linksMatch(page: Page, provider: AccountProvider, approvedPrivacy: unknown) {
  const expected = ACCOUNT_PROVIDERS[provider];
  const privacy = REGISTRATION_SPEC[provider].privacyUrl;
  if (approvedPrivacy !== privacy) return false;
  for (const url of [expected.termsUrl, privacy]) {
    // Static exact provider URLs only; Etsy's observed attribution query carries no approval content.
    const link = page.locator(`a[href="${url}"],a[href="${url}?ref=reg"],a[href="${new URL(url).pathname}"],a[href="${new URL(url).pathname}?ref=reg"]`);
    let matched = false;
    for (let i = 0; i < Math.min(await link.count(), 20); i += 1) {
      if (await link.nth(i).isVisible()) matched = true;
    }
    if (!matched) return false;
  }
  return true;
}

/** Deterministic ordinary-field preparation. The caller must reserve once in its
 * owner-scoped database BEFORE dispatch, and durably save the returned receipt.
 * No model actions, arbitrary selector input, credential handling or signup submit.
 * Production fails closed without an independently verified secure transport.
 * No profile is sent to recorded Steel, and no prepared state is claimed to
 * transfer to a separate browser. Tests inject the same constrained Page path.
 */
export async function prepareAccountRegistration(
  request: RegistrationPreparationInput,
  options: { transport?: RegistrationTransport; now?: () => number; assertCurrent?: () => Promise<void> } = {},
): Promise<RegistrationPreparationReceipt> {
  const now = options.now ?? Date.now;
  // Freeze the exact server-approved values against caller mutation during awaits.
  const input = JSON.parse(JSON.stringify(request)) as RegistrationPreparationInput;
  Object.freeze(input.disclosure.disclosedData); Object.freeze(input.disclosure.profileFields);
  Object.freeze(input.disclosure.cost); Object.freeze(input.disclosure); Object.freeze(input);
  assertApproval(input, now);
  const provider = input.disclosure.provider;
  const transport = options.transport;
  if (!transport || transport.safety?.recording !== "disabled_verified" ||
      transport.safety.secretObservation !== "disabled" || transport.safety.ownerSecureResume !== true ||
      transport.safety.persistentIdentityBound?.businessId !== input.businessId ||
      transport.safety.persistentIdentityBound.provider !== provider) {
    return receipt("account_secure_owner_browser_required");
  }
  if (!options.assertCurrent) return receipt("account_registration_current_authority_required");
  const assertCurrent = async () => {
    assertApproval(input, now);
    try { await options.assertCurrent!(); }
    catch { throw new Error("account_registration_authority_changed"); }
  };
  const spec = ACCOUNT_PROVIDERS[provider];
  const performed: ProfileField[] = [];
  let termsState: RegistrationPreparationReceipt["termsState"] = "not_accepted";
  let session: RegistrationSession | null = null;
  let handedOff = false;
  let result: RegistrationPreparationReceipt;
  try {
    await assertCurrent();
    session = await transport.open(provider);
    const page = session.page;
    await assertCurrent();
    await page.goto(spec.registrationUrl, { waitUntil: "domcontentloaded", timeout: 25_000 });
    assertOrigin(page.url(), provider); assertApproval(input, now);
    if (provider === "printful" && !(await page.locator('input[name="fullName"]').count())) {
      const emailPath = page.getByRole("link", { name: "Sign up with your email", exact: true });
      await emailPath.waitFor({ state: "visible", timeout: 10_000 });
      accountAssert(await emailPath.count() === 1 && await emailPath.isEnabled(), "account_registration_form_changed");
      assertOrigin(page.url(), provider); assertApproval(input, now);
      await assertCurrent();
      await emailPath.click({ timeout: 10_000 });
    }
    const rules = REGISTRATION_SPEC[provider].fields;
    await page.locator(rules[0].selector).waitFor({ state: "visible", timeout: 10_000 });
    assertOrigin(page.url(), provider);
    const boundary = await sensitiveBoundary(page);
    if (boundary) result = receipt(boundary);
    else if (!(await linksMatch(page, provider, input.disclosure.privacyUrl))) {
      result = receipt("account_displayed_terms_changed");
    } else {
      await session.restrictToOrigin(spec.destination);
      // Preflight every approved field before transmitting any value.
      for (const rule of rules) {
        const field = page.locator(rule.selector);
        accountAssert(await field.count() === 1 && await field.isVisible() && await field.isEnabled(), "account_registration_form_changed");
        const metadata = await field.evaluate((element) => {
          if (!(element instanceof HTMLInputElement)) return null;
          return { type: element.type, autocomplete: element.getAttribute("autocomplete"),
            labels: Array.from(element.labels ?? []).map(label => (label.innerText ?? "").replace(/\s+/g, " ").trim()).join(" "),
            formAction: element.form?.getAttribute("action") ?? null, readOnly: element.readOnly };
        });
        accountAssert(metadata && !metadata.readOnly && (rule.types as readonly string[]).includes(metadata.type) &&
          metadata.autocomplete === rule.autocomplete && metadata.labels === rule.label, "account_registration_form_changed");
        if (metadata.formAction) assertOrigin(new URL(metadata.formAction, page.url()).href, provider);
      }
      for (const rule of rules) {
        assertOrigin(page.url(), provider); assertApproval(input, now);
        const boundary = await sensitiveBoundary(page);
        accountAssert(!boundary, boundary ?? "account_sensitive_owner_required");
        await assertCurrent();
        await page.locator(rule.selector).fill(rule.fields.map(field => input.disclosure.disclosedData[field]).filter(Boolean).join(" "), { timeout: 10_000 });
        performed.push(...rule.fields);
      }
      if (provider === "printful") {
        assertOrigin(page.url(), provider); assertApproval(input, now);
        accountAssert(await linksMatch(page, provider, input.disclosure.privacyUrl), "account_displayed_terms_changed");
        const checkbox = page.locator('input[name="hasAcceptedTerms"][type="checkbox"]');
        accountAssert(await checkbox.count() === 1 && await checkbox.isVisible() && await checkbox.isEnabled(), "account_registration_form_changed");
        const labelMatches = await checkbox.evaluate(element => element instanceof HTMLInputElement &&
          Array.from(element.labels ?? []).map(label => (label.innerText ?? "").replace(/\s+/g, " ").trim()).join(" ") === "I agree to Printful's Terms of Service and Privacy Policy.");
        accountAssert(labelMatches, "account_displayed_terms_changed");
        await assertCurrent();
        await checkbox.check({ timeout: 10_000 });
        accountAssert(await checkbox.isChecked(), "account_terms_checkbox_unconfirmed");
        termsState = "checkbox_checked";
      }
      // The password and final signup are never touched; terms checkbox is not account creation.
      assertOrigin(page.url(), provider); assertApproval(input, now);
      await assertCurrent();
      const handoff = await session.handoff();
      accountAssert(ACCOUNT_UUID.test(handoff.id) && Number.isFinite(Date.parse(handoff.expiresAt)) && Date.parse(handoff.expiresAt) > now(), "account_secure_handoff_unconfirmed");
      handedOff = true;
      result = { ...receipt("account_password_owner_required", performed, termsState), outcome: "prepared", secureResumeAvailable: true, handoff };
    }
  } catch (error) {
    // Playwright/provider errors can contain personal values and request URLs. Never persist them.
    const safeCodes = new Set(["account_registration_origin_rejected", "account_registration_form_changed", "account_displayed_terms_changed", "account_terms_checkbox_unconfirmed", "account_approval_expired", "account_mfa_owner_required", "account_billing_owner_required", "account_identity_owner_required", "account_captcha_approval_required", "account_access_grant_owner_required", "account_registration_provider_unconfigured"]);
    const code = error instanceof Error && (safeCodes.has(error.message) || error.message === "account_registration_authority_changed") ? error.message : "account_registration_preparation_unconfirmed";
    result = receipt(code, performed, termsState);
  } finally {
    if (session && !handedOff) {
      try { await session.close(); }
      catch { result = receipt("account_registration_release_unconfirmed", performed, termsState); }
    }
  }
  return result!;
}
