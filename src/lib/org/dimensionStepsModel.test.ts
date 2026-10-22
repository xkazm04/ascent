import { describe, expect, it } from "vitest";
import type { PersistedRecommendation, RecStatus } from "@/lib/types";
import {
  actionsFor,
  applyResult,
  buildSteps,
  orderSteps,
  patchFor,
  stepFromRec,
  type DimensionStep,
} from "./dimensionStepsModel";

function rec(id: string, status: RecStatus, over: Partial<PersistedRecommendation> = {}): PersistedRecommendation {
  return {
    id, title: `t-${id}`, dimension: "D3", impact: "high", effort: "low", rationale: "r", explore: [],
    status, assigneeLogin: null, targetDate: null, projectedPoints: 4, ...over,
  };
}
const step = (id: string, status: RecStatus, over: Partial<DimensionStep> = {}): DimensionStep => ({
  ...stepFromRec(rec(id, status)),
  ...over,
});
const ACME = { org: "acme", canAct: true };

describe("buildSteps", () => {
  it("uses the persisted recs for the dimension when tracking answered", () => {
    const s = buildSteps("D3", [rec("r1", "open"), rec("r9", "open", { dimension: "D5" })], []);
    expect(s.map((x) => x.id)).toEqual(["r1"]);
    expect(s[0]).toMatchObject({ tracked: true, projectedPoints: 4, assigneeLogin: null, targetDate: null });
  });

  it("falls back to the untracked roadmap when recs are null", () => {
    const s = buildSteps("D3", null, [
      { title: "a", dimension: "D3", impact: "high", effort: "low", rationale: "" },
      { title: "b", dimension: "D5", impact: "high", effort: "low", rationale: "" },
    ]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ id: null, tracked: false, status: "open" });
  });
});

describe("orderSteps", () => {
  it("puts open then in_progress first and folds done/dismissed into closed with a count", () => {
    const o = orderSteps([step("a", "done"), step("b", "in_progress"), step("c", "dismissed"), step("d", "open")]);
    expect(o.active.map((s) => s.id)).toEqual(["d", "b"]);
    expect(o.closed.map((s) => s.id).sort()).toEqual(["a", "c"]);
    expect(o.closedCount).toBe(2);
    expect(o.doneCount).toBe(1);
    expect(o.dismissedCount).toBe(1);
  });

  it("openCount for [open, dismissed, done] is 1", () => {
    expect(orderSteps([step("a", "open"), step("b", "dismissed"), step("c", "done")]).openCount).toBe(1);
  });
});

describe("actionsFor", () => {
  it("offers verdicts by status", () => {
    expect(actionsFor(step("a", "open"), ACME)).toEqual(["start", "done", "dismiss"]);
    expect(actionsFor(step("a", "in_progress"), ACME)).toEqual(["done", "dismiss"]);
    expect(actionsFor(step("a", "done"), ACME)).toEqual(["reopen"]);
    expect(actionsFor(step("a", "dismissed"), ACME)).toEqual(["reopen"]);
  });

  it("offers nothing on an untracked step or the public org (the PATCH route 403s it)", () => {
    expect(actionsFor(step("a", "open", { tracked: false }), ACME)).toEqual([]);
    expect(actionsFor(step("a", "open"), { org: "public", canAct: true })).toEqual([]);
    expect(actionsFor(step("a", "open"), { org: " Public ", canAct: true })).toEqual([]);
  });

  it("offers nothing to a viewer without write access (canAct false)", () => {
    for (const s of ["open", "in_progress", "done", "dismissed"] as RecStatus[]) {
      expect(actionsFor(step("a", s), { org: "acme", canAct: false })).toEqual([]);
    }
  });
});

describe("patchFor", () => {
  it("start claims an unowned step for the viewer", () => {
    expect(patchFor("start", { assigneeLogin: null }, { viewerLogin: "ana" })).toEqual({
      status: "in_progress",
      assigneeLogin: "ana",
    });
  });

  it("start never steals an owner", () => {
    expect(patchFor("start", { assigneeLogin: "bo" }, { viewerLogin: "ana" })).toEqual({ status: "in_progress" });
  });

  it("dismiss carries the reason as the note, and an empty reason sends no note key", () => {
    expect(patchFor("dismiss", { assigneeLogin: null }, { reason: "we use Bazel" })).toEqual({
      status: "dismissed",
      note: "we use Bazel",
    });
    const bare = patchFor("dismiss", { assigneeLogin: null }, { reason: "" });
    expect(bare).toEqual({ status: "dismissed" });
    expect("note" in bare).toBe(false);
  });

  it("done and reopen are bare status moves", () => {
    expect(patchFor("done", { assigneeLogin: null })).toEqual({ status: "done" });
    expect(patchFor("reopen", { assigneeLogin: null })).toEqual({ status: "open" });
  });
});

describe("applyResult", () => {
  const steps = [step("r1", "open"), step("r2", "open")];

  it("a 200 replaces the step by id in place and recomputes openCount", () => {
    const r = applyResult(steps, "r1", { ok: true, rec: rec("r1", "done") });
    expect(r.steps.map((s) => s.id)).toEqual(["r1", "r2"]);
    expect(r.steps[0]!.status).toBe("done");
    expect(r.openCount).toBe(1);
    expect(r.error).toBeUndefined();
  });

  it.each([403, 409])("a %i leaves the step unchanged and yields a RowError (no optimistic removal)", (status) => {
    const r = applyResult(steps, "r1", { ok: false, status });
    expect(r.steps).toBe(steps);
    expect(r.steps).toHaveLength(2);
    expect(r.openCount).toBe(2);
    expect(r.error?.status).toBe(status);
    expect(r.error?.message).toBeTruthy();
    expect(r.error?.message).not.toContain(String.fromCharCode(0x2014));
  });
});
