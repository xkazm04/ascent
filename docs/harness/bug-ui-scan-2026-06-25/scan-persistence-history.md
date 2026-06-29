# Scan Persistence & History — Bug + UI Scan
> Context: Scan Persistence & History (Data & Persistence)
> Total: 5 findings (0 critical, 1 high, 3 medium, 1 low)

## 1. getScanComparison missing the private-repo cross-tenant disclosure guard its siblings have
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: silent-failure (security / cross-tenant disclosure)
- **File**: src/lib/db/scans-read.ts:373-418 (the gap is at ~389, right after the repo lookup)
- **Value**: impact 8 · effort 2 · risk 2
- **Scenario**: An anonymous/unauthorized visitor opens `/report/compare?repo=owner/privrepo`. `readableOrgForOwner` (src/lib/auth.ts:339) returns `"public"` for anyone without an installation for `owner`, so `getScanComparison` runs with `orgSlug = "public"`. It loads the full `repo` row (line 386) and serves `before`/`after` ComparableScans — overall/dimension scores, evidence strings, gap lists, recommendations — with NO check on `repo.isPrivate`. Both sibling readers guard exactly this: `getRepositoryHistory` (line 230) and `getScanReportByCommit` (line 671) both do `if (orgSlug === DEFAULT_ORG_SLUG && repo.isPrivate) return null;` and label it "Defense-in-depth (cross-tenant disclosure)". `getScanComparison` is the only public-org read path that omits it.
- **Root cause**: The persist side refuses to write a private repo under the public org (scans-persist.ts:82), so a leak requires a legacy/pre-guard row under the public org — which is precisely the case the two siblings were hardened against. That hardening was applied to two of three twin read functions, not the third.
- **Impact**: A private repo's diffed scores, evidence, and roadmap can be served to an anonymous viewer from the shared public org — a cross-tenant data disclosure (defense-in-depth bypass).
- **Fix sketch**: After loading `repo`, add the identical guard: `if (orgSlug === DEFAULT_ORG_SLUG && repo.isPrivate) return null;` — making all three public-org readers behave uniformly.

## 2. Sha-less scans have no cross-instance dedup — duplicate metered Scan rows + double billing
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: race-condition
- **File**: src/lib/db/scans-persist.ts:172-182, 350-364
- **Value**: impact 6 · effort 4 · risk 3
- **Scenario**: A report with no resolvable `headSha` (head resolution failed, a reconstructed snapshot) is persisted concurrently on two serverless instances. The process-local `withRepoLock` doesn't span instances, so both pass the `findScanByScannedAt` dedup, both `scan.create`. There is no `@@unique` to catch them: the commit-dedup unique index is on `(repoId, headSha)` and Postgres treats NULL `headSha` as distinct, so neither insert collides. The P2002 backstop is also gated on `headSha` being truthy (`if (headSha && isUniqueConstraintError(err))`, line 356), so for a sha-less scan it never fires. Result: two duplicate Scan rows.
- **Root cause**: Dedup for sha-less scans rests entirely on a process-local lock plus a high-precision timestamp-equality read; the comment at scans-read.ts:62 acknowledges the timestamp key is "inherently fragile," but the cross-instance duplicate-insert path has no DB-level guard at all (unlike the sha case).
- **Impact**: A duplicated metered Scan persists a second usage-based charge for one computed report (money error) and injects a duplicate point into history/trend/comparison reads.
- **Fix sketch**: Persist a stable content/idempotency key (e.g. a hash of repo+scannedAt+overallScore) in a `@@unique` column and treat its P2002 as a dedup the same way the headSha race is handled, so sha-less duplicates collapse cross-instance.

## 3. Read queries use a bare scannedAt order — non-deterministic "latest" on a timestamp tie
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case (state-consistency)
- **File**: src/lib/db/scans-read.ts:42, 125, 235, 393, 485, 559, 675
- **Value**: impact 5 · effort 2 · risk 2
- **Scenario**: Two scans of one repo share a `scannedAt` (two re-scores in the same instant, or a same-timestamp re-test). Every read here orders by a bare `orderBy: { scannedAt: "desc" }`, so `findFirst`/the head of `findMany` resolves to an ARBITRARY one of the tied rows — and different queries can pick differently. `getScanReportByCommit` (675) may render one row as "latest" while `getLatestRecommendations` (559) returns the other's recommendations, and `getRepositoryHistory` (235) / `getScanComparison` (393) can flip the order of the tied pair between requests (jittery trend line, picker order swaps).
- **Root cause**: The persist path explicitly fixed this for its "previous" read with `orderBy: [{ scannedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }]` (scans-persist.ts:197, with a comment that bare scannedAt "resolved 'previous' to an ARBITRARY row on a tie"), but the same fix was never propagated to the read-side queries.
- **Impact**: Inconsistent/unstable "latest" snapshot across the report, recommendations, history, and comparison surfaces — confusing UX and a potential data mismatch between two panels of the same page.
- **Fix sketch**: Apply the same `[{ scannedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }]` tiebreaker to all latest/history reads (a shared `SCAN_ORDER` const next to `HISTORY_POINT_SELECT`).

## 4. getScanComparison takes an unclamped, unvalidated limit (its sibling clamps it)
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/lib/db/scans-read.ts:381 (vs the guarded sibling at 215-218)
- **Value**: impact 4 · effort 2 · risk 2
- **Scenario**: `getScanComparison` is exported through the `@/lib/db` barrel. `const limit = opts.limit ?? 60;` is passed straight to Prisma `take` (line 393) with no clamp. A NEGATIVE limit makes Prisma return rows from the OTHER end, so `scans` becomes oldest-first; then `afterId` defaults to `scans[0]` (line 407) — now the OLDEST scan — and the diff targets the wrong scan. `NaN` and an unbounded huge limit are also unhandled (a cheap heavy query). The current caller hardcodes `limit: 60` (report/compare/page.tsx:91), so it's latent today, but the public sibling `getRepositoryHistory` documents and guards this exact hazard with `Math.max(1, Math.min(200, Math.trunc(opts.limit ?? 30) || 30))` (lines 215-218).
- **Root cause**: Two near-identical readers diverged — the limit-sanitization that `getRepositoryHistory` got was not mirrored onto `getScanComparison`.
- **Impact**: A future/alternate caller passing a negative/NaN/huge limit gets a wrong comparison target or a heavy scan — a latent correctness + DoS-shaped gap.
- **Fix sketch**: Reuse the same clamp expression `Math.max(1, Math.min(200, Math.trunc(opts.limit ?? 60) || 60))`.

## 5. Comparison silently reverses direction when the requested "after" is the oldest scan
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/lib/db/scans-read.ts:409
- **Value**: impact 3 · effort 3 · risk 2
- **Scenario**: A user deep-links a compare URL whose `afterId` is the repo's OLDEST scan. `scans[afterIdx + 1]` is undefined, so `defaultBeforeId` falls back to `scans.find((s) => s.id !== afterId)?.id` — which returns `scans[0]`, the NEWEST scan. The diff then renders the newest scan as the "before" baseline and the oldest as the "after" target, so every delta reads backward in time (a real improvement shows as a regression and vice-versa) with no indication the axis flipped.
- **Root cause**: The `before` fallback only guarantees "some other scan," not "a scan older than `after`."
- **Impact**: Misleading "what changed" deltas for the (rare) oldest-as-target selection; confusion, no data loss.
- **Fix sketch**: When no older scan exists, set `before = null` (the page already handles `!comparison.before` gracefully) rather than reaching forward to a newer scan, so the diff never inverts its time axis.
