// The db half of "each lifecycle pass loads its own population" (challenge-2026-09-23b, org-memory#A).
//
// FAILS BEFORE: org-memory-population.ts did not exist, and the one loader every pass shared
// (lifecycleWorkingSet) ordered by updatedAt desc and took 400. On a store that machine feeds keep
// fresh, that cut drops exactly the rows with the longest half-lives (a 120-day-old runbook) before
// the value model scores anything, and it hides every forget-eligible row (> 60 days old) from the
// forget pass by construction.
//
// The fake below EVALUATES the Prisma `where` subset these loaders emit (AND/OR, equality, in/notIn,
// lt/lte/gt, insensitive contains) over an in-memory store, so each assertion is about which rows a
// query would really return, not about the literal shape of the query.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetPrisma } = vi.hoisted(() => ({ mockGetPrisma: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getPrisma: mockGetPrisma, isDbConfigured: () => true }));

import { decayPopulation, recallPopulation } from "@/lib/db/org-memory-population";
import { lifecycleWorkingSet } from "@/lib/db/org-memory-lifecycle";

type Row = Record<string, unknown> & { id: string; updatedAt: Date };
type Cond = Record<string, unknown>;

const NOW = Date.parse("2026-09-01T00:00:00.000Z");
const ago = (days: number) => new Date(NOW - days * 86_400_000);

function matches(row: Row, where: Cond): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === "AND") return (cond as Cond[]).every((w) => matches(row, w));
    if (key === "OR") return (cond as Cond[]).some((w) => matches(row, w));
    const v = row[key] as never;
    if (cond === null || typeof cond !== "object" || cond instanceof Date) return v === cond;
    const c = cond as Record<string, unknown>;
    if ("in" in c && !(c.in as unknown[]).includes(v)) return false;
    if ("notIn" in c && (c.notIn as unknown[]).includes(v)) return false;
    if ("lt" in c && !(v != null && v < (c.lt as never))) return false;
    if ("lte" in c && !(v != null && v <= (c.lte as never))) return false;
    if ("gt" in c && !(v != null && v > (c.gt as never))) return false;
    if ("contains" in c) {
      const hay = String(v ?? "");
      const needle = String(c.contains);
      return c.mode === "insensitive" ? hay.toLowerCase().includes(needle.toLowerCase()) : hay.includes(needle);
    }
    return true;
  });
}

function fakeStore(rows: Row[]) {
  const sortBy = (list: Row[], orderBy: unknown) => {
    const order = (Array.isArray(orderBy) ? orderBy[0] : orderBy) as { updatedAt?: "asc" | "desc" } | undefined;
    const dir = order?.updatedAt === "asc" ? 1 : -1;
    return [...list].sort((a, b) => dir * (a.updatedAt.getTime() - b.updatedAt.getTime()));
  };
  const orgMemory = {
    groupBy: vi.fn(async ({ where }: { where: Cond }) => {
      const counts = new Map<string, number>();
      for (const r of rows.filter((x) => matches(x, where))) {
        counts.set(r.kind as string, (counts.get(r.kind as string) ?? 0) + 1);
      }
      return [...counts].map(([kind, n]) => ({ kind, _count: { _all: n } }));
    }),
    findMany: vi.fn(async ({ where, orderBy, take }: { where: Cond; orderBy?: unknown; take?: number }) =>
      sortBy(rows.filter((r) => matches(r, where)), orderBy).slice(0, take ?? rows.length),
    ),
  };
  return {
    organization: { findUnique: vi.fn(async ({ where }: { where: { slug: string } }) => (where.slug === "acme" ? { id: "org_acme" } : null)) },
    orgMemory,
  };
}

let seq = 0;
const mem = (over: Partial<Row> & { updatedAt: Date }): Row => ({
  id: `m${++seq}`,
  orgId: "org_acme",
  namespace: null,
  content: `scan episode ${seq}`,
  kind: "episodic",
  visibility: "shared",
  source: null,
  confidence: 1,
  tags: "[]",
  supersededBy: null,
  version: 1,
  archived: false,
  accessCount: 0,
  citedCount: 0,
  notUsefulCount: 0,
  expiresAt: null,
  origin: "hosted",
  registryPath: null,
  createdBy: null,
  createdAt: over.updatedAt,
  ...over,
});

/** `n` shared episodic rows updated between 1 and 10 days ago: what scan-feed and the mirror produce. */
const freshEpisodes = (n: number) => Array.from({ length: n }, (_, i) => mem({ updatedAt: ago(1 + (9 * i) / n) }));

beforeEach(() => {
  seq = 0;
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
});
afterEach(() => vi.useRealTimers());

describe("recallPopulation: per-kind lanes, not the newest 400", () => {
  it("keeps a 120-day-old procedural row that 450 fresh episodes would push out of the recency cut", async () => {
    const runbook = mem({ id: "runbook", kind: "procedural", confidence: 1, updatedAt: ago(120) });
    mockGetPrisma.mockReturnValue(fakeStore([...freshEpisodes(450), runbook]));

    const { rows, notConsidered } = await recallPopulation("acme", {});
    expect(rows.map((r) => r.id)).toContain("runbook");
    expect(rows).toHaveLength(400);
    expect(notConsidered).toBe(51);

    // The contrast this card exists for: the recency cut drops it before scoring starts.
    const working = await lifecycleWorkingSet("acme");
    expect(working.map((r) => r.id)).not.toContain("runbook");
  });

  it("filters by query terms BEFORE the cap, so an old answer is not reported as an absence", async () => {
    const flaky = mem({ id: "flaky", kind: "semantic", content: "The e2e suite is Flaky on Windows runners", updatedAt: ago(90) });
    mockGetPrisma.mockReturnValue(fakeStore([...freshEpisodes(420), flaky]));

    const { rows, notConsidered } = await recallPopulation("acme", { terms: ["flaky"] });
    expect(rows.map((r) => r.id)).toEqual(["flaky"]);
    expect(notConsidered).toBe(0);
  });

  it("matches a term in the tags as well as the content", async () => {
    const tagged = mem({ id: "tagged", content: "retry the job", tags: JSON.stringify(["ci", "flaky"]), updatedAt: ago(3) });
    mockGetPrisma.mockReturnValue(fakeStore([mem({ updatedAt: ago(1) }), tagged]));
    expect((await recallPopulation("acme", { terms: ["flaky"] })).rows.map((r) => r.id)).toEqual(["tagged"]);
  });

  it("keeps the read rules: archived, superseded, expired and another author's private rows stay out", async () => {
    mockGetPrisma.mockReturnValue(
      fakeStore([
        mem({ id: "ok", updatedAt: ago(1) }),
        mem({ id: "archived", archived: true, updatedAt: ago(1) }),
        mem({ id: "superseded", supersededBy: "ok", updatedAt: ago(1) }),
        mem({ id: "expired", expiresAt: ago(0.5), updatedAt: ago(1) }),
        mem({ id: "mine", visibility: "private", createdBy: "alice", updatedAt: ago(1) }),
        mem({ id: "theirs", visibility: "private", createdBy: "bob", updatedAt: ago(1) }),
        mem({ id: "other-org", orgId: "org_other", updatedAt: ago(1) }),
      ]),
    );
    expect((await recallPopulation("acme", {}, "alice")).rows.map((r) => r.id).sort()).toEqual(["mine", "ok"]);
    expect((await recallPopulation("acme", {}, null)).rows.map((r) => r.id)).toEqual(["ok"]);
  });

  it("honors the namespace and kinds filters inside every lane", async () => {
    mockGetPrisma.mockReturnValue(
      fakeStore([
        mem({ id: "api-ep", namespace: "acme/api", updatedAt: ago(1) }),
        mem({ id: "api-proc", namespace: "acme/api", kind: "procedural", updatedAt: ago(2) }),
        mem({ id: "web-proc", namespace: "acme/web", kind: "procedural", updatedAt: ago(2) }),
      ]),
    );
    const { rows } = await recallPopulation("acme", { namespace: " acme/api ", kinds: ["procedural"] });
    expect(rows.map((r) => r.id)).toEqual(["api-proc"]);
  });

  it("guard: a store under the cap loads exactly what lifecycleWorkingSet loads, in the same order", async () => {
    const store = [
      ...freshEpisodes(30),
      mem({ id: "old-proc", kind: "procedural", updatedAt: ago(200) }),
      mem({ id: "fact", kind: "semantic", updatedAt: ago(4.5) }),
      mem({ id: "rollup", kind: "summary", updatedAt: ago(11) }),
    ];
    mockGetPrisma.mockReturnValue(fakeStore(store));
    const population = await recallPopulation("acme", {}, "alice");
    const working = await lifecycleWorkingSet("acme", {}, "alice");
    expect(population.rows).toEqual(working);
    expect(population.notConsidered).toBe(0);
  });

  it("answers an unknown org with an empty population", async () => {
    mockGetPrisma.mockReturnValue(fakeStore([mem({ updatedAt: ago(1) })]));
    expect(await recallPopulation("ghost", {})).toEqual({ rows: [], notConsidered: 0 });
  });
});

describe("decayPopulation: forget's own tail, oldest first", () => {
  it("reaches a decay-eligible row that 400 fresh rows would hide from the newest-400 cut", async () => {
    const stale = mem({ id: "stale", confidence: 0.3, notUsefulCount: 2, updatedAt: ago(200) });
    mockGetPrisma.mockReturnValue(fakeStore([...freshEpisodes(400), stale]));
    expect((await decayPopulation("acme", {}, null, NOW)).map((r) => r.id)).toEqual(["stale"]);
    expect((await lifecycleWorkingSet("acme")).map((r) => r.id)).not.toContain("stale");
  });

  it("loads only rows the forget conjunction could act on, oldest first, within the viewer's scope", async () => {
    mockGetPrisma.mockReturnValue(
      fakeStore([
        mem({ id: "old-low", confidence: 0.3, updatedAt: ago(90) }),
        mem({ id: "older-low", confidence: 0.2, updatedAt: ago(300) }),
        mem({ id: "young-low", confidence: 0.3, updatedAt: ago(30) }),
        mem({ id: "old-high", confidence: 0.6, updatedAt: ago(300) }),
        mem({ id: "old-runbook", kind: "procedural", confidence: 0.1, updatedAt: ago(300) }),
        mem({ id: "old-private", visibility: "private", createdBy: "bob", confidence: 0.1, updatedAt: ago(300) }),
        mem({ id: "other-ns", namespace: "acme/web", confidence: 0.1, updatedAt: ago(300) }),
      ]),
    );
    const ids = (await decayPopulation("acme", {}, "alice", NOW)).map((r) => r.id);
    expect(ids).toEqual(["older-low", "other-ns", "old-low"]);
    expect((await decayPopulation("acme", { namespace: "acme/web" }, "alice", NOW)).map((r) => r.id)).toEqual(["other-ns"]);
  });
});
