// THE ADJUDICATION TAIL, alone (challenge-2026-09-23, card live-war-room#A). The cadence-level parity
// — a `"cycle"` lane and a deferred settle writing the same three log lines — is pinned end to end in
// loop-lane.settle.test.ts; this file pins the tail's own contract: the terminal row goes through the
// caller's door BEFORE the lines that describe it, and a non-agent lane gets no per-item tail.

import { beforeEach, describe, expect, it, vi } from "vitest";

const order: string[] = [];
const logs: string[] = [];

vi.mock("@/lib/db/loop-runs", () => ({
  appendLaneLog: vi.fn(async (_id: string, line: string) => {
    order.push("log");
    logs.push(line);
  }),
}));
vi.mock("@/lib/db/lane-outcomes", () => ({ recordLaneOutcomes: vi.fn(async () => void order.push("outcomes")) }));
vi.mock("@/lib/db/playbooks", () => ({ stampPlaybookApplications: vi.fn(async (_o: string, _r: string, ids: string[]) => ids.length) }));
vi.mock("@/lib/db/loop-lessons", () => ({
  recordLoopLessons: vi.fn(async (_o: string, _r: string, _l: string, lessons: string[]) => lessons.map(() => ({ status: "candidate" }))),
}));

import { adjudicateLane, type AdjudicateInput } from "@/lib/local/lane-adjudicate";

const item = (id: string, dimId: string) => ({ id, repo: "o/r", title: id, dimId, dimLabel: dimId, impact: "high", effort: "low", rationale: "", explore: "", projectedPoints: 3 });

const deps = {
  loadPair: vi.fn(async () => null),
  baseRelation: vi.fn(async () => "linear" as const),
  summarize: vi.fn(async (l: never[]) => l),
} as never;

const input = (over: Partial<AdjudicateInput> = {}): AdjudicateInput => ({
  org: "kiro",
  repo: "o/r",
  runId: "run",
  laneId: "lane-1",
  cycle: 1,
  kind: "backlog",
  beforeScanId: "scan-before",
  afterScanId: "scan-after",
  commits: 1,
  closedIds: ["r1"],
  batch: [item("r1", "D3"), item("r2", "D5")],
  agentClaims: [],
  report: { v: 1, parsed: true, items: [], lessons: ["one", "two"] },
  briefedPlaybooks: [{ id: "pb", dimId: "D3" }],
  practiceId: null,
  autoKeepLessons: false,
  cwd: "C:/tmp/wt",
  ...over,
});

beforeEach(() => {
  order.length = 0;
  logs.length = 0;
});

describe("adjudicateLane", () => {
  it("closes the row through the caller's door first, then writes the delivered, lessons and playbook lines", async () => {
    const close = vi.fn(async (columns: Record<string, unknown>) => {
      order.push("close");
      return { closedWith: columns };
    });
    const res = await adjudicateLane(deps, input(), close);
    expect(close).toHaveBeenCalledWith(expect.objectContaining({ closedIds: ["r1"], afterScanId: "scan-after", deliverables: expect.any(Array) }));
    expect(order[0]).toBe("close");
    expect(res).toMatchObject({ closedWith: { closedIds: ["r1"] } });
    expect(logs.some((l) => l.startsWith("Delivered: "))).toBe(true);
    expect(logs).toContain("2 lesson candidate(s) recorded for review — nothing was written into memory.");
    expect(logs).toContain("1 playbook(s) from this lane's brief recorded as applied — the rescan verified the close.");
  });

  it("a deterministic (practice) lane gets its headline and row, but no per-item tail", async () => {
    await adjudicateLane(deps, input({ kind: "practice", practiceId: "ci-gate" }), async () => void order.push("close"));
    expect(order).not.toContain("outcomes");
    expect(logs.some((l) => l.includes("lesson"))).toBe(false);
  });

  it("no playbook line when the close was on a dimension the brief never quoted", async () => {
    await adjudicateLane(deps, input({ closedIds: ["r2"] }), async () => undefined);
    expect(logs.some((l) => l.includes("playbook"))).toBe(false);
  });
});
