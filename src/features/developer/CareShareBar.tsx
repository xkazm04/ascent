// Your AI-attributed share, as a proportion of the commits it is a share OF.
//
// This is the void-vs-zero fix that Wave 1 made to the org-side `AiBar`, on the surface where it is
// most personal: "no commits for a share to be taken of" and "measured, and it is 0%" used to render
// the identical `0%` tile. They are now different pictures — the first draws no bar at all and says
// what the absence is, the second draws an empty track with a real, measured zero beside it.
//
// Server-safe, no motion: there is nothing here for a reduced-motion preference to opt out of.
// Colour is `scoreHex`, never a hand-picked hex (BRAND.md).

import { StateSwatch } from "@/components/org/viz";
import { scoreHex } from "@/lib/ui";

const W = 240;
const H = 8;

export function CareShareBar({
  commits,
  aiCommits,
  share,
}: {
  commits: number;
  aiCommits: number;
  /** 0..100, commit-weighted. Read only when `commits > 0`. */
  share: number;
}) {
  if (commits <= 0) {
    return (
      <div
        className="flex items-center gap-2"
        title="No commits are attributed to you in this workspace's scanned repositories, so there is no denominator for a share. An absence, not a measured 0%."
      >
        <StateSwatch state="missing" />
        <span className="type-body-sm text-slate-500">no commits to take a share of</span>
      </div>
    );
  }

  const filled = Math.max(0, Math.min(W, Math.round((aiCommits / commits) * W)));
  const label = `AI-attributed share: ${share}% — ${aiCommits} of ${commits} commits carry an AI trailer.`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label}>
      <title>{label}</title>
      <rect x={0} y={0} width={W} height={H} rx={2} fill="var(--color-surface-strong)" />
      {filled > 0 && <rect data-fill x={0} y={0} width={filled} height={H} rx={2} fill={scoreHex(share)} />}
    </svg>
  );
}
