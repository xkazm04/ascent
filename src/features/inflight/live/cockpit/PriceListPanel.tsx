"use client";

// THE REMEDIATION PRICE LIST — what a verified maturity point has cost this org, per model, per
// dimension.
//
// Every cell carries its `n`. That is not decoration: a rate from one lane and a rate from nine are
// different claims, and a table that prints only the number invites the reader to treat them as the
// same. There are deliberately NO intervals, variance figures or confidence marks — per-model noise
// bands are deck item #30 and are deferred, and a number dressed as more certain than its sample is
// the exact failure this ledger exists to avoid.
//
// The empty state SAYS WHAT IS MISSING rather than printing zeros. "No prices yet" and "every lane
// so far spent without a measurable pair" are different situations calling for different next moves.
//
// It fetches its own data once on mount rather than riding the run poll: the run poll is armed only
// while a run is live (useLoopRun's poll discipline), and a price list is a standing summary that
// should be there the moment the tab opens, run or no run.

import { useEffect, useState } from "react";
import { Kicker } from "@/components/ui";
import { InlineEmpty, TILE_LEDGER } from "@/components/org/shared/ui";
import { dimShort } from "@/lib/ui";
import { fmtMicrosPerPoint } from "@/lib/local/lane-economics";
import { fetchLoopPrices } from "./loopClient";
import type { RemediationPriceList } from "./loopTypes";

export interface PriceListPanelProps {
  slug: string;
  /** Server-rendered list, when a caller already has one. Omitted, the panel fetches its own. */
  initial?: RemediationPriceList | null;
}

export function PriceListPanel({ slug, initial = null }: PriceListPanelProps) {
  const [prices, setPrices] = useState<RemediationPriceList | null>(initial);
  const [loaded, setLoaded] = useState(initial != null);

  useEffect(() => {
    if (initial != null) return;
    let alive = true;
    void fetchLoopPrices(slug)
      .then((p) => {
        if (alive) setPrices(p);
      })
      .catch(() => null)
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [slug, initial]);

  // Nothing to say yet is not the same as nothing to price — say neither until the read lands.
  if (!loaded) return null;
  if (!prices) return null;

  return (
    <section aria-label="Remediation price list" className="mt-4">
      <Kicker tone="muted">Remediation price list</Kicker>
      {prices.rows.length === 0 ? (
        <InlineEmpty>
          A price needs a lane with both scan ends and a recorded cost. None of the lanes read here had all
          three yet.
        </InlineEmpty>
      ) : (
        <ul className={`mt-2 ${TILE_LEDGER}`}>
          {prices.rows.map((row) => (
            <li key={`${row.model}:${row.dimId}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 bg-ink px-4 py-2">
              <span className="min-w-0 font-mono text-xs text-slate-400">
                {dimShort(row.dimId)} <span className="text-slate-600">·</span> {row.model}
              </span>
              <span className="shrink-0 font-mono text-xs tabular-nums text-slate-300">
                {fmtMicrosPerPoint(row.microsPerPoint)}
                <span className="text-slate-500">/point</span>
                <span
                  className="ml-2 text-slate-600"
                  title="Contributing lanes. A rate from one lane and a rate from nine are different claims; the price is never shown without it."
                >
                  n={row.n}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <PriceListFooter prices={prices} />
    </section>
  );
}

/** The two caveats that make the table above honest, stated whenever they are non-zero. */
function PriceListFooter({ prices }: { prices: RemediationPriceList }) {
  const parts = [
    prices.unproductiveMicros > 0
      ? `${fmtMicrosPerPoint(prices.unproductiveMicros)} spent without measured movement`
      : null,
    prices.unpricedLanes > 0
      ? `${prices.unpricedLanes} ${prices.unpricedLanes === 1 ? "lane" : "lanes"} unpriced (no cost, no model, or no scan pair)`
      : null,
  ].filter((x): x is string => x !== null);
  if (parts.length === 0) return null;
  return (
    <p
      className="mt-2 font-mono text-xs tabular-nums text-slate-600"
      title="Spend that bought no measurable movement is stated as spend rather than averaged into everyone else's rate, and a lane nobody could price is counted rather than assumed free."
    >
      {parts.join(" · ")}
    </p>
  );
}
