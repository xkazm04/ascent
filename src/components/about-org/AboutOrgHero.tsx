"use client";

// /about-org masthead. Same editorial grammar as the /about hero — kicker, headline, lede, CTA pair,
// hairline stat ledger, instrument on the right — so the two marketing decks read as one publication.
// What differs is the argument: /about sells measurement, this sells aggregation, so the instrument is
// a population dial rather than a scale, and the ledger prints module/view counts DERIVED from the
// shipping nav (orgModules.ts) instead of rubric constants.

import { HairlineGrid, Kicker, Stat } from "@/components/ui";
import { DeckSection } from "@/components/deck/DeckSection";
import { AboutCtaButtons } from "@/components/about/AboutCtaButtons";
import { GlowBackdrop } from "@/components/about/GlowBackdrop";
import { useCountUp } from "@/components/landing/prototypes/shared/useCountUp";
import { OrgIndexInstrument } from "./OrgIndexInstrument";
import { MODULE_COUNT, VIEW_COUNT } from "./orgModules";

const INTRO =
  "Ascent scores every repository in your GitHub organization, then rolls them into one governed operating picture: the executive briefing at the top, the audit trail at the bottom, with the evidence behind every number.";

/** Masthead ledger cell whose figure counts up on reveal (the /about hero's StatNum, kept local since
 *  the two decks are free to diverge and this one is a three-cell ledger of derived counts). */
function StatNum({ target, label }: { target: number; label: string }) {
  const { ref, display } = useCountUp(target);
  return <Stat variant="figure" className="bg-ink p-5" label={label} value={<span ref={ref}>{display}</span>} />;
}

export function AboutOrgHero() {
  return (
    <DeckSection id="hero" variant="hero">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="strata absolute inset-0 opacity-40" />
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(58rem 34rem at 78% -8%, rgba(59,158,255,0.15), transparent 62%), linear-gradient(180deg, rgba(8,13,26,0.15) 0%, #080d1a 84%)",
          }}
        />
        {/* The horizon — the same fading accent hairline that closes the landing masthead, so the
            decks share a bottom edge rather than each dissolving into the ink on its own terms. */}
        <div className="absolute inset-x-0 bottom-0 h-px bg-[linear-gradient(90deg,transparent,rgba(59,158,255,0.34)_28%,rgba(59,158,255,0.34)_72%,transparent)]" />
      </div>

      {/* The copy column takes the larger share: the instrument is a fixed-size dial, so a 50/50 split
          just pads the right column with air while forcing the two-clause headline onto a fourth line
          — and a fourth line is what pushes the stat ledger past the fold of a 1080p viewport. */}
      <div className="deck-container grid items-center gap-12 pt-16 lg:grid-cols-[1.2fr_0.8fr] xl:gap-16 2xl:gap-20">
        <div>
          <Kicker>Ascent · Organization edition</Kicker>
          {/* Two steps below the landing masthead (`--h1-*`). This headline is two full clauses and the
              second one carries the thesis, so it has to hold three lines at every desktop width; the
              landing's single clause can afford the larger point size. */}
          <h1 className="deck-h1 mt-4 text-4xl font-bold leading-[1.05] text-white [--h1-ceil:4rem] [--h1-floor:2.75rem] sm:text-5xl">
            Every repository is a data point.{" "}
            <span className="text-accent">The organization is the answer.</span>
          </h1>
          <p className="deck-lede mt-5 max-w-xl text-lg leading-relaxed text-slate-300 2xl:max-w-2xl">{INTRO}</p>

          <AboutCtaButtons className="mt-8" />

          <HairlineGrid className="tick-corners mt-10 max-w-md grid-cols-3">
            <StatNum target={MODULE_COUNT} label="Modules" />
            <StatNum target={VIEW_COUNT} label="Views" />
            <Stat variant="figure" className="bg-ink p-5" label="Fleet index" value="0–100" />
          </HairlineGrid>
        </div>

        <div className="flex justify-center lg:justify-end">
          {/* The dial sits on its own plate so the ticks read against a settled surface instead of the
              hero's gradient, and the registration marks tie it to the ledger on the left. */}
          <div className="tick-corners relative overflow-hidden rounded-2xl border border-divider bg-surface-strong/40 p-6">
            <GlowBackdrop
              strataOpacity="opacity-30"
              pointerEventsNone
              glow="radial-gradient(70% 65% at 50% 0%, rgba(59,158,255,0.12), transparent 72%)"
            >
              <OrgIndexInstrument size={260} className="max-w-full" />
              <div className="mt-2 text-center font-mono text-xs uppercase tracking-[0.22em] text-slate-600">
                Illustrative fleet · 48 repos
              </div>
            </GlowBackdrop>
          </div>
        </div>
      </div>
    </DeckSection>
  );
}
