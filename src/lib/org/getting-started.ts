// Server-derived getting-started model (W6a) — the checklist behind the onboarding channel.
//
// Doneness is DERIVED from what the org's data already proves (getGettingStartedFacts), never
// recorded per step: assign a rec from the backlog tab, an apply-PR, or the API — any door — and
// "resolve one gap" is done. The five steps mirror the onboarding narrative
// (baseline → resolve → registry → loop → team; see docs/features/onboarding/wizard.md).
//
// HONESTY: each step carries `available` so the UI can render truthfully instead of dangling
// impossible work — a PERSONAL workspace has no members, no fleet watch and no governance surface,
// and a viewer-role member can't perform the write-shaped steps. `allDone` rolls up over AVAILABLE
// steps only (an unavailable step must not permanently block "you're set up").
//
// This module stays pure over its inputs (buildGettingStartedModel) with a thin fetch orchestrator
// (buildGettingStarted) — the same db-facts / pure-assembly split as nav-counts.

import { isDbConfigured } from "@/lib/db/client";
import { roleAtLeast, type OrgRole } from "@/lib/db/members";
import {
  EMPTY_GETTING_STARTED_FACTS,
  getGettingStartedFacts,
  type GettingStartedFacts,
} from "@/lib/db/org-onboarding";
import type { OrgTabId } from "@/lib/org/orgTabs";

export type GettingStartedStepId = "first-scan" | "gap-engaged" | "registry" | "loop" | "team";

/** The onboarding narrative's phases, in order. Each step belongs to exactly one. */
export type GettingStartedPhase = "baseline" | "resolve" | "registry" | "loop" | "team";

/**
 * The `data-tour` anchor each step spotlights. `first-scan` reuses the anchor that already exists in
 * the DOM (OverviewFleetPanel's results grid); the rest are declared HERE and stamped onto their
 * elements by the UI lane (W6c) — one shared constant so the model and the DOM can't drift.
 */
export const GETTING_STARTED_ANCHORS: Record<GettingStartedStepId, string> = {
  "first-scan": "results-view",
  "gap-engaged": "backlog-recs",
  registry: "skills-registry",
  loop: "watch-schedule",
  team: "invite-member",
};

export interface GettingStartedStep {
  id: GettingStartedStepId;
  phase: GettingStartedPhase;
  /** Derived from real data — see the per-step predicates in buildGettingStartedModel. */
  done: boolean;
  /** Can THIS workspace kind + viewer role actually perform the step? Render honestly when false. */
  available: boolean;
  /** The org tab that hosts the step's work. */
  tab: OrgTabId;
  /** `data-tour` anchor to spotlight inside that tab (see GETTING_STARTED_ANCHORS). */
  anchor: string;
  /** Optional progress note for composite steps (e.g. "1 of 3 instrumented — schedule ✓"). */
  detail?: string;
}

export interface GettingStarted {
  steps: GettingStartedStep[];
  /** Every AVAILABLE step done. Unavailable steps never block the rollup. */
  allDone: boolean;
  /** Personal workspace (Organization.kind === "personal") — fleet/governance/team steps are off. */
  personal: boolean;
}

/**
 * Availability by role: `null` means the deployment has no viewer identity at all (auth-off local /
 * demo boxes, where every write route is open) and is treated as unrestricted. A real role gates by
 * the SAME thresholds the write routes enforce, so the checklist never points at a 403:
 * backlog/registry writes are member-gated (requireOrgAccess), the alerts sink is admin-gated, and
 * invites + stance publish are owner-gated. `loop` is admin because an admin can complete it
 * honestly — two of its three instruments (schedule, alerts) are within reach and two is the bar.
 */
function can(role: OrgRole | null, min: OrgRole): boolean {
  return role === null || roleAtLeast(role, min);
}

/** Pure assembly: facts + workspace kind + viewer role → the typed checklist. */
export function buildGettingStartedModel(facts: GettingStartedFacts, role: OrgRole | null): GettingStarted {
  const personal = facts.kind === "personal";

  const loopBits: Array<{ label: string; on: boolean }> = [
    { label: "watch schedule", on: facts.loopSchedule },
    { label: "alerts webhook", on: facts.loopAlerts },
    { label: "published AI stance", on: facts.loopStance },
  ];
  const loopOn = loopBits.filter((b) => b.on).length;
  const loopDetail = `${loopOn} of ${loopBits.length} instrumented — ${loopBits
    .map((b) => (b.on ? `${b.label} ✓` : b.label))
    .join(" · ")}`;

  const teamDetail = facts.hasPendingInvite
    ? `${facts.memberCount} member${facts.memberCount === 1 ? "" : "s"} · invite pending`
    : `${facts.memberCount} member${facts.memberCount === 1 ? "" : "s"}`;

  const steps: GettingStartedStep[] = [
    {
      id: "first-scan",
      phase: "baseline",
      done: facts.hasCompletedScan,
      // Reading the baseline is every member's step — and a personal workspace scans through the
      // public report flow, so it's available there too.
      available: true,
      tab: "overview",
      anchor: GETTING_STARTED_ANCHORS["first-scan"],
    },
    {
      id: "gap-engaged",
      phase: "resolve",
      done: facts.gapEngaged,
      // Assigning/closing a rec or opening an apply-PR is a member-level write; a personal
      // workspace engages through its private overlay on the same backlog tab.
      available: can(role, "member"),
      tab: "backlog",
      anchor: GETTING_STARTED_ANCHORS["gap-engaged"],
    },
    {
      id: "registry",
      phase: "registry",
      done: facts.registrySeeded,
      // Skills + Memory exist on personal workspaces too (both tabs are in the personal subset).
      available: can(role, "member"),
      tab: "skills",
      anchor: GETTING_STARTED_ANCHORS.registry,
    },
    {
      id: "loop",
      phase: "loop",
      done: loopOn >= 2,
      // Fleet-only: a personal workspace watches repos via /api/me/watch (no org schedule), has no
      // alert sink and no governance surface. Admin threshold — see `can`'s doc.
      available: !personal && can(role, "admin"),
      tab: "repositories",
      anchor: GETTING_STARTED_ANCHORS.loop,
      detail: loopDetail,
    },
    {
      id: "team",
      phase: "team",
      done: facts.memberCount >= 2 || facts.hasPendingInvite,
      // No members surface on a personal workspace; invites are owner-gated.
      available: !personal && can(role, "owner"),
      tab: "members",
      anchor: GETTING_STARTED_ANCHORS.team,
      detail: teamDetail,
    },
  ];

  const availableSteps = steps.filter((s) => s.available);
  return {
    steps,
    allDone: availableSteps.length > 0 && availableSteps.every((s) => s.done),
    personal,
  };
}

/**
 * Fetch + assemble for `slug`. An org row that doesn't exist yet yields the all-false checklist
 * (nothing exists ⇒ nothing is done — exactly right for a workspace pre-first-scan); null only when
 * the DB is off (the caller answers 503, there is no data to derive from).
 */
export async function buildGettingStarted(slug: string, role: OrgRole | null): Promise<GettingStarted | null> {
  if (!isDbConfigured()) return null;
  const facts = await getGettingStartedFacts(slug);
  return buildGettingStartedModel(facts ?? EMPTY_GETTING_STARTED_FACTS, role);
}
