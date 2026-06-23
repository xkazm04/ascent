# Code Refactor — First-Run Onboarding Wizard
> Context group: Onboarding, Shell & AI Standard
> Total: 3 findings (Critical: 0, High: 1, Medium: 1, Low: 1)

The onboarding files are clean on the cleanup axis — no stray `console.log`, no commented-out
code, no TODO/FIXME markers, and every exported component/helper/type in scope is referenced
(verified via repo-wide grep, including the cross-page `OnboardingChecklist`/`ChecklistStep` reuse
in `src/app/connect/page.tsx` and the `OrgCredit` type imported by `canRunReal.ts`). The three
findings below are real duplication / dead-field issues.

## 1. Onboarding hand-rolls a third copy of the shared SSE drain+parse loop
- **Severity**: High
- **Category**: duplication
- **File**: src/components/onboarding/importScan.ts:79-119
- **Scenario**: `runImportScan` reads the `/api/org/import` response body with its own
  `getReader()` + `TextDecoder` + `buffer.indexOf("\n\n")` framing loop and an inline per-frame
  parser (`event:` / `data:` line scan + `JSON.parse`, lines 90-105). The repo already ships a
  shared, tested implementation of exactly this — `readSSE` + `parseSSE` in `src/lib/sse.ts` — used
  by five other stream consumers (`OrgScanButton`, `RepoRescanButton`, `SegmentActions`,
  `LiveWarRoom`, `FleetMap`). A third near-identical copy lives inside `ReportClient.tsx`. The
  divergence is already documented: `src/components/report/parseSSE.test.ts:5-8` calls out "the
  inline parser in onboarding `runImportScan`" by name as a distinct, separately-behaving copy.
- **Root cause**: `importScan.ts` predates (or was written in parallel with) the extraction of the
  shared `lib/sse.ts` helper, and its extra responsibility — the stall watchdog that re-arms
  `armStall()` on every chunk (lines 49-55, 85) — made it feel un-extractable, so the whole loop was
  left hand-rolled rather than reusing the shared frame splitter.
- **Impact**: Three copies of SSE framing means a fix made once (e.g. the report copy's CRLF
  tolerance via `/\r?\n\r?\n/` and its trailing-frame-without-blank-line flush) silently does NOT
  reach onboarding — onboarding still splits on a literal `"\n\n"` and never flushes a trailing
  frame, so a server that closes the stream right after the terminal `result` frame without a final
  blank line would be dropped here. Maintenance cost and a latent correctness drift across copies.
- **Fix sketch**: The behavior-preserving consolidation is the inner per-frame parse: replace the
  hand-rolled `event`/`dataStr` line loop (lines 91-105) with a call to `parseSSE(block)` from
  `@/lib/sse`, mapping `msg.event`/`msg.data` into the existing `onRepo`/`onResult`/`onError`
  dispatch. This removes the duplicated parse without touching the stall watchdog. The outer
  read loop can ALSO move onto `readSSE`, but that is NOT a drop-in: `readSSE` owns the reader and
  exposes no per-chunk hook, so the `armStall()` re-arm on every chunk would be lost — to keep that,
  either (a) leave the outer loop but call `parseSSE` per frame (smallest safe change), or (b) extend
  `readSSE` with an optional `onChunk`/keepalive callback and migrate all six callers together
  (larger, separate refactor). Recommend (a) here.

## 2. "Sort by prominence, take top N, set selection" repeated three times
- **Severity**: Medium
- **Category**: duplication
- **File**: src/components/onboarding/OnboardingFlow.tsx:175-176, 228, 250-253
- **Scenario**: The same derivation — sort repos by `byProminence`, take the first `MAX_SELECT`, and
  seed `selected` from their `fullName`s — is written three times: in `loadRepos`
  (`const top = [...list].sort(byProminence).slice(0, MAX_SELECT); setSelected(new Set(top.map((r) => r.fullName)))`),
  in `loadInstallationRepos` (line 228, on the already-sorted+sliced `list`), and in `selectTop`
  (lines 250-253). They are subtly inconsistent: `loadRepos`/`selectTop` re-sort then slice; the
  installation path relies on the list already being sorted/sliced and just takes `slice(0, MAX_SELECT)`.
- **Root cause**: Each phase entry point grew its own top-N seed independently as the pick/select/
  resume flows were added, and `selectTop` was extracted only as a button handler — not as the
  single source of the "default selection" rule.
- **Impact**: Low bug-risk today but real drift surface: a future change to the preselect rule (e.g.
  exclude archived repos, or change the cap) must be made in three places or the initial selection
  and the "Select top N" button will disagree. Extra cognitive load reading three spellings of one idea.
- **Fix sketch**: Add one local pure helper, `topSelection(list: OrgRepo[]): Set<string>` =
  `new Set([...list].sort(byProminence).slice(0, MAX_SELECT).map((r) => r.fullName))`, and call it
  from all three sites (`setSelected(topSelection(list))` in `loadRepos`, `setSelected(topSelection(list))`
  in `loadInstallationRepos`, and `setSelected(topSelection(repos))` in `selectTop`). Behavior-preserving:
  the installation path's pre-sorted list re-sorting through `byProminence` is idempotent on already-sorted
  input, so the resulting set is identical.

## 3. `OrgRepo.owner` and `OrgRepo.name` are populated but never read in onboarding
- **Severity**: Low
- **Category**: dead-code
- **File**: src/components/onboarding/types.ts:3-4 (and the writes at OnboardingFlow.tsx:217-218)
- **Scenario**: The onboarding-local `OrgRepo` type declares `owner` and `name`, and
  `loadInstallationRepos` explicitly populates them in its normalize map
  (`owner: String(r.owner), name: String(r.name)`, lines 217-218). Across all onboarding files the
  only consumers of an `OrgRepo` read `fullName`, `private`, `language`, `stars` (SelectStep) and
  `stars`/`pushedAt` (`byProminence`). `owner` and `name` are never read anywhere reachable from this
  type (confirmed: the only onboarding `.owner`/`.name` references are those two writes; `OrgRepo` is
  imported only within onboarding).
- **Root cause**: `OrgRepo` was modeled to mirror the API's `OrgRepoListItem` shape (which legitimately
  carries `owner`/`name` for the server's own validation/routing), so the redundant split fields were
  carried into the client type and dutifully copied in the App-path normalize even though the UI keys
  off `fullName`.
- **Impact**: Minor — two dead fields plus the `String(r.owner)`/`String(r.name)` normalization work
  on every installation-repo load. Mild confusion (a reader assumes they're displayed somewhere) and a
  trivial maintenance cost; no behavior or bundle concern of note.
- **Fix sketch**: Drop `owner` and `name` from `OrgRepo` in `types.ts` and remove the two lines that
  set them in the `loadInstallationRepos` normalize map (OnboardingFlow.tsx:217-218). No callers read
  them, so this is behavior-preserving. (Leave the server's `OrgRepoListItem` untouched — it uses those
  fields server-side.) If parity with the API row is intentionally desired for future use, the safer
  alternative is to leave it and accept the two unused fields — hence Low.
