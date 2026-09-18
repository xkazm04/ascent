// THE OPERATOR'S VERDICT — what approve / reject / revise each write, and that a failed or raced
// write never leaves a phantom decision behind (the plan stays `pending`, no direction survives).

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  plans: [] as Row[],
  directions: [] as Row[],
  recs: [] as Row[],
  decisions: [] as Row[],
  dismissedRows: [] as string[],
  audits: [] as string[],
  decideFails: false,
}));
const matches = (row: Row, where: Row) =>
  Object.entries(where).every(([k, c]) => (c && typeof c === "object" && "in" in (c as Row) ? (c as { in: unknown[] }).in.includes(row[k]) : row[k] === c));
const prisma = vi.hoisted(() => ({}) as Record<string, unknown>);
Object.assign(prisma, {
  loopPlan: {
    findUnique: async ({ where }: { where: { id: string } }) => h.plans.find((p) => p.id === where.id) ?? null,
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const hit = h.plans.filter((p) => matches(p, where));
      for (const p of hit) Object.assign(p, data, { updatedAt: new Date() });
      return { count: hit.length };
    },
  },
  loopDirection: {
    create: async ({ data }: { data: Row }) => {
      const row = { id: `dir-${h.directions.length + 1}`, usedCycles: 0, usedMicros: 0, status: "active", createdAt: new Date(), updatedAt: new Date(), endedAt: null, ...data };
      h.directions.push(row);
      return row;
    },
  },
  recommendation: { findMany: async ({ where }: { where: Row }) => h.recs.filter((r) => matches(r, where)) },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const snap = { plans: structuredClone(h.plans), directions: structuredClone(h.directions) };
    try {
      return await fn(prisma);
    } catch (err) {
      Object.assign(h, snap);
      throw err;
    }
  },
});

vi.mock("@/lib/db/client", () => ({ isDbConfigured: () => true, getPrisma: () => prisma }));
vi.mock("@/lib/db/org-decisions", () => ({
  ROADMAP_DECISION_MODULE: "roadmap",
  decide: vi.fn(async (org: string, input: Row, by: string | null) => {
    if (h.decideFails) return null;
    h.decisions.push({ org, by, ...input });
    return { id: "d", memoryId: null };
  }),
}));
vi.mock("@/lib/db/scans-audit", () => ({ recordAudit: vi.fn(async (action: string) => (h.audits.push(action), true)) }));
vi.mock("@/lib/db/scans-recommendations", () => ({ updateRecommendation: vi.fn(async (id: string) => (h.dismissedRows.push(id), { id })) }));
vi.mock("@/lib/db/loop-plan-items", () => ({
  openItemsByKey: vi.fn(async () => new Map([["k-live", { id: "today-1", title: "Add retries", dimId: "D3" }]])),
}));

import { BUDGET_USD_MAX, decideLoopPlan, parseDecisionBody } from "./loop-plan-decide";
import { getLoopPlan } from "./loop-plans";
import type { PlanDecisionBody } from "@/lib/local/runner-types";

const T = new Date("2026-09-18T10:00:00Z");
function seedPlan(over: Row = {}): Row {
  const plan = {
    id: "plan-1", orgId: "org-acme", repo: "acme/web", runId: "run", laneId: "lane", directionId: null,
    itemKeysJson: '["k-live","k-old","acme/web::rec:D5:abc123"]', recIdsJson: '["r-live","r-old","r-lost"]',
    itemTitlesJson: '["Add retries, as approved","",""]',
    planJson: JSON.stringify({ v: 1, intent: "Split fetch out of db.", items: [{ recommendationId: "r-live", approach: "x", files: [], moves: [] }], modules: ["src/lib/db/", "src/lib/fetch/"], check: "npm test", risks: [], notDoing: [] }),
    planText: "prose", partitionJson: null, cls: "major", clsReason: "declared-moves", status: "pending", sessionId: null, heldBranch: null,
    decidedBy: null, decidedAt: null, decisionNote: null, createdAt: T, updatedAt: T, ...over,
  };
  h.plans.push(plan);
  return plan;
}
const decideAs = async (body: PlanDecisionBody) => decideLoopPlan({ plan: (await getLoopPlan("plan-1"))!, orgSlug: "acme", body, decidedBy: "kaz" });

beforeEach(() => {
  Object.assign(h, { plans: [], directions: [], recs: [{ id: "r-old", title: "Old wording", dimId: "D2" }], decisions: [], dismissedRows: [], audits: [], decideFails: false });
});

describe("parseDecisionBody", () => {
  it.each<[string, unknown, string | null]>([
    ["an unknown verdict", { decision: "maybe", note: "x" }, "'decision'"],
    ["a reject without a note", { decision: "reject", note: "  " }, "needs a note"],
    ["a revise without a note", { decision: "revise" }, "needs a note"],
    ["an approve without a note", { decision: "approve" }, null],
    ["a fractional cycle budget", { decision: "approve", budgetCycles: 1.5 }, "'budgetCycles'"],
    ["an absurd budget", { decision: "approve", budgetUsd: BUDGET_USD_MAX + 1 }, "'budgetUsd'"],
    ["a non-positive budget", { decision: "approve", budgetUsd: 0 }, "'budgetUsd'"],
    ["a fence that is not a list", { decision: "approve", fence: "src/" }, "'fence'"],
    ["an essay", { decision: "reject", note: "x".repeat(1_001) }, "at most"],
  ])("%s", (_n, raw, error) => {
    const res = parseDecisionBody(raw);
    if (error == null) expect(res.ok).toBe(true);
    else expect(res.ok ? "" : res.error).toContain(error);
  });

  it("normalizes an edited fence and never keeps the root", () => {
    const res = parseDecisionBody({ decision: "approve", fence: ["src\\lib", "/", "src/app/"], budgetCycles: 5, budgetUsd: 2.5 });
    expect(res).toEqual({ ok: true, body: { decision: "approve", note: "", fence: ["src/lib/", "src/app/"], budgetCycles: 5, budgetUsd: 2.5 } });
  });
});

describe("decideLoopPlan", () => {
  it("approve creates a fenced, budgeted direction from the plan and binds the plan to it", async () => {
    seedPlan();
    const res = await decideAs({ decision: "approve", note: "", budgetUsd: 150 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.direction).toMatchObject({ title: "Split fetch out of db.", fence: ["src/lib/db/", "src/lib/fetch/"], checkText: "npm test", budgetCycles: 3, budgetMicros: 15_000_000_000, approvedBy: "kaz", originPlanId: "plan-1" });
    expect(res.plan).toMatchObject({ status: "approved", directionId: res.direction!.id, decidedBy: "kaz", decisionNote: null });
    expect(typeof res.plan.decidedAt).toBe("string");
    expect(h.audits).toEqual(["loop.plan_approved"]);
  });

  it("an approve that loses a race leaves no direction behind and says 409", async () => {
    seedPlan();
    const stale = (await getLoopPlan("plan-1"))!;
    h.plans[0]!.status = "rejected";
    const res = await decideLoopPlan({ plan: stale, orgSlug: "acme", body: { decision: "approve", note: "" }, decidedBy: "kaz" });
    expect(res).toMatchObject({ ok: false, status: 409 });
    expect(h.directions).toEqual([]);
    expect(h.audits).toEqual([]);
  });

  it("reject writes a standing dismissal per item by DURABLE key and dismisses today's open row", async () => {
    seedPlan();
    const res = await decideAs({ decision: "reject", note: "We keep fetch inside db." });
    expect(res).toMatchObject({ ok: true, plan: { status: "rejected", decisionNote: "We keep fetch inside db." } });
    expect(h.decisions.map((d) => [d.itemKey, d.status, d.module, d.title, d.rationale])).toEqual([
      ["k-live", "dismissed", "roadmap", "Add retries, as approved (D3)", "We keep fetch inside db."],
      ["k-old", "dismissed", "roadmap", "Old wording (D2)", "We keep fetch inside db."],
      ["acme/web::rec:D5:abc123", "dismissed", "roadmap", "acme/web::rec:D5:abc123", "We keep fetch inside db."],
    ]);
    expect(h.dismissedRows).toEqual(["today-1"]);
    expect(h.audits).toEqual(["loop.plan_rejected"]);
  });

  it("a reject whose dismissal cannot be written is a 500 and the plan stays PENDING", async () => {
    seedPlan();
    h.decideFails = true;
    const res = await decideAs({ decision: "reject", note: "no" });
    expect(res).toMatchObject({ ok: false, status: 500 });
    expect(h.plans[0]).toMatchObject({ status: "pending", decidedBy: null });
    expect(h.audits).toEqual([]);
  });

  it("revise stamps the note for the next planner and dismisses nothing", async () => {
    seedPlan();
    const res = await decideAs({ decision: "revise", note: "Do it without a new module." });
    expect(res).toMatchObject({ ok: true, plan: { status: "revise", decisionNote: "Do it without a new module.", decidedBy: "kaz" }, direction: null });
    expect(h.decisions).toEqual([]);
    expect(h.audits).toEqual(["loop.plan_revised"]);
  });

  it("only a pending plan can be decided", async () => {
    seedPlan({ status: "approved" });
    expect(await decideAs({ decision: "revise", note: "x" })).toMatchObject({ ok: false, status: 409 });
  });
});
