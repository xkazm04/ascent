import { describe, expect, it } from "vitest";
import {
  MIXED_ENGINE_PAIR_LABEL,
  MIXED_ENGINE_PAIR_NOTE,
  MOCK_ENGINE,
  MOCK_HOLLOW_FILL,
  MOCK_POINT_NOTE,
  MOCK_RING_DASH,
  MOCK_SNAPSHOT_NOTE,
  MOCK_SR_SUFFIX,
  hasMockPoint,
  isMockEngine,
  mixesEngines,
  mockHollowInset,
} from "@/components/report/chartEngine";

// G5-30. `engine.provider === "mock"` means the deterministic rubric scored the scan and no model
// contributed to it. Plotted identically to a model-scored point, a mock scan reads as a real jump or
// drop in maturity. These pin the predicate the charts branch on.

describe("isMockEngine", () => {
  it("is true only for the exact mock provider string", () => {
    expect(isMockEngine(MOCK_ENGINE)).toBe(true);
    expect(isMockEngine("mock")).toBe(true);
  });

  it("is false for every real provider", () => {
    for (const p of ["claude-cli", "anthropic", "bedrock", "openai"]) expect(isMockEngine(p)).toBe(false);
  });

  it("is false for an ABSENT engine — an org rollup point averages several scans and has no single one", () => {
    // The important half: `undefined` must not be treated as mock, or every rollup point would be
    // flagged as a demo scan it isn't.
    expect(isMockEngine(undefined)).toBe(false);
    expect(isMockEngine(null)).toBe(false);
    expect(isMockEngine("")).toBe(false);
  });

  it("is case-sensitive — a drifted casing is not silently accepted as mock", () => {
    expect(isMockEngine("Mock")).toBe(false);
    expect(isMockEngine("MOCK")).toBe(false);
  });
});

describe("hasMockPoint / mixesEngines", () => {
  it("arms the footnote for ANY mock point, including an all-mock series", () => {
    expect(hasMockPoint(["claude-cli", "mock", "claude-cli"])).toBe(true);
    expect(hasMockPoint(["mock", "mock"])).toBe(true);
  });

  it("stays quiet on a pure model-scored series (no legend where there is nothing to explain)", () => {
    expect(hasMockPoint(["claude-cli", "bedrock"])).toBe(false);
    expect(hasMockPoint([])).toBe(false);
    expect(hasMockPoint([undefined, undefined])).toBe(false);
  });

  it("mixesEngines isolates the actively-misleading case: a line segment spanning both methods", () => {
    expect(mixesEngines(["claude-cli", "mock", "claude-cli"])).toBe(true);
    expect(mixesEngines(["mock", "mock", "mock"])).toBe(false); // uniformly demo — not a false jump
    expect(mixesEngines(["claude-cli"])).toBe(false);
    expect(mixesEngines(["mock", undefined])).toBe(false); // undefined is not a model-scored point
  });
});

describe("the caveat copy says the model did not contribute", () => {
  it("names the deterministic rubric and the non-comparability, not just 'demo'", () => {
    expect(MOCK_POINT_NOTE).toMatch(/deterministic/i);
    expect(MOCK_POINT_NOTE).toMatch(/not comparable/i);
    expect(MOCK_POINT_NOTE).toMatch(/hollow/i); // the legend must name the mark it explains
    expect(MOCK_SR_SUFFIX).toMatch(/demo scan/i);
    expect(MOCK_SR_SUFFIX).toMatch(/no model/i);
  });
});

describe("mock is an engine identity, not D9", () => {
  // D9 (Security) is signal-only on every live scan: the check battery IS the score and the model
  // only narrates it. That is provenance. A mock-scored REPORT is a different claim — no model
  // contributed to any dimension — and the snapshot charts paint hollow because of the engine, not
  // because a dimension is deterministic. Folding the two together would hollow D9 on a live scan
  // (a real measurement) or treat a demo score as if it were the security battery.
  it("does not treat the security dimension id, or a live provider, as mock", () => {
    expect(isMockEngine("D9")).toBe(false);
    expect(isMockEngine("signal-only")).toBe(false);
    expect(isMockEngine("claude-cli")).toBe(false);
  });

  it("snapshot-chart copy names the hollow mark and does not mention D9", () => {
    expect(MOCK_SNAPSHOT_NOTE).toMatch(/hollow/i);
    expect(MOCK_SNAPSHOT_NOTE).toMatch(/deterministic/i);
    expect(MOCK_SNAPSHOT_NOTE).toMatch(/no model/i);
    expect(MOCK_SNAPSHOT_NOTE).toMatch(/not comparable/i);
    expect(MOCK_SNAPSHOT_NOTE).not.toMatch(/D9|security/i);
    expect(MOCK_HOLLOW_FILL).toBe("var(--color-surface-strong)");
    expect(MOCK_RING_DASH).toMatch(/\d+\s+\d+/);
    expect(mockHollowInset("#22c55e")).toBe("inset 0 0 0 1.5px #22c55e");
  });
});

describe("mixed-engine What Changed pair copy", () => {
  it("labels the pair and names why mock vs live is not a comparable delta", () => {
    expect(MIXED_ENGINE_PAIR_LABEL).toBe("Mixed engines");
    expect(MIXED_ENGINE_PAIR_NOTE).toMatch(/demo/i);
    expect(MIXED_ENGINE_PAIR_NOTE).toMatch(/deterministic/i);
    expect(MIXED_ENGINE_PAIR_NOTE).toMatch(/no model/i);
    expect(MIXED_ENGINE_PAIR_NOTE).toMatch(/not a comparable measurement/i);
  });
});
