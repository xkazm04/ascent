// The platform-observed folds (deepening pass, 2026-08-17): installed-App inventory → D2/D3/D4 and
// default-branch CI health → D3.
//
// What these pin, beyond the arithmetic:
//   • NO DOUBLE CREDIT — when the file scan already found the pipeline / the review bot / the coverage
//     reporter, the App is appended as evidence with ZERO points. Otherwise a repo that both commits a
//     workflow and installs the App would out-score one that only commits it, for the same capability.
//   • ADDITIVE ONLY — nothing here ever subtracts. A red main is named in the evidence, never
//     penalized: an anonymous scan can't observe runs at all, so a penalty would mean the same repo
//     scores LOWER the more access it grants.
//   • Null / empty inputs are "not observable", never "absent" (they must leave `signals` untouched).
//   • A crashed detector's placeholder is never decorated (G3-08).

import { describe, it, expect } from "vitest";
import { applyAppInventorySignals, applyCiHealthSignals } from "./platform-signals";
import type { AppInventory, AppSuite } from "@/lib/github/check-suites";
import type { CiHealth } from "@/lib/github/actions-health";
import type { DimensionId, DimensionSignals, Signal } from "@/lib/types";

const app = (slug: string): AppSuite => ({ slug, name: slug, conclusion: "success" });

const inv = (slugs: string[]): AppInventory => ({
  sha: "abc123",
  apps: slugs.map(app),
  total: slugs.length,
  truncated: false,
});

const dim = (id: DimensionId, signalScore: number, signals: Signal[] = []): DimensionSignals => ({
  id,
  signalScore,
  signals,
});

/** The dimension `id` out of a fold's output (the folds preserve order + length). */
const pick = (out: DimensionSignals[], id: DimensionId): DimensionSignals => out.find((s) => s.id === id)!;

const health = (over: Partial<CiHealth> = {}): CiHealth => ({
  branch: "main",
  sampled: 20,
  successRate: 95,
  medianDurationMin: 7,
  latestRunAt: "2026-08-16T00:00:00Z",
  workflows: 3,
  failing: [],
  ...over,
});

// ── App inventory → D2/D3/D4 ─────────────────────────────────────────────────

describe("applyAppInventorySignals — not observable vs nothing installed", () => {
  it("is a no-op on null / undefined (a tokenless scan never saw the check suites)", () => {
    const base = [dim("D4", 40)];
    expect(applyAppInventorySignals(base, null)).toBe(base);
    expect(applyAppInventorySignals(base, undefined)).toBe(base);
  });

  it("adds nothing when the inventory holds no scoreable category", () => {
    // github-actions is `actions`; code scanning + Wiz are D9's share (security/checks.ts owns them).
    const base = [dim("D2", 50), dim("D3", 50), dim("D4", 50)];
    const out = applyAppInventorySignals(base, inv(["github-actions", "github-code-scanning", "wiz-1234"]));
    expect(out).toBe(base);
  });

  it("adds nothing for an empty apps list on a real 200", () => {
    const base = [dim("D3", 50)];
    expect(applyAppInventorySignals(base, inv([]))).toBe(base);
  });
});

describe("applyAppInventorySignals — D4 (AI review Apps)", () => {
  it("credits +25 and names the slugs when the file scan found no review bot", () => {
    const out = pick(applyAppInventorySignals([dim("D4", 40)], inv(["claude", "coderabbitai"])), "D4");
    expect(out.signalScore).toBe(65);
    expect(out.signals).toHaveLength(1);
    expect(out.signals[0]!.label).toBe("AI review/agent App installed");
    expect(out.signals[0]!.detail).toBe("observed on the scored commit: claude, coderabbitai");
  });

  it("adds evidence with NO points when D4 already carries the configured-bot label", () => {
    const base = [dim("D4", 60, [{ label: "AI code-review agent in the pipeline" }])];
    const out = pick(applyAppInventorySignals(base, inv(["claude"])), "D4");
    expect(out.signalScore).toBe(60); // no double credit for one review bot
    expect(out.signals).toHaveLength(2);
    expect(out.signals[1]!.label).toBe("AI review App also observed on the scored commit");
    expect(out.signals[1]!.detail).toBe("claude");
  });

  it("clamps at 100", () => {
    expect(pick(applyAppInventorySignals([dim("D4", 90)], inv(["claude"])), "D4").signalScore).toBe(100);
  });
});

describe("applyAppInventorySignals — D3 (CI + deploy Apps)", () => {
  it("credits +35 for an off-Actions CI the file scan missed entirely", () => {
    const out = pick(
      applyAppInventorySignals([dim("D3", 20, [{ label: "No CI pipeline detected" }])], inv(["azure-pipelines"])),
      "D3",
    );
    expect(out.signalScore).toBe(55);
    expect(out.signals[1]!.label).toBe("CI system posting checks");
    expect(out.signals[1]!.detail).toBe("azure-pipelines");
  });

  it.each([
    "GitHub Actions CI present",
    "CI pipeline present",
    "Off-GitHub CI detected (Gerrit)",
  ])("adds evidence with NO points when D3 already has %s", (label) => {
    const out = pick(applyAppInventorySignals([dim("D3", 60, [{ label }])], inv(["circleci"])), "D3");
    expect(out.signalScore).toBe(60);
    expect(out.signals[1]!.label).toBe("CI App also posting checks on the scored commit");
    expect(out.signals[1]!.detail).toBe("circleci");
  });

  it("credits +10 for a deploy platform the file scan missed", () => {
    const out = pick(applyAppInventorySignals([dim("D3", 50)], inv(["vercel", "netlify"])), "D3");
    expect(out.signalScore).toBe(60);
    expect(out.signals[0]!.label).toBe("Deploy platform wired");
    expect(out.signals[0]!.detail).toBe("vercel, netlify");
  });

  it("adds evidence with NO points when D3 already has the deploy step", () => {
    const base = [dim("D3", 50, [{ label: "Automated deploy step" }])];
    const out = pick(applyAppInventorySignals(base, inv(["vercel"])), "D3");
    expect(out.signalScore).toBe(50);
    expect(out.signals[1]!.label).toBe("Deploy platform also observed on the scored commit");
  });

  it("stacks CI and deploy in one pass (+45) with one evidence line each", () => {
    const out = pick(applyAppInventorySignals([dim("D3", 10)], inv(["buildkite", "render"])), "D3");
    expect(out.signalScore).toBe(55);
    expect(out.signals.map((x) => x.label)).toEqual(["CI system posting checks", "Deploy platform wired"]);
  });
});

describe("applyAppInventorySignals — D2 (coverage reporters)", () => {
  it("credits +8 when D2 has no coverage signal", () => {
    const out = pick(applyAppInventorySignals([dim("D2", 40, [{ label: "Found 12 test files" }])], inv(["codecov"])), "D2");
    expect(out.signalScore).toBe(48);
    expect(out.signals[1]!.label).toBe("Coverage reporter wired");
    expect(out.signals[1]!.detail).toBe("codecov");
  });

  it("adds evidence with NO points when the file scan already found coverage tracking", () => {
    const base = [dim("D2", 40, [{ label: "Coverage tracking configured" }])];
    const out = pick(applyAppInventorySignals(base, inv(["codecov", "coveralls"])), "D2");
    expect(out.signalScore).toBe(40);
    expect(out.signals[1]!.label).toBe("Coverage reporter also observed on the scored commit");
    expect(out.signals[1]!.detail).toBe("codecov, coveralls");
  });
});

describe("applyAppInventorySignals — a failed detector is never decorated (G3-08)", () => {
  it("leaves a crashed D3/D4/D2 placeholder byte-identical", () => {
    const failed = (id: DimensionId): DimensionSignals => ({ id, signalScore: 0, signals: [], failed: true });
    const base = [failed("D2"), failed("D3"), failed("D4")];
    const out = applyAppInventorySignals(base, inv(["claude", "circleci", "vercel", "codecov"]));
    expect(out).toEqual(base);
  });
});

// ── CI health → D3 ───────────────────────────────────────────────────────────

describe("applyCiHealthSignals — not observable vs no runs", () => {
  it("is a no-op on null / undefined", () => {
    const base = [dim("D3", 50)];
    expect(applyCiHealthSignals(base, null)).toBe(base);
    expect(applyCiHealthSignals(base, undefined)).toBe(base);
  });

  it("is a no-op on sampled: 0 — an off-Actions repo has nothing observable to judge", () => {
    const base = [dim("D3", 50)];
    expect(applyCiHealthSignals(base, health({ sampled: 0, successRate: null, medianDurationMin: null }))).toBe(base);
  });

  it("adds an evidence line with no points below the 5-run floor", () => {
    const out = pick(applyCiHealthSignals([dim("D3", 50)], health({ sampled: 3, successRate: 67 })), "D3");
    expect(out.signalScore).toBe(50);
    expect(out.signals[0]!.label).toBe("Default-branch CI: too few recent runs to judge");
    expect(out.signals[0]!.detail).toBe("3 completed runs sampled");
  });

  it("treats a null successRate at or above the floor as unjudgeable rather than 0%", () => {
    const out = pick(applyCiHealthSignals([dim("D3", 50)], health({ sampled: 9, successRate: null })), "D3");
    expect(out.signalScore).toBe(50);
    expect(out.signals[0]!.label).toBe("Default-branch CI: too few recent runs to judge");
  });
});

describe("applyCiHealthSignals — thresholds", () => {
  it.each([
    [100, 8, "Default-branch CI healthy"],
    [90, 8, "Default-branch CI healthy"],
    [89, 4, "Default-branch CI mostly green"],
    [75, 4, "Default-branch CI mostly green"],
    [74, 0, "Default-branch CI red"],
    [0, 0, "Default-branch CI red"],
  ])("successRate %i → +%i (%s)", (successRate, credit, label) => {
    const out = pick(applyCiHealthSignals([dim("D3", 50)], health({ successRate })), "D3");
    expect(out.signalScore).toBe(50 + credit);
    expect(out.signals[0]!.label).toBe(label);
  });

  it("credits exactly at the 5-run floor", () => {
    const out = pick(applyCiHealthSignals([dim("D3", 50)], health({ sampled: 5, successRate: 100 })), "D3");
    expect(out.signalScore).toBe(58);
  });

  it("clamps at 100", () => {
    expect(pick(applyCiHealthSignals([dim("D3", 96)], health()), "D3").signalScore).toBe(100);
  });

  it("only touches D3", () => {
    const out = applyCiHealthSignals([dim("D2", 50), dim("D3", 50), dim("D4", 50)], health());
    expect(pick(out, "D2").signals).toHaveLength(0);
    expect(pick(out, "D4").signals).toHaveLength(0);
    expect(pick(out, "D3").signals).toHaveLength(1);
  });

  it("never decorates a crashed D3 (G3-08)", () => {
    const base: DimensionSignals[] = [{ id: "D3", signalScore: 0, signals: [], failed: true }];
    expect(applyCiHealthSignals(base, health())).toEqual(base);
  });
});

describe("applyCiHealthSignals — the evidence detail is re-traceable", () => {
  it("states rate, sample, median and workflow count", () => {
    const out = pick(applyCiHealthSignals([dim("D3", 50)], health({ successRate: 92, sampled: 40, medianDurationMin: 12, workflows: 6 })), "D3");
    expect(out.signals[0]!.detail).toBe("92% of last 40 runs green · median 12 min · 6 workflows");
  });

  it("omits the median clause when the duration is unknown", () => {
    const out = pick(applyCiHealthSignals([dim("D3", 50)], health({ medianDurationMin: null })), "D3");
    expect(out.signals[0]!.detail).toBe("95% of last 20 runs green · 3 workflows");
  });

  it("names the currently-red workflows", () => {
    const out = pick(applyCiHealthSignals([dim("D3", 50)], health({ successRate: 60, failing: ["e2e", "lint"] })), "D3");
    expect(out.signals[0]!.detail).toBe("60% of last 20 runs green · median 7 min · 3 workflows · failing: e2e, lint");
  });

  it("caps the named workflows at 3 and counts the rest", () => {
    const out = pick(
      applyCiHealthSignals([dim("D3", 50)], health({ successRate: 40, failing: ["a", "b", "c", "d", "e"] })),
      "D3",
    );
    expect(out.signals[0]!.detail).toBe("40% of last 20 runs green · median 7 min · 3 workflows · failing: a, b, c +2");
  });
});
