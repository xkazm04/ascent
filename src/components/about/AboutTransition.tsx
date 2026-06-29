"use client";

import { SectionHeading } from "@/components/ui";
import { Reveal } from "@/components/deck/Reveal";
import { DeckSection } from "@/components/deck/DeckSection";
import { AboutAscentSteps } from "./AboutAscentSteps";

/** The five-level journey as a stepped staircase ascent (distinct from the homepage's flight-path
 *  levels chart). Full-viewport deck section. */
export function AboutTransition() {
  return (
    <DeckSection id="transition" contained>
      <Reveal>
        <SectionHeading
          size="page"
          kicker="The transition"
          title="From manual keystrokes to autonomous, governed delivery"
          intro="Ascent maps every team onto a five-level ladder — and tracks the measurable path between, with goals and forecast ETAs so the climb stays on pace."
        />
      </Reveal>
      <div className="mt-8">
        <AboutAscentSteps />
      </div>
    </DeckSection>
  );
}
