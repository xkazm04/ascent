// The tech-stacks A-vs-B comparison panel — one card replacing the old four-tile strip plus two
// side-by-side cards. Header: each side's headline (name, score, posture, coverage) around the
// overall/adopt/rigor deltas; body: a mirrored-bar (butterfly) row per headline metric and per
// dimension, so "which side is stronger where" reads at a glance; footer: follow-up links for each
// side (scoped repositories view + per-stack executive brief). Server-safe.

import Link from "next/link";
import { Card, postureLabel, deltaHex, fmtDelta } from "@/components/org/ui";
import type { SegmentComparison, SegmentSummary } from "@/lib/db";
import { DIMENSION_SHORT, scoreHex } from "@/lib/ui";

const dimShort = (id: string) => DIMENSION_SHORT[id as keyof typeof DIMENSION_SHORT] ?? id;

/** One side's headline — name, big score, posture · coverage. `align` mirrors it for the B side. */
function SideHead({ s, align }: { s: SegmentSummary; align: "left" | "right" }) {
  return (
    <div className={align === "right" ? "min-w-0 text-right" : "min-w-0"}>
      <div className="truncate font-medium text-white">{s.name}</div>
      <div className="font-mono text-3xl font-bold" style={{ color: scoreHex(s.avgOverall) }}>
        {s.avgOverall}
      </div>
      <div className="mt-0.5 font-mono text-sm text-slate-500">
        {postureLabel(s.posture)} · {s.scannedCount}/{s.repoCount} scanned
      </div>
    </div>
  );
}

/** A score bar growing toward the center (A side) or away from it (B side) — the butterfly's wing. */
function Wing({ value, dir, strong }: { value: number; dir: "left" | "right"; strong?: boolean }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={`relative ${strong ? "h-2" : "h-1.5"} min-w-0 overflow-hidden rounded-full bg-slate-800`}>
      <div
        className={`absolute inset-y-0 rounded-full ${dir === "left" ? "right-0" : "left-0"}`}
        style={{ width: `${pct}%`, backgroundColor: scoreHex(value) }}
      />
    </div>
  );
}

/** One mirrored comparison row: A value · A wing · label · B wing · B value · Δ. */
function BflyRow({ label, a, b, strong }: { label: string; a: number; b: number; strong?: boolean }) {
  const d = a - b;
  return (
    <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_6.5rem_minmax(0,1fr)_2.25rem_3.25rem] items-center gap-2 text-sm">
      <span className="text-right font-mono tabular-nums" style={{ color: scoreHex(a) }}>{a}</span>
      <Wing value={a} dir="left" strong={strong} />
      <span className={`truncate text-center ${strong ? "font-medium text-slate-300" : "text-slate-400"}`}>{label}</span>
      <Wing value={b} dir="right" strong={strong} />
      <span className="text-left font-mono tabular-nums" style={{ color: scoreHex(b) }}>{b}</span>
      <span className="text-right font-mono" style={{ color: deltaHex(d) }}>{fmtDelta(d)}</span>
    </div>
  );
}

/** One side's follow-up links; the whole-fleet side (id null) links to the unscoped views. */
function SideLinks({ org, s }: { org: string; s: SegmentSummary }) {
  const stackQ = s.id ? `?stack=${encodeURIComponent(s.id)}` : "";
  return (
    <span className="text-slate-500">
      <span className="text-slate-300">{s.name}</span>:{" "}
      <Link href={`/org/${org}/repositories${stackQ}`} className="text-accent transition hover:text-white">repos</Link>
      {" · "}
      <Link href={`/org/${org}/executive${stackQ}`} className="text-accent transition hover:text-white">brief</Link>
    </span>
  );
}

export function StackComparePanel({ org, comparison }: { org: string; comparison: SegmentComparison }) {
  const { a, b, deltas, dimDeltas } = comparison;
  return (
    <Card className="mt-4">
      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-4">
        <SideHead s={a} align="left" />
        <div className="pt-1 text-center">
          <div className="font-mono text-xl font-bold" style={{ color: deltaHex(deltas.overall) }}>
            {fmtDelta(deltas.overall)}
          </div>
          <div className="mt-0.5 font-mono text-xs uppercase tracking-widest text-slate-500">overall Δ</div>
          <div className="mt-1 whitespace-nowrap font-mono text-xs text-slate-500">
            adopt <span style={{ color: deltaHex(deltas.adoption) }}>{fmtDelta(deltas.adoption)}</span> · rigor{" "}
            <span style={{ color: deltaHex(deltas.rigor) }}>{fmtDelta(deltas.rigor)}</span>
          </div>
        </div>
        <SideHead s={b} align="right" />
      </div>

      <div className="mt-5 space-y-2">
        <BflyRow label="Overall" a={a.avgOverall} b={b.avgOverall} strong />
        <BflyRow label="AI Adoption" a={a.avgAdoption} b={b.avgAdoption} strong />
        <BflyRow label="Eng Rigor" a={a.avgRigor} b={b.avgRigor} strong />
        {dimDeltas.length > 0 ? (
          <>
            <div className="!my-3 border-t border-divider" />
            {dimDeltas.map((d) => (
              <BflyRow key={d.dimId} label={dimShort(d.dimId)} a={d.a} b={d.b} />
            ))}
          </>
        ) : (
          <p className="text-sm text-slate-500">Neither side has a scanned repo yet — dimension detail appears after the first scans.</p>
        )}
      </div>

      <div className="mt-5 flex flex-wrap gap-x-6 gap-y-1 border-t border-divider pt-3 font-mono text-sm">
        <SideLinks org={org} s={a} />
        <SideLinks org={org} s={b} />
      </div>
    </Card>
  );
}
