"use client";

// Organization edition section for The Index — the cross-repo intro plus a gallery of the use cases
// an org gets inside the app, each card linking straight into the curated org demo for that view.

import Link from "next/link";
import { DeckSection } from "@/components/deck/DeckSection";
import { Kicker } from "@/components/ui";
import { DEMO_ORG_NAME, demoOrgHref } from "@/lib/site";

interface OrgUseCase {
  title: string;
  blurb: string;
  href: string;
}

// Concrete org surfaces the app ships — each links into the curated demo org (one configurable slug —
// see lib/site) so the use case is one click away rather than described in the abstract.
const ORG_USE_CASES: OrgUseCase[] = [
  {
    title: "Executive rollup",
    blurb: "One maturity score for the whole org, with trends and the repos pulling it up or down.",
    href: demoOrgHref("executive"),
  },
  {
    title: "Governance & policy",
    blurb: "Branch protection, review gates, and rulesets audited across every repository.",
    href: demoOrgHref("governance"),
  },
  {
    title: "AI adoption",
    blurb: "See which teams have operationalized AI tooling, agents, and shared conventions.",
    href: demoOrgHref("adoption"),
  },
  {
    title: "Delivery & CI/CD",
    blurb: "Pipeline health, merge gates, and how reliably code reaches production.",
    href: demoOrgHref("delivery"),
  },
  {
    title: "Supply-chain security",
    blurb: "Shift-left scanning, secret hygiene, and provenance across the fleet.",
    href: demoOrgHref("security"),
  },
  {
    title: "Improvement plan",
    blurb: "A prioritized, ROI-ranked backlog to raise the org to the next level.",
    href: demoOrgHref("plan"),
  },
];

export function IndexOrg() {
  return (
    <DeckSection id="org" justify="startLgCenter">
      <div className="grid gap-6 border-y border-divider py-8 sm:grid-cols-[1fr_auto] sm:items-center 2xl:py-10">
        <div className="max-w-2xl">
          <Kicker>Organization edition</Kicker>
          <h2 className="deck-h2 mt-2 text-2xl font-bold text-white">Index the whole organization</h2>
          <p className="deck-body mt-2 text-base leading-relaxed text-slate-400">
            Ascent scans every repository in an org and rolls the results into one cross-repo register: shared
            strengths, the gaps common across teams, contributor activity, and where to invest next.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:items-end">
          <Link
            href={demoOrgHref()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-base font-semibold text-on-accent transition hover:bg-accent-soft"
          >
            Explore the {DEMO_ORG_NAME} org report →
          </Link>
          <Link href="/onboarding" className="text-sm font-medium text-slate-300 transition hover:text-white">
            Or analyze your own organization →
          </Link>
          {/* The full org-edition story. These six cards are a teaser; /about-org walks the whole
              module map, the fleet-wide capabilities and the operating loop. */}
          <Link
            href="/about-org"
            className="focus-ring rounded-sm font-mono text-xs uppercase tracking-widest text-slate-400 transition hover:text-accent"
          >
            <span aria-hidden>▸</span> What the organization edition includes
          </Link>
        </div>
      </div>

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:mt-10 2xl:gap-4">
        {ORG_USE_CASES.map((u) => (
          <Link
            key={u.title}
            href={u.href}
            className="focus-ring group flex flex-col rounded-xl border border-divider bg-surface-strong/40 p-5 transition hover:border-accent/60 hover:bg-surface/40"
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-base font-semibold text-white group-hover:text-accent">{u.title}</span>
              <span className="font-mono text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-accent">→</span>
            </span>
            <span className="mt-2 text-sm leading-relaxed text-slate-400 2xl:text-base">{u.blurb}</span>
          </Link>
        ))}
      </div>
    </DeckSection>
  );
}
