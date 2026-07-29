"use client";

// Client orchestrator for /about-org as a full-viewport scroll-snap deck — the same shell contract as
// /about (useSnapDeck toggles the `snap-deck` class on <html> while mounted; MotionConfig degrades
// framer transforms for reduced-motion users; DeckNav gives the right-edge section jumps and the
// mobile chapter bar; DeckProgress paints the top scroll rule).
//
// The three feature panes render through /about's `AboutFeature` rather than a forked copy: the
// section is already a generic "copy on one side, live diagram on the other, sides alternating" shell,
// and sharing it means a change to the deck's feature rhythm lands on both marketing pages at once.

import { MotionConfig } from "framer-motion";
import { AboutFeature } from "@/components/about/AboutFeature";
import { DeckNav, type DeckSectionRef } from "@/components/deck/DeckNav";
import { DeckProgress } from "@/components/deck/DeckProgress";
import { useSnapDeck } from "@/components/deck/useSnapDeck";
import { AboutOrgHero } from "./AboutOrgHero";
import { AboutOrgQuestions } from "./AboutOrgQuestions";
import { AboutOrgModules } from "./AboutOrgModules";
import { AboutOrgLoop } from "./AboutOrgLoop";
import { AboutOrgCTA } from "./AboutOrgCTA";
import { PracticeCascade } from "./PracticeCascade";
import { KnowledgeLedger } from "./KnowledgeLedger";
import { GovernanceEvidence } from "./GovernanceEvidence";
import { ABOUT_ORG_FEATURES, type AboutOrgFeatureId } from "./orgFeatures";

// Every diagram here is dependency-free (SVG/DOM + the framer runtime this deck already loads), so —
// unlike /about, whose adoption and risk panes pull the whole Remotion player — there is nothing heavy
// enough to be worth a dynamic() split and its loading-placeholder CLS budget.
const DIAGRAM: Record<AboutOrgFeatureId, React.ReactNode> = {
  practices: <PracticeCascade />,
  knowledge: <KnowledgeLedger />,
  governance: <GovernanceEvidence />,
};

const SECTIONS: DeckSectionRef[] = [
  { id: "hero", label: "Overview" },
  { id: "questions", label: "The questions" },
  { id: "modules", label: "The modules" },
  { id: "practices", label: "Practices" },
  { id: "knowledge", label: "Memory & skills" },
  { id: "governance", label: "Governance" },
  { id: "loop", label: "The loop" },
  { id: "cta", label: "Get started" },
];

export function AboutOrgLanding() {
  useSnapDeck();

  return (
    <MotionConfig reducedMotion="user">
      <DeckProgress />
      <DeckNav sections={SECTIONS} />
      <main id="main">
        <AboutOrgHero />
        <AboutOrgQuestions />
        <AboutOrgModules />
        {ABOUT_ORG_FEATURES.map((f, i) => (
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
        <AboutOrgLoop />
        <AboutOrgCTA />
      </main>
    </MotionConfig>
  );
}
