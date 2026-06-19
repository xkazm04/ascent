"use client";

import { SectionHeading } from "@/components/ui";
import { AboutReveal } from "./AboutReveal";
import { AboutAscentSteps } from "./AboutAscentSteps";

/** The five-level journey as a stepped staircase ascent (distinct from the homepage's flight-path
 *  levels chart). Full-viewport deck section. */
export function AboutTransition() {
  return (
    <section id="transition" className="flex min-h-screen snap-start flex-col justify-center pb-10 pt-14">
      <div className="mx-auto w-full max-w-6xl px-5">
        <AboutReveal>
          <SectionHeading
            size="page"
            kicker="The transition"
            title="From manual keystrokes to autonomous, governed delivery"
            intro="Ascent maps every team onto a five-level ladder — and tracks the measurable path between, with goals and forecast ETAs so the climb stays on pace."
          />
        </AboutReveal>
        <div className="mt-8">
          <AboutAscentSteps />
        </div>
      </div>
    </section>
  );
}
