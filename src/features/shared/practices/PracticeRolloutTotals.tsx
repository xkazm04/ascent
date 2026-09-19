// The rollout's fleet totals — the four numbers, under the matrix that says what KIND of number each
// one is.
//
// Every caption these stats used to carry is gone from here. Two of them were epistemic qualifiers
// ("no repo has been scanned on both sides yet", "awaiting a post-merge rescan") and are now the
// `not-judged` swatch IN PLACE OF the value: a hatch beside "Playbook lift" cannot be misread as a
// zero the way an em dash could. The rest were sample statements, and a sample belongs beside its
// figure as a unit, not as a sentence.
//
// Server-safe: no hooks, no handlers (`WhyChip` brings its own client boundary).

import { Kicker } from "@/components/ui";
import { deltaHex, fmtDelta } from "@/components/org/shared/ui";
import { StateSwatch, WhyChip, STATE_HINT } from "@/components/org/viz";
import type { PracticeRollout } from "./practiceRows";

function Stat({
  label,
  value,
  unit,
  color,
}: {
  label: string;
  value: string;
  unit: string;
  /** Signed-delta paint, from the shared `deltaHex`. Omitted leaves the default ink. */
  color?: string;
}) {
  return (
    <div className="min-w-[8rem]">
      <Kicker tone="muted" as="div">
        {label}
      </Kicker>
      <div
        className={`font-mono type-title font-bold tabular-nums ${color ? "" : "text-white"}`}
        style={color ? { color } : undefined}
      >
        {value}
      </div>
      <div className="type-mono-sm text-slate-500">{unit}</div>
    </div>
  );
}

/**
 * A lift that has not been measured yet. The value slot holds the REAL mark for `not-judged` plus the
 * word, so the state travels with the figure and not only with the legend above it; the chip carries
 * why this particular lift is unjudged plus the canonical caveat ("an absence, never a zero").
 */
function UnjudgedLift({ label, why }: { label: string; why: string }) {
  return (
    <div className="min-w-[8rem]">
      <Kicker tone="muted" as="div">
        {label}
      </Kicker>
      <div className="flex items-center gap-1.5 py-1.5">
        <StateSwatch state="not-judged" />
        <span className="type-mono-sm text-slate-400">not judged</span>
        <WhyChip hint={`${why} ${STATE_HINT["not-judged"]}`} label={label} />
      </div>
    </div>
  );
}

const PLAYBOOK_WHY = "Lift needs a scan on both sides of the adoption mark, and no adopting repository has one yet.";
const PRACTICE_WHY = "Lift is stamped by the first scan after a starter PR merges; none has landed since.";

export function PracticeRolloutTotals({ rollout: r }: { rollout: PracticeRollout }) {
  return (
    <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
      <Stat
        label="Repos adopting"
        value={String(r.adoptingRepos)}
        unit={`${r.playbooksAdopted} playbook${r.playbooksAdopted === 1 ? "" : "s"}`}
      />
      <Stat label="Starter PRs" value={String(r.prsMerged)} unit={`landed · ${r.prsOpen} in flight`} />
      {r.playbookLift != null ? (
        <Stat
          label="Playbook lift"
          value={fmtDelta(r.playbookLift)}
          color={deltaHex(r.playbookLift)}
          unit={`avg pts · ${r.playbookMeasured} adoption${r.playbookMeasured === 1 ? "" : "s"}`}
        />
      ) : (
        <UnjudgedLift label="Playbook lift" why={PLAYBOOK_WHY} />
      )}
      {r.practiceLift != null ? (
        <Stat
          label="Practice PR lift"
          value={fmtDelta(r.practiceLift)}
          color={deltaHex(r.practiceLift)}
          unit={`avg pts · ${r.practiceLiftSources} practice${r.practiceLiftSources === 1 ? "" : "s"}`}
        />
      ) : (
        <UnjudgedLift label="Practice PR lift" why={PRACTICE_WHY} />
      )}
    </div>
  );
}
