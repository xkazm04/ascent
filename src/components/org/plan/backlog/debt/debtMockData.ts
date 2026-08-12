// ⚠️ MOCK DATA — PROTOTYPE ONLY. DO NOT SHIP. ⚠️
//
// The "AI-era debt" surface joins two halves:
//   1. OVERDUE RECOMMENDATION DEBT — REAL. Comes from `OrgBacklog` (getOrgBacklog), the same rows the
//      Backlog tab already renders. See debtModel.ts.
//   2. DELIVERY-QUALITY DEBT — NOT MODELLED YET. rework rate, reversion rate, and churn on
//      AI-authored code have no table, no ingest, and no scan signal in ascent today. This module
//      fabricates them deterministically from the repo name so the variants can be evaluated on
//      layout/metaphor rather than on a data pipeline that doesn't exist.
//
// Everything here is replaced wholesale when the real signal lands. The intended source (see
// docs/ + the agentic-SDLC research pass) is git-side and repo-keyed, so it is cheap to ingest:
//   - aiAuthoredShare : share of merged PRs carrying an AI co-author/`Assisted-By` git trailer.
//   - reworkRate      : DORA 2025's replacement for acceptance rate — share of merged changes whose
//                       lines are rewritten again within a 30-day window.
//   - reversionRate   : Shopify's guardrail metric — share of merged PRs later reverted.
//   - aiChurnShare    : share of that rework/churn landing on lines an AI authored.
// Research anchor for the ranges below: heavy-AI projects measure materially higher defect and
// rework rates (~+41% bugs) than low-AI peers, so the mock correlates rework with aiAuthoredShare
// instead of drawing them independently — a flat, uncorrelated mock would make every variant's
// central claim ("AI velocity is buying quality debt") invisible.

/** One repo's AI-delivery quality metrics. Rates are 0–1 fractions unless the name says otherwise. */
export interface RepoAiQuality {
  repo: string; // owner/name
  /** Share of merged PRs attributed to an AI assistant via git trailer. */
  aiAuthoredShare: number;
  /** Share of merged changes rewritten again within 30 days (DORA 2025 rework rate). */
  reworkRate: number;
  /** The same window, one period earlier — for the trend arrow. */
  reworkRatePrev: number;
  /** Share of merged PRs later reverted (Shopify guardrail). */
  reversionRate: number;
  reversionRatePrev: number;
  /** Lines changed per week, rolling 4-week mean. */
  churnPerWeek: number;
  /** Share of that churn landing on AI-authored lines. */
  aiChurnShare: number;
  /** 12 weekly points, oldest first — the trend the fault-line variant traces. */
  series: WeeklyPoint[];
}

export interface WeeklyPoint {
  /** Weeks before now (11 = oldest, 0 = current). */
  weeksAgo: number;
  aiAuthoredShare: number;
  reworkRate: number;
}

/** Deterministic 0–1 pseudo-random from a string + salt (mulberry-ish), so a repo always mocks the
 *  same numbers across renders and across server/client — a Math.random() mock hydration-mismatches. */
function seeded(key: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return ((h >>> 0) % 100000) / 100000;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Fabricate one repo's quality metrics. Rework is drawn AS A FUNCTION of AI share (see header). */
export function mockRepoQuality(repo: string): RepoAiQuality {
  const ai = clamp01(0.12 + seeded(repo, 1) * 0.78);
  const noise = (salt: number, spread: number) => (seeded(repo, salt) - 0.5) * spread;

  // Baseline rework ~9%, rising to ~26% at full AI authorship (+41% relative bug rate, amplified by
  // the rework window catching rewrites the bug count misses), ± per-repo noise.
  const reworkRate = clamp01(0.09 + ai * 0.17 + noise(2, 0.06));
  const drift = noise(3, 0.07); // period-over-period movement, either direction
  const reworkRatePrev = clamp01(reworkRate - drift);

  const reversionRate = clamp01(0.012 + ai * 0.055 + noise(4, 0.018));
  const reversionRatePrev = clamp01(reversionRate - noise(5, 0.022));

  const churnPerWeek = Math.round(400 + seeded(repo, 6) * 5200 + ai * 2600);
  // Churn concentrates on AI-authored lines slightly ahead of authorship share — the "AI writes it,
  // humans rewrite it" effect the surface exists to show.
  const aiChurnShare = clamp01(ai * 0.86 + 0.14 * seeded(repo, 7) + 0.06);

  const series: WeeklyPoint[] = Array.from({ length: 12 }, (_, i) => {
    const weeksAgo = 11 - i;
    const t = i / 11; // 0 = oldest … 1 = now
    return {
      weeksAgo,
      // AI share ramps toward today's value from ~55% of it 12 weeks ago.
      aiAuthoredShare: clamp01(ai * (0.55 + 0.45 * t) + noise(20 + i, 0.05)),
      // Rework trails AI share by a few weeks — the lag is the story of the trend variants.
      reworkRate: clamp01(
        reworkRatePrev + (reworkRate - reworkRatePrev) * t + (ai - 0.4) * 0.05 * t + noise(40 + i, 0.035),
      ),
    };
  });

  return {
    repo,
    aiAuthoredShare: ai,
    reworkRate,
    reworkRatePrev,
    reversionRate,
    reversionRatePrev,
    churnPerWeek,
    aiChurnShare,
    series,
  };
}

/** Fleet-wide mock: one entry per repo present in the backlog. */
export function mockFleetQuality(repos: string[]): Map<string, RepoAiQuality> {
  return new Map(repos.map((r) => [r, mockRepoQuality(r)]));
}

/** Fleet medians — the "vs fleet" reference line every variant compares a repo against. */
export function fleetMedian(all: RepoAiQuality[], pick: (q: RepoAiQuality) => number): number {
  if (all.length === 0) return 0;
  const xs = all.map(pick).sort((a, b) => a - b);
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid]! : (xs[mid - 1]! + xs[mid]!) / 2;
}
