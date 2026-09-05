// AI-stance fleet overview (W3) — the async assembly sibling of buildGovernanceOverview: reads the
// active stance + per-repo facts (existing scan data only) and evaluates every repo through the
// PURE evaluator in stance.ts. The overview STAMPS the stance version it evaluated, so a readout
// can never silently mix a repo verdict computed against v2 with a header claiming v3. Everything
// here is "declared vs observed attribution" — see stance.ts for the semantics contract.

import { getActiveOrgStance, getStanceRepoFacts } from "@/lib/db";
import {
  evaluateStanceCompliance,
  repoGlobMatches,
  type RepoStanceCompliance,
} from "@/lib/org/stance";
import type { AiStance, AiStanceZone, AutonomyTierId } from "@/lib/types";

/** A declared zone with the repos it currently matches — repo scope checkable, path scope advisory. */
export interface StanceZoneView extends AiStanceZone {
  /** Repo fullNames the zone's repoGlobs match today. */
  matchedRepos: string[];
  /** Observed AI attribution inside matched repos (breach count = repos, not commits). */
  breachedRepos: string[];
  /** True when the zone carries pathGlobs — that half is declared-only (label it). */
  pathAdvisory: boolean;
}

/** An AI tool observed in PR attribution that the stance's allowlist doesn't declare. */
export interface UndeclaredTool {
  name: string;
  repos: string[];
}

export interface StanceOverview {
  org: string;
  /** The stance version every repo verdict below was evaluated against. */
  stanceVersion: number;
  publishedAt: string | null; // ISO date (yyyy-mm-dd) for display
  publishedBy: string | null;
  stance: AiStance;
  repos: RepoStanceCompliance[];
  zones: StanceZoneView[];
  /** Observed-but-undeclared tools across the fleet (empty when no tool allowlist is declared). */
  undeclaredTools: UndeclaredTool[];
  /** % of scanned repos acknowledging the CURRENT version. */
  ackRate: number;
  /** % of scanned repos with no non-advisory finding. */
  cleanRate: number;
  /** Repos whose REAL autonomy tier is T2+ (need more than one approval under typical stances). */
  elevatedCount: number;
  /** Total non-advisory findings across the fleet. */
  findingCount: number;
}

/** Repos grouped into the four tier bands by their REAL autonomy tier (shared resolver), plus the
 *  repos whose latest scan carries no passport (tier not assessed — shown honestly, not defaulted). */
export function reposByTier(repos: RepoStanceCompliance[]): {
  byTier: Record<AutonomyTierId, RepoStanceCompliance[]>;
  unassessed: RepoStanceCompliance[];
} {
  const byTier: Record<AutonomyTierId, RepoStanceCompliance[]> = { T0: [], T1: [], T2: [], T3: [] };
  const unassessed: RepoStanceCompliance[] = [];
  for (const r of repos) {
    if (r.tier) byTier[r.tier].push(r);
    else unassessed.push(r);
  }
  return { byTier, unassessed };
}

/**
 * Assemble the fleet's stance reading. Null when no stance is PUBLISHED (the publish-CTA empty
 * state) — a draft alone renders in the editor, never as a compliance readout.
 */
export async function buildStanceOverview(orgSlug: string): Promise<StanceOverview | null> {
  const active = await getActiveOrgStance(orgSlug);
  if (!active) return null;
  const facts = await getStanceRepoFacts(orgSlug);

  const repos = facts
    .map((f) => evaluateStanceCompliance(active.stance, f, active.version))
    .sort((a, b) => Number(a.compliant) - Number(b.compliant) || a.overall - b.overall);

  // Zone views: which repos each declared zone matches, and where AI attribution was observed
  // inside a sealed repo anyway. The per-repo evaluator already emits the finding; this is the
  // zone-centric projection the SealedZones panel renders.
  const observed = new Map(facts.map((f) => [f.fullName, (f.aiInvolvedRate ?? 0) > 0 || f.unapprovedAiChanges > 0 || f.observedTools.length > 0]));
  const zones: StanceZoneView[] = active.stance.noAiZones.map((z) => {
    const matchedRepos = facts.filter((f) => z.repoGlobs.some((g) => repoGlobMatches(g, f.fullName))).map((f) => f.fullName);
    return {
      ...z,
      matchedRepos,
      breachedRepos: matchedRepos.filter((fn) => observed.get(fn) === true),
      pathAdvisory: z.pathGlobs.length > 0,
    };
  });

  // Fleet-level undeclared tools (the checkpoint strip's third column): only meaningful when the
  // stance actually declares a tool allowlist.
  const undeclared = new Map<string, string[]>();
  if (active.stance.permittedTools.length > 0) {
    const permitted = active.stance.permittedTools.map((t) => t.toLowerCase());
    for (const f of facts) {
      for (const tool of f.observedTools) {
        const lc = tool.toLowerCase();
        if (permitted.some((p) => p.includes(lc) || lc.includes(p))) continue;
        const list = undeclared.get(tool) ?? [];
        list.push(f.fullName);
        undeclared.set(tool, list);
      }
    }
  }

  const scanned = repos.length;
  const acked = repos.filter((r) => r.ack === "current").length;
  const clean = repos.filter((r) => r.compliant).length;

  return {
    org: orgSlug,
    stanceVersion: active.version,
    publishedAt: active.publishedAt ? active.publishedAt.toISOString().slice(0, 10) : null,
    publishedBy: active.publishedBy,
    stance: active.stance,
    repos,
    zones,
    undeclaredTools: [...undeclared.entries()]
      .map(([name, list]) => ({ name, repos: list }))
      .sort((a, b) => b.repos.length - a.repos.length),
    ackRate: scanned ? Math.round((acked / scanned) * 100) : 0,
    cleanRate: scanned ? Math.round((clean / scanned) * 100) : 0,
    elevatedCount: repos.filter((r) => r.tier === "T2" || r.tier === "T3").length,
    findingCount: repos.reduce((a, r) => a + r.findings.filter((f) => !f.advisory).length, 0),
  };
}
