// The repos behind a gap: one trailing side's population ranked worst-first on the metric that is
// trailing, each row carrying the two things a reader can do with it.
//
// Before this, a dimension gap was a readout: "Platform trails Legacy by 14 on Testing" named no repo
// and offered no action, and the reader had to leave for the Repositories tab, set `?segment=`, sort,
// and guess which rows dragged the mean — although the rollup the mean came from held every repo's
// per-dimension score the whole time (`SegmentSummary.points`, 2026-10-05).
//
// Two honesty rules it inherits rather than re-deciding:
//   WATCHED vs TAGGED — POST /api/org/scan intersects its request with the WATCH list, so a Rescan
//     offered on a tagged-but-unwatched repo would promise a scan the route drops. SegmentActions
//     states the same intersection in its button label (SegmentsSection.tsx passes the watched set);
//     here it decides whether the control is offered at all. The control itself is the existing
//     RepoRescanButton with the existing GitHub-App gate, so this adds no new way to spend a credit.
//   NOT SCORED is not ZERO — a repo whose latest scan carries no row for this dimension is listed
//     separately, under its own heading, with no number. Ranking it at 0 would put it at the top of a
//     worst-first list it does not belong on at all.
//
// Server-safe: no hooks, no handlers. RepoRescanButton is the one client island.

import Link from "next/link";
import { RepoRescanButton } from "./RepoRescanButton";
import { Kicker } from "@/components/ui";
import { scoreHex } from "@/lib/ui";
import { laggards, type DistSide } from "./segmentViz";

/** Enough to act on without becoming a second leaderboard. The row count is stated, so a reader knows
 *  the list is a head and not the whole side. */
const SHOWN = 5;

function RepoLine({ fullName }: { fullName: string }) {
  return (
    <Link href={`/report/${fullName}`} className="truncate type-mono-sm text-white hover:text-accent">
      {fullName}
    </Link>
  );
}

export function SegmentGapLaggards({
  org,
  side,
  metricLabel,
  watched,
  schedulable,
}: {
  org: string;
  /** The TRAILING side of the row — the population whose laggards are worth naming. */
  side: DistSide;
  metricLabel: string;
  /** Repos on the org's watch list. A repo outside it gets the report link only. */
  watched: ReadonlySet<string>;
  /** The GitHub App is configured, so /api/org/scan can actually run. Mirrors the leaderboard's gate. */
  schedulable: boolean;
}) {
  const worst = laggards(side, SHOWN);
  if (worst.length === 0 && side.unscored.length === 0) {
    return <p className="type-body-sm text-slate-500">{`${side.name} has no repo scored on ${metricLabel}.`}</p>;
  }
  return (
    <div className="space-y-3">
      {worst.length > 0 && (
        <div>
          <Kicker tone="muted" as="div">
            {`${side.name} · weakest on ${metricLabel}${side.n > worst.length ? ` (${worst.length} of ${side.n})` : ""}`}
          </Kicker>
          <ul className="mt-1 divide-y divide-slate-800/70">
            {worst.map((it) => (
              <li key={it.fullName} data-laggard={it.fullName} className="flex items-center gap-3 py-1.5">
                <span className="w-7 shrink-0 text-right type-mono-sm tabular-nums" style={{ color: scoreHex(it.value) }}>
                  {Math.round(it.value)}
                </span>
                <span className="min-w-0 flex-1">
                  <RepoLine fullName={it.fullName} />
                </span>
                {watched.has(it.fullName) ? (
                  <RepoRescanButton org={org} fullName={it.fullName} disabled={!schedulable} disabledHint="Rescanning requires the GitHub App." />
                ) : (
                  // Tagged into the segment but not watched: the scan route would drop it, so there is
                  // no Rescan to offer. Say which it is rather than showing a control that cannot work.
                  <span className="shrink-0 type-mono-sm text-slate-600" title="Not on the watch list, so a scan request for it is dropped.">
                    tagged, not watched
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {side.unscored.length > 0 && (
        <div>
          <Kicker tone="muted" as="div">not scored on this dimension</Kicker>
          <ul className="mt-1 space-y-1">
            {side.unscored.map((fullName) => (
              <li key={fullName} data-unscored={fullName} className="flex items-center gap-3">
                <span aria-hidden className="w-7 shrink-0 text-right type-mono-sm text-slate-600">—</span>
                <span className="min-w-0 flex-1">
                  <RepoLine fullName={fullName} />
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1 type-body-sm text-slate-500">
            Their latest scan carries no grade for {metricLabel}, so they are outside this mean rather than at the bottom of it.
          </p>
        </div>
      )}
    </div>
  );
}
