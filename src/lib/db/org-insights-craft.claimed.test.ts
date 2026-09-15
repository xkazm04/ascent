// CRAFT ALREADY BUILT — why this read is deliberately wider than the odometer.
//
// The model is asked for the next rung and shown what has been built. It was shown only `done` rows,
// and a craft rung reached `done` only when a later scan stopped raising it — which a re-derived
// craft entry never does. So the pile grew (2757 `in_progress` rows over 186 titles in one repo, one
// title re-raised 61 times), the model re-proposed built rungs, the lane dispatched them, and 37 of
// 136 campaign-5 agent verdicts opened with "Already covered"
// (docs/harness/reflection-2026-09-01.md, finding 5).
//
// The two reads now answer different questions. `getCraftLedger` — a number that only ever rises —
// still counts `done` alone. `getCraftBuilt` also counts a rung a lane recorded a `resolved` outcome
// for, because omitting a built rung costs a wasted session while including an over-claimed one costs
// one un-proposed rung out of an unbounded supply.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Rec = { id: string; dimId: string; title: string; craftAxis: string | null; status: string; kind: string };

const recs: Rec[] = [];
const outcomes: { recommendationId: string; repoFullName: string; verdict: string }[] = [];

vi.mock("@/lib/db/org-shared", () => ({ getOrgBySlug: vi.fn(async () => ({ id: "org-1" })) }));
vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  dbReadSafe: async <T,>(fn: () => Promise<T>, fallback: T) => fn().catch(() => fallback),
  getPrisma: () => ({
    repository: { findUnique: async () => ({ id: "repo-1", fullName: "kiro/systedo-case" }) },
    scan: { findFirst: async () => ({ id: "scan-9" }) },
    laneItemOutcome: {
      findMany: async ({ where }: { where: { repoFullName?: string; verdict?: string } }) =>
        outcomes.filter((o) => (where.repoFullName ? o.repoFullName === where.repoFullName : true) && (where.verdict ? o.verdict === where.verdict : true)),
    },
    recommendation: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        recs.filter((r) => {
          const idIn = (where.id as { in: string[] } | undefined)?.in;
          if (idIn && !idIn.includes(r.id)) return false;
          if (where.kind !== undefined && r.kind !== where.kind) return false;
          if (typeof where.status === "string" && r.status !== where.status) return false;
          return true;
        }),
    },
  }),
}));

import { getCraftBuilt, getCraftLedger } from "./org-insights-craft";

const craft = (id: string, title: string, status: string, dimId = "D2"): Rec => ({ id, dimId, title, craftAxis: "performance", status, kind: "craft" });

beforeEach(() => {
  recs.length = 0;
  outcomes.length = 0;
});

describe("getCraftBuilt — a rung a lane built is not proposed again", () => {
  it("includes a claimed rung that never reached `done`", async () => {
    recs.push(craft("c1", "A performance budget that fails CI", "in_progress"));
    outcomes.push({ recommendationId: "c1", repoFullName: "kiro/systedo-case", verdict: "resolved" });
    const built = await getCraftBuilt("kiro", "kiro/systedo-case");
    expect(built.map((b) => b.title)).toEqual(["A performance budget that fails CI"]);
    expect(built[0]!.axis).toBe("performance");
  });

  it("collapses the 61-times-re-raised title to ONE line", async () => {
    // The real shape: the same rung re-derived by scan after scan, each row a new id, each claimed.
    for (let i = 0; i < 61; i += 1) {
      recs.push(craft(`c${i}`, i % 2 === 0 ? "A performance budget that fails CI" : "A  performance budget that fails CI ", "in_progress"));
      outcomes.push({ recommendationId: `c${i}`, repoFullName: "kiro/systedo-case", verdict: "resolved" });
    }
    const built = await getCraftBuilt("kiro", "kiro/systedo-case");
    expect(built).toHaveLength(1);
  });

  it("ignores a rung nothing claimed, and a claim from another repository", async () => {
    recs.push(craft("c1", "A chaos drill for the queue", "in_progress"));
    recs.push(craft("c2", "An architecture-decay check", "in_progress"));
    outcomes.push({ recommendationId: "c2", repoFullName: "kiro/kp", verdict: "resolved" });
    expect(await getCraftBuilt("kiro", "kiro/systedo-case")).toEqual([]);
  });

  it("ignores a skipped claim", async () => {
    recs.push(craft("c1", "A chaos drill for the queue", "in_progress"));
    outcomes.push({ recommendationId: "c1", repoFullName: "kiro/systedo-case", verdict: "skipped" });
    expect(await getCraftBuilt("kiro", "kiro/systedo-case")).toEqual([]);
  });

  it("leaves the ODOMETER strict — the ledger still counts only what reached `done`", async () => {
    recs.push(craft("c1", "A performance budget that fails CI", "in_progress"));
    outcomes.push({ recommendationId: "c1", repoFullName: "kiro/systedo-case", verdict: "resolved" });
    expect((await getCraftLedger("kiro", "kiro/systedo-case")).total).toBe(0);
    recs.push(craft("c2", "A chaos drill for the queue", "done"));
    expect((await getCraftLedger("kiro", "kiro/systedo-case")).total).toBe(1);
  });
});
