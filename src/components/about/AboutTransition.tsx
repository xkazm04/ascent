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
 *  Do not sell settable goals or forecast ETAs as climb controls here. The Plan tab retired
 *  2026-08-17; those figures print on the Briefing PDF, not as a visitor-operated control. */
export function AboutTransition() {
  return (
    <DeckSection id="transition" contained>
      <Reveal>
        <SectionHeading
          size="page"
          kicker="The transition"
          title="From manual keystrokes to autonomous, governed delivery"
          intro={`Ascent maps every team onto a ${LEVELS.length}-level ladder and tracks the measurable path between.`}
        />
      </Reveal>
      <div className="mt-8">
        <AboutAscentSteps />
      </div>
    </DeckSection>
  );
}
