// The Repositories tab's first sight: the SHAPE of the fleet, above the rows that rank it.
//
// docs/ORG-UX-REDESIGN.md §2.2 — the topmost element under a panel header is the panel's headline
// reading, and the headline reading of a leaderboard is its distribution: clustered, bimodal, or one
// long tail. The sorted table below stays exactly as it was; it is the drill-down evidence (§2.7).
//
// Server-safe (no hooks, no handlers). `Distribution` and `WhyChip` are the kit's client components
// and are rendered from here with plain props, which is the boundary the kit is designed for.

import { Kicker } from "@/components/ui";
import { Distribution, Legend, StateSwatch, WhyChip } from "@/components/org/viz";
import { fleetShapeStates, type FleetShape } from "./fleetShape";

const SHAPE_HINT =
  "The box spans the middle half of the scored fleet (q1–q3) with the median as its rule; the whiskers reach the lowest and highest scored repository. A repo with no scan is in no quartile — it is not judged, and never counted as a zero.";

export function FleetScoreShape({ shape, className = "" }: { shape: FleetShape; className?: string }) {
  const states = fleetShapeStates(shape);
  return (
    <div className={`rounded-2xl border border-divider bg-surface/40 p-4 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <Kicker tone="muted">fleet overall score</Kicker>
        <WhyChip hint={SHAPE_HINT} label="how this spread is drawn" align="end" />
      </div>

      {shape.five ? (
        <Distribution
          className="mt-2 max-w-md"
          min={shape.five.min}
          q1={shape.five.q1}
          median={shape.five.median}
          q3={shape.five.q3}
          max={shape.five.max}
          n={shape.five.n}
          digits={0}
          label="Fleet overall score"
        />
      ) : (
        // One scored repo is a point, not a spread. Draw the void rather than a zero-width box.
        <p className="mt-2 flex items-center gap-2 type-body-sm text-slate-500">
          <StateSwatch state="missing" />
          {shape.scored === 1 ? "One scored repository — a spread needs at least two." : "No scored repository yet."}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <Legend states={states} />
        {shape.unscored > 0 && (
          <Kicker tone="muted" as="span">
            <span className="tabular-nums">{shape.unscored}</span> unscanned
          </Kicker>
        )}
      </div>
    </div>
  );
}
