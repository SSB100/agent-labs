"use client";

import { useActionState, useState } from "react";
import { previewPrintfulPricing } from "./actions";
import {
  initialPricingValues, missingPricingLabels, monetaryPricingFields, pricingFieldNames, preservePricingAssumptions,
  type PricingField, type PricingFormValues, type PricingPreviewState, type PrintfulFixturePreview,
} from "./types";

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency, currencyDisplay: "code" }).format(value / 100);
}

const requirementLabels: Record<string, string> = {
  verified_store_connection: "Verified same-Business store connection",
  current_persisted_creative_production_approval: "Current persisted production-asset approval",
  current_stock_and_cost_quote: "Current stock and cost quote",
  owner_configuration_approval: "Separate owner configuration authority",
  existing_imported_ecommerce_variant: "Existing imported ecommerce variant",
};

export function CatalogConfigurationPreview({ fixture }: { fixture: PrintfulFixturePreview }) {
  const [variantId, setVariantId] = useState(fixture.variants[0].variant.id.value);
  const [placement, setPlacement] = useState<"front" | "back">("front");
  const [storeKind, setStoreKind] = useState<"manual_api" | "ecommerce_linked">("manual_api");
  const selected = fixture.variants.find(entry => entry.variant.id.value === variantId)!;
  const bounds = selected.variant.placementDimensions.find(entry => entry.placement === placement)!;
  const plan = selected.plans.find(entry => entry.placement === placement && entry.storeKind === storeKind)!;

  return <section className="printfulPanel" aria-labelledby="printful-catalog-title">
    <div className="printfulSectionHeader">
      <div><p className="coreEyebrow">01 · Synthetic fixture</p><h2 id="printful-catalog-title">Catalog & configuration preview</h2></div>
      <span className="printfulBadge">Invented examples</span>
    </div>
    <p className="printfulNote">Names, IDs, dimensions, prices and artwork below are invented fixtures. They are not live Printful products, verified print requirements, or your Business records.</p>
    <div className="printfulCatalogGrid">
      <div className="printfulCatalogSummary">
        <div className="printfulPrintArea" aria-label={`Synthetic ${placement} print area: ${bounds.widthIn} by ${bounds.heightIn} inches`}>
          <div><span>{placement} · DTG</span><strong>{bounds.widthIn} × {bounds.heightIn} in</strong><small>Synthetic print area</small></div>
        </div>
        <h3>{fixture.product.name}</h3>
        <dl className="printfulFacts">
          <div><dt>Catalog product ID</dt><dd>{fixture.product.id.value} · synthetic</dd></div>
          <div><dt>Catalog variant ID</dt><dd>{selected.variant.id.value} · synthetic</dd></div>
          <div><dt>Example production cost</dt><dd>{money(selected.productionMinor, "USD")}</dd></div>
          <div><dt>Production currency</dt><dd>Unknown</dd></div>
        </dl>
        <p className="printfulNote">The synthetic regular DTG base includes one ordinary front or back placement once. No discount is assumed. Shipping, taxes, fees and special options are excluded.</p>
      </div>
      <div className="printfulStack">
        <div className="printfulFields">
          <label htmlFor="printful-variant">Synthetic variant<select id="printful-variant" value={variantId} onChange={event => setVariantId(Number(event.target.value))}>{fixture.variants.map(entry => <option key={entry.variant.id.value} value={entry.variant.id.value}>{entry.variant.name}</option>)}</select></label>
          <label htmlFor="printful-placement">Single placement<select id="printful-placement" value={placement} onChange={event => setPlacement(event.target.value as "front" | "back")}><option value="front">Front · DTG</option><option value="back">Back · DTG</option></select></label>
          <label className="printfulWide" htmlFor="printful-store-kind">Store integration type<select id="printful-store-kind" value={storeKind} onChange={event => setStoreKind(event.target.value as "manual_api" | "ecommerce_linked")}><option value="manual_api">Manual / API store</option><option value="ecommerce_linked">Ecommerce-linked store</option></select></label>
        </div>
        <div className="printfulProposal" aria-live="polite" aria-atomic="true">
          <p className="coreEyebrow">Proposal preview only</p>
          <h3>{plan.operation === "create_native_sync_product" ? "Create a native sync product" : "Map an existing ecommerce variant"}</h3>
          <p>{storeKind === "manual_api" ? "A future authorized operation would configure a product in a verified Manual/API store." : "A future authorized operation would map a variant already imported from the connected ecommerce store. This does not create or publish a listing."}</p>
          <dl className="printfulFacts">
            <div><dt>Synthetic source</dt><dd>{fixture.sourcePixels.width} × {fixture.sourcePixels.height} px · sRGB PNG</dd></div>
            <div><dt>Physical design size</dt><dd>{fixture.sourcePixels.designWidthIn} × {fixture.sourcePixels.designHeightIn} in</dd></div>
            <div><dt>Effective pixel density</dt><dd>{plan.effectiveDpi} DPI · synthetic 150 DPI requirement</dd></div>
            <div><dt>Execution / publication / orders</dt><dd>Not authorized</dd></div>
          </dl>
          <p className="printfulNote">This fixture fits without resizing, cropping, rotating or upscaling. Real artwork needs current, exact variant-specific print requirements and a hash-bound asset approval.</p>
        </div>
        <details className="printfulDetails"><summary>Required evidence & traceability</summary>
          <ul className="printfulList"><li>Current independently reviewed TEST decision for the same Business</li>{plan.requires.map(requirement => <li key={requirement}>{requirementLabels[requirement] ?? requirement}</li>)}</ul>
          <p className="printfulNote">No actual approvals are loaded or satisfied by this fixture. Synthetic Business and asset references are used only to exercise the contract.</p>
          <dl className="printfulFacts"><div><dt>Fixture plan SHA-256</dt><dd className="printfulHash">{plan.requestHash}</dd></div><div><dt>Catalog response SHA-256</dt><dd className="printfulHash">{fixture.product.provenance.responseHash}</dd></div><div><dt>Provenance</dt><dd>fixture · v2-beta · liveQualified = false</dd></div></dl>
        </details>
      </div>
    </div>
  </section>;
}

type PricingInputProps = {
  name: PricingField;
  label: string;
  values: PricingFormValues;
  update: (name: PricingField, value: string) => void;
  required?: boolean;
  help?: string;
  percent?: boolean;
};

function PricingInput({ name, label, values, update, required = false, help, percent = false }: PricingInputProps) {
  return <label htmlFor={`printful-${name}`}>{label}{percent ? " (%)" : ` (${values.currency})`}
    <input id={`printful-${name}`} name={name} value={values[name]} onChange={event => update(name, event.target.value)} inputMode="decimal" maxLength={12} required={required} placeholder={required ? "0.00" : "Unknown"} aria-describedby={help ? `printful-${name}-help` : undefined} />
    {help ? <small id={`printful-${name}-help`}>{help}</small> : null}
  </label>;
}

function FeeInputs({ prefix, label, values, update }: { prefix: "marketplace" | "payment"; label: string; values: PricingFormValues; update: PricingInputProps["update"] }) {
  return <fieldset className="printfulFeeFields"><legend>{label} assumption</legend><div className="printfulFields">
    <PricingInput name={`${prefix}Fixed`} label="Fixed fee" values={values} update={update} />
    <PricingInput name={`${prefix}Percent`} label="Rate" values={values} update={update} percent />
    <label className="printfulWide" htmlFor={`printful-${prefix}Basis`}>Percentage applies to<select id={`printful-${prefix}Basis`} name={`${prefix}Basis`} value={values[`${prefix}Basis`]} onChange={event => update(`${prefix}Basis`, event.target.value)}><option value="item">Discounted item price</option><option value="item_plus_shipping">Discounted item + charged shipping</option></select></label>
  </div><p className="printfulNote">Enter both fixed fee and rate, including an explicit 0 when appropriate. Leave both blank if unknown.</p></fieldset>;
}

export function PricingCalculator() {
  const [values, setValues] = useState<PricingFormValues>({ ...initialPricingValues });
  const [state, action, pending] = useActionState<PricingPreviewState, FormData>(previewPrintfulPricing, { error: null, values: null, result: null });
  const isCurrent = state.values !== null && pricingFieldNames.every(key => values[key] === state.values![key]);
  const result = isCurrent ? state.result : null;
  function update(name: PricingField, value: string) {
    setValues(previous => {
      const next = { ...previous, [name]: value };
      if (name === "currency" && value !== previous.currency) monetaryPricingFields.forEach(field => { next[field] = ""; });
      return next;
    });
  }
  function loadSyntheticExample() {
    setValues({ ...initialPricingValues, production: "9.50", fulfilmentShipping: "5.00", sellerTaxCost: "0",
      discountPercent: "10", marketplaceFixed: "0.20", marketplacePercent: "6.5", paymentFixed: "0.25", paymentPercent: "3",
      refundReservePercent: "2", assumptionLabel: "Synthetic USD example; invented costs and fees, not a supplier quote" });
  }

  return <section className="printfulPanel" aria-labelledby="printful-pricing-title">
    <div className="printfulSectionHeader"><div><p className="coreEyebrow">02 · Deterministic arithmetic</p><h2 id="printful-pricing-title">Pricing scenario</h2></div><span className="printfulBadge">No provider calls</span></div>
    <p className="printfulNote">All amounts are assumptions in the selected currency. Blank costs stay unknown, never zero. No live price, tax, fee or foreign-exchange lookup is performed.</p>
    <form action={action} onReset={preservePricingAssumptions} className="printfulPricingForm">
      <fieldset disabled={pending} className="printfulFormBody"><legend className="printfulSrOnly">Pricing assumptions</legend>
        <div className="printfulFields">
          <label htmlFor="printful-currency">Scenario currency<select id="printful-currency" name="currency" value={values.currency} onChange={event => update("currency", event.target.value)} aria-describedby="printful-currency-help">{["USD", "GBP", "AUD", "NZD"].map(currency => <option key={currency}>{currency}</option>)}</select><small id="printful-currency-help">Changing currency clears all monetary inputs. There is no FX conversion.</small></label>
          <label htmlFor="printful-assumption-label">Scenario description<input id="printful-assumption-label" name="assumptionLabel" value={values.assumptionLabel} onChange={event => update("assumptionLabel", event.target.value)} minLength={3} maxLength={160} required /><small>Use assumptions only. Do not enter credentials or private account details.</small></label>
        </div>
        <div className="printfulPricingColumns">
          <div className="printfulStack"><h3>Revenue & target</h3><div className="printfulFields">
            <PricingInput name="itemPrice" label="Item price" values={values} update={update} required />
            <PricingInput name="shippingCharged" label="Shipping charged to buyer" values={values} update={update} required />
            <PricingInput name="discountPercent" label="Item discount" values={values} update={update} required percent />
            <PricingInput name="targetMarginPercent" label="Target margin" values={values} update={update} required percent />
          </div><h3>Production & allowances</h3><div className="printfulFields">
            <PricingInput name="production" label="Production cost" values={values} update={update} />
            <PricingInput name="fulfilmentShipping" label="Fulfilment shipping" values={values} update={update} />
            <PricingInput name="sellerTaxCost" label="Seller tax cost" values={values} update={update} />
            <PricingInput name="refundReservePercent" label="Refund reserve" values={values} update={update} percent help="Applied to discounted item + charged shipping" />
          </div></div>
          <div className="printfulStack"><FeeInputs prefix="marketplace" label="Marketplace fee" values={values} update={update} /><FeeInputs prefix="payment" label="Payment fee" values={values} update={update} /></div>
        </div>
        <div className="printfulActions"><button className="coreButton coreButton-primary" type="submit">{pending ? "Calculating…" : "Calculate scenario"}</button><button className="coreButton" type="button" onClick={loadSyntheticExample}>Load synthetic USD example</button><button className="printfulTextButton" type="button" onClick={() => setValues({ ...initialPricingValues })}>Reset assumptions</button></div>
      </fieldset>
      <div className="printfulResult" aria-live="polite" aria-atomic="true" aria-busy={pending}>
        {pending ? <p>Calculating this scenario…</p> : state.values && !isCurrent ? <p>Inputs changed. Calculate again to see results for these assumptions.</p> : null}
        {isCurrent && state.error ? <p className="coreNotice coreNotice-danger" role="alert">{state.error}</p> : null}
        {!pending && result ? <>
          <p className="coreEyebrow">{result.status === "needs_inputs" ? "Needs inputs" : "Scenario calculated"}</p>
          <h3>{result.assumptionLabel}</h3>
          <dl className="printfulResultMetrics"><div><dt>Revenue after discount</dt><dd>{money(result.revenueMinor, result.currency)}</dd></div><div><dt>Profit</dt><dd>{result.profitMinor === null ? "Unknown" : money(result.profitMinor, result.currency)}</dd></div><div><dt>Margin</dt><dd>{result.marginBps === null ? "Unknown" : `${(result.marginBps / 100).toFixed(2)}%`}</dd></div></dl>
          {result.status === "needs_inputs" ? <p className="printfulNote">Still needed: {result.missing.map(key => missingPricingLabels[key] ?? key).join(", ")}. Profit, margin and target assessment remain unknown.</p> : <>
            <p className={result.meetsTarget ? "printfulTarget" : "printfulTarget printfulTarget-low"}>{result.meetsTarget ? "Meets" : "Below"} the assumed {values.targetMarginPercent}% margin target</p>
            <dl className="printfulFacts printfulCostBreakdown">{[
              ["Item discount", result.discountMinor], ["Production", result.productionMinor], ["Fulfilment shipping", result.fulfilmentShippingMinor],
              ["Seller tax cost", result.sellerTaxCostMinor], ["Marketplace fee", result.marketplaceFeeMinor], ["Payment fee", result.paymentFeeMinor],
              ["Refund reserve", result.refundReserveMinor], ["Total costs / allowances", result.totalCostMinor],
            ].map(([label, value]) => <div key={String(label)}><dt>{label}</dt><dd>{money(Number(value), result.currency)}</dd></div>)}</dl>
            <p className="printfulNote">The item discount is already deducted from revenue; it is not counted again in total costs.</p>
          </>}
          <p className="printfulNote">A scenario is not a supplier quote or tax determination. It grants no configuration, price-publication or order authority. Other unmodeled costs can change actual profit.</p>
        </> : !state.values && !pending ? <p className="printfulNote">Enter your assumptions or load the clearly labelled synthetic example. Calculations are not saved.</p> : null}
      </div>
    </form>
  </section>;
}
