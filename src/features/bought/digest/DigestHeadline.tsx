// The weekly digest's headline row — three ledger tiles (Overall · AI Adoption · Engineering Rigor)
// over the trailing week, with the denominator stated in words underneath.
//
// The caption is the honest half of this block. Every delta here is COHORT-MATCHED (repos scanned on
// both sides of the window), so the number is only meaningful next to the size of that cohort and the
// churn around it — a fleet that onboarded ten repos mid-week moves for reasons the delta can't see.
// When `cohortSize` is null there is no baseline at all: the tiles drop their delta badges entirely
// rather than print a confident 0, and the caption says so.

import { Tile, TILE_LEDGER } from "@/components/org/shared/ui";
import { scoreHex } from "@/lib/ui";
import type { WeeklyDigest } from "@/lib/org/digest-types";

/** "1 repository" / "4 repositories" — the digest never prints a bare count next to a plural noun. */
function repos(n: number): string {
  return `${n} ${n === 1 ? "repository" : "repositories"}`;
}

export function DigestHeadline({ headline }: { headline: WeeklyDigest["headline"] }) {
  const h = headline;
  const cohortLine =
    h.cohortSize == null
      ? "no earlier scans to compare against"
      : `measured over ${repos(h.cohortSize)} scanned on both sides of the week ` +
        `(+${h.onboarded} onboarded, ${h.departed} departed)`;

  return (
    <div>
      <div className={`${TILE_LEDGER} sm:grid-cols-3`}>
        <Tile
          label="Overall"
          value={h.overall}
          sub={`${h.levelId} · ${h.levelName}`}
          color={scoreHex(h.overall)}
          delta={h.dOverall}
          deltaLabel="this week"
        />
        <Tile
          label="AI Adoption"
          value={h.adoption}
          color={scoreHex(h.adoption)}
          delta={h.dAdoption}
          deltaLabel="this week"
        />
        <Tile
          label="Engineering Rigor"
          value={h.rigor}
          color={scoreHex(h.rigor)}
          delta={h.dRigor}
          deltaLabel="this week"
        />
      </div>
      <p className="mt-2 type-caption text-slate-500">
        {cohortLine} · {h.scanned}/{h.total} repositories scanned
      </p>
    </div>
  );
}
