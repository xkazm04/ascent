// THE CALL-PRICING RULE - one place that decides what one model call is estimated to cost.
//
// Before this module the price of a call was decided in three places that disagreed: the env-rate
// estimator (the scan lane headline), the built-in table fold (the scan per-team / per-repo / matrix
// cells and the scan unpriced count) and the meter's `costMicrosFor` (every ledger lane). With
// LLM_*_COST_PER_MTOK set they priced the same window three ways: local GPU tokens at the hosted
// rate in one panel and $0 in the next, env-priced unknown-model scans still counted "unpriced", and
// the team/repo/matrix cells on the table while the lane row used env. Now every fold and the meter
// call `priceCallGroup` with ONE basis, resolved once per summary.
//
// DISPLAY ONLY. Every figure this produces is an ESTIMATE shown on /usage, its CSVs and the spend
// digest. Nothing here feeds a credit, a quota, a plan gate or a charge; the billable unit is the
// Scan COUNT (`isBillableScan`), which this module never sees.
//
// PURE: no db client, no Prisma. The meter (an LLM-seam module) imports it, and must stay free of a
// static db edge (see the meter header, property 3).

import { isZeroCostProvider, priceForModel } from "@/lib/llm/config";

/**
 * Why a call group got the price it got. Exactly one per group, checked in this order:
 *   - `byom`          - the org's OWN provider account served it; Ascent has no figure. Unpriced.
 *   - `zero-cost`     - local inference on the operator's GPU; priced at exactly $0.
 *   - `no-usage`      - no tokens reported (mock, claude-cli timeout path); nothing to price. Unpriced.
 *   - `unknown-model` - the table basis has no rate for the model and refuses to guess. Unpriced.
 *   - `priced`        - a real rate applied to real tokens.
 */
export type PriceReason = "priced" | "zero-cost" | "byom" | "no-usage" | "unknown-model";

/** The rate source. `env` = the operator's LLM_*_COST_PER_MTOK override (both set); `table` = the
 *  built-in MODEL_PRICES. Resolved ONCE per summary so every fold prices by the same basis. */
export type PricingBasis = { kind: "env"; inPerMTok: number; outPerMTok: number } | { kind: "table" };

export const TABLE_BASIS: PricingBasis = { kind: "table" };

/** One (provider, model, byom) group's token totals - the input to every cost fold. */
export interface ModelTokenUsage {
  model: string | null;
  /** Persisted `Scan.engineProvider`. Optional so older callers/mocks still typecheck, but supplying
   *  it is what lets the fold recognize a $0 provider. */
  provider?: string | null;
  /** `true` = the org's own provider account. Nullable/absent means the platform account, so it
   *  stays priceable - the same `!== true` rule `isBillableScan` and the meter apply. */
  byom?: boolean | null;
  inputTokens: number;
  outputTokens: number;
}

/** A group with the call count the unpriced figure needs beside its tokens. */
export type CallGroup = ModelTokenUsage & { calls?: number };

export interface CallPrice {
  usd: number | null;
  reason: PriceReason;
}

function parseRate(raw: string | undefined): number | null {
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** The env basis, or null unless BOTH rates parse: a partial config must never price the other side
 *  at a silent $0. A deliberately-set "0" is a valid explicit price. */
export function envBasis(inRateRaw: string | undefined, outRateRaw: string | undefined): PricingBasis | null {
  const inPerMTok = parseRate(inRateRaw);
  const outPerMTok = parseRate(outRateRaw);
  return inPerMTok == null || outPerMTok == null ? null : { kind: "env", inPerMTok, outPerMTok };
}

/** The scan lane's basis: env rates when both are set, the built-in table otherwise. */
export function resolveScanBasis(
  env: Record<string, string | undefined> = process.env,
): PricingBasis {
  return envBasis(env.LLM_INPUT_COST_PER_MTOK, env.LLM_OUTPUT_COST_PER_MTOK) ?? TABLE_BASIS;
}

/** Whether a reason leaves the call without a price (it lands in `unpricedCalls`). */
export function isUnpricedReason(reason: PriceReason): boolean {
  return reason === "byom" || reason === "no-usage" || reason === "unknown-model";
}

/** THE rule: the estimated USD of one call group under one basis, with the reason. PURE. */
export function priceCallGroup(g: ModelTokenUsage, basis: PricingBasis): CallPrice {
  // BYOM first: a BYOM run served by a zero-cost local provider is still the org's own spend.
  if (g.byom === true) return { usd: null, reason: "byom" };
  // Before the token check and before any rate: local tokens cost nothing, so a local tag that
  // prefix-matches a hosted MODEL_PRICES row, or an operator's hosted env rate, can never invoice it.
  if (isZeroCostProvider(g.provider)) return { usd: 0, reason: "zero-cost" };
  if (g.inputTokens + g.outputTokens === 0) return { usd: null, reason: "no-usage" };
  const rate =
    basis.kind === "env" ? { inPerMTok: basis.inPerMTok, outPerMTok: basis.outPerMTok } : priceForModel(g.model);
  if (!rate) return { usd: null, reason: "unknown-model" };
  return {
    usd: (g.inputTokens / 1_000_000) * rate.inPerMTok + (g.outputTokens / 1_000_000) * rate.outPerMTok,
    reason: "priced",
  };
}

/**
 * Fold groups into one estimate + the count of calls nothing could price.
 *
 * `usd` is null when nothing was priced (a BYOM-only or mock-only window reads "no estimate", never a
 * $0 that looks like a free month) and null when ANY group is `unknown-model`: a partial figure that
 * silently omits the unpriceable tokens is the half-billing trap. BYOM and no-usage groups do not
 * null the fold; they are counted in `unpricedCalls`, so the figure reads as a floor.
 */
export function foldCallGroups(
  groups: readonly CallGroup[],
  basis: PricingBasis,
): { usd: number | null; unpricedCalls: number } {
  let usd = 0;
  let pricedAny = false;
  let refused = false;
  let unpricedCalls = 0;
  for (const g of groups) {
    const p = priceCallGroup(g, basis);
    if (isUnpricedReason(p.reason)) {
      unpricedCalls += g.calls ?? 0;
      if (p.reason === "unknown-model") refused = true;
      continue;
    }
    usd += p.usd ?? 0;
    pricedAny = true;
  }
  return { usd: refused || !pricedAny ? null : usd, unpricedCalls };
}

/** Lump-sum estimate from token totals at explicit per-MTok rates; null unless BOTH rates are set.
 *  Kept for its callers; the summary folds per group through {@link priceCallGroup} instead. */
export function estimateLlmCostUsd(
  inputTokens: number,
  outputTokens: number,
  inRateRaw: string | undefined,
  outRateRaw: string | undefined,
): number | null {
  const basis = envBasis(inRateRaw, outRateRaw);
  if (basis?.kind !== "env") return null;
  return (inputTokens / 1_000_000) * basis.inPerMTok + (outputTokens / 1_000_000) * basis.outPerMTok;
}

/** The built-in table fold ({@link foldCallGroups} on {@link TABLE_BASIS}). */
export function estimateLlmCostFromTable(usage: readonly ModelTokenUsage[]): number | null {
  return foldCallGroups(usage, TABLE_BASIS).usd;
}

/** How many calls could not be costed under `basis` (BYOM, no tokens, or no rate for the model).
 *  A zero-cost provider is NOT counted: local inference has a real price and it is zero. */
export function unpricedScanCalls(usage: readonly CallGroup[], basis: PricingBasis = TABLE_BASIS): number {
  return foldCallGroups(usage, basis).unpricedCalls;
}
