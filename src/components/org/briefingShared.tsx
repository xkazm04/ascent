// Shared briefing UI blocks rendered identically by the authenticated executive page
// (/org/[slug]/executive) and the session-less public share page (/share/briefing/[token]). The share
// page was assembled by copy-pasting render blocks out of the executive page, so the dimension row and
// the "vs previous period" comparison grid lived inline in both — and the share grid had drifted,
// hand-rolling delta color/sign instead of the canonical deltaHex/fmtDelta. Extracting them here
// single-sources both and corrects the share view to the canonical delta presentation.

import { Meter, deltaHex, fmtDelta } from "@/components/org/ui";
import { scoreHex } from "@/lib/ui";

/** One dimension row: id · label, a score Meter, and the right-aligned numeric readout. */
export function DimRow({ dimId, label, avg }: { dimId: string; label: string; avg: number }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-24 shrink-0 text-slate-400">{dimId} · {label}</span>
      <Meter className="flex-1" value={avg} color={scoreHex(avg)} />
      <span className="w-7 text-right font-mono tabular-nums" style={{ color: scoreHex(avg) }}>{avg}</span>
    </div>
  );
}

type PriorPeriod = {
  overall: number;
  adoption: number;
  rigor: number;
  dOverall: number;
  dAdoption: number;
  dRigor: number;
  dims: { dimId: string; label: string; now: number; prior: number; delta: number }[];
};

/**
 * The "vs previous period" comparison grid: a 3-cell headline (Overall/Adoption/Rigor) showing the
 * current score, its prior value, and the signed delta through the canonical deltaHex/fmtDelta helpers.
 * With `showDimensions`, appends the per-dimension now→prior breakdown the exec page wants (the share
 * page omits it).
 */
export function PriorPeriodGrid({
  prior,
  now,
  showDimensions = false,
}: {
  prior: PriorPeriod;
  now: { overall: number; adoption: number; rigor: number };
  showDimensions?: boolean;
}) {
  return (
    <>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {([
          ["Overall", prior.overall, now.overall, prior.dOverall],
          ["Adoption", prior.adoption, now.adoption, prior.dAdoption],
          ["Rigor", prior.rigor, now.rigor, prior.dRigor],
        ] as const).map(([label, priorVal, nowVal, delta]) => (
          <div key={label} className="rounded-xl border border-slate-800 bg-slate-950/30 p-3">
            <div className="font-mono text-sm uppercase tracking-widest text-slate-500">{label}</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-2xl font-bold tabular-nums" style={{ color: scoreHex(nowVal) }}>{nowVal}</span>
              <span className="font-mono text-sm text-slate-500">from {priorVal}</span>
              <span className="font-mono text-sm" style={{ color: deltaHex(delta) }}>{fmtDelta(delta)}</span>
            </div>
          </div>
        ))}
      </div>
      {showDimensions && prior.dims.some((d) => d.delta !== 0) && (
        <div className="mt-3 space-y-1.5 border-t border-slate-800/70 pt-3">
          {prior.dims
            .filter((d) => d.delta !== 0)
            .map((d) => (
              <div key={d.dimId} className="flex items-center justify-between gap-3 font-mono text-sm">
                <span className="text-slate-400">{d.dimId} · {d.label}</span>
                <span>
                  <span className="text-slate-500">{d.prior} → </span>
                  <span style={{ color: scoreHex(d.now) }}>{d.now}</span>{" "}
                  <span style={{ color: deltaHex(d.delta) }}>{fmtDelta(d.delta)}</span>
                </span>
              </div>
            ))}
        </div>
      )}
    </>
  );
}
