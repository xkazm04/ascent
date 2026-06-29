# Biz+Bug Fix Wave 3 — Report & Dashboard Data-Integrity

> 5 commits, 5 findings closed (2 High + 3 Medium). 1 Medium deferred (intentional behavior).
> Baseline preserved: tsc 0 → 0; vitest 2635 pass / 1 pre-existing env-fail → unchanged.

## Commits

| # | Commit | Finding | Sev | File |
|---|---|---|---|---|
| 1 | `597ba5e` | LevelBadge crashes trends on a drifted level | Med | `LevelBadge.tsx` |
| 2 | `51c0d16` | completion % deflated by dismissed items | Med | `RecommendationTracker.tsx` |
| 3 | `66de7ec` | transient DB error shown as 404 "never scanned" | Med | `report/pdf/route.ts` (+test) |
| 4 | `cc21614` | audit CSV truncation signs an incomplete file | **High** | `audit/route.ts` |
| 5 | `7321f44` | exec briefing "100% confidence" on a 2-scan forecast | **High** | `briefing.ts`, `portfolio.ts` |

## What was fixed

1. **LevelBadge crash.** `LEVEL_CLASSES[id].border` with no fallback white-screened the trends page on a
   drifted/empty persisted level. Falls back to L1 (+ glyph guard).
2. **Completion %.** `done/total` counted dismissed items in the denominator, capping the ring below
   100% forever. Now `done/(total − dismissed)`.
3. **PDF 404 vs 503.** `.catch(() => null)` collapsed a transient lookup error into the unscanned-repo
   404 ("Scan it first"), wasting a scan and masking incidents. Errors now 503; only resolved-null 404s.
4. **Audit CSV truncation (High).** The export capped at 10k rows (newest-first → drops oldest evidence)
   and signed the bytes, so a partial file read as complete compliance evidence with a valid hash. Now
   flagged: `x-ascent-truncated` header, `-PARTIAL` filename, row-count/cap headers, server warning.
5. **Forecast confidence (High).** A <3-scan OLS fit is 100% by construction; `forecast.ts` sets
   `lowData` and warns NOT to show it as confidence, but the briefing + portfolio rollup ignored it.
   Confidence is now suppressed on low data (sibling `portfolio.ts` fixed too).

## Deferred (with cause)

- **`recsMovedToDone` counts a born-done recommendation (Medium, `compare.ts:282`).** The code comment
  (`compare.ts:277`) shows including a brand-new already-done rec is an **intentional** design choice,
  and `compare.test.ts` pins it. Whether "moved to done" should include born-done items is a product
  decision (it feeds the "value realized" narrative + a completion-email trigger), not a clear bug —
  left for a product call rather than silently reversing an intentional, tested decision.

## Patterns established (catalogue items 7–9)

7. **DB-string cast to a union, then indexed without a fallback** — `record[x as UnionId].field` crashes
   the whole render on one drifted row. Always `record[id] ?? DEFAULT` when `id` originates from
   persisted/untrusted data, even when the type says it's a known union.
8. **Signed/hashed partial output** — capping a stream and then signing it certifies the truncation as
   authentic-and-complete. Always emit a truncation flag alongside the integrity hash.
9. **Perfect-by-construction metric** — a fit/score that is trivially maximal on tiny N (R²=1 on 2
   points) must be gated on a sample-size flag before it's shown as confidence; the producer flagged it,
   the consumer must honor the flag.

## What remains

Wave 4 (remaining reliability Highs + safe biz quick-wins), then the Medium/Low tail. The DSQL
read-path `withDb` migration (High, many call sites) is deferred to its own focused session.
