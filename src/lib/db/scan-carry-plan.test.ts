// planCarryForward + copyRecRow: the carry-forward unit of work, pinned without a Prisma transaction.

import { describe, it, expect } from "vitest";
import type { InProgressDecision, MovementEngines } from "@/lib/org/followups";
import { decideInProgress, isRestated } from "@/lib/org/followups";
import {
  CLAIM_FIELDS,
  COPY_IDENTITY_FIELDS,
  COPY_RESET_FIELDS,
  PREV_REC_SELECT,
  copyRecRow,
  planCarryForward,
  trackedState,
  type CarryPlanInput,
  type PrevRecRow,
} from "./scan-carry-plan";

const row = (over: Partial<PrevRecRow> = {}): PrevRecRow => ({
  id: "rec_ip", dimId: "D5", title: "Docs drift from the code", status: "in_progress",
  assigneeLogin: "octocat", targetDate: new Date("2026-11-01T00:00:00.000Z"),
  claimActor: "agent:lane", claimExecutor: "local", leaseUntil: new Date("2026-10-23T12:00:00.000Z"), needsHuman: true,
  impact: "high", effort: "low", rationale: "r", firstStep: "f", explore: "[\"q\"]", levelUnlock: "L4", kind: "gap", craftAxis: null,
  ...over,
});

const real = (rubricVersion: string | null = "r9") => ({ engineProvider: "anthropic", engineDegraded: false, rubricVersion });
const engines = (before = real(), after = real()): MovementEngines => ({ before, after });

const input = (over: Partial<CarryPlanInput> = {}): CarryPlanInput => ({
  prevRecs: [row()],
  prevDims: [{ dimId: "D5", score: 60 }],
  roadmap: [],
  dims: [{ id: "D5", score: 60 }],
  resolvedIds: new Set<string>(),
  engines: engines(),
  scanRef: "abc123",
  ...over,
});

type KeepReason = Extract<InProgressDecision, { kind: "keep" }>["reason"];

// One scenario per keep reason. Typed as a Record over the union, so a new reason fails to compile here
// until someone states which branch it belongs in by giving it a scenario.
const KEEP_SCENARIOS: Record<KeepReason, CarryPlanInput> = {
  restated: input({ roadmap: [{ dimension: "D5", title: "Docs drift from the code" }] }),
  "claimed-but-restated": input({ roadmap: [{ dimension: "D5", title: "docs drift from the code." }], resolvedIds: new Set(["rec_ip"]) }),
  "no-movement": input({ roadmap: [{ dimension: "D5", title: "Another gap" }] }),
  "within-noise": input({ dims: [{ id: "D5", score: 62 }] }),
  "mock-scan": input({ dims: [{ id: "D5", score: 90 }], engines: engines({ engineProvider: "mock", engineDegraded: false, rubricVersion: "r9" }) }),
  "rubric-changed": input({ dims: [{ id: "D5", score: 90 }], engines: engines(real("r8")) }),
  "craft-unclaimed": input({ prevRecs: [row({ kind: "craft" })] }),
};

describe("planCarryForward - pairing comes from restatement, for every keep reason", () => {
  for (const [reason, scenario] of Object.entries(KEEP_SCENARIOS) as [KeepReason, CarryPlanInput][]) {
    it(`${reason}: paired iff isRestated, and the claim is never lost`, () => {
      const r = scenario.prevRecs[0]!;
      const nextIds = scenario.roadmap.map((n) => ({ dim: n.dimension, title: n.title }));
      const restated = isRestated({ dim: r.dimId, title: r.title }, nextIds);
      const movement = { before: 60, after: scenario.dims[0]!.score };
      const decision = decideInProgress({ id: r.id, kind: r.kind === "craft" ? "craft" : "gap" }, restated, scenario.resolvedIds, movement, scenario.engines);
      expect(decision).toMatchObject({ kind: "keep", reason });

      const plan = planCarryForward(scenario);
      expect(plan.resolved).toEqual([]);
      const unpaired = plan.keptUnpaired.some((k) => k.prevIndex === 0);
      expect(unpaired).toBe(!restated);
      if (restated) {
        // The row rides carry-forward by its title, and a stated note attaches to that new row.
        expect(plan.carry).toContain(0);
        if (reason === "claimed-but-restated") expect(plan.keptPaired).toEqual([{ prevIndex: 0, nextIndex: 0, note: expect.stringContaining("trailer") }]);
      } else {
        // Not restated: no new row is handed the claim through tier 3.
        expect(plan.carry).not.toContain(0);
        expect(plan.keptPaired).toEqual([]);
        expect(plan.keptUnpaired[0]!.note).not.toBe("");
      }
    });
  }
});

describe("planCarryForward - resolution and determinism", () => {
  it("a not-restated row whose dimension moved past the band is resolved and un-paired", () => {
    const plan = planCarryForward(input({ roadmap: [{ dimension: "D5", title: "Another gap" }], dims: [{ id: "D5", score: 70 }] }));
    expect(plan.resolved).toEqual([{ prevIndex: 0, note: expect.stringContaining("no longer raised") }]);
    expect(plan.carry).toEqual([null]);
    expect(plan.keptUnpaired).toEqual([]);
  });

  it("an open row keeps its tier-3 carry (the rule touches in-progress rows only)", () => {
    const plan = planCarryForward(input({ prevRecs: [row({ status: "open" })], roadmap: [{ dimension: "D5", title: "Reworded" }] }));
    expect(plan.carry).toEqual([0]);
  });

  it("two calls on the same input return equal plans", () => {
    const scenario = input({
      prevRecs: [row(), row({ id: "rec_b", title: "Second", dimId: "D9" }), row({ id: "rec_c", status: "open", title: "Third" })],
      prevDims: [{ dimId: "D5", score: 50 }, { dimId: "D9", score: 40 }],
      roadmap: [{ dimension: "D9", title: "second" }, { dimension: "D5", title: "Third" }],
      dims: [{ id: "D5", score: 70 }, { id: "D9", score: 41 }],
      resolvedIds: new Set(["rec_b"]),
    });
    const a = planCarryForward(scenario);
    expect(planCarryForward(scenario)).toEqual(a);
    expect(a.resolved.map((r) => r.prevIndex)).toEqual([0]);
  });
});

describe("copyRecRow - one copier, every selected field accounted for", () => {
  const selected = Object.keys(PREV_REC_SELECT);

  it("every non-identity field of the previous-scan select is copied onto an in_progress copy", () => {
    const prev = row();
    const copy = copyRecRow(prev, "in_progress") as Record<string, unknown>;
    for (const field of selected) {
      if ((COPY_IDENTITY_FIELDS as readonly string[]).includes(field)) {
        expect(copy).not.toHaveProperty(field);
        continue;
      }
      expect(copy, field).toHaveProperty(field);
      if (!(COPY_RESET_FIELDS as readonly string[]).includes(field)) expect(copy[field], field).toEqual(prev[field as keyof PrevRecRow]);
    }
    expect(Object.keys(copy).sort()).toEqual(selected.filter((f) => f !== "id").sort());
  });

  it("a done copy resets status and exactly the claim fields", () => {
    const prev = row();
    const copy = copyRecRow(prev, "done") as Record<string, unknown>;
    expect(copy.status).toBe("done");
    for (const field of selected) {
      if (field === "id" || field === "status") continue;
      if ((CLAIM_FIELDS as readonly string[]).includes(field)) expect(copy[field], field).toEqual(field === "needsHuman" ? false : null);
      else expect(copy[field], field).toEqual(prev[field as keyof PrevRecRow]);
    }
  });

  it("trackedState carries ownership always and the claim only with in_progress", () => {
    expect(trackedState(row(), "in_progress")).toMatchObject({ claimActor: "agent:lane", needsHuman: true });
    expect(trackedState(row(), "open")).toMatchObject({ assigneeLogin: "octocat", claimActor: null, leaseUntil: null, needsHuman: false });
    expect(trackedState(undefined, "open")).toEqual({
      status: "open", assigneeLogin: null, targetDate: null, claimActor: null, claimExecutor: null, leaseUntil: null, needsHuman: false,
    });
  });
});
