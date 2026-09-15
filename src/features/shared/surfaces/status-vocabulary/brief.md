# Status vocabulary - showcase brief

subject: status-vocabulary
subcategory: feedback-and-style
digest: sha256:0bdc30b0870393c6
verifiedOn: 2026-09-06
goldenPath: knowledge/software-engineering/ui-surfaces/feedback-and-style/status-vocabulary/status-vocabulary.md

## Scene concept

A fleet scan ledger: eight fictional repository scans, each row crossing the value-to-presentation
boundary in every cell - a status token and a severity token through one presentation table each, a
cost / token count / pass rate through one locale-bound number renderer, a finished-at moment through
one shared ticker, and an outside-authored repository name through one text-only label primitive. The
six regions beneath the table hold the controls the ledger reacts to (deliver a skewed producer's
token, sort worst-first, drop colour, switch the viewer's language, pause the ticker, rename a repo,
walk the add-a-member checklist), so a viewer can use the ledger for a minute before the rail reveals
that each column is a technique. `reduced` and `volume` come from props; the ticker starts paused
under `reduced`; nothing reads a media query, the URL, the org or the registry.

Read: the golden path, all six technique files, the six applications (`next--vocabulary-chain-integrity`
- measured in this very repo, so its mechanisms were re-grepped rather than cited; `react--number-formatting`,
`react--status-color-mapping`, `react--timestamp-display`, `react--vocabulary-chain-integrity`,
`rust--vocabulary-chain-integrity`), and the six law anchors. `token-label-separation@i18n` is a shared
technique the index does not list for this subject; the scene embodies it inside chain-integrity (label
key vs token) without a region of its own.

## Techniques

### vocabulary-chain-integrity
- use_when matched: "a new member renders as a raw unlabeled token"
- mechanism to show: `vocabulary.ts` - union as authority; `Record<ScanStatus, …>` presentation table;
  `Covers<>` conditional type over the catalog naming missing keys; members and `STORAGE_CHECK` derived
  from the gated map's keys; `SCAN_STATUS_RANK` as a total map with a decided `UNKNOWN_RANK`; total
  `resolveStatus()`; the pill reports a miss from an effect into a production ledger.
- region: `ChainPanel.tsx` -> `ChainRegion` (layers list, deliver/withdraw skew, worst-first, miss ledger)
- Ascent evidence: `src/lib/integrations/providers.ts` `FIDELITY_META: Record<Fidelity, …>` ->
  `FIDELITY_TIERS = Object.keys(…) as Fidelity[]` (grep: `rg "Record<.*Status.*, *\{" src`,
  `rg "satisfies Record<" src`, `rg "LABEL\[.*\] \?\? " src` -> 10 raw-token fallbacks)
- deviation: `prisma/schema.prisma:164` `status String` with members in a comment (no constraint);
  `?? token` fallbacks at `backlogShared.ts:67`, `goalView.tsx:150`, `AutopilotBandParts.tsx:114`; no miss
  reporting; `aiDeliveryTypes.ts:71` `satisfies Record<string, …>` gates values not coverage.
- applications read: next (the annotate-then-derive shape; the `DIMS` D9 lesson), react (rank as
  `Record<Union, number>` vs the `indexOf` array), rust (the `Covers` probe; 155 fields crossing as bare
  strings; dev-only warn on the miss path). Mechanisms taken: `Covers<>`, derive-after-gate, total rank map,
  production miss report. Nothing cited as Ascent's.

### status-color-mapping
- use_when matched: "choosing what unknown severities fall back to"
- mechanism to show: `ROLE_SLOTS` role -> themed slot set on brand tokens; one entry per member with role +
  glyph + labelKey; token-taking `StatusPill` / `SeverityPill`; two fallbacks with opposite directions and
  their reasoning rendered; grayscale toggle proving shape.
- region: `ChainPanel.tsx` -> `ColorRegion`
- Ascent evidence: `src/lib/ui.ts` `LEVEL_CLASSES` + `LEVEL_GLYPH` (`Record<LevelId, …>`), `LevelBadge.tsx`
  clamps unknown to L1 (grep: `rg "STATUS_TONE|STATUS_ACCENT|LEVEL_CLASSES" src`)
- deviation: glyph and classes as two parallel maps; `SecurityFindingsTable.tsx:44-56` parallel
  `STATUS_LABEL`/`STATUS_TONE` on raw amber/emerald/sky; `EFFORT_CLASS: Record<string,…>`;
  `backlogShared.ts` hex per status.
- applications read: react (`VERDICT_CONFIG` post-mortem; 5-slot `StatusToken`; slot-starvation fork;
  grey default for a state set; severity direction). Numbers taken: the ~10-consumer threshold for a shared
  palette (not needed here). Nothing cited as Ascent's.

### number-formatting
- use_when matched: "sub-unit spend rendering as zero"
- mechanism to show: `locale.ts` context + `useSceneLocale()`; `formatters.ts` `fmtNumber(value, unit,
  locale)` with per-unit options, module-scope `Intl.NumberFormat` cache, `MONEY_FLOOR` guard, `ABSENT`
  placeholder; the fact table beside `handRolledMoney`; language buttons re-render the ledger.
- region: `FormatPanel.tsx` -> `NumberRegion`
- Ascent evidence: `src/lib/ui.ts` `fmtCompact` / `fmtPts` (grep: `rg "Intl.NumberFormat" src` -> 0 hits;
  `rg -l "toLocaleString" src` -> 47 files; `rg '\$\${' src --include=*.tsx` -> 5 sites)
- deviation: no unit-bearing locale-bound primitive; `usageRepoPanel.tsx:27` `$${usd.toFixed(2)}`;
  host-default `toLocaleString()` everywhere; `fmtCompact` English suffix ladder.
- applications read: react (the 212-call-site fix; `<$0.01` guard; zero/null asymmetry inside one branch;
  the lint rule blind to callbacks). Mechanisms taken: bind-inside, guard on the absolute value, cache.
  Nothing cited as Ascent's.

### timestamp-display
- use_when matched: "future timestamps rendering as just now"
- mechanism to show: `ticker.ts` one self-scaling timer (1s/30s/5m by youngest subscriber, stops at zero);
  `Elapsed` subscribes and reads the ticker's clock; `Intl.RelativeTimeFormat(locale, numeric:auto)`;
  clamp <= 2 min to now, beyond -> null -> absolute in warn tone + `reportSkew` once; `Moment` with three
  named variants; visible pause control, paused under `reduced`.
- region: `FormatPanel.tsx` -> `TimeRegion`
- Ascent evidence: `src/lib/ui.ts` `freshness()` (`Math.max(0, …)`) + `src/components/report/FreshnessControl.tsx:30`
  30s interval (grep: `rg "Intl.RelativeTimeFormat" src` -> 0 hits; `rg 'ago`' src` -> 5 ladders)
- deviation: five English ladders; `timeAgo` renders the future as `today`; per-surface intervals; no
  tooltip absolute. `shortDate` en-US pin is a documented SSR choice, noted not counted.
- applications read: react (`cadenceForAge` 1s->30s->5m; `Math.min(0, diff)`; `FUTURE_SKEW_TOLERANCE_MS`
  + one breadcrumb per session; 28 forked ladders). Numbers taken: the cadence ladder. Nothing cited as
  Ascent's.

### untrusted-label-rendering
- use_when matched: "a crafted name breaks the layout"
- mechanism to show: `Label` = text node, `truncate` + `title`, `dir="auto"` + `[unicode-bidi:isolate]`,
  `max-w`; hostile samples (markup, 100 chars no spaces, RTL, a token-shaped name, emoji) rename ledger row
  one; the pill beside it keys on `row.status`.
- region: `TextPanel.tsx` -> `LabelRegion`
- Ascent evidence: `src/components/report/MarkdownLite.tsx` (grep: `rg "dangerouslySetInnerHTML" src` ->
  3 JSON-LD sites + comments; `rg 'dir="auto"|unicode-bidi' src` -> 0 hits)
- deviation: no shared label primitive; truncation per call site; no bidi isolation anywhere.
- applications read: none exist for this technique in the index; the technique file only. Nothing cited.

### vocabulary-evolution-checklist
- use_when matched: "adding a member to a display vocabulary"
- mechanism to show: seven-step checklist as checkboxes; `previewFor(done)` derives the degraded pill a
  user would see per missing layer; rename and retire modes as prose/lists.
- region: `TextPanel.tsx` -> `EvolutionRegion`
- Ascent evidence: `src/components/org/shared/backlogShared.ts:23-30` `STATUS_ACCENT: Record<RecStatus,…>`
  with its own post-mortem (grep: `rg "compile error" src/components/org/shared src/lib/integrations`)
- deviation: no type<->catalog coverage gate; storage `String` so nothing to mirror; no zero-occurrence
  check before a label is removed.
- applications read: rust (the parity test written after `healing_capped` shipped raw). Nothing cited.

## Out of the read

- Server-side validation at the door (`validate_one_of`) - a scene has no write path.
- Locale-parity boards across catalogs - owned by i18n's completeness-gates.
- Telemetry sinks for the miss and skew reports - the scene renders the ledger; a real app would emit.
- `OrgTable` is not used: `src/components/org/shared` is off-limits to feature groups (AGENTS.md).
