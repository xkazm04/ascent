# Bug-UI Fix Wave 2 — Revenue Integrity

> 3 atomic commits, 5 findings closed (1 critical, 3 high, 1 medium).
> Baseline preserved: `tsc` 0 → 0 errors · tests 470/470 → 477/477 (+7 new money-path regression tests).

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|--------|-----------------|----------|-------|
| 1 | `263001d` fix(quota): value-keyed refund closes the double-refund quota bypass | quotas #1, scan-pipeline #1 | Critical + High | `public-scan-quota.ts` (+test), `scan/stream/route.ts` |
| 2 | `9a029be` fix(api/scan): reserve credit before inference + value-keyed quota refund | credits #3, quotas #1 | High | `api/scan/route.ts` |
| 3 | `264870b` fix(credits): atomic clamp on negative grants + canonical slug casing | credits #1, #4 | High + Medium | `db/credits.ts` (+test) |

## What was fixed

1. **Quota double-refund (CRITICAL).** `refundPublicScanQuota` dropped the bucket's *newest* hit, not the slot *this* request charged. Two concurrent refunds on a shared/coalesced scan (two tabs, or a degrade-to-mock both waiters observe) each peeled off a different sibling's timestamp — removing more slots than were consumed, so the free LLM funnel could be grazed indefinitely. `consumePublicScanQuota` now returns the exact `chargedAt` it recorded; `refundPublicScanQuota` removes *that* timestamp (`removeHit`), idempotent if already gone. Both scan routes thread it through. (Also closes the scan-pipeline coalesced-double-refund high — same mechanism.)

2. **`/api/scan` TOCTOU double-spend (High).** The single-scan path checked entitlement up front, ran paid inference, then debited best-effort — so two concurrent private scans on a balance of 1 both ran real LLM inference and the loser was served free (the `unbilled` branch). Now mirrors the already-correct `/api/org/scan` and `/api/cron/rescan`: **reserve** one credit before scanning (`paymentRequired` if the reservation loses), refund on degrade-to-mock / dedup / throw. The atomic reservation is the gate, not an after-the-fact note.

3. **Negative-grant ledger corruption (High).** `grantCredits` did `increment: delta` then a *second* absolute `scanCredits: 0` write to clamp — breaking the append-only invariant `prev + delta === balanceAfter` (so reconciliation drifts forever) and able to clobber a concurrent movement. Now reads the balance, computes the clamped applied delta, applies it in one relative increment, and stamps the ledger with the *applied* delta.

4. **Credit-layer slug casing (Medium).** `getCreditState` / `grantCredits` / `consumeScanCredit` / `getCreditLedger` queried by raw slug while authz + `setOrgPlan` lowercase — a mixed-case slug read `$0/free` (wrongly paywalling a paid org) or made debits silent no-ops. All four now normalize to lowercase.

## Verification

| | Before wave | After wave |
|---|---|---|
| `tsc --noEmit` errors | 0 | 0 |
| Tests | 470/470 | 477/477 |
| New regression tests | — | +7 (4 value-keyed refund, 3 grant clamp) |

## Patterns established (catalogue items 6–8)

6. **Refund by value, not by recency.** When a shared/coalesced operation can be undone by more than one caller, "undo the newest" lets two undos each remove a *different* live unit. Return an opaque handle (the exact timestamp/id) from the do-step and have the undo-step target that handle, idempotently.
7. **Reserve-then-refund for metered side effects.** If running an expensive side effect (paid inference) and billing it are two steps, a point-in-time "can afford?" check that both racers pass lets the loser run the side effect for free. Make the *atomic reservation* precede the side effect; refund on no-deliverable. (One of three sibling scan paths still had the legacy order — aligning it was the fix.)
8. **Relative increments, never increment-then-absolute-clamp.** Clamping a relative `increment` with a following absolute write breaks ledger invariants and clobbers concurrent movements. Compute the clamped delta first and apply it as a single relative op; stamp the *applied* delta.

## Deferred this wave (genuine product/infra decisions — NOT silent skips)

These were in the originally-listed Wave 2 set but the already-existed grep (Phase 4.1d) and a risk read moved them out of a *safe* automated wave:

- **Owner can mint free credits (credits #2, High).** The fix requires a *new privilege tier above org-owner* (super-admin / actor allowlist) + a cumulative per-org grant cap + an audit-on-grant. That's a product/auth-model decision, not a mechanical fix. The existing control (`ASCENT_ALLOW_CREDIT_GRANTS` off in prod + per-call cap) holds in the meantime. **→ needs a product call.**
- **Rate limiter XFF spoof + in-memory reset (quotas #2, #3, High).** Both are deployment-topology / infra decisions: the XFF fix needs the operator's trusted-proxy depth (changing the default risks over-collapsing legit per-IP buckets into the shared "unknown" bucket and over-throttling real users); the in-memory reset needs a shared store (Redis/Upstash). The global per-instance ceiling remains a cost backstop. **→ needs deploy/infra config.**
- **`/api/org/scan` claim-lock (org-import #1, High).** Already mitigated for *money* (atomic per-repo credit reservation) and *data* (persist dedups by commit) — the residual harm is duplicated *work*, not double-bill. Lower value than rated; a claim-lock optimization for a later pass. **→ low-value optimization.**

## What remains

Remaining waves per INDEX: **W3 Data integrity & concurrency** (2 criticals) · W4 Destructive ops (2 criticals) · W5–W11 correctness + UX/a11y. Plus the 3 deferred items above (2 need a human decision, 1 is an optimization).
