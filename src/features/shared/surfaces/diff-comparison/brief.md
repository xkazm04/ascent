# Diff comparison - showcase brief

subject: diff-comparison
subcategory: data-display
digest: sha256:0df03bbd2dcbaf5d
verifiedOn: 2026-09-06
goldenPath: knowledge/software-engineering/ui-surfaces/data-display/diff-comparison/diff-comparison.md

Read: the golden path, all seven technique files, the five applications (`react--computation-offload`,
`react--diff-honesty`, `react--drift-against-declared`, `react--semantic-level-selection`,
`rust--pair-and-baseline-selection`), the cited law anchors in `_laws.md` (failure-not-empty-success,
creation-names-reaper, derivation-names-recomputation, count-carries-predicate, gate-sees-target,
identity-survives-reuse, one-authority-per-vocabulary), the reference scene `motion/` and `BRAND.md`.

## Scene concept

A scan comparison desk for one fictional repository (`harbor/lumen-api`): two snapshots of its detector
signals, compared under a pair the reader chooses by question, at a level the reader chooses from the
entity, by a kernel that runs with an identity and a budget, rendered in the reader's mode. It is the
right host because every technique of the subject is a decision the desk has to make before a row can
be drawn - which pair, which level, which budget, which rendering - and the honesty, invisible and drift
regions are the disclosures the same desk owes once rows exist. A viewer switches species, level, mode
and cut, races a stale response, kills the kernel, suppresses whitespace and amends a promise, and
watches the counts, marks and notices stay consistent because one result feeds everything.

`reduced` and `volume` come from props. The volume sizes the signal list per scan (50 / 5,000 / 50,000);
the kernel aligns the whole list (keyed alignment is linear) and a window of 24 rows is rendered; the
budget ladder in `kernel.ts` picks the rung (full / capped / summary) and the offload region names it.
framer-motion is used for the row entrance and the progress sweep only; under `reduced` rows appear
settled and the sweep is a static bar.

## Techniques

### pair-and-baseline-selection
- use_when matched: "choosing which baseline a diff compares against"
- mechanism to show: `SPECIES` binds species → question → baseline; `resolvePair()` derives the pair from the species (never from output length); role-named sides with identity visible; default displayed when defaulted; self-pair guarded and labelled; retired remembered baseline falls back loudly; declared species hands the left side to the drift region
- region: `PairRegion.tsx`
- Ascent evidence: `src/app/report/compare/page.tsx` (`unhonored` ids detected and said above the picker; `?a`/`?b` → `before → after`), `src/components/report/WhatChanged.tsx` (`sameScan` notice), `src/components/report/ScanComparePicker.tsx` (`isInverted` hint) (grep: `Grep "baseline"` over `src` → `src/lib/window.ts`, `src/app/trends/annotations.ts`, compare page read directly)
- deviation: one temporal pair + one exemplar axis, species never named, no remembered baseline
- applications read: `rust--pair-and-baseline-selection.md` - mechanism taken: the length race as the anti-pattern, "fix the default by the question and label it"; nothing cited as Ascent's

### semantic-level-selection
- use_when matched: "forty phantom edits hiding the one that mattered"
- mechanism to show: three kernels (`diffBytes`, `diffLines`, `diffFields`); the candidate serialization reorders keys and requotes so the line level manufactures phantom edits, counted as `spurious`; keyed alignment by minted id survives head insertions and reports a move; positional alignment is offered as the trap and its spurious count shown; `normalize()` + `LEDGER` + `LEDGER_VERSION`; every result carries a `predicate`
- region: `LevelRegion.tsx` (kernel in `kernel.ts`)
- Ascent evidence: `src/lib/report/compare.ts` (`diffScans` enumerates `DIMENSIONS`; `signalNameKey` blanks embedded counts; `diffSignalSets`), `src/lib/report/exemplar.ts` header ("the match level is the signal, not the string") (grep: `Grep "diffSignalSets|signalNameKey" src/lib/report` → hits)
- deviation: no declared normalization ledger; `signalNameKey` and `memory-read.ts` normalize inline
- applications read: `react--semantic-level-selection.md` - mechanisms taken: the three structural lies (serialization equality, depth one, absent-as-null) as what keyed field comparison must avoid; the projection failure; nothing cited as Ascent's

### computation-offload
- use_when matched: "stale answer for pair A lands under pair B's header"
- mechanism to show: `useComparison` - seq per request, cleanup reaper, supersession drop counted, fast path ≤ 200 rows, scheduled otherwise, `failed` shape on kill with retry, cache keyed by pair + level + alignment + ledger version + both fingerprints, `CACHE_CAP` eviction; `rungFor()` from `BUDGET`; progress sweep static under `reduced`
- region: `OffloadRegion.tsx` (hook in `useComparison.ts`)
- Ascent evidence: `src/features/admin/settings/DataErasurePreview.tsx` (`useErasePreview` keys the answer by request and drops a superseded response via `live`) (grep: `Grep "superseded|stale|AbortController|new Worker\("` over `src` → `DataErasurePreview.tsx:65-67`; no worker, no AbortController on a comparison path)
- deviation: no diff budget, no off-thread comparison; the schema bounds every input
- applications read: `react--computation-offload.md` - mechanisms and numbers taken: request identity + pending map, `{kind:'error'}` as a distinct shape, content-fingerprint cache keys, never-evicting cache as the anti-pattern, chunk append O(n²) as the anti-pattern; nothing cited as Ascent's

### presentation-modes
- use_when matched: "zeros that cannot be told from not-compared"
- mechanism to show: `CHANGE_KINDS` once, `KindMark` renders glyph + label as content; side-by-side / inline / summary from one `DiffResult`; remembered preference + transient override; `ResizeObserver` effective-width hard switch to inline below 560px (abstains in jsdom); summary count carries its predicate and escalates to the same pair; zero / failed / computing are three distinct `data-diff-state`s
- region: `ModesRegion.tsx` + `DiffView.tsx`
- Ascent evidence: `src/components/ui/format.ts` (`DIRECTION_TONE` triad: arrow + colour + label; `fmtDelta` "—" for non-finite) (grep: `Grep "DIRECTION_TONE" src` → `format.ts`)
- deviation: one rendering (dimension cards), no mode preference, `WhatChanged.tsx` hand-rolls emerald/red pills
- applications read: none for this technique in the index; the golden path's counter-evidence (no evidence that two-pane is "the review mode") is why the mode is a remembered preference here

### drift-against-declared
- use_when matched: "same deviation re-alarms on every run"
- mechanism to show: `CONTRACT_V3` with author + version + per-clause discipline (exists / exact / threshold ± tolerance / unchecked); `evaluateDrift()` → undeclared / unfulfilled / deviating / fulfilled / unevaluated / unchecked with identity `(clause@entity)`; standing ledger in `DriftRegion.tsx` updates observations on re-run, closes "no longer observed"; two verbs, amend attributed + logged + version bump; coverage stated, unevaluated never passing
- region: `DriftRegion.tsx` (evaluation in `contract.ts`)
- Ascent evidence: `src/lib/analyze/guidance-projection.ts` (two-hash header: stale vs hand-edited), `src/lib/standard/doctor.ts` (check 5 reports an unperformable drift check as one `unchecked` finding) (grep: `Grep -i "drift" src/lib` → `guidance-projection.ts`, `guidance-graph.ts`, `doctor.ts`, `context.ts`)
- deviation: per-run findings, no standing identity or lifecycle, only the fix-reality verb
- applications read: `react--drift-against-declared.md` - mechanisms taken: tolerance thresholds in the kernel, directional kinds, `targetSection` as the amend route, observation-minted ids + last-N cap as the anti-pattern, the silent-null coverage gap; nothing cited as Ascent's

### diff-honesty
- use_when matched: "deciding what a truncated diff may claim"
- mechanism to show: `CutMarker` at the cut with three wordings (counted remainder / not computed at budget / further differences not computed); `notCompared()` third state with reason; failure state with retry in place; moved row carries its inference and a raw-pair control; summary line gains "+" when partial; cut control 4 / 8 / 24
- region: `HonestyRegion.tsx` (marker in `DiffView.tsx`)
- Ascent evidence: `src/app/report/compare/ExemplarPanel.tsx` (`ExemplarFailureNotice` per failure kind; `notComparable` rendered as "scored on only one side, so no gap is claimed"), `src/components/report/WhatChangedParts.tsx` (`OneSidedBadge` + hatched fill) (grep: `Grep -i "not compared|unavailable|truncated" src` → `ExemplarPanel.tsx`, `athena/*`, `alerts.test.ts`)
- deviation: headline pills carry counts without the name-key predicate they were computed under
- applications read: `react--diff-honesty.md` - mechanism taken: "the vocabulary matches the alignment" (id-set difference borrowing change words) - shown here as the positional predicate wording; nothing cited as Ascent's

### invisible-differences
- use_when matched: "a row is marked changed and both sides look identical"
- mechanism to show: `INVISIBLE_ROWS` (trailing space, tab ↔ spaces, indent +4, CRLF → LF, NBSP, ZWSP, Cyrillic homoglyph); `invisibleMarks()` three classes with magnitude / code point; `revealInvisible()` stand-ins in both cells; ignore-whitespace as a visibly-on, counted, reference-carried view; declared repertoire drops the impersonation mark
- region: `InvisibleRegion.tsx` (classifier in `contract.ts`)
- Ascent evidence: `src/lib/standard/memory-read.ts:119` (BOM strip + CRLF fold before parse), `src/lib/sse.ts:67-69` (CRLF frame boundary) (grep: `Grep -i "\\r\\n|zero-width|\\u200b|bidi" src` → `memory-read.ts`, `sse.ts`, `guidance-graph.ts`)
- deviation: no rendering path for the class; whitespace is normalized silently
- applications read: none for this technique in the index

## Out of the read

- Reconciliation (merge / conflict policy), judged comparison (which wins) and time-travel replay are
  neighbours the golden path excludes; the desk shows difference, never verdict.
- A real Web Worker: the offload disciplines are shown with a scheduled timeout because a worker
  needs a file the body map cannot load; the seq / reaper / failure shape are identical.
- The minimality post-pass after prefix/suffix stripping (a kernel concern the subject only demands be
  declared) - the field kernel is keyed, so no alignment slider exists to show.
- Persisting the remembered mode across sessions (a scene reads no storage).

## Gates run

`npx tsc --noEmit` · `npx vitest run src/features/shared/surfaces src/lib/org` · LOC check (≤200 under
`src/features/**`) · `Scene.dom.test.tsx` (regions once, every volume with its rung, reduced path,
spotlight, source excerpts) · `Scene.mechanisms.test.tsx` (kernel alignment and phantom edits, race
drop + kill/retry, summary predicate + cut, self-pair + pruned baseline, level chips + ledger version,
whitespace suppression + repertoire, drift identity + amend + fix).
