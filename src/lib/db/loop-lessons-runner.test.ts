// THE RUNNER KEEPS ITS VERIFIED LESSONS (spark theater-upgrade, operator Q10) — through the same memory
// door a human keep uses, never half-written, never over a duplicate, and revocable by the operator.
//
// The Prisma client is a small in-memory fake that honours the where-shapes these functions send
// (equality, `{ not: null }`, `{ in }`, `{ gte }`, `OR`), so a test that says "another org's id is not
// found" is about the org actually riding in the query, not about a mock that was told the answer. The
// memory door itself (`createOrgMemory`, `archiveOrgMemories`) is mocked at its module boundary — it
// has its own suite — and the consolidation core is the REAL one, so the duplicate hold is measured.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  candidates: [] as Row[],
  memories: [] as Row[],
  audits: [] as { action: string; meta: Row }[],
  fail: { memory: false, settle: false, read: false, archive: false },
  seq: 0,
}));

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === "OR") return (cond as Row[]).some((w) => matches(row, w));
    const v = row[k];
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as { not?: unknown; in?: unknown[]; gte?: Date };
      if ("not" in c) return v !== c.not;
      if (c.in) return c.in.includes(v);
      if (c.gte) return v instanceof Date && v >= c.gte;
    }
    return v === cond;
  });
}

const prisma = vi.hoisted(() => ({
  orgMemoryCandidate: {
    create: async ({ data }: { data: Row }) => {
      const row = { id: `c${++h.seq}`, reviewedBy: null, reviewedAt: null, promotedMemoryId: null, createdAt: new Date(), ...data };
      h.candidates.push(row);
      return row;
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      if (h.fail.settle) throw new Error("settle down");
      const hit = h.candidates.filter((c) => matches(c, where));
      for (const c of hit) Object.assign(c, data);
      return { count: hit.length };
    },
    findFirst: async ({ where }: { where: Row }) => h.candidates.find((c) => matches(c, where)) ?? null,
    findMany: async ({ where }: { where: Row }) => h.candidates.filter((c) => matches(c, where)),
  },
  orgMemory: {
    findMany: async ({ where }: { where: Row }) => h.memories.filter((m) => matches(m, where)),
    findFirst: async ({ where }: { where: Row }) => h.memories.find((m) => matches(m, where)) ?? null,
  },
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  getPrisma: () => prisma,
  dbReadSafe: async <T,>(fn: () => Promise<T>, fallback: T) => fn().catch(() => fallback),
}));
vi.mock("@/lib/db/org-shared", () => ({
  getOrgBySlug: async (slug: string) => ({ acme: { id: "org-acme" }, other: { id: "org-other" } })[slug] ?? null,
}));
const createOrgMemory = vi.hoisted(() =>
  vi.fn(async (org: string, input: Row, createdBy: string | null) => {
    if (h.fail.memory) throw new Error("no memory");
    const row = { id: `m${++h.seq}`, orgId: `org-${org}`, createdBy, createdAt: new Date(), archived: false, ...input, namespace: input.namespace ?? null };
    h.memories.push(row);
    return { id: row.id };
  }),
);
const candidateOrgMemories = vi.hoisted(() =>
  vi.fn(async (org: string, opts: { namespace?: string }) => {
    if (h.fail.read) throw new Error("no read");
    return h.memories.filter((m) => m.orgId === `org-${org}` && !m.archived && m.namespace === (opts.namespace ?? null));
  }),
);
vi.mock("@/lib/db/org-memory", () => ({ createOrgMemory, candidateOrgMemories }));
vi.mock("@/lib/db/org-memory-lifecycle", () => ({
  archiveOrgMemories: vi.fn(async (org: string, ids: string[]) => {
    if (h.fail.archive) throw new Error("no archive");
    const hit = h.memories.filter((m) => m.orgId === `org-${org}` && ids.includes(m.id as string) && !m.archived);
    for (const m of hit) m.archived = true;
    return hit.length;
  }),
}));
vi.mock("@/lib/db/scans-audit", () => ({ recordAudit: vi.fn(async (action: string, meta: Row) => void h.audits.push({ action, meta })) }));

import { recordLoopLessons } from "@/lib/db/loop-lessons";
import { RUNNER_KEEPER, RUNNER_KEPT_TAG, listRunnerKeptLessons, revokeRunnerKeptLesson } from "@/lib/db/loop-lessons-runner";

const LESSON_A = "The payments package mocks its HTTP client in tests; stub fetch at the module boundary.";
const LESSON_B = "Run prisma generate before typecheck in this repository or the client types are missing.";

beforeEach(() => {
  h.candidates.length = 0;
  h.memories.length = 0;
  h.audits.length = 0;
  h.fail = { memory: false, settle: false, read: false, archive: false };
  createOrgMemory.mockClear();
  candidateOrgMemories.mockClear();
});

describe("recordLoopLessons — autoKeep off is unchanged", () => {
  it("records pending candidates and touches memory not at all, with the option absent or false", async () => {
    const a = await recordLoopLessons("acme", "acme/api", "lane-1", [LESSON_A]);
    const b = await recordLoopLessons("acme", "acme/api", "lane-1", [LESSON_B], { autoKeep: false });
    expect([...a, ...b].map((r) => r.status)).toEqual(["pending", "pending"]);
    expect(createOrgMemory).not.toHaveBeenCalled();
    expect(candidateOrgMemories).not.toHaveBeenCalled();
    expect(h.audits).toEqual([]);
  });
});

describe("recordLoopLessons — autoKeep on a verified runner lane", () => {
  it("keeps each lesson through the memory door, stamped as the runner's, and settles its candidate", async () => {
    const rows = await recordLoopLessons("acme", "acme/api", "lane-1", [LESSON_A, LESSON_B], { autoKeep: true });
    expect(rows.map((r) => r.status)).toEqual(["kept", "kept"]);
    expect(createOrgMemory).toHaveBeenCalledTimes(2);
    expect(createOrgMemory.mock.calls[0]).toEqual([
      "acme",
      { content: LESSON_A, kind: "procedural", namespace: "acme/api", source: "loop-lesson", tags: [RUNNER_KEPT_TAG], confidence: 0.6 },
      RUNNER_KEEPER,
    ]);
    // The candidate is recorded FIRST (exactly as today), then settled — never skipped.
    expect(h.candidates.map((c) => [c.status, c.reviewedBy, c.promotedMemoryId])).toEqual([
      ["kept", RUNNER_KEEPER, rows[0]!.promotedMemoryId],
      ["kept", RUNNER_KEEPER, rows[1]!.promotedMemoryId],
    ]);
    expect(h.audits.map((a) => [a.action, a.meta.keptBy])).toEqual([
      ["org_memory.created", RUNNER_KEEPER],
      ["org_memory.created", RUNNER_KEEPER],
    ]);
  });

  it("a promotion that fails leaves the candidate PENDING — never lost", async () => {
    h.fail.memory = true;
    const rows = await recordLoopLessons("acme", "acme/api", "lane-1", [LESSON_A], { autoKeep: true });
    expect(rows[0]!.status).toBe("pending");
    expect(h.candidates[0]!.status).toBe("pending");
    expect(h.audits).toEqual([]);
  });

  it("a settle that fails takes the new memory back out — never half-written", async () => {
    h.fail.settle = true;
    const rows = await recordLoopLessons("acme", "acme/api", "lane-1", [LESSON_A], { autoKeep: true });
    expect(rows[0]!.status).toBe("pending");
    expect(h.memories).toHaveLength(1);
    expect(h.memories[0]!.archived).toBe(true);
    expect(h.candidates[0]!.status).toBe("pending");
  });

  it("holds a DUPLICATE for a human — of a live memory, and of a sibling lesson from the same lane", async () => {
    await createOrgMemory("acme", { content: LESSON_A, kind: "procedural", namespace: "acme/api" }, "kazimi66");
    const rows = await recordLoopLessons("acme", "acme/api", "lane-2", [LESSON_A, LESSON_B, LESSON_B], { autoKeep: true });
    expect(rows.map((r) => r.status)).toEqual(["pending", "kept", "pending"]);
    expect(h.memories).toHaveLength(2); // the human's, and LESSON_B once
  });

  it("an unreadable comparison set means no keep", async () => {
    h.fail.read = true;
    const rows = await recordLoopLessons("acme", "acme/api", "lane-1", [LESSON_A], { autoKeep: true });
    expect(rows[0]!.status).toBe("pending");
    expect(createOrgMemory).not.toHaveBeenCalled();
  });
});

describe("listRunnerKeptLessons + revokeRunnerKeptLesson", () => {
  async function seed() {
    await recordLoopLessons("acme", "acme/api", "lane-1", [LESSON_A, LESSON_B], { autoKeep: true });
    const human = await recordLoopLessons("acme", "acme/api", "lane-1", ["We pin third-party actions by sha."]);
    const hm = await createOrgMemory("acme", { content: "We pin third-party actions by sha.", namespace: "acme/api" }, "kazimi66");
    Object.assign(h.candidates.find((c) => c.id === human[0]!.id)!, { status: "kept", reviewedBy: "kazimi66", reviewedAt: new Date(), promotedMemoryId: hm.id });
    await recordLoopLessons("other", "other/web", "lane-9", ["Another org's lesson about its own deploy script."], { autoKeep: true });
    return h.candidates.filter((c) => c.reviewedBy === RUNNER_KEEPER).map((c) => c.id as string);
  }

  it("lists the runner's keeps for THIS org only, with ISO stamps, and never a human keep", async () => {
    const [a, b] = await seed();
    const rows = await listRunnerKeptLessons("acme");
    expect(rows.map((r) => r.id).sort()).toEqual([a, b].sort());
    expect(rows.every((r) => r.state === "kept" && r.repo === "acme/api" && typeof r.keptAt === "string")).toBe(true);
    expect(await listRunnerKeptLessons("acme", { since: new Date(Date.now() + 60_000) })).toEqual([]);
  });

  it("revoke archives the memory and marks the candidate discarded by the owner — then lists it as revoked", async () => {
    const [a] = await seed();
    const out = await revokeRunnerKeptLesson("acme", a!, "kazimi66");
    expect(out).toMatchObject({ ok: true, lesson: { id: a, state: "revoked", revokedBy: "kazimi66" } });
    const cand = h.candidates.find((c) => c.id === a)!;
    expect([cand.status, cand.reviewedBy]).toEqual(["discarded", "kazimi66"]);
    expect(h.memories.find((m) => m.id === cand.promotedMemoryId)!.archived).toBe(true);
    expect((await listRunnerKeptLessons("acme")).find((r) => r.id === a)!.state).toBe("revoked");
    expect(h.audits.at(-1)).toMatchObject({ action: "org_memory.archived", meta: { via: "runner-lesson-revoke" } });
  });

  it("refuses another org's id (not-found), a human keep and a pending lesson (not-runner-kept), and a repeat", async () => {
    const [a] = await seed();
    const foreign = h.candidates.find((c) => c.orgId === "org-other")!.id as string;
    expect(await revokeRunnerKeptLesson("acme", foreign, "kazimi66")).toEqual({ ok: false, reason: "not-found" });
    expect(h.candidates.find((c) => c.id === foreign)!.status).toBe("kept");
    const human = h.candidates.find((c) => c.reviewedBy === "kazimi66")!.id as string;
    expect(await revokeRunnerKeptLesson("acme", human, "kazimi66")).toEqual({ ok: false, reason: "not-runner-kept" });
    const pending = (await recordLoopLessons("acme", "acme/api", "lane-3", ["A fresh lesson nobody decided."]))[0]!.id;
    expect(await revokeRunnerKeptLesson("acme", pending, "kazimi66")).toEqual({ ok: false, reason: "not-runner-kept" });
    await revokeRunnerKeptLesson("acme", a!, "kazimi66");
    expect(await revokeRunnerKeptLesson("acme", a!, "kazimi66")).toEqual({ ok: false, reason: "not-runner-kept" });
  });

  it("an archive that fails changes nothing — the lesson stays kept and a retry is possible", async () => {
    const [a] = await seed();
    h.fail.archive = true;
    expect(await revokeRunnerKeptLesson("acme", a!, "kazimi66")).toEqual({ ok: false, reason: "failed" });
    expect(h.candidates.find((c) => c.id === a)!.status).toBe("kept");
  });
});
