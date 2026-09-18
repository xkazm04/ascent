// THE PROPOSALS LEDGER AND THE GRANTS — plan rows, the held-item keys, the engine's conditional status
// moves, and the direction lifecycle, over a small in-memory Prisma fake that honours the where-shapes
// these modules send (equality, `{ in }`), so "another org's plan is not listed" is about the org id
// actually riding in the query. `$transaction` snapshots and restores, so rollback is measured too.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({ plans: [] as Row[], directions: [] as Row[], seq: 0, failCreate: false }));

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([k, cond]) => {
    const v = row[k];
    if (cond && typeof cond === "object" && !(cond instanceof Date) && "in" in (cond as Row)) return ((cond as { in: unknown[] }).in).includes(v);
    return v === cond;
  });
}
function applyData(row: Row, data: Row): void {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && "increment" in (v as Row)) {
      const inc = (v as { increment: number | bigint }).increment;
      row[k] = typeof inc === "bigint" ? BigInt((row[k] as number | bigint) ?? 0) + inc : (row[k] as number) + inc;
    }
    else row[k] = v;
  }
  row.updatedAt = new Date("2026-09-18T12:00:00Z");
}
const table = (key: "plans" | "directions", defaults: () => Row) => ({
  create: async ({ data }: { data: Row }) => {
    if (h.failCreate) throw new Error("create failed");
    const now = new Date("2026-09-18T10:00:00Z");
    const row = { id: `${key}-${++h.seq}`, createdAt: new Date(now.getTime() + h.seq), updatedAt: now, ...defaults(), ...data };
    h[key].push(row);
    return row;
  },
  findMany: async ({ where, orderBy, take }: { where: Row; orderBy?: { createdAt: "asc" | "desc" }; take?: number }) => {
    const hit = h[key].filter((r) => matches(r, where));
    hit.sort((a, b) => ((a.createdAt as Date).getTime() - (b.createdAt as Date).getTime()) * (orderBy?.createdAt === "desc" ? -1 : 1));
    return take ? hit.slice(0, take) : hit;
  },
  findUnique: async ({ where, select }: { where: { id: string }; select?: Row }) => {
    const row = h[key].find((r) => r.id === where.id);
    if (!row) return null;
    return select && "org" in select ? { org: { slug: String(row.orgId).replace(/^org-/, "") } } : row;
  },
  update: async ({ where, data }: { where: { id: string }; data: Row }) => {
    const row = h[key].find((r) => r.id === where.id);
    if (!row) throw new Error("not found");
    applyData(row, data);
    return row;
  },
  updateMany: async ({ where, data }: { where: Row; data: Row }) => {
    const hit = h[key].filter((r) => matches(r, where));
    for (const r of hit) applyData(r, data);
    return { count: hit.length };
  },
});
const prisma = vi.hoisted(() => ({}) as Record<string, unknown>);
Object.assign(prisma, {
  loopPlan: table("plans", () => ({ directionId: null, heldBranch: null, decidedBy: null, decidedAt: null, decisionNote: null, sessionId: null })),
  loopDirection: table("directions", () => ({ usedCycles: 0, usedMicros: BigInt(0), status: "active", approvedAt: new Date("2026-09-18T10:00:00Z"), endedAt: null, budgetMicros: null })),
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const snap = { plans: structuredClone(h.plans), directions: structuredClone(h.directions) };
    try {
      return await fn(prisma);
    } catch (err) {
      h.plans = snap.plans;
      h.directions = snap.directions;
      throw err;
    }
  },
});

vi.mock("@/lib/db/client", () => ({ isDbConfigured: () => true, getPrisma: () => prisma }));
vi.mock("@/lib/db/loop-tenancy", () => ({ orgIdForSlug: async (slug: string) => (slug === "ghost" ? null : `org-${slug}`) }));

import { getLoopPlanOrgSlug, heldPlanKeys, listApprovedPlans, listLoopPlans } from "./loop-plans";
import { holdExecutingPlan, recordLanePlans, reviseNotesFor, settleExecutingPlan, startDirectedPlan } from "./loop-plans-write";
import { activeFences, chargeDirectionMicros, settleDirection } from "./loop-directions";

const slice = (keys: string[], over: Row = {}) => ({
  plan: null, keys, recIds: keys.map((k) => `rec-${k}`), titles: keys.map((k) => `Title ${k}`), cls: "minor" as const, clsReason: "no-moves" as const, directionId: null, ...over,
});
const record = (over: Partial<Parameters<typeof recordLanePlans>[0]> = {}) =>
  recordLanePlans({ org: "acme", repo: "acme/web", runId: "run", laneId: "lane", sessionId: "s-1", planText: "prose", partition: { source: "directory", modules: ["src/a/"] }, executing: null, parked: null, supersede: [], ...over });
const direction = (over: Row = {}) => (prisma.loopDirection as ReturnType<typeof table>).create({ data: { orgId: "org-acme", repo: "acme/web", title: "t", fenceJson: '["src/lib/"]', checkText: "", budgetCycles: 2, originPlanId: "p", approvedBy: "kaz", ...over } });

beforeEach(() => {
  h.plans = [];
  h.directions = [];
  h.seq = 0;
  h.failCreate = false;
});

describe("recording a lane's plan", () => {
  it("writes the executing and parked slices as two rows, wire-mapped with ISO timestamps", async () => {
    const ids = await record({ executing: slice(["a"]), parked: slice(["b"], { cls: "major", clsReason: "declared-moves" }) });
    const plans = await listLoopPlans("acme");
    expect(plans.map((p) => [p.id, p.status, p.cls, p.itemKeys])).toEqual([
      [ids.parkedId, "pending", "major", ["b"]],
      [ids.executingId, "executing", "minor", ["a"]],
    ]);
    expect(plans[0]).toMatchObject({ recIds: ["rec-b"], itemTitles: ["Title b"], sessionId: "s-1", partition: { source: "directory", modules: ["src/a/"] }, plan: null });
    expect(typeof plans[0]!.createdAt).toBe("string");
  });

  it("holds the keys of pending, revise and approved plans only — never another org's", async () => {
    await record({ executing: slice(["run-now"]), parked: slice(["waits"], { cls: "major" }) });
    await recordLanePlans({ org: "other", repo: "acme/web", runId: "r", laneId: "l", sessionId: "s", planText: "", partition: { source: "directory", modules: [] }, executing: null, parked: slice(["foreign"]), supersede: [] });
    expect([...(await heldPlanKeys("acme", "acme/web"))]).toEqual(["waits"]);
    expect(await listLoopPlans("ghost")).toEqual([]);
  });

  it("supersedes the revise plans it answers, and charges the direction it runs under", async () => {
    const d = await direction({ budgetCycles: 1 });
    const old = await record({ parked: slice(["a"], { cls: "major" }) });
    await (prisma.loopPlan as ReturnType<typeof table>).updateMany({ where: { id: old.parkedId }, data: { status: "revise", decisionNote: "smaller please" } });
    expect(await reviseNotesFor("acme", "acme/web", ["a"])).toEqual([{ id: old.parkedId, intent: "prose", note: "smaller please", decidedBy: null }]);
    await record({ executing: slice(["a"], { cls: "minor-under-direction", directionId: d.id }), supersede: [old.parkedId!] });
    expect(h.plans.find((p) => p.id === old.parkedId)!.status).toBe("superseded");
    // One cycle of a one-cycle budget: the direction is spent and says so.
    expect(h.directions[0]).toMatchObject({ usedCycles: 1, status: "exhausted" });
    expect(await activeFences("acme", "acme/web")).toEqual([]);
  });

  it("is all-or-nothing", async () => {
    h.failCreate = true;
    await expect(record({ executing: slice(["a"]) })).rejects.toThrow();
    expect(h.plans).toEqual([]);
  });
});

describe("the engine's status moves", () => {
  it("settles only an executing plan, and resolves a plan's owning org", async () => {
    const { executingId } = await record({ executing: slice(["a"]) });
    expect(await settleExecutingPlan(executingId!, "landed")).toBe(true);
    expect(await settleExecutingPlan(executingId!, "landed")).toBe(false);
    expect(await getLoopPlanOrgSlug(executingId!)).toBe("acme");
  });

  it("a hold marks the executing plan held and re-asks for the same items as a pending major plan", async () => {
    const { executingId } = await record({ executing: slice(["a", "b"]) });
    const created = await holdExecutingPlan({ planId: executingId!, heldBranch: "ascent/held/x", explanation: "Held — module-created src/z/." });
    expect(h.plans.find((p) => p.id === executingId)).toMatchObject({ status: "held", heldBranch: "ascent/held/x" });
    expect(created).toMatchObject({ status: "pending", cls: "major", clsReason: "undeclared-moves-in-diff", itemKeys: ["a", "b"], itemTitles: ["Title a", "Title b"], heldBranch: "ascent/held/x" });
    expect(created!.planText).toMatch(/^Held — module-created src\/z\/\.\n\n--- the plan the lane executed ---\nprose$/);
  });

  it("starts an approved plan exactly once and charges its direction", async () => {
    const d = await direction();
    const { parkedId } = await record({ parked: slice(["a"], { cls: "major" }) });
    await (prisma.loopPlan as ReturnType<typeof table>).updateMany({ where: { id: parkedId }, data: { status: "approved", directionId: d.id } });
    expect((await listApprovedPlans("acme", "acme/web")).map((p) => p.id)).toEqual([parkedId]);
    expect(await startDirectedPlan(parkedId!, d.id, ["today-a"], ["a"], ["Title a"])).toBe(true);
    expect(await startDirectedPlan(parkedId!, d.id, ["today-a"], ["a"], ["Title a"])).toBe(false);
    expect(h.plans[0]).toMatchObject({ status: "executing", recIdsJson: '["today-a"]', itemTitlesJson: '["Title a"]' });
    expect(h.directions[0]).toMatchObject({ usedCycles: 1, status: "active" });
  });
});

describe("the direction lifecycle", () => {
  async function approvedUnder(dirId: string) {
    const { parkedId } = await record({ parked: slice(["a"], { cls: "major" }) });
    await (prisma.loopPlan as ReturnType<typeof table>).updateMany({ where: { id: parkedId }, data: { status: "approved", directionId: dirId, decidedBy: "kaz" } });
    return parkedId!;
  }

  it("revoke returns its unexecuted approved plans to pending; done supersedes them", async () => {
    const d1 = await direction();
    const p1 = await approvedUnder(d1.id as string);
    expect(await settleDirection(d1.id as string, "revoke")).toMatchObject({ status: "revoked" });
    expect(h.plans.find((p) => p.id === p1)).toMatchObject({ status: "pending", decidedBy: null });
    expect(await settleDirection(d1.id as string, "done")).toBeNull();

    const d2 = await direction();
    const p2 = await approvedUnder(d2.id as string);
    expect(await settleDirection(d2.id as string, "done")).toMatchObject({ status: "done" });
    expect(h.plans.find((p) => p.id === p2)!.status).toBe("superseded");
  });

  it("a metered cost past the money budget exhausts the direction", async () => {
    const d = await direction({ budgetMicros: BigInt(1_000) });
    const p = await approvedUnder(d.id as string);
    await chargeDirectionMicros(d.id as string, 1_200);
    expect(h.directions[0]).toMatchObject({ usedMicros: BigInt(1_200), status: "exhausted" });
    expect(h.plans.find((r) => r.id === p)!.status).toBe("pending");
  });
});
