# Code Refactor — Fix Waves 8 & 9: Medium tail (COMPLETE)

> 19 commits, 19 Medium findings closed. Baseline: tsc 0→0 · tests 2610 (unchanged
> total; a few audit-helper test mocks re-pointed, no assertions weakened).

## Wave 8 — remaining dead-code Mediums (9 commits, pure subtraction)

`5df4dd4` stale `isUnlimitedPlan` re-export · `57705ba` unread `__ascentPglite` global ·
`a5ff60e` write-only `LocEntry.raw` · `e5190da` dead `teamOrgName` (+ test narrowed) ·
`b31c1da` dead `SimMetric` type · `54a5959` `RepoStar.name`/`.private` write-only (+ 3 shape assertions) ·
`c36d301` dead `Celebration.level` · `dff0b6a` dead `ArtifactSpec.title` ·
`8128502` `segById` Map built only for `.size` → `segments.length`.

(Four other dead-code Mediums — `MatrixRow.short`, `levelHex`, `advanceSchedule`, `updateRecommendationStatus` — were already removed in Wave 1.)

## Wave 9 — high-value duplication Mediums (10 commits, backend/scoring/billing)

| Commit | What was consolidated | Drift corrected |
|---|---|---|
| `9a52913` | `src/lib/env.ts` `envBool()`; routed authBypass, openOrgDashboards, publicScanQuotaDisabled, plan/credit-grant gates, proxy bypass | (llm/config left — different trim/lowercase truthy set) |
| `6212422` | `fetchWithTimeout` in `host.ts`; source/governance/graphql routed through it | — |
| `4efe043` | pure `windowState()`; `peekPublicScanQuota` + `decideQuota` share it (peek now tested) | — |
| `5318953` | `bucketContext()` quota key; consume/peek/refund derive one identical key | — |
| `9c29a61` | `HISTORY_POINT_SELECT`/`historyPointFrom` at module scope; `getScanComparison` folded on | ✔ comparison now uses the `?? []` dimensions fallback |
| `275b1a6` | `effectiveFloor`/`failsFloor` in gate.ts; gate-comment table + governance green-path routed | ✔ gate-comment now fail-closed via `failsFloor` (kept governance plain `<` by design — avoids NaN-poisoning the green-path total) |
| `6d35087` | memoized `aiStandard` on `RepoIndex` — runs once, not twice per scan | — |
| `d33b872` | `roundedMean`/`mean` in org-shared; 5 copies routed | ✔ `computeWindowDeltas`'s unguarded empty-array copy |
| `3938220` | `recordOrgAudit` helper; members POST/DELETE routed (resolve-org + audit-on-success) | — |
| `c98a9dc` | `resolvePlaybookOrg` in `src/lib/org/playbook-gate.ts`; all 3 per-row playbook routes routed | — |

Tests touched (legitimate — audit now flows through `recordOrgAudit`): members + playbooks `[id]`/apply route tests re-point the mock from `recordAudit`+`getOrgId` to `recordOrgAudit` (call-count only; no assertion weakened).

## Patterns established (catalogue items 9–10)

9. **`x === "1" || x === "true"` env-flag sprawl** — the truthy-env idiom copied across ~10 modules with no shared `envBool`. Consolidate, but watch for a *different* truthy set (e.g. a module that trims/lowercases) and leave those — unifying them would change parsing.
10. **Quota/window math split from its tested core** — a `peek` re-implements the rolling-window trim that the unit-tested `decide` owns. Routing peek through the pure core both dedups AND pulls the untested path under the existing tests.
