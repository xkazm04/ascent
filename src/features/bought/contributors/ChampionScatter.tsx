"use client";

// A champion is a POSITION, not a rank.
//
// The grid below this used to be headed "Highest AI adoption across the most repos, weighted by
// breadth and activity" — a sentence describing a three-variable space as an ordered list. Here the
// space is drawn: x is commit volume, y is AI-authored share, the dot's radius is breadth (repos),
// and the shaded band is the ≥50% "high adoption" bucket the data layer already defines
// (`insights.distribution.high`). Being a champion is then something you SEE — up and to the right,
// inside the band — rather than something the caption asserts.
//
// Dependency-free SVG on the shared scales and `scoreHex`; no hex is picked here.

import { useMounted, usePrefersReducedMotion } from "@/components/report/chartMotion";
import { linScale } from "@/components/report/chartScale";
import { scoreHex } from "@/lib/ui";
import { KICKER_SVG_CLASS, r2 } from "@/components/org/viz";

const W = 320;
const H = 168;
const PAD_L = 30;
const PAD_R = 12;
const PAD_T = 10;
const PAD_B = 26;
/** The bucket boundary `getContributorInsights` uses for `distribution.high`. Not a taste call. */
const HIGH_ADOPTION = 50;

export type ScatterPoint = {
  login: string;
  aiShare: number;
  commits: number;
  repos: number;
  isViewer: boolean;
};

export function ChampionScatter({ points, className = "" }: { points: ScatterPoint[]; className?: string }) {
  const reduced = usePrefersReducedMotion();
  const mounted = useMounted();
  const animate = mounted || reduced;

  const usable = points.filter((p) => Number.isFinite(p.aiShare) && Number.isFinite(p.commits));
  if (usable.length === 0) {
    return (
      <div role="img" aria-label="Champion positions: no measured champions" className={`type-body-sm text-slate-500 ${className}`}>
        No measured champions
      </div>
    );
  }

  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const maxCommits = Math.max(...usable.map((p) => p.commits), 1);
  const maxRepos = Math.max(...usable.map((p) => p.repos), 1);
  const x = linScale(maxCommits, PAD_L, plotW);
  const y = (share: number) => r2(PAD_T + (1 - Math.max(0, Math.min(100, share)) / 100) * plotH);
  const radius = (repos: number) => r2(3 + (Math.max(1, repos) / maxRepos) * 4);

  const ariaLabel =
    `Champion positions: AI-authored share against commit volume for ${usable.length} contributors, dot size is repositories touched. ` +
    usable.map((p) => `${p.login}: ${Math.round(p.aiShare)}% across ${p.repos} repos, ${p.commits} commits`).join("; ") +
    `. The shaded band is ${HIGH_ADOPTION}% share and above.`;

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
        <title>{ariaLabel}</title>
        {/* the high-adoption band — the boundary the buckets already use, shaded not captioned */}
        <rect
          data-band
          x={PAD_L}
          y={y(100)}
          width={plotW}
          height={r2(y(HIGH_ADOPTION) - y(100))}
          fill="var(--color-accent)"
          fillOpacity={0.07}
        />
        <line x1={PAD_L} y1={y(HIGH_ADOPTION)} x2={W - PAD_R} y2={y(HIGH_ADOPTION)} stroke="var(--color-divider)" strokeWidth={1} strokeDasharray="3 3" />
        <rect x={PAD_L} y={PAD_T} width={plotW} height={plotH} fill="none" stroke="var(--color-divider)" strokeWidth={1} />

        {usable.map((p, i) => (
          <g
            key={p.login}
            data-point={p.login}
            style={{
              opacity: animate ? 1 : 0,
              transition: reduced ? undefined : `opacity 0.45s ease-out ${Math.min(i * 60, 400)}ms`,
            }}
          >
            <circle
              cx={x(p.commits)}
              cy={y(p.aiShare)}
              r={radius(p.repos)}
              fill={p.isViewer ? "var(--color-accent-soft)" : scoreHex(p.aiShare)}
              fillOpacity={0.85}
              stroke="var(--color-surface-strong)"
              strokeWidth={1.25}
            >
              <title>{`${p.login}: ${Math.round(p.aiShare)}% AI-authored share, ${p.commits} commits, ${p.repos} repos`}</title>
            </circle>
            {p.isViewer && (
              <text data-you x={r2(x(p.commits) + radius(p.repos) + 3)} y={r2(y(p.aiShare) + 3)} fontSize={9} className={KICKER_SVG_CLASS}>
                you
              </text>
            )}
          </g>
        ))}

        <text x={PAD_L} y={H - 8} fontSize={9} className={KICKER_SVG_CLASS}>commits →</text>
        <text x={W - PAD_R} y={H - 8} textAnchor="end" fontSize={9} className={KICKER_SVG_CLASS}>{maxCommits}</text>
        <text x={9} y={PAD_T + 10} fontSize={9} className={KICKER_SVG_CLASS} transform={`rotate(-90 9 ${PAD_T + 10})`}>ai share →</text>
      </svg>

      <table className="sr-only">
        <caption>Champion positions — AI-authored share, commit volume and breadth</caption>
        <thead>
          <tr>
            <th scope="col">Contributor</th>
            <th scope="col">AI share</th>
            <th scope="col">Commits</th>
            <th scope="col">Repos</th>
          </tr>
        </thead>
        <tbody>
          {usable.map((p) => (
            <tr key={p.login}>
              <th scope="row">{p.login}</th>
              <td>{`${Math.round(p.aiShare)}%`}</td>
              <td>{p.commits}</td>
              <td>{p.repos}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
