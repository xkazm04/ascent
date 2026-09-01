"use client";

// Variant: MIRROR — the two witnesses. Every score on this page is a blend of what the deterministic
// detectors measured and what the model judged; the baseline says so in a sentence and then shows
// only the result. This variant makes the disagreement THE picture: a butterfly per dimension, the
// detector wing opening left, the model wing opening right, the blended score on the spine. A wide,
// lopsided butterfly is where the model argued; a clipped wing is where its judgment was ignored by
// design (D9 signal-only, D1/D4 cited-claim). The takeaway line counts the arguments.

import { useState } from "react";
import type { DimensionId, ScanReport } from "@/lib/types";
import { scoreGlyph, scoreHex } from "@/lib/ui";
import { fillBarStyle, useMounted, usePrefersReducedMotion } from "@/components/report/chartMotion";
import type { TrendPoint } from "@/components/report/TrendChart";
import { DimensionDetail } from "@/components/report/DimensionDetail";
import { dimFacts, provenanceLabel, type DimFacts } from "@/components/report/dimensionExplorerDerive";
import { EmptyState } from "@/components/EmptyState";
import { Kicker, SectionHeading, Surface, chipButtonClass, signedDelta } from "@/components/ui";

export function DimensionExplorerMirror({
  report,
  prevDimScores,
  dimSeries,
}: {
  report: ScanReport;
  prevDimScores: Map<string, number> | null;
  dimSeries: Map<string, TrendPoint[]> | null;
}) {
  const facts = report.dimensions.map((d) => dimFacts(d, prevDimScores?.get(d.id), report.scoreIntegrity));
  const [selectedId, setSelectedId] = useState<DimensionId | null>(facts[0]?.id ?? null);
  const [byDisagreement, setByDisagreement] = useState(false);
  const reduced = usePrefersReducedMotion();
  const mounted = useMounted();
  const sel = facts.find((f) => f.id === selectedId) ?? facts[0];

  if (!sel) {
    return (
      <section aria-label="Dimensions" data-testid="report-tab-dimensions">
        <EmptyState variant="section" title="No dimensions were scored" body="Nothing could be measured on this scan." />
      </section>
    );
  }

  const blended = facts.filter((f) => f.provenance.kind === "blended");
  const above = blended.filter((f) => f.divergence > 0).length;
  const below = blended.filter((f) => f.divergence < 0).length;
  const widest = [...blended].sort((a, b) => Math.abs(b.divergence) - Math.abs(a.divergence))[0];
  const ignored = facts.filter((f) => f.provenance.kind !== "blended").map((f) => f.id);
  const rows = byDisagreement ? [...facts].sort((a, b) => Math.abs(b.divergence) - Math.abs(a.divergence)) : facts;
  const line = [
    `The model argued above the detectors on ${above} and below on ${below} of ${blended.length} blended dimensions`,
    widest ? `widest gap ${widest.short} (${signedDelta(widest.divergence)})` : null,
    ignored.length ? `${ignored.join(", ")} scored without the model's number` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section aria-label="Dimensions" data-testid="report-tab-dimensions" className="space-y-6">
      <SectionHeading
        kicker="Dimension breakdown"
        kickerTone="accent"
        title="Two witnesses per dimension"
        intro={`${line}.`}
        right={
          <button
            type="button"
            aria-pressed={byDisagreement}
            onClick={() => setByDisagreement((v) => !v)}
            className={chipButtonClass("idle", byDisagreement ? "border-accent text-white" : "")}
          >
            Sort by disagreement
          </button>
        }
      />

      <Surface tone="strong" className="px-4 py-3">
        <div className="grid grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] gap-x-3 px-1 pb-2">
          <Kicker tone="muted" className="text-right">◀ detector signal</Kicker>
          <span />
          <Kicker tone="muted">model judgment ▶</Kicker>
        </div>
        <div className="space-y-1" aria-label="Detector versus model score per dimension">
          {rows.map((f, i) => (
            <MirrorRow key={f.id} f={f} index={i} selected={f.id === sel.id} onSelect={() => setSelectedId(f.id)} mounted={mounted} reduced={reduced} />
          ))}
        </div>
      </Surface>

      <Surface radius="2xl" className="p-5">
        <div key={sel.id} className="animate-fade-in">
          <DimensionDetail d={sel.d} prevScore={prevDimScores?.get(sel.id)} series={dimSeries?.get(sel.id)} integrity={report.scoreIntegrity} />
        </div>
      </Surface>
    </section>
  );
}

/** One butterfly: detector wing (left, slate), model wing (right, accent), blended score on the spine. */
function MirrorRow({
  f,
  index,
  selected,
  onSelect,
  mounted,
  reduced,
}: {
  f: DimFacts;
  index: number;
  selected: boolean;
  onSelect: () => void;
  mounted: boolean;
  reduced: boolean;
}) {
  const color = scoreHex(f.d.score);
  const ignored = f.provenance.kind !== "blended";
  const left = fillBarStyle({ pct: f.d.signalScore, index, mounted, reduced });
  const right = fillBarStyle({ pct: f.d.llmScore, index, mounted, reduced });
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${f.id} ${f.short}: detectors ${f.d.signalScore}, model ${f.d.llmScore}, blended ${f.d.score} (${provenanceLabel(f.provenance)})`}
      className={`focus-ring grid w-full grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] items-center gap-x-3 rounded-lg px-1 py-1.5 text-left transition ${
        selected ? "bg-accent/[0.08]" : "hover:bg-surface/60"
      }`}
    >
      {/* Detector wing — grows leftward from the spine. */}
      <span className="flex items-center justify-end gap-2">
        <span className={`type-mono-sm tabular-nums ${selected ? "text-white" : "text-slate-400"}`}>{f.d.signalScore}</span>
        <span className="h-2.5 flex-1 overflow-hidden rounded-l-full bg-slate-800">
          <span className="ml-auto block h-full rounded-l-full bg-slate-500" style={left} />
        </span>
      </span>
      {/* Spine. */}
      <span className="h-8 w-px bg-divider" />
      {/* Model wing — grows rightward; struck when the engine ignored the model's number. */}
      <span className="flex items-center gap-2">
        <span className="h-2.5 flex-1 overflow-hidden rounded-r-full bg-slate-800">
          <span className={`block h-full rounded-r-full ${ignored ? "bg-slate-700" : "bg-accent/70"}`} style={right} />
        </span>
        <span className={`type-mono-sm tabular-nums ${ignored ? "text-slate-600 line-through" : selected ? "text-white" : "text-slate-400"}`}>{f.d.llmScore}</span>
      </span>
      {/* Caption line under the wings: name on the left, blended verdict on the right. */}
      <span className="col-span-3 mt-0.5 flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate">
          <span className="type-mono-sm text-slate-500">{f.id}</span>{" "}
          <span className={`font-semibold ${selected ? "text-white" : "text-slate-200"}`}>{f.d.name}</span>{" "}
          <span className="type-label tracking-[0.16em] text-slate-500">{provenanceLabel(f.provenance)}</span>
        </span>
        <span className="flex shrink-0 items-baseline gap-2">
          {!ignored && (
            <span className="type-mono-sm tabular-nums text-slate-500" title="model minus detectors">
              model {signedDelta(f.divergence)}
            </span>
          )}
          <span className="type-figure font-bold tabular-nums" style={{ color }}>
            <span aria-hidden className="mr-1 type-note">{scoreGlyph(f.d.score)}</span>
            {f.d.score}
          </span>
        </span>
      </span>
    </button>
  );
}
