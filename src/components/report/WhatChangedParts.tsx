// Presentational sub-components for the "What changed" panel (see WhatChanged.tsx).
// Pure (no hooks) so they render on the server alongside the live picker.

import type { ComparableScan } from "@/lib/db/scans";
import type { DimensionDiff, ScanDiff } from "@/lib/report/compare";
import type { LevelId } from "@/lib/types";
import { LEVEL_CLASSES, LEVEL_GLYPH, scoreGlyph, scoreHex, timeAgo } from "@/lib/ui";
import { DeltaTag } from "@/components/report/deltas";
import { Kicker, Surface } from "@/components/ui";

/**
 * A short, human label for one side of the comparison (score · level · when · engine), shared by the
 * "What changed" headline captions and the compare-page scan picker so the dropdown and the diff
 * headline can't drift. `latest` appends `· latest` (the picker flags the most recent scan). Typed
 * structurally so it serves both ComparableScan and HistoryPoint.
 */
export function scanCaption(
  scan: Pick<ComparableScan, "overallScore" | "level" | "scannedAt" | "engineProvider">,
  opts?: { latest?: boolean },
): string {
  return `${scan.overallScore} · ${scan.level} · ${timeAgo(scan.scannedAt)} · ${scan.engineProvider}${opts?.latest ? " · latest" : ""}`;
}

/** Absolute short timestamp for the picker ("Jul 14 09:12") — `timeAgo` buckets widen with age
 *  ("3 months ago" covers many scans), so a list control needs the exact moment. */
function shortDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

/** One picker <option> label per scan, keyed by scan id — the LIST variant of `scanCaption`.
 *
 *  The headline caption (score · level · timeAgo · engine) was reused verbatim as the dropdown
 *  label, where uniqueness matters: two same-day scans with the same score rendered byte-identical
 *  options, so selecting a specific scan — the picker's whole point — degraded to guesswork
 *  (trends-comparison 07-16 #4). This variant uses an absolute short date+time instead of the
 *  widening `timeAgo` bucket, appends the short commit sha when recorded, and — should two captions
 *  STILL collide (same minute, same sha-less engine run) — suffixes an ordinal so every option is
 *  distinguishable. */
export function scanOptionCaptions(
  scans: readonly (Pick<ComparableScan, "overallScore" | "level" | "scannedAt" | "engineProvider"> & {
    id: string;
    headSha: string | null;
  })[],
  latestId: string | undefined,
): Map<string, string> {
  const base = scans.map(
    (s) =>
      `${s.overallScore} · ${s.level} · ${shortDateTime(s.scannedAt)} · ${s.engineProvider}` +
      `${s.headSha ? ` · ${s.headSha.slice(0, 7)}` : ""}${s.id === latestId ? " · latest" : ""}`,
  );
  const totals = new Map<string, number>();
  for (const b of base) totals.set(b, (totals.get(b) ?? 0) + 1);
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  scans.forEach((s, i) => {
    const b = base[i]!;
    const n = (seen.get(b) ?? 0) + 1;
    seen.set(b, n);
    out.set(s.id, (totals.get(b) ?? 1) > 1 ? `${b} · #${n}` : b);
  });
  return out;
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

/** 45° hatch over the neutral fill — the "this is not a comparable measurement" texture. Reserved
 *  for the one-sided diff below; a hatched bar can never be mistaken for a plotted score. */
const UNCOMPARABLE_HATCH =
  "repeating-linear-gradient(45deg, rgba(148,163,184,0.55) 0 3px, rgba(148,163,184,0) 3px 6px)";

/** The structural-change badge for a dimension that only one side of the comparison measured. */
function OneSidedBadge({ kind }: { kind: "added" | "removed" | "neither" }) {
  // Deliberately NOT emerald/red: a dimension appearing or disappearing is a change in WHAT was
  // measured, not an improvement or a regression, and borrowing the gain/loss hues would assert a
  // direction the data doesn't have. Sky = informational-new (the report header's demo chip hue),
  // amber = attention/gap (the "New gaps" list hue). Both ship glyph + label, never color alone.
  const spec = {
    added: { cls: "border-sky-500/40 bg-sky-500/10 text-sky-300", glyph: "+", text: "New in this scan — no baseline to compare" },
    removed: { cls: "border-amber-500/40 bg-amber-500/10 text-amber-300", glyph: "−", text: "No longer scored — nothing to compare" },
    neither: { cls: "border-slate-600 bg-slate-800/60 text-slate-400", glyph: "·", text: "Not scored in either scan" },
  }[kind];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-sm font-semibold ${spec.cls}`}>
      <span aria-hidden>{spec.glyph}</span>
      {spec.text}
    </span>
  );
}

/** GitHub-style diff bar: neutral base to the unchanged level, then a green (gain) or red
 *  (loss) segment spanning the delta.
 *
 *  When exactly ONE side is present there is no delta to draw at all — the dimension was added or
 *  dropped by a model/rubric change. The old fallback painted the present value as an ordinary
 *  score-colored bar, visually identical to a dimension that held steady, so a real structural
 *  change in what was measured read as "nothing happened". It now carries an explicit badge naming
 *  which side is missing, and a hatched neutral fill that reads as "not a comparable measurement". */
function DiffBar({ before, after }: { before: number | null; after: number | null }) {
  if (before === null || after === null) {
    const v = after ?? before;
    const kind = v === null ? "neither" : before === null ? "added" : "removed";
    return (
      <div className="mt-2">
        <OneSidedBadge kind={kind} />
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-800">
          {v !== null && (
            <div
              data-uncomparable
              className="h-full"
              style={{ width: `${v}%`, backgroundColor: "#475569", backgroundImage: UNCOMPARABLE_HATCH }}
            />
          )}
        </div>
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
