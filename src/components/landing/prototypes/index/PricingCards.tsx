"use client";

// Pricing (#pricing) for The Index — bordered tier cards with the featured Private tier emphasised via
// an accent ring + badge and arrow bullets. Content from shared buildPricing.

import { Kicker } from "@/components/ui";
import { buildPricing } from "../shared/content";
import type { LandingData } from "../types";

export function PricingCards({ quota }: Pick<LandingData, "quota">) {
  const tiers = buildPricing(quota);
  return (
    <section id="pricing" className="flex min-h-screen snap-start flex-col justify-start pb-10 pt-14 lg:justify-center">
      <Kicker>Pricing</Kicker>
      <h2 className="mt-2 text-2xl font-bold text-white sm:text-3xl">Usage-based — pay only for what you scan</h2>
      <p className="mt-2 max-w-2xl text-slate-400">
        Public repositories are free on the web. Private repositories draw on prepaid scan credits — each private
        scan uses one. No subscription. Enterprise is implemented to your requirements.
      </p>
      <div className="mt-8 grid gap-5 lg:grid-cols-3">
        {tiers.map((p) => (
          <div
            key={p.name}
            className={`relative flex flex-col rounded-2xl border p-6 ${
              p.featured ? "border-accent/60 bg-accent/5 ring-1 ring-accent/30" : "border-slate-800 bg-slate-950/40"
            }`}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">{p.name}</h3>
              {p.featured && (
                <span className="rounded bg-accent/15 px-2 py-0.5 font-mono text-xs uppercase tracking-widest text-accent">
                  Prepaid credits
                </span>
              )}
            </div>
            <div className="mt-2 text-2xl font-bold text-white">{p.price}</div>
            <p className="mt-1 text-base text-slate-400">{p.tagline}</p>
            <ul className="mt-4 flex-1 space-y-2 text-base text-slate-300">
              {p.features.map((f) => (
                <li key={f} className="flex gap-2">
                  <span className="text-accent">→</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 border-t border-slate-800 pt-3 text-sm text-slate-400">{p.note}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
