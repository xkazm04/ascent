# Biz+Bug Fix Wave 2 — Billing & Quota Integrity

> 3 commits, 5 findings closed (2 High + 2 Medium + 1 Low).
> Baseline preserved: tsc 0 → 0; vitest 2635 pass / 1 pre-existing env-fail → unchanged.

## Commits

| # | Commit | Findings | Sev | Files |
|---|---|---|---|---|
| 1 | `3ceecc1` | reconciliation mis-buckets clawbacks (+ `sumRefundClawback`) | Low | `credits.ts`, `db/index.ts` |
| 2 | `c6c4ff1` | split-refund clawback + fraction basis + fulfilment retry-storm | High+Med+Med | `billing/webhook/route.ts` |
| 3 | `b56be30` | clientIp `unknown` collapses the weekly quota | High | `public-scan-quota.ts` |

## What was fixed

1. **Split/partial-refund clawback (High).** Idempotency was keyed on the order id alone, so only the
   first `order.refunded` event landed — a buyer refunding a credit pack in 2+ chunks kept most granted
   credits. Polar's `refundedAmount` is cumulative, so the webhook now computes the **target total**
   clawback at each refund level and reverses only the **incremental share** (`sumRefundClawback`), keyed
   per cumulative amount for idempotency.
2. **Refund fraction basis (Medium).** The clawback fraction divided `refundedAmount` (of gross/total
   charged) by `netAmount` (net-of-fees) — over/under-clawing on every taxed partial refund. Now divides
   by `totalAmount` (same money basis as the numerator).
3. **Fulfilment retry-storm (Medium).** A paid order with **no org binding** (no `externalId`/metadata)
   is permanent, but the handler threw — spinning Polar's at-least-once retries forever. Now logs loudly
   (dead-letter signal) and ACKs. The genuinely-transient org-row-creation race (`balance === null`)
   still retries.
4. **Reconciliation mis-bucketing (Low).** `getCreditReconciliation` counted every negative delta as
   scan "debited", so a refund-clawback showed on `/usage` as extra credits debited. Now buckets by
   reason: `/refund/i` rows are reversals, excluded from the scan-spend bucket (still net in `net`).
5. **clientIp `unknown` quota collapse (High).** When no IP header resolves, `clientIp` returns
   `"unknown"` for everyone, so the 7-day quota hashed all anonymous visitors into one shared bucket —
   locking the whole public funnel for a week after N scans. consume/peek/refund now fail OPEN for an
   unresolvable IP (the per-minute burst limiter stays the backstop).

## Patterns established (catalogue items 4–6)

4. **Order-id idempotency drops increments** — keying a reversal/clawback on a parent id (order) loses
   every event after the first when the parent can emit several (partial refunds). Key on the
   per-event/cumulative value and reverse-to-target instead.
5. **Mismatched money bases** — a fraction whose numerator and denominator come from different bases
   (refunded-of-gross ÷ net-of-fees) silently drifts on any taxed order. Pin both to the same basis.
6. **Shared fail-closed bucket as a long-window key** — a collective fallback key (`"unknown"`) is a
   correct fail-closed for a short burst window but a site-wide lockout for a low-N long window. Fail
   OPEN there instead.

## Note on a Prisma drift caught mid-wave

`tsc` briefly showed 1 error in `src/lib/db/org-gate.ts` (gatePolicy JSON↔TEXT) — a **stale generated
Prisma client vs. the WIP schema**, not from any edit here. `npx prisma generate` cleared it (tsc → 0).
Pre-deploy: run `prisma generate`.

## What remains

Wave 3 (report/dashboard data-integrity), Wave 4 (slug canonicalization), reliability/DSQL Highs, then
the Medium/Low tail. Business track (90) stays a curated backlog.
