"use client";

// Production landing — "The Index" direction, now a full-viewport scroll-snap deck (consistent with
// /about). The server page renders SiteHeader/SiteFooter + FAQ JSON-LD; this owns the <main> body,
// toggles the snap deck on, renders the right-edge section nav, and wraps everything in MotionConfig
// so every framer transform degrades to opacity for reduced-motion users.

import { useMemo } from "react";
import { MotionConfig } from "framer-motion";
import type { LandingData } from "./types";
import { IndexVariant } from "./index/IndexVariant";
import { DeckNav, type DeckSectionRef } from "@/components/deck/DeckNav";
import { useSnapDeck } from "@/components/deck/useSnapDeck";

export function IndexLanding(props: LandingData) {
  useSnapDeck();
  const sections = useMemo<DeckSectionRef[]>(
    () => [
      { id: "hero", label: "Overview" },
      { id: "org", label: "Organization" },
      ...(props.gallery ? [{ id: "gallery", label: "The register" }] : []),
      { id: "levels", label: "Levels" },
      { id: "dimensions", label: "Dimensions" },
      { id: "pricing", label: "Pricing" },
    ],
    [props.gallery],
  );

  return (
    <MotionConfig reducedMotion="user">
      <DeckNav sections={sections} />
      <main id="main" className="w-full">
        <IndexVariant {...props} />
      </main>
    </MotionConfig>
  );
}
