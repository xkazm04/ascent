# Connect & Repo Selection — bug-hunter + ui-perfectionist scan
> Total: 5 (Critical: 0, High: 2, Medium: 2, Low: 1)
> Lens split: bug-hunter 2 / ui-perfectionist 3
> Files read: 7

## 1. Per-row toggles race the bulk-op rollback (no disabling during `bulkBusy`)
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: Race condition / optimistic-update clobber
- **File**: src/components/connect/InstallationRepos.tsx:245-277 (and RepoRow checkbox at :441-451)
- **Scenario**: User clicks "Watch all (N)". While the bulk POST is in flight, they also flip a *specific* repo's per-row watch checkbox (or its schedule select) — the row controls stay enabled because only the bulk buttons honor `bulkBusy`. The bulk request then fails (`!res.ok`/network), and the catch path runs `targets.forEach((r) => patch(r.fullName, { watched: false }))`.
- **Root cause**: The rollback unconditionally forces every `targets` row back to `watched:false` using the closed-over `targets` array, with no reconciliation against intervening user edits. The per-row `toggleWatch`/`changeSchedule` and the `RepoRow` checkbox/select are never disabled while `bulkBusy` is true. Two optimistic writers mutate the same rows with no coordination.
- **Impact**: A repo the user *deliberately* just turned on (or whose schedule they changed) silently flips back off after the unrelated bulk failure — success theater in reverse, and the most damaging kind: a watched repo silently stops being scanned with no error attributed to that row.
- **Fix sketch**: Disable the per-row `watch` checkbox and schedule `<select>` (pass a `disabled={bulkBusy}` prop into `RepoRow`) while a bulk op runs; or have the bulk rollback re-read current state via the functional `setView` updater and only revert rows still matching the optimistically-set value instead of forcing `false`.

## 2. Bulk watch shows a green "Now watching N repos" even when every individual repo failed
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: Missing error handling on partial-failure path
- **File**: src/components/connect/InstallationRepos.tsx:261-270
- **Scenario**: `/api/org/watch` returns HTTP 200 but `d.failed` lists every target (e.g. all rows hit a downstream GitHub/DB write error server-side). `res.ok` is true, so the success branch runs.
- **Root cause**: The note text is computed as `ok = targets.length - failed.length` and rendered as a `kind: "note"` (neutral/positive) message regardless of whether `ok` is 0. When `failed.length === targets.length`, `ok` is `0` and the user sees "Now watching 0 repos · N failed" styled as a *success* note (`text-slate-500`), not an error. The optimistic patches for failed rows are reverted (good), but the headline messaging contradicts the outcome.
- **Impact**: A fully-failed bulk watch is reported as a benign note. The user believes the action partly succeeded, leaves the page, and no repo is actually watched — scans never run.
- **Fix sketch**: When `ok === 0` (or `failed.length === targets.length`), emit `{ kind: "error", text: "Couldn't watch any repos — N failed. Try again." }`; only use the neutral note when `ok > 0`.

## 3. Per-row `watch` checkbox and `Scan` link are not distinguishable to assistive tech
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: Accessibility — ambiguous control labels in a repeated list
- **File**: src/components/connect/RepoRow.tsx:54-62, :79-84
- **Scenario**: A screen-reader user tabs down a 200-row list. Every watch checkbox announces only "watch", every schedule select announces "Autoscan schedule", and every "Scan" link announces "Scan" — none carry the repo name. The repo name (`r.fullName`) is visually adjacent but not programmatically associated with any control.
- **Root cause**: The `<label>` wraps the literal word "watch" with no repo context; `aria-label="Autoscan schedule"` (RepoRow.tsx:68) is identical on every row; the `Scan` `<Link>` has no `aria-label`. There is no `aria-label`/`aria-labelledby` tying any control to `r.fullName`.
- **Impact**: List-management by keyboard/SR is effectively unusable — you cannot tell which repo a control belongs to without rebuilding context from surrounding nodes.
- **Fix sketch**: Add `aria-label={`Watch ${r.fullName}`}` to the checkbox, `aria-label={`Autoscan schedule for ${r.fullName}`}` to the select, and `aria-label={`Scan ${r.fullName}`}` to the link (or wrap each row in a labelled group).

## 4. Empty-filter state drops the filter bar, trapping the user in a zero-results view
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: Filter UX / empty-state recovery
- **File**: src/components/connect/InstallationRepos.tsx:437-454
- **Scenario**: User types a query (or toggles `watched`) that matches nothing. The list area swaps to `<EmptyState body="No repositories match your search and filters." />`. The `RepoFilterBar` itself is *above* this block (:425-435) and stays mounted — good — but the empty state offers no "Clear filters" affordance and the bulk action bar above still reads "Watch all (0)".
- **Root cause**: The zero-match `EmptyState` has no `actions`, so recovery depends on the user manually finding and clearing each of the four filter controls (query, visibility, watched, language). For a combined filter (e.g. `watched` + a language with no overlap) the cause of zero results is non-obvious.
- **Impact**: Dead-end feel on a core onboarding screen; users may conclude the install has no repos when it's just an over-narrow filter.
- **Fix sketch**: Add a "Clear filters" action to the no-match `EmptyState` that resets `query/visibility/watchedOnly/language`, and consider echoing the active filter summary in the body copy.

## 5. Loading skeleton omits the filter/bulk bars, causing a layout shift on data arrival
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: Visual consistency / CLS on load
- **File**: src/components/connect/RepoListSkeleton.tsx:3-25 (rendered at InstallationRepos.tsx:310)
- **Scenario**: During load only six skeleton rows + a 40px header bar render. When the fetch resolves, the watched-count line, credit strip, bulk-action bar, and the full `RepoFilterBar` all snap in above the list at once, pushing the rows down.
- **Root cause**: The skeleton mirrors only the row list and a single header line; it does not reserve space for the filter bar or bulk-actions row that the loaded view always renders.
- **Impact**: Visible content jump / cumulative layout shift on every load of the Connect page — the first impression of the onboarding flow.
- **Fix sketch**: Add placeholder blocks to `RepoListSkeleton` approximating the bulk-action row and the search/filter bar heights so the loaded layout settles in place.
