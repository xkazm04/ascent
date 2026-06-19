"use client";

// Levels section (#levels) — the migrated flight-path chart in an editorial panel, with The Index's
// hairline level cards below (the cards carry every level's name/band/tagline as real text for SEO +
// a11y). Built on the brand kit (SectionHeading / Surface / HairlineGrid).

import { LEVELS } from "@/lib/maturity/model";
import { LEVEL_HEX } from "@/lib/ui";
import { HairlineGrid, SectionHeading, Surface } from "@/components/ui";
import { TrajectoryChart } from "./TrajectoryChart";
import type { LevelId } from "@/lib/types";

export function IndexLevels() {
  return (
    <section id="levels" className="flex min-h-screen snap-start flex-col justify-center pb-10 pt-14">
      <SectionHeading
        size="page"
        kicker="The ladder"
        title="Five levels, plotted as a climb"
        intro="Each level is a higher altitude band on the 0–100 index. Cross the dashed line and the org reads AI-Native — adopting AI with the rigor to ship it safely."
      />

      <Surface tone="strong" className="mt-8 p-4 sm:p-6">
        <TrajectoryChart />
      </Surface>

      <HairlineGrid className="mt-6 sm:grid-cols-2 lg:grid-cols-5">
        {LEVELS.map((l) => (
          <div key={l.id} className="bg-ink p-5">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-lg font-bold" style={{ color: LEVEL_HEX[l.id as LevelId] }}>{l.id}</span>
              <span className="font-mono text-xs uppercase tracking-widest text-slate-500">{l.band[0]}–{l.band[1]}</span>
            </div>
            <div className="mt-1 text-base font-semibold text-white">{l.name}</div>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{l.tagline}</p>
          </div>
        ))}
      </HairlineGrid>
    </section>
  );
}
