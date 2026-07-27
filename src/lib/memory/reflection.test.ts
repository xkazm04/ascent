// Tests for the reflection (consolidation-into-summary) core. No CLI is ever spawned: `runPrompt` is
// injected, which is the point of keeping the module framework- and provider-free.
//
// The load-bearing guarantees pinned here:
//   - Jaccard is symmetric (unlike consolidation.ts's overlap coefficient) so clustering isn't fooled by
//     one short memory that happens to be a subset of a long one;
//   - clustering is transitive (A~B, B~C ⇒ one family) and only families of ≥3 are candidates;
//   - a `summary` is never a member of another summary;
//   - parseReflectionProposals REJECTS a proposal naming a foreign/invented id — those ids become
//     `supersededBy` writes, so an unvalidated one would silently retire an arbitrary memory;
//   - a rollup can never claim more confidence than the most confident memory it consolidates;
//   - with no model reachable there are NO proposals — silence, never a fabricated summary.

import { describe, it, expect, vi } from "vitest";
import {
  buildReflectionPrompt,
  clusterMemories,
  jaccard,
  MIN_CLUSTER_SIZE,
  parseReflectionProposals,
  proposeReflections,
  reflectionEligible,
  UnionFind,
  type ReflectionCandidate,
} from "@/lib/memory/reflection";

const mem = (id: string, content: string, kind = "episodic", confidence = 0.8): ReflectionCandidate => ({
  id,
  content,
  kind,
  confidence,
});

/** Three memories about one deploy incident — they share enough tokens to exceed 0.30 pairwise. */
const cluster3 = [
  mem("m1", "deploy pipeline failed on staging because the migration lock timed out"),
  mem("m2", "deploy pipeline failed again on staging, migration lock timed out once more"),
  mem("m3", "staging deploy pipeline migration lock timed out and failed the release"),
];

describe("jaccard", () => {
  it("is 1 for identical token sets and 0 for disjoint ones", () => {
    expect(jaccard("auth flow uses supabase", "supabase auth flow uses")).toBe(1);
    expect(jaccard("auth supabase", "kubernetes helm")).toBe(0);
  });
  it("is symmetric", () => {
    const a = "the deploy pipeline failed on staging";
    const b = "deploy pipeline failed";
    expect(jaccard(a, b)).toBe(jaccard(b, a));
  });
  it("punishes a short subset of a long memory (where the overlap coefficient would say 1.0)", () => {
    expect(jaccard("we migrated authentication to supabase oauth last quarter after review", "supabase")).
      toBeLessThan(0.3);
  });
  it("is 0 when either side has no meaningful tokens", () => {
    expect(jaccard("the and of", "supabase auth")).toBe(0);
  });
});

describe("UnionFind", () => {
  it("merges transitively", () => {
    const uf = new UnionFind(4);
    uf.union(0, 1);
    uf.union(1, 2);
    expect(uf.find(0)).toBe(uf.find(2));
    expect(uf.find(3)).not.toBe(uf.find(0));
  });
});

describe("clusterMemories", () => {
  it("finds a family of three and reports its cohesion", () => {
    const clusters = clusterMemories(cluster3);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.memberIds.sort()).toEqual(["m1", "m2", "m3"]);
    expect(clusters[0]!.cohesion).toBeGreaterThan(0.3);
  });

  it("ignores a pair — MIN_CLUSTER_SIZE is 3, a pair is the supersede path", () => {
    expect(MIN_CLUSTER_SIZE).toBe(3);
    expect(clusterMemories(cluster3.slice(0, 2))).toEqual([]);
  });

  it("does not pull in an unrelated memory", () => {
    const clusters = clusterMemories([...cluster3, mem("x", "we pay for datadog monthly per host")]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.memberIds).not.toContain("x");
  });

  it("is transitive: A~B and B~C group all three even when A~C alone falls short", () => {
    const items = [
      mem("a", "alpha beta gamma delta"),
      mem("b", "beta gamma delta epsilon zeta"),
      mem("c", "delta epsilon zeta eta"),
    ];
    const clusters = clusterMemories(items, 0.3);
    expect(jaccard(items[0]!.content, items[2]!.content)).toBeLessThan(0.3);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.memberIds).toHaveLength(3);
  });

  it("is deterministic regardless of a threshold that excludes everything", () => {
    expect(clusterMemories(cluster3, 0.99)).toEqual([]);
  });
});

describe("reflectionEligible", () => {
  it("excludes existing summaries so a rollup is never rolled up again", () => {
    const items = [...cluster3, mem("s", "a rollup of the deploy incidents", "summary")];
    expect(reflectionEligible(items).map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });
});

describe("buildReflectionPrompt", () => {
  it("names every member id and asks for strict JSON", () => {
    const prompt = buildReflectionPrompt(clusterMemories(cluster3), cluster3);
    for (const id of ["m1", "m2", "m3"]) expect(prompt).toContain(id);
    expect(prompt).toContain('"proposals"');
    expect(prompt).toContain("Never invent an id");
  });
});

describe("parseReflectionProposals", () => {
  const clusters = clusterMemories(cluster3);
  const cid = clusters[0]!.memberIds[0]!;
  const ok = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      proposals: [
        {
          clusterId: cid,
          summaryContent: "The staging deploy pipeline repeatedly failed on a migration lock timeout.",
          memberIds: ["m1", "m2", "m3"],
          confidence: 0.7,
          ...over,
        },
      ],
    });

  it("accepts a well-formed proposal and carries the cluster cohesion through", () => {
    const [p] = parseReflectionProposals(ok(), clusters, cluster3);
    expect(p!.memberIds).toEqual(["m1", "m2", "m3"]);
    expect(p!.confidence).toBe(0.7);
    expect(p!.cohesion).toBe(clusters[0]!.cohesion);
  });

  it("accepts a SUBSET of the cluster (a member the rollup does not cover is left out)", () => {
    const [p] = parseReflectionProposals(ok({ memberIds: ["m1", "m2"] }), clusters, cluster3);
    expect(p!.memberIds).toEqual(["m1", "m2"]);
  });

  it("REJECTS the whole proposal when it names an id outside the cluster", () => {
    expect(parseReflectionProposals(ok({ memberIds: ["m1", "m2", "ghost"] }), clusters, cluster3)).toEqual([]);
  });

  it("rejects a proposal for a cluster we never asked about", () => {
    expect(parseReflectionProposals(ok({ clusterId: "invented" }), clusters, cluster3)).toEqual([]);
  });

  it("rejects a rollup of fewer than two members", () => {
    expect(parseReflectionProposals(ok({ memberIds: ["m1"] }), clusters, cluster3)).toEqual([]);
    expect(parseReflectionProposals(ok({ memberIds: ["m1", "m1"] }), clusters, cluster3)).toEqual([]);
  });

  it("rejects a blank or missing summary body", () => {
    expect(parseReflectionProposals(ok({ summaryContent: "   " }), clusters, cluster3)).toEqual([]);
    expect(parseReflectionProposals(ok({ summaryContent: 42 }), clusters, cluster3)).toEqual([]);
  });

  it("caps confidence at the members' own maximum — a rollup never out-trusts its sources", () => {
    const [p] = parseReflectionProposals(ok({ confidence: 1 }), clusters, cluster3);
    expect(p!.confidence).toBe(0.8);
  });

  it("clamps a garbage confidence and falls back to the ceiling when it is absent", () => {
    expect(parseReflectionProposals(ok({ confidence: -5 }), clusters, cluster3)[0]!.confidence).toBe(0);
    expect(parseReflectionProposals(ok({ confidence: "high" }), clusters, cluster3)[0]!.confidence).toBe(0.8);
  });

  it("keeps only the first proposal per cluster", () => {
    const raw = JSON.stringify({
      proposals: [
        { clusterId: cid, summaryContent: "first", memberIds: ["m1", "m2"], confidence: 0.5 },
        { clusterId: cid, summaryContent: "second", memberIds: ["m1", "m3"], confidence: 0.5 },
      ],
    });
    const out = parseReflectionProposals(raw, clusters, cluster3);
    expect(out).toHaveLength(1);
    expect(out[0]!.summaryContent).toBe("first");
  });

  it("returns [] when the model answers valid JSON without a proposals array", () => {
    expect(parseReflectionProposals('{"ok":true}', clusters, cluster3)).toEqual([]);
  });
});

describe("proposeReflections", () => {
  it("never touches the model when nothing clusters", () => {
    const runPrompt = vi.fn();
    return proposeReflections([mem("a", "one"), mem("b", "two")], runPrompt).then((r) => {
      expect(runPrompt).not.toHaveBeenCalled();
      expect(r.proposals).toEqual([]);
      expect(r.clusterCount).toBe(0);
    });
  });

  it("proposes nothing when no model is reachable — silence beats a fabricated summary", async () => {
    const r = await proposeReflections(cluster3, null);
    expect(r.llmUnavailable).toBe(true);
    expect(r.engine).toBe("none");
    expect(r.proposals).toEqual([]);
    expect(r.clusterCount).toBe(1);
  });

  it("degrades to no proposals when the model throws or answers prose", async () => {
    const thrown = await proposeReflections(cluster3, () => Promise.reject(new Error("ENOENT")));
    expect(thrown.proposals).toEqual([]);
    expect(thrown.llmUnavailable).toBe(true);

    const prose = await proposeReflections(cluster3, async () => "Sure! Here are some thoughts.");
    expect(prose.proposals).toEqual([]);
  });

  it("returns validated proposals when the model answers well", async () => {
    const clusters = clusterMemories(cluster3);
    const cid = clusters[0]!.memberIds[0]!;
    const r = await proposeReflections(cluster3, async () =>
      JSON.stringify({
        proposals: [
          { clusterId: cid, summaryContent: "Staging deploys kept failing on a migration lock.", memberIds: ["m1", "m2", "m3"], confidence: 0.6 },
        ],
      }),
    );
    expect(r.engine).toBe("claude-cli");
    expect(r.llmUnavailable).toBe(false);
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]!.memberIds).toEqual(["m1", "m2", "m3"]);
  });

  it("drops an existing summary from the working set before clustering", async () => {
    const withSummary = [...cluster3, mem("s", "staging deploy pipeline migration lock rollup", "summary")];
    const r = await proposeReflections(withSummary, async () => JSON.stringify({ proposals: [] }));
    expect(r.clusterCount).toBe(1);
  });
});
