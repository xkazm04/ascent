"use client";

// Fleet Maturity X-Ray diagram (interactive): a heatmap of repositories tinted on the red→green ramp.
// Cells reveal in a diagonal stagger while a single azure scan line sweeps once. Filter by segment to
// re-scan a slice; hover or click a cell to inspect that repo. The distribution strip + count track
// the active slice. Deterministic data → SSR-stable.

import { useRef, useState } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { scoreHex, LEVEL_HEX } from "@/lib/ui";
import { LEVELS, levelForScore } from "@/lib/maturity/model";

const SEGMENTS = ["Platform", "Web", "Mobile", "Services", "Legacy"] as const;
type Seg = (typeof SEGMENTS)[number];
const COLS = 8;
// Deterministic, integer-only (no trig/random → identical on server + client, stable colours).
const REPOS = Array.from({ length: 40 }, (_, i) => {
  const segment = SEGMENTS[i % SEGMENTS.length]!;
  return {
    name: `${segment.toLowerCase()}-${String(Math.floor(i / SEGMENTS.length) + 1).padStart(2, "0")}`,
    segment,
    score: 15 + Math.round((((i * 37 + 11) % 100) * 0.7)),
  };
});

export function FleetGrid() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  // ABOUT #1: reducedMotion="user" only suppresses transform/layout animation, not the scan line's
  // `left` sweep or the strip's `flexGrow` — gate those non-transform animations on reduced motion.
  const reduced = useReducedMotion();
  const [seg, setSeg] = useState<Seg | "All">("All");
  const [inspect, setInspect] = useState<(typeof REPOS)[number] | null>(null);
  const [pinned, setPinned] = useState(false);

  const shown = seg === "All" ? REPOS : REPOS.filter((r) => r.segment === seg);
  const dist = LEVELS.map((l) => ({ id: l.id, n: shown.filter((r) => levelForScore(r.score).id === l.id).length }));

  return (
    <div ref={ref}>
      <div className="mb-3 flex flex-wrap gap-1">
        {(["All", ...SEGMENTS] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSeg(s)}
            className={`focus-ring rounded-md px-2.5 py-1 font-mono text-xs uppercase tracking-wider transition ${
              seg === s ? "bg-accent/15 text-accent" : "text-slate-500 hover:text-white"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="relative overflow-hidden rounded-lg">
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}>
          {REPOS.map((r, i) => {
            const dim = seg !== "All" && r.segment !== seg;
            const col = i % COLS;
            const row = Math.floor(i / COLS);
            return (
              <motion.button
                key={i}
                type="button"
                // Off-slice (dimmed) cells are not part of the active filter: take them out of the
                // keyboard tab order and the accessibility tree so focus + SR announcements match the
                // visible slice (the count strip) instead of reporting all 40 maturity values.
                disabled={dim}
                tabIndex={dim ? -1 : undefined}
                aria-hidden={dim || undefined}
                className="focus-ring aspect-square rounded-[3px]"
                style={{ backgroundColor: scoreHex(r.score) }}
                initial={{ opacity: 0, scale: 0.4 }}
                animate={inView ? { opacity: dim ? 0.1 : 0.92, scale: 1 } : { opacity: 0, scale: 0.4 }}
                transition={{ duration: 0.35, delay: (col + row) * 0.025, ease: "easeOut" }}
                whileHover={dim ? undefined : { scale: 1.16, opacity: 1 }}
                onHoverStart={() => !dim && !pinned && setInspect(r)}
                onHoverEnd={() => !dim && !pinned && setInspect(null)}
                onClick={() => {
                  if (dim) return;
                  if (pinned && inspect?.name === r.name) {
                    setPinned(false);
                    setInspect(null);
                  } else {
                    setInspect(r);
                    setPinned(true);
                  }
                }}
                aria-label={`${r.name}, maturity ${r.score}`}
              />
            );
          })}
        </div>
        {/* The scan line sweeps via `left` (a non-transform value) — suppressed entirely for
            reduced-motion users, who get the static heatmap as the final/rest state. */}
        {!reduced && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-px bg-accent"
            style={{ boxShadow: "0 0 14px 2px rgba(59,158,255,0.65)" }}
            initial={{ left: "-2%", opacity: 0 }}
            whileInView={{ left: "102%", opacity: [0, 1, 1, 0] }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 1.4, ease: "easeInOut", delay: 0.2 }}
          />
        )}
      </div>

      <div className="mt-4 flex h-5 items-center justify-between gap-3 font-mono text-xs">
        {inspect ? (
          <span className="truncate text-slate-300">
            {inspect.name} ·{" "}
            <span style={{ color: scoreHex(inspect.score) }}>
              {levelForScore(inspect.score).id} {inspect.score}
            </span>{" "}
            · {inspect.segment}
            {pinned && <span className="text-accent"> · pinned</span>}
          </span>
        ) : (
          <span className="uppercase tracking-[0.2em] text-slate-500">hover a cell to inspect</span>
        )}
        <span className="shrink-0 uppercase tracking-[0.2em] text-slate-500">{shown.length} repos</span>
      </div>
      <div className="mt-2 flex h-2 overflow-hidden rounded-full">
        {dist.map((d) => (
          <motion.div
            key={d.id}
            style={{ backgroundColor: LEVEL_HEX[d.id], ...(reduced ? { flexGrow: d.n } : null) }}
            // `flexGrow` is non-transform, so reducedMotion="user" doesn't degrade it — render the
            // final width with no transition for reduced-motion users.
            animate={reduced ? undefined : { flexGrow: d.n }}
            transition={reduced ? { duration: 0 } : { duration: 0.5, ease: "easeOut" }}
          />
        ))}
      </div>
    </div>
  );
}
