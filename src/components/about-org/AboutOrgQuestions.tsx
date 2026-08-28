"use client";

// The argument section: what a per-repo score structurally cannot tell you.
//
// Shape chosen deliberately. The obvious move — four "pain" cards — is already what /about's cost
// section does, and repeating it would make the second deck read as a reskin of the first. This is a
// hairline ledger of QUESTIONS instead: the left column is the sentence a director actually says out
// loud, the right column is the exact view that answers it, hyperlinked into the live demo. It argues
// and navigates at the same time, and every row is falsifiable — if a link doesn't answer its
// question, the claim is visibly wrong.

import Link from "next/link";
import { SectionHeading } from "@/components/ui";
import { Reveal } from "@/components/deck/Reveal";
import { DeckSection } from "@/components/deck/DeckSection";
import { orgTabHref, type OrgTabId } from "@/lib/org/orgTabs";
import { orgGroupLabelFor } from "./orgModules";
import { DEMO_ORG_SLUG } from "@/lib/site";

interface OrgQuestion {
  ask: string;
  tab: OrgTabId;
  /** The named surface INSIDE the tab that answers the question — a sub-view, not the tab itself. */
  view: string;
}

// The module half of each trail is DERIVED from the tab (see `orgGroupLabelFor`). It used to be typed
// here, and named modules the product retired: "Fleet", "Intelligence", "Govern". A reader who
// followed one of these links landed in Standing or Admin and found no such module in the rail —
// on the same page whose module map promises the names are the product's own.
const QUESTIONS: OrgQuestion[] = [
  {
    ask: "Which repositories are ready to accelerate, and which are quietly compounding risk?",
    tab: "repositories",
    view: "Repositories",
  },
  {
    ask: "Are we actually becoming more AI-native, or just louder about it?",
    tab: "overview",
    view: "Trajectory",
  },
  {
    ask: "Where is the one fix that moves twenty repos instead of two?",
    tab: "followups",
    view: "Follow-ups",
  },
  {
    ask: "Who already knows how to do this, and which teams are sitting at zero?",
    tab: "contributors",
    view: "Contributors",
  },
  {
    ask: "Can we prove any of it to an auditor next quarter?",
    tab: "audit",
    view: "Audit trail",
  },
];

export function AboutOrgQuestions() {
  return (
    <DeckSection id="questions" contained justify="startLgCenter">
      <Reveal>
        <SectionHeading
          size="page"
          kicker="Why the org edition exists"
          // Derived from the ledger below it — a heading that counts its own rows can't be off by one.
          title={`${QUESTIONS.length} questions a repository score cannot answer`}
          intro="A per-repo report tells you how one codebase is doing. None of these questions are about one codebase: they are about the population, the trend, and the evidence. Each has a view that answers it; open any of them in the live demo."
        />
      </Reveal>

      {/* One Reveal around the whole ledger, not one per row: the rows are separated by `divide-y` on
          this container, and wrapping each row in its own Reveal <div> would both break that (every
          link becomes the last child of its own wrapper) and spin up five IntersectionObservers to
          stagger a list that reads better arriving as a single plate. */}
      <Reveal>
        <div className="tick-corners mt-10 divide-y divide-divider overflow-hidden rounded-2xl border border-divider 2xl:mt-14">
          {QUESTIONS.map((q, i) => (
            <Link
              key={q.ask}
              href={orgTabHref(DEMO_ORG_SLUG, q.tab)}
              className="focus-ring group grid items-center gap-x-6 gap-y-2 px-5 py-5 transition hover:bg-surface/40 sm:grid-cols-[1fr_auto] sm:px-7 sm:py-6"
            >
              <span className="flex items-start gap-4">
                {/* The row's own number — an index, in the publication's voice. */}
                <span className="mt-0.5 shrink-0 font-mono text-xs tabular-nums text-slate-600 transition group-hover:text-accent">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="deck-body text-base leading-relaxed text-slate-200 group-hover:text-white">
                  {q.ask}
                </span>
              </span>
              <span className="flex items-center gap-2 pl-8 sm:justify-end sm:pl-0">
                <span className="font-mono text-xs uppercase tracking-[0.2em] text-slate-600">{orgGroupLabelFor(q.tab)}</span>
                <span aria-hidden className="text-slate-700">
                  ›
                </span>
                <span className="font-mono text-xs uppercase tracking-[0.2em] text-accent">{q.view}</span>
                <span aria-hidden className="font-mono text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-accent">
                  →
                </span>
              </span>
            </Link>
          ))}
        </div>
      </Reveal>
    </DeckSection>
  );
}
