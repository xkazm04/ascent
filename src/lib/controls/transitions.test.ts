import { describe, expect, it } from "vitest";
import {
  TRANSITION_SEVERITY,
  classifyMove,
  detectControlTransitions,
  isDispatchable,
  transitionsFromRows,
  type ControlSnapshot,
} from "@/lib/controls/transitions";

const snap = (repo: string, entries: [string, "pass" | "fail" | "unmeasurable", string | null][]): ControlSnapshot => ({
  repoFullName: repo,
  entries: entries.map(([controlId, state, value]) => ({ controlId, state, value })),
});

describe("classifyMove", () => {
  it("pass → fail is control-failed", () => {
    expect(classifyMove("pass", "fail")).toBe("control-failed");
  });

  it("fail → pass is control-restored", () => {
    expect(classifyMove("fail", "pass")).toBe("control-restored");
  });

  // The whole honesty contract of the item: a lost read is never a failure.
  it("pass → unmeasurable is control-unmeasurable, NEVER control-failed", () => {
    expect(classifyMove("pass", "unmeasurable")).toBe("control-unmeasurable");
  });

  it("fail → unmeasurable is also control-unmeasurable", () => {
    expect(classifyMove("fail", "unmeasurable")).toBe("control-unmeasurable");
  });

  it("unmeasurable → fail is a real finding, reported as control-failed", () => {
    expect(classifyMove("unmeasurable", "fail")).toBe("control-failed");
  });

  it("unmeasurable → pass is not alertable: regaining a read is news about us, not about them", () => {
    expect(classifyMove("unmeasurable", "pass")).toBeNull();
  });

  it("a same-state move is not alertable", () => {
    expect(classifyMove("pass", "pass")).toBeNull();
    expect(classifyMove("fail", "fail")).toBeNull();
  });
});

describe("severity and dispatch", () => {
  it("control-failed is critical, control-restored a celebration, unmeasurable info", () => {
    expect(TRANSITION_SEVERITY["control-failed"]).toBe("critical");
    expect(TRANSITION_SEVERITY["control-restored"]).toBe("celebration");
    expect(TRANSITION_SEVERITY["control-unmeasurable"]).toBe("info");
  });

  it("unmeasurable never reaches a sink", () => {
    expect(isDispatchable("control-unmeasurable")).toBe(false);
    expect(isDispatchable("control-failed")).toBe(true);
    expect(isDispatchable("control-restored")).toBe(true);
  });
});

describe("detectControlTransitions", () => {
  // The spec's fail-before case (a): required-approvals 2 → 0.
  it("catches required-approvals falling to zero", () => {
    const out = detectControlTransitions(
      snap("acme/api", [["required-approvals", "pass", "2"]]),
      snap("acme/api", [["required-approvals", "fail", "0"]]),
      { at: "2026-08-20T00:00:00.000Z", actorLogin: "octocat" },
    );
    expect(out).toEqual([
      {
        controlId: "required-approvals",
        repoFullName: "acme/api",
        code: "control-failed",
        from: "pass",
        to: "fail",
        fromValue: "2",
        toValue: "0",
        at: "2026-08-20T00:00:00.000Z",
        actorLogin: "octocat",
      },
    ]);
  });

  it("a control absent from prev is a BASELINE, not a change", () => {
    expect(detectControlTransitions(snap("a/b", []), snap("a/b", [["branch-protection", "fail", "false"]]))).toEqual([]);
  });

  it("a value-only move (approvals 2 → 1, both pass) is not alertable", () => {
    expect(
      detectControlTransitions(snap("a/b", [["required-approvals", "pass", "2"]]), snap("a/b", [["required-approvals", "pass", "1"]])),
    ).toEqual([]);
  });

  it("carries null actor and null time when the caller gave neither — never a fabricated stamp", () => {
    const [t] = detectControlTransitions(snap("a/b", [["signed-commits", "pass", "true"]]), snap("a/b", [["signed-commits", "fail", "false"]]));
    expect(t?.at).toBeNull();
    expect(t?.actorLogin).toBeNull();
  });

  it("sorts by control id so a message body is stable", () => {
    const out = detectControlTransitions(
      snap("a/b", [
        ["signed-commits", "pass", "true"],
        ["branch-protection", "pass", "true"],
      ]),
      snap("a/b", [
        ["signed-commits", "fail", "false"],
        ["branch-protection", "fail", "false"],
      ]),
    );
    expect(out.map((t) => t.controlId)).toEqual(["branch-protection", "signed-commits"]);
  });
});

describe("transitionsFromRows", () => {
  const row = (over: Partial<Parameters<typeof transitionsFromRows>[0][number]>) => ({
    controlId: "branch-protection",
    repoFullName: "acme/api",
    state: "fail" as const,
    value: "false",
    prevState: "pass" as const,
    prevValue: "true",
    occurredAt: "2026-08-20T10:00:00.000Z",
    actorLogin: null,
    ...over,
  });

  it("reads the ledger row's own prevState", () => {
    expect(transitionsFromRows([row({})])).toMatchObject([{ code: "control-failed", from: "pass", to: "fail", at: "2026-08-20T10:00:00.000Z" }]);
  });

  it("skips a baseline row (prevState null)", () => {
    expect(transitionsFromRows([row({ prevState: null, prevValue: null })])).toEqual([]);
  });

  it("keeps the webhook actor when the row carries one", () => {
    expect(transitionsFromRows([row({ actorLogin: "octocat" })])[0]?.actorLogin).toBe("octocat");
  });
});
