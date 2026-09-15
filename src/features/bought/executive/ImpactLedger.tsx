// "The Impact Ledger" (W1d) — the Briefing tab's answer to the rail's fourth question: what did the
// last period BUY us? METAPHOR: a receipt, not a forecast.
//
// It reads the improvement loop's own bookends (src/lib/db/org-impact.ts): each row is a starter PR
// the org accepted, merged, and then re-scanned, and the number beside it is the measured delta on
// the dimension that PR was aimed at. Everything here is a purchase already made.
//
// WHAT IT DELIBERATELY REFUSES TO DO — the reason the panel is trustworthy at all. Each of these was
// a sentence in a field-notes paragraph under the tiles; each is now a shape or a disclosure:
//   - A merged-but-not-yet-rescanned PR contributes NOTHING → the funnel's second stage is shorter
//     than its first, and the count carries IMPACT_AWAITING_HINT on hover.
//   - With nothing verified, the headline is an em dash and a reason, NEVER "0 points" → the
//     movement chart draws a dashed VOID axis with no bars (impactView's `hasMovement`).
//   - A regression keeps its sign → it is a bar on the LEFT of the same axis, at the same scale as
//     the gains, rather than a signed chip in a wrap row.
//   - Per-repo overall deltas are never summed → IMPACT_NO_SUM_HINT rides on that column's header.
//
// Sibling in spirit to the Backlog tab's Debt Ledger: that one is what the fleet OWES, this one is
// what it has PAID DOWN. Server-safe — no hooks, no handlers.

import { Kicker } from "@/components/ui";
import { SectionHeader, Tile, TILE_LEDGER } from "@/components/org/shared/ui";
import { FlowRibbon, Legend, StateSwatch, WhyChip, type LegendExtra, type VizState } from "@/components/org/viz";
import type { ImpactLedger as ImpactLedgerModel } from "@/lib/db/org-impact";
import { LEVEL_HEX } from "@/lib/ui";
import { BAD, GOOD, signed } from "./ImpactLedgerCells";
import { ImpactLedgerTable } from "./ImpactLedgerTable";
import { ImpactMovement } from "./ImpactMovement";
import {
  IMPACT_AWAITING_HINT,
  IMPACT_BASIS_HINT,
  IMPACT_NO_BASELINE_HINT,
  impactFunnelStages,
  impactMovementRows,
} from "./impactView";

export function ImpactLedger({
  slug,
  ledger,
  periodTitle,
}: {
  slug: string;
  ledger: ImpactLedgerModel;
  periodTitle: string;
}) {
  // Nothing merged at all: say so plainly and point at the loop. An empty ledger is an honest state,
  // not an error, and it must not render a wall of zeroes. This is where the panel's argument lives —
  // the reader has nothing to look at and genuinely needs to be told what would put something here.
  if (ledger.mergedCount === 0) {
    return (
      <div className="rounded-xl border border-dashed border-divider bg-surface/40 px-4 py-3 type-body-sm text-slate-400">
        <span className="type-label tracking-[0.22em] text-slate-500">Bought</span> No improvement PRs
        merged in {periodTitle.toLowerCase()}. Accept a direction on the{" "}
        <a href={`/org/${encodeURIComponent(slug)}?tab=live`} className="focus-ring text-accent hover:text-white">
          Live
        </a>{" "}
        wall and its measured impact lands here once the post-merge rescan completes. Points are the
        measured delta on each PR&apos;s targeted dimension; only re-scanned merges ever count.
      </div>
    );
  }

  const nothingVerified = ledger.dimPoints == null;
  const movement = impactMovementRows(ledger);
  // Only the states this panel actually draws — a legend that teaches six encodings for a chart
  // using two is the prose problem in another costume.
  const states: VizState[] = movement.length > 0 ? ["measured"] : [];
  const extra: LegendExtra[] = [];
  if (ledger.awaitingRescan > 0) {
    extra.push({
      id: "awaiting",
      label: `${ledger.awaitingRescan} awaiting rescan`,
      swatch: <StateSwatch state="missing" />,
      hint: IMPACT_AWAITING_HINT,
    });
  }
  if (ledger.unmeasurable > 0) {
    extra.push({
      id: "no-baseline",
      label: `${ledger.unmeasurable} with no baseline`,
      swatch: <StateSwatch state="missing" />,
      hint: IMPACT_NO_BASELINE_HINT,
    });
  }

  return (
    <div className="animate-fade-up space-y-5">
      <SectionHeader
        title={
          <span className="inline-flex items-center gap-2">
            Impact ledger
            <WhyChip hint={IMPACT_BASIS_HINT} label="what a point is" />
          </span>
        }
        right={
          <span className="type-mono-sm uppercase tracking-widest text-slate-600">
            {periodTitle.toLowerCase()} · verified merges
          </span>
        }
      />

      {/* First sight: the funnel from merged to moved, and the movement that funnel bought. */}
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Kicker>Merged → re-scanned → moved</Kicker>
          <FlowRibbon stages={impactFunnelStages(ledger)} title="Improvement merges" className="mt-1" />
        </div>
        <div>
          <Kicker>Movement by dimension</Kicker>
          <ImpactMovement rows={movement} className="mt-1" />
        </div>
      </div>

      <Legend states={states} extra={extra} />

      <div className={`${TILE_LEDGER} grid-cols-2 sm:grid-cols-3 lg:grid-cols-5`}>
        <Tile
          label="Points bought"
          value={nothingVerified ? "—" : signed(ledger.dimPoints as number)}
          sub={nothingVerified ? "nothing re-scanned yet" : "verified dimension pts"}
          color={nothingVerified ? undefined : (ledger.dimPoints as number) > 0 ? GOOD : BAD}
        />
        <Tile label="Verified" value={ledger.verifiedCount} sub={`of ${ledger.mergedCount} merged`} />
        <Tile
          label="Awaiting rescan"
          value={ledger.awaitingRescan}
          sub="not counted yet"
          color={ledger.awaitingRescan ? LEVEL_HEX.L3 : undefined}
        />
        <Tile label="Repos moved" value={ledger.reposMoved} sub="with a verified merge" />
        {/* MOONSHOT #26 — beside the bought number, never inside it. Real, independently rescanned
            movement that has not merged, so it is not owned yet. Em dash, not 0, when nothing is
            measurable: "no lane has been measured" and "the lanes moved nothing" are different. */}
        <Tile
          label="In review"
          value={ledger.inReviewPoints == null ? "—" : signed(ledger.inReviewPoints)}
          sub={ledger.inReviewPoints == null ? "no measured lane" : "on branches, not merged"}
        />
        <Tile
          label="Regressions"
          value={ledger.regressions}
          sub="verified, moved down"
          color={ledger.regressions ? BAD : undefined}
        />
      </div>

      <ImpactLedgerTable ledger={ledger} />
    </div>
  );
}
