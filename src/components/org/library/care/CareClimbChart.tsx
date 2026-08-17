"use client";

// The Climb variant's signature: a dependency-free SVG trajectory of the developer's own ascent.
//
// Two series on one frame, both derived from the view model (nothing invented):
//   • the STEP line — cumulative moves kept over time (each step is a decision the developer made);
//   • the AREA      — cumulative expected time returned per week by those moves (their own estimate).
// Right-hand ticks mark the repos the developer commits to at their current level, so the personal
// climb and the fleet's altitude read on one picture — the join a machine-local skill cannot draw.
//
// Motion: a single `strokeDasharray` draw-on via the shared `.animate-meter`-class family is NOT used
// here; the entrance comes from the panel's own `animate-fade-in`, so there is no new always-on motion
// and nothing to gate (BRAND principle 5).

import { LEVEL_HEX, scoreHex } from "@/lib/ui";
import { SectionEmpty } from "@/components/org/shared/ui";
import type { LevelId } from "@/lib/types";
import {
  CARE_SHAPE_LABEL,
  CARE_SHAPE_ORDER,
  careShapeValue,
  type CareOrgView,
  type CarePersonalView,
} from "@/lib/org/care-view";

const W = 640;
const H = 220;
const PAD = { l: 34, r: 96, t: 14, b: 26 };

interface Step {
  t: number;
  kept: number;
  saving: number;
  title: string;
}

function buildSteps(personal: CarePersonalView): Step[] {
  const kept = personal.moves
    .filter((m) => m.state === "kept")
    .map((m) => ({ at: Date.parse(m.at), saving: m.expectedSaving ?? 0, title: m.title }))
    .filter((m) => Number.isFinite(m.at))
    .sort((a, b) => a.at - b.at);
  let n = 0;
  let s = 0;
  return kept.map((m) => {
    n += 1;
    s += m.saving;
    return { t: m.at, kept: n, saving: s / 60, title: m.title };
  });
}

export function CareClimbTrajectory({ personal }: { personal: CarePersonalView }) {
  const steps = buildSteps(personal);
  const firstStep = steps[0];
  const lastStep = steps[steps.length - 1];
  if (!firstStep || !lastStep) {
    return (
      <SectionEmpty>
        No climb yet. The first move you keep starts the line — and it stays here when you change machines.
      </SectionEmpty>
    );
  }

  const t0 = firstStep.t;
  const t1 = Math.max(Date.now(), lastStep.t);
  const span = Math.max(1, t1 - t0);
  const maxKept = Math.max(1, lastStep.kept);
  const maxSaving = Math.max(0.5, lastStep.saving);

  const x = (t: number) => PAD.l + ((t - t0) / span) * (W - PAD.l - PAD.r);
  const yKept = (k: number) => H - PAD.b - (k / (maxKept + 0.5)) * (H - PAD.t - PAD.b);
  const ySaving = (s: number) => H - PAD.b - (s / (maxSaving * 1.15)) * (H - PAD.t - PAD.b);

  // Step path: hold the previous level until the next decision, then rise. A smooth curve would
  // imply continuous progress; keeping a move is a discrete act.
  let line = `M ${x(t0)} ${yKept(0)}`;
  let area = `M ${x(t0)} ${H - PAD.b} L ${x(t0)} ${ySaving(0)}`;
  let prevKept = 0;
  let prevSaving = 0;
  for (const s of steps) {
    line += ` L ${x(s.t)} ${yKept(prevKept)} L ${x(s.t)} ${yKept(s.kept)}`;
    area += ` L ${x(s.t)} ${ySaving(prevSaving)} L ${x(s.t)} ${ySaving(s.saving)}`;
    prevKept = s.kept;
    prevSaving = s.saving;
  }
  line += ` L ${x(t1)} ${yKept(prevKept)}`;
  area += ` L ${x(t1)} ${ySaving(prevSaving)} L ${x(t1)} ${H - PAD.b} Z`;

  const label = (iso: number) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <div className="mt-3 rounded-2xl border border-divider bg-surface-strong/40 p-4">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Your climb: ${maxKept} moves kept, about ${maxSaving.toFixed(1)} hours a week returned, over ${Math.round(span / 86_400_000)} days`}
      >
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={PAD.l}
            x2={W - PAD.r}
            y1={PAD.t + (1 - f) * (H - PAD.t - PAD.b)}
            y2={PAD.t + (1 - f) * (H - PAD.t - PAD.b)}
            stroke="var(--color-divider)"
            strokeWidth={1}
            strokeDasharray="2 4"
          />
        ))}
        <path d={area} fill="var(--color-accent)" fillOpacity={0.1} stroke="none" />
        <path d={line} fill="none" stroke="var(--color-accent)" strokeWidth={2.25} />
        {steps.map((s) => (
          <g key={s.t}>
            <circle cx={x(s.t)} cy={yKept(s.kept)} r={3.5} fill="var(--color-accent)" />
            <title>{`${label(s.t)} · kept: ${s.title}`}</title>
          </g>
        ))}
        <text x={4} y={yKept(maxKept) + 3} fontSize={9} className="fill-slate-500">
          {maxKept}
        </text>
        <text x={4} y={H - PAD.b + 1} fontSize={9} className="fill-slate-600">
          0
        </text>
        <text x={PAD.l} y={H - 6} fontSize={9} className="fill-slate-600">
          {label(t0)}
        </text>
        <text x={W - PAD.r} y={H - 6} fontSize={9} textAnchor="end" className="fill-slate-600">
          today
        </text>

        {/* Right margin: the repos you commit to, as elevation ticks on the same frame. */}
        <line x1={W - PAD.r + 12} x2={W - PAD.r + 12} y1={PAD.t} y2={H - PAD.b} stroke="var(--color-divider)" strokeWidth={1} />
        {personal.myRepos.map((r, i) => {
          const hex = r.level && r.level in LEVEL_HEX ? LEVEL_HEX[r.level as LevelId] : r.score != null ? scoreHex(r.score) : "#475569";
          const y = PAD.t + 12 + i * 18;
          return (
            <g key={r.fullName}>
              <rect x={W - PAD.r + 8} y={y - 4} width={9} height={8} rx={1.5} fill={hex} />
              <text x={W - PAD.r + 22} y={y + 3} fontSize={9} className="fill-slate-400">
                {r.fullName.split("/")[1] ?? r.fullName}
              </text>
              <title>{`${r.fullName} · ${r.level ?? "unscored"}${r.score != null ? ` · ${r.score}` : ""}`}</title>
            </g>
          );
        })}
      </svg>
      <p className="mt-2 text-sm text-slate-500">
        Line: moves you kept. Shaded: about {maxSaving.toFixed(1)} h/week returned by your own estimate. Right margin: the
        repos you commit to, at their current level.
      </p>
    </div>
  );
}

/** Org mode's counterpart: the distribution of climbs, as bands. No individual climb is drawable. */
export function CareClimbDistribution({ org }: { org: CareOrgView }) {
  const fields = CARE_SHAPE_ORDER.filter((f) => org.shapeBands[f]);
  if (fields.length === 0) return <SectionEmpty>No distribution yet — nobody has shared these counts.</SectionEmpty>;
  return (
    <div className="mt-3 space-y-4 rounded-2xl border border-divider bg-surface-strong/40 p-4">
      {fields.map((f) => {
        const b = org.shapeBands[f]!;
        const max = Math.max(1, b.p75 * 1.2);
        const pct = (n: number) => `${Math.min(100, (n / max) * 100)}%`;
        return (
          <div key={f}>
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-xs uppercase tracking-[0.18em] text-slate-400">{CARE_SHAPE_LABEL[f]}</span>
              <span className="font-mono text-sm tabular-nums text-slate-500">
                {careShapeValue(f, b.p25)} – {careShapeValue(f, b.p75)}
              </span>
            </div>
            <div className="relative mt-2 h-4" role="img" aria-label={`${CARE_SHAPE_LABEL[f]}: p25 ${b.p25}, median ${b.p50}, p75 ${b.p75}`}>
              <div className="absolute inset-x-0 top-2 h-px bg-divider" />
              <div className="absolute top-1 h-2 rounded-full bg-accent/30" style={{ left: pct(b.p25), width: `calc(${pct(b.p75)} - ${pct(b.p25)})` }} />
              <div className="absolute top-0 h-4 w-px bg-accent" style={{ left: pct(b.p50) }} />
            </div>
          </div>
        );
      })}
      <p className="text-sm text-slate-500">Interquartile band with the median marked. Individual climbs are not plottable here by design.</p>
    </div>
  );
}
