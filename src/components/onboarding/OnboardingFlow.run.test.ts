// The wizard's ONE run model (first-run-onboarding-wizard#A, challenge-2026-09-23).
//
// A run used to be 23 useStates plus three hand-kept lists that had to agree: the resetRun setter
// list, the snapshot field list and the "has this row settled?" predicate (nine sites, three
// variants). These pin the pure replacement: one row vocabulary, one reset derived from the type, and
// a versioned snapshot that carries WHAT the run is (its plan and consent), not only where it was.

import { describe, it, expect } from "vitest";
import {
  decodeSnapshot,
  encodeSnapshot,
  initialRun,
  reportableRepos,
  rowSettled,
  runMode,
  runProgress,
  runReducer,
  settleLeftovers,
  type RunState,
} from "./OnboardingFlow.run";

const LIVE_PLAN = {
  mock: false,
  watch: true,
  schedule: undefined,
  upgradeAfter: false,
  publicFunnel: false,
  previewCause: null,
} as const;

describe("one row-settle rule", () => {
  it("a re-attached 'completed' row is settled and counts toward progress", () => {
    expect(rowSettled({ repo: "a/b", completed: true })).toBe(true);
    expect(rowSettled({ repo: "a/b" })).toBe(false);
    expect(
      runProgress({ a: { repo: "a", completed: true }, b: { repo: "b", level: "L2", overall: 40 } }),
    ).toEqual({ completed: 2, total: 2, pct: 100 });
    expect(runProgress({})).toEqual({ completed: 0, total: 0, pct: 0 });
  });

  it("reportableRepos keeps scored AND completed rows, never errored/skipped/unsettled ones", () => {
    expect(
      reportableRepos({
        "a/scored": { repo: "a/scored", level: "L3", overall: 60 },
        "a/done": { repo: "a/done", completed: true },
        "a/err": { repo: "a/err", error: "boom" },
        "a/skip": { repo: "a/skip", skipped: "not_scanned" },
        "a/wait": { repo: "a/wait" },
      }),
    ).toEqual(["a/scored", "a/done"]);
  });

  it("settleLeftovers resolves only the unsettled rows, with the given reason", () => {
    const out = settleLeftovers(
      { a: { repo: "a" }, b: { repo: "b", completed: true }, c: { repo: "c", error: "x" } },
      "monthly_quota",
    );
    expect(out).toEqual({
      a: { repo: "a", skipped: "monthly_quota" },
      b: { repo: "b", completed: true },
      c: { repo: "c", error: "x" },
    });
  });
});

describe("runReducer reset", () => {
  it("reset deep-equals initialRun() for every RunState key, whatever the state was", () => {
    const dirty: RunState = {
      phase: "done",
      rows: { a: { repo: "a", level: "L2", overall: 40 } },
      gate: { kind: "signin", org: "acme" },
      credit: { org: "acme", balance: 3, unlimited: false },
      plan: { ...LIVE_PLAN },
      consent: { previewFirst: false, watchOptIn: true },
      notices: [{ reason: "monthly_quota", scanning: 1, skipped: 1 }],
      runId: "run-1",
      reattached: true,
      invitedCount: 2,
    };
    const reset = runReducer(dirty, { type: "reset" });
    expect(reset).toEqual(initialRun());
    // Every key the type declares is covered: the reset set is derived, not hand-kept.
    expect(Object.keys(reset).sort()).toEqual(Object.keys(dirty).sort());
  });
});

describe("runMode — the done-screen disclosures read off the recorded plan", () => {
  it("no plan yet: preview by default, mode unresolved (today's pre-resolution behaviour)", () => {
    expect(runMode(initialRun())).toEqual({
      previewScan: true,
      modeResolved: false,
      upgradePlanned: false,
      previewCause: null,
    });
  });

  it("a live plan is not a preview; an upgrade plan is a preview with the upgrade owed", () => {
    expect(runMode({ ...initialRun(), plan: { ...LIVE_PLAN } }).previewScan).toBe(false);
    const up = runMode({ ...initialRun(), plan: { ...LIVE_PLAN, mock: true, upgradeAfter: true, schedule: "off" } });
    expect(up).toMatchObject({ previewScan: true, upgradePlanned: true, modeResolved: true });
  });
});

describe("snapshot codec", () => {
  it("encodes v2 with the plan and consent, and decodes it back", () => {
    const raw = encodeSnapshot({
      org: "acme",
      sourceLabel: "acme",
      sourceInstallId: "42",
      selected: ["acme/api"],
      phase: "scanning",
      runId: "run-1",
      plan: { ...LIVE_PLAN },
      consent: { previewFirst: false, watchOptIn: true },
    });
    const snap = decodeSnapshot(raw);
    expect(snap).toMatchObject({ version: 2, runId: "run-1", consent: { previewFirst: false, watchOptIn: true } });
    expect(snap?.plan).toMatchObject({ mock: false, watch: true, upgradeAfter: false });
  });

  it("guard: a v1 snapshot (no version, no plan) still decodes, with no plan and no consent", () => {
    const snap = decodeSnapshot(
      JSON.stringify({ org: "acme", sourceLabel: "acme", sourceInstallId: null, selected: ["a/b"], phase: "select" }),
    );
    expect(snap).toMatchObject({ sourceLabel: "acme", selected: ["a/b"], phase: "select", runId: null });
    expect(snap?.plan).toBeNull();
    expect(snap?.consent).toBeNull();
  });

  it("drops a malformed plan rather than trusting it, and rejects garbage outright", () => {
    const snap = decodeSnapshot(
      JSON.stringify({ version: 2, org: "a", sourceLabel: "a", sourceInstallId: null, selected: [], plan: { mock: "yes" } }),
    );
    expect(snap?.plan).toBeNull();
    expect(decodeSnapshot("not json")).toBeNull();
    expect(decodeSnapshot(null)).toBeNull();
    expect(decodeSnapshot(JSON.stringify({ selected: [] }))).toBeNull();
  });
});
