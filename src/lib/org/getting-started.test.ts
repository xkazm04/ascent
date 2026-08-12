// Pure getting-started model (W6a): per-step doneness from facts, availability honesty by workspace
// kind + viewer role, the ≥2-of-3 loop bar, and the allDone rollup counting AVAILABLE steps only.

import { describe, it, expect } from "vitest";
import type { GettingStartedFacts } from "@/lib/db/org-onboarding";
import { buildGettingStartedModel, GETTING_STARTED_ANCHORS, type GettingStartedStepId } from "./getting-started";

const baseFacts: GettingStartedFacts = {
  kind: "org",
  hasCompletedScan: false,
  gapEngaged: false,
  registrySeeded: false,
  loopSchedule: false,
  loopAlerts: false,
  loopStance: false,
  memberCount: 1,
  hasPendingInvite: false,
};

const facts = (over: Partial<GettingStartedFacts> = {}): GettingStartedFacts => ({ ...baseFacts, ...over });

const step = (m: ReturnType<typeof buildGettingStartedModel>, id: GettingStartedStepId) => {
  const s = m.steps.find((x) => x.id === id);
  if (!s) throw new Error(`missing step ${id}`);
  return s;
};

describe("step doneness", () => {
  it("first-scan flips on hasCompletedScan", () => {
    expect(step(buildGettingStartedModel(facts(), null), "first-scan").done).toBe(false);
    expect(step(buildGettingStartedModel(facts({ hasCompletedScan: true }), null), "first-scan").done).toBe(true);
  });

  it("gap-engaged / registry mirror their facts", () => {
    const m = buildGettingStartedModel(facts({ gapEngaged: true, registrySeeded: true }), null);
    expect(step(m, "gap-engaged").done).toBe(true);
    expect(step(m, "registry").done).toBe(true);
    const m0 = buildGettingStartedModel(facts(), null);
    expect(step(m0, "gap-engaged").done).toBe(false);
    expect(step(m0, "registry").done).toBe(false);
  });

  it("loop needs at least TWO of {schedule, alerts, stance}", () => {
    expect(step(buildGettingStartedModel(facts({ loopSchedule: true }), null), "loop").done).toBe(false);
    expect(
      step(buildGettingStartedModel(facts({ loopSchedule: true, loopAlerts: true }), null), "loop").done,
    ).toBe(true);
    expect(
      step(buildGettingStartedModel(facts({ loopAlerts: true, loopStance: true }), null), "loop").done,
    ).toBe(true);
  });

  it("loop detail reports which instruments are on", () => {
    const s = step(buildGettingStartedModel(facts({ loopSchedule: true }), null), "loop");
    expect(s.detail).toContain("1 of 3");
    expect(s.detail).toContain("watch schedule ✓");
    expect(s.detail).toContain("published AI stance");
  });

  it("team is done with ≥2 members OR a pending invite", () => {
    expect(step(buildGettingStartedModel(facts({ memberCount: 1 }), null), "team").done).toBe(false);
    expect(step(buildGettingStartedModel(facts({ memberCount: 2 }), null), "team").done).toBe(true);
    expect(
      step(buildGettingStartedModel(facts({ memberCount: 1, hasPendingInvite: true }), null), "team").done,
    ).toBe(true);
  });
});

describe("availability honesty — workspace kind", () => {
  it("a personal workspace loses the fleet loop and team steps, keeps the rest", () => {
    const m = buildGettingStartedModel(facts({ kind: "personal" }), null);
    expect(m.personal).toBe(true);
    expect(step(m, "first-scan").available).toBe(true);
    expect(step(m, "gap-engaged").available).toBe(true);
    expect(step(m, "registry").available).toBe(true);
    expect(step(m, "loop").available).toBe(false);
    expect(step(m, "team").available).toBe(false);
  });
});

describe("availability honesty — viewer role", () => {
  it("null role (auth-off deployment) is unrestricted", () => {
    const m = buildGettingStartedModel(facts(), null);
    expect(m.steps.every((s) => s.available)).toBe(true);
  });

  it("viewer: only the read-shaped first-scan step is available", () => {
    const m = buildGettingStartedModel(facts(), "viewer");
    expect(m.steps.filter((s) => s.available).map((s) => s.id)).toEqual(["first-scan"]);
  });

  it("member: write steps open, loop (admin) and team (owner) stay closed", () => {
    const m = buildGettingStartedModel(facts(), "member");
    expect(m.steps.filter((s) => s.available).map((s) => s.id)).toEqual([
      "first-scan",
      "gap-engaged",
      "registry",
    ]);
  });

  it("admin: loop opens; team stays owner-gated (invites are owner-only)", () => {
    const m = buildGettingStartedModel(facts(), "admin");
    expect(step(m, "loop").available).toBe(true);
    expect(step(m, "team").available).toBe(false);
  });

  it("owner: everything is available", () => {
    const m = buildGettingStartedModel(facts(), "owner");
    expect(m.steps.every((s) => s.available)).toBe(true);
  });
});

describe("allDone rollup", () => {
  const allTrue = facts({
    hasCompletedScan: true,
    gapEngaged: true,
    registrySeeded: true,
    loopSchedule: true,
    loopAlerts: true,
    memberCount: 3,
  });

  it("true when every AVAILABLE step is done", () => {
    expect(buildGettingStartedModel(allTrue, "owner").allDone).toBe(true);
  });

  it("unavailable steps never block the rollup (viewer with just a scan is all done)", () => {
    const m = buildGettingStartedModel(facts({ hasCompletedScan: true }), "viewer");
    expect(m.allDone).toBe(true);
  });

  it("false while any available step is open", () => {
    expect(buildGettingStartedModel(facts({ hasCompletedScan: true }), "owner").allDone).toBe(false);
  });

  it("personal workspace rolls up over its three available steps", () => {
    const m = buildGettingStartedModel(
      facts({ kind: "personal", hasCompletedScan: true, gapEngaged: true, registrySeeded: true }),
      "owner",
    );
    expect(m.allDone).toBe(true);
  });
});

describe("navigation targets", () => {
  it("phases mirror the onboarding narrative in order", () => {
    const m = buildGettingStartedModel(facts(), null);
    expect(m.steps.map((s) => s.phase)).toEqual(["baseline", "resolve", "registry", "loop", "team"]);
  });

  it("each step points at its org tab and shared anchor constant", () => {
    const m = buildGettingStartedModel(facts(), null);
    expect(m.steps.map((s) => [s.id, s.tab, s.anchor])).toEqual([
      ["first-scan", "overview", GETTING_STARTED_ANCHORS["first-scan"]],
      ["gap-engaged", "backlog", GETTING_STARTED_ANCHORS["gap-engaged"]],
      ["registry", "skills", GETTING_STARTED_ANCHORS.registry],
      ["loop", "repositories", GETTING_STARTED_ANCHORS.loop],
      ["team", "members", GETTING_STARTED_ANCHORS.team],
    ]);
    // first-scan reuses the data-tour anchor that ALREADY exists in the DOM.
    expect(GETTING_STARTED_ANCHORS["first-scan"]).toBe("results-view");
  });
});
