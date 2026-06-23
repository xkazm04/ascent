# Code Refactor — Quotas & Rate Limiting
> Context group: Billing, Credits & Metering
> Total: 4 findings (Critical: 0, High: 0, Medium: 2, Low: 2)

This context is in good shape. Every exported symbol across the seven in-scope files
has a confirmed caller (verified by repo-wide grep, including re-exports via
`src/lib/db/index.ts`, the `usage` page, the scan/stream/badge/org-import routes, the
retention purge job, `ReportClient.tsx`, and `IndexHero.tsx`). There is **no dead code**:
`removeNewestHit` is a live fallback branch (consume/refund pass `chargedAt` through, but
the legacy "drop newest" path still fires when a caller omits it), `getQuotaEventTotals`
feeds the public `/usage` view, and all three rate-limit configs are imported by routes.
The findings below are all localized duplication / stale-doc cleanups — each is strictly
behavior-preserving.

## 1. Rolling-window math duplicated between `decideQuota` and `peekPublicScanQuota`
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/public-scan-quota.ts:108-119 and 248-252
- **Scenario**: `decideQuota` (the pure, unit-tested decision function) trims hits older than the week, sorts them, and computes `resetAt = oldest-in-window + WEEK_MS`. `peekPublicScanQuota` re-implements that exact same trim/sort/remaining/resetAt arithmetic inline: `parseHits(...).filter((t) => t > now - WEEK_MS).sort((a, b) => a - b)`, then `remaining = Math.max(0, limit - recent.length)` and `resetAt = recent.length ? recent[0]! + WEEK_MS : null`.
- **Root cause**: `peek` was added later as the read-only sibling of `consume` (to power the pre-scan meter) and hand-rolled its own window read rather than reusing the already-extracted pure helper, because `decideQuota` always *appends* `now` (it decides for a would-be new scan) whereas peek must NOT count a hit.
- **Impact**: Two copies of the window/`resetAt` rule that must stay in lock-step. If the window definition ever changes (e.g. cutoff comparison `>` vs `>=`, or how `resetAt` is derived), one copy can be updated and the other silently drift — and only `decideQuota` is unit-tested, so a peek-side drift would ship unnoticed. The peek meter and the consume gate could then disagree about "scans left."
- **Fix sketch**: Extract the shared part into a small pure helper, e.g. `function windowState(prior: number[], now: number, limit: number): { remaining: number; resetAt: number | null }` that does the trim/sort once and returns `{ remaining, resetAt }` for a *non-consuming* read. Have `peekPublicScanQuota` call it; optionally have `decideQuota` reuse the same trim step (it would still append `now` and recompute on the post-append array). No caller signatures change — `QuotaPeek`/`QuotaDecision` shapes are untouched.

## 2. Bucket-key + identity derivation copy-pasted across consume / peek / refund
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/public-scan-quota.ts:161-162 & 169, 237-239 & 243, 306-307
- **Scenario**: All three DB-bound functions open with the same identity boilerplate: `const signedIn = Boolean(identity.viewerId);` then `const ipHash = signedIn ? hashKey(\`u:${identity.viewerId}\`) : hashIp(clientIp(req));` (and consume/peek additionally re-derive `limit = signedIn ? signedInScanWeeklyLimit() : publicScanWeeklyLimit()`). The bucket-key ternary is verbatim at lines 169, 243, and 307.
- **Root cause**: Organic growth — `consume` came first, then `peek` and `refund` were each written by copying the opening lines so the bucket key is "recomputed exactly as consume does" (a correctness requirement called out in the `refund` doc comment). The shared intent ("compute the bucket the same way everywhere") was enforced by duplication rather than a helper.
- **Impact**: The namespace-prefix rule (`u:` vs `ip:`) and the signed-in-vs-anon branch live in three places. The whole module's correctness hinges on these three computing the *identical* key (a refund against a different key than the consume would leak a slot), yet that invariant is maintained by hand. A future change (e.g. adding an org bucket, or salting differently) must be applied three times.
- **Fix sketch**: Add one private helper, e.g. `function bucketContext(req: Request, identity: QuotaIdentity): { signedIn: boolean; ipHash: string; scope: "anon" | "user" }` (and, where needed, `limit`). Replace the three duplicated openings with a single call. Pure refactor — public function signatures, returned shapes, and the key derivation itself are unchanged, so existing tests (which assert on the resulting `ipHash` via `hashIp`) keep passing.

## 3. Stale comment in `rate-limit.ts` claims the badge route "ships its own copy"
- **Severity**: Low
- **Category**: cleanup
- **File**: src/lib/rate-limit.ts:9-10
- **Scenario**: The header comment reads: *"(The badge route ships its own copy of this pattern; this module generalizes it for the scan/import endpoints that previously had NO limiter at all.)"* That is no longer true — `src/app/api/badge/[owner]/[repo]/route.ts:291` now calls `rateLimitRequest(req, BADGE_RATE_LIMIT)` from this very module (its own inline comment even says *"via the SHARED limiter"*), and `BADGE_RATE_LIMIT` is exported here at lines 122-127.
- **Root cause**: The badge limiter was later consolidated into this shared module (the `BADGE_RATE_LIMIT` config was added), but the migration-era comment describing the *old* state ("badge ships its own copy") was never updated.
- **Impact**: Misleads a maintainer into thinking there's a separate, duplicate badge limiter still to be unified — they may go hunting for code that no longer exists, or hesitate to change `BADGE_RATE_LIMIT` thinking the badge route doesn't use it.
- **Fix sketch**: Update the parenthetical to reflect reality, e.g. *"(The badge route also uses this shared limiter via `BADGE_RATE_LIMIT`.)"* Comment-only change; no code touched.

## 4. Reset-date formatting duplicated in `QuotaMeter` instead of reusing `formatResetAt`
- **Severity**: Low
- **Category**: duplication
- **File**: src/components/QuotaMeter.tsx:36 (vs the exported helper at src/components/report/QuotaNotice.tsx:28-31)
- **Scenario**: `QuotaNotice.tsx` exports a `formatResetAt(resetAt)` helper that renders the weekly-reset date coarsely (`toLocaleDateString(undefined, { month: "short", day: "numeric" })`, with a `null`/non-finite fallback). `QuotaMeter` renders the same concept with its own inline expression: `const reset = q.resetAt ? new Date(q.resetAt).toLocaleDateString() : null;` — a second, slightly different date format for the identical "when does the quota reset" string, in a sibling quota component.
- **Root cause**: `QuotaMeter` (landing-page meter) and `QuotaNotice` (report banners) were built separately; the meter formatted the reset date inline before `formatResetAt` was extracted, and was never refactored to use it.
- **Impact**: Two reset-date renderings that can drift in format ("Jun 30" vs the locale default like "6/30/2026") and in null-handling. Low cost today, but it's the kind of small inconsistency that makes the UI look unpolished and means a future "show the reset more precisely" change has to be made in two spots.
- **Fix sketch**: Import `formatResetAt` from `@/components/report/QuotaNotice` (it's already exported) and replace the inline `reset` computation in `QuotaMeter` with it — or, if the import direction (report → meter) is undesirable, lift `formatResetAt` to a shared util both import. Note the wording differs slightly (meter says "resets {reset}" expecting a bare date; `formatResetAt` returns "on Jun 30"/"in a few days"), so reconcile the surrounding sentence when adopting it. Behavior-preserving aside from the intended format unification.
