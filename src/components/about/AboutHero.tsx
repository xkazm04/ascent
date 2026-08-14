"use client";

import { useState } from "react";
import Image from "next/image";
import { HairlineGrid, Kicker, Stat } from "@/components/ui";
import { DeckSection } from "@/components/deck/DeckSection";
import { ScoreGauge } from "@/components/landing/prototypes/index/ScoreGauge";
import { LEVELS, DIMENSIONS } from "@/lib/maturity/model";
import { useCountUp } from "@/components/landing/prototypes/shared/useCountUp";
import { AboutCtaButtons } from "./AboutCtaButtons";

const INTRO =
  "Ascent turns your organization's scattered AI adoption into one comparable index, then shows the highest-ROI path from manual development to a fully LLM-based, governed engineering org.";

/** A masthead ledger cell whose number counts up on reveal — the brand Stat in its inverted `figure`
 *  form, with the count-up span passed as the value so useCountUp's ref lands on the digits. */
function StatNum({ target, label }: { target: number; label: string }) {
  const { ref, display } = useCountUp(target);
  return <Stat variant="figure" className="bg-ink p-5" label={label} value={<span ref={ref}>{display}</span>} />;
}

/** Masthead: editorial headline + the animated index ring (ScoreGauge) as the instrument, with
 *  count-up stat tiles. A restrained generated backdrop sits behind at low opacity for depth. */
export function AboutHero({ bg }: { bg?: string }) {
  // If the backdrop asset ever fails to load, fall back to the CSS strata/glow rather than a broken image.
  const [bgFailed, setBgFailed] = useState(false);
  return (
    <DeckSection id="hero" variant="hero">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="strata absolute inset-0 opacity-40" />
        {bg && !bgFailed && (
          <Image
            src={bg}
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover object-center opacity-20"
            onError={() => setBgFailed(true)}
          />
        )}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(60rem 36rem at 80% -10%, rgba(59,158,255,0.14), transparent 60%), linear-gradient(180deg, rgba(8,13,26,0.2) 0%, #080d1a 82%)",
          }}
        />
      </div>

      <div className="deck-container grid items-center gap-12 pt-16 lg:grid-cols-[1.1fr_0.9fr] xl:gap-16 2xl:gap-20">
        <div>
          <Kicker>The maturity index for AI-native engineering</Kicker>
          {/* This headline is a full sentence, so it runs one step below the landing masthead at every
              width — the `--h1-*` floor/ceiling keep the deck's ramp while preserving that relationship
              (see the .deck-h1 note in globals.css). */}
          <h1 className="deck-h1 mt-4 text-4xl font-bold leading-[1.05] text-white [--h1-ceil:4.5rem] [--h1-floor:3rem] sm:text-5xl">
            Make the move to AI-native development: <span className="text-accent">measured, not guessed</span>
          </h1>
          <p className="deck-lede mt-5 max-w-xl text-lg leading-relaxed text-slate-300 2xl:max-w-2xl">{INTRO}</p>

          <AboutCtaButtons className="mt-8" />

          <HairlineGrid className="tick-corners mt-10 max-w-md grid-cols-3">
            <StatNum target={LEVELS.length} label="Levels" />
            <StatNum target={DIMENSIONS.length} label="Dimensions" />
            <Stat variant="figure" className="bg-ink p-5" label="Index" value="0–100" />
          </HairlineGrid>
        </div>

        <div className="flex justify-center lg:justify-end">
          <ScoreGauge size={300} className="max-w-full" />
        </div>
      </div>
    </DeckSection>
  );
}
