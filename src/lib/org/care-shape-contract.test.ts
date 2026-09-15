// The C3 share contract, pinned before any producer exists. Every refusal below is a payload the
// tree accepted before this module: `CareSessionShape` is `number | null` per field, so a 140% plan
// mode, a 90-day window summed into a "30d" count or an unknown field had nothing to stop them.

import { describe, expect, it } from "vitest";
import {
  CARE_SHAPE_SCOPE,
  CARE_SHAPE_REASON_COPY,
  CARE_SHAPE_WINDOW_DAYS,
  careCountsTowardShape,
  careShapeEmptyReason,
  validateCareShapePayload,
} from "./care-shape-contract";
import { CARE_SHAPE_ORDER, emptyDeveloperView, type DeveloperView } from "./developer-view";

const good = () => ({
  contract: 1,
  windowDays: 30,
  launcher: "interactive-only",
  excludedProgrammatic: 4,
  fields: { sessionsPerWeek: 11, planModePct: 62, skillInvokes30d: 23, compactionsPerSession: { reason: "not-collected" } },
});

describe("CARE_SHAPE_SCOPE", () => {
  it("declares a scope for exactly the fields the page renders", () => {
    expect(Object.keys(CARE_SHAPE_SCOPE).sort()).toEqual([...CARE_SHAPE_ORDER].sort());
    for (const scope of Object.values(CARE_SHAPE_SCOPE)) {
      expect(scope.numerator.length).toBeGreaterThan(0);
      // Only a plain count may go without a denominator.
      expect(scope.denominator === null).toBe(scope.unit === "count");
    }
    expect(CARE_SHAPE_WINDOW_DAYS).toBe(30);
  });
});

describe("careCountsTowardShape", () => {
  it("admits only sessions a person launched", () => {
    expect(careCountsTowardShape("cli")).toBe(true);
    expect(careCountsTowardShape("claude-desktop")).toBe(true);
  });

  it("excludes SDK, MCP, CI and unknown launchers, and a missing entrypoint", () => {
    for (const e of ["sdk-ts", "sdk-py", "mcp", "claude-code-github-action", "local-agent", "CLI", "", null, undefined]) {
      expect(careCountsTowardShape(e)).toBe(false);
    }
  });
});

describe("validateCareShapePayload: accepts", () => {
  it("folds a valid payload into the view's shape, shared fields and declared reasons", () => {
    const r = validateCareShapePayload(good());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.shape).toEqual({ ...emptyDeveloperView().shape, sessionsPerWeek: 11, planModePct: 62, skillInvokes30d: 23 });
    expect(r.sharedFields).toEqual(["sessionsPerWeek", "planModePct", "skillInvokes30d", "compactionsPerSession"]);
    expect(r.shapeReasons).toEqual({ compactionsPerSession: "not-collected" });
  });

  it("keeps a measured zero and the ratio bounds themselves", () => {
    const r = validateCareShapePayload({ ...good(), fields: { planModePct: 0, testsBeforeCommitPct: 100, retriesPerSession: 0 } });
    expect(r.ok && r.shape.planModePct).toBe(0);
    expect(r.ok && r.shape.testsBeforeCommitPct).toBe(100);
  });
});

describe("validateCareShapePayload: refuses", () => {
  const refused: Array<[string, unknown]> = [
    ["a non-object", "sessions=11"],
    ["an unknown top-level key", { ...good(), transcript: "hello" }],
    ["an unknown field", { ...good(), fields: { sessionsPerWeek: 11, hoursAfterMidnight: 3 } }],
    ["a field named after a prototype key", { ...good(), fields: { constructor: 1 } }],
    ["a ratio above 100", { ...good(), fields: { planModePct: 140 } }],
    ["a negative value", { ...good(), fields: { turnsPerSession: -1 } }],
    ["a non-finite value", { ...good(), fields: { turnsPerSession: Number.NaN } }],
    ["a string value", { ...good(), fields: { sessionsPerWeek: "11" } }],
    ["a fractional count", { ...good(), fields: { skillInvokes30d: 2.5 } }],
    ["a window other than the declared one", { ...good(), windowDays: 90 }],
    ["a launcher that admits programmatic sessions", { ...good(), launcher: "all" }],
    ["another contract version", { ...good(), contract: 2 }],
    ["a missing exclusion count", { ...good(), excludedProgrammatic: undefined }],
    ["a reason only the server may derive", { ...good(), fields: { planModePct: { reason: "not-shared" } } }],
    ["a reason object carrying a value", { ...good(), fields: { planModePct: { reason: "below-sample", value: 3 } } }],
  ];

  it.each(refused)("refuses %s", (_label, payload) => {
    const r = validateCareShapePayload(payload);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThan(0);
  });

  it("reports every problem at once rather than the first", () => {
    const r = validateCareShapePayload({ ...good(), windowDays: 7, fields: { planModePct: 101, nope: 1 } });
    expect(r.ok ? [] : r.errors).toEqual(["windowDays must be 30", "planModePct: a ratio is out of range (0 to 100)", "unknown field: nope"]);
  });
});

describe("careShapeEmptyReason", () => {
  const shared = (over: Partial<DeveloperView>): DeveloperView => ({
    ...emptyDeveloperView("ada"),
    setup: { ...emptyDeveloperView().setup, lastShareAt: "2026-09-14T00:00:00.000Z" },
    ...over,
  });

  it("says nothing arrived when no share was ever received", () => {
    expect(careShapeEmptyReason(emptyDeveloperView("ada"), "planModePct")).toBe("no-share-received");
  });

  it("tells a field left out of a real share apart from one never received", () => {
    expect(careShapeEmptyReason(shared({ sharedFields: ["sessionsPerWeek"] }), "planModePct")).toBe("not-shared");
  });

  it("carries the producer's declared reason for a shared null", () => {
    const v = shared({ sharedFields: ["planModePct"], shapeReasons: { planModePct: "below-sample" } });
    expect(careShapeEmptyReason(v, "planModePct")).toBe("below-sample");
    expect(careShapeEmptyReason(shared({ sharedFields: ["planModePct"] }), "planModePct")).toBe("not-collected");
  });

  it("is null for a shared value, including a measured zero", () => {
    const v = shared({ sharedFields: ["planModePct"], shape: { ...emptyDeveloperView().shape, planModePct: 0 } });
    expect(careShapeEmptyReason(v, "planModePct")).toBeNull();
  });

  it("keeps every reason's label free of digits, so a void never reads as a number", () => {
    for (const { label, title } of Object.values(CARE_SHAPE_REASON_COPY)) {
      expect(label).not.toMatch(/\d/);
      expect(title).not.toContain(String.fromCharCode(0x2014));
    }
  });
});
