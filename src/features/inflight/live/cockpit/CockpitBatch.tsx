"use client";

// SHARED GROUND — what the current selection has in COMMON, as one bar per dimension.
//
// This file used to also hold the PROPOSED BATCH (one card per repo, a checkbox list inside). That
// left for the main column on 2026-09-17 and is now `CockpitBatchLedger` + `cockpitBatchRows`: a
// table, in the Proposals ledger's own shape. What stays here is the only part of the old pair that
// is genuinely a RAIL object — a six-row summary of the selection, which is a reading rather than a
// decision and needs no width.

import { Kicker } from "@/components/ui";
import { isOrgWide, shareLine, type SharedDimensions } from "./cockpitDimensions";

export function SharedDimensionBars({ shares }: { shares: SharedDimensions }) {
  if (shares.rows.length === 0) return null;
  return (
    <div className="mt-4">
      <Kicker tone="muted">Shared ground</Kicker>
      <ul className="mt-2 space-y-1.5">
        {shares.rows.slice(0, 6).map((row) => {
          const wide = isOrgWide(row, shares.total);
          return (
            <li key={row.dimId} className="flex items-center gap-2">
              <span className="w-16 shrink-0 type-caption text-slate-400">{row.dimId}</span>
              <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-divider">
                <span
                  className={`block h-full ${wide ? "bg-accent" : "bg-slate-600"}`}
                  style={{ width: `${Math.round(row.share * 100)}%` }}
                />
              </span>
              <span className={`w-32 shrink-0 text-right type-caption tabular-nums ${wide ? "text-accent" : "text-slate-500"}`}>
                {wide ? shareLine(row, shares.total) : `${row.repos}/${shares.total}`}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
