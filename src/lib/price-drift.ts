// Price-drift guard for the PRICE CONTRACT in src/lib/plans.ts: `monthlyPrice` on each tier is a
// DISPLAY-ONLY duplicate of the Polar product's real price (Polar is the price book — what checkout
// actually charges). A price change in the Polar dashboard that isn't mirrored into plans.ts means
// /pricing advertises one number and the buyer is charged another. This module is the automated
// reconciliation that contract note used to say didn't exist: it fetches the live price of every
// product mapped by POLAR_PLAN_PRODUCTS and compares it against the plan's advertised monthlyPrice.
//
// Operationally it fires from the operator KPI route (GET /api/kpi → `priceDrift`) — an on-demand,
// operator-gated pull — so it can never break builds, dev, or any customer-facing path, and it
// no-ops (returns null) when the Polar env is unset. See the wiring comment in
// src/app/api/kpi/route.ts for why the KPI route was chosen over the weekly digest cron.

import { getPolar, planProducts } from "@/lib/polar";
import { PLAN_FEATURES, type PlanId } from "@/lib/plans";

/** The slice of a Polar Product this check reads. Structural (elements stay `unknown` and are
 *  narrowed field-by-field) so the real SDK `Product` satisfies it and tests can stub it without
 *  importing the SDK's model types. */
export interface PolarProductLike {
  prices?: ReadonlyArray<unknown> | null;
}

/** The slice of the Polar client this check needs — injectable so the comparison is unit-testable
 *  without network or the SDK. The real `Polar` client satisfies it structurally. */
export interface PriceSource {
  products: { get(request: { id: string }): Promise<PolarProductLike> };
}

export interface PriceMismatch {
  plan: PlanId;
  productId: string;
  /** What /pricing advertises — PLAN_FEATURES[plan].monthlyPrice, in whole USD. */
  displayUsd: number;
  /** The live Polar fixed monthly price in USD, or null when the product carries no comparable
   *  fixed USD price at all (free/custom/metered pricing — itself a drift worth surfacing). */
  polarUsd: number | null;
}

export interface PriceDriftReport {
  /** Products successfully fetched and compared. */
  checked: number;
  mismatches: PriceMismatch[];
  /** Per-product fetch failures. Kept OUT of `mismatches` on purpose: a network blip is not
   *  evidence of a price change, and conflating the two would train the operator to ignore drift. */
  errors: string[];
}

/**
 * The live monthly USD price on a Polar product: the first non-archived fixed USD price, converted
 * from cents. Null when no such price exists. Narrows structurally because Product.prices is a wide
 * union (fixed/free/custom/metered/seat) and only the fixed leg carries `priceAmount`.
 */
export function productMonthlyUsd(product: PolarProductLike): number | null {
  for (const entry of product.prices ?? []) {
    if (!entry || typeof entry !== "object") continue;
    const p = entry as Record<string, unknown>;
    if (p.amountType !== "fixed") continue;
    if (p.isArchived === true) continue;
    if (typeof p.priceAmount !== "number") continue;
    if (typeof p.priceCurrency === "string" && p.priceCurrency.toLowerCase() !== "usd") continue;
    return p.priceAmount / 100; // Polar prices are in cents
  }
  return null;
}

/**
 * Compare one plan's advertised price against the live Polar product. Null = in lockstep (or the
 * plan is custom-priced — the Custom tier renders "Flexible", so no number exists to drift). Pure given
 * the fetched product, so the comparison semantics are unit-testable without a client.
 */
export function comparePlanPrice(plan: PlanId, productId: string, product: PolarProductLike): PriceMismatch | null {
  const displayUsd = PLAN_FEATURES[plan].monthlyPrice;
  if (displayUsd == null) return null;
  const polarUsd = productMonthlyUsd(product);
  if (polarUsd === displayUsd) return null;
  return { plan, productId, displayUsd, polarUsd };
}

/**
 * Fetch the live Polar price for every plan-mapped product and reconcile against plans.ts.
 * Returns null — a clean "not configured", distinct from "checked, no drift" — when Polar has no
 * access token or POLAR_PLAN_PRODUCTS maps nothing. One product's fetch failure never aborts the
 * rest; it lands in `errors`.
 */
export async function checkPriceDrift(client: PriceSource | null = getPolar()): Promise<PriceDriftReport | null> {
  const bindings = planProducts();
  if (!client || bindings.length === 0) return null;

  const report: PriceDriftReport = { checked: 0, mismatches: [], errors: [] };
  for (const { plan, productId } of bindings) {
    try {
      const product = await client.products.get({ id: productId });
      report.checked++;
      const mismatch = comparePlanPrice(plan, productId, product);
      if (mismatch) report.mismatches.push(mismatch);
    } catch (err) {
      report.errors.push(`${plan} (${productId}): ${err instanceof Error ? err.message : "fetch failed"}`);
    }
  }
  return report;
}
