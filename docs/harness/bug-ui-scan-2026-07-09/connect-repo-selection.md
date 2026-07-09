# Connect & Repo Selection — bug-hunter + ui-perfectionist scan

> Context: Connect & Repo Selection (group: Onboarding, Shell & AI Standard)
> Files scanned: 10
> Total: 7 findings (Critical: 0, High: 1, Medium: 5, Low: 1)

## 1. Long repo names overflow the row instead of truncating (missing min-w-0)
- **Severity**: High
- **Lens**: ui-perfectionist
- **Category**: responsive-overflow
- **File**: src/components/connect/RepoRow.tsx:42
- **Scenario**: A private org with names like `acme-platform/internal-billing-reconciliation-service` renders in the list. The name span has `truncate` but sits in an inner `flex items-center gap-2` (line 42) that has no `min-w-0`, and the span itself has no `min-w-0`.
- **Root cause**: `truncate` (`white-space:nowrap`) on a flex item does nothing without `min-w-0` — a flex child's default `min-width:auto` refuses to shrink below its content width, so the ellipsis never engages. The outer `min-w-0 flex-1` (line 41) doesn't propagate to the inner flex row.
- **Impact**: On the core repo-selection screen, long names push the `private`/level badges off-screen and force the watch/schedule/Scan controls to wrap awkwardly (outer row is `flex-wrap`). Affects every user with typical long private-repo names.
- **Fix sketch**: Add `min-w-0` to the inner flex row (line 42) and to the name span (line 43): `className="min-w-0 truncate font-mono ..."`.

## 2. Skeleton omits the filter/bulk/credit bars → large layout jump on load
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: loading-state
- **File**: src/components/connect/RepoListSkeleton.tsx:3
- **Scenario**: While `/api/app/repos` is in flight, `InstallationRepos.tsx:46` renders only `<RepoListSkeleton>` — one placeholder bar + six rows. When data lands, the loaded view inserts a header row ("N of M watched" + Org dashboard link), `CreditCostStrip`, `BulkActionsBar`, and `RepoFilterBar` ABOVE the list (InstallationRepos.tsx:71–112).
- **Root cause**: The skeleton's own comment claims "keeps a stable height... no snap-in layout shift," but it models only the list, not the ~3 always-present control rows above it.
- **Impact**: The repo list visibly jumps down several rows the instant data arrives — the exact CLS the skeleton was meant to prevent, on the primary funnel screen.
- **Fix sketch**: Add skeleton placeholders for the header row + filter bar + bulk bar above the list block so the skeleton's vertical footprint matches the loaded layout.

## 3. Loading state is invisible to screen readers (aria-hidden skeleton, no status)
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: accessibility
- **File**: src/components/connect/RepoListSkeleton.tsx:9
- **Scenario**: A screen-reader user reaches "Repositories for <org>", then the skeleton renders with `aria-hidden` and no live region. Nothing is announced during the fetch; rows then appear silently.
- **Root cause**: The panel has an announced error state (`role="alert"`, InstallationRepos.tsx:49) but no `aria-busy`/`role="status"` for the loading state, so assistive tech gets dead air followed by an unannounced content swap.
- **Impact**: Blind/low-vision users can't tell the panel is loading vs. empty vs. stalled on the key onboarding screen.
- **Fix sketch**: Wrap the skeleton in `role="status" aria-busy="true"` with an SR-only "Loading repositories…" label (keep the visual bars `aria-hidden`).

## 4. Visibility filter buttons lack pressed/group semantics
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: accessibility
- **File**: src/components/connect/RepoFilterBar.tsx:42
- **Scenario**: The all/public/private buttons (lines 42–46) convey the active choice only through the `chip()` color/border classes. The adjacent "watched" toggle correctly sets `aria-pressed` (line 47), but the three visibility toggles set nothing.
- **Root cause**: Toggle state is expressed purely visually; there's no `aria-pressed` and no grouping label/role, so the selected filter isn't programmatically exposed.
- **Impact**: Screen-reader users can't perceive which visibility filter is active — a WCAG 4.1.2 state gap on a filter that changes what repos they can act on.
- **Fix sketch**: Add `aria-pressed={visibility === v}` to each button (line 43) and wrap the three in a labelled group (`role="group" aria-label="Filter by visibility"`), or model as a radiogroup.

## 5. "Discovered" org chips all dead-link to generic /onboarding (org lost)
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: misleading-affordance
- **File**: src/components/connect/ConnectDiscovered.tsx:44
- **Scenario**: The panel lists each suggested org as a clickable chip showing its name (lines 43–51). Every chip's `href` is the literal `"/onboarding"` — the org name is rendered but never passed through.
- **Root cause**: The chips look like per-org actions ("scan acme"), but all resolve to the same generic onboarding page with no org context — a dead-end affordance.
- **Impact**: A user clicking "acme" expecting to scan acme lands on an empty generic page and must re-enter the org, eroding trust at the discovery step.
- **Fix sketch**: Carry the org into the link (`href={\`/onboarding?org=${encodeURIComponent(o)}\`}` or a public-scan deep link) and have onboarding prefill from it.

## 6. `outline-none` inputs/selects rely on a 1px border-color-only focus cue
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: accessibility
- **File**: src/components/connect/RepoFilterBar.tsx:39
- **Scenario**: The search input (line 39), language select (line 55), and the row schedule select (RepoRow.tsx:79) all use `outline-none focus:border-accent`, while nearby buttons/links use the `.focus-ring` utility.
- **Root cause**: Removing the native outline and replacing it with only a border-color swap yields a weak, inconsistent keyboard-focus indicator that may not meet contrast/visibility guidance.
- **Impact**: Keyboard users get a subtle, inconsistent focus signal across the filter/scan controls; minor but a real polish/a11y gap.
- **Fix sketch**: Apply the shared `.focus-ring` (or `focus-visible:ring-2 ring-accent`) to these inputs/selects instead of bare `focus:border-accent`.

## 7. Superseded watch toggle prematurely clears `watchPending`, reopening the schedule lock
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race-condition
- **File**: src/components/connect/RepoRow.tsx:77
- **Scenario**: User rapidly toggles a repo unwatch→watch. Two `/api/org/watch` POSTs are in flight (`useInstallationRepos.ts` `watchSeq`). If the older (seq-1) response resolves first, its `finally` deletes `watchPending[fullName]` (useInstallationRepos.ts:229–235) even though it `return`ed as superseded — while the newer watch POST is still pending. The schedule select (`disabled={... || watchPending}`, RepoRow.tsx:77) re-enables; the user picks "daily"; the newer watch POST then fails and rolls back to unwatched.
- **Root cause**: The `finally` clears the per-row pending flag unconditionally, assuming one in-flight watch per row; with overlapping toggles the flag is cleared by whichever POST resolves first, not by the one that owns the row — defeating the guard that exists precisely to stop scheduling an unconfirmed watch.
- **Impact**: Orphaned cadence: the row shows a schedule on a repo the server has as unwatched → cron never runs it (success theater), the exact failure the guard was built to prevent.
- **Fix sketch**: In the `finally`, only clear pending when `watchSeq.current[fullName] === seq` (the request still owns the row); leave it set for superseded responses. Also disable the RepoRow watch checkbox (line 64) while its own mutation is pending.
