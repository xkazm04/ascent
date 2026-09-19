// `openBatch`'s GREEN RESERVATION — the wiring, on top of the pure rules in lane-reservation.test.ts.
//
// Sibling of loop-lane.craft.test.ts, which pins the gaps-outrank-craft ordering and the zero-gap
// fallback and must keep passing untouched: every case there is a NON-green repo (its dimension read
// is unmocked and answers nothing), and a non-green repo's batch is byte-identical to what it was
// before the reservation existed.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FollowUpItem } from "@/lib/org/followups";
import type { CraftAxis } from "@/lib/scoring/craft";

const backlogItems: Record<string, unknown>[] = [];
const craftItems: FollowUpItem[] = [];
let ledger: { total: number; byAxis: Record<CraftAxis, number>; unaxised: number };
let dimScores: { dimId: string; score: number }[] = [];
let unmeasurableDims: string[] = [];

vi.mock("@/lib/db/org-insights", () => ({
  getOrgBacklog: vi.fn(async () => ({ byOwner: [{ items: backlogItems }] })),
}));
vi.mock("@/lib/db/org-insights-craft", () => ({
  getCraftItems: vi.fn(async () => craftItems),
  getCraftLedger: vi.fn(async () => ledger),
}));
vi.mock("@/lib/db/org-insights-green", () => ({
  getLatestRepoDimScores: vi.fn(async () => dimScores),
}));
vi.mock("@/lib/db/lane-outcomes", () => ({
  getActiveDeferrals: vi.fn(async () => new Set<string>()),
  recordLaneOutcomes: vi.fn(async () => []),
}));
vi.mock("@/lib/db/scans-read", () => ({ getLatestUnmeasurableDims: vi.fn(async () => unmeasurableDims) }));
vi.mock("@/lib/db/scans-recommendations", () => ({ updateRecommendation: vi.fn(async (id: string) => ({ id })) }));
vi.mock("@/lib/db/loop-runs", () => ({
  upsertLane: vi.fn(async () => ({ id: "lane-1" })),
  updateLane: vi.fn(async () => ({})),
  appendLaneLog: vi.fn(async () => {}),
  getLatestScanIdForRepo: vi.fn(async () => "scan-before"),
}));
vi.mock("@/lib/db/playbooks", () => ({ stampPlaybookApplications: vi.fn(async () => 0) }));
vi.mock("@/lib/db/loop-lessons", () => ({ recordLoopLessons: vi.fn(async () => {}) }));
vi.mock("@/lib/local/lane-cost", () => ({ recordAgentCost: vi.fn(async () => {}), excludeLaneReport: vi.fn(async () => {}) }));
vi.mock("@/lib/local/git", () => ({ runGit: vi.fn(async () => ({ ok: true, stdout: "1", stderr: "" })) }));
vi.mock("@/lib/db", () => ({ persistScanReport: vi.fn(async () => ({ scanId: "s" })), getLatestPlatformSignals: vi.fn(async () => null) }));
vi.mock("@/lib/scan", () => ({ scanRepository: vi.fn(async () => ({})) }));
vi.mock("@/lib/local/source", () => ({ LocalFsSource: class {} }));
vi.mock("@/lib/local/agent", () => ({ runClaudeAgent: vi.fn(async () => ({ ok: true, summary: "done" })) }));

import { BATCH_SIZE, openBatch } from "@/lib/local/loop-lane";
import { GAP_SLOTS_AT_GREEN } from "@/lib/local/lane-reservation";
import { emptyAxisTally } from "@/lib/scoring/craft";

const gap = (id: string) => ({
  id,
  repo: "o/r",
  title: `gap ${id}`,
  dimId: "D9",
  dimLabel: "Security",
  impact: "high",
  effort: "low",
  rationale: "",
  explore: [],
  projectedPoints: 3,
  status: "open",
});

const craft = (id: string, axis: CraftAxis | null = "performance"): FollowUpItem => ({
  id,
  repo: "o/r",
  title: `rung ${id}`,
  dimId: "D2",
  dimLabel: "Testing",
  impact: "medium",
  effort: "medium",
  rationale: "",
  explore: [],
  projectedPoints: null,
  kind: "craft",
  craftAxis: axis,
});

/** Every measured dimension above FOLLOW_UP_BELOW but well short of L5 — the campaign shape. */
const GREEN = [{ dimId: "D1", score: 81 }, { dimId: "D5", score: 72 }, { dimId: "D9", score: 68 }];
/** One dimension in a real hole. */
const NOT_GREEN = [...GREEN, { dimId: "D6", score: 40 }];

beforeEach(() => {
  backlogItems.length = 0;
  craftItems.length = 0;
  dimScores = [];
  unmeasurableDims = [];
  ledger = { total: 0, byAxis: emptyAxisTally(), unaxised: 0 };
});

describe("the green reservation", () => {
  it("MIXES the batch on a green repo — gaps in the top slots, the ladder in the rest", async () => {
    // The starvation case: two fresh gaps every rescan means `gaps.length === 0` never arrives, so
    // before this the five well-formed rungs sitting in the table never got a turn.
    backlogItems.push(gap("g1"), gap("g2"), gap("g3"), gap("g4"), gap("g5"));
    craftItems.push(craft("c1"), craft("c2"), craft("c3"));
    dimScores = GREEN;

    const batch = await openBatch("kiro", "o/r");
    expect(batch).toHaveLength(BATCH_SIZE);
    expect(batch.filter((b) => b.kind !== "craft").map((b) => b.id)).toEqual(["g1", "g2"]);
    expect(batch.slice(0, GAP_SLOTS_AT_GREEN).every((b) => b.kind !== "craft")).toBe(true);
    expect(batch.filter((b) => b.kind === "craft").map((b) => b.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("leaves a NON-GREEN repo gaps-only — a repo with a real hole gets no craft budget", async () => {
    backlogItems.push(gap("g1"), gap("g2"), gap("g3"));
    craftItems.push(craft("c1"), craft("c2"));
    dimScores = NOT_GREEN;
    expect((await openBatch("kiro", "o/r")).map((b) => b.id)).toEqual(["g1", "g2", "g3"]);
  });

  it("treats an UNREADABLE dimension read as not green — an absence of evidence opens nothing", async () => {
    backlogItems.push(gap("g1"), gap("g2"), gap("g3"));
    craftItems.push(craft("c1"));
    dimScores = [];
    expect((await openBatch("kiro", "o/r")).map((b) => b.id)).toEqual(["g1", "g2", "g3"]);
  });

  it("counts an unobservable dimension the same way the rest of the loop does", async () => {
    // D2/D3/D4 read at their file-scan floor on a worktree rescan. Judged, they would keep every
    // loop repo permanently non-green; held out, the repo is green and the reservation opens.
    backlogItems.push(gap("g1"), gap("g2"), gap("g3"));
    craftItems.push(craft("c1"));
    dimScores = [...GREEN, { dimId: "D3", score: 12 }];
    expect((await openBatch("kiro", "o/r")).map((b) => b.id)).toEqual(["g1", "g2", "g3"]);
    unmeasurableDims = ["D2", "D3", "D4"];
    // Two gaps, then the ladder's one rung, then the slot the short ladder could not fill goes back
    // to the gap list rather than shrinking the batch.
    expect((await openBatch("kiro", "o/r")).map((b) => b.id)).toEqual(["g1", "g2", "c1", "g3"]);
  });

  it("gives a green repo with NO rungs left exactly the batch it had before", async () => {
    backlogItems.push(gap("g1"), gap("g2"), gap("g3"));
    dimScores = GREEN;
    expect((await openBatch("kiro", "o/r")).map((b) => b.id)).toEqual(["g1", "g2", "g3"]);
  });

  it("does NOT reserve on a CURATED read — the whole open list has to survive the filter", async () => {
    backlogItems.push(gap("g1"), gap("g2"), gap("g3"), gap("g4"), gap("g5"), gap("g6"));
    craftItems.push(craft("c1"));
    dimScores = GREEN;
    const curated = await openBatch("kiro", "o/r", 500, { includeDeferred: true, reserveCraft: false });
    expect(curated.map((b) => b.id)).toEqual(["g1", "g2", "g3", "g4", "g5", "g6"]);
  });

  it("still falls all the way through to a craft-ONLY batch when there is no gap at all", async () => {
    craftItems.push(craft("c1"), craft("c2"));
    dimScores = GREEN;
    expect((await openBatch("kiro", "o/r")).every((b) => b.kind === "craft")).toBe(true);
  });
});
