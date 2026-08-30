// The Altimeter's nine dimension gauges, grouped by SDLC phase (dimensionReading's SDLC_PHASES).
// Each dial is a column on the SAME 0–100 scale as the main gauge: the level strata as faint rules,
// a bar to today's average in its score colour, and — with a baseline — a dashed "was" mark joined
// to "is" by a stroke in the delta colour, so movement is read as distance, not as a glyph. Every
// dial is a link to the heatmap ranked weakest-first on that dimension (the ▦ affordance of the
// ledger, promoted to the whole cell). No hooks — server-safe.

import Link from "next/link";
import { InlineEmpty } from "@/components/org/shared/ui";
import { deltaHex, fmtDelta } from "@/components/ui/format";
import { LEVELS, clamp } from "@/lib/maturity/model";
import { buildUrl, clearedTabScopedParams } from "@/lib/org/orgTabs";
import { scoreHex } from "@/lib/ui";
import { groupByPhase, type DimensionReading } from "./dimensionReading";

export function OverviewAltimeterDials({
  readings,
  slug,
  search,
  owed,
  className = "",
}: {
  readings: DimensionReading[];
  slug: string;
  search: string;
  owed: number;
  className?: string;
}) {
  const groups = groupByPhase(readings);
  return (
    <div className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="type-label tracking-[0.22em] text-slate-500">Dimensions · by SDLC phase</span>
        <span className="type-caption tabular-nums text-slate-500">
          {owed === 0 ? "every dial in the green band" : `${owed} of ${readings.length} dials below green`}
        </span>
      </div>
      {groups.length === 0 ? (
        <InlineEmpty>No dimension has a score in this view yet.</InlineEmpty>
      ) : (
        <div className="mt-4 grid gap-x-8 gap-y-6 md:grid-cols-3">
          {groups.map((g) => (
            <div key={g.phase.id} className="min-w-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="type-caption uppercase tracking-[0.18em] text-slate-400" title={g.phase.question}>
                  {g.phase.label}
                </span>
                {g.avg !== null && (
                  <span className="type-caption tabular-nums text-slate-500">
                    avg{" "}
                    <span className="font-semibold" style={{ color: scoreHex(g.avg) }}>
                      {g.avg}
                    </span>
                  </span>
                )}
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {g.rows.map((r) => (
                  <Dial key={r.dimId} r={r} slug={slug} search={search} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Dial({ r, slug, search }: { r: DimensionReading; slug: string; search: string }) {
  const color = scoreHex(r.avg);
  const prev = r.delta === null ? null : clamp(r.avg - r.delta);
  const moved = prev !== null && r.delta !== 0;
  const href = `${buildUrl(slug, { ...clearedTabScopedParams(), dim: r.dimId }, search)}#heatmap`;
  return (
    <Link
      href={href}
      className="focus-ring group min-w-0 rounded-lg border border-transparent p-1.5 transition hover:border-divider hover:bg-surface/40"
      title={`${r.name} · ${r.avg} (${r.status})${r.note ? ` · ${r.note}` : ""} — rank the fleet weakest-first on it`}
    >
      <svg viewBox="0 0 40 100" preserveAspectRatio="none" className="h-24 w-full" aria-hidden>
        {LEVELS.map((l) => (
          <line key={l.id} x1={0} x2={40} y1={100 - l.band[0]} y2={100 - l.band[0]} stroke="var(--color-divider)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        <rect x={13} width={14} y={100 - r.avg} height={r.avg} fill={color} opacity={0.85} />
        {moved && (
          <>
            <line x1={9} x2={31} y1={100 - prev} y2={100 - prev} stroke="var(--color-tone-flat)" strokeWidth={1} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
            <line x1={20} x2={20} y1={100 - prev} y2={100 - r.avg} stroke={deltaHex(r.delta ?? 0)} strokeWidth={2} vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      <div className="mt-1.5 flex items-baseline justify-between gap-1">
        <span className="type-micro min-w-0 truncate uppercase tracking-[0.12em] text-slate-400 group-hover:text-white">{r.short}</span>
        <span className="type-mono-sm shrink-0 font-semibold tabular-nums" style={{ color }}>
          {r.avg}
        </span>
      </div>
      <div
        className="type-micro tabular-nums"
        style={{ color: r.delta === null ? undefined : r.delta === 0 ? undefined : deltaHex(r.delta) }}
      >
        {r.delta === null ? <span className="text-slate-600">— no baseline</span> : r.delta === 0 ? <span className="text-slate-500">→ holding</span> : fmtDelta(r.delta)}
      </div>
    </Link>
  );
}
