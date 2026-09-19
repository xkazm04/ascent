// Price-drift guard for the PRICE CONTRACT in src/lib/plans.ts: `monthlyPrice` on each tier is a
// DISPLAY-ONLY duplicate of the Polar product's real price (Polar is the price book — what checkout
// actually charges). A price change in the Polar dashboard that isn't mirrored into plans.ts means
// /pricing advertises one number and the buyer is charged another. This module is the automated
// reconciliation that contract note used to say didn't exist: it fetches the live price of every
// product mapped by POLAR_PLAN_PRODUCTS and compares it against the plan's advertised monthlyPrice.
//
// TWO CHECKS, ONE CONTRACT. The live pull can only run where Polar is reachable, so on its own the
// safeguard was real code nobody was watching — a price could sit wrong on /pricing indefinitely
// until an operator happened to open the KPI route.
//   1. RECORDED_PRICE_BOOK + checkRecordedPriceBook() — a dated transcript of the price book in
//      Polar's own units, compared against `monthlyPrice` by a unit test (price-drift.test.ts). This
//      is the check that actually fails in front of someone: it runs on every CI build, needs no
//      network, cannot flake, and cannot page anyone at 3am. It does not know today's Polar price —
//      it knows the price someone last READ off Polar, which is exactly what makes a one-sided edit
//      to the display copy impossible to land silently.
//   2. checkPriceDrift() — the live pull, still on the operator KPI route (GET /api/kpi →
//      `priceDrift`): an on-demand, operator-gated fetch that can never break builds, dev, or any
//      customer-facing path, and no-ops (returns null) when the Polar env is unset. See the wiring
//      comment in src/app/api/kpi/route.ts for why the KPI route was chosen over the weekly digest
//      cron. Its `status` is deliberately three-valued — a fetch failure reads "unknown", never
//      "no drift", because a network outage is not evidence that the prices match.

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

/** What the live sweep is entitled to CLAIM.
 *  - `ok`      — every mapped product was fetched and every one matched.
 *  - `drift`   — at least one advertised price disagrees with the price book. Act.
 *  - `unknown` — at least one product could not be fetched, so the ones that were prove nothing about
 *                it. A green dashboard drawn from an all-errors run is the failure mode this field
 *                exists to prevent: silence from a dead integration used to be indistinguishable from
 *                silence from a healthy one. */
export type PriceDriftStatus = "ok" | "drift" | "unknown";

export interface PriceDriftReport {
  /** Products successfully fetched and compared. */
  checked: number;
  mismatches: PriceMismatch[];
  /** Per-product fetch failures. Kept OUT of `mismatches` on purpose: a network blip is not
   *  evidence of a price change, and conflating the two would train the operator to ignore drift. */
  errors: string[];
  /** The single field a reader may act on — see PriceDriftStatus. Present so nobody has to infer
   *  health from `mismatches.length === 0`, which is TRUE during a total outage. */
  status: PriceDriftStatus;
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

  const report: PriceDriftReport = { checked: 0, mismatches: [], errors: [], status: "ok" };
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
  // Drift outranks an outage (a confirmed wrong price is actionable now); an outage outranks "ok" (an
  // unfetched product's price is simply not known). Only a complete, clean sweep may read "ok".
  report.status = report.mismatches.length > 0 ? "drift" : report.errors.length > 0 ? "unknown" : "ok";
  return report;
}

// ---------------------------------------------------------------------------------------------
// The recorded price book — the build-time half of the contract.
// ---------------------------------------------------------------------------------------------

export interface RecordedPrice {
  /** The fixed monthly price Polar charged for this tier when it was last read, in CENTS — Polar's
   *  own unit, on purpose: this is a transcript of an external system's state, not a second copy of
   *  our display copy, and keeping it in the provider's units keeps that distinction visible. `null`
   *  means no fixed price exists there: the Custom tier is negotiated, and Free is not sold. */
  cents: number | null;
  /** The date a human last READ this figure off the Polar dashboard (or off a clean checkPriceDrift
   *  run). Bump it when you re-verify; it is what tells a reader how old this evidence is. */
  recordedAt: string;
  /** Why the figure is what it is — especially for the tiers with no Polar price at all. */
  note?: string;
}

/**
 * What Polar's price book said, the last time anyone looked.
 *
 * The PRICE CONTRACT (see src/lib/plans.ts) makes `monthlyPrice` a display-only mirror of Polar. The
 * live detector above can confirm the mirror is true, but only where Polar is reachable — which is
 * nowhere in CI and nowhere in a self-hosted build. So the mirror also has to be checkable against
 * something checked into the repo, and this is it: `checkRecordedPriceBook()` is asserted empty by a
 * unit test, so an advertised price edited WITHOUT a matching edit here fails the build with the two
 * numbers side by side.
 *
 * The point is NOT that this table knows the true price — it cannot. The point is that the display
 * price can no longer be edited alone. Changing both means writing down, with a date, that you looked
 * at the price book; the live check on GET /api/kpi is what later proves you looked correctly.
 *
 * PROCEDURE when a price changes in the Polar dashboard: change it in Polar, mirror `monthlyPrice` in
 * plans.ts, update `cents` + `recordedAt` here, and confirm with a clean `priceDrift` (status "ok",
 * not "unknown") on the KPI route against the live account.
 */
export const RECORDED_PRICE_BOOK: Record<PlanId, RecordedPrice> = {
  free: { cents: 0, recordedAt: "2026-08-14", note: "Not sold: no Polar product is mapped to the free tier." },
  pro: { cents: 500, recordedAt: "2026-08-14", note: "$5/mo, set by the 2026-08-14 repricing." },
  team: { cents: 1000, recordedAt: "2026-08-14", note: "$10/mo, set by the 2026-08-14 repricing." },
  enterprise: { cents: null, recordedAt: "2026-08-14", note: "Negotiated per contract; /pricing shows 'Flexible'." },
};

export interface RecordedPriceMismatch {
  plan: PlanId;
  /** What /pricing advertises today — PLAN_FEATURES[plan].monthlyPrice, in whole USD. */
  displayUsd: number | null;
  /** What the recorded price book says Polar charged, in whole USD (null = no fixed price there). */
  recordedUsd: number | null;
  recordedAt: string;
}

/**
 * Compare every advertised price against the recorded price book. Empty = the display copy still
 * matches the last price anyone verified. Pure and offline — this is the half that runs in CI.
 *
 * `advertised` is injected (defaulting to the real plan model) so the FAILURE path is testable: a
 * check that can only ever be exercised in its passing state is not a check anyone has verified.
 */
export function checkRecordedPriceBook(
  advertised: (plan: PlanId) => number | null = (plan) => PLAN_FEATURES[plan].monthlyPrice,
): RecordedPriceMismatch[] {
  const out: RecordedPriceMismatch[] = [];
  for (const plan of Object.keys(RECORDED_PRICE_BOOK) as PlanId[]) {
    const recorded = RECORDED_PRICE_BOOK[plan];
    const recordedUsd = recorded.cents == null ? null : recorded.cents / 100;
    const displayUsd = advertised(plan);
    if (displayUsd !== recordedUsd) out.push({ plan, displayUsd, recordedUsd, recordedAt: recorded.recordedAt });
  }
  return out;
}
