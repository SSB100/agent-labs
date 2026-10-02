"use client";

import { AccountForm } from "../connection-feedback";
import { submitOwnerPrintfulCredential } from "../actions";

export function PrintfulSecureForm({ businessId, runId, observedAt, returnTo, action = submitOwnerPrintfulCredential }: {
  businessId: string; runId: string; observedAt: string; returnTo: string; action?: (form: FormData) => Promise<void>;
}) {
  return <AccountForm action={action} className="accountSecureForm compactSecureForm" id="printful-secure-form" returnTo={returnTo} pendingLabel="Verifying Printful…">
    <input type="hidden" name="businessId" value={businessId}/><input type="hidden" name="runId" value={runId}/><input type="hidden" name="provider" value="printful"/>
    <div className="secureInputGrid">
      <label className="secureFullWidth">Printful private token<input name="credential" data-field-label="Printful private token" type="password" required minLength={8} maxLength={8192} pattern="[!-~]+" autoComplete="off" data-private="true" spellCheck={false}/></label>
      <label>Intended Printful store ID<input name="storeId" data-field-label="Intended Printful store ID" type="number" inputMode="numeric" min={1} max={Number.MAX_SAFE_INTEGER} step={1} required/><small>Verification must return exactly this store.</small></label>
      <label>Store type<select name="storeKind" data-field-label="Store type" aria-label="Store type" aria-describedby="printful-store-kind-help" required defaultValue=""><option value="" disabled>Choose the intended store type</option><option value="ecommerce_linked">Ecommerce-linked · Etsy selling</option><option value="manual_api">Manual / API · Custom integration</option></select></label>
      <label className="secureFullWidth">Stop using this credential after<input name="expiresAt" data-field-label="Local credential cutoff" type="datetime-local" required min={new Date(Date.parse(observedAt) + 60_000).toISOString().slice(0, 16)} max={new Date(Date.parse(observedAt) + 31 * 86_400_000).toISOString().slice(0, 16)} defaultValue={new Date(Date.parse(observedAt) + 30 * 86_400_000).toISOString().slice(0, 16)}/><small>UTC, at most 31 days. Agent Labs’ local cutoff, not provider token expiry.</small></label>
    </div>
    <div className="accountConsentForm"><label><input type="checkbox" name="secureAccessConsent" data-field-label="Encrypted storage and exact-store access consent" required/> I approve encrypted storage and the listed access to this exact Printful store for this Business. I entered this token myself.</label></div>
    <button className="coreButton coreButton-primary" type="submit">Verify Printful</button>
  </AccountForm>;
}
