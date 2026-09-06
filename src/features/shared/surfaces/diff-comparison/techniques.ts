// The drawer entries for the diff-comparison scene: one per technique of the registry's
// `diff-comparison` subject (authored against sha256:0df03bbd2dcbaf5d, 2026-09-06), in the golden
// path's order. `mechanism` is this scene's React/Tailwind/Motion mechanism in our words; `source` is
// the scene's own code; `inAscent` cites a real Ascent file that was read; `deviation` names where
// Ascent falls short of the technique.

import type { SurfaceTechnique } from "../surfaceBody";
import * as S from "./sources";

export const techniques: readonly SurfaceTechnique[] = [
  {
    slug: "pair-and-baseline-selection",
    title: "Pair & baseline selection",
    mechanism:
      "`SPECIES` in fixtures.ts binds each baseline species to the question it answers and to the scan that answers it; `resolvePair()` in PairRegion.tsx turns the species into the pair, so the baseline is chosen by the question and never by which output came out longer. " +
      "The two sides render under role names (baseline, candidate) with identity, sha and date visible before any difference, and the line \"compared with the temporal baseline\" is shown even when defaulted. " +
      "Selecting the same scan on both sides produces a labelled self-comparison notice in place of a diff, so the pair (X, X) can never read as \"no changes\". " +
      "Retiring the remembered baseline falls back to the default species loudly — the notice names what was retired and what replaced it — instead of silently swapping the question. " +
      "The declared species hands the left side to the drift region, because a promise is not a past state.",
    source: S.SRC_PAIR,
    inAscent: {
      file: "src/app/report/compare/page.tsx",
      note: "The compare page resolves `?a`/`?b` into a `before → after` pair, detects ids the server did not honor and says so above the picker instead of silently showing the default pair; `WhatChanged.tsx` guards the same-scan pair with its own notice.",
    },
    deviation:
      "Ascent's compare view offers one temporal pair and one exemplar axis but never names the baseline species; the picker's inverted-pair hint (`ScanComparePicker.tsx`) is the only role discipline, and no remembered baseline exists to decay.",
  },
  {
    slug: "semantic-level-selection",
    title: "Semantic level selection",
    mechanism:
      "The same pair is compared at three levels by three kernels in kernel.ts: `diffBytes` answers identical-or-not, `diffLines` aligns two serializations positionally, and `diffFields` walks the entity's own rows. " +
      "The line level counts its phantom edits (differences beyond what the field level found) so the reader sees what text-diffing a structured entity manufactures; the candidate serialization reorders keys and requotes strings on purpose. " +
      "Keyed alignment matches rows by their minted id, so two ids inserted at the head shift nothing, and a row whose shared-order rank moved by more than one slot is reported as moved; the positional chip shows the trap and the region counts the spurious changes it would have claimed. " +
      "`normalize()` is the one normalization function every kernel calls, and `LEDGER` lists each assertion with its reason under one version. " +
      "Every result carries a `predicate` string, so \"no differences\" is always scoped to a stated level.",
    source: S.SRC_LEVEL,
    inAscent: {
      file: "src/lib/report/compare.ts",
      note: "`diffScans` enumerates `DIMENSIONS` — the schema that scores the entity — and diffs per dimension with per-field equality (null deltas unless both sides scored it); `diffSignalSets` aligns evidence on a signal-name key with embedded counts blanked, and `exemplar.ts` says why that level is right across repos and wrong within one.",
    },
    deviation:
      "No normalization ledger exists: `signalNameKey` blanks counts inline and `memory-read.ts` strips BOM and CRLF silently, so what Ascent treats as not-a-difference is spread across kernels rather than declared once with a version.",
  },
  {
    slug: "computation-offload",
    title: "Computation offload",
    mechanism:
      "`useComparison` in useComparison.ts mints a sequence number per request; the effect's cleanup is the named reaper (a pair or level change clears the scheduled kernel), and a response whose seq no longer matches is dropped and counted rather than applied under the wrong header. " +
      "Pairs at or below `BUDGET.fastPathRows` compute synchronously inside the effect; larger ones are scheduled with a delay proportional to their size, standing in for a worker round trip. " +
      "The kill switch makes the kernel die, and it dies into a distinct `failed` state with a message and a retry — never into an empty result. " +
      "The cache is keyed by pair identity, level, alignment, ledger version and both sides' content fingerprints, and it evicts past `CACHE_CAP`. " +
      "`rungFor()` chooses the ladder rung from the declared budgets before any row is rendered, and the region names the rung in words.",
    source: S.SRC_OFFLOAD,
    inAscent: {
      file: "src/features/admin/settings/DataErasurePreview.tsx",
      note: "`useErasePreview` stores the answer with the request key it answers and reads it back only on an exact match, and its in-flight `live` flag drops a superseded response so a slow first request cannot overwrite a fast second one.",
    },
    deviation:
      "Ascent has no diff kernel budget and no off-thread comparison: `diffScans` runs synchronously on the server per request, and no surface declares what an oversized pair degrades to — the inputs are bounded by the schema, so the ladder has never been needed.",
  },
  {
    slug: "presentation-modes",
    title: "Presentation modes",
    mechanism:
      "`CHANGE_KINDS` in kernel.ts is the one change-kind vocabulary — glyph and label rendered as content beside a tone class — and `KindMark` is the only component that renders it, so every region and the legend agree. " +
      "One `DiffResult` feeds all three modes in DiffView.tsx: side-by-side keeps both sides whole with an absent side occupying real space and unchanged rows collapsed behind a labelled expander; inline is one reading flow; summary is the counts with their predicate. " +
      "The mode is a remembered reader preference with a transient per-pair override, never inferred from the task; a ResizeObserver reads the effective width and hard-switches two-pane to inline below `NARROW_PX` rather than wrapping. " +
      "The summary's \"open detail\" lands on the same pair, level and predicate because it is the same result. " +
      "Zero is a claim: the region renders \"compared, none found\", \"comparison unavailable\" and \"comparing…\" as three distinct states.",
    source: S.SRC_MODES,
    inAscent: {
      file: "src/components/ui/format.ts",
      note: "`DIRECTION_TONE` is the single source of the rising/falling/flat triad — arrow glyph, colour and label together — and `fmtDelta` renders a non-finite delta as a bare \"—\" so a measurement gap never wears a confident arrow.",
    },
    deviation:
      "Ascent's compare page renders one mode (dimension cards); there is no inline or summary rendering to switch between and no remembered preference, and `WhatChanged.tsx` still hand-rolls emerald/red pills beside the shared triad.",
  },
  {
    slug: "drift-against-declared",
    title: "Drift against declared",
    mechanism:
      "`CONTRACT_V3` in contract.ts is a declaration with an author and a version; each clause carries its comparison discipline (exists, exact, threshold with tolerance, or deliberately unchecked). " +
      "`evaluateDrift()` returns directional findings — undeclared, unfulfilled, deviating — plus fulfilled, unevaluated and unchecked, under an identity minted from (clause, entity) rather than from the observation. " +
      "DriftRegion.tsx keeps a standing ledger derived from that identity: re-running the check raises an observation count on open findings and never mints a duplicate, and a deviation that is gone on the next run closes as \"no longer observed\". " +
      "Every open finding offers both verbs; \"amend promise\" is attributed, logged with before and after, and bumps the contract version, so the promise is never auto-laundered into whatever reality does. " +
      "The coverage readout states clauses evaluated over clauses declared, and an unevaluated clause is rendered as not passing.",
    source: S.SRC_DRIFT,
    inAscent: {
      file: "src/lib/analyze/guidance-projection.ts",
      note: "A projection's header carries two hashes so drift from the canonical is diagnosable as stale (source moved) versus hand-edited (projection changed), and `standard/doctor.ts` reports a drift check it could not perform as one aggregated `unchecked` finding rather than as fresh.",
    },
    deviation:
      "Ascent's drift findings (doctor checks, guidance-projection staleness) are per-run outputs with no standing identity or resolution lifecycle, and the only verb offered is fix reality — a stale declaration cannot be amended from the finding.",
  },
  {
    slug: "diff-honesty",
    title: "Diff honesty",
    mechanism:
      "`CutMarker` in DiffView.tsx renders at the cut, inside the reading flow, and its wording follows the result: a counted remainder says \"and N more\", a summary rung says row detail was not computed, and a too-large rung says further differences were not computed — never a rounded number. " +
      "`notCompared()` in kernel.ts turns the binary blob and the ledger-excluded volatile stamp into a third state with its reason, counted apart from unchanged. " +
      "A dead kernel renders as \"comparison unavailable\" with a retry beside it, in the place the diff would have been, and the honesty region shows the same failure. " +
      "A move is presented with the displacement it was inferred from and a \"show raw pair\" control, so the detector's guess is never the only route to the content. " +
      "The summary line is built from the same result as the rows and gains a \"+\" the moment the detail is partial.",
    source: S.SRC_HONESTY,
    inAscent: {
      file: "src/app/report/compare/ExemplarPanel.tsx",
      note: "`ExemplarFailureNotice` spells every reason a comparison was not made as a sentence instead of substituting an exemplar, and the panel renders `notComparable` dimensions as a distinct \"scored on only one side, so no gap is claimed\" state.",
    },
    deviation:
      "Ascent has no truncated diff to disclose (the schema bounds every comparison), and `WhatChangedParts.tsx` already badges a one-sided dimension as not comparable; the gap is the headline pills — \"N signals detected\" travels without the name-key predicate `diffSignalSets` counted under.",
  },
  {
    slug: "invisible-differences",
    title: "Invisible differences",
    mechanism:
      "`INVISIBLE_ROWS` in contract.ts holds seven pairs the kernel rightly marks changed whose sides look identical; `invisibleMarks()` classifies each into whitespace with magnitude (indent +4, tab ↔ spaces, CRLF → LF, trailing space +2), no-extent characters and impersonators, each named by code point. " +
      "`revealInvisible()` substitutes visible stand-ins in both cells, so the row shows its cause instead of a tinted pair of identical strings. " +
      "The \"ignore whitespace\" chip is the reader's suppression: the surface says it is on, counts the rows it annotated out, keeps them as a count instead of deleting them, and the reference string carries `ws=ignore` so a handed-off link shows the same view. " +
      "Declaring Cyrillic as expected removes the impersonation mark, because out-of-repertoire is only a finding against a declared repertoire. " +
      "One tone per class, defined once, beside a text label.",
    source: S.SRC_INVISIBLE,
    inAscent: {
      file: "src/lib/standard/memory-read.ts",
      note: "`parseRepoMemoryEntry` strips a BOM and folds CRLF to LF before parsing — the everyday half of the class handled as a normalization — and `sse.ts` documents why a CRLF frame boundary is invisible to a `\\n\\n` search.",
    },
    deviation:
      "Ascent has no rendering path for a whitespace-only, no-extent or homoglyph difference — its comparison surfaces diff scores and signal names, never text — so the class is normalized away silently rather than shown with magnitude.",
  },
];
