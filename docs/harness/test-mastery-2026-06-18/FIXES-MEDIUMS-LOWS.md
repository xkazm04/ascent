# Test Mastery — ascent — Medium + Low tiers

> After the 60 criticals + 76 Highs + 9 latent-bug fixes, the Medium and Low tiers were worked the same way.
> **39 of 40 Mediums + 14 of 16 Lows closed.** Suite continued to grow green; tsc 0; 0 regressions.
> The 3 not-closed are all the SAME finding type — "add a calibrated changed-code coverage gate" (onboarding / db / launch) — which needs a coverage-provider dependency + CI wiring (out of the test-only scope). See "Deferred" below.

## Mediums (5 waves M1–M5, 39 closed)

Each wave = 7–8 findings; subagents wrote + self-verified, orchestrator verified centrally + committed atomically. Highlights:

- **M1 (security/money):** `/api/report/skill` gate, `getActiveOrg` tampered-cookie rejection, null-vs-zero signal semantics, `consumeScanCredit` plan/casing, `safeFilenameSlug` + public-org day cap. **+2 source fixes**: `policyFromParams` 0-floor bypass (an always-pass gate via `?min_dimension=0` query param — the same class as latent bug #1, in the param path) and a **3rd CSV-injection surface** neutralized (`/api/audit`).
- **M2 (math/data-integrity):** sha-less dedup fallback, `dueBucketFor` boundaries, `toPersistedRec` adversarial (5000-deep / 20k / `__proto__`), `cheapestPathToNextLevel` greedy-stop + unreachable, `getRepoSegmentMap` inversion, `claimRescan` CAS + fairness, webhook replay TTL/eviction, the pure plan helpers.
- **M3 (frontend/derivations):** language→commands map, `briefingMarkdown` null branches, `getMembershipRole` misses, `priceForModel` longest-prefix, `diffScans` direction, `freshness`/`timeAgo`, **FleetMap derivations extracted** (`fleetMapDerive.ts`), PeriodSummary cohort-now.
- **M4 (money/runtime):** quota abuse counters, low-credits fires-once-on-crossing, `pruneAudit` loop-termination, simulate route NaN-reject, `makeCacheKey` casing/encoding, playbooks `[id]` gate, `fetchPullRequests` pagination, the PDF document score-band (real `renderToBuffer`).
- **M5 (frontend, final):** small-population success-theater guards, error-boundary digest/reset, `projectedPoints` ROI, **connect install-routing extracted** (403-avoidance), org-window precedence, **report taxonomy extracted** (history-status + abort/timeout), **recommendation rollback extracted** + timeline order.

## Lows (2 waves L1–L2, 14 closed)

- **L1:** EmptyState, `parseJsonLoose` cost guards, deterministic briefing dates, `dueLabel`/`eventValue`, **CopyForLlm clipboard extracted**, maintain.mjs numbering/slug, `withinRange` edges, recommendation-leverage formula + weights.
- **L2:** retention opt-in safety (orchestrator level), **PostureMix true-distribution extracted**, orgsim direction+exact-magnitude, `sse.ts` parseSSE/readSSE, the two chart empty/unknown fallbacks, and **a Playwright e2e for the watch-toggle rollback** (type-checks against real selectors/routes; runnable in CI — not run here).

## Component extractions this run (behavior-preserving)

The Medium/Low tiers added these to the earlier crit/high extractions: `fleetMapDerive`, `installRouting`, `reportTaxonomy`, `recommendationRowState`, `copy-for-llm.logic`, `liveWarRoomShared.postureBarPct`. Each was a verbatim move out of a `"use client"` component into a React-free module + re-import, validated by tsc + the full vitest suite. (Where a helper was module-private and a source edit wasn't warranted, the test pins the behavior against a verbatim mirror — noted in those commits.)

## Two more source fixes surfaced (M1) and applied

- `policyFromParams` now rejects a `<=0` `min_overall`/`min_dimension` (falls back to the archetype default) — closing a CI-gate bypass via query param.
- `/api/audit` CSV export now neutralizes formula injection (the 3rd surface, after `/api/history` and `/api/org/export` in the latent-bug pass).

## Deferred — the calibrated coverage gate (1 Medium + 2 Lows, same theme)

The findings `first-run-onboarding (M)`, `database-client-schema (L)`, and `launch-fleet-map (L)` all ask for a **changed-code / per-directory coverage gate** so new untested code can't ship. Implementing it requires: (a) a coverage provider dependency (`@vitest/coverage-v8`), (b) `coverage` thresholds in `vitest.config.js` (per-dir for `src/components/onboarding/`, `src/lib/db/`, `src/components/launch/`), and (c) a CI step. That touches deps + CI config (outside this test-only run's scope), so it is left as a **single recommended follow-up** rather than auto-applied. With the suite now at 2298 tests, a baseline coverage ratchet is low-friction to add.

## Status

**189 / 192 findings addressed** (60C + 76H + 39M + 14L), **9 latent bugs fixed**, plus the 3 CSV surfaces + the `policyFromParams` bypass. The 3 open are the single coverage-gate recommendation above. Suite **509 → 2298 (+1789)**, tsc 0, 0 regressions.
