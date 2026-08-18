"use client";

// The operating loop — the section /about doesn't have.
//
// Every capability up to here is a noun. A buyer's remaining question is a verb one: what does using
// this actually look like on a Tuesday? Five steps, each naming the module that owns it, drawn as a
// closed loop rather than a funnel — because the last step feeds the first, and a marketing page that
// draws this as a funnel is quietly promising a one-off engagement.

import Link from "next/link";
import { Kicker, SectionHeading } from "@/components/ui";
import { Reveal } from "@/components/deck/Reveal";
import { DeckSection } from "@/components/deck/DeckSection";
import { orgTabHref, type OrgTabId } from "@/lib/org/orgTabs";
import { DEMO_ORG_SLUG } from "@/lib/site";

interface LoopStep {
  n: string;
  title: string;
  detail: string;
  module: string;
  tab: OrgTabId;
}

const STEPS: LoopStep[] = [
  {
    n: "01",
    title: "Connect",
    detail: "Install the GitHub App on the org. Ascent reads through the API; it never clones your code.",
    module: "Govern",
    tab: "settings",
  },
  {
    n: "02",
    title: "Scan",
    detail: "Every watched repository is scored across the nine dimensions, then rescanned on a cadence you set.",
    module: "Fleet",
    tab: "repositories",
  },
  {
    n: "03",
    title: "Read",
    detail: "The rollup says where the fleet stands, what moved, and which gaps are shared across teams.",
    module: "Overview",
    tab: "overview",
  },
  {
    n: "04",
    title: "Decide",
    detail: "The org-wide gaps — open in half the fleet — are practices to fix once; the ledger marks them so a batch is the right shape.",
    module: "Standing",
    tab: "followups",
  },
  {
    n: "05",
    title: "Apply",
    detail: "Tick a batch, get one fix prompt for your local agent, hand it off; the next scan closes what landed.",
    module: "Standing",
    tab: "followups",
  },
];

export function AboutOrgLoop() {
  return (
    <DeckSection id="loop" contained justify="startLgCenter">
      <Reveal>
        <SectionHeading
          size="page"
          kicker="How it runs"
          title="A loop, not a report"
          intro="The next scan measures whether the last decision worked. That is the only way an index becomes a management instrument instead of a quarterly slide."
        />
      </Reveal>

      <Reveal delay={0.08}>
        <ol className="tick-corners mt-10 grid gap-px overflow-hidden rounded-2xl border border-divider bg-divider sm:grid-cols-2 lg:grid-cols-5 2xl:mt-14">
          {STEPS.map((s) => (
            <li key={s.n} className="relative bg-ink">
              <Link
                href={orgTabHref(DEMO_ORG_SLUG, s.tab)}
                className="focus-ring group flex h-full flex-col p-5 transition hover:bg-surface/40 2xl:p-6"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs tabular-nums text-accent">{s.n}</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-600">{s.module}</span>
                </span>
                <span className="mt-3 text-base font-semibold text-white group-hover:text-accent">{s.title}</span>
                <span className="mt-1.5 text-sm leading-relaxed text-slate-400 2xl:text-base">{s.detail}</span>
              </Link>
            </li>
          ))}
        </ol>
      </Reveal>

      {/* The return edge, stated in words rather than drawn: an arc across a responsive grid that
          reflows from 5 columns to 2 to 1 would be pointing at the wrong cell at two of those three
          breakpoints, and a decorative line that lies is worse than no line. */}
      <Reveal delay={0.14}>
        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 border-l-2 border-accent/50 pl-4">
          <Kicker>↺ back to 02</Kicker>
          <p className="deck-body text-base text-slate-300">
            The next scheduled scan re-scores what you changed, and the trajectory either bends or it
            doesn&apos;t.
          </p>
        </div>
      </Reveal>
    </DeckSection>
  );
}
