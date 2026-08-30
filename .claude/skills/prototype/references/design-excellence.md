# Design excellence — the bar a variant must clear before it is shown

Why this file exists: `/prototype` produced three *different* layouts of a mediocre baseline and called
it a round. Layout diversity is not quality. A variant is only worth the user's attention if it is
**better** than the baseline on a bar the skill can state and check — this file is that bar, written
so an LLM can apply it while designing and score its own output before presenting it.

Three parts, used in order: the **principles** (what excellent means here), the **brief** (answered
before any variant code is written), and the **critique** (scored on every variant before it is shown;
a failing variant is reworked, not presented).

Sources this distils: Tufte (data-ink, small multiples), Nielsen (visibility of status), the Stripe /
Linear / Vercel school of premium UI (one accent, layered dark surfaces, typeset numbers), Refactoring
UI (hierarchy by de-emphasis, not emphasis), the squint test, the dashboard 5-second rule, and the
brand's own `BRAND.md`.

---

## 1. Principles — what "excellent" means on an ascent surface

Each principle carries the **test** the skill runs on its own output. A principle without a test is a
mood; these are checks.

1. **One takeaway, stated first.** The surface answers one question before it shows any data.
   *Test: write the takeaway in ≤ 8 words before writing layout code. If you cannot, the surface has no
   editor yet — the variant will be a pile of panels.*
2. **Unmistakable hierarchy.** Exactly one focal element wins by size, contrast or position; two or three
   secondary elements; everything else recedes. Hierarchy is built by **de-emphasising the rest**
   (smaller, muted, mono) — not by making the focal thing louder.
   *Test (squint): blur the screen mentally. One thing must still win. A tie between two elements is a
   fail; a screen where everything is the same size/weight is a fail.*
3. **5-second legibility.** A first-time reader can say "fine / not fine, and where to look" in five
   seconds without a legend or a hover.
   *Test: cover the top of the screen after five seconds. Verdict + location must come immediately.*
4. **Density earns its ink.** Every border, icon, label, gridline and background must let someone decide
   or act, or it goes. The exception is *guidance* — labels, units, the sentence that explains a number —
   which is never chrome. "Delete until it breaks", then put the guidance back.
   *Test: for each visual element, name the decision it enables. Unnamed → cut.*
5. **Progressive disclosure, not a flat wall.** The primary read is visible; detail is one interaction
   deeper (expand, hover, drill-in), never side-by-side at the same weight as the headline.
   *Test: count values visible above the first fold. If a reader could not sort them into "core" and
   "extra" without help, the layers are not layered.*
6. **The system, not the screen.** Sizes come from the type scale (`type-*` in `globals.css`), colour
   from the tokens and `@/lib/ui`, chrome from `@/components/ui` and `@/components/org/shared/ui`.
   *Test: list every font size, colour and spacing value in the variant. More than ~6 per axis, or any
   arbitrary `text-[…px]` / hand-picked hex → the system leaked.*
7. **One azure, earned.** The accent carries meaning — the focal number, the active state, the one CTA —
   and appears nowhere decorative. Level/score colour is the red→green ramp and nothing else.
   *Test: count accent occurrences. More than three semantic roles on a screen means it is diluted.*
8. **Every state is designed.** Empty, loading, error and "first day, zero rows" get the same care as
   the populated state, and say what to do next.
   *Test: describe the zero-data render in one sentence. "I didn't design that" is a fail.*
9. **Motion has one job.** An animation explains exactly one state change (arrived, updated, expanded).
   Nothing loops; everything is gated under `prefers-reduced-motion`.
   *Test: name the transition each animation explains. Unnamed → cut.*
10. **Real nouns, real numbers.** Repo names, D1…D9, deltas with sign, posture words, follow-up titles.
    Decorative shapes, name-only chips and unlabelled bars are the tells of a prototype.
    *Test: every cell/chip/bar carries a fact the reader already cares about.*

---

## 2. The brief — answered in writing BEFORE any variant code

Write this as a short block in the round's summary (the user reads it beside the tabs). One brief per
**surface**, then one *directional twist* line per variant. If two answers would be identical for both
variants, that's fine — the variants differ in metaphor, not in what the screen must say.

1. **Takeaway sentence** (≤ 8 words): the one thing the screen must say.
2. **Primary reader + their 5-second question**: who opens this, what single question are they
   answering right now.
3. **Hierarchy ladder**: name them — 1 focal, 2–3 secondary, and the explicit list of what is tertiary.
4. **Density tier** and why: `compact` (scanning many rows), `comfortable` (default), `spacious`
   (one thing, contemplated). One tier per surface; never mixed inside a table.
5. **What gets deleted** — ≥ 3 things a mediocre version would include, each with the decision it
   *would* have enabled (proving it isn't needed here).
6. **The one place motion is allowed** and the state change it explains.
7. **Zero / loading / error** — one line each.
8. **Reference surface mined** — the sibling in the codebase this borrows its bar from (Phase 3a.3).

---

## 3. The critique — scored on every variant BEFORE it is shown

Score each row 0 / 1 / 2. **Minimum to show: 16 / 20, and no row at 0.** A 0 on any row is disqualifying
on its own — a missing takeaway or a hierarchy tie is not something the user should have to point out.
Rework the variant and re-score; if a variant cannot clear the bar in two passes, drop it and say so
rather than padding the round with it.

| # | Row | 0 — fail | 2 — pass | Failure signal to look for |
|---|---|---|---|---|
| 1 | Takeaway present | No single sentence | ≤ 8 words, and the layout visibly leads with it | "shows metrics and trends" (plural, vague) |
| 2 | Focal dominance | ≥ 2 elements tie when blurred | One element wins at a glance | Same size/weight/colour everywhere |
| 3 | 5-second verdict | Needs a legend or hover | Status + where-to-look are immediate | Reader's eye has no entry point |
| 4 | Token discipline | Arbitrary sizes / hand hexes / > 6 values per axis | All from `type-*`, tokens, `@/lib/ui` | `text-[11px]`, `text-violet-300`, hand-rolled card |
| 5 | Density match | Tier contradicts the reader's task | Row rhythm and whitespace match the stated tier | Dense scanner given airy cards; one-number view crammed |
| 6 | Deletion honesty | Nothing from the brief's list was cut | Every listed item is absent and nothing else replaced it | Element count equals the baseline's |
| 7 | Accent discipline | Accent on decoration or > 3 roles | Accent only on the focal number / active state / one CTA | Blue borders, blue icons, blue labels |
| 8 | State completeness | Only the happy path exists | Empty / loading / error designed and actionable | `InlineEmpty` missing; a blank grid |
| 9 | Alignment & grid | Mixed alignment, numbers not right-aligned | Shared columns and baselines; mono tabular numbers right-aligned | A stat column that wobbles |
| 10 | Motion justification | Decorative or looping animation | Each animation names its transition and is gated | `hover:-translate-y`, drifting particles |

Report the score per variant in the round summary as `excellence 17/20 (row 5 = 1: …)`. The user sees
the number and the weakest row; that is what turns "this feels mediocre" into a specific next move.

---

## 4. Dark-dashboard rules with numbers (the brand's specifics)

- **Sizes:** nothing below `type-micro` (12px), and micro only for dense metadata — never for a
  primary number or a sentence. Body copy is `type-body-sm` (15px) or `type-body` (17px); a stat is
  `type-figure` / `type-figure-lg`. Line-height ≥ 1.4× in tabular data.
- **Text ladder, one hue:** primary `text-white` / `text-slate-100`; secondary `text-slate-300/400`;
  tertiary `text-slate-500`; disabled/provenance `text-slate-600`. Never a fourth grey family.
- **Depth is surface tone, not shadow:** `bg-ink` → `bg-surface/40` → `bg-surface-strong/40`. No drop
  shadows on dark.
- **Tables & matrices:** numbers mono, tabular, right-aligned, never wrapping; labels left-aligned;
  a cell label truncates with a title tooltip at ~24 characters (~14 for a tile label). Row height on
  a fixed scale — compact 32px, comfortable 40px, spacious 48px — one per screen.
- **Deltas carry shape + colour:** a sign (`+3`, `−2`) or arrow with `deltaHex`, never colour alone.
- **Sparklines are context:** 40–64px wide, one stroke, no axes or ticks; they sit beside a number and
  are never read on their own.
- **Accent budget:** ≤ 3 semantic roles per screen (focal number, active/selected state, one CTA).
- **Copy voice:** a label is a noun (`Attributable lift`), a reading is a sentence with a verb
  (`Frontend leads · Backend trails 13 pts`), a CTA is an imperative (`Open report`).
