"use client";

// Organization edition section for The Index — the cross-repo intro plus a gallery of the use cases
// an org gets inside the app, each card linking straight into the live Vercel demo for that view.

import Link from "next/link";
import { Kicker } from "@/components/ui";
import { DeckSection } from "@/components/deck/DeckSection";

interface OrgUseCase {
  title: string;
  blurb: string;
  href: string;
}

// Concrete org surfaces the app ships — each links into the public Vercel demo so the use case is one
// click away rather than described in the abstract.
const ORG_USE_CASES: OrgUseCase[] = [
  {
    title: "Executive rollup",
    blurb: "One maturity score for the whole org, with trends and the repos pulling it up or down.",
    href: "/org/vercel/executive",
  },
  {
    title: "Governance & policy",
    blurb: "Branch protection, review gates, and rulesets audited across every repository.",
    href: "/org/vercel/governance",
  },
  {
    title: "AI adoption",
    blurb: "See which teams have operationalized AI tooling, agents, and shared conventions.",
    href: "/org/vercel/adoption",
  },
  {
    title: "Delivery & CI/CD",
    blurb: "Pipeline health, merge gates, and how reliably code reaches production.",
    href: "/org/vercel/delivery",
  },
  {
    title: "Supply-chain security",
    blurb: "Shift-left scanning, secret hygiene, and provenance across the fleet.",
    href: "/org/vercel/security",
  },
  {
    title: "Improvement plan",
    blurb: "A prioritized, ROI-ranked backlog to raise the org to the next level.",
    href: "/org/vercel/plan",
  },
];

export function IndexOrg() {
  return (
    <DeckSection id="org">
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

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ORG_USE_CASES.map((u) => (
          <Link
            key={u.title}
            href={u.href}
            className="focus-ring group flex flex-col rounded-xl border border-slate-800 bg-slate-950/40 p-5 transition hover:border-accent/60 hover:bg-slate-900/40"
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-base font-semibold text-white group-hover:text-accent">{u.title}</span>
              <span className="font-mono text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-accent">→</span>
            </span>
            <span className="mt-2 text-sm leading-relaxed text-slate-400">{u.blurb}</span>
          </Link>
        ))}
      </div>
    </DeckSection>
  );
}
