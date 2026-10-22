// THE CALLS DRILL-IN MODEL - pure. Parses the `?calls=` filter, builds the links every spend figure on
// /usage opens with, and says WHY each unpriced call has no price.
//
// The "why" is NOT decided here. It is `priceCallGroup` (src/lib/db/usage-pricing.ts) - the one
// call-pricing rule the meter priced the call with at write time - applied to the row's own inputs.
// A second classifier is how a panel and the figure it opens from start disagreeing.
//
// DISPLAY ONLY: nothing here feeds a credit, a quota, a plan gate or a charge.

import { LANE_LABEL, type UsageLane } from "@/lib/llm/meter";
import { TABLE_BASIS, priceCallGroup, type PriceReason } from "@/lib/db/usage-pricing";
import type { UsageEventRow } from "@/lib/db/usage-events";
import type { CallsFilter, UnpricedGroup } from "@/lib/db/usage-ledger-read";

export type { CallsFilter };
export type UnpricedReason = Exclude<PriceReason, "priced">;

const LANES = Object.keys(LANE_LABEL) as UsageLane[];
const isLane = (v: string): v is UsageLane => (LANES as string[]).includes(v);

/** `?calls=` -> a filter, or `null` for anything unrecognised: a bad filter renders NO panel, never an
 *  unfiltered dump of the ledger. An empty team / repo is the org-wide bucket. */
export function parseCallsFilter(raw: string | null | undefined): CallsFilter | null {
  const s = (raw ?? "").trim();
  if (s === "unpriced") return { kind: "unpriced" };
  const cell = /^lane:([^,]+),team:(.*)$/.exec(s);
  if (cell) return isLane(cell[1]!) ? { kind: "cell", lane: cell[1], teamKey: cell[2] || null } : null;
  const m = /^(lane|team|repo):(.*)$/.exec(s);
  if (!m) return null;
  const value = m[2]!;
  if (m[1] === "lane") return isLane(value) ? { kind: "lane", lane: value } : null;
  if (m[1] === "team") return { kind: "team", teamKey: value || null };
  return { kind: "repo", repoFullName: value || null };
}

export function serializeCallsFilter(f: CallsFilter): string {
  switch (f.kind) {
    case "lane":
      return `lane:${f.lane}`;
    case "team":
      return `team:${f.teamKey ?? ""}`;
    case "repo":
      return `repo:${f.repoFullName ?? ""}`;
    case "cell":
      return `lane:${f.lane},team:${f.teamKey ?? ""}`;
    case "unpriced":
      return "unpriced";
  }
}

/** The /usage link that opens a figure's calls, on the same org and window. */
export function callsHref(org: string, days: number, f: CallsFilter): string {
  const q = new URLSearchParams({ org, days: String(days), calls: serializeCallsFilter(f) });
  return `/usage?${q.toString()}#calls`;
}

/** The same page with the panel closed. */
export function closeCallsHref(org: string, days: number): string {
  return `/usage?${new URLSearchParams({ org, days: String(days) }).toString()}`;
}

const ORG_WIDE = "Org-wide (no repo)";

export function callsFilterLabel(f: CallsFilter): string {
  switch (f.kind) {
    case "lane":
      return `Lane ${LANE_LABEL[f.lane]}`;
    case "team":
      return `Team ${f.teamKey ?? ORG_WIDE}`;
    case "repo":
      return `Repository ${f.repoFullName ?? ORG_WIDE}`;
    case "cell":
      return `${LANE_LABEL[f.lane]} × ${f.teamKey ?? ORG_WIDE}`;
    case "unpriced":
      return "Every unpriced call";
  }
}

/** The scan lane keeps its own ledger (stored scans), so a scan filter reads no rows here. */
export function isScanFilter(f: CallsFilter): boolean {
  return (f.kind === "lane" || f.kind === "cell") && f.lane === "scan";
}

type PricingInputs = Partial<Pick<UsageEventRow, "byom" | "provider" | "model" | "inputTokens" | "outputTokens" | "costMicros">>;

/**
 * Why a call carries no hosted price, or `null` when it was priced. A row the meter priced above $0
 * is priced. Otherwise the reason is `priceCallGroup`'s, on the row's own inputs and the table basis
 * the meter uses. A call the rule would price TODAY but whose stored cost is null had no rate when it
 * was metered: that is `unknown-model` (the stored row is never repriced).
 */
export function unpricedReason(row: PricingInputs): UnpricedReason | null {
  if (row.costMicros != null && row.costMicros > 0) return null;
  const p = priceCallGroup(
    {
      provider: row.provider ?? null,
      model: row.model ?? null,
      byom: row.byom ?? null,
      inputTokens: row.inputTokens ?? 0,
      outputTokens: row.outputTokens ?? 0,
    },
    TABLE_BASIS,
  );
  if (p.reason === "priced") return row.costMicros == null ? "unknown-model" : null;
  return p.reason;
}

export interface ReasonCopy {
  label: string;
  why: string;
  /** Only where a configuration change would ever close the gap. */
  fix: string | null;
}

export const REASON_COPY: Record<UnpricedReason, ReasonCopy> = {
  byom: {
    label: "Your provider account",
    why: "Served by your own provider account (BYOM). Ascent has no figure for it, and no rate will ever close it: the bill is your vendor's.",
    fix: null,
  },
  "zero-cost": {
    label: "Local inference",
    why: "Ran on your own GPU. Priced at exactly $0 by design, not missing a rate.",
    fix: null,
  },
  "no-usage": {
    label: "No usage reported",
    why: "The provider reported no tokens (a mock run or a timed-out call), so there is nothing to price.",
    fix: null,
  },
  "unknown-model": {
    label: "Unknown model",
    why: "No built-in rate matches this model, and the table refuses to guess one.",
    fix: "Fix: set LLM_INPUT/OUTPUT_COST_PER_MTOK (scan lane) or add a price for this model to the built-in table (other lanes). Calls metered from then on are priced; stored calls are not repriced.",
  },
};

export type ReasonCounts = Record<UnpricedReason, number>;

/** Per-reason counts over UNPRICED inputs (stored cost null), each weighted by its `calls` (default
 *  1). They sum to the filter's unpriced count: every null-cost row has exactly one reason. */
export function summarizeUnpriced(rows: readonly (PricingInputs & { calls?: number })[]): ReasonCounts {
  const out: ReasonCounts = { byom: 0, "zero-cost": 0, "no-usage": 0, "unknown-model": 0 };
  for (const r of rows) {
    if (r.costMicros != null) continue;
    const reason = unpricedReason({ ...r, costMicros: null });
    if (reason) out[reason] += r.calls ?? 1;
  }
  return out;
}

/** A db group as the pricing inputs it stands for. */
export function groupInputs(g: UnpricedGroup): PricingInputs & { calls: number } {
  return { provider: g.provider, model: g.model, byom: g.byom, inputTokens: g.tokensReported ? 1 : 0, outputTokens: 0, costMicros: null, calls: g.calls };
}

/** The panel's three lists: failed calls apart (never mixed into the priced list), then priced, then
 *  unpriced. Order within each is the read's (most expensive first). */
export function groupCalls(rows: readonly UsageEventRow[]) {
  const failed: UsageEventRow[] = [];
  const priced: UsageEventRow[] = [];
  const unpriced: UsageEventRow[] = [];
  for (const r of rows) {
    if (r.status !== "success") failed.push(r);
    else if (r.costMicros != null) priced.push(r);
    else unpriced.push(r);
  }
  return { failed, priced, unpriced };
}
