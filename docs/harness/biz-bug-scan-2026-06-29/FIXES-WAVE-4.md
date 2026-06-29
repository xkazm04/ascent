# Biz+Bug Fix Wave 4 — Remaining Reliability Highs + Safe Growth Quick-Win

> 3 commits, 3 findings closed (2 High + 1 High-value biz quick-win).
> Baseline preserved: tsc 0 → 0; vitest 2635 pass / 1 pre-existing env-fail → unchanged.

## Commits

| # | Commit | Finding | Sev | File |
|---|---|---|---|---|
| 1 | `950aad6` | leaderboard missing from sitemap | High (biz quick-win) | `sitemap.ts` |
| 2 | `e48befc` | unbounded self-attested conformance score | **High** | `report/conformance/route.ts` |
| 3 | `23d07bf` | ScanModal locks members out on viewer error | **High** | `landing/.../ScanModal.tsx` |

## What was fixed

1. **Leaderboard in sitemap (safe biz quick-win).** The public AI-native leaderboard — ascent's prime
   viral/SEO surface — was reachable only by following links. Added to `sitemap.ts` (it's public and not
   robots-blocked; the `seo.test` sitemap/robots-disjoint invariant still holds). Zero-risk growth win.
2. **Conformance score bound (High).** `/api/report/conformance` validated types but not ranges, so an
   org/CI-token-authed-but-untrusted reporter could persist `score=999999` (or negative) and poison the
   Repository row + every dashboard aggregate. Clamp score to 0–100 and fails/warns to non-negative
   counts before `recordConformance`.
3. **ScanModal lockout (High).** The gate did `setSignedIn(false)` on any `/api/auth/viewer` error (and
   a non-ok response), caching "signed out" for the page lifetime — a transient blip walled a real
   signed-in member off the hero's primary scan CTA. The gate is UX-only (the scan endpoint enforces the
   wall server-side), so it now fails OPEN to the form on a check failure.

## Deferred to a follow-up session (with cause)

- **Push-rescan throttle (High, `app/webhook/route.ts:319`).** A watched repo's every default-branch
  push runs a full LLM-billed scan with no per-repo debounce — a push storm = unbounded paid scans.
  A correct fix needs a per-repo cooldown keyed on the latest scan's timestamp (or a shared store, since
  the in-memory limiter is per-instance) and sits on the signature-verified webhook hot path; worth its
  own focused change rather than a rushed guess. (Same-commit pushes already dedup via `persistScanReport`.)
- **DimensionTrends stale-repo race (Medium, `DimensionTrends.tsx:35`).** `loadDimensions` has no
  abort/active guard, so a slow response for repo A can paint under repo B. Needs an AbortController /
  latest-repo ref threaded through the useCallback + its effect; deferred to a focused races wave.

## Patterns established (catalogue items 10–11)

10. **UX gate that caches a hard deny on a soft failure** — a client gate fronting a server-enforced
    wall must FAIL OPEN on its own check error, never cache "denied"; otherwise a transient blip locks
    out legitimate users while the server would have let them through.
11. **Self-attested telemetry persisted unbounded** — an authed-but-untrusted ingest (CI token, org
    owner) must range-bound every value it stores; type-validation alone lets one bad reporter poison
    every downstream aggregate.

## What remains

The Medium/Low tail across both lenses, plus the deferred Highs above and the DSQL read-path `withDb`
migration. The 90-item business track stays a curated backlog for product/pricing decisions.
