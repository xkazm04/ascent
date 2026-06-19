"use client";

// How-it-works (#how) for The Index — three numbered editorial steps separated by hairline rules,
// oversized index numerals, restrained type.

import { Kicker } from "@/components/ui";
import { HOW_STEPS } from "../shared/content";

export function EditorialSteps() {
  return (
    <section id="method" className="flex min-h-screen snap-start flex-col justify-center pb-10 pt-14">
      <Kicker>Method</Kicker>
      <h2 className="mt-2 text-2xl font-bold text-white sm:text-3xl">How a repository is read</h2>
      <div className="mt-10 divide-y divide-slate-800 border-y border-slate-800">
        {HOW_STEPS.map((s) => (
          <div key={s.n} className="grid gap-4 py-8 sm:grid-cols-[auto_1fr] sm:gap-10">
            <div className="font-mono text-5xl font-bold tabular-nums text-slate-700 sm:w-24">{s.n}</div>
            <div className="max-w-2xl">
              <h3 className="text-xl font-semibold text-white">{s.t}</h3>
              <p className="mt-2 text-base leading-relaxed text-slate-400">{s.d}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
