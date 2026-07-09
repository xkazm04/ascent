# Fix Waves 4–7 — honesty flags, money, reliability, correctness

> 5 commits · **~30 findings closed** · 0 regressions.
> tsc **0 → 0** · vitest **3057 → 3165 passing** (199 files).
> Branch `vibeman/bug-ui-scan-2026-07-09`. Uncommitted WIP never staged (surgical index writes for
> `src/lib/scan.ts` and `src/app/org/[slug]/security/page.tsx`).

Waves 1–3 closed the dormant-auth cluster ([Wave 1](FIXES-WAVE-1.md), [Waves 2–3](FIXES-WAVE-2-3.md)).
These four waves close the themes that had nothing to do with auth.

---

## Wave 4 (`ec1ccbd`) — the honesty flags nobody read

**One shape, six sites:** the code derives a truth about how untrustworthy a result is, then drops it
before any consumer can act on it. Nothing errors. Nothing alarms. The system reports success it did not
earn.

| Flag | Computed at | Read by | Consequence |
|---|---|---|---|
| `partial` | `graphql.ts` | **nobody** | truncated PR slice scored + cached as authoritative → D6/D7/D8 silently understated on the largest repos |
| `degraded` | `supply-chain.ts` | **nobody** | a failed advisory fetch rendered as a **clean supply chain** |
| `warnings` / `engine` | `scan.ts` | web UI ✓, **gate JSON ✗** | CI merged on a mock-fallback score |
| `stoppedEarly` | `retention.ts` | **nobody** | a purge run that skipped its sweeps returned a green `200` |

Plus two structural ones:

- The purge cron's wall-clock budget was polled only **between orgs**, so one large fleet org — the exact
  case the budget protects — ran past `maxDuration` and was hard-killed mid-delete. Now interruptible
  between batches; each batch is its own transaction, so a stop stays safe and resumable.
- `maintain.mjs check`, documented for a **pre-push** hook, diffed only the uncommitted worktree — which is
  empty at pre-push. The "self-maintaining upkeep" guardrail was a silent no-op for every adopting repo.

`partial` is now a typed `report.prPartial`, a third cache-poisoning guard (`partialPrSlice`) beside
`degradedToMock`/`lowCoverage`, **and** a user-visible warning. Both scan routes now pass the whole guard
object instead of re-assembling two of its three fields, so the next vector can't be dropped at a call site.

> **Composition worth noting:** because Wave 4 also made `/api/gate` surface `warnings`, the `partial` flag
> now reaches CI. Two independent fixes met in the right place.

---

## Wave 5 (`6716d7c`) — the money

| # | Defect | Direction |
|---|---|---|
| 1 | Plan tiers **never revoked** on cancel / refund / chargeback | revenue leaks out |
| 2 | No per-repo lock → concurrent scans **double-charge** | customer overcharged |
| 3 | Refund clawback matched two key formats inconsistently → **double-clawback** | customer's paid credits destroyed |
| 4 | Cost preview ignored the free allowance the entitlement gate honors | qualifying users scared out of the funnel |
| 5 | Every OpenRouter model priced `null` → whole-org cost estimate blank | no bill visibility |

Details that mattered:

- **`cancel_at_period_end` is a no-op.** The customer paid through the period; Polar fires `revoked` when it
  ends. Downgrading them on `canceled` would have been a *new* bug. Only `revoked` and a **full** refund
  downgrade. Event names were verified against the installed `@polar-sh` adapter types, not guessed.
- **The double-charge fix is honestly partial.** `claimRescan` couldn't be reused (it keys on
  `nextScanAt <= now` and needs a persisted row; import repos have none yet, and bending `nextScanAt`
  corrupts cadence). What shipped is an atomic test-and-set **process-local** TTL lease with a fencing
  token, released in `finally` on every exit path. It closes the dominant same-instance case and says so
  in-code; it is **not** a cross-instance distributed lock. A 15-minute TTL rather than a boolean means a
  serverless kill self-heals — a leaked boolean lock would bar a repo from every future scan, strictly worse
  than the duplicate it guards.
- **The double-clawback destroyed real credits.** A seeded legacy-keyed row plus a new-format refund event
  moved a balance `60 → 20` instead of leaving it at 20.
- **The all-or-nothing cost nulling is deliberate** — `estimateLlmCostFromTable` refuses a half-bill — so
  only the root cause (unpriced OpenRouter slugs) was fixed, not the fail-closed behavior.

**Not fixed — needs a product decision.** The paid tier-upgrade funnel is unreachable: `/pricing`'s Pro and
Team CTAs both dead-end at `/onboarding` (the file's own comment at `:16` admits it is "neither a checkout
nor a plan upgrade"), and the only live checkout link sells credit packs. Pro/Team cannot be purchased
in-app. That is a product gap, not a bug to patch silently.

---

## Waves 6+7 (`0c706f4`) — share tokens, recovery, cache identity, bounds

### Share-token lifecycle

`/live/shared` was a stateless HMAC capability with **no revocation** and a hardcoded 7-day TTL, killable
only by rotating a secret that defaults to `AUTH_SECRET` — which signs out every user. Meanwhile
`briefing-share` implemented the *same feature correctly*. The fix ports its owner-binding and adds a
per-token `jti` revoked through the existing `SessionRevocation` store under a namespaced
`live-share:<jti>` key: a **single-link kill switch that touches neither the shared secret nor anyone's
session**, with no schema change. Minting now requires `canReadOrg` (it was open on auth-off deployments,
reopening a read path the read gate keeps closed), and the HMAC gained a `"live-share.v1"` domain label +
`aud` claim so a session cookie can never be replayed as a share token.

Briefing links carried only the range *key* (`"90d"`), so `resolveWindow` recomputed against the
**recipient's** clock — a board member saw different numbers than the owner sent. Absolute instants are now
frozen at mint; legacy tokens fall back to recomputing, so live links keep working.

### Recovery gaps

- `createCheckRun` was a single un-retried POST **whose throw the caller swallowed inline**, so a transient
  GitHub 5xx left a required status check permanently pending, blocking every PR with no alarm. The retry
  matters, but the load-bearing change was **removing the silent `.catch`**: an exhausted retry now reaches
  the outer handler and posts a neutral "could not run" check.
- A webhook delivery was dropped forever on a transient `installationMatchesOwner` failure — it early-returned
  without releasing, so GitHub could never redeliver.
- `hydrating = loaded < orgs` counted only *done* orgs as loaded, so one errored org left the live region
  announcing "charting 2/3…" forever. It now terminates on **settled** (done OR errored).

### Cache identity

`makeCacheKey` omitted provider, model, and rubric — so after any model swap every unchanged repo served the
**old score as current** for 7 days, with no invalidation lever. The key now folds a stable fingerprint of
`{provider, model, rubric}`, `SCORING_RUBRIC_VERSION` lives as one documented constant beside the model, and
the **persistent DB tier had the same staleness** (it keys on repo+sha only) — a persisted hit is now served
only when its stamped engine matches the active config.

### Bounds & concurrency

- `/api/org/simulate` never bounded `fixes[]` — an attacker-controlled loop bound × fleet size, reachable
  **unauthenticated**. Capped at 9, justified: there are exactly 9 maturity dimensions.
- The global rate limiter recorded a hit **before** the cap check, so a tripped ceiling fed itself and a ~1s
  spike became a sustained instance-wide lockout.
- Goals/initiatives did blind last-write-wins. Added a value-compare CAS → 409. **Honest limit:** with no
  version column this only catches two admins editing the *same field*; a complete fix needs a schema
  `updatedAt`/version plus client cooperation.

### Silently wrong numbers

The delivery page joined an **unscoped** whole-org spend total against **scoped** PR signals, inflating
idle/ungoverned/annual-$ by `(org total)/(subset)` on any filtered view — and users make budget calls on
those figures. `getOrgUsageRollup`'s allocated layer is a single org-level total with no per-repo breakdown,
so it genuinely cannot be filtered. Rather than fake a scope, the allocated dollars are now **withheld under
a filter, with an explanation**. Measured per-repo figures still render.

---

## Verification

| Gate | Wave 4 | Wave 5 | Waves 6+7 |
|---|---|---|---|
| `tsc --noEmit` | 0 | 0 | 0 |
| `vitest` | 3057 → 3072 | 3072 → 3108 | 3108 → 3165 |
| Failures | 0 | 0 | 0 |

---

## Patterns established (catalogue items 9–15)

9. **A computed honesty flag with no consumer is worse than no flag.** It makes the code *look* careful
   while the system reports unearned success. Grep every flag for a reader before trusting it: `partial`,
   `degraded`, `stoppedEarly` were all set, documented, and unread.
10. **Fail-closed defects hide in silence.** A lockout produces no error, no 500, no alert — the paid PDF
    export simply 404s. The same property that makes them safe makes them invisible.
11. **Fixing the guard without fixing the fallback is cosmetic.** Denying a privileged credential means
    nothing if the code then reaches for an ambient one (`noAmbientToken`). Always ask: *what does this use
    when I say no?*
12. **The right implementation is usually already in the repo.** `briefing-share` (revocable) vs `live-share`
    (not). `claimRescan` (atomic) vs manual scan (unlocked). `RadarChart` (guards the stale index) vs
    `DimLine` (crashes). Look for the sibling before designing.
13. **A guard dead in production may be live in dev.** Re-keying onto the active wall *alone* dropped a real
    401 on legacy-configured boxes. Gate on `(active || dormant)` when the intent is "some auth stack is
    live."
14. **Deliberate fail-closed behavior is not a bug.** `estimateLlmCostFromTable` nulls the whole period
    rather than emit a half-bill; `/api/gate` should 503 rather than pass a mock score. Read the comment
    before "fixing" the symptom — fix the root (unpriced models), not the honesty.
15. **When a number cannot be computed correctly under a filter, withhold it.** The delivery page's allocated
    dollars had no per-repo breakdown to scope. Rendering an inflated number with a caveat would still have
    driven wrong budget calls; the honest move is to not render it.
