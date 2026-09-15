// Shared PRE-scan gates for the two single-repo scan entry points — /api/scan (sync JSON) and
// /api/scan/stream (SSE). Both routes ran byte-identical copies of the burst rate limiter (with its
// quota-event observability side effect) and the public sign-in wall; a fix to one silently missed the
// other.
//
// These helpers return a DECISION, never a Response: each route surfaces a rejection in its own
// protocol (today both reject before the SSE stream opens, so both render JSON — but the stream route
// must stay free to emit an `error` frame instead if a gate ever moves inside start(), and a shared
// response builder would flatten that distinction).
//
// ORDERING IS LOAD-BEARING. Both routes now run the SAME sequence (G8-49):
//
//     rate limit → sign-in wall → quota (consumeScanQuota) → credit reserve (scanCreditGate)
//
// The credit reserve is the LAST gate, and it is last for a money reason: it is the only gate that
// MUTATES an org's balance, so every cheaper refusal (throttled, walled, out of monthly slots, typo'd
// URL/ref) must have been answered before a credit can be debited — otherwise a rejected request
// leaves a debit behind for the refund path to clean up. Everything above it is a pure read.
//
// The routes differ only in WHERE that sequence sits, which is a placement question, not an ordering
// one:
//   • /api/scan/stream: at the top of the handler — reaching the stream already means a real scan.
//   • /api/scan:        after the free cache-hit / peek / salvage returns, so the cheap hydration
//     paths stay unthrottled and a saved report still costs nothing.
//
// WHY THIS ORDER, and why it was unified. The two routes used to disagree (the stream limited first,
// the JSON route walled first), so one throttled anonymous request got 401 from one endpoint and 429
// from the other, and only the stream recorded the `rate_limit` quota event — throttled JSON traffic
// was invisible to observability. Rate limit wins the tie because:
//   1. It is the TRUTHFUL answer. "The shared scan budget is exhausted" holds no matter who is asking;
//      signing in does not lift a burst limit, so a 401 sends the caller into a flow that cannot help.
//   2. It is the CHEAPER answer — an in-memory/shared-store counter versus a Supabase session resolve.
//   3. It is the SAFER answer. The limiter is the cost ceiling; deciding it only for callers who first
//      pass an auth check makes the ceiling conditional on an unrelated gate.
//   4. It leaks nothing. Both rejections are anonymous-visible and neither reveals repo existence.
// The one deliberate exception is documented at its call site: /api/scan's PRIVATE-scan wall
// (orgSlug !== "public") still precedes the limiter, because moving it below would let an anonymous
// caller drive a GitHub ref resolve against a private repo.
//
// What both share and must never change: the rate limiter runs BEFORE the quota counter, so throttled
// traffic can never burn a monthly free-scan slot.

import { recordQuotaEvent } from "@/lib/db";
import { rateLimitRequestShared, SCAN_RATE_LIMIT, type RateLimitResult } from "@/lib/rate-limit";
import { authGateEnabled, type Viewer } from "@/lib/access";
import { publicScanSignInRequired } from "@/lib/env";
import { checkScanEntitlement, isMeteredScan } from "@/lib/entitlement";
import { refundScanCredit, reserveScanCredit } from "@/lib/scan-credit";

/**
 * Outcome of one pre-scan gate. `ok: true` means "proceed"; a rejection carries only what the caller
 * needs to render it in its own protocol (JSON body / SSE frame), never a built Response.
 */
export type ScanGatePass = { ok: true };
/** Over the per-IP / fleet-wide burst budget. `retryAfterSec` feeds the caller's Retry-After. */
/** Carries the whole `RateLimitResult`, not just the delay. Flattening it here is what kept the two
 *  highest-traffic scan endpoints from naming their refusal — and they are the only routes on the
 *  shared scan budget, so they are the likeliest to hit the GLOBAL ceiling, which is precisely the
 *  case a caller cannot diagnose from a bare retry-after. `retryAfterSec` stays for existing callers. */
export type ScanRateLimitRejection = { ok: false; reason: "rate_limited"; retryAfterSec: number; rl: RateLimitResult };
/** The sign-in wall is on and no viewer is signed in. */
export type ScanAuthRejection = { ok: false; reason: "auth_required" };
export type ScanGateDecision = ScanGatePass | ScanRateLimitRejection | ScanAuthRejection;

const PASS: ScanGatePass = { ok: true };

/**
 * Burst/global rate limit for the EXPENSIVE scan path (shared per-IP + fleet-wide budget across both
 * routes). Records the `rate_limit` quota event on rejection — the observability side effect both
 * routes carried inline. Callers render `retryAfterSec` themselves (JSON routes: `tooManyRequests`).
 * MUST be sequenced before the quota consume so throttled traffic never burns a free slot.
 */
export async function scanRateLimitGate(req: Request): Promise<ScanGatePass | ScanRateLimitRejection> {
  const rl = await rateLimitRequestShared(req, SCAN_RATE_LIMIT);
  if (rl.ok) return PASS;
  void recordQuotaEvent("rate_limit", "scan").catch(() => {}); // QUOTA #2: observability on the costly scan path
  return { ok: false, reason: "rate_limited", retryAfterSec: rl.retryAfterSec, rl };
}

/**
 * Sign-in wall for a REAL new scan: in production (Supabase configured + bypass hard-off, via
 * authGateEnabled) a scan requires a signed-in viewer; no-op in dev / when auth is bypassed. Viewing a
 * SAVED report stays free — the callers place this AFTER their free cache/peek returns.
 *
 * UAT TOMAS-L1-01 — THE ANONYMOUS PUBLIC FUNNEL IS EXEMPT BY DEFAULT. This gate used to wall every
 * scan, public included, which made `POST /api/scan` on a public repo 401 in production while every
 * read-only surface stayed open: the product left open every surface that would not convince a buyer
 * and walled the single one that would, under a page promising "no signup". `publicScanSignInRequired()`
 * (`ASCENT_REQUIRE_SIGNIN_FOR_PUBLIC_SCAN`, default off) lets an operator re-wall it deliberately.
 * The cost ceiling for the anonymous funnel is unchanged and does not depend on this flag: the shared
 * burst limiter runs before this gate and the rolling monthly free-scan quota runs after it.
 *
 * `publicScan` is the caller's resolved `orgSlug === PUBLIC_ORG` — i.e. no installation token was
 * minted, so this cannot reach a private repo. A private / installed-org scan (`publicScan: false`) is
 * walled exactly as before.
 *
 * Takes a viewer THUNK, not a viewer, to preserve both call sites exactly: the JSON route never resolves
 * a viewer when the gate is disabled (short-circuit), while the stream route resolves one earlier in
 * request scope (cookies aren't readable inside the stream's start()) and simply hands it back.
 */
export async function scanAuthGate(
  resolveViewer: () => Promise<Viewer | null> | Viewer | null,
  opts: { publicScan: boolean },
): Promise<ScanGatePass | ScanAuthRejection> {
  const walled = opts.publicScan ? publicScanWallEnabled() : authGateEnabled();
  if (!walled) return PASS;
  if (await resolveViewer()) return PASS;
  return { ok: false, reason: "auth_required" };
}

/**
 * Whether an ANONYMOUS PUBLIC scan is actually walled on this deployment — the composed predicate
 * `scanAuthGate` applies on its `publicScan: true` branch, exported so a UI can ask the same question
 * the endpoint will answer instead of approximating it.
 *
 * UAT TOMAS-L1-01 (recurrence 2). The server exemption above shipped alone: `POST /api/scan` returned
 * 200 to a cookie-less caller while the hero's scan dialog kept locking on `authGateEnabled()` and
 * painted a "Scanning is for signed-in members" panel over the form — a wall that was not there, on
 * the one door a prospective buyer actually uses, taking the QuotaMeter and the honest duration
 * sentence down with it. Two predicates for one decision is the whole defect, so there is now one:
 * `src/app/page.tsx` computes the dialog's `gated` from THIS function, and `/report?repo=` (which
 * starts the scan and renders whatever the server answers, including `auth_required` → SignInNotice)
 * needs no predicate of its own. Cheap, synchronous, next/headers-free — safe in a server component.
 *
 * Not a security boundary: the endpoint gate above is. This exists so the UI cannot disagree with it.
 */
export function publicScanWallEnabled(): boolean {
  return authGateEnabled() && publicScanSignInRequired();
}

// ── CREDIT GATE ──────────────────────────────────────────────────────────────────────────────────
//
// The fourth pre-scan gate, and the only one that spends money. It used to live INLINE in
// /api/scan only, which is exactly how /api/scan/stream — the route the report UI actually drives —
// came to run real LLM inference against a private org repo with no entitlement check, no reservation
// and no refund. The stream's own comment claimed "private (token) scans are credit-metered and skip
// this [monthly quota]"; the first half was simply false, so a private scan paid neither meter.
//
// This is a THIN layer over the existing mechanism, not a second one: `isMeteredScan` /
// `checkScanEntitlement` (src/lib/entitlement.ts) decide, and `reserveScanCredit` / `refundScanCredit`
// (src/lib/scan-credit.ts — the same pair the three fleet paths use) move the credit and fire the
// low-credit alert. What it adds is the ROUTE shape the two single-repo entry points need and the
// fleet paths do not: a not-metered/unlimited short-circuit, an entitlement pre-check that can 402
// before any debit, and a refund closure the route can fire from several unwind points.

/** A reservation held for the duration of one scan, returned by {@link scanCreditGate}. */
export interface ScanCreditHold {
  /**
   * The org's prepaid balance after the reservation — what `x-ascent-credits-remaining` reports.
   * `null` when nothing is metered (public/mock scan, or an unlimited plan), in which case the header
   * is omitted rather than reported as 0. `refund()` updates it, so a JSON route that refunds before
   * building its headers reports the post-refund truth.
   */
  remaining: number | null;
  /**
   * Refund the reservation when nothing billable was produced — degrade-to-mock, dedup, throw/abort.
   * Idempotent (at most one refund per reservation) and a no-op unless an overflow credit was actually
   * DEBITED: a within-allowance scan was free, and "refunding" it would MINT a credit.
   */
  refund: () => Promise<void>;
}

/** Nothing was reserved, so nothing can be refunded and there is no balance to report. */
const FREE_HOLD: ScanCreditHold = { remaining: null, refund: async () => {} };

export type ScanCreditPass = { ok: true; hold: ScanCreditHold };
/** Out of credits (and out of monthly allowance). Callers render `paymentRequired(balance)` — a 402. */
export type ScanCreditRejection = { ok: false; reason: "payment_required"; balance: number };

/**
 * Entitlement check + credit RESERVATION for one single-repo scan. Sequenced last (see the ordering
 * note at the top of this file) and BEFORE any inference runs.
 *
 * Reserving before the scan — rather than debiting after it — is the property this exists to hold.
 * `checkScanEntitlement` is a point-in-time read that two concurrent scans both pass; the old
 * "scan first, debit after" ordering let the loser run a full paid inference and then fail to debit,
 * serving a paid scan for free. `consumeScanCredit`'s atomic conditional decrement makes the
 * RESERVATION the real gate, and the hold's `refund()` hands the credit back on every path that
 * delivered nothing billable.
 *
 * Public (token-less) and mock scans are never charged: `isMeteredScan` short-circuits them to
 * FREE_HOLD, so a public funnel scan pays only the monthly free-scan quota, exactly as before.
 */
export async function scanCreditGate(
  orgSlug: string,
  opts: {
    mock: boolean;
    repoFullName: string;
    /**
     * WHO the spend is attributed to on the CreditLedger row — the signed-in viewer's login, or null
     * when there is none (the gate falls back to "system" rather than inventing an owner).
     *
     * A THUNK, for the same reason `scanAuthGate` takes one: /api/scan deliberately does not resolve a
     * viewer unless a gate needs it, and a non-metered scan needs no actor at all. It is invoked only
     * on the metered branch, after the entitlement check, so the public funnel resolves nothing.
     */
    resolveActor?: () => Promise<string | null> | string | null;
  },
): Promise<ScanCreditPass | ScanCreditRejection> {
  if (!isMeteredScan(orgSlug, opts.mock)) return { ok: true, hold: FREE_HOLD };

  const ent = await checkScanEntitlement(orgSlug);
  if (!ent.allowed) return { ok: false, reason: "payment_required", balance: ent.balance };
  // An unlimited plan is entitled but never debited, so there is no reservation to hold or refund.
  if (ent.unlimited) return { ok: true, hold: FREE_HOLD };

  // reserveScanCredit also fires maybeAlertLowCredits on a debit that crossed the low-water mark —
  // the proactive lifecycle push, which the inline /api/scan copy did and the stream route did not.
  // Attribution for BOTH sides of this movement: the debit below and the refund inside the hold carry
  // the same repo and the same actor, which is what makes a `refund` row joinable to the `scan` row it
  // reverses. `scanId` is deliberately absent — see ScanSpendAttribution in scan-credit.ts: the reserve
  // happens before inference, so no Scan row exists to name yet, and a ledger row is written once.
  const actor = (await opts.resolveActor?.()) ?? "system";
  const res = await reserveScanCredit(orgSlug, opts.repoFullName, { actor });
  // The balance moved between the read above and this atomic decrement (another in-flight scan spent
  // the last credit). Report the reservation's own balance where it has one; fall back to the read.
  if (res.skip) return { ok: false, reason: "payment_required", balance: res.balance ?? ent.balance };

  let reserved = res.reserved;
  const hold: ScanCreditHold = {
    remaining: res.balance,
    refund: async () => {
      if (!reserved) return;
      reserved = false; // at most one refund per reservation — a second call must not mint a credit
      const bal = await refundScanCredit(orgSlug, true, { actor, repoFullName: opts.repoFullName });
      if (typeof bal === "number") hold.remaining = bal;
    },
  };
  return { ok: true, hold };
}
