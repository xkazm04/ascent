"use client";

// Fleet Maturity X-Ray diagram (interactive): a heatmap of repositories tinted on the red→green ramp.
// Cells reveal in a diagonal stagger while a single azure scan line sweeps once. Filter by segment to
// re-scan a slice; hover or click a cell to inspect that repo. The distribution strip + count track
// the active slice. Deterministic data → SSR-stable.
//
// Card about-1: `fleet` comes from aboutFleetModel. Live, the cells are the scanned public repos (each
// a link to its own report, inspected on hover or focus) and the filters are the postures present;
// with no live corpus it is the labelled 40-cell illustration, unchanged.

import { useRef, useState } from "react";
import Link from "next/link";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { scoreHex, LEVEL_HEX } from "@/lib/ui";
import { LEVELS, levelForScore } from "@/lib/maturity/model";
import { useMounted } from "@/components/report/chartMotion";
import { ILLUSTRATIVE_FLEET, fleetCaption, type AboutFleet, type FleetCell } from "./aboutFleetModel";

const COLS = 8;
const MotionLink = motion.create(Link);

export function FleetGrid({ fleet = ILLUSTRATIVE_FLEET }: { fleet?: AboutFleet }) {
  const REPOS = fleet.cells;
  const live = fleet.mode === "live";
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  // ABOUT #1: reducedMotion="user" only suppresses transform/layout animation, not the scan line's
  // `left` sweep or the strip's `flexGrow` — gate those non-transform animations on reduced motion.
  const reduced = useReducedMotion();
  const [seg, setSeg] = useState<string>("All");
  const [inspect, setInspect] = useState<FleetCell | null>(null);
  const [pinned, setPinned] = useState(false);
  // Same contract as deck/Reveal: the served frame is the RESOLVED heatmap. `initial={{ opacity: 0 }}`
  // used to bake opacity:0 into all 40 cells of the SSR HTML, so no-JS, a failed hydration, and print
  // got an empty grid. The hidden entry state is applied only after mount, and never under reduced
  // motion, where the heatmap is the static composition rather than something to scroll to.
  const armed = useMounted();
  const resolved = !armed || inView || !!reduced;

  const shown = seg === "All" ? REPOS : REPOS.filter((r) => r.segment === seg);
  const dist = LEVELS.map((l) => ({ id: l.id, n: shown.filter((r) => levelForScore(r.score).id === l.id).length }));
  const segLabel = (id: string) => fleet.segments.find((s) => s.id === id)?.label ?? id;

  // ABOUT #1: switching segment can strand the current inspection. If the pinned/hovered cell falls
  // OUTSIDE the new slice it becomes `disabled` (off-slice), so its own clear-toggle can never fire and
  // hover is frozen (pinned stays true) — leaving a stale readout that can't be dismissed. Drop the
  // pin + inspection whenever the inspected repo isn't part of the newly selected segment.
  const selectSeg = (s: string) => {
    setSeg(s);
    if (inspect && s !== "All" && inspect.segment !== s) {
      setPinned(false);
      setInspect(null);
    }
  };

  return (
    <div ref={ref}>
      <div className="mb-3 flex flex-wrap gap-1">
        {[{ id: "All", label: "All" }, ...fleet.segments].map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => selectSeg(s.id)}
            className={`focus-ring rounded-md px-2.5 py-1 type-label tracking-wider transition ${
              seg === s.id ? "bg-accent/15 text-accent" : "text-slate-500 hover:text-white"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="relative overflow-hidden rounded-lg">
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}>
          {REPOS.map((r, i) => {
            const dim = seg !== "All" && r.segment !== seg;
            const isPinned = pinned && inspect?.name === r.name;
            const col = i % COLS;
            const row = Math.floor(i / COLS);
            const shared = {
              // Off-slice (dimmed) cells are not part of the active filter: take them out of the
              // keyboard tab order and the accessibility tree so focus + SR announcements match the
              // visible slice (the count strip) instead of reporting all 40 maturity values.
              tabIndex: dim ? -1 : undefined,
              "aria-hidden": dim || undefined,
              "data-reveal": dim ? undefined : "",
              style: { backgroundColor: scoreHex(r.score) },
              initial: false as const,
              animate: resolved ? { opacity: dim ? 0.1 : 0.92, scale: 1 } : { opacity: 0, scale: 0.4 },
              transition: resolved
                ? { duration: 0.35, delay: (col + row) * 0.025, ease: "easeOut" as const }
                : { duration: 0 },
              whileHover: dim ? undefined : { scale: 1.16, opacity: 1 },
              onHoverStart: () => !dim && !pinned && setInspect(r),
              onHoverEnd: () => !dim && !pinned && setInspect(null),
              "aria-label": `${r.name}, maturity ${r.score}`,
            };
            if (live && r.href) {
              // A real repo: the cell IS the way into its report. Focus inspects, as hover does.
              return (
                <MotionLink
                  key={r.name}
                  href={r.href}
                  {...shared}
                  className={`focus-ring block aspect-square rounded-[3px]${dim ? " pointer-events-none" : ""}`}
                  onFocus={() => !dim && setInspect(r)}
                  onBlur={() => setInspect(null)}
                />
              );
            }
            return (
              <motion.button
                key={i}
                type="button"
                {...shared}
                disabled={dim}
                aria-pressed={isPinned || undefined}
                className={`focus-ring aspect-square rounded-[3px]${
                  isPinned ? " ring-2 ring-accent ring-offset-2 ring-offset-ink" : ""
                }`}
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

      <div className="mt-4 flex h-5 items-center justify-between gap-3 type-caption">
        {inspect ? (
          <span className="truncate text-slate-300">
            {inspect.name} ·{" "}
            <span style={{ color: scoreHex(inspect.score) }}>
              {levelForScore(inspect.score).id} {inspect.score}
            </span>{" "}
            · {segLabel(inspect.segment)}
            {pinned && <span className="text-accent"> · pinned</span>}
          </span>
        ) : (
          <span className="uppercase tracking-[0.2em] text-slate-500">
            {live ? "hover a cell to inspect, click to open its report" : "hover a cell to inspect"}
          </span>
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
      {/* Provenance ships with the cells: the labelled illustration (same chrome as RoiSimulator), or
          the live corpus size + freshness when the cells are real scanned repos. */}
      <p className="mt-3 text-center type-label tracking-[0.22em] text-slate-600">
        {fleetCaption({ mode: fleet.mode, n: REPOS.length, newest: fleet.newest })}
      </p>
    </div>
  );
}
