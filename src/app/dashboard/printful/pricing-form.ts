import { decimalMinor, supportedCurrency } from "../../../printful/contracts";
import { evaluatePrintPricing, type FeeScenario } from "../../../printful/pricing";
import { pricingFieldNames, type PricingField, type PricingFormValues } from "./types";

export function readPricingForm(form: FormData): PricingFormValues {
  return Object.fromEntries(pricingFieldNames.map(name => {
    const value = form.get(name);
    return [name, typeof value === "string" ? value : ""];
  })) as PricingFormValues;
}

/** Input parsing only; all money/fee/margin arithmetic lives in the shared pricing contract. */
export function calculatePricingForm(values: PricingFormValues) {
  function amount(key: PricingField, label: string, optional = false) {
    const value = values[key].trim();
    if (!value && optional) return null;
    if (!/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(value)) {
      throw new Error(`${label}: enter a nonnegative amount with up to two decimals${optional ? ", or leave it blank for unknown" : ""}.`);
    }
    return decimalMinor(value);
  }
  function percent(key: PricingField, label: string, optional = false) {
    const value = amount(key, label, optional);
    if (value !== null && value > 10000) throw new Error(`${label}: use a percentage from 0 to 100.`);
    return value;
  }
  function fee(prefix: "marketplace" | "payment", label: string): FeeScenario | null {
    const fixedMinor = amount(`${prefix}Fixed`, `${label} fixed amount`, true);
    const rateBps = percent(`${prefix}Percent`, `${label} percentage`, true);
    if (fixedMinor === null && rateBps === null) return null;
    if (fixedMinor === null || rateBps === null) throw new Error(`${label}: enter both fixed amount and percentage, or leave both blank for unknown.`);
    const basis = values[`${prefix}Basis`];
    if (basis !== "item" && basis !== "item_plus_shipping") throw new Error(`${label}: select a fee basis.`);
    return { fixedMinor, rateBps, basis };
  }
  const assumptionLabel = values.assumptionLabel.trim();
  if (assumptionLabel.length < 3 || assumptionLabel.length > 160) throw new Error("Describe the scenario in 3 to 160 characters.");
  return evaluatePrintPricing({
    currency: supportedCurrency(values.currency), assumptionLabel,
    itemPriceMinor: amount("itemPrice", "Item price")!, shippingChargedMinor: amount("shippingCharged", "Shipping charged")!,
    discountBps: percent("discountPercent", "Discount")!, productionMinor: amount("production", "Production cost", true),
    fulfilmentShippingMinor: amount("fulfilmentShipping", "Fulfilment shipping", true),
    sellerTaxCostMinor: amount("sellerTaxCost", "Seller tax cost", true),
    marketplaceFee: fee("marketplace", "Marketplace fee"), paymentFee: fee("payment", "Payment fee"),
    refundReserveBps: percent("refundReservePercent", "Refund reserve", true),
    targetMarginBps: percent("targetMarginPercent", "Target margin")!,
  });
}
