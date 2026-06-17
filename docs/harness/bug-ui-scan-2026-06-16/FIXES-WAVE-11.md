# Bug-UI Fix Wave 11 — UI States & Consistency (final wave)

> 1 atomic commit, 2 findings closed (1 high, 1 medium) + 1 found already-mitigated.
> Baseline preserved: `tsc` 0 → 0 errors · tests 509/509 → 509/509 (markup/state changes).

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|--------|-----------------|----------|-------|
| 1 | `eb5dd9f` fix(ui): true posture distribution + recover the scan form from bfcache | live-war-room #2, scan-pipeline #3 | High + Medium | `LiveWarRoomPanels.tsx`, `ScanForm.tsx` |

## What was fixed

1. **War-room posture bars misrepresented the distribution (High).** `PostureMix` scaled each posture bar to the *largest* bucket, so the leading posture always rendered as a full 100% bar regardless of its real share — on a projected war-room wall that overstates the dominant posture's prevalence to leadership. Bars now scale to the total scored fleet, so each is that posture's true fraction (clamped at 100%).
2. **Scan form stuck disabled after back-navigation (Medium).** `ScanForm.submit()` sets the submitting flag then navigates to `/report`; on BACK the browser restores the page from bfcache with the flag still true, leaving the form permanently disabled. A `pageshow.persisted` listener now resets it so the form is usable again.

## Already-mitigated (already-existed catch, Phase 4.1d)

- **Connect empty-filter dead-end (connect #4, Medium).** The report flagged the filter bar as dropped in the zero-results state — but `RepoFilterBar` renders *above* the `filtered.length === 0` conditional, so it's never removed; the user can always clear the filter. **No change needed.**

## Verification

| | Before wave | After wave |
|---|---|---|
| `tsc --noEmit` errors | 0 | 0 |
| Tests | 509/509 | 509/509 |

## Patterns established (catalogue item 24)

24. **A "share" bar must divide by the whole, not the max.** Scaling each bar to `max(buckets)` makes the largest category always read as 100% and misrepresents a distribution as "one category dominates." Divide by the total (sum / population) so bar length is the true proportion.

## Deferred (diffuse UI polish)

The remaining W11 findings are Medium/Low and subjective/cosmetic: skeleton→report `max-w` layout shift, projection-mode tile scaling for a wall, uneven empty-state coverage across sibling pages, missing Export CSV on one of three tabs. Real polish, but no correctness or data-integrity impact; left for a focused UI pass.

## Run complete

This was the last of the 11 themed waves. See `CUMULATIVE-STATUS.md` for the full run scorecard.
