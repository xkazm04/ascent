// Reflection must stay inside one ownership scope. Similarity says two memories are ABOUT the same
// thing; it says nothing about whether they belong to the same place. The org boundary is enforced by
// every query, but inside an org a memory also has a namespace (the project it belongs to) and a
// visibility (shared with the org, or one author's private scratch). A rollup that unions across those
// either files one project's knowledge under another, or publishes private scratch org-wide and then
// supersedes the private original.
//
// Every fixture in reflection.test.ts omits namespace and visibility, so the crossing was
// unrepresentable there. These cases carry both.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetPrisma } = vi.hoisted(() => ({ mockGetPrisma: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getPrisma: mockGetPrisma, isDbConfigured: () => true }));

import { clusterMemories, type ReflectionCandidate } from "@/lib/memory/reflection";
import { applyReflection } from "@/lib/db/org-memory-lifecycle";

type Scope = { namespace?: string; visibility?: string; createdBy?: string | null };

const TEXTS = [
  "deploy pipeline failed on staging because the migration lock timed out",
  "deploy pipeline failed again on staging, migration lock timed out once more",
  "staging deploy pipeline migration lock timed out and failed the release",
];

const cand = (id: string, text: string, scope: Scope): ReflectionCandidate =>
  ({ id, content: text, kind: "episodic", confidence: 0.8, ...scope }) as ReflectionCandidate;

const crossesScope = (clusterIds: string[], byId: Map<string, Scope>) => {
  const keys = new Set(
    clusterIds.map((id) => {
      const s = byId.get(id)!;
      const vis = s.visibility ?? "shared";
      return `${s.namespace ?? ""}|${vis}|${vis === "private" ? (s.createdBy ?? "") : ""}`;
    }),
  );
  return keys.size > 1;
};

function run(scopes: Scope[]) {
  const items = scopes.map((s, i) => cand(`m${i + 1}`, TEXTS[i % 3]!, s));
  const byId = new Map(items.map((m, i) => [m.id, scopes[i]!]));
  const clusters = clusterMemories(items);
  return { clusters, crossing: clusters.filter((c) => crossesScope(c.memberIds, byId)).length };
}

describe("clusterMemories stays inside one ownership scope", () => {
  it("PC1 (positive control): three same-scope restatements still form one family", () => {
    const { clusters, crossing } = run([
      { namespace: "acme/api", visibility: "shared" },
      { namespace: "acme/api", visibility: "shared" },
      { namespace: "acme/api", visibility: "shared" },
    ]);
    expect(clusters).toHaveLength(1);
    expect(crossing).toBe(0);
  });

  it("S1: does not union memories from two namespaces", () => {
    const { crossing } = run([
      { namespace: "acme/api", visibility: "shared" },
      { namespace: "acme/api", visibility: "shared" },
      { namespace: "acme/web", visibility: "shared" },
    ]);
    expect(crossing).toBe(0);
  });

  it("S2: does not fold a private scratch note into a shared family", () => {
    const { crossing } = run([
      { namespace: "acme/api", visibility: "shared" },
      { namespace: "acme/api", visibility: "shared" },
      { namespace: "acme/api", visibility: "private", createdBy: "alice" },
    ]);
    expect(crossing).toBe(0);
  });

  it("S3: does not union two authors' private scratch", () => {
    const { crossing } = run([
      { namespace: "acme/api", visibility: "private", createdBy: "alice" },
      { namespace: "acme/api", visibility: "private", createdBy: "alice" },
      { namespace: "acme/api", visibility: "private", createdBy: "bob" },
    ]);
    expect(crossing).toBe(0);
  });
});

// ── The apply door ─────────────────────────────────────────────────────────────────────────────

type Row = { id: string; orgId: string; version: number; namespace: string | null; visibility: string; createdBy: string | null };

function fakePrisma(rows: Row[]) {
  const calls = { create: [] as Record<string, unknown>[], updateMany: [] as unknown[] };
  const matches = (r: Row, where: Record<string, unknown>): boolean => {
    const idIn = (where.id as { in?: string[] } | undefined)?.in;
    if (idIn && !idIn.includes(r.id)) return false;
    if (where.orgId && where.orgId !== r.orgId) return false;
    if (Array.isArray(where.OR) && !where.OR.some((w) => matches(r, w as Record<string, unknown>))) return false;
    if (Array.isArray(where.AND) && !where.AND.every((w) => matches(r, w as Record<string, unknown>))) return false;
    if (typeof where.visibility === "string" && where.visibility !== r.visibility) return false;
    if (typeof where.createdBy === "string" && where.createdBy !== r.createdBy) return false;
    return true;
  };
  const orgMemory = {
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => matches(r, where))),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      calls.create.push(data);
      return { id: "mem_sum" };
    }),
    updateMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
      calls.updateMany.push(args);
      return { count: rows.filter((r) => matches(r, args.where)).length };
    }),
  };
  const prisma = {
    organization: { findUnique: vi.fn(async () => ({ id: "org_acme" })) },
    orgMemory,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ orgMemory })),
  };
  return { prisma, calls };
}

const row = (id: string, s: Partial<Row>): Row => ({
  id,
  orgId: "org_acme",
  version: 1,
  namespace: "acme/api",
  visibility: "shared",
  createdBy: "carol",
  ...s,
});

beforeEach(() => vi.clearAllMocks());

describe("applyReflection refuses a rollup that crosses ownership scope", () => {
  it("PC2 (positive control): a same-scope rollup still writes and supersedes", async () => {
    const { prisma, calls } = fakePrisma([row("a", {}), row("b", {}), row("c", {})]);
    mockGetPrisma.mockReturnValue(prisma);
    const out = await applyReflection(
      "acme",
      { summaryContent: "rollup", memberIds: ["a", "b", "c"], confidence: 0.7, namespace: "acme/api" },
      "carol",
    );
    expect(out).toEqual({ id: "mem_sum", superseded: 3 });
    expect(calls.create[0]).toMatchObject({ namespace: "acme/api", visibility: "shared" });
  });

  it("D1: members from two namespaces write nothing", async () => {
    const { prisma, calls } = fakePrisma([row("a", {}), row("b", {}), row("c", { namespace: "acme/web" })]);
    mockGetPrisma.mockReturnValue(prisma);
    await applyReflection(
      "acme",
      { summaryContent: "rollup", memberIds: ["a", "b", "c"], confidence: 0.7, namespace: "acme/api" },
      "carol",
    ).catch(() => null);
    expect(calls.create).toHaveLength(0);
  });

  it("D2: a private member never becomes part of a shared rollup", async () => {
    const { prisma, calls } = fakePrisma([
      row("a", {}),
      row("b", {}),
      row("c", { visibility: "private", createdBy: "carol" }),
    ]);
    mockGetPrisma.mockReturnValue(prisma);
    await applyReflection(
      "acme",
      { summaryContent: "rollup", memberIds: ["a", "b", "c"], confidence: 0.7, namespace: "acme/api" },
      "carol",
    ).catch(() => null);
    const published = calls.create.filter((d) => d.visibility === "shared");
    expect(published).toHaveLength(0);
  });

  it("D3: one author cannot supersede another author's private scratch by id", async () => {
    const { prisma, calls } = fakePrisma([
      row("a", { visibility: "private", createdBy: "alice" }),
      row("b", { visibility: "private", createdBy: "alice" }),
      row("c", { visibility: "private", createdBy: "alice" }),
    ]);
    mockGetPrisma.mockReturnValue(prisma);
    await applyReflection(
      "acme",
      { summaryContent: "rollup", memberIds: ["a", "b", "c"], confidence: 0.7, namespace: "acme/api" },
      "mallory",
    ).catch(() => null);
    expect(calls.create).toHaveLength(0);
  });

  it("PC3 (positive control): an author may roll up their own private scratch, and it stays private", async () => {
    const { prisma, calls } = fakePrisma([
      row("a", { visibility: "private", createdBy: "alice" }),
      row("b", { visibility: "private", createdBy: "alice" }),
      row("c", { visibility: "private", createdBy: "alice" }),
    ]);
    mockGetPrisma.mockReturnValue(prisma);
    await applyReflection(
      "acme",
      { summaryContent: "rollup", memberIds: ["a", "b", "c"], confidence: 0.7, namespace: "acme/api" },
      "alice",
    ).catch(() => null);
    expect(calls.create).toHaveLength(1);
    expect(calls.create[0]).toMatchObject({ visibility: "private", createdBy: "alice" });
  });
});
