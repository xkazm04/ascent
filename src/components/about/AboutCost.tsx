"use client";

import { SectionHeading } from "@/components/ui";
import { Reveal } from "@/components/deck/Reveal";

const COSTS = [
  { t: "Rework", d: "Initiatives that move two repos when you budgeted for twenty." },
  { t: "Failed audits", d: "Ungoverned repos discovered during the security review, not before it." },
  { t: "Slow onboarding", d: "Re-teaching top-down what a champion on the next team already knows." },
  { t: "Silent regressions", d: "A repo slips a level and no one notices until it ships." },
];

function DownTrend() {
  return (
    <svg viewBox="0 0 56 22" className="h-5 w-14" aria-hidden>
      <polyline points="2,4 18,9 34,12 54,18" fill="none" stroke="#f87171" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={54} cy={18} r={2} fill="#f87171" />
    </svg>
  );
}

/** The problem framing: unmeasured AI adoption burns money in four predictable ways. */
export function AboutCost() {
  return (
    <section id="cost" className="flex min-h-screen snap-start flex-col justify-center pb-10 pt-14">
      <div className="mx-auto w-full max-w-6xl px-5">
        <Reveal>
          <SectionHeading
            size="page"
            kicker="The cost of guessing"
            title="AI adoption without a map is expensive"
            intro="Most orgs can't see where their AI maturity actually is — so they spend in the wrong places, miss the risks, and find out too late."
          />
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {COSTS.map((c, i) => (
            <Reveal key={c.t} delay={i * 0.08}>
              <div className="h-full rounded-xl border border-divider bg-surface/40 p-6">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-mono text-sm uppercase tracking-[0.2em] text-danger-soft">{c.t}</div>
                  <DownTrend />
                </div>
                <p className="mt-3 text-base leading-relaxed text-slate-400">{c.d}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
