// Prism receipt. Funnel counts are real zeroes. Points are not measured until a rescan lands.
import { DimensionLine, Frame, parseDimension, SectionHead, StatStrip, StatTile, VoidMark } from "@/components/kit";
import type { ImpactLedger } from "@/lib/db/org-impact";
import { signed } from "./ImpactLedgerCells";
import { dimensionName } from "./executiveMarks";
import { impactTableV2 } from "./ImpactTable.v2";
import { hasMovement, IMPACT_AWAITING_HINT, IMPACT_BASIS_HINT, impactMovementRows, movementDomain } from "./impactView";

function pointsFigure(n: number) {
  const up = n > 0;
  const down = n < 0;
  return (
    <span>
      {(up || down) && (
        <span aria-hidden className="mr-1 align-middle type-body">
          {up ? "✓" : "▲"}
        </span>
      )}
      {(up || down) && <span className="sr-only">{up ? "Up" : "Down"}: </span>}
      {signed(n)}
    </span>
  );
}

function movement(ledger: ImpactLedger) {
  if (!hasMovement(ledger)) {
    return (
      <p className="flex items-center gap-2 type-body-sm text-slate-400">
        <VoidMark label="not measured" subject="Dimension points" />
        Nothing was re-scanned, so no dimension movement is stated.
      </p>
    );
  }
  const rows = impactMovementRows(ledger);
  const domain = movementDomain(rows);
  return (
    <div>
      {rows.map((r) => {
        const dim = parseDimension(r.dimId);
        if (!dim) {
          return (
            <p key={r.dimId} className="type-body-sm text-slate-400">
              {r.dimId}: not measured
            </p>
          );
        }
        return (
          <DimensionLine
            key={r.dimId}
            dimension={dim}
            label={dimensionName(r.dimId)}
            value={domain > 0 ? Math.abs(r.points) / domain : 0}
            display={signed(r.points)}
            wide
            detail={`${r.prs} merged PR${r.prs === 1 ? "" : "s"}`}
          />
        );
      })}
    </div>
  );
}

export function impactLedgerV2(slug: string, ledger: ImpactLedger, periodTitle: string) {
  if (ledger.mergedCount === 0) {
    return (
      <Frame>
        <SectionHead
          eyebrow="Bought"
          title="No improvement PRs merged in"
          named={periodTitle.toLowerCase()}
          lede={
            <>
              Accept a direction on the{" "}
              <a href={`/org/${encodeURIComponent(slug)}?tab=live`} className="focus-ring underline">
                Live
              </a>{" "}
              wall and its measured impact lands here once the post-merge rescan completes. Points are the measured
              delta on each PR&apos;s targeted dimension; only re-scanned merges ever count.
            </>
          }
        />
      </Frame>
    );
  }
  const points = ledger.dimPoints;
  const review = ledger.inReviewPoints;
  return (
    <Frame>
      <SectionHead eyebrow="Bought" title="Impact ledger" named={periodTitle.toLowerCase()} lede={IMPACT_BASIS_HINT} />
      <div className="mt-6 space-y-6">
        <StatStrip cols={3}>
          <StatTile label="Merged" value={ledger.mergedCount} />
          <StatTile label="Re-scanned" value={ledger.verifiedCount} sub={`of ${ledger.mergedCount} merged`} />
          <StatTile label="Repos moved" value={ledger.reposMoved} sub="with a verified merge" />
        </StatStrip>
        <StatStrip cols={6}>
          <StatTile
            label="Points bought"
            value={points == null ? "not measured" : pointsFigure(points)}
            sub={points == null ? "nothing re-scanned yet" : "verified dimension pts"}
          />
          <StatTile label="Verified" value={ledger.verifiedCount} sub={`of ${ledger.mergedCount} merged`} />
          <StatTile label="Awaiting rescan" value={ledger.awaitingRescan} sub="not counted yet" />
          <StatTile label="Repos moved" value={ledger.reposMoved} sub="with a verified merge" />
          <StatTile
            label="In review"
            value={review == null ? "not measured" : pointsFigure(review)}
            sub={review == null ? "no measured lane" : "on branches, not merged"}
          />
          <StatTile
            label="Regressions"
            value={ledger.regressions}
            sub="verified, moved down"
          />
        </StatStrip>
        {ledger.awaitingRescan > 0 && (
          <p className="type-body-sm text-slate-400">
            {ledger.awaitingRescan} awaiting rescan. {IMPACT_AWAITING_HINT}
          </p>
        )}
        {ledger.unmeasurable > 0 && (
          <p className="type-body-sm text-slate-400">
            {ledger.unmeasurable} with no baseline. Re-scanned, but the repository had no baseline scan when the PR
            opened, so there is nothing to compare against. Shown as not measured, not as zero.
          </p>
        )}
        {movement(ledger)}
        {ledger.rows.length > 0 && impactTableV2(ledger)}
      </div>
    </Frame>
  );
}
