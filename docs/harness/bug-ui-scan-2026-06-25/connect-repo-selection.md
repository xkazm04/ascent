# Connect & Repo Selection — Bug + UI Scan
> Context: Connect & Repo Selection (Onboarding, Shell & AI Standard)
> Total: 5 findings (0 critical, 0 high, 2 medium, 3 low)

## 1. Bulk "Schedule watched" has no per-repo reconciliation → schedule success theater
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/components/connect/InstallationRepos.tsx:286-314 (esp. 293, 300-307)
- **Value**: impact 6 · effort 3 · risk 3
- **Scenario**: User clicks "Schedule watched → daily". `scheduleWatched` optimistically patches every repo where `r.state?.watched` (optimistic view) to `scanSchedule: "daily"` (line 293), POSTs the no-`fullName` body, then reads only a scalar `updated` count. The server's `setWatchedSchedule` updates only repos that are *watched in the DB* and returns `updated` (route confirmed at src/app/api/org/schedule/route.ts:45-46). If the client's watched set is larger than the DB's — e.g. a per-row watch toggle is still in flight or silently failed/rolled back — `updated < watchedRepos.length`, yet every optimistically-watched row keeps showing "daily" and no row is reverted.
- **Root cause**: Unlike the sibling `watchAllFiltered`, which reconciles against a per-repo `failed[]` list via `summarizeBulkWatch`, the schedule path trusts a single aggregate count and applies the optimistic cadence to all rows regardless of how many the server actually saved.
- **Impact**: Rows display an autoscan cadence the server never persisted; those scheduled scans silently never run, with no inline error — the exact "success theater" class this codebase explicitly guards against elsewhere (watchState.ts:61-104).
- **Fix sketch**: Have `/api/org/schedule` return the affected fullNames (or compare `updated` to the optimistic target list) and revert/flag the un-updated rows; or only patch rows the server confirms. At minimum, when `updated < watchedRepos.length`, surface a partial-failure note and roll back the unconfirmed rows.

## 2. Schedule select is enabled on an optimistically-watched repo before the watch is persisted
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: state-corruption
- **File**: src/components/connect/RepoRow.tsx:69-74 (with InstallationRepos.tsx:197-235)
- **Value**: impact 5 · effort 2 · risk 2
- **Scenario**: User ticks "watch" on a repo. `toggleWatch` optimistically sets `watched:true` (InstallationRepos.tsx:199) and re-renders, which immediately enables the schedule `<select>` (`disabled={!st?.watched || bulkBusy}`, RepoRow.tsx:71). Within the in-flight window the user picks "daily"; `changeSchedule` POSTs `{org, fullName, schedule:"daily"}` (which calls `setRepoSchedule`) without checking that the watch POST succeeded. If the watch POST then fails and rolls back to `watched:false`, the repo is left with a persisted `scanSchedule:"daily"` but `watched:false` in the DB.
- **Root cause**: The schedule control's enabled-state is gated on the *optimistic* watch flag, not on a server-confirmed watch; watch and schedule are independent fire-and-forget mutations with no ordering guard.
- **Impact**: Orphaned schedule on an unwatched repo — the cron won't scan it (watched=false), but the row later renders a stale/greyed "daily" cadence, confusing the user about what will scan. State diverges from the user's actual intent.
- **Fix sketch**: Gate the schedule select on a server-confirmed watched flag (or disable it while a watch mutation for that row is pending), and/or have `changeSchedule` no-op when the row isn't confirmed watched.

## 3. Connect funnel checklist steps 2–3 are hardcoded incomplete even after the user watches/scans
- **Lens**: ui-perfectionist
- **Severity**: low
- **Category**: loading-state
- **File**: src/app/connect/page.tsx:126-138
- **Value**: impact 4 · effort 2 · risk 1
- **Scenario**: The `OnboardingChecklist` on the connect page passes `done: false` literally for "Pick repositories to watch" and "Run your first scan". Even after the user watches several repos (the watched count is computed right below in `InstallationRepos`) and runs scans, the checklist permanently shows only step 1 as done.
- **Root cause**: The page renders the funnel from static literals rather than deriving step-2 completion from the watch state it already has access to.
- **Impact**: A progress indicator that never reflects real progress reads as broken/misleading and undercuts the "two first-run halves feel like one flow" intent stated in the comment (line 124).
- **Fix sketch**: Derive step 2 `done` from whether any repo in the installation is watched (the session or the repos response already carries this), and consider deriving step 3 from scan history; or drop the static steps to avoid implying trackable progress.

## 4. Inconsistent error color tokens across the same panel
- **Lens**: ui-perfectionist
- **Severity**: low
- **Category**: visual-consistency
- **File**: src/components/connect/InstallationRepos.tsx:427 (vs 319 and RepoRow.tsx:114)
- **Value**: impact 3 · effort 1 · risk 1
- **Scenario**: Three error surfaces in the same feature use three different colors for the same semantic: the bulk message error uses `text-orange-300` (InstallationRepos.tsx:427), the panel-level fetch error uses `text-danger-soft` (line 319), and the per-row error uses `text-danger` (RepoRow.tsx:114).
- **Root cause**: Ad-hoc Tailwind color (`orange-300`) used instead of the design-system danger token chosen elsewhere.
- **Impact**: Error states look like different severities/classes within one screen, weakening the visual language and the user's ability to recognize "this failed".
- **Fix sketch**: Standardize on the `danger`/`danger-soft` token for all error text in this feature (replace `text-orange-300`).

## 5. Segment tag buttons hardcode hex colors and risk unreadable contrast on dark segment colors
- **Lens**: ui-perfectionist
- **Severity**: low
- **Category**: a11y
- **File**: src/components/connect/RepoRow.tsx:102-107
- **Value**: impact 4 · effort 2 · risk 2
- **Scenario**: A tagged segment chip sets inline `style={{ backgroundColor: s.color, color: "#04070e" }}` — near-black text on the user-chosen segment color. If a user picks a dark segment color, the label becomes effectively invisible (no contrast). The off-state also hardcodes `#334155`/`#94a3b8` instead of theme tokens.
- **Root cause**: Fixed foreground color assumes every segment color is light enough; no luminance check or token-based pairing.
- **Impact**: Failing/illegible chip labels for dark segment colors (WCAG contrast) and design-system drift (raw hex vs. slate tokens used everywhere else in the row).
- **Fix sketch**: Compute a readable foreground (light/dark) from the segment color's luminance, or pair each segment color with a stored contrasting text color; replace the off-state hex literals with the existing slate tokens.
