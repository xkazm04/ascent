"use client";

// Client orchestrator for /about as a full-viewport scroll-snap deck. While mounted it adds the
// `snap-deck` class to <html> (which turns on scroll-snap, scoped to this page) and renders one
// section per viewport plus the right-edge section nav. MotionConfig reducedMotion="user" degrades
// entrances to fades; each section's animation (Remotion + reveals) re-triggers on entry.

import { MotionConfig } from "framer-motion";
import { AboutHero } from "./AboutHero";
import { AboutCost } from "./AboutCost";
import { AboutFeature } from "./AboutFeature";
import { FleetGrid } from "./FleetGrid";
import { RoiSimulator } from "./RoiSimulator";
import { ChampionNetwork } from "./ChampionNetwork";
import { RiskRadar } from "./RiskRadar";
import { AboutTransition } from "./AboutTransition";
import { AboutCTA } from "./AboutCTA";
import { DeckNav, type DeckSectionRef } from "@/components/deck/DeckNav";
import { useSnapDeck } from "@/components/deck/useSnapDeck";
import { ABOUT_FEATURES, type AboutFeatureId } from "./features";

const DIAGRAM: Record<AboutFeatureId, React.ReactNode> = {
  xray: <FleetGrid />,
  roi: <RoiSimulator />,
  adoption: <ChampionNetwork />,
  risk: <RiskRadar />,
};

const SECTIONS: DeckSectionRef[] = [
  { id: "hero", label: "Overview" },
  { id: "cost", label: "The cost" },
  { id: "xray", label: "Fleet X-Ray" },
  { id: "roi", label: "ROI simulator" },
  { id: "adoption", label: "Adoption" },
  { id: "risk", label: "Risk radar" },
  { id: "transition", label: "Transition" },
  { id: "cta", label: "Get started" },
];

export function AboutLanding({ heroBg }: { heroBg?: string }) {
  useSnapDeck();

  return (
    <MotionConfig reducedMotion="user">
      <DeckNav sections={SECTIONS} />
      <main id="main">
        <AboutHero bg={heroBg} />
        <AboutCost />
        {ABOUT_FEATURES.map((f, i) => (
          <AboutFeature
            key={f.id}
            id={f.id}
            kicker={f.kicker}
            title={f.title}
            body={f.body}
            points={f.points}
            value={f.value}
            reverse={i % 2 === 1}
          >
            {DIAGRAM[f.id]}
          </AboutFeature>
        ))}
        <AboutTransition />
        <AboutCTA />
      </main>
    </MotionConfig>
  );
}
