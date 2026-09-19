"use client";

// Levels section (#levels) — the migrated flight-path chart in an editorial panel, with The Index's
// hairline level cards below (the cards carry every level's name/band/tagline as real text for SEO +
// a11y). Built on the brand kit (SectionHeading / Surface / HairlineGrid).

import dynamic from "next/dynamic";
import { LEVELS, LEVEL_BY_ID } from "@/lib/maturity/model";
import { LEVEL_HEX } from "@/lib/ui";
import { HairlineGrid, SectionHeading, Surface } from "@/components/ui";
import { DeckSection } from "@/components/deck/DeckSection";
import { TrajectoryPlaceholder } from "./TrajectoryPlaceholder";
import type { LevelId } from "@/lib/types";

// Recharts (+ its d3 deps) is the single heaviest dependency that would otherwise ride the homepage's
// first load — and it powers only this below-the-fold deck section. Load it in its own client chunk
// (ssr:false, valid here since this is a Client Component) so `/` ships without it. The loading
// fallback is the SAME shared placeholder the chart paints at rest (before it scrolls into view), so
// the slot never jumps between "chunk streaming" and "waiting to animate".
const TrajectoryChart = dynamic(() => import("./TrajectoryChart").then((m) => m.TrajectoryChart), {
  ssr: false,
  loading: () => <TrajectoryPlaceholder />,
});

export function IndexLevels() {
  return (
    <DeckSection id="levels" justify="startLgCenter">
      <SectionHeading
        size="page"
        kicker="The ladder"
        title={`${LEVELS.length} levels, plotted as a climb`}
        // The dashed line's meaning is derived alongside the line itself (TrajectoryChart's
        // AGENT_BAND). This intro said "cross the dashed line and the org reads AI-Native" while the
        // line was drawn at the POSTURE threshold — a cut on the adoption and rigor axes, not on the
        // index this chart plots, and one that lands inside L3 besides. Crossing it changed nothing.
        intro={`Each level is a higher altitude band on the 0–100 index. The dashed line is ${LEVEL_BY_ID.L4.id} — ${LEVEL_BY_ID.L4.name} — where agents move from the keyboard into the process itself: ${LEVEL_BY_ID.L4.tagline}.`}
      />

      {/* tick-corners frames the chart plate as an instrument read-out — the same registration marks
          the masthead ledger carries, so the two editorial plates on the deck match. */}
      <Surface tone="strong" className="tick-corners mt-8 p-4 sm:p-6 2xl:mt-10 2xl:p-8">
        <TrajectoryChart />
      </Surface>

      <HairlineGrid className="mt-6 sm:grid-cols-2 lg:grid-cols-5 2xl:mt-8">
        {LEVELS.map((l) => (
          <div key={l.id} className="bg-ink p-5 2xl:p-6">
            <div className="flex items-baseline justify-between">
              <span className="font-mono type-lede font-bold" style={{ color: LEVEL_HEX[l.id as LevelId] }}>{l.id}</span>
              <span className="type-label tracking-widest text-slate-500">{l.band[0]}–{l.band[1]}</span>
            </div>
            <div className="mt-1 type-body font-semibold text-white">{l.name}</div>
            <p className="mt-1.5 type-body-sm leading-relaxed text-slate-400 2xl:type-body">{l.tagline}</p>
          </div>
        ))}
      </HairlineGrid>
    </DeckSection>
  );
}
