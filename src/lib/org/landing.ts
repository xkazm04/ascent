// Which tab a bare `/org/<slug>` opens on (W1b). Pure over its inputs — the same db-facts / pure-
// assembly split as getting-started.ts and nav-counts.ts, so the decision is unit-testable without a
// database and the shell + the page can't disagree about it.
//
// WHY THIS EXISTS. The improvement loop (src/lib/db/improvement.ts: identify → triage → PR → merge →
// rescan → verified impact) is the product's differentiator, and until W1 it sat third-of-four inside
// a nav group called "Fleet" — a returning org whose PRs were mid-flight landed on a score ring
// instead of on its own work. Landing is now a decision, not a constant.
//
// THE RULE. Read your baseline first; after that, open on what is moving.
//   - No completed scan yet  → `overview`. There is nothing in flight, and the baseline IS the job.
//   - A loop running         → `live`. Work is open on the org's behalf; that is the news.
//   - Scanned, nothing open  → `overview`. The fleet read is the right resting state.
//
// This deliberately does NOT consider the backlog: an item sitting in the backlog is a decision not
// yet taken, and landing someone on a to-do list every visit is nagging, not companionship. Only an
// actually-open PR — something the org already said yes to — earns the landing slot.

import { DEFAULT_ORG_TAB, type OrgTabId } from "@/lib/org/orgTabs";

/** The two facts the decision needs. Both are cheap counts the shell already has or can get in one query. */
export interface OrgLandingFacts {
  /** Repos with at least one completed scan (getOrgHeaderSummary.scannedCount). */
  scannedCount: number;
  /** ImprovementPr rows in state "open" — PRs the loop has in flight right now. */
  inFlightPrs: number;
}

/** The tab a bare `/org/<slug>` opens on. Pure. */
export function resolveLandingTab(facts: OrgLandingFacts): OrgTabId {
  if (facts.scannedCount <= 0) return DEFAULT_ORG_TAB;
  return facts.inFlightPrs > 0 ? "live" : DEFAULT_ORG_TAB;
}

/** Did the landing decision move the org off its default? Drives the "we brought you here" note. */
export function isLoopLanding(facts: OrgLandingFacts): boolean {
  return resolveLandingTab(facts) !== DEFAULT_ORG_TAB;
}
