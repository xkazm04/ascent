"use client";

import Image from "next/image";
import Link from "next/link";
import { Kicker } from "@/components/ui";
import { ScoreGauge } from "@/components/landing/prototypes/index/ScoreGauge";
import { LEVELS, DIMENSIONS } from "@/lib/maturity/model";
import { useCountUp } from "@/components/landing/prototypes/shared/useCountUp";

const INTRO =
  "Ascent turns your organization's scattered AI adoption into one comparable index, then shows the highest-ROI path from manual development to a fully LLM-based, governed engineering org.";

function StatNum({ target, label }: { target: number; label: string }) {
  const { ref, display } = useCountUp(target);
  return (
    <div className="bg-ink p-5">
      <div className="font-mono text-3xl font-bold tabular-nums text-white">
        <span ref={ref}>{display}</span>
      </div>
      <div className="mt-1 font-mono text-xs uppercase tracking-[0.2em] text-slate-500">{label}</div>
    </div>
  );
}

/** Masthead: editorial headline + the animated index ring (ScoreGauge) as the instrument, with
 *  count-up stat tiles. A restrained generated backdrop sits behind at low opacity for depth. */
export function AboutHero({ bg }: { bg?: string }) {
  return (
    <section id="hero" className="relative isolate flex min-h-screen snap-start items-center overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="strata absolute inset-0 opacity-40" />
        {bg && <Image src={bg} alt="" fill priority sizes="100vw" className="object-cover object-center opacity-20" />}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(60rem 36rem at 80% -10%, rgba(59,158,255,0.14), transparent 60%), linear-gradient(180deg, rgba(8,13,26,0.2) 0%, #080d1a 82%)",
          }}
        />
      </div>

      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 pt-16 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <Kicker>The maturity index for AI-native engineering</Kicker>
          <h1 className="mt-4 text-4xl font-bold leading-[1.05] text-white sm:text-5xl">
            Make the move to AI-native development — <span className="text-accent">measured, not guessed</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-300">{INTRO}</p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/connect"
              className="rounded-xl bg-accent px-5 py-2.5 font-semibold text-on-accent transition hover:bg-accent-soft"
            >
              Scan your org
            </Link>
            <Link
              href="/org/vercel"
              className="rounded-xl border border-divider px-5 py-2.5 font-medium text-slate-200 transition hover:border-accent hover:text-white"
            >
              Explore the live demo →
            </Link>
          </div>

          <div className="mt-10 grid max-w-md grid-cols-3 gap-px overflow-hidden rounded-2xl border border-divider bg-divider">
            <StatNum target={LEVELS.length} label="Levels" />
            <StatNum target={DIMENSIONS.length} label="Dimensions" />
            <div className="bg-ink p-5">
              <div className="font-mono text-3xl font-bold tabular-nums text-white">0–100</div>
              <div className="mt-1 font-mono text-xs uppercase tracking-[0.2em] text-slate-500">Index</div>
            </div>
          </div>
        </div>

        <div className="flex justify-center lg:justify-end">
          <ScoreGauge size={300} className="max-w-full" />
        </div>
      </div>
    </section>
  );
}
