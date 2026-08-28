"use client";

import { SectionHeading } from "@/components/ui";
import { Reveal } from "@/components/deck/Reveal";
import { DeckSection } from "@/components/deck/DeckSection";
import { LEVELS } from "@/lib/maturity/model";
import { AboutAscentSteps } from "./AboutAscentSteps";

/** The ladder as a stepped staircase ascent (distinct from the homepage's flight-path levels chart).
 *  Full-viewport deck section. The rung count is read from LEVELS, not typed — this intro said
 *  "five-level" as a word beside a diagram that already derived its own steps from the model.
 *
 *  The "forecast ETAs" half of the sentence is REAL and stays: `src/lib/db/plan.ts:262-267` computes
 *  `etaDays` / `etaDate` / `requiredPerWeek` per goal from the OLS fit in
 *  `src/lib/maturity/forecast.ts`, and `src/lib/org/briefing.ts:536` prints them. Goals being
 *  read-only in the UI is a separate thing from the projection not existing. */
export function AboutTransition() {
  return (
    <DeckSection id="transition" contained>
      <Reveal>
        <SectionHeading
          size="page"
          kicker="The transition"
          title="From manual keystrokes to autonomous, governed delivery"
          intro={`Ascent maps every team onto a ${LEVELS.length}-level ladder and tracks the measurable path between, with goals and forecast ETAs so the climb stays on pace.`}
        />
      </Reveal>
      <div className="mt-8">
        <AboutAscentSteps />
      </div>
    </DeckSection>
  );
}
