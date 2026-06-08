"use client";

// Roadmap Sandbox — turns the static report into a planning surface. Drag any dimension's
// slider and the whole hero recomputes live, in the browser, with no re-scan: the overall
// ScoreRing + level, the radar shape, the Adoption × Rigor posture quadrant, and the fastest
// path to the next level. All math is the SAME archetype-weighted blend the engine used to score
// the repo (projectSandbox / cheapestPathToNextLevel), so a what-if is never a lie — with every
// slider at its current value the projection is byte-for-byte the report you're reading.

import { useId, useMemo, useState } from "react";
import type { DimensionId, LlmRoadmapItem, ScanReport } from "@/lib/types";
import { DIMENSION_BY_ID, LEVEL_BY_ID, LEVELS, clamp } from "@/lib/maturity/model";
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
import { PostureQuadrant, RadarChart, ScoreRing } from "@/components/report/Charts";
import { DeltaPill, DeltaTag } from "@/components/report/deltas";

type Overrides = Partial<Record<DimensionId, number>>;

export function RoadmapSandbox({ report }: { report: ScanReport }) {
  const [open, setOpen] = useState(false);
  const [overrides, setOverrides] = useState<Overrides>({});
  const panelId = useId();

  // Live recompute — pure, cheap (9 dimensions), re-run on every slider tick.
  const proj = useMemo(() => projectSandbox(report, overrides), [report, overrides]);

  // A projected report, so the "fastest path to the next level" recomputes from the slider state
  // (the gap shrinks as you drag) using the exact greedy planner the static report already uses.
  const projectedReport = useMemo<ScanReport>(
    () => ({
      ...report,
      overallScore: proj.overall.overallScore,
      level: LEVEL_BY_ID[proj.overall.level],
      adoptionScore: proj.adoptionScore,
      rigorScore: proj.rigorScore,
      posture: proj.posture,
      dimensions: proj.dimensions,
    }),
    [report, proj],
  );
  const path = useMemo(() => cheapestPathToNextLevel(projectedReport), [projectedReport]);

  const projectedLevel = LEVEL_BY_ID[proj.overall.level];
  const baseline = { adoption: report.adoptionScore, rigor: report.rigorScore };
  const anyChanged = report.dimensions.some((d) => (overrides[d.id] ?? d.score) !== d.score);

  const setDim = (id: DimensionId, v: number) =>
    setOverrides((o) => ({ ...o, [id]: clamp(Math.round(v)) }));
  const resetDim = (id: DimensionId) =>
    setOverrides((o) => {
      const next = { ...o };
      delete next[id];
      return next;
    });
  const resetAll = () => setOverrides({});
  const closeAllGaps = () =>
    setOverrides(Object.fromEntries(report.dimensions.map((d) => [d.id, 100])) as Overrides);

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-sm uppercase tracking-[0.25em] text-accent">Plan</div>
          <h2 className="mt-1 text-xl font-bold text-white">Roadmap sandbox</h2>
          <p className="mt-1 max-w-prose text-base leading-relaxed text-slate-400">
            What if Testing hit 80? Drag any dimension and watch your score, radar, posture, and
            next-level path recompute instantly — no re-scan.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          className="shrink-0 rounded-xl border border-slate-700 px-4 py-2 text-base font-medium text-slate-300 transition hover:border-accent hover:text-white"
        >
          {open ? "Close sandbox" : "Open sandbox →"}
        </button>
      </div>

      {open && (
        <div id={panelId} className="mt-6 space-y-6">
          {/* Polite live region — announces the projected headline as sliders move. */}
          <div role="status" aria-live="polite" className="sr-only">
            {`Projected score ${proj.overall.overallScore} of 100, level ${projectedLevel.id} ${projectedLevel.name}.`}
          </div>

          {/* Live hero + the sliders that drive it. */}
          <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
            <div className="flex flex-col items-center justify-start gap-3">
              <ScoreRing score={proj.overall.overallScore} level={projectedLevel} size={180} />
              <LevelTransition fromId={report.level.id} toId={proj.overall.level} levelUp={proj.overall.levelUp} />
              <DeltaPill delta={proj.overall.deltaScore} suffix="vs now" />
              <NextLevelBanner report={report} proj={proj} path={path} onSimulate={setOverrides} />
            </div>

            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-sm uppercase tracking-widest text-slate-500">
                  Drag to explore
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={closeAllGaps}
                    className="rounded-lg border border-slate-700 px-2.5 py-1 text-sm text-slate-300 transition hover:border-accent hover:text-white"
                  >
                    Close all gaps
                  </button>
                  <button
                    type="button"
                    onClick={resetAll}
                    disabled={!anyChanged}
                    className="rounded-lg border border-slate-700 px-2.5 py-1 text-sm text-slate-300 transition hover:border-accent hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Reset
                  </button>
                </div>
              </div>
              <div className="mt-3 space-y-2.5" role="group" aria-label="Dimension what-if sliders">
                {report.dimensions.map((d) => (
                  <DimensionSlider
                    key={d.id}
                    id={d.id}
                    name={d.name}
                    base={d.score}
                    value={overrides[d.id] ?? d.score}
                    onChange={(v) => setDim(d.id, v)}
                    onReset={() => resetDim(d.id)}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* The "watch the future" shape change: radar + posture quadrant re-render live, with a
              trail from where the repo sits today to where the sliders would take it. */}
          <div className="grid gap-6 md:grid-cols-2">
            <div className="flex flex-col rounded-xl border border-slate-800 bg-slate-950/30 p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-sm uppercase tracking-widest text-slate-500">Posture</span>
                <span className="text-base font-semibold" style={{ color: scoreHex(proj.adoptionScore) }}>
                  {proj.posture.label}
                </span>
              </div>
              <div className="flex items-center justify-center">
                <PostureQuadrant
                  adoption={proj.adoptionScore}
                  rigor={proj.rigorScore}
                  posture={proj.posture}
                  prev={baseline}
                  size={280}
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <AxisStat label="AI Adoption" value={proj.adoptionScore} base={report.adoptionScore} />
                <AxisStat label="Eng. Rigor" value={proj.rigorScore} base={report.rigorScore} />
              </div>
            </div>
            <div className="flex flex-col items-center justify-center rounded-xl border border-slate-800 bg-slate-950/30 p-4">
              <span className="self-start font-mono text-sm uppercase tracking-widest text-slate-500">
                Projected radar
              </span>
              <RadarChart dimensions={proj.dimensions} size={320} />
            </div>
          </div>

          {/* Roadmap items, wired to the sliders: "Try it" closes that gap and the whole hero
              recomputes — making the payoff of each investment tangible before committing. */}
          {report.roadmap.length > 0 && (
            <RoadmapSimulators
              report={report}
              overrides={overrides}
              path={path}
              onTry={(id) => setDim(id, 100)}
            />
          )}
        </div>
      )}
    </section>
  );
}

/** A single dimension slider with a baseline tick, its current→target readout, and a per-row reset. */
function DimensionSlider({
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
function LevelTransition({
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
function AxisStat({ label, value, base }: { label: string; value: number; base: number }) {
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
function NextLevelBanner({
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
function RoadmapSimulators({
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
