// ATHENA'S RECALL IS THE MCP DOOR'S RECALL - same population, same packer, same answer.
//
// Athena used to keep a private recall_org_memory that loaded the newest 60 rows and filtered by the
// query afterwards: the false absence the MCP door fixed in 47d10a70 ("filters by query terms before
// the population cap"), fixed at one door only. These cases run the REAL runTool over one fake store
// whose loaders carry their real population rules, and ask both doors the same question.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Mem = { id: string; kind: string; namespace: string | null; content: string; tags: string[]; source: string; confidence: number; accessCount: number; citedCount: number; notUsefulCount: number; updatedAt: string };
let memories: Mem[] = [];
const bumped: string[][] = [];
const CAP = 400;
const newest = (rows: Mem[]) => [...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

vi.mock("@/lib/db", () => ({
  // The population with the query terms in its WHERE, then the cap (org-memory-population.ts).
  recallPopulation: vi.fn(async (_org: string, opts: { terms?: string[] }) => {
    const terms = opts.terms ?? [];
    const hit = memories.filter((m) => !terms.length || terms.some((t) => `${m.content} ${m.tags.join(" ")}`.toLowerCase().includes(t)));
    return { rows: newest(hit).slice(0, CAP), notConsidered: Math.max(0, hit.length - CAP) };
  }),
  bumpMemoryAccessCounts: vi.fn(async (_org: string, ids: string[]) => {
    bumped.push(ids);
    return ids.length;
  }),
}));

const { runTool } = await import("@/lib/mcp/handlers");
const { bumpMemoryAccessCounts } = await import("@/lib/db");
const { ATHENA_MEMORY_TOOL, createAthenaGrounding } = await import("@/lib/athena/grounding");
const { UNTRUSTED_OPEN, UNTRUSTED_CLOSE } = await import("@/lib/llm/untrusted");

const memory = (id: string, content: string, ageMin: number): Mem => ({
  id,
  kind: "semantic",
  namespace: null,
  content,
  tags: [],
  source: "human",
  confidence: 0.8,
  accessCount: 0,
  citedCount: 0,
  notUsefulCount: 0,
  updatedAt: new Date(Date.parse("2026-09-10T00:00:00.000Z") - ageMin * 60_000).toISOString(),
});

async function athena() {
  // Built as a variable, not a literal: the pre-change door also took a `loadWorkingSet` (the newest
  // 60, as lifecycleWorkingSet served it), which is how the red-before state was reproduced.
  const d = {
    canReadOrg: async () => true,
    memoryAllowed: async () => true,
    runTool,
    loadWorkingSet: async () => newest(memories).slice(0, 60),
  };
  return (await createAthenaGrounding("acme", d))!;
}

const unfence = (text: string): unknown => {
  expect(text.startsWith(`${UNTRUSTED_OPEN}\n`)).toBe(true);
  expect(text.endsWith(`\n${UNTRUSTED_CLOSE}`)).toBe(true);
  return JSON.parse(text.slice(UNTRUSTED_OPEN.length + 1, -(UNTRUSTED_CLOSE.length + 1)));
};

beforeEach(() => {
  memories = [];
  bumped.length = 0;
  vi.mocked(bumpMemoryAccessCounts).mockClear();
});

describe("Athena recall goes through the MCP door's recall", () => {
  it("finds the only matching memory even when it is the oldest of 61", async () => {
    memories = [
      ...Array.from({ length: 60 }, (_, i) => memory(`scan${i}`, `Overall moved on acme/api scan ${i}`, i)),
      memory("zebra", "The zebra rollout is gated on the canary.", 10_000),
    ];
    const out = unfence(await (await athena()).execute({ id: "c", name: ATHENA_MEMORY_TOOL, args: { query: "zebra" } })) as {
      count: number;
      entries: { id: string }[];
    };
    expect(out.count).toBe(1);
    expect(out.entries.map((e) => e.id)).toEqual(["zebra"]);
  });

  it("reports notConsideredCount when the matching population exceeds the recall cap", async () => {
    memories = Array.from({ length: CAP + 5 }, (_, i) => memory(`m${i}`, `postgres note ${i}`, i));
    const out = unfence(await (await athena()).execute({ id: "c", name: ATHENA_MEMORY_TOOL, args: { query: "postgres" } })) as {
      notConsideredCount?: number;
    };
    expect(out.notConsideredCount).toBeGreaterThan(0);
  });

  it("answers with the same structuredContent as the MCP door, apart from the fence", async () => {
    memories = [
      memory("a", "We chose postgres for the ledger.", 1),
      { ...memory("b", "Postgres replicas live in eu-west.", 2), namespace: "acme/api", tags: ["db"] },
      memory("c", "Unrelated note about release trains.", 3),
    ];
    const door = await runTool(ATHENA_MEMORY_TOOL, "acme", { query: "postgres" }, undefined, { countDeliveries: false });
    const text = await (await athena()).execute({ id: "c", name: ATHENA_MEMORY_TOOL, args: { query: "postgres" } });
    expect(unfence(text)).toEqual(door.structuredContent);
  });

  // guard (green before): Athena is a companion side-read and never counts as a delivery; the MCP
  // door counts exactly what it delivered.
  it("does not bump access counts for Athena, and bumps once with the delivered ids for the door", async () => {
    memories = [memory("a", "We chose postgres for the ledger.", 1)];
    await (await athena()).execute({ id: "c", name: ATHENA_MEMORY_TOOL, args: { query: "postgres" } });
    expect(bumpMemoryAccessCounts).not.toHaveBeenCalled();
    await runTool(ATHENA_MEMORY_TOOL, "acme", { query: "postgres" });
    expect(bumpMemoryAccessCounts).toHaveBeenCalledTimes(1);
    expect(bumped).toEqual([["a"]]);
  });
});
