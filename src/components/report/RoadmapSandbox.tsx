"use client";

// Roadmap Sandbox — turns the static report into a planning surface. Drag any dimension's
// slider and the whole hero recomputes live, in the browser, with no re-scan: the overall
// ScoreRing + level, the radar shape, the Adoption × Rigor posture quadrant, and the fastest
// path to the next level. All math is the SAME archetype-weighted blend the engine used to score
// the repo (projectSandbox / cheapestPathToNextLevel), so a what-if is never a lie — with every
// slider at its current value the projection is byte-for-byte the report you're reading.

import { useId, useMemo, useState } from "react";
import type { DimensionId, ScanReport } from "@/lib/types";
import { LEVEL_BY_ID, clamp } from "@/lib/maturity/model";
import { cheapestPathToNextLevel, projectSandbox } from "@/lib/scoring/engine";
import { scoreHex } from "@/lib/ui";
import { PostureQuadrant, RadarChart, ScoreRing } from "@/components/report/Charts";
import { DeltaPill } from "@/components/report/deltas";
import {
  AxisStat,
  DimensionSlider,
  LevelTransition,
  NextLevelBanner,
  RoadmapSimulators,
  type Overrides,
} from "@/components/report/RoadmapSandboxParts";

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
