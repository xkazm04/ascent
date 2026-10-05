// One reviewed candidate. Extracted purely for the 200-LOC features cap; it renders what
// skillRetireModel already decided and holds no state of its own.
//
// The row's job is the blast radius: the repos that recorded this skill, when it was last used and how
// long ago, and the window the verdict was measured against. All three are shown BEFORE the ask, which is
// the whole difference between this and the per-row `archive` link it replaces.

import {
  blastRadiusLabel,
  judgedWindowLabel,
  lastUseLabel,
  type RetireCandidate,
} from "./skillRetireModel";

export function SkillRetireSweepRow({ c }: { c: RetireCandidate }) {
  return (
    <li
      data-testid={`retire-candidate-${c.id}`}
      data-skill={c.id}
      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-slate-800/80 py-2 first:border-t-0"
    >
      <span className="min-w-0 truncate type-mono-sm text-slate-200" title={c.name}>
        {c.name}
      </span>
      <span data-testid="retire-blast" className="type-body-sm text-slate-400">
        {blastRadiusLabel(c.adoptedRepos)}
      </span>
      <span className="type-body-sm text-slate-500">{lastUseLabel(c.lastUsedAt, c.daysSinceUse)}</span>
      <span className="type-body-sm text-slate-600">{judgedWindowLabel(c.windowDays)}</span>
      {!c.retirable && c.reason && (
        <span data-testid="retire-refusal" className="type-body-sm text-amber-300/80">
          Not retirable here. {c.reason}
        </span>
      )}
    </li>
  );
}
