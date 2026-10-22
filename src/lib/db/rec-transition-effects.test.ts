// applyRecTransitionEffects: plan the transition, run the existing writers, never throw
// (roadmap-0, challenge 2026-10-22b).

import { beforeEach, describe, expect, it, vi } from "vitest";

const { closedMemory, closeById, dismissal, clear } = vi.hoisted(() => ({
  closedMemory: vi.fn(async () => ({ id: "mem_1" })),
  closeById: vi.fn(async () => ({ id: "mem_2" })),
  dismissal: vi.fn(async () => ({ id: "dec_1", memoryId: null })),
  clear: vi.fn(async () => null),
}));

vi.mock("@/lib/memory/scan-feed", () => ({
  recordRecommendationClosedMemory: closedMemory,
  recordRecommendationClose: closeById,
}));
vi.mock("@/lib/db/org-decisions", () => ({
  recordRecommendationDismissal: dismissal,
  clearRecommendationDismissal: clear,
}));

import { applyRecTransitionEffects } from "./rec-transition-effects";

const rec = { title: "Add CI smoke tests", dimension: "D2" };

beforeEach(() => vi.clearAllMocks());

describe("applyRecTransitionEffects", () => {
  it("a close with the repo scope in hand writes memory on (orgId, fullName) without an id read", async () => {
    const out = await applyRecTransitionEffects(
      { from: "in_progress", to: "done", ...rec },
      { recommendationId: "rec_1", orgId: "org_1", repoFullName: "acme/widget" },
    );
    expect(out).toEqual({ applied: ["close-memory"], failed: [] });
    expect(closedMemory).toHaveBeenCalledWith("org_1", "acme/widget", rec, undefined);
    expect(closeById).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });

  it("a close without the scope resolves it from the id (the route path)", async () => {
    await applyRecTransitionEffects({ from: null, to: "done", ...rec }, { recommendationId: "rec_1", actor: "alice" });
    expect(closeById).toHaveBeenCalledWith("rec_1", rec, undefined);
    // Unknown prior state: the defensive clear rides too, as the route always did.
    expect(clear).toHaveBeenCalledWith("rec_1", rec, "alice");
  });

  it("a dismissal with a reason records the standing decision with the actor", async () => {
    const out = await applyRecTransitionEffects(
      { from: null, to: "dismissed", reason: "we build with Bazel", ...rec },
      { recommendationId: "rec_1", actor: "alice" },
    );
    expect(out.applied).toEqual(["standing-dismissal"]);
    expect(dismissal).toHaveBeenCalledWith("rec_1", { ...rec, reason: "we build with Bazel" }, "alice");
  });

  it("never throws: a failing memory writer resolves to {applied:[], failed:['close-memory']} and logs", async () => {
    closedMemory.mockRejectedValueOnce(new Error("db down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await applyRecTransitionEffects(
      { from: "in_progress", to: "done", ...rec },
      { recommendationId: "rec_1", orgId: "org_1", repoFullName: "acme/widget" },
    );
    expect(out).toEqual({ applied: [], failed: ["close-memory"] });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("one failing effect does not stop the next one", async () => {
    closeById.mockRejectedValueOnce(new Error("boom"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await applyRecTransitionEffects({ from: "dismissed", to: "done", ...rec }, { recommendationId: "rec_1" });
    expect(out).toEqual({ applied: ["reopen-decision"], failed: ["close-memory"] });
    warn.mockRestore();
  });

  it("a transition with no consequence touches no writer", async () => {
    const out = await applyRecTransitionEffects({ from: "open", to: "in_progress", ...rec }, { recommendationId: "rec_1" });
    expect(out).toEqual({ applied: [], failed: [] });
    expect(closedMemory).not.toHaveBeenCalled();
    expect(closeById).not.toHaveBeenCalled();
    expect(dismissal).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });
});
