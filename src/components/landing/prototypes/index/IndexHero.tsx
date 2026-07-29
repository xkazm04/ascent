"use client";

// The Index hero — an editorial masthead: a dateline rule, an oversized headline, the scan dialog
// (ScanModal) + an org-scan path, and the index ring on the right. Restrained motion, generous
// whitespace, hairline rules.

import Image from "next/image";
import Link from "next/link";
import { Dateline } from "@/components/ui";
import { DIMENSIONS, LEVELS } from "@/lib/maturity/model";
import { ScoreGauge } from "./ScoreGauge";
import { ScanModal } from "./ScanModal";
import { demoOrgHref } from "@/lib/site";
import { DeckSection } from "@/components/deck/DeckSection";
import type { LandingData } from "../types";

function RuleStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col">
      <span className="deck-figure font-mono text-2xl font-bold tabular-nums text-white">{value}</span>
      <span className="mt-1 font-mono text-xs uppercase tracking-[0.2em] text-slate-500">{label}</span>
    </div>
  );
}

export function IndexHero({ exampleRepos, auth = null, gated = false }: LandingData) {
  // A real, already-scored repo to anchor the "see a sample report" link, so it opens a finished report
  // instead of a hardcoded slug that might not be scanned (which would cold-scan via ColdScanGate).
  // Falsy when the corpus is empty — the sample-report link is then omitted (the curated org-demo link,
  // which points at a seeded org, still shows).
  const sampleRepo = exampleRepos?.[0] ?? null;
  return (
    <DeckSection id="hero" variant="hero">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        {/* GPT Image 2 editorial paper-relief backdrop (hybrid), weighted right behind the index ring.
            No `priority`: this 40%-opacity decorative backdrop is NOT the LCP element (the H1/CTA text is),
            so it must not preempt the genuinely critical resources with a high-fetchpriority preload. */}
        <Image src="/brand/proto/index-bg.png" alt="" fill sizes="100vw" className="object-cover object-right opacity-40" />
        <div className="absolute inset-0 bg-[radial-gradient(50rem_32rem_at_70%_-10%,rgba(59,158,255,0.08),transparent_62%)]" />
        <div className="absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-ink to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-ink to-transparent" />
        {/* The horizon: a single accent hairline along the masthead's bottom edge, faded out at both
            ends so it reads as an altitude marking rather than a border. It gives the hero a hard
            bottom the eye can rest on — without it the section dissolves into the ink gradient and
            the deck's first snap boundary is invisible. */}
        <div className="absolute inset-x-0 bottom-0 h-px bg-[linear-gradient(90deg,transparent,rgba(59,158,255,0.34)_28%,rgba(59,158,255,0.34)_72%,transparent)]" />
      </div>

      <div className="deck-container pt-16">
        <Dateline
          left="The AI-native maturity index"
          right={`Vol. 01 — ${LEVELS.length} levels · ${DIMENSIONS.length} dimensions`}
        />

        {/* Vertical rhythm here is gated on viewport HEIGHT, not width. The masthead is a
            `min-h-screen overflow-hidden` pane and the sticky header already spends ~56px of it, so on
            the common wide-but-short desktop (1920×1080 ⇒ ~900px of viewport) the content ends within
            ~30px of the fold — adding air at a `2xl` WIDTH breakpoint is exactly how the stat ledger
            gets silently clipped on the most common large display there is. The extra air appears when
            there is actually room for it. Horizontal gap still keys off width, which is correct.

            68rem (1088px) rather than the obvious 60rem: the three steps below add ~48px of height
            between them, and at a 1008px viewport that left only ~24px under the ledger. The threshold
            has to clear the fold by more than the rhythm it turns on. */}
        <div className="mt-12 grid items-center gap-12 lg:grid-cols-[1.25fr_0.75fr] xl:gap-16 2xl:gap-20 [@media(min-height:68rem)]:mt-16">
          <div>
            <h1 className="deck-h1 text-4xl font-bold leading-[1.04] tracking-tight text-white sm:text-6xl">
              Every engineering org has a maturity.
              <span className="text-accent"> Now it has an index.</span>
            </h1>
            {/* The measure grows a step with the type, so the lede keeps ~60 characters a line at the
                top of the ramp instead of narrowing to a ragged column. */}
            <p className="deck-lede mt-6 max-w-xl text-lg leading-relaxed text-slate-300 2xl:max-w-2xl [@media(min-height:68rem)]:mt-8">
              Ascent reads a GitHub repository and rates how AI-native the engineering is — a single 0–100
              score on a {LEVELS.length}-level ladder across {DIMENSIONS.length} weighted dimensions, with the
              evidence behind every number.
            </p>
            {/* Primary CTA opens the single-repo scan dialog (input + expected output + GitHub connect).
                The secondary button surfaces the higher-value path — a one-shot whole-org scan + cross-repo
                rollup — which a cold-start visitor would otherwise only discover after signing in. */}
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <ScanModal examples={exampleRepos} auth={auth} gated={gated} />
              <Link
                href="/onboarding"
                className="focus-ring inline-flex items-center gap-2 rounded-md border border-slate-700 px-4 py-2 font-mono text-xs uppercase tracking-widest text-slate-300 transition hover:border-accent hover:text-white"
              >
                Scan your whole org <span aria-hidden>→</span>
              </Link>
            </div>
            {/* Zero-commitment previews — drop a first-time visitor straight into a fully-rendered
                example before scanning anything. The org dashboard points at the curated demo org (one
                configurable slug — see lib/site); the sample report points at a real top-scored repo from
                the live index when one exists (so it opens a finished report, never a cold scan — and is
                simply omitted until the corpus has a public scan). */}
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-xs uppercase tracking-widest text-slate-400">
              {sampleRepo && (
                <Link href={`/report/${sampleRepo}`} className="focus-ring rounded-sm transition hover:text-accent">
                  <span aria-hidden>▸</span> See a sample report
                </Link>
              )}
              <Link href={demoOrgHref()} className="focus-ring rounded-sm transition hover:text-accent">
                <span aria-hidden>▸</span> See an example org dashboard
              </Link>
            </div>
          </div>

          <div className="flex justify-center lg:justify-end">
            <ScoreGauge size={260} />
          </div>
        </div>

        {/* hairline stat ledger — a fixed 3-column grid crowded "0–100" into overflow on the narrowest
            phones (≤320px). Stack to a single divided column below sm (dividers flip from vertical to
            horizontal) so each stat keeps its full width; three side-by-side columns return from sm up. */}
        {/* tick-corners: four hairline registration marks at the ledger's corners — the instrument
            frame from the brand's "Index" identity, and the one place on the masthead where a purely
            decorative mark earns its keep (it reads the rule-bounded ledger as a measured plate). */}
        <div className="tick-corners mt-14 grid grid-cols-1 divide-y divide-divider border-y border-divider py-6 sm:grid-cols-3 sm:divide-x sm:divide-y-0 [@media(min-height:68rem)]:mt-16 [@media(min-height:68rem)]:py-8">
          <div className="px-4 py-3 sm:px-8 sm:py-0"><RuleStat value={String(LEVELS.length)} label="Levels" /></div>
          <div className="px-4 py-3 sm:px-8 sm:py-0"><RuleStat value={String(DIMENSIONS.length)} label="Dimensions" /></div>
          <div className="px-4 py-3 sm:px-8 sm:py-0"><RuleStat value="0–100" label="Index scale" /></div>
        </div>
      </div>
    </DeckSection>
  );
}
