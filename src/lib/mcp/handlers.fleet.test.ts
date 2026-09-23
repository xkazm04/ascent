// THE FLEET-STANDING TOOLS — what they say when there is something, and what they say when there is
// NOTHING.
//
// These six handlers are projections, so their arithmetic is not the interesting part (it is tested
// where it lives). What is interesting is the sentence each returns for an absence: an agent handed
// `count: 0`, an empty dimension list or a silent "no stance" reads every one of them as "nothing to
// worry about" and proceeds. That is the failure this product's whole surface is arranged to avoid,
// and it is one careless default away in every handler here.

import { beforeEach, describe, expect, it, vi } from "vitest";

const rollup = {
  avgOverall: 61,
  avgAdoption: 58,
  avgRigor: 64,
  repos: [
    {
      fullName: "acme/api",
      latest: {
        level: "L2",
        overall: 62,
        adoption: 58,
        rigor: 66,
        posture: "balanced",
        scannedAt: "2026-09-01T00:00:00.000Z",
        engine: "claude",
        dims: [{ dimId: "D1", score: 40 }],
        protected: true,
        govReadable: true,
        aiGovernedRate: 0.9,
        aiPrSample: 20,
      },
    },
    { fullName: "acme/legacy", latest: null },
  ],
};

let recs: { title: string; repos: string[] }[] | null = [];
let memories: { id: string; kind: string; namespace: string; content: string; tags: string[]; source: string; confidence: number; accessCount: number; citedCount: number; notUsefulCount: number; updatedAt: string }[] = [];
let stance: unknown = null;
const newest = <T extends { updatedAt: string }>(rows: T[]) => [...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
const bumped: string[][] = [];

vi.mock("@/lib/db", () => ({
  getOrgRollup: vi.fn(async () => rollup),
  getOrgRecommendations: vi.fn(async (_org: string, limit: number, _s: unknown, _t: unknown, repo?: string | null) =>
    // The REAL contract this handler now leans on: the repo filter is applied INSIDE, before the cap.
    recs === null ? null : (repo ? recs.filter((r) => r.repos.some((x) => `acme/${x}` === repo)) : recs).slice(0, limit),
  ),
  // The two loaders over ONE fake store, each with its real population rule and the real cap:
  // lifecycleWorkingSet is the newest-400 cut; recallPopulation applies the query terms BEFORE the cap.
  lifecycleWorkingSet: vi.fn(async () => newest(memories).slice(0, 400)),
  recallPopulation: vi.fn(async (_org: string, opts: { terms?: string[] }) => {
    const terms = opts.terms ?? [];
    const hit = memories.filter((m) => !terms.length || terms.some((t) => `${m.content} ${m.tags.join(" ")}`.toLowerCase().includes(t)));
    return { rows: newest(hit).slice(0, 400), notConsidered: Math.max(0, hit.length - 400) };
  }),
  bumpMemoryAccessCounts: vi.fn(async (_org: string, ids: string[]) => {
    bumped.push(ids);
    return ids.length;
  }),
}));
vi.mock("@/lib/db/org-gate", () => ({ getOrgGatePolicy: vi.fn(async () => null) }));
vi.mock("@/lib/db/org-stance", () => ({
  getActiveOrgStance: vi.fn(async () => stance),
  getStanceRepoFacts: vi.fn(async () => []),
}));
vi.mock("@/lib/db/org-admission", () => ({ getRepoAdmission: vi.fn(async () => null) }));

const { runTool } = await import("@/lib/mcp/handlers");
const { recallMemories } = await import("@/lib/memory/recall");
const { lifecycleWorkingSet, recallPopulation } = await import("@/lib/db");

const rec = (title: string, repos: string[], impact = "high") => ({
  title,
  dimId: "D1",
  impact,
  rationale: "",
  explore: [],
  repoCount: repos.length,
  repos,
  leverage: 3.5,
  projectedPoints: 4,
  liftsRepos: 1,
});

beforeEach(() => {
  recs = [];
  memories = [];
  stance = null;
  bumped.length = 0;
  vi.mocked(lifecycleWorkingSet).mockClear();
  vi.mocked(recallPopulation).mockClear();
});

describe("get_repo_standing", () => {
  it("answers one repo with its level, posture and the ENGINE that produced it", async () => {
    const out = (await runTool("get_repo_standing", "acme", { repo: "acme/api" })).structuredContent as Record<string, unknown>;
    expect(out).toMatchObject({ repo: "acme/api", level: "L2", overall: 62, engine: "claude" });
  });

  it("distinguishes NOT IN THE FLEET from IN THE FLEET BUT NEVER SCANNED", async () => {
    const missing = await runTool("get_repo_standing", "acme", { repo: "acme/ghost" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/not in this organization's fleet/);

    const unscanned = await runTool("get_repo_standing", "acme", { repo: "acme/legacy" });
    expect(unscanned.isError).toBe(true);
    // "Never scanned" is not a low score, and an agent must not be able to read it as one.
    expect(unscanned.text).toMatch(/never been scanned/);
  });

  it("counts the fleet's unscanned repos rather than hiding them", async () => {
    const out = (await runTool("get_repo_standing", "acme", {})).structuredContent as Record<string, unknown>;
    expect(out).toMatchObject({ reposScanned: 1, reposTotal: 2 });
  });
});

describe("get_gate_verdict", () => {
  it("evaluates against the org's persisted policy and says the verdict is about the LAST SCAN", async () => {
    const out = (await runTool("get_gate_verdict", "acme", { repo: "acme/api" })).structuredContent as {
      pass: boolean;
      policy: string[];
      basis: string;
    };
    expect(typeof out.pass).toBe("boolean");
    expect(out.policy.length).toBeGreaterThan(0);
    // The sentence an agent needs before it treats a pass as a guarantee about its working tree.
    expect(out.basis).toMatch(/not your working tree/);
  });

  it("refuses an unscanned repo rather than reporting a pass", async () => {
    const res = await runTool("get_gate_verdict", "acme", { repo: "acme/legacy" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/no gate verdict exists yet/);
  });
});

describe("list_open_recommendations", () => {
  it("filters by repo BEFORE the cap, so a repo's own move survives a fleet-wide slice", async () => {
    recs = [rec("Shared gap", ["api", "legacy"]), rec("Api only", ["api"], "low")];
    const out = (await runTool("list_open_recommendations", "acme", { repo: "acme/api", limit: 5 }))
      .structuredContent as { count: number; recommendations: { title: string }[] };
    expect(out.count).toBe(2);
    expect(out.recommendations.map((r) => r.title)).toEqual(["Shared gap", "Api only"]);
  });

  it("excludes a repo the moves do not affect, and NAMES the absence", async () => {
    recs = [rec("Shared gap", ["legacy"])];
    const out = (await runTool("list_open_recommendations", "acme", { repo: "acme/api" })).structuredContent as {
      count: number;
      note?: string;
    };
    expect(out.count).toBe(0);
    // `count: 0` alone reads as "this repository is clean". It is not the same fact as "nothing is
    // recorded against it", and only one of the two is good news.
    expect(out.note).toMatch(/not that the repository is known to be in good shape/);
  });

  it("names the org-wide absence too, and stays silent when there IS something", async () => {
    const empty = (await runTool("list_open_recommendations", "acme", {})).structuredContent as { note?: string };
    expect(empty.note).toMatch(/absence of records/);

    recs = [rec("Shared gap", ["api"])];
    const some = (await runTool("list_open_recommendations", "acme", {})).structuredContent as { note?: string };
    expect(some.note).toBeUndefined();
  });

  it("answers a DB-less install as no data, not as no gaps", async () => {
    recs = null;
    const res = await runTool("list_open_recommendations", "acme", {});
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/No data for organization/);
  });
});

describe("get_ai_stance", () => {
  const published = (over: Record<string, unknown> = {}) => ({
    version: 3,
    stance: {
      permittedTools: ["Claude Code"],
      permittedModels: [],
      noAiZones: [],
      reviewTiers: [],
      provenance: { requireTrailer: true, requireHumanApproval: false },
      ...over,
    },
  });

  it("refuses an unpublished stance in words — absence is not permission", async () => {
    const res = await runTool("get_ai_stance", "acme", {});
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/Absence is not permission/);
  });

  it("returns the org-wide declaration and points at the per-repo narrowing", async () => {
    stance = published();
    const out = (await runTool("get_ai_stance", "acme", {})).structuredContent as { version: number; enforcement: string };
    expect(out.version).toBe(3);
    expect(out.enforcement).toMatch(/Pass `repo`/);
  });

  it("refuses a repo outside the caller's own org — the token's org is the only org", async () => {
    stance = published();
    const res = await runTool("get_ai_stance", "acme", { repo: "other/api" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/is not a repository in acme/);
  });

  it("says NOT ASSESSED, in words, for a repo with no admission row", async () => {
    stance = published();
    const out = (await runTool("get_ai_stance", "acme", { repo: "acme/api" })).structuredContent as {
      admission: { assessed: boolean; tier: null };
      enforcement: string;
    };
    expect(out.admission).toMatchObject({ assessed: false, tier: null });
    expect(out.enforcement).toMatch(/Absence of an assessment is not permission/);
  });
});

describe("get_practice_shape", () => {
  const listed = async () =>
    ((await runTool("get_practice_shape", "acme", {})).structuredContent as { practices: { id: string }[] }).practices;

  it("lists the practice ids when called with no argument", async () => {
    expect((await listed()).length).toBeGreaterThan(0);
  });

  it("returns the reusable SHAPE, and tells an unknown id how to find a real one", async () => {
    const id = (await listed())[0]!.id;
    const out = (await runTool("get_practice_shape", "acme", { practiceId: id })).structuredContent as { shape: unknown };
    expect(out.shape).toBeDefined();

    const bad = await runTool("get_practice_shape", "acme", { practiceId: "nope" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/list the available ids/);
  });
});

describe("recall_org_memory", () => {
  const memory = (id: string, content: string, confidence = 0.8) => ({
    id,
    kind: "semantic",
    namespace: "eng",
    content,
    tags: [] as string[],
    source: "human",
    confidence,
    accessCount: 0,
    citedCount: 0,
    notUsefulCount: 0,
    updatedAt: "2026-09-01T00:00:00.000Z",
  });

  it("returns query matches, packs by the recall value model, and counts the delivery", async () => {
    memories = [memory("m1", "We chose postgres for the ledger"), memory("m2", "Postgres and redis both run in dev", 0.9)];
    const out = (await runTool("recall_org_memory", "acme", { query: "postgres ledger" })).structuredContent as {
      count: number;
      entries: { id: string }[];
    };
    // Term overlap is the filter; ORDERING is confidence × decay × evidence, so the 0.9 row leads.
    expect(out.entries.map((e) => e.id)).toEqual(["m2", "m1"]);
    // A read through this door counts as a DELIVERY. It did not use to, so every memory an agent
    // reached over MCP looked to decay.ts like one nobody had ever asked for.
    expect(bumped).toEqual([["m2", "m1"]]);
    expect(out.count).toBe(2);
  });

  it("uses the REST recall model and counts only entries returned under the budget", async () => {
    memories = [
      memory("uncited", `Postgres ${"a".repeat(140)}`, 0.9),
      { ...memory("cited", `Postgres ${"b".repeat(140)}`, 0.6), citedCount: 4 },
    ];
    const out = (await runTool("recall_org_memory", "acme", { query: "postgres", limit: 1 })).structuredContent as {
      entries: { id: string; citedCount: number }[];
    };
    const restIds = recallMemories(memories, { now: Date.now(), charBudget: 200 }).selected.map((s) => s.memory.id);
    const budgeted = (await runTool("recall_org_memory", "acme", { query: "postgres", charBudget: 200 })).structuredContent as {
      entries: { id: string }[];
    };
    expect(budgeted.entries.map((e) => e.id)).toEqual(restIds);
    expect(out.entries.map((e) => e.id)).toEqual(["cited"]);
    expect(out.entries[0]?.citedCount).toBe(4);
    expect(bumped).toEqual([["cited"], ["cited"]]);
  });

  it("passes a namespace to the shared working set and excludes other namespaces", async () => {
    memories = [memory("eng", "Postgres convention"), { ...memory("api", "Postgres service"), namespace: "api" }];
    const out = (await runTool("recall_org_memory", "acme", { query: "postgres", namespace: "api" })).structuredContent as {
      entries: { id: string }[];
    };
    expect(recallPopulation).toHaveBeenCalledWith("acme", { namespace: "api", terms: ["postgres"] }, null);
    expect(out.entries.map((e) => e.id)).toEqual(["api"]);
  });

  it("answers NO MATCH with the sentence that says it is not an endorsement", async () => {
    memories = [memory("m1", "Unrelated")];
    const out = (await runTool("recall_org_memory", "acme", { query: "kafka" })).structuredContent as {
      count: number;
      note: string;
    };
    expect(out.count).toBe(0);
    expect(out.note).toMatch(/not that the approach is endorsed/);
    // Nothing was delivered, so nothing is counted as delivered.
    expect(bumped).toEqual([]);
  });

  it("finds a stored answer older than the 400 newest rows, instead of reporting a false absence", async () => {
    const fresh = Array.from({ length: 400 }, (_, i) => ({
      ...memory(`scan${i}`, `Overall moved on acme/api scan ${i}`),
      updatedAt: new Date(Date.parse("2026-09-10T00:00:00.000Z") - i * 60_000).toISOString(),
    }));
    memories = [...fresh, { ...memory("flaky", "The e2e suite is flaky on Windows runners"), updatedAt: "2026-06-01T00:00:00.000Z" }];
    const out = (await runTool("recall_org_memory", "acme", { query: "flaky" })).structuredContent as {
      count: number;
      entries: { id: string }[];
      note?: string;
    };
    expect(out.count).toBe(1);
    expect(out.entries.map((e) => e.id)).toEqual(["flaky"]);
    expect(out.note).toBeUndefined();
    // guard: only what was delivered is counted as delivered.
    expect(bumped).toEqual([["flaky"]]);
  });

  it("requires a query rather than dumping the store", async () => {
    const res = await runTool("recall_org_memory", "acme", {});
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/`query` is required/);
  });
});
