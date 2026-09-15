// Low-balance / "auto-recharge" preference — the PURE half, shared by the client popover
// (CreditsControl.tsx) and the server route (src/app/api/billing/autorecharge/route.ts).
//
// WHAT THIS IS, HONESTLY. Polar is integrated here as a HOSTED CHECKOUT + signed webhook
// (src/lib/polar.ts → polar.checkouts.create; src/app/api/billing/webhook). Nothing in this repo stores
// a payment method or can charge a customer OFF-SESSION, so a true "buy N credits automatically when
// the balance drops below T" is NOT implementable today — it would need Polar customer-session/saved-
// method support plus a stored customer id. Rather than ship a charging path that silently never fires
// (strictly worse than nothing on a money surface), this models the part that IS real:
//
//   1. an opt-in, per-org THRESHOLD preference,
//   2. a PRE-EMPTIVE low-balance warning while the balance is still positive, and
//   3. a one-click top-up prompt (the existing /api/billing/checkout link) at that threshold.
//
// The only automatic thing is the WARNING. The UI must never claim money moves by itself; see
// `AUTO_RECHARGE_CHARGES_AUTOMATICALLY`.
//
// No React, no next/server, no Prisma — importable from both a "use client" component and a route
// handler without dragging the server bundle into the browser.

/** Audit-log `action` recorded whenever the preference CHANGES — "who armed this billing warning, and
 *  when". It is no longer the storage: the preference is a real column, `Organization.autoRechargeJson`,
 *  read/written through src/lib/db/org-settings.ts (G1-39). This action id still matters on the read
 *  side too, as the legacy fallback for orgs whose preference was saved before the column existed. */
export const AUTO_RECHARGE_ACTION = "billing.autorecharge";

/** Hard-wired FALSE, and exported so the UI copy is single-sourced with reality: no stored payment
 *  method / off-session charge exists in this deployment's Polar integration. Flip this only when a
 *  real off-session charge path lands — every "we will top up for you" string must be gated on it. */
export const AUTO_RECHARGE_CHARGES_AUTOMATICALLY = false;

/** Matches the default of CREDITS_ALERT_THRESHOLD in lib/alerts (the Slack low-credit line), so the
 *  in-app warning and the pushed alert agree out of the box. */
export const DEFAULT_LOW_BALANCE_THRESHOLD = 5;

/** Upper bound on a stored threshold — a preference, not a purchase; keeps a fat-fingered value from
 *  pinning the warning permanently on. */
export const MAX_LOW_BALANCE_THRESHOLD = 10_000;

export interface AutoRechargePref {
  /** Opt-IN. False → no warning, no prompt, nothing derived from `threshold` (see creditPressure). */
  enabled: boolean;
  /** Warn once the balance is at or below this many credits (and still > 0). */
  threshold: number;
  /** Polar product id of the pack the one-click top-up should offer; null = let the user pick. */
  packProductId: string | null;
}

export const DEFAULT_AUTO_RECHARGE: AutoRechargePref = {
  enabled: false,
  threshold: DEFAULT_LOW_BALANCE_THRESHOLD,
  packProductId: null,
};

/**
 * Coerce anything (a request body, a parsed audit `meta` blob carrying extra keys like `_sig`) into a
 * valid preference. Total and never throws: an unusable field falls back to its default rather than
 * rejecting, so a hand-edited/legacy audit row degrades to "feature off" instead of breaking the popover.
 */
export function normalizeAutoRecharge(raw: unknown): AutoRechargePref {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_AUTO_RECHARGE };
  const o = raw as Record<string, unknown>;
  const threshold =
    typeof o.threshold === "number" && Number.isFinite(o.threshold)
      ? Math.min(MAX_LOW_BALANCE_THRESHOLD, Math.max(1, Math.trunc(o.threshold)))
      : DEFAULT_LOW_BALANCE_THRESHOLD;
  const pack = typeof o.packProductId === "string" && o.packProductId.trim() ? o.packProductId.trim() : null;
  return { enabled: o.enabled === true, threshold, packProductId: pack };
}

/** Where an org's credit position sits, as one word.
 *  - `paused`  — balance spent AND the monthly free allowance spent: private scans are HARD-STOPPED.
 *  - `covered` — balance 0 but the monthly allowance still pays: scans keep running, do NOT nudge.
 *  - `low`     — still positive, but at/below the org's opt-in warning line: the pre-emptive state.
 *  - `ok`      — nothing to say. */
export type CreditPressure = "ok" | "low" | "covered" | "paused";

/**
 * The single boundary rule for the whole feature.
 *
 * `low` is the ONLY state the preference can produce, and it requires `pref.enabled` — with the
 * feature off this function returns exactly what CreditsControl computed before it existed
 * (paused / covered / ok), so an org that never opts in sees no behavior change at all.
 *
 * The boundary is INCLUSIVE (`balance <= threshold`) and requires `balance > 0`: at 0 the state is
 * already `paused`/`covered`, which are strictly more informative than "running low". `allowanceRemaining`
 * is the free metered scans LEFT this month (Infinity on the unlimited plan, which never renders here).
 */
export function creditPressure(input: {
  balance: number;
  allowanceRemaining: number;
  pref: AutoRechargePref;
}): CreditPressure {
  const { balance, pref } = input;
  const allowance = Math.max(0, input.allowanceRemaining);
  if (balance <= 0) return allowance > 0 ? "covered" : "paused";
  if (pref.enabled && balance <= pref.threshold) return "low";
  return "ok";
}
