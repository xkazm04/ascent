"use client";

// Client orchestrator for /about as a full-viewport scroll-snap deck. While mounted it adds the
// `snap-deck` class to <html> (which turns on scroll-snap, scoped to this page) and renders one
// section per viewport plus the right-edge section nav. MotionConfig reducedMotion="user" degrades
// entrances to fades; each section's animation (Remotion + reveals) re-triggers on entry.
//
// Card about-1: `gallery` is the cached public scan gallery the server page read (plain, serialisable
// props; this file never queries). fleetFrom reduces it once for the X-Ray and ROI panes, and a null or
// too-small corpus is the labelled illustration.

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
import { DeckProgress } from "@/components/deck/DeckProgress";
import { useSnapDeck } from "@/components/deck/useSnapDeck";
import { fleetFrom, type AboutFleet, type AboutGallery } from "./aboutFleetModel";
import { ABOUT_FEATURES, type AboutFeatureId } from "./features";

// The adoption + risk diagrams each pull in the full Remotion runtime — @remotion/player (via
// RemotionStage) plus the `remotion` core (via their compositions): the heaviest graph on this route.
// Split them into a client-only chunk (ssr:false, valid in this Client Component) so the /about initial
// payload never carries the video runtime. The deck reveals these sections on scroll, and RemotionStage
// already holds a sized aspect-video placeholder until its Player mounts — the loading fallback matches
// that box so there's no layout shift while the chunk streams in.
const DiagramPlaceholder = () => (
  <>
    <div className="overflow-hidden rounded-xl border border-divider bg-surface-strong/40">
      <div className="aspect-video w-full" />
    </div>
    {/* RemotionStage always paints a legend/replay row beneath its box (RemotionStage.tsx:90) — reserve
        the SAME ~24px row here so the column doesn't grow taller when the client chunk resolves (CLS).
        Matches the row's height: text-xs line + the replay button's py-1. */}
    <div className="mt-3 h-6" />
  </>
);
const ChampionNetwork = dynamic(() => import("./ChampionNetwork").then((m) => m.ChampionNetwork), {
  ssr: false,
  loading: DiagramPlaceholder,
});
const RiskRadar = dynamic(() => import("./RiskRadar").then((m) => m.RiskRadar), {
  ssr: false,
  loading: DiagramPlaceholder,
});

const diagram = (fleet: AboutFleet): Record<AboutFeatureId, React.ReactNode> => ({
  xray: <FleetGrid fleet={fleet} />,
  roi: <RoiSimulator fleet={fleet} />,
  adoption: <ChampionNetwork />,
  risk: <RiskRadar />,
});

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

export function AboutLanding({ heroBg, gallery = null }: { heroBg?: string; gallery?: AboutGallery }) {
  useSnapDeck();
  const DIAGRAM = diagram(fleetFrom(gallery));

  return (
    <MotionConfig reducedMotion="user">
      <DeckProgress />
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
