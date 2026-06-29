"use client";

// The Index hero — an editorial masthead: a dateline rule, an oversized headline, the live ScanForm,
// and the index ring on the right. Restrained motion, generous whitespace, hairline rules.

import Image from "next/image";
import Link from "next/link";
import { ScanForm } from "@/components/ScanForm";
import { QuotaMeter } from "@/components/QuotaMeter";
import { Dateline } from "@/components/ui";
import { DIMENSIONS, LEVELS } from "@/lib/maturity/model";
import { ScoreGauge } from "./ScoreGauge";
import { DeckSection } from "@/components/deck/DeckSection";
import type { LandingData } from "../types";

function RuleStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col">
      <span className="font-mono text-2xl font-bold tabular-nums text-white">{value}</span>
      <span className="mt-1 font-mono text-xs uppercase tracking-[0.2em] text-slate-500">{label}</span>
    </div>
  );
}

export function IndexHero({ quota, exampleRepos }: LandingData) {
  return (
    <DeckSection id="hero" variant="hero">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        {/* GPT Image 2 editorial paper-relief backdrop (hybrid), weighted right behind the index ring */}
        <Image src="/brand/proto/index-bg.png" alt="" fill priority sizes="100vw" className="object-cover object-right opacity-40" />
        <div className="absolute inset-0 bg-[radial-gradient(50rem_32rem_at_70%_-10%,rgba(59,158,255,0.08),transparent_62%)]" />
        <div className="absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-ink to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-ink to-transparent" />
      </div>

      <div className="mx-auto w-full max-w-6xl px-5 pt-16">
        <Dateline
          left="The AI-native maturity index"
          right={`Vol. 01 — ${LEVELS.length} levels · ${DIMENSIONS.length} dimensions`}
        />

        <div className="mt-12 grid items-center gap-12 lg:grid-cols-[1.25fr_0.75fr]">
          <div>
            <h1 className="text-4xl font-bold leading-[1.04] tracking-tight text-white sm:text-6xl">
              Every engineering org has a maturity.
              <span className="text-accent"> Now it has an index.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-300">
              Ascent reads a GitHub repository and rates how AI-native the engineering is — a single 0–100
              score on a {LEVELS.length}-level ladder across {DIMENSIONS.length} weighted dimensions, with the
              evidence behind every number.
            </p>
            <div className="mt-8">
              <ScanForm autoFocus examples={exampleRepos} />
            </div>
            {/* Zero-friction path for first-time visitors: one click to a fully-rendered example report
                (instant when persisted; falls back to a live keyless mock scan otherwise). */}
            <div className="mt-3">
              <Link
                href="/report/vercel/next.js"
                className="focus-ring inline-flex items-center gap-2 rounded-md border border-slate-700 px-4 py-2 font-mono text-xs uppercase tracking-widest text-slate-300 transition hover:border-accent hover:text-white"
              >
                <span aria-hidden>▸</span> See a sample report — no signup
              </Link>
            </div>
            <QuotaMeter />
            <p className="mt-4 font-mono text-sm uppercase tracking-widest text-slate-400">
              {quota ? (
                <>
                  <span>{quota.anon} free scans a week — no signup</span>
                  <span aria-hidden> · </span>
                  <span>Sign in for {quota.member}</span>
                </>
              ) : (
                <>
                  <span>Free for public repos</span>
                  <span aria-hidden> · </span>
                  <span>No signup</span>
                  <span aria-hidden> · </span>
                  <span>Results in under a minute</span>
                </>
              )}
            </p>
          </div>

          <div className="flex justify-center lg:justify-end">
            <ScoreGauge size={260} />
          </div>
        </div>

        {/* hairline stat ledger */}
        <div className="mt-14 grid grid-cols-3 divide-x divide-divider border-y border-divider py-6">
          <div className="px-4 sm:px-8"><RuleStat value={String(LEVELS.length)} label="Levels" /></div>
          <div className="px-4 sm:px-8"><RuleStat value={String(DIMENSIONS.length)} label="Dimensions" /></div>
          <div className="px-4 sm:px-8"><RuleStat value="0–100" label="Index scale" /></div>
        </div>
      </div>
    </DeckSection>
  );
}
