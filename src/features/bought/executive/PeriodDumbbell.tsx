// The period-over-period comparison, as a mark instead of a sentence.
//
// The "vs previous period" card carried a header line — "This period's end state against the
// equal-length window before it" — that the reader had to hold in their head while looking at three
// cells reading "76 from 71 ▲+5". The framing IS the mark: a hollow origin dot at where the fleet
// stood at the end of the previous, equal-length window; a filled dot at where it stands now; a rule
// between them coloured by the canonical delta tone. The sentence is the generated `<title>`.
//
// Both the authenticated Briefing tab and the anonymous /share/briefing/[token] page render this,
// through PriorPeriodGrid — the same picture, so the two surfaces cannot drift.
//
// Server-safe: no hooks, no handlers, no motion.

import { deltaHex, fmtDelta } from "@/components/ui";
import { scoreHex } from "@/lib/ui";

const W = 120;
const H = 14;
const PAD = 5;
const R = 3;

export function PeriodDumbbell({
  label,
  prior,
  now,
  delta,
  className = "",
}: {
  /** What is being compared, e.g. "Overall". Used in the accessible name. */
  label: string;
  prior: number;
  now: number;
  delta: number;
  className?: string;
}) {
  const ok = [prior, now].every((v) => Number.isFinite(v));
  const title = ok
    ? `${label}: ${prior} at the end of the equal-length window before this one, ${now} now (${fmtDelta(delta)}).`
    : `${label}: no comparable prior window.`;

  if (!ok) {
    return (
      <span role="img" aria-label={title} className={`type-mono-sm text-slate-600 ${className}`}>
        —
      </span>
    );
  }

  const span = W - PAD * 2;
  const x = (v: number) => PAD + (Math.max(0, Math.min(100, v)) / 100) * span;
  const xa = x(prior);
  const xb = x(now);
  const mid = H / 2;
  const tone = deltaHex(delta);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`h-3.5 w-full max-w-[120px] ${className}`} role="img" aria-label={title}>
      <title>{title}</title>
      {/* The 0-100 track the two ends live on, so the distance between them is readable as a share
          of the whole scale rather than only as a printed difference. */}
      <line x1={PAD} y1={mid} x2={W - PAD} y2={mid} stroke="var(--color-divider)" strokeWidth={1} />
      <line x1={xa} y1={mid} x2={xb} y2={mid} stroke={tone} strokeWidth={2.5} />
      {/* Origin: hollow. It is where the fleet WAS, and a filled dot at both ends would give the past
          the same visual weight as the present. */}
      <circle cx={xa} cy={mid} r={R} fill="none" stroke="var(--color-divider)" strokeWidth={1.5} />
      <circle cx={xb} cy={mid} r={R} fill={scoreHex(now)} />
    </svg>
  );
}
