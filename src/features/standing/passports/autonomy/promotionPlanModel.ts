// The fleet promotion plan: which ONE condition, fixed, lifts the most repos to their next autonomy
// tier. Pure, no React. The register below it stays unranked (a clearance is read, not ranked); this
// ranks CONDITIONS, not repos, per the readiness-passports blocker-rollups technique:
//
//   - SCOPED TO A STATED TRANSITION. A repo contributes only to its OWN next step (T0→T1, T1→T2 or
//     T2→T3), from the resolver's own next-tier checklist. The cumulative T2 list can carry t1.* ids
//     for a T0 repo, but a T0 repo's transition is T0→T1, so those never leak into T1→T2.
//   - GROUPED ON IDENTITY. Rows key on the stable condition id, never on the prose, which interpolates
//     each repo's own levels ("Test suite is none" vs "is smoke") and would split one condition.
//   - SOLE FIRST, INCIDENCE BESIDE IT. `sole` = repos for which this is the only unmet condition (the
//     fix converts straight into a promotion); `incidence` = repos carrying it at all.
//   - TIES BY ID, never input order, so the same fleet always yields the same list.
//   - UNASSESSABLE IS ITS OWN BUCKET. A tokenless scan cannot see branch protection, so every tier
//     above T1 is out of reach until a re-scan; that is a limit of the evidence, not a fix, and it is
//     counted beside the rows instead of ranked among them.
//   - PLACEHOLDER REPOS ARE COUNTED AND LABELLED, never excluded: a row names which of its repos rest
//     on a placeholder scan engine.

import { AUTONOMY_TOKENLESS_ID } from "@/lib/analyze/passport-autonomy";
import type { AutonomyConditionId } from "@/lib/types";
import type { AutonomyTier, RepoAutonomy } from "./autonomyModel";

export type PlanRepo = Pick<RepoAutonomy, "fullName" | "name" | "tier" | "nextTier" | "blocking" | "blockingIds" | "engine">;

export type FixableConditionId = Exclude<AutonomyConditionId, typeof AUTONOMY_TOKENLESS_ID>;

/** A short, repo-independent name per condition. The resolver's prose stays on each repo's card. */
export const CONDITION_LABEL: Record<FixableConditionId, string> = {
  "t1.agent-instructions": "Agent instructions file (CLAUDE.md / AGENTS.md)",
  "t1.test-entry": "One-command test entry point",
  "t1.tests-partial": "Test suite at least partial",
  "t2.ci-gated": "CI gates merges (branch protection)",
  "t2.tests-substantial": "Substantial test suite",
  "t2.guardrails": "Guardrail hooks or a reproducible sandbox",
  "t3.ai-in-workflow": "AI in the repo's workflow",
  "t3.evals": "Eval harness for AI output",
  "t3.migrations-versioned": "Versioned migrations",
};

export interface PlanRow {
  id: FixableConditionId;
  label: string;
  /** Repos for which this is the ONLY unmet condition on their next transition. */
  sole: number;
  /** Repos carrying this condition on their next transition at all. */
  incidence: number;
  /** fullNames of the carrying repos, sorted. */
  repos: string[];
  /** The subset of `repos` whose verdict rests on a placeholder scan engine. */
  placeholderRepos: string[];
}

export interface PlanTransition {
  from: AutonomyTier;
  to: AutonomyTier;
  /** Repos whose next transition this is (assessed + unassessable). */
  population: number;
  /** Repos the scan could not assess for this step (tokenless: enforcement not observable). */
  unassessable: number;
  unassessableRepos: string[];
  rows: PlanRow[];
}

const isPlaceholder = (r: PlanRepo): boolean => r.engine === "mock";
const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** One transition's rollup over the repos whose next step it is. */
function rollup(from: AutonomyTier, repos: PlanRepo[]): PlanTransition {
  const cohort = repos.filter((r) => r.tier === from && r.nextTier === from + 1);
  const unassessableRepos: string[] = [];
  const rows = new Map<FixableConditionId, PlanRow>();

  for (const r of cohort) {
    if (r.blockingIds.includes(AUTONOMY_TOKENLESS_ID)) {
      unassessableRepos.push(r.fullName);
      continue;
    }
    const ids = [...new Set(r.blockingIds)] as FixableConditionId[];
    for (const id of ids) {
      const row = rows.get(id) ?? { id, label: CONDITION_LABEL[id] ?? id, sole: 0, incidence: 0, repos: [], placeholderRepos: [] };
      row.incidence += 1;
      if (ids.length === 1) row.sole += 1;
      row.repos.push(r.fullName);
      if (isPlaceholder(r)) row.placeholderRepos.push(r.fullName);
      rows.set(id, row);
    }
  }

  const ranked = [...rows.values()]
    .map((row) => ({ ...row, repos: [...row.repos].sort(byId), placeholderRepos: [...row.placeholderRepos].sort(byId) }))
    .sort((a, b) => b.sole - a.sole || b.incidence - a.incidence || byId(a.id, b.id));

  return {
    from,
    to: (from + 1) as AutonomyTier,
    population: cohort.length,
    unassessable: unassessableRepos.length,
    unassessableRepos: unassessableRepos.sort(byId),
    rows: ranked,
  };
}

/** The plan for every transition, T0→T1, T1→T2, T2→T3, in ladder order. Repos at T3 have no next
 *  transition and contribute to none. */
export function promotionPlan(repos: PlanRepo[]): PlanTransition[] {
  return ([0, 1, 2] as AutonomyTier[]).map((from) => rollup(from, repos));
}
