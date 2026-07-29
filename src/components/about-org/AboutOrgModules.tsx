"use client";

// Deck pane around the module map. Thin on purpose — the heading states the count (derived, so it
// cannot contradict the map beneath it) and OrgModuleMap owns everything else.

import { SectionHeading } from "@/components/ui";
import { Reveal } from "@/components/deck/Reveal";
import { DeckSection } from "@/components/deck/DeckSection";
import { OrgModuleMap } from "./OrgModuleMap";
import { MODULE_COUNT, VIEW_COUNT } from "./orgModules";

export function AboutOrgModules() {
  return (
    <DeckSection id="modules" contained justify="startLgCenter">
      <Reveal>
        <SectionHeading
          size="page"
          kicker="What you get"
          title={`${MODULE_COUNT} modules. ${VIEW_COUNT} views. One index.`}
          intro="This is the actual navigation of the org dashboard, not an illustration of it — same modules, same order, same names. Pick one and every view inside opens in the live demo."
        />
      </Reveal>
      <div className="mt-8 2xl:mt-12">
        <Reveal delay={0.08}>
          <OrgModuleMap />
        </Reveal>
      </div>
    </DeckSection>
  );
}
