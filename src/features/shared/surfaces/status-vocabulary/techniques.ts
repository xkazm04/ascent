// The drawer entries for the status-vocabulary scene: one per technique of the registry's
// `status-vocabulary` subject (authored against sha256:0bdc30b0870393c6, 2026-09-06). `mechanism`
// explains what the region does in React/Tailwind; `source` is the scene's own code; `inAscent`
// cites a real Ascent file read during the run; `deviation` names where Ascent falls short.

import type { SurfaceTechnique } from "../surfaceBody";
import * as S from "./sources";

export const techniques: readonly SurfaceTechnique[] = [
  {
    slug: "vocabulary-chain-integrity",
    title: "Vocabulary chain integrity",
    mechanism:
      "vocabulary.ts holds the union once; the presentation table is `Record<ScanStatus, …>`, the catalog sits under a `Covers<>` conditional type that fails `tsc` naming the missing keys, and the member list and the storage `CHECK` are derived from the gated map's keys afterwards — gate first, derive second. " +
      "The region lists the four layers with their artifacts so the derivation direction is visible. " +
      "Pressing deliver injects a row whose status crossed the wire as `dead_letter`: the resolver is total, the pill renders the unknown entry, and the pill's effect reports the miss into a ledger the region reads — in production, not behind a dev flag. " +
      "The rank map is `Record<ScanStatus, number>`; the unknown rank is a written constant, so worst-first sorting places the unknown row by decision rather than by `indexOf` returning −1.",
    source: S.SRC_CHAIN,
    inAscent: {
      file: "src/lib/integrations/providers.ts",
      note: "`FIDELITY_META: Record<Fidelity, …>` is the gate and `FIDELITY_TIERS = Object.keys(FIDELITY_META) as Fidelity[]` the derivation after it — the landed annotate-then-derive shape, with the reason in prose.",
    },
    deviation:
      "Storage constraints do not exist: `prisma/schema.prisma` stores `status String` with the members in a comment, and the unknown path is a silent `LABEL[x] ?? x` at a dozen sites (`backlogShared.ts:67`, `goalView.tsx:150`, `AutopilotBandParts.tsx:114`) — the raw token ships and no miss is reported anywhere.",
  },
  {
    slug: "status-color-mapping",
    title: "Status color mapping",
    mechanism:
      "`ROLE_SLOTS` maps the five semantic roles to themed Tailwind slot sets (text, border, bg, dot) built on the brand tokens; each vocabulary's presentation table maps a member to a role, a glyph and a label key in one entry, keyed by the union so a new member cannot render as a colourless pill. " +
      "The pill takes the token and owns the table — no call site wires three lines of classes. " +
      "Two vocabularies sit side by side because their fallbacks point different ways: the state set degrades to neutral, the severity set to the most severe member, and the reasoning is rendered beside each fallback row. " +
      "Drop colour applies a grayscale filter to the ledger: the glyph in the same entry keeps the rows distinguishable.",
    source: S.SRC_COLOR,
    inAscent: {
      file: "src/lib/ui.ts",
      note: "`LEVEL_CLASSES` and `LEVEL_GLYPH` are both `Record<LevelId, …>` with the CVD rationale in-source, and `LevelBadge.tsx` clamps an unrecognised level to L1 — the attention end — on purpose.",
    },
    deviation:
      "Glyph and classes are two parallel maps rather than one entry; `SecurityFindingsTable.tsx` keeps `STATUS_LABEL` and `STATUS_TONE` apart on raw palette classes (amber/emerald/sky, not the tokens); `EFFORT_CLASS` in lib/ui.ts is `Record<string, …>`; `backlogShared.ts` hand-picks hex per status.",
  },
  {
    slug: "number-formatting",
    title: "Number formatting",
    mechanism:
      "`Num` reads the viewer's locale from `LocaleContext` through `useSceneLocale()` — the language buttons in this region are the only place it is set, and every figure in the ledger follows without any cell being told. " +
      "`fmtNumber` in formatters.ts is the one renderer: value plus unit in, the whole string out, with `Intl.NumberFormat` instances cached at module scope by locale and unit. " +
      "The fact table shows the three statements a formatter must keep apart — absent renders the placeholder, an exact zero renders zero, a sub-cent spend renders the `<` guard with the sign placed by the locale — beside what `$${v.toFixed(2)}` says for each. " +
      "Compact and percent go through the same primitive, so lakh grouping and symbol position appear when the locale changes.",
    source: S.SRC_NUMBER,
    inAscent: {
      file: "src/lib/ui.ts",
      note: "`fmtCompact` and `fmtPts` are one home for two precision ladders (the compact k/M/B ladder and the one-decimal points rule) that the fleet columns call instead of re-deriving.",
    },
    deviation:
      "No unit-bearing, locale-bound primitive exists: 47 files call host-default `toLocaleString()`, `src/app/usage/usageRepoPanel.tsx:27` and siblings concatenate `$${usd.toFixed(2)}` (sub-cent spend renders as $0.00), and `fmtCompact` is English-only with a hand-built suffix.",
  },
  {
    slug: "timestamp-display",
    title: "Timestamp display",
    mechanism:
      "ticker.ts is one application-scoped timer: each `Elapsed` cell subscribes with its instant, the cadence is keyed on the youngest subscriber (1s, 30s, 5m), the interval restarts only when the target cadence changes, and it stops at zero subscribers — the readout shows subscribers and cadence live. " +
      "The label comes from `Intl.RelativeTimeFormat` in the bound locale, so no ladder of strings is authored; the absolute moment sits in the `title`, and `Moment` is the fixed-moment primitive with three named variants. " +
      "A future instant within two minutes clamps to now; beyond that `fmtElapsed` returns null and the cell shows the absolute moment in the warning tone and reports the skew once. " +
      "The ticker is a loop, so the region carries a visible pause control and starts paused under `reduced`, and the label says the labels are held still.",
    source: S.SRC_TIME,
    inAscent: {
      file: "src/lib/ui.ts",
      note: "`freshness()` clamps negative elapsed time to zero (`Math.max(0, …)`) and `FreshnessControl.tsx` re-evaluates it on a 30s interval — the shelf-life of an elapsed label is taken seriously in one place.",
    },
    deviation:
      "Five hand-rolled English ladders (`timeAgo`, `freshness`, `AlertsMovement.tsx:48`, `knowledgeModel.ts:121`, `SkillDormancyBadge.tsx`) and zero `Intl.RelativeTimeFormat`; `timeAgo` maps a future instant to `today`; intervals are per surface, not one ticker; no absolute value in a tooltip. `shortDate` pins en-US deliberately for SSR hydration, which is a documented choice rather than drift.",
  },
  {
    slug: "untrusted-label-rendering",
    title: "Untrusted label rendering",
    mechanism:
      "`Label` renders the repository name as a text node — React escapes it, and the scene has no `dangerouslySetInnerHTML` and no markdown door at all — so the markup sample renders as its own angle brackets. " +
      "Geometry is decided inside the primitive: `truncate` with the full value recoverable from `title`, `dir=\"auto\"` plus `unicode-bidi: isolate` so a right-to-left run cannot reorder its neighbours, and a fixed max width so a 100-character name cannot stretch the ledger. " +
      "The looks-like-a-token sample renames the row to `critical`: the pill beside it keys on `row.status`, so the name changes nothing about colour or sorting — content flows into a dead end and never becomes vocabulary.",
    source: S.SRC_LABEL,
    inAscent: {
      file: "src/components/report/MarkdownLite.tsx",
      note: "The one markdown door for model-written prose: four inert constructs, no href, no src, no dangerouslySetInnerHTML — the raw-markup door is used only for repo-authored JSON-LD in layout.tsx.",
    },
    deviation:
      "No shared label primitive owns geometry: `truncate` is applied per call site and `dir=\"auto\"` / bidi isolation appears nowhere (0 hits), so a crafted repository name is clipped by eye or not at all.",
  },
  {
    slug: "vocabulary-evolution-checklist",
    title: "Vocabulary evolution checklist",
    mechanism:
      "The add mode lists the seven steps for a new member `retrying` as checkboxes; `previewFor()` derives what a user would see from which steps are discharged — a bare string on the wire renders through the unknown path, a missing constraint fails the write, a missing catalog entry ships the raw token, a missing presentation entry ships a colourless pill. " +
      "Only all four layers in one change render the member properly, and the verdict still notes whether the fallback direction was re-affirmed. " +
      "Rename mode says which of the two things a rename is — a label edit in the catalog, or add-migrate-retire — and retire mode lists the mirror checklist top-down, with the reason deleting the label first is not a retirement.",
    source: S.SRC_EVOLUTION,
    inAscent: {
      file: "src/components/org/shared/backlogShared.ts",
      note: "`STATUS_ACCENT: Record<RecStatus, string>` carries its own post-mortem: typed against the union so a newly-added status is a compile error, not an undefined border colour.",
    },
    deviation:
      "The checklist is held by memory: no coverage gate spans type and catalog, storage is `String` with a comment so step 3 has nothing to mirror, and a member's retirement has no zero-occurrence check before its label is removed.",
  },
];
