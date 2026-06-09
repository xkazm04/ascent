"use client";

// Sub-components for the Roadmap Sandbox: the per-dimension sliders, the now → projected level
// transition, the projected axis stats, the "how close am I" next-level banner, and the
// per-recommendation simulators. Pure presentational pieces driven by the sandbox's slider state.

import type { DimensionId, LlmRoadmapItem, ScanReport } from "@/lib/types";
import { DIMENSION_BY_ID, LEVEL_BY_ID, LEVELS } from "@/lib/maturity/model";
import { cheapestPathToNextLevel, projectSandbox } from "@/lib/scoring/engine";
import {
  DIMENSION_SHORT,
  EFFORT_CLASS,
  IMPACT_CLASS,
  LEVEL_CLASSES,
  LEVEL_GLYPH,
  scoreGlyph,
  scoreHex,
} from "@/lib/ui";
import { DeltaTag } from "@/components/report/deltas";

export type Overrides = Partial<Record<DimensionId, number>>;

/** A single dimension slider with a baseline tick, its current→target readout, and a per-row reset. */
export function DimensionSlider({
  id,
  name,
  base,
  value,
  onChange,
  onReset,
}: {
  id: DimensionId;
  name: string;
  base: number;
  value: number;
  onChange: (v: number) => void;
  onReset: () => void;
}) {
  const changed = value !== base;
  const color = scoreHex(value);
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
      <div className="flex items-center justify-between gap-2 text-base">
        <span className="flex min-w-0 items-center gap-2">
          <span className="font-mono text-sm text-slate-500">{id}</span>
          <span className="truncate font-medium text-white">{DIMENSION_SHORT[id]}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2 font-mono tabular-nums">
          {changed && <span className="text-sm text-slate-600">{base}→</span>}
          <span className="flex w-9 items-center justify-end gap-1 text-base font-bold" style={{ color }}>
            <span aria-hidden className="text-sm">{scoreGlyph(value)}</span>
            {value}
          </span>
          <span className="w-9 text-right">
            <DeltaTag delta={value - base} hideZero />
          </span>
          <button
            type="button"
            onClick={onReset}
            disabled={!changed}
            aria-label={`Reset ${name} to ${base}`}
            className="text-slate-500 transition hover:text-white disabled:opacity-0"
          >
            ↺
          </button>
        </span>
      </div>
      <div className="relative mt-1.5">
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={`${name} projected score`}
          aria-valuetext={`${value} of 100${changed ? `, baseline ${base}` : ""}`}
          style={{ accentColor: color }}
          className="w-full cursor-pointer"
        />
        {/* Baseline marker — where the repo scores today (approximate at the extremes). */}
        <span
          aria-hidden
          title={`Current: ${base}`}
          className="pointer-events-none absolute -top-0.5 h-2.5 w-px bg-slate-500"
          style={{ left: `${base}%` }}
        />
      </div>
    </div>
  );
}

/** Now → projected level, with the target chip lit when the change levels you up. */
export function LevelTransition({
  fromId,
  toId,
  levelUp,
}: {
  fromId: ScanReport["level"]["id"];
  toId: ScanReport["level"]["id"];
  levelUp: boolean;
}) {
  const from = LEVEL_BY_ID[fromId];
  const to = LEVEL_BY_ID[toId];
  const down = LEVELS.findIndex((l) => l.id === toId) < LEVELS.findIndex((l) => l.id === fromId);
  return (
    <div className="flex items-center gap-2 text-sm">
      <LevelChip id={from.id} name={from.name} muted />
      <span aria-hidden className={levelUp ? "text-emerald-400" : down ? "text-red-400" : "text-slate-600"}>
        →
      </span>
      <LevelChip id={to.id} name={to.name} highlight={levelUp} demoted={down} />
    </div>
  );
}

function LevelChip({
  id,
  name,
  muted = false,
  highlight = false,
  demoted = false,
}: {
  id: ScanReport["level"]["id"];
  name: string;
  muted?: boolean;
  highlight?: boolean;
  demoted?: boolean;
}) {
  const lc = LEVEL_CLASSES[id];
  const cls = muted
    ? "border-slate-700 bg-slate-900/60 text-slate-400"
    : demoted
      ? "border-red-500/40 bg-red-500/10 text-red-300"
      : `${lc.border} ${lc.bg} ${lc.text}`;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-semibold ${cls} ${
        highlight ? "ring-1 ring-emerald-400/50" : ""
      }`}
    >
      <span aria-hidden>{LEVEL_GLYPH[id]}</span>
      {id} {name}
    </span>
  );
}

/** Projected axis value with its baseline delta — the two numbers the posture quadrant plots. */
export function AxisStat({ label, value, base }: { label: string; value: number; base: number }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
      <div className="font-mono text-sm uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span className="font-mono text-lg font-bold tabular-nums" style={{ color: scoreHex(value) }}>
          {value}
        </span>
        <DeltaTag delta={value - base} hideZero />
      </div>
    </div>
  );
}

/** The live "how close am I" callout — celebrates a level-up, or shows the cheapest remaining
 *  path to the next band and a button that simulates closing exactly those gaps. */
export function NextLevelBanner({
  report,
  proj,
  path,
  onSimulate,
}: {
  report: ScanReport;
  proj: ReturnType<typeof projectSandbox>;
  path: ReturnType<typeof cheapestPathToNextLevel>;
  onSimulate: (updater: (o: Overrides) => Overrides) => void;
}) {
  // Did this what-if cross into a higher band than the repo's real level?
  const leveledUp = proj.overall.levelUp;
  const target = path.target;

  if (!target) {
    return (
      <p className="text-center text-sm leading-relaxed text-slate-500">
        {report.level.id === "L5"
          ? "Top of the ladder — the work now is sustaining trust."
          : "Sustaining the summit."}
      </p>
    );
  }

  const gap = Math.max(0, target.score - proj.overall.overallScore);
  const names = path.steps.map((s) => DIMENSION_SHORT[s.dimension]).join(" + ");
  const applyPath = () =>
    onSimulate((o) => {
      const next = { ...o };
      for (const s of path.steps) next[s.dimension] = 100;
      return next;
    });

  return (
    <div className="w-full rounded-xl border border-accent/20 bg-accent/[0.06] p-3 text-center text-sm">
      {leveledUp && (
        <div className="mb-1 font-semibold text-emerald-300">
          🎉 Unlocks {LEVEL_BY_ID[proj.overall.level].id} {LEVEL_BY_ID[proj.overall.level].name}
        </div>
      )}
      <p className="leading-relaxed text-slate-300">
        <span className="font-semibold text-white">{gap} pts</span> to{" "}
        <span className="font-semibold" style={{ color: scoreHex(target.score) }}>
          {target.level} {target.name}
        </span>
        {names && (
          <>
            {" "}
            — fastest via <span className="font-semibold text-white">{names}</span>
          </>
        )}
      </p>
      {path.steps.length > 0 && (
        <button
          type="button"
          onClick={applyPath}
          className="mt-2 rounded-lg border border-accent/40 px-2.5 py-1 font-medium text-accent transition hover:bg-accent/10"
        >
          Simulate this path
        </button>
      )}
    </div>
  );
}

/** Roadmap items as one-click what-ifs: "Try it" closes that dimension's gap so the payoff of the
 *  recommendation shows up immediately in the ring, radar, and posture above. */
export function RoadmapSimulators({
  report,
  overrides,
  path,
  onTry,
}: {
  report: ScanReport;
  overrides: Overrides;
  path: ReturnType<typeof cheapestPathToNextLevel>;
  onTry: (id: DimensionId) => void;
}) {
  const onPath = new Set(path.steps.map((s) => s.dimension));
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
      <div className="font-mono text-sm uppercase tracking-widest text-slate-500">
        Simulate a recommendation
      </div>
      <ul className="mt-3 space-y-2">
        {report.roadmap.map((item: LlmRoadmapItem, i) => {
          const dimName = DIMENSION_BY_ID[item.dimension]?.name ?? item.dimension;
          const applied = (overrides[item.dimension] ?? -1) === 100;
          const unlocks = onPath.has(item.dimension);
          return (
            <li
              key={i}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm text-slate-500" title={dimName}>
                    {DIMENSION_SHORT[item.dimension]}
                  </span>
                  <span className="truncate text-base font-medium text-white">{item.title}</span>
                  {unlocks && (
                    <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-sm font-semibold uppercase tracking-wide text-emerald-300">
                      ⤴ on the path
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-sm">
                  <span className={`rounded border px-1.5 py-0.5 ${IMPACT_CLASS[item.impact]}`}>
                    impact {item.impact}
                  </span>
                  <span className={`rounded border px-1.5 py-0.5 ${EFFORT_CLASS[item.effort]}`}>
                    effort {item.effort}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onTry(item.dimension)}
                aria-pressed={applied}
                className={`shrink-0 rounded-lg border px-2.5 py-1 text-sm font-medium transition ${
                  applied
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-slate-700 text-slate-300 hover:border-accent hover:text-white"
                }`}
              >
                {applied ? "Applied ✓" : "Try it →"}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
