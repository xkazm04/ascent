"use client";

// ROI Simulator diagram — the interactive centerpiece, now multi-lever. Drag any dimension target and
// the whole fleet recomputes live: bars grow from each repo's current score to its projected score,
// repos that cross a level boundary flash a promotion badge, and the tiles tally promotions / average
// gain / repos in scope. Mirrors the real /org what-if simulator across several dimensions at once.

import { useState } from "react";
import { motion } from "framer-motion";
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
const W = 0.16; // each dimension's contribution to the overall index (illustrative)

export function RoiSimulator() {
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
              className="h-1 flex-1 cursor-pointer accent-[#3b9eff]"
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
                transition={{ type: "spring", stiffness: 130, damping: 20 }}
              />
              <span aria-hidden className="absolute inset-y-0 w-px bg-white/40" style={{ left: `${r.base}%` }} />
            </div>
            <span className="w-7 text-right font-mono text-xs tabular-nums" style={{ color: scoreHex(r.next) }}>
              {r.next}
            </span>
            <span className={`w-8 font-mono text-xs ${r.promoted ? "text-emerald-400" : "text-transparent"}`}>
              ↑{r.after.id}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-divider bg-divider text-center">
        {[
          { v: promotions, l: "promoted", accent: true },
          { v: `+${avgGain}`, l: "avg gain" },
          { v: affected, l: "in scope" },
        ].map((tile) => (
          <div key={tile.l} className="bg-ink p-3">
            <div className={`font-mono text-2xl font-bold tabular-nums ${tile.accent ? "text-accent" : "text-white"}`}>
              {tile.v}
            </div>
            <div className="mt-0.5 font-mono text-xs uppercase tracking-widest text-slate-500">{tile.l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
