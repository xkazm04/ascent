"use client";

// Kit batch 5 specimen (2026-10-22): the data-viz components in their Prism treatment. Each was an
// Altimeter-only specimen gap (PRISM-MIGRATION-GAPS.md): ScoreRing, AltimeterGauge, RadarChart,
// StackRadarChart, the MatrixGrid heat cells and LevelBadge. Synthetic data only; nothing here is a measurement.
import { useState } from "react";
import { HonestyTag } from "@/components/kit";
import { LevelBadge, ScorePill } from "@/components/LevelBadge";
import { ScoreRing } from "@/components/report/ScoreRing";
import { RadarChart } from "@/components/report/RadarChart";
import { AltimeterGauge } from "@/components/report/AltimeterGauge";
import { dimFacts } from "@/components/report/dimensionExplorerDerive";
import { StackRadarChart } from "@/features/standing/tech-stacks/StackRadarChart";
import { MatrixGrid } from "@/components/shared/viz";
import { DIMENSIONS, LEVELS, levelForScore } from "@/lib/maturity/model";
import type { DimensionId, DimensionResult } from "@/lib/types";

const SCORES = [72, 58, 81, 44, 90, 36, 66, 77, 52];
const PREV = [66, 58, 75, 50, 90, 30, 66, 70, 52];
const DIMS: DimensionResult[] = DIMENSIONS.map((d, i) => ({
  id: d.id,
  name: d.name,
  weight: d.weight,
  score: SCORES[i] ?? 50,
  signalScore: SCORES[i] ?? 50,
  llmScore: SCORES[i] ?? 50,
  summary: "",
  evidence: [],
  strengths: [],
  gaps: [],
}));
const FACTS = DIMS.map((d, i) => dimFacts(d, PREV[i]));
const IDS = DIMS.map((d) => d.id as string);
const LEVEL = (id: string) => LEVELS.find((l) => l.id === id)!;

const SERIES = [
  { id: "a", name: "Web stack", color: "#f2eee6", values: SCORES as (number | null)[] },
  { id: "b", name: "Data stack", color: "#a1a6ba", values: [60, 70, 40, 55, 62, null, 48, 71, 58] as (number | null)[] },
];

const MATRIX_ROWS = [
  { id: "r1", label: "Agent guidance", cells: [{ state: "measured" as const, score: 92 }, { state: "measured" as const, score: 64 }, { state: "declared" as const, score: 40 }] },
  { id: "r2", label: "Test discipline", cells: [{ state: "measured" as const, score: 38 }, { state: "not-judged" as const }, { state: "missing" as const }] },
  { id: "r3", label: "Release gates", cells: [{ state: "measured" as const, score: 77 }, { state: "measured" as const, score: 12 }, { state: "measured" as const, score: 55 }] },
];

function Row({ name, note, children }: { name: string; note: string; children: React.ReactNode }) {
  return (
    <div data-specimen={`b5-${name}`} className="grid gap-4 border-t border-divider py-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="space-y-2">
        <p className="font-mono type-mono-sm text-slate-300">{name}</p>
        <p className="type-note text-slate-400">{note}</p>
      </div>
      <div className="min-w-0 space-y-3">{children}</div>
    </div>
  );
}

export function KitViz() {
  const [sel, setSel] = useState<DimensionId>(DIMS[0]!.id);
  return (
    <section aria-label="Kit batch 5" className="mt-12">
      <p className="type-label tracking-[0.22em] text-slate-400">Batch 5 · charts, heat cells and level marks</p>
      <Row name="ScoreRing" note="A paper arc on a hairline track. The level is the glyph, the id and a word: lightness, not hue.">
        <div className="flex flex-wrap items-center gap-8">
          <ScoreRing score={72} level={LEVEL("L4")} size={160} />
          <ScoreRing score={34} level={LEVEL("L2")} size={160} engine="mock" />
          <HonestyTag kind="illustrative" />
        </div>
      </Row>
      <Row name="AltimeterGauge" note="Nine climbers on five strata. A rope takes its dimension's hue (the one place hue names something); strata are paper washes; labels are sans.">
        <AltimeterGauge facts={FACTS} selectedId={sel} onSelect={setSel} mounted reduced />
      </Row>
      <Row name="RadarChart" note="One paper profile. Each axis is ruled in its dimension's hue at half strength; the zero ring and the hollow mock vertex are unchanged.">
        <RadarChart dimensions={DIMS} size={300} highlightId={sel} onSelect={setSel} />
      </Row>
      <Row name="StackRadarChart" note="Several stacks overlaid; a null value breaks the ring instead of plotting a zero. Series colour is the caller's (paper and mute here).">
        <div className="mx-auto aspect-square w-full max-w-[340px]">
          <StackRadarChart series={SERIES} dims={IDS} />
        </div>
      </Row>
      <Row name="MatrixGrid heat cells" note="Score is paper lightness (6 to 36% over void). Hatched = not judged, empty = no measurement, outlined = declared only.">
        <MatrixGrid axes={["Declared", "Observed", "Enforced"]} rows={MATRIX_ROWS} title="Practice ledger" />
      </Row>
      <Row name="LevelBadge · ScorePill" note="A hairline tag at 3px. L1 is dim, L5 is paper; the glyph repeats the level for anyone who cannot see lightness.">
        <div className="flex flex-wrap items-center gap-3">
          {LEVELS.map((l) => (
            <LevelBadge key={l.id} id={l.id} name={l.name} />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 type-body-sm">
          {[88, 66, 51, 30, 12].map((n) => (
            <ScorePill key={n} level={levelForScore(n).id} overall={n} className="px-2 py-0.5" />
          ))}
        </div>
      </Row>
    </section>
  );
}
