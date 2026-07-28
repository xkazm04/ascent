// The headline block of a public org scorecard: the aggregate score + level, the adoption/rigor split,
// and the nine-dimension strip. Presentational + pure (no hooks, no handlers) so the scorecard page
// stays a server component and its numbers are in the crawled HTML.
//
// It draws a number ONLY when a model actually produced one. `verifiedCount === 0` renders the refusal
// state instead — the same rule the share card applies to an incomplete scan and the badge applies via
// its `demo` qualifier. There is no code path here that renders an average over mock scores.

import type { PublicOrgScorecard } from "@/lib/register/data";
import type { DimensionId, LevelId } from "@/lib/types";
import { DIMENSIONS, DIMENSION_BY_ID } from "@/lib/maturity/model";
import { DIMENSION_SHORT, LEVEL_GLYPH, LEVEL_HEX, scoreHex } from "@/lib/ui";

const DIMS: DimensionId[] = DIMENSIONS.map((d) => d.id);

export function ScorecardSummary({ card }: { card: PublicOrgScorecard }) {
  if (card.verifiedCount === 0) {
    return (
      <div className="mt-8 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-8">
        <p className="text-lg font-semibold text-white">No published score yet</p>
        <p className="mt-2 max-w-2xl text-base leading-relaxed text-slate-400">
          All {card.repoCount} scanned public {card.repoCount === 1 ? "repository" : "repositories"} for{" "}
          {card.owner} were scored by the deterministic preview rubric — no model contributed a
          judgement. Ascent will not publish a maturity number a model never produced, so this scorecard
          stays blank until a real scan lands.
        </p>
      </div>
    );
  }

  const levelHex = LEVEL_HEX[card.level as LevelId] ?? "#94a3b8";

  return (
    <div className="mt-8 rounded-2xl border border-divider bg-surface/40 p-8">
      <div className="flex flex-wrap items-end gap-x-10 gap-y-6">
        <div>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
            Fleet maturity
          </span>
          <div className="flex items-baseline">
            <span className="text-6xl font-bold tabular-nums" style={{ color: levelHex }}>
              {card.avgOverall}
            </span>
            <span className="text-2xl font-semibold text-slate-500">/100</span>
          </div>
          <span className="mt-1 flex items-center gap-2 font-mono text-sm font-bold" style={{ color: levelHex }}>
            <span aria-hidden>{LEVEL_GLYPH[card.level as LevelId]}</span>
            {card.level} · {card.levelName}
          </span>
        </div>

        <dl className="flex gap-8">
          {[
            { label: "Adoption", value: card.avgAdoption },
            { label: "Rigor", value: card.avgRigor },
            { label: "Scored repos", value: card.verifiedCount },
          ].map((s) => (
            <div key={s.label}>
              <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">{s.label}</dt>
              <dd className="mt-1 font-mono text-2xl font-bold tabular-nums text-white">{s.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="mt-8 grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-5 lg:grid-cols-9">
        {DIMS.map((d) => {
          const v = card.dimensions[d];
          return (
            <div key={d} className="text-center" title={DIMENSION_BY_ID[d].name}>
              <span className="block font-mono text-[10px] uppercase tracking-wider text-slate-500">
                {DIMENSION_SHORT[d]}
              </span>
              <span
                className="mt-1 block font-mono text-lg font-bold tabular-nums"
                style={{ color: v == null ? "#334155" : scoreHex(v) }}
              >
                {v ?? "—"}
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-6 border-t border-divider pt-4 text-xs leading-relaxed text-slate-500">
        Averaged across {card.verifiedCount} model-scored public{" "}
        {card.verifiedCount === 1 ? "repository" : "repositories"}
        {card.repoCount > card.verifiedCount && (
          <>
            {" "}
            ({card.repoCount - card.verifiedCount} further{" "}
            {card.repoCount - card.verifiedCount === 1 ? "repository was" : "repositories were"} preview-scored
            only and excluded from every number above)
          </>
        )}
        . Private repositories are never included — this page is a lens over the public scan corpus, not
        over any organisation&apos;s Ascent workspace.
      </p>
    </div>
  );
}
