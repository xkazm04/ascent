// The weekly digest's headline row — three ledger tiles (Overall · AI Adoption · Engineering Rigor)
// over the trailing week, with the population they were measured over DRAWN underneath.
//
// The caption used to be the honest half of this block and also the hardest part of it to read:
// "measured over 8 repositories scanned on both sides of the week (+2 onboarded, 1 departed) · 10/12
// repositories scanned" is three nested populations in one line. `DigestCoverageStrip` nests them as
// a strip; the composition churn that explains why the cohort is smaller than the scanned set rides
// a WhyChip, where a basis belongs.
//
// When `cohortSize` is null there is no baseline at all: the tiles drop their delta badges entirely
// rather than print a confident 0, and the strip draws the cohort as a void.
//
// The pasted markdown keeps the sentence in full (`standingDelta` in digest-markdown.ts) — a
// recipient in Slack has no strip to look at and no chip to open. That divergence is deliberate.

import { Tile, TILE_LEDGER } from "@/components/org/shared/ui";
import { WhyChip } from "@/components/org/viz";
import { scoreHex } from "@/lib/ui";
import type { WeeklyDigest } from "@/lib/org/digest-types";
import { DigestCoverageStrip } from "./DigestCoverageStrip";
import { coverageView } from "./digestViz";

/** "1 repository" / "4 repositories" — the digest never prints a bare count next to a plural noun. */
function repos(n: number): string {
  return `${n} ${n === 1 ? "repository" : "repositories"}`;
}

function cohortHint(h: WeeklyDigest["headline"]): string {
  if (h.cohortSize == null) {
    return (
      "No repository has a scan on both sides of this week, so there is no cohort to measure a delta over. " +
      "The tiles show the standing only — a delta here would have no baseline behind it."
    );
  }
  const churn =
    h.onboarded > 0 || h.departed > 0
      ? ` ${repos(h.onboarded)} onboarded and ${h.departed} departed mid-week are excluded: their move would be a lifetime delta, not a week's.`
      : "";
  return `Every delta above is measured over the ${repos(h.cohortSize)} scanned on both sides of the week.${churn}`;
}

export function DigestHeadline({ headline: h }: { headline: WeeklyDigest["headline"] }) {
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
        <Tile label="AI Adoption" value={h.adoption} color={scoreHex(h.adoption)} delta={h.dAdoption} deltaLabel="this week" />
        <Tile
          label="Engineering Rigor"
          value={h.rigor}
          color={scoreHex(h.rigor)}
          delta={h.dRigor}
          deltaLabel="this week"
        />
      </div>
      <div className="mt-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <DigestCoverageStrip view={coverageView(h)} />
        </div>
        <WhyChip hint={cohortHint(h)} label="delta cohort" align="end" className="mt-1" />
      </div>
    </div>
  );
}
