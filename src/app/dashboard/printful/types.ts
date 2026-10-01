import type { PrintfulConfigurationPlan } from "../../../printful/configuration";
import type { PrintfulCatalogProduct, PrintfulCatalogVariant } from "../../../printful/contracts";
import type { evaluatePrintPricing } from "../../../printful/pricing";

export type FixtureVariantPreview = {
  variant: PrintfulCatalogVariant;
  productionMinor: number;
  plans: PrintfulConfigurationPlan[];
};
export type PrintfulFixturePreview = {
  product: PrintfulCatalogProduct;
  variants: FixtureVariantPreview[];
  sourcePixels: { width: number; height: number; designWidthIn: number; designHeightIn: number };
};

export const pricingFieldNames = [
  "currency", "assumptionLabel", "itemPrice", "shippingCharged", "discountPercent",
  "production", "fulfilmentShipping", "sellerTaxCost", "marketplaceFixed",
  "marketplacePercent", "marketplaceBasis", "paymentFixed", "paymentPercent",
  "paymentBasis", "refundReservePercent", "targetMarginPercent",
] as const;
export type PricingField = (typeof pricingFieldNames)[number];
export type PricingFormValues = Record<PricingField, string>;
export type PricingPreviewState = {
  error: string | null;
  values: PricingFormValues | null;
  result: ReturnType<typeof evaluatePrintPricing> | null;
};
export const initialPricingValues: PricingFormValues = {
  currency: "USD", assumptionLabel: "Synthetic pricing scenario", itemPrice: "30.00",
  shippingCharged: "5.00", discountPercent: "0", production: "",
  fulfilmentShipping: "", sellerTaxCost: "", marketplaceFixed: "",
  marketplacePercent: "", marketplaceBasis: "item_plus_shipping", paymentFixed: "",
  paymentPercent: "", paymentBasis: "item_plus_shipping", refundReservePercent: "",
  targetMarginPercent: "30",
};
export const monetaryPricingFields: PricingField[] = [
  "itemPrice", "shippingCharged", "production", "fulfilmentShipping", "sellerTaxCost",
  "marketplaceFixed", "paymentFixed",
];
export const missingPricingLabels: Record<string, string> = {
  productionMinor: "Production cost", fulfilmentShippingMinor: "Fulfilment shipping",
  sellerTaxCostMinor: "Seller tax cost", marketplaceFee: "Marketplace fee",
  paymentFee: "Payment fee", refundReserveBps: "Refund reserve", positive_revenue: "Positive revenue",
};
