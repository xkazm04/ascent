// THE ONE PHASE VOCABULARY, as a table. Pure: no clock but the `now` each row passes, no db, no DOM —
// the same function the pulse runs on the server and the theater may re-run in the browser.

import { describe, expect, it } from "vitest";
import { deriveLanePhase, fmtQuiet, laneQuietForMs, lanePhaseLabel, newestEvidenceMs, type PhaseInput } from "@/lib/local/lane-phase";
import { PHASE_QUIET_MS, type LaneActivity, type LanePhase } from "@/lib/local/runner-types";

const T0 = Date.parse("2026-09-18T10:00:00.000Z");
const iso = (dt: number) => new Date(T0 + dt).toISOString();
const ev = (kind: LaneActivity["kind"], dt: number): LaneActivity => ({ at: iso(dt), kind, path: null, tool: null, note: null });
const input = (o: Partial<PhaseInput>): PhaseInput => ({ phase: "dispatching", stage: null, tail: [], heartbeatAt: null, ...o });

describe("deriveLanePhase — the row's own phase and stage", () => {
  const rows: [string, Partial<PhaseInput>, LanePhase][] = [
    ["queued", { phase: "queued" }, "queued"],
    ["rescanning", { phase: "rescanning", stage: "analyze" }, "rescanning"],
    ["done", { phase: "done" }, "done"],
    ["error", { phase: "error", stage: "verify" }, "error"],
    ["held outranks done", { phase: "done", held: true }, "held"],
    ["planning", { stage: "planning" }, "planning"],
    ["an explicit baseline stage", { stage: "baseline", tail: [ev("edit", 0)] }, "baseline"],
    ["installing", { stage: "installing" }, "installing"],
    ["committing", { stage: "committing" }, "committing"],
    ["landing", { stage: "landing" }, "landing"],
  ];
  it.each(rows)("%s", (_name, o, want) => {
    expect(deriveLanePhase(input(o), T0)).toBe(want);
  });
});

describe("deriveLanePhase — `verifying` is the baseline until an execution session ran", () => {
  const plan = [ev("read", 0), ev("search", 1_000), ev("result", 2_000)];
  const rows: [string, Partial<PhaseInput>, LanePhase][] = [
    ["no session yet", { stage: "verifying" }, "baseline"],
    ["after a planning session only", { stage: "verifying", tail: plan, planned: true }, "baseline"],
    ["an edit means the execution session ran", { stage: "verifying", tail: [ev("edit", 0), ev("result", 1_000)], planned: true }, "verifying"],
    ["a write counts as an edit", { stage: "verifying", tail: [ev("write", 0)] }, "verifying"],
    ["two sessions behind it", { stage: "verifying", tail: [...plan, ev("read", 3_000), ev("result", 4_000)], planned: true }, "verifying"],
    ["one finished session on a lane that did NOT plan", { stage: "verifying", tail: [ev("read", 0), ev("result", 1_000)], planned: false }, "verifying"],
    ["one read-only session, planning unknown → the baseline", { stage: "verifying", tail: plan }, "baseline"],
  ];
  it.each(rows)("%s", (_name, o, want) => {
    expect(deriveLanePhase(input(o), T0 + 5_000)).toBe(want);
  });
});

describe("deriveLanePhase — the agent's own stretch", () => {
  const now = T0 + 10_000;
  const rows: [string, Partial<PhaseInput>, LanePhase][] = [
    ["a Read", { tail: [ev("read", 9_000)] }, "agent-reading"],
    ["a Grep/Glob", { tail: [ev("search", 9_000)] }, "agent-reading"],
    ["an Edit", { tail: [ev("read", 1_000), ev("edit", 9_000)] }, "agent-editing"],
    ["a Write", { tail: [ev("write", 9_000)] }, "agent-editing"],
    ["assistant text", { tail: [ev("edit", 1_000), ev("text", 9_000)] }, "agent-thinking"],
    ["another tool", { tail: [ev("tool", 9_000)] }, "agent-thinking"],
    ["a result (between sessions)", { tail: [ev("result", 9_000)] }, "agent-thinking"],
    ["nothing at all → the generic phase", {}, "agent-thinking"],
    ["an unknown stage word → the agent's stretch", { stage: "fetch", tail: [ev("read", 9_000)] }, "agent-reading"],
    // The planning session's reads happened BEFORE this stage began: they cannot name it.
    ["an event from an earlier stage never names this one", { tail: [ev("read", 1_000)], stageAt: iso(5_000) }, "agent-thinking"],
    ["an event inside the stage does", { tail: [ev("read", 1_000), ev("edit", 6_000)], stageAt: iso(5_000) }, "agent-editing"],
  ];
  it.each(rows)("%s", (_name, o, want) => {
    expect(deriveLanePhase(input(o), now)).toBe(want);
  });
});

describe("deriveLanePhase — honest decay", () => {
  it("decays a specific phase to agent-quiet once the newest evidence is older than PHASE_QUIET_MS", () => {
    const i = input({ tail: [ev("edit", 0)] });
    expect(deriveLanePhase(i, T0 + PHASE_QUIET_MS)).toBe("agent-editing");
    expect(deriveLanePhase(i, T0 + PHASE_QUIET_MS + 1)).toBe("agent-quiet");
  });

  it("counts the worktree poll's heartbeat as evidence — a moving tree is not a quiet agent", () => {
    const i = input({ tail: [ev("read", 0)], heartbeatAt: iso(PHASE_QUIET_MS) });
    expect(deriveLanePhase(i, T0 + PHASE_QUIET_MS + 60_000)).toBe("agent-reading");
  });

  it("floors the quiet clock at the stage start — a session that just began is not 'quiet for 5m'", () => {
    const i = input({ tail: [ev("result", 0)], stageAt: iso(300_000) });
    expect(deriveLanePhase(i, T0 + 310_000)).toBe("agent-thinking");
  });

  it("never claims quiet without evidence to measure from", () => {
    expect(deriveLanePhase(input({}), T0 + 10 * PHASE_QUIET_MS)).toBe("agent-thinking");
  });

  it("does not decay a stage the lane wrote — the stage row IS the evidence", () => {
    expect(deriveLanePhase(input({ stage: "verifying", stageAt: iso(0), tail: [ev("edit", 0)] }), T0 + 10 * PHASE_QUIET_MS)).toBe(
      "verifying",
    );
  });
});

describe("evidence and quiet measurement", () => {
  it("takes the newest of the tail, the heartbeat and the stage start", () => {
    expect(newestEvidenceMs({ tail: [ev("read", 1_000)], heartbeatAt: iso(3_000), stageAt: iso(2_000) })).toBe(T0 + 3_000);
    expect(newestEvidenceMs({ tail: [], heartbeatAt: null, stageAt: null })).toBeNull();
    expect(newestEvidenceMs({ tail: [{ ...ev("read", 0), at: "not a date" }], heartbeatAt: null })).toBeNull();
  });

  it("measures silence from it, never negative", () => {
    expect(laneQuietForMs({ tail: [ev("read", 0)], heartbeatAt: null }, T0 + 180_000)).toBe(180_000);
    expect(laneQuietForMs({ tail: [ev("read", 5_000)], heartbeatAt: null }, T0)).toBe(0);
    expect(laneQuietForMs({ tail: [], heartbeatAt: null }, T0)).toBeNull();
  });
});

describe("lanePhaseLabel — the words", () => {
  const rows: [LanePhase, string][] = [
    ["queued", "Queued"],
    ["planning", "Planning"],
    ["baseline", "Checking the baseline"],
    ["agent-reading", "Reading the code"],
    ["agent-editing", "Editing"],
    ["agent-thinking", "Thinking"],
    ["verifying", "Checking the build"],
    ["installing", "Installing dependencies"],
    ["committing", "Committing"],
    ["landing", "Landing"],
    ["rescanning", "Rescanning"],
    ["held", "Held for review"],
    ["done", "Done"],
    ["error", "Failed"],
  ];
  it.each(rows)("%s → %s", (phase, want) => {
    expect(lanePhaseLabel(phase)).toBe(want);
  });

  it("says how long a quiet agent has been quiet — presence, never progress", () => {
    expect(lanePhaseLabel("agent-quiet", 3 * 60_000)).toBe("Still working — quiet for 3m");
    expect(lanePhaseLabel("agent-quiet", 80 * 60_000)).toBe("Still working — quiet for 1h 20m");
    expect(lanePhaseLabel("agent-quiet")).toBe("Still working — quiet");
  });

  it("formats silences coarsely", () => {
    expect(fmtQuiet(45_000)).toBe("45s");
    expect(fmtQuiet(90_000)).toBe("1m");
    expect(fmtQuiet(2 * 3_600_000)).toBe("2h");
    expect(fmtQuiet(-5)).toBe("0s");
  });
});
