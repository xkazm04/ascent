// The posture composition's arithmetic, shared by both compositions: true shares in POSTURE_ORDER, zero
// segments kept (the legend prints them, the bar skips them). `total` floors at 1 so an empty fleet never divides by zero.
import { POSTURE_ORDER } from "@/components/org/shared/ui";

export interface PostureShare {
  posture: string;
  n: number;
  /** 0..1 of the scored repos. */
  share: number;
  /** Whole percent, for titles. */
  pct: number;
}

export function postureShares(counts: Record<string, number>): { shares: PostureShare[]; scored: number } {
  const scored = POSTURE_ORDER.reduce((sum, p) => sum + (counts[p] ?? 0), 0);
  const total = Math.max(1, scored);
  return {
    scored,
    shares: POSTURE_ORDER.map((p) => {
      const n = counts[p] ?? 0;
      return { posture: p, n, share: n / total, pct: Math.round((n / total) * 100) };
    }),
  };
}
