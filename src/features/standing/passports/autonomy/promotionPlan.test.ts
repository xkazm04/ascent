// The fleet promotion plan (challenge-2026-09-23, ai-native-passports#B). The per-repo register can
// say each repo's tier and its first unmet condition; it cannot say which ONE fix lifts the most repos.
// These pin the rollup the governing technique (readiness-passports / blocker-rollups) prescribes:
// scoped to a stated transition, ranked by sole-blocker count with incidence beside it, ties broken by
// condition id (never input order), and a tokenless scan kept in its own unassessable bucket rather
// than ranked as a fix.

import { describe, it, expect } from "vitest";
import { AUTONOMY_TOKENLESS_ID, TOKENLESS_MISSING } from "@/lib/analyze/passport-autonomy";
import type { AutonomyTier } from "./autonomyModel";
import { promotionPlan, type PlanRepo } from "./promotionPlan";

/** A repo at `tier` whose next transition is blocked by `ids` (prose is irrelevant to the plan). */
function repo(name: string, tier: AutonomyTier, ids: string[], engine: string | null = "claude"): PlanRepo {
  return {
    fullName: `acme/${name}`,
    name,
    tier,
    nextTier: tier < 3 ? ((tier + 1) as AutonomyTier) : null,
    blocking: ids.map((id) => (id === AUTONOMY_TOKENLESS_ID ? TOKENLESS_MISSING : `prose for ${id}`)),
    blockingIds: ids,
    engine,
  };
}

const t12 = (repos: PlanRepo[]) => promotionPlan(repos).find((t) => t.from === 1 && t.to === 2)!;

/** Every permutation of a small list (Heap's algorithm is overkill for n ≤ 5). */
function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest]));
}

describe("promotionPlan — sole blocker first, incidence beside it", () => {
  it("three T1 repos held only by CI gating, one also by guardrails: ci-gated leads with sole 3, incidence 4", () => {
    const repos = [
      repo("a", 1, ["t2.ci-gated"]),
      repo("b", 1, ["t2.ci-gated"]),
      repo("c", 1, ["t2.ci-gated"]),
      repo("d", 1, ["t2.ci-gated", "t2.guardrails"]),
    ];
    const t = t12(repos);
    expect(t.rows[0].id).toBe("t2.ci-gated");
    expect(t.rows[0].sole).toBe(3);
    expect(t.rows[0].incidence).toBe(4);
    expect(t.rows[0].repos).toEqual(["acme/a", "acme/b", "acme/c", "acme/d"]);
    expect(t.rows[1]).toMatchObject({ id: "t2.guardrails", sole: 0, incidence: 1, repos: ["acme/d"] });
    expect(t.population).toBe(4);
    expect(t.unassessable).toBe(0);
  });

  it("a tokenless T1 repo is unassessable for T1→T2, never counted or ranked as a fixable condition", () => {
    const t = t12([
      repo("a", 1, ["t2.ci-gated"]),
      repo("tokenless", 1, [AUTONOMY_TOKENLESS_ID, "t2.ci-gated", "t2.guardrails"]),
    ]);
    expect(t.unassessable).toBe(1);
    expect(t.unassessableRepos).toEqual(["acme/tokenless"]);
    expect(t.rows.map((r) => r.id)).not.toContain(AUTONOMY_TOKENLESS_ID);
    for (const r of t.rows) {
      expect(r.repos).not.toContain("acme/tokenless");
    }
    expect(t.rows.find((r) => r.id === "t2.ci-gated")).toMatchObject({ sole: 1, incidence: 1 });
    expect(t.rows.find((r) => r.id === "t2.guardrails")).toBeUndefined();
  });

  it("equal sole and incidence order by condition id, identically for every input permutation", () => {
    const repos = [
      repo("a", 1, ["t2.tests-substantial"]),
      repo("b", 1, ["t2.guardrails"]),
      repo("c", 1, ["t2.ci-gated"]),
      repo("d", 1, [AUTONOMY_TOKENLESS_ID, "t2.ci-gated"]),
    ];
    const expected = promotionPlan(repos);
    expect(t12(repos).rows.map((r) => r.id)).toEqual(["t2.ci-gated", "t2.guardrails", "t2.tests-substantial"]);
    for (const p of permutations(repos)) {
      expect(promotionPlan(p)).toEqual(expected);
    }
  });

  it("T3 repos contribute to no transition; placeholder-engine repos are counted and labelled", () => {
    const plan = promotionPlan([
      repo("top", 3, []),
      repo("mocked", 0, ["t1.test-entry"], "mock"),
      repo("real", 0, ["t1.test-entry", "t1.agent-instructions"]),
    ]);
    expect(plan.map((t) => `${t.from}->${t.to}`)).toEqual(["0->1", "1->2", "2->3"]);
    for (const t of plan) {
      for (const r of t.rows) expect(r.repos).not.toContain("acme/top");
    }
    expect(plan.reduce((n, t) => n + t.population, 0)).toBe(2);
    const t01 = plan[0];
    const entry = t01.rows.find((r) => r.id === "t1.test-entry")!;
    expect(entry).toMatchObject({ sole: 1, incidence: 2, placeholderRepos: ["acme/mocked"] });
    expect(entry.repos).toContain("acme/mocked");
    expect(t01.rows.find((r) => r.id === "t1.agent-instructions")!.placeholderRepos).toEqual([]);
  });

  it("a row carries a stable label, never the repo-specific prose", () => {
    const row = promotionPlan([repo("a", 0, ["t1.tests-partial"])])[0].rows[0];
    expect(row.label).not.toMatch(/prose for/);
    expect(row.label.length).toBeGreaterThan(0);
  });
});
