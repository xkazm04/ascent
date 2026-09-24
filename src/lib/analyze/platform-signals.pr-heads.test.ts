// r22 (backlog develop-2026-09-17 row 42): an App seen ONLY on recent merged PR heads is credited.
//
// Row 12 made the inventory read suites on up to PR_HEAD_INVENTORY_CAP merged PR heads and kept what
// it found there in `prHeadApps`, apart from the scored commit's `apps`. This file pins the credit
// rule for that list, as the D2/D4 folds apply it:
//   • PR-gate categories only: an AI review, SAST, coverage or supply-chain App earns the SAME award
//     from a PR head as from the scored commit, because the pull request is where those tools run.
//     CI and deploy Apps are NOT credited from a PR head (a PR-head deploy suite is a preview; the D3
//     CI award is "a pipeline exists" read off the default branch).
//   • One award per capability: a category seen on both lists is paid once, and a slug on both lists
//     is named once, on the scored commit.
//   • `prHeadTruncated` never removes credit: the list is a floor, so what it names still counts and
//     what it could not read changes nothing.
//   • An inventory with no PR-head read is byte-identical to r21.

import { describe, it, expect } from "vitest";
import { applyAppInventorySignals, applyPlatformSignals } from "./platform-signals";
import { prHeadAppsOf, type AppInventory, type AppSuite } from "@/lib/github/check-suites";
import type { DimensionId, DimensionSignals, Signal } from "@/lib/types";

const app = (slug: string): AppSuite => ({ slug, name: slug, conclusion: "success" });

const inv = (commit: string[], prHead?: string[], prHeadTruncated = false): AppInventory => ({
  sha: "abc123",
  apps: commit.map(app),
  total: commit.length,
  truncated: false,
  ...(prHead ? { prHeadApps: prHead.map(app), prHeadShas: ["pr1", "pr2"], prHeadTruncated } : {}),
});

const dim = (id: DimensionId, signalScore: number, signals: Signal[] = [], facets?: string[]): DimensionSignals => ({
  id,
  signalScore,
  signals,
  ...(facets ? { facets } : {}),
});

const pick = (out: DimensionSignals[], id: DimensionId): DimensionSignals => out.find((s) => s.id === id)!;
const base = () => [dim("D2", 30), dim("D3", 30), dim("D4", 40)];

describe("prHeadAppsOf: the PR-head half of a category", () => {
  it("returns PR-head Apps of a PR-gate category and nothing for CI or deploy", () => {
    const i = inv(["github-actions"], ["codecov", "github-code-scanning", "coderabbitai", "socket-security", "circleci", "vercel"]);
    expect(prHeadAppsOf(i, "coverage").map((a) => a.slug)).toEqual(["codecov"]);
    expect(prHeadAppsOf(i, "sast").map((a) => a.slug)).toEqual(["github-code-scanning"]);
    expect(prHeadAppsOf(i, "ai-review").map((a) => a.slug)).toEqual(["coderabbitai"]);
    expect(prHeadAppsOf(i, "supply-chain").map((a) => a.slug)).toEqual(["socket-security"]);
    expect(prHeadAppsOf(i, "ci")).toEqual([]);
    expect(prHeadAppsOf(i, "deploy")).toEqual([]);
  });

  it("never repeats a slug the scored commit lists, even on a hand-built inventory", () => {
    expect(prHeadAppsOf(inv(["codecov"], ["codecov", "coveralls"]), "coverage").map((a) => a.slug)).toEqual(["coveralls"]);
  });

  it("is empty on null, on no PR-head read, and on a malformed persisted list", () => {
    expect(prHeadAppsOf(null, "sast")).toEqual([]);
    expect(prHeadAppsOf(inv(["codecov"]), "coverage")).toEqual([]);
    const broken = { ...inv([]), prHeadApps: "codecov" } as unknown as AppInventory;
    expect(prHeadAppsOf(broken, "coverage")).toEqual([]);
  });
});

describe("applyAppInventorySignals: D2 credits a PR-only coverage App", () => {
  it("awards the +8 coverage fold once for a coverage App seen only on PR heads", () => {
    const out = pick(applyAppInventorySignals(base(), inv(["github-actions"], ["codecov"])), "D2");
    expect(out.signalScore).toBe(38);
    expect(out.signals).toEqual([{ label: "Coverage reporter wired", detail: "observed on recent PR heads: codecov" }]);
  });

  it("pays once when coverage is on the scored commit AND a second reporter is on PR heads", () => {
    const out = pick(applyAppInventorySignals(base(), inv(["codecov"], ["coveralls"])), "D2");
    expect(out.signalScore).toBe(38);
    expect(out.signals).toEqual([{ label: "Coverage reporter wired", detail: "codecov · on recent PR heads: coveralls" }]);
  });

  it("adds zero-point evidence when committed coverage config already earned the capability", () => {
    const out = pick(applyAppInventorySignals([dim("D2", 30, [{ label: "Coverage config" }])], inv([], ["codecov"])), "D2");
    expect(out.signalScore).toBe(30);
    expect(out.signals[1]).toEqual({ label: "Coverage reporter also observed on recent PR heads", detail: "codecov" });
  });
});

describe("applyAppInventorySignals: D4 credits a PR-only AI review App", () => {
  it("awards the automated_review facet once and says where it was seen", () => {
    const out = pick(applyAppInventorySignals(base(), inv([], ["coderabbitai"])), "D4");
    expect(out.signalScore).toBe(65);
    expect(out.facets).toEqual(["automated_review"]);
    expect(out.signals).toEqual([{ label: "AI review/agent App installed", detail: "observed on recent PR heads: coderabbitai" }]);
  });

  it("does not double-credit a review App seen on both the scored commit and a PR head", () => {
    const out = pick(applyAppInventorySignals(base(), inv(["claude"], ["claude", "coderabbitai"])), "D4");
    expect(out.signalScore).toBe(65);
    expect(out.signals[0]!.detail).toBe("observed on the scored commit: claude · on recent PR heads: coderabbitai");
  });

  it("is evidence only when the detector already evidenced the facet", () => {
    const out = pick(applyAppInventorySignals([dim("D4", 60, [], ["automated_review"])], inv([], ["claude"])), "D4");
    expect(out.signalScore).toBe(60);
    expect(out.signals).toEqual([{ label: "AI review App also observed on recent PR heads", detail: "claude" }]);
  });
});

describe("applyAppInventorySignals: what a PR head does not buy", () => {
  it("credits no CI or deploy App seen only on PR heads (D3 is untouched)", () => {
    const b = base();
    const out = applyAppInventorySignals(b, inv(["github-actions"], ["circleci", "vercel"]));
    expect(out).toBe(b);
  });

  it("a truncated PR-head read keeps the credit it names", () => {
    const out = pick(applyAppInventorySignals(base(), inv([], ["codecov"], true)), "D2");
    expect(out.signalScore).toBe(38);
  });

  it("a truncated PR-head read that named nothing changes nothing", () => {
    const b = base();
    expect(applyAppInventorySignals(b, inv(["github-actions"], [], true))).toBe(b);
  });

  it("guard: an inventory without a PR-head read scores exactly as r21 did", () => {
    const out = pick(applyAppInventorySignals(base(), inv(["codecov"])), "D2");
    expect(out.signalScore).toBe(38);
    expect(out.signals).toEqual([{ label: "Coverage reporter wired", detail: "codecov" }]);
  });
});

describe("applyPlatformSignals: the PR-head credit is part of the recorded fold", () => {
  it("records the points and evidence so a worktree carry replays them", () => {
    const { record } = applyPlatformSignals(base(), inv([], ["codecov"]), null, { observedAt: "2026-09-24T00:00:00Z" });
    expect(record?.dims).toEqual([
      { dimId: "D2", points: 8, signals: [{ label: "Coverage reporter wired", detail: "observed on recent PR heads: codecov" }] },
    ]);
  });
});
