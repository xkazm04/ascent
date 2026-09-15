// The headline "Est. cost" tile's value + caption.
//
// It exists as a pure module because the tile carries THREE facts that must never come apart:
// which lanes the figure covers, which basis priced them, and whether the figure is a floor. UAT
// VICTOR-L1-05 (live-confirmed in arm B, 2026-08-30) caught the page shipping the first fact
// implicitly and wrong: the tile priced the scan lane alone ($25.90) while the "Spend by lane"
// table three rows below summed to $115.28 — the big number a FinOps director reads first was the
// small one. The fix is not a bigger number; it is a number that says what it covers.
//
// Floor honesty is the lane rows' rule, lifted to the headline: a call that could not be priced is
// NEVER folded in as $0. It is disclosed as a count, so "$115.28" reads as "at least $115.28".

import type { UsageSummary } from "@/lib/db";

/**
 * How the tile should describe the basis that priced the figure.
 *
 * `costBasis` describes the SCAN lane only — it is the basis `getUsageSummary` chose for the Scan
 * token totals. Every other lane was priced at write time from the built-in per-model table
 * (`costMicros` on the ledger row), which the operator's `LLM_*_COST_PER_MTOK` override does not
 * reach. So a multi-lane figure under an env override is genuinely mixed, and says so rather than
 * claiming the operator's own rates produced all of it.
 */
function basisPhrase(costBasis: UsageSummary["costBasis"], multiLane: boolean): string {
  if (costBasis === "env") return multiLane ? "configured + built-in rates" : "configured rates";
  // A null basis with a real figure means the scan lane priced nothing but the ledger did: the
  // figure is still built-in-table money, so don't caption it "no rate configured".
  return "built-in rates (approx.)";
}

export function costHeadline(usage: {
  periodDays: number;
  costBasis: UsageSummary["costBasis"];
  allLanesCostUsd: number | null;
  allLanesUnpricedCalls: number;
  byomScans?: number;
  byLane: { lane: string }[];
}): { value: string; sub: string } {
  const { allLanesCostUsd, allLanesUnpricedCalls } = usage;
  // BYOM scans are already inside `allLanesUnpricedCalls` (they are unpriceable calls), but "34
  // calls unpriced" and "34 calls unpriced, 12 of them BYOM" are different answers: the first invites
  // the reader to go configure a rate, and no rate will ever price a BYOM scan. Naming the BYOM share
  // is the difference between a gap the operator can close and one that is closed by design.
  const byom = usage.byomScans ?? 0;
  const byomNote = byom > 0 ? ` · ${byom.toLocaleString()} BYOM scan${byom === 1 ? "" : "s"}, unpriced` : "";
  // One lane in the period means "all lanes" would be a distinction without a difference — name the
  // lane instead, so the caption is never vaguer than the page's own itemization.
  const scope =
    usage.byLane.length === 1 && usage.byLane[0]?.lane === "scan"
      ? "scan lane"
      : usage.byLane.length <= 1
        ? "all lanes"
        : `all ${usage.byLane.length} lanes`;

  if (allLanesCostUsd == null) {
    // Nothing could be priced. Say how much went unpriced rather than printing "—" over real volume.
    return {
      value: "—",
      sub:
        allLanesUnpricedCalls > 0
          ? `${allLanesUnpricedCalls.toLocaleString()} call${allLanesUnpricedCalls === 1 ? "" : "s"} unpriced${byomNote} · set LLM_*_COST_PER_MTOK to estimate`
          : `set LLM_*_COST_PER_MTOK to estimate${byomNote}`,
    };
  }

  const floor =
    allLanesUnpricedCalls > 0
      ? ` · floor: +${allLanesUnpricedCalls.toLocaleString()} call${allLanesUnpricedCalls === 1 ? "" : "s"} unpriced`
      : "";
  return {
    value: `$${allLanesCostUsd.toFixed(2)}`,
    sub: `last ${usage.periodDays}d · ${scope} · ${basisPhrase(usage.costBasis, usage.byLane.length > 1)}${floor}${byomNote}`,
  };
}
