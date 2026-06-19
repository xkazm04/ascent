// Presentational sub-components for the "What changed" panel (see WhatChanged.tsx).
// Pure (no hooks) so they render on the server alongside the live picker.

import type { ComparableScan } from "@/lib/db/scans";
import type { DimensionDiff, ScanDiff } from "@/lib/report/compare";
import type { LevelId } from "@/lib/types";
import { LEVEL_CLASSES, LEVEL_GLYPH, scoreGlyph, scoreHex, timeAgo } from "@/lib/ui";
import { DeltaTag } from "@/components/report/deltas";
import { Kicker, Surface } from "@/components/ui";

/** A short, human label for one side of the comparison (score · level · when · engine). */
export function scanCaption(scan: ComparableScan): string {
  return `${scan.overallScore} · ${scan.level} · ${timeAgo(scan.scannedAt)} · ${scan.engineProvider}`;
}

/** A level pill (glyph + id · name), colored by the level's brand class. */
export function LevelChip({ id, name }: { id: LevelId; name: string }) {
  const lc = LEVEL_CLASSES[id] ?? LEVEL_CLASSES.L1;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border ${lc.border} ${lc.bg} px-2.5 py-1 text-sm font-semibold ${lc.text}`}>
      <span aria-hidden>{LEVEL_GLYPH[id]}</span>
      {id} · {name}
    </span>
  );
}

/** before → after pair with a centered arrow; `changed` mutes the row when nothing moved. */
export function Transition({
  label,
  before,
  after,
  changed,
}: {
  label: string;
  before: React.ReactNode;
  after: React.ReactNode;
  changed: boolean;
}) {
  return (
    <Surface radius="xl" className="p-4">
      <div className="flex items-center justify-between">
        <Kicker tone="muted">{label}</Kicker>
        {changed ? (
          <span className="font-mono text-sm uppercase tracking-widest text-accent">changed</span>
        ) : (
          <span className="font-mono text-sm uppercase tracking-widest text-slate-600">no change</span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {before}
        <span aria-hidden className={changed ? "text-accent" : "text-slate-600"}>
          →
        </span>
        {after}
      </div>
    </Surface>
  );
}

/** GitHub-style diff bar: neutral base to the unchanged level, then a green (gain) or red
 *  (loss) segment spanning the delta. Falls back to a plain colored bar when a side is absent. */
function DiffBar({ before, after }: { before: number | null; after: number | null }) {
  if (before === null || after === null) {
    const v = after ?? before ?? 0;
    return (
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-800">
        <div className="h-full" style={{ width: `${v}%`, backgroundColor: scoreHex(v) }} />
      </div>
    );
  }
  const min = Math.min(before, after);
  const max = Math.max(before, after);
  const gain = after >= before;
  return (
    <div className="relative mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-800">
      <div className="absolute inset-y-0 left-0 bg-slate-600" style={{ width: `${min}%` }} />
      <div
        className="absolute inset-y-0"
        style={{ left: `${min}%`, width: `${max - min}%`, backgroundColor: gain ? "#22c55e" : "#ef4444" }}
      />
    </div>
  );
}

function GapList({ title, gaps, tone }: { title: string; gaps: string[]; tone: "closed" | "opened" }) {
  if (gaps.length === 0) return null;
  const good = tone === "closed";
  return (
    <div>
      <div className={`text-sm font-semibold uppercase tracking-wide ${good ? "text-emerald-400/80" : "text-amber-400/80"}`}>
        {title}
      </div>
      <ul className="mt-1 space-y-1 text-base">
        {gaps.map((g, i) => (
          <li key={i} className={`flex gap-2 ${good ? "text-emerald-200/90" : "text-amber-200/90"}`}>
            <span aria-hidden className={good ? "text-emerald-400" : "text-amber-400"}>
              {good ? "✓" : "+"}
            </span>
            <span className={good ? "line-through decoration-emerald-700/60" : ""}>{g}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The concrete detector signals that appeared (gained, green) or disappeared (lost, red)
 *  between the two scans — the evidence behind a dimension's score movement. */
function SignalList({ title, signals, tone }: { title: string; signals: string[]; tone: "gained" | "lost" }) {
  if (signals.length === 0) return null;
  const gained = tone === "gained";
  return (
    <div>
      <div className={`text-sm font-semibold uppercase tracking-wide ${gained ? "text-emerald-400/80" : "text-red-400/80"}`}>
        {title}
      </div>
      <ul className="mt-1 space-y-1 text-base">
        {signals.map((sig, i) => (
          <li key={i} className={`flex gap-2 ${gained ? "text-emerald-200/90" : "text-red-200/90"}`}>
            <span aria-hidden className={gained ? "text-emerald-400" : "text-red-400"}>
              {gained ? "+" : "−"}
            </span>
            <span>{sig}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DimensionDiffCard({ d }: { d: DimensionDiff }) {
  const afterColor = d.after !== null ? scoreHex(d.after) : "#475569";
  return (
    <Surface radius="xl" className="p-4">
      <div className="flex items-center gap-3">
        <span className="font-mono text-sm text-slate-500">{d.id}</span>
        <span className="flex-1 font-semibold text-white">{d.name}</span>
        {d.delta !== null && <DeltaTag delta={d.delta} />}
        <span className="flex items-center gap-1 font-mono text-base tabular-nums text-slate-400">
          <span>{d.before ?? "—"}</span>
          <span aria-hidden className="text-slate-600">→</span>
          <span className="flex items-center gap-1 font-bold" style={{ color: afterColor }}>
            <span aria-hidden className="text-sm">{d.after !== null ? scoreGlyph(d.after) : ""}</span>
            {d.after ?? "—"}
          </span>
        </span>
      </div>
      <DiffBar before={d.before} after={d.after} />
      {(d.appearedSignals.length > 0 || d.disappearedSignals.length > 0) && (
        <div className="mt-3 space-y-2">
          <SignalList title="Signals detected" signals={d.appearedSignals} tone="gained" />
          <SignalList title="Signals lost" signals={d.disappearedSignals} tone="lost" />
        </div>
      )}
      {(d.closedGaps.length > 0 || d.openedGaps.length > 0) && (
        <div className="mt-3 space-y-2">
          <GapList title="Resolved" gaps={d.closedGaps} tone="closed" />
          <GapList title="New gaps" gaps={d.openedGaps} tone="opened" />
        </div>
      )}
    </Surface>
  );
}

export function AxisDeltaRow({ label, axis }: { label: string; axis: ScanDiff["adoption"] }) {
  const color = scoreHex(axis.after);
  return (
    <Surface radius="xl" className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-base font-medium text-white">{label}</span>
        <div className="flex items-center gap-2 font-mono text-base tabular-nums">
          <span className="text-slate-400">{axis.before}</span>
          <span aria-hidden className="text-slate-600">→</span>
          <span className="font-bold" style={{ color }}>{axis.after}</span>
          <DeltaTag delta={axis.delta} />
        </div>
      </div>
      <DiffBar before={axis.before} after={axis.after} />
    </Surface>
  );
}
