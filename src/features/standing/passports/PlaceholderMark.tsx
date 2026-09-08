// The one place the passports surfaces say "placeholder scan".
//
// A deterministic-mock scan emits a FLOOR without ever asking a model. Round 10 taught the fleet
// averages to say so (`isMockEngine` → the "mock" chip on RepoCategoryRollupRow, and the average that
// excludes them), but the passports portfolio never followed: on the default Baseline view a
// placeholder passport rendered identically to a live one, and the blocker Pareto folded its blockers
// into the fleet counts as if a model had found them. Only the non-default Clearance prototype said
// anything at all, in its own footer sentence ("· placeholder scan", ClearanceCard).
//
// So the vocabulary gets ONE author: that exact wording, and this component. Deliberately NOT a chip
// in `@/components/ui` — the overview's equivalent is inline markup in RepoCategoryRollupRow, not a
// shared primitive, so promoting a chip to the global kit is a wider decision than this change.
//
// Server-safe (no hooks, no handlers) on purpose: the card renders on the server report page and the
// table/scatter render inside client components, and both import this same file.

import { StateSwatch } from "@/components/org/viz";

/** The wording. Every passports surface spells a placeholder scan this way, and only this way. */
export const PLACEHOLDER_LABEL = "placeholder scan";

export const PLACEHOLDER_TITLE =
  "Deterministic placeholder scan: a floor emitted without a model, not a live graded scan. Re-scan live to replace it.";

/** A scan engine is the deterministic placeholder floor when it is the mock engine. Mirrors
 *  `isMockEngine` in the overview's repoTrajectory — same predicate, stated for a nullable engine. */
export const isPlaceholderEngine = (engine: string | null | undefined): boolean => engine === "mock";

/**
 * The hairline mark. Sized to sit inline beside a repo name or a metadata line.
 *
 * /org redesign: it now carries the kit's `not-judged` swatch — the same hatch the Doctor-check grid,
 * the Clearance ladder and the scatter paint. A placeholder scan IS the not-judged state ("missing
 * evidence, not a finding, and never counted as passing"), so a reader who has learned the hatch once
 * reads it everywhere instead of learning a second vocabulary for the same fact. The wording stays
 * this file's, and stays the label: the swatch is `aria-hidden` so nothing is said twice.
 */
export function PlaceholderMark({ className = "" }: { className?: string }) {
  return (
    <span
      title={PLACEHOLDER_TITLE}
      className={`inline-flex shrink-0 items-center gap-1 rounded border border-divider px-1 type-label tracking-wider text-slate-500 ${className}`}
    >
      <span aria-hidden className="inline-flex">
        <StateSwatch state="not-judged" size={9} />
      </span>
      {PLACEHOLDER_LABEL}
    </span>
  );
}
