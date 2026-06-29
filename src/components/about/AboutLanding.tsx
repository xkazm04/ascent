"use client";

// Client orchestrator for /about as a full-viewport scroll-snap deck. While mounted it adds the
// `snap-deck` class to <html> (which turns on scroll-snap, scoped to this page) and renders one
// section per viewport plus the right-edge section nav. MotionConfig reducedMotion="user" degrades
// entrances to fades; each section's animation (Remotion + reveals) re-triggers on entry.

import dynamic from "next/dynamic";
import { MotionConfig } from "framer-motion";
import { AboutHero } from "./AboutHero";
import { AboutCost } from "./AboutCost";
import { AboutFeature } from "./AboutFeature";
import { FleetGrid } from "./FleetGrid";
import { RoiSimulator } from "./RoiSimulator";
import { AboutTransition } from "./AboutTransition";
import { AboutCTA } from "./AboutCTA";
import { DeckNav, type DeckSectionRef } from "@/components/deck/DeckNav";
import { useSnapDeck } from "@/components/deck/useSnapDeck";
import { ABOUT_FEATURES, type AboutFeatureId } from "./features";

// The adoption + risk diagrams each pull in the full Remotion runtime — @remotion/player (via
// RemotionStage) plus the `remotion` core (via their compositions): the heaviest graph on this route.
// Split them into a client-only chunk (ssr:false, valid in this Client Component) so the /about initial
// payload never carries the video runtime. The deck reveals these sections on scroll, and RemotionStage
// already holds a sized aspect-video placeholder until its Player mounts — the loading fallback matches
// that box so there's no layout shift while the chunk streams in.
const DiagramPlaceholder = () => (
  <div className="overflow-hidden rounded-xl border border-divider bg-surface-strong/40">
    <div className="aspect-video w-full" />
  </div>
);
const ChampionNetwork = dynamic(() => import("./ChampionNetwork").then((m) => m.ChampionNetwork), {
  ssr: false,
  loading: DiagramPlaceholder,
});
const RiskRadar = dynamic(() => import("./RiskRadar").then((m) => m.RiskRadar), {
  ssr: false,
  loading: DiagramPlaceholder,
});

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
