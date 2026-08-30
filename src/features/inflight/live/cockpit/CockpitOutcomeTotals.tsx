"use client";

// THE OUTCOME HEADER'S TALLY, extracted from CockpitOutcomeLedger so that file stays inside the
// 200-LOC cap AGENTS.md sets for src/features. PURE RELOCATION — the component, its comments and its
// props are byte-for-byte what they were, and the ledger re-exports it so no call site moved.

import { deltaHex, fmtDelta, Kicker } from "@/components/ui";
import type { RunAttribution } from "./cockpitDrift";

/**
 * The three-way tally the outcome header leads with, plus what the headline number EXCLUDED. A run of
 * four one-point movements is not "+4" — the lift holds only the attributable lanes — so the counts
 * beside it are what stops that reading as "nothing happened": "no lift, 3 within noise" and "no
 * lift, 3 mock scans" are different situations calling for opposite next moves.
 */
export function OutcomeTotals({
  lift,
  improved,
  flat,
  regressed,
  excluded,
}: {
  lift: number | null;
  improved: number;
  flat: number;
  regressed: number;
  excluded: Pick<RunAttribution, "withinNoise" | "mock" | "unmeasured" | "undelivered">;
}) {
  const parts = [
    excluded.withinNoise > 0 ? `${excluded.withinNoise} within noise` : null,
    excluded.mock > 0 ? `${excluded.mock} mock ${excluded.mock === 1 ? "scan" : "scans"}` : null,
    excluded.unmeasured > 0 ? `${excluded.unmeasured} not measured` : null,
    excluded.undelivered > 0 ? `${excluded.undelivered} uncommitted` : null,
  ].filter((x): x is string => x !== null);

  return (
    <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <span className="type-figure" style={{ color: deltaHex(lift ?? 0) }}>
        {lift == null ? "—" : fmtDelta(lift)}
      </span>
      <Kicker tone="muted">attributable lift</Kicker>
      <span className="type-caption tabular-nums text-slate-500">
        {improved} improved · {flat} flat · {regressed} regressed
      </span>
      {parts.length > 0 && (
        <span
          className="type-caption tabular-nums text-slate-600"
          title="Held out of the lift: a movement smaller than the measured run-to-run noise band, or one measured across a scan that fell to the deterministic mock floor, is not evidence the repository changed. Neither is a movement a lane never committed — the loop scans a worktree it then deletes, so an uncommitted lane measured a state that no longer exists."
        >
          excluded: {parts.join(" · ")}
        </span>
      )}
    </div>
  );
}
