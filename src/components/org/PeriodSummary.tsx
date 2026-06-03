// The "Quarter in review" banner — an auto-written summary of the fleet's net movement over the
// selected window. Reads the rollup's baseline/deltas (period-over-period) and the windowed movers
// (level changes) and turns them into a sentence: did the org climb, and who leveled up/down.
// Server-safe (no client hooks). Renders nothing without a baseline (e.g. the "All time" range).
import { deltaHex, fmtDelta, signedDelta } from "@/components/org/ui";
import type { OrgMovers, OrgRollup } from "@/lib/db";
import type { ResolvedWindow } from "@/lib/window";

function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

export function PeriodSummary({
  window,
  rollup,
  movers,
}: {
  window: ResolvedWindow;
  rollup: OrgRollup;
  movers: OrgMovers | null;
}) {
  const { baseline, deltas } = rollup;
  if (!baseline || !deltas) return null;

  const promoted = movers?.levelChanges.filter((m) => m.levelDelta > 0).length ?? 0;
  const demoted = movers?.levelChanges.filter((m) => m.levelDelta < 0).length ?? 0;

  const maturity =
    deltas.overall === 0
      ? `Fleet maturity held at ${rollup.avgOverall}.`
      : `Fleet maturity ${deltas.overall > 0 ? "climbed" : "slipped"} ${signedDelta(deltas.overall)} to ${rollup.avgOverall} (from ${baseline.avgOverall}).`;

  const levels =
    promoted || demoted
      ? `${promoted ? `${promoted} ${plural(promoted, "repo")} leveled up` : ""}${promoted && demoted ? ", " : ""}${demoted ? `${demoted} slipped a level` : ""}.`
      : "No level changes across the fleet.";

  return (
    <div className="rounded-2xl border border-accent/30 bg-accent/[0.06] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="text-2xl" aria-hidden>
            🏔️
          </span>
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.25em] text-accent">{window.reviewTitle}</div>
            <p className="mt-1.5 max-w-2xl text-sm text-slate-200">
              {maturity} {levels}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-slate-400">
              <span>
                overall {baseline.avgOverall} → {rollup.avgOverall}
              </span>
              <span>
                adoption <span style={{ color: deltaHex(deltas.adoption) }}>{signedDelta(deltas.adoption)}</span>
              </span>
              <span>
                rigor <span style={{ color: deltaHex(deltas.rigor) }}>{signedDelta(deltas.rigor)}</span>
              </span>
              {promoted > 0 && <span className="text-lime-400">▲ {promoted} promoted</span>}
              {demoted > 0 && <span className="text-orange-400">▼ {demoted} demoted</span>}
              <span className="text-slate-600">across {baseline.repos} {plural(baseline.repos, "repo")}</span>
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-3xl font-bold tabular-nums" style={{ color: deltaHex(deltas.overall) }}>
            {fmtDelta(deltas.overall)}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-slate-500">net maturity</div>
        </div>
      </div>
    </div>
  );
}
