// The posture composition as ONE thin bar + one sentence — the Overview prototypes' replacement for
// the baseline's bar-plus-legend-chips block. Every non-empty segment is still a deep link to the
// Repositories tab filtered to that posture (postureHref); zero-count postures are simply absent
// rather than rendered as greyed chips (a decision no reader makes from "0 Getting Started"). No
// hooks — server-safe.

import Link from "next/link";
import { POSTURE_ORDER, postureLabel } from "@/components/org/shared/ui";
import { POSTURE_HEX } from "@/components/org/shared/liveWarRoomShared";
import { postureHref } from "./PostureCompositionBar";
import { POSTURE_DOT_FALLBACK } from "./repoTrajectory";
import { postureLine } from "./overviewTakeaway";

export function OverviewPostureLine({
  slug,
  postureCounts,
  search,
  className = "",
}: {
  slug: string;
  postureCounts: Record<string, number>;
  search: string;
  className?: string;
}) {
  const total = POSTURE_ORDER.reduce((sum, p) => sum + (postureCounts[p] ?? 0), 0);
  if (total === 0) return null;
  return (
    <div className={className}>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-slate-800" role="list" aria-label="Posture composition">
        {POSTURE_ORDER.map((p) => {
          const n = postureCounts[p] ?? 0;
          if (n === 0) return null;
          return (
            <Link
              key={p}
              role="listitem"
              href={postureHref(slug, p, search)}
              className="h-full transition hover:opacity-80"
              style={{ width: `${(n / total) * 100}%`, backgroundColor: POSTURE_HEX[p] ?? POSTURE_DOT_FALLBACK }}
              title={`View the ${n} ${postureLabel(p)} repo${n === 1 ? "" : "s"} (${Math.round((n / total) * 100)}%)`}
              aria-label={`View the ${n} ${postureLabel(p)} repositories`}
            />
          );
        })}
      </div>
      <p className="type-caption mt-1.5 tabular-nums text-slate-400">{postureLine(postureCounts, POSTURE_ORDER, postureLabel)}</p>
    </div>
  );
}
