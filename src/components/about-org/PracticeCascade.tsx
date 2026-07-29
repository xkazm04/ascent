"use client";

// "Fix once, apply across the fleet" — the practice library's leverage, drawn.
//
// One authored artifact at the top, a fan of connectors, and the repos it lands in below. The reader
// picks a practice from the real catalog (PRACTICES, src/lib/practices.ts — not an invented list) and
// the fan re-targets to the repos that practice is missing, with the run bounded at the SAME 25-repo
// batch cap the shipping endpoint enforces. A demo that promised "apply to all 40" would be selling
// something `POST /api/practices/apply-batch` will not do.

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { PRACTICES } from "@/lib/practices";
import { usePrefersReducedMotion } from "@/components/report/chartMotion";

/** The batch ceiling `POST /api/practices/apply-batch` enforces per call (docs/features/
 *  org-dashboard/practices.md). Mirrored here so the diagram can't overstate the run. */
const BATCH_CAP = 25;
const FLEET = 40;
const COLS = 10;

/** The four practices this vignette offers — the first of each "shape" in the real catalog, so every
 *  label on screen is a practice the product can actually scaffold. */
const OFFERED = ["ci-gates", "agent-guidance", "test-discipline", "supply-chain-security"] as const;

/**
 * Deterministic "is repo r missing practice p": integer-only, so SSR and CSR agree and the picture is
 * stable across renders. Different practices hit different (overlapping) slices of the fleet.
 *
 * The row term matters. A plain `repo * 7 % 10` depends only on `repo % 10`, which is exactly the
 * column index at COLS = 10 — so every repo in a column got the same answer and the "fleet" rendered
 * as six solid vertical stripes. Folding the row in decorrelates the pattern from the grid geometry.
 */
function missing(repo: number, practiceIndex: number): boolean {
  return (repo * 7 + Math.floor(repo / COLS) * 3 + practiceIndex * 11) % 10 < 6 - practiceIndex;
}

export function PracticeCascade() {
  const reduced = usePrefersReducedMotion();
  const [pick, setPick] = useState(0);

  const offered = useMemo(
    () => OFFERED.map((id) => PRACTICES.find((p) => p.id === id)).filter((p): p is (typeof PRACTICES)[number] => Boolean(p)),
    [],
  );
  const targets = useMemo(
    () => Array.from({ length: FLEET }, (_, i) => i).filter((i) => missing(i, pick)),
    [pick],
  );
  const applied = targets.slice(0, BATCH_CAP);
  const appliedSet = useMemo(() => new Set(applied), [applied]);
  const targetSet = useMemo(() => new Set(targets), [targets]);
  const label = offered[pick]?.label ?? "Practice";

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1">
        {offered.map((p, i) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPick(i)}
            aria-pressed={i === pick}
            className={`focus-ring rounded-md px-2.5 py-1 font-mono text-xs uppercase tracking-wider transition ${
              i === pick ? "bg-accent/15 text-accent" : "text-slate-500 hover:text-white"
            }`}
          >
            {/* The catalog labels carry a parenthetical for humans reading the practice list
                ("Agent guidance (CLAUDE.md / AGENTS.md)"); a chip row wants the head of it. */}
            {p.label.split(" (")[0]}
          </button>
        ))}
      </div>

      {/* the authored artifact */}
      <div className="mx-auto flex max-w-[16rem] items-center gap-2 rounded-lg border border-accent/50 bg-accent/10 px-3 py-2">
        <span aria-hidden className="font-mono text-xs text-accent">
          ◆
        </span>
        <span className="truncate font-mono text-xs uppercase tracking-wider text-accent">{label.split(" (")[0]}</span>
      </div>

      {/* the fan: one hairline from the artifact down to each targeted repo cell */}
      <svg viewBox="0 0 200 34" className="mt-1 h-9 w-full" aria-hidden preserveAspectRatio="none">
        {applied.map((r) => {
          const x = ((r % COLS) + 0.5) * (200 / COLS);
          return (
            <motion.line
              key={r}
              x1={100}
              y1={0}
              x2={Math.round(x * 100) / 100}
              y2={34}
              stroke="#3b9eff"
              strokeWidth={0.6}
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 0.45 }}
              transition={reduced ? { duration: 0 } : { duration: 0.3, delay: 0.05 }}
            />
          );
        })}
      </svg>

      {/* the fleet */}
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}>
        {Array.from({ length: FLEET }, (_, i) => {
          const hit = appliedSet.has(i);
          const overflow = targetSet.has(i) && !hit;
          return (
            <motion.div
              key={i}
              className={`aspect-square rounded-[3px] border ${
                hit ? "border-accent bg-accent/70" : overflow ? "border-accent/40 bg-accent/10" : "border-divider bg-surface/40"
              }`}
              // A scale beat only on the cells this run actually touches, so the eye lands on the
              // difference between "applied" and "already fine" rather than on the whole grid.
              initial={reduced ? false : { scale: hit ? 0.7 : 1 }}
              animate={{ scale: 1 }}
              transition={reduced ? { duration: 0 } : { duration: 0.3, delay: 0.1 + (i % COLS) * 0.02 }}
            />
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 font-mono text-xs">
        <span className="text-slate-300">
          <span className="text-accent">{applied.length}</span> repos in one run
          {targets.length > applied.length && (
            <span className="text-slate-500"> · {targets.length - applied.length} queued for the next</span>
          )}
        </span>
        <span className="uppercase tracking-[0.2em] text-slate-500">{BATCH_CAP}/run cap</span>
      </div>
    </div>
  );
}
