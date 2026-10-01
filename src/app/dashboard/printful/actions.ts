"use server";

import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { calculatePricingForm, readPricingForm } from "./pricing-form";
import type { PricingPreviewState } from "./types";

/** Authenticated arithmetic only: no persistence, provider calls, grants or mutations. */
export async function previewPrintfulPricing(
  _previous: PricingPreviewState,
  form: FormData,
): Promise<PricingPreviewState> {
  await requireOwnerUiContext();
  const values = readPricingForm(form);
  try {
    return { values, error: null, result: calculatePricingForm(values) };
  } catch (error) {
    return { values, result: null, error: error instanceof Error ? error.message : "The pricing scenario could not be calculated." };
  }
}
