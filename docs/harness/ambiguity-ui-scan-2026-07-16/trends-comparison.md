# Trends & Comparison — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

## 1. Swap button can never produce the swapped comparison — server guard silently rewrites every swap
- **Severity**: High
- **Category**: edge-case-gap
- **File**: `src/components/report/ScanComparePicker.tsx:69` (with `src/lib/db/scans-read.ts:470-480` and `src/lib/report/compare.ts:207-210`)
- **Scenario**: The picker's ⇄ button ("Swap baseline and compared scans") navigates to `?a=<oldBefore>&b=<oldAfter>`. But by definition a swap makes the requested `beforeId` NEWER than the requested `afterId`, and `getScanComparison` honors an explicit `beforeId` only when `beforeIdx > afterIdx` (i.e. strictly older). Every swap is therefore rejected server-side and silently replaced with `defaultBeforeId` — the scan immediately older than the old baseline. Clicking Swap on (before=Jan 1, after=Feb 1) yields a diff of Jan 1 vs whatever preceded Jan 1, not Feb 1 → Jan 1.
- **Root cause**: Two modules record contradictory design intents: `compare.ts:209` documents "Passing an older scan as `after` is valid — the deltas simply read as regressions", while `scans-read.ts` (scan-persistence-history #7) treats a time-inverted pair as a hazard and reverts it. The UI kept the swap affordance built for the first contract after the second was added.
- **Impact**: A first-class labeled control never does what it says; the user gets a plausible-looking but wrong diff (wrong baseline, wrong deltas) with no error, and the dropdowns quietly re-seat to the rewritten pair — easy to read numbers off the wrong comparison in a QBR.
- **Fix sketch**: Decide which contract wins. Either (a) drop the ⇄ button and the "regressions are valid" doc line, or (b) let an explicit, both-ids-valid pair through in either order (the diff engine already handles inversion correctly and `WhatChanged` renders negative deltas fine), keeping the guard only for the *default* baseline resolution. Add a picker/page notice whenever the server substituted a different pair than the URL requested (see #2).

## 2. Requested scan ids outside the newest-60 window are silently swapped for defaults
- **Severity**: Medium
- **Category**: undocumented-assumption
- **File**: `src/app/report/compare/page.tsx:80-85` (with `src/lib/db/scans-read.ts:461-462`)
- **Scenario**: The compare page fetches `limit: 60` scans and `getScanComparison` honors `?a`/`?b` "only when they belong to this repo's scan set" — meaning the newest 60 rows. A shared/bookmarked compare URL whose scan has aged past the 60th slot (retention keeps 200), or whose id is stale/mistyped, renders a *different* comparison (latest vs its predecessor) with zero indication that the request was not honored.
- **Root cause**: Id resolution conflates "id not in the fetched window" with "id doesn't belong to this repo", and the resolution result (honored vs defaulted) is never surfaced to the page.
- **Impact**: Shareable-URL contract quietly breaks over time: the link a user saved as evidence of a specific before/after later shows different numbers under the same URL. Undermines the exact audit/permalink story the rest of the module works hard for (pinned report permalinks, CSV SHA-256).
- **Fix sketch**: Return a flag (or the unresolved ids) from `getScanComparison` when a requested id was not honored, and render a dismissible notice ("Scan `abc1234` is no longer in the comparison window — showing the latest diff instead"). Optionally look up an explicitly requested id directly by `(repoId, id)` instead of only within the `take: limit` window, since retention holds 200.

## 3. `unchanged` verdict ignores dimensions present on only one side — "No measurable change" above a visible "— → 70" card
- **Severity**: Medium
- **Category**: edge-case-gap
- **File**: `src/lib/report/compare.ts:301-309` (rendered at `src/components/report/WhatChanged.tsx:50-53`)
- **Scenario**: When a dimension exists in only one scan (added to the model after the baseline, or dropped), its `delta` is `null` — correctly no invented number. But `unchanged` computes `dimensions.every((d) => (d.delta ?? 0) === 0)`, coercing `null` to 0, and gap/signal counters only accumulate when *both* sides scored the dimension. If overall/level/posture happen to hold steady, the headline says "No measurable change between these two scans" while the By-dimension list below renders a `— → 70` card with its gaps. `buildAttribution` also returns `null` for one-sided dims, so the appearance never reaches "Why it moved" either.
- **Root cause**: The no-invented-deltas rule (good) leaks into the change-detection predicate: "we can't quantify it" was treated as "nothing changed".
- **Impact**: Contradictory UI after any dimension-model migration (exactly when users re-scan to see what the new dimension says): the summary lies relative to the detail below it, eroding trust in the diff's other claims.
- **Fix sketch**: Track `appearedDims`/`droppedDims` (before === null XOR after === null) in `diffScans`; include them in the `unchanged` predicate and emit an attribution line like "D9 added in the newer scan (70)" so the headline, movements list, and cards agree. Add a test: identical scans except one extra dimension → `unchanged === false`.

## 4. Same-day scans are indistinguishable in the picker — `scanCaption` has no unique component
- **Severity**: Medium
- **Category**: missing-state
- **File**: `src/components/report/WhatChangedParts.tsx:17-22` (used at `src/components/report/ScanComparePicker.tsx:61,88`)
- **Scenario**: The dropdown option label is `score · level · timeAgo · engine`. Two scans of the same repo hours apart with the same score (common: re-scan after a small PR, deterministic mock engine) render byte-identical options, e.g. `62 · L3 · 2 days ago · bedrock` twice. The user cannot tell which is which, and `timeAgo` buckets widen with age ("3 months ago" can cover many scans). The picker is the module's primary selection control, and the data needed to disambiguate (`headSha`, exact timestamp) is already on `HistoryPoint` and already shown in the trend-chart tooltip.
- **Root cause**: The caption was designed for the "What changed" headline (one scan per side, context obvious) and reused verbatim for a list control where uniqueness matters.
- **Impact**: Selecting a specific scan — the whole point of the picker — degrades to guesswork exactly when scan cadence is high; users comparing pre/post-deploy scans from the same day can't target them.
- **Fix sketch**: In the picker (keep the headline caption short), append the short sha when present and use an absolute short date+time instead of/alongside `timeAgo`: `62 · L3 · Jul 14 09:12 · bedrock · a1b2c3d`. Guarantee uniqueness by suffixing an index for exact-duplicate captions.

## 5. Header action-link trio duplicated across /trends and /report/compare with drifting focus styles
- **Severity**: Low
- **Category**: component-extraction
- **File**: `src/app/report/compare/page.tsx:124-135` (vs `src/app/trends/page.tsx:125-144`)
- **Scenario**: Both pages hand-roll the same header block (kicker + repo h1 + a row of bordered pill links: Trends/Compare/Full report/Export CSV) with the identical class string `rounded-lg border border-slate-700 px-3 py-1.5 text-base text-slate-300 hover:border-accent hover:text-white` — except the trends page adds the repo-wide `focus-ring` utility to all three links and the compare page omits it on both of its links. The Shell/Notice wrappers and the sign-in → no-repo → invalid-repo → no-DB guard cascade are likewise copy-pasted between the two pages (compare even rebuilds the shell from SiteHeader/SiteFooter instead of `ReportShell`).
- **Root cause**: The compare page was cloned from the trends page before `focus-ring` was applied there; no shared `HeaderActionLink`/`RepoPageHeader` component exists to keep them in lockstep.
- **Impact**: Keyboard users get the polished focus treatment on one page and the browser default on its sibling (inconsistent, and fragile — one added `outline-none` away from invisible focus); every future tweak to the pill style or guard cascade must be made twice and has already drifted once.
- **Fix sketch**: Extract a small `PillLink` (or `headerActionClass` constant including `focus-ring`) plus a `RepoPageHeader({ kicker, title, actions })` used by both pages; optionally fold the repeated sign-in/parse/DB guard cascade into a shared `resolveRepoPageGate()` helper both server components call.
