import { assertFreshPrintful, assertPrintful, supportedCurrency, type PrintfulVariantPrices, type SupportedCurrency } from "./contracts";

export type FeeScenario = {fixedMinor: number; rateBps: number; basis: "item" | "item_plus_shipping"};
export type PrintPricingInput = {
  currency: SupportedCurrency; itemPriceMinor: number; shippingChargedMinor: number; discountBps: number;
  productionMinor: number | null; fulfilmentShippingMinor: number | null; sellerTaxCostMinor: number | null;
  marketplaceFee: FeeScenario | null; paymentFee: FeeScenario | null; refundReserveBps: number | null;
  targetMarginBps: number; assumptionLabel: string;
};
function money(value: number, label: string) { assertPrintful(Number.isSafeInteger(value) && value >= 0 && value <= 10_000_000_000, `Invalid ${label} in currency minor units.`); return value; }
function rate(value: number, label: string) { assertPrintful(Number.isInteger(value) && value >= 0 && value <= 10000, `Invalid ${label} basis points.`); return value; }
function fractionUp(value: number, bps: number) { return Number((BigInt(value) * BigInt(bps) + BigInt(9999)) / BigInt(10000)); }
function fee(value: FeeScenario, item: number, revenue: number) {
  money(value.fixedMinor, "fixed fee"); rate(value.rateBps, "fee rate");
  assertPrintful(["item", "item_plus_shipping"].includes(value.basis), "Fee basis must be explicit.");
  return value.fixedMinor + fractionUp(value.basis === "item" ? item : revenue, value.rateBps);
}
/** A single ordinary DTG front/back placement is included, not charged twice.
 * Other techniques/options require the later provider order-estimation contract. */
export function singlePlacementProductionCost(prices: PrintfulVariantPrices, placement: "front" | "back", now = Date.now()) {
  assertFreshPrintful(prices.provenance, now); supportedCurrency(prices.currency);
  assertPrintful(placement === "front" || placement === "back", "Only one ordinary front/back placement is supported by this cost scenario.");
  const base = prices.techniques.find(row => row.key === "dtg");
  assertPrintful(base && prices.placementPrices.some(row => row.placement === placement && row.technique === "dtg"), "The exact DTG placement and technique price are required.");
  money(base.regularMinor, "provider technique price");
  return {currency: prices.currency, productionMinor: base.regularMinor, includedPlacement: placement, technique: "dtg" as const,
    discountedPriceUsed: false, excludes: ["shipping", "taxes", "marketplace_fees", "payment_fees", "special_options"],
    estimateOnly: true, executionAuthorized: false as const, provenance: prices.provenance};
}
/** Arithmetic only. Missing country/account inputs remain unknown, never zero. */
export function evaluatePrintPricing(input: PrintPricingInput) {
  const currency = supportedCurrency(input.currency);
  money(input.itemPriceMinor, "item price"); money(input.shippingChargedMinor, "shipping charged");
  rate(input.discountBps, "discount"); rate(input.targetMarginBps, "target margin");
  assertPrintful(typeof input.assumptionLabel === "string" && input.assumptionLabel.trim().length >= 3 && input.assumptionLabel.length <= 1000, "A labelled pricing scenario is required.");
  const discountMinor = fractionUp(input.itemPriceMinor, input.discountBps), itemNetMinor = input.itemPriceMinor - discountMinor;
  const revenueMinor = itemNetMinor + input.shippingChargedMinor;
  const missing = (Object.keys(input) as (keyof PrintPricingInput)[]).filter(key => input[key] === null);
  for (const key of ["productionMinor", "fulfilmentShippingMinor", "sellerTaxCostMinor"] as const) if (input[key] !== null) money(input[key], key);
  if (input.refundReserveBps !== null) rate(input.refundReserveBps, "refund reserve");
  // Validate supplied fee data even if another necessary input is missing.
  if (input.marketplaceFee !== null) fee(input.marketplaceFee, itemNetMinor, revenueMinor);
  if (input.paymentFee !== null) fee(input.paymentFee, itemNetMinor, revenueMinor);
  const common = {currency, assumptionLabel: input.assumptionLabel, discountMinor, revenueMinor, executionAuthorized: false as const, publicationAuthorized: false as const};
  if (missing.length || revenueMinor === 0) return {...common, status: "needs_inputs" as const, missing: [...missing, ...(revenueMinor === 0 ? ["positive_revenue"] : [])], profitMinor: null, marginBps: null, meetsTarget: null};
  const marketplaceFeeMinor = fee(input.marketplaceFee!, itemNetMinor, revenueMinor), paymentFeeMinor = fee(input.paymentFee!, itemNetMinor, revenueMinor);
  const refundReserveMinor = fractionUp(revenueMinor, input.refundReserveBps!);
  const totalCostMinor = input.productionMinor! + input.fulfilmentShippingMinor! + input.sellerTaxCostMinor! + marketplaceFeeMinor + paymentFeeMinor + refundReserveMinor;
  assertPrintful(Number.isSafeInteger(totalCostMinor), "Pricing exceeds safe integer arithmetic.");
  const profitMinor = revenueMinor - totalCostMinor;
  const numerator = BigInt(profitMinor) * BigInt(10000), denominator = BigInt(revenueMinor);
  const marginBps = Number(numerator / denominator - (numerator < BigInt(0) && numerator % denominator !== BigInt(0) ? BigInt(1) : BigInt(0)));
  return {...common, status: "scenario_calculated" as const, missing: [], productionMinor: input.productionMinor!, fulfilmentShippingMinor: input.fulfilmentShippingMinor!, sellerTaxCostMinor: input.sellerTaxCostMinor!, marketplaceFeeMinor, paymentFeeMinor, refundReserveMinor, totalCostMinor, profitMinor, marginBps, meetsTarget: marginBps >= input.targetMarginBps};
}
