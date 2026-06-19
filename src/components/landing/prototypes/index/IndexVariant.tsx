"use client";

// The Index — the editorial rating-instrument direction, laid out as a full-viewport scroll-snap
// deck (see IndexLanding). Masthead hero with the index ring, the org edition, a live register, the
// levels flight-path, editorial method steps, the dimension scorecard, and the price table. Each
// content section reveals on entry (Reveal) for movement as you snap to it.

import Link from "next/link";
import type { LandingData } from "../types";
import { IndexHero } from "./IndexHero";
import { IndexGallery } from "./IndexGallery";
import { IndexLevels } from "./IndexLevels";
import { DimensionMatrix } from "./DimensionMatrix";
import { EditorialSteps } from "./EditorialSteps";
import { PricingCards } from "./PricingCards";
import { Kicker } from "@/components/ui";
import { Reveal } from "@/components/deck/Reveal";

export function IndexVariant(props: LandingData) {
  return (
    <>
      <IndexHero {...props} />

      <div className="mx-auto w-full max-w-6xl px-5">
        {/* Organization view — the org edition */}
        <section id="org" className="flex min-h-screen snap-start flex-col justify-center pb-10 pt-14">
          <Reveal>
            <div className="grid gap-6 border-y border-slate-800 py-8 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="max-w-2xl">
                <Kicker>Organization edition</Kicker>
                <h2 className="mt-2 text-2xl font-bold text-white">Index the whole organization</h2>
                <p className="mt-2 text-base leading-relaxed text-slate-400">
                  Ascent scans every repository in an org and rolls the results into one cross-repo register — shared
                  strengths, the gaps common across teams, contributor activity, and where to invest next.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:items-end">
                <Link
                  href="/org/vercel"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-base font-semibold text-on-accent transition hover:bg-accent-soft"
                >
                  Explore the Vercel org report →
                </Link>
                <Link href="/onboarding" className="text-sm font-medium text-slate-300 transition hover:text-white">
                  Or analyze your own organization →
                </Link>
              </div>
            </div>
          </Reveal>
        </section>

        {props.gallery && (
          <Reveal>
            <IndexGallery gallery={props.gallery} />
          </Reveal>
        )}
        <Reveal>
          <IndexLevels />
        </Reveal>
        <Reveal>
          <EditorialSteps />
        </Reveal>
        <Reveal>
          <DimensionMatrix />
        </Reveal>
        <Reveal>
          <PricingCards quota={props.quota} />
        </Reveal>
      </div>
    </>
  );
}
