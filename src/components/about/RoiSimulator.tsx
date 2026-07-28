"use client";

// ROI Simulator diagram — the interactive centerpiece, now multi-lever. Drag any dimension target and
// the whole fleet recomputes live: bars grow from each repo's current score to its projected score,
// repos that cross a level boundary flash a promotion badge, and the tiles tally promotions / average
// gain / repos in scope. Mirrors the real /org what-if simulator across several dimensions at once.

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { HairlineGrid, Stat } from "@/components/ui";
import { scoreHex } from "@/lib/ui";
import { levelForScore } from "@/lib/maturity/model";

const DIMS = [
  { key: "testing", label: "Testing" },
  { key: "cicd", label: "CI / CD" },
  { key: "conv", label: "Conventions" },
] as const;
type DimKey = (typeof DIMS)[number]["key"];

const REPOS: { name: string; base: number; testing: number; cicd: number; conv: number }[] = [
  { name: "web-app", base: 38, testing: 20, cicd: 35, conv: 28 },
  { name: "api-gateway", base: 52, testing: 44, cicd: 50, conv: 48 },
  { name: "mobile-client", base: 41, testing: 30, cicd: 38, conv: 33 },
  { name: "design-system", base: 61, testing: 56, cicd: 58, conv: 62 },
  { name: "billing", base: 33, testing: 15, cicd: 28, conv: 22 },
  { name: "data-pipeline", base: 47, testing: 38, cicd: 30, conv: 40 },
  { name: "auth-service", base: 44, testing: 26, cicd: 42, conv: 35 },
  { name: "docs-site", base: 29, testing: 12, cicd: 20, conv: 18 },
];
// Each dimension's contribution to the overall index in THIS demo. Deliberately NOT the production
// weighting: the index is nine dimensions (≈ 1/9 ≈ 0.11 each), rounded up to 0.16 so the three
// sliders here produce visible movement and level promotions at demo scale. The real /org what-if
// simulator computes lift from the rubric's actual archetype weights — keep this constant and the
// paired copy in features.ts (the `roi` entry's copy contract) honest together.
const W = 0.16;

export function RoiSimulator() {
  // ABOUT #1: the bars animate `width` (non-transform), which reducedMotion="user" doesn't degrade —
  // gate the growth animation so reduced-motion users get bars rendered at their final width.
  const reduced = useReducedMotion();
  const [t, setT] = useState<Record<DimKey, number>>({ testing: 45, cicd: 30, conv: 30 });
  const rows = REPOS.map((r) => {
    const lift = DIMS.reduce((s, d) => s + Math.max(0, t[d.key] - r[d.key]) * W, 0);
    const next = Math.min(100, Math.round(r.base + lift));
    const before = levelForScore(r.base);
    const after = levelForScore(next);
    return { ...r, next, after, promoted: after.band[0] > before.band[0] };
  });
  const promotions = rows.filter((r) => r.promoted).length;
  const affected = rows.filter((r) => r.next > r.base).length;
  const avgGain = Math.round(rows.reduce((s, r) => s + (r.next - r.base), 0) / rows.length);

  return (
    <div>
      <div className="space-y-2">
        {DIMS.map((d) => (
          <div key={d.key} className="flex items-center gap-3">
            <label htmlFor={`roi-${d.key}`} className="w-32 shrink-0 font-mono text-xs uppercase tracking-wider text-slate-400">
              {d.label} <span className="text-sm text-accent">{t[d.key]}</span>
            </label>
            <input
              id={`roi-${d.key}`}
              type="range"
              min={10}
              max={90}
              value={t[d.key]}
              onChange={(e) => setT((p) => ({ ...p, [d.key]: Number(e.target.value) }))}
              className="h-1 flex-1 cursor-pointer accent-accent"
              aria-label={`Target ${d.label} score`}
            />
          </div>
        ))}
      </div>

      <div className="mt-4 space-y-2 border-t border-divider pt-4">
        {rows.map((r) => (
          <div key={r.name} className="flex items-center gap-3">
            <span className="w-28 shrink-0 truncate font-mono text-xs text-slate-400">{r.name}</span>
            <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-surface-strong">
              <motion.div
                className="h-full rounded-full"
                style={{ backgroundColor: scoreHex(r.next) }}
                animate={{ width: `${r.next}%` }}
                // Reduced motion: snap to the target width (no spring) so the bar still reflects the
                // current slider value without the growing sweep.
                transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 130, damping: 20 }}
              />
              <span aria-hidden className="absolute inset-y-0 w-px bg-white/40" style={{ left: `${r.base}%` }} />
            </div>
            <span className="w-7 text-right font-mono text-xs tabular-nums" style={{ color: scoreHex(r.next) }}>
              {r.next}
            </span>
            {/* ABOUT #2: only render the promotion badge when the repo actually crossed a level —
                a transparent badge on every row was still read by screen readers as a phantom
                promotion. The fixed-width wrapper preserves row alignment when absent. */}
            <span className="w-8 font-mono text-xs text-emerald-400">
              {r.promoted ? `↑${r.after.id}` : ""}
            </span>
          </div>
        ))}
      </div>

      {/* The tally ledger is the brand HairlineGrid + Stat `figure-compact`, not a hand-copied class
          string. The grid's radius moves rounded-xl → rounded-2xl in the process: rounded-xl was drift,
          and every other hairline cluster on this page (including the masthead's stat ledger) is 2xl. */}
      <HairlineGrid className="mt-5 grid-cols-3 text-center">
        {[
          { v: promotions, l: "promoted", accent: true },
          { v: `+${avgGain}`, l: "avg gain" },
          { v: affected, l: "in scope" },
        ].map((tile) => (
          <Stat
            key={tile.l}
            variant="figure-compact"
            className="bg-ink p-3"
            label={tile.l}
            value={tile.v}
            color={tile.accent ? "var(--color-accent)" : undefined}
          />
        ))}
      </HairlineGrid>
    </div>
  );
}
